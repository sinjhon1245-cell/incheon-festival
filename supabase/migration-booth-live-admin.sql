-- ===================================================================
-- 부스 대기 현황 — 관리자 보강 (migration-booth-live.sql 의 후속)
--
--   먼저 migration-booth-live.sql 의 처음 판이 적용돼 있어야 합니다(운영 DB 2026-10-02).
--      이 파일은 그 위에 얹는 후속이고, 여러 번 실행해도 안전합니다.
--
--   migration-booth-live.sql 최신판과의 관계
--     이 파일의 내용은 migration-booth-live.sql 최신판에도 모두 들어 있습니다
--     (같은 동작의 함수 · 같은 칸 · 같은 제약 — 주석 · 빈 줄만 다를 수 있음).
--     운영 DB 는 처음 판을 먼저
--     적용했기 때문에 이 차이만 따로 적용했고, 새로 만드는 DB 는
--     migration-booth-live.sql 하나만 실행하면 됩니다. 어느 쪽을 다시
--     실행해도 같은 결과로 수렴하니, 고치려고 다시 돌릴 때는
--     migration-booth-live.sql 하나면 됩니다.
--
--   이 파일이 하는 일
--     1. 열쇠 끄기
--        booth_access 에 disabled_at 칸을 더합니다. 꺼진 열쇠는
--        booth_ctrl_get · set · touch 가 '모르는 열쇠' 와 똑같이 거절합니다
--        (get 은 0줄, set · touch 는 42501 + hint 'booth_token_invalid').
--        인쇄 페이지를 다시 열어도 꺼진 부스에 새 열쇠를 만들지 않습니다
--        — 줄이 남아 있으니까요. 다시 켜는 길은 '열쇠 바꾸기' 하나뿐이고,
--        그때는 새 열쇠가 나옵니다(예전 열쇠는 다시 살아나지 않습니다).
--
--        열쇠 바꾸기와 다른 점: 바꾸기는 그 자리에서 새 열쇠를 내주니
--        새 카드를 바로 찍어야 할 때 씁니다. 끄기는 새 열쇠 없이 멈추기만
--        합니다 — 부스가 일찍 철수했거나, 누가 그 부스 값을 엉뚱하게
--        바꾸는데 아직 담당 선생님과 연락이 안 될 때.
--
--     2. 관리자 직접 수정 — admin_set_booth_live(p_booth_id, p_mode, p_wait_minutes)
--        운영본부가 열쇠 없이 한 부스의 값을 고칩니다(선생님 휴대폰이
--        꺼졌거나, 열쇠를 끈 부스의 값이 틀려 있을 때). 규칙은 운영자
--        입력과 같습니다: open + 대기 분 → 여유 · 보통 · 혼잡, pause → 중단,
--        closed → 마감. 'clear' 는 그 부스 값을 지워 '정보 없음' 으로 되돌립니다.
--        기록(booth_live_log)에는 source 'admin' 으로 남습니다.
--
--     3. admin_booth_access() 가 'disabled' 칸을 더 돌려줍니다. 꺼진 부스는
--        token 을 비워(null) 돌려줍니다 — 인쇄 화면에 꺼진 열쇠가 QR 로
--        다시 찍히지 않게 합니다.
--
--     4. admin_rotate_booth_token() 이 새 열쇠를 내면서 꺼짐을 풉니다.
--
--   바뀌지 않는 것
--     · booths · zones · 기존 포털 · 관리자 함수와 정책
--     · booth_live 의 값, booth_access 의 열쇠, booth_live_log 의 기록
--     · 함수 이름과 인자. booth_ctrl_* 세 함수는 돌려주는 칸도 그대로입니다.
--       (admin_booth_access 만 끝에 disabled 칸이 하나 늘어납니다 — 인쇄
--        페이지가 함께 바뀝니다.)
--
--   보안 점검 경고
--     새 함수 admin_disable_booth_token · admin_set_booth_live 도
--     authenticated_security_definer_function_executable 로 짚힙니다.
--     함수 안의 is_admin() 이 막습니다. authenticated 실행 권한을 거두면
--     인쇄 페이지의 끄기 · 직접 수정이 멈춥니다.
--
-- 사용법: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run.
--         여러 번 실행해도 안전합니다. 맨 아래 확인 표의 '맞음' 이 모두
--         true 여야 합니다.
--
-- 트랜잭션: BEGIN/COMMIT 을 넣지 않습니다. SQL Editor 와 apply_migration
--   은 이미 한 트랜잭션으로 돌립니다. psql 은 psql -1 -v ON_ERROR_STOP=1 -f.
-- ===================================================================


