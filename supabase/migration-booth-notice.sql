-- ===================================================================
-- 운영자 알림 — 관리자가 보내고, 운영자 화면(QR · PIN)이 15~20초마다 자기 부스 알림만 읽음
--
--   관리자(booth-admin.html)가 '확인 필요 · 미입력 · 구역 · 전체 공개' 부스에 짧은 알림을 보내면,
--   운영자 화면이 열려 있고 보이는 동안 위쪽 띠로 보여 주고, 운영자가 [확인했어요] 를 누르면 기록합니다.
--   상태는 셋뿐입니다: 대기(아직 화면에 안 뜸) · 화면에 표시됨 · 운영자 확인. ‘전달 완료’ 는 없습니다.
--
--   기본은 꺼짐입니다
--     · public.booth_notice_config.enabled = false 로 만듭니다. 꺼져 있으면 관리자는 보낼 수 없고(55000 notice_off),
--       운영자 함수는 빈 목록 + '꺼짐' 만 돌려줍니다. 켜고 끄는 것은 SQL Editor 에서 운영 담당자가 합니다(맨 아래).
--     · 운영자 화면 쪽도 설정(assets/config.js boothNotices)이 켜져 있어야 묻기 시작합니다(booth-live 따로 배포).
--
--   운영 기록은 바꾸지 않습니다
--     · booth_live · booth_live_log · 기존 함수(booth_ctrl_* · booth_session_* · admin_*) · 정책 · 23:00 예약 작업 그대로.
--     · 알림을 보거나 확인해도 혼잡도 · 대기 · 입력 시각은 바뀌지 않습니다(이 파일의 함수는 booth_live 를 쓰지 않음).
--       PIN 세션은 기존 private.booth_session_resolve 로 확인만 합니다(그 함수가 원래 하던 대로 10분에 한 번 last_used_at 을 적을 수 있음).
--
--   이 파일이 더하는 것
--     표 public.booth_notice_config(한 줄 · 켜짐 여부) · public.booth_notice(보낸 알림) · public.booth_notice_target(부스별 표시 · 확인 시각)
--       — 모두 RLS 켬 · 정책 없음 · anon/authenticated 표 권한 없음(함수로만). 부스 외래 키 없음(감사 기록 보존).
--     관리자 public.admin_booth_notice_enabled() · admin_send_booth_notice(...) · admin_booth_notice_status(...)
--     운영자 public.booth_ctrl_notice(p_token, p_action, p_notice_id) · booth_session_notice(p_session, p_action, p_notice_id)
--       p_action: 'list'(내 부스의 아직 확인 안 한 · 만료 전 알림) · 'shown'(화면에 그렸음) · 'ack'(확인했어요)
--       부스는 서버가 QR 열쇠 · PIN 세션에서 정합니다(부스 id 를 받지 않음). 다른 부스 알림 id 는 '없음' 과 똑같이 답합니다.
--
--   반복 발송 제한: 같은 부스에 같은 종류(stale · missing · zone · all)를 10분 안에 다시 보내지 않습니다(skipped:recent).
--     관리자 보내기는 advisory 잠금 하나로 줄을 세워 두 관리자가 같은 순간에 보내도 겹치지 않습니다.
--   대상은 보낼 때 서버가 다시 셉니다(확인 필요 = 오늘 값 · 마감 아님 · 30분 넘게 그대로, 미입력 = 오늘 값 없음, 공개 부스만).
--   알림은 보낸 뒤 3시간 또는 그날(KST) 자정 중 이른 때에 만료됩니다.
--
--   보안 점검 경고: 운영자 함수 둘은 anon 실행이 의도된 것입니다(QR 열쇠 · PIN 세션으로만 동작 — booth_ctrl_* 와 같음).
--   관리자 함수는 authenticated 실행 + 함수 안 is_admin().
--
-- 사용법: SQL Editor 에 전체 붙여넣고 Run. 여러 번 실행해도 안전합니다(표 · 기록 · 켜짐 여부 그대로). 맨 아래 확인 표가 모두 true.
-- 되돌리기: supabase/rollback-booth-notice.sql (함수만 지움 · 기록 표는 남김)
-- 트랜잭션: BEGIN/COMMIT 을 넣지 않습니다(SQL Editor · apply_migration 이 한 트랜잭션). psql 은 psql -1 -v ON_ERROR_STOP=1 -f.
-- ===================================================================


