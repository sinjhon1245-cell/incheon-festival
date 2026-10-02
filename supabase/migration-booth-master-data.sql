-- ===================================================================
-- 부스 · 구역 기준 데이터 정비 (Phase 1a) — 초안, 아직 적용하지 않음
--
--   실제 부스 · 구역이 들어오기 전에(2026-10-02 조회: zones 0 · booths 0)
--   관리자 포털을 기준 데이터(Source of Truth)로 삼을 수 있게 구조를
--   바로잡습니다.
--
--   이 파일이 하는 일
--     1. 공개 여부      zones · booths 에 is_published(기본 false) — 관람객 ·
--                       부스 운영자는 공개한 것만 봅니다. booths.status
--                       (준비 전 … 운영 종료)는 뜻을 바꾸지 않습니다.
--                       부스가 보이려면 넷 다: 구역 배정 · 번호 배정 · 구역 공개 · 부스 공개.
--     2. 미배정 허용    booths.zone_key · booths.no 를 비울 수 있게 합니다.
--                       구역 · 번호가 정해지기 전에도 부스를 먼저 등록합니다.
--     3. 구역 삭제      on delete cascade → set null. 구역을 지워도 부스와
--                       그 대기 현황 · 열쇠 · 기록은 남고 부스는 미배정이 됩니다.
--                       on update cascade(구역 코드 바꾸기)는 그대로 둡니다.
--     4. 부스 번호      no(정수)가 유일한 기준입니다. code('A-01')는 DB 가
--                       zone_key + no 로 만들어 채웁니다(손으로 넣은 값은 무시).
--                       같은 구역 같은 번호는 막고, 미배정 부스는 여럿 둡니다.
--     4-1. 공개 지키기  트리거 하나와 검사 하나로 '공개인데 자리가 없는' 부스를 막습니다.
--                       · 미배정이 되면(구역 · 번호를 비우거나 구역을 지워 set null) 저절로 비공개.
--                         나중에 구역만 다시 정했을 때 뜻하지 않게 바로 공개되지 않게 합니다.
--                       · 공개를 켤 때 구역 · 번호가 없으면 거절, 구역이 비공개여도 거절.
--                       · 구역을 비공개로 바꿔도 부스의 공개 값은 그대로 둡니다(구역이 막음).
--     5. 공개 읽기 정책 anon · authenticated 는 공개 구역 · 공개 부스 · 공개 부스의
--                       대기 현황만 읽습니다. 관리자(is_admin())는 전부 봅니다.
--     6. 운영자 함수    booth_ctrl_get · set · touch 는 공개 + 배정된 부스(공개
--                       구역)에서만 동작합니다. 그 밖의 열쇠는 '모르는 열쇠' 와
--                       똑같이 거절합니다.
--     7. 열쇠 발급      admin_booth_access() 는 조회만 합니다(더는 열쇠를 저절로
--                       만들지 않음). 발급은 admin_issue_booth_tokens() 로 따로,
--                       바꾸기(admin_rotate_booth_token)는 이미 있는 열쇠만.
--
--   이 파일이 하지 않는 일 (Phase 1b · 다음 단계)
--     · booths 의 내부 칸(manager · manager_phone · memo · notes) 분리
--       → migration-booth-private.sql. 지금 main 에서 배포 중인 운영 포털이
--         그 칸을 anon 으로 읽고 있어, 포털 배포와 함께 적용해야 합니다.
--     · PIN · 임시 운영자 세션 · 새 운영자 화면
--     · 부스 삭제를 소프트 삭제로 바꾸기(부스를 지우면 지금처럼 대기 현황 ·
--       열쇠 · 기록도 함께 지워집니다 — 관리자 화면의 경고로 다룹니다)
--
--   main 에서 배포 중인 화면과의 호환
--     지금 운영 포털(main)과 같은 DB 를 씁니다. 이 파일은 그 화면을 깨지
--     않게 짰습니다.
--       · 포털(anon)  zones · booths 를 읽는 칸은 그대로 있습니다. 공개한 것이
--                     없으면 빈 목록이고, 포털은 지금처럼 협의용 예시를 보여 줍니다.
--       · 관리자      code · no · zone_key 를 함께 보내도 저장됩니다(code 는 DB 가
--                     다시 셈합니다). 다만 새로 만든 구역 · 부스는 비공개라, 공개
--                     단추가 있는 새 관리자 화면 전에는 관람객에게 보이지 않습니다.
--
-- 사용법 (승인 뒤): Supabase MCP apply_migration 또는 SQL Editor 에 전체 붙여넣고 Run.
--   여러 번 실행해도 같은 결과입니다.
--   BEGIN/COMMIT 은 넣지 않습니다 — SQL Editor · apply_migration 이 이미 한
--   트랜잭션으로 돌려, 중간에 실패하면 전부 되돌아갑니다
--   (migration-private-contacts.sql 의 '원자성' 설명과 같은 이유).
--   psql 로 돌린다면: psql -1 -v ON_ERROR_STOP=1 -f 이 파일
--
-- 되돌리기: rollback-booth-master-data.sql (1a 부분)
-- 선행: migration-booth-live.sql · migration-booth-live-admin.sql
-- ===================================================================


