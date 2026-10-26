-- ===================================================================
-- 개별 PIN 일관성 점검 — 읽기 전용 · 몇 번이든 다시 실행해도 됩니다 (2026-10-26)
--
-- 무엇을 보나
--   PIN 을 발급 · 재발급 · 끈 뒤(또는 배포 뒤 · 아무 때나) 서버의 PIN 줄 · Vault 보관값 · 로그인 해시 · 세션 · 기록이
--   서로 맞는지. QR · PIN 관리 화면의 ‘보기’ · ‘선택 PIN 조회’ · ‘QR코드 + 개별 PIN’ 인쇄가 최신 PIN 만 쓰는 근거와 같습니다.
-- 지키는 것
--   SELECT 만 합니다(표 · 함수 · 설정 · 세션 · 기록을 바꾸지 않음). PIN 숫자 · 해시 · QR 열쇠는 결과에 나오지 않습니다 —
--   수 · 부스 번호 · 판정만 나옵니다. 보관값은 SQL 안에서만 해시와 대조합니다(bcrypt, 켜진 PIN 한 곳에 약 0.1초).
-- 사용법
--   Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run(postgres). ‘판정’ 이 모두 ‘정상’ 또는 ‘참고’ 여야 합니다.
--   ‘확인 필요’ 가 있으면 그 줄의 부스 번호를 QR · PIN 관리에서 확인하고, 필요하면 그 부스만 재발급합니다.
-- 실제 부스 = 기관이 '[예시]' 로 시작하지 않는 부스(화면의 BC.isSample 과 같은 규칙) · 예시 · 보관 부스 = 그 밖
-- ===================================================================
with b as (
  select x.id, x.code, x.zone_key, x.no, (coalesce(x.org, '') !~ '^\s*\[예시\]') as real
    from public.booths x
), p as (
  select b.id, b.code, b.zone_key, b.no, b.real,
         (q.disabled_at is not null)                       as off,
         coalesce(q.reissued_at, q.issued_at)              as at,
         q.pin_hash                                        as h,
         s.decrypted_secret                                as v
    from b
    join public.booth_pin q on q.booth_id = b.id
    left join vault.decrypted_secrets s on s.name = 'booth_pin_print_' || b.id::text
), c as (
  -- 켜진 PIN 마다 보관값 판정: ok(보관값 = 로그인 PIN) · no_copy(보관값 없음) · bad(모양 · 해시 불일치)
  select p.*,
         case when p.off then null
              when p.v is null then 'no_copy'
              when p.v !~ '^[0-9]{6}$' then 'bad'
              when extensions.crypt(private.booth_pin_digest(p.v), p.h) = p.h then 'ok'
              else 'bad' end as copy
    from p
), r as (
  select
    (select count(*) from b where b.real)                                     as n_real,
    (select count(*) from b where not b.real)                                 as n_ex,
    (select count(*) from c where c.real and not c.off)                       as real_on,
    (select count(*) from c where c.real and c.off)                           as real_off,
    (select count(*) from b where b.real and not exists (select 1 from public.booth_pin q where q.booth_id = b.id)) as real_none,
    (select count(*) from c where c.real and c.copy = 'ok')                   as real_ok,
    (select coalesce(string_agg(c.code, ' ' order by c.zone_key, c.no), '없음') from c where c.real and c.copy = 'no_copy') as real_nocopy,
    (select coalesce(string_agg(c.code, ' ' order by c.zone_key, c.no), '없음') from c where c.real and c.copy = 'bad')     as real_bad,
    (select coalesce(string_agg(c.code || '(' || c.copy || ')', ' ' order by c.zone_key, c.no), '없음') from c where not c.real and not c.off and c.copy <> 'ok') as ex_notok,
    (select count(*) from c where not c.real and not c.off)                   as ex_on,
    -- 꺼진 PIN 의 보관값은 무작위 표시로 덮여 있어야 함(6자리 숫자로 남으면 안 됨)
    (select coalesce(string_agg(c.code, ' ' order by c.zone_key, c.no), '없음') from c where c.off and c.v ~ '^[0-9]{6}$') as off_readable,
    -- PIN 줄이 없는 부스(또는 지워진 부스)의 보관값
    (select count(*) from vault.secrets s
      where s.name like 'booth_pin_print\_%' escape '\'
        and not exists (select 1 from public.booth_pin q where 'booth_pin_print_' || q.booth_id::text = s.name)) as orphan,
    -- 꺼진 PIN 부스의 살아 있는 세션(끄면 모두 끊김)
    (select coalesce(string_agg(distinct c.code, ' '), '없음') from c join public.booth_session ss on ss.booth_id = c.id
      where c.off and ss.revoked_at is null and ss.expires_at > now()) as off_live,
    -- 켜진 PIN 부스에서 마지막 발급 · 재발급 전에 만든 살아 있는 세션(발급 · 재발급하면 그때까지의 세션이 모두 끊김)
    (select coalesce(string_agg(distinct c.code, ' '), '없음') from c join public.booth_session ss on ss.booth_id = c.id
      where not c.off and ss.revoked_at is null and ss.expires_at > now() and ss.created_at < c.at) as stale_live,
    -- 켜진 PIN 마다 그 발급 시각의 발급 · 재발급 기록(같은 트랜잭션이라 시각이 같음 — 1밀리초 안)
    (select coalesce(string_agg(c.code, ' ' order by c.zone_key, c.no), '없음') from c
      where c.real and not c.off and not exists (select 1 from public.booth_auth_event e
        where e.booth_id = c.id and e.event in ('pin_issued', 'pin_reissued')
          and e.at between c.at - interval '1 millisecond' and c.at + interval '1 millisecond')) as no_event,
    (select to_char(max(c.at) at time zone 'Asia/Seoul', 'MM-DD HH24:MI:SS') from c where c.real) as last_at,
    (select count(*) from private.booth_pin_print_audit a where a.at > now() - interval '24 hours') as audit_24h,
    (select count(distinct a.actor) from private.booth_pin_print_audit a where a.at > now() - interval '24 hours') as audit_actors,
    (select count(*) from public.staff_profiles sp where sp.role = 'admin')   as admins,
    (select to_char(private.rehearsal_common_pin_until() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI')) as cm_until,
    (select count(*) from b where b.real and private.rehearsal_common_pin_open(b.id)) as cm_open,
    (select string_agg(left(md5(replace(pg_catalog.pg_get_functiondef(f::regprocedure), E'\r', '')), 8), ' ' order by o)
       from (values (1, 'public.admin_issue_booth_pin(uuid)'), (2, 'public.admin_disable_booth_pin(uuid)'),
                    (3, 'public.admin_print_booth_pins(uuid[])'), (4, 'public.admin_issue_booth_pin_checked(uuid, text, timestamptz)'),
                    (5, 'public.booth_pin_login(uuid, text, text)')) as x(o, f)) as fps
)
select v."순서", v."항목", v."기대", v."실제",
       case when v."기대" = '참고' then '참고' when v."기대" = v."실제" then '정상' else '확인 필요' end as "판정"
  from r, lateral (values
    (1,  '부스 수 — 실제 · 예시 · 보관',                                         '84 · 50',  r.n_real || ' · ' || r.n_ex),
    (2,  '실제 부스 개별 PIN — 켜짐 · 꺼짐 · 미발급',                              '참고',      r.real_on || ' · ' || r.real_off || ' · ' || r.real_none),
    (3,  '켜진 실제 PIN 가운데 보관값 = 로그인 PIN(‘보기’ · 조회 · 인쇄 가능)',      r.real_on::text, r.real_ok::text),
    (4,  '켜진 실제 PIN 보관값 없음(재발급해야 다시 볼 수 있음)',                    '없음',      r.real_nocopy),
    (5,  '켜진 실제 PIN 보관값 불일치(모양 · 해시)',                                '없음',      r.real_bad),
    (6,  '예시 · 보관 부스 켜진 PIN 가운데 보관값이 정상이 아닌 곳(이 기능 전 발급분 등)', '참고',   r.ex_on || '곳 중 ' || r.ex_notok),
    (7,  '꺼진 PIN 보관값이 PIN 모양으로 남음',                                     '없음',      r.off_readable),
    (8,  'PIN 줄 없는 보관값(남은 비밀)',                                           '0',         r.orphan::text),
    (9,  '꺼진 PIN 부스의 살아 있는 세션',                                          '없음',      r.off_live),
    (10, '켜진 PIN 부스 — 마지막 발급 전에 만든 살아 있는 세션',                      '없음',      r.stale_live),
    (11, '켜진 실제 PIN — 그 발급 시각의 발급 · 재발급 기록 없음',                    '없음',      r.no_event),
    (12, '실제 부스 마지막 PIN 발급 · 재발급(KST)',                                 '참고',      coalesce(r.last_at, '없음')),
    (13, '최근 24시간 PIN 조회 기록(PIN 값 없음) — 건 · 관리자 수',                  '참고',      r.audit_24h || ' · ' || r.audit_actors),
    (14, '관리자 계정 수(모두 PIN 조회 · 인쇄 가능)',                                '참고',      r.admins::text),
    (15, '리허설 공통 PIN 끝 · 지금 쓸 수 있는 실제 부스',                           '참고',      r.cm_until || ' · ' || r.cm_open || '곳'),
    (16, '발급 · 끄기 · 조회 · 조건부 발급 · PIN 로그인 함수 지문',                  '5218420e a19e6ca4 8f272e17 ba79b2cc d78e25b9', r.fps)
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";
