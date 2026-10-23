-- ===================================================================
-- 개별 PIN · 공통 PIN 병행 확인 (읽기 전용 — 아무것도 바꾸지 않습니다)
--
--   migration-booth-common-pin-dual-nov4.sql(병행 · 11-04 23:00 마감)을 적용한 뒤 실제 부스 84곳에 개별 PIN 을 발급하고
--   QR 인쇄 화면 '운영자 PIN 발급·관리' 의 결과 창과 함께 봅니다. 언제 몇 번 실행해도 됩니다.
--   private 함수를 부르지 않고 같은 조건을 표에서 직접 셉니다 — 읽기 전용 계정으로도 돌아갑니다.
--   PIN · 세션 원문은 읽지 않고, QR 열쇠는 md5 로만 견줍니다.
--   예전 규칙(발급하면 공통 PIN 닫힘)으로 세는 check-booth-pin-conversion.sql 은 병행 정책에서는 쓰지 않습니다.
--
--   다 발급했으면: 2 = 84 · 3 = 0 · 4 = 0 · 5 = '-' (기대 = 실제).
--     6 은 서버의 끝나는 때와 같은 식입니다. 7 은 마감 전 84 · 마감 뒤 0 이 기대값입니다(시각에 따라 기대가 바뀜).
--     8 은 참고 — 마감 전에는 지금 공통 PIN 으로 연 화면 수(숫자), 마감 뒤에는 0 이어야 합니다.
--   일부가 남았으면 5 에 그 부스 번호가 나옵니다 → 인쇄 화면에서 그 부스만 골라 ‘선택 PIN 발급’ → 이 파일을 다시 실행.
--   9 는 리허설 시작 전(2026-10-19) QR 열쇠 지문이라, 그 뒤 '열쇠 바꾸기' 를 한 부스가 있으면 달라집니다(그때는 10 · 11 로 봅니다).
--   개별 PIN 숫자가 부스끼리 겹치는지는 DB 에서 알 수 없습니다 — 발급 결과 창이 알려 줍니다.
-- ===================================================================
with r as (       -- 실제 부스(기관이 '[예시]' 로 시작하지 않는 부스) — 리허설 대상 84곳과 같은 목록인지 1 에서 확인
  select b.id, coalesce(nullif(b.code, ''), b.zone_key || '-' || lpad(b.no::text, 2, '0')) as code,
         b.zone_key, b.no, b.is_published
    from public.booths b
   where coalesce(b.org, '') !~ '^\s*\[예시\]'
), st as (
  select r.*, (p.booth_id is not null) as has_pin, (p.disabled_at is not null) as pin_off
    from r left join public.booth_pin p on p.booth_id = r.id
), until_at as (  -- private.rehearsal_common_pin_until() 과 같은 식(병행 판)
  select least(timestamptz '2026-11-04 23:00:00+09',
               (least(coalesce((select (s.event_start at time zone 'Asia/Seoul')::date from public.settings s order by s.id limit 1),
                               date '2026-11-06'), date '2026-11-06'))::timestamp at time zone 'Asia/Seoul') as t
), open_common as (   -- 지금 공통 PIN 으로 열 수 있는 실제 부스(병행 판 리허설 갈래 + 공개 조건과 같음)
  select st.id from st
    join public.zones z on z.key = st.zone_key
   where pg_catalog.now() < (select t from until_at)
     and not st.pin_off
     and st.is_published and z.is_published and st.no is not null
)
select v."순서", v."항목", v."기대", v."실제"
  from (values
    (1, '실제 부스 수 · 목록 지문(리허설 대상 84곳과 같음)', '84 · 965ec1ec308bd1f1c59b6a52fc3adb9c',
        (select count(*) || ' · ' || md5(string_agg(id::text, ',' order by id::text)) from r)),
    (2, '개별 PIN 켜짐(발급됨)', '84', (select count(*) from st where has_pin and not pin_off)::text),
    (3, '개별 PIN 없음(미발급)', '0', (select count(*) from st where not has_pin)::text),
    (4, '개별 PIN 꺼짐(공통 PIN 도 막힘)', '0', (select count(*) from st where pin_off)::text),
    (5, '다시 발급할 부스(미발급 · 꺼짐)', '-',
        coalesce((select string_agg(code, ' ' order by zone_key, no) from st where not has_pin or pin_off), '-')),
    (6, '공통 PIN 끝나는 때(한국 시각)', '2026-11-04 23:00:00',
        (select to_char(t at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS') from until_at)),
    (7, '지금 공통 PIN 으로 열 수 있는 실제 부스(마감 전 84 · 마감 뒤 0)',
        case when pg_catalog.now() < (select t from until_at) then '84' else '0' end,
        (select count(*) from open_common)::text),
    (8, '(참고) 지금 쓸 수 있는 공통 PIN 세션(실제 부스 · 마감 뒤 0)',
        case when pg_catalog.now() < (select t from until_at) then '-' else '0' end,
        (select count(*) from public.booth_session s
          where s.via_common_pin and s.revoked_at is null and s.expires_at > pg_catalog.now()
            and s.booth_id in (select id from open_common))::text),
    (9, 'QR 열쇠 지문(134곳 · 2026-10-19 기준)', '7c14f0583f09b78ec9a0cdf882411fa9',
        (select md5(coalesce(string_agg(a.booth_id::text || ':' || md5(a.token) || ':' || coalesce(extract(epoch from a.created_at)::text, '')
                                        || ':' || coalesce(extract(epoch from a.rotated_at)::text, '') || ':' || coalesce(extract(epoch from a.disabled_at)::text, ''),
                                        ',' order by a.booth_id), '')) from public.booth_access a)),
    (10, 'QR 열쇠가 있는 실제 부스 · 꺼진 열쇠', '84 · 0',
        (select count(*) || ' · ' || count(*) filter (where a.disabled_at is not null) from public.booth_access a where a.booth_id in (select id from r))),
    (11, 'QR 열쇠를 바꾼 실제 부스(10-19 뒤)', '0',
        (select count(*) from public.booth_access a
          where a.booth_id in (select id from r) and a.rotated_at > timestamptz '2026-10-19 00:00:00+09')::text)
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";
