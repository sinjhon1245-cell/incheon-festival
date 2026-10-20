-- ===================================================================
-- 실제 부스 사전 안내(배치 준비 중) — 관람객 목록 노출과 운영자 접속을 나눔 — 초안(아직 Production 미적용)
--
--   왜 필요한가
--     실제 스쿨존 84개는 구역 · 번호가 정해지기 전이라 비공개 · 미배정입니다. 공개 규칙
--     (booths ‘공개 부스 열람’: 공개 + 번호 있음 + 구역 공개)과 운영자 접속(booth_ctrl_* ·
--     booth_pin_login · booth_session_*: 같은 조건)이 같은 조건을 쓰므로, 지금은 관람객에게 보이게
--     하려면 운영자 접속까지 열어야 합니다. 그래서 ‘사전 안내 목록에 보일지’ 를 따로 둡니다.
--
--   이 파일이 하는 일 (더하기만 합니다)
--     1. public.booths.preview_listed (boolean, 기본 false) 칸 하나.
--        켜진 부스는 배치 전에도 관람객 화면의 ‘배치 준비 중’ 목록에 이름 · 기관 · 체험 내용만 보입니다.
--     2. public.booth_preview_list() — 사전 안내 목록(읽기 전용 · SECURITY DEFINER).
--          돌려주는 칸: id · name · org · program 넷뿐. 구역 · 번호 · 표시 코드 · 대기 값 · 담당자 ·
--          QR/PIN 정보는 돌려주지 않습니다.
--          대상: preview_listed 이고, ‘[예시]’ 가 아니고, 아직 공개 규칙으로 보이지 않는 부스
--          (공개 + 번호 + 구역 공개가 되면 원래 목록으로 넘어가고 여기서는 빠집니다).
--          anon · authenticated 가 부를 수 있습니다(관람객 화면 서버가 anon 키로 부름).
--
--   바꾸지 않는 것
--     booths · zones · booth_live 의 RLS 정책, 트리거(booths_before_write · trg_touch_booths),
--     booth_ctrl_get/set/touch · booth_pin_login · booth_session_* · admin_* 함수, QR · PIN 표, 설정.
--     → 사전 안내 목록에 올라가도 운영자 QR · PIN 접속은 지금처럼 ‘공개 + 구역 공개 + 번호’ 일 때만 됩니다.
--     부스 공개(is_published)의 뜻도 그대로입니다 — 배치 전 부스는 여전히 비공개 · 미배정입니다.
--
--   선행: migration-booth-master-data.sql(1a) · migration-booth-private.sql(1b)
--   되돌리기: rollback-booth-preview.sql (함수 · 칸만 지움, 다른 데이터 영향 없음)
--   이 파일만으로는 아무 부스도 목록에 올라가지 않습니다(칸 기본값 false). 켜는 것은 별도 승인 SQL 입니다.
-- ===================================================================

begin;

-- 칸 추가는 부스 표를 아주 잠깐 잠급니다(기본값 칸이라 표를 다시 쓰지 않음). 다른 작업이 표를 오래 잡고
-- 있으면 그 뒤에 관람객 읽기가 줄 서지 않도록, 5초 안에 잠그지 못하면 아무것도 바꾸지 않고 멈춥니다.
set local lock_timeout = '5s';

alter table public.booths
  add column if not exists preview_listed boolean not null default false;

comment on column public.booths.preview_listed is
  '사전 안내 목록(배치 준비 중)에 보임. 운영자 QR · PIN 접속 조건(공개 + 구역 공개 + 번호)과 무관.';

create or replace function public.booth_preview_list()
 returns table(id uuid, name text, org text, program text)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select b.id, b.name, b.org, b.program
    from public.booths b
   where b.preview_listed
     and b.org !~ '^\s*\[예시\]'
     and not (b.is_published
              and b.no is not null
              and exists (select 1 from public.zones z where z.key = b.zone_key and z.is_published))
   order by b.sort_order, b.name, b.id
$function$;

comment on function public.booth_preview_list() is
  '관람객 사전 안내 목록(배치 준비 중). id · name · org · program 만. 운영자 접속 권한과 무관.';

revoke all on function public.booth_preview_list() from public;
grant execute on function public.booth_preview_list() to anon, authenticated;

commit;

-- 관람객 화면 서버(PostgREST)가 새 함수 목록을 바로 읽게 합니다(다른 migration 과 같은 방식).
notify pgrst, 'reload schema';

-- ── 적용 확인(읽기 전용) ────────────────────────────────────────────
select 'booths.preview_listed 칸' as 확인,
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'booths' and column_name = 'preview_listed') as 맞음
union all
select 'preview_listed 켜진 부스 0(이 파일은 켜지 않음)',
       (select count(*) from public.booths where preview_listed) = 0
union all
select 'booth_preview_list 함수 · SECURITY DEFINER',
       exists (select 1 from pg_proc where proname = 'booth_preview_list' and pronamespace = 'public'::regnamespace and prosecdef)
union all
select 'anon 실행 가능',
       has_function_privilege('anon', 'public.booth_preview_list()', 'EXECUTE')
union all
select '‘공개 부스 열람’ 정책 그대로',
       (select qual from pg_policies where schemaname = 'public' and tablename = 'booths' and policyname = '공개 부스 열람')
         like '%is_published%no IS NOT NULL%';