-- ═══════════════════════════════════════════════════════════════
-- 0. 선행 조건 검사
-- ═══════════════════════════════════════════════════════════════
do $preflight$
begin
  if to_regclass('public.booth_live') is null
     or to_regclass('public.booths') is null
     or to_regclass('public.zones') is null
     or to_regclass('public.booth_access') is null
     or to_regclass('public.staff_profiles') is null
     or to_regprocedure('public.is_admin()') is null
     or to_regprocedure('auth.uid()') is null
     or to_regprocedure('private.booth_session_resolve(text, boolean)') is null then
    raise exception '선행 조건 누락: booth_live · booth_access · is_admin() · auth.uid() · private.booth_session_resolve(PIN) 가 있어야 합니다.';
  end if;
end
$preflight$;


-- ═══════════════════════════════════════════════════════════════
-- 1. 표
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.booth_notice_config (
  id          smallint    primary key default 1 check (id = 1),
  enabled     boolean     not null default false,
  updated_at  timestamptz not null default pg_catalog.now()
);
insert into public.booth_notice_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.booth_notice (
  id               bigint      generated always as identity primary key,
  kind             text        not null,
  body             text        not null check (char_length(body) between 1 and 120),
  zone_key         text,
  created_by       uuid        not null,
  created_by_name  text        not null default '',
  created_at       timestamptz not null default pg_catalog.now(),
  expires_at       timestamptz not null
);

-- 부스 외래 키를 걸지 않습니다(부스를 지워도 보낸 기록이 남게) — 그때의 부스번호 · 이름을 함께 둡니다.
create table if not exists public.booth_notice_target (
  notice_id      bigint      not null references public.booth_notice(id) on delete cascade,
  booth_id       uuid        not null,
  booth_code     text        not null default '',
  booth_name     text        not null default '',
  shown_at       timestamptz,
  shown_via      text        check (shown_via in ('qr', 'pin')),
  acked_at       timestamptz,
  acked_via      text        check (acked_via in ('qr', 'pin')),
  acked_session  uuid,
  primary key (notice_id, booth_id)
);
-- 종류: stale(확인 필요) · missing(미입력) · zone(구역) · all(전체 공개) · booth(부스 1곳). 다시 실행해도 같은 제약 하나만 남게 지우고 다시 겁니다.
alter table public.booth_notice drop constraint if exists booth_notice_kind_check;
alter table public.booth_notice add constraint booth_notice_kind_check check (kind in ('stale', 'missing', 'zone', 'all', 'booth'));
create index if not exists booth_notice_target_booth_idx on public.booth_notice_target (booth_id, notice_id desc);
create index if not exists booth_notice_created_idx on public.booth_notice (created_at desc);

alter table public.booth_notice_config enable row level security;
alter table public.booth_notice        enable row level security;
alter table public.booth_notice_target enable row level security;
revoke all on table public.booth_notice_config from public, anon, authenticated;
revoke all on table public.booth_notice        from public, anon, authenticated;
revoke all on table public.booth_notice_target from public, anon, authenticated;

comment on table public.booth_notice_config is '운영자 알림 켜짐 여부(한 줄). 기본 꺼짐. SQL Editor 에서 운영 담당자만 바꿉니다.';
comment on table public.booth_notice is '관리자가 보낸 운영자 알림. 현황 값(booth_live)과 별개입니다.';
comment on table public.booth_notice_target is '알림 받는 부스별 상태 — shown_at(운영자 화면에 그려짐) · acked_at(운영자가 확인했어요). 대기 = 둘 다 없음.';


