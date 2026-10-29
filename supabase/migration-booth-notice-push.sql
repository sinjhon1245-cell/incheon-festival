-- ===================================================================
-- 운영자 알림 — 30분 유효 · 짧은 기본 문구 · 휴대전화 시스템 알림(Web Push) 추가 SQL
--
--   migration-booth-notice.sql · migration-booth-notice-rehearsal.sql 위에 덧붙입니다(처음 설치 SQL 을 다시 돌리지 않음).
--   · 새로 보내는 알림은 30분(그날 자정이 먼저면 자정)에 만료. 10분 같은 종류 제한은 그대로(따로 셈).
--   · 문구를 비우면 모든 종류가 '다시 확인해 주세요.'
--   · 만료된 알림은 운영자 목록에서 빠지고, 만료 뒤의 ‘화면에 표시됨’ · ‘확인했어요’ 요청은 기록하지 않음(expired 로 답함).
--   · Web Push: 운영자 기기 구독(booth_push_sub)은 QR 열쇠 · PIN 세션으로만 등록(부스 id 를 받지 않음).
--     보낼 때(관리자 → Vercel /api/notice-push) 서버가 그 알림을 받은 부스의, 아직 유효한 QR · PIN 으로 등록된 구독만 돌려줌.
--     켜짐은 booth_notice_config.push_enabled(기본 false) — 알림 스위치 enabled · 리허설 모드 rehearsal_only 와 따로입니다.
--   · 대기 값(booth_live) · 기존 알림 기록 · 리허설 모드 · 서버 스위치는 바꾸지 않습니다.
--
-- 사용법: SQL Editor 에 전체 붙여넣고 Run(한 트랜잭션). 여러 번 실행해도 같습니다. 맨 아래 확인 표 모두 true.
-- Web Push 켜기(따로 승인 · Vercel 키 등록 뒤): update public.booth_notice_config set push_enabled = true, updated_at = now() where id = 1;
-- 되돌리기: supabase/rollback-booth-notice-push.sql
-- ===================================================================

do $preflight$
begin
  if to_regprocedure('public.admin_booth_notice_mode()') is null
     or to_regprocedure('private.booth_notice_rehearsal_only()') is null
     or to_regprocedure('private.booth_common_pin_target(uuid)') is null
     or to_regprocedure('extensions.digest(text, text)') is null then
    raise exception '선행 조건 누락: migration-booth-notice.sql · migration-booth-notice-rehearsal.sql 을 먼저 적용해야 합니다(pgcrypto 필요).';
  end if;
end
$preflight$;

-- ── 표 · 칸 ────────────────────────────────────────────────────────
alter table public.booth_notice_config add column if not exists push_enabled boolean not null default false;
comment on column public.booth_notice_config.push_enabled is
  '휴대전화 시스템 알림(Web Push) 켜짐. 기본 false. enabled(알림 전체) · rehearsal_only(보내기 범위)와 별개 — 셋 다 켜져야 시스템 알림이 갑니다.';

alter table public.booth_notice_target add column if not exists push_sent_at timestamptz;
alter table public.booth_notice_target add column if not exists push_result text;
comment on column public.booth_notice_target.push_sent_at is '시스템 알림을 푸시 서비스가 받은 시각(기기 표시 · 운영자 확인과 다름).';

-- 운영자 기기 구독. 부스 외래 키 없음(다른 알림 표와 같음). 같은 기기 주소(endpoint)는 한 줄 — 다른 부스로 다시 등록하면 그 부스로 옮김.
create table if not exists public.booth_push_sub (
  id          bigint      generated always as identity primary key,
  booth_id    uuid        not null,
  via         text        not null check (via in ('qr', 'pin')),
  session_id  uuid,
  token_hash  bytea,
  endpoint    text        not null unique check (endpoint ~ '^https://' and pg_catalog.char_length(endpoint) <= 1000),
  p256dh      text        not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth        text        not null check (auth ~ '^[A-Za-z0-9_-]{16,32}$'),
  created_at  timestamptz not null default pg_catalog.now(),
  updated_at  timestamptz not null default pg_catalog.now(),
  fail_count  integer     not null default 0,
  disabled_at timestamptz,
  check ((via = 'qr' and token_hash is not null) or (via = 'pin' and session_id is not null))
);
create index if not exists booth_push_sub_booth_idx on public.booth_push_sub (booth_id);
alter table public.booth_push_sub enable row level security;
revoke all on table public.booth_push_sub from public, anon, authenticated;
comment on table public.booth_push_sub is '운영자 기기의 Web Push 구독. QR · PIN 함수로만 등록 · 해제. 관리자 · 공개 화면에서 직접 못 읽음.';

