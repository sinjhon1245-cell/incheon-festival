/* ===================================================================
   실제 부스 비공개 등록 SQL 생성기
   ───────────────────────────────────────────────────────────────────
   manifest(승인 대상 부스 목록)에서 SQL 다섯 개를 만듭니다.
     01-precheck.sql      읽기 전용 — 반영 직전 상태
     02-register.sql      비공개 · 미배정 등록(쓰기는 public.booths INSERT 하나뿐)
     03-verify.sql        읽기 전용 — 반영 직후 확인
     09-rollback.sql      승인된 UUID 만 삭제(쓰기는 public.booths DELETE 하나뿐)
     20-golive-db-check.sql 읽기 전용 — 공개 전 구역 · 번호 · QR · PIN · 담당자 점검

   지키는 것
     · 쓰기는 DO 블록 하나 안에서만 합니다. 어떤 확인이든 실패하면 블록 전체가 되돌아갑니다.
     · 반복 읽기(REPEATABLE READ)로 묶어, 전후 비교가 다른 사람의 동시 작업에 흔들리지 않게 합니다.
     · 예시 부스 · 구역 · QR · PIN · 대기 값 · 대기 기록 · 세션 · 보안 기록 · 담당자 · 설정의
       지문을 반영 전후로 견주어 하나라도 다르면 되돌립니다(인증정보 칸은 지문에서도 뺍니다).
     · 인증정보 원문 · 해시는 조회하지도 출력하지도 않습니다.
   =================================================================== */

const q = s => `'${String(s).replace(/'/g, "''")}'`;
const SAMPLE = "'^\\s*\\[예시\\]'";   // SQL: '^\s*\[예시\]'

// 대상(ex: uuid[] 식)을 뺀 나머지 전부의 지문. 반영 전후로 같아야 합니다.
export const fingerprint = ex => `(select concat_ws(' | ',
      (select md5(coalesce(string_agg(row_to_json(b)::text, ',' order by b.id), '')) from public.booths b where b.id <> all(${ex})),
      (select md5(coalesce(string_agg(row_to_json(z)::text, ',' order by z.id), '')) from public.zones z),
      (select md5(coalesce(string_agg(concat_ws(':', a.booth_id, a.created_at, a.rotated_at, a.disabled_at), ',' order by a.booth_id), '')) from public.booth_access a where a.booth_id <> all(${ex})),
      (select md5(coalesce(string_agg(concat_ws(':', p.booth_id, p.issued_at, p.reissued_at, p.disabled_at), ',' order by p.booth_id), '')) from public.booth_pin p where p.booth_id <> all(${ex})),
      (select md5(coalesce(string_agg(row_to_json(l)::text, ',' order by l.booth_id), '')) from public.booth_live l where l.booth_id <> all(${ex})),
      (select concat(count(*), '/', coalesce(max(g.id), 0)) from public.booth_live_log g where g.booth_id <> all(${ex})),
      (select concat(count(*), '/', count(s.revoked_at), '/', coalesce(max(s.created_at)::text, ''), '/', coalesce(max(s.last_used_at)::text, '')) from public.booth_session s where s.booth_id <> all(${ex})),
      (select concat(count(*), '/', coalesce(max(e.id), 0)) from public.booth_auth_event e where e.booth_id <> all(${ex})),
      (select md5(coalesce(string_agg(row_to_json(v)::text, ',' order by v.booth_id), '')) from public.booth_private v where v.booth_id <> all(${ex})),
      (select md5(coalesce(string_agg(row_to_json(t)::text, ',' order by t.id), '')) from public.settings t)
    ))`;

// 대상 부스에 딸린 흔적(QR · PIN · 대기 값 · 기록 · 세션 · 보안 기록 · 담당자)
const traces = ex => `(select concat_ws(' · ',
      'QR ' || (select count(*) from public.booth_access where booth_id = any(${ex})),
      'PIN ' || (select count(*) from public.booth_pin where booth_id = any(${ex})),
      '대기 값 ' || (select count(*) from public.booth_live where booth_id = any(${ex})),
      '대기 기록 ' || (select count(*) from public.booth_live_log where booth_id = any(${ex})),
      '세션 ' || (select count(*) from public.booth_session where booth_id = any(${ex})),
      '보안 기록 ' || (select count(*) from public.booth_auth_event where booth_id = any(${ex})),
      '담당자 ' || (select count(*) from public.booth_private where booth_id = any(${ex}))))`;
