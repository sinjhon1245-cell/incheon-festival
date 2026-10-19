-- ===================================================================
-- 리허설 공통 PIN — 실제 부스 84곳도 행사 전 리허설 동안 운영 준비용 공통 PIN 으로 운영자 화면을 엽니다
--
--   새 인증 길을 만들지 않습니다. 예시 부스에 이미 쓰는 '운영 준비용 공통 PIN'(migration-booth-example-pin.sql)의
--   길 — PIN 로그인(public.booth_pin_login) → 공통 PIN 비교(private.booth_common_pin_ok) → 대상 판정
--   (private.booth_common_pin_target), 세션은 쓸 때마다 private.booth_session_resolve 가 대상 판정을 다시 봄 — 에서
--   '대상 판정' 하나에 리허설 갈래를 더합니다. 로그인 · 세션 확인 · 공통 PIN 비교 함수는 바꾸지 않습니다.
--   공통 PIN 값(6자리)은 이 파일에 적지 않고(그 값은 booth_common_pin_ok 안에만 있음), 개별 PIN 으로 저장하지도
--   않습니다(booth_pin 줄을 만들지 않음).
--
--   대상: private.rehearsal_booth_ids() 의 실제 부스 84곳(migration-booth-rehearsal.sql) 중 공개 · 구역 공개 · 번호 있음 ·
--         '[예시]' 기관 아님 · 개별 PIN 을 한 번도 받지 않은 부스. 예시 50곳의 조건(스위치 · '[예시]')은 그대로입니다.
--
--   끝나는 때 — 둘 중 이른 쪽, 서버 시각으로 서버가 판정
--     ① 2026-11-05 23:00 KST(행사 첫날 settings.event_start 가 앞당겨지면 그날 00:00 KST)
--        · 그때부터 새 로그인은 맞지 않는 PIN 과 같게 거절됩니다(횟수 제한 · 보안 기록 pin_fail 그대로).
--        · 이미 열린 공통 PIN 화면은 다음 저장 · 확인 · 다시 읽기에서 서버가 거절합니다(42501 booth_session_revoked).
--     ② 그 부스에 개별 PIN 을 발급한 순간(관리자 ⋯ 메뉴 · QR · PIN 관리 '선택 PIN 발급' — 기존 기능 그대로)
--        · 기존 발급 함수가 한 트랜잭션에서 PIN 저장 · 그 부스 세션 모두 끊기(pin_reissued) · 기록(pin_issued)을 합니다.
--        · 그 뒤로는 PIN 줄과 발급 기록이 있어 그 부스에는 공통 PIN 이 다시 열리지 않습니다(PIN 끄기도 줄을 지우지 않음).
--        · 부스마다 따로 끝납니다. 일괄 발급 중 일부가 실패하면 그 부스만 공통 PIN 이 남고(①에서 끝남),
--          '선택 PIN 발급' 으로 다시 발급하면 그 순간 끝납니다.
--
--   이 파일이 바꾸는 것
--     private.booth_common_pin_target(uuid)     예시 부스 조건은 한 글자도 바꾸지 않고 '또는 리허설 갈래' 만 더함
--   이 파일이 더하는 것
--     private.rehearsal_common_pin_until()       ①의 시각
--     private.rehearsal_common_pin_open(uuid)    리허설 갈래 조건(84곳 · ① 전 · 개별 PIN 이력 없음)
--   그대로인 것
--     표 · 칸 · 제약 · RLS · 설정 · QR · 개별 PIN · 세션 · 보안 기록 · 대기 값 · 부스 정보 · 예시 50곳 ·
--     횟수 제한 · 세션 규칙(부스 하나에 묶임 · 그날 24:00 만료 · 부스당 10개) · 공통 PIN 로그인 기록(detail 'common_pin')
--     · 리허설 대기 채우기 · 비우기 · 23시 초기화(서로 따로 돕니다 — 초기화는 세션을 끊지 않고, PIN 이 끝나도 값은 그대로)
--
-- 사용법: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run. 여러 번 실행해도 같은 결과입니다.
--         맨 아래 확인 표의 '기대' 와 '실제' 가 모두 같아야 합니다.
-- 되돌리기(= 리허설 공통 PIN 즉시 끝내기): supabase/rollback-booth-rehearsal-pin.sql
-- 트랜잭션: BEGIN/COMMIT 을 넣지 않습니다. SQL Editor 와 apply_migration 은 이미 한 트랜잭션으로
--   돌립니다. psql 은 psql -1 -v ON_ERROR_STOP=1 -f.
-- ===================================================================


