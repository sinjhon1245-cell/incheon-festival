-- ===================================================================
-- 되돌리기: 운영자 알림 리허설 모드(migration-booth-notice-rehearsal.sql)
--   보내기 함수를 리허설 모드 앞의 정의(migration-booth-notice.sql 과 같음)로 돌리고, 모드 함수 · 도우미를 지웁니다.
--   rehearsal_only 칸은 남깁니다(값만 남고 아무도 보지 않음). 알림 기록 · 서버 스위치 · 대기 값은 그대로.
--   되돌리면 다시 모든 종류를 보낼 수 있으니, 서버 스위치를 먼저 끄고 실행하세요.
-- ===================================================================

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

drop function if exists public.admin_booth_notice_mode();
drop function if exists private.booth_notice_rehearsal_only();
notify pgrst, 'reload schema';

select v."항목", v."기대", v."실제", v."기대" = v."실제" as "맞음"
  from (values
    (1, '모드 함수 · 도우미 없음', 'true',
        (to_regprocedure('public.admin_booth_notice_mode()') is null and to_regprocedure('private.booth_notice_rehearsal_only()') is null)::text),
    (2, '보내기 함수가 리허설 모드를 보지 않음(처음 정의)', 'false',
        (pg_catalog.pg_get_functiondef('public.admin_send_booth_notice(text,text,uuid[],text)'::regprocedure) ~ 'rehearsal')::text),
    (3, '보내기 함수 정의 지문 = 처음 설치(Production 10-28 c8802c27)', 'c8802c27',
        left(md5(replace(pg_catalog.pg_get_functiondef('public.admin_send_booth_notice(text,text,uuid[],text)'::regprocedure), E'\r', '')), 8))
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";