const traceCount = ex => `((select count(*) from public.booth_access where booth_id = any(${ex}))
      + (select count(*) from public.booth_pin where booth_id = any(${ex}))
      + (select count(*) from public.booth_live where booth_id = any(${ex}))
      + (select count(*) from public.booth_live_log where booth_id = any(${ex}))
      + (select count(*) from public.booth_session where booth_id = any(${ex}))
      + (select count(*) from public.booth_auth_event where booth_id = any(${ex}))
      + (select count(*) from public.booth_private where booth_id = any(${ex})))`;

const header = (title, meta, lines) => `-- ===================================================================
-- ${title}
-- 2026 인천 AI미래채움 교육페스티벌 · 대상 ${meta.count}개(${meta.scope})
-- manifest sha256 ${meta.sha256}
-- 만든 시각 ${meta.generatedAt} · scripts/booth-data/build-registration.mjs
${lines.map(l => `-- ${l}`).join('\n')}
-- ===================================================================
`;
const idArray = rows => `'{${rows.map(r => r.booth_id).join(',')}}'::uuid[]`;
const keyValues = rows => rows.map(r => `  (${q(r.booth_id)}::uuid, ${q(r.doc_key)})`).join(',\n');

export function precheckSql(rows, meta) {
  return header('01 반영 직전 확인 (읽기 전용)', meta, ['쓰기 없음. 결과 한 줄을 반영 기록에 남깁니다.', '기대: 대상_이미있음 0 · 같은이름_다른UUID 없음 · 열린_세션 0(권장)']) + `
with t(id, doc_key, org, name) as (values
${rows.map(r => `  (${q(r.booth_id)}::uuid, ${q(r.doc_key)}, ${q(r.org)}, ${q(r.name)})`).join(',\n')}
)
select
  (select count(*) from t)                                                         as 대상,
  (select count(*) from public.booths b join t on t.id = b.id)                       as 대상_이미있음,
  (select string_agg(t.doc_key, ', ' order by t.doc_key) from t
     join public.booths b on b.org = t.org and b.name = t.name and b.id <> t.id)     as 같은이름_다른UUID,
  (select count(*) from public.booths)                                              as 전체_부스,
  (select count(*) from public.booths where org ~ ${SAMPLE})                        as 예시_부스,
  (select count(*) from public.booths where is_published)                           as 공개_부스,
  (select count(*) from public.booth_access)                                        as qr_열쇠,
  (select count(*) from public.booth_pin)                                           as 개별_pin,
  (select count(*) from public.booth_live_log)                                      as 대기_기록,
  (select count(*) from public.booth_session where revoked_at is null and expires_at > now()) as 열린_세션,
  (select booth_pin_enabled from public.settings where id = 1)                      as pin_보조로그인,
  (select booth_sample_common_pin_enabled from public.settings where id = 1)        as 예시_공통pin,
  (select md5(coalesce(string_agg(row_to_json(b)::text, ',' order by b.id), '')) from public.booths b where b.org ~ ${SAMPLE}) as 예시_부스_지문;
`;
}

