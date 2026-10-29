-- ===================================================================
-- 되돌리기: 운영자 알림 30분 · 시스템 알림(migration-booth-notice-push.sql)
--   보내기 함수는 리허설 모드 판(migration-booth-notice-rehearsal.sql — 3시간 · 종류별 기본 문구)으로,
--   운영자 처리 · 관리자 현황 함수는 처음 설치 판(migration-booth-notice.sql)으로 돌립니다.
--   시스템 알림 함수 · 도우미를 지우고, 기기 구독 표(booth_push_sub)는 지웁니다(기기 주소 · 열쇠를 남기지 않음).
--   push_enabled · push_sent_at · push_result 칸은 남깁니다(push_enabled 는 false 로). 알림 기록 · 서버 스위치 · 리허설 모드 · 대기 값은 그대로.
--   먼저 Vercel 의 VAPID 키를 지우거나 운영자 화면 boothPush 를 끄면, 그 사이 시스템 알림 요청은 ‘꺼짐’ 으로 끝납니다.
-- ===================================================================

update public.booth_notice_config set push_enabled = false, updated_at = pg_catalog.now() where id = 1 and push_enabled;

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

-- 보내기(같은 이름 · 같은 인자 — 권한 그대로). 바뀐 곳은 리허설 모드 두 군데뿐입니다.
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
  '관리자 전용. 운영자 알림 보내기(꺼져 있으면 55000 notice_off · 리허설 모드에서 부스 1곳이 아니면 55000 rehearsal_only). 대상은 서버가 다시 셈 · 같은 부스 같은 종류 10분 안 다시 안 보냄. booth_live 는 바꾸지 않습니다.';

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

drop function if exists public.admin_notice_push_result(bigint, jsonb);
drop function if exists public.admin_notice_push_targets(bigint);
drop function if exists public.booth_session_push(text, text, jsonb);
drop function if exists public.booth_ctrl_push(text, text, jsonb);
drop function if exists private.booth_push_op(uuid, text, uuid, bytea, text, jsonb);
drop function if exists private.booth_push_on();
drop table if exists public.booth_push_sub;
notify pgrst, 'reload schema';

select v."항목", v."기대", v."실제", v."기대" = v."실제" as "맞음"
  from (values
    (1, '시스템 알림 함수 · 표 없음', 'true',
        (to_regprocedure('public.booth_ctrl_push(text,text,jsonb)') is null and to_regprocedure('public.booth_session_push(text,text,jsonb)') is null
         and to_regprocedure('public.admin_notice_push_targets(bigint)') is null and to_regprocedure('public.admin_notice_push_result(bigint,jsonb)') is null
         and to_regprocedure('private.booth_push_on()') is null and to_regclass('public.booth_push_sub') is null)::text),
    (2, '보내기 함수 = 리허설 판(3시간 · 리허설 모드)', 'true',
        (pg_catalog.pg_get_functiondef('public.admin_send_booth_notice(text,text,uuid[],text)'::regprocedure) ~ '3 hours'
         and pg_catalog.pg_get_functiondef('public.admin_send_booth_notice(text,text,uuid[],text)'::regprocedure) ~ 'booth_notice_rehearsal_only')::text),
    (3, '운영자 처리 함수 = 처음 판(expired 없음)', 'false',
        (pg_catalog.pg_get_functiondef('private.booth_notice_op(uuid,text,uuid,text,bigint)'::regprocedure) ~ 'expired')::text),
    (4, '관리자 현황 함수에 push_sent_at 없음', 'false',
        (pg_catalog.pg_get_functiondef('public.admin_booth_notice_status(integer)'::regprocedure) ~ 'push_sent_at')::text),
    (5, 'push_enabled false', 'false', (select c.push_enabled from public.booth_notice_config c where c.id = 1)::text)
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";
