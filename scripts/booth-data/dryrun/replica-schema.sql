-- ===================================================================
-- 로컬 사전 실행용 복제 schema — 부스 등록에 닿는 표만
-- Production 카탈로그(2026-10-14 읽기 전용 조회)의 칸 · 기본값 · 제약 · 트리거와 같게 맞췄습니다.
-- RLS · 권한 · 함수(QR · PIN · 대기 값 RPC)는 등록 SQL 이 쓰지 않으므로 뺐습니다.
-- 로컬 PGlite 에서만 씁니다. Production 에서 실행하지 않습니다.
-- ===================================================================

create table public.zones (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique,
  label        text not null,
  sub          text not null default '',
  range_from   integer not null default 1,
  range_to     integer not null default 1,
  tint         text not null default '#D7E6FF',
  solid        text not null default '#2563C9',
  deep         text not null default '#17458F',
  sort_order   integer not null default 0,
  is_published boolean not null default false
);

create table public.booths (
  id            uuid primary key default gen_random_uuid(),
  no            integer,
  zone_key      text,
  name          text not null,
  org           text not null default '',
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  code          text not null default '',
  program       text not null default '',
  hours         text not null default '',
  needs_power   boolean not null default false,
  needs_network boolean not null default false,
  supplies      text not null default '',
  status        text not null default '준비 전',
  updated_at    timestamptz not null default now(),
  image_url     text not null default '',
  image_alt     text not null default '',
  image_caption text not null default '',
  org_type      text,
  is_published  boolean not null default false,
  constraint booths_no_check check ((no is null) or ((no >= 1) and (no <= 999))),
  constraint booths_org_type_check check ((org_type is null) or (org_type = any (array['초등'::text, '중등'::text, '고등'::text, '기관'::text, '기업'::text, '기타'::text]))),
  constraint booths_published_needs_slot check ((not is_published) or ((zone_key is not null) and (no is not null))),
  constraint booths_status_check check ((status = any (array['준비 전'::text, '준비 완료'::text, '운영 중'::text, '일시 중단'::text, '운영 종료'::text]))),
  constraint booths_zone_key_fkey foreign key (zone_key) references public.zones(key) on update cascade on delete set null,
  constraint booths_zone_no_key unique (zone_key, no)
);

create or replace function public.touch_updated_at()
 returns trigger language plpgsql set search_path to ''
as $function$
begin
  new.updated_at = now();
  return new;
end $function$;

create or replace function public.booths_before_write()
 returns trigger language plpgsql set search_path to ''
as $function$
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
$function$;

create trigger trg_booths_before_write before insert or update on public.booths for each row execute function public.booths_before_write();
create trigger trg_touch_booths before update on public.booths for each row execute function public.touch_updated_at();

create table public.booth_live (
  booth_id     uuid primary key references public.booths(id) on delete cascade,
  congestion   text not null,
  wait_minutes integer not null default 0,
  updated_at   timestamptz not null default now(),
  constraint booth_live_congestion_check check ((congestion = any (array['여유'::text, '보통'::text, '혼잡'::text, '중단'::text, '마감'::text]))),
  constraint booth_live_wait_check check (((wait_minutes >= 0) and (wait_minutes <= 180)))
);

create table public.booth_access (
  booth_id    uuid primary key references public.booths(id) on delete cascade,
  token       text not null unique,
  created_at  timestamptz not null default now(),
  rotated_at  timestamptz,
  disabled_at timestamptz
);

create table public.booth_session (
  id             uuid primary key default gen_random_uuid(),
  booth_id       uuid not null references public.booths(id) on delete cascade,
  token_hash     bytea not null unique,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  revoke_reason  text,
  last_used_at   timestamptz,
  device_tag     text,
  via_common_pin boolean not null default false,
  constraint booth_session_expiry_check check ((expires_at > created_at)),
  constraint booth_session_hash_len_check check ((octet_length(token_hash) = 32)),
  constraint booth_session_revoke_check check ((((revoked_at is null) = (revoke_reason is null)) and ((revoke_reason is null) or (revoke_reason = any (array['logout'::text, 'pin_reissued'::text, 'pin_disabled'::text, 'session_cap'::text, 'same_device'::text])))))
);

create table public.booth_live_log (
  id           bigint generated always as identity primary key,
  booth_id     uuid not null references public.booths(id) on delete cascade,
  congestion   text not null,
  wait_minutes integer not null,
  source       text not null,
  created_at   timestamptz not null default now(),
  session_id   uuid,
  constraint booth_live_log_source_check check ((source = any (array['set'::text, 'touch'::text, 'admin'::text]))),
  constraint booth_live_log_session_fkey foreign key (session_id) references public.booth_session(id) on delete set null
);
create index booth_live_log_booth_time on public.booth_live_log (booth_id, created_at);

create table public.booth_pin (
  booth_id    uuid primary key references public.booths(id) on delete cascade,
  pin_hash    text not null,
  issued_at   timestamptz not null default now(),
  reissued_at timestamptz,
  disabled_at timestamptz,
  issued_by   uuid,
  constraint booth_pin_hash_check check ((pin_hash ~ '^\$2[abxy]\$10\$[./A-Za-z0-9]{53}$'::text))
);

create table public.booth_auth_event (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  event      text not null,
  booth_id   uuid references public.booths(id) on delete set null,
  session_id uuid references public.booth_session(id) on delete set null,
  ip_tag     text,
  device_tag text,
  limit_kind text,
  detail     text,
  actor      uuid
);

create table public.booth_private (
  id            uuid primary key default gen_random_uuid(),
  booth_id      uuid not null unique references public.booths(id) on delete cascade,
  manager       text not null default '',
  manager_phone text not null default '',
  memo          text not null default '',
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_touch_booth_private before update on public.booth_private for each row execute function public.touch_updated_at();

-- settings 는 등록 · 전환 SQL 과 관람객 스냅샷(live-snapshot)이 읽는 칸만
create table public.settings (
  id                              smallint primary key default 1,
  event_title                     text not null default '2026 인천 AI미래채움 교육페스티벌',
  event_start                     timestamptz not null,
  event_end                       timestamptz,
  time_label                      text not null default '10:00 – 17:00',
  date_label                      text not null default '2026. 11. 6.(금) ~ 11. 7.(토)',
  venue                           text not null default '인천 상상플랫폼',
  booth_map_url                   text not null default '',
  booth_map_alt                   text not null default '',
  booth_pin_enabled               boolean not null default false,
  booth_sample_common_pin_enabled boolean not null default false,
  updated_at                      timestamptz not null default now(),
  constraint settings_single_row check ((id = 1))
);
create trigger trg_touch_settings before update on public.settings for each row execute function public.touch_updated_at();
