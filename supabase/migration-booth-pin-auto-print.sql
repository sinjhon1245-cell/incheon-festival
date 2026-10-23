-- Additive migration: encrypted PIN recovery for admin-only QR-card printing.
-- IMPORTANT: do not apply to Production before clone tests + security review.
-- Baseline: migration-booth-pin.sql and migration-booth-pin-checked.sql.
-- Supabase Vault encrypts each PIN using a managed key separate from DB storage.
-- Existing bcrypt/HMAC hashes remain the login authority. For old PINs issued
-- before this migration (hash only), automatic reprinting is IMPOSSIBLE until
-- one new issuance; these rows remain untouched.
-- A successful issue/reissue updates the Vault secret and the hash in one SQL
-- transaction. Disabling overwrites the Vault secret with a non-PIN marker.
-- The exposed RPC always checks is_admin() + role privileges, and never returns
-- old/disabled/hash-mismatched PINs. Every successful read is audited.
-- Do not log response bodies or expose vault.decrypted_secrets.
--
-- Apply order: migration -> deployed print-qr.html; rollback as two-step change.
-- NOTE: This changes original one-time-reveal confidentiality by intent.

do $preflight$
begin
  if to_regprocedure('public.admin_issue_booth_pin_checked(uuid,text,timestamptz)') is null
     or to_regprocedure('public.admin_issue_booth_pin(uuid)') is null
     or to_regprocedure('public.admin_disable_booth_pin(uuid)') is null
     or to_regprocedure('private.booth_pin_digest(text)') is null
     or to_regprocedure('private.booth_pin_weak(text)') is null
     or to_regprocedure('vault.create_secret(text,text,text,uuid)') is null
     or to_regprocedure('vault.update_secret(uuid,text,text,text,uuid)') is null
     or to_regclass('vault.decrypted_secrets') is null
     or to_regclass('vault.secrets') is null
     or to_regprocedure('public.is_admin()') is null then
    raise exception 'PIN prerequisites unavailable; migration not applied';
  end if;
end $preflight$;

-- private = no Data API access. Append-only audit without PIN/token/secret values.
create table if not exists private.booth_pin_print_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid not null,
  booth_id uuid,
  action text not null default 'admin_pin_print_read'
    check (action = 'admin_pin_print_read')
);
alter table private.booth_pin_print_audit enable row level security;
revoke all on private.booth_pin_print_audit from public, anon, authenticated;
revoke all on sequence private.booth_pin_print_audit_id_seq from public, anon, authenticated;

-- Keep function signatures/OIDs and grants; checked-issue RPC still delegates here.

