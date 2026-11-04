-- 운영중 일괄 입력 105곳 지원 되돌리기: 기존 84곳 관리자 일괄 입력으로 복구.
-- 반드시 운영 페이지 JS를 이전 버전으로 먼저 복구하세요. 기존 23:00 초기화/QR/PIN/상태는 건드리지 않습니다.
begin;
set local lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.admin_rehearsal_status()
 RETURNS TABLE(target_ids uuid[], closed boolean, cutoff date, kst_today date, reset_state text, reset_schedule text, last_run_at timestamp with time zone, last_status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_state  text := 'none';
  v_job    bigint;
  v_sched  text;
  v_active boolean;
  v_at     timestamptz;
  v_st     text;
begin
  if not public.is_admin() then
    raise exception '관리자만 볼 수 있습니다.' using errcode = '42501';
  end if;
  -- pg_cron 이 아직 없을 수 있어 표 이름을 글로 적어 둡니다(없어도 이 함수는 만들어지고 'none' 을 돌려줌).
  if pg_catalog.to_regclass('cron.job') is not null then
    begin
      execute 'select j.jobid, j.schedule, j.active from cron.job j where j.jobname = $1 order by j.jobid limit 1'
        into v_job, v_sched, v_active using 'booth-rehearsal-reset';
      if v_job is null then
        v_state := 'off';
      else
        v_state := case when v_active then 'on' else 'paused' end;
        execute 'select d.start_time, d.status from cron.job_run_details d where d.jobid = $1 order by d.start_time desc nulls last limit 1'
          into v_at, v_st using v_job;
      end if;
    exception when others then
      v_state := 'unknown';
    end;
  end if;
  return query select private.rehearsal_booth_ids(), private.rehearsal_closed(), private.rehearsal_cutoff(),
                      (pg_catalog.now() at time zone 'Asia/Seoul')::date, v_state, v_sched, v_at, v_st;
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_rehearsal_set_live(p_booth_id uuid, p_mode text, p_wait_minutes integer)
 RETURNS TABLE(booth_id uuid, congestion text, wait_minutes integer, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception '관리자만 쓸 수 있습니다.' using errcode = '42501';
  end if;
  if p_booth_id is null or not (p_booth_id = any (private.rehearsal_booth_ids())) then
    raise exception '리허설 대상(실제 부스 84곳)이 아닌 부스입니다.' using errcode = '22023';
  end if;
  if private.rehearsal_closed() then
    raise exception '행사가 시작되어 리허설 대기시간을 넣거나 지울 수 없습니다.'
      using errcode = 'P0001', hint = 'rehearsal_closed';
  end if;
  return query select * from public.admin_set_booth_live(p_booth_id, p_mode, p_wait_minutes);
end;
$function$;
drop function if exists private.rehearsal_bulk_target_ids();
commit;
