-- ===================================================================
-- 운영 상태 변경을 로그인한 운영진으로 제한
--
-- 지금까지 두 함수는 anon(로그인 없음)도 실행할 수 있었습니다.
--   resolve_operation_request(id)        운영 요청 해결 완료
--   set_operation_task_status(id, st)    담당 업무 시작/완료
-- 포털 주소만 알면 누구나 요청을 '완료' 로 닫거나 업무를 끝낼 수
-- 있었다는 뜻입니다. 열람은 그대로 두고, 상태를 바꾸는 일만 로그인한
-- 운영진(staff_profiles 에 등록된 계정)으로 좁힙니다.
--
-- 함께 점검한 두 함수
--   set_booth_status(id, st)             이미 authenticated 전용
--   set_supply_target_status(id, st)     이미 authenticated 전용
-- 둘 다 실행 권한은 막혀 있었지만, 함수 안에서 누구인지 확인하지
-- 않았습니다. 가입이 열린 프로젝트라면 아무 계정이나 만들어 부를 수
-- 있으므로 관리자 확인(is_admin)을 함수 안에 넣습니다.
--
-- 바뀌지 않는 것
--   · 표 · 데이터 · RLS 정책 · Storage 정책
--   · 운영 요청 등록(누구나 '접수' 로만 등록) — 현장 보고는 열어 둡니다
--   · 함수 이름과 인자 — 포털 · 관리자 코드는 그대로 부릅니다
--
-- 적용: 2026-10-01, Supabase MCP apply_migration
--       (lock_portal_actions_to_staff). 여러 번 실행해도 안전합니다.
-- 선행: migration-fix-portal-actions.sql, migration-private-contacts-hardening.sql
-- ===================================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. 운영 요청 — 해결 완료 (운영진)
-- ═══════════════════════════════════════════════════════════════
create or replace function public.resolve_operation_request(p_id uuid)
returns public.operation_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur     public.operation_requests;
  updated public.operation_requests;
begin
  if not public.is_staff() then
    raise exception '운영진 로그인 후 처리할 수 있습니다.' using errcode = '42501';
  end if;

  select * into cur from public.operation_requests where id = p_id for update;
  if cur.id is null then
    raise exception '해당 요청을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  if cur.status = '완료' then
    return cur;
  end if;

  update public.operation_requests
     set status = '완료',
         updated_at = pg_catalog.now()
   where id = p_id
  returning * into updated;

  return updated;
end;
$$;

