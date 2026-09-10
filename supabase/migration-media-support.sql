-- ===================================================================
-- 이미지(미디어) 지원 마이그레이션
--
--   행사장 전체 안내도 · 주요 공간 사진 · 부스 전체 배치도 ·
--   개별 부스 대표 이미지를 관리자에서 올릴 수 있게 합니다.
--
--   지금은 실제 이미지가 없습니다. 이 파일은 "자리와 통로"만
--   만들어 둡니다. 나중에 관리자에서 파일만 올리면 됩니다.
--
-- 사용법: Supabase 대시보드 → SQL Editor 에 전체 붙여넣고 Run.
--         여러 번 실행해도 안전하고, 기존 데이터를 지우지 않습니다.
--
-- 선행: migration-public-portal.sql 이 이미 실행되어 있어야 합니다.
--       (public.is_admin() 함수를 씁니다)
-- ===================================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. 이미지 칼럼
--
-- settings.venue_map_url 은 이미 있습니다. "배치도 이미지 주소"로
-- 쓰이고 있어서, 새로 만들지 않고 행사장 전체 안내도로 그대로
-- 이어 씁니다. 설명(alt)과 캡션만 옆에 붙입니다.
-- ═══════════════════════════════════════════════════════════════
alter table public.settings
  add column if not exists venue_map_url     text not null default '',
  add column if not exists venue_map_alt     text not null default '',
  add column if not exists venue_map_caption text not null default '',
  add column if not exists booth_map_url     text not null default '',
  add column if not exists booth_map_alt     text not null default '',
  add column if not exists booth_map_caption text not null default '';

-- 주요 공간 대표 사진
alter table public.venue_places
  add column if not exists image_url     text not null default '',
  add column if not exists image_alt     text not null default '',
  add column if not exists image_caption text not null default '';

-- 개별 부스 대표 이미지
alter table public.booths
  add column if not exists image_url     text not null default '',
  add column if not exists image_alt     text not null default '',
  add column if not exists image_caption text not null default '';

-- 예전에 만들어진 줄에 NULL 이 남아 있으면 화면에서 걸리적거립니다.
update public.settings      set venue_map_url = '' where venue_map_url is null;
update public.venue_places  set image_url     = '' where image_url is null;
update public.booths        set image_url     = '' where image_url is null;


-- ═══════════════════════════════════════════════════════════════
-- 2. 이미지 보관함 (Storage)
--
-- public = true 라 포털에서 로그인 없이 이미지를 볼 수 있습니다.
-- 올리고 지우는 것은 아래 정책이 관리자로 제한합니다.
--
-- 용량과 형식은 여기서 한 번 더 막습니다. 브라우저 쪽 검사만
-- 믿으면 개발자도구로 우회할 수 있기 때문입니다.
-- ═══════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('festival-images', 'festival-images', true, 10485760,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = true,
      file_size_limit    = 10485760,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];


-- ═══════════════════════════════════════════════════════════════
-- 3. 보관함 접근 정책
--
-- 열람은 누구나, 올리기·바꾸기·지우기는 관리자만.
-- 운영 데이터에 건 규칙과 같은 모양입니다.
--
-- ⚠️ 아래에서 "must be owner of table objects" 오류가 난다면,
--    프로젝트 권한 설정 때문입니다. 그 경우에만 대시보드
--    Storage → festival-images → Policies 에서 같은 내용을
--    손으로 만들어 주세요. 다른 부분은 이미 적용된 상태입니다.
-- ═══════════════════════════════════════════════════════════════
drop policy if exists "행사 이미지 열람"        on storage.objects;
drop policy if exists "행사 이미지 관리자 등록" on storage.objects;
drop policy if exists "행사 이미지 관리자 교체" on storage.objects;
drop policy if exists "행사 이미지 관리자 삭제" on storage.objects;

create policy "행사 이미지 열람" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'festival-images');

create policy "행사 이미지 관리자 등록" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'festival-images' and public.is_admin());

create policy "행사 이미지 관리자 교체" on storage.objects
  for update to authenticated
  using (bucket_id = 'festival-images' and public.is_admin())
  with check (bucket_id = 'festival-images' and public.is_admin());

create policy "행사 이미지 관리자 삭제" on storage.objects
  for delete to authenticated
  using (bucket_id = 'festival-images' and public.is_admin());


-- ═══════════════════════════════════════════════════════════════
-- 4. 운영 FAQ 질문 목록
--
-- 답변은 비워 두고 '비공개' 로 넣습니다.
--   · 확정되지 않은 내용을 지어내지 않기 위해서입니다.
--   · 관리자 화면에서는 채워야 할 목록으로 보이고,
--     답변을 쓰고 '공개' 로 바꾸기 전까지 포털에는 나오지 않습니다.
--
-- FAQ 가 하나라도 있으면 통째로 건너뜁니다. 기존 내용을 덮어쓰거나
-- 같은 질문을 두 번 넣지 않기 위해서입니다.
-- ═══════════════════════════════════════════════════════════════
insert into public.faqs (question, answer, category, is_public, sort_order)
select q.question, '', q.category, false, q.ord
from (values
  ('부스 운영자는 몇 시까지 도착해야 하나요?',              '부스 운영',  1),
  ('부스 설치와 세팅은 언제부터 가능한가요?',               '부스 운영',  2),
  ('부스 운영 교대는 어떻게 하나요?',                       '부스 운영',  3),
  ('점심시간에는 부스를 어떻게 운영하나요?',                '부스 운영',  4),
  ('행사 종료 후 철수는 언제부터 가능한가요?',              '부스 운영',  5),
  ('물품 반입은 어디로 하면 되나요?',                       '물품·지원',  6),
  ('기자재나 추가 물품이 필요하면 어떻게 하나요?',          '물품·지원',  7),
  ('전기 사용이 가능한가요?',                               '시설·장소',  8),
  ('인터넷 또는 와이파이를 사용할 수 있나요?',              '시설·장소',  9),
  ('주차는 어디에 하나요?',                                 '시설·장소', 10),
  ('운영본부는 어디에 있나요?',                             '시설·장소', 11),
  ('안전사고나 응급환자가 발생하면 어떻게 해야 하나요?',    '안전',      12),
  ('운영 중 문제가 생기면 어디에 요청하나요?',              '기타',      13),
  ('분실물은 어디에서 확인하나요?',                         '기타',      14),
  ('긴급 공지나 일정 변경은 어디에서 확인하나요?',          '기타',      15)
) as q(question, category, ord)
where not exists (select 1 from public.faqs);


-- ═══════════════════════════════════════════════════════════════
-- 5. 확인
-- ═══════════════════════════════════════════════════════════════
select '이미지 보관함' as 항목,
       coalesce((select case when public then '공개 · 준비됨' else '비공개' end
                 from storage.buckets where id = 'festival-images'), '없음') as 값
union all
select '보관함 정책', (select count(*)::text from pg_policies
                       where schemaname = 'storage' and tablename = 'objects'
                         and policyname like '행사 이미지%')
union all
select 'FAQ 전체',    (select count(*)::text from public.faqs)
union all
select 'FAQ 공개',    (select count(*)::text from public.faqs where is_public)
union all
select '일정',        (select count(*)::text from public.schedule_items)
union all
select '부스',        (select count(*)::text from public.booths)
union all
select '행사장 공간', (select count(*)::text from public.venue_places);
