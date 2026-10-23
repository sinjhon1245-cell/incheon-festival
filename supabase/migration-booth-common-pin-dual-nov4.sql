-- ===================================================================
-- 리허설 공통 PIN · 개별 PIN 병행 — 2026-11-04 23:00 KST 까지 실제 부스 84곳은 공통 PIN 과 개별 PIN 을 함께 씁니다
--
--   지금(migration-booth-rehearsal-pin.sql · 10-19): 그 부스에 개별 PIN 을 한 번이라도 발급하면 공통 PIN 이 닫히고,
--                                                  늦어도 11-05 23:00 에 끝납니다.
--   이 파일부터
--     · 리허설 대상 84곳은 개별 PIN 을 받아도 마감 전까지 공통 PIN 으로도 로그인합니다
--       (로그인은 지금처럼 개별 PIN 을 먼저 보고, 맞지 않을 때 공통 PIN 을 봅니다 — booth_pin_login 은 바꾸지 않음).
--     · 개별 PIN 을 끈 부스는 공통 PIN 도 막힙니다(비상 끄기는 끈 채로). 다시 발급하면 마감 전까지 둘 다 됩니다.
--     · 마감 = 2026-11-04 23:00 KST(행사 첫날이 앞당겨지면 그날 00:00 KST — 둘 중 이른 쪽). 예시 부스 공통 PIN 도 같은 마감.
--       마감부터 공통 PIN 새 로그인은 맞지 않는 PIN 과 같은 답이고, 열린 공통 PIN 화면은 다음 저장 · 확인에서 서버가
--       거절합니다(세션 확인이 쓸 때마다 대상 판정을 다시 봄). 개별 PIN · QR 은 그대로입니다.
--     · 발급 · 재발급은 지금처럼 그 부스의 PIN 세션(공통 PIN 세션 포함)을 끊습니다. 마감 전에는 다시 로그인할 수 있습니다.
--
--   이 파일이 바꾸는 것(셋 모두 private · API 에 나가지 않음 · anon · authenticated 실행 권한 없음)
--     private.rehearsal_common_pin_until()     11-05 23:00 → 11-04 23:00
--     private.rehearsal_common_pin_open(uuid)  ‘개별 PIN 이력 없음’ → ‘꺼진 개별 PIN 없음’
--     private.booth_common_pin_target(uuid)    예시 갈래에도 마감을 더함(리허설 갈래 조건 · 공개 조건은 그대로)
--   그대로인 것
--     PIN 로그인 · 공통 PIN 비교 · 세션 확인 · 발급 · 끄기 함수 · 표 · 칸 · 세션 · 보안 기록 · QR · 대기 값 · 23시 초기화 ·
--     횟수 제한 · 권한. PIN 을 만들거나 바꾸지 않습니다.
--
-- 사용법: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run. 여러 번 실행해도 같은 결과입니다.
--         맨 아래 확인 표의 '기대' 와 '실제' 가 모두 같아야 합니다(마감 전에 실행하는 것을 기준으로 함).
-- 되돌리기: supabase/rollback-booth-common-pin-dual-nov4.sql — 병행만 되돌림(개별 PIN 이력이 있는 부스는 공통 PIN 닫힘) ·
--           11-04 23:00 마감 · 예시 부스 마감은 그대로 둠.
-- 비상 정지(공통 PIN 을 지금 모두 멈춤): supabase/stop-booth-common-pin.sql. 이 파일 뒤에는 rollback-booth-rehearsal-pin.sql
--           을 비상 정지로 쓰지 마세요 — 대상 판정을 마감 조건이 없는 예시 부스 판으로 되돌립니다.
-- 확인(읽기 전용 · 몇 번이든): supabase/check-booth-pin-dual.sql. check-booth-pin-conversion.sql 은 예전 규칙으로 셉니다.
-- 순서: 이 파일 → 화면(Pages: print-qr · booth-admin · pin-status.js) 배포 → 그 뒤에 실제 부스 개별 PIN 발급.
-- 트랜잭션: BEGIN/COMMIT 을 넣지 않습니다. SQL Editor 와 apply_migration 은 이미 한 트랜잭션으로 돌립니다.
-- ===================================================================


