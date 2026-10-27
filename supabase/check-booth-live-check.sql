-- ===================================================================
-- 점검(읽기만): '확인 필요' 관리자 일괄 확인 — 적용 전 · 리허설 · 적용 후
--
--   이 파일은 아무것도 바꾸지 않습니다(select 만). SQL Editor 에서 필요한 묶음만 골라 Run 합니다.
--   절차는 docs/ops-batch-confirm-apply.md.
--
--   A. 적용 전 — 선행 조건 · 같은 이름 없음 · 23:00 예약 작업 · 지금 값 지문
--   B. 리허설 비교 — 일괄 확인 앞뒤로 두 번 돌려 '확인한 부스의 현황 값 · 입력 시각 · 대기 기록' 이 그대로인지
--   C. 최근 확인 기록 — 누가 · 언제 · 어떤 값을(적용 뒤)
--   (적용 직후의 확인 표 10줄은 migration-booth-live-check.sql 맨 아래에 있습니다.)
-- ===================================================================


-- ── A. 적용 전 ────────────────────────────────────────────────────
-- 모든 칸이 true(또는 설명대로)여야 적용합니다.
select
  current_setting('server_version')                                            as "PostgreSQL",
  to_regclass('public.booth_live') is not null
    and to_regclass('public.booths') is not null
    and to_regclass('public.staff_profiles') is not null
    and to_regprocedure('public.is_admin()') is not null
    and to_regprocedure('auth.uid()') is not null                              as "선행 조건 있음",
  to_regclass('public.booth_live_check') is null
    and to_regprocedure('public.admin_confirm_booth_live(jsonb)') is null
    and to_regprocedure('public.admin_booth_live_checks()') is null            as "새 이름 아직 없음(처음 적용)",
  (select string_agg(j.jobname || ' ' || j.schedule || ' active=' || j.active::text, '; ')
     from cron.job j)                                                           as "예약 작업(23:00 = 0 14 * * *)",
  (select count(*) from public.booth_live)                                      as "booth_live 줄",
  (select md5(coalesce(string_agg(l.booth_id::text || '|' || l.congestion || '|' || l.wait_minutes || '|' || l.updated_at::text,
                                  ',' order by l.booth_id), ''))
     from public.booth_live l)                                                  as "booth_live 지문",
  (select count(*) || ' / ' || coalesce(max(g.id), 0) from public.booth_live_log g) as "대기 기록 줄 / 마지막 id";


-- ── B. 리허설 비교(일괄 확인 바로 전 · 바로 뒤에 한 번씩) ────────────────
-- 아래 부스번호 목록을 리허설에서 확인할 부스로 바꿔 씁니다. 두 결과의 '지문' · '마지막 입력' · '대기 기록' 이 같아야 합니다
-- (그 사이 운영자가 그 부스에 직접 입력했다면 달라지는 것이 맞습니다 — 그때는 그 부스를 빼고 다시 봅니다).
with target as (
  select b.id,
         coalesce(nullif(b.code, ''), b.zone_key || '-' || lpad(b.no::text, greatest(2, length(b.no::text)), '0')) as code
    from public.booths b
   where coalesce(nullif(b.code, ''), b.zone_key || '-' || lpad(b.no::text, greatest(2, length(b.no::text)), '0'))
         = any (array['R1-01', 'R1-02'])
)
select t.code                                                                     as "부스",
       l.congestion                                                               as "혼잡도",
       l.wait_minutes                                                             as "대기",
       l.updated_at                                                               as "마지막 입력(updated_at)",
       md5(coalesce(l.congestion, '') || '|' || coalesce(l.wait_minutes::text, '') || '|' || coalesce(l.updated_at::text, '')) as "지문",
       (select count(*) || ' / ' || coalesce(max(g.id), 0)
          from public.booth_live_log g where g.booth_id = t.id)                   as "대기 기록 줄 / 마지막 id",
       (select count(*) from public.booth_live_check c where c.booth_id = t.id)   as "관리자 확인 기록 수"
  from target t
  left join public.booth_live l on l.booth_id = t.id
 order by t.code;


-- ── C. 최근 관리자 확인 기록(적용 뒤) ─────────────────────────────────
select c.checked_at                         as "확인 시각",
       coalesce(s.name, '') || ' (' || c.checked_by::text || ')' as "확인한 관리자",
       c.booth_code                          as "부스",
       c.booth_name                          as "부스명",
       c.seen_congestion || ' ' || c.seen_wait || '분' as "확인한 값",
       c.seen_updated_at                     as "그 값의 입력 시각",
       c.batch_id                            as "묶음"
  from public.booth_live_check c
  left join public.staff_profiles s on s.id = c.checked_by
 order by c.id desc
 limit 30;
