-- ===================================================================
-- 부스 운영 방식(현장대기 · 현장예약) — booth_live_mode
--
--   운영 방식(mode)과 운영 상태(status)를 다른 표에 둡니다.
--     방식  public.booth_live_mode   부스당 한 줄 · 줄이 없으면 '현장대기'(wait).
--                                     23:00 초기화(private.rehearsal_live_reset)는 이 표를 건드리지 않아 방식이 유지됩니다.
--     상태  public.booth_live        지금처럼 부스당 한 줄. 23:00 에 줄째 지워져 당일 상태만 초기화됩니다.
--           현장예약 상태 두 가지를 더합니다 — '예약중'(예약 운영 중) · '예약마감'(예약 마감).
--           잠시 중단 · 오늘 마감은 두 방식이 같은 '중단' · '마감' 을 씁니다.
--
--   스위치  public.booth_live_mode_config.enabled (기본 false — 이 파일을 적용해도 꺼진 채로 시작합니다)
--     꺼짐  모든 부스를 '현장대기' 로 봅니다(방식 줄은 지우지 않고 무시). 방식 표는 공개 읽기에서도 0줄로 보입니다.
--           → 운영자 · 관람객 · 관리 화면이 지금과 같은 모양 · 같은 입력으로 돌아갑니다.
--     켜짐  운영자가 PIN · QR 로 연 화면에서 자기 부스의 방식을 바꿀 수 있습니다.
--
--   쓰기 다섯 길에 같은 문지기를 둡니다(방식에 맞지 않는 값은 22023 · hint booth_mode_mismatch 로 거부).
--     private.booth_op_set · private.booth_op_touch       (PIN 세션 — booth_session_set · touch 가 부름)
--     public.booth_ctrl_set · public.booth_ctrl_touch     (QR 열쇠 — 이제 위 두 함수를 그대로 부름)
--     public.admin_set_booth_live                         (관리자 긴급 수정 · 예시 채우기 · 직접 고치기)
--   이름 · 인자 · 반환 모양 · 권한은 그대로입니다(CREATE OR REPLACE). 방식이 '현장대기' 인 부스에는 지금과 같은 값 ·
--   같은 기록 · 같은 오류를 냅니다. 바뀌는 것은 부스 단위로 줄을 세우는 잠금(advisory, 트랜잭션 끝에 풀림) 하나입니다.
--
--   새 함수
--     public.booth_session_mode(p_session, p_mode)   PIN 세션 — p_mode null 이면 읽기만, 'wait' · 'reserve' 면 전환
--     public.booth_ctrl_mode(p_token, p_mode)        QR 열쇠 — 같은 일
--     public.booth_live_mode_enabled()               스위치 읽기(공개)
--     전환은 같은 부스 잠금 안에서 booth_live 그 부스 줄을 지우고 방식을 적습니다(과거 대기 · 예약 상태가 되살아나지 않음).
--     지금 방식과 같은 전환은 아무것도 하지 않습니다(응답을 잃고 다시 보내도 상태를 지우지 않음).
--
--   바꾸지 않는 것: booths · zones · booth_access(QR) · booth_pin · booth_session · UUID · 84곳 데이터 · booth_live 값 ·
--     23:00 예약(cron) · private.rehearsal_live_reset · admin_reset_booth_live · admin_confirm_booth_live ·
--     booth_session_get · set · touch · booth_ctrl_get 의 정의.
--
--   먼저 볼 것: 지금 정의가 2026-11-03 Production 과 같은지 md5 로 확인하고, 다르면 아무것도 바꾸지 않고 멈춥니다.
--   되돌리기: supabase/rollback-booth-live-mode.sql · 켜고 끄기 · 테스트 설정 정리: supabase/ops-booth-live-mode.sql
--   사용법: SQL Editor → 전체 붙여넣고 Run(한 트랜잭션). 이미 적용했으면 STOP 으로 멈춥니다.
-- ===================================================================

begin;
set local lock_timeout = '5s';

-- 0. 먼저 볼 것 ------------------------------------------------------
do $pre$
declare
  v_bad text := '';
begin
  if pg_catalog.to_regclass('public.booth_live_mode') is not null
     or pg_catalog.to_regclass('public.booth_live_mode_config') is not null
     or pg_catalog.to_regclass('public.booth_live_mode_log') is not null then
    raise exception 'STOP: 운영 방식 표가 이미 있습니다(이미 적용함). 다시 적용하지 않습니다.';
  end if;
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
    raise exception 'STOP: 2026-11-03 Production 정의와 다릅니다:%', v_bad;
  end if;
