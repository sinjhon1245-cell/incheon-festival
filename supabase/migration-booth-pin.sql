-- ===================================================================
-- 부스 운영자 PIN 보조 로그인 (booth_pin · booth_session · booth_auth_event)
--
--   운영자 화면의 기본 열쇠는 계속 QR(booth_access)입니다. PIN 은 QR 카드를
--   쓸 수 없을 때(못 받음 · 잃어버림 · 카메라 문제 · 담당자 교체)만 쓰는
--   보조 길입니다. 흐름은 이렇습니다.
--     운영자 화면  구역 → 실제 부스 → 6자리 PIN → booth_pin_login
--                  → 성공하면 임시 세션 원문(43자)을 한 번 받아 이 기기에만 둡니다
--                  → booth_session_get · set · touch · logout(세션) 으로 QR 과 같은 화면을 씁니다
--     관리자 화면  admin_issue_booth_pin(부스) 으로 PIN 을 만들어 발급 창에서 한 번만 봅니다
--                  admin_disable_booth_pin(부스) 로 끕니다 · admin_booth_credentials() 로 상태만 봅니다
--
--   이 파일이 지키는 약속
--     1. QR 과 완전히 따로입니다. booth_ctrl_get · set · touch 와 booth_access 를
--        한 글자도 바꾸지 않습니다(확인 표 1~3번이 적용 전후 정의 md5 를 견줍니다).
--        PIN 길의 함수는 booth_access 를 읽지 않습니다 — PIN 을 맞혀도 QR 열쇠를
--        얻을 길이 없습니다(token_tail 도 늘 null).
--     2. PIN 원문은 어디에도 저장하지 않습니다. bcrypt(bf 10) 해시만 두고, 그 앞에
--        Vault 비밀(booth_pin_pepper)로 HMAC 을 한 번 겁니다 — 해시 표만 새어서는
--        100만 개를 대입해도 풀 수 없습니다. 관리자도 기존 PIN 을 다시 볼 수 없습니다.
--     3. 세션 원문(32바이트 무작위)도 저장하지 않습니다. sha256 만 둡니다.
--     4. 세션 함수에는 부스 id 인자가 없습니다. 세션 → 부스를 서버가 정합니다
--        (다른 부스 id 를 보낼 길 자체가 없습니다).
--     5. 6자리 대입을 막되 부스를 잠그지 않습니다(누군가 남의 부스를 일부러 잠글 수
--        없게). 기기 · 부스 · 전체 세 층(+ 믿을 수 있는 IP 가 확인되면 IP 층)으로
--        retry_after(초)만 돌려줍니다. 서버에서 기다리지(pg_sleep) 않습니다.
--        틀린 PIN 은 오류를 내지 않고 ok=false 로 답합니다 — 오류로 끝내면 트랜잭션이
--        되돌아가 실패 기록이 남지 않고, 그러면 횟수 제한도 걸리지 않습니다.
--     6. 전체 스위치: settings.booth_pin_enabled (기본 false). 끄면 새 로그인과 이미
--        열린 PIN 세션이 모두 멈춥니다. QR 은 그대로입니다.
--
--   보안 점검 경고에 대하여
--     anon_security_definer_function_executable 이 booth_pin_login ·
--     booth_session_get · set · touch · logout 다섯을 짚습니다. 의도된 것입니다
--     (운영자는 로그인하지 않고 PIN · 세션만 들고 옵니다. booth_ctrl_* 와 같은 이유).
--     authenticated_… 경고는 관리자 함수에도 뜹니다(함수 안의 is_admin() 이 막음).
--     rls_enabled_no_policy 가 새 표 셋에 뜹니다 — 정책 없이 닫아 둔 것이 의도입니다.
--
--   바꾸는 기존 객체 (둘 다 칸을 더하기만 합니다)
--     public.booth_live_log.session_id   PIN 세션으로 넣은 값이면 그 세션(QR · 관리자 입력은 null)
--     public.settings.booth_pin_enabled  PIN 전체 스위치(기본 false)
--
-- 사용법 (승인 뒤): Supabase MCP apply_migration 또는 SQL Editor 에 전체 붙여넣고 Run.
--   BEGIN/COMMIT 을 넣지 않습니다(도구가 한 트랜잭션으로 돌립니다 — 중간에 실패하면
--   전부 되돌아갑니다). psql: psql -1 -v ON_ERROR_STOP=1 -f 이 파일
--   여러 번 실행해도 같은 결과입니다. 이미 있는 PIN · 세션 · 기록은 지우지 않습니다.
--   적용 직후에는 스위치가 꺼져 있어 화면에서 달라지는 것이 없습니다.
--
-- 되돌리기: rollback-booth-pin.sql
-- 선행: migration-booth-master-data.sql(1a) · migration-booth-private.sql(1b)
--       pgcrypto(extensions) · supabase_vault
-- ===================================================================


-- ═══════════════════════════════════════════════════════════════
-- 0. 선행 조건 (아무것도 바꾸지 않습니다)
-- ═══════════════════════════════════════════════════════════════
do $preflight$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'booths' and column_name = 'is_published') then
    raise exception '선행 조건 누락: Phase 1a(migration-booth-master-data.sql)를 먼저 적용하세요.';
  end if;
  if to_regclass('public.booth_private') is null then
    raise exception '선행 조건 누락: Phase 1b(migration-booth-private.sql)를 먼저 적용하세요.';
  end if;
  if to_regclass('public.booth_access') is null or to_regclass('public.booth_live') is null
     or to_regclass('public.booth_live_log') is null or to_regclass('public.settings') is null then
    raise exception '선행 조건 누락: booth_access · booth_live · booth_live_log · settings 가 필요합니다.';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception '선행 조건 누락: public.is_admin() 이 없습니다.';
  end if;
  if to_regprocedure('public.booth_ctrl_get(text)') is null
     or to_regprocedure('public.booth_ctrl_set(text,text,integer)') is null
     or to_regprocedure('public.booth_ctrl_touch(text)') is null then
    raise exception '선행 조건 누락: QR 운영자 함수(booth_ctrl_*)가 없습니다.';
  end if;
  if to_regprocedure('extensions.crypt(text,text)') is null
     or to_regprocedure('extensions.gen_salt(text,integer)') is null
     or to_regprocedure('extensions.hmac(bytea,bytea,text)') is null
     or to_regprocedure('extensions.digest(text,text)') is null
     or to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception '선행 조건 누락: pgcrypto(extensions 스키마)의 crypt · gen_salt · hmac · digest · gen_random_bytes 가 필요합니다.';
  end if;
  if to_regprocedure('vault.create_secret(text,text,text,uuid)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    raise exception '선행 조건 누락: supabase_vault(vault.create_secret · vault.decrypted_secrets)가 필요합니다.';
  end if;
end
$preflight$;

-- QR 운영자 함수의 지금 정의(md5). 맨 아래 확인 표가 이 파일을 돌린 뒤와 견줍니다.
-- 이 트랜잭션이 끝나면 저절로 사라집니다.
create temp table booth_pin_qr_before on commit drop as
select p.oid::regprocedure::text as fn, md5(pg_catalog.pg_get_functiondef(p.oid)) as h
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('booth_ctrl_get', 'booth_ctrl_set', 'booth_ctrl_touch');


-- ═══════════════════════════════════════════════════════════════
-- 1. private 스키마 — API 로 드러나지 않는 도우미 함수 · 설정 자리
--    PostgREST 가 노출하는 스키마(public)가 아니고, anon · authenticated 에게
--    USAGE 도 주지 않습니다. 공개 함수(정의자 = postgres)만 안에서 부릅니다.
-- ═══════════════════════════════════════════════════════════════
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

-- IP 를 횟수 제한에 쓸지 · 어느 헤더를 믿을지. 기본은 비어 있음(= IP 층 꺼짐).
-- Production 에서 admin_booth_ip_probe() 로 실측해 위조할 수 없는 헤더가 확인된
-- 뒤에만 그 이름을 적습니다(README '부스 운영자 PIN' 참고). 위조 가능한 헤더를 믿으면
-- 누군가 행사장 IP 를 사칭해 행사장 전체의 PIN 로그인을 막을 수 있기 때문입니다.
create table if not exists private.booth_pin_settings (
  id         smallint primary key default 1 check (id = 1),
  ip_header  text check (ip_header in ('cf-connecting-ip', 'x-real-ip',
                                       'x-forwarded-for:first', 'x-forwarded-for:last')),
  updated_at timestamptz not null default now()
);
insert into private.booth_pin_settings (id) values (1) on conflict (id) do nothing;
alter table private.booth_pin_settings enable row level security;
revoke all on private.booth_pin_settings from public, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 2. pepper — Vault 비밀 booth_pin_pepper (없을 때만 만듭니다)
--    PIN 해시 · 기기 표식 · IP 표식 앞에 거는 HMAC 키입니다. 값은 어디에도
--    출력하지 않습니다. 지우면 모든 PIN 이 맞지 않게 되고 → PIN 재발급으로 복구합니다.
-- ═══════════════════════════════════════════════════════════════
do $pepper$
begin
  if not exists (select 1 from vault.decrypted_secrets s where s.name = 'booth_pin_pepper') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'booth_pin_pepper',
      '부스 운영자 PIN · 기기 · IP 표식의 HMAC 키(migration-booth-pin.sql). 지우면 모든 PIN 이 실패합니다 — PIN 재발급으로 복구.');
  end if;
