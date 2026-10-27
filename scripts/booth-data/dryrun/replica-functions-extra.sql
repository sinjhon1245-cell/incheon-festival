-- 로컬 복제 DB 보충 — Production 함수 셋을 그대로 옮긴 것(2026-10-16 · pg_get_functiondef · 읽기 전용으로 가져옴)
--   booth_ctrl_touch       운영자 '변동 없음 · 지금 확인'(그날 값이 있을 때만 · 기록 source 'touch')
--   admin_set_booth_live   관리자 '대기 값 직접 고치기'(open · pause · closed · clear)
--   admin_reset_booth_live 관리자 '실시간 값 모두 지우기'(모든 부스의 지금 값만)
-- 권한도 Production 과 같게: touch 는 anon · authenticated, 나머지 둘은 authenticated 만.

CREATE OR REPLACE FUNCTION public.booth_ctrl_touch(p_token text)
 RETURNS TABLE(booth_id uuid, code text, zone_key text, zone_label text, name text, org text, congestion text, wait_minutes integer, updated_at timestamp with time zone, issued_at timestamp with time zone, token_tail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_booth      uuid;
  v_congestion text;
  v_wait       integer;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{24}$' then
    raise exception '이 QR은 쓸 수 없습니다.' using errcode = '42501', hint = 'booth_token_invalid';
  end if;
  select a.booth_id into v_booth
    from public.booth_access a
    join public.booths b on b.id = a.booth_id
    join public.zones  z on z.key = b.zone_key
   where a.token = p_token
     and a.disabled_at is null
     and b.is_published
     and z.is_published
     and b.no is not null;
  if v_booth is null then
    raise exception '이 QR은 쓸 수 없습니다.' using errcode = '42501', hint = 'booth_token_invalid';
  end if;
  update public.booth_live as l
     set updated_at = pg_catalog.now()
   where l.booth_id = v_booth
     and (l.updated_at at time zone 'Asia/Seoul')::date
       = (pg_catalog.now() at time zone 'Asia/Seoul')::date
  returning l.congestion, l.wait_minutes into v_congestion, v_wait;
  if not found then
    raise exception '아직 입력한 값이 없습니다. 먼저 대기 시간을 눌러 주세요.' using errcode = '22023';
  end if;
  insert into public.booth_live_log as g (booth_id, congestion, wait_minutes, source)
  values (v_booth, v_congestion, v_wait, 'touch');
  return query select * from public.booth_ctrl_get(p_token);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_set_booth_live(p_booth_id uuid, p_mode text, p_wait_minutes integer)
 RETURNS TABLE(booth_id uuid, congestion text, wait_minutes integer, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_congestion text;
  v_wait       integer;
  v_at         timestamptz;
begin
  if not public.is_admin() then
    raise exception '관리자만 직접 고칠 수 있습니다.' using errcode = '42501';
  end if;
  if p_booth_id is null or not exists (select 1 from public.booths b where b.id = p_booth_id) then
    raise exception '해당 부스를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if p_mode is null or p_mode not in ('open', 'pause', 'closed', 'clear') then
    raise exception '허용되지 않는 상태입니다.' using errcode = '22023';
  end if;
  if p_mode = 'clear' then
    delete from public.booth_live as l where l.booth_id = p_booth_id;
    return query select p_booth_id, null::text, null::integer, null::timestamptz;
    return;
  end if;
  if p_mode = 'open' then
    if p_wait_minutes is null or p_wait_minutes not between 0 and 180 then
      raise exception '대기 시간은 0~180분이어야 합니다.' using errcode = '22023';
    end if;
    v_wait := p_wait_minutes;
    v_congestion := case when p_wait_minutes <= 10 then '여유'
                         when p_wait_minutes <= 25 then '보통'
                         else '혼잡' end;
  elsif p_mode = 'pause' then
    v_congestion := '중단';
    v_wait := 0;
  else
    v_congestion := '마감';
    v_wait := 0;
  end if;
  insert into public.booth_live as l (booth_id, congestion, wait_minutes, updated_at)
  values (p_booth_id, v_congestion, v_wait, pg_catalog.now())
  on conflict on constraint booth_live_pkey do update
     set congestion   = excluded.congestion,
         wait_minutes = excluded.wait_minutes,
         updated_at   = excluded.updated_at
  returning l.updated_at into v_at;
  insert into public.booth_live_log as g (booth_id, congestion, wait_minutes, source)
  values (p_booth_id, v_congestion, v_wait, 'admin');
  return query select p_booth_id, v_congestion, v_wait, v_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_reset_booth_live()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  n integer;
begin
  if not public.is_admin() then
    raise exception '관리자만 지울 수 있습니다.' using errcode = '42501';
  end if;
  delete from public.booth_live as l where true;
  get diagnostics n = row_count;
  return n;
end;
$function$
;

revoke all on function public.booth_ctrl_touch(text) from public;
revoke all on function public.admin_set_booth_live(uuid, text, integer) from public;
revoke all on function public.admin_reset_booth_live() from public;
grant execute on function public.booth_ctrl_touch(text) to anon, authenticated;
grant execute on function public.admin_set_booth_live(uuid, text, integer) to authenticated;
grant execute on function public.admin_reset_booth_live() to authenticated;