export function registerSql(rows, meta) {
  const values = rows.map(r => `      (${q(r.booth_id)}::uuid, ${q(r.doc_key)}, ${q(r.name)}, ${q(r.org)}, ${r.org_type ? q(r.org_type) : 'null'}, ${q(r.program)}, ${r.sort_order})`).join(',\n');
  const ex = 'array(select id from _reg)';
  return header('02 실제 부스 비공개 등록', meta, [
    '이 파일 하나를 SQL Editor 에 통째로 붙여 실행합니다(관리자 계정).',
    '쓰기: public.booths INSERT 하나뿐 — 비공개 · 구역/번호 없음 · 상태 \'준비 전\'. QR · PIN · 대기 값은 만들지 않습니다.',
    '확인 하나라도 실패하면 DO 블록 전체가 되돌아갑니다. 오류가 보이면 같은 창에서 rollback; 을 한 번 실행합니다.',
    '다시 실행해도 안전합니다 — 모두 있으면 "변경 없음", 일부만 있으면 중단.'
  ]) + `
begin isolation level repeatable read;

do $reg$
declare
  c_expected constant int := ${rows.length};
  v_total_before int; v_pub_before int; v_total_after int; v_pub_after int;
  v_fp_before text; v_fp_after text; v_present int; v_n int; v_keys text;
begin
  create temp table _reg (
    id uuid primary key, doc_key text not null unique, name text not null, org text not null,
    org_type text, program text not null, sort_order int not null
  ) on commit drop;
  insert into _reg (id, doc_key, name, org, org_type, program, sort_order) values
${values};

  -- 1. 입력 확인
  if (select count(*) from _reg) <> c_expected then
    raise exception '[중단] 입력 % 건 — 기대 % 건', (select count(*) from _reg), c_expected;
  end if;
  if (select count(distinct (org, name)) from _reg) <> c_expected then
    raise exception '[중단] 입력 안에 같은 운영기관 · 부스명이 겹칩니다.';
  end if;
  if exists (select 1 from _reg where org ~ ${SAMPLE} or btrim(name) = '' or btrim(org) = '') then
    raise exception '[중단] 입력에 빈 부스명 · 운영기관 또는 [예시] 표시가 있습니다.';
  end if;

  -- 2. 지금 상태
  select count(*), count(*) filter (where is_published) into v_total_before, v_pub_before from public.booths;
  v_fp_before := ${fingerprint(ex)};
  select count(*) into v_present from public.booths b join _reg r on r.id = b.id;

  if v_present = c_expected then
    select count(*) into v_n from public.booths b join _reg r on r.id = b.id
     where (b.name, b.org, coalesce(b.org_type, ''), b.program) is distinct from (r.name, r.org, coalesce(r.org_type, ''), r.program);
    raise notice '[변경 없음] 대상 % 건이 이미 모두 있습니다(그 뒤 고친 행 % 건). 아무것도 바꾸지 않았습니다.', v_present, v_n;
    return;
  elsif v_present > 0 then
    raise exception '[중단] 대상 중 % / % 건만 있습니다(부분 등록 상태). 아무것도 바꾸지 않았습니다.', v_present, c_expected;
  end if;

  select string_agg(r.doc_key, ', ' order by r.doc_key) into v_keys
    from _reg r join public.booths b on b.org = r.org and b.name = r.name;
  if v_keys is not null then
    raise exception '[중단] 같은 운영기관 · 부스명의 부스가 다른 UUID 로 이미 있습니다: %', v_keys;
  end if;

  -- 3. 등록 — 비공개 · 미배정
  insert into public.booths (id, name, org, org_type, program, zone_key, no, status, is_published, sort_order)
  select id, name, org, org_type, program, null, null, '준비 전', false, sort_order from _reg
  on conflict (id) do nothing;
  get diagnostics v_n = row_count;
  if v_n <> c_expected then
    raise exception '[중단] % 건만 들어갔습니다(기대 %).', v_n, c_expected;
  end if;

  -- 4. 사후 확인
  select count(*), count(*) filter (where is_published) into v_total_after, v_pub_after from public.booths;
  if v_total_after <> v_total_before + c_expected then
    raise exception '[중단] 전체 부스 % → % (기대 +%)', v_total_before, v_total_after, c_expected;
  end if;
  if v_pub_after <> v_pub_before then
    raise exception '[중단] 공개 부스 수가 바뀌었습니다(% → %).', v_pub_before, v_pub_after;
  end if;
  select string_agg(r.doc_key, ', ' order by r.doc_key) into v_keys
    from public.booths b join _reg r on r.id = b.id
   where b.is_published or b.zone_key is not null or b.no is not null or b.code <> '' or b.status <> '준비 전'
      or b.name <> r.name or b.org <> r.org or b.org_type is distinct from r.org_type or b.program <> r.program;
  if v_keys is not null then
    raise exception '[중단] 등록된 값이 입력과 다릅니다: %', v_keys;
  end if;
  if ${traceCount(ex)} <> 0 then
    raise exception '[중단] 새 부스에 흔적이 생겼습니다(%). 자동 발급 트리거가 있는지 확인하세요.', ${traces(ex)};
  end if;
  v_fp_after := ${fingerprint(ex)};
  if v_fp_after is distinct from v_fp_before then
    raise exception '[중단] 기존 부스 · 구역 · QR · PIN · 대기 값 · 기록 · 세션 · 담당자 · 설정 중 무언가가 바뀌었습니다.';
  end if;

  raise notice '[등록 완료] % 건 · 전체 부스 % → % · 공개 부스 % 그대로', c_expected, v_total_before, v_total_after, v_pub_after;
end
$reg$;

commit;

-- 결과 한 줄(읽기 전용) — 위가 실패했으면 이 줄은 실행되지 않습니다.
select count(*) as 등록된_대상,
       count(*) filter (where is_published) as 공개,
       count(*) filter (where zone_key is not null or no is not null) as 구역번호_배정,
       (select count(*) from public.booths) as 전체_부스,
       (select count(*) from public.booths where org ~ ${SAMPLE}) as 예시_부스
  from public.booths where id = any(${idArray(rows)});
`;
}

