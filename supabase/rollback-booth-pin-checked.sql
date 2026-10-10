-- ===================================================================
-- 되돌리기: 운영자 PIN 조건부 발급 (migration-booth-pin-checked.sql)
--
--   admin_issue_booth_pin_checked 하나만 지웁니다. PIN · 세션 · QR · 다른 함수는 그대로입니다.
--   지우면 print-qr.html 의 여러 부스 PIN 발급 · 재발급 단추가 잠깁니다('안전한 일괄 PIN 발급 기능이
--   준비되지 않았습니다') — 조건 없는 admin_issue_booth_pin 으로 바꿔 보내지 않습니다.
--   관리자 → 부스 ⋯ 메뉴의 한 부스 PIN 발급 · 재발급 · 끄기는 그대로 됩니다.
--
-- 사용법: SQL Editor · apply_migration 에 전체 붙여넣고 Run(한 트랜잭션). 여러 번 돌려도 같습니다.
-- ===================================================================

drop function if exists public.admin_issue_booth_pin_checked(uuid, text, timestamptz);

notify pgrst, 'reload schema';

select '조건부 발급 함수 없음' as 항목,
       to_regprocedure('public.admin_issue_booth_pin_checked(uuid,text,timestamptz)') is null as 맞음;
