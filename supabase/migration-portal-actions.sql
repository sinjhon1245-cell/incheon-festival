-- ===================================================================
-- 현장 상태 처리 마이그레이션
--
--   관계자 포털에서 로그인 없이 "상태만" 바꿀 수 있게 합니다.
--
--     운영 요청 → 해결 완료          (anon 가능)
--     담당 업무 → 시작 / 완료        (anon 가능)
--     운영 물품 → 조회만. 배부 상태는 운영본부가 관리자에서 정합니다.
--               anon 의 set_supply_target_status 실행 권한을 거둡니다.
--     부스     → 조회만. anon 의 set_booth_status 실행 권한을 거둡니다.
--
--   함께 들어 있는 표 변경: booths.org_type (운영기관 유형) 칼럼 추가
--
-- 사용법: Supabase 대시보드 → SQL Editor 에 전체 붙여넣고 Run.
--         여러 번 실행해도 안전하고, 기존 데이터를 지우지 않습니다.
--
-- 선행: migration-public-portal.sql, migration-operations.sql
--
-- 다시 실행하는 경우: 이전 판을 이미 실행했어도 이 파일을 통째로 다시
-- 실행하면 됩니다. create or replace 와 if not exists 로 되어 있습니다.
--
-- ⚠️ 보안에서 가장 중요한 점
--    표 전체에 anon UPDATE 정책을 만들지 않습니다. 그렇게 하면 주소를
--    아는 사람이 담당자 연락처나 수량까지 바꿀 수 있습니다. 대신 anon 에게는
--    아래 함수 두 개(요청 해결 완료 · 업무 상태)만 열어 둡니다. 각 함수는
--    security definer 라 RLS 를 지나치지만, 하는 일이 "status 한 칸 수정"
--    뿐이라 다른 칸을 건드릴 방법이 없습니다.
-- ===================================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. 담당 업무에 상태 칸 추가
--
-- 나머지 셋(요청·물품·부스)은 이미 status 를 가지고 있습니다.
-- 여기만 없어서 더합니다. 칼럼을 더하는 것뿐이라 기존 줄은 모두
-- 기본값 '예정' 으로 채워집니다.
-- ═══════════════════════════════════════════════════════════════
alter table public.operation_tasks
  add column if not exists status text not null default '예정';

alter table public.operation_tasks drop constraint if exists operation_tasks_status_check;
alter table public.operation_tasks
  add constraint operation_tasks_status_check
  check (status in ('예정', '진행 중', '완료'));


-- ═══════════════════════════════════════════════════════════════
-- 2. 운영 요청 — 해결 완료
--
-- 관계자가 할 수 있는 것은 "끝났다" 한 가지입니다. '확인 중'·'처리 중'
-- 같은 운영본부의 관리 상태는 관리자 화면에서 다룹니다.
--
-- 이미 완료된 요청을 다시 눌러도 오류를 내지 않습니다. 여러 사람이
-- 같은 화면을 열어 두고 거의 동시에 누를 수 있기 때문입니다.
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
  select * into cur from public.operation_requests where id = p_id for update;
  if cur.id is null then
    raise exception '해당 요청을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  -- 이미 완료면 손대지 않고 그대로 돌려줍니다(수정 시각도 바꾸지 않음).
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

