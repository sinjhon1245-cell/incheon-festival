-- ===================================================================
-- 리허설 대기시간 — 채우기 · 비우기 · 매일 23:00(KST) 자동 초기화용 DB 함수
--
--   부스 운영 현황(booth-admin.html)의 '리허설 관리' 와 23:00 예약 작업이 씁니다.
--   새 표 · 새 칸 · 새 설정은 없습니다. 함수 여섯 개만 더합니다.
--
--   대상: 승인된 실제 부스 84곳(문서 번호 S01~S84) — 부스 UUID 를 이 파일에 적어 둡니다.
--         구역 · 번호 · 기관 이름이 바뀌어도(R1~R4 임시 구역 → 최종 구역) 같은 부스입니다.
--         예시 부스 50곳('[예시]' 기관)은 들어 있지 않습니다.
--
--   이 파일이 더하는 것
--     private.rehearsal_booth_ids()    84곳 UUID(고정 목록)
--     private.rehearsal_cutoff()       리허설 관리가 닫히는 날(한국 날짜) — settings.event_start 의 날,
--                                      늦어도 2026-11-06. 행사 기본정보를 뒤로 고쳐도 11-06 을 넘지 않습니다.
--     private.rehearsal_closed()       오늘(한국 날짜)이 그날 이후인가
--     public.admin_rehearsal_status()  관리자 화면이 읽는 한 줄 — 대상 UUID · 닫힘 · 닫히는 날 · 오늘 ·
--                                      23시 자동 초기화 상태(pg_cron 이 없으면 'none')
--     public.admin_rehearsal_set_live(p_booth_id, p_mode, p_wait_minutes)
--          관리자만 · 84곳만 · 닫히는 날 전만. 통과하면 관리자 긴급 수정과 같은 admin_set_booth_live 를
--          그대로 부릅니다(혼잡도는 서버가 대기 분으로 판정 · 기록 source 'admin' · 'clear' 는 그 부스의
--          지금 값만 지우고 기록은 남김). 행사 당일에는 화면을 고쳐 불러도 여기서 막힙니다.
--     private.rehearsal_live_reset()   23:00 예약 작업이 부르는 함수 — 84곳의 지금 값(booth_live)만 지웁니다.
--                                      대기 기록 · QR · PIN · 부스 정보 · 예시 50곳은 그대로. 여러 번 불러도 같음.
--
--   이 파일이 하지 않는 것
--     · 예약 작업 등록(pg_cron) — supabase/schedule-booth-rehearsal-reset.sql (따로 승인 뒤)
--     · 대기 값 넣기 · 지우기 — 함수만 만듭니다. 표 · 칸 · 제약 · RLS · 기존 함수는 그대로입니다.
--
--   보안 점검 경고
--     admin_rehearsal_* 두 함수도 authenticated_security_definer_function_executable 로 짚힙니다.
--     함수 안의 is_admin() 이 막습니다(관리자 화면의 다른 admin_* 함수와 같음). anon 실행 권한은 거둡니다.
--
-- 사용법: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run. 여러 번 실행해도 안전합니다.
--         맨 아래 확인 표의 '기대' 와 '실제' 가 모두 같아야 합니다.
-- 되돌리기: supabase/rollback-booth-rehearsal.sql
-- 트랜잭션: BEGIN/COMMIT 을 넣지 않습니다. SQL Editor 와 apply_migration 은 이미 한 트랜잭션으로
--   돌립니다. psql 은 psql -1 -v ON_ERROR_STOP=1 -f.
-- ===================================================================


-- ═══════════════════════════════════════════════════════════════
-- 0. 선행 조건 검사 (아무것도 바꾸지 않습니다)
-- ═══════════════════════════════════════════════════════════════
do $preflight$
begin
  if to_regprocedure('public.admin_set_booth_live(uuid, text, integer)') is null
     or to_regprocedure('public.is_admin()') is null
     or to_regclass('public.booth_live') is null
     or to_regnamespace('private') is null then
    raise exception '선행 조건 누락: migration-booth-live.sql · migration-booth-live-admin.sql · migration-booth-private.sql 을 먼저 적용하세요.';
  end if;