end;
$pre$;

-- 1. 표 ---------------------------------------------------------------
-- 1-1. 스위치(한 줄). 읽기는 public.booth_live_mode_enabled() 로만, 바꾸기는 SQL Editor 에서만(ops 파일).
create table public.booth_live_mode_config (
  id         smallint primary key default 1 check (id = 1),
  enabled    boolean not null default false,
  updated_at timestamptz not null default pg_catalog.now()
);
insert into public.booth_live_mode_config (id, enabled) values (1, false);
alter table public.booth_live_mode_config enable row level security;
revoke all on table public.booth_live_mode_config from public, anon, authenticated;

-- 1-2. 방식. 줄이 없으면 '현장대기'. 기존 84곳에는 줄을 넣지 않습니다(적용 직후 모두 현장대기).
create table public.booth_live_mode (
  booth_id   uuid primary key references public.booths(id) on delete cascade,
  mode       text not null check (mode in ('wait', 'reserve')),
  updated_at timestamptz not null default pg_catalog.now(),
  via        text not null check (via in ('pin', 'qr', 'admin')),
  session_id uuid references public.booth_session(id) on delete set null
);
alter table public.booth_live_mode enable row level security;
revoke all on table public.booth_live_mode from public, anon, authenticated;
grant select on table public.booth_live_mode to anon, authenticated;

-- 1-3. 전환 기록. 전환으로 지운 상태(cleared_*)도 남깁니다 — booth_live_log 는 congestion 이 NOT NULL 이라 '지움' 을 적을 수 없어서.
create table public.booth_live_mode_log (
  id                 bigint generated always as identity primary key,
  booth_id           uuid not null references public.booths(id) on delete cascade,
  from_mode          text not null check (from_mode in ('wait', 'reserve')),
  to_mode            text not null check (to_mode in ('wait', 'reserve')),
  cleared_congestion text,
  cleared_wait       integer,
  cleared_updated_at timestamptz,
  via                text not null check (via in ('pin', 'qr', 'admin')),
  session_id         uuid references public.booth_session(id) on delete set null,
  created_at         timestamptz not null default pg_catalog.now()
);
create index booth_live_mode_log_booth_at on public.booth_live_mode_log (booth_id, created_at desc);
alter table public.booth_live_mode_log enable row level security;
revoke all on table public.booth_live_mode_log from public, anon, authenticated;

-- 2. 스위치 · 도우미 ---------------------------------------------------
create function public.booth_live_mode_enabled()
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select coalesce((select c.enabled from public.booth_live_mode_config c where c.id = 1), false)
$function$;
revoke all on function public.booth_live_mode_enabled() from public;
grant execute on function public.booth_live_mode_enabled() to anon, authenticated;

-- 공개 읽기: 스위치가 켜져 있을 때만 줄이 보입니다(꺼지면 관람객 스냅샷 · 관리 화면 모두 '모두 현장대기').
create policy "공개 부스 운영 방식 열람" on public.booth_live_mode
  for select to anon, authenticated
  using (public.booth_live_mode_enabled()
         and exists (select 1 from public.booths b where b.id = booth_live_mode.booth_id));

-- 지금 이 부스의 방식(스위치가 꺼져 있으면 늘 'wait').
create function private.booth_mode_of(p_booth uuid)
 returns text
 language sql
 stable
 set search_path to ''
as $function$
  select case when public.booth_live_mode_enabled()
              then coalesce((select m.mode from public.booth_live_mode m where m.booth_id = p_booth), 'wait')
              else 'wait' end
$function$;

-- 같은 부스의 쓰기 · 전환을 한 줄로 세웁니다(두 32비트 키 — 다른 곳의 64비트 키 잠금과 겹치지 않음).
-- 트랜잭션이 끝나면 풀립니다. 운영자 한 번의 저장은 몇 ms 라 기다림이 생기지 않습니다.
create function private.booth_mode_lock(p_booth uuid)
 returns void
 language sql
 volatile
 set search_path to ''
as $function$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('booth_live_mode'), pg_catalog.hashtext(p_booth::text))
$function$;

