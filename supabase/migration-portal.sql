-- ===================================================================
-- 2026년 인천 AI·SW미래채움 교육페스티벌
-- 관계자 운영 포털 마이그레이션
--
-- 사용법: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run
-- 여러 번 실행해도 안전합니다. 기존 데이터는 지우지 않습니다.
--
-- 기존 표(settings·schedule_items·zones·booths·faqs·programs)는
-- 삭제하지 않고 운영용 칼럼을 덧붙여 재사용합니다.
-- ===================================================================

create extension if not exists "pgcrypto";

-- ── 공통: updated_at 자동 갱신 ───────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;


-- ═══════════════════════════════════════════════════════════════
-- 1. 관계자 계정 (staff_profiles)
--
-- auth.users 에 계정이 있어도 여기에 줄이 없으면 아무 데이터도
-- 볼 수 없습니다. 계정 생성만으로 내부 정보가 열리지 않게 하는
-- 잠금장치입니다.
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.staff_profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  name       text not null default '',
  team       text not null default '',
  phone      text not null default '',
  role       text not null default 'staff' check (role in ('admin', 'staff')),
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 권한 확인 함수. SECURITY DEFINER 라 RLS 를 우회하므로
-- staff_profiles 자신의 정책에서 불러도 무한 재귀가 생기지 않습니다.
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff_profiles where id = auth.uid());
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff_profiles where id = auth.uid() and role = 'admin');
$$;


-- ═══════════════════════════════════════════════════════════════
-- 2. 기존 표 확장
-- ═══════════════════════════════════════════════════════════════

-- 2-1. 행사 설정 — event_settings 를 새로 만들지 않고 확장합니다.
alter table public.settings
  add column if not exists event_end     timestamptz,
  add column if not exists venue_detail  text not null default '',
  add column if not exists venue_map_url text not null default '',
  add column if not exists portal_note   text not null default '';

update public.settings
set event_title = '2026년 인천 AI·SW미래채움 교육페스티벌'
where id = 1 and event_title <> '2026년 인천 AI·SW미래채움 교육페스티벌';

-- 종료 시각이 비어 있으면 시작 +7시간으로 채웁니다(10:00–17:00 기준).
update public.settings
set event_end = event_start + interval '7 hours'
where id = 1 and event_end is null;

-- 2-2. 일정 — 운영 정보 칼럼 추가
alter table public.schedule_items
  add column if not exists start_time text not null default '',
  add column if not exists end_time   text not null default '',
  add column if not exists team       text not null default '',
  add column if not exists owner      text not null default '',
  add column if not exists memo       text not null default '',
  add column if not exists status     text not null default '예정',
  add column if not exists updated_at timestamptz not null default now();

-- 기존 time_label('10:00 – 10:20')에서 시작·종료 시각을 뽑아 채웁니다.
update public.schedule_items
set start_time = trim(split_part(replace(replace(time_label, '–', '-'), '—', '-'), '-', 1)),
    end_time   = trim(split_part(replace(replace(time_label, '–', '-'), '—', '-'), '-', 2))
where start_time = '' and time_label like '%-%' or start_time = '' and time_label like '%–%';

-- 갈래를 운영 분류로 옮깁니다(기존 제약을 새 값으로 교체).
alter table public.schedule_items drop constraint if exists schedule_items_category_check;
update public.schedule_items set category = case category
  when '기조·강연' then '강연'
  when '체험·전시' then '부스'
  when '무대 공연' then '무대'
  when '운영'      then '운영'
  else category end;
alter table public.schedule_items
  add constraint schedule_items_category_check
  check (category in ('무대', '강연', '부스', '운영', '행사 지원'));

alter table public.schedule_items drop constraint if exists schedule_items_status_check;
alter table public.schedule_items
  add constraint schedule_items_status_check
  check (status in ('예정', '진행 중', '종료', '취소', '변경'));

-- 2-3. 부스 — 운영현황 칼럼 추가
alter table public.booths
  add column if not exists code          text not null default '',
  add column if not exists manager       text not null default '',
  add column if not exists manager_phone text not null default '',
  add column if not exists program       text not null default '',
  add column if not exists hours         text not null default '',
  add column if not exists needs_power   boolean not null default false,
  add column if not exists needs_network boolean not null default false,
  add column if not exists supplies      text not null default '',
  add column if not exists memo          text not null default '',
  add column if not exists notes         text not null default '',
  add column if not exists status        text not null default '준비 전',
  add column if not exists updated_at    timestamptz not null default now();

-- 부스 번호 → 표시용 코드(A-01) 자동 생성
update public.booths
set code = zone_key || '-' || lpad(no::text, 2, '0')
where code = '';

alter table public.booths drop constraint if exists booths_status_check;
alter table public.booths
  add constraint booths_status_check
  check (status in ('준비 전', '준비 완료', '운영 중', '일시 중단', '운영 종료'));

-- 2-4. FAQ — 분류·공개여부
alter table public.faqs
  add column if not exists category   text not null default '운영',
  add column if not exists is_public  boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();


-- ═══════════════════════════════════════════════════════════════
-- 3. 새 표
-- ═══════════════════════════════════════════════════════════════

