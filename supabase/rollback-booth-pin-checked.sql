-- ===================================================================
-- 되돌리기: 운영자 PIN 조건부 발급 (migration-booth-pin-checked.sql)
--
--   admin_issue_booth_pin_checked 하나만 지웁니다. PIN · 세션 · QR · 다른 함수는 그대로입니다.
--   지운 뒤 print-qr.html 의 PIN 관리는 저절로 기존 함수(admin_issue_booth_pin)로 발급합니다
--   (부스마다 직전 상태를 다시 읽기만 하고, 서버 조건 검사는 없어집니다).
--
-- 사용법: SQL Editor · apply_migration 에 전체 붙여넣고 Run(한 트랜잭션). 여러 번 돌려도 같습니다.
-- ===================================================================

drop function if exists public.admin_issue_booth_pin_checked(uuid, text, timestamptz);

notify pgrst, 'reload schema';

select '조건부 발급 함수 없음' as 항목,
       to_regprocedure('public.admin_issue_booth_pin_checked(uuid,text,timestamptz)') is null as 맞음;
