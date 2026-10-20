/* ===================================================================
   Gate 4-R SQL 생성기 — 리허설용 임시 배치(R1~R4) · 공개 · 최종 재배정
   ───────────────────────────────────────────────────────────────────
   같은 부스(UUID 84개) · 같은 운영자 QR 을 그대로 두고 구역 · 번호만 바꿉니다.
   부스 삭제 · 재생성 · QR 발급 · 교체 · PIN 변경은 하지 않습니다.

   묶음
     assignSqls(m)  T-01 직전 확인 · T-02 임시 구역 만들기 + 84곳 배정(비공개) · T-03 공개 ·
                    T-04 공개 뒤 확인 · T-09a 배정 되돌리기(공개 전 전용) · T-09b 공개 되돌리기(비상용)
     moveSqls(m, mv) F-01 직전 확인 · F-02 옮기기(공개 유지 · 한 트랜잭션) · F-03 확인
                    — 최종 배치 확정 뒤(R → 최종). 거꾸로(최종 → R)도 같은 함수로 만듭니다.

   SQL 마다 DO 블록 하나(REPEATABLE READ):
     실행 전 확인 · 지문 → 바꾸기 → 실행 뒤 확인 · 지문. 하나라도 틀리면 전체가 되돌아갑니다.
   열쇠 · PIN 값은 결과로 내보내지 않습니다(지문 비교는 DB 안에서만).
   =================================================================== */

const q = s => `'${String(s).replace(/'/g, "''")}'`;
const SAMPLE = "'^\\s*\\[예시\\]'";
const uuids = ids => `'{${ids.join(',')}}'::uuid[]`;
const texts = xs => `array[${xs.map(q).join(', ')}]::text[]`;
const ints = xs => `array[${xs.join(', ')}]::int[]`;

const head = (title, m, lines) => `-- ===================================================================
-- ${title}
-- 2026 인천 AI미래채움 교육페스티벌 · 실제 ${m.realIds.length} · 예시 ${m.exampleIds.length}
-- manifest sha256 ${m.sha256} · 배치안 ${m.planName} sha256 ${m.planSha}
-- 만든 시각 ${m.generatedAt} · scripts/booth-data/build-gate4r.mjs
${lines.map(l => `-- ${l}`).join('\n')}
-- ===================================================================
`;

// 바뀌면 안 되는 것의 지문(QR · PIN · 대기 값 · 기록 · 세션 · 보안 기록 · 비공개 칸). 값은 DB 안에서만 견줍니다.
const protectedFp = `(select concat_ws(' | ',
      (select md5(coalesce(string_agg(concat_ws(':', a.booth_id, md5(a.token), a.created_at, a.rotated_at, a.disabled_at), ',' order by a.booth_id), '')) from public.booth_access a),
      (select md5(coalesce(string_agg(concat_ws(':', p.booth_id, md5(p.pin_hash), p.issued_at, p.reissued_at, p.disabled_at), ',' order by p.booth_id), '')) from public.booth_pin p),
      (select md5(coalesce(string_agg(row_to_json(l)::text, ',' order by l.booth_id), '')) from public.booth_live l),
      (select concat(count(*), '/', coalesce(max(g.id), 0)) from public.booth_live_log g),
      (select md5(coalesce(string_agg(concat_ws(':', s.id, s.booth_id, s.created_at, s.expires_at, s.revoked_at, s.revoke_reason), ',' order by s.id), '')) from public.booth_session s),
      (select concat(count(*), '/', coalesce(max(e.id), 0)) from public.booth_auth_event e),
      (select md5(coalesce(string_agg(row_to_json(v)::text, ',' order by v.booth_id), '')) from public.booth_private v)
    ))`;
const realFp = drop => `(select md5(coalesce(string_agg((row_to_json(b)::jsonb ${drop.map(c => `- ${q(c)}`).join(' ')})::text, ',' order by b.id), ''))
       from public.booths b where b.id = any(c_real))`;
const othersFp = `(select md5(coalesce(string_agg(row_to_json(b)::text, ',' order by b.id), '')) from public.booths b where b.id <> all(c_real))`;
const zonesFp = (exceptVar, drop = []) => `(select md5(coalesce(string_agg((row_to_json(z)::jsonb ${drop.map(c => `- ${q(c)}`).join(' ')})::text, ',' order by z.key), ''))
       from public.zones z where z.key <> all(${exceptVar}))`;
const zonesOnlyFp = (onlyVar, drop = []) => `(select md5(coalesce(string_agg((row_to_json(z)::jsonb ${drop.map(c => `- ${q(c)}`).join(' ')})::text, ',' order by z.key), ''))
       from public.zones z where z.key = any(${onlyVar}))`;
const settingsFp = `(select md5(row_to_json(s)::text) from public.settings s where s.id = 1)`;
// 운영자 화면이 열리는 열쇠(공개 + 구역 공개 + 번호 + 꺼지지 않음) — booth_ctrl_get 과 같은 조건
const gateOpen = idsExpr => `(select count(*) from public.booth_access a join public.booths b on b.id = a.booth_id join public.zones z on z.key = b.zone_key
       where a.disabled_at is null and b.is_published and z.is_published and b.no is not null and b.id = any(${idsExpr}))`;