-- ═══════════════════════════════════════════════════════════════
-- 0. 선행 조건 · 데이터 검사 (아무것도 바꾸지 않습니다)
--    실패하면 무엇이 문제인지 적고 멈춥니다. 트랜잭션이라 남는 것이 없습니다.
-- ═══════════════════════════════════════════════════════════════
do $preflight$
declare
  n bigint;
begin
  if to_regclass('public.zones') is null or to_regclass('public.booths') is null then
    raise exception '선행 조건 누락: public.zones · public.booths 가 없습니다.';
  end if;
  if to_regclass('public.booth_live') is null or to_regclass('public.booth_access') is null
     or to_regclass('public.booth_live_log') is null then
    raise exception '선행 조건 누락: booth_live · booth_access · booth_live_log 가 없습니다. migration-booth-live.sql 을 먼저 적용하세요.';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception '선행 조건 누락: public.is_admin() 이 없습니다.';
  end if;
  if to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception '선행 조건 누락: extensions.gen_random_bytes() 가 없습니다(pgcrypto).';
  end if;

  -- 번호 0 이하 · 1000 이상은 새 검사(1~999)에 걸립니다. 있으면 사람이 먼저 고칩니다.
  select count(*) into n from public.booths where no is not null and (no < 1 or no > 999);
  if n > 0 then
    raise exception '부스 % 곳의 번호(no)가 1~999 밖입니다. 먼저 고친 뒤 다시 실행하세요.', n;
  end if;

  -- 같은 구역 같은 번호가 이미 있으면 유일 제약을 걸 수 없습니다.
  select count(*) into n from (
    select zone_key, no from public.booths
     where zone_key is not null and no is not null
     group by zone_key, no having count(*) > 1
  ) d;
  if n > 0 then
    raise exception '같은 구역 · 같은 번호인 부스 묶음이 % 개 있습니다. 먼저 번호를 나눈 뒤 다시 실행하세요.', n;
  end if;

  -- 이미 등록된 것이 있으면 알려만 줍니다. 새 칸 is_published 는 false 로
  -- 시작하므로, 적용하는 순간 관람객 · 포털에서 사라집니다(공개를 눌러야 다시 보임).
  select count(*) into n from public.booths;
  if n > 0 then raise notice '부스 % 곳이 비공개로 시작합니다. 관리자에서 공개해야 보입니다.', n; end if;
  select count(*) into n from public.zones;
  if n > 0 then raise notice '구역 % 개가 비공개로 시작합니다. 관리자에서 공개해야 보입니다.', n; end if;
end
$preflight$;


-- ═══════════════════════════════════════════════════════════════
-- 1. 공개 여부 칸
--    이름은 이 프로젝트의 다른 참/거짓 칸(contacts.is_staff 등)처럼 is_ 로 시작합니다.
--    기본 false — 만들자마자 보이는 일이 없게, 사람이 공개를 눌러야 보입니다.
-- ═══════════════════════════════════════════════════════════════
alter table public.zones  add column if not exists is_published boolean not null default false;
alter table public.booths add column if not exists is_published boolean not null default false;

comment on column public.zones.is_published  is '관람객 · 부스 운영자에게 보이는가. 기본 false(관리자만 봄).';
comment on column public.booths.is_published is '관람객 · 부스 운영자에게 보이는가. 기본 false. 공개해도 구역 · 번호가 없거나 구역이 비공개면 보이지 않습니다. status(운영 상태)와는 별개입니다.';


