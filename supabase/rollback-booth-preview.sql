-- ===================================================================
-- 되돌리기: migration-booth-preview.sql — 초안(아직 Production 미적용)
--
--   순서: 관람객 화면(booth-live)을 먼저 되돌리거나 그대로 둬도 됩니다 — 화면 서버는
--   booth_preview_list 가 없으면(PGRST202) 사전 안내 목록을 빈 목록으로 보고 원래대로 동작합니다.
--
--   하는 일: booth_preview_list() 함수와 booths.preview_listed 칸을 지웁니다.
--   지우지 않는 것: 부스 · 구역 · QR · PIN · 대기 값 · 기록 · 설정. 다른 함수 · 정책.
--   주의: preview_listed 값(어느 부스를 목록에 올렸는지)은 함께 사라집니다. 다시 적용하면 모두 false.
-- ===================================================================

begin;

drop function if exists public.booth_preview_list();
alter table public.booths drop column if exists preview_listed;

commit;

-- 관람객 화면 서버(PostgREST)가 새 함수 목록을 바로 읽게 합니다(다른 migration 과 같은 방식).
notify pgrst, 'reload schema';

select 'booth_preview_list 없음' as 확인,
       not exists (select 1 from pg_proc where proname = 'booth_preview_list' and pronamespace = 'public'::regnamespace) as 맞음
union all
select 'preview_listed 칸 없음',
       not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'booths' and column_name = 'preview_listed');
