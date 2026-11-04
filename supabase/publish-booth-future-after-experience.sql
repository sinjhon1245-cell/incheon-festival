-- 미래채움존 9곳만 공개(96 → 105). 실행 전 QR/PIN 9/9 발급과 실물 확인.
-- 기존 체험존/학교는 UPDATE 하지 않습니다. 오류 시 전체 트랜잭션 롤백.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $guard$
declare v_n int; v_qr int; v_pin int; v_total int; v_school int; v_exp int;
begin
 select count(*) into v_n from public.booths where zone_key='미래';
 select count(*) into v_school from public.booths where zone_key in ('초등','중등','고등','특수') and is_published;
 select count(*) into v_exp from public.booths where zone_key='체험' and is_published;
 select count(*) into v_total from public.booths where is_published;
 if v_n<>9 or v_school<>84 or v_exp<>12 or v_total<>96
    or exists(select 1 from public.booths where zone_key='미래' and is_published)
    or coalesce((select is_published from public.zones where key='미래'),true) then
    raise exception '공개 사전 조건 불일치(미래 %, 학교 %, 체험 %, 공개 전체 %). 중단.',v_n,v_school,v_exp,v_total;
 end if;
 select count(distinct a.booth_id) into v_qr from public.booth_access a
   join public.booths b on b.id=a.booth_id
   where b.zone_key='미래' and a.disabled_at is null;
 select count(distinct p.booth_id) into v_pin from public.booth_pin p
   join public.booths b on b.id=p.booth_id
   where b.zone_key='미래' and p.disabled_at is null;
 if v_qr<>9 or v_pin<>9 then
   raise exception '미래채움존 QR %/9, PIN %/9. 미발급 부스가 있으므로 공개 중단.',v_qr,v_pin;
 end if;
end
$guard$;

update public.zones set is_published=true where key='미래' and not is_published;
update public.booths set is_published=true where zone_key='미래' and not is_published;

do $verify$
begin
 if (select count(*) from public.booths where is_published)<>105
   or (select count(*) from public.booths where zone_key='미래' and is_published)<>9
   or (select count(*) from public.booths where zone_key='체험' and is_published)<>12 then
   raise exception '105곳 공개 확인 실패. 롤백.';
 end if;
end
$verify$;
commit;
-- 성공 후 check-booth-105.sql과 Production 105곳·6개 탭 재확인.
