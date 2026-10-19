-- ===================================================================
-- 매일 23:00(한국 시각) 리허설 대기시간 자동 초기화 — 예약 등록 (pg_cron)
--
--   먼저 supabase/migration-booth-rehearsal.sql 이 적용돼 있어야 합니다(private.rehearsal_live_reset).
--   ⚠️ 이 파일을 실행하는 순간부터 매일 23:00 에 실제 부스 84곳의 지금 대기 값이 지워집니다(따로 승인 뒤 실행).
--
--   하는 일
--     1. pg_cron 켜기(Supabase 'Cron' 모듈과 같음 — 이미 켜져 있으면 그대로)
--     2. 예약 'booth-rehearsal-reset' 하나 등록: 매일 14:00 UTC = 23:00 KST(한국은 서머타임 없음)
--          할 일: select private.rehearsal_live_reset();   — 84곳의 booth_live 만 지움(기록 · QR · PIN · 예시 그대로)
--        · pg_cron 의 시각 기준(cron.timezone)이 UTC(GMT)가 아니면 등록하지 않고 멈춥니다.
--        · 같은 이름의 예약이 있으면 새로 만들지 않고 그 예약을 고쳐 씁니다(pg_cron 의 이름 규칙) → 늘 하나.
--        · 이름은 다르지만 같은 함수를 부르는 예약이 있으면 멈춥니다(두 번 돌지 않게).
--     3. 확인 표: 예약 하나 · 14:00 UTC · 켜짐 · 다음 실행(한국 시각)
--
--   관람객 · 관리자 · 운영자 화면, 표 · 함수는 바꾸지 않습니다. 관리 화면 '리허설 관리' 의 '자동 초기화' 줄이
--   '매일 23:00 · 켜짐' 으로 바뀌고, 첫 실행 뒤에는 마지막 실행 시각 · 결과(성공 · 실패)가 보입니다.
--
--   실행 기록 보기(SQL Editor, 읽기만):
--     select d.start_time at time zone 'Asia/Seoul' as kst, d.status, d.return_message
--       from cron.job_run_details d join cron.job j on j.jobid = d.jobid
--      where j.jobname = 'booth-rehearsal-reset' order by d.start_time desc limit 10;
--   끄기(멈춤): select cron.alter_job((select jobid from cron.job where jobname = 'booth-rehearsal-reset'), active := false);
--   지우기: supabase/rollback-booth-rehearsal.sql 의 1번(예약만) — 함수까지 지우려면 그 파일 전체
--
-- 사용법: SQL Editor → 전체 붙여넣고 Run. 여러 번 실행해도 예약은 하나입니다.
-- ===================================================================

-- 1. pg_cron (Supabase 문서 'Cron → Install' 과 같은 SQL)
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- 2. 확인 뒤 등록
do $schedule$
declare
  v_tz    text := coalesce(nullif(current_setting('cron.timezone', true), ''), 'GMT');
  v_other integer;
begin
  if to_regprocedure('private.rehearsal_live_reset()') is null then
    raise exception '먼저 supabase/migration-booth-rehearsal.sql 을 적용해 주세요(private.rehearsal_live_reset 없음).';
  end if;
  if upper(v_tz) not in ('GMT', 'UTC', 'ETC/UTC', 'ETC/GMT', 'Z') then
    raise exception 'pg_cron 시각 기준(cron.timezone)이 % 입니다. UTC 14:00 이 한국 23:00 이 아니라 등록하지 않습니다.', v_tz;
  end if;
  select count(*) into v_other
    from cron.job j
   where j.command ilike '%rehearsal_live_reset%' and j.jobname is distinct from 'booth-rehearsal-reset';
  if v_other > 0 then
    raise exception '같은 초기화를 부르는 다른 이름의 예약이 %개 있습니다. 먼저 정리해 주세요(cron.job).', v_other;
  end if;
  perform cron.schedule('booth-rehearsal-reset', '0 14 * * *', 'select private.rehearsal_live_reset();');
end
$schedule$;

-- 3. 확인 (기대 = 실제)
select v."순서", v."항목", v."기대", v."실제"
  from (values
    (1, '예약 수(이 이름)', '1', (select count(*) from cron.job where jobname = 'booth-rehearsal-reset')::text),
    (2, '같은 초기화를 부르는 예약 수(모든 이름)', '1',
        (select count(*) from cron.job where command ilike '%rehearsal_live_reset%')::text),
    (3, '일정(UTC)', '0 14 * * *', (select schedule from cron.job where jobname = 'booth-rehearsal-reset')),
    (4, '켜짐', 'true', (select active from cron.job where jobname = 'booth-rehearsal-reset')::text),
    (5, 'pg_cron 시각 기준', 'GMT', coalesce(nullif(current_setting('cron.timezone', true), ''), 'GMT')),
    (6, '다음 실행(한국 시각)', '오늘 또는 내일 23:00',
        to_char(case when (now() at time zone 'Asia/Seoul')::time < time '23:00'
                     then date_trunc('day', now() at time zone 'Asia/Seoul') + interval '23 hours'
                     else date_trunc('day', now() at time zone 'Asia/Seoul') + interval '1 day 23 hours' end,
                'YYYY-MM-DD HH24:MI') || ' KST')
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";
