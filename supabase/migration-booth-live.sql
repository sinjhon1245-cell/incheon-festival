-- ===================================================================
-- 부스 실시간 대기 현황 (booth_live · booth_access · booth_live_log)
--
--   관람객이 휴대폰으로 "지금 어느 부스가 한가한지" 보게 합니다.
--   값은 부스 선생님이 운영자용 QR 카드로 연 화면에서 직접 누릅니다.
--   누가 무엇을 하는지는 이렇습니다.
--     관람객 사이트 · 포털      booth_live 를 읽기만 합니다(anon 열람).
--     부스 운영자 화면          QR 열쇠를 들고 booth_ctrl_* 함수만 부릅니다.
--     QR 인쇄 페이지(관리자)    admin_* 함수로 열쇠를 받고 · 바꾸고,
--                               리허설 값을 지웁니다.
--
--   이 파일이 하는 일
--     1. booth_live      부스당 한 줄: 혼잡도 · 대기 분 · 입력 시각. 공개 열람.
--     2. booth_access    부스당 운영자 QR 열쇠(24자). anon · authenticated 는
--                        직접 읽지 못합니다 — 아래 함수만 만집니다.
--                        (service_role · postgres 처럼 RLS 를 건너뛰는
--                        관리 역할은 예외입니다. 서비스 키는 원래 만능 키입니다.)
--     3. booth_live_log  누를 때마다 한 줄. 행사 후 보고용이고
--                        SQL Editor 에서만 읽습니다.
--     4. 함수 여덟
--          booth_ctrl_get · booth_ctrl_set · booth_ctrl_touch
--            QR 열쇠로 그 부스 한 곳의 값을 읽고 바꿉니다. anon 실행 허용.
--            꺼진 열쇠(booth_access.disabled_at)는 모르는 열쇠와 똑같이 거절합니다.
--          admin_booth_access · admin_rotate_booth_token · admin_reset_booth_live
--          admin_disable_booth_token · admin_set_booth_live
--            관리자 전용. 열쇠 발급 · 교체 · 끄기, 실시간 값 모두 지우기,
--            한 부스 값 직접 고치기(기록 출처 'admin').
--
--   왜 booths 에 칸을 더하지 않나
--     · 저장소가 공개라 assets/config.js 의 anon 키도 공개입니다. anon 이
--       읽을 수 있는 표는 사실상 누구나 통째로 가져갑니다. booths 가 그런
--       표라서 열쇠를 거기 두면 그대로 샙니다. 열쇠는 anon 도
--       authenticated 도 읽지 못하는 booth_access 에만 둡니다.
--     · 관리자 화면이 부스 정보를 저장할 때 현장에서 누른 대기 값을 옛
--       값으로 덮어쓰지 않고, 대기 값이 바뀔 때 booths.updated_at 도
--       흔들리지 않습니다.
--
--   왜 PIN 이 아니라 QR 열쇠인가
--     4자리 PIN 은 공개 키로 몇 분이면 전부 넣어 볼 수 있습니다. 열쇠는
--     무작위 18바이트(144비트)를 base64url 로 적은 24자라 맞힐 수 없습니다.
--     열쇠는 POST 본문으로만 보냅니다. 이것은 우리 화면(booth-core.js)이
--     지키는 약속이지 서버가 막아 주는 것이 아닙니다. PostgREST 는 GET
--     /rpc 요청을 늘 읽기 전용 트랜잭션으로 돌릴 뿐이라, volatile 이어도
--     쓰지 않는 함수는 GET 으로 불립니다. 그래서 booth_ctrl_get 은 GET 으로
--     오면 일부러 0줄을 돌려주고(4-1), set · touch 는 GET 이면 쓰는 순간
--     실패합니다. 다만 어느 쪽이든 그 요청 주소에는 이미 열쇠가 실려
--     Supabase 접속 기록에 남습니다. 열쇠를 주소(?p_token=…)에 넣는
--     curl 예시나 화면을 만들지 마세요.
--     (운영자 화면 주소에서도 열쇠는 # 뒤에 있어 서버로 가지 않습니다).
--     오류 문구에도 열쇠를 되풀이하지 않습니다.
--
--   왜 Realtime 을 쓰지 않나
--     요금제 한도(초당 메시지 · 동시 접속)가 낮고, 부스 하나가 바뀌면
--     구독자 수만큼 메시지가 나갑니다. 한도를 넘으면 프로젝트의 Realtime
--     연결이 모두 끊깁니다. 화면들은 몇십 초마다 다시 읽습니다(polling).
--     그래서 supabase_realtime 발행에 아무 표도 넣지 않습니다.
--
--   바뀌지 않는 것
--     · public.booths · public.zones — 칸 · 제약 · 정책 · 데이터 그대로
--     · supabase_realtime 발행
--     · 그 밖의 표 · 함수 · 정책 · Storage
--
--   지운 초안: migration-booth-realtime.sql
--     booths 에 대기 칸과 PIN 을 더하고 Realtime 에 올리던 예전 초안입니다.
--     실제 DB 에는 적용된 적이 없어(2026-10-02 조회: booths 에 congestion ·
--     pin_code 칸 없음, update_booth_congestion 함수 없음, 발행 비어 있음)
--     되돌릴 것 없이 이 파일로 대신합니다.
--
--   보안 점검 경고에 대하여 (중요)
--     Supabase 보안 점검이 booth_ctrl_get · booth_ctrl_set · booth_ctrl_touch
--     를 anon_security_definer_function_executable 로 짚습니다. 의도된
--     것입니다. 부스 QR 열쇠로만 동작합니다 — 부스 선생님은 로그인하지
--     않고 열쇠만 들고 옵니다. 함수는 열쇠 형식부터 확인하고, 그 열쇠의
--     부스 한 곳만 건드립니다. 경고를 보고 anon 실행 권한을 거두지
--     마세요. 거두면 모든 부스의 입력이 그 자리에서 멈춥니다.
--     같은 이유로 authenticated_security_definer_function_executable 경고도
--     새 함수 여덟 모두에 뜹니다. admin_* 는 함수 안의 is_admin() 이,
--     booth_ctrl_* 는 열쇠가 막습니다. authenticated 실행 권한을 거두면
--     인쇄 페이지가 멈춥니다.
--
-- 사용법: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run.
--         여러 번 실행해도 안전합니다. 표는 if not exists, 제약 · 정책 ·
--         함수는 지우고 다시 만들고, 권한은 같은 결과로 수렴합니다.
--         이미 쌓인 대기 값 · 열쇠 · 기록은 지우지 않습니다.
--         실행 결과로 나오는 5번 확인 표에서 1~22번 줄의 '맞음' 은 모두
--         true 여야 합니다. 23~25번 줄은 참고용 숫자라 '맞음' 칸이 비어 있습니다.
--
--   이 파일은 '지금의 전체 정의' 입니다
--     운영 DB 에는 2026-10-02 에 두 번에 나눠 적용했습니다: 처음 판(열쇠 ·
--     대기 값 · 운영자 함수) → migration-booth-live-admin.sql(열쇠 끄기 ·
--     관리자 직접 수정). 그 후속 내용도 이 파일에 모두 들어 있어서, 어느
--     파일을 다시 실행해도 같은 결과로 수렴합니다. 고치려고 다시 돌릴 때
--     (예: 누가 보안 점검을 보고 anon 실행 권한을 거뒀을 때)는 이 파일
--     하나만 실행하면 됩니다. 꺼 둔 열쇠는 되살아나지 않습니다 — 끌 때
--     열쇠 문자열 자체를 새 무작위 값으로 바꿔 두기 때문입니다(4-7).
--
-- 선행: schema.sql                  (public.booths · public.zones)
--       migration-portal.sql         (booths.code)
--       migration-public-portal.sql  (public.is_admin())
--       pgcrypto 확장(extensions 스키마) — Supabase 프로젝트에 기본으로 켜져 있습니다.
--       하나라도 빠져 있으면 아래 0번이 아무것도 바꾸지 않고 멈춥니다.
--
-- 트랜잭션: BEGIN/COMMIT 을 넣지 않습니다. SQL Editor 와 apply_migration 은
--   스크립트 전체를 이미 한 트랜잭션으로 돌립니다(여기서 COMMIT 하면 도구의
--   트랜잭션을 중간에 끝내 버립니다). psql 로 돌릴 때는
--   psql -1 -v ON_ERROR_STOP=1 -f 로 실행하세요.
-- ===================================================================


-- ═══════════════════════════════════════════════════════════════
-- 0. 선행 조건 검사 (아무것도 바꾸지 않습니다)
--
-- 함수 본문이 booths.code · is_admin() · gen_random_bytes() 를 씁니다.
-- plpgsql 은 만들 때 본문을 끝까지 확인하지 않아서, 빠진 것이 있어도
-- 설치는 "성공" 하고 행사 당일 첫 입력에서야 터집니다. 그 전에 멈춥니다.
-- ═══════════════════════════════════════════════════════════════
do $preflight$
begin
  if to_regclass('public.booths') is null then
    raise exception '선행 조건 누락: public.booths 표가 없습니다. schema.sql 을 먼저 적용하세요.';
  end if;

  if to_regclass('public.zones') is null then
    raise exception '선행 조건 누락: public.zones 표가 없습니다. schema.sql 을 먼저 적용하세요.';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_attribute att
     where att.attrelid = to_regclass('public.booths')
       and att.attname = 'code'
       and not att.attisdropped
  ) then
    raise exception '선행 조건 누락: public.booths.code 칸이 없습니다. '
                    'migration-portal.sql 을 먼저 적용하세요.';
  end if;

  if to_regprocedure('public.is_admin()') is null then
    raise exception '선행 조건 누락: public.is_admin() 함수가 없습니다. '
                    'migration-public-portal.sql 을 먼저 적용하세요.';
  end if;

  if to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception '선행 조건 누락: extensions.gen_random_bytes(integer) 가 없습니다. '
                    'Database → Extensions 에서 pgcrypto 를 extensions 스키마로 켜세요.';
  end if;