-- 3-1. 공지
create table if not exists public.notices (
  id         uuid primary key default gen_random_uuid(),
  level      text not null default '일반' check (level in ('긴급', '중요', '일반')),
  title      text not null,
  body       text not null default '',
  pinned     boolean not null default false,
  author     text not null default '',
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3-2. 운영 요청 / 현장 문제 보고
create table if not exists public.operation_requests (
  id            uuid primary key default gen_random_uuid(),
  location      text not null default '',
  kind          text not null default '기타'
                check (kind in ('전기', '네트워크', '기자재', '시설', '안전', '물품', '주차', '기타')),
  priority      text not null default '보통' check (priority in ('긴급', '높음', '보통')),
  title         text not null,
  body          text not null default '',
  reporter      text not null default '',
  reporter_id   uuid references auth.users(id) on delete set null,
  assignee_team text not null default '',
  status        text not null default '접수'
                check (status in ('접수', '확인 중', '처리 중', '완료')),
  sort_order    int  not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 3-3. 자료실
create table if not exists public.resources (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  category    text not null default '기타',
  description text not null default '',
  url         text not null default '',
  is_public   boolean not null default true,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 3-4. 연락망
create table if not exists public.contacts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  org        text not null default '',
  duty       text not null default '',
  phone      text not null default '',
  memo       text not null default '',
  category   text not null default '기타',
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3-5. 행사장 공간 안내
create table if not exists public.venue_places (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  category   text not null default '기타',
  detail     text not null default '',
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- ── updated_at 트리거 ────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['staff_profiles','settings','schedule_items','booths','faqs',
                           'notices','operation_requests','resources','contacts','venue_places']
  loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$I', t);
    execute format(
      'create trigger trg_touch_%1$s before update on public.%1$I
       for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;


-- ═══════════════════════════════════════════════════════════════
-- 4. 보안 정책 (RLS)
--
-- 이 사이트는 관계자 전용입니다. 로그인하지 않으면 아무 표도
-- 읽을 수 없습니다. 예전의 "공개 읽기" 정책을 모두 걷어냅니다.
--
--   열람  : staff_profiles 에 등록된 사용자(is_staff)
--   편집  : role = 'admin' (is_admin)
--   예외  : 운영 요청은 staff 도 등록 가능
--           부스 상태는 staff 도 변경 가능
-- ═══════════════════════════════════════════════════════════════
do $$
declare
  t text;
  all_tables text[] := array['settings','programs','schedule_items','zones','booths','faqs',
                             'notices','operation_requests','resources','contacts',
                             'venue_places','staff_profiles'];
begin
  foreach t in array all_tables
  loop
    execute format('alter table public.%I enable row level security', t);

    -- 이전 버전에서 만든 정책 정리
    execute format('drop policy if exists "공개 읽기" on public.%I', t);
    execute format('drop policy if exists "로그인 사용자 쓰기" on public.%I', t);
    execute format('drop policy if exists "로그인 사용자 추가" on public.%I', t);
    execute format('drop policy if exists "로그인 사용자 수정" on public.%I', t);
    execute format('drop policy if exists "로그인 사용자 삭제" on public.%I', t);
    execute format('drop policy if exists "관계자 열람" on public.%I', t);
    execute format('drop policy if exists "관리자 편집" on public.%I', t);

    -- 관계자만 열람
    execute format(
      'create policy "관계자 열람" on public.%I for select to authenticated using (public.is_staff())', t);

    -- 관리자만 편집
    execute format(
      'create policy "관리자 편집" on public.%I for all to authenticated
       using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- 예외 1. 운영 요청은 관계자 누구나 등록할 수 있어야 합니다.
drop policy if exists "관계자 요청 등록" on public.operation_requests;
create policy "관계자 요청 등록" on public.operation_requests
  for insert to authenticated with check (public.is_staff());

-- 예외 2. 부스 상태는 현장 관계자가 바꿀 수 있어야 합니다.
drop policy if exists "관계자 부스 상태 변경" on public.booths;
create policy "관계자 부스 상태 변경" on public.booths
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- 예외 3. 본인 프로필은 스스로 읽을 수 있게 (로그인 직후 role 확인용)
drop policy if exists "본인 프로필 열람" on public.staff_profiles;
create policy "본인 프로필 열람" on public.staff_profiles
  for select to authenticated using (id = auth.uid());


-- ═══════════════════════════════════════════════════════════════
-- 5. 첫 관리자 등록
--
-- 이미 만들어 둔 로그인 계정을 관리자로 올립니다.
-- 다른 주소를 쓰신다면 아래 이메일만 바꾸세요.
-- ═══════════════════════════════════════════════════════════════
insert into public.staff_profiles (id, email, name, team, role)
select u.id, u.email, '운영 총괄', '운영본부', 'admin'
from auth.users u
where u.email = 'aifest@ice.go.kr'
on conflict (id) do update set role = 'admin', email = excluded.email;


-- ═══════════════════════════════════════════════════════════════
-- 6. 확인
-- ═══════════════════════════════════════════════════════════════
select '관리자 계정' as 항목, count(*)::text as 값 from public.staff_profiles where role = 'admin'
union all select '일정', count(*)::text from public.schedule_items
union all select '부스', count(*)::text from public.booths
union all select '공지', count(*)::text from public.notices
union all select '운영 요청', count(*)::text from public.operation_requests
union all select '자료실', count(*)::text from public.resources
union all select '연락망', count(*)::text from public.contacts
union all select '행사장', count(*)::text from public.venue_places;