end
$pepper$;


-- ═══════════════════════════════════════════════════════════════
-- 3. 표 — 셋 다 RLS 켜고 정책 0 · anon · authenticated 권한 0 (booth_access 와 같은 방식)
--    Supabase 는 public 의 새 표 · 순서기에 anon · authenticated 권한을 '직접' 줍니다.
--    PUBLIC 만 거둬서는 남으므로 세 쪽 모두 거둡니다.
-- ═══════════════════════════════════════════════════════════════

-- 3-1. booth_pin — 부스당 한 줄. 줄 없음 = PIN 미발급, disabled_at 있음 = PIN 꺼짐.
create table if not exists public.booth_pin (
  booth_id    uuid primary key references public.booths(id) on delete cascade,
  pin_hash    text not null,
  issued_at   timestamptz not null default now(),
  reissued_at timestamptz,
  disabled_at timestamptz,
  issued_by   uuid
);
-- bcrypt(bf 10) 모양이 아니면 받지 않습니다 — 누가 실수로 원문을 넣으려 해도 표가 거절합니다.
alter table public.booth_pin drop constraint if exists booth_pin_hash_check;
alter table public.booth_pin add constraint booth_pin_hash_check
  check (pin_hash ~ '^\$2[abxy]\$10\$[./A-Za-z0-9]{53}$');
alter table public.booth_pin enable row level security;
revoke all on public.booth_pin from anon, authenticated, public;
comment on table public.booth_pin is
  '부스 운영자 PIN(부스당 한 줄). bcrypt(HMAC(pepper, PIN)) 만 저장 — 원문 없음. anon · authenticated 권한 · 정책 없음, 정의자 함수만 씁니다.';
comment on column public.booth_pin.disabled_at is 'PIN 을 끈 시각. 끌 때 해시도 무작위 값으로 바꿉니다. 다시 켜는 길은 새 PIN 발급뿐입니다.';

-- 3-2. booth_session — PIN 으로 연 임시 세션. 원문은 운영자 기기에만, 여기는 sha256 만.
create table if not exists public.booth_session (
  id            uuid primary key default gen_random_uuid(),
  booth_id      uuid not null references public.booths(id) on delete cascade,
  token_hash    bytea not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  revoke_reason text,
  last_used_at  timestamptz,
  device_tag    text
);
alter table public.booth_session drop constraint if exists booth_session_token_hash_key;
alter table public.booth_session add constraint booth_session_token_hash_key unique (token_hash);
alter table public.booth_session drop constraint if exists booth_session_hash_len_check;
alter table public.booth_session add constraint booth_session_hash_len_check check (octet_length(token_hash) = 32);
alter table public.booth_session drop constraint if exists booth_session_expiry_check;
alter table public.booth_session add constraint booth_session_expiry_check check (expires_at > created_at);
alter table public.booth_session drop constraint if exists booth_session_revoke_check;
alter table public.booth_session add constraint booth_session_revoke_check
  check ((revoked_at is null) = (revoke_reason is null)
         and (revoke_reason is null
              or revoke_reason in ('logout', 'pin_reissued', 'pin_disabled', 'session_cap', 'same_device')));
-- 부스별 활성 세션 세기 · 한꺼번에 끊기(재발급 · 끄기)용. booth_id 외래 키 색인도 겸합니다.
create index if not exists booth_session_booth on public.booth_session (booth_id, created_at);
alter table public.booth_session enable row level security;
revoke all on public.booth_session from anon, authenticated, public;
comment on table public.booth_session is
  'PIN 으로 연 부스 운영자 임시 세션. 원문은 운영자 기기에만 있고 여기는 sha256 만. anon · authenticated 권한 · 정책 없음.';

-- 3-3. booth_auth_event — 보안 기록 + 횟수 제한의 근거.
--   절대 적지 않는 것: PIN 원문 · 세션 원문 · QR 열쇠 · 해시 · 원래 IP · User-Agent.
--   ip_tag · device_tag 는 HMAC(pepper, 값) 의 앞 16자 — 같은 것인지만 견줄 수 있습니다.
--   부스를 지워도 기록은 남깁니다(set null). 행사 후 정리 SQL(맨 아래 주석)로 지웁니다.
create table if not exists public.booth_auth_event (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  event      text not null,
  booth_id   uuid references public.booths(id) on delete set null,
  session_id uuid references public.booth_session(id) on delete set null,
  ip_tag     text,
  device_tag text,
  limit_kind text,
  detail     text,
  actor      uuid
);
alter table public.booth_auth_event drop constraint if exists booth_auth_event_event_check;
alter table public.booth_auth_event add constraint booth_auth_event_event_check
  check (event in ('pin_ok', 'pin_fail', 'pin_limited', 'pin_issued', 'pin_reissued', 'pin_disabled',
                   'session_revoked', 'session_logout'));
alter table public.booth_auth_event drop constraint if exists booth_auth_event_limit_check;
alter table public.booth_auth_event add constraint booth_auth_event_limit_check
  check (limit_kind is null or limit_kind in ('device', 'ip', 'booth', 'global'));
alter table public.booth_auth_event drop constraint if exists booth_auth_event_detail_check;
alter table public.booth_auth_event add constraint booth_auth_event_detail_check
  check (detail is null or detail in ('logout', 'pin_reissued', 'pin_disabled', 'session_cap', 'same_device'));
alter table public.booth_auth_event drop constraint if exists booth_auth_event_tag_check;
alter table public.booth_auth_event add constraint booth_auth_event_tag_check
  check ((ip_tag is null or ip_tag ~ '^[0-9a-f]{16}$')
         and (device_tag is null or device_tag ~ '^([0-9a-f]{16}|nodev)$'));
create index if not exists booth_auth_event_fail_at on public.booth_auth_event (at) where event = 'pin_fail';
create index if not exists booth_auth_event_booth on public.booth_auth_event (booth_id, at);
create index if not exists booth_auth_event_device on public.booth_auth_event (device_tag, at) where device_tag is not null;
create index if not exists booth_auth_event_ip on public.booth_auth_event (ip_tag, at) where ip_tag is not null;
create index if not exists booth_auth_event_session on public.booth_auth_event (session_id);
alter table public.booth_auth_event enable row level security;
revoke all on public.booth_auth_event from anon, authenticated, public;
revoke all on sequence public.booth_auth_event_id_seq from anon, authenticated, public;
comment on table public.booth_auth_event is
  'PIN 로그인 보안 기록(성공 · 실패 · 제한 · 발급 · 끄기 · 세션 끊김). 원문 · 해시 · 원래 IP 를 적지 않습니다. SQL Editor 에서만 봅니다.';


