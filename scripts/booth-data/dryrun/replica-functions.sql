-- ===================================================================
-- 로컬 사전 실행용 복제 — QR · PIN · 운영자 접속 함수와 공개(RLS) 규칙
-- replica-schema.sql 다음에 실행합니다. PGlite + pgcrypto(extensions 스키마) 전제.
--
-- 함수 본문은 Production 카탈로그(2026-10-15 읽기 전용 조회, pg_get_functiondef)와 같습니다.
-- 다른 점(로컬 시험용 대체 — Production 값이 아님):
--   · auth.uid()                  : 설정값 test.uid 를 돌려줍니다(관리자 흉내).
--   · private.booth_pin_pepper()  : 시험용 고정 바이트(실제 pepper 는 Vault 에 있고 읽지 않음).
--   · private.booth_common_pin_ok : 실제 공통 PIN 대신 시험용 값 '000000' 과 비교합니다.
-- 로컬 PGlite 에서만 씁니다. Production 에서 실행하지 않습니다.
-- ===================================================================

create schema if not exists auth;
create schema if not exists private;

create or replace function auth.uid() returns uuid language sql stable
as $$ select nullif(pg_catalog.current_setting('test.uid', true), '')::uuid $$;

create table public.staff_profiles (
  id         uuid primary key,
  role       text not null default 'staff',
  name       text not null default '',
  email      text not null default '',
  updated_at timestamptz not null default now()
);

create table private.booth_pin_settings (
  id         smallint primary key default 1 check (id = 1),
  ip_header  text,
  updated_at timestamptz not null default now()
);
insert into private.booth_pin_settings (id, ip_header) values (1, null);

create or replace function public.is_admin()
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select exists (select 1 from public.staff_profiles where id = auth.uid() and role = 'admin');
$function$;

-- ── 시험용 대체 ─────────────────────────────────────────────────────
create or replace function private.booth_pin_pepper()
 returns bytea language sql immutable set search_path to ''
as $function$ select pg_catalog.convert_to('local-dryrun-pepper-not-production', 'UTF8') $function$;

create or replace function private.booth_common_pin_target(p_booth uuid)
 returns boolean language sql stable set search_path to ''
as $function$
  select coalesce((select s.booth_sample_common_pin_enabled from public.settings s order by s.id limit 1), false)
     and exists (
       select 1 from public.booths b join public.zones z on z.key = b.zone_key
        where b.id = p_booth and b.is_published and z.is_published and b.no is not null
          and b.org ~ '^\s*\[예시\]'
     )
$function$;

create or replace function private.booth_common_pin_ok(p_booth uuid, p_pin text)
 returns boolean language sql stable set search_path to ''
as $function$ select private.booth_common_pin_target(p_booth) and p_pin = '000000' $function$;

-- ── Production 과 같은 본문 ─────────────────────────────────────────
create or replace function private.booth_client_ip()
 returns text language plpgsql stable set search_path to ''
as $function$
declare
  v_mode text;
  h      json;
  v      text;
  parts  text[];
begin
  select s.ip_header into v_mode from private.booth_pin_settings s where s.id = 1;
  if v_mode is null then return null; end if;
  h := nullif(pg_catalog.current_setting('request.headers', true), '')::json;
  if h is null then return null; end if;
  if v_mode in ('cf-connecting-ip', 'x-real-ip') then
    v := h ->> v_mode;
  else
    parts := string_to_array(replace(coalesce(h ->> 'x-forwarded-for', ''), ' ', ''), ',');
    v := case when v_mode = 'x-forwarded-for:first' then parts[1] else parts[array_length(parts, 1)] end;
  end if;
  return nullif(btrim(coalesce(v, '')), '');
exception when others then
  return null;
end;
$function$;

create or replace function private.booth_pin_digest(p_pin text)
 returns text language sql stable set search_path to ''
as $function$
  select encode(extensions.hmac(pg_catalog.convert_to('pin:' || p_pin, 'UTF8'), private.booth_pin_pepper(), 'sha256'), 'hex')
$function$;

create or replace function private.booth_tag(p_kind text, p_value text)
 returns text language sql stable set search_path to ''