create or replace function private.booth_push_on()
returns boolean language sql stable set search_path = ''
as $$ select coalesce((select c.enabled and c.push_enabled from public.booth_notice_config c where c.id = 1), false) $$;
revoke all on function private.booth_push_on() from public;

-- ── 운영자 알림 처리 — 만료된 알림은 ‘화면에 표시됨’ · ‘확인했어요’ 를 기록하지 않음 ─────────────
-- (migration-booth-notice.sql 2 와 같고, 목록에 expires_at · shown · ack 에 ‘만료 전’ 조건과 expired 답만 더했습니다)
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
             'id', x.id, 'kind', x.kind, 'body', x.body, 'created_at', x.created_at, 'expires_at', x.expires_at, 'shown', x.shown_at is not null)
             order by x.created_at desc), '[]'::jsonb)
      into v_list
      from (select n.id, n.kind, n.body, n.created_at, n.expires_at, t.shown_at
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
     where t.notice_id = p_notice_id and t.booth_id = p_booth
       and exists (select 1 from public.booth_notice n where n.id = t.notice_id and n.expires_at > v_now);
  else
    update public.booth_notice_target as t
       set acked_at      = coalesce(t.acked_at, v_now),
           acked_via     = coalesce(t.acked_via, p_via),
           acked_session = coalesce(t.acked_session, p_session),
           shown_at      = coalesce(t.shown_at, v_now),
           shown_via     = coalesce(t.shown_via, p_via)
     where t.notice_id = p_notice_id and t.booth_id = p_booth
       and exists (select 1 from public.booth_notice n where n.id = t.notice_id and n.expires_at > v_now);
  end if;
  get diagnostics v_n = row_count;
  -- 내 부스 알림인데 만료됐으면 expired(아무것도 적지 않음). 다른 부스의 알림 id 와 없는 id 는 전처럼 똑같이 답합니다.
  if v_n = 0 and exists (select 1 from public.booth_notice_target t where t.notice_id = p_notice_id and t.booth_id = p_booth) then
    return pg_catalog.jsonb_build_object('enabled', true, 'poll_ms', 18000, 'ok', false, 'expired', true);
  end if;
  return pg_catalog.jsonb_build_object('enabled', true, 'poll_ms', 18000, 'ok', v_n > 0);
end;
$$;
revoke all on function private.booth_notice_op(uuid, text, uuid, text, bigint) from public;

-- 보내기(같은 이름 · 같은 인자 — 권한 그대로). 리허설 판에서 바뀐 곳: 만료 30분 · 비운 문구는 모든 종류가 '다시 확인해 주세요.'
create or replace function public.admin_send_booth_notice(p_kind text, p_zone text, p_booth_ids uuid[], p_body text)
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
  -- 리허설 모드(booth_notice_config.rehearsal_only, 기본 true): 부스 1곳(kind booth · id 하나)만. 화면을 거치지 않은 직접 호출도 여기서 막습니다.
  if private.booth_notice_rehearsal_only() and p_kind <> 'booth' then
    raise exception '리허설 모드에서는 부스 1곳만 보낼 수 있습니다.' using errcode = '55000', hint = 'rehearsal_only';
  end if;
  if p_kind = 'zone' and (p_zone is null or not exists (select 1 from public.zones z where z.key = p_zone and z.is_published)) then
    raise exception '공개된 구역을 골라 주세요.' using errcode = '22023';
  end if;
  if p_booth_ids is not null and pg_catalog.cardinality(p_booth_ids) > 200 then
    raise exception '한 번에 200곳까지 보낼 수 있습니다.' using errcode = '22023';
  end if;

  v_body := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'));
  if v_body = '' then
    v_body := '다시 확인해 주세요.';
  end if;
  if v_body = '' or pg_catalog.char_length(v_body) > 120 then
    raise exception '알림 문구는 1~120자여야 합니다.' using errcode = '22023';
  end if;

  -- 관리자 보내기끼리 줄 세우기(같은 순간 두 관리자가 보내도 10분 제한이 겹치지 않게). 최대 3초.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('public.admin_send_booth_notice'));

  select coalesce(nullif(s.name, ''), '') into v_name from public.staff_profiles s where s.id = v_uid;
  v_exp := least(v_now + interval '30 minutes', ((v_today + 1)::timestamp at time zone 'Asia/Seoul'));

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

  -- 리허설 모드: 실제로 보낼 부스가 1곳을 넘으면(있을 수 없지만) 아무것도 기록하지 않고 거절
  if private.booth_notice_rehearsal_only()
     and (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_rows) e where e ->> 'status' = 'queued') > 1 then
    raise exception '리허설 모드에서는 부스 1곳만 보낼 수 있습니다.' using errcode = '55000', hint = 'rehearsal_only';
  end if;

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
  '관리자 전용. 운영자 알림 보내기(꺼져 있으면 55000 notice_off · 리허설 모드에서 부스 1곳이 아니면 55000 rehearsal_only). 대상은 서버가 다시 셈 · 같은 부스 같은 종류 10분 안 다시 안 보냄 · 30분(또는 자정)에 만료. booth_live 는 바꾸지 않습니다.';

