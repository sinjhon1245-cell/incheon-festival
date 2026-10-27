-- ===================================================================
-- 부스 운영 현황 — '확인 필요' 관리자 일괄 확인 기록
--
--   관리자가 현장(전화 · 순회)에서 실제로 확인한 부스만 골라 "이 값을 이 시각에 확인했다" 를
--   따로 남깁니다. 관리자 화면(booth-admin.html)의 '확인 필요' 정리에만 쓰입니다.
--
--   운영 기록은 바꾸지 않습니다
--     · booth_live 의 값 · updated_at, booth_live_log, 기존 함수 · 정책 · 23:00 예약 작업은 그대로입니다.
--       관람객 화면(30분 넘은 값은 '정보 없음')과 운영자 화면(마지막 입력 · 20분 확인 상자)은
--       이 기록을 읽지 않으므로 아무것도 달라지지 않습니다.
--     · 관람객에게 보이는 값까지 새로 하려면 지금처럼 [수정](admin_set_booth_live, 기록 'admin')으로 입력합니다.
--
--   이 파일이 더하는 것
--     public.booth_live_check                표 — 확인한 값(입력 시각 · 혼잡도 · 대기) · 확인한 관리자 · 시각 · 묶음 id.
--                                            RLS 켬 · 정책 없음 · anon/authenticated 권한 없음(아래 두 함수로만).
--     public.admin_confirm_booth_live(jsonb)  관리자만. [{ booth_id, seen_updated_at }] 1~100곳.
--                                            부스마다 booth_live 줄을 FOR UPDATE 로 잠근 뒤 판단하고, 통과하면 기록 한 줄.
--     public.admin_booth_live_checks()        관리자만. 부스마다 '지금 값' 에 대한 오늘(KST)의 마지막 확인.
--
--   판단 순서(admin_confirm_booth_live) — 결과는 부스마다 한 줄
--     skipped:duplicate   같은 요청 안에서 같은 부스가 또 나옴(처음 것만 처리)
--     skipped:not_found   그런 부스 없음
--     skipped:no_value    지금 값 없음(미입력 · 23:00 초기화 뒤)
--     skipped:not_today   오늘(KST) 값이 아님(날짜가 바뀜)
--     skipped:closed      마감(마감은 '확인 필요' 가 아님)
--     skipped:changed     미리보기에서 본 입력 시각과 지금이 다름 — 그 사이 운영자 · 관리자가 입력함
--     skipped:fresh       30분 안에 입력됨(확인 필요 아님)
--     skipped:checked     같은 값을 30분 안에 이미 관리자 확인함(중복 요청 · 다른 관리자) — checked_at = 그 확인 시각
--     confirmed           기록함
--     failed:busy         3초 안에 잠그지 못함(그 부스에 다른 입력이 진행 중) — 그 부스만, 다시 시도하면 됨
--     failed              그 밖의 오류 — 그 부스만(나머지는 계속)
--
--   동시성 — 왜 FOR SHARE 가 아니라 FOR UPDATE 인가
--     · FOR SHARE 는 공유 잠금끼리 서로 막지 않습니다. 두 관리자(또는 같은 요청 두 번)가 같은 부스를 동시에 잡으면
--       둘 다 '아직 확인 없음' 을 보고 둘 다 기록합니다(중복). 운영자 입력은 막지만 관리자끼리는 못 막습니다.
--     · FOR UPDATE 는 관리자 · 운영자 입력(booth_ctrl_set · touch, booth_session_*, admin_set_booth_live, 23:00 초기화)
--       모두와 차례를 지킵니다. 뒤에 온 쪽은 앞 쪽이 끝날 때까지(몇 ms) 기다린 뒤, READ COMMITTED 에서
--       그 줄의 최신 판을 다시 읽고, 다음 문장(이미 확인했는가)도 새 스냅숏으로 봅니다
--       → 늦게 온 관리자는 skipped:checked, 그 사이 운영자가 입력했으면 skipped:changed.
--     · 잠그기만 하고 값 · 시각은 바꾸지 않습니다. 운영자 입력은 관리자 요청이 끝날 때까지만(보통 수 ms) 기다립니다.
--     · 여러 부스는 booth_id 순서로 잠급니다 — 두 관리자 묶음이 서로 엇갈려 잠그는 교착을 막습니다.
--     · lock_timeout 3초 — 오래 걸리는 입력이 있으면 그 부스만 failed:busy 로 넘기고 관리자 요청이 매달리지 않습니다.
--
--   보안 점검 경고
--     두 함수도 authenticated_security_definer_function_executable 로 짚힙니다. 함수 안의 is_admin() 이 막습니다
--     (관리자 화면의 다른 admin_* 함수와 같음). anon 실행 권한은 거둡니다.
--
-- 사용법: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run. 여러 번 실행해도 안전합니다(표 · 기록은 그대로).
--         맨 아래 확인 표의 '맞음' 이 모두 true 여야 합니다.
-- 되돌리기: supabase/rollback-booth-live-check.sql (함수만 지움 · 기록 표는 남김)
-- 트랜잭션: BEGIN/COMMIT 을 넣지 않습니다. SQL Editor 와 apply_migration 은 이미 한 트랜잭션으로
--   돌립니다. psql 은 psql -1 -v ON_ERROR_STOP=1 -f.
-- ===================================================================


