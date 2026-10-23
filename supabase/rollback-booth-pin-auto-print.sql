-- ===================================================================
-- 되돌리기 — 개별 PIN 자동 인쇄(migration-booth-pin-auto-print.sql)
--
--   1. 발급 · 끄기 함수를 원래 판(migration-booth-pin.sql 7-2 · 7-3, 지문 ff87c440 · 72c0bad7)으로 되돌립니다.
--   2. 인쇄용 조회 함수 public.admin_print_booth_pins 를 지웁니다(화면의 자동 PIN 은 ‘함수 없음’ 으로 막힘).
--   3. Vault 에 보관한 인쇄용 PIN(이름 booth_pin_print_*)을 모두 무작위 표시로 덮어씁니다.
--      이 프로젝트의 postgres 는 vault.secrets 를 지울 수 없어(권한 없음) Supabase 가 준 vault.update_secret 으로 덮어씁니다.
--      덮어쓴 뒤에는 보관한 PIN 을 다시 꺼낼 수 없습니다.
--   4. 보관 도우미 함수를 지웁니다. 조회 기록 표(private.booth_pin_print_audit)는 남깁니다(PIN 값 없음 · 이력).
--
--   그대로인 것: 개별 PIN 해시(지금 PIN 으로 계속 로그인 · 되돌린 뒤 발급부터는 다시 ‘한 번만 공개’) · QR · 세션 ·
--               보안 기록 · 대기 값 · 부스 정보 · 로그인 · 조건부 발급 · 상태 조회
--   순서: print-qr.html 을 먼저 앞 판으로 되돌린 뒤 이 파일을 실행합니다. 여러 번 실행해도 같은 결과입니다.
-- ===================================================================

do $preflight$
declare
  v_fp text;
begin
  v_fp := left(md5(replace(pg_catalog.pg_get_functiondef('public.admin_issue_booth_pin(uuid)'::regprocedure), E'\r', '')), 8)
       || ' ' || left(md5(replace(pg_catalog.pg_get_functiondef('public.admin_disable_booth_pin(uuid)'::regprocedure), E'\r', '')), 8);
  if v_fp not in ('ff87c440 72c0bad7', '5218420e a19e6ca4') then
    raise exception '발급 · 끄기 함수가 예상한 판이 아닙니다(지문 %). 아무것도 바꾸지 않고 멈춥니다.', v_fp;
  end if;
end
$preflight$;

-- 1. 원래 판(migration-booth-pin.sql 7-2 · 7-3 그대로)
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

-- 2. 인쇄용 조회 함수
drop function if exists public.admin_print_booth_pins(uuid[]);

-- 3. 보관한 인쇄용 PIN 을 모두 덮어씀(되살릴 수 없게)
do $wipe$
declare
  r record;
begin
  for r in select s.id from vault.secrets s where s.name like 'booth_pin\_print\_%' loop
    perform vault.update_secret(r.id, 'revoked:' || encode(extensions.gen_random_bytes(24), 'hex'));
  end loop;
end
$wipe$;

-- 4. 보관 도우미
drop function if exists private.booth_pin_vault_put(uuid, text);
drop function if exists private.booth_pin_vault_revoke(uuid);
drop function if exists private.booth_pin_vault_name(uuid);

notify pgrst, 'reload schema';

-- 확인 (기대 = 실제)
select v."순서", v."항목", v."기대", v."실제"
  from (values
    (1, '발급 · 끄기 함수 원래 판(지문)', 'ff87c440 72c0bad7',
        left(md5(replace(pg_catalog.pg_get_functiondef('public.admin_issue_booth_pin(uuid)'::regprocedure), E'\r', '')), 8) || ' ' ||
        left(md5(replace(pg_catalog.pg_get_functiondef('public.admin_disable_booth_pin(uuid)'::regprocedure), E'\r', '')), 8)),
    (2, '인쇄용 조회 함수 · 보관 도우미 남은 수', '0',
        ((to_regprocedure('public.admin_print_booth_pins(uuid[])') is not null)::int
         + (to_regprocedure('private.booth_pin_vault_put(uuid, text)') is not null)::int
         + (to_regprocedure('private.booth_pin_vault_revoke(uuid)') is not null)::int
         + (to_regprocedure('private.booth_pin_vault_name(uuid)') is not null)::int)::text),
    (3, 'Vault 인쇄용 보관값 가운데 PIN 모양(6자리 숫자)', '0',
        (select count(*) from vault.decrypted_secrets s where s.name like 'booth_pin\_print\_%' and s.decrypted_secret ~ '^[0-9]{6}$')::text)
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";