as $function$
  select case when p_value is null or p_value = '' then null
              else left(encode(extensions.hmac(pg_catalog.convert_to(p_kind || ':' || p_value, 'UTF8'),
                                               private.booth_pin_pepper(), 'sha256'), 'hex'), 16) end
$function$;

create or replace function private.booth_pin_no(p_reason text, p_retry integer)
 returns table(ok boolean, reason text, retry_after integer, session text, expires_at timestamp with time zone, booth_id uuid, code text, zone_key text, zone_label text, name text, org text, congestion text, wait_minutes integer, updated_at timestamp with time zone)
 language sql immutable set search_path to ''
as $function$
  select false, p_reason, greatest(coalesce(p_retry, 0), 0), null::text, null::timestamptz,
         null::uuid, null::text, null::text, null::text, null::text, null::text,
         null::text, null::integer, null::timestamptz
$function$;

create or replace function private.booth_session_token()
 returns text language sql set search_path to ''
as $function$
  select pg_catalog.translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_')
$function$;

create or replace function private.booth_pin_retry_after(p_ip text, p_dev text, p_booth uuid, p_now timestamp with time zone, out retry integer, out kind text)
 returns record language plpgsql stable set search_path to ''
as $function$
declare
  n      bigint;
  last_at timestamptz;
  w      integer;
begin
  retry := 0;
  kind := null;

  select count(*) into n from public.booth_auth_event e
   where e.event = 'pin_fail' and e.at > p_now - interval '60 minutes';
  if n >= 200 then
    select max(e.at) into last_at from public.booth_auth_event e
     where e.event in ('pin_fail', 'pin_ok') and e.at > p_now - interval '5 seconds';
    if last_at is not null then
      w := ceil(extract(epoch from (last_at + interval '5 seconds' - p_now)))::integer;
      if w > retry then retry := w; kind := 'global'; end if;
    end if;
  end if;

  if p_ip is not null then
    select count(*), max(e.at) into n, last_at from public.booth_auth_event e
     where e.event = 'pin_fail' and e.ip_tag = p_ip and e.at > p_now - interval '15 minutes';
    if n >= 20 then
      w := ceil(extract(epoch from (last_at + interval '15 minutes' - p_now)))::integer;
      if w > retry then retry := w; kind := 'ip'; end if;
    end if;
  end if;

  if p_dev is not null then
    select count(*), max(e.at) into n, last_at from public.booth_auth_event e
     where e.event = 'pin_fail' and e.device_tag = p_dev and e.at > p_now - interval '10 minutes';
    if n >= 5 then
      w := ceil(extract(epoch from (last_at + make_interval(secs => least(600, 30 * power(2, least(n - 5, 10)))) - p_now)))::integer;
      if w > retry then retry := w; kind := 'device'; end if;
    end if;
  end if;

  if p_booth is not null then
    select count(*) into n from public.booth_auth_event e
     where e.event = 'pin_fail' and e.booth_id = p_booth and e.at > p_now - interval '15 minutes';
    if n >= 10 then
      select max(e.at) into last_at from public.booth_auth_event e
       where e.event in ('pin_fail', 'pin_ok') and e.booth_id = p_booth and e.at > p_now - interval '30 seconds';
      if last_at is not null then
        w := ceil(extract(epoch from (last_at + interval '30 seconds' - p_now)))::integer;
        if w > retry then retry := w; kind := 'booth'; end if;
      end if;
    end if;
  end if;
end;
$function$;

create or replace function private.booth_op_row(p_booth uuid)
 returns table(booth_id uuid, code text, zone_key text, zone_label text, name text, org text, congestion text, wait_minutes integer, updated_at timestamp with time zone)
 language sql stable set search_path to ''
as $function$
  select b.id,
         coalesce(nullif(b.code, ''),
                  b.zone_key || '-' || lpad(b.no::text, greatest(2, length(b.no::text)), '0')),
         b.zone_key, z.label, b.name, b.org, l.congestion, l.wait_minutes, l.updated_at
    from public.booths b
    left join public.zones z on z.key = b.zone_key
    left join public.booth_live l on l.booth_id = b.id
   where b.id = p_booth
$function$;

create or replace function private.booth_op_set(p_booth uuid, p_mode text, p_wait integer, p_session uuid)
 returns void language plpgsql set search_path to ''