-- ═══════════════════════════════════════════════════════════════
-- 0. 선행 조건 검사 (아무것도 바꾸지 않습니다)
-- ═══════════════════════════════════════════════════════════════
do $preflight$
begin
  if to_regclass('public.booth_live') is null
     or to_regclass('public.booths') is null
     or to_regclass('public.staff_profiles') is null
     or to_regprocedure('public.is_admin()') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception '선행 조건 누락: migration-booth-live.sql(booth_live) · is_admin() · auth.uid() 가 있어야 합니다.';
  end if;
end
$preflight$;


-- ═══════════════════════════════════════════════════════════════
-- 1. 표 — 관리자 확인 기록(지우지 않고 쌓기만)
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.booth_live_check (
  id               bigint      generated always as identity primary key,
  batch_id         uuid        not null,
  booth_id         uuid        not null references public.booths(id) on delete cascade,
  seen_updated_at  timestamptz not null,
  seen_congestion  text        not null,
  seen_wait        integer     not null,
  checked_by       uuid        not null,
  checked_at       timestamptz not null default pg_catalog.now()
);

create index if not exists booth_live_check_booth_at_idx
  on public.booth_live_check (booth_id, checked_at desc);

alter table public.booth_live_check enable row level security;
revoke all on table public.booth_live_check from public, anon, authenticated;

comment on table public.booth_live_check is
  '관리자 일괄 확인 기록. booth_live 의 그 값(seen_updated_at)을 관리자(checked_by)가 checked_at 에 현장 확인했다는 표시일 뿐, 현황 값 · 입력 시각을 바꾸지 않습니다. 함수(admin_confirm_booth_live · admin_booth_live_checks)로만 씁니다.';
comment on column public.booth_live_check.seen_updated_at is
  '확인한 값의 booth_live.updated_at. 운영자가 새로 입력하면 updated_at 이 바뀌어 이 확인은 더 이상 지금 값에 붙지 않습니다.';


-- ═══════════════════════════════════════════════════════════════
-- 2. 일괄 확인 — admin_confirm_booth_live(p_items jsonb)
--    p_items: [{ "booth_id": uuid, "seen_updated_at": timestamptz }] 1~100개
-- ═══════════════════════════════════════════════════════════════
drop function if exists public.admin_confirm_booth_live(jsonb);
create function public.admin_confirm_booth_live(p_items jsonb)
returns table (
  booth_id         uuid,
  status           text,
  checked_at       timestamptz,
  live_updated_at  timestamptz,
  batch_id         uuid
)
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
#variable_conflict use_column
declare
  v_uid   uuid := auth.uid();
  v_now   timestamptz := pg_catalog.now();
  v_batch uuid := pg_catalog.gen_random_uuid();
  v_today date;
  v_item  record;
  v_live  record;
  v_prev  timestamptz;
  v_at    timestamptz;
  v_ts    timestamptz;
