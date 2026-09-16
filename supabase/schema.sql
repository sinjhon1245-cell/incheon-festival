-- ===================================================================
-- 2026년 인천 AI·SW미래채움 교육페스티벌 — 데이터베이스 스키마
--
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 내용을 붙여넣고 실행
-- 여러 번 실행해도 안전합니다(있으면 건너뜁니다).
-- ===================================================================

create extension if not exists "pgcrypto";

-- ── 1. 행사 설정 (항상 한 줄만 씁니다) ────────────────────────────
create table if not exists public.settings (
  id                 smallint primary key default 1,
  event_title        text        not null default '2026년 인천 AI·SW미래채움 교육페스티벌',
  event_start        timestamptz not null default '2026-11-13T10:00:00+09:00',
  time_label         text        not null default '10:00 – 17:00',
  date_label         text        not null default '2026. 11. 13.(금) ~ 11. 14.(토)',
  venue              text        not null default '송도컨벤시아',
  venue_address      text        not null default '인천광역시 연수구 센트럴로 123',
  -- 확정되지 않은 값은 비워 둡니다. '032-000-0000' 같은 자리표시 번호를
  -- 기본값으로 두면 새 환경에서 실제 대표 전화처럼 보입니다. 비어 있으면
  -- 관리자 → 행사 기본정보에서 채우면 됩니다.
  contact_phone      text        not null default '',
  contact_email      text        not null default 'aifest@ice.go.kr',
  -- 옛 관람객 안내 사이트의 '검토용 예시 데이터입니다' 문구가 기본값으로
  -- 남아 있었습니다. 지금 화면 어디에서도 쓰지 않아 비워 둡니다.
  footer_note        text        not null default '',
  -- 장소 상세: 2026 행사의 전시홀 번호는 아직 확정 전이라 비워 둡니다.
  -- 확정되면 관리자 → 행사 기본정보에서 채웁니다.
  venue_detail       text        not null default '',
  -- 아래 셋은 옛 부스 모집 안내에 쓰던 칸입니다. 지금 포털·관리자
  -- 어느 화면도 읽지 않지만, 호환성을 위해 칸은 그대로 둡니다.
  -- 모집 기간처럼 확정되지 않은 값은 기본값으로 넣지 않습니다 —
  -- 새 환경에서 확정된 일정처럼 보입니다.
  host_line          text        not null default '주최 인천광역시교육청',
  booth_dept         text        not null default '',
  booth_apply_period text        not null default '',
  show_ops_track     boolean     not null default false,
  show_parking_table boolean     not null default false,
  show_countdown     boolean     not null default true,
  updated_at         timestamptz not null default now(),
  constraint settings_single_row check (id = 1)
);

