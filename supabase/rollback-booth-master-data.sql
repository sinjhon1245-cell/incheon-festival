-- ===================================================================
-- 되돌리기: migration-booth-private.sql(1b) · migration-booth-master-data.sql(1a)
-- — 초안. 적용한 순서의 반대로, 필요한 부분만 돌립니다.
--
--   A. 1b 되돌리기  booths 에 내부 칸을 다시 만들고 booth_private 의 값을 옮긴 뒤
--                   booth_private 를 지웁니다. ⚠️ 그 칸은 다시 anon 이 읽게 됩니다.
--   B. 1a 되돌리기  2026-10-02 production 상태(정책 · 제약 · 함수 본문)로 돌립니다.
--                   미배정 부스(zone_key 또는 no 가 빈 부스)가 있으면 NOT NULL 을
--                   되살릴 수 없어 멈춥니다 — 먼저 배정하거나 지우세요.
--                   is_published 값은 사라집니다(되돌린 뒤에는 모두 공개).
--
--   한 번에 둘 다 돌릴 때는 A → B 순서 그대로 이 파일 전체를 실행합니다.
--   1a 만 적용했다면 A 는 아무것도 바꾸지 않고 지나갑니다.
-- ===================================================================


-- ═══════════════════════════════════════════════════════════════
-- A. 1b 되돌리기
-- ═══════════════════════════════════════════════════════════════
alter table public.booths add column if not exists manager       text not null default '';
alter table public.booths add column if not exists manager_phone text not null default '';
alter table public.booths add column if not exists memo          text not null default '';
alter table public.booths add column if not exists notes         text not null default '';

do $back$
begin
  if to_regclass('public.booth_private') is not null then
    update public.booths b
       set manager = p.manager, manager_phone = p.manager_phone, memo = p.memo, notes = p.notes
      from public.booth_private p
     where p.booth_id = b.id;
  end if;
end
$back$;

drop table if exists public.booth_private;
comment on table public.booths is null;


-- ═══════════════════════════════════════════════════════════════
-- B. 1a 되돌리기
-- ═══════════════════════════════════════════════════════════════
do $preflight$
declare
  n bigint;
begin
  select count(*) into n from public.booths where zone_key is null or no is null;
  if n > 0 then
    raise exception '미배정 부스가 % 곳 있어 되돌릴 수 없습니다(zone_key · no NOT NULL). 먼저 구역 · 번호를 배정하거나 지우세요.', n;
  end if;
end
$preflight$;

-- B-1. 함수를 먼저 2026-10-02 본문으로 (뒤에서 지울 is_published 를 더는 읽지 않게)
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
    left join public.zones z on z.key = b.zone_key
    left join public.booth_live l on l.booth_id = b.id
   where p_token ~ '^[A-Za-z0-9_-]{24}$'
     and a.token = p_token
     and a.disabled_at is null
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

drop function if exists public.admin_issue_booth_tokens(uuid[]);

-- B-2. 정책
drop policy if exists "공개 구역 열람"       on public.zones;
drop policy if exists "공개 부스 열람"       on public.booths;
drop policy if exists "공개 부스 대기 열람"  on public.booth_live;
drop policy if exists "누구나 열람" on public.zones;
drop policy if exists "누구나 열람" on public.booths;
drop policy if exists "누구나 열람" on public.booth_live;
create policy "누구나 열람" on public.zones      for select to anon, authenticated using (true);
create policy "누구나 열람" on public.booths     for select to anon, authenticated using (true);
create policy "누구나 열람" on public.booth_live for select to anon, authenticated using (true);

grant insert, update, delete, truncate, references, trigger on public.zones  to anon;
grant insert, update, delete, truncate, references, trigger on public.booths to anon;

-- B-3. code 트리거 · 번호 제약 · FK · NOT NULL
drop trigger  if exists trg_booths_before_write on public.booths;
drop function if exists public.booths_before_write();
drop trigger  if exists trg_booths_code on public.booths;          -- 앞 초안의 이름
drop function if exists public.booths_derive_code();

alter table public.booths drop constraint if exists booths_published_needs_slot;
alter table public.booths drop constraint if exists booths_zone_no_key;
alter table public.booths drop constraint if exists booths_no_check;

alter table public.booths drop constraint if exists booths_zone_key_fkey;
alter table public.booths add  constraint booths_zone_key_fkey
  foreign key (zone_key) references public.zones(key)
  on update cascade on delete cascade;

alter table public.booths alter column zone_key set not null;
alter table public.booths alter column no       set not null;

-- B-4. 공개 칸
alter table public.booths drop column if exists is_published;
alter table public.zones  drop column if exists is_published;

comment on column public.booths.code     is null;
comment on column public.booths.zone_key is null;
comment on column public.booths.no       is null;

notify pgrst, 'reload schema';