as $function$
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

create or replace function private.booth_session_resolve(p_session text, p_mark boolean)
 returns table(session_id uuid, booth_id uuid, created_at timestamp with time zone, expires_at timestamp with time zone)
 language plpgsql set search_path to ''
as $function$
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

create or replace function public.admin_issue_booth_tokens(p_booth_ids uuid[] default null::uuid[])
 returns table(booth_id uuid, token text, issued_at timestamp with time zone)
 language plpgsql security definer set search_path to ''
as $function$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception '관리자만 열쇠를 발급할 수 있습니다.' using errcode = '42501';
  end if;
  return query
    with issued as (
      insert into public.booth_access as a (booth_id, token)
      select b.id, translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_')
        from public.booths b
        join public.zones  z on z.key = b.zone_key
       where b.no is not null
         and (p_booth_ids is null or b.id = any (p_booth_ids))
      on conflict on constraint booth_access_pkey do nothing
      returning a.booth_id, a.token, a.created_at
    )
    select i.booth_id, i.token, i.created_at from issued i order by i.booth_id;
end;
$function$;

create or replace function public.admin_rotate_booth_token(p_booth_id uuid)
 returns table(token text, issued_at timestamp with time zone)
 language plpgsql security definer set search_path to ''
as $function$
#variable_conflict use_column
declare
  v_token  text;
  v_issued timestamptz;
begin
  if not public.is_admin() then
    raise exception '관리자만 열쇠를 바꿀 수 있습니다.' using errcode = '42501';
  end if;
  update public.booth_access as a
     set token       = translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_'),
         rotated_at  = pg_catalog.now(),
         disabled_at = null
   where a.booth_id = p_booth_id
  returning a.token, coalesce(a.rotated_at, a.created_at) into v_token, v_issued;
  if not found then
    raise exception '아직 열쇠를 발급하지 않은 부스입니다. 먼저 발급해 주세요.' using errcode = 'P0002';
  end if;
  return query select v_token, v_issued;
end;
$function$;

create or replace function public.admin_disable_booth_token(p_booth_id uuid)
 returns timestamp with time zone
 language plpgsql security definer set search_path to ''
as $function$
#variable_conflict use_column
declare
  v_at timestamptz;
begin
  if not public.is_admin() then
    raise exception '관리자만 열쇠를 끌 수 있습니다.' using errcode = '42501';
  end if;
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
$function$;

create or replace function public.admin_booth_access()
 returns table(booth_id uuid, token text, issued_at timestamp with time zone, rotated boolean, disabled boolean)
 language plpgsql security definer set search_path to ''
as $function$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception '관리자만 볼 수 있습니다.' using errcode = '42501';
  end if;
  return query
    select a.booth_id,
           case when a.disabled_at is null then a.token end,
           coalesce(a.rotated_at, a.created_at),
           a.rotated_at is not null,
           a.disabled_at is not null
      from public.booth_access a
     order by a.booth_id;
end;
$function$;

create or replace function public.admin_booth_credentials()
 returns table(booth_id uuid, qr_state text, qr_issued_at timestamp with time zone, pin_state text, pin_issued_at timestamp with time zone, pin_sessions integer, pin_failures_1h integer, live_by text)
 language plpgsql stable security definer set search_path to ''
as $function$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception '관리자만 볼 수 있습니다.' using errcode = '42501';
  end if;
  return query
    select b.id,
           case when a.booth_id is null then 'none' when a.disabled_at is not null then 'off' else 'on' end,
           coalesce(a.rotated_at, a.created_at),
           case when p.booth_id is null then 'none' when p.disabled_at is not null then 'off' else 'on' end,
           coalesce(p.reissued_at, p.issued_at),
           (select count(*) from public.booth_session s
             where s.booth_id = b.id and s.revoked_at is null and s.expires_at > pg_catalog.now())::integer,
           (select count(*) from public.booth_auth_event e
             where e.booth_id = b.id and e.event = 'pin_fail' and e.at > pg_catalog.now() - interval '1 hour')::integer,
           (select case when g.source = 'admin' then 'admin' when g.session_id is not null then 'pin' else 'qr' end
              from public.booth_live_log g
             where g.booth_id = b.id
             order by g.created_at desc, g.id desc
             limit 1)
      from public.booths b
      left join public.booth_access a on a.booth_id = b.id
      left join public.booth_pin    p on p.booth_id = b.id
     order by b.id;
