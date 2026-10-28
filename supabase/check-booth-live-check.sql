-- ===================================================================
-- 점검(읽기만): '확인 필요' 관리자 일괄 확인 — 적용 전 · 리허설 · 적용 후
--
--   이 파일은 아무것도 바꾸지 않습니다(select 만). SQL Editor 에서 필요한 묶음만 골라 Run 합니다.
--   절차는 docs/ops-batch-confirm-apply.md.
--
--   A. 적용 전 — 선행 조건 · 같은 이름 없음 · 23:00 예약 작업 · 지금 값 지문
--   B. 리허설 비교 — 일괄 확인 앞뒤로 두 번 돌려 '확인한 부스의 현황 값 · 입력 시각 · 대기 기록' 이 그대로인지
--   C. 최근 확인 기록 — 누가 · 언제 · 어떤 값을(적용 뒤)
--   D. 확인 표 10줄 다시 보기 — migration-booth-live-check.sql 맨 아래와 같은 표(적용 뒤 언제든)
--   E. 기준 지문 — 적용 직전 · 직후 · 리허설 뒤에 한 번씩 돌려 견줌(실제 84곳 · 현황 · 대기 기록 · QR · PIN · 기존 함수 · 정책 · 23:00 작업)
--   F. 확인 필요 · 관리자 확인 · 아직 미확인 수 — 관리자 화면 ‘관리 조치’ 와 같은 셈(적용 뒤)
--   R. 23:00 자동 초기화 — 적용 당일 14:00 · 다음 날 아침(전날 23:00 succeeded · 어제 값 남음 0)
--   X. E 가 달라졌을 때 — E(전) 뒤 대기 기록의 출처 · 시각 대조 + 기록 없이 바뀐 현황 수(0)
--   G. 관리자 확인 뒤 현황 그대로인가 — 확인한 부스마다(적용 뒤)
--   (적용 직후의 확인 표 10줄은 migration-booth-live-check.sql 맨 아래에도 있습니다.)
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


