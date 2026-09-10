-- ===================================================================
-- 공개 운영 포털 전환 마이그레이션
--
--   변경 전 : 관계자도 로그인해야 운영정보를 볼 수 있었습니다.
--   변경 후 : 링크를 아는 사람은 로그인 없이 열람하고,
--             편집은 관리자(admin) 로그인 계정만 할 수 있습니다.
--
-- 사용법: Supabase 대시보드 → SQL Editor 에 전체 붙여넣고 Run.
--         여러 번 실행해도 안전합니다.
--         기존 데이터는 하나도 지우지 않습니다. 정책만 바꿉니다.
--
-- ⚠️ 이 파일을 실행한 뒤에는 migration-portal.sql 을 다시 실행하지
--    마세요. 그 파일은 "관계자 로그인 필수" 정책을 되살리기 때문에
--    공개 포털이 다시 잠깁니다. (표 구조는 이미 반영돼 있습니다.)
-- ===================================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. 열람 정책 — 로그인 없이 읽을 수 있게
--
-- 운영 요청까지 포함합니다. 포털의 "운영 요청" 화면이 기존 요청
-- 목록을 보여 주기 때문입니다.
-- staff_profiles 는 여기에 넣지 않습니다. 관리자 계정 정보라
-- 공개할 이유가 없습니다.
-- ═══════════════════════════════════════════════════════════════
do $$
declare
  t text;
  public_tables text[] := array['settings','programs','schedule_items','zones','booths','faqs',
                                'notices','operation_requests','resources','contacts','venue_places'];
begin
  foreach t in array public_tables
  loop
    execute format('alter table public.%I enable row level security', t);

    -- 이전 구조에서 만든 정책 정리
    execute format('drop policy if exists "공개 읽기" on public.%I', t);
    execute format('drop policy if exists "관계자 열람" on public.%I', t);
    execute format('drop policy if exists "로그인 사용자 쓰기" on public.%I', t);
    execute format('drop policy if exists "누구나 열람" on public.%I', t);

    execute format(
      'create policy "누구나 열람" on public.%I for select to anon, authenticated using (true)', t);

    -- 편집은 관리자만. (migration-portal.sql 과 같은 이름·같은 조건이라
    -- 이미 있어도 결과가 달라지지 않습니다.)
    execute format('drop policy if exists "관리자 편집" on public.%I', t);
    execute format(
      'create policy "관리자 편집" on public.%I for all to authenticated
       using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;


-- ═══════════════════════════════════════════════════════════════
-- 2. 관계자 전용 정책 제거
--
-- 이제 관계자라는 로그인 개념이 없습니다.
-- ═══════════════════════════════════════════════════════════════
drop policy if exists "관계자 요청 등록"      on public.operation_requests;
drop policy if exists "관계자 부스 상태 변경" on public.booths;

-- staff_profiles 는 계속 잠가 둡니다.
-- 관리자가 로그인 직후 자기 role 을 확인하는 데만 씁니다.
alter table public.staff_profiles enable row level security;
drop policy if exists "관계자 열람"      on public.staff_profiles;
drop policy if exists "누구나 열람"      on public.staff_profiles;
drop policy if exists "본인 프로필 열람" on public.staff_profiles;
create policy "본인 프로필 열람" on public.staff_profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists "관리자 편집" on public.staff_profiles;
create policy "관리자 편집" on public.staff_profiles
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- public.is_staff() 는 일부러 남겨 둡니다. 지우면 예전 SQL 파일을
-- 실수로 다시 돌렸을 때 알 수 없는 오류가 나기 때문입니다.
-- 어떤 정책도 더 이상 이 함수를 쓰지 않습니다.


-- ═══════════════════════════════════════════════════════════════
-- 3. 운영 요청 — 로그인 없이 등록
--
-- 등록만 허용합니다. 처리 상태와 담당팀은 관리자 몫이라,
-- 비로그인 등록은 '접수' 상태로만 들어올 수 있게 막습니다.
-- (수정·삭제 정책은 아예 없으므로 anon 은 손댈 수 없습니다.)
-- ═══════════════════════════════════════════════════════════════
drop policy if exists "누구나 요청 등록" on public.operation_requests;
create policy "누구나 요청 등록" on public.operation_requests
  for insert to anon, authenticated
  with check (status = '접수' and assignee_team = '');

-- 비로그인 등록에는 작성자 계정이 없습니다.
alter table public.operation_requests alter column reporter_id drop not null;


-- ═══════════════════════════════════════════════════════════════
-- 4. 부스 상태 변경 — status 만 바꾸는 전용 함수
--
-- anon 에게 booths UPDATE 를 열어 주면 담당자 연락처까지 바꿀 수
-- 있게 됩니다. 그래서 UPDATE 정책은 만들지 않고, 이 함수 하나만
-- 열어 둡니다. security definer 라 RLS 를 우회하지만, 함수가 하는
-- 일이 "status 한 칸 수정"뿐이라 다른 칼럼은 건드릴 방법이 없습니다.
-- ═══════════════════════════════════════════════════════════════
create or replace function public.set_booth_status(p_id uuid, p_status text)
returns public.booths
language plpgsql
security definer
set search_path = public
as $$
declare
  updated public.booths;
begin
  if p_status is null or p_status not in
     ('준비 전', '준비 완료', '운영 중', '일시 중단', '운영 종료') then
    raise exception '허용되지 않는 부스 상태입니다: %', p_status
      using errcode = '22023';
  end if;

  update public.booths
     set status = p_status,
         updated_at = now()
   where id = p_id
  returning * into updated;

  if updated.id is null then
    raise exception '해당 부스를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  return updated;
end;
$$;

revoke all on function public.set_booth_status(uuid, text) from public;
grant execute on function public.set_booth_status(uuid, text) to anon, authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 5. 확인 — 데이터가 그대로인지, 관리자가 남아 있는지
-- ═══════════════════════════════════════════════════════════════
select '관리자 계정' as 항목, count(*)::text as 값 from public.staff_profiles where role = 'admin'
union all select '일정',      count(*)::text from public.schedule_items
union all select '부스',      count(*)::text from public.booths
union all select '구역',      count(*)::text from public.zones
union all select 'FAQ',       count(*)::text from public.faqs
union all select '공지',      count(*)::text from public.notices
union all select '운영 요청', count(*)::text from public.operation_requests
union all select '자료실',    count(*)::text from public.resources
union all select '연락망',    count(*)::text from public.contacts
union all select '행사장',    count(*)::text from public.venue_places;
