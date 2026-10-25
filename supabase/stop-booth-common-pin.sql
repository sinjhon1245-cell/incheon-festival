-- ===================================================================
-- 비상 정지 — 공통 PIN(리허설 실제 부스 · 예시 부스)을 지금 바로 모두 멈춥니다
--
--   migration-booth-common-pin-dual-nov4.sql(공통 PIN · 개별 PIN 병행)을 적용한 뒤에 쓰는 정지 길입니다.
--   그 뒤에는 rollback-booth-rehearsal-pin.sql 을 비상 정지로 쓰지 마세요 — 그 파일은 대상 판정을 마감 조건이 없는
--   예시 부스 판으로 되돌려, 예시 공통 PIN 스위치를 켜면 11-04 23:00 뒤에도 예시 부스 공통 PIN 이 열립니다.
--
--   바꾸는 것: private.booth_common_pin_target(uuid) 하나 — 늘 거짓
--   그 순간
--     · 공통 PIN 새 로그인은 맞지 않는 PIN 과 같은 답입니다(횟수 제한 · 보안 기록 pin_fail 그대로).
--     · 열려 있던 공통 PIN 화면은 다음 저장 · 확인 · 다시 읽기에서 서버가 거절합니다(42501 booth_session_revoked).
--   그대로인 것: 개별 PIN · QR · 세션 줄 · 보안 기록 · 설정 · 대기 값 · 끝나는 때 · 리허설 갈래 함수 · 로그인 · 세션 확인 함수
--   다시 열기(마감 전에만 뜻이 있음): migration-booth-common-pin-dual-nov4.sql 을 다시 실행(그 파일의 선행 검사가 이 판을 받아들임)
--   예시 부스 공통 PIN 만 멈출 때는 이 파일 대신 관리자 → 기본 정보의 ‘운영 준비용 예시 부스 공통 PIN’ 을 끕니다.
--
-- 사용법: SQL Editor → 전체 붙여넣고 Run. 여러 번 실행해도 같은 결과입니다. 확인 표 기대 = 실제.
-- 트랜잭션: BEGIN/COMMIT 을 넣지 않습니다(SQL Editor 는 한 트랜잭션).
-- ===================================================================

do $preflight$
begin
  if to_regprocedure('private.booth_common_pin_target(uuid)') is null then
    raise exception '공통 PIN 대상 판정 함수가 없습니다(공통 PIN 이 이미 없음). 아무것도 바꾸지 않고 멈춥니다.';
  end if;
end
$preflight$;

create or replace function private.booth_common_pin_target(p_booth uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select false
$$;

revoke all on function private.booth_common_pin_target(uuid) from public, anon, authenticated;

select v."순서", v."항목", v."기대", v."실제"
  from (values
    (1, '대상 판정 = 비상 정지 판(지문)', 'cc30867e',
        left(md5(replace(pg_catalog.pg_get_functiondef('private.booth_common_pin_target(uuid)'::regprocedure), E'\r', '')), 8)),
    (2, '공통 PIN 대상 부스(실제 · 예시 모두)', '0',
        (select count(*) from public.booths b where private.booth_common_pin_target(b.id))::text),
    (3, 'PIN 로그인 · 공통 PIN 비교 · 세션 확인 함수 그대로(지문)', 'd78e25b9 57684373 587f4d79',
        (select string_agg(left(md5(replace(pg_catalog.pg_get_functiondef(f::regprocedure), E'\r', '')), 8), ' ' order by o)
           from (values (1, 'public.booth_pin_login(uuid, text, text)'),
                        (2, 'private.booth_common_pin_ok(uuid, text)'),
                        (3, 'private.booth_session_resolve(text, boolean)')) as x(o, f))),
    (4, '대상 판정 — anon · authenticated 실행', 'false',
        (has_function_privilege('anon', 'private.booth_common_pin_target(uuid)', 'EXECUTE')
         or has_function_privilege('authenticated', 'private.booth_common_pin_target(uuid)', 'EXECUTE'))::text)
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";
