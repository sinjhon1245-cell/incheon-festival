-- ===================================================================
-- 부스 내부 정보 분리 (booth_private, Phase 1b) — 초안, 아직 적용하지 않음
--
--   지금 구조가 왜 문제인가
--     booths 의 열람 정책이 anon 에게 true 이고 칸 단위 제한도 없습니다.
--     그래서 부스 담당자(manager) · 담당자 연락처(manager_phone) · 운영 메모
--     (memo) · 특이사항(notes)까지 공개 키 하나로 REST 에서 그대로 읽힙니다
--     (?select=manager_phone). 화면이 그 칸을 요청하지 않는 것은 눈에 보이는
--     노출만 막은 것입니다. 2026-10-02 기준 부스가 0곳이라 아직 샌 것은 없습니다.
--
--   이 파일이 하는 일
--     그 네 칸을 관리자만 읽고 쓰는 booth_private 로 옮기고 booths 에서 뺍니다.
--     이 프로젝트가 담당자 개인 연락처에 이미 쓰는 방식(contacts → contact_private,
--     migration-private-contacts.sql)과 같습니다. 관리자 화면에는 그 방식을 위한
--     '관리자 전용 칸' 장치(ENTITIES.*.private)가 이미 있습니다.
--     칸 단위 권한(GRANT SELECT (칸 …))을 쓰지 않는 까닭은 아래 보고서 4번 —
--     Supabase 문서가 대부분의 경우 권하지 않고(select * 실패 등), 관리자와 같은
--     authenticated 역할을 칸으로 나눌 수 없기 때문입니다.
--
--   ⚠️ 배포와 함께 적용합니다
--     지금 main 에서 배포 중인 운영 포털은 booths 의 manager · memo · notes 를
--     anon 으로 요청합니다(assets/portal.js PUBLIC_COLS). 칸이 사라지면 그 요청이
--     거절되고, 포털은 모든 데이터를 한 번에 받으므로 화면 전체가 오류가 됩니다.
--     관리자 화면(main)도 그 칸에 저장하려다 실패합니다.
--     그래서 이 파일은 '포털 · 관리자 화면 수정본을 main 에 배포하는 때' 에 함께
--     적용합니다. 실제 부스를 처음 등록하기 전이어야 합니다.
--
-- 선행: migration-booth-master-data.sql (Phase 1a)
--       migration-portal.sql (touch_updated_at) · migration-public-portal.sql (is_admin)
-- 되돌리기: rollback-booth-master-data.sql (1b 부분)
-- 사용법: 1a 와 같습니다(SQL Editor · apply_migration, BEGIN/COMMIT 없음).
-- ===================================================================


-- ═══════════════════════════════════════════════════════════════
-- 0. 선행 조건 (아무것도 바꾸지 않습니다)
-- ═══════════════════════════════════════════════════════════════
do $preflight$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'booths' and column_name = 'is_published') then
    raise exception '선행 조건 누락: Phase 1a(migration-booth-master-data.sql)를 먼저 적용하세요.';
  end if;
  if to_regprocedure('public.is_admin()') is null or to_regprocedure('public.touch_updated_at()') is null then
    raise exception '선행 조건 누락: public.is_admin() · public.touch_updated_at() 이 필요합니다.';
  end if;
end
$preflight$;


-- ═══════════════════════════════════════════════════════════════
-- 1. 표 — contact_private 와 같은 모양
--    booth_id unique: 부스 하나에 한 줄. 관리자 화면이 booth_id 로 upsert 합니다.
--    on delete cascade: 부스를 지우면 그 내부 정보도 함께 지웁니다.
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.booth_private (
  id            uuid primary key default gen_random_uuid(),
  booth_id      uuid not null unique references public.booths(id) on delete cascade,
  manager       text not null default '',
  manager_phone text not null default '',
  memo          text not null default '',
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.booth_private is '부스 내부 정보(담당자 · 연락처 · 운영 메모 · 특이사항). anon 권한 · 정책 없음 — 관리자(is_admin())만 읽고 씁니다.';


-- ═══════════════════════════════════════════════════════════════
-- 2 · 3. 만들자마자 닫습니다 — RLS 와 권한 두 겹 (contact_private 와 같은 이유)
-- ═══════════════════════════════════════════════════════════════
alter table public.booth_private enable row level security;

revoke all on public.booth_private from anon;
revoke all on public.booth_private from public;
grant select, insert, update, delete on public.booth_private to authenticated;

drop policy if exists "관리자 열람" on public.booth_private;
create policy "관리자 열람" on public.booth_private
  for select to authenticated using (public.is_admin());

drop policy if exists "관리자 추가" on public.booth_private;
create policy "관리자 추가" on public.booth_private
  for insert to authenticated with check (public.is_admin());

drop policy if exists "관리자 수정" on public.booth_private;
create policy "관리자 수정" on public.booth_private
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "관리자 삭제" on public.booth_private;
create policy "관리자 삭제" on public.booth_private
  for delete to authenticated using (public.is_admin());

drop trigger if exists trg_touch_booth_private on public.booth_private;
create trigger trg_touch_booth_private
  before update on public.booth_private
  for each row execute function public.touch_updated_at();


-- ═══════════════════════════════════════════════════════════════
-- 4. 옮기기 — 값이 하나라도 있는 부스만(지금은 0줄). 여러 번 돌려도 같습니다.
--    칸이 이미 빠진 뒤(두 번째 실행)에는 건너뜁니다.
-- ═══════════════════════════════════════════════════════════════
do $move$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'booths' and column_name = 'manager_phone') then
    insert into public.booth_private as p (booth_id, manager, manager_phone, memo, notes)
    select b.id, b.manager, b.manager_phone, b.memo, b.notes
      from public.booths b
     where b.manager <> '' or b.manager_phone <> '' or b.memo <> '' or b.notes <> ''
    on conflict (booth_id) do update
       set manager       = excluded.manager,
           manager_phone = excluded.manager_phone,
           memo          = excluded.memo,
           notes         = excluded.notes;
  end if;
end
$move$;


-- ═══════════════════════════════════════════════════════════════
-- 5. booths 에서 빼기 — 이제 booths 의 모든 칸은 공개해도 되는 칸입니다.
--    앞으로 booths 에 칸을 더할 때는 '누구나 읽어도 되는가' 를 먼저 묻고,
--    아니면 booth_private 에 더합니다.
-- ═══════════════════════════════════════════════════════════════
alter table public.booths drop column if exists manager;
alter table public.booths drop column if exists manager_phone;
alter table public.booths drop column if exists memo;
alter table public.booths drop column if exists notes;

comment on table public.booths is '부스(공개 칸만). 내부 정보는 booth_private. 관람객 · 운영자는 공개(is_published) + 배정된 부스만 봅니다.';

notify pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════
-- 6. 확인
-- ═══════════════════════════════════════════════════════════════
select 'booths 에 내부 칸 없음' as 확인, count(*) = 0 as 맞음
  from information_schema.columns
 where table_schema = 'public' and table_name = 'booths'
   and column_name in ('manager', 'manager_phone', 'memo', 'notes')
union all
select 'booth_private RLS 켜짐', relrowsecurity from pg_class where oid = 'public.booth_private'::regclass
union all
select 'booth_private anon 열람 불가', not has_table_privilege('anon', 'public.booth_private', 'select')
union all
select 'booth_private 관리자 정책 4개', count(*) = 4 from pg_policies where tablename = 'booth_private';
