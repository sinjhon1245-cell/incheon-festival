-- ===================================================================
-- 운영 준비용 예시 부스 공통 PIN (부스 운영자 PIN 로그인에 리허설 길 하나 더하기)
--
--   운영 준비 기간에 Production 에 공개해 둔 예시 부스(운영기관 이름이 '[예시]' 로 시작)는
--   부스마다 PIN 을 발급하지 않아도 공통 PIN 하나로 운영자 화면을 열 수 있게 합니다.
--   협의 · 시연 때마다 PIN 을 재발급하지 않으려는 것입니다.
--
--   공통 PIN 이 통하는 조건 — 모두 서버가 로그인하는 순간 확인합니다
--     settings.booth_pin_enabled                = true   PIN 전체 스위치(기존)
--     settings.booth_sample_common_pin_enabled  = true   이 기능 스위치(새 칸, 기본 false)
--     부스 공개 · 구역 공개 · 부스 번호 있음
--     booths.org 가 '[예시]' 로 시작
--   하나라도 아니면 공통 PIN 은 틀린 PIN 과 똑같습니다(실패 기록 · 횟수 제한 그대로).
--
--   실제 PIN 은 바꾸지 않습니다
--     booth_pin(bcrypt bf10 + Vault pepper) · 발급 · 끄기 · 약한 PIN 거르기 · 횟수 제한 · 세션 규칙 그대로.
--     공통 PIN 은 booth_pin 에 없는 값이고, 실제 PIN 을 먼저 견준 뒤 맞지 않을 때만 봅니다.
--     123456 은 약한 PIN(연속 숫자)이라 실제 PIN 으로는 만들어지지 않습니다.
--     실제 PIN 이 있는 예시 부스는 두 PIN 이 모두 통합니다.
--
--   공통 PIN 으로 연 세션은 표시해 둡니다(booth_session.via_common_pin). 그 세션은 쓸 때마다
--   위 조건을 다시 봅니다 — 기관에서 '[예시]' 를 지우거나 스위치를 끄면, 그 부스의 공통 PIN
--   로그인도 이미 열린 공통 PIN 화면도 그 순간 멈춥니다. 실제 PIN 으로 연 세션은 그대로입니다.
--
--   공통 PIN 값(123456)은 아래 private.booth_common_pin_ok 안에만 있는 리허설용 값입니다.
--   표에 저장하지 않고, 보안 기록(booth_auth_event)에는 원문 대신 detail = 'common_pin' 만 남깁니다.
--   운영자 화면은 예시 부스를 고르면 이 값을 안내만 합니다 — 맞는지는 늘 서버가 정합니다.
--
--   바꾸는 기존 객체 (칸 더하기 · 함수 내용 — 인자 · 돌려주는 모양 · 권한은 그대로)
--     public.settings.booth_sample_common_pin_enabled   새 칸(기본 false)
--     public.booth_session.via_common_pin               새 칸(기본 false)
--     public.booth_auth_event 의 detail 허용 값          'common_pin' 추가
--     private.booth_session_resolve(text, boolean)      공통 PIN 세션 다시 확인
--     public.booth_pin_login(uuid, text, text)          공통 PIN 길
--   QR(booth_ctrl_* · booth_access)은 건드리지 않습니다(맨 아래 확인 표가 정의 md5 로 견줍니다).
--
-- 사용법: apply_migration 또는 SQL Editor 에 전체 붙여넣고 Run(한 트랜잭션). 여러 번 돌려도 같습니다.
--   적용 직후에는 새 스위치가 꺼져 있어 달라지는 것이 없습니다. 켜기 · 끄기:
--     update public.settings set booth_sample_common_pin_enabled = true;   -- 운영 준비 기간
--     update public.settings set booth_sample_common_pin_enabled = false;  -- 실제 행사로 넘어갈 때
--   (관리자 화면 → 기본정보 → '부스 운영자 PIN' 에서도 켜고 끕니다)
-- 되돌리기: rollback-booth-example-pin.sql
-- 선행: migration-booth-pin.sql
-- ===================================================================


-- ═══════════════════════════════════════════════════════════════
-- 0. 선행 조건 (아무것도 바꾸지 않습니다)
-- ═══════════════════════════════════════════════════════════════
do $preflight$
begin
  if to_regprocedure('public.booth_pin_login(uuid,text,text)') is null
     or to_regprocedure('private.booth_session_resolve(text,boolean)') is null
     or to_regclass('public.booth_session') is null
     or to_regclass('public.booth_auth_event') is null then
    raise exception '선행 조건 누락: migration-booth-pin.sql 을 먼저 적용하세요.';
  end if;
end
$preflight$;

create temp table booth_example_pin_qr_before on commit drop as
select p.oid::regprocedure::text as fn, md5(pg_catalog.pg_get_functiondef(p.oid)) as h
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('booth_ctrl_get', 'booth_ctrl_set', 'booth_ctrl_touch');


