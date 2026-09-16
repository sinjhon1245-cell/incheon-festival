-- ===================================================================
-- 실제 DB 맞추기 — 포털 상태 처리 + 일정 구분 기본값
--
-- 실제 DB를 점검해 보니 migration-portal-actions.sql 이 적용되지
-- 않은 상태였습니다. 프런트엔드(portal.js · admin.js)는 이미 그
-- 칼럼과 함수를 쓰고 있어서, 포털의 "해결 완료 · 업무 시작/완료"
-- 버튼과 부스 유형 표시가 동작하지 않았습니다.
--
-- 이 파일은 빠진 것만 채웁니다. 기존 데이터·RLS 정책·Storage 정책은
-- 하나도 건드리지 않습니다.
--
-- 적용 완료: 2026-09-16, Supabase MCP 의 apply_migration 으로 적용했습니다.
--           마이그레이션 원장 버전 20260916005818
--           (fix_portal_actions_and_schedule_category_default)
--           이미 들어간 내용이라 다시 돌릴 일은 없습니다. 다만 여러 번
--           실행해도 안전하게 써 두었습니다.
--
-- 선행: migration-public-portal.sql, migration-operations.sql
-- 내용: migration-portal-actions.sql 과 같고, 아래 8번(일정 구분
--       기본값 교정)이 더 붙어 있습니다.
-- ===================================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. 담당 업무에 상태 칸 추가
--
-- 기존 줄은 모두 '예정' 으로 채워집니다(현재 0줄이라 영향 없음).
-- ═══════════════════════════════════════════════════════════════
alter table public.operation_tasks
  add column if not exists status text not null default '예정';

alter table public.operation_tasks drop constraint if exists operation_tasks_status_check;
alter table public.operation_tasks
  add constraint operation_tasks_status_check
  check (status in ('예정', '진행 중', '완료'));


-- ═══════════════════════════════════════════════════════════════
-- 2. 운영 요청 — 해결 완료 (anon 가능)
--
-- 관계자가 할 수 있는 것은 "끝났다" 한 가지입니다. 이미 완료된
-- 요청을 다시 눌러도 오류를 내지 않습니다.
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
-- 3. 담당 업무 — 시작 / 완료 (anon 가능)
--
-- 앞으로만 갑니다: 예정 → 진행 중 → 완료. 되돌리기는 관리자 몫입니다.
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

revoke all on function public.set_operation_task_status(uuid, text) from public;
grant execute on function public.set_operation_task_status(uuid, text) to anon, authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 4. 운영 물품 상태 함수 — 관리자 전용
--
-- 배부 상태는 운영본부가 판단합니다. anon 에게는 열지 않습니다.
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

revoke all on function public.set_supply_target_status(uuid, text) from public;
revoke execute on function public.set_supply_target_status(uuid, text) from anon;
grant execute on function public.set_supply_target_status(uuid, text) to authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 5. 부스 상태 함수 — anon 실행 권한을 거둡니다
--
-- 함수와 표의 status 칸·데이터는 그대로 둡니다.
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
-- 칸만 더합니다. 기존 16줄은 null 그대로 둡니다 — 값을 짐작해
-- 채우지 않습니다. 관리자가 고른 값만 믿습니다.
-- ═══════════════════════════════════════════════════════════════
alter table public.booths
  add column if not exists org_type text;

alter table public.booths drop constraint if exists booths_org_type_check;
alter table public.booths
  add constraint booths_org_type_check
  check (org_type is null or org_type in ('초등', '중등', '고등', '기관', '기업', '기타'));


-- ═══════════════════════════════════════════════════════════════
-- 7. 일정 구분(schedule_items.category) 기본값 교정
--
-- migration-portal.sql 이 허용값을 새 낱말로 바꾸면서 기본값은
-- 옛 낱말 '체험·전시' 로 남겨 두었습니다. 지금 기본값은 제약을
-- 통과하지 못해, category 를 빼고 넣는 INSERT 는 무조건 실패합니다.
--
-- '운영' 으로 바꿉니다. 관리자 화면이 새 일정을 만들 때 쓰는 값이고
-- (assets/admin.js 의 schedule blank · 빈 값 대체 모두 '운영'),
-- 값을 정하지 않은 줄을 무대나 강연으로 잘못 보이게 하지 않습니다.
--
-- 기본값만 바꿉니다. 이미 들어 있는 13줄은 건드리지 않습니다.
-- ═══════════════════════════════════════════════════════════════
alter table public.schedule_items
  alter column category set default '운영';