-- 상태 값이 어느 방식의 것인가: 대기(여유 · 보통 · 혼잡) · 예약(예약중 · 예약마감) · 둘 다(중단 · 마감)
create function private.booth_live_kind(p_congestion text)
 returns text
 language sql
 immutable
 set search_path to ''
as $function$
  select case when p_congestion in ('여유', '보통', '혼잡') then 'wait'
              when p_congestion in ('예약중', '예약마감') then 'reserve'
              else 'any' end
$function$;

-- 방식에 맞지 않는 쓰기를 거부합니다. 운영자 화면은 22023 이면 그 누름을 버리고 알립니다(못 보낸 누름이 되살아나지 않음).
create function private.booth_mode_check(p_booth uuid, p_mode text)
 returns void
 language plpgsql
 stable
 set search_path to ''
as $function$
declare
  v_mode text := private.booth_mode_of(p_booth);
begin
  if (p_mode = 'open' and v_mode <> 'wait')
     or (p_mode in ('resv_open', 'resv_closed') and v_mode <> 'reserve') then
    raise exception '운영 방식이 바뀌었습니다. 화면을 새로 고쳐 주세요.'
      using errcode = '22023', hint = 'booth_mode_mismatch';
  end if;
end;
$function$;

revoke all on function private.booth_mode_of(uuid)            from public, anon, authenticated;
revoke all on function private.booth_mode_lock(uuid)          from public, anon, authenticated;
revoke all on function private.booth_live_kind(text)          from public, anon, authenticated;
revoke all on function private.booth_mode_check(uuid, text)   from public, anon, authenticated;

-- 3. 쓰기 다섯 길 -----------------------------------------------------
-- 3-1. PIN 세션 저장. 새 상태 resv_open('예약중') · resv_closed('예약마감').
create or replace function private.booth_op_set(p_booth uuid, p_mode text, p_wait integer, p_session uuid)
 returns void
 language plpgsql
 set search_path to ''
as $function$
declare
  v_congestion text;
  v_wait       integer;
begin
  if p_mode is null or p_mode not in ('open', 'pause', 'closed', 'resv_open', 'resv_closed') then
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
  elsif p_mode = 'closed' then
    v_congestion := '마감';
    v_wait := 0;
  elsif p_mode = 'resv_open' then
    v_congestion := '예약중';
    v_wait := 0;
  else
    v_congestion := '예약마감';
    v_wait := 0;
  end if;

  -- 운영 방식 전환과 차례를 정한 뒤 방식을 봅니다(전환 직전에 못 보낸 대기 분이 전환 뒤에 들어가지 않게).
  perform private.booth_mode_lock(p_booth);
  perform private.booth_mode_check(p_booth, p_mode);

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

-- 3-2. PIN 세션 '변동 없음 · 지금 확인'. 지금 방식에 맞는 오늘 값만 시각을 새로 합니다.
create or replace function private.booth_op_touch(p_booth uuid, p_session uuid)
 returns void
 language plpgsql
 set search_path to ''
as $function$
declare
  v_congestion text;
  v_wait       integer;
begin
  perform private.booth_mode_lock(p_booth);

  update public.booth_live as l
     set updated_at = pg_catalog.now()
   where l.booth_id = p_booth
     and (l.updated_at at time zone 'Asia/Seoul')::date
       = (pg_catalog.now() at time zone 'Asia/Seoul')::date
     and private.booth_live_kind(l.congestion) in ('any', private.booth_mode_of(p_booth))
  returning l.congestion, l.wait_minutes into v_congestion, v_wait;

  if not found then
    -- 오늘 값은 있는데 방식이 맞지 않음(스위치를 끈 뒤 남은 예약 상태 등) — 확인으로 되살리지 않습니다.
    if exists (select 1 from public.booth_live as l
                where l.booth_id = p_booth
                  and (l.updated_at at time zone 'Asia/Seoul')::date
                    = (pg_catalog.now() at time zone 'Asia/Seoul')::date) then
      raise exception '운영 방식이 바뀌었습니다. 화면을 새로 고쳐 주세요.'
        using errcode = '22023', hint = 'booth_mode_mismatch';
    end if;
    raise exception '아직 입력한 값이 없습니다. 먼저 대기 시간을 눌러 주세요.' using errcode = '22023';
  end if;

  insert into public.booth_live_log as g (booth_id, congestion, wait_minutes, source, session_id)
  values (p_booth, v_congestion, v_wait, 'touch', p_session);
