-- ===================================================================
-- 개별 PIN 자동 인쇄 — QR · PIN 관리 ① 카드에 ‘개별 PIN 함께 인쇄’ 를 켜고 인쇄하면 서버에서 그 부스의 최신 PIN 을 받아 넣습니다
--
--   지금까지: 서버에는 PIN 의 해시(bcrypt(HMAC(pepper, PIN)))만 있고 원문은 발급 응답에서 한 번만 보였습니다.
--   이 파일부터: 발급 · 재발급할 때 같은 트랜잭션에서 원문을 Supabase Vault 에 암호화해 함께 보관하고,
--               관리자만 부를 수 있는 인쇄용 조회 함수가 고른 부스의 최신 PIN 을 돌려줍니다.
--               → PIN 원문 ‘한 번만 공개’ 정책을 의도적으로 바꿉니다(관리자는 언제든 다시 볼 수 있음).
--
--   지키는 것
--     · 로그인 기준은 그대로 해시입니다. 로그인 · 세션 · 공통 PIN · QR 함수는 바꾸지 않습니다.
--     · 발급 · 재발급 · 끄기 함수는 원래 본문을 한 글자도 바꾸지 않고, 같은 트랜잭션 안에 Vault 보관 한 줄씩만 더합니다.
--       해시와 보관값은 함께 바뀌거나 함께 되돌려집니다(한쪽만 바뀌는 일 없음).
--     · 조회 함수는 PIN 을 돌려주기 전에 보관값을 지금 로그인 해시와 bcrypt 로 다시 대조합니다. 맞지 않으면 숫자를
--       돌려주지 않고 'mismatch' 로 알립니다. 꺼진 PIN · 발급 전 · 보관값 없음도 숫자 없이 상태만 알립니다.
--     · Vault 는 Supabase 가 준 함수(vault.create_secret · vault.update_secret)와 복호화 보기(vault.decrypted_secrets)로만
--       씁니다. vault 표를 직접 잠그거나 고치지 않습니다(이 프로젝트의 postgres 에는 vault.secrets 수정 권한이 없음).
--     · 돌려준 PIN 마다 누가 · 언제 · 어느 부스를 봤는지 private.booth_pin_print_audit 에 남깁니다(PIN 값은 남기지 않음).
--     · anon · authenticated 는 vault · 보관 도우미 · 기록 표에 손댈 수 없습니다. 조회 함수는 authenticated 에만 열고
--       안에서 is_admin() 을 다시 확인합니다.
--     · 한 번에 25곳까지만 받습니다(부스마다 bcrypt 대조 — authenticated 의 statement_timeout 8초 안에 끝나게).
--
--   이 파일 전에 발급한 PIN(2026-10-23 Production 2곳 — 예시 부스 A-01 · A-03)은 해시만 있어 원문을 되살릴 수 없습니다.
--   이 파일은 그 PIN 을 바꾸지 않습니다. 조회 함수는 그 부스를 'no_copy' 로 알리고, 인쇄 화면은 그 부스만 PIN 포함 인쇄를
--   막습니다(그때 받은 CSV 를 불러오면 그 CSV 로, 또는 관리자가 따로 재발급하면 그때부터 자동).
--
--   이 파일이 바꾸는 것
--     public.admin_issue_booth_pin(uuid)      원래 본문 + Vault 보관 한 줄(발급 · 재발급 · 다시 켜기 · 조건부 발급도 이 함수를 거침)
--     public.admin_disable_booth_pin(uuid)    원래 본문 + Vault 보관값 지우기 한 줄(무작위 표시로 덮어씀)
--   이 파일이 더하는 것
--     private.booth_pin_vault_name(uuid) · private.booth_pin_vault_put(uuid, text) · private.booth_pin_vault_revoke(uuid)
--     private.booth_pin_print_audit           조회 기록(PIN 값 없음)
--     public.admin_print_booth_pins(uuid[])   관리자 인쇄용 최신 PIN 조회
--   그대로인 것
--     표 · 칸 · 제약 · RLS · 설정 · QR 열쇠 · 기존 PIN 해시 · 세션 · 보안 기록 · 대기 값 · 부스 정보 ·
--     PIN 로그인 · 세션 확인 · 공통 PIN · 조건부 발급(admin_issue_booth_pin_checked) · 상태 조회(admin_booth_credentials)
--
-- 사용법: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run. 여러 번 실행해도 같은 결과입니다.
--         맨 아래 확인 표의 '기대' 와 '실제' 가 모두 같아야 합니다.
-- 되돌리기: supabase/rollback-booth-pin-auto-print.sql(원래 두 함수로 되돌리고 조회 함수를 지우며, 보관한 PIN 을 모두 덮어씀)
-- 순서: 이 파일 → print-qr.html 배포. 되돌릴 때는 print-qr.html 을 먼저 되돌리고 되돌리기 SQL.
--       (화면이 먼저 배포돼도 조회 함수가 없으면 자동 PIN 만 막고 CSV · 결과 창 인쇄는 그대로 됩니다.)
-- 트랜잭션: BEGIN/COMMIT 을 넣지 않습니다. SQL Editor 와 apply_migration 은 이미 한 트랜잭션으로 돌립니다.
-- ===================================================================