end
$preflight$;


-- ═══════════════════════════════════════════════════════════════
-- 1. booth_live — 부스당 지금 값 한 줄 (공개 열람)
--
-- 줄이 없으면 "정보 없음" 입니다. 0분 · '여유' 로 미리 채워 두지
-- 않습니다 — 아무도 누르지 않은 부스가 한가해 보이면 관람객이
-- 헛걸음합니다.
--
-- 혼잡도는 화면이 아니라 함수가 대기 분에서 정합니다(10분 이하 여유,
-- 25분 이하 보통, 그 위 혼잡). 선생님마다 '혼잡' 의 뜻이 달라지지 않게
-- 하려는 것입니다. 중단 · 마감은 대기 0분으로 둡니다.
--
-- Supabase 는 새 표에 anon · authenticated 의 모든 권한을 "직접" 줍니다
-- (기본 권한). PUBLIC 만 거둬서는 남으므로 세 쪽 모두 거두고 읽기만
-- 다시 줍니다. 쓰는 길은 아래 정의자 함수뿐입니다.
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.booth_live (
  booth_id      uuid primary key references public.booths(id) on delete cascade,
  congestion    text not null,
  wait_minutes  integer not null default 0,
  updated_at    timestamptz not null default now()
);

alter table public.booth_live drop constraint if exists booth_live_congestion_check;
alter table public.booth_live
  add constraint booth_live_congestion_check
  check (congestion in ('여유', '보통', '혼잡', '중단', '마감'));

alter table public.booth_live drop constraint if exists booth_live_wait_check;
alter table public.booth_live
  add constraint booth_live_wait_check
  check (wait_minutes between 0 and 180);

alter table public.booth_live enable row level security;

revoke all on public.booth_live from anon, authenticated, public;
grant select on public.booth_live to anon, authenticated;

drop policy if exists "누구나 열람" on public.booth_live;
create policy "누구나 열람" on public.booth_live
  for select to anon, authenticated using (true);

comment on table public.booth_live is
  '부스별 지금 대기 현황(부스당 한 줄). 누구나 읽고, 쓰기는 booth_ctrl_set · booth_ctrl_touch 함수만 합니다.';


-- ═══════════════════════════════════════════════════════════════
-- 2. booth_access — 부스 운영자 QR 열쇠 (비공개)
--
-- 정책도 권한도 두지 않습니다. RLS 를 켠 채 정책이 없으면, 나중에
-- 누가 실수로 권한을 줘도 한 줄도 보이지 않습니다 — 두 겹으로 닫습니다.
-- 표 주인(postgres)이 만든 정의자 함수만 RLS 를 거치지 않고 읽습니다.
-- 보안 점검의 rls_enabled_no_policy 안내(이 표와 booth_live_log)도
-- 그래서 의도된 것입니다. 정책을 만들어 "해결" 하지 마세요.
--
-- 열쇠는 미리 만들지 않습니다. 관리자가 인쇄 페이지를 열 때
-- admin_booth_access() 가 열쇠 없는 부스에만 만들어 줍니다. 부스를
-- 나중에 가져와도(import) 다음에 인쇄 페이지를 열면 채워집니다.
-- booths 에 트리거를 달지 않는 것은 booths 를 건드리지 않기 위해서입니다.
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.booth_access (
  booth_id    uuid primary key references public.booths(id) on delete cascade,
  token       text not null unique,
  created_at  timestamptz not null default now(),
  rotated_at  timestamptz
);

-- 열쇠를 끈 시각. 값이 있으면 그 열쇠는 운영자 함수가 거절합니다(4-1~4-3).
-- 처음 판에는 없던 칸이라 if not exists 로 더합니다.
alter table public.booth_access add column if not exists disabled_at timestamptz;

comment on column public.booth_access.disabled_at is
  '열쇠를 끈 시각. 값이 있으면 그 열쇠는 운영자 화면에서 거절됩니다. 열쇠 바꾸기로만 다시 켭니다.';

alter table public.booth_access enable row level security;

revoke all on public.booth_access from anon, authenticated, public;

comment on table public.booth_access is
  '부스 운영자 QR 열쇠(부스당 하나). anon · authenticated 에게 정책 · 권한 없음 — booth_ctrl_* · admin_* 정의자 함수만 읽고 씁니다.';


