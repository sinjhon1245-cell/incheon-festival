/* ===================================================================
   Gate 3-C SQL 생성기 — 예시 → 실제 전환 · QR 사전 발급
   ───────────────────────────────────────────────────────────────────
   두 묶음을 만듭니다. 묶음마다 DO 블록 하나(REPEATABLE READ) — 확인 하나라도 틀리면 전체가 되돌아갑니다.

   A. 전환(transition)
        예시 50곳 비공개 · 예시 구역 A~E 비공개 · 실제 84곳 사전 안내(preview_listed) 켜기 ·
        예시 공통 PIN 끄기. 지우는 것 없음. QR · PIN · 대기 값 · 기록 · 세션 · 담당자는 건드리지 않습니다.
   B. QR 사전 발급(qr-preissue)
        실제 84곳에 운영자 QR 열쇠만 넣습니다(이미 있으면 그대로 — 바꾸지 않음).
        발급 뒤에도 운영자 접속은 막혀 있어야 합니다(booth_ctrl_get 이 0줄 — 블록 안에서 확인).
        열쇠 값은 어디에도 출력하지 않습니다.

   전제: supabase/migration-booth-preview.sql 이 먼저 적용돼 있어야 A 가 돕니다(칸 · 함수 확인).
   =================================================================== */

const q = s => `'${String(s).replace(/'/g, "''")}'`;
const SAMPLE = "'^\\s*\\[예시\\]'";
const arr = ids => `'{${ids.join(',')}}'::uuid[]`;
const textArr = xs => `'{${xs.join(',')}}'::text[]`;

const head = (title, meta, lines) => `-- ===================================================================
-- ${title}
-- 2026 인천 AI미래채움 교육페스티벌 · 실제 ${meta.real} · 예시 ${meta.examples}
-- manifest sha256 ${meta.sha256}
-- 만든 시각 ${meta.generatedAt} · scripts/booth-data/build-gate3c.mjs
${lines.map(l => `-- ${l}`).join('\n')}
-- ===================================================================
`;

// 바뀌면 안 되는 것의 지문(값은 DB 안에서만 비교 — 출력하지 않음).
// QR 열쇠 · PIN 해시도 지문에 넣어 ‘값이 바뀌지 않았음’ 을 보지만, 결과로 내보내지는 않습니다.
const protectedFp = (exceptAccessIds = null) => `(select concat_ws(' | ',
      (select md5(coalesce(string_agg(concat_ws(':', a.booth_id, md5(a.token), a.created_at, a.rotated_at, a.disabled_at), ',' order by a.booth_id), ''))
         from public.booth_access a ${exceptAccessIds ? `where a.booth_id <> all(${exceptAccessIds})` : ''}),
      (select md5(coalesce(string_agg(concat_ws(':', p.booth_id, md5(p.pin_hash), p.issued_at, p.reissued_at, p.disabled_at), ',' order by p.booth_id), '')) from public.booth_pin p),
      (select md5(coalesce(string_agg(row_to_json(l)::text, ',' order by l.booth_id), '')) from public.booth_live l),
      (select concat(count(*), '/', coalesce(max(g.id), 0)) from public.booth_live_log g),
      (select md5(coalesce(string_agg(concat_ws(':', s.id, s.booth_id, s.created_at, s.expires_at, s.revoked_at, s.revoke_reason), ',' order by s.id), '')) from public.booth_session s),
      (select concat(count(*), '/', coalesce(max(e.id), 0)) from public.booth_auth_event e),
      (select md5(coalesce(string_agg(row_to_json(v)::text, ',' order by v.booth_id), '')) from public.booth_private v)
    ))`;

// 부스 줄 지문 — 정해진 칸만 빼고 견줍니다.
const boothFp = (ids, dropCols) => `(select md5(coalesce(string_agg((row_to_json(b)::jsonb ${dropCols.map(c => `- ${q(c)}`).join(' ')})::text, ',' order by b.id), ''))
       from public.booths b where b.id = any(${ids}))`;