create or replace function public.admin_issue_booth_pin(p_booth_id uuid)
returns table (pin text, issued_at timestamptz, revoked_sessions integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_now  timestamptz := pg_catalog.now();
  v_zone text;
  v_no   integer;
  v_old  text;
  v_had  boolean;
  v_pin  text;
  v_at   timestamptz;
  v_n    integer;
  v_vault_name text;
  v_vault_id uuid;
begin
  if not public.is_admin() then
    raise exception '관리자만 PIN 을 발급할 수 있습니다.' using errcode = '42501';
  end if;
  select b.zone_key, b.no into v_zone, v_no from public.booths b where b.id = p_booth_id;
  if not found then
    raise exception '해당 부스를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_zone is null or v_no is null then
    raise exception '구역과 부스 번호를 먼저 지정해 주세요.' using errcode = '22023', hint = 'booth_pin_needs_slot';
  end if;

  select p.pin_hash into v_old from public.booth_pin p where p.booth_id = p_booth_id for update;
  v_had := found;
  loop
    v_pin := private.booth_pin_generate();
    -- 재발급이면 바로 앞 PIN 과 다른 값이어야 합니다.
    exit when v_old is null or extensions.crypt(private.booth_pin_digest(v_pin), v_old) <> v_old;
  end loop;

  insert into public.booth_pin as p (booth_id, pin_hash, issued_at, issued_by)
  values (p_booth_id, extensions.crypt(private.booth_pin_digest(v_pin), extensions.gen_salt('bf', 10)), v_now, auth.uid())
  on conflict on constraint booth_pin_pkey do update
     set pin_hash    = excluded.pin_hash,
         reissued_at = v_now,
         disabled_at = null,
         issued_by   = excluded.issued_by
  returning coalesce(p.reissued_at, p.issued_at) into v_at;

  -- Vault stores a separately encrypted, recoverable copy for admin-only printing.
  -- Same database transaction as the bcrypt hash and session revocation: no split-brain PIN.
  v_vault_name := 'booth_pin_print_' || p_booth_id::text;
  select s.id into v_vault_id from vault.secrets s where s.name = v_vault_name for update;
  if v_vault_id is null then
    perform vault.create_secret(v_pin, v_vault_name, 'Encrypted booth PIN for admin-only reprinting');
  else
    perform vault.update_secret(v_vault_id, v_pin);
  end if;

  with cut as (
    update public.booth_session as s
       set revoked_at = v_now, revoke_reason = 'pin_reissued'
     where s.booth_id = p_booth_id and s.revoked_at is null and s.expires_at > v_now
    returning s.id
  ), ev as (
    insert into public.booth_auth_event (event, booth_id, session_id, detail, actor)
    select 'session_revoked', p_booth_id, cut.id, 'pin_reissued', auth.uid() from cut
    returning 1
  )
  select count(*) into v_n from ev;

  insert into public.booth_auth_event (event, booth_id, actor)
  values (case when v_had then 'pin_reissued' else 'pin_issued' end, p_booth_id, auth.uid());

  return query select v_pin, v_at, v_n;
end;
$$;

create or replace function public.admin_disable_booth_pin(p_booth_id uuid)
returns table (disabled_at timestamptz, revoked_sessions integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_now timestamptz := pg_catalog.now();
  v_at  timestamptz;
  v_n   integer;
  v_vault_id uuid;
begin
  if not public.is_admin() then
    raise exception '관리자만 PIN 을 끌 수 있습니다.' using errcode = '42501';
  end if;
  update public.booth_pin as p
     set pin_hash    = case when p.disabled_at is null
                            then extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf', 10))
                            else p.pin_hash end,
         disabled_at = coalesce(p.disabled_at, v_now)
   where p.booth_id = p_booth_id
  returning p.disabled_at into v_at;
  if not found then
    raise exception '이 부스에는 아직 PIN 이 없습니다.' using errcode = 'P0002';
  end if;

  -- Destroy the recoverable prior PIN when disabled; the hash is already revoked.
  select s.id into v_vault_id from vault.secrets s
   where s.name = 'booth_pin_print_' || p_booth_id::text for update;
  if v_vault_id is not null then
    perform vault.update_secret(v_vault_id, 'revoked:' || encode(extensions.gen_random_bytes(24), 'hex'));
  end if;

  with cut as (
    update public.booth_session as s
       set revoked_at = v_now, revoke_reason = 'pin_disabled'
     where s.booth_id = p_booth_id and s.revoked_at is null and s.expires_at > v_now
    returning s.id
  ), ev as (
    insert into public.booth_auth_event (event, booth_id, session_id, detail, actor)
    select 'session_revoked', p_booth_id, cut.id, 'pin_disabled', auth.uid() from cut
    returning 1
  )
  select count(*) into v_n from ev;

  if v_at = v_now then
    insert into public.booth_auth_event (event, booth_id, actor) values ('pin_disabled', p_booth_id, auth.uid());
  end if;

  return query select v_at, v_n;
end;
$$;

-- Requested booth IDs only (no whole-table dump), up to 100 per request.
-- Fail closed on missing/disabled/corrupt copies; caller checks complete cardinality.
-- SECURITY DEFINER is necessary for locked PIN and Vault records; explicit admin
-- authorization AND GRANT restrictions are essential. No PINs in audit/logs.
create or replace function public.admin_print_booth_pins(p_booth_ids uuid[])
returns table(booth_id uuid, pin text, issued_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;
  if p_booth_ids is null or cardinality(p_booth_ids) = 0 then return; end if;
  if cardinality(p_booth_ids) > 100 or array_position(p_booth_ids, null) is not null then
    raise exception '요청할 부스 수 또는 ID가 올바르지 않습니다.' using errcode = '22023';
  end if;
  for r in
    select p.booth_id, p.pin_hash, coalesce(p.reissued_at,p.issued_at) as issued_at,
           s.decrypted_secret as decrypted_pin
      from public.booth_pin p
      join vault.decrypted_secrets s
        on s.name = 'booth_pin_print_' || p.booth_id::text
     where p.booth_id = any(p_booth_ids)
       and p.disabled_at is null
  loop
    -- Check Vault value against the *actual* PIN login hash, not only issued time.
    if r.decrypted_pin is null
       or private.booth_pin_weak(r.decrypted_pin)
       or extensions.crypt(private.booth_pin_digest(r.decrypted_pin), r.pin_hash) is distinct from r.pin_hash then
      raise exception 'PIN 인쇄 보관값을 확인할 수 없습니다.' using errcode = '22023';
    end if;
    insert into private.booth_pin_print_audit(actor, booth_id)
    values (auth.uid(), r.booth_id);
    return query select r.booth_id::uuid, r.decrypted_pin::text, r.issued_at::timestamptz;
  end loop;
end
$$;
revoke all on function public.admin_print_booth_pins(uuid[]) from public;
revoke execute on function public.admin_print_booth_pins(uuid[]) from anon;
grant execute on function public.admin_print_booth_pins(uuid[]) to authenticated;
comment on function public.admin_print_booth_pins(uuid[]) is
  'Administrator-only; retrieves Vault-encrypted current PIN for selected booths, verifies HMAC+bcrypt, audits every returned PIN. Do not expose to anon.';

notify pgrst, 'reload schema';

-- NONSECRET verification queries for a DBA AFTER applying:
-- select not has_function_privilege('anon','public.admin_print_booth_pins(uuid[])','execute') as anon_blocked;
-- select has_function_privilege('authenticated','public.admin_print_booth_pins(uuid[])','execute') as auth_granted;
-- select count(*) as audited_reads from private.booth_pin_print_audit;
-- select count(*) as stored_pins from vault.secrets where name like 'booth_pin_print_%';