-- ═══════════════════════════════════════════════════════════════
-- 0. 선행 조건 검사 (아무것도 바꾸지 않습니다)
--    이 파일은 아래 네 함수가 2026-10-19 Production 과 같은 판일 때만 맞게 동작합니다. 다르면 멈춥니다.
--    (지문 = 줄 끝 CR 을 뺀 pg_get_functiondef 의 md5)
-- ═══════════════════════════════════════════════════════════════
do $preflight$
declare
  v_fp text;
begin
  if to_regprocedure('private.rehearsal_booth_ids()') is null
     or to_regprocedure('private.rehearsal_cutoff()') is null then
    raise exception '선행 조건 누락: migration-booth-rehearsal.sql 을 먼저 적용하세요.';
  end if;
  if to_regprocedure('public.booth_pin_login(uuid, text, text)') is null
     or to_regprocedure('private.booth_session_resolve(text, boolean)') is null
     or to_regprocedure('private.booth_common_pin_ok(uuid, text)') is null
     or to_regprocedure('private.booth_common_pin_target(uuid)') is null
     or to_regclass('public.booth_pin') is null
     or to_regclass('public.booth_auth_event') is null then
    raise exception '선행 조건 누락: migration-booth-pin.sql · migration-booth-example-pin.sql 을 먼저 적용하세요.';
  end if;

  select string_agg(left(md5(replace(pg_catalog.pg_get_functiondef(f::regprocedure), E'\r', '')), 8), ' ' order by o)
    into v_fp
    from (values (1, 'public.booth_pin_login(uuid, text, text)'),
                 (2, 'private.booth_common_pin_ok(uuid, text)'),
                 (3, 'private.booth_session_resolve(text, boolean)')) as x(o, f);
  if v_fp <> 'd78e25b9 57684373 587f4d79' then
    raise exception 'PIN 로그인 · 세션 확인 · 공통 PIN 비교 함수가 예상한 판이 아닙니다(지문 %). 아무것도 바꾸지 않고 멈춥니다.', v_fp;
  end if;

  -- 대상 판정은 예시 부스 판(migration-booth-example-pin.sql 3-1) 또는 이 파일의 판이어야 합니다(다시 실행).
  v_fp := md5(replace(pg_catalog.pg_get_functiondef('private.booth_common_pin_target(uuid)'::regprocedure), E'\r', ''));
  if v_fp not in ('8a6c426db3698038988853239fac834b', 'ecc7f328f814ff4ac029db5ce40904a4') then
    raise exception 'private.booth_common_pin_target 이 예상한 판이 아닙니다(지문 %). 아무것도 바꾸지 않고 멈춥니다.', left(v_fp, 8);
  end if;
end
$preflight$;


-- ═══════════════════════════════════════════════════════════════
-- 1. 리허설 공통 PIN 이 끝나는 때 — 2026-11-05 23:00 KST, 행사 첫날이 앞당겨지면 그날 00:00 KST
--    private.rehearsal_cutoff() = settings.event_start 의 한국 날짜(늦어도 2026-11-06)
-- ═══════════════════════════════════════════════════════════════
create or replace function private.rehearsal_common_pin_until()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select least(timestamptz '2026-11-05 23:00:00+09',
               (private.rehearsal_cutoff())::timestamp at time zone 'Asia/Seoul')
$$;


-- ═══════════════════════════════════════════════════════════════
-- 2. 리허설 갈래 — 84곳 · 끝나는 때 전 · 그 부스에 개별 PIN 이력이 없음
--    PIN 줄(booth_pin)은 발급하면 생기고 끄기로도 지워지지 않습니다. 줄을 손으로 지워도 보안 기록의
--    발급 · 재발급 · 끄기가 남아 있으면 열리지 않습니다 — 개별 PIN 으로 넘어간 부스에 공통 PIN 이 다시 열리지 않게.
-- ═══════════════════════════════════════════════════════════════
create or replace function private.rehearsal_common_pin_open(p_booth uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
           p_booth = any (private.rehearsal_booth_ids())
           and pg_catalog.now() < private.rehearsal_common_pin_until()
           and not exists (select 1 from public.booth_pin p where p.booth_id = p_booth)
           and not exists (select 1 from public.booth_auth_event e
                            where e.booth_id = p_booth
                              and e.event in ('pin_issued', 'pin_reissued', 'pin_disabled')),
           false)
$$;