-- ═══════════════════════════════════════════════════════════════
-- 2. 안쪽 도우미(private — 바깥에서 부르지 못함)
-- ═══════════════════════════════════════════════════════════════
create or replace function private.booth_notice_on()
returns boolean language sql stable set search_path = ''
as $$ select coalesce((select c.enabled from public.booth_notice_config c where c.id = 1), false) $$;
revoke all on function private.booth_notice_on() from public;

-- 부스 하나의 알림 처리(운영자 함수 둘이 부스를 정한 뒤 부름). booth_live 를 읽지도 쓰지도 않습니다.
create or replace function private.booth_notice_op(p_booth uuid, p_via text, p_session uuid, p_action text, p_notice_id bigint)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_now  timestamptz := pg_catalog.now();
  v_list jsonb;
  v_n    integer;
begin
  if p_action is null or p_action not in ('list', 'shown', 'ack') then
    raise exception '허용되지 않는 요청입니다.' using errcode = '22023';
  end if;
  if not private.booth_notice_on() then
    return pg_catalog.jsonb_build_object('enabled', false, 'poll_ms', 300000, 'ok', false, 'notices', '[]'::jsonb);
  end if;

  if p_action = 'list' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', x.id, 'kind', x.kind, 'body', x.body, 'created_at', x.created_at, 'shown', x.shown_at is not null)
             order by x.created_at desc), '[]'::jsonb)
      into v_list
      from (select n.id, n.kind, n.body, n.created_at, t.shown_at
              from public.booth_notice_target t
              join public.booth_notice n on n.id = t.notice_id
             where t.booth_id = p_booth
               and t.acked_at is null
               and n.expires_at > v_now
             order by n.created_at desc
             limit 5) x;
    return pg_catalog.jsonb_build_object('enabled', true, 'poll_ms', 18000, 'ok', true, 'notices', v_list);
  end if;

  if p_notice_id is null then
    raise exception '알림을 고르지 않았습니다.' using errcode = '22023';
  end if;

  if p_action = 'shown' then
    update public.booth_notice_target as t
       set shown_at  = coalesce(t.shown_at, v_now),
           shown_via = coalesce(t.shown_via, p_via)
     where t.notice_id = p_notice_id and t.booth_id = p_booth;
  else
    update public.booth_notice_target as t
       set acked_at      = coalesce(t.acked_at, v_now),
           acked_via     = coalesce(t.acked_via, p_via),
           acked_session = coalesce(t.acked_session, p_session),
           shown_at      = coalesce(t.shown_at, v_now),
           shown_via     = coalesce(t.shown_via, p_via)
     where t.notice_id = p_notice_id and t.booth_id = p_booth;
  end if;
  get diagnostics v_n = row_count;
  -- 다른 부스의 알림 id 와 없는 id 를 똑같이 답합니다(있는지조차 알 수 없게).
  return pg_catalog.jsonb_build_object('enabled', true, 'poll_ms', 18000, 'ok', v_n > 0);
end;
$$;
revoke all on function private.booth_notice_op(uuid, text, uuid, text, bigint) from public;