-- ═══════════════════════════════════════════════════════════════
-- 0. 선행 조건 검사 (아무것도 바꾸지 않습니다)
-- ═══════════════════════════════════════════════════════════════
do $preflight$
begin
  if to_regclass('public.booth_access') is null
     or to_regclass('public.booth_live') is null
     or to_regclass('public.booth_live_log') is null then
    raise exception '선행 조건 누락: migration-booth-live.sql 을 먼저 적용하세요.';
  end if;
  if to_regprocedure('public.booth_ctrl_get(text)') is null
     or to_regprocedure('public.admin_booth_access()') is null then
    raise exception '선행 조건 누락: migration-booth-live.sql 의 함수가 없습니다.';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception '선행 조건 누락: public.is_admin() 이 없습니다.';
  end if;
  if to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception '선행 조건 누락: extensions.gen_random_bytes(integer) 가 없습니다.';
  end if;
end
$preflight$;


-- ═══════════════════════════════════════════════════════════════
-- 1. 칸 · 제약
-- ═══════════════════════════════════════════════════════════════
alter table public.booth_access add column if not exists disabled_at timestamptz;

comment on column public.booth_access.disabled_at is
  '열쇠를 끈 시각. 값이 있으면 그 열쇠는 운영자 화면에서 거절됩니다. 열쇠 바꾸기로만 다시 켭니다.';

-- 기록 출처에 'admin'(관리자 직접 수정)을 더합니다.
alter table public.booth_live_log drop constraint if exists booth_live_log_source_check;
alter table public.booth_live_log
  add constraint booth_live_log_source_check
  check (source in ('set', 'touch', 'admin'));


-- ═══════════════════════════════════════════════════════════════
-- 2. 운영자 함수 세 개 — 꺼진 열쇠 거절
--
-- 돌려주는 칸 · 인자 · 동작은 migration-booth-live.sql 과 같고,
-- 열쇠를 찾는 곳마다 "and a.disabled_at is null" 한 줄만 더했습니다.
-- 지우고 다시 만드는 이유는 앞 파일과 같습니다(칸이 바뀐 함수가 섞여
-- 남지 않게). 권한도 다시 줍니다.
-- ═══════════════════════════════════════════════════════════════
drop function if exists public.booth_ctrl_get(text);
create function public.booth_ctrl_get(p_token text)
returns table (
  booth_id      uuid,
  code          text,
  zone_key      text,
  zone_label    text,
  name          text,
  org           text,
  congestion    text,
  wait_minutes  integer,
  updated_at    timestamptz,
  issued_at     timestamptz,
  token_tail    text
)
language sql
volatile
security definer
set search_path = ''
as $$
  select b.id,
         coalesce(nullif(b.code, ''),
                  b.zone_key || '-' || lpad(b.no::text, greatest(2, length(b.no::text)), '0')),
         b.zone_key,
         z.label,
         b.name,
         b.org,
         l.congestion,
         l.wait_minutes,
         l.updated_at,
         coalesce(a.rotated_at, a.created_at),
         right(a.token, 4)
    from public.booth_access a
    join public.booths b on b.id = a.booth_id
    left join public.zones z on z.key = b.zone_key
    left join public.booth_live l on l.booth_id = b.id
   where p_token ~ '^[A-Za-z0-9_-]{24}$'
     and a.token = p_token
     and a.disabled_at is null
     and coalesce(pg_catalog.current_setting('request.method', true), '') not in ('GET', 'HEAD')
$$;

revoke all     on function public.booth_ctrl_get(text) from public;
grant  execute on function public.booth_ctrl_get(text) to anon, authenticated;
comment on function public.booth_ctrl_get(text) is
  '부스 QR 열쇠로만 동작합니다. anon 실행 권한은 의도된 것입니다 — 보안 점검(anon_security_definer_function_executable) 경고를 보고 거두지 마세요.';