-- ── 2. 프로그램 카드 ──────────────────────────────────────────────
create table if not exists public.programs (
  id          uuid primary key default gen_random_uuid(),
  no          text not null default '01',
  title       text not null,
  description text not null default '',
  meta        text not null default '',
  tint        text not null default '#D7E6FF',   -- 번호 배지 배경
  deep        text not null default '#17458F',   -- 번호 배지 글자
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- ── 3. 시간표 ─────────────────────────────────────────────────────
create table if not exists public.schedule_items (
  id         uuid primary key default gen_random_uuid(),
  half       text not null default 'am' check (half in ('am', 'pm')),
  time_label text not null,                       -- 예: '10:00 – 10:20'
  duration   text not null default '',            -- 예: '20분'
  title      text not null,
  place      text not null default '',
  category   text not null default '체험·전시'
             check (category in ('기조·강연', '체험·전시', '무대 공연', '운영')),
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

-- ── 4. 부스 구역 ──────────────────────────────────────────────────
create table if not exists public.zones (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,                -- A · B · C · D
  label      text not null,
  sub        text not null default '',
  range_from int  not null default 1,
  range_to   int  not null default 1,
  tint       text not null default '#D7E6FF',
  solid      text not null default '#2563C9',
  deep       text not null default '#17458F',
  sort_order int  not null default 0
);

-- ── 5. 부스 ───────────────────────────────────────────────────────
create table if not exists public.booths (
  id         uuid primary key default gen_random_uuid(),
  no         int  not null,
  zone_key   text not null references public.zones(key) on update cascade on delete cascade,
  name       text not null,
  org        text not null default '',
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

-- ── 6. FAQ ────────────────────────────────────────────────────────
create table if not exists public.faqs (
  id         uuid primary key default gen_random_uuid(),
  question   text not null,
  answer     text not null default '',
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);


-- ===================================================================
-- 보안 정책 (RLS)
--
-- 핵심: 읽기는 누구나, 쓰기는 로그인한 사람만.
-- 이 정책은 데이터베이스가 직접 강제하므로, 관리자 페이지 주소를
-- 남이 알아내도 로그인 없이는 아무것도 바꿀 수 없습니다.
-- ===================================================================

alter table public.settings       enable row level security;
alter table public.programs       enable row level security;
alter table public.schedule_items enable row level security;
alter table public.zones          enable row level security;
alter table public.booths         enable row level security;
alter table public.faqs           enable row level security;

do $$
declare t text;
begin
  foreach t in array array['settings', 'programs', 'schedule_items', 'zones', 'booths', 'faqs']
  loop
    execute format('drop policy if exists "공개 읽기" on public.%I', t);
    execute format('drop policy if exists "로그인 사용자 쓰기" on public.%I', t);

    -- 공개 사이트가 anon 키로 읽습니다.
    execute format(
      'create policy "공개 읽기" on public.%I for select using (true)', t);

    -- 로그인한 사용자만 추가·수정·삭제할 수 있습니다.
    execute format(
      'create policy "로그인 사용자 쓰기" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;


-- ===================================================================
-- 초기 데이터 — 행사 설정 한 줄뿐입니다.
--
-- 운영 콘텐츠(일정 · 구역 · 부스 · FAQ · 프로그램)는 DB에 넣지
-- 않습니다. 비어 있으면 포털이 UI-only 예시를 보여 주고, 실제
-- 데이터가 한 건이라도 등록되면 예시는 사라집니다. 예시를 DB에
-- 넣어 두면 그 전환이 영영 일어나지 않습니다.
-- ===================================================================

insert into public.settings (id) values (1) on conflict (id) do nothing;

-- 프로그램 안내 카드는 현재 관계자 운영 포털에서 사용하지 않습니다.
-- programs 테이블은 호환성을 위해 유지하되 초기 seed는 넣지 않습니다.
--
-- 옛 관람객 안내 사이트의 카드 다섯 장(AI 체험 부스 · 기조 강연 ·
-- 학생 작품 전시 · 에듀테크 기업 전시 · 무대 공연)이었습니다. 포털과
-- 관리자 어느 화면도 이 표를 읽지 않아, 넣어 두면 아무 데도 보이지
-- 않는 옛 행사장 문구만 DB에 남습니다.

-- 일정 예시는 DB에 넣지 않습니다.
-- schedule_items 가 비어 있으면 포털이 UI-only sample 을 표시합니다.
-- 실제 행사 일정은 관리자 → 일정에서 등록합니다.
--
-- 예전에는 여기서 일정 13건을 넣었습니다. 그 예시가 실제 운영 DB 에
-- 남아 옛 행사장(야외광장·대강당·학생식당) 이름이 포털에 그대로
-- 보였고, 무엇보다 '일정 0건일 때만 예시' 라는 규칙 때문에 새로 만든
-- UI-only 예시가 아예 나오지 않았습니다. 예시는 화면(assets/portal.js)
-- 한 곳에서만 관리합니다. schedule_items 표 정의는 그대로 둡니다.

-- 구역은 실제 부스 배치가 확정된 뒤 등록합니다.
-- 확정 전 구역 예시는 DB에 seed하지 않습니다.
--
-- 예전 A~D(함께배움존 · 만들기존 · 데이터·로봇존 · 전시·기업관)는
-- 2026 배치가 아니라 초기 예시였습니다. 부스 번호 구간까지 정해 두면
-- 실제 배치가 나왔을 때 지우고 다시 넣어야 합니다.

-- 부스 예시는 DB에 넣지 않습니다.
-- booths가 비어 있으면 포털이 UI-only sample을 표시합니다.
-- 실제 부스는 관리자 → 부스에서 등록합니다.
--
-- 예전에는 여기서 부스 16건을 넣었습니다. 그 예시가 실제 운영 DB에
-- 남아 '일정 0건일 때만 예시' 와 같은 이유로 새 UI-only 예시가 나오지
-- 않았고, 기관명에 옛 행사장(인천교육과학연구원)이 남아 있었습니다.
-- 부스 예시는 화면(assets/portal.js) 한 곳에서만 관리합니다.
-- zones · booths 표 정의는 그대로 둡니다.

-- FAQ 예시는 DB에 넣지 않습니다.
--
-- 예전에는 여기서 관람객용 질문 여섯 개(참가비 · 사전신청 · 참여 연령 ·
-- 보호자 · 부스 신청 · 우천)를 넣었습니다. 지금 이 사이트는 관람객
-- 안내가 아니라 관계자 운영 포털이라, 새 환경에서 그 질문들이 자동으로
-- 생기면 방향이 맞지 않습니다.
--
-- 관계자 운영 FAQ 15개는 migration-media-support.sql 이 답변 빈칸 ·
-- 비공개로 넣어 둡니다. 관리자 → FAQ에서 답변을 채우고 공개를 켜면
-- 포털에 나옵니다. faqs 표 정의는 그대로 둡니다.
