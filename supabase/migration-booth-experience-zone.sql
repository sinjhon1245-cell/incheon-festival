-- ===================================================================
-- 체험존 12곳 등록(비공개) — 구역 · 유형 칸 · 번호 규칙 · 23:00 초기화 · 부스
--
-- 보류 중입니다. 12곳이 각각 독립적으로 대기 시간을 관리하는 단위로 확정되기 전에는 실행하지 않습니다.
--   확정되면 아래 '0. 시작 조건' 의 v_confirmed 를 true 로 바꾼 뒤 실행합니다.
--   바꾸지 않고 실행하면 아무것도 바꾸지 않고 멈춥니다.
--
-- 이 파일은 부스를 '비공개' 로 넣습니다. 관람객 화면에는 아직 나타나지 않습니다.
-- 공개는 QR · PIN 을 발급한 뒤 supabase/publish-booth-experience-zone.sql 로 따로 합니다.
--
--   하는 일
--     1. 칸 booths.booth_type 추가('게임' · '교육' 또는 비움). 비어 있는 칸이라 기존 줄을 다시 쓰지 않습니다
--     2. 구역 '체험'(이름 체험존, 비공개) 추가
--     3. 번호 규칙(public.booths_before_write): 구역 '체험' 만 코드를 체험1 ~ 체험12 로
--        (다른 구역의 규칙은 한 글자도 바꾸지 않습니다)
--     4. 23:00 초기화(private.rehearsal_live_reset): 지금 84곳에 구역 '체험' 을 더함
--        (예약 일정 'booth-rehearsal-reset' 은 그대로. 함수 안의 대상만 늘어납니다)
--     5. 부스 12곳 추가(비공개, 고정 UUID). 운영기관은 아직 받지 않아 비워 둡니다
--
--   건드리지 않는 것
--     기존 부스 84곳의 어떤 줄도 고치지 않습니다(칸 추가 · INSERT 만 합니다). UUID · 번호 · QR · PIN · 상태 그대로.
--     private.rehearsal_booth_ids()(84곳 목록)도 그대로라, 리허설 채우기 · 비우기 · 공통 PIN 대상은 바뀌지 않습니다.
--     새 12곳은 공통 PIN 을 쓸 수 없고 부스별 PIN 또는 QR 로만 들어옵니다.
--
--   번호와 고유 ID
--     표시 번호는 code('체험1'), 고유 ID 는 id(UUID)로 따로입니다. no 는 구역 안 순번(1~12)이라
--     고등 1번과 체험 1번이 함께 있어도 됩니다(UNIQUE 는 zone_key + no). 로그인 · QR · 상태 저장은
--     모두 UUID 로 찾으므로 번호가 겹쳐도 다른 부스를 건드리지 않습니다.
--
--   미래채움존 9곳
--     이 파일은 9곳 계획을 대신합니다. 구역 '미래' 가 운영 DB 에 있으면 멈춥니다(지우지 않습니다).
--
-- 사용법: 먼저 supabase/check-booth-experience-zone.sql 을 돌려 STOP 이 없는지 본 뒤,
--         SQL Editor → 전체 붙여넣고 Run. 두 번 실행해도 같습니다(이미 있으면 건너뜀).
--         하나라도 맞지 않으면 처음부터 되돌리고 멈춥니다(한 트랜잭션).
-- 되돌리기: supabase/rollback-booth-experience-zone.sql
-- ===================================================================

begin;

-- 0. 시작 조건 — 예상과 다르면 아무것도 바꾸지 않고 멈춥니다
do $check$
declare
  -- 12곳이 각각 독립 운영 단위로 확정되면 true 로 바꿉니다
  v_confirmed constant boolean := false;
  v_trig  text := md5(replace((select prosrc from pg_proc where oid = 'public.booths_before_write()'::regprocedure), chr(13), ''));
  v_reset text := md5(replace((select prosrc from pg_proc where oid = 'private.rehearsal_live_reset()'::regprocedure), chr(13), ''));
  v_school integer;
  v_dup integer;