-- ═══════════════════════════════════════════════════════════════
-- 4. 기존 표에 칸 더하기 (둘 다 비어도 되는 칸 — 기존 화면 · 함수는 그대로 돕니다)
-- ═══════════════════════════════════════════════════════════════
-- PIN 세션으로 넣은 값이면 그 세션. QR 운영자 · 관리자 입력은 지금처럼 null 로 남습니다.
alter table public.booth_live_log add column if not exists session_id uuid;
alter table public.booth_live_log drop constraint if exists booth_live_log_session_fkey;
alter table public.booth_live_log add constraint booth_live_log_session_fkey
  foreign key (session_id) references public.booth_session(id) on delete set null;
create index if not exists booth_live_log_session on public.booth_live_log (session_id);
comment on column public.booth_live_log.session_id is 'PIN 세션으로 넣은 값이면 그 세션(booth_session.id). QR 운영자 · 관리자 입력은 null.';

-- PIN 전체 스위치. 공개돼도 되는 값입니다(운영자 화면이 'PIN으로 시작' 단추를 보일지 정함).
alter table public.settings add column if not exists booth_pin_enabled boolean not null default false;
comment on column public.settings.booth_pin_enabled is
  '부스 운영자 PIN 보조 로그인 전체 스위치(기본 false). 끄면 새 PIN 로그인과 열린 PIN 세션이 모두 멈춥니다. QR 은 그대로.';


-- ═══════════════════════════════════════════════════════════════
-- 5. private 도우미 함수
--    정의자 함수가 아닙니다 — 부르는 공개 함수(정의자 = postgres)의 권한으로 돕니다.
--    누구에게도 실행 권한을 주지 않습니다(PUBLIC 의 기본 실행 권한도 거둡니다).
-- ═══════════════════════════════════════════════════════════════

-- 5-1. pepper 를 bytea 로. 없으면 멈춥니다(조용히 약한 해시로 내려가지 않게).
drop function if exists private.booth_pin_pepper();
create function private.booth_pin_pepper()
returns bytea
language plpgsql
stable
set search_path = ''
as $$
declare
  v text;
begin
  select s.decrypted_secret into v from vault.decrypted_secrets s where s.name = 'booth_pin_pepper' limit 1;
  if v is null or length(v) < 32 then
    raise exception 'booth_pin_pepper 비밀이 없습니다. migration-booth-pin.sql 을 다시 적용해 주세요.' using errcode = '55000';
  end if;
  return pg_catalog.convert_to(v, 'UTF8');
end;
$$;

-- 5-2. 표식: HMAC(pepper, 종류:값) 의 앞 16자. 값이 비면 null.
drop function if exists private.booth_tag(text, text);
create function private.booth_tag(p_kind text, p_value text)
returns text
language sql
stable
set search_path = ''
as $$
  select case when p_value is null or p_value = '' then null
              else left(encode(extensions.hmac(pg_catalog.convert_to(p_kind || ':' || p_value, 'UTF8'),
                                               private.booth_pin_pepper(), 'sha256'), 'hex'), 16) end
$$;

-- 5-3. bcrypt 에 넣을 값: HMAC(pepper, 'pin:' || PIN) 의 hex 64자(bcrypt 72바이트 한도 안).
drop function if exists private.booth_pin_digest(text);
create function private.booth_pin_digest(p_pin text)
returns text
language sql
stable
set search_path = ''
as $$
  select encode(extensions.hmac(pg_catalog.convert_to('pin:' || p_pin, 'UTF8'), private.booth_pin_pepper(), 'sha256'), 'hex')
$$;