end;
$function$;

-- 3-3. QR 열쇠 저장 · 확인. 열쇠 검사는 그대로 두고, 값 처리는 PIN 세션과 같은 함수를 씁니다
--      (예전에는 같은 로직의 사본이라 한쪽만 고치면 다른 쪽으로 방식에 맞지 않는 값이 들어갈 수 있었음).
create or replace function public.booth_ctrl_set(p_token text, p_mode text, p_wait_minutes integer)
 returns table(booth_id uuid, code text, zone_key text, zone_label text, name text, org text, congestion text, wait_minutes integer, updated_at timestamp with time zone, issued_at timestamp with time zone, token_tail text)
 language plpgsql
 security definer
 set search_path to ''
as $function$
#variable_conflict use_column
declare
  v_booth uuid;
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
  perform private.booth_op_set(v_booth, p_mode, p_wait_minutes, null);
  return query select * from public.booth_ctrl_get(p_token);
end;
$function$;

create or replace function public.booth_ctrl_touch(p_token text)
 returns table(booth_id uuid, code text, zone_key text, zone_label text, name text, org text, congestion text, wait_minutes integer, updated_at timestamp with time zone, issued_at timestamp with time zone, token_tail text)
 language plpgsql
 security definer
 set search_path to ''
as $function$
#variable_conflict use_column
declare
  v_booth uuid;
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
  perform private.booth_op_touch(v_booth, null);
  return query select * from public.booth_ctrl_get(p_token);
end;
$function$;

-- 3-4. 관리자 긴급 수정 · 예시 채우기 · 직접 고치기. 현장예약 부스에 대기 분(open)을 넣지 않습니다.
--      clear(값 지우기)는 두 방식 모두에서 됩니다. 관리자가 방식을 바꾸는 길은 두지 않습니다(운영자가 정함).
create or replace function public.admin_set_booth_live(p_booth_id uuid, p_mode text, p_wait_minutes integer)
 returns table(booth_id uuid, congestion text, wait_minutes integer, updated_at timestamp with time zone)
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
  if p_mode is null or p_mode not in ('open', 'pause', 'closed', 'clear', 'resv_open', 'resv_closed') then
    raise exception '허용되지 않는 상태입니다.' using errcode = '22023';
  end if;
  perform private.booth_mode_lock(p_booth_id);
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
  elsif p_mode = 'closed' then
    v_congestion := '마감';
    v_wait := 0;
  elsif p_mode = 'resv_open' then
    v_congestion := '예약중';
    v_wait := 0;
  else
    v_congestion := '예약마감';
    v_wait := 0;
  end if;
  perform private.booth_mode_check(p_booth_id, p_mode);
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

-- 4. 운영 방식 읽기 · 전환 --------------------------------------------
-- p_mode null  : 읽기만(지금 방식 · 스위치 · 지금 상태)
-- p_mode 값    : 스위치가 켜져 있을 때만. 지금과 같으면 아무것도 하지 않습니다.
--                다르면 같은 부스 잠금 안에서 booth_live 그 부스 줄을 지우고(과거 대기 · 예약 상태 제거) 방식을 적습니다.
create function private.booth_mode_op(p_booth uuid, p_mode text, p_via text, p_session uuid)
 returns table(op_mode text, mode_updated_at timestamp with time zone, reserve_enabled boolean, congestion text, wait_minutes integer, updated_at timestamp with time zone)
 language plpgsql
 set search_path to ''
as $function$
#variable_conflict use_column
declare
  v_on    boolean := public.booth_live_mode_enabled();
  v_cur   text;
  v_old_c text;
  v_old_w integer;
  v_old_t timestamptz;
