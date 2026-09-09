-- ===================================================================
-- 제1회 인천 AI디지털 교육 페스티벌 — 데이터베이스 스키마
--
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 내용을 붙여넣고 실행
-- 여러 번 실행해도 안전합니다(있으면 건너뜁니다).
-- ===================================================================

create extension if not exists "pgcrypto";

-- ── 1. 행사 설정 (항상 한 줄만 씁니다) ────────────────────────────
create table if not exists public.settings (
  id                 smallint primary key default 1,
  event_title        text        not null default '제1회 인천 AI디지털 교육 페스티벌',
  event_start        timestamptz not null default '2026-10-17T10:00:00+09:00',
  time_label         text        not null default '10:00 – 17:00',
  date_label         text        not null default '2026. 10. 17. 토',
  venue              text        not null default '인천교육과학연구원',
  venue_address      text        not null default '인천광역시 남동구 예술로 000',
  contact_phone      text        not null default '032-000-0000',
  contact_email      text        not null default 'aifest@ice.go.kr',
  footer_note        text        not null default '일정·부스·주차 정보는 검토용 예시 데이터입니다.',
  venue_detail       text        not null default '인천교육과학연구원 대강당 · 야외광장',
  host_line          text        not null default '주최 인천광역시교육청 · 주관 인천교육과학연구원',
  booth_dept         text        not null default '미래교육과',
  booth_apply_period text        not null default '2026. 9. 7.(월) ~ 9. 25.(금)',
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
-- 초기 데이터 — 지금 사이트에 들어 있는 예시 내용입니다.
-- 이미 데이터가 있으면 건너뜁니다.
-- ===================================================================

insert into public.settings (id) values (1) on conflict (id) do nothing;

insert into public.programs (no, title, description, meta, tint, deep, sort_order)
select * from (values
  ('01', 'AI 체험 부스',      '직접 만들고 실험하는 40개 부스. 네 구역으로 나뉘어 운영됩니다.',   '야외광장 일대 · 11:00–16:00', '#D7E6FF', '#17458F', 1),
  ('02', '기조 강연·특강',    '교실의 AI 전환을 먼저 실천한 교사와 연구자의 세 편의 강연.',       '대강당 · 세미나실 A·B',       '#D9EFF7', '#0F5468', 2),
  ('03', '학생 작품 전시',    '학생들이 만든 AI·디지털 프로젝트 100선. 폐막식에서 시상합니다.',   '1층 전시홀 · 11:00–16:00',    '#DCEFE6', '#14573F', 3),
  ('04', '에듀테크 기업 전시', '수업에 바로 쓰는 도구를 만드는 기업의 기업관 시연.',              '기업관(D존) · 14:00–15:00',   '#E3E1F9', '#392C86', 4),
  ('05', '무대 공연·이벤트',  '로봇 퍼포먼스와 학생 밴드·댄스 공연이 야외무대에서 이어집니다.',   '야외무대 · 13:00–16:40',      '#DAE8F5', '#1F4468', 5)
) as v where not exists (select 1 from public.programs);

insert into public.schedule_items (half, time_label, duration, title, place, category, sort_order)
select * from (values
  ('am', '09:00 – 10:00', '1시간', '운영진 집결 및 부스 세팅',              '야외광장 · 운영본부',    '운영',      1),
  ('am', '10:00 – 10:20', '20분',  '개막식 및 환영 인사',                   '야외무대',               '기조·강연', 2),
  ('am', '10:20 – 11:00', '40분',  '기조강연 「교실의 AI 전환, 무엇부터」',  '대강당',                 '기조·강연', 3),
  ('am', '11:00 – 16:00', '5시간', 'AI 체험 부스 운영 (40개 부스)',         '야외광장 일대',          '체험·전시', 4),
  ('am', '11:00 – 16:00', '5시간', '학생 작품 전시 100선',                  '1층 전시홀',             '체험·전시', 5),
  ('am', '11:30 – 12:10', '40분',  '특강 「데이터로 읽는 학습」',            '세미나실 A',             '기조·강연', 6),
  ('pm', '12:00 – 13:00', '1시간', '점심 및 부스 교대',                     '학생식당 · 부스별 자율', '운영',      7),
  ('pm', '13:00 – 13:40', '40분',  '로봇 퍼포먼스',                         '야외무대',               '무대 공연', 8),
  ('pm', '13:40 – 14:20', '40분',  '학생 공연 (밴드 · 댄스)',               '야외무대',               '무대 공연', 9),
  ('pm', '14:00 – 15:00', '1시간', '에듀테크 기업관 시연 세션',             '기업관(D존)',            '체험·전시', 10),
  ('pm', '15:00 – 15:40', '40분',  '특강 「AI와 함께 쓰는 글쓰기 수업」',    '세미나실 B',             '기조·강연', 11),
  ('pm', '16:00 – 16:40', '40분',  '폐막식 및 우수 작품 시상',              '야외무대',               '무대 공연', 12),
  ('pm', '16:40 – 17:20', '40분',  '정리 및 철수',                          '전체 구역',              '운영',      13)
) as v where not exists (select 1 from public.schedule_items);

insert into public.zones (key, label, sub, range_from, range_to, tint, solid, deep, sort_order)
select * from (values
  ('A', '함께배움존',    '협력 놀이',     1,  10, '#D7E6FF', '#2563C9', '#17458F', 1),
  ('B', '만들기존',      '피지컬 컴퓨팅', 11, 22, '#D9EFF7', '#0E7490', '#0B4C5E', 2),
  ('C', '데이터·로봇존', '전원 필요',     23, 32, '#DCEFE6', '#12805C', '#0E5941', 3),
  ('D', '전시·기업관',   '실내 전시홀',   33, 40, '#E3E1F9', '#4B3FBF', '#332A87', 4)
) as v where not exists (select 1 from public.zones);

insert into public.booths (no, zone_key, name, org, sort_order)
select * from (values
  (1,  'A', '프롬프트로 그리는 우리 반 이야기', '인천남동초등학교',          1),
  (3,  'A', 'AI 튜터와 함께 푸는 수학 한 문제', '인천교육청 미래교육과',      2),
  (5,  'A', '생성형 AI 저작권 골든벨',          '인천논현중학교',            3),
  (8,  'A', '목소리로 만드는 우리 반 화음',     '인천예술고등학교',          4),
  (11, 'B', '마이크로비트 교실 알림봇 만들기',  '인천서창초등학교',          5),
  (14, 'B', '3D 펜으로 짓는 미래 학교',         '인천만수중학교',            6),
  (17, 'B', '드론 코딩 미션 존',                '인천부평공업고등학교',      7),
  (21, 'B', '재활용 재료로 만드는 로봇 팔',     '인천교육과학연구원',        8),
  (23, 'C', '우리 학교 급식 데이터 분석소',     '인천송도고등학교',          9),
  (26, 'C', '자율주행 트랙 도전',               '인천청라중학교',            10),
  (29, 'C', '센서로 읽는 교실 공기',            '인천대 SW중심대학사업단',   11),
  (31, 'C', '개인정보 지킴이 미션',             '인천교육청 정보화지원과',   12),
  (33, 'D', 'AI디지털 프로젝트 100선 전시',     '학생 작품 전시관',          13),
  (35, 'D', '수업에 바로 쓰는 도구 시연',       '에듀테크 기업관',           14),
  (37, 'D', 'AI 시대 진로 상담 부스',           '인천진로교육원',            15),
  (39, 'D', '학부모 AI 리터러시 상담소',        '인천교육청 학교교육과',     16)
) as v where not exists (select 1 from public.booths);

insert into public.faqs (question, answer, sort_order)
select * from (values
  ('참가비가 있나요?',
   '없습니다. 전 프로그램과 체험 부스가 모두 무료이고, 현장 안내 데스크에서 프로그램 책자를 받으실 수 있습니다.', 1),
  ('신청을 하고 가야 하나요?',
   '아니요. 사전신청 절차가 없어 당일 그냥 오시면 됩니다. 다만 정원을 두고 회차별로 운영하는 일부 체험 부스는 현장에서 선착순으로 참여하실 수 있습니다.', 2),
  ('몇 살부터 참여할 수 있나요?',
   '초등학교 1학년부터 고등학교 3학년까지 참여할 수 있습니다. 미취학 아동은 보호자와 함께 입장해 주세요.', 3),
  ('보호자도 함께 볼 수 있나요?',
   '네. 본관 1층에 보호자 쉼터를 운영하고, D존에서 학부모 대상 AI 리터러시 상담소를 함께 운영합니다.', 4),
  ('학교나 기관도 부스를 운영할 수 있나요?',
   '9월 7일부터 25일까지 운영계획서를 공문으로 접수합니다. 전기 사용과 부스 규격을 함께 적어 주시면 배치 검토가 빠릅니다.', 5),
  ('비가 오면 어떻게 되나요?',
   '실내 프로그램으로 대체 운영합니다. 당일 오전 8시에 누리집 공지로 변경된 배치도를 안내합니다.', 6)
) as v where not exists (select 1 from public.faqs);
