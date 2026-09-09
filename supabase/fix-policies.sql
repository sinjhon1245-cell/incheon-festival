-- ===================================================================
-- 쓰기 정책 점검 · 복구
--
-- _diag.html 에서 "DELETE 가 데이터베이스에서 막힙니다" 가 나왔을 때만
-- 실행하세요. 정상이면 실행할 필요가 없습니다(실행해도 무해합니다).
--
-- 바꾸지 않는 것:
--   · RLS 를 끄지 않습니다.
--   · anon(비로그인)에게 쓰기를 열지 않습니다. 읽기만 그대로 둡니다.
--   · service_role 키는 어디에도 쓰지 않습니다.
--
-- 바꾸는 것:
--   기존의 FOR ALL 한 덩어리 정책을 insert/update/delete 세 개로
--   나눠 명시합니다. 동작은 같지만, 어느 명령이 열려 있는지
--   pg_policies 에서 눈으로 확인할 수 있습니다.
-- ===================================================================

-- ── 1. 지금 상태 확인 ─────────────────────────────────────────────
-- 실행하면 결과 탭에 현재 정책이 나옵니다.
select tablename, policyname, cmd, roles, qual::text, with_check::text
from pg_policies
where schemaname = 'public'
order by tablename, cmd;


-- ── 2. 정책 다시 만들기 ───────────────────────────────────────────
do $$
declare
  t text;
  tables text[] := array['settings', 'programs', 'schedule_items', 'zones', 'booths', 'faqs'];
begin
  foreach t in array tables
  loop
    -- RLS 는 켠 상태를 유지합니다.
    execute format('alter table public.%I enable row level security', t);

    -- 예전 이름들을 정리합니다.
    execute format('drop policy if exists "공개 읽기" on public.%I', t);
    execute format('drop policy if exists "로그인 사용자 쓰기" on public.%I', t);
    execute format('drop policy if exists "로그인 사용자 추가" on public.%I', t);
    execute format('drop policy if exists "로그인 사용자 수정" on public.%I', t);
    execute format('drop policy if exists "로그인 사용자 삭제" on public.%I', t);

    -- 읽기는 누구나 (공개 사이트가 publishable 키로 읽습니다)
    execute format(
      'create policy "공개 읽기" on public.%I for select using (true)', t);

    -- 쓰기는 로그인한 사용자만. 명령별로 나눠 둡니다.
    execute format(
      'create policy "로그인 사용자 추가" on public.%I for insert to authenticated with check (true)', t);
    execute format(
      'create policy "로그인 사용자 수정" on public.%I for update to authenticated using (true) with check (true)', t);
    execute format(
      'create policy "로그인 사용자 삭제" on public.%I for delete to authenticated using (true)', t);
  end loop;
end $$;


-- ── 3. 테이블 권한 확인 ───────────────────────────────────────────
-- RLS 정책이 맞아도 GRANT 가 없으면 막힙니다. Supabase 기본값이라
-- 보통은 이미 있지만, 결과에 authenticated 의 DELETE 가 없으면
-- 아래 GRANT 를 실행하세요.
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and table_name = 'faqs'
order by grantee, privilege_type;

-- 위 결과에 authenticated 의 DELETE 가 없을 때만 실행:
-- grant select, insert, update, delete on all tables in schema public to authenticated;
-- grant select on all tables in schema public to anon;
-- grant usage on all sequences in schema public to authenticated;


-- ── 4. 고친 뒤 다시 확인 ──────────────────────────────────────────
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'faqs'
order by cmd;