begin
  if not v_confirmed then
    raise exception '체험존 12곳이 독립 운영 단위로 확정되지 않았습니다. 확정 뒤 v_confirmed 를 true 로 바꿔 주세요.';
  end if;
  if exists (select 1 from public.zones where key = '미래') then
    raise exception '구역 미래가 이미 있습니다. 9곳 계획과 겹치니 현황을 먼저 확인해 주세요. 멈춥니다.';
  end if;
  -- 처음 실행이면 2026-11-04 Production 의 정의여야 합니다. 다시 실행이면 이 파일이 쓴 정의입니다.
  if v_trig <> '7cc3adfefbf22bf5993705352903ea1f' and not exists (
    select 1 from pg_proc where oid = 'public.booths_before_write()'::regprocedure and prosrc like '%체험존 번호%') then
    raise exception 'booths_before_write 가 예상한 정의와 다릅니다(md5 %). 멈춥니다.', v_trig;
  end if;
  if v_reset <> 'ddfca11ab8541f58ac5cc015a13fbb61' and not exists (
    select 1 from pg_proc where oid = 'private.rehearsal_live_reset()'::regprocedure and prosrc like '%체험존 포함%') then
    raise exception 'rehearsal_live_reset 이 예상한 정의와 다릅니다(md5 %). 멈춥니다.', v_reset;
  end if;
  select count(*) into v_school from public.booths b
   where b.zone_key in ('초등', '중등', '고등', '특수') and b.org !~ '^\s*\[예시\]';
  if v_school <> 84 then
    raise exception '학교 부스가 84곳이 아닙니다(%곳). 멈춥니다.', v_school;
  end if;
  -- 같은 이름의 부스가 다른 구역에 이미 있으면 겹쳐 만들지 않습니다
  select count(*) into v_dup from public.booths b
   where coalesce(b.zone_key, '') <> '체험'
     and b.name in ('카미봇 미션 레이싱 챌린지', '나만의 앨범만들기', '나도 될 수 있다, 케이팝 아이돌',
                    '경찰과 도둑', '나는야 아케이드 게임제작자', 'AI 동화책 작가 되기',
                    '스마트 모빌리티의 기초 : 엠봇으로 배우는 로봇제어', '나만의 필터 카메라앱 만들기', '내가 만드는 AR 방탈출 - 장면전환과 코딩의마법',
                    '돌려라! 맞춰라! AI Cube 코딩챌린지', '알티노로 배우는 AI 음성인식 자율주행 모빌리티', 'AI와 함께 뚝딱 나만의 4컷 웹툰 만들기');
  if v_dup <> 0 then
    raise exception '같은 이름의 부스가 다른 구역에 %곳 있습니다. 멈춥니다.', v_dup;
  end if;
end
$check$;

-- 1. 유형 칸 — 제목 글자가 아니라 따로 둡니다. 관람객 화면의 작은 배지가 이 값을 씁니다
alter table public.booths add column if not exists booth_type text
  constraint booths_booth_type_check check (booth_type is null or booth_type = any (array['게임', '교육']));
comment on column public.booths.booth_type is '체험존 유형(게임 · 교육). 학교 부스는 비움';

-- 2. 구역(비공개). 공개 순서는 학교급 뒤(sort_order 5)
insert into public.zones (key, label, sub, range_from, range_to, tint, solid, deep, sort_order, is_published)
values ('체험', '체험존', '2026 체험존 · 부스번호 체험1~체험12', 1, 12, '#D7E6FF', '#2563C9', '#17458F', 5, false)
on conflict (key) do nothing;

-- 3. 번호 규칙 — 구역 '체험' 한 줄만 더합니다
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
        -- 체험존 번호: 표시 번호는 체험1 ~ 체험12
        WHEN new.zone_key = '체험' AND new.no IS NOT NULL
          THEN '체험' || new.no::text
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

-- 4. 23:00 초기화 — 지운 줄은 당일 상태(booth_live)뿐이고, 운영 방식(booth_live_mode)은 그대로입니다
create or replace function private.rehearsal_live_reset()
 returns integer
 language plpgsql
 set search_path to ''
as $function$
declare
  n integer;
begin
  -- 체험존 포함: 84곳 목록 + 구역 '체험'
  delete from public.booth_live as l
   where l.booth_id = any (private.rehearsal_booth_ids())
      or l.booth_id in (select b.id from public.booths as b where b.zone_key = '체험');
  get diagnostics n = row_count;
  return n;
end;
$function$;
revoke all on function private.rehearsal_live_reset() from public;