end
$preflight$;


-- ═══════════════════════════════════════════════════════════════
-- 1. 대상 84곳 · 닫히는 날
-- ═══════════════════════════════════════════════════════════════
-- 2026-10-19 Production 의 실제 부스 84곳(기관이 '[예시]' 로 시작하지 않는 부스 전부 · S01~S84 순서).
-- 정렬한 UUID 의 md5 = 965ec1ec308bd1f1c59b6a52fc3adb9c. 부스를 새로 만들거나 바꾸면 이 목록도 고쳐야 합니다.
create or replace function private.rehearsal_booth_ids()
 returns uuid[] language sql immutable set search_path to ''
as $function$
  select array[
    'c25be9e3-c766-5fc0-9eee-fcdeb4cd156c', '177d8f80-f684-572f-ba32-beafb28e54bc', '9662582a-a036-521e-930f-ad000746dc0d',   -- S01 S02 S03
    '44b3f975-77dc-5e17-8a09-10b5abccc552', 'a3d4f361-0aa4-5ba6-9cbe-893f9b75e23c', '637a42e0-3cd0-5d85-a98a-f329fae86332',   -- S04 S05 S06
    '4199f4ac-c58b-5e9b-be3e-be46ed061099', 'd3704531-7681-514c-a60a-0ea3614d4c05', '5fc6401a-4e02-5ea6-9837-43e1bab2c6f4',   -- S07 S08 S09
    '2de4c863-8836-579b-a1fb-d6a09b301e67', '9cfe948f-95ca-5d08-a177-a749e64f1ab8', '3584e7de-2610-58ab-9d21-25bd5d9f5e8e',   -- S10 S11 S12
    'e0d380e4-6c4d-5bef-9a3e-b2c595a84141', '099917fb-8949-5b2e-b611-71be91ca6f02', '9be440e8-2ef4-559b-9f9f-38b01da8591d',   -- S13 S14 S15
    'ee6cd707-50d6-5120-a25d-6e503f37feec', 'a4e7e816-f605-5f90-a833-39e4c8ed7d00', '224cd04b-593c-51d3-8d12-20e2e41661ff',   -- S16 S17 S18
    '66b3083d-b77a-5501-bf52-1fad00eae545', '19ac68f7-9f85-581e-9cca-f05d90c6ea3a', 'c25a9fff-b90f-57c7-a029-31dcb89dadaa',   -- S19 S20 S21
    '02e9f946-3423-525e-9b8c-654481e427ea', '4e8abfd5-2133-54dc-a490-a2caccbe898d', 'b241da92-caa7-5568-9dc1-d844f06765ac',   -- S22 S23 S24
    '442ab200-4cfd-57b6-972c-49e768a4a40a', '439c0e75-c9eb-5607-8c1d-731e09e50815', '0ed1aef9-b246-515d-9a32-8c85455f129a',   -- S25 S26 S27
    '60c34a21-1a50-5b4e-8730-2149bc45f930', '298e06c1-eff8-5020-92f3-5d1f8b5b9352', '34c01b1e-93e2-57f5-852c-0d9f716e7865',   -- S28 S29 S30
    '72d29e9e-c0d5-51a3-bdec-eecc08163425', '6ad98955-589f-536c-932c-2e6c84054bfd', 'd8a77979-69cf-529c-ab92-770274534d60',   -- S31 S32 S33
    '753d237d-a32b-5ad9-96bc-19fa2a5612ff', 'dcdac6b8-4e7c-5e4d-90b1-48d5c68d78a2', 'ba376927-c5f7-5a37-b326-8dfe1fa614d3',   -- S34 S35 S36
    '5d884b33-a632-513c-8d69-c6d398197662', '36b7c9f9-8386-53e2-ab44-a93617b324b6', '585c01d4-e2fd-56df-923b-da627cee893a',   -- S37 S38 S39
    '87331f66-0318-5a5a-a600-2c6f9705b962', '988ff332-7d0f-5acb-8f22-afebc22c6e65', '80d87f4d-3980-577f-8e00-5929bdd04475',   -- S40 S41 S42
    '15ffe3ea-3a98-5b18-87ad-9ddcf2216aa8', 'e24eb01e-6ae3-5064-8b81-15afc13bde68', '02635f9f-b943-5ce4-96fa-54fc76379bb6',   -- S43 S44 S45
    'b0c288a4-4c05-5e14-9411-3c16f875a46f', '45251b1c-4a19-5b57-babd-448e61414d78', 'f6a16c17-246a-535a-832c-fff98e7aac30',   -- S46 S47 S48
    '5f9bc8e6-1591-5170-95ca-c030e6aefa82', '36d3be4d-5b06-539a-8f76-c4c15c1de7d3', 'e7cd8f76-4ddf-543a-9feb-ea7a971433c8',   -- S49 S50 S51
    'ce47823c-cc43-55ac-98c0-2648c97c9e66', 'f57ecd45-e6d6-53df-8772-860d958e73fe', '9721e9f5-f5c4-5e6d-8e64-176be6db7da1',   -- S52 S53 S54
    'cb0fd173-83e2-550b-9da5-97766810d2db', '642a1213-4b7e-5ec0-ae3c-92a066435e6b', '8425096b-e4ff-5322-af69-966f46bb085a',   -- S55 S56 S57
    '79a4a9ac-fd9b-5ac1-b469-4ccaf85ab71d', '70eb322c-058b-5282-919e-5882f1af0035', 'aec34db6-3bfc-5c45-a508-41b24cff0a74',   -- S58 S59 S60
    'd8491aa9-22c4-5ce3-8775-5cd778c4ce5a', 'd322cc3f-6bf5-5c4c-8edb-628066b77d92', '7e7ff5e4-8090-525c-971a-f0009d11fe8e',   -- S61 S62 S63
    '6026bf1b-b387-5eca-ae95-64b7c175b126', '6c160a91-a8c0-5793-b73a-56597b4893a3', '328cad61-2edd-5e78-8ba7-5b4c90719eb4',   -- S64 S65 S66
    '3d487ee5-e726-5704-99b6-443488be7f29', '5947fc6c-155a-5111-bb4a-112464ebaebc', 'dab3cc5e-6cc0-57e6-832e-0fb7c661433f',   -- S67 S68 S69
    'f17a9a59-4c96-5a37-910b-f417450faa4a', '1ff1e13c-cf24-57fb-ba41-ac7874e71ee2', 'e5a9435a-4b95-51fd-8505-0afbb300e46e',   -- S70 S71 S72
    '9bd97ee0-066c-5863-8e81-85aa55f50d3a', '85d12b49-ebf6-55cb-b180-608be1e74acd', 'afc0cecf-8ac8-5742-946a-3982165be9ed',   -- S73 S74 S75
    '61547dfd-272b-5e26-afd3-879eac13e39c', '67befba9-7532-58c7-bb8d-cd0cbc6528a4', 'ae5351da-c3bb-5bcd-adbe-27f459584b54',   -- S76 S77 S78
    '5c1a3697-9d5f-5a64-bcea-19e0d68f5a23', 'a08643e4-1529-5e7e-9a47-1c0c54bebdb7', '2f693fe9-ff8c-5f01-b617-d6e0379ff9c2',   -- S79 S80 S81
    'bb6b8f87-4927-5d73-bbae-25dba34558e8', '55545ef6-97df-52ca-9a58-e23d8211d3f5', '9ddc5151-f35e-5841-9475-ed2a40943a64'    -- S82 S83 S84
  ]::uuid[]
