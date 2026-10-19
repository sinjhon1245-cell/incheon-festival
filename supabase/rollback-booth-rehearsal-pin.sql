-- ===================================================================
-- 되돌리기 — 리허설 공통 PIN (migration-booth-rehearsal-pin.sql)
--
--   리허설 공통 PIN 을 11-05 23:00 전에 당장 끝내는 길이기도 합니다(비상 정지).
--   1. 공통 PIN 대상 판정을 migration-booth-example-pin.sql 3-1 의 글자 그대로 되돌립니다(예시 부스 조건만).
--   2. 이 파일이 더한 함수 둘을 지웁니다.
--
--   되돌린 순간
--     · 실제 부스 84곳은 공통 PIN 으로 새로 로그인할 수 없습니다(맞지 않는 PIN 과 같음 · 횟수 제한 그대로).
--     · 이미 열린 실제 부스의 공통 PIN 화면은 다음 저장 · 확인 · 다시 읽기에서 서버가 거절합니다
--       (세션 확인이 쓸 때마다 대상 판정을 다시 봄 — 세션 줄 · 기록을 따로 고치지 않습니다).
--   바뀌지 않는 것: 예시 부스 공통 PIN(스위치 · 조건) · 개별 PIN · QR · 세션 · 보안 기록 · 대기 값 · 대기 기록 ·
--     부스 · 구역 · 설정 · 리허설 대기 함수 · 23시 예약.
--
-- 사용법: SQL Editor → 전체 붙여넣고 Run(한 트랜잭션). 여러 번 실행해도 같은 결과입니다.
-- ===================================================================

-- 1. 대상 판정 — 예시 부스 판(migration-booth-example-pin.sql 3-1 과 같은 글자)
create or replace function private.booth_common_pin_target(p_booth uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select s.booth_sample_common_pin_enabled from public.settings s order by s.id limit 1), false)
     and exists (
       select 1 from public.booths b join public.zones z on z.key = b.zone_key
        where b.id = p_booth and b.is_published and z.is_published and b.no is not null
          and b.org ~ '^\s*\[예시\]'
     )
$$;
revoke all on function private.booth_common_pin_target(uuid)     from public;
revoke all on function private.booth_common_pin_target(uuid)     from anon, authenticated;

-- 2. 더한 함수 지우기
drop function if exists private.rehearsal_common_pin_open(uuid);
drop function if exists private.rehearsal_common_pin_until();

-- 3. 확인 (기대 = 실제)
select v."순서", v."항목", v."기대", v."실제"
  from (values
    (1, '대상 판정 = 예시 부스 판(지문)', '8a6c426d',
        left(md5(replace(pg_catalog.pg_get_functiondef('private.booth_common_pin_target(uuid)'::regprocedure), E'\r', '')), 8)),
    (2, '리허설 공통 PIN 함수 남음', '0',
        (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'private' and p.proname in ('rehearsal_common_pin_open', 'rehearsal_common_pin_until'))::text),
    (3, '공통 PIN 대상인 실제 부스(예시 아님)', '0',
        (select count(*) from public.booths b
          where coalesce(b.org, '') !~ '^\s*\[예시\]' and private.booth_common_pin_target(b.id))::text),
    (4, 'PIN 로그인 · 공통 PIN 비교 · 세션 확인 함수 그대로(지문)', 'd78e25b9 57684373 587f4d79',
        (select string_agg(left(md5(replace(pg_catalog.pg_get_functiondef(f::regprocedure), E'\r', '')), 8), ' ' order by o)
           from (values (1, 'public.booth_pin_login(uuid, text, text)'),
                        (2, 'private.booth_common_pin_ok(uuid, text)'),
                        (3, 'private.booth_session_resolve(text, boolean)')) as x(o, f)))
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";
