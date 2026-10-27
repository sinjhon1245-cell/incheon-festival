-- ===================================================================
-- 되돌리기: 운영자 알림 (migration-booth-notice.sql)
--
--   함수만 지웁니다 — 운영자 함수 둘 · 관리자 함수 셋 · 안쪽 도우미 둘.
--   지우면 운영자 화면은 알림을 묻다가 ‘함수 없음’ 을 받고 그 화면에서는 더 묻지 않으며(띠 숨김),
--   관리자 화면의 [운영자 알림] 은 ‘준비 중’ 으로 돌아갑니다. 대기 입력 · QR · PIN 로그인은 처음부터 그대로입니다.
--
--   표(booth_notice_config · booth_notice · booth_notice_target)는 기록 보존을 위해 남깁니다(RLS · 권한 없음 — 아무도 못 읽음).
--   표까지 지우려면 내려받은 뒤 맨 아래 주석의 drop 을 따로 승인 받아 실행합니다.
--   바뀌지 않는 것: booth_live · booth_live_log · 기존 함수 · 정책 · 23:00 예약 작업.
--
-- 급히 끄기만 할 때는 되돌리기 대신:  update public.booth_notice_config set enabled = false, updated_at = now() where id = 1;
-- 사용법: SQL Editor 에 전체 붙여넣고 Run(한 트랜잭션). 여러 번 돌려도 같습니다.
-- ===================================================================

drop function if exists public.booth_ctrl_notice(text, text, bigint);
drop function if exists public.booth_session_notice(text, text, bigint);
drop function if exists public.admin_booth_notice_enabled();
drop function if exists public.admin_send_booth_notice(text, text, uuid[], text);
drop function if exists public.admin_booth_notice_status(integer);
drop function if exists private.booth_notice_op(uuid, text, uuid, text, bigint);
drop function if exists private.booth_notice_on();

notify pgrst, 'reload schema';

select v."항목", v."기대", v."실제", v."기대" = v."실제" as "맞음"
  from (values
    (1, '운영자 · 관리자 · 도우미 함수 모두 없음', 'true',
        (to_regprocedure('public.booth_ctrl_notice(text,text,bigint)') is null
         and to_regprocedure('public.booth_session_notice(text,text,bigint)') is null
         and to_regprocedure('public.admin_booth_notice_enabled()') is null
         and to_regprocedure('public.admin_send_booth_notice(text,text,uuid[],text)') is null
         and to_regprocedure('public.admin_booth_notice_status(integer)') is null
         and to_regprocedure('private.booth_notice_op(uuid,text,uuid,text,bigint)') is null
         and to_regprocedure('private.booth_notice_on()') is null)::text),
    (2, '기록 표는 남음', 'true',
        (to_regclass('public.booth_notice') is not null and to_regclass('public.booth_notice_target') is not null)::text)
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";

-- ── 표까지 지울 때만(기록을 내려받은 뒤, 따로 승인 받아 실행) ──
-- drop table if exists public.booth_notice_target;
-- drop table if exists public.booth_notice;
-- drop table if exists public.booth_notice_config;
