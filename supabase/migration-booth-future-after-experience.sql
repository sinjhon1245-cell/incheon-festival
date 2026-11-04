-- 미래채움존 9곳: 체험존 12곳이 이미 운영 중인 Production(96곳) 전용
-- 출처: 2026-11-04 사용자가 공유한 미래채움존 순번·운영기관·프로그램명 이미지
-- 절대 PR #66의 migration-booth-future-zone.sql과 혼용하지 마세요.
-- 실행 전후 check-booth-105.sql 확인. QR/PIN 발급 전까지 미래 9곳은 비공개.
-- 함수 변경은 현재 96곳의 번호 규칙/초기화를 보존한 채 미래 9곳만 추가합니다.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $guard$
declare
  v_trig text;
  v_reset text;
  v_school integer;
  v_exp integer;
  v_published integer;
  v_school_hash text;
  v_exp_hash text;
begin
  select md5(replace(prosrc,chr(13),'')) into v_trig
    from pg_proc where oid='public.booths_before_write()'::regprocedure;
  select md5(replace(prosrc,chr(13),'')) into v_reset
    from pg_proc where oid='private.rehearsal_live_reset()'::regprocedure;
  if v_trig <> '4412167746be88a9b52251eb9741abd0'
     or v_reset <> 'b201023f5f8602f6b1fb3fb28f0dc8c3' then
    raise exception '현재 함수가 검증한 96곳 버전과 다릅니다(트리거 %, 초기화 %). 중단.',v_trig,v_reset;
  end if;
  select count(*) into v_school from public.booths
   where zone_key in ('초등','중등','고등','특수') and is_published;
  select count(*) into v_exp from public.booths
   where zone_key='체험' and is_published;
  select count(*) into v_published from public.booths where is_published;
  if v_school<>84 or v_exp<>12 or v_published<>96 then
    raise exception '공개 부스 시작 조건 불일치(학교 %, 체험 %, 전체 %). 중단.',v_school,v_exp,v_published;
  end if;
  if (select count(*) from public.booths where zone_key='체험')<>12
     or exists(select 1 from public.zones where key='미래')
     or exists(select 1 from public.booths where zone_key='미래') then
    raise exception '체험존 수 또는 미래채움존 사전 등록 상태가 예상과 다릅니다. 중단.';
  end if;
  select md5(string_agg(id::text||'|'||code||'|'||zone_key||'|'||name||'|'||coalesce(org,''),E'\n' order by id))
    into v_school_hash from public.booths
   where zone_key in ('초등','중등','고등','특수') and is_published;
  select md5(string_agg(id::text||'|'||code||'|'||zone_key||'|'||name||'|'||coalesce(org,''),E'\n' order by id))
    into v_exp_hash from public.booths where zone_key='체험';
  if v_school_hash<>'06e0cecb38136960b0f65f187b0f4c12'
     or v_exp_hash<>'63bace0fa5646d00b6b588998be8d528' then
    raise exception '학교/체험 기본정보 지문이 기준과 다릅니다. 중단.';
  end if;
end
$guard$;

-- 체험존 구역(정렬 5)은 그대로, 미래채움존은 별도 구역(정렬 6).
-- 관람객 화면은 코드에서 미래채움존 → 체험존 순서로 표시합니다.
insert into public.zones (key,label,sub,range_from,range_to,tint,solid,deep,sort_order,is_published)
values ('미래','미래채움존','2026 미래채움존 · 미래1~미래9',1,9,'#D7E6FF','#2563C9','#17458F',6,false);

-- 기존 학교 84곳 + 체험 12곳 번호 규칙을 그대로 유지하면서 미래1~미래9 추가
create or replace function public.booths_before_write()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
  declare v_opening boolean;
  begin
    new.code := case
      when new.zone_key in ('초등','중등','고등','특수') and new.no is not null then new.no::text
      when new.zone_key = '체험' and new.no is not null then '체험'||new.no::text
      when new.zone_key = '미래' and new.no is not null then '미래'||new.no::text
      when new.zone_key is not null and new.no is not null
        then new.zone_key||'-'||lpad(new.no::text,greatest(2,length(new.no::text)),'0')
      else ''
    end;
    if tg_op='INSERT' then
      v_opening := coalesce(new.is_published,false);
    else
      v_opening := coalesce(new.is_published,false) and not coalesce(old.is_published,false);
    end if;
    if new.zone_key is null or new.no is null then
      if v_opening then
        raise exception '구역과 부스 번호를 먼저 지정해 주세요.'
          using errcode='23514',hint='booth_publish_needs_slot';
      end if;
      new.is_published := false;
    elsif v_opening and not exists (
      select 1 from public.zones z where z.key=new.zone_key and z.is_published
    ) then
      raise exception '현재 구역이 비공개 상태입니다. 구역을 먼저 공개해 주세요.'
        using errcode='23514',hint='booth_publish_zone_hidden';
    end if;
    return new;
  end;