-- ═══════════════════════════════════════════════════════════════
-- 0. 선행 조건 검사 (아무것도 바꾸지 않습니다)
--    아래 함수들이 2026-10-23 Production 과 같은 판일 때만 맞게 동작합니다. 다르면 멈춥니다.
--    (지문 = 줄 끝 CR 을 뺀 pg_get_functiondef 의 md5. 발급 · 끄기는 원래 판 또는 이 파일의 판 — 다시 실행)
--    Vault 는 권한(지금 계정 · 발급 · 끄기 함수 소유자)과 실제 동작(시험 비밀을 만들고 · 고치고 · 읽은 뒤 되돌림)을 확인합니다.
-- ═══════════════════════════════════════════════════════════════
do $preflight$
declare
  v_fp  text;
  v_own oid;
  v_id  uuid;
  v_val text;
begin
  if to_regclass('public.booth_pin') is null or to_regclass('public.booth_session') is null
     or to_regclass('public.booth_auth_event') is null
     or to_regprocedure('public.admin_issue_booth_pin(uuid)') is null
     or to_regprocedure('public.admin_disable_booth_pin(uuid)') is null
     or to_regprocedure('public.admin_issue_booth_pin_checked(uuid, text, timestamptz)') is null
     or to_regprocedure('private.booth_pin_digest(text)') is null
     or to_regprocedure('private.booth_pin_weak(text)') is null
     or to_regprocedure('private.booth_pin_generate()') is null
     or to_regprocedure('public.is_admin()') is null then
    raise exception '선행 조건 누락: migration-booth-pin.sql · migration-booth-pin-checked.sql 을 먼저 적용하세요.';
  end if;
  if to_regprocedure('vault.create_secret(text, text, text, uuid)') is null
     or to_regprocedure('vault.update_secret(uuid, text, text, text, uuid)') is null
     or to_regclass('vault.decrypted_secrets') is null or to_regclass('vault.secrets') is null then
    raise exception 'Supabase Vault(supabase_vault)를 찾지 못했습니다. 아무것도 바꾸지 않고 멈춥니다.';
  end if;
  if not has_function_privilege(current_user, 'vault.create_secret(text, text, text, uuid)', 'EXECUTE')
     or not has_function_privilege(current_user, 'vault.update_secret(uuid, text, text, text, uuid)', 'EXECUTE')
     or not has_table_privilege(current_user, 'vault.decrypted_secrets', 'SELECT')
     or not has_table_privilege(current_user, 'vault.secrets', 'SELECT') then
    raise exception '지금 계정(%)에 Vault 사용 권한이 없습니다. SQL Editor(postgres)에서 실행하세요.', current_user;
  end if;
  -- 발급 · 끄기 함수는 create or replace 해도 소유자가 그대로이고, 그 소유자 권한으로 Vault 에 씁니다.
  for v_own in select p.proowner from pg_catalog.pg_proc p
                where p.oid in ('public.admin_issue_booth_pin(uuid)'::regprocedure, 'public.admin_disable_booth_pin(uuid)'::regprocedure) loop
    if not has_function_privilege(v_own, 'vault.create_secret(text, text, text, uuid)', 'EXECUTE')
       or not has_function_privilege(v_own, 'vault.update_secret(uuid, text, text, text, uuid)', 'EXECUTE')
       or not has_table_privilege(v_own, 'vault.secrets', 'SELECT') then
      raise exception '발급 · 끄기 함수의 소유자(%)에게 Vault 사용 권한이 없습니다. 아무것도 바꾸지 않고 멈춥니다.', pg_catalog.pg_get_userbyid(v_own);
    end if;
  end loop;
  -- 실제 Vault 자가 시험: 시험 비밀을 만들고 · 고치고 · 복호화해 읽은 뒤 되돌립니다(아무것도 남지 않음).
  -- Vault 가 실제로 암호화 · 복호화하지 못하면 여기서 멈춥니다(그대로 적용하면 PIN 발급 · 재발급이 모두 실패하기 때문).
  begin
    v_id := vault.create_secret('selftest-a', 'booth_pin_selftest_' || encode(extensions.gen_random_bytes(8), 'hex'), 'migration-booth-pin-auto-print preflight');
    perform vault.update_secret(v_id, 'selftest-b');
    select s.decrypted_secret into v_val from vault.decrypted_secrets s where s.id = v_id;
    if v_val is distinct from 'selftest-b' then
      raise exception using errcode = 'P0001', message = 'vault_selftest_bad';
    end if;
    raise exception using errcode = 'P0001', message = 'vault_selftest_ok';   -- 시험 비밀을 되돌리려고 일부러 멈춤
  exception when others then
    if sqlerrm <> 'vault_selftest_ok' then
      raise exception 'Supabase Vault 자가 시험 실패(%). 아무것도 바꾸지 않고 멈춥니다.', sqlerrm;
    end if;
  end;

  select string_agg(left(md5(replace(pg_catalog.pg_get_functiondef(f::regprocedure), E'\r', '')), 8), ' ' order by o)
    into v_fp
    from (values (1, 'public.admin_issue_booth_pin_checked(uuid, text, timestamptz)'),
                 (2, 'public.booth_pin_login(uuid, text, text)'),
                 (3, 'private.booth_pin_digest(text)'),
                 (4, 'private.booth_pin_weak(text)'),
                 (5, 'public.is_admin()')) as x(o, f);
  if v_fp <> 'ba79b2cc d78e25b9 7d9cfa8b 797f3b63 651002b9' then
    raise exception '조건부 발급 · PIN 로그인 · PIN 해시 · 약한 PIN · 관리자 확인 함수가 예상한 판이 아닙니다(지문 %). 아무것도 바꾸지 않고 멈춥니다.', v_fp;
  end if;
  v_fp := md5(replace(pg_catalog.pg_get_functiondef('public.admin_issue_booth_pin(uuid)'::regprocedure), E'\r', ''));
  if v_fp not in ('ff87c4408246e936b88f91d4e248481e', '5218420ef9ad1dc596630eb67a803a49') then
    raise exception 'public.admin_issue_booth_pin 이 예상한 판이 아닙니다(지문 %). 아무것도 바꾸지 않고 멈춥니다.', left(v_fp, 8);
  end if;
  v_fp := md5(replace(pg_catalog.pg_get_functiondef('public.admin_disable_booth_pin(uuid)'::regprocedure), E'\r', ''));
  if v_fp not in ('72c0bad7e27f3cfa517546fe26947970', 'a19e6ca4064d98f2827882a7e4d16d2e') then
    raise exception 'public.admin_disable_booth_pin 이 예상한 판이 아닙니다(지문 %). 아무것도 바꾸지 않고 멈춥니다.', left(v_fp, 8);
  end if;