-- ═══════════════════════════════════════════════════════════════
-- 3. booth_live_log — 누를 때마다 한 줄 (비공개)
--
-- 행사 후 "몇 시에 어느 부스가 붐볐나" 보고용입니다. 화면은 이 표를
-- 읽지 않습니다. 관리자도 SQL Editor 에서만 봅니다(맨 아래 보고 쿼리).
-- source: 'set' 은 값을 고른 것, 'touch' 는 "변동 없음 · 지금 확인",
--         'admin' 은 운영본부가 인쇄 페이지에서 직접 고친 것(4-8).
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.booth_live_log (
  id           bigint generated always as identity primary key,
  booth_id     uuid not null references public.booths(id) on delete cascade,
  congestion   text not null,
  wait_minutes integer not null,
  source       text not null,
  created_at   timestamptz not null default now()
);

alter table public.booth_live_log drop constraint if exists booth_live_log_source_check;
alter table public.booth_live_log
  add constraint booth_live_log_source_check
  check (source in ('set', 'touch', 'admin'));

create index if not exists booth_live_log_booth_time
  on public.booth_live_log (booth_id, created_at);

alter table public.booth_live_log enable row level security;

revoke all on public.booth_live_log from anon, authenticated, public;

-- 자동 번호(identity) 순서기도 기본 권한으로 anon · authenticated 에게 열려
-- 만들어집니다. API 로 부를 길은 없지만, 쓰지 않는 권한은 남기지 않습니다.
revoke all on sequence public.booth_live_log_id_seq from anon, authenticated, public;

comment on table public.booth_live_log is
  '부스 대기 입력 기록(누를 때마다 한 줄). 행사 후 보고용 — 화면에서는 읽지 않고 SQL Editor 에서만 봅니다.';


-- ═══════════════════════════════════════════════════════════════
-- 4. 함수 — 공통 규칙
--
--   · security definer + search_path = ''
--     표 주인 권한으로 돌기 때문에 검색 경로를 비우고 이름을 모두
--     스키마까지 적습니다(public. · extensions. · pg_catalog.now()).
--     translate · encode · lpad · right 같은 내장 함수는 pg_catalog 에
--     있어 경로가 비어 있어도 늘 먼저 찾습니다.
--   · create or replace 대신 drop → create
--     돌려주는 모양(returns table)이 바뀌면 replace 는 실패하고, 인자가
--     바뀌면 옛 함수가 anon 실행 권한을 가진 채 남습니다. 정확한 인자로
--     지우고 새로 만든 뒤 권한을 다시 줍니다.
--   · plpgsql 의 returns table 칸 이름(booth_id · token …)은 함수 안에서
--     변수가 됩니다. 같은 이름의 표 칸과 부딪히면 42702 "ambiguous" 로
--     멈추므로 #variable_conflict use_column 을 켜고, 표마다 별칭을 붙이고,
--     on conflict 는 칸 이름 대신 제약 이름으로 적습니다.
--   · 새 함수에는 Supabase 기본 권한으로 anon · authenticated 실행 권한이
--     "직접" 붙습니다. PUBLIC 만 거두면 anon 은 그대로 부를 수 있어서,
--     관리자 함수는 anon 에서도 따로 거둡니다.
--   · 오류 문구에 열쇠를 넣지 않습니다. raise 문구에는 % 를 쓰지
--     않습니다(자리표시로 읽힙니다).
--
-- 운영자 함수 셋이 돌려주는 한 줄의 모양(화면이 그대로 씁니다)
--   booth_id · code · zone_key · zone_label · name · org ·
--   congestion · wait_minutes · updated_at · issued_at · token_tail
--   issued_at  = 열쇠를 만든(바꾼) 시각, token_tail = 열쇠 끝 4자.
--   운영자 화면 아래쪽에 "열쇠 끝자리 · 발급 시각" 으로 보여 줘서,
--   교체한 뒤 옛 카드를 들고 있는지 현장에서 바로 알 수 있게 합니다.
-- ═══════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────
-- 4-1. booth_ctrl_get(열쇠) — 그 부스의 지금 값 (anon)
--
-- 맞는 열쇠면 한 줄, 아니면 0줄입니다. 0줄은 정상 응답이라 화면이
-- "쓸 수 없는 QR" 과 "네트워크 오류" 를 헷갈리지 않습니다.
--
-- volatile 은 여섯 함수를 같은 모양으로 맞춘 것일 뿐 GET 을 막는 장치가
-- 아닙니다(5번 확인 16이 이것을 봅니다). PostgREST 에서 volatility 는
-- POST 를 읽기 · 쓰기 중 어느 트랜잭션으로 돌릴지만 정합니다. GET 은
-- 함수와 상관없이 늘 읽기 전용으로 돌고, 함수가 실제로 쓸 때만
-- 거절(405)됩니다. 이 함수는 읽기만 하므로 그대로 두면 GET
-- /rpc/booth_ctrl_get?p_token=… 으로도 값이 나옵니다.
--
-- 그래서 요청 방식이 GET · HEAD 면 0줄("쓸 수 없는 QR")을 돌려줍니다.
-- 누가 GET 으로 부르는 화면이나 예시를 만들어도 처음부터 동작하지
-- 않으니 열쇠를 주소에 싣는 방식이 자리 잡지 못합니다. 그렇다고 그
-- GET 요청의 주소(열쇠 포함)가 Supabase 접속 기록에 남는 것까지 막지는
-- 못합니다 — 열쇠를 POST 본문에만 싣는 것은 화면 쪽 약속입니다.
-- request.method 는 PostgREST 가 요청마다 넣는 값입니다. SQL Editor
-- 에서는 NULL 이거나(한 번도 넣지 않음) '' 라서 coalesce 로 '' 로 맞추면
-- 통과합니다. set · touch 가 안에서 이 함수를 부를 때는 그 POST 요청
-- 안이라 통과합니다.
--
-- 열쇠 형식(24자 base64url)이 아니면 표를 보기 전에 0줄입니다.
--
-- code 는 booths.code 가 비었으면 구역-번호(A-01)로 채웁니다. 관리자
-- 화면(admin.js 의 pad2 = padStart)과 같은 규칙입니다. lpad 만 쓰면
-- 세 자리 번호를 잘라 버려(123 → '12') 다른 부스 코드와 겹치므로,
-- 두 자리보다 짧을 때만 0 을 채웁니다.
-- ───────────────────────────────────────────────────────────────
drop function if exists public.booth_ctrl_get(text);
create function public.booth_ctrl_get(p_token text)
returns table (
  booth_id      uuid,
  code          text,
  zone_key      text,
  zone_label    text,
  name          text,
  org           text,
  congestion    text,
  wait_minutes  integer,
  updated_at    timestamptz,
  issued_at     timestamptz,
  token_tail    text
)
language sql
volatile
security definer
set search_path = ''
as $$
  select b.id,
         coalesce(nullif(b.code, ''),
                  b.zone_key || '-' || lpad(b.no::text, greatest(2, length(b.no::text)), '0')),
         b.zone_key,
         z.label,
         b.name,
         b.org,
         l.congestion,
         l.wait_minutes,
         l.updated_at,
         coalesce(a.rotated_at, a.created_at),
         right(a.token, 4)
    from public.booth_access a
    join public.booths b on b.id = a.booth_id
    left join public.zones z on z.key = b.zone_key
    left join public.booth_live l on l.booth_id = b.id
   where p_token ~ '^[A-Za-z0-9_-]{24}$'
     and a.token = p_token
     and a.disabled_at is null
     and coalesce(pg_catalog.current_setting('request.method', true), '') not in ('GET', 'HEAD')