-- ═══════════════════════════════════════════════════════════════
-- 1. 칸 — 스위치 하나 · 세션 표시 하나
-- ═══════════════════════════════════════════════════════════════
alter table public.settings add column if not exists booth_sample_common_pin_enabled boolean not null default false;
comment on column public.settings.booth_sample_common_pin_enabled is
  '운영 준비용 예시 부스(운영기관 이름이 [예시] 로 시작) 공통 PIN 스위치. 실제 행사로 넘어갈 때 끕니다. booth_pin_enabled 도 켜져 있어야 동작합니다.';

alter table public.booth_session add column if not exists via_common_pin boolean not null default false;
comment on column public.booth_session.via_common_pin is
  '운영 준비용 공통 PIN 으로 연 세션. 쓸 때마다 스위치 · 공개 · [예시] 조건을 다시 봅니다.';


-- ═══════════════════════════════════════════════════════════════
-- 2. 보안 기록 — 공통 PIN 로그인 표시(원문은 적지 않음)
-- ═══════════════════════════════════════════════════════════════
alter table public.booth_auth_event drop constraint if exists booth_auth_event_detail_check;
alter table public.booth_auth_event add constraint booth_auth_event_detail_check
  check (detail is null or detail in ('logout', 'pin_reissued', 'pin_disabled', 'session_cap', 'same_device', 'common_pin'));


-- ═══════════════════════════════════════════════════════════════
-- 3. private 도우미 — API 로 드러나지 않습니다(anon · authenticated 실행 권한 없음)
-- ═══════════════════════════════════════════════════════════════

-- 3-1. 이 부스가 지금 공통 PIN 대상인가: 스위치 둘 · 부스 공개 · 구역 공개 · 번호 · '[예시]'.
--   PIN 전체 스위치(booth_pin_enabled)는 booth_pin_login · booth_session_resolve 가 먼저 봅니다.
create or replace function private.booth_common_pin_target(p_booth uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select s.booth_sample_common_pin_enabled from public.settings s order by s.id limit 1), false)
     and exists (
       select 1 from public.booths b join public.zones z on z.key = b.zone_key
        where b.id = p_booth and b.is_published and z.is_published and b.no is not null
          and b.org ~ '^\s*\[예시\]'
     )
$$;