-- ═══════════════════════════════════════════════════════════════
-- 3. 운영자 함수(anon) — QR 열쇠 · PIN 세션으로만. 부스 id 를 받지 않습니다.
-- ═══════════════════════════════════════════════════════════════
drop function if exists public.booth_ctrl_notice(text, text, bigint);
create function public.booth_ctrl_notice(p_token text, p_action text, p_notice_id bigint default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_booth uuid;
begin
  -- GET · HEAD 로는 아무것도 하지 않습니다(주소에 열쇠가 실려 캐시 · 기록에 남는 길을 막음 — booth_ctrl_get 과 같은 규칙).
  if coalesce(pg_catalog.current_setting('request.method', true), '') in ('GET', 'HEAD') then
    raise exception '허용되지 않는 요청입니다.' using errcode = '42501', hint = 'booth_token_invalid';
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{24}$' then
    raise exception '이 QR은 쓸 수 없습니다.' using errcode = '42501', hint = 'booth_token_invalid';
  end if;
  select a.booth_id into v_booth from public.booth_access a where a.token = p_token and a.disabled_at is null;
  if v_booth is null then
    raise exception '이 QR은 쓸 수 없습니다.' using errcode = '42501', hint = 'booth_token_invalid';
  end if;
  return private.booth_notice_op(v_booth, 'qr', null, p_action, p_notice_id);
end;
$$;
revoke all     on function public.booth_ctrl_notice(text, text, bigint) from public;
grant  execute on function public.booth_ctrl_notice(text, text, bigint) to anon, authenticated;
comment on function public.booth_ctrl_notice(text, text, bigint) is
  '운영자 알림(QR). 부스 QR 열쇠로만 동작합니다. anon 실행 권한은 의도된 것입니다 — 보안 점검 경고를 보고 거두지 마세요. booth_live 는 바꾸지 않습니다.';

drop function if exists public.booth_session_notice(text, text, bigint);
create function public.booth_session_notice(p_session text, p_action text, p_notice_id bigint default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if coalesce(pg_catalog.current_setting('request.method', true), '') in ('GET', 'HEAD') then
    raise exception '허용되지 않는 요청입니다.' using errcode = '42501', hint = 'booth_session_invalid';
  end if;
  -- 세션 확인은 기존 함수 그대로(끝난 · 바뀐 · 만료 · 비공개 부스면 42501 + 같은 hint)
  select x.session_id, x.booth_id into r from private.booth_session_resolve(p_session, false) x;
  return private.booth_notice_op(r.booth_id, 'pin', r.session_id, p_action, p_notice_id);
end;
$$;
revoke all     on function public.booth_session_notice(text, text, bigint) from public;
grant  execute on function public.booth_session_notice(text, text, bigint) to anon, authenticated;
comment on function public.booth_session_notice(text, text, bigint) is
  '운영자 알림(PIN). PIN 세션으로만 동작합니다. anon 실행 권한은 의도된 것입니다. booth_live 는 바꾸지 않습니다.';


-- ═══════════════════════════════════════════════════════════════
-- 4. 관리자 함수
-- ═══════════════════════════════════════════════════════════════
drop function if exists public.admin_booth_notice_enabled();
create function public.admin_booth_notice_enabled()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception '관리자만 볼 수 있습니다.' using errcode = '42501';
  end if;
  return private.booth_notice_on();
end;
$$;
revoke all     on function public.admin_booth_notice_enabled() from public;
revoke execute on function public.admin_booth_notice_enabled() from anon;
grant  execute on function public.admin_booth_notice_enabled() to authenticated;

-- 보내기. p_kind: stale · missing · zone(p_zone 필요) · all · booth(p_booth_ids 에 정확히 1곳). p_booth_ids: 그 대상 안에서 고른 부스(null 이면 대상 전부).
-- p_body: 120자 안(앞뒤 · 여러 칸 공백은 한 칸으로). stale · missing 은 비우면 정해진 문구.
-- 돌려줌: 부스마다 queued · skipped:recent(10분 안에 같은 종류 받음) · skipped:not_target(지금 대상이 아님).
drop function if exists public.admin_send_booth_notice(text, text, uuid[], text);
create function public.admin_send_booth_notice(p_kind text, p_zone text, p_booth_ids uuid[], p_body text)
returns table (booth_id uuid, booth_code text, status text, notice_id bigint)
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
#variable_conflict use_column
declare
  v_uid    uuid := auth.uid();
  v_now    timestamptz := pg_catalog.now();
  v_today  date := (pg_catalog.now() at time zone 'Asia/Seoul')::date;
  v_body   text;
  v_name   text;
  v_notice bigint;
  v_exp    timestamptz;
  v_rows   jsonb;
begin
  if v_uid is null or not public.is_admin() then
    raise exception '관리자만 보낼 수 있습니다.' using errcode = '42501';
  end if;
  if not private.booth_notice_on() then
    raise exception '운영자 알림이 꺼져 있습니다.' using errcode = '55000', hint = 'notice_off';
  end if;
  if p_kind is null or p_kind not in ('stale', 'missing', 'zone', 'all', 'booth') then
    raise exception '알림 종류가 맞지 않습니다.' using errcode = '22023';
  end if;
  if p_kind = 'booth' and (p_booth_ids is null or pg_catalog.cardinality(p_booth_ids) <> 1 or p_booth_ids[1] is null) then
    raise exception '부스 1곳을 골라 주세요.' using errcode = '22023';
  end if;
  if p_kind = 'zone' and (p_zone is null or not exists (select 1 from public.zones z where z.key = p_zone and z.is_published)) then
    raise exception '공개된 구역을 골라 주세요.' using errcode = '22023';
  end if;
  if p_booth_ids is not null and pg_catalog.cardinality(p_booth_ids) > 200 then
    raise exception '한 번에 200곳까지 보낼 수 있습니다.' using errcode = '22023';
  end if;

  v_body := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'));
  if v_body = '' then
    v_body := case p_kind
      when 'stale'   then '대기 상태가 30분 넘게 그대로예요. 지금 상태를 다시 눌러 주세요.'
      when 'missing' then '오늘 대기 상태가 아직 없어요. 지금 상태를 눌러 주세요.'
      else '' end;
  end if;
  if v_body = '' or pg_catalog.char_length(v_body) > 120 then
    raise exception '알림 문구는 1~120자여야 합니다.' using errcode = '22023';
  end if;

  -- 관리자 보내기끼리 줄 세우기(같은 순간 두 관리자가 보내도 10분 제한이 겹치지 않게). 최대 3초.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('public.admin_send_booth_notice'));

  select coalesce(nullif(s.name, ''), '') into v_name from public.staff_profiles s where s.id = v_uid;
  v_exp := least(v_now + interval '3 hours', ((v_today + 1)::timestamp at time zone 'Asia/Seoul'));

  -- 부스마다 결과를 한 번에 정합니다(임시 표 없이) — 지금 대상(공개 부스 + 종류별 조건) · 10분 안에 받음 · 고른 부스 중 대상 아님
  with cand as (
    select b.id as bid,
           coalesce(nullif(b.code, ''), b.zone_key || '-' || lpad(b.no::text, greatest(2, length(b.no::text)), '0')) as code,
           b.name
      from public.booths b
      join public.zones z on z.key = b.zone_key and z.is_published
      left join public.booth_live l on l.booth_id = b.id
                                   and (l.updated_at at time zone 'Asia/Seoul')::date = v_today
     where b.is_published and b.no is not null
       and (p_booth_ids is null or b.id = any (p_booth_ids))
       and case p_kind
             when 'stale'   then l.booth_id is not null and l.congestion <> '마감' and l.updated_at < v_now - interval '30 minutes'
             when 'missing' then l.booth_id is null
             when 'zone'    then b.zone_key = p_zone
             else true end   -- all · booth(위 p_booth_ids 로 1곳)
  ), picks as (
    select c.bid, c.code, c.name,
           case when exists (select 1 from public.booth_notice_target t join public.booth_notice n on n.id = t.notice_id
                              where t.booth_id = c.bid and n.kind = p_kind and n.created_at > v_now - interval '10 minutes')
                then 'skipped:recent' else 'queued' end as status
      from cand c
    union all
    select u.x,
           coalesce((select coalesce(nullif(b.code, ''), b.zone_key || '-' || lpad(b.no::text, greatest(2, length(b.no::text)), '0'))
                       from public.booths b where b.id = u.x), ''),
           '', 'skipped:not_target'
      from (select distinct unnest(p_booth_ids) as x) u
     where p_booth_ids is not null and not exists (select 1 from cand c where c.bid = u.x)
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('bid', p.bid, 'code', coalesce(p.code, ''), 'name', coalesce(p.name, ''), 'status', p.status)
                                       order by p.code, p.bid), '[]'::jsonb)
    into v_rows
    from picks p;

  if exists (select 1 from pg_catalog.jsonb_array_elements(v_rows) e where e ->> 'status' = 'queued') then
    insert into public.booth_notice as n (kind, body, zone_key, created_by, created_by_name, created_at, expires_at)
    values (p_kind, v_body, case when p_kind = 'zone' then p_zone end, v_uid, coalesce(v_name, ''), v_now, v_exp)
    returning n.id into v_notice;
    insert into public.booth_notice_target (notice_id, booth_id, booth_code, booth_name)
    select v_notice, (e ->> 'bid')::uuid, e ->> 'code', e ->> 'name'
      from pg_catalog.jsonb_array_elements(v_rows) e
     where e ->> 'status' = 'queued';
  end if;

  return query
    select (e ->> 'bid')::uuid, e ->> 'code', e ->> 'status', case when e ->> 'status' = 'queued' then v_notice end
      from pg_catalog.jsonb_array_elements(v_rows) with ordinality as x(e, n)
     order by x.n;
