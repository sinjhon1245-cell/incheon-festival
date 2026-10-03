-- ===================================================================
-- 되돌리기: 운영 준비용 예시 부스 공통 PIN (migration-booth-example-pin.sql)
--
--   공통 PIN 을 당장 멈추기만 하려면 이 파일 대신 스위치 한 줄이면 됩니다:
--     update public.settings set booth_sample_common_pin_enabled = false;
--   (공통 PIN 로그인과 열린 공통 PIN 화면이 모두 멈추고, 실제 PIN · QR 은 그대로)
--
--   이 파일은 기능을 통째로 걷어냅니다: PIN 로그인 · 세션 확인 함수를 migration-booth-pin.sql
--   의 정의로 되돌리고, 공통 PIN 으로 연 세션을 끊은 뒤 새 칸 둘 · private 도우미 둘을 지우고
--   보안 기록 detail 허용 값을 원래대로 돌립니다(그 전에 'common_pin' 표시만 비웁니다 — 기록 줄은 남김).
--   실제 PIN · 세션 · QR 은 건드리지 않습니다.
--
-- 사용법: SQL Editor · apply_migration 에 전체 붙여넣고 Run(한 트랜잭션). 여러 번 돌려도 같습니다.
-- ===================================================================

create temp table booth_example_pin_rb_qr_before on commit drop as
select p.oid::regprocedure::text as fn, md5(pg_catalog.pg_get_functiondef(p.oid)) as h
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('booth_ctrl_get', 'booth_ctrl_set', 'booth_ctrl_touch');

-- 1. 세션 확인 · PIN 로그인을 migration-booth-pin.sql 의 정의로 되돌립니다(공통 PIN 길 없음)
create or replace function private.booth_session_resolve(p_session text, p_mark boolean)
returns table (session_id uuid, booth_id uuid, created_at timestamptz, expires_at timestamptz)
language plpgsql
volatile
set search_path = ''
as $$
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

  if p_mark or s.last_used_at is null or s.last_used_at < pg_catalog.now() - interval '10 minutes' then
    update public.booth_session as x set last_used_at = pg_catalog.now() where x.id = s.id;
  end if;

  return query select s.id, s.booth_id, s.created_at, s.expires_at;
end;
$$;
revoke all on function private.booth_session_resolve(text, boolean) from public;
revoke all on function private.booth_session_resolve(text, boolean) from anon, authenticated;

create or replace function public.booth_pin_login(p_booth_id uuid, p_pin text, p_device text default null)
returns table (ok boolean, reason text, retry_after integer, session text, expires_at timestamptz,
               booth_id uuid, code text, zone_key text, zone_label text, name text, org text,
               congestion text, wait_minutes integer, updated_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  -- PIN 이 없는 부스에도 같은 시간이 걸리게 계산할 가짜 bcrypt 해시(무작위 값의 해시, PIN 아님).
  c_dummy  constant text := '$2a$10$lbS/kgNlmfpNa2ZehjX/tu58PIpz4BvIBUmhwDE16XEU.Gatab65i';
  v_now    timestamptz := pg_catalog.now();
  v_on     boolean;
  v_end    timestamptz;
  v_ip     text;
  v_dev    text;
  v_booth  uuid;
  v_hash   text;
  v_match  boolean := false;
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
  -- 기록의 부스 칸은 외래 키라, 있는 부스일 때만 적습니다.
  select b.id into v_booth from public.booths b where b.id = p_booth_id;

  -- 같은 IP · 기기 · 부스의 동시 시도는 줄을 세웁니다. 기다리지 않고 1초 뒤 다시 하라고 답합니다.
  if (v_ip is not null and not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('booth_pin:ip:' || v_ip, 0)))
     or not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('booth_pin:dev:' || v_dev, 0))
     or (v_booth is not null
         and not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('booth_pin:booth:' || v_booth::text, 0))) then
    return query select * from private.booth_pin_no('limited', 1);
    return;
  end if;

  select r.retry, r.kind into v_retry, v_kind from private.booth_pin_retry_after(v_ip, v_dev, v_booth, v_now) r;
  if v_retry > 0 then
    -- 제한에 걸린 시도는 기기마다 1분에 한 줄만 남깁니다(기록이 부풀지 않게).
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
    -- 늘 bcrypt 를 한 번 돌립니다(해시가 없으면 가짜 해시로) — 응답 시간으로 PIN 발급 여부를 알 수 없게.
    v_match := extensions.crypt(private.booth_pin_digest(p_pin), coalesce(v_hash, c_dummy)) = v_hash;
  end if;

  if not coalesce(v_match, false) then
    insert into public.booth_auth_event (event, booth_id, ip_tag, device_tag)
    values ('pin_fail', v_booth, v_ip, v_dev);
    select r.retry into v_retry from private.booth_pin_retry_after(v_ip, v_dev, v_booth, v_now) r;
    return query select * from private.booth_pin_no('invalid', v_retry);
    return;
  end if;

  -- 같은 기기가 같은 부스로 다시 들어오면 그 기기의 이전 세션은 정리합니다.
  with cut as (
    update public.booth_session as s
       set revoked_at = v_now, revoke_reason = 'same_device'
     where s.booth_id = v_booth and s.device_tag = v_dev and v_dev <> 'nodev'
       and s.revoked_at is null and s.expires_at > v_now
    returning s.id
  )
  insert into public.booth_auth_event (event, booth_id, session_id, detail)
  select 'session_revoked', v_booth, cut.id, 'same_device' from cut;

  -- 부스당 활성 세션은 10개까지 — 새 세션 자리를 위해 가장 오래된 것부터 끊습니다.
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

  -- 만료: 로그인 + 12시간과 그날 24:00(한국 시각) 중 이른 쪽.
  v_token := private.booth_session_token();
  v_exp := least(v_now + interval '12 hours',
                 ((v_now at time zone 'Asia/Seoul')::date + 1)::timestamp at time zone 'Asia/Seoul');
  insert into public.booth_session (booth_id, token_hash, created_at, expires_at, last_used_at, device_tag)
  values (v_booth, extensions.digest(v_token, 'sha256'), v_now, v_exp, v_now, v_dev)
  returning id into v_sid;

  insert into public.booth_auth_event (event, booth_id, session_id, ip_tag, device_tag)
  values ('pin_ok', v_booth, v_sid, v_ip, v_dev);

  return query
    select true, null::text, 0, v_token, v_exp,
           r.booth_id, r.code, r.zone_key, r.zone_label, r.name, r.org, r.congestion, r.wait_minutes, r.updated_at
      from private.booth_op_row(v_booth) r;