revoke all     on function public.resolve_operation_request(uuid) from public;
revoke execute on function public.resolve_operation_request(uuid) from anon;
grant  execute on function public.resolve_operation_request(uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 2. 담당 업무 — 시작 / 완료 (운영진)
--
-- 앞으로만 갑니다: 예정 → 진행 중 → 완료. 되돌리기는 관리자 화면 몫입니다.
-- ═══════════════════════════════════════════════════════════════
create or replace function public.set_operation_task_status(p_id uuid, p_status text)
returns public.operation_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur     public.operation_tasks;
  updated public.operation_tasks;
begin
  if not public.is_staff() then
    raise exception '운영진 로그인 후 처리할 수 있습니다.' using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('예정', '진행 중', '완료') then
    raise exception '허용되지 않는 업무 상태입니다: %', p_status
      using errcode = '22023';
  end if;

  select * into cur from public.operation_tasks where id = p_id for update;
  if cur.id is null then
    raise exception '해당 업무를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  if cur.status = p_status then
    return cur;
  end if;

  if not (
       (cur.status = '예정'    and p_status = '진행 중')
    or (cur.status = '진행 중' and p_status = '완료')
  ) then
    raise exception '현재 상태(%)에서는 ''%''(으)로 바꿀 수 없습니다. 관리자에게 요청해 주세요.',
      cur.status, p_status using errcode = '22023';
  end if;

  update public.operation_tasks
     set status = p_status,
         updated_at = pg_catalog.now()
   where id = p_id
  returning * into updated;

  return updated;
end;
$$;

revoke all     on function public.set_operation_task_status(uuid, text) from public;
revoke execute on function public.set_operation_task_status(uuid, text) from anon;
grant  execute on function public.set_operation_task_status(uuid, text) to authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 3. 부스 상태 — 관리자
--
-- 검색 경로를 비우고(search_path = '') 이름을 모두 public. 으로 적습니다.
-- ═══════════════════════════════════════════════════════════════
create or replace function public.set_booth_status(p_id uuid, p_status text)
returns public.booths
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated public.booths;
begin
  if not public.is_admin() then
    raise exception '관리자만 부스 상태를 바꿀 수 있습니다.' using errcode = '42501';
  end if;

  if p_status is null or p_status not in
     ('준비 전', '준비 완료', '운영 중', '일시 중단', '운영 종료') then
    raise exception '허용되지 않는 부스 상태입니다: %', p_status
      using errcode = '22023';
  end if;

  update public.booths
     set status = p_status,
         updated_at = pg_catalog.now()
   where id = p_id
  returning * into updated;

  if updated.id is null then
    raise exception '해당 부스를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  return updated;
end;
$$;

revoke all     on function public.set_booth_status(uuid, text) from public;
revoke execute on function public.set_booth_status(uuid, text) from anon;
grant  execute on function public.set_booth_status(uuid, text) to authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 4. 운영 물품 배부 상태 — 관리자
-- ═══════════════════════════════════════════════════════════════
create or replace function public.set_supply_target_status(p_id uuid, p_status text)
returns public.supply_targets
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur     public.supply_targets;
  updated public.supply_targets;
begin
  if not public.is_admin() then
    raise exception '관리자만 배부 상태를 바꿀 수 있습니다.' using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('일부 배부', '배부 완료') then
    raise exception '허용되지 않는 배부 상태입니다: %', p_status
      using errcode = '22023';
  end if;

  select * into cur from public.supply_targets where id = p_id for update;
  if cur.id is null then
    raise exception '해당 배부 대상을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  if cur.status = p_status then
    return cur;
  end if;

  if cur.status = '배부 완료' then
    raise exception '이미 수령 완료된 대상입니다. 바꾸려면 관리자에게 요청해 주세요.'
      using errcode = '22023';
  end if;

  update public.supply_targets
     set status = p_status,
         updated_at = pg_catalog.now()
   where id = p_id
  returning * into updated;

  return updated;
end;
$$;

revoke all     on function public.set_supply_target_status(uuid, text) from public;
revoke execute on function public.set_supply_target_status(uuid, text) from anon;
grant  execute on function public.set_supply_target_status(uuid, text) to authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 5. 행사 기본정보의 자리표시 연락처 비우기
--
-- 대표 전화 '032-000-0000' 은 자리표시 번호이고, 대표 메일
-- 'aifest@ice.go.kr' 은 관리자 로그인 계정 주소입니다(문의 창구가
-- 아닙니다). 두 값 모두 확인된 문의처가 아니라서 비웁니다. 비어 있으면
-- 포털에는 문의 줄이 나오지 않고, 관리자 → 기본정보에서 실제 값을
-- 넣으면 그대로 저장 · 표시됩니다.
--
-- 이 두 값과 같을 때만 비웁니다. 그새 실제 값을 넣었다면 건드리지 않습니다.
-- ═══════════════════════════════════════════════════════════════
update public.settings set contact_phone = '' where contact_phone = '032-000-0000';
update public.settings set contact_email = '' where contact_email = 'aifest@ice.go.kr';
alter table public.settings alter column contact_email set default '';


-- ═══════════════════════════════════════════════════════════════
-- 확인 (기대값을 괄호에 적었습니다)
-- ═══════════════════════════════════════════════════════════════
select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as "anon 실행 (f)",
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as "authenticated 실행 (t)"
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('resolve_operation_request', 'set_operation_task_status',
                     'set_booth_status', 'set_supply_target_status')
 order by 1;