$function$;

-- 목록이 DB 와 맞는지: 84곳 모두 있고, 겹침 없고, 예시 부스가 하나도 없어야 합니다. 아니면 여기서 멈춥니다.
do $targets$
declare
  v_ids uuid[] := private.rehearsal_booth_ids();
  v_have integer;
  v_sample integer;
begin
  select count(*), count(*) filter (where b.org ~ '^\s*\[예시\]')
    into v_have, v_sample
    from public.booths b where b.id = any (v_ids);
  if cardinality(v_ids) <> 84
     or (select count(distinct x) from unnest(v_ids) as x) <> 84
     or v_have <> 84 or v_sample <> 0 then
    raise exception '리허설 대상 84곳이 DB 와 맞지 않습니다(목록 %곳 · DB 에 있음 %곳 · 예시 %곳). 아무것도 바꾸지 않고 멈춥니다.',
      cardinality(v_ids), v_have, v_sample;
  end if;
end
$targets$;

create or replace function private.rehearsal_cutoff()
 returns date language sql stable set search_path to ''
as $function$
  select least(
    coalesce((select (s.event_start at time zone 'Asia/Seoul')::date
                from public.settings s order by s.id limit 1), date '2026-11-06'),
    date '2026-11-06')
$function$;

create or replace function private.rehearsal_closed()
 returns boolean language sql stable set search_path to ''