drop function if exists public.booth_ctrl_set(text, text, integer);
create function public.booth_ctrl_set(p_token text, p_mode text, p_wait_minutes integer)
returns table (
  booth_id      uuid,
  code          text,
  zone_key      text,
  zone_label    text,
  name          text,
  org           text,
  congestion    text,
  wait_minutes  integer,
  updated_at    timestamptz,
  issued_at     timestamptz,
  token_tail    text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
   where a.token = p_token
     and a.disabled_at is null;
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
$$;

revoke all     on function public.booth_ctrl_set(text, text, integer) from public;
grant  execute on function public.booth_ctrl_set(text, text, integer) to anon, authenticated;
comment on function public.booth_ctrl_set(text, text, integer) is
  '부스 QR 열쇠로만 동작합니다. anon 실행 권한은 의도된 것입니다 — 보안 점검(anon_security_definer_function_executable) 경고를 보고 거두지 마세요.';


drop function if exists public.booth_ctrl_touch(text);
create function public.booth_ctrl_touch(p_token text)
returns table (
  booth_id      uuid,
  code          text,
  zone_key      text,
  zone_label    text,
  name          text,
  org           text,
  congestion    text,
  wait_minutes  integer,
  updated_at    timestamptz,
  issued_at     timestamptz,
  token_tail    text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
   where a.token = p_token
     and a.disabled_at is null;
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
$$;

revoke all     on function public.booth_ctrl_touch(text) from public;
grant  execute on function public.booth_ctrl_touch(text) to anon, authenticated;
comment on function public.booth_ctrl_touch(text) is
  '부스 QR 열쇠로만 동작합니다. anon 실행 권한은 의도된 것입니다 — 보안 점검(anon_security_definer_function_executable) 경고를 보고 거두지 마세요.';


-- ═══════════════════════════════════════════════════════════════
-- 3. 관리자 함수
-- ═══════════════════════════════════════════════════════════════

-- 3-1. 열쇠 목록 — 끝에 disabled 칸이 늘었습니다. 꺼진 부스는 token 을
--      null 로 돌려줍니다(인쇄 화면에 QR 로 다시 찍히지 않게).
--      꺼진 부스에도 줄은 남아 있으니 새 열쇠를 만들지 않습니다.
drop function if exists public.admin_booth_access();
create function public.admin_booth_access()
returns table (
  booth_id   uuid,
  token      text,
  issued_at  timestamptz,
  rotated    boolean,
  disabled   boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception '관리자만 볼 수 있습니다.' using errcode = '42501';
  end if;

  insert into public.booth_access as a (booth_id, token)
  select b.id, translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_')
    from public.booths b
  on conflict on constraint booth_access_pkey do nothing;

  return query
    select a.booth_id,
           case when a.disabled_at is null then a.token end,
           coalesce(a.rotated_at, a.created_at),
           a.rotated_at is not null,
           a.disabled_at is not null
      from public.booth_access a
     order by a.booth_id;
end;
$$;

revoke all     on function public.admin_booth_access() from public;
revoke execute on function public.admin_booth_access() from anon;
grant  execute on function public.admin_booth_access() to authenticated;
comment on function public.admin_booth_access() is
  '관리자 전용. 열쇠 없는 부스에 운영자 QR 열쇠를 만들고, 모든 부스의 열쇠를 돌려줍니다(꺼진 부스는 token null · disabled true).';


-- 3-2. 열쇠 바꾸기 — 새 열쇠를 내면서 꺼짐도 풉니다.
drop function if exists public.admin_rotate_booth_token(uuid);
create function public.admin_rotate_booth_token(p_booth_id uuid)
returns table (
  token      text,
  issued_at  timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_token  text;
  v_issued timestamptz;
begin
  if not public.is_admin() then
    raise exception '관리자만 열쇠를 바꿀 수 있습니다.' using errcode = '42501';
  end if;

  insert into public.booth_access as a (booth_id, token)
  select b.id, translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_')
    from public.booths b
   where b.id = p_booth_id
  on conflict on constraint booth_access_pkey do update
     set token       = excluded.token,
         rotated_at  = pg_catalog.now(),
         disabled_at = null
  returning a.token, coalesce(a.rotated_at, a.created_at) into v_token, v_issued;

  if not found then
    raise exception '해당 부스를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  return query select v_token, v_issued;
end;
$$;

revoke all     on function public.admin_rotate_booth_token(uuid) from public;
revoke execute on function public.admin_rotate_booth_token(uuid) from anon;
grant  execute on function public.admin_rotate_booth_token(uuid) to authenticated;
comment on function public.admin_rotate_booth_token(uuid) is
  '관리자 전용. 부스의 운영자 QR 열쇠를 새로 바꿉니다(꺼져 있었다면 다시 켭니다) — 옛 카드와 열려 있던 운영자 화면이 바로 멈춥니다.';


-- 3-3. 열쇠 끄기 — 새 열쇠 없이 멈춥니다. 이미 꺼져 있으면 처음 끈 시각을 그대로 둡니다.
drop function if exists public.admin_disable_booth_token(uuid);
create function public.admin_disable_booth_token(p_booth_id uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_at timestamptz;
begin
  if not public.is_admin() then
    raise exception '관리자만 열쇠를 끌 수 있습니다.' using errcode = '42501';
  end if;

  -- 끌 때 열쇠 문자열도 새 무작위 값으로 바꿉니다. 나중에 누가 꺼짐 검사를
  -- 빠뜨린 함수를 다시 만들어도 옛 열쇠(유출된 그 문자열)는 DB 어디에도
  -- 없어서 살아날 수 없습니다(표에서 지울 뿐 백업 · 기록까지 지우는 것은 아님).
  -- 바뀐 열쇠는 누구에게도 돌려주지 않습니다.
  update public.booth_access as a
     set token       = case when a.disabled_at is null
                            then translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_')
                            else a.token end,
         disabled_at = coalesce(a.disabled_at, pg_catalog.now())
   where a.booth_id = p_booth_id
  returning a.disabled_at into v_at;

  if not found then
    raise exception '이 부스에는 아직 열쇠가 없습니다.' using errcode = 'P0002';
  end if;

  return v_at;
end;
$$;

revoke all     on function public.admin_disable_booth_token(uuid) from public;
revoke execute on function public.admin_disable_booth_token(uuid) from anon;
grant  execute on function public.admin_disable_booth_token(uuid) to authenticated;
comment on function public.admin_disable_booth_token(uuid) is
  '관리자 전용. 부스의 운영자 QR 열쇠를 새 열쇠 없이 끕니다(열쇠 문자열도 버림). 다시 켜려면 열쇠 바꾸기.';


-- 3-4. 관리자 직접 수정 — 열쇠 없이 한 부스의 값을 고칩니다.
--      p_mode: 'open'(대기 분 필요) · 'pause' · 'closed' · 'clear'(값 지우기).
--      돌려주는 줄: 고친 뒤의 값(clear 면 세 칸이 null).
drop function if exists public.admin_set_booth_live(uuid, text, integer);
create function public.admin_set_booth_live(p_booth_id uuid, p_mode text, p_wait_minutes integer)
returns table (
  booth_id      uuid,
  congestion    text,
  wait_minutes  integer,
  updated_at    timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
$$;

revoke all     on function public.admin_set_booth_live(uuid, text, integer) from public;
revoke execute on function public.admin_set_booth_live(uuid, text, integer) from anon;
grant  execute on function public.admin_set_booth_live(uuid, text, integer) to authenticated;
comment on function public.admin_set_booth_live(uuid, text, integer) is
  '관리자 전용. 열쇠 없이 한 부스의 대기 값을 고칩니다(open · pause · closed · clear). 기록에는 source admin.';


-- ═══════════════════════════════════════════════════════════════
-- 4. 확인 (읽기만 합니다 — '맞음' 이 모두 true 여야 합니다)
-- ═══════════════════════════════════════════════════════════════
select v."항목",
       v."기대",
       v."실제",
       v."기대" = v."실제" as "맞음"
  from (values
    (1, 'booth_access.disabled_at 칸', 'timestamp with time zone',
        (select pg_catalog.format_type(att.atttypid, att.atttypmod)
           from pg_catalog.pg_attribute att
          where att.attrelid = 'public.booth_access'::regclass
            and att.attname = 'disabled_at' and not att.attisdropped)),
    (2, '기록 출처 제약에 admin 포함', 'true',
        (select pg_catalog.pg_get_constraintdef(con.oid) like '%admin%'
           from pg_catalog.pg_constraint con
          where con.conrelid = 'public.booth_live_log'::regclass
            and con.conname = 'booth_live_log_source_check')::text),
    (3, '운영자 함수 세 개 모두 꺼진 열쇠 확인', 'true',
        ((select pg_catalog.pg_get_functiondef('public.booth_ctrl_get(text)'::regprocedure) like '%disabled_at is null%')
         and (select pg_catalog.pg_get_functiondef('public.booth_ctrl_set(text,text,integer)'::regprocedure) like '%disabled_at is null%')
         and (select pg_catalog.pg_get_functiondef('public.booth_ctrl_touch(text)'::regprocedure) like '%disabled_at is null%'))::text),
    (4, 'anon 운영자 함수 실행 (get · set · touch)', 'true',
        (has_function_privilege('anon', 'public.booth_ctrl_get(text)', 'EXECUTE')
         and has_function_privilege('anon', 'public.booth_ctrl_set(text,text,integer)', 'EXECUTE')
         and has_function_privilege('anon', 'public.booth_ctrl_touch(text)', 'EXECUTE'))::text),
    (5, 'anon 관리자 함수 실행 (다섯 중 하나라도)', 'false',
        (has_function_privilege('anon', 'public.admin_booth_access()', 'EXECUTE')
         or has_function_privilege('anon', 'public.admin_rotate_booth_token(uuid)', 'EXECUTE')
         or has_function_privilege('anon', 'public.admin_reset_booth_live()', 'EXECUTE')
         or has_function_privilege('anon', 'public.admin_disable_booth_token(uuid)', 'EXECUTE')
         or has_function_privilege('anon', 'public.admin_set_booth_live(uuid,text,integer)', 'EXECUTE'))::text),
    (6, 'authenticated 관리자 함수 실행 (다섯 모두)', 'true',
        (has_function_privilege('authenticated', 'public.admin_booth_access()', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.admin_rotate_booth_token(uuid)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.admin_reset_booth_live()', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.admin_disable_booth_token(uuid)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.admin_set_booth_live(uuid,text,integer)', 'EXECUTE'))::text),
    (7, '함수 이름마다 정의 1개',
        'admin_booth_access 1, admin_disable_booth_token 1, admin_reset_booth_live 1, admin_rotate_booth_token 1, '
        'admin_set_booth_live 1, booth_ctrl_get 1, booth_ctrl_set 1, booth_ctrl_touch 1',
        (select string_agg(f.n || ' ' || (select count(*)
                                            from pg_catalog.pg_proc pro
                                            join pg_catalog.pg_namespace nsp on nsp.oid = pro.pronamespace
                                           where nsp.nspname = 'public'
                                             and pro.proname = f.n)::text,
                           ', ' order by f.n collate "C")
           from unnest(array['admin_booth_access', 'admin_disable_booth_token', 'admin_reset_booth_live',
                             'admin_rotate_booth_token', 'admin_set_booth_live',
                             'booth_ctrl_get', 'booth_ctrl_set', 'booth_ctrl_touch']) as f(n))),
    (8, 'security definer · search_path 빈 값 · volatile (여덟 함수)', '8',
        (select count(*)
           from pg_catalog.pg_proc pro
           join pg_catalog.pg_namespace nsp on nsp.oid = pro.pronamespace
          where nsp.nspname = 'public'
            and pro.proname in ('admin_booth_access', 'admin_disable_booth_token', 'admin_reset_booth_live',
                                'admin_rotate_booth_token', 'admin_set_booth_live',
                                'booth_ctrl_get', 'booth_ctrl_set', 'booth_ctrl_touch')
            and pro.prosecdef
            and pro.provolatile = 'v'
            and pro.proconfig = array['search_path=""'])::text),
    (9, 'booth_access 읽기 (anon · authenticated)', 'false',
        (has_table_privilege('anon', 'public.booth_access', 'SELECT')
         or has_table_privilege('authenticated', 'public.booth_access', 'SELECT'))::text),
    (10, 'booth_live 쓰기 (anon · authenticated)', 'false',
        (has_table_privilege('anon', 'public.booth_live', 'INSERT')
         or has_table_privilege('anon', 'public.booth_live', 'UPDATE')
         or has_table_privilege('anon', 'public.booth_live', 'DELETE')
         or has_table_privilege('authenticated', 'public.booth_live', 'INSERT')
         or has_table_privilege('authenticated', 'public.booth_live', 'UPDATE')
         or has_table_privilege('authenticated', 'public.booth_live', 'DELETE'))::text)
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";


-- ═══════════════════════════════════════════════════════════════
-- 5. 되돌리기
--
-- 이 파일만 따로 되돌리는 길은 두지 않습니다. migration-booth-live.sql
-- 최신판이 이 내용을 포함한 '지금의 전체 정의' 라서, 그 파일을 다시
-- 실행해도 끄기 · 직접 수정은 그대로 남습니다(되돌아가지 않습니다).
-- 기능 전체를 걷어낼 때는 migration-booth-live.sql 맨 아래 '9. 되돌리기'
-- 를 씁니다.
-- ═══════════════════════════════════════════════════════════════
