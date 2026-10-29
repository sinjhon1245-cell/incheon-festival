-- ===================================================================
-- 운영자 알림 — 리허설 모드(부스 1곳만 보내기) 추가 SQL
--
--   이미 적용된 migration-booth-notice.sql 위에 덧붙입니다(처음 설치 SQL 을 다시 돌리지 않음).
--   · booth_notice_config 에 rehearsal_only 칸(기본 true) — 서버 스위치 enabled 와 따로입니다.
--     rehearsal_only = true 이면 admin_send_booth_notice 가 kind booth(부스 1곳) 말고는 거절하고,
--     실제로 보낼 부스가 1곳을 넘어도 거절합니다(화면을 거치지 않은 직접 호출 포함).
--   · admin_booth_notice_mode() — 관리자 화면이 지금 모드(rehearsal · event)를 읽음.
--   · 대기 값(booth_live) · 기존 알림 기록 · 운영자 함수 · 서버 스위치는 바꾸지 않습니다.
--
-- 사용법: SQL Editor 에 전체 붙여넣고 Run(한 트랜잭션). 여러 번 실행해도 같습니다. 맨 아래 확인 표 모두 true.
-- 행사 모드로(따로 승인):  update public.booth_notice_config set rehearsal_only = false, updated_at = now() where id = 1;
-- 리허설 모드로:          update public.booth_notice_config set rehearsal_only = true,  updated_at = now() where id = 1;
-- 되돌리기: supabase/rollback-booth-notice-rehearsal.sql
-- ===================================================================

do $preflight$
begin
  if to_regclass('public.booth_notice_config') is null
     or to_regprocedure('public.admin_send_booth_notice(text, text, uuid[], text)') is null
     or to_regprocedure('private.booth_notice_on()') is null then
    raise exception '선행 조건 누락: migration-booth-notice.sql 을 먼저 적용해야 합니다.';
  end if;
end
$preflight$;

alter table public.booth_notice_config add column if not exists rehearsal_only boolean not null default true;
comment on column public.booth_notice_config.rehearsal_only is
  'true(기본) = 리허설 모드: 관리자 보내기는 부스 1곳(kind booth)만. false = 행사 모드(확인 필요 · 미입력 · 구역 · 전체 공개 허용). 서버 스위치 enabled 와 별개.';

create or replace function private.booth_notice_rehearsal_only()
returns boolean language sql stable set search_path = ''
as $$ select coalesce((select c.rehearsal_only from public.booth_notice_config c where c.id = 1), true) $$;
revoke all on function private.booth_notice_rehearsal_only() from public;

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

-- 지금 보내기 모드: rehearsal(부스 1곳만) · event(모든 종류). 관리자만.
create or replace function public.admin_booth_notice_mode()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception '관리자만 볼 수 있습니다.' using errcode = '42501';
  end if;
  return case when private.booth_notice_rehearsal_only() then 'rehearsal' else 'event' end;
end;
$$;
revoke all     on function public.admin_booth_notice_mode() from public;
revoke execute on function public.admin_booth_notice_mode() from anon;
grant  execute on function public.admin_booth_notice_mode() to authenticated;

notify pgrst, 'reload schema';

-- ── 확인 표(모두 true) ─────────────────────────────────────────────
select v."항목", v."기대", v."실제", v."기대" = v."실제" as "맞음"
  from (values
    (1, 'rehearsal_only 칸 · 기본 true', 'true',
        (select c.column_default = 'true' and c.is_nullable = 'NO' from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = 'booth_notice_config' and c.column_name = 'rehearsal_only')::text),
    (2, '지금 모드(처음 적용 때 리허설)', 'true', (select c.rehearsal_only from public.booth_notice_config c where c.id = 1)::text),
    (4, '보내기 함수가 리허설 모드를 봄', 'true',
        (pg_catalog.pg_get_functiondef('public.admin_send_booth_notice(text,text,uuid[],text)'::regprocedure) ~ 'booth_notice_rehearsal_only')::text),
    (5, '보내기 · 모드 함수 anon 실행', 'false',
        (has_function_privilege('anon', 'public.admin_send_booth_notice(text,text,uuid[],text)', 'EXECUTE')
         or has_function_privilege('anon', 'public.admin_booth_notice_mode()', 'EXECUTE'))::text),
    (6, '보내기 · 모드 함수 authenticated 실행(안에서 is_admin)', 'true',
        (has_function_privilege('authenticated', 'public.admin_send_booth_notice(text,text,uuid[],text)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.admin_booth_notice_mode()', 'EXECUTE'))::text),
    (7, '안쪽 도우미 바깥 실행', 'false',
        (has_function_privilege('anon', 'private.booth_notice_rehearsal_only()', 'EXECUTE')
         or has_function_privilege('authenticated', 'private.booth_notice_rehearsal_only()', 'EXECUTE'))::text),
    (8, '보내기 함수가 booth_live · booth_live_log 를 쓰지 않음', 'false',
        (pg_catalog.pg_get_functiondef('public.admin_send_booth_notice(text,text,uuid[],text)'::regprocedure) ~* '(insert\s+into|update|delete\s+from)\s+public\.booth_live(_log)?\M')::text)
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";