begin
  if p_mode is not null then
    if not v_on then
      raise exception '지금은 운영 방식을 바꿀 수 없습니다.' using errcode = '22023', hint = 'booth_mode_off';
    end if;
    if p_mode not in ('wait', 'reserve') then
      raise exception '허용되지 않는 운영 방식입니다.' using errcode = '22023';
    end if;
    perform private.booth_mode_lock(p_booth);
    v_cur := private.booth_mode_of(p_booth);
    if v_cur <> p_mode then
      delete from public.booth_live as l where l.booth_id = p_booth
      returning l.congestion, l.wait_minutes, l.updated_at into v_old_c, v_old_w, v_old_t;
      insert into public.booth_live_mode as m (booth_id, mode, updated_at, via, session_id)
      values (p_booth, p_mode, pg_catalog.now(), p_via, p_session)
      on conflict on constraint booth_live_mode_pkey do update
         set mode       = excluded.mode,
             updated_at = excluded.updated_at,
             via        = excluded.via,
             session_id = excluded.session_id;
      insert into public.booth_live_mode_log as g
             (booth_id, from_mode, to_mode, cleared_congestion, cleared_wait, cleared_updated_at, via, session_id)
      values (p_booth, v_cur, p_mode, v_old_c, v_old_w, v_old_t, p_via, p_session);
    end if;
  end if;

  return query
    select private.booth_mode_of(p_booth),
           case when v_on then m.updated_at end,
           v_on,
           l.congestion,
           l.wait_minutes,
           l.updated_at
      from (select p_booth as id) as x
      left join public.booth_live_mode as m on m.booth_id = x.id
      left join public.booth_live      as l on l.booth_id = x.id;
end;
$function$;
revoke all on function private.booth_mode_op(uuid, text, text, uuid) from public, anon, authenticated;

create function public.booth_session_mode(p_session text, p_mode text)
 returns table(op_mode text, mode_updated_at timestamp with time zone, reserve_enabled boolean, congestion text, wait_minutes integer, updated_at timestamp with time zone)
 language plpgsql
 security definer
 set search_path to ''
as $function$
#variable_conflict use_column
declare
  s record;
begin
  if coalesce(pg_catalog.current_setting('request.method', true), '') in ('GET', 'HEAD') then
    return;
  end if;
  select * into s from private.booth_session_resolve(p_session, p_mode is not null);
  return query select * from private.booth_mode_op(s.booth_id, p_mode, 'pin', s.session_id);
end;
$function$;

create function public.booth_ctrl_mode(p_token text, p_mode text)
 returns table(op_mode text, mode_updated_at timestamp with time zone, reserve_enabled boolean, congestion text, wait_minutes integer, updated_at timestamp with time zone)
 language plpgsql
 security definer
 set search_path to ''
as $function$
#variable_conflict use_column
declare
  v_booth uuid;
begin
  if coalesce(pg_catalog.current_setting('request.method', true), '') in ('GET', 'HEAD') then
    return;
  end if;
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
  return query select * from private.booth_mode_op(v_booth, p_mode, 'qr', null);
end;
$function$;

revoke all on function public.booth_session_mode(text, text) from public;
revoke all on function public.booth_ctrl_mode(text, text)    from public;
grant execute on function public.booth_session_mode(text, text) to anon, authenticated;
grant execute on function public.booth_ctrl_mode(text, text)    to anon, authenticated;

-- 5. 상태 값 두 가지 더하기 ----------------------------------------------
alter table public.booth_live drop constraint booth_live_congestion_check;
alter table public.booth_live add constraint booth_live_congestion_check
  check (congestion = any (array['여유'::text, '보통'::text, '혼잡'::text, '중단'::text, '마감'::text, '예약중'::text, '예약마감'::text]));

-- 6. 확인 ---------------------------------------------------------------
do $post$
begin
  if (select count(*) from public.booth_live_mode) <> 0 then raise exception 'STOP: 방식 줄이 0이 아닙니다'; end if;
  if (select enabled from public.booth_live_mode_config where id = 1) is distinct from false then
    raise exception 'STOP: 스위치가 꺼져 있지 않습니다';
  end if;
  if has_table_privilege('anon', 'public.booth_live_mode', 'INSERT')
     or has_table_privilege('anon', 'public.booth_live_mode_config', 'SELECT')
     or has_table_privilege('anon', 'public.booth_live_mode_log', 'SELECT')
     or has_function_privilege('anon', 'private.booth_mode_op(uuid,text,text,uuid)', 'EXECUTE') then
    raise exception 'STOP: 공개 권한이 예상과 다릅니다';
  end if;
end;
$post$;

commit;

-- 적용 뒤 확인(읽기만) — 모두 기대값이면 끝입니다.
select (select count(*) from public.booth_live_mode)                         as mode_rows,        -- 0
       (select enabled from public.booth_live_mode_config where id = 1)      as enabled,          -- false
       (select count(*) from public.booth_live)                              as live_rows,        -- 적용 전과 같음
       (select count(*) from public.booths where is_published and no is not null) as published_booths; -- 84
