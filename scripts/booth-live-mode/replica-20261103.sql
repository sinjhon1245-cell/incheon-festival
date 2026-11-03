-- ===================================================================
-- 시험용 복제 스키마 — 2026-11-03 Production 의 부스 대기 관련 표 · 함수(읽기 전용 조회로 받은 정의)
--
--   운영 방식 시험(test-db.mjs)이 빈 로컬 Postgres 에 먼저 올립니다. 운영 데이터는 없고 가짜 부스 4곳만 둡니다.
--   표: 시험에 필요한 열만(이름 · 형 · 기본값 · 제약은 Production 과 같게).
--   함수: Production 정의 그대로(pg_get_functiondef). 운영 방식 migration 이 바꾸는 다섯 함수는 여기 두지 않고
--         시험이 supabase/rollback-booth-live-mode.sql 의 3번(2026-11-03 정의)을 올린 뒤 md5 로 Production 과 견줍니다.
--   흉내: auth.uid() · extensions.digest() · private.booth_common_pin_target() · private.rehearsal_booth_ids()(가짜 부스).
-- ===================================================================

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create schema extensions;
create schema private;
grant usage on schema public to anon, authenticated;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function extensions.digest(p text, p_alg text) returns bytea language sql immutable as $$
  select sha256(convert_to(p, 'UTF8'))
$$;
grant usage on schema auth, extensions to anon, authenticated;

-- ── 표 ──────────────────────────────────────────────────────────────
create table public.settings (
  id smallint primary key default 1,
  event_start timestamptz not null default '2026-11-06 01:00:00+00',
  event_end timestamptz,
  booth_pin_enabled boolean not null default false,
  booth_sample_common_pin_enabled boolean not null default false
);
create table public.zones (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  sort_order integer not null default 0,
  is_published boolean not null default false
);
create table public.booths (
  id uuid primary key default gen_random_uuid(),
  no integer check (no is null or (no >= 1 and no <= 999)),
  zone_key text references public.zones(key) on update cascade on delete set null,
  name text not null,
  org text not null default '',
  sort_order integer not null default 0,
  code text not null default '',
  is_published boolean not null default false,
  unique (zone_key, no)
);
create table public.staff_profiles (
  id uuid primary key,
  name text not null default '',
  role text not null default 'staff'
);
create table public.booth_access (
  booth_id uuid primary key references public.booths(id) on delete cascade,
  token text not null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  disabled_at timestamptz
);
create table public.booth_session (
  id uuid primary key default gen_random_uuid(),
  booth_id uuid not null references public.booths(id) on delete cascade,
  token_hash bytea not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text,
  last_used_at timestamptz,
  device_tag text,
  via_common_pin boolean not null default false
);
create table public.booth_live (
  booth_id uuid primary key references public.booths(id) on delete cascade,
  congestion text not null,
  wait_minutes integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint booth_live_congestion_check check ((congestion = any (array['여유'::text, '보통'::text, '혼잡'::text, '중단'::text, '마감'::text]))),
  constraint booth_live_wait_check check (((wait_minutes >= 0) and (wait_minutes <= 180)))
);
create table public.booth_live_log (
  id bigint generated always as identity primary key,
  booth_id uuid not null references public.booths(id) on delete cascade,
  congestion text not null,
  wait_minutes integer not null,
  source text not null check ((source = any (array['set'::text, 'touch'::text, 'admin'::text]))),
  created_at timestamptz not null default now(),
  session_id uuid references public.booth_session(id) on delete set null
);
create table public.booth_live_check (
  id bigint generated always as identity primary key,
  batch_id uuid not null,
  booth_id uuid not null,
  booth_code text not null default '',
  booth_name text not null default '',
  seen_updated_at timestamptz not null,
  seen_congestion text not null,
  seen_wait integer not null,
  checked_by uuid not null,
  checked_at timestamptz not null default now()
);
alter table public.booth_live enable row level security;
alter table public.booth_live_log enable row level security;
alter table public.booth_live_check enable row level security;
alter table public.booth_access enable row level security;
alter table public.booth_session enable row level security;
alter table public.booths enable row level security;
alter table public.zones enable row level security;
grant select on public.booth_live to anon, authenticated;
grant select on public.booths, public.zones to anon, authenticated;
create policy "공개 부스 대기 열람" on public.booth_live for select to anon, authenticated
  using (exists (select 1 from public.booths b where b.id = booth_live.booth_id));
create policy "공개 부스" on public.booths for select to anon, authenticated using (is_published);
create policy "공개 구역" on public.zones for select to anon, authenticated using (is_published);

-- ── 흉내 ────────────────────────────────────────────────────────────
create function private.booth_common_pin_target(p_booth uuid) returns boolean language sql stable as $$ select false $$;
create function private.rehearsal_booth_ids() returns uuid[] language sql immutable set search_path to '' as $$
  select array['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
               '00000000-0000-4000-8000-000000000003']::uuid[]