-- ═══════════════════════════════════════════════════════════════
-- 0. 선행 조건 검사 (아무것도 바꾸지 않습니다)
--    지문 = 줄 끝 CR 을 뺀 pg_get_functiondef 의 md5. 바꿀 셋은 2026-10-19 Production 판 또는 이 파일의 판(다시 실행)이어야
--    하고, 대상 판정은 비상 정지 판(stop-booth-common-pin.sql)도 받습니다(다시 열기). 다르면 멈춥니다.
-- ═══════════════════════════════════════════════════════════════
do $preflight$
declare
  v_fp text;
begin
  if to_regprocedure('private.rehearsal_common_pin_until()') is null
     or to_regprocedure('private.rehearsal_common_pin_open(uuid)') is null
     or to_regprocedure('private.booth_common_pin_target(uuid)') is null
     or to_regprocedure('private.booth_common_pin_ok(uuid, text)') is null
     or to_regprocedure('private.booth_session_resolve(text, boolean)') is null
     or to_regprocedure('public.booth_pin_login(uuid, text, text)') is null
     or to_regprocedure('private.rehearsal_booth_ids()') is null
     or to_regprocedure('private.rehearsal_cutoff()') is null
     or to_regclass('public.booth_pin') is null
     or to_regclass('public.booth_session') is null then
    raise exception '선행 조건 누락: migration-booth-rehearsal.sql · migration-booth-rehearsal-pin.sql 을 먼저 적용하세요.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'booth_session' and column_name = 'via_common_pin') then
    raise exception '선행 조건 누락: 공통 PIN 세션 표시(booth_session.via_common_pin)가 없습니다.';
  end if;

  select string_agg(left(md5(replace(pg_catalog.pg_get_functiondef(f::regprocedure), E'\r', '')), 8), ' ' order by o)
    into v_fp
    from (values (1, 'public.booth_pin_login(uuid, text, text)'),
                 (2, 'private.booth_common_pin_ok(uuid, text)'),
                 (3, 'private.booth_session_resolve(text, boolean)')) as x(o, f);
  if v_fp <> 'd78e25b9 57684373 587f4d79' then
    raise exception 'PIN 로그인 · 공통 PIN 비교 · 세션 확인 함수가 예상한 판이 아닙니다(지문 %). 아무것도 바꾸지 않고 멈춥니다.', v_fp;
  end if;
  v_fp := md5(replace(pg_catalog.pg_get_functiondef('private.rehearsal_common_pin_until()'::regprocedure), E'\r', ''));
  if v_fp not in ('11cc0ed62d6dcf38c8aeffe01571a3f9', '28208263426f7ea306145c2615a31bb7') then
    raise exception 'private.rehearsal_common_pin_until 이 예상한 판이 아닙니다(지문 %). 아무것도 바꾸지 않고 멈춥니다.', left(v_fp, 8);
  end if;
  v_fp := md5(replace(pg_catalog.pg_get_functiondef('private.rehearsal_common_pin_open(uuid)'::regprocedure), E'\r', ''));
  if v_fp not in ('6b9d4ecaa58d90ffa8a09201d89c18d3', '847963bde4283e359aa9c3bd617be50e') then
    raise exception 'private.rehearsal_common_pin_open 이 예상한 판이 아닙니다(지문 %). 아무것도 바꾸지 않고 멈춥니다.', left(v_fp, 8);
  end if;
  v_fp := md5(replace(pg_catalog.pg_get_functiondef('private.booth_common_pin_target(uuid)'::regprocedure), E'\r', ''));
  if v_fp not in ('ecc7f328f814ff4ac029db5ce40904a4', 'de16c95824a5494b9da1083ffb1f2d53', 'cc30867e7545905b9f65b0d4d1ea70c9') then
    raise exception 'private.booth_common_pin_target 이 예상한 판이 아닙니다(지문 %). 아무것도 바꾸지 않고 멈춥니다.', left(v_fp, 8);
  end if;
  if (select cardinality(private.rehearsal_booth_ids())) <> 84 then
    raise exception '리허설 대상 목록이 84곳이 아닙니다. 아무것도 바꾸지 않고 멈춥니다.';
  end if;