-- ═══════════════════════════════════════════════════════════════
-- 2. 미배정 허용 + 구역 삭제 시 부스를 남김
--    FK 는 지금처럼 zones.key(구역 코드)를 가리킵니다. 코드를 바꾸면 부스도
--    따라 바뀌고(on update cascade), 구역을 지우면 부스는 미배정이 됩니다
--    (on delete set null). 부스에 딸린 대기 현황 · 열쇠 · 기록은 그대로 남습니다.
-- ═══════════════════════════════════════════════════════════════
alter table public.booths alter column zone_key drop not null;
alter table public.booths alter column no       drop not null;

alter table public.booths drop constraint if exists booths_zone_key_fkey;
alter table public.booths add  constraint booths_zone_key_fkey
  foreign key (zone_key) references public.zones(key)
  on update cascade on delete set null;

alter table public.booths drop constraint if exists booths_no_check;
alter table public.booths add  constraint booths_no_check
  check (no is null or no between 1 and 999);

comment on column public.booths.zone_key is '구역 코드(zones.key). 비어 있으면 미배정.';
comment on column public.booths.no       is '구역 안의 부스 번호(1~999). 실제 부스 번호의 유일한 기준. 비어 있으면 미배정.';


-- ═══════════════════════════════════════════════════════════════
-- 3. 같은 구역 같은 번호 금지 — 미배정 부스는 여럿 허용
--    nulls distinct(기본값)라 zone_key 나 no 가 비어 있는 줄끼리는 겹쳐도 됩니다.
--    색인의 맨 앞 칸이 zone_key 라 FK(zone_key) 색인도 겸합니다.
-- ═══════════════════════════════════════════════════════════════
alter table public.booths drop constraint if exists booths_zone_no_key;
alter table public.booths add  constraint booths_zone_no_key unique nulls distinct (zone_key, no);


-- ═══════════════════════════════════════════════════════════════
-- 4. 저장할 때마다 — code 만들기 · 공개 지키기 (트리거 하나)
--
--  4-a. code 는 DB 가 만듭니다 (zone_key + 두 자리 번호)
--    'A' + 1 → 'A-01', 'A' + 12 → 'A-12', 'A' + 101 → 'A-101'. 미배정이면 ''.
--    관람객 화면 · 운영자 함수 · 인쇄 화면 · 포털이 지금 code 를 읽으므로 칸은
--    남기되, 사람이 적는 값이 아니게 합니다. 손으로 보낸 code 는 무시하고 다시 셉니다.
--    생성 칸(generated column) 대신 트리거를 쓰는 까닭: 지금 main 의 관리자
--    화면이 code 를 함께 보내는데, 생성 칸은 값을 보내면 저장을 거절합니다.
--    구역 코드를 바꿀 때(on update cascade)도 이 트리거가 돌아 code 가 따라 바뀝니다.
--    운영자 함수(booth_ctrl_get)와 같은 셈법입니다.
--
--  4-b. 공개 지키기
--    '이번 저장으로 공개를 켜는가'(새 줄이면 공개 값, 고치는 줄이면 꺼져 있다가 켜짐)를
--    따로 봅니다. 이미 공개인 부스를 고치는 저장은 막지 않습니다 — 구역을 나중에
--    비공개로 바꾼 뒤에도 그 부스의 이름 · 설명은 고칠 수 있어야 합니다.
--      · 구역이나 번호가 비면:   켜는 중이면 거절, 아니면 저절로 비공개로 저장.
--                                구역 삭제(on delete set null)도 이 길로 와서 비공개가 됩니다.
--      · 켜는 중인데 구역이 비공개면 거절.
--    오류 문구는 관리자 화면이 그대로 보여 줍니다(23514 · hint 로 갈래 구분).
--    보안 정의자가 아닙니다(security invoker) — 저장하는 사람(관리자)의 권한으로
--    zones 를 봅니다. 관리자만 booths 를 고칠 수 있으므로 그것으로 충분합니다.
-- ═══════════════════════════════════════════════════════════════
create or replace function public.booths_before_write()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  v_opening boolean;
begin
  new.code := case
    when new.zone_key is not null and new.no is not null
      then new.zone_key || '-' || lpad(new.no::text, greatest(2, length(new.no::text)), '0')
    else ''
  end;

  if tg_op = 'INSERT' then
    v_opening := coalesce(new.is_published, false);
  else
    v_opening := coalesce(new.is_published, false) and not coalesce(old.is_published, false);
  end if;

  if new.zone_key is null or new.no is null then
    if v_opening then
      raise exception '구역과 부스 번호를 먼저 지정해 주세요.'
        using errcode = '23514', hint = 'booth_publish_needs_slot';
    end if;
    new.is_published := false;
  elsif v_opening and not exists (
    select 1 from public.zones z where z.key = new.zone_key and z.is_published
  ) then
    raise exception '현재 구역이 비공개 상태입니다. 구역을 먼저 공개해 주세요.'
      using errcode = '23514', hint = 'booth_publish_zone_hidden';
  end if;

  return new;