end;
$$;
revoke all     on function public.admin_send_booth_notice(text, text, uuid[], text) from public;
revoke execute on function public.admin_send_booth_notice(text, text, uuid[], text) from anon;
grant  execute on function public.admin_send_booth_notice(text, text, uuid[], text) to authenticated;
comment on function public.admin_send_booth_notice(text, text, uuid[], text) is
  '관리자 전용. 운영자 알림 보내기(꺼져 있으면 55000 notice_off). 대상은 서버가 다시 셈 · 같은 부스 같은 종류 10분 안 다시 안 보냄. booth_live 는 바꾸지 않습니다.';

-- 상태: 최근 p_hours 시간(1~48) 동안 보낸 알림의 부스별 상태. state = waiting(대기) · shown(화면에 표시됨) · acked(운영자 확인) · expired(대기인 채로 만료)
drop function if exists public.admin_booth_notice_status(integer);
create function public.admin_booth_notice_status(p_hours integer default 12)
returns table (notice_id bigint, kind text, body text, zone_key text, created_at timestamptz, created_by_name text,
               expires_at timestamptz, booth_id uuid, booth_code text, booth_name text, shown_at timestamptz, acked_at timestamptz, state text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception '관리자만 볼 수 있습니다.' using errcode = '42501';
  end if;
  return query
    select n.id, n.kind, n.body, n.zone_key, n.created_at, n.created_by_name, n.expires_at,
           t.booth_id, t.booth_code, t.booth_name, t.shown_at, t.acked_at,
           case when t.acked_at is not null then 'acked'
                when t.shown_at is not null then 'shown'
                when n.expires_at <= pg_catalog.now() then 'expired'
                else 'waiting' end
      from public.booth_notice n
      join public.booth_notice_target t on t.notice_id = n.id
     where n.created_at > pg_catalog.now() - pg_catalog.make_interval(hours => least(greatest(coalesce(p_hours, 12), 1), 48))
     order by n.created_at desc, t.booth_code;
end;
$$;
revoke all     on function public.admin_booth_notice_status(integer) from public;
revoke execute on function public.admin_booth_notice_status(integer) from anon;
grant  execute on function public.admin_booth_notice_status(integer) to authenticated;

notify pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════
-- 5. 확인(읽기만 — '맞음' 이 모두 true)
-- ═══════════════════════════════════════════════════════════════
select v."항목", v."기대", v."실제", v."기대" = v."실제" as "맞음"
  from (values
    (1, '세 표 모두 RLS 켬', 'true',
        (select bool_and(c.relrowsecurity) from pg_catalog.pg_class c
          where c.oid in ('public.booth_notice_config'::regclass, 'public.booth_notice'::regclass, 'public.booth_notice_target'::regclass))::text),
    (2, '세 표의 정책 수', '0',
        (select count(*) from pg_catalog.pg_policies p where p.schemaname = 'public'
            and p.tablename in ('booth_notice_config', 'booth_notice', 'booth_notice_target'))::text),
    (3, '세 표 직접 읽기 · 쓰기(anon · authenticated)', 'false',
        (select bool_or(has_table_privilege(r, t, pr))
           from unnest(array['anon', 'authenticated']) r,
                unnest(array['public.booth_notice_config', 'public.booth_notice', 'public.booth_notice_target']) t,
                unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) pr)::text),
    (4, '기본 꺼짐(처음 적용 때)', 'false',
        (select c.enabled from public.booth_notice_config c where c.id = 1)::text),
    (5, '운영자 함수 anon 실행(둘 다)', 'true',
        (has_function_privilege('anon', 'public.booth_ctrl_notice(text,text,bigint)', 'EXECUTE')
         and has_function_privilege('anon', 'public.booth_session_notice(text,text,bigint)', 'EXECUTE'))::text),
    (6, '관리자 함수 anon 실행(셋 중 하나라도)', 'false',
        (has_function_privilege('anon', 'public.admin_booth_notice_enabled()', 'EXECUTE')
         or has_function_privilege('anon', 'public.admin_send_booth_notice(text,text,uuid[],text)', 'EXECUTE')
         or has_function_privilege('anon', 'public.admin_booth_notice_status(integer)', 'EXECUTE'))::text),
    (7, '관리자 함수 authenticated 실행(셋 다 — 안에서 is_admin)', 'true',
        (has_function_privilege('authenticated', 'public.admin_booth_notice_enabled()', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.admin_send_booth_notice(text,text,uuid[],text)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.admin_booth_notice_status(integer)', 'EXECUTE'))::text),
    (8, '안쪽 도우미 바깥 실행(anon · authenticated)', 'false',
        (has_function_privilege('anon', 'private.booth_notice_op(uuid,text,uuid,text,bigint)', 'EXECUTE')
         or has_function_privilege('authenticated', 'private.booth_notice_op(uuid,text,uuid,text,bigint)', 'EXECUTE')
         or has_function_privilege('anon', 'private.booth_notice_on()', 'EXECUTE'))::text),
    (9, '새 함수가 booth_live · booth_live_log 를 쓰지 않음', 'false',
        (select bool_or(pg_catalog.pg_get_functiondef(f::regprocedure) ~* '(insert\s+into|update|delete\s+from)\s+public\.booth_live(_log)?\M')
           from unnest(array['public.booth_ctrl_notice(text,text,bigint)', 'public.booth_session_notice(text,text,bigint)',
                             'private.booth_notice_op(uuid,text,uuid,text,bigint)', 'public.admin_send_booth_notice(text,text,uuid[],text)',
                             'public.admin_booth_notice_status(integer)', 'public.admin_booth_notice_enabled()']) f)::text),
    (10, 'security definer · search_path 빈 값(공개 함수 다섯)', '5',
        (select count(*) from pg_catalog.pg_proc pro join pg_catalog.pg_namespace nsp on nsp.oid = pro.pronamespace
          where nsp.nspname = 'public'
            and pro.proname in ('booth_ctrl_notice', 'booth_session_notice', 'admin_booth_notice_enabled', 'admin_send_booth_notice', 'admin_booth_notice_status')
            and pro.prosecdef and 'search_path=""' = any (pro.proconfig))::text),
    (11, '알림 표에 부스 외래 키 없음', '0',
        (select count(*) from pg_catalog.pg_constraint con
          where con.conrelid = 'public.booth_notice_target'::regclass and con.contype = 'f' and con.confrelid = 'public.booths'::regclass)::text)
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";

-- ── 켜기 · 끄기(운영 담당자 · 따로 실행) ──────────────────────────────
-- 켜기:  update public.booth_notice_config set enabled = true,  updated_at = now() where id = 1;
-- 끄기:  update public.booth_notice_config set enabled = false, updated_at = now() where id = 1;
-- 끄면 바로(다음 묻기부터) 운영자 화면의 알림 띠가 사라지고, 관리자 보내기가 막힙니다. 보낸 기록은 남습니다.