export function transitionSqls(m) {
  const EX = arr(m.exampleIds), RE = arr(m.realIds), ZK = textArr(m.exampleZones);
  const sets = `(select json_build_object(
      'booths', (select count(*) from public.booths),
      'published', (select count(*) from public.booths where is_published),
      'examples_published', (select count(*) from public.booths where id = any(${EX}) and is_published),
      'example_zones_published', (select count(*) from public.zones where key = any(${ZK}) and is_published),
      'real_listed', (select count(*) from public.booths where id = any(${RE}) and preview_listed),
      'common_pin', (select booth_sample_common_pin_enabled from public.settings where id = 1)))`;

  const pre = head('C-01 전환 직전 확인 (읽기 전용)', m, ['쓰기 없음. 결과 한 줄을 기록합니다.',
    '기대: 예시 50(공개 50) · 실제 84(공개 0 · 배정 0 · 사전 안내 0) · 예시 구역 A~E 공개 · preview 칸 · 함수 있음',
    '      열린 세션: 예시 리허설(공통 PIN) 중이면 0 이 아닐 수 있습니다 — C-02 뒤 모두 멈춥니다(실행을 막지 않음)',
    '      Q-02(QR 사전 발급)를 먼저 했어도 이 확인의 값은 같습니다(QR 칸 없음)']) + `
select
  (select count(*) from public.booths where id = any(${EX})) as 예시,
  (select count(*) from public.booths where id = any(${EX}) and org ~ ${SAMPLE}) as 예시_표시,
  (select count(*) from public.booths where id = any(${EX}) and is_published) as 예시_공개,
  (select count(*) from public.booths where id = any(${RE})) as 실제,
  (select count(*) from public.booths where id = any(${RE}) and (is_published or zone_key is not null or no is not null)) as 실제_공개_또는_배정,
  (select count(*) from public.booths where id <> all(${EX}) and id <> all(${RE})) as 그밖의_부스,
  (select string_agg(key || ':' || is_published, ',' order by key) from public.zones where key = any(${ZK})) as 예시_구역,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'booths' and column_name = 'preview_listed') as preview_칸,
  exists (select 1 from pg_proc where proname = 'booth_preview_list' and pronamespace = 'public'::regnamespace) as preview_함수,
  (select count(*) from public.booth_session where revoked_at is null and expires_at > now()) as 열린_세션,
  (select booth_sample_common_pin_enabled from public.settings where id = 1) as 예시_공통pin,
  (select booth_pin_enabled from public.settings where id = 1) as pin_보조로그인,
  (select concat(count(*), '/', max(id)) from public.booth_live_log) as 대기기록_건수_최대id;
`;

  const run = head('C-02 전환 — 예시 비공개 · 실제 사전 안내 · 공통 PIN 끄기', m, [
    '이 파일 하나를 SQL Editor 에 통째로 붙여 실행합니다(관리자 계정 · Role postgres).',
    '쓰기: booths(예시 50 공개 끔 · 실제 84 사전 안내 켬) · zones(예시 A~E 공개 끔) · settings(예시 공통 PIN 끔).',
    '지우는 것 없음. QR · PIN · 대기 값 · 대기 기록 · 세션 · 보안 기록 · 담당자는 그대로(지문으로 확인).',
    '다시 실행해도 안전합니다(이미 바뀐 것은 다시 바꾸지 않음). 실패하면 전체가 되돌아갑니다 — 오류가 보이면 rollback; 한 번.'
  ]) + `
begin isolation level repeatable read;

do $c3$
declare
  c_ex   constant uuid[] := ${EX};
  c_real constant uuid[] := ${RE};
  c_zk   constant text[] := ${ZK};
  v_fp_before text; v_fp_after text; v_ex_before text; v_ex_after text; v_re_before text; v_re_after text;
  v_pin_on_before boolean; v_evt_before text; v_n int;
begin
  -- 1. 전제
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'booths' and column_name = 'preview_listed')
     or not exists (select 1 from pg_proc where proname = 'booth_preview_list' and pronamespace = 'public'::regnamespace) then
    raise exception '[중단] migration-booth-preview.sql 이 아직 적용되지 않았습니다.';
  end if;
  if (select count(distinct x) from unnest(c_ex) x) <> ${m.exampleIds.length} or (select count(distinct x) from unnest(c_real) x) <> ${m.realIds.length} then
    raise exception '[중단] 대상 UUID 목록에 중복이 있습니다.';
  end if;
  if exists (select 1 from unnest(c_ex) x where x = any(c_real)) then
    raise exception '[중단] 예시 목록과 실제 목록이 겹칩니다.';
  end if;
  if (select count(*) from public.booths where id = any(c_ex) and org ~ ${SAMPLE}) <> ${m.exampleIds.length} then
    raise exception '[중단] 예시 목록 ${m.exampleIds.length}곳이 모두 [예시] 부스가 아닙니다(%곳).', (select count(*) from public.booths where id = any(c_ex) and org ~ ${SAMPLE});
  end if;
  if (select count(*) from public.booths where id = any(c_real) and org !~ ${SAMPLE}) <> ${m.realIds.length} then
    raise exception '[중단] 실제 목록 ${m.realIds.length}곳이 모두 있지 않거나 [예시] 가 섞여 있습니다.';
  end if;
  if exists (select 1 from public.booths where id = any(c_real) and (is_published or zone_key is not null or no is not null)) then
    raise exception '[중단] 실제 부스 중 이미 공개되었거나 구역 · 번호가 배정된 곳이 있습니다. 이 전환은 배치 전 전용입니다.';
  end if;
  if exists (select 1 from public.booths where zone_key = any(c_zk) and id <> all(c_ex)) then
    raise exception '[중단] 예시 구역 A~E 에 예시가 아닌 부스가 있습니다.';
  end if;

  -- 2. 지금 상태(지문)
  v_fp_before := ${protectedFp()};
  v_ex_before := ${boothFp('c_ex', ['is_published', 'updated_at'])};
  v_re_before := ${boothFp('c_real', ['preview_listed', 'updated_at'])};
  select booth_pin_enabled, concat(event_start, '/', event_end) into v_pin_on_before, v_evt_before from public.settings where id = 1;

  -- 3. 바꾸기(이미 바뀐 것은 건너뜀)
  update public.booths set is_published = false where id = any(c_ex) and org ~ ${SAMPLE} and is_published;
  update public.zones  set is_published = false where key = any(c_zk) and is_published;
  update public.booths set preview_listed = true where id = any(c_real) and not preview_listed;
  update public.settings set booth_sample_common_pin_enabled = false where id = 1 and booth_sample_common_pin_enabled;

  -- 4. 사후 확인
  if exists (select 1 from public.booths where id = any(c_ex) and is_published) then
    raise exception '[중단] 공개된 예시 부스가 남았습니다.';
  end if;
  if exists (select 1 from public.zones where key = any(c_zk) and is_published) then
    raise exception '[중단] 공개된 예시 구역이 남았습니다.';
  end if;
  if (select count(*) from public.booths where is_published) <> 0 then
    raise exception '[중단] 공개 부스가 % 곳 남았습니다(기대 0).', (select count(*) from public.booths where is_published);
  end if;
  select count(*) into v_n from public.booth_preview_list() p where p.id = any(c_real);
  if v_n <> ${m.realIds.length} or (select count(*) from public.booth_preview_list()) <> ${m.realIds.length} then
    raise exception '[중단] 사전 안내 목록이 실제 % 곳 · 전체 % 곳입니다(기대 ${m.realIds.length}).', v_n, (select count(*) from public.booth_preview_list());
  end if;
  if exists (select 1 from public.booths where id = any(c_real) and (is_published or zone_key is not null or no is not null)) then
    raise exception '[중단] 실제 부스의 공개 · 배정이 바뀌었습니다.';
  end if;
  if (select booth_sample_common_pin_enabled from public.settings where id = 1) then
    raise exception '[중단] 예시 공통 PIN 이 아직 켜져 있습니다.';
  end if;
  if (select booth_pin_enabled from public.settings where id = 1) is distinct from v_pin_on_before
     or (select concat(event_start, '/', event_end) from public.settings where id = 1) is distinct from v_evt_before then
    raise exception '[중단] PIN 보조 로그인 스위치나 행사 시각이 바뀌었습니다.';
  end if;
  v_fp_after := ${protectedFp()};
  v_ex_after := ${boothFp('c_ex', ['is_published', 'updated_at'])};
  v_re_after := ${boothFp('c_real', ['preview_listed', 'updated_at'])};
  if v_fp_after is distinct from v_fp_before then
    raise exception '[중단] QR · PIN · 대기 값 · 기록 · 세션 · 보안 기록 · 담당자 중 무언가가 바뀌었습니다.';
  end if;
  if v_ex_after is distinct from v_ex_before or v_re_after is distinct from v_re_before then
    raise exception '[중단] 예시 · 실제 부스의 다른 칸이 바뀌었습니다.';
  end if;

  raise notice '[전환 완료] 예시 비공개 · 예시 구역 비공개 · 실제 % 곳 사전 안내 · 공통 PIN 끔', v_n;
end
$c3$;

commit;

select ${sets} as 결과;
`;

  const verify = head('C-03 전환 직후 확인 (읽기 전용)', m, [
    '기대: 공개 부스 0 · 예시 공개 0 · 예시 구역 공개 0 · 사전 안내 84 · 공통 PIN false · PIN 보조 로그인 true(그대로)',
    '        실제 84 공개 0 · 배정 0 · 실제 PIN 0 · 대기 기록 건수 = C-01 과 같음',
    '        실제 QR: Q-02 를 먼저 했으면 실제_qr 84 · qr_전체 134(예시 50 + 실제 84), 안 했으면 0 · 50']) + `
select
  (select count(*) from public.booths) as 전체_부스,
  (select count(*) from public.booths where is_published) as 공개_부스,
  (select count(*) from public.booths where id = any(${EX}) and is_published) as 예시_공개,
  (select count(*) from public.zones where key = any(${ZK}) and is_published) as 예시_구역_공개,
  (select count(*) from public.booth_preview_list()) as 사전_안내,
  (select count(*) from public.booth_preview_list() p where p.id = any(${RE})) as 사전_안내_실제,
  (select count(*) from public.booths where id = any(${RE}) and (is_published or zone_key is not null or no is not null)) as 실제_공개_또는_배정,
  (select count(*) from public.booth_access where booth_id = any(${RE})) as 실제_qr,
  (select count(*) from public.booth_pin where booth_id = any(${RE})) as 실제_pin,
  (select count(*) from public.booth_access) as qr_전체,
  (select count(*) from public.booth_pin) as pin_전체,
  (select booth_sample_common_pin_enabled from public.settings where id = 1) as 예시_공통pin,
  (select booth_pin_enabled from public.settings where id = 1) as pin_보조로그인,
  (select concat(count(*), '/', max(id)) from public.booth_live_log) as 대기기록_건수_최대id,
  (select count(*) from public.booth_session where revoked_at is null and expires_at > now()) as 열린_세션;
`;

  const rollback = head('C-09 전환 되돌리기 — 예시 다시 공개 · 사전 안내 끔 · 공통 PIN 다시 켬', m, [
    '전환 직전 상태(예시 50 공개 · 예시 구역 A~E 공개 · 사전 안내 0 · 공통 PIN 켜짐)로 돌립니다. 지우는 것 없음.',
    '실제 부스가 이미 배정 · 공개되었으면 멈춥니다(그 뒤 단계가 진행된 상태).',
    '공통 PIN 은 전환 전 값(켜짐)으로 돌립니다 — 다시 켜지 않으려면 c_restore_common_pin 을 false 로.'
  ]) + `
begin isolation level repeatable read;

do $c3rb$
declare
  c_ex   constant uuid[] := ${EX};
  c_real constant uuid[] := ${RE};
  c_zk   constant text[] := ${ZK};
  c_restore_common_pin constant boolean := true;
  v_fp_before text; v_fp_after text;
begin
  if exists (select 1 from public.booths where id = any(c_real) and (is_published or zone_key is not null or no is not null)) then
    raise exception '[중단] 실제 부스가 이미 배정 · 공개되었습니다. 이 되돌리기는 배치 전 전용입니다.';
  end if;
  if (select count(*) from public.booths where id = any(c_ex) and org ~ ${SAMPLE}) <> ${m.exampleIds.length} then
    raise exception '[중단] 예시 ${m.exampleIds.length}곳이 그대로가 아닙니다.';
  end if;
  v_fp_before := ${protectedFp()};

  update public.zones  set is_published = true where key = any(c_zk) and not is_published;     -- 구역 먼저(트리거: 비공개 구역의 부스는 공개 못 함)
  update public.booths set is_published = true where id = any(c_ex) and org ~ ${SAMPLE} and not is_published;
  update public.booths set preview_listed = false where id = any(c_real) and preview_listed;
  if c_restore_common_pin then
    update public.settings set booth_sample_common_pin_enabled = true where id = 1 and not booth_sample_common_pin_enabled;
  end if;

  if (select count(*) from public.booths where id = any(c_ex) and is_published) <> ${m.exampleIds.length}
     or exists (select 1 from public.zones where key = any(c_zk) and not is_published)
     or exists (select 1 from public.booths where id = any(c_real) and preview_listed) then
    raise exception '[중단] 되돌린 상태가 기대와 다릅니다.';
  end if;
  v_fp_after := ${protectedFp()};
  if v_fp_after is distinct from v_fp_before then
    raise exception '[중단] QR · PIN · 대기 값 · 기록 · 세션 중 무언가가 바뀌었습니다.';
  end if;
  raise notice '[되돌리기 완료] 예시 % 곳 공개 · 사전 안내 끔', ${m.exampleIds.length};
end
$c3rb$;

commit;

select ${sets} as 결과;
`;
  return { pre, run, verify, rollback };
}

