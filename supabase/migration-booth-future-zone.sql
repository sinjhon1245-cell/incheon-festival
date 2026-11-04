-- ===================================================================
-- 미래채움존 9곳 등록(비공개) — 구역 · 부스 · 번호 규칙 · 23:00 초기화
--
-- 이 파일은 부스를 '비공개' 로 넣습니다. 관람객 화면에는 아직 나타나지 않습니다.
-- 공개는 QR · PIN 을 발급한 뒤 supabase/publish-booth-future-zone.sql 로 따로 합니다.
--
--   하는 일
--     1. 구역 '미래'(이름 미래채움존, 비공개) 추가
--     2. 번호 규칙(public.booths_before_write): 구역 '미래' 만 코드를 미래1 ~ 미래9 로
--        (다른 구역의 규칙은 한 글자도 바꾸지 않습니다)
--     3. 23:00 초기화(private.rehearsal_live_reset): 지금 84곳에 구역 '미래' 를 더함
--        (예약 일정 'booth-rehearsal-reset' 은 그대로. 함수 안의 대상만 늘어납니다)
--     4. 부스 9곳 추가(비공개, 고정 UUID, 학교급 없음 — org_type '기관')
--
--   건드리지 않는 것
--     기존 부스 84곳의 어떤 줄도 고치지 않습니다(INSERT 만 합니다). UUID · 번호 · QR · PIN · 상태 그대로.
--     private.rehearsal_booth_ids()(84곳 목록)도 그대로라, 리허설 채우기 · 비우기 · 공통 PIN 대상은 바뀌지 않습니다.
--     새 9곳은 공통 PIN 을 쓸 수 없고 부스별 PIN 또는 QR 로만 들어옵니다.
--
--   번호와 고유 ID
--     표시 번호는 code('미래1'), 고유 ID 는 id(UUID)로 따로입니다. no 는 구역 안 순번(1~9)이라
--     고등 1번과 미래 1번이 함께 있어도 됩니다(UNIQUE 는 zone_key + no). 로그인 · QR · 상태 저장은
--     모두 UUID 로 찾으므로 번호가 겹쳐도 다른 부스를 건드리지 않습니다.
--
-- 사용법: 먼저 supabase/check-booth-future-zone.sql 을 돌려 STOP 이 없는지 본 뒤,
--         SQL Editor → 전체 붙여넣고 Run. 두 번 실행해도 같습니다(이미 있으면 건너뜀).
--         하나라도 맞지 않으면 처음부터 되돌리고 멈춥니다(한 트랜잭션).
-- 되돌리기: supabase/rollback-booth-future-zone.sql
-- ===================================================================

begin;

-- 0. 시작 조건 — 예상과 다르면 아무것도 바꾸지 않고 멈춥니다
do $check$
declare
  v_trig  text := md5(replace((select prosrc from pg_proc where oid = 'public.booths_before_write()'::regprocedure), chr(13), ''));
  v_reset text := md5(replace((select prosrc from pg_proc where oid = 'private.rehearsal_live_reset()'::regprocedure), chr(13), ''));
  v_school integer;
  v_dup integer;
begin
  -- 처음 실행이면 2026-11-04 Production 의 정의여야 합니다. 다시 실행이면 이 파일이 쓴 정의입니다.
  if v_trig <> '7cc3adfefbf22bf5993705352903ea1f' and not exists (
    select 1 from pg_proc where oid = 'public.booths_before_write()'::regprocedure and prosrc like '%미래채움존 번호%') then
    raise exception 'booths_before_write 가 예상한 정의와 다릅니다(md5 %). 멈춥니다.', v_trig;
  end if;
  if v_reset <> 'ddfca11ab8541f58ac5cc015a13fbb61' and not exists (
    select 1 from pg_proc where oid = 'private.rehearsal_live_reset()'::regprocedure and prosrc like '%미래채움존 포함%') then
    raise exception 'rehearsal_live_reset 이 예상한 정의와 다릅니다(md5 %). 멈춥니다.', v_reset;
  end if;
  select count(*) into v_school from public.booths b
   where b.zone_key in ('초등', '중등', '고등', '특수') and b.org !~ '^\s*\[예시\]';
  if v_school <> 84 then
    raise exception '학교 부스가 84곳이 아닙니다(%곳). 멈춥니다.', v_school;
  end if;
  -- 같은 이름의 부스가 다른 구역에 이미 있으면 겹쳐 만들지 않습니다
  select count(*) into v_dup from public.booths b
   where coalesce(b.zone_key, '') <> '미래'
     and b.name in ('AI 로봇 플레이존', '채울샘 SW체험존', '상상ON! 자율주행 드라이빙 스쿨',
                    '재미를 잇다, 상상을 잇다! (잇다풋볼 & 잇다오락실)', 'touch. play. ai', 'AI 상상 공작소',
                    '인천 바다 아케이드 대 탐험', '아이온과 함께 하는 로봇 배틀 아레나', 'AIㆍSW와 만나는 미래 융합 탐험대');
  if v_dup <> 0 then
    raise exception '같은 이름의 부스가 다른 구역에 %곳 있습니다. 멈춥니다.', v_dup;
  end if;
end
$check$;

-- 1. 구역(비공개). 공개 순서는 학교급 뒤(sort_order 5)
insert into public.zones (key, label, sub, range_from, range_to, tint, solid, deep, sort_order, is_published)
values ('미래', '미래채움존', '2026 미래채움존 · 부스번호 미래1~미래9', 1, 9, '#D7E6FF', '#2563C9', '#17458F', 5, false)
on conflict (key) do nothing;