$function$;

-- 기존 학교 84곳 + 체험 12곳 + 미래 9곳: 당일 대기 상태만 삭제.
-- 운영 방식, QR, PIN, 예약 일정, 이력 테이블은 건드리지 않습니다.
create or replace function private.rehearsal_live_reset()
 returns integer
 language plpgsql
 set search_path to ''
as $function$
declare n integer;
begin
  delete from public.booth_live as l
   where l.booth_id = any(private.rehearsal_booth_ids())
      or l.booth_id in (
        select b.id from public.booths as b where b.zone_key in ('체험','미래')
      );
  get diagnostics n = row_count;
  return n;
end;
$function$;
revoke all on function private.rehearsal_live_reset() from public;

-- 공식 이미지 순서 및 명칭 그대로. 운영 DB 기존 부스 UPDATE 없음.
insert into public.booths
 (id,no,zone_key,name,org,org_type,sort_order,is_published,preview_listed)
values
 ('ce80c576-8818-5d33-b64b-d07393f6532e',1,'미래','AI 로봇 플레이존','에듀플라이교육협동조합','기관',1101,false,false),
 ('ecb9a627-8808-5e5c-97b1-2c6c7cdce9d8',2,'미래','채울샘 SW체험존','채울샘 협동조합','기관',1102,false,false),
 ('ae4fd488-da07-567e-a639-abdb7c7886ab',3,'미래','상상ON! 자율주행 드라이빙 스쿨','허니소프트협동조합','기관',1103,false,false),
 ('705313b2-b933-56c3-82db-5952f86e4464',4,'미래','재미를 잇다, 상상을 잇다! (잇다풋볼 & 잇다오락실)','잇다에듀 협동조합','기관',1104,false,false),
 ('59ac3987-0b3c-5003-b9f6-049f59bd002b',5,'미래','touch. play. Ai','코딩랩스 협동조합','기관',1105,false,false),
 ('37933efc-09ae-566b-8513-68b1971c1513',6,'미래','AI 상상 공작소','누구나코딩교육협동조합','기관',1106,false,false),
 ('2f0b0930-842e-5934-bb10-864c9a6074c6',7,'미래','인천 바다 아케이드 대 탐험','미래채움교육협동조합','기관',1107,false,false),
 ('fcd56dd0-51b5-5ad1-b717-440b721a6633',8,'미래','아이온과 함께 하는 로봇 배틀 아레나','그린플래그 교육협동조합','기관',1108,false,false),
 ('bc46c554-738d-5283-b393-c20f2dd395d9',9,'미래','AI · SW와 만나는 미래 융합 탐험대','비트상상협동조합','기관',1109,false,false);

do $verify$
declare v_school integer; v_exp integer; v_future integer; v_all integer; v_bad integer;
begin
  select count(*) into v_school from public.booths where zone_key in ('초등','중등','고등','특수') and is_published;
  select count(*) into v_exp from public.booths where zone_key='체험' and is_published;
  select count(*) into v_future from public.booths where zone_key='미래' and not is_published
     and code='미래'||no::text and no between 1 and 9 and org_type='기관';
  select count(*) into v_all from public.booths where is_published;
  if v_school<>84 or v_exp<>12 or v_future<>9 or v_all<>96
      or (select is_published from public.zones where key='미래') then
    raise exception '미래채움 등록 후 검증 실패(학교 %, 체험 %, 미래 비공개 %, 공개 전체 %). 롤백.',v_school,v_exp,v_future,v_all;
  end if;
  select count(*) into v_bad from public.booths where zone_key='미래'
    and (no not between 1 and 9 or code<>'미래'||no::text);
  if v_bad<>0 then raise exception '미래채움 번호 검증 실패. 롤백.'; end if;
end
$verify$;
commit;

-- 이후 별도 read-only 점검, 9곳 QR/PIN 발급, publish-booth-future-after-experience.sql 순서.
