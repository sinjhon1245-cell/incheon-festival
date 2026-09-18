-- ===================================================================
-- 개인 연락처 보강 (migration-private-contacts.sql 의 후속)
--
--   ⚠️ migration-private-contacts.sql 은 다시 돌리지 않습니다. 이미
--      적용돼 있고(2026-09-17), 이 파일은 그 위에 얹는 후속입니다.
--
--   이 파일이 하는 일
--     1. contact_private 의 authenticated 권한을 네 가지로 줄입니다.
--     2. is_admin() 을 비로그인 사용자가 부르지 못하게 합니다.
--     3. 쓰이지 않는 옛 함수 is_staff() 도 같은 방식으로 닫습니다.
--     4. 세 함수의 search_path 를 빈 값으로 고정합니다.
--
--   무엇이 문제였나
--     1. 앞 파일은 `revoke all ... from public` 뒤에 authenticated 에
--        네 가지 권한을 grant 했지만, Supabase 는 authenticated 에게
--        표 권한을 "직접" 줍니다. PUBLIC 에서 거둬도 그 직접 권한은
--        남아서, authenticated 는 여전히 arwdDxtm — TRUNCATE ·
--        REFERENCES · TRIGGER · MAINTAIN 까지 들고 있었습니다.
--        TRUNCATE 는 RLS 를 거치지 않습니다. 지금 Supabase 가 여는
--        경로(REST · GraphQL · RPC)로는 부를 방법이 없지만, "권한과
--        RLS 두 겹" 이라는 앞 파일의 약속과 다릅니다.
--     2. Supabase 보안 점검(anon_security_definer_function_executable)
--        이 is_admin() · is_staff() 를 짚었습니다. 비로그인 사용자가
--        /rest/v1/rpc/is_admin 으로 직접 부를 수 있습니다.
--        돌려주는 값은 "나는 관리자인가" 한 칸이라 새는 정보는 없지만,
--        비로그인 사용자가 부를 이유도 없습니다.
--
--   무엇을 확인하고 바꿨나 (2026-09-18, 실제 DB 조회)
--     · is_admin() 을 부르는 정책은 public 21개 · storage 3개, 모두
--       `to authenticated` 입니다. anon 이나 PUBLIC 에 걸린 정책 중에는
--       없습니다 — anon 권한을 거둬도 비로그인 열람은 그대로입니다.
--     · 포털·관리자 코드는 is_admin() · is_staff() 를 RPC 로 부르지
--       않습니다(관리자 여부는 staff_profiles 한 줄을 읽어 판단).
--     · is_staff() 는 어떤 정책에도 쓰이지 않습니다.
--     · 세 함수 몸통은 모두 스키마를 붙여 씁니다(public.staff_profiles
--       · auth.uid() · now()). search_path 를 비워도 찾는 대상이 같습니다.
--
--   바꾸지 않는 것
--     · authenticated 의 is_admin() 실행 권한 — 거두면 관리자 정책이
--       모두 "권한 없음" 오류가 나서 관리자 화면이 멈춥니다.
--     · 표 · 칸 · 데이터 · RLS 정책. 이 파일은 권한과 함수 설정만
--       만집니다. contacts.phone · booths.manager_phone 도 그대로입니다.
--     · resolve_operation_request · set_operation_task_status 의 anon
--       실행 권한 — 포털의 '해결 완료' · '업무 시작/완료' 가 씁니다.
--
-- 사용법: Supabase 대시보드 → SQL Editor 에 전체 붙여넣고 Run.
--         여러 번 실행해도 안전합니다(revoke · grant · alter 모두
--         같은 결과로 수렴합니다).
--
-- 트랜잭션: 앞 파일과 같은 이유로 BEGIN/COMMIT 을 넣지 않습니다.
--   SQL Editor 와 apply_migration 은 이미 한 트랜잭션으로 돌립니다.
--   psql 로 돌릴 때는 psql -1 -v ON_ERROR_STOP=1 -f 로 실행하세요.
-- ===================================================================


-- ═══════════════════════════════════════════════════════════════
-- 0. 선행 조건 검사 (아무것도 바꾸지 않습니다)
-- ═══════════════════════════════════════════════════════════════
do $preflight$
begin
  if to_regclass('public.contact_private') is null then
    raise exception '선행 조건 누락: public.contact_private 가 없습니다. '
                    'migration-private-contacts.sql 을 먼저 적용하세요.';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception '선행 조건 누락: public.is_admin() 이 없습니다.';
  end if;
  if to_regprocedure('public.touch_updated_at()') is null then
    raise exception '선행 조건 누락: public.touch_updated_at() 이 없습니다.';
  end if;
end
$preflight$;


