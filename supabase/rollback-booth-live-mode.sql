-- ===================================================================
-- 되돌리기: 부스 운영 방식(supabase/migration-booth-live-mode.sql)
--
--   하는 일(한 트랜잭션)
--     1. 스위치를 끕니다(혹시 켜져 있었다면).
--     2. booth_live 의 현장예약 상태('예약중' · '예약마감') 줄을 지웁니다 — 옛 CHECK 에 맞지 않아서.
--        그 부스는 관람객 화면에서 '정보 없음', 운영자는 대기 시간을 다시 누르면 됩니다. 다른 부스의 값은 그대로.
--     3. 쓰기 다섯 함수를 2026-11-03 Production 정의 그대로 되돌립니다(끝에서 md5 로 확인).
--     4. 새 함수 · 정책 · 표를 지웁니다. 부스별 운영 방식은 private.booth_live_mode_backup 에 복사해 둡니다.
--     5. booth_live CHECK 를 원래 다섯 값으로 되돌립니다.
--   바꾸지 않는 것: booths · zones · QR · PIN · 세션 · 23:00 예약 · 다른 부스의 booth_live 값 · booth_live_log.
--   사용법: SQL Editor → 전체 붙여넣고 Run. 이미 되돌렸으면 STOP 으로 멈춥니다.
-- ===================================================================

begin;
set local lock_timeout = '5s';

do $pre$
begin
  if pg_catalog.to_regclass('public.booth_live_mode') is null then
    raise exception 'STOP: 운영 방식 표가 없습니다(적용 전이거나 이미 되돌림).';
  end if;
  if pg_catalog.to_regclass('private.booth_live_mode_backup') is not null then
    raise exception 'STOP: private.booth_live_mode_backup 이 이미 있습니다. 확인 뒤 이름을 바꾸고 다시 실행하세요.';
  end if;
end;
$pre$;

-- 1 · 2
update public.booth_live_mode_config set enabled = false, updated_at = pg_catalog.now() where id = 1;
delete from public.booth_live as l where l.congestion in ('예약중', '예약마감');