export function verifySql(rows, meta) {
  return header('03 반영 직후 확인 (읽기 전용)', meta, ['기대: 등록됨 = 대상 · 공개 0 · 배정 0 · QR/PIN/대기 값/기록 0 · 예시 부스 지문이 01 과 같음']) + `
with t(id, doc_key) as (values
${keyValues(rows)}
)
select
  (select count(*) from t)                                                                        as 대상,
  (select count(*) from public.booths b join t on t.id = b.id)                                      as 등록됨,
  (select string_agg(t.doc_key, ', ' order by t.doc_key) from t where t.id not in (select id from public.booths)) as 빠진_문서키,
  (select count(*) from public.booths b join t on t.id = b.id where b.is_published)                 as 공개,
  (select count(*) from public.booths b join t on t.id = b.id where b.zone_key is not null or b.no is not null) as 구역번호_배정,
  (select count(*) from public.booth_access a join t on t.id = a.booth_id)                          as qr,
  (select count(*) from public.booth_pin p join t on t.id = p.booth_id)                             as pin,
  (select count(*) from public.booth_live l join t on t.id = l.booth_id)                            as 대기_값,
  (select count(*) from public.booth_live_log g join t on t.id = g.booth_id)                        as 대기_기록,
  (select count(*) from public.booths)                                                              as 전체_부스,
  (select count(*) from public.booths where org ~ ${SAMPLE})                                        as 예시_부스,
  (select count(*) from public.booths where is_published)                                           as 공개_부스,
  (select count(*) from public.booth_live_log)                                                      as 대기_기록_전체,
  (select md5(coalesce(string_agg(row_to_json(b)::text, ',' order by b.id), '')) from public.booths b where b.org ~ ${SAMPLE}) as 예시_부스_지문;
`;
}

export function rollbackSql(rows, meta) {
  const ex = 'c_ids';
  return header('09 되돌리기 — 승인된 UUID 만 삭제', meta, [
    '02 로 등록한 부스를 지웁니다. 쓰기: public.booths DELETE 하나뿐(대상 UUID 목록 안, [예시] 아닌 행만).',
    '공개된 부스가 있거나, QR · PIN · 대기 기록 등 흔적이 있으면 멈춥니다.',
    '흔적까지 지워야 할 때만 승인자가 c_allow_with_traces 를 true 로 바꿉니다(그 흔적도 cascade 로 함께 지워짐).',
    '대상이 하나도 없으면 "변경 없음". 실패하면 DO 블록 전체가 되돌아갑니다.'
  ]) + `
begin isolation level repeatable read;

do $rb$
declare
  c_ids constant uuid[] := ${idArray(rows)};
  c_expected constant int := ${rows.length};
  c_allow_with_traces constant boolean := false;
  v_total_before int; v_total_after int; v_targets int; v_n int; v_fp_before text; v_fp_after text;
begin
  if (select count(distinct x) from unnest(c_ids) x) <> c_expected then
    raise exception '[중단] 대상 UUID 목록에 중복이 있습니다.';
  end if;
  select count(*) into v_targets from public.booths where id = any(c_ids);
  if v_targets = 0 then
    raise notice '[변경 없음] 되돌릴 부스가 없습니다.';
    return;
  end if;
  if exists (select 1 from public.booths where id = any(c_ids) and org ~ ${SAMPLE}) then
    raise exception '[중단] 대상 안에 [예시] 부스가 있습니다. 예시 부스는 지우지 않습니다.';
  end if;
  if exists (select 1 from public.booths where id = any(c_ids) and is_published) then
    raise exception '[중단] 공개된 부스가 있습니다. 먼저 비공개로 돌린 뒤 되돌립니다.';
  end if;
  if not c_allow_with_traces and ${traceCount(ex)} <> 0 then
    raise exception '[중단] 흔적이 있는 부스가 있습니다(%). 승인 없이 지우지 않습니다.', ${traces(ex)};
  end if;

  select count(*) into v_total_before from public.booths;
  v_fp_before := ${fingerprint(ex)};

  delete from public.booths where id = any(c_ids) and org !~ ${SAMPLE};
  get diagnostics v_n = row_count;
  if v_n <> v_targets then
    raise exception '[중단] % 건 지움(기대 %).', v_n, v_targets;
  end if;

  select count(*) into v_total_after from public.booths;
  if v_total_after <> v_total_before - v_n or exists (select 1 from public.booths where id = any(c_ids)) then
    raise exception '[중단] 지운 뒤 건수가 맞지 않습니다(% → %).', v_total_before, v_total_after;
  end if;
  v_fp_after := ${fingerprint(ex)};
  if v_fp_after is distinct from v_fp_before then
    raise exception '[중단] 대상 밖의 부스 · 구역 · QR · PIN · 기록 · 설정이 바뀌었습니다.';
  end if;

  raise notice '[되돌리기 완료] % 건 삭제 · 전체 부스 % → %', v_n, v_total_before, v_total_after;
end
$rb$;

commit;

select (select count(*) from public.booths where id = any(${idArray(rows)})) as 남은_대상,
       (select count(*) from public.booths) as 전체_부스,
       (select count(*) from public.booths where org ~ ${SAMPLE}) as 예시_부스;
`;
}

