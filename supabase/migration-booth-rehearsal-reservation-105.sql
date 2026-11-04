-- 관리자 행사 전 리허설: 기존 105곳 대상에 현장예약 예시를 포함
-- 2026-11-04: user confirmation. 11-05까지 유효, 11-06 서버에서 종료.
-- 예약 운영방식 3곳도 포함해 admin_rehearsal_set_live(...,'resv_open',null) 호출 가능.
-- 일반 대기 102곳은 'open'/중단/마감, 예약 방식은 'resv_open'으로 저장.
-- 모드 호환은 기존 private.booth_mode_check에서 강제. mode·QR·PIN·로그·23시 예약을 변경하지 않습니다.
-- 이 SQL은 함수를 수정할 뿐 실제 대기값 채우기/비우기는 절대로 실행하지 않습니다.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $guard$
declare
 v_hash text;
begin
 select md5(replace(prosrc,chr(13),'')) into v_hash
   from pg_proc where oid='public.admin_rehearsal_set_live(uuid,text,integer)'::regprocedure;
 if v_hash <> '7bdf55d0bc603fe32dba3a3131c3964a' then
   raise exception 'admin_rehearsal_set_live 함수가 변경되어 중단합니다: %',v_hash;
 end if;
 if cardinality(private.rehearsal_bulk_target_ids()) <> 105
    or cardinality(private.rehearsal_booth_ids()) <> 84
    or private.rehearsal_cutoff() <> date '2026-11-06' then
   raise exception '행사 일괄 입력 대상/날짜 검증 실패';
 end if;
 if (select count(*) from public.booths b join public.zones z on z.key=b.zone_key
     where b.is_published and z.is_published) <> 105 then
   raise exception '현재 공개 부스 수가 105가 아닙니다';
 end if;
end
$guard$;
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
  -- 예약 운영 방식도 행사 전 일괄 입력 대상입니다.
  -- admin_set_booth_live는 운영 방식과 예시 상태의 일치를 별도로 검증합니다.
  if private.rehearsal_closed() then
    raise exception '행사가 시작되어 리허설 대기시간을 넣거나 지울 수 없습니다.'
      using errcode = 'P0001', hint = 'rehearsal_closed';
  end if;
  return query select * from public.admin_set_booth_live(p_booth_id, p_mode, p_wait_minutes);
end;
$function$;
do $verify$
begin
 if has_function_privilege('anon','public.admin_rehearsal_set_live(uuid,text,integer)','EXECUTE') then
   raise exception 'anon 실행 권한이 열려 있습니다';
 end if;
 if not has_function_privilege('authenticated','public.admin_rehearsal_set_live(uuid,text,integer)','EXECUTE') then
   raise exception '인증된 관리자 실행 경로가 사라졌습니다';
 end if;
 if cardinality(private.rehearsal_bulk_target_ids()) <> 105 then
   raise exception '일괄 입력 대상 105곳 조건 실패';
 end if;
end
$verify$;
commit;