end;
$$;

comment on function public.booths_before_write() is 'booths 저장 때: code 를 zone_key + 두 자리 no 로 채우고, 미배정이면 비공개로 · 자리 없거나 구역 비공개면 공개 거절(트리거 전용).';

drop trigger if exists trg_booths_code         on public.booths;  -- 앞 초안의 이름
drop function if exists public.booths_derive_code();
drop trigger if exists trg_booths_before_write on public.booths;
create trigger trg_booths_before_write
  before insert or update on public.booths
  for each row execute function public.booths_before_write();

-- 트리거가 꺼지는 일이 있어도 '공개인데 자리가 없는' 줄은 표가 받지 않습니다.
alter table public.booths drop constraint if exists booths_published_needs_slot;
alter table public.booths add  constraint booths_published_needs_slot
  check (not is_published or (zone_key is not null and no is not null));

-- 이미 있는 줄도 같은 규칙으로 맞춥니다(지금은 0줄).
update public.booths set code = code;

comment on column public.booths.code is '표시용 부스 번호(예: A-01). DB 가 zone_key + no 로 만듭니다 — 직접 적지 않습니다. 미배정이면 빈 글자.';


-- ═══════════════════════════════════════════════════════════════
-- 5. 공개 읽기 정책
--    anon · authenticated: 공개한 것만. 관리자: 기존 '관리자 편집'(ALL, is_admin())
--    정책이 함께 있어 전부 봅니다(허용 정책끼리는 OR).
--    booths 정책 안의 zones 조회 · booth_live 정책 안의 booths 조회에도 RLS 가
--    걸리므로, 같은 '공개' 규칙이 사슬처럼 이어집니다.
-- ═══════════════════════════════════════════════════════════════
drop policy if exists "누구나 열람"   on public.zones;
drop policy if exists "공개 구역 열람" on public.zones;
create policy "공개 구역 열람" on public.zones
  for select to anon, authenticated
  using (is_published);

drop policy if exists "누구나 열람"   on public.booths;
drop policy if exists "공개 부스 열람" on public.booths;
create policy "공개 부스 열람" on public.booths
  for select to anon, authenticated
  using (
    is_published
    and no is not null
    and exists (select 1 from public.zones z where z.key = booths.zone_key and z.is_published)
  );

drop policy if exists "누구나 열람"        on public.booth_live;
drop policy if exists "공개 부스 대기 열람" on public.booth_live;
create policy "공개 부스 대기 열람" on public.booth_live
  for select to anon, authenticated
  using (exists (select 1 from public.booths b where b.id = booth_live.booth_id));

-- anon 은 이 두 표를 읽기만 합니다. 쓰기는 RLS 가 이미 막지만(관리자 정책뿐),
-- 권한도 거둬 두 겹으로 둡니다. authenticated 는 관리자가 쓰므로 그대로 둡니다.
revoke insert, update, delete, truncate, references, trigger on public.zones  from anon;
revoke insert, update, delete, truncate, references, trigger on public.booths from anon;


