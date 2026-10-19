-- ===================================================================
-- 되돌리기 — 리허설 대기시간 함수 · 23:00 자동 초기화 예약
--   (migration-booth-rehearsal.sql · schedule-booth-rehearsal-reset.sql 을 걷어냅니다)
--
--   1. 예약 'booth-rehearsal-reset' 이 있으면 지웁니다(pg_cron 자체 · 다른 예약은 그대로).
--   2. 함수 여섯 개를 지웁니다. 관리 화면의 '리허설 관리' 는 'DB 준비 전' 으로 바뀌고 단추가 잠깁니다.
--
--   바뀌지 않는 것: 지금 대기 값(booth_live) · 대기 기록 · QR · PIN · 부스 · 구역 · 기존 함수.
--   리허설로 넣은 값을 지우려면 이 파일을 실행하기 전에 관리 화면의 '리허설 대기시간 비우기' 를 씁니다.
--
--   예약만 멈추려면 1번 블록만 실행합니다.
-- 사용법: SQL Editor → 전체 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- ===================================================================

-- 1. 예약 지우기(있을 때만)
do $unschedule$
begin
  if to_regclass('cron.job') is not null then
    if exists (select 1 from cron.job where jobname = 'booth-rehearsal-reset') then
      perform cron.unschedule('booth-rehearsal-reset');
    end if;
  end if;
end
$unschedule$;

-- 2. 함수 지우기
drop function if exists public.admin_rehearsal_set_live(uuid, text, integer);
drop function if exists public.admin_rehearsal_status();
drop function if exists private.rehearsal_live_reset();
drop function if exists private.rehearsal_closed();
drop function if exists private.rehearsal_cutoff();
drop function if exists private.rehearsal_booth_ids();

-- 3. 확인
select (to_regprocedure('public.admin_rehearsal_set_live(uuid, text, integer)') is null
        and to_regprocedure('public.admin_rehearsal_status()') is null
        and to_regprocedure('private.rehearsal_live_reset()') is null
        and to_regprocedure('private.rehearsal_booth_ids()') is null) as "함수 모두 지워짐";
