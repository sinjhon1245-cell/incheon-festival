-- ===================================================================
-- 되돌리기 — 공통 PIN · 개별 PIN 병행(migration-booth-common-pin-dual-nov4.sql)
--
--   병행만 되돌립니다: 리허설 갈래를 예전 규칙(그 부스에 개별 PIN 이력이 있으면 공통 PIN 닫힘)으로 바꿉니다.
--   더 안전한 쪽은 그대로 둡니다 — 끝나는 때 2026-11-04 23:00 KST 와 예시 부스 공통 PIN 의 마감은 남깁니다(늦추지 않음).
--
--   되돌린 순간
--     · 개별 PIN 을 한 번이라도 받은 실제 부스는 공통 PIN 새 로그인이 막히고, 그 부스의 열린 공통 PIN 화면은 다음 저장 ·
--       확인에서 서버가 거절합니다. 개별 PIN 을 받지 않은 부스는 마감 전까지 공통 PIN 그대로.
--   지우지 않는 것: PIN · 세션 줄 · QR 열쇠 · 보안 기록 · 대기 값 · 설정.
--   공통 PIN 을 지금 모두 멈추려면 이 파일 대신 supabase/stop-booth-common-pin.sql.
--
-- 사용법: SQL Editor → 전체 붙여넣고 Run(한 트랜잭션). 여러 번 실행해도 같은 결과입니다. 확인 표 기대 = 실제.
-- ===================================================================

-- 리허설 갈래: migration-booth-rehearsal-pin.sql(10-19)과 같은 글자(개별 PIN 줄 · 발급 기록이 있으면 닫힘)
create or replace function private.rehearsal_common_pin_open(p_booth uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
           p_booth = any (private.rehearsal_booth_ids())
           and pg_catalog.now() < private.rehearsal_common_pin_until()
           and not exists (select 1 from public.booth_pin p where p.booth_id = p_booth)
           and not exists (select 1 from public.booth_auth_event e
                            where e.booth_id = p_booth
                              and e.event in ('pin_issued', 'pin_reissued', 'pin_disabled')),
           false)
$$;

-- 대상 판정: 병행 파일과 같은 글자(예시 · 리허설 갈래 모두 마감 전에만 — 마감은 그대로)
create or replace function private.booth_common_pin_target(p_booth uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
           pg_catalog.now() < private.rehearsal_common_pin_until()
           and (
             (coalesce((select s.booth_sample_common_pin_enabled from public.settings s order by s.id limit 1), false)
              and exists (
                select 1 from public.booths b join public.zones z on z.key = b.zone_key
                 where b.id = p_booth and b.is_published and z.is_published and b.no is not null
                   and b.org ~ '^\s*\[예시\]'
              ))
             or
             (private.rehearsal_common_pin_open(p_booth)
              and exists (
                select 1 from public.booths b join public.zones z on z.key = b.zone_key
                 where b.id = p_booth and b.is_published and z.is_published and b.no is not null
                   and coalesce(b.org, '') !~ '^\s*\[예시\]'
              ))
           ),
           false)
$$;
revoke all on function private.rehearsal_common_pin_open(uuid) from public,anon,authenticated;
revoke all on function private.booth_common_pin_target(uuid) from public,anon,authenticated;

select v."순서", v."항목", v."기대", v."실제"
  from (values
    (1, '공통 PIN 끝나는 때(한국 시각 — 그대로)', '2026-11-04 23:00:00',
        to_char(private.rehearsal_common_pin_until() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS')),
    (2, '개별 PIN 이력이 있는 리허설 부스 중 공통 PIN 대상(예전 규칙)', '0',
        (select count(*) from unnest(private.rehearsal_booth_ids()) x
          where private.booth_common_pin_target(x)
            and (exists (select 1 from public.booth_pin p where p.booth_id = x)
                 or exists (select 1 from public.booth_auth_event e where e.booth_id = x
                             and e.event in ('pin_issued', 'pin_reissued', 'pin_disabled'))))::text),
    (3, 'PIN 로그인 · 공통 PIN 비교 · 세션 확인 그대로(지문)', 'd78e25b9 57684373 587f4d79',
        (select string_agg(left(md5(replace(pg_catalog.pg_get_functiondef(f::regprocedure), E'\r', '')), 8), ' ' order by o)
           from (values (1, 'public.booth_pin_login(uuid, text, text)'), (2, 'private.booth_common_pin_ok(uuid, text)'),
                        (3, 'private.booth_session_resolve(text, boolean)')) as x(o, f))),
    (4, '리허설 갈래 · 대상 판정 — anon · authenticated 실행', 'false',
        (has_function_privilege('anon', 'private.rehearsal_common_pin_open(uuid)', 'EXECUTE')
         or has_function_privilege('authenticated', 'private.rehearsal_common_pin_open(uuid)', 'EXECUTE')
         or has_function_privilege('anon', 'private.booth_common_pin_target(uuid)', 'EXECUTE')
         or has_function_privilege('authenticated', 'private.booth_common_pin_target(uuid)', 'EXECUTE'))::text)
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";