revoke all on function private.rehearsal_common_pin_until()      from public;
revoke all on function private.rehearsal_common_pin_until()      from anon, authenticated;
revoke all on function private.rehearsal_common_pin_open(uuid)   from public;
revoke all on function private.rehearsal_common_pin_open(uuid)   from anon, authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 3. 공통 PIN 대상 판정 — 앞 괄호(예시 부스)는 migration-booth-example-pin.sql 3-1 과 같은 글자,
--    뒤 괄호(리허설 갈래)만 더했습니다. 로그인(booth_common_pin_ok)과 세션 확인(booth_session_resolve)이
--    모두 이 함수를 부르므로, 로그인 · 열린 화면의 저장 · 확인이 같은 판정을 받습니다. null 은 돌려주지 않습니다.
-- ═══════════════════════════════════════════════════════════════
create or replace function private.booth_common_pin_target(p_booth uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
           (coalesce((select s.booth_sample_common_pin_enabled from public.settings s order by s.id limit 1), false)
            and exists (
              select 1 from public.booths b join public.zones z on z.key = b.zone_key
               where b.id = p_booth and b.is_published and z.is_published and b.no is not null
                 and b.org ~ '^\s*\[예시\]'
            ))
           or
           (private.rehearsal_common_pin_open(p_booth)
            and exists (
              select 1 from public.booths b join public.zones z on z.key = b.zone_key
               where b.id = p_booth and b.is_published and z.is_published and b.no is not null
                 and coalesce(b.org, '') !~ '^\s*\[예시\]'
            )),
           false)
$$;

revoke all on function private.booth_common_pin_target(uuid)     from public;
revoke all on function private.booth_common_pin_target(uuid)     from anon, authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 4. 확인 (기대 = 실제)
--    5 · 6 은 2026-10-19 Production 기준(실제 84곳 모두 공개 · 번호 있음 · 개별 PIN 0 · 예시 공통 PIN 스위치 꺼짐)입니다.
--    리허설 중 일부 부스에 개별 PIN 을 낸 뒤 다시 실행하면 5 는 그만큼 줄어듭니다.
-- ═══════════════════════════════════════════════════════════════
select v."순서", v."항목", v."기대", v."실제"
  from (values
    (1, '리허설 공통 PIN 끝나는 때(한국 시각)', '2026-11-05 23:00:00',
        to_char(private.rehearsal_common_pin_until() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS')),
    (2, 'PIN 로그인 · 세션 확인 · 공통 PIN 비교 함수 그대로(지문)', 'd78e25b9 57684373 587f4d79',
        (select string_agg(left(md5(replace(pg_catalog.pg_get_functiondef(f::regprocedure), E'\r', '')), 8), ' ' order by o)
           from (values (1, 'public.booth_pin_login(uuid, text, text)'),
                        (2, 'private.booth_common_pin_ok(uuid, text)'),
                        (3, 'private.booth_session_resolve(text, boolean)')) as x(o, f))),
    (3, '대상 판정 새 판(지문)', 'ecc7f328',
        left(md5(replace(pg_catalog.pg_get_functiondef('private.booth_common_pin_target(uuid)'::regprocedure), E'\r', '')), 8)),
    (4, '84곳 밖 부스에 리허설 갈래가 열림(예시 · 없는 부스 · null 포함)', '0',
        ((select count(*) from public.booths b
           where not (b.id = any (private.rehearsal_booth_ids())) and private.rehearsal_common_pin_open(b.id))
         + (private.rehearsal_common_pin_open(null))::int
         + (private.rehearsal_common_pin_open('00000000-0000-0000-0000-000000000000'))::int)::text),
    (5, '지금 리허설 공통 PIN 대상(84곳 중)', '84',
        (select count(*) from unnest(private.rehearsal_booth_ids()) x where private.booth_common_pin_target(x))::text),
    (6, '예시 부스 판정 바뀜(앞 판과 다른 부스 수)', '0',
        (select count(*) from public.booths b
          where not (b.id = any (private.rehearsal_booth_ids()))
            and private.booth_common_pin_target(b.id) is distinct from
                (coalesce((select s.booth_sample_common_pin_enabled from public.settings s order by s.id limit 1), false)
                 and exists (select 1 from public.zones z
                              where z.key = b.zone_key and b.is_published and z.is_published and b.no is not null
                                and b.org ~ '^\s*\[예시\]')))::text),
    (7, '새 함수 · 대상 판정 — anon · authenticated 실행', 'false',
        (has_function_privilege('anon', 'private.rehearsal_common_pin_until()', 'EXECUTE')
         or has_function_privilege('authenticated', 'private.rehearsal_common_pin_until()', 'EXECUTE')
         or has_function_privilege('anon', 'private.rehearsal_common_pin_open(uuid)', 'EXECUTE')
         or has_function_privilege('authenticated', 'private.rehearsal_common_pin_open(uuid)', 'EXECUTE')
         or has_function_privilege('anon', 'private.booth_common_pin_target(uuid)', 'EXECUTE')
         or has_function_privilege('authenticated', 'private.booth_common_pin_target(uuid)', 'EXECUTE'))::text),
    (8, 'private 스키마 사용(anon · authenticated)', 'false',
        (has_schema_privilege('anon', 'private', 'USAGE') or has_schema_privilege('authenticated', 'private', 'USAGE'))::text)
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";