-- 5-4. 약한 PIN: 같은 숫자 · 두 자리 · 세 자리 되풀이 · 오름 · 내림 연속.
drop function if exists private.booth_pin_weak(text);
create function private.booth_pin_weak(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is null
      or p !~ '^[0-9]{6}$'
      or p ~ '^([0-9])\1{5}$'
      or p ~ '^([0-9]{2})\1\1$'
      or p ~ '^([0-9]{3})\1$'
      or strpos('01234567890', p) > 0
      or strpos('09876543210', p) > 0
$$;

-- 5-5. 새 PIN. CSPRNG 3바이트(0~16,777,215) 중 16,000,000 이상은 버려 치우침 없이 000000~999999.
drop function if exists private.booth_pin_generate();
create function private.booth_pin_generate()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  b bytea;
  v integer;
  s text;
begin
  loop
    b := extensions.gen_random_bytes(3);
    v := (get_byte(b, 0) << 16) | (get_byte(b, 1) << 8) | get_byte(b, 2);
    continue when v >= 16000000;
    s := lpad((v % 1000000)::text, 6, '0');
    exit when not private.booth_pin_weak(s);
  end loop;
  return s;
end;
$$;

-- 5-6. 세션 원문: 32바이트 → base64url 43자('=' 없음). QR 열쇠(24자)와 모양이 달라 서로 섞이지 않습니다.
drop function if exists private.booth_session_token();
create function private.booth_session_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_')
$$;

-- 5-7. 믿을 수 있는 클라이언트 IP(1번 설정의 헤더). 설정이 비었거나 헤더가 없으면 null.
drop function if exists private.booth_client_ip();
create function private.booth_client_ip()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_mode text;
  h      json;
  v      text;
  parts  text[];
begin
  select s.ip_header into v_mode from private.booth_pin_settings s where s.id = 1;
  if v_mode is null then return null; end if;
  h := nullif(pg_catalog.current_setting('request.headers', true), '')::json;
  if h is null then return null; end if;
  if v_mode in ('cf-connecting-ip', 'x-real-ip') then
    v := h ->> v_mode;
  else
    parts := string_to_array(replace(coalesce(h ->> 'x-forwarded-for', ''), ' ', ''), ',');
    v := case when v_mode = 'x-forwarded-for:first' then parts[1] else parts[array_length(parts, 1)] end;
  end if;
  return nullif(btrim(coalesce(v, '')), '');
exception when others then
  return null;
end;
$$;

-- 5-8. 지금 시도해도 되는가 → (retry 초, 걸린 층). 0 이면 됩니다.
--   기기   10분 실패 5회 → 마지막 실패 뒤 30초, 실패마다 2배, 최대 10분
--   IP     15분 실패 20회 → 마지막 실패 뒤 15분          (IP 를 믿을 수 있을 때만)
--   부스   15분 실패 10회 → 잠그지 않고, 그 부스는 30초에 한 번만 시도
--   전체   1시간 실패 200회 → 잠그지 않고, 전체가 5초에 한 번만 시도
drop function if exists private.booth_pin_retry_after(text, text, uuid, timestamptz);
create function private.booth_pin_retry_after(p_ip text, p_dev text, p_booth uuid, p_now timestamptz,
                                              out retry integer, out kind text)
language plpgsql
stable
set search_path = ''
as $$
declare
  n      bigint;
  last_at timestamptz;
  w      integer;
begin
  retry := 0;
  kind := null;

  select count(*) into n from public.booth_auth_event e
   where e.event = 'pin_fail' and e.at > p_now - interval '60 minutes';
  if n >= 200 then
    select max(e.at) into last_at from public.booth_auth_event e
     where e.event in ('pin_fail', 'pin_ok') and e.at > p_now - interval '5 seconds';
    if last_at is not null then
      w := ceil(extract(epoch from (last_at + interval '5 seconds' - p_now)))::integer;
      if w > retry then retry := w; kind := 'global'; end if;
    end if;
  end if;

  if p_ip is not null then
    select count(*), max(e.at) into n, last_at from public.booth_auth_event e
     where e.event = 'pin_fail' and e.ip_tag = p_ip and e.at > p_now - interval '15 minutes';
    if n >= 20 then
      w := ceil(extract(epoch from (last_at + interval '15 minutes' - p_now)))::integer;
      if w > retry then retry := w; kind := 'ip'; end if;
    end if;
  end if;

  if p_dev is not null then
    select count(*), max(e.at) into n, last_at from public.booth_auth_event e
     where e.event = 'pin_fail' and e.device_tag = p_dev and e.at > p_now - interval '10 minutes';
    if n >= 5 then
      w := ceil(extract(epoch from (last_at + make_interval(secs => least(600, 30 * power(2, least(n - 5, 10)))) - p_now)))::integer;
      if w > retry then retry := w; kind := 'device'; end if;
    end if;
  end if;

  if p_booth is not null then
    select count(*) into n from public.booth_auth_event e
     where e.event = 'pin_fail' and e.booth_id = p_booth and e.at > p_now - interval '15 minutes';
    if n >= 10 then
      select max(e.at) into last_at from public.booth_auth_event e
       where e.event in ('pin_fail', 'pin_ok') and e.booth_id = p_booth and e.at > p_now - interval '30 seconds';
      if last_at is not null then
        w := ceil(extract(epoch from (last_at + interval '30 seconds' - p_now)))::integer;
        if w > retry then retry := w; kind := 'booth'; end if;
      end if;
    end if;
  end if;
end;
$$;

-- 5-9. 로그인 실패 · 제한 · 꺼짐의 답(성공 칸은 모두 비움).
drop function if exists private.booth_pin_no(text, integer);
create function private.booth_pin_no(p_reason text, p_retry integer)
returns table (ok boolean, reason text, retry_after integer, session text, expires_at timestamptz,
               booth_id uuid, code text, zone_key text, zone_label text, name text, org text,
               congestion text, wait_minutes integer, updated_at timestamptz)
language sql
immutable
set search_path = ''
as $$
  select false, p_reason, greatest(coalesce(p_retry, 0), 0), null::text, null::timestamptz,
         null::uuid, null::text, null::text, null::text, null::text, null::text,
         null::text, null::integer, null::timestamptz
$$;

-- 5-10. 운영 화면에 보일 부스 한 줄. QR 함수(booth_ctrl_get)와 같은 code 셈법.
--       booth_access 를 읽지 않습니다.
drop function if exists private.booth_op_row(uuid);
create function private.booth_op_row(p_booth uuid)
returns table (booth_id uuid, code text, zone_key text, zone_label text, name text, org text,
               congestion text, wait_minutes integer, updated_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select b.id,
         coalesce(nullif(b.code, ''),
                  b.zone_key || '-' || lpad(b.no::text, greatest(2, length(b.no::text)), '0')),
         b.zone_key, z.label, b.name, b.org, l.congestion, l.wait_minutes, l.updated_at
    from public.booths b
    left join public.zones z on z.key = b.zone_key
    left join public.booth_live l on l.booth_id = b.id
   where b.id = p_booth
$$;

-- 5-11. 값 바꾸기 — QR 의 booth_ctrl_set 과 같은 규칙 · 같은 문구(혼잡도: 10분 이하 여유,
--       25분 이하 보통, 그 위 혼잡 · 중단 · 마감은 0분). 기록에 세션을 남깁니다.
drop function if exists private.booth_op_set(uuid, text, integer, uuid);
create function private.booth_op_set(p_booth uuid, p_mode text, p_wait integer, p_session uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_congestion text;
  v_wait       integer;
begin
  if p_mode is null or p_mode not in ('open', 'pause', 'closed') then
    raise exception '허용되지 않는 상태입니다.' using errcode = '22023';
  end if;
  if p_mode = 'open' then
    if p_wait is null or p_wait not between 0 and 180 then
      raise exception '대기 시간은 0~180분이어야 합니다.' using errcode = '22023';
    end if;
    v_wait := p_wait;
    v_congestion := case when p_wait <= 10 then '여유'
                         when p_wait <= 25 then '보통'
                         else '혼잡' end;
  elsif p_mode = 'pause' then
    v_congestion := '중단';
    v_wait := 0;
  else
    v_congestion := '마감';
    v_wait := 0;
  end if;

  insert into public.booth_live as l (booth_id, congestion, wait_minutes, updated_at)
  values (p_booth, v_congestion, v_wait, pg_catalog.now())
  on conflict on constraint booth_live_pkey do update
     set congestion   = excluded.congestion,
         wait_minutes = excluded.wait_minutes,
         updated_at   = excluded.updated_at;

  insert into public.booth_live_log as g (booth_id, congestion, wait_minutes, source, session_id)
  values (p_booth, v_congestion, v_wait, 'set', p_session);
end;
$$;

-- 5-12. "변동 없음 · 지금 확인" — QR 의 booth_ctrl_touch 와 같은 규칙(오늘 값만 당김).
drop function if exists private.booth_op_touch(uuid, uuid);
create function private.booth_op_touch(p_booth uuid, p_session uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_congestion text;
  v_wait       integer;
begin
  update public.booth_live as l
     set updated_at = pg_catalog.now()
   where l.booth_id = p_booth
     and (l.updated_at at time zone 'Asia/Seoul')::date
       = (pg_catalog.now() at time zone 'Asia/Seoul')::date
  returning l.congestion, l.wait_minutes into v_congestion, v_wait;

  if not found then
    raise exception '아직 입력한 값이 없습니다. 먼저 대기 시간을 눌러 주세요.' using errcode = '22023';
  end if;

  insert into public.booth_live_log as g (booth_id, congestion, wait_minutes, source, session_id)
  values (p_booth, v_congestion, v_wait, 'touch', p_session);
end;
$$;

-- 5-13. 세션 원문 → (세션, 부스). 못 쓰는 세션이면 42501 + hint 로 까닭을 알립니다.
--   booth_pin_off            전체 스위치가 꺼짐(세션은 남아 있어 다시 켜면 이어집니다)
--   booth_session_invalid    모양이 틀림 · 모름 · 로그아웃 · 같은 기기 재로그인 · 상한으로 끊김
--   booth_session_revoked    운영본부가 PIN 을 재발급하거나 꺼서 끊김
--   booth_session_expired    만료(그날 자정 또는 12시간)
--   booth_session_unavailable 부스가 지금 비공개 · 미배정 · 구역 비공개(세션은 그대로)
--   p_mark: 쓰기(set · touch)면 마지막 사용 시각을 늘 적고, 읽기면 10분에 한 번만 적습니다.
drop function if exists private.booth_session_resolve(text, boolean);
create function private.booth_session_resolve(p_session text, p_mark boolean)
returns table (session_id uuid, booth_id uuid, created_at timestamptz, expires_at timestamptz)
language plpgsql
volatile
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_on boolean;
  s    public.booth_session%rowtype;
begin
  select st.booth_pin_enabled into v_on from public.settings st order by st.id limit 1;
  if not coalesce(v_on, false) then
    raise exception 'PIN 로그인이 꺼져 있습니다.' using errcode = '42501', hint = 'booth_pin_off';
  end if;
  if p_session is null or p_session !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'PIN 로그인이 끝났습니다.' using errcode = '42501', hint = 'booth_session_invalid';
  end if;

  select x.* into s from public.booth_session x where x.token_hash = extensions.digest(p_session, 'sha256');
  if not found then
    raise exception 'PIN 로그인이 끝났습니다.' using errcode = '42501', hint = 'booth_session_invalid';
  end if;
  if s.revoked_at is not null then
    if s.revoke_reason in ('pin_reissued', 'pin_disabled') then
      raise exception '운영본부가 PIN을 변경했습니다.' using errcode = '42501', hint = 'booth_session_revoked';
    end if;
    raise exception 'PIN 로그인이 끝났습니다.' using errcode = '42501', hint = 'booth_session_invalid';
  end if;
  if s.expires_at <= pg_catalog.now() then
    raise exception 'PIN 로그인 시간이 끝났습니다.' using errcode = '42501', hint = 'booth_session_expired';
  end if;
  if not exists (
    select 1 from public.booths b join public.zones z on z.key = b.zone_key
     where b.id = s.booth_id and b.is_published and z.is_published and b.no is not null
  ) then
    raise exception '지금은 이 부스를 운영할 수 없습니다.' using errcode = '42501', hint = 'booth_session_unavailable';
  end if;

  if p_mark or s.last_used_at is null or s.last_used_at < pg_catalog.now() - interval '10 minutes' then
    update public.booth_session as x set last_used_at = pg_catalog.now() where x.id = s.id;
  end if;

  return query select s.id, s.booth_id, s.created_at, s.expires_at;
end;
$$;

revoke all on function private.booth_pin_pepper()                                   from public;
revoke all on function private.booth_tag(text, text)                                from public;
revoke all on function private.booth_pin_digest(text)                               from public;
revoke all on function private.booth_pin_weak(text)                                 from public;
revoke all on function private.booth_pin_generate()                                 from public;
revoke all on function private.booth_session_token()                                from public;
revoke all on function private.booth_client_ip()                                    from public;
revoke all on function private.booth_pin_retry_after(text, text, uuid, timestamptz) from public;
revoke all on function private.booth_pin_no(text, integer)                          from public;
revoke all on function private.booth_op_row(uuid)                                   from public;
revoke all on function private.booth_op_set(uuid, text, integer, uuid)              from public;
revoke all on function private.booth_op_touch(uuid, uuid)                           from public;
revoke all on function private.booth_session_resolve(text, boolean)                 from public;


-- ═══════════════════════════════════════════════════════════════
-- 6. 운영자 함수 (anon) — 공통 규칙은 migration-booth-live.sql 4번과 같습니다
--    security definer + search_path '' · drop → create · 실행 권한은 anon · authenticated
-- ═══════════════════════════════════════════════════════════════

-- 6-1. booth_pin_login(부스, PIN, 기기) — 성공하면 세션 원문을 한 번 돌려줍니다.
--   언제나 한 줄을 돌려주고 오류를 내지 않습니다(실패 기록이 남아야 하니까요).
--     ok true            session · expires_at · 부스 칸
--     reason 'invalid'   부스 번호나 PIN 이 맞지 않음 — PIN 미발급 · 꺼짐 · 부스 비공개도
--                        모두 이 하나(무엇이 문제인지 알려 주지 않습니다). retry_after 가 0 보다
--                        크면 다음 시도까지 기다릴 초
--     reason 'limited'   횟수 제한 — retry_after 초 뒤 다시
--     reason 'off'       PIN 로그인이 꺼짐(전체 스위치 · 행사 종료 12시간 뒤)
--   p_device: 운영자 화면이 이 기기에 만들어 둔 무작위 값(16~64자). HMAC 표식으로만 남깁니다.
--   GET · HEAD 로 오면 아무것도 하지 않습니다(PIN 이 주소에 실리는 방식을 막습니다).
drop function if exists public.booth_pin_login(uuid, text, text);
create function public.booth_pin_login(p_booth_id uuid, p_pin text, p_device text default null)
returns table (ok boolean, reason text, retry_after integer, session text, expires_at timestamptz,
               booth_id uuid, code text, zone_key text, zone_label text, name text, org text,
               congestion text, wait_minutes integer, updated_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  -- PIN 이 없는 부스에도 같은 시간이 걸리게 계산할 가짜 bcrypt 해시(무작위 값의 해시, PIN 아님).
  c_dummy  constant text := '$2a$10$lbS/kgNlmfpNa2ZehjX/tu58PIpz4BvIBUmhwDE16XEU.Gatab65i';
  v_now    timestamptz := pg_catalog.now();
  v_on     boolean;
  v_end    timestamptz;
  v_ip     text;
  v_dev    text;
  v_booth  uuid;
  v_hash   text;
  v_match  boolean := false;
  v_retry  integer;
  v_kind   text;
  v_token  text;
  v_exp    timestamptz;
  v_sid    uuid;
begin
  if coalesce(pg_catalog.current_setting('request.method', true), '') in ('GET', 'HEAD') then
    return query select * from private.booth_pin_no('invalid', 0);
    return;
  end if;

  select s.booth_pin_enabled, s.event_end into v_on, v_end from public.settings s order by s.id limit 1;
  if not coalesce(v_on, false) or (v_end is not null and v_now > v_end + interval '12 hours') then
    return query select * from private.booth_pin_no('off', 0);
    return;
  end if;

  v_ip  := private.booth_tag('ip', private.booth_client_ip());
  v_dev := coalesce(case when p_device ~ '^[A-Za-z0-9_-]{16,64}$' then private.booth_tag('dev', p_device) end, 'nodev');
  -- 기록의 부스 칸은 외래 키라, 있는 부스일 때만 적습니다.
  select b.id into v_booth from public.booths b where b.id = p_booth_id;

  -- 같은 IP · 기기 · 부스의 동시 시도는 줄을 세웁니다. 기다리지 않고 1초 뒤 다시 하라고 답합니다.
  if (v_ip is not null and not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('booth_pin:ip:' || v_ip, 0)))
     or not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('booth_pin:dev:' || v_dev, 0))
     or (v_booth is not null
         and not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('booth_pin:booth:' || v_booth::text, 0))) then
    return query select * from private.booth_pin_no('limited', 1);
    return;
  end if;

  select r.retry, r.kind into v_retry, v_kind from private.booth_pin_retry_after(v_ip, v_dev, v_booth, v_now) r;
  if v_retry > 0 then
    -- 제한에 걸린 시도는 기기마다 1분에 한 줄만 남깁니다(기록이 부풀지 않게).
    if not exists (select 1 from public.booth_auth_event e
                    where e.event = 'pin_limited' and e.device_tag = v_dev and e.at > v_now - interval '1 minute') then
      insert into public.booth_auth_event (event, booth_id, ip_tag, device_tag, limit_kind)
      values ('pin_limited', v_booth, v_ip, v_dev, v_kind);
    end if;
    return query select * from private.booth_pin_no('limited', v_retry);
    return;
  end if;

  if p_pin ~ '^[0-9]{6}$' then
    if v_booth is not null then
      select p.pin_hash into v_hash
        from public.booth_pin p
        join public.booths b on b.id = p.booth_id
        join public.zones  z on z.key = b.zone_key
       where p.booth_id = v_booth
         and p.disabled_at is null
         and b.is_published and z.is_published and b.no is not null;
    end if;
    -- 늘 bcrypt 를 한 번 돌립니다(해시가 없으면 가짜 해시로) — 응답 시간으로 PIN 발급 여부를 알 수 없게.
    v_match := extensions.crypt(private.booth_pin_digest(p_pin), coalesce(v_hash, c_dummy)) = v_hash;
  end if;

  if not coalesce(v_match, false) then
    insert into public.booth_auth_event (event, booth_id, ip_tag, device_tag)
    values ('pin_fail', v_booth, v_ip, v_dev);
    select r.retry into v_retry from private.booth_pin_retry_after(v_ip, v_dev, v_booth, v_now) r;
    return query select * from private.booth_pin_no('invalid', v_retry);
    return;
  end if;

  -- 같은 기기가 같은 부스로 다시 들어오면 그 기기의 이전 세션은 정리합니다.
  with cut as (
    update public.booth_session as s
       set revoked_at = v_now, revoke_reason = 'same_device'
     where s.booth_id = v_booth and s.device_tag = v_dev and v_dev <> 'nodev'
       and s.revoked_at is null and s.expires_at > v_now
    returning s.id
  )
  insert into public.booth_auth_event (event, booth_id, session_id, detail)
  select 'session_revoked', v_booth, cut.id, 'same_device' from cut;

  -- 부스당 활성 세션은 10개까지 — 새 세션 자리를 위해 가장 오래된 것부터 끊습니다.
  with extra as (
    select s.id from public.booth_session s
     where s.booth_id = v_booth and s.revoked_at is null and s.expires_at > v_now
     order by s.created_at desc
    offset 9
  ), cut as (
    update public.booth_session as s
       set revoked_at = v_now, revoke_reason = 'session_cap'
      from extra where s.id = extra.id
    returning s.id
  )
  insert into public.booth_auth_event (event, booth_id, session_id, detail)
  select 'session_revoked', v_booth, cut.id, 'session_cap' from cut;

  -- 만료: 로그인 + 12시간과 그날 24:00(한국 시각) 중 이른 쪽.
  v_token := private.booth_session_token();
  v_exp := least(v_now + interval '12 hours',
                 ((v_now at time zone 'Asia/Seoul')::date + 1)::timestamp at time zone 'Asia/Seoul');
  insert into public.booth_session (booth_id, token_hash, created_at, expires_at, last_used_at, device_tag)
  values (v_booth, extensions.digest(v_token, 'sha256'), v_now, v_exp, v_now, v_dev)
  returning id into v_sid;

  insert into public.booth_auth_event (event, booth_id, session_id, ip_tag, device_tag)
  values ('pin_ok', v_booth, v_sid, v_ip, v_dev);

  return query
    select true, null::text, 0, v_token, v_exp,
           r.booth_id, r.code, r.zone_key, r.zone_label, r.name, r.org, r.congestion, r.wait_minutes, r.updated_at
      from private.booth_op_row(v_booth) r;
end;
$$;

-- 6-2. booth_session_get(세션) — 그 부스의 지금 값. 돌려주는 모양은 booth_ctrl_get 과 같고
--   (issued_at = 세션을 연 시각, token_tail = 늘 null) 끝에 expires_at 하나를 더합니다.
--   GET · HEAD 면 0줄입니다(booth_ctrl_get 과 같은 까닭).
drop function if exists public.booth_session_get(text);
create function public.booth_session_get(p_session text)
returns table (booth_id uuid, code text, zone_key text, zone_label text, name text, org text,
               congestion text, wait_minutes integer, updated_at timestamptz,
               issued_at timestamptz, token_tail text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  s record;
begin
  if coalesce(pg_catalog.current_setting('request.method', true), '') in ('GET', 'HEAD') then
    return;
  end if;
  select * into s from private.booth_session_resolve(p_session, false);
  return query
    select r.booth_id, r.code, r.zone_key, r.zone_label, r.name, r.org, r.congestion, r.wait_minutes, r.updated_at,
           s.created_at, null::text, s.expires_at
      from private.booth_op_row(s.booth_id) r;
end;
$$;

-- 6-3. booth_session_set(세션, 상태, 대기 분) — 값 바꾸기(booth_ctrl_set 과 같은 규칙 · 같은 문구).
drop function if exists public.booth_session_set(text, text, integer);
create function public.booth_session_set(p_session text, p_mode text, p_wait_minutes integer)
returns table (booth_id uuid, code text, zone_key text, zone_label text, name text, org text,
               congestion text, wait_minutes integer, updated_at timestamptz,
               issued_at timestamptz, token_tail text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  s record;
begin
  select * into s from private.booth_session_resolve(p_session, true);
  perform private.booth_op_set(s.booth_id, p_mode, p_wait_minutes, s.session_id);
  return query
    select r.booth_id, r.code, r.zone_key, r.zone_label, r.name, r.org, r.congestion, r.wait_minutes, r.updated_at,
           s.created_at, null::text, s.expires_at
      from private.booth_op_row(s.booth_id) r;
end;
$$;

-- 6-4. booth_session_touch(세션) — "변동 없음 · 지금 확인"(booth_ctrl_touch 와 같은 규칙).
drop function if exists public.booth_session_touch(text);
create function public.booth_session_touch(p_session text)
returns table (booth_id uuid, code text, zone_key text, zone_label text, name text, org text,
               congestion text, wait_minutes integer, updated_at timestamptz,
               issued_at timestamptz, token_tail text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  s record;
begin
  select * into s from private.booth_session_resolve(p_session, true);
  perform private.booth_op_touch(s.booth_id, s.session_id);
  return query
    select r.booth_id, r.code, r.zone_key, r.zone_label, r.name, r.org, r.congestion, r.wait_minutes, r.updated_at,
           s.created_at, null::text, s.expires_at
      from private.booth_op_row(s.booth_id) r;
end;
$$;

-- 6-5. booth_session_logout(세션) — 이 세션 하나만 끊습니다(같은 부스의 다른 운영자 세션은 그대로).
--   전체 스위치가 꺼져 있어도 됩니다. 모르는 세션이어도 true(세션이 있었는지 알려 주지 않음).
drop function if exists public.booth_session_logout(text);
create function public.booth_session_logout(p_session text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_booth uuid;
begin
  if coalesce(pg_catalog.current_setting('request.method', true), '') in ('GET', 'HEAD') then
    return false;
  end if;
  if p_session is null or p_session !~ '^[A-Za-z0-9_-]{43}$' then
    return true;
  end if;
  update public.booth_session as s
     set revoked_at = pg_catalog.now(), revoke_reason = 'logout'
   where s.token_hash = extensions.digest(p_session, 'sha256') and s.revoked_at is null
  returning s.id, s.booth_id into v_id, v_booth;
  if v_id is not null then
    insert into public.booth_auth_event (event, booth_id, session_id, detail)
    values ('session_logout', v_booth, v_id, 'logout');
  end if;
  return true;
end;
$$;

revoke all     on function public.booth_pin_login(uuid, text, text)          from public;
revoke all     on function public.booth_session_get(text)                    from public;
revoke all     on function public.booth_session_set(text, text, integer)     from public;
revoke all     on function public.booth_session_touch(text)                  from public;
revoke all     on function public.booth_session_logout(text)                 from public;
grant  execute on function public.booth_pin_login(uuid, text, text)          to anon, authenticated;
grant  execute on function public.booth_session_get(text)                    to anon, authenticated;
grant  execute on function public.booth_session_set(text, text, integer)     to anon, authenticated;
grant  execute on function public.booth_session_touch(text)                  to anon, authenticated;
grant  execute on function public.booth_session_logout(text)                 to anon, authenticated;

comment on function public.booth_pin_login(uuid, text, text) is
  '부스 운영자 PIN 로그인(구역 → 부스 → 6자리). 실패도 오류 없이 ok=false 로 답합니다. anon 실행 권한은 의도된 것입니다 — 보안 점검 경고를 보고 거두지 마세요.';
comment on function public.booth_session_get(text) is
  'PIN 세션으로 그 부스의 지금 값을 읽습니다(부스 id 인자 없음). anon 실행 권한은 의도된 것입니다.';
comment on function public.booth_session_set(text, text, integer) is
  'PIN 세션으로 그 부스의 대기 값을 바꿉니다(booth_ctrl_set 과 같은 규칙, 부스 id 인자 없음). anon 실행 권한은 의도된 것입니다.';
comment on function public.booth_session_touch(text) is
  'PIN 세션으로 "변동 없음 · 지금 확인"(부스 id 인자 없음). anon 실행 권한은 의도된 것입니다.';
comment on function public.booth_session_logout(text) is
  'PIN 세션 하나를 끊습니다(이 휴대폰에서 나가기). anon 실행 권한은 의도된 것입니다.';


-- ═══════════════════════════════════════════════════════════════
-- 7. 관리자 함수 — is_admin() 이 막고, anon 실행 권한을 거둡니다
-- ═══════════════════════════════════════════════════════════════

-- 7-1. admin_booth_credentials() — 부스마다 QR · PIN 상태(값 없음). 관리자 목록 · 현장 콘솔용.
--   qr_state · pin_state: 'none'(미발급) · 'on'(켜짐) · 'off'(꺼짐)
--   pin_sessions: 지금 쓸 수 있는 PIN 세션 수 · pin_failures_1h: 최근 1시간 PIN 실패 수
--   live_by: 마지막 대기 입력을 누가 했나 'qr'(운영자 QR) · 'pin'(운영자 PIN) · 'admin'(관리자) · null(기록 없음)
--   QR 열쇠 · 해시 · 세션은 돌려주지 않습니다.
drop function if exists public.admin_booth_credentials();
create function public.admin_booth_credentials()
returns table (booth_id uuid, qr_state text, qr_issued_at timestamptz,
               pin_state text, pin_issued_at timestamptz, pin_sessions integer, pin_failures_1h integer,
               live_by text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception '관리자만 볼 수 있습니다.' using errcode = '42501';
  end if;
  return query
    select b.id,
           case when a.booth_id is null then 'none' when a.disabled_at is not null then 'off' else 'on' end,
           coalesce(a.rotated_at, a.created_at),
           case when p.booth_id is null then 'none' when p.disabled_at is not null then 'off' else 'on' end,
           coalesce(p.reissued_at, p.issued_at),
           (select count(*) from public.booth_session s
             where s.booth_id = b.id and s.revoked_at is null and s.expires_at > pg_catalog.now())::integer,
           (select count(*) from public.booth_auth_event e
             where e.booth_id = b.id and e.event = 'pin_fail' and e.at > pg_catalog.now() - interval '1 hour')::integer,
           (select case when g.source = 'admin' then 'admin' when g.session_id is not null then 'pin' else 'qr' end
              from public.booth_live_log g
             where g.booth_id = b.id
             order by g.created_at desc, g.id desc
             limit 1)
      from public.booths b
      left join public.booth_access a on a.booth_id = b.id
      left join public.booth_pin    p on p.booth_id = b.id
     order by b.id;
end;
$$;

-- 7-2. admin_issue_booth_pin(부스) — 첫 발급 · 재발급 · 꺼진 PIN 다시 켜기를 모두 이것 하나로.
--   서버가 새 PIN 을 만들어 원문을 이 응답에서 한 번만 돌려줍니다(저장은 해시만).
--   그 부스의 PIN 세션은 모두 끊습니다(옛 PIN 으로 연 기기가 남지 않게). QR 은 그대로.
--   구역 · 번호가 없는 부스(미배정)에는 발급하지 않습니다.
drop function if exists public.admin_issue_booth_pin(uuid);
create function public.admin_issue_booth_pin(p_booth_id uuid)
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

-- 7-3. admin_disable_booth_pin(부스) — 새 PIN 로그인을 막고 그 부스의 PIN 세션을 모두 끊습니다.
--   해시도 무작위 값의 해시로 바꿔 둡니다(QR 끄기와 같은 방식). 다시 켜기 = 새 PIN 발급(7-2).
--   이미 꺼져 있으면 처음 끈 시각을 그대로 둡니다. QR 은 그대로.
drop function if exists public.admin_disable_booth_pin(uuid);
create function public.admin_disable_booth_pin(p_booth_id uuid)
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

-- 7-4. admin_booth_ip_probe() — IP 헤더 실측(관리자 전용, 읽기만).
--   원래 IP 는 돌려주지 않습니다. 헤더 '이름' 목록과, 시험값 203.0.113.77(문서용 주소)을
--   요청에 직접 실어 보냈을 때 그 값이 어느 헤더 · 어느 자리에 그대로 남는지만 알려 줍니다.
--   그대로 남는 헤더는 위조할 수 있는 것이라 횟수 제한에 쓰면 안 됩니다(1번 설정 참고).
drop function if exists public.admin_booth_ip_probe();
create function public.admin_booth_ip_probe()
returns table (header_names text[], cf_present boolean, cf_is_probe boolean,
               xri_present boolean, xri_is_probe boolean, xff_count integer, xff_probe_pos integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_probe constant text := '203.0.113.77';
  h     json;
  parts text[];
begin
  if not public.is_admin() then
    raise exception '관리자만 볼 수 있습니다.' using errcode = '42501';
  end if;
  h := coalesce(nullif(pg_catalog.current_setting('request.headers', true), ''), '{}')::json;
  parts := case when h ->> 'x-forwarded-for' is null then array[]::text[]
                else string_to_array(replace(h ->> 'x-forwarded-for', ' ', ''), ',') end;
  return query select
    array(select k from json_object_keys(h) k order by k),
    (h ->> 'cf-connecting-ip') is not null,
    coalesce(h ->> 'cf-connecting-ip', '') = c_probe,
    (h ->> 'x-real-ip') is not null,
    coalesce(h ->> 'x-real-ip', '') = c_probe,
    coalesce(array_length(parts, 1), 0),
    array_position(parts, c_probe);
end;
$$;

revoke all     on function public.admin_booth_credentials()       from public;
revoke all     on function public.admin_issue_booth_pin(uuid)     from public;
revoke all     on function public.admin_disable_booth_pin(uuid)   from public;
revoke all     on function public.admin_booth_ip_probe()          from public;
revoke execute on function public.admin_booth_credentials()       from anon;
revoke execute on function public.admin_issue_booth_pin(uuid)     from anon;
revoke execute on function public.admin_disable_booth_pin(uuid)   from anon;
revoke execute on function public.admin_booth_ip_probe()          from anon;
grant  execute on function public.admin_booth_credentials()       to authenticated;
grant  execute on function public.admin_issue_booth_pin(uuid)     to authenticated;
grant  execute on function public.admin_disable_booth_pin(uuid)   to authenticated;
grant  execute on function public.admin_booth_ip_probe()          to authenticated;

comment on function public.admin_booth_credentials() is
  '관리자 전용. 부스마다 QR · PIN 상태와 PIN 세션 수 · 최근 1시간 실패 수 · 마지막 입력 주체(값 · 해시 없음).';
comment on function public.admin_issue_booth_pin(uuid) is
  '관리자 전용. 새 PIN 을 만들어 원문을 한 번만 돌려줍니다(첫 발급 · 재발급 · 다시 켜기). 그 부스의 PIN 세션은 모두 끊습니다. QR 은 그대로.';
comment on function public.admin_disable_booth_pin(uuid) is
  '관리자 전용. PIN 로그인을 막고 그 부스의 PIN 세션을 모두 끊습니다(해시도 버림). 다시 켜기는 새 PIN 발급. QR 은 그대로.';
comment on function public.admin_booth_ip_probe() is
  '관리자 전용. IP 헤더 실측(헤더 이름과 시험값의 자리만, 원래 IP 없음).';


-- ═══════════════════════════════════════════════════════════════
-- 8. API 가 새 칸 · 함수를 바로 알도록
-- ═══════════════════════════════════════════════════════════════
notify pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════
-- 9. 확인 (읽기만 합니다. PIN · 세션 · 해시 · pepper 값은 조회하지 않습니다)
--    '맞음' 이 모두 true 여야 합니다. 기대가 빈 줄은 참고용 숫자입니다.
-- ═══════════════════════════════════════════════════════════════
select v."순서", v."항목", v."기대", v."실제", v."기대" = v."실제" as "맞음"
  from (values
    ( 1, 'QR 함수 정의 md5 — 적용 전과 같음 (get · set · touch)', '3',
         (select count(*) from booth_pin_qr_before q
           where q.h = md5(pg_catalog.pg_get_functiondef(q.fn::regprocedure)))::text),
    ( 2, 'QR 함수 이름마다 정의 1개', 'booth_ctrl_get 1, booth_ctrl_set 1, booth_ctrl_touch 1',
         (select string_agg(f.n || ' ' || (select count(*) from pg_catalog.pg_proc pro
                                             join pg_catalog.pg_namespace nsp on nsp.oid = pro.pronamespace
                                            where nsp.nspname = 'public' and pro.proname = f.n)::text,
                            ', ' order by f.n collate "C")
            from unnest(array['booth_ctrl_get', 'booth_ctrl_set', 'booth_ctrl_touch']) as f(n))),
    ( 3, 'booth_access 칸 그대로', 'booth_id, token, created_at, rotated_at, disabled_at',
         (select string_agg(att.attname::text, ', ' order by att.attnum) from pg_catalog.pg_attribute att
           where att.attrelid = 'public.booth_access'::regclass and att.attnum > 0 and not att.attisdropped)),
    ( 4, '새 표 RLS 켜짐 (셋 중)', '3',
         (select count(*) from pg_catalog.pg_class c
           where c.oid in ('public.booth_pin'::regclass, 'public.booth_session'::regclass, 'public.booth_auth_event'::regclass)
             and c.relrowsecurity)::text),
    ( 5, '새 표 정책 수', '0',
         (select count(*) from pg_catalog.pg_policies p
           where p.schemaname = 'public' and p.tablename in ('booth_pin', 'booth_session', 'booth_auth_event'))::text),
    ( 6, '새 표 anon · authenticated 권한 (어느 하나라도)', 'false',
         (select bool_or(has_table_privilege(r.rol, t.tbl, pr.p))
            from unnest(array['anon', 'authenticated']) r(rol),
                 unnest(array['public.booth_pin', 'public.booth_session', 'public.booth_auth_event']) t(tbl),
                 unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) pr(p))::text),
    ( 7, '보안 기록 순서기 anon · authenticated 권한', 'false',
         (has_sequence_privilege('anon', 'public.booth_auth_event_id_seq', 'USAGE')
          or has_sequence_privilege('authenticated', 'public.booth_auth_event_id_seq', 'USAGE'))::text),
    ( 8, 'private 스키마 USAGE (anon · authenticated)', 'false',
         (has_schema_privilege('anon', 'private', 'USAGE')
          or has_schema_privilege('authenticated', 'private', 'USAGE'))::text),
    ( 9, 'private 함수 실행 권한 (anon · authenticated, 어느 하나라도)', 'false',
         (select coalesce(bool_or(has_function_privilege(r.rol, p.oid, 'EXECUTE')), false)
            from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace,
                 unnest(array['anon', 'authenticated']) r(rol)
           where n.nspname = 'private')::text),
    (10, 'anon 운영자 PIN 함수 실행 (다섯 모두)', 'true',
         (has_function_privilege('anon', 'public.booth_pin_login(uuid,text,text)', 'EXECUTE')
          and has_function_privilege('anon', 'public.booth_session_get(text)', 'EXECUTE')
          and has_function_privilege('anon', 'public.booth_session_set(text,text,integer)', 'EXECUTE')
          and has_function_privilege('anon', 'public.booth_session_touch(text)', 'EXECUTE')
          and has_function_privilege('anon', 'public.booth_session_logout(text)', 'EXECUTE'))::text),
    (11, 'anon 관리자 PIN 함수 실행 (넷 중 하나라도)', 'false',
         (has_function_privilege('anon', 'public.admin_booth_credentials()', 'EXECUTE')
          or has_function_privilege('anon', 'public.admin_issue_booth_pin(uuid)', 'EXECUTE')
          or has_function_privilege('anon', 'public.admin_disable_booth_pin(uuid)', 'EXECUTE')
          or has_function_privilege('anon', 'public.admin_booth_ip_probe()', 'EXECUTE'))::text),
    (12, 'authenticated 관리자 PIN 함수 실행 (넷 모두)', 'true',
         (has_function_privilege('authenticated', 'public.admin_booth_credentials()', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.admin_issue_booth_pin(uuid)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.admin_disable_booth_pin(uuid)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.admin_booth_ip_probe()', 'EXECUTE'))::text),
    (13, '새 공개 함수 security definer · search_path 빈 값 · 소유자 postgres (아홉)', '9',
         (select count(*) from pg_catalog.pg_proc pro join pg_catalog.pg_namespace nsp on nsp.oid = pro.pronamespace
           where nsp.nspname = 'public'
             and pro.proname in ('booth_pin_login', 'booth_session_get', 'booth_session_set', 'booth_session_touch',
                                 'booth_session_logout', 'admin_booth_credentials', 'admin_issue_booth_pin',
                                 'admin_disable_booth_pin', 'admin_booth_ip_probe')
             and pro.prosecdef and pro.proconfig = array['search_path=""']
             and pg_catalog.pg_get_userbyid(pro.proowner) = 'postgres')::text),
    (14, '세션 함수 인자에 부스 id 없음 (get · set · touch · logout)', '0',
         (select count(*) from pg_catalog.pg_proc pro join pg_catalog.pg_namespace nsp on nsp.oid = pro.pronamespace
           where nsp.nspname = 'public' and pro.proname like 'booth_session\_%'
             and (pro.proargtypes::oid[] @> array['uuid'::regtype::oid]
                  or pg_catalog.pg_get_function_identity_arguments(pro.oid) like '%booth%'))::text),
    (15, 'PIN 해시 칸은 bcrypt 모양만 받음', 'true',
         (select count(*) = 1 from pg_catalog.pg_constraint con
           where con.conrelid = 'public.booth_pin'::regclass and con.conname = 'booth_pin_hash_check')::text),
    (16, 'PIN 로그인 함수가 booth_access 를 읽지 않음 (로그인 · 세션 · private)', 'false',
         (select bool_or(pg_catalog.pg_get_functiondef(pro.oid) like '%booth_access%')
            from pg_catalog.pg_proc pro join pg_catalog.pg_namespace nsp on nsp.oid = pro.pronamespace
           where (nsp.nspname = 'public' and pro.proname in ('booth_pin_login', 'booth_session_get', 'booth_session_set',
                                                             'booth_session_touch', 'booth_session_logout'))
              or nsp.nspname = 'private')::text),
    (17, 'settings.booth_pin_enabled 기본값 false', 'false',
         (select column_default from information_schema.columns
           where table_schema = 'public' and table_name = 'settings' and column_name = 'booth_pin_enabled')),
    (18, 'booth_live_log.session_id 비어도 됨 · 세션 지우면 null', 'true',
         ((select is_nullable = 'YES' from information_schema.columns
            where table_schema = 'public' and table_name = 'booth_live_log' and column_name = 'session_id')
          and (select pg_catalog.pg_get_constraintdef(con.oid) like '%ON DELETE SET NULL%' from pg_catalog.pg_constraint con
                where con.conname = 'booth_live_log_session_fkey'))::text),
    (19, 'Vault 비밀 booth_pin_pepper 있음 (이름만 확인)', '1',
         (select count(*) from vault.decrypted_secrets s where s.name = 'booth_pin_pepper')::text),
    (20, 'IP 층 설정 (비어 있으면 꺼짐 — 실측 뒤에만 켭니다)', null,
         coalesce((select s.ip_header from private.booth_pin_settings s where s.id = 1), '꺼짐')),
    (21, '참고: 지금 스위치 값', null,
         (select coalesce(bool_or(s.booth_pin_enabled), false)::text from public.settings s)),
    (22, '참고: PIN 발급된 부스 · 활성 세션 · 보안 기록 수', null,
         (select count(*) from public.booth_pin)::text || ' · ' ||
         (select count(*) from public.booth_session s where s.revoked_at is null and s.expires_at > now())::text || ' · ' ||
         (select count(*) from public.booth_auth_event)::text)
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";


-- ═══════════════════════════════════════════════════════════════
-- 10. 행사 후 정리 (11. 7. 이후, 따로 실행 — migration-booth-live.sql 7번과 함께)
--
--   PIN · 세션은 행사 뒤 쓸 일이 없습니다. 보안 기록은 보고 · 확인이 끝나면(행사 종료 + 14일) 지웁니다.
--     delete from public.booth_session;
--     delete from public.booth_pin;
--     delete from public.booth_auth_event where at < now() - interval '14 days';
--     update public.settings set booth_pin_enabled = false;
-- ═══════════════════════════════════════════════════════════════