// 공통 선언: 실제 · 예시 목록과 배치안(부스마다 구역 · 번호 · 표시 코드)
function decl(m, plan, zones) {
  return `  c_real constant uuid[] := ${uuids(m.realIds)};
  c_ex   constant uuid[] := ${uuids(m.exampleIds)};
  c_exz  constant text[] := ${texts(m.exampleZones)};
  c_ids  constant uuid[] := ${uuids(plan.map(p => p.id))};
  c_zone constant text[] := ${texts(plan.map(p => p.zone))};
  c_no   constant int[]  := ${ints(plan.map(p => p.no))};
  c_code constant text[] := ${texts(plan.map(p => p.code))};
  c_zk   constant text[] := ${texts(zones.map(z => z.key))};
  c_zl   constant text[] := ${texts(zones.map(z => z.label))};
  c_zs   constant text[] := ${texts(zones.map(z => z.sub || ''))};
  c_zo   constant int[]  := ${ints(zones.map(z => z.order))};
  c_zf   constant int[]  := ${ints(zones.map(z => z.from))};
  c_zt   constant int[]  := ${ints(zones.map(z => z.to))};`;
}
// 목록 자체가 맞는지(어느 단계든 맨 앞에서)
function listGuards(m) {
  return `  if (select count(distinct x) from unnest(c_real) x) <> ${m.realIds.length} or (select count(distinct x) from unnest(c_ex) x) <> ${m.exampleIds.length}
     or exists (select 1 from unnest(c_ex) x where x = any(c_real)) then
    raise exception '[중단] 실제 · 예시 목록에 중복 · 겹침이 있습니다.';
  end if;
  if (select count(*) from public.booths where id = any(c_real) and org !~ ${SAMPLE}) <> ${m.realIds.length} then
    raise exception '[중단] 실제 부스 ${m.realIds.length}곳이 모두 있지 않거나 [예시] 가 섞여 있습니다.';
  end if;
  if (select count(*) from public.booths where id = any(c_ex) and org ~ ${SAMPLE}) <> ${m.exampleIds.length} then
    raise exception '[중단] 예시 부스 ${m.exampleIds.length}곳이 그대로가 아닙니다.';
  end if;
  if (select count(*) from public.booths) <> ${m.realIds.length + m.exampleIds.length} then
    raise exception '[중단] 전체 부스 수가 % 곳입니다(기대 ${m.realIds.length + m.exampleIds.length}).', (select count(*) from public.booths);
  end if;
  if exists (select 1 from public.booths where id = any(c_ex) and is_published)
     or exists (select 1 from public.zones where key = any(c_exz) and is_published) then
    raise exception '[중단] 예시 부스 · 예시 구역(A~E) 중 공개된 것이 있습니다(지금은 모두 비공개여야 함).';
  end if;
  if exists (select 1 from unnest(c_zk) k where k = any(c_exz)) then
    raise exception '[중단] 배치안 구역 코드에 예시 구역(A~E)이 있습니다.';
  end if;
  if (select count(*) from unnest(c_ids) x where x = any(c_real)) <> ${m.realIds.length} or cardinality(c_ids) <> ${m.realIds.length} then
    raise exception '[중단] 배치안이 실제 ${m.realIds.length}곳과 정확히 같지 않습니다.';
  end if;`;
}
// 배치안대로인 부스 수(공개 여부 조건은 extra 로)
const atPlan = (extra = '') => `(select count(*) from public.booths b join unnest(c_ids, c_zone, c_no, c_code) p(id, zone, no, code) on p.id = b.id
       where b.zone_key = p.zone and b.no = p.no and b.code = p.code ${extra})`;