-- ═══════════════════════════════════════════════════════════════
-- 6. 운영자 함수 — 공개 + 배정된 부스에서만
--    열쇠가 맞아도 부스가 비공개 · 미배정이거나 구역이 비공개면 '모르는 열쇠' 와
--    똑같이 거절합니다(get 은 0줄, set · touch 는 42501 + hint booth_token_invalid).
--    운영자 화면은 이 응답을 이미 '이 QR은 쓸 수 없어요' 로 처리합니다 — 화면을
--    고치지 않아도 됩니다. 다시 공개하면 같은 열쇠가 그대로 다시 동작합니다.
--    인자 · 돌려주는 모양은 그대로라 create or replace 로 바꿉니다(권한 유지).
-- ═══════════════════════════════════════════════════════════════
create or replace function public.booth_ctrl_get(p_token text)
  returns table (
    booth_id uuid, code text, zone_key text, zone_label text, name text, org text,
    congestion text, wait_minutes integer, updated_at timestamptz,
    issued_at timestamptz, token_tail text
  )
  language sql
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
    join public.zones  z on z.key = b.zone_key
    left join public.booth_live l on l.booth_id = b.id
   where p_token ~ '^[A-Za-z0-9_-]{24}$'
     and a.token = p_token
     and a.disabled_at is null
     and b.is_published
     and z.is_published
     and b.no is not null
     and coalesce(pg_catalog.current_setting('request.method', true), '') not in ('GET', 'HEAD')
$$;

create or replace function public.booth_ctrl_set(p_token text, p_mode text, p_wait_minutes integer)
  returns table (
    booth_id uuid, code text, zone_key text, zone_label text, name text, org text,
    congestion text, wait_minutes integer, updated_at timestamptz,
    issued_at timestamptz, token_tail text
  )
  language plpgsql
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
    join public.booths b on b.id = a.booth_id
    join public.zones  z on z.key = b.zone_key
   where a.token = p_token
     and a.disabled_at is null
     and b.is_published
     and z.is_published
     and b.no is not null;
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

create or replace function public.booth_ctrl_touch(p_token text)
  returns table (
    booth_id uuid, code text, zone_key text, zone_label text, name text, org text,
    congestion text, wait_minutes integer, updated_at timestamptz,
    issued_at timestamptz, token_tail text
  )
  language plpgsql
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
    join public.booths b on b.id = a.booth_id
    join public.zones  z on z.key = b.zone_key
   where a.token = p_token
     and a.disabled_at is null
     and b.is_published
     and z.is_published
     and b.no is not null;
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

revoke all     on function public.booth_ctrl_get(text)                  from public;
revoke all     on function public.booth_ctrl_set(text, text, integer)   from public;
revoke all     on function public.booth_ctrl_touch(text)                from public;
grant  execute on function public.booth_ctrl_get(text)                  to anon, authenticated;
grant  execute on function public.booth_ctrl_set(text, text, integer)   to anon, authenticated;
grant  execute on function public.booth_ctrl_touch(text)                to anon, authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 7. 열쇠 — 조회와 발급을 나눕니다
--   admin_booth_access()          조회만. 열쇠가 없는 부스는 줄이 없습니다.
--                                 (예전: 인쇄 화면을 열기만 해도 모든 부스에 열쇠를 만듦)
--   admin_issue_booth_tokens(ids) 발급. 구역 · 번호가 배정된 부스 가운데 열쇠가
--                                 없는 것에만 새로 만듭니다. ids 를 비우면 그런 부스
--                                 전부. 이미 있는 열쇠는 건드리지 않습니다.
--                                 공개 전에도 발급할 수 있습니다 — 카드를 미리 인쇄하고
--                                 행사 날 공개하는 순서를 막지 않으려는 것입니다. 공개
--                                 전에는 운영자 함수(6번)가 그 열쇠를 거절합니다.
--   admin_rotate_booth_token(id)  바꾸기. 이미 있는 열쇠만(없으면 P0002 — 먼저 발급).
--   admin_disable_booth_token(id) 그대로.
-- ═══════════════════════════════════════════════════════════════
create or replace function public.admin_booth_access()
  returns table (booth_id uuid, token text, issued_at timestamptz, rotated boolean, disabled boolean)
  language plpgsql
  security definer
  set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception '관리자만 볼 수 있습니다.' using errcode = '42501';
  end if;
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