end;
$$;
revoke all     on function public.booth_pin_login(uuid, text, text) from public;
grant  execute on function public.booth_pin_login(uuid, text, text) to anon, authenticated;
comment on function public.booth_pin_login(uuid, text, text) is
  '부스 운영자 PIN 로그인(구역 → 부스 → 6자리). 실패도 오류 없이 ok=false 로 답합니다. anon 실행 권한은 의도된 것입니다 — 보안 점검 경고를 보고 거두지 마세요.';

-- 2. 공통 PIN 으로 연 세션은 끊습니다(칸을 지우면 더는 가려낼 수 없으므로)
do $cut$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'booth_session' and column_name = 'via_common_pin') then
    execute $q$update public.booth_session set revoked_at = now(), revoke_reason = 'logout'
               where via_common_pin and revoked_at is null$q$;
  end if;
end
$cut$;

-- 3. 보안 기록: 'common_pin' 표시를 비우고 허용 값을 원래대로
update public.booth_auth_event set detail = null where detail = 'common_pin';
alter table public.booth_auth_event drop constraint if exists booth_auth_event_detail_check;
alter table public.booth_auth_event add constraint booth_auth_event_detail_check
  check (detail is null or detail in ('logout', 'pin_reissued', 'pin_disabled', 'session_cap', 'same_device'));

-- 4. private 도우미 · 칸
drop function if exists private.booth_common_pin_ok(uuid, text);
drop function if exists private.booth_common_pin_target(uuid);
alter table public.booth_session drop column if exists via_common_pin;
alter table public.settings drop column if exists booth_sample_common_pin_enabled;

-- 5. 확인
select v."항목", v."기대", v."실제", case when v."기대" = v."실제" then 'OK' else '확인 필요' end as "결과"
  from (values
    ('QR 함수 정의 그대로', '3',
     (select count(*) from booth_example_pin_rb_qr_before b
        join pg_catalog.pg_proc p on p.oid::regprocedure::text = b.fn
       where p.prokind = 'f' and md5(case when p.prokind = 'f' then pg_catalog.pg_get_functiondef(p.oid) end) = b.h)::text),
    ('공통 PIN 도우미 남음', '0',
     (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and p.proname in ('booth_common_pin_target', 'booth_common_pin_ok'))::text),
    ('PIN 로그인에 공통 PIN 길 남음', 'false',
     (pg_catalog.pg_get_functiondef('public.booth_pin_login(uuid,text,text)'::regprocedure) like '%common_pin%')::text)
  ) as v("항목", "기대", "실제");