-- ── 관리자 현황 — 시스템 알림 보낸 시각(push_sent_at)을 한 칸 더(돌려주는 모양이 바뀌어 지우고 다시 만듦) ──
drop function if exists public.admin_booth_notice_status(integer);
create function public.admin_booth_notice_status(p_hours integer default 12)
returns table (notice_id bigint, kind text, body text, zone_key text, created_at timestamptz, created_by_name text,
               expires_at timestamptz, booth_id uuid, booth_code text, booth_name text, shown_at timestamptz, acked_at timestamptz, state text,
               push_sent_at timestamptz)
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
                else 'waiting' end,
           t.push_sent_at
      from public.booth_notice n
      join public.booth_notice_target t on t.notice_id = n.id
     where n.created_at > pg_catalog.now() - pg_catalog.make_interval(hours => least(greatest(coalesce(p_hours, 12), 1), 48))
     order by n.created_at desc, t.booth_code;
end;
$$;
revoke all     on function public.admin_booth_notice_status(integer) from public;
revoke execute on function public.admin_booth_notice_status(integer) from anon;
grant  execute on function public.admin_booth_notice_status(integer) to authenticated;

-- ── 운영자 기기 구독(부스는 QR 열쇠 · PIN 세션으로 서버가 정함) ─────────────────
create or replace function private.booth_push_op(p_booth uuid, p_via text, p_session uuid, p_token_hash bytea, p_action text, p_sub jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_ep text := p_sub ->> 'endpoint';
  v_p  text := p_sub #>> '{keys,p256dh}';
  v_a  text := p_sub #>> '{keys,auth}';
  v_n  integer;
begin
  if p_action is null or p_action not in ('subscribe', 'unsubscribe', 'status') then
    raise exception '허용되지 않는 요청입니다.' using errcode = '22023';
  end if;
  -- status: 시스템 알림이 켜져 있는지 · 이 기기(주소)가 지금 이 열쇠 · 세션으로 이 부스 알림을 받는지만(다른 부스 구독은 알려 주지 않음)
  if p_action = 'status' then
    return pg_catalog.jsonb_build_object('ok', true, 'push', private.booth_push_on(), 'mine',
      v_ep is not null and exists (select 1 from public.booth_push_sub s
                                    where s.endpoint = v_ep and s.booth_id = p_booth and s.disabled_at is null and s.via = p_via
                                      and ((p_via = 'qr' and s.token_hash = p_token_hash) or (p_via = 'pin' and s.session_id = p_session))));
  end if;
  -- 브라우저 푸시 서비스 주소만(FCM · Mozilla · Windows · Apple · Samsung). 아무 주소로나 보내지 않게.
  if v_ep is null or pg_catalog.char_length(v_ep) > 1000
     or v_ep !~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.samsungosp\.com)/' then
    raise exception '알림 주소가 맞지 않습니다.' using errcode = '22023';
  end if;
  if p_action = 'unsubscribe' then
    delete from public.booth_push_sub s where s.endpoint = v_ep and s.booth_id = p_booth;
    get diagnostics v_n = row_count;
    return pg_catalog.jsonb_build_object('ok', v_n > 0, 'push', private.booth_push_on());
  end if;
  -- 켜져 있을 때만 새 구독을 받습니다(꺼진 동안 기기가 쌓이지 않게)
  if not private.booth_push_on() then
    return pg_catalog.jsonb_build_object('ok', false, 'push', false);
  end if;
  if v_p is null or v_p !~ '^[A-Za-z0-9_-]{80,100}$' or v_a is null or v_a !~ '^[A-Za-z0-9_-]{16,32}$' then
    raise exception '알림 열쇠가 맞지 않습니다.' using errcode = '22023';
  end if;
  insert into public.booth_push_sub as s (booth_id, via, session_id, token_hash, endpoint, p256dh, auth)
  values (p_booth, p_via, p_session, p_token_hash, v_ep, v_p, v_a)
  on conflict (endpoint) do update
     set booth_id = excluded.booth_id, via = excluded.via, session_id = excluded.session_id, token_hash = excluded.token_hash,
         p256dh = excluded.p256dh, auth = excluded.auth, updated_at = pg_catalog.now(), fail_count = 0, disabled_at = null;
  -- 한 부스에 기기 20대까지(오래된 것부터 지움)
  delete from public.booth_push_sub s
   where s.booth_id = p_booth
     and s.id not in (select s2.id from public.booth_push_sub s2 where s2.booth_id = p_booth order by s2.updated_at desc, s2.id desc limit 20);
  return pg_catalog.jsonb_build_object('ok', true, 'push', true);