create or replace function public.admin_issue_booth_tokens(p_booth_ids uuid[] default null)
  returns table (booth_id uuid, token text, issued_at timestamptz)
  language plpgsql
  security definer
  set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception '관리자만 열쇠를 발급할 수 있습니다.' using errcode = '42501';
  end if;
  return query
    with issued as (
      insert into public.booth_access as a (booth_id, token)
      select b.id, translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_')
        from public.booths b
        join public.zones  z on z.key = b.zone_key
       where b.no is not null
         and (p_booth_ids is null or b.id = any (p_booth_ids))
      on conflict on constraint booth_access_pkey do nothing
      returning a.booth_id, a.token, a.created_at
    )
    select i.booth_id, i.token, i.created_at from issued i order by i.booth_id;
end;
$$;

comment on function public.admin_issue_booth_tokens(uuid[]) is '구역 · 번호가 배정됐고 열쇠가 없는 부스에 운영자 QR 열쇠를 발급합니다(관리자 전용). 인자를 비우면 그런 부스 전부.';

create or replace function public.admin_rotate_booth_token(p_booth_id uuid)
  returns table (token text, issued_at timestamptz)
  language plpgsql
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
  update public.booth_access as a
     set token       = translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_'),
         rotated_at  = pg_catalog.now(),
         disabled_at = null
   where a.booth_id = p_booth_id
  returning a.token, coalesce(a.rotated_at, a.created_at) into v_token, v_issued;
  if not found then
    raise exception '아직 열쇠를 발급하지 않은 부스입니다. 먼저 발급해 주세요.' using errcode = 'P0002';
  end if;
  return query select v_token, v_issued;
end;
$$;

revoke all     on function public.admin_booth_access()                  from public;
revoke all     on function public.admin_issue_booth_tokens(uuid[])      from public;
revoke all     on function public.admin_rotate_booth_token(uuid)        from public;
revoke execute on function public.admin_booth_access()                  from anon;
revoke execute on function public.admin_issue_booth_tokens(uuid[])      from anon;
revoke execute on function public.admin_rotate_booth_token(uuid)        from anon;
grant  execute on function public.admin_booth_access()                  to authenticated;
grant  execute on function public.admin_issue_booth_tokens(uuid[])      to authenticated;
grant  execute on function public.admin_rotate_booth_token(uuid)        to authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 8. API 가 새 칸 · 함수를 바로 알도록
-- ═══════════════════════════════════════════════════════════════
notify pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════
-- 9. 확인 (읽기만 합니다 — 적용 뒤 결과를 눈으로 봅니다)
-- ═══════════════════════════════════════════════════════════════
select 'booths.zone_key nullable' as 확인, is_nullable = 'YES' as 맞음
  from information_schema.columns where table_schema = 'public' and table_name = 'booths' and column_name = 'zone_key'
union all
select 'booths.no nullable', is_nullable = 'YES'
  from information_schema.columns where table_schema = 'public' and table_name = 'booths' and column_name = 'no'
union all
select 'zone FK on delete set null', pg_get_constraintdef(oid) like '%ON DELETE SET NULL%'
  from pg_constraint where conname = 'booths_zone_key_fkey'
union all
select 'unique (zone_key, no)', count(*) = 1 from pg_constraint where conname = 'booths_zone_no_key'
union all
select '저장 트리거(code · 공개 지키기)', count(*) = 1 from pg_trigger where tgname = 'trg_booths_before_write'
union all
select '공개는 자리 있는 부스만(검사)', count(*) = 1 from pg_constraint where conname = 'booths_published_needs_slot'
union all
select 'zones 공개 정책', count(*) = 1 from pg_policies where tablename = 'zones' and policyname = '공개 구역 열람'
union all
select 'booths 공개 정책', count(*) = 1 from pg_policies where tablename = 'booths' and policyname = '공개 부스 열람'
union all
select 'booth_live 공개 정책', count(*) = 1 from pg_policies where tablename = 'booth_live' and policyname = '공개 부스 대기 열람'
union all
select '옛 누구나 열람 정책 없음', count(*) = 0 from pg_policies
 where tablename in ('zones', 'booths', 'booth_live') and policyname = '누구나 열람'
union all
select 'admin_issue_booth_tokens anon 불가', not has_function_privilege('anon', 'public.admin_issue_booth_tokens(uuid[])', 'execute')
union all
select 'booth_ctrl_set anon 가능', has_function_privilege('anon', 'public.booth_ctrl_set(text, text, integer)', 'execute');