end
$preflight$;


-- ═══════════════════════════════════════════════════════════════
-- 1. 끝나는 때 — 2026-11-04 23:00 KST, 행사 첫날이 앞당겨지면 그날 00:00 KST(둘 중 이른 쪽 · 늦출 수 없음)
-- ═══════════════════════════════════════════════════════════════
create or replace function private.rehearsal_common_pin_until()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select least(timestamptz '2026-11-04 23:00:00+09',
               (private.rehearsal_cutoff())::timestamp at time zone 'Asia/Seoul')
$$;


-- ═══════════════════════════════════════════════════════════════
-- 2. 리허설 갈래 — 84곳 · 끝나는 때 전 · 그 부스의 개별 PIN 이 꺼져 있지 않음(발급 · 재발급과는 무관)
-- ═══════════════════════════════════════════════════════════════
create or replace function private.rehearsal_common_pin_open(p_booth uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
           p_booth = any (private.rehearsal_booth_ids())
           and pg_catalog.now() < private.rehearsal_common_pin_until()
           and not exists (
             select 1 from public.booth_pin p
              where p.booth_id = p_booth and p.disabled_at is not null
           ),
           false)
$$;


-- ═══════════════════════════════════════════════════════════════
-- 3. 공통 PIN 대상 판정 — 예시 갈래 · 리허설 갈래 모두 끝나는 때 전에만. 로그인(booth_common_pin_ok)과 세션 확인
--    (booth_session_resolve)이 모두 이 함수를 부르므로, 새 로그인과 열린 공통 PIN 화면이 같은 판정을 받습니다.
-- ═══════════════════════════════════════════════════════════════
create or replace function private.booth_common_pin_target(p_booth uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
           pg_catalog.now() < private.rehearsal_common_pin_until()
           and (
             (coalesce((select s.booth_sample_common_pin_enabled from public.settings s order by s.id limit 1), false)
              and exists (
                select 1 from public.booths b join public.zones z on z.key = b.zone_key
                 where b.id = p_booth and b.is_published and z.is_published and b.no is not null
                   and b.org ~ '^\s*\[예시\]'
              ))
             or
             (private.rehearsal_common_pin_open(p_booth)
              and exists (
                select 1 from public.booths b join public.zones z on z.key = b.zone_key
                 where b.id = p_booth and b.is_published and z.is_published and b.no is not null
                   and coalesce(b.org, '') !~ '^\s*\[예시\]'
              ))
           ),
           false)
$$;