end;
$$;
revoke all on function private.booth_push_op(uuid, text, uuid, bytea, text, jsonb) from public;

drop function if exists public.booth_ctrl_push(text, text, jsonb);
create function public.booth_ctrl_push(p_token text, p_action text, p_sub jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_booth uuid;
begin
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
  return private.booth_push_op(v_booth, 'qr', null, extensions.digest(p_token, 'sha256'), p_action, p_sub);
end;
$$;
revoke all     on function public.booth_ctrl_push(text, text, jsonb) from public;
grant  execute on function public.booth_ctrl_push(text, text, jsonb) to anon, authenticated;
comment on function public.booth_ctrl_push(text, text, jsonb) is
  '운영자 기기 시스템 알림 구독(QR). 부스 QR 열쇠로만. anon 실행 권한은 의도된 것입니다. 열쇠는 해시만 남깁니다.';

drop function if exists public.booth_session_push(text, text, jsonb);
create function public.booth_session_push(p_session text, p_action text, p_sub jsonb)
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
  select x.session_id, x.booth_id into r from private.booth_session_resolve(p_session, false) x;
  return private.booth_push_op(r.booth_id, 'pin', r.session_id, null, p_action, p_sub);
end;
$$;
revoke all     on function public.booth_session_push(text, text, jsonb) from public;
grant  execute on function public.booth_session_push(text, text, jsonb) to anon, authenticated;
comment on function public.booth_session_push(text, text, jsonb) is
  '운영자 기기 시스템 알림 구독(PIN). PIN 세션으로만. anon 실행 권한은 의도된 것입니다.';

-- ── 관리자: 보낼 곳 · 결과(Vercel /api/notice-push 가 관리자 로그인으로 부름) ─────────────
-- 그 알림을 받은(queued) 부스 중 아직 확인 안 했고 시스템 알림을 안 보낸 곳의, 지금도 유효한 구독만.
--   QR 구독: 등록 때의 열쇠가 지금도 그 부스의 켜진 열쇠일 때(열쇠를 바꾸거나 끄면 빠짐)
--   PIN 구독: 등록 때의 세션이 끝나지 · 바뀌지 · 만료되지 않았을 때
drop function if exists public.admin_notice_push_targets(bigint);
create function public.admin_notice_push_targets(p_notice_id bigint)
returns table (booth_id uuid, booth_code text, sub_id bigint, endpoint text, p256dh text, auth text, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception '관리자만 보낼 수 있습니다.' using errcode = '42501';
  end if;
  if not private.booth_push_on() then
    return;
  end if;
  return query
    select t.booth_id, t.booth_code, s.id, s.endpoint, s.p256dh, s.auth, n.expires_at
      from public.booth_notice n
      join public.booth_notice_target t on t.notice_id = n.id
      join public.booth_push_sub s on s.booth_id = t.booth_id and s.disabled_at is null
     where n.id = p_notice_id
       and n.expires_at > pg_catalog.now()
       and t.acked_at is null
       and t.push_sent_at is null
       and ((s.via = 'qr' and exists (select 1 from public.booth_access a
                                       where a.booth_id = s.booth_id and a.disabled_at is null
                                         and extensions.digest(a.token, 'sha256') = s.token_hash))
         or (s.via = 'pin' and exists (select 1 from public.booth_session x
                                        where x.id = s.session_id and x.booth_id = s.booth_id
                                          and x.revoked_at is null and x.expires_at > pg_catalog.now()
                                          and (not x.via_common_pin or private.booth_common_pin_target(x.booth_id)))))
       and exists (select 1 from public.booths b join public.zones z on z.key = b.zone_key
                    where b.id = t.booth_id and b.is_published and z.is_published and b.no is not null)
     order by t.booth_code, s.id;
end;
$$;
revoke all     on function public.admin_notice_push_targets(bigint) from public;
revoke execute on function public.admin_notice_push_targets(bigint) from anon;
grant  execute on function public.admin_notice_push_targets(bigint) to authenticated;

-- p_results: [{ "sub_id": 1, "booth_id": "…", "status": 201 }, …] — 2xx 면 그 부스 대상에 push_sent_at, 404 · 410 이면 구독 끄기
drop function if exists public.admin_notice_push_result(bigint, jsonb);
create function public.admin_notice_push_result(p_notice_id bigint, p_results jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ok integer := 0; v_gone integer := 0; v_fail integer := 0;
  e jsonb;
  v_st integer;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception '관리자만 쓸 수 있습니다.' using errcode = '42501';
  end if;
  if p_results is null or pg_catalog.jsonb_typeof(p_results) <> 'array' or pg_catalog.jsonb_array_length(p_results) > 500 then
    raise exception '결과 형식이 맞지 않습니다.' using errcode = '22023';
  end if;
  for e in select x from pg_catalog.jsonb_array_elements(p_results) x loop
    v_st := coalesce((e ->> 'status')::integer, 0);
    if v_st between 200 and 299 then
      update public.booth_notice_target t set push_sent_at = coalesce(t.push_sent_at, pg_catalog.now()), push_result = 'sent'
       where t.notice_id = p_notice_id and t.booth_id = (e ->> 'booth_id')::uuid;
      update public.booth_push_sub s set fail_count = 0 where s.id = (e ->> 'sub_id')::bigint;
      v_ok := v_ok + 1;
    elsif v_st in (404, 410) then
      update public.booth_push_sub s set disabled_at = coalesce(s.disabled_at, pg_catalog.now()) where s.id = (e ->> 'sub_id')::bigint;
      v_gone := v_gone + 1;
    else
      update public.booth_push_sub s set fail_count = s.fail_count + 1 where s.id = (e ->> 'sub_id')::bigint;
      update public.booth_notice_target t set push_result = coalesce(t.push_result, 'fail:' || v_st)
       where t.notice_id = p_notice_id and t.booth_id = (e ->> 'booth_id')::uuid and t.push_sent_at is null;
      v_fail := v_fail + 1;
    end if;
  end loop;
  return pg_catalog.jsonb_build_object('sent', v_ok, 'gone', v_gone, 'failed', v_fail);
end;
$$;
revoke all     on function public.admin_notice_push_result(bigint, jsonb) from public;
revoke execute on function public.admin_notice_push_result(bigint, jsonb) from anon;
grant  execute on function public.admin_notice_push_result(bigint, jsonb) to authenticated;

notify pgrst, 'reload schema';

-- ── 확인 표(모두 true) ─────────────────────────────────────────────
select v."항목", v."기대", v."실제", v."기대" = v."실제" as "맞음"
  from (values
    (1, 'push_enabled 칸 · 기본 false · 지금 false', 'true',
        ((select c.column_default = 'false' and c.is_nullable = 'NO' from information_schema.columns c
           where c.table_schema = 'public' and c.table_name = 'booth_notice_config' and c.column_name = 'push_enabled')
         and not (select c.push_enabled from public.booth_notice_config c where c.id = 1))::text),
    (2, '구독 표 RLS 켬 · 정책 0 · 직접 읽기 · 쓰기 없음', 'true',
        ((select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.booth_push_sub'::regclass)
         and (select count(*) from pg_catalog.pg_policies p where p.schemaname = 'public' and p.tablename = 'booth_push_sub') = 0
         and not (select bool_or(has_table_privilege(r, 'public.booth_push_sub', pr))
                    from unnest(array['anon', 'authenticated']) r, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) pr))::text),
    (3, '보내기 함수 — 30분 · 기본 문구 · 리허설 모드 그대로', 'true',
        (pg_catalog.pg_get_functiondef('public.admin_send_booth_notice(text,text,uuid[],text)'::regprocedure) ~ '30 minutes'
         and pg_catalog.pg_get_functiondef('public.admin_send_booth_notice(text,text,uuid[],text)'::regprocedure) ~ '다시 확인해 주세요\.'
         and pg_catalog.pg_get_functiondef('public.admin_send_booth_notice(text,text,uuid[],text)'::regprocedure) !~ '3 hours'
         and pg_catalog.pg_get_functiondef('public.admin_send_booth_notice(text,text,uuid[],text)'::regprocedure) ~ 'booth_notice_rehearsal_only')::text),
    (4, '운영자 처리 — 만료 알림 기록 안 함', 'true',
        (pg_catalog.pg_get_functiondef('private.booth_notice_op(uuid,text,uuid,text,bigint)'::regprocedure) ~ '''expired'', true')::text),
    (5, '운영자 구독 함수 anon 실행(둘 다)', 'true',
        (has_function_privilege('anon', 'public.booth_ctrl_push(text,text,jsonb)', 'EXECUTE')
         and has_function_privilege('anon', 'public.booth_session_push(text,text,jsonb)', 'EXECUTE'))::text),
    (6, '관리자 푸시 함수 anon 실행', 'false',
        (has_function_privilege('anon', 'public.admin_notice_push_targets(bigint)', 'EXECUTE')
         or has_function_privilege('anon', 'public.admin_notice_push_result(bigint,jsonb)', 'EXECUTE')
         or has_function_privilege('anon', 'public.admin_booth_notice_status(integer)', 'EXECUTE'))::text),
    (7, '관리자 푸시 · 현황 함수 authenticated 실행(안에서 is_admin)', 'true',
        (has_function_privilege('authenticated', 'public.admin_notice_push_targets(bigint)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.admin_notice_push_result(bigint,jsonb)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.admin_booth_notice_status(integer)', 'EXECUTE'))::text),
    (8, '안쪽 도우미 바깥 실행', 'false',
        (select bool_or(has_function_privilege(r, f, 'EXECUTE'))
           from unnest(array['anon', 'authenticated']) r,
                unnest(array['private.booth_push_on()', 'private.booth_push_op(uuid,text,uuid,bytea,text,jsonb)',
                             'private.booth_notice_op(uuid,text,uuid,text,bigint)']) f)::text),
    (9, '새 · 바뀐 함수가 booth_live · booth_live_log 를 쓰지 않음', 'false',
        (select bool_or(pg_catalog.pg_get_functiondef(f::regprocedure) ~* '(insert\s+into|update|delete\s+from)\s+public\.booth_live(_log)?\M')
           from unnest(array['public.booth_ctrl_push(text,text,jsonb)', 'public.booth_session_push(text,text,jsonb)',
                             'private.booth_push_op(uuid,text,uuid,bytea,text,jsonb)', 'public.admin_notice_push_targets(bigint)',
                             'public.admin_notice_push_result(bigint,jsonb)', 'private.booth_notice_op(uuid,text,uuid,text,bigint)',
                             'public.admin_send_booth_notice(text,text,uuid[],text)', 'public.admin_booth_notice_status(integer)']) f)::text),
    (10, 'security definer · search_path 빈 값(공개 함수 다섯)', '5',
        (select count(*) from pg_catalog.pg_proc pro join pg_catalog.pg_namespace nsp on nsp.oid = pro.pronamespace
          where nsp.nspname = 'public'
            and pro.proname in ('booth_ctrl_push', 'booth_session_push', 'admin_notice_push_targets', 'admin_notice_push_result', 'admin_booth_notice_status')
            and pro.prosecdef and 'search_path=""' = any (pro.proconfig))::text),
    (11, '알림 스위치 · 리허설 모드는 그대로(이 SQL 은 바꾸지 않음)', 'true',
        (select c.rehearsal_only from public.booth_notice_config c where c.id = 1)::text)
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";