-- ═══════════════════════════════════════════════════════════════
-- 1. contact_private — authenticated 는 네 가지만
--
-- 순서가 중요합니다. 먼저 전부 거두고, 필요한 네 가지만 다시 줍니다.
-- 트랜잭션 안이라 그 사이에 관리자 화면이 막히는 순간은 없습니다.
--
-- anon · PUBLIC 은 앞 파일에서 이미 거뒀지만, 이 파일만 따로 돌리는
-- 환경에서도 같은 결과가 되도록 한 번 더 거둡니다.
--
-- service_role 은 건드리지 않습니다. 서버 전용 키가 쓰는 역할이고
-- 원래 RLS 를 거치지 않습니다 — 여기서 줄여도 막는 것이 없습니다.
-- ═══════════════════════════════════════════════════════════════
revoke all on public.contact_private from anon;
revoke all on public.contact_private from public;
revoke all on public.contact_private from authenticated;

grant select, insert, update, delete on public.contact_private to authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 2. is_admin() — 로그인한 사용자만 부를 수 있게
--
-- PUBLIC 과 anon 둘 다 거둬야 합니다. Supabase 는 anon 에게도 실행
-- 권한을 "직접" 줘서, PUBLIC 만 거두면 anon 은 그대로 부를 수 있습니다.
-- authenticated 에는 다시 줍니다(이미 있어도 같은 결과) — 관리자
-- 정책 24개가 이 함수로 판단하기 때문입니다.
-- ═══════════════════════════════════════════════════════════════
revoke execute on function public.is_admin() from public;
revoke execute on function public.is_admin() from anon;
grant  execute on function public.is_admin() to authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 3. is_staff() — 쓰이지 않는 옛 함수
--
-- migration-public-portal.sql 이 일부러 남겨 둔 함수입니다(지우면
-- 예전 SQL 을 다시 돌렸을 때 오류). 지우지 않고 비로그인 실행만
-- 막습니다. 로그인한 사용자 쪽은 지금과 같게 둡니다.
-- ═══════════════════════════════════════════════════════════════
do $isstaff$
begin
  if to_regprocedure('public.is_staff()') is not null then
    execute 'revoke execute on function public.is_staff() from public';
    execute 'revoke execute on function public.is_staff() from anon';
    execute 'grant  execute on function public.is_staff() to authenticated';
    execute 'alter function public.is_staff() set search_path = ''''';
  end if;
end
$isstaff$;


-- ═══════════════════════════════════════════════════════════════
-- 4. search_path 를 빈 값으로
--
-- is_admin() 은 SECURITY DEFINER 라 표 주인(postgres) 권한으로
-- 돕니다. search_path 가 'public' 이면, 누군가 public 에 같은 이름의
-- 객체를 만들 수 있을 때 그쪽을 먼저 찾게 됩니다. 지금은 anon ·
-- authenticated 가 public 에 아무것도 만들 수 없어 실제 위험은
-- 없지만, 몸통이 이미 스키마를 붙여 쓰므로 비워 두는 편이 권장
-- 방식(Supabase 보안 점검 0011)과 맞고 앞으로도 안전합니다.
-- 최근 함수(resolve_operation_request 등)도 이미 '' 를 씁니다.
--
-- touch_updated_at() 은 SECURITY DEFINER 가 아니지만 보안 점검이
-- search_path 미고정으로 짚었습니다. 몸통은 now() 뿐입니다.
--
-- alter ... set 은 몸통과 권한을 건드리지 않고 설정 한 칸만 바꿉니다.
-- ═══════════════════════════════════════════════════════════════
alter function public.is_admin()         set search_path = '';
alter function public.touch_updated_at() set search_path = '';


-- ═══════════════════════════════════════════════════════════════
-- 5. 확인 — 모든 칸이 오른쪽 값이어야 합니다
-- ═══════════════════════════════════════════════════════════════
select
  -- contact_private
  has_table_privilege('anon', 'public.contact_private', 'SELECT')           as "anon 읽기 (f)",
  (has_table_privilege('authenticated', 'public.contact_private', 'SELECT')
   and has_table_privilege('authenticated', 'public.contact_private', 'INSERT')
   and has_table_privilege('authenticated', 'public.contact_private', 'UPDATE')
   and has_table_privilege('authenticated', 'public.contact_private', 'DELETE'))
                                                                             as "authenticated 네 가지 (t)",
  (has_table_privilege('authenticated', 'public.contact_private', 'TRUNCATE')
   or has_table_privilege('authenticated', 'public.contact_private', 'REFERENCES')
   or has_table_privilege('authenticated', 'public.contact_private', 'TRIGGER')
   or has_table_privilege('authenticated', 'public.contact_private', 'MAINTAIN'))
                                                                             as "authenticated 그 밖 (f)",
  (select relrowsecurity from pg_class where oid = 'public.contact_private'::regclass)
                                                                             as "RLS 켜짐 (t)",
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'contact_private')          as "정책 수 (4)",
  -- is_admin()
  has_function_privilege('anon', 'public.is_admin()', 'EXECUTE')            as "anon is_admin 실행 (f)",
  has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE')   as "authenticated is_admin 실행 (t)",
  (select array_to_string(proconfig, ',') from pg_proc
    where oid = 'public.is_admin()'::regprocedure)                          as "is_admin 설정 (search_path 빈 값)";