export function goLiveDbCheckSql(rows, meta) {
  return header('20 GO-LIVE 점검 — 공개 전 DB 상태 (읽기 전용)', meta, [
    '구역 · 번호 배정과 QR · PIN 발급을 마친 뒤, 공개하기 직전에 실행합니다.',
    '인증정보 값은 보지 않고 있음 · 꺼짐 여부만 셉니다. 담당자도 이름 · 연락처 대신 입력 여부만 셉니다.',
    '기대: 미완료_문서키 없음 · 번호_중복 0 · 공개 0(공개 전) · 구역_비공개 0(공개 순서에 따라)'
  ]) + `
with t(id, doc_key) as (values
${keyValues(rows)}
),
s as (
  select t.doc_key, b.id is not null as 있음, b.zone_key, b.no, b.code, coalesce(b.is_published, false) as 공개,
         z.key is not null as 구역_있음, coalesce(z.is_published, false) as 구역_공개,
         (a.booth_id is not null and a.disabled_at is null) as qr_유효,
         (p.booth_id is not null and p.disabled_at is null) as pin_유효,
         coalesce(btrim(v.manager), '') <> '' as 담당자
    from t
    left join public.booths b on b.id = t.id
    left join public.zones z on z.key = b.zone_key
    left join public.booth_access a on a.booth_id = t.id
    left join public.booth_pin p on p.booth_id = t.id
    left join public.booth_private v on v.booth_id = t.id
)
select count(*)                                                        as 대상,
       count(*) filter (where 있음)                                    as 등록,
       count(*) filter (where zone_key is not null and no is not null) as 구역번호_배정,
       count(*) filter (where 구역_있음)                               as 구역_있음,
       count(*) filter (where 구역_있음 and not 구역_공개)             as 구역_비공개,
       (select count(*) from (select zone_key, no from public.booths where no is not null group by 1, 2 having count(*) > 1) d) as 번호_중복,
       count(*) filter (where qr_유효)                                 as qr_유효,
       count(*) filter (where pin_유효)                                as pin_유효,
       count(*) filter (where 담당자)                                  as 담당자_입력,
       count(*) filter (where 공개)                                    as 공개,
       string_agg(doc_key, ', ' order by doc_key) filter (where not (있음 and zone_key is not null and no is not null and 구역_있음 and qr_유효 and 담당자)) as 미완료_문서키
  from s;
`;
}

// 생성된 SQL 의 쓰기 문 — 정적 검사용
export function writeStatements(sql) {
  const body = sql.replace(/--[^\n]*/g, '');
  return [...body.matchAll(/\b(insert\s+into|update|delete\s+from|truncate|alter\s+table|drop\s+table|create\s+(?:table|function|trigger))\s+([a-z_."]+)/gi)]
    .map(m => `${m[1].toLowerCase().replace(/\s+/g, ' ')} ${m[2]}`);
}
