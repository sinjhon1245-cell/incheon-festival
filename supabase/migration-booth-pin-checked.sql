-- ===================================================================
-- 운영자 PIN 조건부 발급 (admin_issue_booth_pin_checked) — 초안 · 미적용
--
--   왜 필요한가
--     admin_issue_booth_pin(부스) 는 첫 발급 · 재발급 · 다시 켜기를 조건 없이 처리합니다.
--     관리자 A 가 'PIN 미발급' 을 본 직후 관리자 B 가 같은 부스에 PIN 을 발급하면,
--     A 의 '선택 PIN 발급' 이 B 의 PIN 을 조용히 덮어씁니다(B 가 나눠 준 PIN 이 실패하고
--     그 PIN 으로 연 기기가 로그아웃). 화면이 직전에 다시 확인해도 그 확인과 발급 사이의
--     틈(왕복 한 번)은 화면만으로 닫을 수 없습니다.
--
--   이 파일이 하는 일 (더하기만 합니다)
--     public.admin_issue_booth_pin_checked(부스, 기대 상태, 기대 발급 시각) 하나를 만듭니다.
--       1. 관리자인지 확인합니다(is_admin).
--       2. 부스 줄과 그 부스의 PIN 줄을 잠근 뒤 지금 상태를 읽습니다.
--          부스 줄 잠금(FOR UPDATE)은 같은 부스의 첫 발급(PIN 새 줄 — 외래 키 확인이 부스 줄을
--          KEY SHARE 로 잠금)과도 순서를 맞춥니다.
--       3. 상태('none' · 'on' · 'off')와 발급 시각(admin_booth_credentials 의 pin_issued_at)이
--          화면이 본 값과 다르면 아무것도 바꾸지 않고 멈춥니다(hint = booth_pin_state_changed).
--       4. 같으면 기존 admin_issue_booth_pin(부스) 를 그대로 부릅니다 — PIN 만들기 · 해시 ·
--          세션 끊기 · 보안 기록은 기존 함수 그대로입니다(한 글자도 바꾸지 않습니다).
--     p_booth_id 가 null 이면 아무것도 하지 않고 0줄을 돌려줍니다. 관리자 화면이 이 함수가
--     있는지 알아보는 데 씁니다(없으면 PGRST202).
--
--   바꾸지 않는 것
--     admin_issue_booth_pin · admin_disable_booth_pin · admin_booth_credentials · booth_pin_login ·
--     booth_session_* · booth_ctrl_* · 표 · 칸 · 설정. 확인 표가 적용 전후 정의 md5 를 견줍니다.
--     관리자 → 부스 ⋯ 메뉴의 개별 PIN 발급은 계속 기존 함수를 씁니다.
--
--   적용 전 · 후 화면
--     print-qr.html 의 '운영자 PIN 발급·관리' 는 이 함수가 있으면 이것으로, 없으면 기존 함수로
--     발급합니다(없을 때는 부스마다 직전 상태를 다시 읽어 틈을 줄이기만 합니다).
--
-- 사용법 (승인 뒤에만): SQL Editor 또는 apply_migration 에 전체 붙여넣고 Run(한 트랜잭션).
--   여러 번 실행해도 같은 결과입니다. 되돌리기: rollback-booth-pin-checked.sql
-- 선행: migration-booth-pin.sql
-- ===================================================================

do $preflight$
begin
  if to_regprocedure('public.admin_issue_booth_pin(uuid)') is null
     or to_regclass('public.booth_pin') is null or to_regprocedure('public.is_admin()') is null then
    raise exception '선행 조건 누락: migration-booth-pin.sql 을 먼저 적용하세요.';
  end if;
end
$preflight$;

-- 기존 함수 정의(md5). 맨 아래 확인 표가 이 파일을 돌린 뒤와 견줍니다.
create temp table booth_pin_checked_before on commit drop as
select p.oid::regprocedure::text as fn, md5(pg_catalog.pg_get_functiondef(p.oid)) as h
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('admin_issue_booth_pin', 'admin_disable_booth_pin', 'admin_booth_credentials',
                     'booth_pin_login', 'booth_ctrl_get', 'booth_ctrl_set', 'booth_ctrl_touch');

drop function if exists public.admin_issue_booth_pin_checked(uuid, text, timestamptz);
create function public.admin_issue_booth_pin_checked(p_booth_id uuid, p_expect_state text,
                                                     p_expect_issued_at timestamptz default null)
