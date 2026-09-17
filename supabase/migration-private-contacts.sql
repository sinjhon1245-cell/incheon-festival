-- ===================================================================
-- 개인 연락처 분리 (contact_private)
--
--   담당자의 개인 전화번호를 공개 표에서 떼어 냅니다.
--
--   지금 구조가 왜 문제인가
--     포털은 로그인이 없습니다. contacts 의 열람 정책은 anon 에게
--     `true` 라서, 링크를 아는 사람이면 누구나 REST 로 표를 통째로
--     가져갈 수 있습니다. 칼럼 단위 제한도 없어 phone 도 함께
--     내려갑니다. 화면에서 번호를 빼는 것(2026-09-17 작업)은 눈에
--     보이는 노출만 막은 것이고, API 는 그대로였습니다.
--
--   이 파일이 하는 일
--     개인 전화번호를 담을 표를 따로 만들고, 그 표에는 anon 열람
--     정책을 만들지 않습니다. 관리자(is_admin())만 읽고 씁니다.
--
-- 사용법: Supabase 대시보드 → SQL Editor 에 전체 붙여넣고 Run.
--         여러 번 실행해도 안전합니다.
--
-- 선행: migration-public-portal.sql (public.is_admin())
--       migration-portal.sql       (public.touch_updated_at())
--
-- ⚠️ 이 파일은 기존 데이터를 옮기지도 지우지도 않습니다.
--    contacts.phone 과 booths.manager_phone 은 칸도 값도 그대로
--    둡니다. 값이 있다면 개인번호인지 공용번호인지 사람이 보고
--    판단해야 하고, 그건 별도 작업입니다(아래 5번 참고).
-- ===================================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. 표
--
-- contact_id 는 unique 입니다. 담당자 한 사람에 개인 연락처 한 줄이면
-- 충분하고, 그래야 관리자 화면에서 "이 사람의 번호" 를 고민 없이
-- 한 줄로 다룰 수 있습니다. 번호가 둘 이상 필요해지면 그때 이 제약을
-- 풀고 용도 칸을 더합니다 — 지금 미리 열어 두면 어느 번호가 대표인지
-- 판단하는 코드부터 필요해집니다.
--
-- on delete cascade: 담당자를 지우면 그 사람의 개인 연락처도 함께
-- 사라져야 합니다. 주인이 없어진 번호가 표에 남는 것이 가장 나쁩니다.
--
-- 값은 not null default '' 입니다. 이 프로젝트의 다른 글자 칸과 같은
-- 방식이라, 화면에서 null 과 빈 글자를 따로 다루지 않아도 됩니다.
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.contact_private (
  id           uuid primary key default gen_random_uuid(),
  contact_id   uuid not null unique
                 references public.contacts(id) on delete cascade,
  phone        text not null default '',
  private_memo text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.contact_private is
  '담당자 개인 연락처. anon 열람 정책이 없습니다 — 관리자만 읽고 씁니다.';
comment on column public.contact_private.phone is
  '개인 전화번호. 공개 포털에는 표시하지 않습니다.';
comment on column public.contact_private.private_memo is
  '공개하지 않는 메모(예: 비상 연락 방법). contacts.memo 는 공개입니다.';


-- ═══════════════════════════════════════════════════════════════
-- 2. updated_at
--
-- 이미 있는 공통 함수를 그대로 씁니다(migration-portal.sql 의
-- touch_updated_at). 표마다 trg_touch_<표> 이름을 쓰는 것도 기존
-- 방식 그대로입니다. 같은 일을 하는 함수를 새로 만들지 않습니다.
-- ═══════════════════════════════════════════════════════════════
drop trigger if exists trg_touch_contact_private on public.contact_private;
create trigger trg_touch_contact_private
  before update on public.contact_private
  for each row execute function public.touch_updated_at();


-- ═══════════════════════════════════════════════════════════════
-- 3. RLS — 관리자만
--
-- 이 표에는 "누구나 열람" 정책을 만들지 않습니다. RLS 가 켜져 있고
-- 맞는 정책이 없으면 그 요청은 아무 줄도 보지 못합니다. 그래서 anon
-- 에게는 정책을 아예 두지 않는 것이 가장 분명한 차단입니다.
--
-- 명령별로 네 개로 나눕니다. 다른 표는 'ALL' 한 줄을 쓰지만, 이
-- 표에서는 나중에 "관계자 로그인을 붙여 열람만 열어 준다" 같은 변경이
-- 생길 때 열람 정책 하나만 건드리면 되도록 나눠 둡니다.
-- ═══════════════════════════════════════════════════════════════
alter table public.contact_private enable row level security;

drop policy if exists "관리자 열람" on public.contact_private;
create policy "관리자 열람" on public.contact_private
  for select to authenticated using (public.is_admin());

drop policy if exists "관리자 추가" on public.contact_private;
create policy "관리자 추가" on public.contact_private
  for insert to authenticated with check (public.is_admin());

drop policy if exists "관리자 수정" on public.contact_private;
create policy "관리자 수정" on public.contact_private
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "관리자 삭제" on public.contact_private;
create policy "관리자 삭제" on public.contact_private
  for delete to authenticated using (public.is_admin());


-- ═══════════════════════════════════════════════════════════════
-- 4. 표 권한 — anon 에게서 거둬들입니다
--
-- Supabase 는 public 스키마에 만든 표의 권한을 anon · authenticated
-- 에게 자동으로 줍니다(기본 권한 설정). 실제 차단은 RLS 가 하지만,
-- 그것 하나에만 기대지 않습니다. RLS 를 잠깐 끄거나 정책을 잘못
-- 건드리는 순간 표가 통째로 열리기 때문입니다.
--
-- anon 의 권한을 거두면 RLS 와 권한 두 겹이 됩니다. 한 겹이 무너져도
-- 나머지가 남습니다.
--
-- authenticated 는 그대로 둡니다 — 관리자가 쓰는 역할이고, 관리자
-- 여부는 위의 RLS 가 is_admin() 으로 가립니다. 여기서 authenticated
-- 까지 막으면 관리자 화면이 동작하지 않습니다.
-- ═══════════════════════════════════════════════════════════════
revoke all on public.contact_private from anon;
revoke all on public.contact_private from public;

grant select, insert, update, delete on public.contact_private to authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 5. 기존 칸은 그대로 둡니다
--
-- contacts.phone 과 booths.manager_phone 은 지우지 않습니다.
--   · 값이 있다면 개인번호인지 운영본부 대표번호인지 값만 보고는
--     알 수 없습니다. 지우는 것은 사람이 확인한 뒤에 할 일입니다.
--   · 칸을 없애면 되돌릴 방법이 없습니다.
-- 대신 무엇을 넣으면 안 되는지 표에 적어 둡니다. 관리자 화면의
-- 입력 칸에도 같은 경고가 붙어 있습니다.
--
-- 값을 옮기는 INSERT 는 이 파일에 넣지 않습니다. 자동으로 옮기면
-- 공용번호까지 개인 연락처로 숨겨져, 필요한 번호가 화면에서 사라진
-- 이유를 아무도 모르게 됩니다.
-- ═══════════════════════════════════════════════════════════════
comment on column public.contacts.phone is
  'DEPRECATED: 개인 전화번호 저장 금지. 이 표는 로그인 없이 열람됩니다. '
  '개인 연락처는 contact_private 를 쓰고, 여기에는 공용번호만 둡니다.';

comment on column public.booths.manager_phone is
  'DEPRECATED: 개인 전화번호 저장 금지. 이 표도 로그인 없이 열람됩니다. '
  '공용번호만 두거나 비워 둡니다.';


-- ═══════════════════════════════════════════════════════════════
-- 6. 확인
--
-- anon 에게 열린 정책이 하나도 없어야 하고(열람정책_anon = 0),
-- 관리자용 정책 넷이 있어야 합니다.
-- ═══════════════════════════════════════════════════════════════
select
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'contact_private') as 정책수,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'contact_private'
      and 'anon' = any (roles)) as anon_정책수,
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'contact_private') as rls_켜짐,
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'contact_private'
      and grantee = 'anon') as anon_표권한수,
  (select count(*) from public.contact_private) as 저장된_개인연락처;
