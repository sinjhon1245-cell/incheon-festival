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
-- 선행: migration-portal.sql        (public.touch_updated_at())
--       migration-public-portal.sql (public.is_admin())
--       선행이 빠져 있으면 아래 0번이 아무것도 바꾸지 않고 멈춥니다.
--
-- ⚠️ 이 파일은 기존 데이터를 옮기지도 지우지도 않습니다.
--    contacts.phone 과 booths.manager_phone 은 칸도 값도 그대로
--    둡니다. 값이 있다면 개인번호인지 공용번호인지 사람이 보고
--    판단해야 하고, 그건 별도 작업입니다(아래 6번 참고).
--
-- ⚠️ 원자성(전부 적용되거나 전부 안 되거나)에 대하여
--    여기에는 BEGIN/COMMIT 을 넣지 않았습니다. 이 파일이 쓰는 문장은
--    모두 트랜잭션 안에서 안전한 DDL 이라 감쌀 수는 있지만, 실제
--    적용 경로를 보면 넣지 않는 편이 낫습니다.
--      · Supabase SQL Editor — 스크립트 전체가 이미 한 트랜잭션으로
--        실행됩니다. 중간에 실패하면 앞의 것도 함께 되돌아갑니다.
--      · Supabase CLI · MCP apply_migration — 도구가 자기 트랜잭션을
--        엽니다. 여기서 BEGIN 을 또 열면 경고가 나고, COMMIT 이
--        도구의 트랜잭션을 중간에 끝내 버립니다.
--      · psql 로 직접 돌린다면 문장마다 자동 커밋이라 원자적이지
--        않습니다. 그때는 psql -1 -v ON_ERROR_STOP=1 -f 로 실행하세요.
--    어느 경로든 실패해도 남는 중간 상태가 위험하지 않도록, 아래
--    순서를 "만들자마자 닫는" 차례로 두었습니다.
-- ===================================================================


-- ═══════════════════════════════════════════════════════════════
-- 0. 선행 조건 검사 (아무것도 바꾸지 않습니다)
--
-- 이 검사가 없으면, 예를 들어 touch_updated_at() 이 없는 새 환경에서
-- 표는 만들어지고 트리거 만들다 실패해 멈춥니다. 원자적으로 실행되지
-- 않는 경로(psql 자동 커밋)에서는 RLS 도 권한 정리도 안 된 표가
-- 그대로 남습니다 — 보안 마이그레이션에서 가장 피해야 할 상태입니다.
--
-- 그래서 바꾸기 전에 먼저 멈춥니다. 무엇이 없는지와 어느 파일을
-- 먼저 돌려야 하는지까지 적어 둡니다.
-- ═══════════════════════════════════════════════════════════════
do $preflight$
declare
  id_type text;
begin
  if to_regclass('public.contacts') is null then
    raise exception '선행 조건 누락: public.contacts 표가 없습니다. schema.sql 을 먼저 적용하세요.';
  end if;

  select data_type into id_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'contacts' and column_name = 'id';

  if id_type is null then
    raise exception '선행 조건 누락: public.contacts.id 칸이 없습니다. schema.sql 을 먼저 적용하세요.';
  end if;

  if id_type <> 'uuid' then
    raise exception '선행 조건 불일치: public.contacts.id 가 uuid 가 아니라 % 입니다. '
                    'contact_private.contact_id 가 참조할 수 없습니다.', id_type;
  end if;

  if to_regprocedure('public.is_admin()') is null then
    raise exception '선행 조건 누락: public.is_admin() 함수가 없습니다. '
                    'migration-public-portal.sql 을 먼저 적용하세요.';
  end if;

  if to_regprocedure('public.touch_updated_at()') is null then
    raise exception '선행 조건 누락: public.touch_updated_at() 함수가 없습니다. '
                    'migration-portal.sql 을 먼저 적용하세요.';
  end if;

  -- id 기본값이 쓰는 함수입니다. schema.sql 이 pgcrypto 를 켜 두지만,
  -- 이 파일만 따로 돌리는 환경도 있어 함께 확인합니다.
  if to_regprocedure('public.gen_random_uuid()') is null
     and to_regprocedure('gen_random_uuid()') is null then
    raise exception '선행 조건 누락: gen_random_uuid() 가 없습니다. '
                    'create extension if not exists "pgcrypto"; 를 먼저 실행하세요.';
  end if;
end
$preflight$;


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


-- ═══════════════════════════════════════════════════════════════
-- 2. 만들자마자 닫습니다 — RLS
--
-- 표를 만든 바로 다음 문장입니다. 뒤의 트리거나 정책에서 실패하더라도
-- 표는 이미 잠긴 상태로 남습니다. RLS 를 켜고 정책이 하나도 없으면
-- 아무도 아무 줄도 보지 못합니다 — 열어 주는 정책은 4번에서 관리자에게만
-- 답니다.
-- ═══════════════════════════════════════════════════════════════
alter table public.contact_private enable row level security;


