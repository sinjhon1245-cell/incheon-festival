-- ===================================================================
-- 되돌리기: '확인 필요' 관리자 일괄 확인 기록 (migration-booth-live-check.sql)
--
--   함수 두 개(admin_confirm_booth_live · admin_booth_live_checks)만 지웁니다.
--   지우면 관리자 화면의 [일괄 확인] 은 함수가 없다는 답(PGRST202)을 받아 '준비 중' 으로 돌아가고,
--   줄의 '관리자 확인 HH:MM' 표시도 사라집니다. '확인 필요'(30분) 표시 · 수는 원래부터 그대로입니다.
--
--   기록 표 public.booth_live_check 는 남깁니다(누가 언제 무엇을 확인했는지 — 감사 기록).
--   RLS 켬 · 정책 없음 · anon/authenticated 권한 없음이라 남겨도 아무도 읽거나 쓰지 못합니다.
--   표까지 지우려면 먼저 내려받은 뒤(Table Editor → Export CSV) 맨 아래 주석의 drop 을 따로 실행합니다.
--
--   바뀌지 않는 것: booth_live · booth_live_log · 기존 함수 · 정책 · 23:00 예약 작업 · QR · PIN.
--   (일괄 확인은 처음부터 이것들을 바꾸지 않았으므로 되돌릴 데이터가 없습니다.)
--
-- 순서: 화면 먼저 되돌릴 필요는 없습니다(함수가 없으면 화면이 알아서 '준비 중'). 다시 켜려면
--       migration-booth-live-check.sql 을 다시 실행합니다(표 · 기록은 그대로 이어 씀).
-- 사용법: SQL Editor 에 전체 붙여넣고 Run(한 트랜잭션). 여러 번 돌려도 같습니다.
-- ===================================================================

drop function if exists public.admin_confirm_booth_live(jsonb);
drop function if exists public.admin_booth_live_checks();

notify pgrst, 'reload schema';

select v."항목", v."기대", v."실제", v."기대" = v."실제" as "맞음"
  from (values
    (1, '일괄 확인 함수 없음', 'true', (to_regprocedure('public.admin_confirm_booth_live(jsonb)') is null)::text),
    (2, '확인 읽기 함수 없음', 'true', (to_regprocedure('public.admin_booth_live_checks()') is null)::text),
    (3, '기록 표는 남음(감사 기록)', 'true', (to_regclass('public.booth_live_check') is not null)::text),
    (4, '기록 표 직접 읽기 (anon · authenticated)', 'false',
        coalesce((has_table_privilege('anon', 'public.booth_live_check', 'SELECT')
                  or has_table_privilege('authenticated', 'public.booth_live_check', 'SELECT'))::text, 'false'))
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";

-- ── 표까지 지울 때만(기록을 내려받은 뒤, 따로 승인 받아 실행) ──
-- drop table if exists public.booth_live_check;