export function qrSqls(m) {
  const RE = arr(m.realIds);
  const pre = head('Q-01 QR 사전 발급 직전 확인 (읽기 전용)', m, ['기대: 실제 84 · 공개 0 · 실제 QR 0 · 전체 QR = 예시 수']) + `
select
  (select count(*) from public.booths where id = any(${RE}) and org !~ ${SAMPLE}) as 실제,
  (select count(*) from public.booths where id = any(${RE}) and is_published) as 실제_공개,
  (select count(*) from public.booth_access where booth_id = any(${RE})) as 실제_qr,
  (select count(*) from public.booth_access) as qr_전체,
  (select count(*) from public.booth_access where disabled_at is not null) as qr_꺼짐;
`;

  const run = head('Q-02 실제 부스 운영자 QR 사전 발급', m, [
    '쓰기: public.booth_access 에 실제 84곳의 열쇠 줄만 넣습니다(이미 있으면 그대로 — 바꾸지 않음).',
    '열쇠 값은 결과에 나오지 않습니다. 카드는 관리자 → QR 인쇄 화면(배치 미정 묶음)에서 봅니다.',
    '발급 뒤에도 운영자 접속은 막혀 있는지 블록 안에서 booth_ctrl_get 으로 확인합니다(0줄이어야 통과).',
    '다시 실행해도 안전합니다(없는 곳만 넣음). 실패하면 전체가 되돌아갑니다.'
  ]) + `
begin isolation level repeatable read;

do $qr$
declare
  c_real constant uuid[] := ${RE};
  v_fp_before text; v_fp_after text; v_b_before text; v_b_after text; v_have int; v_new int; v_open int;
begin
  if (select count(distinct x) from unnest(c_real) x) <> ${m.realIds.length} then
    raise exception '[중단] 대상 UUID 목록에 중복이 있습니다.';
  end if;
  if (select count(*) from public.booths where id = any(c_real) and org !~ ${SAMPLE}) <> ${m.realIds.length} then
    raise exception '[중단] 실제 ${m.realIds.length}곳이 모두 있지 않거나 [예시] 가 섞여 있습니다.';
  end if;
  if exists (select 1 from public.booths where id = any(c_real) and is_published) then
    raise exception '[중단] 이미 공개된 실제 부스가 있습니다. 사전 발급은 공개 전에만 합니다.';
  end if;

  select count(*) into v_have from public.booth_access where booth_id = any(c_real);
  v_fp_before := ${protectedFp('c_real')};
  v_b_before := (select md5(coalesce(string_agg(row_to_json(b)::text, ',' order by b.id), '')) from public.booths b);

  insert into public.booth_access (booth_id, token)
  select b.id, translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_')
    from public.booths b
   where b.id = any(c_real)
  on conflict on constraint booth_access_pkey do nothing;
  get diagnostics v_new = row_count;

  if (select count(*) from public.booth_access where booth_id = any(c_real) and disabled_at is null and token ~ '^[A-Za-z0-9_-]{24}$') <> ${m.realIds.length} then
    raise exception '[중단] 열쇠가 있는 실제 부스가 % 곳입니다(기대 ${m.realIds.length}).', (select count(*) from public.booth_access where booth_id = any(c_real));
  end if;
  if v_new <> ${m.realIds.length} - v_have then
    raise exception '[중단] 새로 넣은 열쇠 % 줄(기대 %).', v_new, ${m.realIds.length} - v_have;
  end if;
  -- 발급 ≠ 접속 허용: 공개 · 배정 전이므로 운영자 화면 함수가 아무것도 돌려주지 않아야 합니다.
  select count(*) into v_open from public.booth_access a cross join lateral public.booth_ctrl_get(a.token) g
   where a.booth_id = any(c_real);
  if v_open <> 0 then
    raise exception '[중단] 사전 발급한 QR 로 운영자 화면이 열립니다(% 곳). 공개 조건을 확인하세요.', v_open;
  end if;
  v_fp_after := ${protectedFp('c_real')};
  v_b_after := (select md5(coalesce(string_agg(row_to_json(b)::text, ',' order by b.id), '')) from public.booths b);
  if v_fp_after is distinct from v_fp_before or v_b_after is distinct from v_b_before then
    raise exception '[중단] 다른 부스의 QR · PIN · 대기 값 · 기록 · 세션 · 부스 정보가 바뀌었습니다.';
  end if;

  raise notice '[QR 사전 발급] 새로 % 곳 · 이미 있던 % 곳 · 운영자 접속 열림 0', v_new, v_have;
end
$qr$;

commit;

select count(*) as 실제_qr,
       count(*) filter (where a.disabled_at is null) as 실제_qr_켜짐,
       (select count(*) from public.booth_access) as qr_전체
  from public.booth_access a where a.booth_id = any(${RE});
`;

  const rollback = head('Q-09 QR 사전 발급 되돌리기 — 실제 84곳 열쇠 줄 삭제', m, [
    '실제 84곳의 booth_access 줄만 지웁니다(예시 열쇠는 그대로). 인쇄한 배치 미정 카드는 쓸 수 없게 됩니다.',
    '실제 부스 중 공개된 곳이나 대기 값 · 기록이 생긴 곳이 있으면 멈춥니다(이미 운영에 쓰는 중).'
  ]) + `
begin isolation level repeatable read;

do $qrrb$
declare
  c_real constant uuid[] := ${RE};
  v_fp_before text; v_fp_after text; v_n int;
begin
  if exists (select 1 from public.booths where id = any(c_real) and is_published) then
    raise exception '[중단] 공개된 실제 부스가 있습니다. 운영 중인 열쇠는 지우지 않습니다(필요하면 화면의 열쇠 끄기).';
  end if;
  if exists (select 1 from public.booth_live where booth_id = any(c_real))
     or exists (select 1 from public.booth_live_log where booth_id = any(c_real)) then
    raise exception '[중단] 실제 부스에 대기 값 · 기록이 있습니다.';
  end if;
  v_fp_before := ${protectedFp('c_real')};
  delete from public.booth_access where booth_id = any(c_real);
  get diagnostics v_n = row_count;
  if exists (select 1 from public.booth_access where booth_id = any(c_real)) then
    raise exception '[중단] 지운 뒤에도 실제 부스 열쇠가 남았습니다.';
  end if;
  v_fp_after := ${protectedFp('c_real')};
  if v_fp_after is distinct from v_fp_before then
    raise exception '[중단] 예시 열쇠 · PIN · 기록이 바뀌었습니다.';
  end if;
  raise notice '[QR 사전 발급 되돌리기] % 줄 삭제', v_n;
end
$qrrb$;

commit;

select (select count(*) from public.booth_access where booth_id = any(${RE})) as 실제_qr,
       (select count(*) from public.booth_access) as qr_전체;
`;
  return { pre, run, rollback };
}
