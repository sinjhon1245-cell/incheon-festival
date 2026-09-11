-- ===================================================================
-- 현장 운영 강화 마이그레이션
--
--   1. 핵심 일정 표시          (schedule_items.is_highlight)
--   2. 대시보드 운영 안내      (settings.ops_guide)
--   3. 담당 업무 · 운영 인력   (operation_tasks · task_assignments)
--   4. 운영 물품               (supply_items · supply_targets · supply_allocations)
--
-- 사용법: Supabase 대시보드 → SQL Editor 에 전체 붙여넣고 Run.
--         여러 번 실행해도 안전합니다. 기존 표와 데이터는 하나도
--         지우지 않고, 칼럼과 표만 덧붙입니다.
--
-- 선행: migration-public-portal.sql 이 이미 실행되어 있어야 합니다.
--       (public.is_admin() 함수와 "누구나 열람 / 관리자 편집" 정책을
--        그대로 이어 씁니다.)
--
-- 이 파일을 실행하기 전에도 포털은 정상 동작합니다. 새 표가 없으면
-- 해당 메뉴가 "준비 중"으로 보일 뿐, 기존 화면은 영향을 받지 않습니다.
-- ===================================================================

create extension if not exists "pgcrypto";


-- ═══════════════════════════════════════════════════════════════
-- 1. 기존 표 확장 — 새 표를 만들지 않고 칼럼만 덧붙입니다
-- ═══════════════════════════════════════════════════════════════

-- 1-1. 핵심 일정
-- 대시보드 "오늘의 하이라이트" 와 일정 화면의 "핵심 일정만 보기" 가
-- 이 한 칸을 같이 씁니다. 따로 표를 만들 이유가 없습니다.
alter table public.schedule_items
  add column if not exists is_highlight boolean not null default false;

-- 1-2. 대시보드 운영 안내
-- 행사 당일 관계자가 가장 먼저 확인해야 하는 짧은 안내입니다.
-- 줄바꿈을 그대로 살려 여러 항목을 적을 수 있게 text 한 칸으로 둡니다.
-- 새 표를 만들면 "한 줄짜리 표" 가 하나 더 생길 뿐이라 settings 에 넣습니다.
alter table public.settings
  add column if not exists ops_guide text not null default '';

-- 1-3. 연락망을 운영 인력 명부로 함께 씁니다
-- 사람 정보를 staff 표에 또 만들면 연락망과 이름·소속이 둘로 갈라집니다.
-- 그래서 contacts 를 그대로 명부로 쓰고, 운영 인력 여부와 역할 구분만
-- 덧붙입니다. 기존 연락망 화면은 이 칼럼을 쓰지 않으므로 영향이 없습니다.
alter table public.contacts
  add column if not exists is_staff    boolean not null default false,
  add column if not exists role_group  text    not null default '';

-- 역할 구분은 값을 제한하지 않습니다. 현장에서 쓰는 말이 해마다
-- 달라지는데 check 제약을 걸면 관리자가 새 역할을 못 넣습니다.
-- 대신 관리자 화면이 아래 목록을 추천값으로 보여 줍니다.
--   총괄 · 운영본부 · 부스 지원 · 안전 · 안내 · 행사 지원 · 기타