-- 2. 번호 규칙 — 구역 '미래' 한 줄만 더합니다
create or replace function public.booths_before_write()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
    DECLARE v_opening boolean;
    BEGIN
      new.code := CASE
        WHEN new.zone_key IN ('초등','중등','고등','특수') AND new.no IS NOT NULL
          THEN new.no::text
        -- 미래채움존 번호: 표시 번호는 미래1 ~ 미래9
        WHEN new.zone_key = '미래' AND new.no IS NOT NULL
          THEN '미래' || new.no::text
        WHEN new.zone_key IS NOT NULL AND new.no IS NOT NULL
          THEN new.zone_key || '-' || lpad(new.no::text, greatest(2,length(new.no::text)), '0')
        ELSE ''
      END;
      IF tg_op='INSERT' THEN
        v_opening := coalesce(new.is_published,false);
      ELSE
        v_opening := coalesce(new.is_published,false) AND NOT coalesce(old.is_published,false);
      END IF;
      IF new.zone_key IS NULL OR new.no IS NULL THEN
        IF v_opening THEN
          RAISE EXCEPTION '구역과 부스 번호를 먼저 지정해 주세요.'
            USING errcode='23514', hint='booth_publish_needs_slot';
        END IF;
        new.is_published := false;
      ELSIF v_opening AND NOT EXISTS (
        SELECT 1 FROM public.zones z WHERE z.key=new.zone_key AND z.is_published
      ) THEN
        RAISE EXCEPTION '현재 구역이 비공개 상태입니다. 구역을 먼저 공개해 주세요.'
          USING errcode='23514', hint='booth_publish_zone_hidden';
      END IF;
      RETURN new;
    END;
    $function$;

-- 3. 23:00 초기화 — 지운 줄은 당일 상태(booth_live)뿐이고, 운영 방식(booth_live_mode)은 그대로입니다
create or replace function private.rehearsal_live_reset()
 returns integer
 language plpgsql
 set search_path to ''
as $function$
declare
  n integer;
begin
  -- 미래채움존 포함: 84곳 목록 + 구역 '미래'
  delete from public.booth_live as l
   where l.booth_id = any (private.rehearsal_booth_ids())
      or l.booth_id in (select b.id from public.booths as b where b.zone_key = '미래');
  get diagnostics n = row_count;
  return n;
end;
$function$;
revoke all on function private.rehearsal_live_reset() from public;

-- 4. 부스 9곳(비공개). 이름 · 기관은 공식 명단 그대로. 트리거가 code 를 미래1 ~ 미래9 로 채웁니다
insert into public.booths (id, no, zone_key, name, org, org_type, sort_order, is_published, preview_listed)
values
  ('ce80c576-8818-5d33-b64b-d07393f6532e', 1, '미래', 'AI 로봇 플레이존', '에듀플라이플라이교육협동조합', '기관', 1101, false, false),
  ('ecb9a627-8808-5e5c-97b1-2c6c7cdce9d8', 2, '미래', '채울샘 SW체험존', '채울샘 협동조합', '기관', 1102, false, false),
  ('ae4fd488-da07-567e-a639-abdb7c7886ab', 3, '미래', '상상ON! 자율주행 드라이빙 스쿨', '허니소프트협동조합', '기관', 1103, false, false),
  ('705313b2-b933-56c3-82db-5952f86e4464', 4, '미래', '재미를 잇다, 상상을 잇다! (잇다풋볼 & 잇다오락실)', '잇다에듀 협동조합', '기관', 1104, false, false),
  ('59ac3987-0b3c-5003-b9f6-049f59bd002b', 5, '미래', 'touch. play. ai', '코딩랩스 협동조합', '기관', 1105, false, false),
  ('37933efc-09ae-566b-8513-68b1971c1513', 6, '미래', 'AI 상상 공작소', '누구나코딩교육협동조합', '기관', 1106, false, false),
  ('2f0b0930-842e-5934-bb10-864c9a6074c6', 7, '미래', '인천 바다 아케이드 대 탐험', '미래채움교육협동조합', '기관', 1107, false, false),
  ('fcd56dd0-51b5-5ad1-b717-440b721a6633', 8, '미래', '아이온과 함께 하는 로봇 배틀 아레나', '그린플래그 교육협동조합', '기관', 1108, false, false),
  ('bc46c554-738d-5283-b393-c20f2dd395d9', 9, '미래', 'AIㆍSW와 만나는 미래 융합 탐험대', '비트상상협동조합', '기관', 1109, false, false)
on conflict (zone_key, no) do nothing;

-- 5. 결과가 맞지 않으면 전부 되돌립니다
do $verify$
declare
  v_n integer;
begin
  select count(*) into v_n from public.booths b where b.zone_key = '미래' and b.code = '미래' || b.no::text and b.no between 1 and 9;
  if v_n <> 9 then
    raise exception '미래채움존 부스가 9곳이 아닙니다(%곳). 되돌립니다.', v_n;
  end if;
end
$verify$;

commit;

-- 확인(기대 = 실제)
select v."순서", v."항목", v."기대", v."실제"
  from (values
    (1, '학교 부스', '84', (select count(*) from public.booths where zone_key in ('초등','중등','고등','특수') and org !~ '^\s*\[예시\]')::text),
    (2, '미래채움존 부스', '9', (select count(*) from public.booths where zone_key = '미래')::text),
    (3, '미래채움존 번호', '미래1,미래2,미래3,미래4,미래5,미래6,미래7,미래8,미래9', (select string_agg(code, ',' order by no) from public.booths where zone_key = '미래')),
    (4, '구역 공개', 'false', (select is_published from public.zones where key = '미래')::text),
    (5, '공개된 미래채움존 부스(이미 공개했다면 9)', '0', (select count(*) from public.booths where zone_key = '미래' and is_published)::text)
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";