revoke all on function private.rehearsal_common_pin_until() from public, anon, authenticated;
revoke all on function private.rehearsal_common_pin_open(uuid) from public, anon, authenticated;
revoke all on function private.booth_common_pin_target(uuid) from public, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 4. 확인 (기대 = 실제) — 마감 전에 실행한 것을 기준으로 합니다. 4 · 5 · 7 의 기대는 표에서 직접 센 값입니다.
--    이 표의 어느 줄이라도 다르면 실제 부스 개별 PIN 을 발급하지 마세요.
-- ═══════════════════════════════════════════════════════════════
select v."순서", v."항목", v."기대", v."실제"
  from (values
    (1, '공통 PIN 끝나는 때(한국 시각)', '2026-11-04 23:00:00',
        to_char(private.rehearsal_common_pin_until() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS')),
    (2, '바뀐 셋(끝나는 때 · 리허설 갈래 · 대상 판정) 지문', '28208263 847963bd de16c958',
        (select string_agg(left(md5(replace(pg_catalog.pg_get_functiondef(f::regprocedure), E'\r', '')), 8), ' ' order by o)
           from (values (1, 'private.rehearsal_common_pin_until()'), (2, 'private.rehearsal_common_pin_open(uuid)'),
                        (3, 'private.booth_common_pin_target(uuid)')) as x(o, f))),
    (3, 'PIN 로그인 · 공통 PIN 비교 · 세션 확인 그대로(지문)', 'd78e25b9 57684373 587f4d79',
        (select string_agg(left(md5(replace(pg_catalog.pg_get_functiondef(f::regprocedure), E'\r', '')), 8), ' ' order by o)
           from (values (1, 'public.booth_pin_login(uuid, text, text)'), (2, 'private.booth_common_pin_ok(uuid, text)'),
                        (3, 'private.booth_session_resolve(text, boolean)')) as x(o, f))),
    (4, '지금 공통 PIN 대상인 리허설 부스(84곳 중 공개 · 번호 있음 · 개별 PIN 이 꺼지지 않은 곳)',
        (select count(*) from public.booths b join public.zones z on z.key = b.zone_key
          where b.id = any (private.rehearsal_booth_ids()) and b.is_published and z.is_published and b.no is not null
            and coalesce(b.org, '') !~ '^\s*\[예시\]'
            and not exists (select 1 from public.booth_pin p where p.booth_id = b.id and p.disabled_at is not null))::text,
        (select count(*) from unnest(private.rehearsal_booth_ids()) x where private.booth_common_pin_target(x))::text),
    (5, '개별 PIN 이 켜진 리허설 부스 중 공통 PIN 대상(병행 — 같아야 함)',
        (select count(*) from public.booth_pin p join public.booths b on b.id = p.booth_id join public.zones z on z.key = b.zone_key
          where p.booth_id = any (private.rehearsal_booth_ids()) and p.disabled_at is null
            and b.is_published and z.is_published and b.no is not null and coalesce(b.org, '') !~ '^\s*\[예시\]')::text,
        (select count(*) from public.booth_pin p
          where p.booth_id = any (private.rehearsal_booth_ids()) and p.disabled_at is null and private.booth_common_pin_target(p.booth_id))::text),
    (6, '개별 PIN 이 꺼진 리허설 부스 중 공통 PIN 대상', '0',
        (select count(*) from public.booth_pin p
          where p.booth_id = any (private.rehearsal_booth_ids()) and p.disabled_at is not null and private.booth_common_pin_target(p.booth_id))::text),
    (7, '예시 부스 공통 PIN 대상(스위치 · 공개 · 번호 — 표에서 센 값과 같아야 함)',
        (select count(*) from public.booths b join public.zones z on z.key = b.zone_key
          where coalesce((select s.booth_sample_common_pin_enabled from public.settings s order by s.id limit 1), false)
            and b.is_published and z.is_published and b.no is not null and b.org ~ '^\s*\[예시\]')::text,
        (select count(*) from public.booths b where b.org ~ '^\s*\[예시\]' and private.booth_common_pin_target(b.id))::text),
    (8, '84곳 밖 실제 부스 · 없는 부스 · null 이 공통 PIN 대상', '0',
        ((select count(*) from public.booths b
           where not (b.id = any (private.rehearsal_booth_ids())) and coalesce(b.org, '') !~ '^\s*\[예시\]'
             and private.booth_common_pin_target(b.id))
         + (private.booth_common_pin_target(null))::int
         + (private.booth_common_pin_target('00000000-0000-0000-0000-000000000000'))::int)::text),
    (9, '바뀐 셋 — anon · authenticated 실행', 'false',
        (has_function_privilege('anon', 'private.rehearsal_common_pin_until()', 'EXECUTE')
         or has_function_privilege('authenticated', 'private.rehearsal_common_pin_until()', 'EXECUTE')
         or has_function_privilege('anon', 'private.rehearsal_common_pin_open(uuid)', 'EXECUTE')
         or has_function_privilege('authenticated', 'private.rehearsal_common_pin_open(uuid)', 'EXECUTE')
         or has_function_privilege('anon', 'private.booth_common_pin_target(uuid)', 'EXECUTE')
         or has_function_privilege('authenticated', 'private.booth_common_pin_target(uuid)', 'EXECUTE'))::text),
    (10, 'private 스키마 사용(anon · authenticated)', 'false',
        (has_schema_privilege('anon', 'private', 'USAGE') or has_schema_privilege('authenticated', 'private', 'USAGE'))::text)
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";
