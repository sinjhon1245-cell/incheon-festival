-- 105곳 리허설 중 현장예약 예시 지원 되돌리기 (이전 PR #69 함수로 복구)
-- DB 변경 사항: 함수 1개만 복원, 대기값/방식/QR/PIN/23시 예약 비변경.
begin;
set local lock_timeout = '5s';
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
$function$;
commit;