revoke all on function public.resolve_operation_request(uuid) from public;
grant execute on function public.resolve_operation_request(uuid) to anon, authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 3. 담당 업무 — 시작 / 완료
--
-- 앞으로만 갑니다: 예정 → 진행 중 → 완료.
-- 되돌리기는 관리자 몫입니다. 로그인이 없어 누가 눌렀는지 알 수 없는데
-- 되돌리기까지 열어 두면, 끝난 업무가 조용히 되살아나도 아무도 모릅니다.
--
-- 같은 상태를 다시 보내면 그대로 둡니다(두 사람이 동시에 눌러도 안전).
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
  if p_status is null or p_status not in ('예정', '진행 중', '완료') then
    raise exception '허용되지 않는 업무 상태입니다: %', p_status
      using errcode = '22023';
  end if;

  select * into cur from public.operation_tasks where id = p_id for update;
  if cur.id is null then
    raise exception '해당 업무를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  -- 이미 그 상태면 그대로 돌려줍니다.
  if cur.status = p_status then
    return cur;
  end if;

  -- 앞으로 가는 두 걸음만 허용합니다.
  if not (
       (cur.status = '예정'   and p_status = '진행 중')
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

revoke all on function public.set_operation_task_status(uuid, text) from public;
grant execute on function public.set_operation_task_status(uuid, text) to anon, authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 4. 운영 물품 상태 함수 — 관리자 전용으로 둡니다
--
-- 배부 상태는 운영본부가 판단합니다. 관계자 포털에서는 조회만 하므로
-- anon 이 이 함수를 부를 이유가 없습니다. 이 파일의 이전 판을 이미
-- 실행해 anon 에게 열려 있더라도, 다시 실행하면 아래 revoke 로 거둡니다.
-- 함수 자체는 호환을 위해 남깁니다(관리자는 표를 직접 고칩니다).
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
  -- '미배부' 는 일부러 뺐습니다. 관계자가 쓸 수 있는 값이 아닙니다.
  if p_status is null or p_status not in ('일부 배부', '배부 완료') then
    raise exception '허용되지 않는 배부 상태입니다: %', p_status
      using errcode = '22023';
  end if;

  -- 행을 잠그고 읽습니다. 두 사람이 동시에 눌러도 한 줄씩 차례로 봅니다.
  select * into cur from public.supply_targets where id = p_id for update;
  if cur.id is null then
    raise exception '해당 배부 대상을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  -- 같은 값이면 그대로 돌려줍니다.
  if cur.status = p_status then
    return cur;
  end if;

  -- 이미 다 받은 대상을 '일부 배부' 로 되돌리는 것은 관리자 몫입니다.
  if cur.status = '배부 완료' then
    raise exception '이미 수령 완료된 대상입니다. 바꾸려면 관리자에게 요청해 주세요.'
      using errcode = '22023';
  end if;

  update public.supply_targets
     set status = p_status,
         updated_at = pg_catalog.now()
   where id = p_id
  returning * into updated;

  if updated.id is null then
    raise exception '해당 배부 대상을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  return updated;
end;
$$;

revoke all on function public.set_supply_target_status(uuid, text) from public;
revoke execute on function public.set_supply_target_status(uuid, text) from anon;
grant execute on function public.set_supply_target_status(uuid, text) to authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 5. 부스 상태 — 관계자 포털에서 거둡니다
--
-- 부스 운영 상태는 현장에서 아무도 갱신하지 않아 포털에서 뺐습니다.
-- 쓰지 않는 변경 권한을 anon 에게 열어 둘 이유가 없습니다.
-- 함수는 지우지 않습니다. 예전 SQL 을 다시 돌렸을 때 오류가 나지 않게
-- 하고, 관리자(authenticated)는 필요하면 계속 부를 수 있게 둡니다.
-- 표의 status 칸과 데이터도 그대로 둡니다.
-- ═══════════════════════════════════════════════════════════════
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_booth_status'
  ) then
    revoke execute on function public.set_booth_status(uuid, text) from anon;
    revoke execute on function public.set_booth_status(uuid, text) from public;
    grant  execute on function public.set_booth_status(uuid, text) to authenticated;
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════════
-- 6. 부스 운영기관 유형 (booths.org_type)
--
-- 구역(A·B·C…)은 "어디에 있나", 유형은 "누가 운영하나" 입니다.
-- 같은 A구역에 초등·중등 부스가 함께 있을 수 있어 칸을 따로 둡니다.
-- 칸을 더하기만 합니다. 기존 줄은 비어 있는 채로 두고, 값을 짐작해
-- 채우지 않습니다 — 관리자가 고른 값만 믿습니다. 비어 있으면 포털이
-- 기관 이름(…초등학교 등)으로 화면에서만 짐작하고 저장하지 않습니다.
-- ═══════════════════════════════════════════════════════════════
alter table public.booths
  add column if not exists org_type text;

alter table public.booths drop constraint if exists booths_org_type_check;
alter table public.booths
  add constraint booths_org_type_check
  check (org_type is null or org_type in ('초등', '중등', '고등', '기관', '기업', '기타'));


-- ═══════════════════════════════════════════════════════════════
-- 7. 확인
--
-- anon_실행 이 true 인 함수는 resolve_operation_request 와
-- set_operation_task_status 둘뿐이어야 합니다.
-- set_booth_status · set_supply_target_status 는 false 여야 정상입니다.
-- 표에 anon UPDATE 정책이 하나도 없다는 것도 함께 확인합니다.
-- ═══════════════════════════════════════════════════════════════
select p.proname as "함수",
       has_function_privilege('anon', p.oid, 'execute') as "anon_실행",
       p.prosecdef as "security_definer",
       p.proconfig as "설정"
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('set_booth_status', 'resolve_operation_request',
                    'set_operation_task_status', 'set_supply_target_status')
order by p.proname;

select count(*) as "anon UPDATE 정책 수 (0 이어야 정상)"
from pg_policies
where schemaname = 'public'
  and cmd = 'UPDATE'
  and 'anon' = any(roles);