returns table (pin text, issued_at timestamptz, revoked_sessions integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_state text;
  v_at    timestamptz;
  v_by    uuid;
begin
  if not public.is_admin() then
    raise exception '관리자만 PIN 을 발급할 수 있습니다.' using errcode = '42501';
  end if;
  -- 있는지 알아보기용: 아무것도 하지 않습니다.
  if p_booth_id is null then
    return;
  end if;
  if p_expect_state is null or p_expect_state not in ('none', 'on', 'off') then
    raise exception '기대 상태가 올바르지 않습니다.' using errcode = '22023', hint = 'booth_pin_bad_expect';
  end if;

  perform 1 from public.booths b where b.id = p_booth_id for update;
  if not found then
    raise exception '해당 부스를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  select case when p.disabled_at is not null then 'off' else 'on' end, coalesce(p.reissued_at, p.issued_at), p.issued_by
    into v_state, v_at, v_by
    from public.booth_pin p
   where p.booth_id = p_booth_id
     for update;
  if not found then
    v_state := 'none';
    v_at := null;
    v_by := null;
  end if;

  if v_state <> p_expect_state
     or (p_expect_state <> 'none' and v_at is distinct from p_expect_issued_at) then
    -- 같은 관리자 계정이 방금(2분 안) 바꾼 것이면 따로 알립니다. 응답을 잃은 앞 요청을 브라우저가
    -- 저절로 다시 보낸 경우가 여기에 걸립니다 — 그때는 PIN 이 이미 바뀌었고 원문은 아무도 모릅니다.
    -- (같은 계정을 쓰는 다른 기기일 수도 있어 화면은 '결과 확인 필요' 로만 다룹니다.)
    if v_by is not null and v_by = auth.uid() and v_at > pg_catalog.now() - interval '2 minutes' then
      raise exception '같은 관리자 계정으로 방금 이 부스의 PIN 이 바뀌었습니다. 응답을 받지 못한 앞 요청이 처리됐을 수 있습니다.'
        using errcode = 'P0001', hint = 'booth_pin_state_changed_self';
    end if;
    raise exception '다른 곳에서 이 부스의 PIN 상태가 바뀌었습니다. 새로 고친 뒤 다시 확인해 주세요.'
      using errcode = 'P0001', hint = 'booth_pin_state_changed';
  end if;

  return query select r.pin, r.issued_at, r.revoked_sessions from public.admin_issue_booth_pin(p_booth_id) r;
end;
$$;

revoke all     on function public.admin_issue_booth_pin_checked(uuid, text, timestamptz) from public;
revoke execute on function public.admin_issue_booth_pin_checked(uuid, text, timestamptz) from anon;
grant  execute on function public.admin_issue_booth_pin_checked(uuid, text, timestamptz) to authenticated;

comment on function public.admin_issue_booth_pin_checked(uuid, text, timestamptz) is
  '관리자 전용. 화면이 본 PIN 상태 · 발급 시각이 지금과 같을 때만 admin_issue_booth_pin 을 부릅니다(다르면 booth_pin_state_changed). p_booth_id 가 null 이면 0줄.';

notify pgrst, 'reload schema';

-- 확인 (읽기만). '맞음' 이 모두 true 여야 합니다.
select '기존 함수 정의 그대로' as 항목,
       (select count(*) from booth_pin_checked_before b
         where b.h = (select md5(pg_catalog.pg_get_functiondef(b.fn::regprocedure))))::text || ' / ' ||
       (select count(*) from booth_pin_checked_before)::text as 값,
       (select count(*) from booth_pin_checked_before b
         where b.h = (select md5(pg_catalog.pg_get_functiondef(b.fn::regprocedure))))
         = (select count(*) from booth_pin_checked_before) as 맞음
union all
select '새 함수 있음', coalesce(to_regprocedure('public.admin_issue_booth_pin_checked(uuid,text,timestamptz)')::text, '없음'),
       to_regprocedure('public.admin_issue_booth_pin_checked(uuid,text,timestamptz)') is not null
union all
select 'anon 실행 불가',
       (not has_function_privilege('anon', 'public.admin_issue_booth_pin_checked(uuid,text,timestamptz)', 'execute'))::text,
       not has_function_privilege('anon', 'public.admin_issue_booth_pin_checked(uuid,text,timestamptz)', 'execute');