as $function$
  select (pg_catalog.now() at time zone 'Asia/Seoul')::date >= private.rehearsal_cutoff()
$function$;


-- ═══════════════════════════════════════════════════════════════
-- 2. 관리자 화면이 읽는 상태 한 줄
-- ═══════════════════════════════════════════════════════════════
-- reset_state: 'none'(pg_cron 꺼짐) · 'off'(예약 없음) · 'on'(예약 켜짐) · 'paused'(예약 멈춤) · 'unknown'(읽지 못함)
-- last_status: pg_cron 의 마지막 실행 결과('succeeded' · 'failed' · 'running' …), 아직 없으면 null
create or replace function public.admin_rehearsal_status()
 returns table(target_ids uuid[], closed boolean, cutoff date, kst_today date,
               reset_state text, reset_schedule text, last_run_at timestamptz, last_status text)
 language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_state  text := 'none';
  v_job    bigint;
  v_sched  text;
  v_active boolean;
  v_at     timestamptz;
  v_st     text;
begin
  if not public.is_admin() then
    raise exception '관리자만 볼 수 있습니다.' using errcode = '42501';
  end if;
  -- pg_cron 이 아직 없을 수 있어 표 이름을 글로 적어 둡니다(없어도 이 함수는 만들어지고 'none' 을 돌려줌).
  if pg_catalog.to_regclass('cron.job') is not null then
    begin
      execute 'select j.jobid, j.schedule, j.active from cron.job j where j.jobname = $1 order by j.jobid limit 1'
        into v_job, v_sched, v_active using 'booth-rehearsal-reset';
      if v_job is null then
        v_state := 'off';
      else
        v_state := case when v_active then 'on' else 'paused' end;
        execute 'select d.start_time, d.status from cron.job_run_details d where d.jobid = $1 order by d.start_time desc nulls last limit 1'
          into v_at, v_st using v_job;
      end if;
    exception when others then
      v_state := 'unknown';
    end;
  end if;
  return query select private.rehearsal_booth_ids(), private.rehearsal_closed(), private.rehearsal_cutoff(),
                      (pg_catalog.now() at time zone 'Asia/Seoul')::date, v_state, v_sched, v_at, v_st;
end;
$function$;

revoke all     on function public.admin_rehearsal_status() from public;
revoke execute on function public.admin_rehearsal_status() from anon;
grant  execute on function public.admin_rehearsal_status() to authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 3. 리허설 값 넣기 · 지우기 (부스 하나씩 — 관리자 화면이 84번 부릅니다)
-- ═══════════════════════════════════════════════════════════════
create or replace function public.admin_rehearsal_set_live(p_booth_id uuid, p_mode text, p_wait_minutes integer)
 returns table(booth_id uuid, congestion text, wait_minutes integer, updated_at timestamp with time zone)
 language plpgsql security definer set search_path to ''
