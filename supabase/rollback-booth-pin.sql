-- ===================================================================
-- 되돌리기: 부스 운영자 PIN 보조 로그인 (migration-booth-pin.sql)
--
--   PIN 기능을 통째로 걷어낼 때만 씁니다. 당장 멈추기만 하려면 이 파일 대신
--     update public.settings set booth_pin_enabled = false;
--   한 줄이면 됩니다(새 PIN 로그인 · 열린 PIN 세션이 모두 멈추고 QR 은 그대로).
--
--   지우는 것: PIN 함수 아홉 · private 도우미 · booth_pin · booth_session · booth_auth_event
--              (그 안의 PIN 해시 · 세션 · 보안 기록) · booth_live_log.session_id 칸 ·
--              settings.booth_pin_enabled 칸 · Vault 비밀 booth_pin_pepper · 빈 private 스키마
--   남기는 것: QR 운영자 함수(booth_ctrl_*) · booth_access · booth_live · booth_live_log 의 값 ·
--              관리자 QR 함수 — 한 글자도 바꾸지 않습니다(맨 아래 확인 1번이 md5 로 견줍니다).
--
--   화면 쪽: 운영자 화면은 PIN 함수가 없으면(PGRST202) 'PIN으로 시작' 단추를 숨기고 QR 은
--   그대로 씁니다. 관리자 화면은 PIN 상태 칸만 비웁니다. 그래도 PIN 화면 코드를 함께
--   되돌리는 것(커밋 되돌리기)을 권합니다.
--
-- 사용법: SQL Editor · apply_migration 에 전체 붙여넣고 Run(한 트랜잭션). 여러 번 돌려도 같습니다.
-- ===================================================================

create temp table booth_pin_rollback_qr_before on commit drop as
select p.oid::regprocedure::text as fn, md5(pg_catalog.pg_get_functiondef(p.oid)) as h
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('booth_ctrl_get', 'booth_ctrl_set', 'booth_ctrl_touch');

-- 1. 함수 (공개 → private)
drop function if exists public.booth_pin_login(uuid, text, text);
drop function if exists public.booth_session_get(text);
drop function if exists public.booth_session_set(text, text, integer);
drop function if exists public.booth_session_touch(text);
drop function if exists public.booth_session_logout(text);
drop function if exists public.admin_booth_credentials();
drop function if exists public.admin_issue_booth_pin(uuid);
drop function if exists public.admin_disable_booth_pin(uuid);
drop function if exists public.admin_booth_ip_probe();

drop function if exists private.booth_session_resolve(text, boolean);
drop function if exists private.booth_op_touch(uuid, uuid);
drop function if exists private.booth_op_set(uuid, text, integer, uuid);
drop function if exists private.booth_op_row(uuid);
drop function if exists private.booth_pin_no(text, integer);
drop function if exists private.booth_pin_retry_after(text, text, uuid, timestamptz);
drop function if exists private.booth_client_ip();
drop function if exists private.booth_session_token();
drop function if exists private.booth_pin_generate();
drop function if exists private.booth_pin_weak(text);
drop function if exists private.booth_pin_digest(text);
drop function if exists private.booth_tag(text, text);
drop function if exists private.booth_pin_pepper();

-- 2. 표 (기록 → 기존 표의 칸 → 세션 → PIN). booth_live_log 의 값 줄은 지우지 않습니다.
drop table if exists public.booth_auth_event;
alter table public.booth_live_log drop constraint if exists booth_live_log_session_fkey;
drop index if exists public.booth_live_log_session;
alter table public.booth_live_log drop column if exists session_id;
drop table if exists public.booth_session;
drop table if exists public.booth_pin;
drop table if exists private.booth_pin_settings;

-- 3. 스위치 칸 · pepper · 빈 private 스키마
alter table public.settings drop column if exists booth_pin_enabled;
delete from vault.secrets where name = 'booth_pin_pepper';
do $schema$
begin
  if exists (select 1 from pg_catalog.pg_namespace where nspname = 'private')
     and not exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'private')
     and not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private') then
    drop schema private;
  end if;
end
$schema$;

notify pgrst, 'reload schema';

-- 4. 확인 ('맞음' 이 모두 true)
select v."순서", v."항목", v."기대", v."실제", v."기대" = v."실제" as "맞음"
  from (values
    (1, 'QR 함수 정의 md5 — 되돌리기 전과 같음 (get · set · touch)', '3',
        (select count(*) from booth_pin_rollback_qr_before q
          where q.h = md5(pg_catalog.pg_get_functiondef(q.fn::regprocedure)))::text),
    (2, 'PIN 표 남은 것', '0',
        (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname in ('booth_pin', 'booth_session', 'booth_auth_event'))::text),
    (3, 'PIN 함수 남은 것', '0',
        (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where (n.nspname = 'public' and p.proname in ('booth_pin_login', 'booth_session_get', 'booth_session_set',
                                                        'booth_session_touch', 'booth_session_logout',
                                                        'admin_booth_credentials', 'admin_issue_booth_pin',
                                                        'admin_disable_booth_pin', 'admin_booth_ip_probe'))
             or n.nspname = 'private')::text),
    (4, 'booth_live_log 칸 (원래대로)', 'id, booth_id, congestion, wait_minutes, source, created_at',
        (select string_agg(att.attname::text, ', ' order by att.attnum) from pg_catalog.pg_attribute att
          where att.attrelid = 'public.booth_live_log'::regclass and att.attnum > 0 and not att.attisdropped)),
    (5, 'settings.booth_pin_enabled 칸 없음', '0',
        (select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'settings' and column_name = 'booth_pin_enabled')::text),
    (6, 'Vault 비밀 booth_pin_pepper 없음', '0',
        (select count(*) from vault.decrypted_secrets s where s.name = 'booth_pin_pepper')::text),
    (7, 'QR 운영자 함수 anon 실행 그대로', 'true',
        (has_function_privilege('anon', 'public.booth_ctrl_get(text)', 'EXECUTE')
         and has_function_privilege('anon', 'public.booth_ctrl_set(text,text,integer)', 'EXECUTE')
         and has_function_privilege('anon', 'public.booth_ctrl_touch(text)', 'EXECUTE'))::text)
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";
