-- ===================================================================
-- 인쇄용 최신 PIN 조회 — 관리자가 아닌 접근 차단 확인 (아무것도 바꾸지 않습니다)
--
--   migration-booth-pin-auto-print.sql 을 적용한 뒤 SQL Editor 에서 실행합니다. 언제 몇 번 실행해도 됩니다.
--   Production 에는 관리자가 아닌 계정이 없어서, 이 SQL 이 잠깐 역할을 anon · authenticated 로 바꿔
--   public.admin_print_booth_pins 를 불러 보고 바로 되돌립니다. 어느 경우에도 PIN 숫자는 돌려받지 않습니다
--   (거절되므로 조회 기록도 남지 않습니다). 결과는 이 접속에서만 보이는 임시 표에 적고, 표 · 데이터는 바꾸지 않습니다.
--   관리자 계정이 받는지는 화면(QR · PIN 관리 ① ‘개별 PIN 함께 인쇄’)에서 봅니다 — 관리자는 따로 등록하지 않아도 됩니다.
--
--   기대: 1 · 2 · 3 모두 42501(권한 없음). 하나라도 ALLOWED 이면 그 자리에서 멈추고 화면 배포를 하지 마세요.
-- ===================================================================
create temp table if not exists booth_pin_print_access_probe (n int, who text, got text);
truncate booth_pin_print_access_probe;

do $probe$
declare
  v_ids uuid[] := array[(select b.id from public.booths b where b.code = 'A-04')];
  r     text;
begin
  -- 1. 비로그인 — anon 은 이 함수 실행 권한이 없어야 함
  begin
    set local role anon;
    perform 1 from public.admin_print_booth_pins(v_ids);
    r := 'ALLOWED';
  exception when others then r := sqlstate;
  end;
  reset role;
  insert into booth_pin_print_access_probe values (1, '비로그인(anon)', r);

  -- 2. authenticated 이지만 로그인한 사용자 정보가 없음
  begin
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    perform pg_catalog.set_config('request.jwt.claims', '', true);
    set local role authenticated;
    perform 1 from public.admin_print_booth_pins(v_ids);
    r := 'ALLOWED';
  exception when others then r := sqlstate;
  end;
  reset role;
  insert into booth_pin_print_access_probe values (2, '로그인 정보 없음(authenticated)', r);

  -- 3. 로그인했지만 관리자가 아님(운영 계정에 없는 무작위 사용자)
  begin
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    perform pg_catalog.set_config('request.jwt.claims',
      json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform 1 from public.admin_print_booth_pins(v_ids);
    r := 'ALLOWED';
  exception when others then r := sqlstate;
  end;
  reset role;
  insert into booth_pin_print_access_probe values (3, '관리자가 아닌 로그인(authenticated)', r);
end
$probe$;

select v.n as "순서", v.who as "항목", '42501' as "기대", v.got as "실제"
  from booth_pin_print_access_probe v
 order by v.n;
