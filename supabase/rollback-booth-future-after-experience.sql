-- 미래채움존만 비공개로 되돌림(105 → 96). 체험존12/학교84/QR/PIN/이력 보존.
-- 의도적인 삭제/함수 롤백을 포함하지 않습니다.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $guard$
begin
 if (select count(*) from public.booths where zone_key='미래')<>9
   or (select count(*) from public.booths where zone_key='체험' and is_published)<>12
   or (select count(*) from public.booths where zone_key in ('초등','중등','고등','특수') and is_published)<>84 then
   raise exception '부스 수가 예상과 달라 미래채움존 숨기기를 중단합니다.';
 end if;
end
$guard$;

update public.booths set is_published=false where zone_key='미래' and is_published;
update public.zones set is_published=false where key='미래' and is_published;

do $verify$
begin
 if (select count(*) from public.booths where is_published)<>96
   or (select count(*) from public.booths where zone_key='체험' and is_published)<>12
   or (select count(*) from public.booths where zone_key='미래')<>9 then
  raise exception '96곳 복귀 확인 실패. 롤백.';
 end if;
end
$verify$;
commit;
-- 재공개할 때는 기존 미래 9곳의 활성 QR/PIN을 확인하고 publish SQL을 사용합니다.
