-- ===================================================================
-- 부스 운영 방식 — 보기 · 켜기 · 끄기 · 테스트 설정 정리 (SQL Editor 에서 한 칸씩)
--
--   먼저 supabase/migration-booth-live-mode.sql 이 적용돼 있어야 합니다.
--   한 번에 전체를 Run 하지 말고, 필요한 칸만 골라 실행합니다. A 는 읽기만 합니다.
--   어느 칸도 booths · zones · QR · PIN · 세션 · 23:00 예약을 바꾸지 않습니다.
-- ===================================================================


-- ── A. 지금 상태 보기 (읽기만) ─────────────────────────────────────────
select (select enabled from public.booth_live_mode_config where id = 1)            as enabled,
       (select count(*) from public.booth_live_mode where mode = 'reserve')          as reserve_booths,
       (select count(*) from public.booth_live where congestion in ('예약중', '예약마감')) as reserve_status_rows;

select coalesce(nullif(b.code, ''), b.zone_key || '-' || lpad(b.no::text, 2, '0')) as code,
       b.name, m.mode, m.updated_at at time zone 'Asia/Seoul' as mode_at_kst, m.via,
       l.congestion, l.updated_at at time zone 'Asia/Seoul' as status_at_kst
  from public.booth_live_mode m
  join public.booths b on b.id = m.booth_id
  left join public.booth_live l on l.booth_id = m.booth_id
 order by b.zone_key, b.no;


-- ── B. 켜기 ───────────────────────────────────────────────────────────
--   운영자 화면에 '현장대기 | 현장예약' 이 보이고 바꿀 수 있게 됩니다. 이미 정해 둔 방식이 그대로 살아납니다.
--   운영자 화면은 다음 읽기(10초 안팎), 관람객 화면은 스냅샷 캐시(최대 약 40초) 뒤에 따라옵니다.
-- update public.booth_live_mode_config set enabled = true, updated_at = now() where id = 1;


-- ── C. 끄기 (11-05 정오까지 실기기 검증을 끝내지 못했을 때 · 문제가 생겼을 때) ───────────
--   모든 부스가 '현장대기' 로 돌아갑니다. 방식 줄은 지우지 않습니다(다시 켜면 그대로).
--   끈 뒤 남은 예약 상태('예약중' · '예약마감')는:
--     · 관람객 화면 — 보내지 않음 → '정보 없음'
--     · 운영자 화면 — '현장대기' 단추판 · 지금 상태 '운영 상태 설정 필요' → 대기 시간을 누르면 바로 덮어씀
--     · '변동 없음 · 지금 확인' 은 그 값을 되살리지 않고 거부(22023)
--     · 23:00 초기화에서 지워짐
--   바로 '정보 없음' 으로 정리하려면 C-2 도 실행합니다.
-- update public.booth_live_mode_config set enabled = false, updated_at = now() where id = 1;

-- C-2. 남은 예약 상태 지우기(끈 뒤에만). 지운 부스는 운영자가 대기 시간을 다시 누를 때까지 '정보 없음'.
-- delete from public.booth_live l
--  where l.congestion in ('예약중', '예약마감')
--    and not (select enabled from public.booth_live_mode_config where id = 1);


-- ── D. 테스트 설정 정리 (실제 운영 전 — 리허설 중 바꿔 본 방식을 '현장대기' 로) ───────────
--   v_codes 에 정리할 부스 번호를 적습니다(빈 배열이면 현장예약인 부스 모두). v_apply 가 false 면
--   바꿀 부스만 보여 주고 아무것도 바꾸지 않습니다. 확인한 뒤 true 로 바꿔 다시 실행합니다.
--   부스마다: 방식 → 'wait', 그 부스의 지금 상태 줄 지움(운영자가 전환할 때와 같음), 전환 기록에 via = 'admin'.
--   11-05 밤에 일괄로 되돌리지 않습니다(결정 5). 이 칸은 정리가 필요한 부스에만 씁니다.
do $cleanup$
declare
  v_codes text[]  := array[]::text[];   -- 예: array['S01', 'S02']  (빈 배열 = 현장예약 부스 전부)
  v_apply boolean := false;             -- true 로 바꿔야 실제로 바꿉니다
  r       record;
  v_old_c text;
  v_old_w integer;
  v_old_t timestamptz;
  n       integer := 0;
begin
  for r in
    select m.booth_id, coalesce(nullif(b.code, ''), b.zone_key || '-' || lpad(b.no::text, 2, '0')) as code
      from public.booth_live_mode m
      join public.booths b on b.id = m.booth_id
     where m.mode = 'reserve'
       and (cardinality(v_codes) = 0
            or coalesce(nullif(b.code, ''), b.zone_key || '-' || lpad(b.no::text, 2, '0')) = any (v_codes))
     order by b.zone_key, b.no
  loop
    n := n + 1;
    if not v_apply then
      raise notice '정리 대상 %: %', n, r.code;
      continue;
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('booth_live_mode'), pg_catalog.hashtext(r.booth_id::text));
    delete from public.booth_live l where l.booth_id = r.booth_id
    returning l.congestion, l.wait_minutes, l.updated_at into v_old_c, v_old_w, v_old_t;
    update public.booth_live_mode m set mode = 'wait', updated_at = now(), via = 'admin', session_id = null
     where m.booth_id = r.booth_id;
    insert into public.booth_live_mode_log (booth_id, from_mode, to_mode, cleared_congestion, cleared_wait, cleared_updated_at, via)
    values (r.booth_id, 'reserve', 'wait', v_old_c, v_old_w, v_old_t, 'admin');
    raise notice '현장대기로 정리 %: %', n, r.code;
  end loop;
  raise notice '%곳 %', n, case when v_apply then '정리함' else '정리 대상(아직 바꾸지 않음)' end;
end;
$cleanup$;
