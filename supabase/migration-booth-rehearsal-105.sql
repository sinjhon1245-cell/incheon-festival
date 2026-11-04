-- 2026-11-04: 관리자 부스 운영 현황의 행사 전 일괄 입력 대상을 84 -> 105곳으로 확장.
-- 운영자 권한과 행사 시작(11월 6일) 차단 유지. 현장예약(현재 3곳)은 제외.
-- 23:00 초기화 함수, 84곳 공통 PIN UUID 목록, QR/PIN/기록/상태 테이블은 변경하지 않습니다.
-- 실행 SQL은 함수 3개(신규 private 1, 기존 public 2)를 생성/변경할 뿐 실제 채우기·비우기를 실행하지 않습니다.
-- 변경 전: supabase/check-booth-105.sql을 참고하여 운영 데이터 확인.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $guard$
declare
 v_status text; v_set text; v_school int; v_live int; v_new int;
begin
 select md5(replace(prosrc,chr(13),'')) into v_status
   from pg_proc where oid='public.admin_rehearsal_status()'::regprocedure;
 select md5(replace(prosrc,chr(13),'')) into v_set
   from pg_proc where oid='public.admin_rehearsal_set_live(uuid,text,integer)'::regprocedure;
 if v_status <> '67aae509084e8e8d3e75b9e5734a8b91'
    or v_set <> 'c6585d9df0c8ee642df4524eb32ddf7c' then
   raise exception '리허설 함수의 기존 지문 불일치 (status %, set %). 중단.',v_status,v_set;
 end if;
 if to_regprocedure('private.rehearsal_bulk_target_ids()') is not null then
   raise exception '105곳 대상 함수가 이미 있습니다. 중복 실행을 멈춥니다.';
 end if;
 select cardinality(private.rehearsal_booth_ids()) into v_school;
 select count(*) into v_new from public.booths b join public.zones z on z.key=b.zone_key
   where b.is_published and z.is_published and b.no is not null and b.zone_key in ('체험','미래');
 select count(*) into v_live from public.booths b join public.zones z on z.key=b.zone_key
   where b.is_published and z.is_published and b.no is not null and
     (b.id = any(private.rehearsal_booth_ids()) or b.zone_key in ('체험','미래'));
 if v_school<>84 or v_new<>21 or v_live<>105 or private.rehearsal_cutoff()<>date '2026-11-06' then
   raise exception '부스/기간 검증 실패(학교 %, 신규 %, 전체 %). 중단.',v_school,v_new,v_live;
 end if;
end
$guard$;

create or replace function private.rehearsal_bulk_target_ids()
 returns uuid[]
 language sql
 stable
 set search_path to ''
as $function$
  -- 학교 84곳의 고정 UUID 목록은 그대로 둡니다. 공통 PIN/기존 초기화 대상은 변경하지 않습니다.
  -- 새 체험/미래 부스는 실제 공개된 구역·번호가 있는 경우에만 일괄 입력 대상에 더합니다.
  select coalesce(array_agg(b.id order by b.id), array[]::uuid[])
    from public.booths b
    join public.zones z on z.key = b.zone_key
   where b.is_published and z.is_published and b.no is not null
     and (b.id = any(private.rehearsal_booth_ids()) or b.zone_key in ('체험','미래'));
$function$;
revoke all on function private.rehearsal_bulk_target_ids() from public, anon, authenticated;

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
  return query select private.rehearsal_bulk_target_ids(), private.rehearsal_closed(), private.rehearsal_cutoff(),
                      (pg_catalog.now() at time zone 'Asia/Seoul')::date, v_state, v_sched, v_at, v_st;
end;
$function$

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
  if p_booth_id is null or not (p_booth_id = any (private.rehearsal_bulk_target_ids())) then
    raise exception '리허설 대상(공개 부스 105곳)이 아닌 부스입니다.' using errcode = '22023';
  end if;
  -- 현장예약 부스의 상태는 일괄 채우기/비우기로 변경하지 않습니다.
  if exists (select 1 from public.booth_live_mode m where m.booth_id = p_booth_id and m.mode = 'reserve') then
    raise exception '현장예약 부스는 일괄 입력에서 제외됩니다.' using errcode = '22023';
  end if;
  if private.rehearsal_closed() then
    raise exception '행사가 시작되어 리허설 대기시간을 넣거나 지울 수 없습니다.'
      using errcode = 'P0001', hint = 'rehearsal_closed';
  end if;
  return query select * from public.admin_set_booth_live(p_booth_id, p_mode, p_wait_minutes);
end;
$function$

do $verify$
declare n integer;
begin
 select cardinality(private.rehearsal_bulk_target_ids()) into n;
 if n<>105 or cardinality(private.rehearsal_booth_ids())<>84 then
   raise exception '등록 대상 검증 실패: %, 학교 고정 %',n,cardinality(private.rehearsal_booth_ids());
 end if;
 if (select count(*) from public.booths b join public.booth_live_mode m on m.booth_id=b.id
     where b.id=any(private.rehearsal_bulk_target_ids()) and m.mode='reserve')<>3 then
   raise exception '현장예약 대상 수 변동: 실제 운영 상태를 다시 확인하세요.';
 end if;
end
$verify$;
commit;
-- 실행 전/후 public.booth_live, PIN, QR, 이력 자료는 수정하지 않습니다.