end;
$function$;

create or replace function public.booth_ctrl_get(p_token text)
 returns table(booth_id uuid, code text, zone_key text, zone_label text, name text, org text, congestion text, wait_minutes integer, updated_at timestamp with time zone, issued_at timestamp with time zone, token_tail text)
 language sql security definer set search_path to ''
as $function$
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

create or replace function public.booth_ctrl_set(p_token text, p_mode text, p_wait_minutes integer)
 returns table(booth_id uuid, code text, zone_key text, zone_label text, name text, org text, congestion text, wait_minutes integer, updated_at timestamp with time zone, issued_at timestamp with time zone, token_tail text)
 language plpgsql security definer set search_path to ''
as $function$
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

create or replace function public.booth_pin_login(p_booth_id uuid, p_pin text, p_device text default null::text)
 returns table(ok boolean, reason text, retry_after integer, session text, expires_at timestamp with time zone, booth_id uuid, code text, zone_key text, zone_label text, name text, org text, congestion text, wait_minutes integer, updated_at timestamp with time zone)
 language plpgsql security definer set search_path to ''
as $function$
#variable_conflict use_column
declare
  c_dummy  constant text := '$2a$10$lbS/kgNlmfpNa2ZehjX/tu58PIpz4BvIBUmhwDE16XEU.Gatab65i';
  v_now    timestamptz := pg_catalog.now();
  v_on     boolean;
  v_end    timestamptz;
  v_ip     text;
  v_dev    text;
  v_booth  uuid;
  v_hash   text;
  v_match  boolean := false;
  v_common boolean := false;
  v_retry  integer;
  v_kind   text;
  v_token  text;
  v_exp    timestamptz;
  v_sid    uuid;