-- ── D. 확인 표 10줄 다시 보기(적용 뒤) ──────────────────────────────
-- migration-booth-live-check.sql 맨 아래와 같은 표입니다. ‘맞음’ 이 모두 true 여야 합니다.
select v."항목",
       v."기대",
       v."실제",
       v."기대" = v."실제" as "맞음"
  from (values
    (1, 'booth_live_check 표 · RLS 켬', 'true',
        (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.booth_live_check'::regclass)::text),
    (2, 'booth_live_check 정책 수(함수로만 씀)', '0',
        (select count(*) from pg_catalog.pg_policies p where p.schemaname = 'public' and p.tablename = 'booth_live_check')::text),
    (3, 'booth_live_check 직접 읽기 · 쓰기 (anon · authenticated)', 'false',
        (has_table_privilege('anon', 'public.booth_live_check', 'SELECT')
         or has_table_privilege('anon', 'public.booth_live_check', 'INSERT')
         or has_table_privilege('authenticated', 'public.booth_live_check', 'SELECT')
         or has_table_privilege('authenticated', 'public.booth_live_check', 'INSERT')
         or has_table_privilege('authenticated', 'public.booth_live_check', 'UPDATE')
         or has_table_privilege('authenticated', 'public.booth_live_check', 'DELETE'))::text),
    (4, 'anon 실행 (두 함수 중 하나라도)', 'false',
        (has_function_privilege('anon', 'public.admin_confirm_booth_live(jsonb)', 'EXECUTE')
         or has_function_privilege('anon', 'public.admin_booth_live_checks()', 'EXECUTE'))::text),
    (5, 'authenticated 실행 (두 함수 모두 — 안에서 is_admin)', 'true',
        (has_function_privilege('authenticated', 'public.admin_confirm_booth_live(jsonb)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.admin_booth_live_checks()', 'EXECUTE'))::text),
    (6, 'security definer · search_path 빈 값 · volatile (두 함수)', '2',
        (select count(*)
           from pg_catalog.pg_proc pro
           join pg_catalog.pg_namespace nsp on nsp.oid = pro.pronamespace
          where nsp.nspname = 'public'
            and pro.proname in ('admin_confirm_booth_live', 'admin_booth_live_checks')
            and pro.prosecdef
            and pro.provolatile = 'v'
            and 'search_path=""' = any (pro.proconfig))::text),
    (7, '일괄 확인: 관리자끼리 advisory 잠금 · 줄은 FOR UPDATE NOWAIT · lock_timeout 3s', 'true',
        ((select pg_catalog.pg_get_functiondef('public.admin_confirm_booth_live(jsonb)'::regprocedure) ~* 'for\s+update\s+nowait')
         and (select pg_catalog.pg_get_functiondef('public.admin_confirm_booth_live(jsonb)'::regprocedure) ~* 'pg_advisory_xact_lock')
         and (select 'lock_timeout=3s' = any (pro.proconfig) from pg_catalog.pg_proc pro
               where pro.oid = 'public.admin_confirm_booth_live(jsonb)'::regprocedure))::text),
    (8, '일괄 확인이 booth_live · booth_live_log 를 쓰지 않음', 'false',
        (select pg_catalog.pg_get_functiondef('public.admin_confirm_booth_live(jsonb)'::regprocedure)
                ~* '(insert\s+into|update|delete\s+from)\s+public\.booth_live(_log)?\M')::text),
    (9, '함수 이름마다 정의 1개', 'admin_booth_live_checks 1, admin_confirm_booth_live 1',
        (select string_agg(f.n || ' ' || (select count(*)
                                            from pg_catalog.pg_proc pro
                                            join pg_catalog.pg_namespace nsp on nsp.oid = pro.pronamespace
                                           where nsp.nspname = 'public'
                                             and pro.proname = f.n)::text,
                           ', ' order by f.n collate "C")
           from unnest(array['admin_booth_live_checks', 'admin_confirm_booth_live']) as f(n))),
    (10, '기록 표에 외래 키 없음(부스를 지워도 감사 기록 남음)', '0',
        (select count(*) from pg_catalog.pg_constraint con
          where con.conrelid = 'public.booth_live_check'::regclass and con.contype = 'f')::text)
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";


-- ── E. 기준 지문(적용 직전 · 직후 · 리허설 뒤에 한 번씩) ─────────────────
-- 일괄 확인은 아래 어느 것도 바꾸지 않습니다. 적용 직전과 직후가 칸마다 같아야 하고(그 사이 운영자 입력이 없을 때),
-- 리허설 뒤에도 ‘현황 · 대기 기록’ 말고는 같아야 합니다(리허설에서 운영자가 입력한 것은 현황 · 기록이 바뀌는 것이 맞음).
-- ‘기존 함수 지문’ 은 새 함수 두 개(admin_confirm_booth_live · admin_booth_live_checks)를 빼고, 줄바꿈 CR 을 무시하고 셉니다.
with r as (select b.id from public.booths b where b.org !~ '^\s*\[예시\]')
select
  (select count(*) from r)                                                                  as "실제 부스",
  (select md5(string_agg(b.id::text, ',' order by b.id)) from public.booths b join r on r.id = b.id) as "실제 부스 id 지문",
  (select count(*) from public.booths b join r on r.id = b.id join public.zones z on z.key = b.zone_key
     where b.is_published and z.is_published and b.no is not null)                           as "실제 중 공개",
  (select count(*) from public.booth_live)                                                  as "booth_live 줄",
  (select md5(coalesce(string_agg(l.booth_id::text || '|' || l.congestion || '|' || l.wait_minutes || '|' || l.updated_at::text,
                                  ',' order by l.booth_id), '')) from public.booth_live l)   as "booth_live 지문(값 · updated_at)",
  (select count(*) || ' / ' || coalesce(max(g.id), 0) from public.booth_live_log g)         as "대기 기록 줄 / 마지막 id",
  (select md5(coalesce(string_agg(a.booth_id::text || coalesce(a.rotated_at::text, '') || coalesce(a.disabled_at::text, ''),
                                  ',' order by a.booth_id), '')) from public.booth_access a) as "QR 상태 지문(열쇠 값 제외)",
  (select count(*) from public.booth_pin p join r on r.id = p.booth_id)                      as "실제 개별 PIN",
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prokind = 'f'
      and p.proname not in ('admin_confirm_booth_live', 'admin_booth_live_checks'))          as "기존 함수 수",
  (select md5(string_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' || md5(replace(pg_get_functiondef(p.oid), E'\r', '')),
                         ',' order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prokind = 'f'
      and p.proname not in ('admin_confirm_booth_live', 'admin_booth_live_checks'))          as "기존 함수 지문",
  (select md5(string_agg(tablename || policyname || cmd || coalesce(qual, '') || coalesce(with_check, ''), ',' order by tablename, policyname))
     from pg_policies where schemaname = 'public')                                           as "정책 지문",
  (select string_agg(j.jobname || ' [' || j.schedule || '] active=' || j.active, '; ') from cron.job j) as "예약 작업";


-- ── F. 확인 필요 · 관리자 확인 · 아직 미확인(적용 뒤) ──────────────────────
-- 관리자 화면 ‘관리 조치’ 와 같은 셈입니다(공개 부스 · 오늘 값 · 마감 아님 · 30분 넘게 그대로 = 확인 필요,
-- 그중 지금 값에 붙은 관리자 확인이 30분 안이면 관리자 확인, 나머지는 아직 미확인). 두 관리자가 같은 숫자를 봐야 합니다.
with pub as (
  select b.id from public.booths b join public.zones z on z.key = b.zone_key
   where b.is_published and z.is_published and b.no is not null
), stale as (
  select l.booth_id, l.updated_at from public.booth_live l join pub on pub.id = l.booth_id
   where (l.updated_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date
     and l.congestion <> '마감' and l.updated_at < now() - interval '30 minutes'
)
select (select count(*) from stale) as "확인 필요",
       (select count(*) from stale s where exists (
          select 1 from public.booth_live_check c
           where c.booth_id = s.booth_id and c.seen_updated_at = s.updated_at
             and c.checked_at >= now() - interval '30 minutes'
             and (c.checked_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date)) as "관리자 확인",
       (select count(*) from stale s where not exists (
          select 1 from public.booth_live_check c
           where c.booth_id = s.booth_id and c.seen_updated_at = s.updated_at
             and c.checked_at >= now() - interval '30 minutes'
             and (c.checked_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date)) as "아직 미확인";


-- ── R. 23:00 자동 초기화(적용 당일 14:00 · 다음 날 아침) ─────────────────────
-- 맨 앞이 ‘succeeded 전날 23:00’ 이고 ‘실제 부스 어제 값 남음’ 이 0 이어야 적용합니다. 아니면 적용을 미루고 초기화부터 봅니다.
with r as (select b.id from public.booths b where b.org !~ '^\s*\[예시\]')
select
  (select string_agg(d.status || ' ' || to_char(d.start_time at time zone 'Asia/Seoul', 'MM-DD HH24:MI:SS'), ' · ' order by d.start_time desc)
     from (select d.* from cron.job_run_details d join cron.job j on j.jobid = d.jobid
            where j.jobname = 'booth-rehearsal-reset' order by d.start_time desc limit 3) d) as "최근 초기화 3번(상태 시작 KST)",
  (select count(*) from public.booth_live l join r on r.id = l.booth_id
    where (l.updated_at at time zone 'Asia/Seoul')::date < (now() at time zone 'Asia/Seoul')::date) as "실제 부스 어제 값 남음(0)",
  (select count(*) from public.booth_live l join r on r.id = l.booth_id
    where (l.updated_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date) as "실제 부스 오늘 입력";


-- ── X. E 가 달라졌을 때 — 입력 시각 · 출처 대조(적용 전에도 · 뒤에도) ─────────────
-- 맨 위 'E(전)의_마지막_id' 를 E(전) 결과의 ‘대기 기록 줄 / 마지막 id’ 의 마지막 id(숫자)로 바꿔 Run 합니다(안 바꾸면 일부러 오류).
-- 출처: set = 운영자 입력 · touch = 운영자 ‘변동 없음’ · admin = 관리자 화면 입력. 일괄 확인은 대기 기록을 남기지 않습니다.
-- ‘기록과 안 맞는 현황’ 은 현황 줄마다 같은 시각 · 같은 값의 대기 기록이 있는지 셉니다 — 0 이 아니면 기록 없이 바뀐 값이 있다는 뜻(되돌리기 · 원인 확인).
-- 기록이 맞아도 누가 입력했는지는 따로 판단합니다(대기 기록에는 입력한 사람이 없음 — 문서 9장).
-- X1 요약
with base as (select 'E(전)의_마지막_id'::bigint as last_id)
select
  (select count(*) from public.booth_live_log g, base where g.id > base.last_id) as "E(전) 뒤 새 대기 기록",
  (select coalesce(string_agg(x.s, ' · '), '없음') from (
      select g.source || ' ' || count(*) || '건 ' || to_char(min(g.created_at) at time zone 'Asia/Seoul', 'HH24:MI:SS')
             || '~' || to_char(max(g.created_at) at time zone 'Asia/Seoul', 'HH24:MI:SS') as s
        from public.booth_live_log g, base where g.id > base.last_id group by g.source order by g.source) x) as "출처별",
  (select count(*) from public.booth_live l
    where not exists (select 1 from public.booth_live_log g
                       where g.booth_id = l.booth_id and g.created_at = l.updated_at
                         and g.congestion is not distinct from l.congestion
                         and g.wait_minutes is not distinct from l.wait_minutes)) as "기록과 안 맞는 현황(0)";

-- X2 목록(어느 부스에 언제 무엇이) — 위와 같은 숫자로 바꿔 씁니다
with base as (select 'E(전)의_마지막_id'::bigint as last_id)
select g.id                                                                       as "기록 id",
       to_char(g.created_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI:SS')        as "입력 시각(KST)",
       g.source                                                                   as "출처",
       coalesce(nullif(b.code, ''), b.zone_key || '-' || lpad(b.no::text, greatest(2, length(b.no::text)), '0')) as "부스",
       g.congestion || ' ' || coalesce(g.wait_minutes::text || '분', '')           as "값",
       coalesce(l.updated_at = g.created_at, false)                               as "지금 현황이 이 입력"
  from public.booth_live_log g cross join base
  left join public.booths b on b.id = g.booth_id
  left join public.booth_live l on l.booth_id = g.booth_id
 where g.id > base.last_id
 order by g.id
 limit 200;


-- ── G. 관리자 확인 뒤 현황이 그대로인가(적용 뒤 — 새 표가 있어야 함) ───────────────
-- 오늘 확인한 부스마다 ‘확인한 값’ 이 지금 현황과 같은지 봅니다.
-- ‘현황 그대로’ false 는 ‘확인한 값 뒤 입력 수’ 가 1 이상(그 뒤 운영자 · 관리자가 새로 입력)일 때만 정상입니다.
-- false 인데 0 이면 관리자 확인만으로 현황이 바뀐 것 — 즉시 사용 중단 · 되돌리기 · 원인 확인.
select c.booth_code                                                          as "부스",
       to_char(c.checked_at at time zone 'Asia/Seoul', 'HH24:MI:SS')        as "확인 시각",
       c.seen_updated_at = l.updated_at                                      as "현황 그대로",
       (select count(*) from public.booth_live_log g
         where g.booth_id = c.booth_id and g.created_at > c.seen_updated_at) as "확인한 값 뒤 입력 수",
       (select coalesce(string_agg(g.source || ' ' || to_char(g.created_at at time zone 'Asia/Seoul', 'HH24:MI:SS'), ', ' order by g.id), '')
          from public.booth_live_log g
         where g.booth_id = c.booth_id and g.created_at > c.seen_updated_at) as "그 입력(출처 시각)"
  from public.booth_live_check c
  left join public.booth_live l on l.booth_id = c.booth_id
 where (c.checked_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date
 order by c.id desc;