$$;

-- ── Production 정의 그대로 ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.staff_profiles where id = auth.uid() and role = 'admin');
$function$;

CREATE OR REPLACE FUNCTION private.booth_session_resolve(p_session text, p_mark boolean)
 RETURNS TABLE(session_id uuid, booth_id uuid, created_at timestamp with time zone, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_on boolean;
  s    public.booth_session%rowtype;
begin
  select st.booth_pin_enabled into v_on from public.settings st order by st.id limit 1;
  if not coalesce(v_on, false) then
    raise exception 'PIN 로그인이 꺼져 있습니다.' using errcode = '42501', hint = 'booth_pin_off';
  end if;
  if p_session is null or p_session !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'PIN 로그인이 끝났습니다.' using errcode = '42501', hint = 'booth_session_invalid';
  end if;

  select x.* into s from public.booth_session x where x.token_hash = extensions.digest(p_session, 'sha256');
  if not found then
    raise exception 'PIN 로그인이 끝났습니다.' using errcode = '42501', hint = 'booth_session_invalid';
  end if;
  if s.revoked_at is not null then
    if s.revoke_reason in ('pin_reissued', 'pin_disabled') then
      raise exception '운영본부가 PIN을 변경했습니다.' using errcode = '42501', hint = 'booth_session_revoked';
    end if;
    raise exception 'PIN 로그인이 끝났습니다.' using errcode = '42501', hint = 'booth_session_invalid';
  end if;
  if s.expires_at <= pg_catalog.now() then
    raise exception 'PIN 로그인 시간이 끝났습니다.' using errcode = '42501', hint = 'booth_session_expired';
  end if;
  if not exists (
    select 1 from public.booths b join public.zones z on z.key = b.zone_key
     where b.id = s.booth_id and b.is_published and z.is_published and b.no is not null
  ) then
    raise exception '지금은 이 부스를 운영할 수 없습니다.' using errcode = '42501', hint = 'booth_session_unavailable';
  end if;
  if s.via_common_pin and not private.booth_common_pin_target(s.booth_id) then
    raise exception '운영 준비용 공통 PIN을 더 이상 쓸 수 없습니다.' using errcode = '42501', hint = 'booth_session_revoked';
  end if;

  if p_mark or s.last_used_at is null or s.last_used_at < pg_catalog.now() - interval '10 minutes' then
    update public.booth_session as x set last_used_at = pg_catalog.now() where x.id = s.id;
  end if;

  return query select s.id, s.booth_id, s.created_at, s.expires_at;
end;
$function$;

CREATE OR REPLACE FUNCTION private.booth_op_row(p_booth uuid)
 RETURNS TABLE(booth_id uuid, code text, zone_key text, zone_label text, name text, org text, congestion text, wait_minutes integer, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select b.id,
         coalesce(nullif(b.code, ''),
                  b.zone_key || '-' || lpad(b.no::text, greatest(2, length(b.no::text)), '0')),
         b.zone_key, z.label, b.name, b.org, l.congestion, l.wait_minutes, l.updated_at
    from public.booths b
    left join public.zones z on z.key = b.zone_key
    left join public.booth_live l on l.booth_id = b.id
   where b.id = p_booth
$function$;

CREATE OR REPLACE FUNCTION public.booth_ctrl_get(p_token text)
 RETURNS TABLE(booth_id uuid, code text, zone_key text, zone_label text, name text, org text, congestion text, wait_minutes integer, updated_at timestamp with time zone, issued_at timestamp with time zone, token_tail text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    join public.zones  z on z.key = b.zone_key
    left join public.booth_live l on l.booth_id = b.id
   where p_token ~ '^[A-Za-z0-9_-]{24}$'
     and a.token = p_token
     and a.disabled_at is null
     and b.is_published
     and z.is_published
     and b.no is not null
     and coalesce(pg_catalog.current_setting('request.method', true), '') not in ('GET', 'HEAD')
$function$;

CREATE OR REPLACE FUNCTION public.booth_session_get(p_session text)
 RETURNS TABLE(booth_id uuid, code text, zone_key text, zone_label text, name text, org text, congestion text, wait_minutes integer, updated_at timestamp with time zone, issued_at timestamp with time zone, token_tail text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  s record;
begin
  if coalesce(pg_catalog.current_setting('request.method', true), '') in ('GET', 'HEAD') then
    return;
  end if;
  select * into s from private.booth_session_resolve(p_session, false);
  return query
    select r.booth_id, r.code, r.zone_key, r.zone_label, r.name, r.org, r.congestion, r.wait_minutes, r.updated_at,
           s.created_at, null::text, s.expires_at
      from private.booth_op_row(s.booth_id) r;
end;
$function$;

CREATE OR REPLACE FUNCTION public.booth_session_set(p_session text, p_mode text, p_wait_minutes integer)
 RETURNS TABLE(booth_id uuid, code text, zone_key text, zone_label text, name text, org text, congestion text, wait_minutes integer, updated_at timestamp with time zone, issued_at timestamp with time zone, token_tail text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  s record;
begin
  select * into s from private.booth_session_resolve(p_session, true);
  perform private.booth_op_set(s.booth_id, p_mode, p_wait_minutes, s.session_id);
  return query
    select r.booth_id, r.code, r.zone_key, r.zone_label, r.name, r.org, r.congestion, r.wait_minutes, r.updated_at,
           s.created_at, null::text, s.expires_at
      from private.booth_op_row(s.booth_id) r;
end;
$function$;

CREATE OR REPLACE FUNCTION public.booth_session_touch(p_session text)
 RETURNS TABLE(booth_id uuid, code text, zone_key text, zone_label text, name text, org text, congestion text, wait_minutes integer, updated_at timestamp with time zone, issued_at timestamp with time zone, token_tail text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  s record;
begin
  select * into s from private.booth_session_resolve(p_session, true);
  perform private.booth_op_touch(s.booth_id, s.session_id);
  return query
    select r.booth_id, r.code, r.zone_key, r.zone_label, r.name, r.org, r.congestion, r.wait_minutes, r.updated_at,
           s.created_at, null::text, s.expires_at
      from private.booth_op_row(s.booth_id) r;
end;
$function$;

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
$function$;

CREATE OR REPLACE FUNCTION private.rehearsal_live_reset()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  n integer;
begin
  delete from public.booth_live as l where l.booth_id = any (private.rehearsal_booth_ids());
  get diagnostics n = row_count;
  return n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_confirm_booth_live(p_items jsonb)
 RETURNS TABLE(booth_id uuid, status text, checked_at timestamp with time zone, live_updated_at timestamp with time zone, batch_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
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

  begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('public.admin_confirm_booth_live'));
  exception when lock_not_available then
    return query
      select (e.x ->> 'booth_id')::uuid, 'failed:busy'::text, null::timestamptz, null::timestamptz, v_batch
        from pg_catalog.jsonb_array_elements(p_items) with ordinality as e(x, n)
       order by 1, e.n;
    return;
  end;

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
      select l.congestion, l.wait_minutes, l.updated_at
        into v_live
        from public.booth_live as l
       where l.booth_id = v_item.bid
         for update nowait;

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
                   (batch_id, booth_id, booth_code, booth_name, seen_updated_at, seen_congestion, seen_wait, checked_by, checked_at)
            select v_batch, v_item.bid,
                   coalesce(nullif(b.code, ''), b.zone_key || '-' || lpad(b.no::text, greatest(2, length(b.no::text)), '0'), ''),
                   coalesce(b.name, ''),
                   v_live.updated_at, v_live.congestion, v_live.wait_minutes, v_uid, v_now
              from public.booths as b
             where b.id = v_item.bid
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
$function$;

-- Production 권한 모양(함수)
revoke all on function private.booth_session_resolve(text, boolean) from public;
revoke all on function private.booth_op_row(uuid) from public;
revoke all on function private.rehearsal_live_reset() from public;
revoke all on function public.admin_reset_booth_live() from public;
revoke all on function public.admin_confirm_booth_live(jsonb) from public;
grant execute on function public.admin_reset_booth_live() to authenticated;
grant execute on function public.admin_confirm_booth_live(jsonb) to authenticated;
grant execute on function public.booth_ctrl_get(text) to anon, authenticated;
grant execute on function public.booth_session_get(text) to anon, authenticated;
grant execute on function public.booth_session_set(text, text, integer) to anon, authenticated;
grant execute on function public.booth_session_touch(text) to anon, authenticated;

-- ── 가짜 부스 ──────────────────────────────────────────────────────────
insert into public.settings (id, event_start, event_end, booth_pin_enabled) values (1, '2026-11-06 01:00:00+00', '2026-11-07 08:00:00+00', true);
insert into public.zones (key, label, sort_order, is_published) values ('S', '시험', 1, true), ('H', '숨김', 2, false);
insert into public.booths (id, no, zone_key, name, org, code, is_published) values
  ('00000000-0000-4000-8000-000000000001', 1, 'S', '시험 부스 1', '시험초', 'S01', true),
  ('00000000-0000-4000-8000-000000000002', 2, 'S', '시험 부스 2', '시험중', 'S02', true),
  ('00000000-0000-4000-8000-000000000003', 3, 'S', '시험 부스 3', '시험고', 'S03', true),
  ('00000000-0000-4000-8000-000000000009', 9, 'H', '숨은 부스', '[예시] 시험', 'H09', false);
insert into public.staff_profiles (id, name, role) values ('00000000-0000-4000-8000-0000000000ad', '시험 관리자', 'admin');