end
$preflight$;


-- ═══════════════════════════════════════════════════════════════
-- 1. 조회 기록 — 돌려준 PIN 하나마다 한 줄(누가 · 언제 · 어느 부스). PIN 값 · 해시 · 열쇠는 적지 않습니다.
--    private 스키마는 Data API 에 나가지 않고, anon · authenticated 권한도 없습니다.
-- ═══════════════════════════════════════════════════════════════
create table if not exists private.booth_pin_print_audit (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  actor    uuid not null,
  booth_id uuid not null
);
alter table private.booth_pin_print_audit enable row level security;
revoke all on table private.booth_pin_print_audit from public, anon, authenticated;
revoke all on sequence private.booth_pin_print_audit_id_seq from public, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 2. Vault 보관 도우미 — 부스마다 이름 'booth_pin_print_<부스 id>' 의 비밀 하나(이름은 Vault 가 유일하게 지킴)
--    잠금: 발급 함수가 이미 그 부스의 PIN 줄을 잡고(for update · on conflict), 조건부 발급은 그보다 먼저 부스별
--    advisory lock 을 잡습니다. 그래서 같은 부스의 보관값은 늘 한 트랜잭션씩 바뀝니다. vault 표는 잠그지 않습니다.
-- ═══════════════════════════════════════════════════════════════
create or replace function private.booth_pin_vault_name(p_booth uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'booth_pin_print_' || p_booth::text
$$;

create or replace function private.booth_pin_vault_put(p_booth uuid, p_value text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select s.id into v_id from vault.secrets s where s.name = private.booth_pin_vault_name(p_booth);
  if v_id is null then
    perform vault.create_secret(p_value, private.booth_pin_vault_name(p_booth), '부스 운영자 PIN — QR · PIN 관리 관리자 인쇄용');
  else
    perform vault.update_secret(v_id, p_value);
  end if;
end;
$$;

-- 끄기 · 되돌리기: 보관값을 PIN 이 아닌 무작위 표시로 덮어씁니다(보관값이 없으면 만들지 않음).
create or replace function private.booth_pin_vault_revoke(p_booth uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select s.id into v_id from vault.secrets s where s.name = private.booth_pin_vault_name(p_booth);
  if v_id is not null then
    perform vault.update_secret(v_id, 'revoked:' || encode(extensions.gen_random_bytes(24), 'hex'));
  end if;
end;
$$;

revoke all on function private.booth_pin_vault_name(uuid)        from public, anon, authenticated;
revoke all on function private.booth_pin_vault_put(uuid, text)   from public, anon, authenticated;
revoke all on function private.booth_pin_vault_revoke(uuid)      from public, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 3. 발급 · 끄기 — 원래 본문(migration-booth-pin.sql 7-2 · 7-3) 그대로 + 표시한 한 줄씩
--    create or replace 라 함수 번호(OID) · 권한 · 설명이 그대로입니다. 조건부 발급(admin_issue_booth_pin_checked)도
--    이 함수를 부르므로 따로 바꾸지 않습니다.
-- ═══════════════════════════════════════════════════════════════
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

  -- [자동 인쇄] 같은 트랜잭션에서 원문을 Vault 에 암호화해 보관(관리자 인쇄용 조회 함수만 꺼냄)
  perform private.booth_pin_vault_put(p_booth_id, v_pin);

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

  -- [자동 인쇄] 보관한 원문도 같은 트랜잭션에서 무작위 표시로 덮어씀(꺼진 PIN 은 다시 볼 수 없음)
  perform private.booth_pin_vault_revoke(p_booth_id);

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


-- ═══════════════════════════════════════════════════════════════
-- 4. admin_print_booth_pins(부스 id 배열) — 관리자 인쇄용 최신 PIN 조회
--    부를 수 있는 사람: 로그인한 관리자(is_admin)만. anon 은 실행 권한 자체가 없습니다.
--    받는 것: 부스 id 1 ~ 25개(겹치면 한 번만). 표 전체를 돌려주는 길은 없습니다.
--    돌려주는 것: 받은 부스마다 한 줄 — state 와, state 가 'ok' 일 때만 pin.
--      ok        켜진 PIN · 보관값이 지금 로그인 해시와 bcrypt 로 맞음 → pin · issued_at
--      none      PIN 을 발급한 적 없음
--      off       PIN 이 꺼져 있음
--      no_copy   PIN 은 켜져 있지만 보관값이 없음(이 파일 전에 발급한 PIN)
--      mismatch  보관값이 지금 PIN 과 맞지 않음(숫자는 돌려주지 않음 — 재발급 필요)
--    한 번의 조회(한 스냅숏)로 PIN 줄과 보관값을 함께 읽으므로, 그 사이 재발급이 끼어도 둘이 어긋나지 않습니다.
-- ═══════════════════════════════════════════════════════════════
create or replace function public.admin_print_booth_pins(p_booth_ids uuid[])
returns table (booth_id uuid, state text, pin text, issued_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  r     record;
begin
  if v_uid is null or not public.is_admin() then
    raise exception '관리자만 인쇄용 PIN 을 볼 수 있습니다.' using errcode = '42501';
  end if;
  if p_booth_ids is null or cardinality(p_booth_ids) = 0 then
    return;
  end if;
  if array_position(p_booth_ids, null) is not null then
    raise exception '부스 id 가 비어 있습니다.' using errcode = '22023', hint = 'booth_pin_print_bad_ids';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_booth_ids) as x;
  if cardinality(v_ids) > 25 then
    raise exception '한 번에 25곳까지 조회할 수 있습니다.' using errcode = '22023', hint = 'booth_pin_print_too_many';
  end if;

  for r in
    select x.id                                  as id,
           (p.booth_id is not null)              as has_pin,
           p.disabled_at                         as disabled_at,
           p.pin_hash                            as pin_hash,
           coalesce(p.reissued_at, p.issued_at)  as at,
           s.decrypted_secret                    as v
      from unnest(v_ids) as x(id)
      left join public.booth_pin p on p.booth_id = x.id
      left join vault.decrypted_secrets s on s.name = private.booth_pin_vault_name(x.id)
     order by x.id
  loop
    if not r.has_pin then
      return query select r.id, 'none'::text, null::text, null::timestamptz;
    elsif r.disabled_at is not null then
      return query select r.id, 'off'::text, null::text, r.at;
    elsif r.v is null then
      return query select r.id, 'no_copy'::text, null::text, r.at;
    elsif r.v !~ '^[0-9]{6}$' or private.booth_pin_weak(r.v)
          or extensions.crypt(private.booth_pin_digest(r.v), r.pin_hash) is distinct from r.pin_hash then
      return query select r.id, 'mismatch'::text, null::text, r.at;
    else
      insert into private.booth_pin_print_audit (actor, booth_id) values (v_uid, r.id);
      return query select r.id, 'ok'::text, r.v, r.at;
    end if;
  end loop;
end;
$$;

revoke all     on function public.admin_print_booth_pins(uuid[]) from public;
revoke execute on function public.admin_print_booth_pins(uuid[]) from anon;
grant  execute on function public.admin_print_booth_pins(uuid[]) to authenticated;
comment on function public.admin_print_booth_pins(uuid[]) is
  '관리자 인쇄용 — 고른 부스(25곳까지)의 최신 개별 PIN. Vault 보관값을 지금 로그인 해시와 대조해 맞을 때만 돌려주고 조회마다 기록. anon 실행 불가.';

notify pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════
-- 5. 확인 (기대 = 실제)
--    7 · 8 은 2026-10-23 Production 기준(개별 PIN 2곳 — 예시 A-01 · A-03, 이 파일 전에 발급)입니다.
-- ═══════════════════════════════════════════════════════════════
select v."순서", v."항목", v."기대", v."실제"
  from (values
    (1, '발급 · 끄기 함수 새 판(지문)', '5218420e a19e6ca4',
        (select string_agg(left(md5(replace(pg_catalog.pg_get_functiondef(f::regprocedure), E'\r', '')), 8), ' ' order by o)
           from (values (1, 'public.admin_issue_booth_pin(uuid)'), (2, 'public.admin_disable_booth_pin(uuid)')) as x(o, f))),
    (2, '조건부 발급 · PIN 로그인 · 해시 · 약한 PIN · 관리자 확인 · 상태 조회 그대로(지문)', 'ba79b2cc d78e25b9 7d9cfa8b 797f3b63 651002b9 1ffa74d5',
        (select string_agg(left(md5(replace(pg_catalog.pg_get_functiondef(f::regprocedure), E'\r', '')), 8), ' ' order by o)
           from (values (1, 'public.admin_issue_booth_pin_checked(uuid, text, timestamptz)'), (2, 'public.booth_pin_login(uuid, text, text)'),
                        (3, 'private.booth_pin_digest(text)'), (4, 'private.booth_pin_weak(text)'), (5, 'public.is_admin()'),
                        (6, 'public.admin_booth_credentials()')) as x(o, f))),
    (3, '인쇄용 조회 함수 — anon 실행 · authenticated 실행', 'false true',
        has_function_privilege('anon', 'public.admin_print_booth_pins(uuid[])', 'EXECUTE')::text || ' ' ||
        has_function_privilege('authenticated', 'public.admin_print_booth_pins(uuid[])', 'EXECUTE')::text),
    (4, '보관 도우미 3개 — anon · authenticated 실행', 'false',
        (has_function_privilege('anon', 'private.booth_pin_vault_put(uuid, text)', 'EXECUTE')
         or has_function_privilege('authenticated', 'private.booth_pin_vault_put(uuid, text)', 'EXECUTE')
         or has_function_privilege('anon', 'private.booth_pin_vault_revoke(uuid)', 'EXECUTE')
         or has_function_privilege('authenticated', 'private.booth_pin_vault_revoke(uuid)', 'EXECUTE')
         or has_function_privilege('anon', 'private.booth_pin_vault_name(uuid)', 'EXECUTE')
         or has_function_privilege('authenticated', 'private.booth_pin_vault_name(uuid)', 'EXECUTE'))::text),
    (5, '조회 기록 표 — anon · authenticated 읽기 · 쓰기', 'false',
        (has_table_privilege('anon', 'private.booth_pin_print_audit', 'SELECT') or has_table_privilege('authenticated', 'private.booth_pin_print_audit', 'SELECT')
         or has_table_privilege('anon', 'private.booth_pin_print_audit', 'INSERT') or has_table_privilege('authenticated', 'private.booth_pin_print_audit', 'INSERT'))::text),
    (6, 'vault — anon · authenticated 사용 · 복호화 보기 읽기', 'false',
        (has_schema_privilege('anon', 'vault', 'USAGE') or has_schema_privilege('authenticated', 'vault', 'USAGE')
         or has_table_privilege('anon', 'vault.decrypted_secrets', 'SELECT') or has_table_privilege('authenticated', 'vault.decrypted_secrets', 'SELECT'))::text),
    (7, '개별 PIN 줄(이 파일은 바꾸지 않음)', '2',
        (select count(*) from public.booth_pin)::text),
    (8, '인쇄용 보관 PIN(이 파일은 만들지 않음 — 다음 발급부터)', '0',
        (select count(*) from vault.secrets s where s.name like 'booth_pin_print_%')::text)
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";