-- ═══════════════════════════════════════════════════════════════
-- 3. 만들자마자 닫습니다 — 표 권한
--
-- Supabase 는 public 스키마에 만든 표의 권한을 anon · authenticated
-- 에게 자동으로 줍니다(기본 권한 설정). 실제 차단은 RLS 가 하지만,
-- 그것 하나에만 기대지 않습니다. RLS 를 잠깐 끄거나 정책을 잘못
-- 건드리는 순간 표가 통째로 열리기 때문입니다.
--
-- anon 의 권한을 거두면 RLS 와 권한 두 겹이 됩니다. 한 겹이 무너져도
-- 나머지가 남습니다.
--
-- authenticated 는 필요한 만큼 다시 줍니다 — 관리자가 쓰는 역할이고,
-- 관리자 여부는 4번의 RLS 가 is_admin() 으로 가립니다. 여기서
-- authenticated 까지 막으면 관리자 화면이 동작하지 않습니다.
-- (revoke ... from public 이 authenticated 에도 영향을 주므로,
--  grant 는 반드시 revoke 뒤에 옵니다.)
-- ═══════════════════════════════════════════════════════════════
revoke all on public.contact_private from anon;
revoke all on public.contact_private from public;

grant select, insert, update, delete on public.contact_private to authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 4. 관리자에게만 여는 정책
--
-- anon 정책은 만들지 않습니다. RLS 가 켜져 있고 맞는 정책이 없으면
-- 그 요청은 아무 줄도 보지 못합니다 — anon 에게 정책을 아예 두지
-- 않는 것이 가장 분명한 차단입니다.
--
-- 명령별로 네 개로 나눕니다. 다른 표는 'ALL' 한 줄을 쓰지만, 이
-- 표에서는 나중에 "관계자 로그인을 붙여 열람만 열어 준다" 같은 변경이
-- 생길 때 열람 정책 하나만 건드리면 되도록 나눠 둡니다.
-- ═══════════════════════════════════════════════════════════════
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
-- 5. updated_at
--
-- 이미 있는 공통 함수를 그대로 씁니다(migration-portal.sql 의
-- touch_updated_at). 표마다 trg_touch_<표> 이름을 쓰는 것도 기존
-- 방식 그대로입니다. 같은 일을 하는 함수를 새로 만들지 않습니다.
--
-- 잠그는 일(2·3·4번)이 끝난 뒤에 답니다. 여기서 실패하더라도 표는
-- 이미 닫혀 있고, 다시 실행하면 이 자리부터 이어집니다.
-- ═══════════════════════════════════════════════════════════════
drop trigger if exists trg_touch_contact_private on public.contact_private;
create trigger trg_touch_contact_private
  before update on public.contact_private
  for each row execute function public.touch_updated_at();


-- ═══════════════════════════════════════════════════════════════
-- 6. 설명과 기존 칸 처리
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
comment on table public.contact_private is
  '담당자 개인 연락처. anon 열람 정책이 없습니다 — 관리자만 읽고 씁니다.';
comment on column public.contact_private.phone is
  '개인 전화번호. 공개 포털에는 표시하지 않습니다.';
comment on column public.contact_private.private_memo is
  '공개하지 않는 메모(예: 비상 연락 방법). contacts.memo 는 공개입니다.';

comment on column public.contacts.phone is
  'DEPRECATED: 개인 전화번호 저장 금지. 이 표는 로그인 없이 열람됩니다. '
  '개인 연락처는 contact_private 를 쓰고, 여기에는 공용번호만 둡니다.';

comment on column public.booths.manager_phone is
  'DEPRECATED: 개인 전화번호 저장 금지. 이 표도 로그인 없이 열람됩니다. '
  '공용번호만 두거나 비워 둡니다.';


-- ═══════════════════════════════════════════════════════════════
-- 7. 확인
--
-- 다섯 칸이 모두 기대한 값이어야 합니다.
--   표_있음            t
--   rls_켜짐           t
--   정책수             4
--   anon_정책수        0
--   anon_읽기권한      f   ← 권한 자체가 없어야 합니다
--   anon_쓰기권한      f
--   관리자역할_권한    t   ← authenticated 는 네 가지 모두 가능
--   저장된_개인연락처  (건수만. 번호 값은 조회하지 않습니다)
-- ═══════════════════════════════════════════════════════════════
select
  to_regclass('public.contact_private') is not null                       as 표_있음,
  (select relrowsecurity from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'contact_private')         as rls_켜짐,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'contact_private')        as 정책수,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'contact_private'
      and 'anon' = any (roles))                                           as anon_정책수,
  has_table_privilege('anon', 'public.contact_private', 'SELECT')         as anon_읽기권한,
  (has_table_privilege('anon', 'public.contact_private', 'INSERT')
   or has_table_privilege('anon', 'public.contact_private', 'UPDATE')
   or has_table_privilege('anon', 'public.contact_private', 'DELETE'))    as anon_쓰기권한,
  (has_table_privilege('authenticated', 'public.contact_private', 'SELECT')
   and has_table_privilege('authenticated', 'public.contact_private', 'INSERT')
   and has_table_privilege('authenticated', 'public.contact_private', 'UPDATE')
   and has_table_privilege('authenticated', 'public.contact_private', 'DELETE'))
                                                                          as 관리자역할_권한,
  (select count(*) from public.contact_private)                           as 저장된_개인연락처;
