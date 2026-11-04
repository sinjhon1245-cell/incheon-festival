-- ===================================================================
-- 미래채움존 점검(읽기 전용) — 아무것도 바꾸지 않습니다
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
), future as (
  select b.* from public.booths b where b.zone_key = '미래'
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
  select 6, '번호 규칙', case when (select prosrc from pg_proc where oid = 'public.booths_before_write()'::regprocedure) like '%미래채움존 번호%' then '적용됨' else '적용 전' end,
         '등록 뒤 적용됨', '보기'
  union all
  select 7, '23:00 초기화 대상', case when (select prosrc from pg_proc where oid = 'private.rehearsal_live_reset()'::regprocedure) like '%미래채움존 포함%' then '미래채움존 포함' else '84곳만' end,
         '등록 뒤 미래채움존 포함', '보기'
  union all
  select 8, '구역 미래', coalesce((select case when is_published then '공개' else '비공개' end from public.zones where key = '미래'), '없음'),
         '등록 전 없음 · 등록 뒤 비공개 · 공개 뒤 공개', '보기'
  union all
  select 9, '미래채움존 부스', count(*)::text, '등록 전 0 · 뒤 9', case when count(*) in (0, 9) then 'OK' else 'STOP' end from future
  union all
  select 10, '미래채움존 번호', coalesce(string_agg(code, ',' order by no), '없음'), '미래1 ~ 미래9',
         case when count(*) = 0 or string_agg(code, ',' order by no) = '미래1,미래2,미래3,미래4,미래5,미래6,미래7,미래8,미래9' then 'OK' else 'STOP' end from future
  union all
  select 11, '미래채움존 공개', count(*) filter (where is_published)::text || ' / ' || count(*)::text, '등록 뒤 0 · 공개 뒤 9', '보기' from future
  union all
  select 12, '미래채움존 QR', count(a.booth_id)::text || ' / ' || count(*)::text, '공개 전 9 / 9', '보기'
    from future f left join public.booth_access a on a.booth_id = f.id and a.disabled_at is null
  union all
  select 13, '미래채움존 PIN', count(p.booth_id)::text || ' / ' || count(*)::text, '공개 전 9 / 9', '보기'
    from future f left join public.booth_pin p on p.booth_id = f.id and p.disabled_at is null
  union all
  select 14, '같은 이름 겹침(다른 구역)', count(*)::text, '0', case when count(*) = 0 then 'OK' else 'STOP' end
    from public.booths b
   where coalesce(b.zone_key, '') <> '미래'
     and b.name in ('AI 로봇 플레이존', '채울샘 SW체험존', '상상ON! 자율주행 드라이빙 스쿨',
                    '재미를 잇다, 상상을 잇다! (잇다풋볼 & 잇다오락실)', 'touch. play. ai', 'AI 상상 공작소',
                    '인천 바다 아케이드 대 탐험', '아이온과 함께 하는 로봇 배틀 아레나', 'AIㆍSW와 만나는 미래 융합 탐험대')
)
select n as "순서", item as "항목", val as "지금", want as "기대", verdict as "판정" from v order by n;