export function assignSqls(m, plan, zones) {
  const N = m.realIds.length;
  const result = `(select json_build_object(
      'booths', (select count(*) from public.booths),
      'published', (select count(*) from public.booths where is_published),
      'real_at_plan', (select count(*) from public.booths b join unnest(${uuids(plan.map(p => p.id))}, ${texts(plan.map(p => p.zone))}, ${ints(plan.map(p => p.no))}) p(id, zone, no) on p.id = b.id where b.zone_key = p.zone and b.no = p.no),
      'real_published', (select count(*) from public.booths where id = any(${uuids(m.realIds)}) and is_published),
      'zones', (select string_agg(key || ':' || is_published, ',' order by sort_order, key) from public.zones where key = any(${texts(zones.map(z => z.key))})),
      'preview', (select count(*) from public.booth_preview_list()),
      'operator_qr_open', (select count(*) from public.booth_access a join public.booths b on b.id = a.booth_id join public.zones z on z.key = b.zone_key
          where a.disabled_at is null and b.is_published and z.is_published and b.no is not null)))`;

  const pre = head('T-01 임시 배치 직전 확인 (읽기 전용)', m, [
    '쓰기 없음. 결과 한 줄을 기록합니다.',
    `기대: 실제 ${N}(공개 0 · 배정 0 · 사전 안내 ${N}) · 예시 ${m.exampleIds.length}(비공개 · A~E) · ${zones.map(z => z.key).join('/')} 없음 · 그 구역을 쓰는 부스 0`,
    '      QR 134(실제 84) · 열리는 QR 0 · 공개 구역 0']) + `
select
  (select count(*) from public.booths) as 전체_부스,
  (select count(*) from public.booths where id = any(${uuids(m.realIds)})) as 실제,
  (select count(*) from public.booths where id = any(${uuids(m.realIds)}) and (is_published or zone_key is not null or no is not null)) as 실제_공개_또는_배정,
  (select count(*) from public.booths where id = any(${uuids(m.realIds)}) and preview_listed) as 실제_사전안내,
  (select count(*) from public.booths where id = any(${uuids(m.exampleIds)}) and org ~ ${SAMPLE} and not is_published) as 예시_비공개,
  (select count(*) from public.booths where id = any(${uuids(m.exampleIds)}) and zone_key = any(${texts(m.exampleZones)})) as 예시_AE_자리,
  (select count(*) from public.zones where key = any(${texts(zones.map(z => z.key))})) as 임시구역_이미있음,
  (select count(*) from public.booths where zone_key = any(${texts(zones.map(z => z.key))})) as 임시구역_사용부스,
  (select count(*) from public.zones where is_published) as 공개_구역,
  (select count(*) from public.booth_access) as qr_전체,
  (select count(*) from public.booth_access where booth_id = any(${uuids(m.realIds)})) as 실제_qr,
  (select md5(string_agg(to_jsonb(a)::text, ',' order by a.booth_id)) from public.booth_access a) as qr_지문,
  (select count(*) from public.booth_access a join public.booths b on b.id = a.booth_id join public.zones z on z.key = b.zone_key
     where a.disabled_at is null and b.is_published and z.is_published and b.no is not null) as 열리는_qr,
  (select count(*) from public.booth_pin) as pin_전체,
  (select concat(count(*), '/', max(id)) from public.booth_live_log) as 대기기록_건수_최대id;
`;

  const run = head(`T-02 임시 구역 ${zones.map(z => z.key).join('·')} 만들기 + 실제 ${N}곳 배정 (비공개 유지)`, m, [
    '이 파일 하나를 SQL Editor 에 통째로 붙여 실행합니다(관리자 계정 · Role postgres).',
    `쓰기: zones(${zones.map(z => z.key).join(' · ')} 새로 · 비공개) · booths(실제 ${N}곳의 구역 · 번호만 — 표시 코드는 트리거가 만듭니다).`,
    '관람객 화면은 바뀌지 않습니다(아직 비공개 → 계속 \'배치 준비 중\'). 운영자 QR 도 아직 열리지 않습니다.',
    '지우는 것 없음. QR · PIN · 대기 값 · 기록 · 세션 · 예시 부스 · 다른 구역 · 설정은 그대로(지문으로 확인).',
    '이미 이 배치안대로 되어 있으면 아무것도 바꾸지 않고 끝납니다. 실패하면 전체가 되돌아갑니다 — 오류가 보이면 rollback; 한 번.'
  ]) + `
begin isolation level repeatable read;
set local lock_timeout = '5s';

do $t2$
declare
${decl(m, plan, zones)}
  v_fp text; v_others text; v_real text; v_zones text; v_set text; v_n int;
begin
${listGuards(m)}
  -- 이미 적용된 상태면 끝(바꾸지 않음)
  if ${atPlan()} = ${N} and (select count(*) from public.zones where key = any(c_zk)) = cardinality(c_zk) then
    raise notice '[이미 적용] 배치안대로 되어 있습니다 — 바꾼 것 없음';
    return;
  end if;
  -- 실행 전 확인. 임시 구역 행이 이미 있으면 '이 파일이 만든 그대로(이름 · 부제 · 순서) · 비공개 · 빈 구역' 일 때만 다시 씁니다
  -- (T-09a 로 배정을 되돌린 뒤 다시 배정하는 경우). 그 밖의 같은 코드 구역이 있으면 멈춥니다.
  if exists (select 1 from public.zones z join unnest(c_zk, c_zl, c_zs, c_zo) u(k, l, s, o) on u.k = z.key
              where z.is_published or z.label <> u.l or z.sub <> u.s or z.sort_order <> u.o
                 or exists (select 1 from public.booths b where b.zone_key = z.key)) then
    raise exception '[중단] 임시 구역 코드(%)가 이미 있습니다(이 배치안이 만든 빈 비공개 구역이 아님).', (select string_agg(key, ',' order by key) from public.zones where key = any(c_zk));
  end if;
  if exists (select 1 from public.booths where zone_key = any(c_zk)) then
    raise exception '[중단] 임시 구역 코드를 쓰는 부스가 있습니다.';
  end if;
  if exists (select 1 from public.booths where id = any(c_real) and (is_published or zone_key is not null or no is not null)) then
    raise exception '[중단] 실제 부스 중 이미 공개되었거나 구역 · 번호가 있는 곳이 있습니다.';
  end if;
  if (select count(*) from public.booths where id = any(c_real) and preview_listed) <> ${N} then
    raise exception '[중단] 실제 부스 사전 안내가 % 곳입니다(기대 ${N}).', (select count(*) from public.booths where id = any(c_real) and preview_listed);
  end if;
  if (select count(*) from (select z, n from unnest(c_zone, c_no) u(z, n) group by z, n having count(*) > 1) d) > 0
     or exists (select 1 from unnest(c_zone) z where z <> all(c_zk))
     or exists (select 1 from unnest(c_no) n where n not between 1 and 999) then
    raise exception '[중단] 배치안에 같은 구역 번호 중복 · 없는 구역 · 범위 밖 번호가 있습니다.';
  end if;
  v_fp := ${protectedFp};
  v_others := ${othersFp};
  v_real := ${realFp(['zone_key', 'no', 'code', 'updated_at'])};
  v_zones := ${zonesFp('c_zk')};
  v_set := ${settingsFp};

  -- 바꾸기
  insert into public.zones (key, label, sub, sort_order, range_from, range_to, is_published)
  select k, l, s, o, f, t, false from unnest(c_zk, c_zl, c_zs, c_zo, c_zf, c_zt) u(k, l, s, o, f, t)
   where not exists (select 1 from public.zones z where z.key = u.k);
  update public.booths b set zone_key = p.zone, no = p.no
    from unnest(c_ids, c_zone, c_no) p(id, zone, no)
   where b.id = p.id and b.zone_key is null and b.no is null and not b.is_published;
  get diagnostics v_n = row_count;
  if v_n <> ${N} then
    raise exception '[중단] 배정한 부스가 % 곳입니다(기대 ${N}).', v_n;
  end if;

  -- 실행 뒤 확인
  if ${atPlan('and not b.is_published')} <> ${N} then
    raise exception '[중단] 배치안과 다른 부스가 있습니다(구역 · 번호 · 표시 코드).';
  end if;
  if (select count(*) from public.booths where is_published) <> 0 then
    raise exception '[중단] 공개된 부스가 생겼습니다.';
  end if;
  if (select count(*) from public.zones where key = any(c_zk) and not is_published) <> cardinality(c_zk) then
    raise exception '[중단] 임시 구역이 기대와 다릅니다.';
  end if;
  if (select count(*) from public.booth_preview_list() p where p.id = any(c_real)) <> ${N} then
    raise exception '[중단] 사전 안내 목록이 실제 ${N}곳이 아닙니다(비공개 배정 중에는 그대로여야 함).';
  end if;
  if ${protectedFp} is distinct from v_fp then
    raise exception '[중단] QR · PIN · 대기 값 · 기록 · 세션 · 보안 기록 · 비공개 칸 중 무언가가 바뀌었습니다.';
  end if;
  if ${othersFp} is distinct from v_others or ${realFp(['zone_key', 'no', 'code', 'updated_at'])} is distinct from v_real
     or ${zonesFp('c_zk')} is distinct from v_zones or ${settingsFp} is distinct from v_set then
    raise exception '[중단] 예시 · 다른 부스 · 실제 부스의 다른 칸 · 다른 구역 · 설정 중 무언가가 바뀌었습니다.';
  end if;
  raise notice '[배정 완료] 임시 구역 % 곳 · 실제 % 곳 배정(비공개)', cardinality(c_zk), v_n;
end
$t2$;

commit;

select ${result} as 결과;
`;

  const publish = head(`T-03 임시 배치 공개 — 구역 ${zones.map(z => z.key).join('·')} → 실제 ${N}곳`, m, [
    '이 파일 하나를 SQL Editor 에 통째로 붙여 실행합니다(관리자 계정 · Role postgres). T-02 다음에만 됩니다.',
    `쓰기: zones(${zones.map(z => z.key).join(' · ')} 공개) → booths(실제 ${N}곳 공개). 구역을 먼저 공개합니다(트리거 규칙).`,
    `관람객 화면: 임시 구역 · 번호(${plan[0].code} …)와 함께 ${N}곳이 목록에 보이고 '배치 준비 중' 묶음은 저절로 빠집니다.`,
    '            행사 첫날 전이라 대기 값은 관람객에게 보이지 않습니다(관람객 API 규칙).',
    `운영자 QR: 실제 ${N}곳의 인쇄한 QR 이 그대로 열립니다(열쇠는 바꾸지 않음). 예시 부스 · A~E 는 비공개 그대로.`,
    '이미 공개되어 있으면 아무것도 바꾸지 않고 끝납니다. 실패하면 전체가 되돌아갑니다.'
  ]) + `
begin isolation level repeatable read;
set local lock_timeout = '5s';

do $t3$
declare
${decl(m, plan, zones)}
  v_fp text; v_others text; v_real text; v_zones text; v_zr text; v_set text; v_n int;
begin
${listGuards(m)}
  if ${atPlan('and b.is_published')} = ${N} and (select count(*) from public.zones where key = any(c_zk) and is_published) = cardinality(c_zk) then
    raise notice '[이미 공개] 바꾼 것 없음';
    return;
  end if;
  if ${atPlan('and not b.is_published')} <> ${N} then
    raise exception '[중단] T-02 배정이 배치안대로가 아닙니다(먼저 T-02 · T-04 확인).';
  end if;
  if (select count(*) from public.zones where key = any(c_zk) and not is_published) <> cardinality(c_zk) then
    raise exception '[중단] 임시 구역이 없거나 일부가 이미 공개되어 있습니다.';
  end if;
  if (select count(*) from public.booths where is_published) <> 0 or (select count(*) from public.zones where is_published) <> 0 then
    raise exception '[중단] 이미 공개된 부스 · 구역이 있습니다(공개 0 에서만 진행).';
  end if;
  v_fp := ${protectedFp};
  v_others := ${othersFp};
  v_real := ${realFp(['is_published', 'updated_at'])};
  v_zones := ${zonesFp('c_zk')};
  v_zr := ${zonesOnlyFp('c_zk', ['is_published'])};
  v_set := ${settingsFp};

  update public.zones set is_published = true where key = any(c_zk) and not is_published;
  update public.booths set is_published = true where id = any(c_real) and not is_published;
  get diagnostics v_n = row_count;

  if v_n <> ${N} or ${atPlan('and b.is_published')} <> ${N} then
    raise exception '[중단] 공개한 부스가 % 곳입니다(기대 ${N}).', v_n;
  end if;
  if (select count(*) from public.booths where is_published) <> ${N} or exists (select 1 from public.booths where is_published and id <> all(c_real)) then
    raise exception '[중단] 실제 ${N}곳 밖의 부스가 공개되었습니다.';
  end if;
  if (select count(*) from public.zones where is_published) <> cardinality(c_zk) or exists (select 1 from public.zones where is_published and key <> all(c_zk)) then
    raise exception '[중단] 임시 구역 밖의 구역이 공개되었습니다.';
  end if;
  if (select count(*) from public.booth_preview_list()) <> 0 then
    raise exception '[중단] 사전 안내 목록이 남았습니다(공개 뒤에는 0).';
  end if;
  if ${gateOpen('c_real')} <> ${N} or ${gateOpen('c_ex')} <> 0 then
    raise exception '[중단] 운영자 QR 이 열리는 부스 수가 기대와 다릅니다(실제 ${N} · 예시 0).';
  end if;
  if ${protectedFp} is distinct from v_fp then
    raise exception '[중단] QR · PIN · 대기 값 · 기록 · 세션 · 보안 기록 · 비공개 칸 중 무언가가 바뀌었습니다.';
  end if;
  if ${othersFp} is distinct from v_others or ${realFp(['is_published', 'updated_at'])} is distinct from v_real
     or ${zonesFp('c_zk')} is distinct from v_zones or ${zonesOnlyFp('c_zk', ['is_published'])} is distinct from v_zr or ${settingsFp} is distinct from v_set then
    raise exception '[중단] 예시 · 다른 부스 · 실제 부스의 다른 칸 · 구역 · 설정 중 무언가가 바뀌었습니다.';
  end if;
  raise notice '[공개 완료] 임시 구역 % 곳 · 실제 % 곳 · 열리는 운영자 QR %', cardinality(c_zk), v_n, ${N};
end
$t3$;

commit;

select ${result} as 결과;
`;

  const verify = head('T-04 공개 뒤 확인 (읽기 전용)', m, [
    `기대: 전체 134 · 공개 ${N}(모두 실제) · 배치안대로 ${N} · 임시 구역 ${zones.length} 공개 · 다른 구역 공개 0 · 사전 안내 0`,
    `      열리는 운영자 QR ${N}(예시 0) · QR 134 · QR 지문 = T-01 · PIN 2 · 대기 기록 = T-01(리허설 전)`]) + `
select
  ${result.replace(/^\(select /, '').replace(/\)$/, '')} as 결과,
  (select md5(string_agg(to_jsonb(a)::text, ',' order by a.booth_id)) from public.booth_access a) as qr_지문,
  (select count(*) from public.zones where is_published and key <> all(${texts(zones.map(z => z.key))})) as 다른_공개구역,
  (select count(*) from public.booths where is_published and id <> all(${uuids(m.realIds)})) as 실제밖_공개부스,
  (select count(*) from public.booth_pin) as pin_전체,
  (select concat(count(*), '/', max(id)) from public.booth_live_log) as 대기기록_건수_최대id,
  (select count(*) from public.booth_live where booth_id = any(${uuids(m.realIds)})) as 실제_대기값;
`;

  const unassign = head('T-09a 배정 되돌리기 — 공개 전에만(구역 · 번호 비우기)', m, [
    '쓸 때: T-02 뒤 T-03 전에 배정을 취소할 때만. 이미 공개되었으면 멈춥니다(그때는 T-09b).',
    `쓰기: booths(실제 ${N}곳 구역 · 번호 비움 → '배치 미정'). 임시 구역 행은 지우지 않고 비공개로 둡니다.`,
    'QR · PIN · 대기 값 · 기록은 그대로.']) + `
begin isolation level repeatable read;
set local lock_timeout = '5s';

do $t9a$
declare
${decl(m, plan, zones)}
  v_fp text; v_others text; v_n int;
begin
${listGuards(m)}
  if exists (select 1 from public.booths where id = any(c_real) and is_published) then
    raise exception '[중단] 이미 공개된 부스가 있습니다 — 공개 되돌리기(T-09b)를 먼저 검토하세요.';
  end if;
  if exists (select 1 from public.booths where zone_key = any(c_zk) and id <> all(c_real)) then
    raise exception '[중단] 임시 구역에 실제 ${N}곳 밖의 부스가 있습니다.';
  end if;
  v_fp := ${protectedFp};
  v_others := ${othersFp};
  update public.booths set zone_key = null, no = null where id = any(c_real) and zone_key = any(c_zk);
  get diagnostics v_n = row_count;
  if exists (select 1 from public.booths where id = any(c_real) and (zone_key is not null or no is not null or is_published)) then
    raise exception '[중단] 비우지 못한 부스가 있습니다.';
  end if;
  if (select count(*) from public.booth_preview_list() p where p.id = any(c_real)) <> ${N} then
    raise exception '[중단] 사전 안내 목록이 실제 ${N}곳으로 돌아오지 않았습니다.';
  end if;
  if ${protectedFp} is distinct from v_fp or ${othersFp} is distinct from v_others then
    raise exception '[중단] QR · 기록 · 예시 등 바뀌면 안 되는 것이 바뀌었습니다.';
  end if;
  raise notice '[배정 되돌림] % 곳 배치 미정으로', v_n;
end
$t9a$;

commit;

select ${result} as 결과;
`;

  const unpublish = head('T-09b 공개 되돌리기 — 비상용(관람객 화면을 \'배치 준비 중\' 으로)', m, [
    '쓸 때: 공개 뒤 임시 배치를 관람객 화면에서 즉시 내려야 할 때만(별도 승인). 계획상 리허설 뒤에도 공개를 유지합니다.',
    `쓰기: booths(실제 ${N}곳 비공개) → zones(임시 구역 비공개). 구역 · 번호는 그대로 둡니다(다시 T-03 으로 공개 가능).`,
    '결과: 관람객 화면은 사전 안내(배치 준비 중)로 돌아가고, 운영자 QR 은 닫힙니다. QR 열쇠 자체는 그대로.']) + `
begin isolation level repeatable read;
set local lock_timeout = '5s';

do $t9b$
declare
${decl(m, plan, zones)}
  v_fp text; v_others text;
begin
${listGuards(m)}
  v_fp := ${protectedFp};
  v_others := ${othersFp};
  update public.booths set is_published = false where id = any(c_real) and is_published;
  update public.zones set is_published = false where key = any(c_zk) and is_published;
  if exists (select 1 from public.booths where id = any(c_real) and is_published) or exists (select 1 from public.zones where key = any(c_zk) and is_published) then
    raise exception '[중단] 비공개로 바뀌지 않은 것이 있습니다.';
  end if;
  if (select count(*) from public.booth_preview_list() p where p.id = any(c_real)) <> ${N} or ${gateOpen('c_real')} <> 0 then
    raise exception '[중단] 사전 안내 ${N} · 열리는 QR 0 이 아닙니다.';
  end if;
  if ${protectedFp} is distinct from v_fp or ${othersFp} is distinct from v_others then
    raise exception '[중단] QR · 기록 · 예시 등 바뀌면 안 되는 것이 바뀌었습니다.';
  end if;
  raise notice '[공개 되돌림] 실제 ${N}곳 · 임시 구역 비공개';
end
$t9b$;

commit;

select ${result} as 결과;
`;
  return { pre, run, publish, verify, unassign, unpublish };
}