-- 3-2. 공통 PIN 이 맞고 대상 부스인가. 리허설용 값은 이 함수 안에만 둡니다.
create or replace function private.booth_common_pin_ok(p_booth uuid, p_pin text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(p_pin = '123456', false) and private.booth_common_pin_target(p_booth)
$$;

revoke all on function private.booth_common_pin_target(uuid)     from public;
revoke all on function private.booth_common_pin_target(uuid)     from anon, authenticated;
revoke all on function private.booth_common_pin_ok(uuid, text)   from public;
revoke all on function private.booth_common_pin_ok(uuid, text)   from anon, authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 4. 세션 확인 — 공통 PIN 세션은 쓸 때마다 조건을 다시 봅니다
--    (migration-booth-pin.sql 5-13 과 같고, 표시한 네 줄만 더했습니다)
-- ═══════════════════════════════════════════════════════════════
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
  -- 운영 준비용 공통 PIN 으로 연 세션은 쓸 때마다 조건을 다시 봅니다. 기관에서 '[예시]' 를 지우거나
  -- 공통 PIN 스위치를 끄면 그 순간 멈춥니다(운영자 화면은 'PIN을 바꿨습니다' 안내로 처음 화면에 돌아감).
  if s.via_common_pin and not private.booth_common_pin_target(s.booth_id) then
    raise exception '운영 준비용 공통 PIN을 더 이상 쓸 수 없습니다.' using errcode = '42501', hint = 'booth_session_revoked';
  end if;

  if p_mark or s.last_used_at is null or s.last_used_at < pg_catalog.now() - interval '10 minutes' then
    update public.booth_session as x set last_used_at = pg_catalog.now() where x.id = s.id;
  end if;

  return query select s.id, s.booth_id, s.created_at, s.expires_at;
end;
$$;
revoke all on function private.booth_session_resolve(text, boolean) from public;
revoke all on function private.booth_session_resolve(text, boolean) from anon, authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 5. PIN 로그인 — 실제 PIN 다음에 공통 PIN 을 봅니다
--    (migration-booth-pin.sql 6-1 과 같고, v_common · 공통 PIN 확인 · 세션 표시 · 기록 detail 만 더했습니다)
-- ═══════════════════════════════════════════════════════════════
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

  -- 운영 준비용 예시 부스 공통 PIN. 실제 PIN 이 맞지 않았을 때만 봅니다(실제 PIN 이 늘 먼저).
  -- 조건(스위치 · 공개 · '[예시]')은 private.booth_common_pin_ok 가 이 자리에서 다시 확인합니다.
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
  insert into public.booth_session (booth_id, token_hash, created_at, expires_at, last_used_at, device_tag, via_common_pin)
  values (v_booth, extensions.digest(v_token, 'sha256'), v_now, v_exp, v_now, v_dev, v_common)
  returning id into v_sid;

  -- 공통 PIN 로그인은 원문 대신 detail 'common_pin' 만 남깁니다.
  insert into public.booth_auth_event (event, booth_id, session_id, ip_tag, device_tag, detail)
  values ('pin_ok', v_booth, v_sid, v_ip, v_dev, case when v_common then 'common_pin' end);

  return query
    select true, null::text, 0, v_token, v_exp,
           r.booth_id, r.code, r.zone_key, r.zone_label, r.name, r.org, r.congestion, r.wait_minutes, r.updated_at
      from private.booth_op_row(v_booth) r;
end;
$$;
revoke all     on function public.booth_pin_login(uuid, text, text) from public;
grant  execute on function public.booth_pin_login(uuid, text, text) to anon, authenticated;
comment on function public.booth_pin_login(uuid, text, text) is
  '부스 운영자 PIN 로그인(구역 → 부스 → 6자리). 실제 PIN 다음에 운영 준비용 예시 부스 공통 PIN 을 봅니다(스위치 · 공개 · [예시] 조건). 실패도 오류 없이 ok=false 로 답합니다. anon 실행 권한은 의도된 것입니다.';


-- ═══════════════════════════════════════════════════════════════
-- 6. 확인 — 모든 줄이 '기대' 와 '실제' 가 같아야 합니다(참고 줄은 기대가 비어 있음)
-- ═══════════════════════════════════════════════════════════════
select v."순서", v."항목", v."기대", v."실제",
       case when v."기대" is null then '참고' when v."기대" = v."실제" then 'OK' else '확인 필요' end as "결과"
  from (values
    (1, 'QR 함수 정의 그대로 (booth_ctrl_get · set · touch)', '3',
        (select count(*) from booth_example_pin_qr_before b
           join pg_catalog.pg_proc p on p.oid::regprocedure::text = b.fn
          where p.prokind = 'f' and md5(case when p.prokind = 'f' then pg_catalog.pg_get_functiondef(p.oid) end) = b.h)::text),
    (2, 'settings.booth_sample_common_pin_enabled 기본값 false', 'false',
        (select column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'settings' and column_name = 'booth_sample_common_pin_enabled')),
    (3, 'booth_session.via_common_pin 기본값 false', 'false',
        (select column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'booth_session' and column_name = 'via_common_pin')),
    (4, '새 private 함수 실행 권한 (anon · authenticated, 어느 하나라도)', 'false',
        (select coalesce(bool_or(has_function_privilege(r.rol, p.oid, 'EXECUTE')), false)
           from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace,
                unnest(array['anon', 'authenticated']) r(rol)
          where n.nspname = 'private' and p.proname in ('booth_common_pin_target', 'booth_common_pin_ok', 'booth_session_resolve'))::text),
    (5, 'booth_pin_login security definer · search_path 빈 값 · 소유자 postgres', 'true',
        (select pro.prosecdef and pro.proconfig = array['search_path=""'] and pg_catalog.pg_get_userbyid(pro.proowner) = 'postgres'
           from pg_catalog.pg_proc pro where pro.oid = 'public.booth_pin_login(uuid,text,text)'::regprocedure)::text),
    (6, 'anon 의 booth_pin_login 실행 (운영자 화면용 — 기존과 같음)', 'true',
        has_function_privilege('anon', 'public.booth_pin_login(uuid,text,text)', 'EXECUTE')::text),
    (7, '123456 은 실제 PIN 으로 약한 PIN (발급 · 받기 모두 거름)', 'true',
        private.booth_pin_weak('123456')::text),
    (8, 'PIN 로그인 · 세션 함수가 booth_access 를 읽지 않음', 'false',
        (select coalesce(bool_or(case when pro.prokind = 'f' then pg_catalog.pg_get_functiondef(pro.oid) like '%booth_access%' end), false)
           from pg_catalog.pg_proc pro join pg_catalog.pg_namespace nsp on nsp.oid = pro.pronamespace
          where pro.prokind = 'f'
            and ((nsp.nspname = 'public' and pro.proname = 'booth_pin_login') or nsp.nspname = 'private'))::text),
    (9, '참고: 스위치 (PIN 전체 · 예시 공통 PIN)', null,
        (select coalesce(bool_or(s.booth_pin_enabled), false)::text || ' · ' ||
                coalesce(bool_or(s.booth_sample_common_pin_enabled), false)::text from public.settings s)),
    (10, '참고: 지금 공통 PIN 대상 부스 수', null,
        (select count(*) from public.booths b where private.booth_common_pin_target(b.id))::text)
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";