as $function$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception '관리자만 쓸 수 있습니다.' using errcode = '42501';
  end if;
  if p_booth_id is null or not (p_booth_id = any (private.rehearsal_booth_ids())) then
    raise exception '리허설 대상(실제 부스 84곳)이 아닌 부스입니다.' using errcode = '22023';
  end if;
  if private.rehearsal_closed() then
    raise exception '행사가 시작되어 리허설 대기시간을 넣거나 지울 수 없습니다.'
      using errcode = 'P0001', hint = 'rehearsal_closed';
  end if;
  return query select * from public.admin_set_booth_live(p_booth_id, p_mode, p_wait_minutes);
end;
$function$;

revoke all     on function public.admin_rehearsal_set_live(uuid, text, integer) from public;
revoke execute on function public.admin_rehearsal_set_live(uuid, text, integer) from anon;
grant  execute on function public.admin_rehearsal_set_live(uuid, text, integer) to authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 4. 23:00 자동 초기화가 부르는 함수 (예약 등록은 schedule-booth-rehearsal-reset.sql)
-- ═══════════════════════════════════════════════════════════════
-- 84곳의 지금 값만 지웁니다. 지운 수를 돌려줍니다(없으면 0). 행사 날에도 23:00 은 문을 닫은 뒤라 그대로 돕니다.
create or replace function private.rehearsal_live_reset()
 returns integer language plpgsql set search_path to ''
as $function$
declare
  n integer;
begin
  delete from public.booth_live as l where l.booth_id = any (private.rehearsal_booth_ids());
  get diagnostics n = row_count;
  return n;
end;
$function$;

revoke all on function private.rehearsal_booth_ids()  from public;
revoke all on function private.rehearsal_cutoff()     from public;
revoke all on function private.rehearsal_closed()     from public;
revoke all on function private.rehearsal_live_reset() from public;


-- ═══════════════════════════════════════════════════════════════
-- 5. 확인 (기대 = 실제)
-- ═══════════════════════════════════════════════════════════════
select v."순서", v."항목", v."기대", v."실제"
  from (values
    (1, '대상 목록 84곳 · 겹침 없음', 'true',
        (cardinality(private.rehearsal_booth_ids()) = 84
         and (select count(distinct x) from unnest(private.rehearsal_booth_ids()) as x) = 84)::text),
    (2, '대상이 모두 DB 의 실제 부스(예시 아님)', '84',
        (select count(*) from public.booths b
          where b.id = any (private.rehearsal_booth_ids()) and b.org !~ '^\s*\[예시\]')::text),
    (3, '대상 목록 지문(md5)', '965ec1ec308bd1f1c59b6a52fc3adb9c',
        (select md5(string_agg(x::text, ',' order by x::text)) from unnest(private.rehearsal_booth_ids()) as x)),
    (4, '닫히는 날(한국 날짜)', '2026-11-06', private.rehearsal_cutoff()::text),
    (5, '지금 닫힘(행사 전이면 false)', 'false', private.rehearsal_closed()::text),
    (6, '익명(anon) 실행 — 상태 · 넣기', 'false',
        (has_function_privilege('anon', 'public.admin_rehearsal_status()', 'EXECUTE')
         or has_function_privilege('anon', 'public.admin_rehearsal_set_live(uuid, text, integer)', 'EXECUTE'))::text),
    (7, '로그인(authenticated) 실행 — 상태 · 넣기(함수 안에서 관리자 확인)', 'true',
        (has_function_privilege('authenticated', 'public.admin_rehearsal_status()', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.admin_rehearsal_set_live(uuid, text, integer)', 'EXECUTE'))::text),
    (8, '초기화 함수 — anon · authenticated 실행', 'false',
        (has_function_privilege('anon', 'private.rehearsal_live_reset()', 'EXECUTE')
         or has_function_privilege('authenticated', 'private.rehearsal_live_reset()', 'EXECUTE'))::text),
    (9, 'private 스키마 사용(anon · authenticated)', 'false',
        (has_schema_privilege('anon', 'private', 'USAGE') or has_schema_privilege('authenticated', 'private', 'USAGE'))::text)
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";