/* 옮기기(공개 유지) — 최종 배치 확정 뒤 R → 최종, 또는 거꾸로.
   mv = { name, fromKeys: ['R1',…], plan: [{id, zone, no, code}], zones: [{key, label, sub, order, from, to}] }
   · 받는 구역은 새 코드면 공개로 새로 만들고, 이미 있는 빈 구역(F~J · 비공개였던 임시 구역 등)이면 이름 · 순서 · 부제를 고쳐 공개합니다.
   · 보내는 구역(fromKeys)은 다 비면 비공개로 둡니다(지우지 않음).
   · 받는 구역과 보내는 구역이 겹치면 안 됩니다(같은 구역 안 번호 바꾸기는 유일 제약에 걸릴 수 있어 따로 다룸). */
export function moveSqls(m, mv) {
  const N = m.realIds.length;
  const toKeys = mv.zones.map(z => z.key);
  const result = `(select json_build_object(
      'published', (select count(*) from public.booths where is_published),
      'real_at_plan', (select count(*) from public.booths b join unnest(${uuids(mv.plan.map(p => p.id))}, ${texts(mv.plan.map(p => p.zone))}, ${ints(mv.plan.map(p => p.no))}) p(id, zone, no) on p.id = b.id where b.zone_key = p.zone and b.no = p.no and b.is_published),
      'to_zones', (select string_agg(key || ':' || is_published, ',' order by sort_order, key) from public.zones where key = any(${texts(toKeys)})),
      'from_zones', (select string_agg(key || ':' || is_published || ':' || (select count(*) from public.booths b where b.zone_key = z.key), ',' order by sort_order, key) from public.zones z where key = any(${texts(mv.fromKeys)})),
      'preview', (select count(*) from public.booth_preview_list()),
      'operator_qr_open', (select count(*) from public.booth_access a join public.booths b on b.id = a.booth_id join public.zones z on z.key = b.zone_key
          where a.disabled_at is null and b.is_published and z.is_published and b.no is not null)))`;

  const pre = head(`F-01 옮기기 직전 확인 (읽기 전용) — ${mv.name}`, m, [
    `기대: 실제 ${N} 모두 공개 · 모두 ${mv.fromKeys.join('/')} 안 · 받는 구역(${toKeys.join('/')})에 다른 부스 0 · 열리는 QR ${N}`]) + `
select
  (select count(*) from public.booths where id = any(${uuids(m.realIds)}) and is_published) as 실제_공개,
  (select count(*) from public.booths where id = any(${uuids(m.realIds)}) and zone_key = any(${texts(mv.fromKeys)})) as 보내는구역_안,
  (select string_agg(key || ':' || is_published, ',' order by key) from public.zones where key = any(${texts(toKeys)})) as 받는구역_이미있음,
  (select count(*) from public.booths where zone_key = any(${texts(toKeys)})) as 받는구역_부스,
  (select md5(string_agg(to_jsonb(a)::text, ',' order by a.booth_id)) from public.booth_access a) as qr_지문,
  (select count(*) from public.booth_access a join public.booths b on b.id = a.booth_id join public.zones z on z.key = b.zone_key
     where a.disabled_at is null and b.is_published and z.is_published and b.no is not null) as 열리는_qr;
`;

  const run = head(`F-02 구역 · 번호 옮기기(공개 유지 · 같은 QR) — ${mv.name}`, m, [
    '이 파일 하나를 SQL Editor 에 통째로 붙여 실행합니다(관리자 계정 · Role postgres).',
    `쓰기: zones(받는 구역 ${toKeys.join(' · ')} 공개 — 새로 만들거나 빈 구역 고침) → booths(실제 ${N}곳 구역 · 번호) → zones(보내는 구역 ${mv.fromKeys.join(' · ')} 비공개).`,
    '한 트랜잭션이라 관람객 화면은 옛 번호에서 새 번호로 한 번에 바뀝니다. 부스가 사라지는 순간이 없습니다.',
    '운영자 QR 은 그대로 열립니다(열쇠 · 부스 UUID 그대로 — 화면의 번호만 새 번호로). 대기 값 · 기록도 그대로.',
    '이미 옮겨져 있으면 아무것도 바꾸지 않고 끝납니다. 실패하면 전체가 되돌아갑니다.'
  ]) + `
begin isolation level repeatable read;
set local lock_timeout = '5s';

do $f2$
declare
${decl(m, mv.plan, mv.zones)}
  c_from constant text[] := ${texts(mv.fromKeys)};
  v_fp text; v_others text; v_real text; v_zones text; v_set text; v_n int;
begin
${listGuards(m)}
  if exists (select 1 from unnest(c_zk) k where k = any(c_from)) then
    raise exception '[중단] 받는 구역과 보내는 구역이 겹칩니다.';
  end if;
  if exists (select 1 from unnest(c_zk) k where k !~ '^[A-Z][A-Z0-9]{0,2}$') then
    raise exception '[중단] 구역 코드 형식이 아닙니다(영문 대문자로 시작 1~3자).';
  end if;
  if (select count(*) from (select z, n from unnest(c_zone, c_no) u(z, n) group by z, n having count(*) > 1) d) > 0
     or exists (select 1 from unnest(c_zone) z where z <> all(c_zk))
     or exists (select 1 from unnest(c_no) n where n not between 1 and 999) then
    raise exception '[중단] 배치안에 같은 구역 번호 중복 · 없는 구역 · 범위 밖 번호가 있습니다.';
  end if;
  -- 이미 옮겨진 상태면 끝
  if ${atPlan('and b.is_published')} = ${N} and (select count(*) from public.zones where key = any(c_zk) and is_published) = cardinality(c_zk) then
    raise notice '[이미 적용] 배치안대로 공개되어 있습니다 — 바꾼 것 없음';
    return;
  end if;
  if (select count(*) from public.booths where id = any(c_real) and is_published and zone_key = any(c_from) and no is not null) <> ${N} then
    raise exception '[중단] 실제 ${N}곳이 모두 공개 상태로 보내는 구역(%) 안에 있지 않습니다.', array_to_string(c_from, ',');
  end if;
  if exists (select 1 from public.booths where zone_key = any(c_zk)) then
    raise exception '[중단] 받는 구역에 이미 부스가 있습니다.';
  end if;
  if exists (select 1 from public.booths where is_published and id <> all(c_real)) then
    raise exception '[중단] 실제 ${N}곳 밖에 공개된 부스가 있습니다.';
  end if;
  v_fp := ${protectedFp};
  v_others := ${othersFp};
  v_real := ${realFp(['zone_key', 'no', 'code', 'updated_at'])};
  v_zones := (select md5(coalesce(string_agg(row_to_json(z)::text, ',' order by z.key), '')) from public.zones z where z.key <> all(c_zk) and z.key <> all(c_from));
  v_set := ${settingsFp};

  -- 받는 구역: 이미 있는 빈 구역은 고쳐 공개, 없으면 공개로 새로
  update public.zones z set label = u.l, sub = u.s, sort_order = u.o, range_from = u.f, range_to = u.t, is_published = true
    from unnest(c_zk, c_zl, c_zs, c_zo, c_zf, c_zt) u(k, l, s, o, f, t) where z.key = u.k;
  insert into public.zones (key, label, sub, sort_order, range_from, range_to, is_published)
  select k, l, s, o, f, t, true from unnest(c_zk, c_zl, c_zs, c_zo, c_zf, c_zt) u(k, l, s, o, f, t)
   where not exists (select 1 from public.zones z where z.key = u.k);
  -- 부스 옮기기(공개 그대로)
  update public.booths b set zone_key = p.zone, no = p.no
    from unnest(c_ids, c_zone, c_no) p(id, zone, no)
   where b.id = p.id and b.zone_key = any(c_from) and b.is_published;
  get diagnostics v_n = row_count;
  if v_n <> ${N} then
    raise exception '[중단] 옮긴 부스가 % 곳입니다(기대 ${N}).', v_n;
  end if;
  -- 보내는 구역: 비었으면 비공개
  if exists (select 1 from public.booths where zone_key = any(c_from)) then
    raise exception '[중단] 보내는 구역에 부스가 남았습니다.';
  end if;
  update public.zones set is_published = false where key = any(c_from) and is_published;

  -- 실행 뒤 확인
  if ${atPlan('and b.is_published')} <> ${N} then
    raise exception '[중단] 배치안과 다른 부스가 있습니다(구역 · 번호 · 표시 코드 · 공개).';
  end if;
  if (select count(*) from public.booths where is_published) <> ${N} or (select count(*) from public.booth_preview_list()) <> 0 then
    raise exception '[중단] 공개 부스 수 · 사전 안내 목록이 기대와 다릅니다.';
  end if;
  if (select count(*) from public.zones where is_published) <> cardinality(c_zk) or exists (select 1 from public.zones where is_published and key <> all(c_zk)) then
    raise exception '[중단] 공개 구역이 받는 구역과 다릅니다.';
  end if;
  if ${gateOpen('c_real')} <> ${N} or ${gateOpen('c_ex')} <> 0 then
    raise exception '[중단] 운영자 QR 이 열리는 부스 수가 기대와 다릅니다.';
  end if;
  if ${protectedFp} is distinct from v_fp then
    raise exception '[중단] QR · PIN · 대기 값 · 기록 · 세션 · 보안 기록 · 비공개 칸 중 무언가가 바뀌었습니다.';
  end if;
  if ${othersFp} is distinct from v_others or ${realFp(['zone_key', 'no', 'code', 'updated_at'])} is distinct from v_real
     or (select md5(coalesce(string_agg(row_to_json(z)::text, ',' order by z.key), '')) from public.zones z where z.key <> all(c_zk) and z.key <> all(c_from)) is distinct from v_zones
     or ${settingsFp} is distinct from v_set then
    raise exception '[중단] 예시 · 다른 부스 · 실제 부스의 다른 칸 · 다른 구역 · 설정 중 무언가가 바뀌었습니다.';
  end if;
  raise notice '[옮기기 완료] % 곳 · 받는 구역 % · 보내는 구역 비공개', v_n, array_to_string(c_zk, ',');
end
$f2$;

commit;

select ${result} as 결과;
`;

  const verify = head(`F-03 옮긴 뒤 확인 (읽기 전용) — ${mv.name}`, m, [
    `기대: 공개 ${N} · 배치안대로 ${N} · 받는 구역 공개 · 보내는 구역 비공개(부스 0) · 사전 안내 0 · 열리는 QR ${N} · QR 지문 = F-01`]) + `
select
  ${result.replace(/^\(select /, '').replace(/\)$/, '')} as 결과,
  (select md5(string_agg(to_jsonb(a)::text, ',' order by a.booth_id)) from public.booth_access a) as qr_지문;
`;
  return { pre, run, verify };
}