-- 3. 2026-11-03 Production 정의 ----------------------------------------
CREATE OR REPLACE FUNCTION private.booth_op_set(p_booth uuid, p_mode text, p_wait integer, p_session uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_congestion text;
  v_wait       integer;
begin
  if p_mode is null or p_mode not in ('open', 'pause', 'closed') then
    raise exception '허용되지 않는 상태입니다.' using errcode = '22023';
  end if;
  if p_mode = 'open' then
    if p_wait is null or p_wait not between 0 and 180 then
      raise exception '대기 시간은 0~180분이어야 합니다.' using errcode = '22023';
    end if;
    v_wait := p_wait;
    v_congestion := case when p_wait <= 10 then '여유'
                         when p_wait <= 25 then '보통'
                         else '혼잡' end;
  elsif p_mode = 'pause' then
    v_congestion := '중단';
    v_wait := 0;
  else
    v_congestion := '마감';
    v_wait := 0;
  end if;

  insert into public.booth_live as l (booth_id, congestion, wait_minutes, updated_at)
  values (p_booth, v_congestion, v_wait, pg_catalog.now())
  on conflict on constraint booth_live_pkey do update
     set congestion   = excluded.congestion,
         wait_minutes = excluded.wait_minutes,
         updated_at   = excluded.updated_at;

  insert into public.booth_live_log as g (booth_id, congestion, wait_minutes, source, session_id)
  values (p_booth, v_congestion, v_wait, 'set', p_session);
end;
$function$;

CREATE OR REPLACE FUNCTION private.booth_op_touch(p_booth uuid, p_session uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_congestion text;
  v_wait       integer;
begin
  update public.booth_live as l
     set updated_at = pg_catalog.now()
   where l.booth_id = p_booth
     and (l.updated_at at time zone 'Asia/Seoul')::date
       = (pg_catalog.now() at time zone 'Asia/Seoul')::date
  returning l.congestion, l.wait_minutes into v_congestion, v_wait;

  if not found then
    raise exception '아직 입력한 값이 없습니다. 먼저 대기 시간을 눌러 주세요.' using errcode = '22023';
  end if;

  insert into public.booth_live_log as g (booth_id, congestion, wait_minutes, source, session_id)
  values (p_booth, v_congestion, v_wait, 'touch', p_session);
end;
$function$;

CREATE OR REPLACE FUNCTION public.booth_ctrl_set(p_token text, p_mode text, p_wait_minutes integer)
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
  if p_mode is null or p_mode not in ('open', 'pause', 'closed') then
    raise exception '허용되지 않는 상태입니다.' using errcode = '22023';
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
  values (v_booth, v_congestion, v_wait, pg_catalog.now())
  on conflict on constraint booth_live_pkey do update
     set congestion   = excluded.congestion,
         wait_minutes = excluded.wait_minutes,
         updated_at   = excluded.updated_at;
  insert into public.booth_live_log as g (booth_id, congestion, wait_minutes, source)
  values (v_booth, v_congestion, v_wait, 'set');
  return query select * from public.booth_ctrl_get(p_token);
end;
$function$;

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
$function$;

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
$function$;

-- 4. 새 함수 · 정책 · 표 ------------------------------------------------
drop function public.booth_session_mode(text, text);
drop function public.booth_ctrl_mode(text, text);
drop function private.booth_mode_op(uuid, text, uuid);
drop function private.booth_mode_check(uuid, text);
drop function private.booth_live_kind(text);
drop function private.booth_mode_lock(uuid);
drop function private.booth_mode_of(uuid);
drop policy "공개 부스 운영 방식 열람" on public.booth_live_mode;
drop function public.booth_live_mode_enabled();

-- 운영 방식 줄은 지우기 전에 private 에 남겨 둡니다(누가 어떤 방식이었는지 — 기록은 booth_live_log 에 그대로).
create table private.booth_live_mode_backup as select * from public.booth_live_mode;
revoke all on table private.booth_live_mode_backup from public, anon, authenticated;
drop table public.booth_live_mode;
drop table public.booth_live_mode_config;

-- 5. CHECK --------------------------------------------------------------
alter table public.booth_live drop constraint booth_live_congestion_check;
alter table public.booth_live add constraint booth_live_congestion_check
  check (congestion = any (array['여유'::text, '보통'::text, '혼잡'::text, '중단'::text, '마감'::text]));

-- 6. 확인: 2026-11-03 정의와 같은가 ---------------------------------------
do $post$
declare
  v_bad text := '';
begin
  if (select md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = 'private.booth_op_set(uuid,text,integer,uuid)'::regprocedure)
     is distinct from '47b39587a259ede1172674269286f543' then v_bad := v_bad || ' private.booth_op_set'; end if;
  if (select md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = 'private.booth_op_touch(uuid,uuid)'::regprocedure)
     is distinct from 'f4a7c7206aeb1ffaece995cf36e3888b' then v_bad := v_bad || ' private.booth_op_touch'; end if;
  if (select md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = 'public.booth_ctrl_set(text,text,integer)'::regprocedure)
     is distinct from 'c244c2caaaf3cb72efea6af1a90694af' then v_bad := v_bad || ' public.booth_ctrl_set'; end if;
  if (select md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = 'public.booth_ctrl_touch(text)'::regprocedure)
     is distinct from '133b47076c22d428ce6dcc0591702051' then v_bad := v_bad || ' public.booth_ctrl_touch'; end if;
  if (select md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = 'public.admin_set_booth_live(uuid,text,integer)'::regprocedure)
     is distinct from '778f69b8ceaac6eea38aaea71324c8c4' then v_bad := v_bad || ' public.admin_set_booth_live'; end if;
  if (select md5(pg_catalog.pg_get_constraintdef(c.oid)) from pg_catalog.pg_constraint c
       where c.conrelid = 'public.booth_live'::regclass and c.conname = 'booth_live_congestion_check')
     is distinct from '935e9a9548dbdd292622c12a13ff47ed' then v_bad := v_bad || ' booth_live_congestion_check'; end if;
  if v_bad <> '' then
    raise exception 'STOP: 되돌린 정의가 2026-11-03 판과 다릅니다:%', v_bad;
  end if;
end;
$post$;

commit;
