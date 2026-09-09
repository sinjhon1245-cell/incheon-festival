-- ===================================================================
-- 행사 설정에 관리 항목 추가
--
-- 지금까지 index.html 에 직접 적혀 있어 관리자에서 못 고치던 값들을
-- settings 표로 옮깁니다.
--
-- 사용법: Supabase 대시보드 → SQL Editor 에 붙여넣고 Run.
-- 여러 번 실행해도 안전합니다(이미 있으면 건너뜁니다).
-- 기존 데이터는 지우지 않습니다.
-- ===================================================================

alter table public.settings
  add column if not exists venue_detail       text not null default '인천교육과학연구원 대강당 · 야외광장',
  add column if not exists host_line          text not null default '주최 인천광역시교육청 · 주관 인천교육과학연구원',
  add column if not exists booth_dept         text not null default '미래교육과',
  add column if not exists booth_apply_period text not null default '2026. 9. 7.(월) ~ 9. 25.(금)';

-- 확인
select venue_detail, host_line, booth_dept, booth_apply_period
from public.settings where id = 1;
