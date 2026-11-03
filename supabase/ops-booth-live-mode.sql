-- ===================================================================
-- 부스 운영 방식 — 보기 · 켜기 · 끄기 · 테스트 설정 정리 (SQL Editor 에서 한 칸씩)
--
--   먼저 supabase/migration-booth-live-mode.sql 이 적용돼 있어야 합니다.
--   한 번에 전체를 Run 하지 말고, 필요한 칸만 골라 실행합니다. A 는 읽기만 합니다.
--   전체를 실수로 Run 해도 B · C · C-2 는 주석이라 실행되지 않고, D 는 미리 보기만 합니다(아무것도 바꾸지 않음).
--   어느 칸도 booths · zones · QR · PIN · 세션 · 23:00 예약을 바꾸지 않습니다.
-- ===================================================================


-- ── A. 지금 상태 보기 (읽기만) ─────────────────────────────────────────
select (select enabled from public.booth_live_mode_config where id = 1)            as enabled,
       (select count(*) from public.booth_live_mode where mode = 'reserve')          as reserve_booths,
       (select count(*) from public.booth_live where congestion in ('예약중', '예약마감')) as reserve_status_rows;

select coalesce(nullif(b.code, ''), b.zone_key || '-' || lpad(b.no::text, 2, '0')) as code,
       b.name, m.mode, m.updated_at at time zone 'Asia/Seoul' as mode_at_kst,
       l.congestion, l.updated_at at time zone 'Asia/Seoul' as status_at_kst
  from public.booth_live_mode m
  join public.booths b on b.id = m.booth_id
  left join public.booth_live l on l.booth_id = m.booth_id
 order by b.zone_key, b.no;


-- ── B. 켜기 ───────────────────────────────────────────────────────────
--   운영자 화면에 '현장대기 | 현장예약' 이 보이고 바꿀 수 있게 됩니다. 이미 정해 둔 방식이 그대로 살아납니다.
--   운영자 화면은 다음 읽기(1분 안), 관람객 화면은 스냅샷 캐시(최대 약 40초) 뒤에 따라옵니다.
-- update public.booth_live_mode_config set enabled = true, updated_at = now() where id = 1;


-- ── C. 끄기 (11-05 정오까지 실기기 검증을 끝내지 못했을 때 · 문제가 생겼을 때 — 긴급 비활성화) ───────
--   배포 없이 바로 모든 부스가 '현장대기' 로 돌아갑니다. 운영 데이터는 지우지 않습니다(방식 줄 · 상태 줄 그대로).
--   끈 뒤 남은 예약 상태('예약중' · '예약마감')는:
--     · 관람객 화면 · 관리 화면 · 운영 포털 — 그리지 않음(정보 없음 · 미입력)
--     · 운영자 화면 — 선택 줄이 사라지고 현장대기 단추판. 대기 시간을 누르면 바로 덮어씀
--     · '변동 없음 · 지금 확인' 은 그 값을 되살리지 않고 거부(22023)
--     · 23:00 초기화에서 지워짐 · 다시 켜면 정해 둔 방식이 그대로 살아남
-- update public.booth_live_mode_config set enabled = false, updated_at = now() where id = 1;

-- C-2. (선택 · 보통은 쓰지 않음) 끈 뒤 남은 예약 상태 줄을 바로 지우기. 화면에는 이미 보이지 않으므로
--      꼭 필요할 때만, 스위치가 꺼져 있을 때만 지웁니다. 지운 부스는 운영자가 대기 시간을 누를 때까지 '정보 없음'.
-- delete from public.booth_live l
--  where l.congestion in ('예약중', '예약마감')
--    and not (select enabled from public.booth_live_mode_config where id = 1);


-- ── D. 테스트 설정 정리 (실제 운영 전 — 리허설 중 바꿔 본 방식을 '현장대기' 로) ───────────
--   1) v_codes 에 정리할 부스 번호를 적고(또는 v_all := true — 현장예약 부스 전부) 그대로 실행 → 대상 목록만 나옵니다.
--   2) 목록이 맞으면 v_confirm 에 나온 승인 문구(예: '3곳 정리')를 그대로 적어 다시 실행 → 그때만 바꿉니다.
--   · v_codes 가 비어 있고 v_all 도 false 면 아무 부스도 고르지 않습니다(빈 목록이 '전부' 가 되지 않음).
--   · 승인 문구의 곳 수가 실행할 때의 대상 수와 다르면(그사이 바뀜) 바꾸지 않고 멈춥니다.
--   부스마다: 방식 → 'wait', 그 부스의 지금 상태 줄 지움(운영자가 현장대기로 바꿀 때와 같음).
--   11-05 밤에 일괄로 되돌리지 않습니다(결정 5). 이 칸은 정리가 필요한 부스에만 씁니다.
do $cleanup$
declare
  v_codes   text[]  := array[]::text[];   -- 예: array['12', '45']  (부스 번호 — 화면의 번호 그대로)
  v_all     boolean := false;             -- true = 현장예약 부스 전부(번호를 적지 않을 때만)
  v_confirm text    := '';                -- 1) 실행 결과의 승인 문구를 그대로 적어야 실제로 바꿉니다
  r         record;
  n         integer;
  v_need    text;
begin
  if cardinality(v_codes) = 0 and not v_all then
    raise notice '정리할 부스를 고르지 않았습니다. v_codes 에 부스 번호를 적거나 v_all := true 로 바꿔 다시 실행하세요. (아무것도 바꾸지 않음)';
    return;
  end if;
  if cardinality(v_codes) > 0 and v_all then
    raise exception 'STOP: v_codes 와 v_all 을 함께 쓰지 않습니다. 둘 중 하나만 정하세요.';
  end if;

  create temp table cleanup_targets on commit drop as
    select m.booth_id, coalesce(nullif(b.code, ''), b.zone_key || '-' || lpad(b.no::text, 2, '0')) as code, b.name
      from public.booth_live_mode m
      join public.booths b on b.id = m.booth_id
     where m.mode = 'reserve'
       and (v_all or coalesce(nullif(b.code, ''), b.zone_key || '-' || lpad(b.no::text, 2, '0')) = any (v_codes)
                  or b.no::text = any (v_codes));
  select count(*) into n from cleanup_targets;
  v_need := n || '곳 정리';

  for r in select * from cleanup_targets order by code loop
    raise notice '대상: % %', r.code, r.name;
  end loop;
  if n = 0 then
    raise notice '현장예약인 대상 부스가 없습니다. (아무것도 바꾸지 않음)';
    return;
  end if;
  if v_confirm is distinct from v_need then
    raise notice '미리 보기만 했습니다(%곳). 바꾸려면 v_confirm := ''%'' 로 적어 다시 실행하세요.', n, v_need;
    return;
  end if;

  for r in select * from cleanup_targets loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('booth_live_mode'), pg_catalog.hashtext(r.booth_id::text));
    delete from public.booth_live l where l.booth_id = r.booth_id;
    update public.booth_live_mode m set mode = 'wait', updated_at = now() where m.booth_id = r.booth_id;
  end loop;
  raise notice '%곳을 현장대기로 정리했습니다.', n;
end;
$cleanup$;
