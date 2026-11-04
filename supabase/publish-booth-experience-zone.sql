-- ===================================================================
-- 체험존 12곳 공개 — 관람객 화면 · 운영자 화면에 나타납니다
--
-- 먼저 할 일
--   · 관람객 화면 배포(지금 Production 화면에는 다섯째 탭 · 유형 배지가 없습니다)
--   · supabase/migration-booth-experience-zone.sql 적용
--   · 관리자 화면에서 12곳 QR 열쇠 발급(admin_issue_booth_tokens) · 부스별 PIN 발급 · 카드 인쇄
--
-- 하는 일: 구역 '체험' 공개 → 부스 12곳 공개. 다른 구역 · 부스는 건드리지 않습니다.
-- 공개 순간부터 전체 부스 수가 96곳으로 보입니다(화면은 공개된 부스를 세어 표시합니다).
-- 12곳 중 하나라도 QR 또는 PIN 이 없으면 아무것도 바꾸지 않고 멈춥니다.
-- 공개를 거두려면 supabase/rollback-booth-experience-zone.sql 의 1번.
-- ===================================================================

begin;

do $check$
declare
  v_n integer;
  v_qr integer;
  v_pin integer;
begin
  select count(*) into v_n from public.booths b where b.zone_key = '체험';
  if v_n <> 12 then
    raise exception '체험존 부스가 12곳이 아닙니다(%곳). 등록 SQL 을 먼저 적용해 주세요.', v_n;
  end if;
  select count(*) into v_qr from public.booths b
    join public.booth_access a on a.booth_id = b.id and a.disabled_at is null
   where b.zone_key = '체험';
  select count(*) into v_pin from public.booths b
    join public.booth_pin p on p.booth_id = b.id and p.disabled_at is null
   where b.zone_key = '체험';
  if v_qr <> 12 or v_pin <> 12 then
    raise exception 'QR % / 12곳, PIN % / 12곳입니다. 관리자 화면에서 모두 발급한 뒤 공개해 주세요.', v_qr, v_pin;
  end if;
end
$check$;

-- 구역을 먼저(트리거가 비공개 구역의 부스 공개를 막습니다)
update public.zones set is_published = true where key = '체험' and not is_published;
update public.booths set is_published = true where zone_key = '체험' and not is_published;

commit;

-- 확인(기대 = 실제)
select v."순서", v."항목", v."기대", v."실제"
  from (values
    (1, '구역 공개', 'true', (select is_published from public.zones where key = '체험')::text),
    (2, '공개된 체험존 부스', '12', (select count(*) from public.booths where zone_key = '체험' and is_published)::text),
    (3, '공개된 학교 부스', '84', (select count(*) from public.booths where is_published and zone_key in ('초등','중등','고등','특수') and org !~ '^\s*\[예시\]')::text),
    (4, '공개된 전체 부스', '96', (select count(*) from public.booths where is_published and org !~ '^\s*\[예시\]')::text)
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";