$$;

revoke all     on function public.booth_ctrl_get(text) from public;
grant  execute on function public.booth_ctrl_get(text) to anon, authenticated;

comment on function public.booth_ctrl_get(text) is
  '부스 QR 열쇠로만 동작합니다. anon 실행 권한은 의도된 것입니다 — 보안 점검(anon_security_definer_function_executable) 경고를 보고 거두지 마세요.';


-- ───────────────────────────────────────────────────────────────
-- 4-2. booth_ctrl_set(열쇠, 상태, 대기 분) — 값 바꾸기 (anon)
--
-- 상태(p_mode)
--   'open'    운영 중. 대기 분(0~180)에서 혼잡도를 정합니다.
--   'pause'   잠시 중단(점심 · 재료 준비 · 회차 사이). 대기 0분.
--   'closed'  오늘 마감. 대기 0분.
--
-- 확인 순서: 열쇠 → 상태 → 대기 분. 열쇠가 틀리면 나머지 입력이
-- 맞는지조차 알려 주지 않습니다. 형식이 틀린 열쇠와 없는 열쇠는 같은
-- 문구 · 같은 코드(42501)라 둘을 구별할 수 없습니다. hint 'booth_token_invalid' 를
-- 붙여, 실행 권한이 빠졌을 때 PostgREST 가 내는 42501(permission denied)과
-- 구별합니다 — 운영자 화면은 이 hint 가 있을 때만 '이 QR은 못 써요' 로 보고
-- 저장 대기 값을 지웁니다.
--
-- 저장 시각은 서버 시각(now)입니다. 휴대폰 시계가 틀려도 관람객
-- 화면의 "N분 전" 이 어긋나지 않습니다.
-- ───────────────────────────────────────────────────────────────
drop function if exists public.booth_ctrl_set(text, text, integer);
create function public.booth_ctrl_set(p_token text, p_mode text, p_wait_minutes integer)
returns table (
  booth_id      uuid,
  code          text,
  zone_key      text,
  zone_label    text,
  name          text,
  org           text,
  congestion    text,
  wait_minutes  integer,
  updated_at    timestamptz,
  issued_at     timestamptz,
  token_tail    text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_booth      uuid;
  v_congestion text;
  v_wait       integer;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{24}$' then
    raise exception '이 QR은 쓸 수 없습니다.' using errcode = '42501', hint = 'booth_token_invalid';
  end if;

  select a.booth_id into v_booth
    from public.booth_access a
   where a.token = p_token
     and a.disabled_at is null;

  if v_booth is null then
    raise exception '이 QR은 쓸 수 없습니다.' using errcode = '42501', hint = 'booth_token_invalid';
  end if;

  if p_mode is null or p_mode not in ('open', 'pause', 'closed') then
    raise exception '허용되지 않는 상태입니다.' using errcode = '22023';
  end if;

  if p_mode = 'open' then
    if p_wait_minutes is null or p_wait_minutes not between 0 and 180 then
      raise exception '대기 시간은 0~180분이어야 합니다.' using errcode = '22023';
    end if;
    v_wait := p_wait_minutes;
    v_congestion := case when p_wait_minutes <= 10 then '여유'
                         when p_wait_minutes <= 25 then '보통'
                         else '혼잡' end;
  elsif p_mode = 'pause' then
    v_congestion := '중단';
    v_wait := 0;
  else
    v_congestion := '마감';
    v_wait := 0;
  end if;

  insert into public.booth_live as l (booth_id, congestion, wait_minutes, updated_at)
  values (v_booth, v_congestion, v_wait, pg_catalog.now())
  on conflict on constraint booth_live_pkey do update
     set congestion   = excluded.congestion,
         wait_minutes = excluded.wait_minutes,
         updated_at   = excluded.updated_at;

  insert into public.booth_live_log as g (booth_id, congestion, wait_minutes, source)
  values (v_booth, v_congestion, v_wait, 'set');

  return query select * from public.booth_ctrl_get(p_token);
end;
$$;

revoke all     on function public.booth_ctrl_set(text, text, integer) from public;
grant  execute on function public.booth_ctrl_set(text, text, integer) to anon, authenticated;

comment on function public.booth_ctrl_set(text, text, integer) is
  '부스 QR 열쇠로만 동작합니다. anon 실행 권한은 의도된 것입니다 — 보안 점검(anon_security_definer_function_executable) 경고를 보고 거두지 마세요.';


-- ───────────────────────────────────────────────────────────────
-- 4-3. booth_ctrl_touch(열쇠) — "변동 없음 · 지금 확인" (anon)
--
-- 값은 그대로 두고 입력 시각만 지금으로 당깁니다. 화면이 들고 있던
-- 값을 다시 보내는 방식(set)으로 하면, 그사이 다른 기기에서 바꾼 새
-- 값을 옛 값으로 덮어쓸 수 있습니다. touch 는 서버에 있는 값을 그대로
-- 확인만 하므로 그런 일이 없습니다.
--
-- 오늘(한국 시각) 들어온 값이 없으면 확인할 것이 없다고 돌려보냅니다.
-- 화면들은 어제 값을 "정보 없음" 으로 보는데, 여기서 어제 값의
-- 시각만 오늘로 당기면 어제 값이 오늘 값처럼 되살아납니다. 그래서
-- 같은 날짜일 때만 당깁니다.
-- ───────────────────────────────────────────────────────────────
drop function if exists public.booth_ctrl_touch(text);
create function public.booth_ctrl_touch(p_token text)
returns table (
  booth_id      uuid,
  code          text,
  zone_key      text,
  zone_label    text,
  name          text,
  org           text,
  congestion    text,
  wait_minutes  integer,
  updated_at    timestamptz,
  issued_at     timestamptz,
  token_tail    text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_booth      uuid;
  v_congestion text;
  v_wait       integer;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{24}$' then
    raise exception '이 QR은 쓸 수 없습니다.' using errcode = '42501', hint = 'booth_token_invalid';
  end if;

  select a.booth_id into v_booth
    from public.booth_access a
   where a.token = p_token
     and a.disabled_at is null;

  if v_booth is null then
    raise exception '이 QR은 쓸 수 없습니다.' using errcode = '42501', hint = 'booth_token_invalid';
  end if;

  update public.booth_live as l
     set updated_at = pg_catalog.now()
   where l.booth_id = v_booth
     and (l.updated_at at time zone 'Asia/Seoul')::date
       = (pg_catalog.now() at time zone 'Asia/Seoul')::date
  returning l.congestion, l.wait_minutes into v_congestion, v_wait;

  if not found then
    raise exception '아직 입력한 값이 없습니다. 먼저 대기 시간을 눌러 주세요.' using errcode = '22023';
  end if;

  insert into public.booth_live_log as g (booth_id, congestion, wait_minutes, source)
  values (v_booth, v_congestion, v_wait, 'touch');

  return query select * from public.booth_ctrl_get(p_token);
end;
$$;

revoke all     on function public.booth_ctrl_touch(text) from public;
grant  execute on function public.booth_ctrl_touch(text) to anon, authenticated;

comment on function public.booth_ctrl_touch(text) is
  '부스 QR 열쇠로만 동작합니다. anon 실행 권한은 의도된 것입니다 — 보안 점검(anon_security_definer_function_executable) 경고를 보고 거두지 마세요.';


-- ───────────────────────────────────────────────────────────────
-- 4-4. admin_booth_access() — 모든 부스의 열쇠 (관리자)
--
-- 인쇄 페이지 ① 이 부릅니다. 열쇠 없는 부스에만 새로 만들고(이미
-- 있는 열쇠는 그대로), 모든 부스의 열쇠를 돌려줍니다. 만드는 일이
-- 있어 volatile 입니다.
--
-- 열쇠: 무작위 18바이트 → base64 는 정확히 24자이고 '=' 도 줄바꿈도
-- 붙지 않습니다(18 은 3 의 배수, 76자 미만). '+' '/' 만 주소에 안전한
-- '-' '_' 로 바꿉니다. 그래서 늘 ^[A-Za-z0-9_-]{24}$ 입니다.
--
-- 꺼진 부스(disabled_at 있음)는 token 을 비워(null) 돌려주고 disabled 를
-- true 로 줍니다. 인쇄 화면에 꺼진 열쇠가 QR 로 다시 찍히지 않게 합니다.
-- 꺼진 부스에도 줄은 남아 있으니 새 열쇠를 만들지도 않습니다.
-- ───────────────────────────────────────────────────────────────
drop function if exists public.admin_booth_access();
create function public.admin_booth_access()
returns table (
  booth_id   uuid,
  token      text,
  issued_at  timestamptz,
  rotated    boolean,
  disabled   boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception '관리자만 볼 수 있습니다.' using errcode = '42501';
  end if;

  insert into public.booth_access as a (booth_id, token)
  select b.id, translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_')
    from public.booths b
  on conflict on constraint booth_access_pkey do nothing;

  return query
    select a.booth_id,
           case when a.disabled_at is null then a.token end,
           coalesce(a.rotated_at, a.created_at),
           a.rotated_at is not null,
           a.disabled_at is not null
      from public.booth_access a
     order by a.booth_id;
end;
$$;

revoke all     on function public.admin_booth_access() from public;
revoke execute on function public.admin_booth_access() from anon;
grant  execute on function public.admin_booth_access() to authenticated;

comment on function public.admin_booth_access() is
  '관리자 전용. 열쇠 없는 부스에 운영자 QR 열쇠를 만들고, 모든 부스의 열쇠를 돌려줍니다(꺼진 부스는 token null · disabled true).';


-- ───────────────────────────────────────────────────────────────
-- 4-5. admin_rotate_booth_token(부스) — 열쇠 바꾸기 (관리자)
--
-- 운영자 QR 사진이 단체방에 올라가는 등 유출됐을 때만 씁니다. 바꾸는
-- 순간 옛 카드와, 옛 열쇠로 열려 있던 운영자 화면이 모두 멈춥니다.
-- 잃어버린 경우에는 바꾸지 말고 인쇄 페이지의 'QR 크게 보기' 로 같은
-- 열쇠를 다시 찍게 합니다.
--
-- 열쇠가 아직 없던 부스면 새로 만듭니다(그때는 교체가 아니라 첫
-- 발급이라 rotated_at 은 비어 있습니다).
--
-- 꺼진 열쇠(4-7)를 다시 켜는 길도 이것 하나입니다. 새 열쇠를 내면서
-- disabled_at 을 비웁니다 — 예전 열쇠는 다시 살아나지 않습니다.
-- ───────────────────────────────────────────────────────────────
drop function if exists public.admin_rotate_booth_token(uuid);
create function public.admin_rotate_booth_token(p_booth_id uuid)
returns table (
  token      text,
  issued_at  timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_token  text;
  v_issued timestamptz;
begin
  if not public.is_admin() then
    raise exception '관리자만 열쇠를 바꿀 수 있습니다.' using errcode = '42501';
  end if;

  insert into public.booth_access as a (booth_id, token)
  select b.id, translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_')
    from public.booths b
   where b.id = p_booth_id
  on conflict on constraint booth_access_pkey do update
     set token       = excluded.token,
         rotated_at  = pg_catalog.now(),
         disabled_at = null
  returning a.token, coalesce(a.rotated_at, a.created_at) into v_token, v_issued;

  if not found then
    raise exception '해당 부스를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  return query select v_token, v_issued;
end;
$$;

revoke all     on function public.admin_rotate_booth_token(uuid) from public;
revoke execute on function public.admin_rotate_booth_token(uuid) from anon;
grant  execute on function public.admin_rotate_booth_token(uuid) to authenticated;

comment on function public.admin_rotate_booth_token(uuid) is
  '관리자 전용. 부스의 운영자 QR 열쇠를 새로 바꿉니다(꺼져 있었다면 다시 켭니다) — 옛 카드와 열려 있던 운영자 화면이 바로 멈춥니다.';


-- ───────────────────────────────────────────────────────────────
-- 4-6. admin_reset_booth_live() — 실시간 값 모두 지우기 (관리자)
--
-- 리허설에서 누른 값을 행사 전에 비웁니다. 모든 부스가 "정보 없음"
-- 이 됩니다. 기록(booth_live_log)과 열쇠는 그대로 둡니다. 지운 줄
-- 수를 돌려줍니다.
--
-- where true 는 일부러 적었습니다. Supabase 는 PostgREST 요청에
-- pg-safeupdate 를 걸어 where 없는 delete 를 거절할 수 있고, 함수
-- 안의 문장도 그 검사를 거칩니다.
-- ───────────────────────────────────────────────────────────────
drop function if exists public.admin_reset_booth_live();
create function public.admin_reset_booth_live()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  n integer;
begin
  if not public.is_admin() then
    raise exception '관리자만 지울 수 있습니다.' using errcode = '42501';
  end if;

  delete from public.booth_live as l where true;
  get diagnostics n = row_count;

  return n;
end;
$$;

revoke all     on function public.admin_reset_booth_live() from public;
revoke execute on function public.admin_reset_booth_live() from anon;
grant  execute on function public.admin_reset_booth_live() to authenticated;

comment on function public.admin_reset_booth_live() is
  '관리자 전용. 모든 부스의 실시간 대기 값을 지웁니다(리허설 값 정리). 기록과 열쇠는 남깁니다.';


-- ───────────────────────────────────────────────────────────────
-- 4-7. admin_disable_booth_token(부스) — 열쇠 끄기 (관리자)
--
-- 새 열쇠 없이 그 부스의 운영자 QR 을 멈춥니다. 부스가 일찍 철수했거나,
-- 누가 그 부스 값을 엉뚱하게 바꾸는데 담당 선생님과 아직 연락이 안 될 때.
-- (새 카드를 바로 찍어야 하면 4-5 열쇠 바꾸기.)
--
-- 끌 때 열쇠 문자열도 새 무작위 값으로 바꿔 둡니다. 운영자 함수는 이미
-- disabled_at 으로 거절하지만, 나중에 누가 그 검사를 빠뜨린 함수를 다시
-- 만들어도 옛 열쇠(유출된 그 문자열)는 DB 어디에도 없어서 살아날 수
-- 없습니다. 바뀐 열쇠는 누구에게도 돌려주지 않습니다(4-4 가 null 로 숨김).
-- 이미 꺼져 있으면 처음 끈 시각과 열쇠를 그대로 둡니다.
-- 다시 켜는 길은 4-5 하나입니다(새 열쇠).
-- ───────────────────────────────────────────────────────────────
drop function if exists public.admin_disable_booth_token(uuid);
create function public.admin_disable_booth_token(p_booth_id uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_at timestamptz;
begin
  if not public.is_admin() then
    raise exception '관리자만 열쇠를 끌 수 있습니다.' using errcode = '42501';
  end if;

  update public.booth_access as a
     set token       = case when a.disabled_at is null
                            then translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_')
                            else a.token end,
         disabled_at = coalesce(a.disabled_at, pg_catalog.now())
   where a.booth_id = p_booth_id
  returning a.disabled_at into v_at;

  if not found then
    raise exception '이 부스에는 아직 열쇠가 없습니다.' using errcode = 'P0002';
  end if;

  return v_at;
end;
$$;

revoke all     on function public.admin_disable_booth_token(uuid) from public;
revoke execute on function public.admin_disable_booth_token(uuid) from anon;
grant  execute on function public.admin_disable_booth_token(uuid) to authenticated;

comment on function public.admin_disable_booth_token(uuid) is
  '관리자 전용. 부스의 운영자 QR 열쇠를 새 열쇠 없이 끕니다(열쇠 문자열도 버림). 다시 켜려면 열쇠 바꾸기.';


-- ───────────────────────────────────────────────────────────────
-- 4-8. admin_set_booth_live(부스, 상태, 대기 분) — 직접 고치기 (관리자)
--
-- 운영본부가 열쇠 없이 한 부스의 값을 고칩니다(선생님 휴대폰이 꺼졌거나,
-- 열쇠를 끈 부스의 값이 틀려 있을 때). 규칙은 운영자 입력과 같습니다:
-- 'open' + 대기 분 → 여유 · 보통 · 혼잡, 'pause' → 중단, 'closed' → 마감.
-- 'clear' 는 그 부스 값을 지워 '정보 없음' 으로 되돌립니다(기록 없음 —
-- 기록 표는 값이 있는 입력만 남깁니다).
-- 기록에는 source 'admin' 으로 남아 행사 후에도 운영자 입력과 구별됩니다.
-- 돌려주는 줄: 고친 뒤의 값(clear 면 세 칸이 null).
-- ───────────────────────────────────────────────────────────────
drop function if exists public.admin_set_booth_live(uuid, text, integer);
create function public.admin_set_booth_live(p_booth_id uuid, p_mode text, p_wait_minutes integer)
returns table (
  booth_id      uuid,
  congestion    text,
  wait_minutes  integer,
  updated_at    timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_congestion text;
  v_wait       integer;
  v_at         timestamptz;
begin
  if not public.is_admin() then
    raise exception '관리자만 직접 고칠 수 있습니다.' using errcode = '42501';
  end if;

  if p_booth_id is null or not exists (select 1 from public.booths b where b.id = p_booth_id) then
    raise exception '해당 부스를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  if p_mode is null or p_mode not in ('open', 'pause', 'closed', 'clear') then
    raise exception '허용되지 않는 상태입니다.' using errcode = '22023';
  end if;

  if p_mode = 'clear' then
    delete from public.booth_live as l where l.booth_id = p_booth_id;
    return query select p_booth_id, null::text, null::integer, null::timestamptz;
    return;
  end if;

  if p_mode = 'open' then
    if p_wait_minutes is null or p_wait_minutes not between 0 and 180 then
      raise exception '대기 시간은 0~180분이어야 합니다.' using errcode = '22023';
    end if;
    v_wait := p_wait_minutes;
    v_congestion := case when p_wait_minutes <= 10 then '여유'
                         when p_wait_minutes <= 25 then '보통'
                         else '혼잡' end;
  elsif p_mode = 'pause' then
    v_congestion := '중단';
    v_wait := 0;
  else
    v_congestion := '마감';
    v_wait := 0;
  end if;

  insert into public.booth_live as l (booth_id, congestion, wait_minutes, updated_at)
  values (p_booth_id, v_congestion, v_wait, pg_catalog.now())
  on conflict on constraint booth_live_pkey do update
     set congestion   = excluded.congestion,
         wait_minutes = excluded.wait_minutes,
         updated_at   = excluded.updated_at
  returning l.updated_at into v_at;

  insert into public.booth_live_log as g (booth_id, congestion, wait_minutes, source)
  values (p_booth_id, v_congestion, v_wait, 'admin');

  return query select p_booth_id, v_congestion, v_wait, v_at;
end;
$$;

revoke all     on function public.admin_set_booth_live(uuid, text, integer) from public;
revoke execute on function public.admin_set_booth_live(uuid, text, integer) from anon;
grant  execute on function public.admin_set_booth_live(uuid, text, integer) to authenticated;

comment on function public.admin_set_booth_live(uuid, text, integer) is
  '관리자 전용. 열쇠 없이 한 부스의 대기 값을 고칩니다(open · pause · closed · clear). 기록에는 source admin.';


-- ═══════════════════════════════════════════════════════════════
-- 5. 확인 (읽기만 합니다. 열쇠 값은 조회하지 않습니다)
--
-- '맞음' 칸이 모두 true 여야 합니다. 기대값이 빈 줄(참고)은 맞음도
-- 비어 있습니다 — 개수만 보여 주는 줄입니다.
--
-- '겹치는 부스 코드' 가 0 이 아니면, 관람객 화면의 부스 찾기와 현장
-- 안내가 헷갈립니다. 아래 쿼리로 어느 코드인지 보고 관리자 → 부스에서
-- 코드를 고치세요.
--   select eff, count(*)
--     from (select coalesce(nullif(code, ''),
--                           zone_key || '-' || lpad(no::text, greatest(2, length(no::text)), '0')) as eff
--             from public.booths) s
--    group by eff having count(*) > 1;
-- ═══════════════════════════════════════════════════════════════
select v."항목",
       v."기대",
       v."실제",
       v."기대" = v."실제" as "맞음"
  from (values
    ( 1, 'booth_live 칸',
         'booth_id uuid, congestion text, wait_minutes integer, updated_at timestamp with time zone',
         (select string_agg(att.attname::text || ' ' || pg_catalog.format_type(att.atttypid, att.atttypmod),
                            ', ' order by att.attnum)
            from pg_catalog.pg_attribute att
           where att.attrelid = 'public.booth_live'::regclass
             and att.attnum > 0 and not att.attisdropped)),
    ( 2, 'booth_access 칸',
         'booth_id uuid, token text, created_at timestamp with time zone, rotated_at timestamp with time zone, disabled_at timestamp with time zone',
         (select string_agg(att.attname::text || ' ' || pg_catalog.format_type(att.atttypid, att.atttypmod),
                            ', ' order by att.attnum)
            from pg_catalog.pg_attribute att
           where att.attrelid = 'public.booth_access'::regclass
             and att.attnum > 0 and not att.attisdropped)),
    ( 3, 'booth_live_log 칸',
         'id bigint, booth_id uuid, congestion text, wait_minutes integer, source text, created_at timestamp with time zone',
         (select string_agg(att.attname::text || ' ' || pg_catalog.format_type(att.atttypid, att.atttypmod),
                            ', ' order by att.attnum)
            from pg_catalog.pg_attribute att
           where att.attrelid = 'public.booth_live_log'::regclass
             and att.attnum > 0 and not att.attisdropped)),
    ( 4, '함수가 기대는 제약 이름 (pkey 2 · check 3)', '5',
         (select count(*)
            from pg_catalog.pg_constraint con
           where con.conrelid in ('public.booth_live'::regclass,
                                  'public.booth_access'::regclass,
                                  'public.booth_live_log'::regclass)
             and con.conname in ('booth_live_pkey', 'booth_access_pkey',
                                 'booth_live_congestion_check', 'booth_live_wait_check',
                                 'booth_live_log_source_check'))::text),
    ( 5, 'RLS 켜진 표 (세 표 중)', '3',
         (select count(*)
            from pg_catalog.pg_class cls
           where cls.oid in ('public.booth_live'::regclass,
                             'public.booth_access'::regclass,
                             'public.booth_live_log'::regclass)
             and cls.relrowsecurity)::text),
    ( 6, 'booth_live 정책 수', '1',
         (select count(*) from pg_catalog.pg_policies pol
           where pol.schemaname = 'public' and pol.tablename = 'booth_live')::text),
    ( 7, 'booth_access · booth_live_log 정책 수', '0',
         (select count(*) from pg_catalog.pg_policies pol
           where pol.schemaname = 'public' and pol.tablename in ('booth_access', 'booth_live_log'))::text),
    ( 8, 'anon booth_live 읽기', 'true',
         has_table_privilege('anon', 'public.booth_live', 'SELECT')::text),
    ( 9, 'booth_live 쓰기 (anon · authenticated, insert · update · delete · truncate)', 'false',
         (has_table_privilege('anon', 'public.booth_live', 'INSERT')
          or has_table_privilege('anon', 'public.booth_live', 'UPDATE')
          or has_table_privilege('anon', 'public.booth_live', 'DELETE')
          or has_table_privilege('anon', 'public.booth_live', 'TRUNCATE')
          or has_table_privilege('authenticated', 'public.booth_live', 'INSERT')
          or has_table_privilege('authenticated', 'public.booth_live', 'UPDATE')
          or has_table_privilege('authenticated', 'public.booth_live', 'DELETE')
          or has_table_privilege('authenticated', 'public.booth_live', 'TRUNCATE'))::text),
    (10, 'booth_access 읽기 (authenticated · anon)', 'false',
         (has_table_privilege('authenticated', 'public.booth_access', 'SELECT')
          or has_table_privilege('anon', 'public.booth_access', 'SELECT'))::text),
    (11, 'booth_live_log 읽기 (anon · authenticated)', 'false',
         (has_table_privilege('anon', 'public.booth_live_log', 'SELECT')
          or has_table_privilege('authenticated', 'public.booth_live_log', 'SELECT'))::text),
    (12, 'anon 운영자 함수 실행 (get · set · touch)', 'true',
         (has_function_privilege('anon', 'public.booth_ctrl_get(text)', 'EXECUTE')
          and has_function_privilege('anon', 'public.booth_ctrl_set(text,text,integer)', 'EXECUTE')
          and has_function_privilege('anon', 'public.booth_ctrl_touch(text)', 'EXECUTE'))::text),
    (13, 'anon 관리자 함수 실행 (다섯 중 하나라도)', 'false',
         (has_function_privilege('anon', 'public.admin_booth_access()', 'EXECUTE')
          or has_function_privilege('anon', 'public.admin_rotate_booth_token(uuid)', 'EXECUTE')
          or has_function_privilege('anon', 'public.admin_reset_booth_live()', 'EXECUTE')
          or has_function_privilege('anon', 'public.admin_disable_booth_token(uuid)', 'EXECUTE')
          or has_function_privilege('anon', 'public.admin_set_booth_live(uuid,text,integer)', 'EXECUTE'))::text),
    (14, 'authenticated 관리자 함수 실행 (다섯 모두)', 'true',
         (has_function_privilege('authenticated', 'public.admin_booth_access()', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.admin_rotate_booth_token(uuid)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.admin_reset_booth_live()', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.admin_disable_booth_token(uuid)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.admin_set_booth_live(uuid,text,integer)', 'EXECUTE'))::text),
    (15, '함수 이름마다 정의 1개 (옛 인자 남은 것 없음)',
         'admin_booth_access 1, admin_disable_booth_token 1, admin_reset_booth_live 1, '
         'admin_rotate_booth_token 1, admin_set_booth_live 1, '
         'booth_ctrl_get 1, booth_ctrl_set 1, booth_ctrl_touch 1',
         (select string_agg(f.n || ' ' || (select count(*)
                                             from pg_catalog.pg_proc pro
                                             join pg_catalog.pg_namespace nsp on nsp.oid = pro.pronamespace
                                            where nsp.nspname = 'public'
                                              and pro.proname = f.n)::text,
                            ', ' order by f.n collate "C")
            from unnest(array['admin_booth_access', 'admin_disable_booth_token', 'admin_reset_booth_live',
                              'admin_rotate_booth_token', 'admin_set_booth_live',
                              'booth_ctrl_get', 'booth_ctrl_set', 'booth_ctrl_touch']) as f(n))),
    (16, 'security definer · search_path 빈 값 · volatile (여덟 함수)', '8',
         (select count(*)
            from pg_catalog.pg_proc pro
            join pg_catalog.pg_namespace nsp on nsp.oid = pro.pronamespace
           where nsp.nspname = 'public'
             and pro.proname in ('admin_booth_access', 'admin_disable_booth_token', 'admin_reset_booth_live',
                                 'admin_rotate_booth_token', 'admin_set_booth_live',
                                 'booth_ctrl_get', 'booth_ctrl_set', 'booth_ctrl_touch')
             and pro.prosecdef
             and pro.provolatile = 'v'
             and pro.proconfig = array['search_path=""'])::text),
    (17, 'Realtime 발행에 올라간 부스 표', '0',
         (select count(*) from pg_catalog.pg_publication_tables pub
           where pub.pubname = 'supabase_realtime'
             and pub.schemaname = 'public'
             and pub.tablename in ('booths', 'booth_live', 'booth_access', 'booth_live_log'))::text),
    (18, '겹치는 부스 코드 (위 주석의 쿼리로 확인)', '0',
         (select count(*)
            from (select 1
                    from public.booths b
                   group by coalesce(nullif(b.code, ''),
                                     b.zone_key || '-' || lpad(b.no::text, greatest(2, length(b.no::text)), '0'))
                  having count(*) > 1) dup)::text),
    (19, '운영자 함수 세 개 모두 꺼진 열쇠 거절', 'true',
         ((select pg_catalog.pg_get_functiondef('public.booth_ctrl_get(text)'::regprocedure) like '%disabled_at is null%')
          and (select pg_catalog.pg_get_functiondef('public.booth_ctrl_set(text,text,integer)'::regprocedure) like '%disabled_at is null%')
          and (select pg_catalog.pg_get_functiondef('public.booth_ctrl_touch(text)'::regprocedure) like '%disabled_at is null%'))::text),
    (20, '기록 출처에 admin 포함 (set · touch · admin)', 'true',
         (select pg_catalog.pg_get_constraintdef(con.oid) like '%admin%'
            from pg_catalog.pg_constraint con
           where con.conrelid = 'public.booth_live_log'::regclass
             and con.conname = 'booth_live_log_source_check')::text),
    (21, '자동 번호 순서기 anon 사용 권한', 'false',
         has_sequence_privilege('anon', 'public.booth_live_log_id_seq', 'USAGE')::text),
    (22, '여덟 함수의 소유자가 postgres (정의자 함수의 권한 주체)', '8',
         (select count(*)
            from pg_catalog.pg_proc pro
            join pg_catalog.pg_namespace nsp on nsp.oid = pro.pronamespace
           where nsp.nspname = 'public'
             and pro.proname in ('admin_booth_access', 'admin_disable_booth_token', 'admin_reset_booth_live',
                                 'admin_rotate_booth_token', 'admin_set_booth_live',
                                 'booth_ctrl_get', 'booth_ctrl_set', 'booth_ctrl_touch')
             and pg_catalog.pg_get_userbyid(pro.proowner) = 'postgres')::text),
    (23, '참고: 부스 수', null,
         (select count(*) from public.booths)::text),
    (24, '참고: 켜진 열쇠가 있는 부스 수 (인쇄 페이지 ① 을 열면 부스 수와 같아짐)', null,
         (select count(*) from public.booth_access a where a.disabled_at is null)::text),
    (25, '참고: 대기 값이 있는 부스 수', null,
         (select count(*) from public.booth_live)::text)
  ) as v("순서", "항목", "기대", "실제")
 order by v."순서";


-- ═══════════════════════════════════════════════════════════════
-- 6. 행사 전 — 시험 값 지우기 (필요할 때 따로 실행)
--
-- 리허설에서 누른 값이 남아 있으면 첫날 아침 관람객 화면에 보일 수
-- 있습니다. 인쇄 페이지(관리자 로그인)의 '실시간 값 모두 지우기'
-- 버튼을 누르거나, SQL Editor 에서:
--
--   delete from public.booth_live;
--
-- TRUNCATE 는 쓰지 않습니다. 표 전체를 가장 센 잠금으로 막아 그동안
-- 관람객 · 포털 조회까지 멈춥니다. 열쇠와 기록은 그대로 둡니다.
-- ═══════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- 7. 행사 후 — 열쇠 거두기와 결과 보고 (11. 7. 17:00 이후, 따로 실행)
--
-- 먼저 보고서를 뽑습니다. 부스 · 시간대별 평균 대기와 입력 수입니다.
--   · 'touch' 는 값이 그대로라 셈에서 뺍니다. 'admin'(운영본부 직접 수정)은
--     실제로 값이 바뀐 것이라 운영자 입력('set')과 함께 셉니다.
--   · 중단 · 마감도 대기 0분으로 기록되므로 평균에 넣으면 '마감' 을 누른
--     마지막 시간대마다 평균이 0 쪽으로 끌려 내려갑니다. 그래서 평균대기 ·
--     입력수는 운영 중(여유 · 보통 · 혼잡) 값만 세고, 중단 · 마감은
--     중단마감수로 따로 셉니다. 중단만 있던 시간대도 빠지지 않고 평균대기가
--     빈 칸(NULL)으로 나옵니다.
--   · 평균은 누른 횟수 기준입니다(시간 가중 아님). 30분을 한 번 누르고
--     50분 동안 그대로 둔 것과 5분 뒤 바꾼 것을 같은 무게로 셉니다.
--   · 코드는 위 4-1 과 같은 규칙(비었으면 구역-번호)으로 맞춥니다.
--
--   select coalesce(nullif(b.code, ''),
--                   b.zone_key || '-' || lpad(b.no::text, greatest(2, length(b.no::text)), '0')) as code,
--          b.name,
--          date_trunc('hour', l.created_at at time zone 'Asia/Seoul') as 시각,
--          round(avg(l.wait_minutes) filter (where l.congestion in ('여유', '보통', '혼잡'))) as 평균대기,
--          count(*) filter (where l.congestion in ('여유', '보통', '혼잡')) as 입력수,
--          count(*) filter (where l.congestion in ('중단', '마감')) as 중단마감수
--     from public.booth_live_log l
--     join public.booths b on b.id = l.booth_id
--    where l.source in ('set', 'admin')
--    group by 1, 2, 3
--    order by 1, 3;
--
-- 그다음 열쇠와 지금 값을 지웁니다. 인쇄한 운영자 카드는 이때부터
-- 모두 "쓸 수 없는 QR" 이 됩니다. 행사가 끝난 뒤에도 카드 사진이
-- 돌아다니므로 꼭 지웁니다.
--
--   delete from public.booth_access;
--   delete from public.booth_live;
--
-- 기록(booth_live_log)은 보고가 끝날 때까지 둡니다.
-- ═══════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- 8. 부스를 가져올 때(import) 주의
--
-- 운영자 QR 을 인쇄한 뒤에는 부스를 지웠다가 다시 만들지 마세요.
-- booths 의 줄을 지우면 그 부스의 열쇠 · 지금 값 · 기록이 함께
-- 지워지고(on delete cascade), 새로 만든 줄은 id 가 달라서 인쇄한
-- 운영자 카드와 부스 앞 안내 QR(부스 id 를 담고 있음)이 모두 멈춥니다.
-- 구역(zones)을 지워도 그 구역의 부스가 함께 지워져 같은 일이 생깁니다.
-- 이름 · 코드 · 구역을 바꿀 때는 그 줄을 고쳐(update) 주세요.
-- ═══════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- 9. 되돌리기 (이 기능을 통째로 걷어낼 때만, 따로 실행)
--
-- 지금 값 · 열쇠 · 기록이 모두 사라집니다. 표가 없으면 관람객 화면은
-- "행사 당일부터 표시" 안내로 바뀌고, 포털은 대기 표시만 빠집니다.
--
--   drop function if exists public.booth_ctrl_touch(text);
--   drop function if exists public.booth_ctrl_set(text, text, integer);
--   drop function if exists public.booth_ctrl_get(text);
--   drop function if exists public.admin_booth_access();
--   drop function if exists public.admin_rotate_booth_token(uuid);
--   drop function if exists public.admin_reset_booth_live();
--   drop function if exists public.admin_disable_booth_token(uuid);
--   drop function if exists public.admin_set_booth_live(uuid, text, integer);
--   drop table if exists public.booth_live_log;
--   drop table if exists public.booth_access;
--   drop table if exists public.booth_live;
-- ═══════════════════════════════════════════════════════════════
