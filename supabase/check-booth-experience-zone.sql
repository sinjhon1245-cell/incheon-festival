-- ===================================================================
-- 체험존 점검(읽기 전용) — 아무것도 바꾸지 않습니다
--
-- 등록 전 · 등록 뒤 · 공개 뒤에 돌려 표를 견줍니다. 판정이 STOP 이면 다음 단계로 가지 않습니다.
--   '학교 84곳 지문' 은 UUID · 번호 · 코드 · 구역 · 이름 · 기관을 합친 값입니다. 세 번 모두 같아야 합니다.
--   (2026-11-04 Production: 1093259944fc7b9bca144de6214f5301. 관리자가 이름을 고쳤다면 달라질 수 있습니다.)
--   'QR 열쇠 지문' 은 84곳 열쇠의 해시만 합친 값으로, 열쇠 값은 보이지 않습니다. 세 번 모두 같아야 합니다.
--
-- 이 표에는 PIN · QR 열쇠 원문이 나오지 않습니다.
-- ===================================================================

with school as (
  select b.* from public.booths b
   where b.zone_key in ('초등', '중등', '고등', '특수') and b.org !~ '^\s*\[예시\]'
), exp as (
  select b.*, to_jsonb(b) ->> 'booth_type' as kind from public.booths b where b.zone_key = '체험'
), v(n, item, val, want, verdict) as (
  select 1, '학교 부스', count(*)::text, '84', case when count(*) = 84 then 'OK' else 'STOP' end from school
  union all
  select 2, '학교 84곳 지문',
         md5(string_agg(s.id::text || '|' || coalesce(s.no::text, '') || '|' || s.code || '|' || coalesce(s.zone_key, '') || '|' || s.name || '|' || s.org, E'\n' order by s.id)),
         '세 번 모두 같음', '비교' from school s
  union all
  select 3, 'QR 열쇠 지문(84곳)', md5(string_agg(md5(a.token) || coalesce(a.rotated_at::text, ''), E'\n' order by a.booth_id)),
         '세 번 모두 같음', '비교'
    from public.booth_access a join school s on s.id = a.booth_id
  union all
  select 4, 'PIN 상태 지문(84곳)', md5(string_agg(p.booth_id::text || coalesce(p.reissued_at::text, '') || coalesce(p.disabled_at::text, ''), E'\n' order by p.booth_id)),
         '세 번 모두 같음', '비교'
    from public.booth_pin p join school s on s.id = p.booth_id
  union all
  select 5, '23:00 예약', string_agg(jobname || ' ' || schedule || ' active=' || active, ' '), 'booth-rehearsal-reset 0 14 * * * active=true',
         case when string_agg(jobname || ' ' || schedule || ' active=' || active, ' ') = 'booth-rehearsal-reset 0 14 * * * active=true' then 'OK' else 'STOP' end
    from cron.job
  union all
  select 6, '번호 규칙', case when (select prosrc from pg_proc where oid = 'public.booths_before_write()'::regprocedure) like '%체험존 번호%' then '적용됨' else '적용 전' end,
         '등록 뒤 적용됨', '보기'
  union all
  select 7, '23:00 초기화 대상', case when (select prosrc from pg_proc where oid = 'private.rehearsal_live_reset()'::regprocedure) like '%체험존 포함%' then '체험존 포함' else '84곳만' end,
         '등록 뒤 체험존 포함', '보기'
  union all
  select 8, '구역 체험', coalesce((select case when is_published then '공개' else '비공개' end from public.zones where key = '체험'), '없음'),
         '등록 전 없음 · 등록 뒤 비공개 · 공개 뒤 공개', '보기'
  union all
  select 9, '체험존 부스', count(*)::text, '등록 전 0 · 뒤 12', case when count(*) in (0, 12) then 'OK' else 'STOP' end from exp
  union all
  select 10, '체험존 번호', coalesce(string_agg(code, ',' order by no), '없음'), '체험1 ~ 체험12',
         case when count(*) = 0 or string_agg(code, ',' order by no) = '체험1,체험2,체험3,체험4,체험5,체험6,체험7,체험8,체험9,체험10,체험11,체험12' then 'OK' else 'STOP' end from exp
  union all
  select 11, '체험존 공개', count(*) filter (where is_published)::text || ' / ' || count(*)::text, '등록 뒤 0 · 공개 뒤 12', '보기' from exp
  union all
  select 12, '체험존 QR', count(a.booth_id)::text || ' / ' || count(*)::text, '공개 전 12 / 12', '보기'
    from exp f left join public.booth_access a on a.booth_id = f.id and a.disabled_at is null
  union all
  select 13, '체험존 PIN', count(p.booth_id)::text || ' / ' || count(*)::text, '공개 전 12 / 12', '보기'
    from exp f left join public.booth_pin p on p.booth_id = f.id and p.disabled_at is null
  union all
  select 14, '같은 이름 겹침(다른 구역)', count(*)::text, '0', case when count(*) = 0 then 'OK' else 'STOP' end
    from public.booths b
   where coalesce(b.zone_key, '') <> '체험'
     and b.name in ('카미봇 미션 레이싱 챌린지', '나만의 앨범만들기', '나도 될 수 있다, 케이팝 아이돌',
                    '경찰과 도둑', '나는야 아케이드 게임제작자', 'AI 동화책 작가 되기',
                    '스마트 모빌리티의 기초 : 엠봇으로 배우는 로봇제어', '나만의 필터 카메라앱 만들기', '내가 만드는 AR 방탈출 - 장면전환과 코딩의마법',
                    '돌려라! 맞춰라! AI Cube 코딩챌린지', '알티노로 배우는 AI 음성인식 자율주행 모빌리티', 'AI와 함께 뚝딱 나만의 4컷 웹툰 만들기')
  union all
  select 15, '게임 / 교육', count(*) filter (where kind = '게임' and no between 1 and 4)::text || ' / ' || count(*) filter (where kind = '교육' and no between 5 and 12)::text,
         '등록 전 0 / 0 · 뒤 4 / 8',
         case when count(*) = 0 or (count(*) filter (where kind = '게임' and no between 1 and 4) = 4 and count(*) filter (where kind = '교육' and no between 5 and 12) = 8) then 'OK' else 'STOP' end from exp
  union all
  select 16, '구역 미래(9곳 계획)', count(*)::text, '0', case when count(*) = 0 then 'OK' else 'STOP' end from public.zones where key = '미래'
)
select n as "순서", item as "항목", val as "지금", want as "기대", verdict as "판정" from v order by n;