-- ═══════════════════════════════════════════════════════════════
-- 2. 담당 업무 (operation_tasks · task_assignments)
--
-- 필요한 것은 두 가지입니다.
--   · 업무별 담당자 : 업무 하나에 여러 사람
--   · 개인별 역할   : 사람 하나에 여러 업무
-- 양쪽 모두 성립하므로 연결표(task_assignments)가 필요합니다.
--
-- 사람은 contacts 를 가리킵니다. 연락망에 없는 사람(학생 도우미처럼
-- 번호를 남기지 않는 경우)은 person_name 에 이름만 적습니다.
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.operation_tasks (
  id          uuid primary key default gen_random_uuid(),
  area        text not null default '운영',   -- 업무 영역: 기념식 · 부스 운영 · 안전 …
  title       text not null,
  start_time  text not null default '',       -- '09:00'
  end_time    text not null default '',       -- '10:00' (비면 "09:00–")
  place       text not null default '',
  description text not null default '',
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.task_assignments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.operation_tasks(id) on delete cascade,
  -- 연락망에 있는 사람이면 여기를 연결합니다. 연락처가 바뀌어도
  -- 업무 배정을 다시 손댈 필요가 없습니다.
  contact_id  uuid references public.contacts(id) on delete set null,
  -- 연락망에 없는 사람은 이름만 적습니다.
  person_name text not null default '',
  person_org  text not null default '',
  role        text not null default '',       -- 이 업무에서 맡은 몫
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists task_assignments_task_idx    on public.task_assignments(task_id);
create index if not exists task_assignments_contact_idx on public.task_assignments(contact_id);


-- ═══════════════════════════════════════════════════════════════
-- 3. 운영 물품 (supply_items · supply_targets · supply_allocations)
--
--   supply_items       무엇을 나눠 주는가 (명찰 · 식권 · 생수 …)
--   supply_targets     누구에게 나눠 주는가 (기관 · 팀 · 부스)
--   supply_allocations 대상에게 무엇을 몇 개
--
-- 물품 종류를 코드에 박지 않기 위해 supply_items 를 따로 둡니다.
-- 대상마다 물품이 여러 개 붙으므로 연결표가 필요합니다.
-- 배부 상태는 대상 단위로 관리합니다. 물품 한 줄씩 상태를 두면
-- 현장에서 확인할 것이 너무 많아집니다.
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.supply_items (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  unit       text not null default '개',
  category   text not null default '기타',
  memo       text not null default '',
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supply_targets (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  kind       text not null default '팀' check (kind in ('기관', '팀', '부스')),
  manager    text not null default '',
  headcount  int  not null default 0,
  status     text not null default '미배부'
             check (status in ('미배부', '일부 배부', '배부 완료')),
  memo       text not null default '',
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supply_allocations (
  id         uuid primary key default gen_random_uuid(),
  target_id  uuid not null references public.supply_targets(id) on delete cascade,
  item_id    uuid not null references public.supply_items(id)   on delete cascade,
  qty        int  not null default 0,
  memo       text not null default '',
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists supply_allocations_target_idx on public.supply_allocations(target_id);
create index if not exists supply_allocations_item_idx   on public.supply_allocations(item_id);

-- 같은 대상에 같은 물품이 두 줄 생기지 않게 합니다. 수량이 갈라지면
-- 합계가 맞지 않아 현장에서 다시 세어야 합니다.
create unique index if not exists supply_allocations_unique
  on public.supply_allocations(target_id, item_id);


-- ═══════════════════════════════════════════════════════════════
-- 4. updated_at 자동 갱신
-- touch_updated_at() 은 migration-portal.sql 에서 이미 만들었습니다.
-- ═══════════════════════════════════════════════════════════════
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['operation_tasks','task_assignments',
                           'supply_items','supply_targets','supply_allocations']
  loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$I', t);
    execute format(
      'create trigger trg_touch_%1$s before update on public.%1$I
       for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;


-- ═══════════════════════════════════════════════════════════════
-- 5. 보안 정책 (RLS)
--
-- 기존 표와 똑같은 모양입니다.
--   열람 : 누구나 (링크를 아는 관계자가 로그인 없이 봅니다)
--   편집 : 관리자만 (public.is_admin())
--
-- anon 에게는 select 만 줍니다. insert · update · delete 정책을
-- 만들지 않으므로 비로그인 사용자는 손댈 방법이 없습니다.
-- ═══════════════════════════════════════════════════════════════
do $$
declare
  t text;
  new_tables text[] := array['operation_tasks','task_assignments',
                             'supply_items','supply_targets','supply_allocations'];
begin
  foreach t in array new_tables
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "누구나 열람" on public.%I', t);
    execute format(
      'create policy "누구나 열람" on public.%I for select to anon, authenticated using (true)', t);

    execute format('drop policy if exists "관리자 편집" on public.%I', t);
    execute format(
      'create policy "관리자 편집" on public.%I for all to authenticated
       using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;


-- ═══════════════════════════════════════════════════════════════
-- 6. 확인
--
-- 새 표는 비어 있는 것이 정상입니다. 포털은 실제 데이터가 0건이면
-- "예시" 배지를 단 화면 구성 안내를 보여 줍니다. 관리자에서 실제
-- 내용을 한 건이라도 넣으면 예시는 자동으로 사라집니다.
-- ═══════════════════════════════════════════════════════════════
select '핵심 일정'   as 항목, count(*)::text as 값 from public.schedule_items where is_highlight
union all select '운영 인력(연락망)', count(*)::text from public.contacts where is_staff
union all select '담당 업무',        count(*)::text from public.operation_tasks
union all select '업무 배정',        count(*)::text from public.task_assignments
union all select '물품 종류',        count(*)::text from public.supply_items
union all select '배부 대상',        count(*)::text from public.supply_targets
union all select '물품 배정',        count(*)::text from public.supply_allocations;