-- 5. 부스 12곳(비공개). 이름은 받은 목록 그대로, 운영기관은 비움. 트리거가 code 를 체험1 ~ 체험12 로 채웁니다
insert into public.booths (id, no, zone_key, name, org, org_type, booth_type, sort_order, is_published, preview_listed)
values
  ('7ffafa20-bd9c-5a76-a5e1-099c3d426a94', 1, '체험', '카미봇 미션 레이싱 챌린지', '', null, '게임', 1201, false, false),
  ('5e3b7a97-7b6d-579b-9892-1c981deb5807', 2, '체험', '나만의 앨범만들기', '', null, '게임', 1202, false, false),
  ('47572788-8942-5666-812f-89f6d9094019', 3, '체험', '나도 될 수 있다, 케이팝 아이돌', '', null, '게임', 1203, false, false),
  ('99da0143-d4b6-5b35-904a-60d4ac267097', 4, '체험', '경찰과 도둑', '', null, '게임', 1204, false, false),
  ('2f541a83-a95d-5239-af8e-4e48206de662', 5, '체험', '나는야 아케이드 게임제작자', '', null, '교육', 1205, false, false),
  ('1cf94685-e224-5cbf-9821-25f529bdeae5', 6, '체험', 'AI 동화책 작가 되기', '', null, '교육', 1206, false, false),
  ('22c12f3f-1b5e-5a76-9a03-ab2a6743c666', 7, '체험', '스마트 모빌리티의 기초 : 엠봇으로 배우는 로봇제어', '', null, '교육', 1207, false, false),
  ('37c449de-8e5a-53e7-90ad-d2c28a55efef', 8, '체험', '나만의 필터 카메라앱 만들기', '', null, '교육', 1208, false, false),
  ('7a80d973-a3a9-50cb-b53c-b30afc3964bc', 9, '체험', '내가 만드는 AR 방탈출 - 장면전환과 코딩의마법', '', null, '교육', 1209, false, false),
  ('56923104-d1ca-5842-afa7-892d680052c2', 10, '체험', '돌려라! 맞춰라! AI Cube 코딩챌린지', '', null, '교육', 1210, false, false),
  ('eaf1f44e-c921-5eb7-9b5f-d578c0f34794', 11, '체험', '알티노로 배우는 AI 음성인식 자율주행 모빌리티', '', null, '교육', 1211, false, false),
  ('acd33608-26ce-59db-b2ce-1c7607ad3527', 12, '체험', 'AI와 함께 뚝딱 나만의 4컷 웹툰 만들기', '', null, '교육', 1212, false, false)
on conflict (zone_key, no) do nothing;

-- 6. 결과가 맞지 않으면 전부 되돌립니다
do $verify$
declare
  v_n integer;
  v_game integer;
  v_edu integer;
begin
  select count(*), count(*) filter (where b.booth_type = '게임' and b.no between 1 and 4), count(*) filter (where b.booth_type = '교육' and b.no between 5 and 12)
    into v_n, v_game, v_edu
    from public.booths b where b.zone_key = '체험' and b.code = '체험' || b.no::text and b.no between 1 and 12;
  if v_n <> 12 or v_game <> 4 or v_edu <> 8 then
    raise exception '체험존 부스가 맞지 않습니다(전체 %곳 · 게임 %곳 · 교육 %곳). 되돌립니다.', v_n, v_game, v_edu;
  end if;
end
$verify$;

commit;

notify pgrst, 'reload schema';

-- 확인(기대 = 실제)
select v."순서", v."항목", v."기대", v."실제"
  from (values
    (1, '학교 부스', '84', (select count(*) from public.booths where zone_key in ('초등','중등','고등','특수') and org !~ '^\s*\[예시\]')::text),
    (2, '체험존 부스', '12', (select count(*) from public.booths where zone_key = '체험')::text),
    (3, '체험존 번호', '체험1,체험2,체험3,체험4,체험5,체험6,체험7,체험8,체험9,체험10,체험11,체험12', (select string_agg(code, ',' order by no) from public.booths where zone_key = '체험')),
    (4, '게임 / 교육', '4 / 8', (select count(*) filter (where booth_type = '게임') || ' / ' || count(*) filter (where booth_type = '교육') from public.booths where zone_key = '체험')),
    (5, '구역 공개', 'false', (select is_published from public.zones where key = '체험')::text),
    (6, '공개된 체험존 부스(이미 공개했다면 12)', '0', (select count(*) from public.booths where zone_key = '체험' and is_published)::text)
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";