begin
  if coalesce(pg_catalog.current_setting('request.method', true), '') in ('GET', 'HEAD') then
    return query select * from private.booth_pin_no('invalid', 0);
    return;
  end if;

  select s.booth_pin_enabled, s.event_end into v_on, v_end from public.settings s order by s.id limit 1;
  if not coalesce(v_on, false) or (v_end is not null and v_now > v_end + interval '12 hours') then
    return query select * from private.booth_pin_no('off', 0);
    return;
  end if;

  v_ip  := private.booth_tag('ip', private.booth_client_ip());
  v_dev := coalesce(case when p_device ~ '^[A-Za-z0-9_-]{16,64}$' then private.booth_tag('dev', p_device) end, 'nodev');
  select b.id into v_booth from public.booths b where b.id = p_booth_id;

  if (v_ip is not null and not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('booth_pin:ip:' || v_ip, 0)))
     or not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('booth_pin:dev:' || v_dev, 0))
     or (v_booth is not null
         and not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('booth_pin:booth:' || v_booth::text, 0))) then
    return query select * from private.booth_pin_no('limited', 1);
    return;
  end if;

  select r.retry, r.kind into v_retry, v_kind from private.booth_pin_retry_after(v_ip, v_dev, v_booth, v_now) r;
  if v_retry > 0 then
    if not exists (select 1 from public.booth_auth_event e
                    where e.event = 'pin_limited' and e.device_tag = v_dev and e.at > v_now - interval '1 minute') then
      insert into public.booth_auth_event (event, booth_id, ip_tag, device_tag, limit_kind)
      values ('pin_limited', v_booth, v_ip, v_dev, v_kind);
    end if;
    return query select * from private.booth_pin_no('limited', v_retry);
    return;
  end if;

  if p_pin ~ '^[0-9]{6}$' then
    if v_booth is not null then
      select p.pin_hash into v_hash
        from public.booth_pin p
        join public.booths b on b.id = p.booth_id
        join public.zones  z on z.key = b.zone_key
       where p.booth_id = v_booth
         and p.disabled_at is null
         and b.is_published and z.is_published and b.no is not null;
    end if;
    v_match := extensions.crypt(private.booth_pin_digest(p_pin), coalesce(v_hash, c_dummy)) = v_hash;
  end if;

  if not coalesce(v_match, false) and v_booth is not null and private.booth_common_pin_ok(v_booth, p_pin) then
    v_match  := true;
    v_common := true;
  end if;

  if not coalesce(v_match, false) then
    insert into public.booth_auth_event (event, booth_id, ip_tag, device_tag)
    values ('pin_fail', v_booth, v_ip, v_dev);
    select r.retry into v_retry from private.booth_pin_retry_after(v_ip, v_dev, v_booth, v_now) r;
    return query select * from private.booth_pin_no('invalid', v_retry);
    return;
  end if;

  with cut as (
    update public.booth_session as s
       set revoked_at = v_now, revoke_reason = 'same_device'
     where s.booth_id = v_booth and s.device_tag = v_dev and v_dev <> 'nodev'
       and s.revoked_at is null and s.expires_at > v_now
    returning s.id
  )
  insert into public.booth_auth_event (event, booth_id, session_id, detail)
  select 'session_revoked', v_booth, cut.id, 'same_device' from cut;

  with extra as (
    select s.id from public.booth_session s
     where s.booth_id = v_booth and s.revoked_at is null and s.expires_at > v_now
     order by s.created_at desc
    offset 9
  ), cut as (
    update public.booth_session as s
       set revoked_at = v_now, revoke_reason = 'session_cap'
      from extra where s.id = extra.id
    returning s.id
  )
  insert into public.booth_auth_event (event, booth_id, session_id, detail)
  select 'session_revoked', v_booth, cut.id, 'session_cap' from cut;

  v_token := private.booth_session_token();
  v_exp := least(v_now + interval '12 hours',
                 ((v_now at time zone 'Asia/Seoul')::date + 1)::timestamp at time zone 'Asia/Seoul');
  insert into public.booth_session (booth_id, token_hash, created_at, expires_at, last_used_at, device_tag, via_common_pin)
  values (v_booth, extensions.digest(v_token, 'sha256'), v_now, v_exp, v_now, v_dev, v_common)
  returning id into v_sid;

  insert into public.booth_auth_event (event, booth_id, session_id, ip_tag, device_tag, detail)
  values ('pin_ok', v_booth, v_sid, v_ip, v_dev, case when v_common then 'common_pin' end);

  return query
    select true, null::text, 0, v_token, v_exp,
           r.booth_id, r.code, r.zone_key, r.zone_label, r.name, r.org, r.congestion, r.wait_minutes, r.updated_at
      from private.booth_op_row(v_booth) r;
end;
$function$;

create or replace function public.booth_session_set(p_session text, p_mode text, p_wait_minutes integer)
 returns table(booth_id uuid, code text, zone_key text, zone_label text, name text, org text, congestion text, wait_minutes integer, updated_at timestamp with time zone, issued_at timestamp with time zone, token_tail text, expires_at timestamp with time zone)
 language plpgsql security definer set search_path to ''
as $function$
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

-- ── 공개(RLS) 규칙 — Production 정책과 같은 조건 ─────────────────────
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;
grant select on public.booths, public.zones, public.settings, public.booth_live to anon, authenticated;
alter table public.booths enable row level security;
alter table public.zones enable row level security;
alter table public.settings enable row level security;
alter table public.booth_live enable row level security;
create policy "공개 부스 열람" on public.booths for select to anon, authenticated
  using (is_published and no is not null and exists (select 1 from public.zones z where z.key = booths.zone_key and z.is_published));
create policy "공개 구역 열람" on public.zones for select to anon, authenticated using (is_published);
create policy "누구나 열람" on public.settings for select to anon, authenticated using (true);
create policy "공개 부스 대기 열람" on public.booth_live for select to anon, authenticated
  using (exists (select 1 from public.booths b where b.id = booth_live.booth_id));
-- 운영자 · 관람객 함수는 anon 도 부를 수 있음(Production 과 같음). 관리자 함수는 authenticated 만.
grant execute on function public.booth_ctrl_get(text), public.booth_ctrl_set(text, text, integer),
  public.booth_pin_login(uuid, text, text), public.booth_session_set(text, text, integer) to anon, authenticated;