begin
  if v_uid is null or not public.is_admin() then
    raise exception '관리자만 확인 기록을 남길 수 있습니다.' using errcode = '42501';
  end if;

  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array'
     or pg_catalog.jsonb_array_length(p_items) not between 1 and 100 then
    raise exception '확인할 부스를 1~100곳 골라 주세요.' using errcode = '22023';
  end if;

  -- 형식 검사: 모두 { booth_id: uuid 글자, seen_updated_at: 시각 글자 } — 하나라도 틀리면 아무것도 기록하지 않습니다.
  for v_item in select e.x from pg_catalog.jsonb_array_elements(p_items) as e(x) loop
    if pg_catalog.jsonb_typeof(v_item.x) is distinct from 'object'
       or pg_catalog.jsonb_typeof(v_item.x -> 'booth_id') is distinct from 'string'
       or pg_catalog.jsonb_typeof(v_item.x -> 'seen_updated_at') is distinct from 'string'
       or (v_item.x ->> 'booth_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception '확인 목록 형식이 맞지 않습니다.' using errcode = '22023';
    end if;
    begin
      v_ts := (v_item.x ->> 'seen_updated_at')::timestamptz;
    exception when others then
      raise exception '확인 목록의 시각 형식이 맞지 않습니다.' using errcode = '22023';
    end;
  end loop;

  v_today := (v_now at time zone 'Asia/Seoul')::date;

  -- booth_id 순서로(교착 방지). 같은 부스가 여러 번이면 처음 것만.
  for v_item in
    select (e.x ->> 'booth_id')::uuid                as bid,
           (e.x ->> 'seen_updated_at')::timestamptz  as seen,
           pg_catalog.row_number() over (partition by (e.x ->> 'booth_id')::uuid order by e.n) as k
      from pg_catalog.jsonb_array_elements(p_items) with ordinality as e(x, n)
     order by 1, e.n
  loop
    booth_id := v_item.bid;
    batch_id := v_batch;
    checked_at := null;
    live_updated_at := null;

    if v_item.k > 1 then
      status := 'skipped:duplicate';
      return next;
      continue;
    end if;

    begin
      -- 운영자 입력 · 다른 관리자와 차례를 지키는 잠금(값은 바꾸지 않음)
      select l.congestion, l.wait_minutes, l.updated_at
        into v_live
        from public.booth_live as l
       where l.booth_id = v_item.bid
         for update;

      if not found then
        status := case when exists (select 1 from public.booths as b where b.id = v_item.bid)
                       then 'skipped:no_value' else 'skipped:not_found' end;
      else
        live_updated_at := v_live.updated_at;
        if (v_live.updated_at at time zone 'Asia/Seoul')::date <> v_today then
          status := 'skipped:not_today';
        elsif v_live.congestion = '마감' then
          status := 'skipped:closed';
        elsif v_live.updated_at <> v_item.seen then
          status := 'skipped:changed';
        elsif v_live.updated_at >= v_now - interval '30 minutes' then
          status := 'skipped:fresh';
        else
          select max(c.checked_at) into v_prev
            from public.booth_live_check as c
           where c.booth_id = v_item.bid
             and c.seen_updated_at = v_live.updated_at
             and c.checked_at >= v_now - interval '30 minutes';
          if v_prev is not null then
            status := 'skipped:checked';
            checked_at := v_prev;
          else
            insert into public.booth_live_check as c
                   (batch_id, booth_id, seen_updated_at, seen_congestion, seen_wait, checked_by, checked_at)
            values (v_batch, v_item.bid, v_live.updated_at, v_live.congestion, v_live.wait_minutes, v_uid, v_now)
            returning c.checked_at into v_at;
            status := 'confirmed';
            checked_at := v_at;
          end if;
        end if;
      end if;
    exception
      when lock_not_available then
        status := 'failed:busy';
      when others then
        status := 'failed';
    end;
    return next;
  end loop;
end;
$$;

revoke all     on function public.admin_confirm_booth_live(jsonb) from public;
revoke execute on function public.admin_confirm_booth_live(jsonb) from anon;
grant  execute on function public.admin_confirm_booth_live(jsonb) to authenticated;
comment on function public.admin_confirm_booth_live(jsonb) is
  '관리자 전용. 현장에서 확인한 부스의 지금 값에 확인 기록(booth_live_check)만 남깁니다. booth_live · booth_live_log 는 바꾸지 않습니다(FOR UPDATE 로 잠그기만). 결과는 부스마다 confirmed · skipped:* · failed*.';


-- ═══════════════════════════════════════════════════════════════
-- 3. 관리자 읽기 — admin_booth_live_checks()
--    부스마다 '지금 값(booth_live.updated_at)' 에 대한 오늘(KST)의 마지막 확인. 새 입력이 오면 저절로 빠집니다.
--    30분이 지났는지는 화면이 봅니다(확인 시각 기준 — '확인 필요' 판정과 같은 30분).
-- ═══════════════════════════════════════════════════════════════
drop function if exists public.admin_booth_live_checks();
create function public.admin_booth_live_checks()
returns table (
  booth_id         uuid,
  live_updated_at  timestamptz,
  checked_at       timestamptz,
  checked_by_me    boolean,
  checked_by_name  text,
  batch_id         uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
begin
  if v_uid is null or not public.is_admin() then
    raise exception '관리자만 볼 수 있습니다.' using errcode = '42501';
  end if;

  return query
    select distinct on (c.booth_id)
           c.booth_id,
           l.updated_at,
           c.checked_at,
           c.checked_by = v_uid,
           coalesce(s.name, ''),
           c.batch_id
      from public.booth_live_check as c
      join public.booth_live as l
        on l.booth_id = c.booth_id
       and l.updated_at = c.seen_updated_at
      left join public.staff_profiles as s on s.id = c.checked_by
     where (c.checked_at at time zone 'Asia/Seoul')::date = (v_now at time zone 'Asia/Seoul')::date
     order by c.booth_id, c.checked_at desc;
end;
$$;

revoke all     on function public.admin_booth_live_checks() from public;
revoke execute on function public.admin_booth_live_checks() from anon;
grant  execute on function public.admin_booth_live_checks() to authenticated;
comment on function public.admin_booth_live_checks() is
  '관리자 전용. 부스마다 지금 값에 붙은 오늘(KST)의 마지막 관리자 확인(누가 · 언제). 읽기만 합니다.';

notify pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════
-- 4. 확인 (읽기만 합니다 — '맞음' 이 모두 true 여야 합니다)
-- ═══════════════════════════════════════════════════════════════
select v."항목",
       v."기대",
       v."실제",
       v."기대" = v."실제" as "맞음"
  from (values
    (1, 'booth_live_check 표 · RLS 켬', 'true',
        (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.booth_live_check'::regclass)::text),
    (2, 'booth_live_check 정책 수(함수로만 씀)', '0',
        (select count(*) from pg_catalog.pg_policies p where p.schemaname = 'public' and p.tablename = 'booth_live_check')::text),
    (3, 'booth_live_check 직접 읽기 · 쓰기 (anon · authenticated)', 'false',
        (has_table_privilege('anon', 'public.booth_live_check', 'SELECT')
         or has_table_privilege('anon', 'public.booth_live_check', 'INSERT')
         or has_table_privilege('authenticated', 'public.booth_live_check', 'SELECT')
         or has_table_privilege('authenticated', 'public.booth_live_check', 'INSERT')
         or has_table_privilege('authenticated', 'public.booth_live_check', 'UPDATE')
         or has_table_privilege('authenticated', 'public.booth_live_check', 'DELETE'))::text),
    (4, 'anon 실행 (두 함수 중 하나라도)', 'false',
        (has_function_privilege('anon', 'public.admin_confirm_booth_live(jsonb)', 'EXECUTE')
         or has_function_privilege('anon', 'public.admin_booth_live_checks()', 'EXECUTE'))::text),
    (5, 'authenticated 실행 (두 함수 모두 — 안에서 is_admin)', 'true',
        (has_function_privilege('authenticated', 'public.admin_confirm_booth_live(jsonb)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.admin_booth_live_checks()', 'EXECUTE'))::text),
    (6, 'security definer · search_path 빈 값 · volatile (두 함수)', '2',
        (select count(*)
           from pg_catalog.pg_proc pro
           join pg_catalog.pg_namespace nsp on nsp.oid = pro.pronamespace
          where nsp.nspname = 'public'
            and pro.proname in ('admin_confirm_booth_live', 'admin_booth_live_checks')
            and pro.prosecdef
            and pro.provolatile = 'v'
            and 'search_path=""' = any (pro.proconfig))::text),
    (7, '일괄 확인: FOR UPDATE 잠금 · lock_timeout 3s', 'true',
        ((select pg_catalog.pg_get_functiondef('public.admin_confirm_booth_live(jsonb)'::regprocedure) ~* 'for\s+update')
         and (select 'lock_timeout=3s' = any (pro.proconfig) from pg_catalog.pg_proc pro
               where pro.oid = 'public.admin_confirm_booth_live(jsonb)'::regprocedure))::text),
    (8, '일괄 확인이 booth_live · booth_live_log 를 쓰지 않음', 'false',
        (select pg_catalog.pg_get_functiondef('public.admin_confirm_booth_live(jsonb)'::regprocedure)
                ~* '(insert\s+into|update|delete\s+from)\s+public\.booth_live(_log)?\M')::text),
    (9, '함수 이름마다 정의 1개', 'admin_booth_live_checks 1, admin_confirm_booth_live 1',
        (select string_agg(f.n || ' ' || (select count(*)
                                            from pg_catalog.pg_proc pro
                                            join pg_catalog.pg_namespace nsp on nsp.oid = pro.pronamespace
                                           where nsp.nspname = 'public'
                                             and pro.proname = f.n)::text,
                           ', ' order by f.n collate "C")
           from unnest(array['admin_booth_live_checks', 'admin_confirm_booth_live']) as f(n)))
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";
