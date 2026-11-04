-- 읽기 전용: 학교84 + 체험12 + 미래9 점검. QR/PIN 원문 출력 금지.
-- 실행 시점: (1) 등록 전 96, (2) 비공개 등록 후 96, (3) 공개 후 105.
-- 기준 지문은 2026-11-04 공식 96곳 Production에서 수집.
with school as (
 select b.* from public.booths b where b.zone_key in ('초등','중등','고등','특수') and b.is_published
), exp as (
 select b.* from public.booths b where b.zone_key='체험'
), future as (
 select b.* from public.booths b where b.zone_key='미래'
), v(n, item, actual, expected, verdict) as (
 select 1,'학교 공개',count(*)::text,'84',case when count(*)=84 then 'OK' else 'STOP' end from school
 union all
 select 2,'체험 공개',count(*) filter(where is_published)::text,'12',
   case when count(*)=12 and count(*) filter(where is_published)=12 then 'OK' else 'STOP' end from exp
 union all
 select 3,'미래 등록',count(*)::text,'등록 전 0, 등록 후 9',case when count(*) in (0,9) then 'OK' else 'STOP' end from future
 union all
 select 4,'미래 번호',coalesce(string_agg(code,',' order by no),'없음'),'미래1~미래9',
   case when count(*)=0 or (count(*)=9 and string_agg(code,',' order by no)='미래1,미래2,미래3,미래4,미래5,미래6,미래7,미래8,미래9') then 'OK' else 'STOP' end from future
 union all
 select 5,'학교 지문',md5(string_agg(id::text||'|'||code||'|'||zone_key||'|'||name||'|'||coalesce(org,''),E'\n' order by id)),
  '06e0cecb38136960b0f65f187b0f4c12',
  case when md5(string_agg(id::text||'|'||code||'|'||zone_key||'|'||name||'|'||coalesce(org,''),E'\n' order by id))='06e0cecb38136960b0f65f187b0f4c12' then 'OK' else 'STOP' end from school
 union all
 select 6,'체험 지문',md5(string_agg(id::text||'|'||code||'|'||zone_key||'|'||name||'|'||coalesce(org,''),E'\n' order by id)),
  '63bace0fa5646d00b6b588998be8d528',
  case when md5(string_agg(id::text||'|'||code||'|'||zone_key||'|'||name||'|'||coalesce(org,''),E'\n' order by id))='63bace0fa5646d00b6b588998be8d528' then 'OK' else 'STOP' end from exp
 union all
 select 7,'공개 전체',count(*)::text,'미래 등록 전/비공개 후 96, 공개 후 105',
   case when count(*) in (96,105) then 'OK' else 'STOP' end
   from public.booths where is_published
 union all
 select 8,'미래 공개',count(*) filter(where is_published)::text,'비공개 0, 공개 후 9',
   case when count(*) filter(where is_published) in (0,9) then 'OK' else 'STOP' end from future
 union all
 select 9,'미래 QR(활성)',count(distinct a.booth_id)::text||'/9','공개 전 9/9',
   case when (select count(*) from future)=0 or count(distinct a.booth_id)=9 then 'OK' else 'PENDING' end
   from future f left join public.booth_access a on a.booth_id=f.id and a.disabled_at is null
 union all
 select 10,'미래 PIN(활성)',count(distinct p.booth_id)::text||'/9','공개 전 9/9',
   case when (select count(*) from future)=0 or count(distinct p.booth_id)=9 then 'OK' else 'PENDING' end
   from future f left join public.booth_pin p on p.booth_id=f.id and p.disabled_at is null
 union all
 select 11,'미래 구역',coalesce((select case when is_published then '공개' else '비공개' end from public.zones where key='미래'),'없음'),
  '등록 전 없음, 비공개 후 비공개, 공개 후 공개','보기'
 union all
 select 12,'체험/미래 번호 함수',case when (select prosrc from pg_proc where oid='public.booths_before_write()'::regprocedure) like '%''체험''%' and (select count(*) from future)=0 then '체험 지원 · 미래 미등록'
      when (select prosrc from pg_proc where oid='public.booths_before_write()'::regprocedure) like '%''미래''%' and (select prosrc from pg_proc where oid='public.booths_before_write()'::regprocedure) like '%''체험''%' then '체험·미래 지원'
      else '검토 필요' end,'등록 후 체험·미래 지원','보기'
 union all
 select 13,'23시 초기화 함수',case when (select prosrc from pg_proc where oid='private.rehearsal_live_reset()'::regprocedure) like '%''미래''%' and (select prosrc from pg_proc where oid='private.rehearsal_live_reset()'::regprocedure) like '%''체험''%' then '84+체험+미래' else '미래 추가 전' end,
 '등록 후 84+체험+미래','보기'
 union all
 select 14,'23시 초기화 예약',coalesce((select jobname||' '||schedule||' active='||active from cron.job where jobname='booth-rehearsal-reset' limit 1),'없음'),
 'booth-rehearsal-reset 0 14 * * * active=true','보기'
)
select n as "번호",item as "항목",actual as "현재",expected as "기대",verdict as "판정" from v order by n;

-- 미래채움존 명단 9곳 정확 비교(등록 전에는 결과 없음).
with expected(no,org,name) as (
 values
 (1,'에듀플라이교육협동조합','AI 로봇 플레이존'),
 (2,'채울샘 협동조합','채울샘 SW체험존'),
 (3,'허니소프트협동조합','상상ON! 자율주행 드라이빙 스쿨'),
 (4,'잇다에듀 협동조합','재미를 잇다, 상상을 잇다! (잇다풋볼 & 잇다오락실)'),
 (5,'코딩랩스 협동조합','touch. play. Ai'),
 (6,'누구나코딩교육협동조합','AI 상상 공작소'),
 (7,'미래채움교육협동조합','인천 바다 아케이드 대 탐험'),
 (8,'그린플래그 교육협동조합','아이온과 함께 하는 로봇 배틀 아레나'),
 (9,'비트상상협동조합','AI · SW와 만나는 미래 융합 탐험대')
)
select '미래'||e.no as "번호", b.org as "실제 운영기관",b.name as "실제 프로그램",
 case when b.no is null then '미등록' when b.org=e.org and b.name=e.name and b.code='미래'||e.no::text then 'OK' else 'STOP' end as "판정"
from expected e left join public.booths b on b.zone_key='미래' and b.no=e.no order by e.no;
