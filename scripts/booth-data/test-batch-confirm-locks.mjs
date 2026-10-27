/* ===================================================================
   '확인 필요' 일괄 확인 — 실제 PostgreSQL(여러 독립 연결) 동시 잠금 시험
   ───────────────────────────────────────────────────────────────────
   test-batch-confirm.mjs(PGlite · 한 연결)는 두 요청이 같은 순간에 잠금을 다투는 경우를 볼 수 없어 따로 둡니다.
   관리자 A · B · C, 운영자(실제 booth_ctrl_set · QR 열쇠), 23:00 초기화(실제 private.rehearsal_live_reset · 84곳)를
   각각 다른 연결로 돌립니다. 지금 설계(advisory 줄 세우기 + FOR UPDATE NOWAIT)와 견줄 것으로
   ① 처음 설계(FOR UPDATE 로 기다림) ② FOR SHARE 를 같은 정의에서 만들어 같은 순서로 돌려 봅니다(시험 DB 안에서만).
     L1 두 관리자가 같은 부스를 동시에 → confirmed 1 · skipped:checked 1 · 기록 1줄(반복)        (비교: FOR SHARE → 중복)
     L2 운영자 입력과 충돌 → 운영자 먼저면 관리자 failed:busy(기다리지 않음) · 다시 보내면 changed,
        관리자 먼저면 운영자는 몇 ms 기다렸다 저장 · 확인은 지금 값에서 빠짐, 동시 반복에서 운영자 실패 0 · 최신 입력 유지
     L3 lock_timeout · busy → 잡힌 부스만 failed:busy, 나머지 confirmed / 다른 관리자가 3초 넘게 잡으면 그 요청 전체 failed:busy
     L4 서로 다른 순서로 여러 부스 → 교착(40P01) 0 · 부스마다 기록 1줄(반복)
     L5 23:00 초기화와 겹침 → 같은 순서 끼어들기에서 처음 설계는 초기화가 교착으로 실패할 수 있고, 지금 설계는 초기화가 늘 완료(반복)
     L6 관리자 확인만 한 동안 booth_live · booth_live_log 그대로
   ⚠️ 버려도 되는 빈 PostgreSQL(14 이상 · pgcrypto)에서만 돌립니다. Production · Supabase 프로젝트에 돌리지 마세요.
      Supabase 주소와 public.booths 가 이미 있는 DB 는 거절합니다. 열쇠 · PIN 은 이 DB 에서 만든 가짜 값이고 출력하지 않습니다.
   쓰는 법: PGURL=postgres://postgres:<암호>@localhost:5432/bc_lock_test \
            node scripts/booth-data/test-batch-confirm-locks.mjs --pg-dir <pg 가 깔린 폴더> --main-dir <브랜치 작업 폴더> --disposable [--rounds 40]
            (GitHub Actions: .github/workflows/batch-confirm-locks.yml — PostgreSQL 17 서비스 컨테이너)
   결과: out/rehearsal/batch-confirm-locks-report.md (+ 같은 내용 JSON)
   =================================================================== */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'out');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const MAIN = resolve(arg('main-dir', resolve(HERE, '..', '..')));
const ROUNDS = +arg('rounds', 40);
if (!process.argv.includes('--disposable') || !process.env.PGURL) { console.error('버려도 되는 빈 DB 주소(PGURL)와 --disposable 이 필요합니다.'); process.exit(2); }
if (/supabase\.(co|com)|pooler/i.test(process.env.PGURL)) { console.error('Supabase 주소에는 돌리지 않습니다(로컬 · CI PostgreSQL 전용).'); process.exit(2); }
const { Client } = createRequire(join(resolve(arg('pg-dir')), 'package.json'))('pg');

const ADMIN = '00000000-0000-4000-8000-00000000a001', ADMIN2 = '00000000-0000-4000-8000-00000000a002', ADMIN3 = '00000000-0000-4000-8000-00000000a003';
const results = [], metrics = {};
function t(name, ok, note = '') { results.push({ name, ok: !!ok, note: String(note).slice(0, 700) }); console.log(`${ok ? '통과' : '실패'}  ${name}${note ? '  — ' + String(note).slice(0, 700) : ''}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const settle = p => p.then(v => ({ ok: true, v }), e => ({ ok: false, code: e.code, message: e.message }));
// 약속이 ms 안에 끝나지 않으면 true(= 잠금을 기다리는 중)
async function stillWaiting(p, ms = 500) { let done = false; p.then(() => { done = true; }, () => { done = true; }); await sleep(ms); return !done; }
const timed = async p => { const t0 = Date.now(); const r = await settle(p); return Object.assign(r, { ms: Date.now() - t0 }); };
const shuffle = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const tally = rows => rows.reduce((m, r) => (m[r] = (m[r] || 0) + 1, m), {});

async function client(uid) {
  const c = new Client({ connectionString: process.env.PGURL }); await c.connect();
  if (uid) await c.query("select set_config('test.uid', $1, false)", [uid]);
  return c;
}
const S = await client();
if ((await S.query("select to_regclass('public.booths') r")).rows[0].r) { console.error('public.booths 가 이미 있습니다 — 빈 DB 에서만 돌립니다.'); process.exit(2); }
const pgVersion = (await S.query('show server_version')).rows[0].server_version;
const deadlockTimeout = (await S.query('show deadlock_timeout')).rows[0].deadlock_timeout;

// ── 준비: 복제 스키마 · 함수(Production 정의) → 리허설 함수(실제 23:00 초기화) → 일괄 확인 ──
await S.query('create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions;');
for (const f of ['replica-schema.sql', 'replica-functions.sql', 'replica-functions-extra.sql']) await S.query(readFileSync(resolve(HERE, 'dryrun', f), 'utf8'));
await S.query(`insert into public.settings (id, event_start, event_end, booth_pin_enabled, booth_sample_common_pin_enabled) values (1, '2026-11-06 01:00+00', '2026-11-07 08:00+00', true, false)`);
await S.query("insert into public.staff_profiles (id, role, name) values ($1, 'admin', '관리자 A'), ($2, 'admin', '관리자 B'), ($3, 'admin', '관리자 C')", [ADMIN, ADMIN2, ADMIN3]);
for (const [i, k] of ['R1', 'R2', 'R3', 'R4'].entries()) await S.query("insert into public.zones (key, label, sort_order, is_published) values ($1, '리허설 임시구역', $2, true)", [k, i + 1]);
// 리허설 SQL 은 대상 84곳이 DB 에 있어야 적용됩니다 — 그 파일에 적힌 UUID 로 부스를 먼저 만듭니다.
const REH = readFileSync(join(MAIN, 'supabase/migration-booth-rehearsal.sql'), 'utf8');
const idsBody = REH.slice(REH.indexOf('function private.rehearsal_booth_ids()'), REH.indexOf('$function$;', REH.indexOf('function private.rehearsal_booth_ids()')));
const R = [...new Set(idsBody.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g))].sort();
for (const [i, id] of R.entries()) await S.query("insert into public.booths (id, zone_key, no, name, org, org_type, is_published, sort_order) values ($1, $2, $3, $4, '시험 기관', '기관', true, $5)",
  [id, 'R' + (1 + Math.floor(i / 21)), (i % 21) + 1, '시험 부스 ' + (i + 1), i + 1]);
await S.query(REH);
const R2 = (await S.query('select x::text id from unnest(private.rehearsal_booth_ids()) x order by 1')).rows.map(r => r.id);
if (R2.join() !== R.join()) { console.error('리허설 대상 목록을 읽지 못했습니다.'); process.exit(2); }
await S.query(readFileSync(join(MAIN, 'supabase/migration-booth-live-check.sql'), 'utf8'));
const siteRev = (() => { try { return execFileSync('git', ['-C', MAIN, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return '?'; } })();
// 운영자 QR 열쇠(가짜 · 출력 안 함)
await S.query("select set_config('test.uid', $1, false)", [ADMIN]);
await S.query('select count(*) from public.admin_issue_booth_tokens(null)');
const TOK = Object.fromEntries((await S.query('select booth_id::text b, token from public.admin_booth_access()')).rows.map(r => [r.b, r.token]));
await S.query("select set_config('test.uid', '', false)");
t(`준비 — PostgreSQL ${pgVersion} · deadlock_timeout ${deadlockTimeout} · 리허설 84곳 · 실제 초기화 함수 · 운영자 QR 열쇠 84 · 일괄 확인 SQL(${siteRev})`,
  R.length === 84 && Object.keys(TOK).filter(k => R.includes(k) && TOK[k]).length === 84, '');

// 비교용 함수(시험 DB 안에서만) — 같은 정의에서 줄 세우기를 빼고 잠금만 바꿈
const def = (await S.query("select pg_get_functiondef('public.admin_confirm_booth_live(jsonb)'::regprocedure) d")).rows[0].d;
const noAdv = def.replace(/\n\s*begin\s*\n\s*perform pg_catalog\.pg_advisory_xact_lock[\s\S]*?\n\s*return;\s*\n\s*end;/, '');
const OLD = noAdv.replace('public.admin_confirm_booth_live(', 'public.test_confirm_old_wait(').replace(/for update nowait/i, 'for update');
const SHARE = noAdv.replace('public.admin_confirm_booth_live(', 'public.test_confirm_share(').replace(/for update nowait/i, 'for share');
t('비교용 함수 — 처음 설계(FOR UPDATE 기다림) · FOR SHARE 를 같은 정의에서 줄 세우기만 빼고 만듦', noAdv !== def && !/advisory/.test(noAdv) && /for update;/i.test(OLD) && /for share;/i.test(SHARE), '');
await S.query(OLD); await S.query(SHARE);

// 값 채우기 — 84곳 '45분 전 · 보통 20분'(확인 필요). booth_id 큰 순서로 넣어 초기화(순차 읽기)가 관리자와 반대 순서로 잡게 합니다.
async function refill(ids = R) {
  await S.query('delete from public.booth_live_check');
  await S.query('delete from public.booth_live where booth_id = any($1::uuid[])', [ids]);
  for (const id of ids.slice().sort().reverse()) await S.query("insert into public.booth_live (booth_id, congestion, wait_minutes, updated_at) values ($1, '보통', 20, now() - interval '45 minutes')", [id]);
}
const seenOf = async ids => Object.fromEntries((await S.query('select booth_id::text b, updated_at::text t from public.booth_live where booth_id = any($1::uuid[])', [ids])).rows.map(r => [r.b, r.t]));
const items = (ids, seen) => ids.map(id => ({ booth_id: id, seen_updated_at: seen[id] }));
const confirm = (c, its, fn = 'admin_confirm_booth_live') => c.query(`select booth_id::text, status from public.${fn}($1::jsonb)`, [JSON.stringify(its)]).then(r => r.rows);
const recN = async id => +(await S.query('select count(*) n from public.booth_live_check where booth_id = $1', [id])).rows[0].n;
const recPerBooth = async () => Object.fromEntries((await S.query('select booth_id::text b, count(*)::int n from public.booth_live_check group by 1')).rows.map(r => [r.b, r.n]));
const opSet = (c, id, w) => c.query('select wait_minutes, updated_at from public.booth_ctrl_set($1, $2, $3)', [TOK[id], 'open', w]).then(r => r.rows[0]);
const activeChecks = async () => { await S.query("select set_config('test.uid', $1, false)", [ADMIN]); const r = (await S.query('select booth_id::text b from public.admin_booth_live_checks()')).rows.map(x => x.b); await S.query("select set_config('test.uid', '', false)"); return r; };
const fp = async () => (await S.query(`select md5(coalesce(string_agg(row(l.*)::text, ',' order by l.booth_id), '')) a,
  (select md5(coalesce(string_agg(row(g.*)::text, ',' order by g.id), '')) from public.booth_live_log g) b from public.booth_live l`)).rows[0];

const A = await client(ADMIN), B = await client(ADMIN2), C = await client(ADMIN3), OP = await client(), RS = await client();
const [X, Y, Z, W] = [R[10], R[20], R[30], R[40]];

// ══ L1 두 관리자 · 같은 부스 ═══════════════════════════════════════════
await refill();
let seen = await seenOf(R);
await A.query('begin'); const a1 = await confirm(A, items([X], seen));
const pb1 = timed(confirm(B, items([X], seen)));
const waited1 = await stillWaiting(pb1, 400);
await A.query('commit'); const b1 = await pb1;
t('L1a 관리자 A 가 확인 중일 때 B 가 같은 부스 → B 는 A 가 끝날 때까지 기다렸다가 skipped:checked · 기록 1줄', a1[0].status === 'confirmed' && waited1 && b1.ok && b1.v[0].status === 'skipped:checked' && (await recN(X)) === 1,
  JSON.stringify({ a: a1[0].status, waited1, b: b1.v && b1.v[0].status, bMs: b1.ms }));
{ // 동시 반복: 두 관리자가 같은 5곳(서로 다른 순서)을 같은 순간에
  const st = [], dup = []; let errs = 0;
  const fp0 = await fp();
  for (let i = 0; i < ROUNDS; i++) {
    await S.query('delete from public.booth_live_check');
    const ids = shuffle(R).slice(0, 5); seen = await seenOf(ids);
    const [ra, rb] = await Promise.all([settle(confirm(A, items(ids, seen))), settle(confirm(B, items(shuffle(ids), seen)))]);
    if (!ra.ok || !rb.ok) { errs++; continue; }
    st.push(...ra.v.map(r => r.status), ...rb.v.map(r => r.status));
    const per = await recPerBooth(); for (const id of ids) if ((per[id] || 0) !== 1) dup.push(id);
    for (const id of ids) { const s = [...ra.v, ...rb.v].filter(r => r.booth_id === id).map(r => r.status).sort().join(); if (s !== 'confirmed,skipped:checked') dup.push(id + ':' + s); }
  }
  const fp1 = await fp();
  metrics.L1 = { rounds: ROUNDS, booths: ROUNDS * 5, statuses: tally(st), duplicateOrOdd: dup.length, errors: errs };
  t(`L1b 동시 반복 ${ROUNDS}번 × 5곳 — 부스마다 confirmed 1 · skipped:checked 1 · 기록 1줄, 중복 0 · 오류 0`, dup.length === 0 && errs === 0, JSON.stringify(metrics.L1));
  t('L6 관리자 확인만 한 동안 booth_live · booth_live_log 그대로(지문 같음)', fp0.a === fp1.a && fp0.b === fp1.b, JSON.stringify({ fp0, fp1 }));
}
{ // 비교: FOR SHARE
  let dupN = 0;
  for (let i = 0; i < ROUNDS; i++) {
    await S.query('delete from public.booth_live_check');
    seen = await seenOf([Y]);
    await A.query('begin'); await confirm(A, items([Y], seen), 'test_confirm_share');
    const rb = await settle(confirm(B, items([Y], seen), 'test_confirm_share'));
    await A.query('commit');
    if (rb.ok && (await recN(Y)) > 1) dupN++;
  }
  metrics.L1share = { rounds: ROUNDS, duplicates: dupN };
  t(`L1c (비교) FOR SHARE 사본 — 같은 끼어들기 ${ROUNDS}번 중 중복 기록 ${dupN}번(FOR SHARE 로는 못 막음)`, dupN === ROUNDS, JSON.stringify(metrics.L1share));
}

// ══ L2 운영자 입력과 충돌 ═══════════════════════════════════════════════
await refill(); seen = await seenOf(R);
await OP.query('begin'); const op2 = await opSet(OP, X, 25);
const a2 = await timed(confirm(A, items([X], seen)));
await OP.query('commit');
const a2b = await confirm(A, items([X], seen));
const l2 = (await S.query('select wait_minutes from public.booth_live where booth_id = $1', [X])).rows[0];
t('L2a 운영자 입력이 진행 중일 때 관리자 확인 → 기다리지 않고 그 부스 failed:busy · 기록 0 · 운영자 저장 후 다시 보내면 skipped:changed · 값 = 운영자 25분',
  op2 && a2.ok && a2.v[0].status === 'failed:busy' && a2.ms < 1000 && a2b[0].status === 'skipped:changed' && (await recN(X)) === 0 && l2.wait_minutes === 25,
  JSON.stringify({ a: a2.v && a2.v[0].status, ms: a2.ms, again: a2b[0].status, wait: l2.wait_minutes }));
await A.query('begin'); const a3 = await confirm(A, items([Y], seen));
const po3 = timed(opSet(OP, Y, 30));
const waited3 = await stillWaiting(po3, 300);
await A.query('commit'); const o3 = await po3;
const l3 = (await S.query('select wait_minutes from public.booth_live where booth_id = $1', [Y])).rows[0];
t('L2b 관리자 확인이 먼저 잡고 있으면 운영자 입력은 그동안만 기다렸다가 저장(30분) · 확인은 지금 값에서 빠짐 · 기록 1줄 남음',
  a3[0].status === 'confirmed' && waited3 && o3.ok && l3.wait_minutes === 30 && !(await activeChecks()).includes(Y) && (await recN(Y)) === 1,
  JSON.stringify({ a: a3[0].status, waited3, opMs: o3.ms, wait: l3.wait_minutes }));
{ // 동시 반복: 같은 부스에 관리자 확인과 운영자 입력을 같은 순간에
  const st = []; let opErr = 0, lost = 0, active = 0;
  for (let i = 0; i < ROUNDS * 2; i++) {
    const id = R[i % 84]; await refill([id]); const s = await seenOf([id]); const w = 5 + (i % 50);
    const [ra, ro] = await Promise.all([settle(confirm(A, items([id], s))), settle(opSet(OP, id, w))]);
    if (!ro.ok) opErr++;
    if (ra.ok) st.push(ra.v[0].status);
    const l = (await S.query('select wait_minutes from public.booth_live where booth_id = $1', [id])).rows[0];
    if (!l || l.wait_minutes !== w) lost++;
    if ((await activeChecks()).includes(id)) active++;
  }
  metrics.L2 = { rounds: ROUNDS * 2, adminStatuses: tally(st), operatorErrors: opErr, operatorValueLost: lost, staleCheckStillActive: active };
  t(`L2c 동시 반복 ${ROUNDS * 2}번 — 운영자 입력 실패 0 · 운영자 값 유지 ${ROUNDS * 2}/${ROUNDS * 2} · 운영자 입력 뒤 남은 관리자 확인 표시 0`,
    opErr === 0 && lost === 0 && active === 0, JSON.stringify(metrics.L2));
}

// ══ L3 lock_timeout · busy ══════════════════════════════════════════════
await refill(); seen = await seenOf(R);
await OP.query('begin'); await opSet(OP, Z, 20);
const a4 = await timed(confirm(A, items([Z, W], seen)));
await OP.query('rollback');
const s4 = Object.fromEntries((a4.v || []).map(r => [r.booth_id, r.status]));
t('L3a 운영자 입력이 잡고 있는 부스만 failed:busy · 다른 부스는 confirmed · 관리자는 기다리지 않음', s4[Z] === 'failed:busy' && s4[W] === 'confirmed' && a4.ms < 1000, JSON.stringify({ s4, ms: a4.ms }));
const ids5 = [R[50], R[51], R[52]];
await A.query('begin'); await confirm(A, items([R[49]], seen));     // A 가 일괄 확인을 끝내지 않고 붙잡음(줄 세우기 잠금 보유)
const b5 = await timed(confirm(B, items(ids5, seen)));
await sleep(200); await A.query('commit');
const b5b = await confirm(B, items(ids5, seen));
t('L3b 다른 관리자의 일괄 확인이 3초 넘게 끝나지 않으면 이 요청은 약 3초 뒤 전체 failed:busy(기록 0) · 다시 보내면 confirmed',
  b5.ok && b5.v.length === 3 && b5.v.every(r => r.status === 'failed:busy') && b5.ms >= 2800 && b5.ms < 6000 && b5b.every(r => r.status === 'confirmed') && (await recN(R[50])) === 1,
  JSON.stringify({ st: b5.v && b5.v.map(r => r.status), ms: b5.ms }));

// ══ L4 서로 다른 순서로 여러 부스 ═════════════════════════════════════════
{
  let dl = 0, odd = 0; const st = [];
  for (let i = 0; i < ROUNDS; i++) {
    await S.query('delete from public.booth_live_check');
    const ids = shuffle(R).slice(0, 20); seen = await seenOf(ids);
    const rs = await Promise.all([A, B, C].map(c => settle(confirm(c, items(shuffle(ids), seen)))));
    for (const r of rs) { if (!r.ok) { if (r.code === '40P01') dl++; odd++; } else st.push(...r.v.map(x => x.status)); }
    const per = await recPerBooth(); for (const id of ids) if ((per[id] || 0) !== 1) odd++;
  }
  metrics.L4 = { rounds: ROUNDS, adminsPerRound: 3, boothsPerBatch: 20, statuses: tally(st), deadlocks: dl, oddRecords: odd };
  t(`L4 세 관리자가 같은 20곳을 서로 다른 순서로 동시에 ${ROUNDS}번 — 교착 0 · 오류 0 · 부스마다 기록 1줄`, dl === 0 && odd === 0, JSON.stringify(metrics.L4));
}

// ══ L5 23:00 초기화와 겹침 ═══════════════════════════════════════════════
await refill();
const plan = (await S.query('explain delete from public.booth_live as l where l.booth_id = any (private.rehearsal_booth_ids())')).rows.map(r => r['QUERY PLAN'])
  .join(' / ').replace(/'\{[^}]*\}'::uuid\[\]/g, "'{84곳}'::uuid[]").replace(/\s+\(cost=[^)]*\)/g, '');
metrics.resetPlan = plan;
// 초기화가 줄을 잡는 순서 — 순차 읽기면 물리 순서(ctid), 색인 읽기면 booth_id 순서. 맨 처음 · 맨 끝 줄을 골라
// '관리자가 끝 줄을 잡은 채, 초기화가 이미 잡은 첫 줄을 요청' 하는 엇갈림을 일부러 만듭니다.
async function resetOrder() {
  const byIndex = /Index (Only )?Scan/i.test(plan);
  const rows = (await S.query(`select booth_id::text b from public.booth_live where booth_id = any($1::uuid[]) order by ${byIndex ? 'booth_id' : 'ctid'}`, [R])).rows.map(r => r.b);
  return { first: rows[0], last: rows[rows.length - 1] };
}
async function interleave(fn) {
  await refill(); const { first: lockedFirst, last: lockedLast } = await resetOrder(); const s = await seenOf([lockedFirst, lockedLast]);
  await A.query('begin'); const first = await confirm(A, items([lockedLast], s), fn);  // 관리자: 초기화가 맨 끝에 잡을 줄을 먼저 잡음
  const pr = timed(RS.query('select private.rehearsal_live_reset()'));                // 초기화: 앞에서부터 지우다 그 줄에서 기다림
  const resetWaiting = await stillWaiting(pr, 400);
  const second = await timed(confirm(A, items([lockedFirst], s), fn));                // 관리자: 이미 초기화가 잡은 첫 줄을 요청
  await A.query('commit');
  const r = await pr;
  const left = +(await S.query('select count(*) n from public.booth_live where booth_id = any($1::uuid[])', [R])).rows[0].n;
  return { first: first[0].status, second: second.ok ? second.v[0].status : second.code, secondMs: second.ms, resetWaiting, resetOk: r.ok, resetCode: r.code || '', resetMs: r.ms, left };
}
const old5 = await interleave('test_confirm_old_wait');
const new5 = await interleave('admin_confirm_booth_live');
metrics.L5interleave = { old: old5, now: new5 };
t('L5a (비교) 처음 설계(FOR UPDATE 기다림) — 관리자가 앞 부스를 잡은 채 초기화가 잡은 부스를 기다리면 교착 → 초기화가 실패할 수 있음',
  !old5.resetOk && old5.resetCode === '40P01', JSON.stringify({ plan, old5 }));
t('L5b 지금 설계 — 같은 끼어들기에서 관리자는 그 부스만 failed:busy(기다리지 않음) · 초기화는 관리자 요청이 끝나자 84곳 모두 지우고 완료(오류 없음)',
  new5.first === 'confirmed' && new5.second === 'failed:busy' && new5.secondMs < 1000 && new5.resetWaiting && new5.resetOk && new5.left === 0, JSON.stringify(new5));
async function resetStress(fn, rounds) {
  let resetFail = 0, deadlocks = 0, adminErr = 0, left = 0; const st = [];
  for (let i = 0; i < rounds; i++) {
    await refill(); const s = await seenOf(R);
    const batches = [A, B, C].map(c => () => confirm(c, items(shuffle(R).slice(0, 30), s), fn));
    const jobs = [sleep(Math.floor(Math.random() * 15)).then(() => settle(RS.query('select private.rehearsal_live_reset()'))),
      ...batches.map(b => sleep(Math.floor(Math.random() * 15)).then(() => settle(b())))];
    const [rr, ...ra] = await Promise.all(jobs);
    if (!rr.ok) { resetFail++; if (rr.code === '40P01') deadlocks++; }
    for (const r of ra) { if (!r.ok) { adminErr++; if (r.code === '40P01') deadlocks++; } else st.push(...r.v.map(x => x.status)); }
    left += +(await S.query('select count(*) n from public.booth_live where booth_id = any($1::uuid[])', [R])).rows[0].n;
  }
  return { rounds, resetFailures: resetFail, deadlocks, adminErrors: adminErr, rowsLeftAfterReset: left, adminStatuses: tally(st) };
}
metrics.L5now = await resetStress('admin_confirm_booth_live', ROUNDS);
t(`L5c 지금 설계 — 초기화 + 관리자 세 명(30곳씩)을 같은 순간에 ${ROUNDS}번: 초기화 실패 0 · 교착 0 · 초기화 뒤 남은 값 0 · 관리자 오류 0`,
  metrics.L5now.resetFailures === 0 && metrics.L5now.deadlocks === 0 && metrics.L5now.rowsLeftAfterReset === 0 && metrics.L5now.adminErrors === 0, JSON.stringify(metrics.L5now));
metrics.L5old = await resetStress('test_confirm_old_wait', ROUNDS);
t(`L5d (참고) 처음 설계로 같은 반복 ${ROUNDS}번 — 초기화 실패 ${metrics.L5old.resetFailures} · 교착 ${metrics.L5old.deadlocks}(0 이 아닐 수 있음을 기록만)`, true, JSON.stringify(metrics.L5old));
t('L5e 초기화 함수는 시험 내내 그대로(이 시험이 바꾸지 않음)', /delete from public\.booth_live/i.test((await S.query("select pg_get_functiondef('private.rehearsal_live_reset()'::regprocedure) d")).rows[0].d), '');

await S.query('drop function public.test_confirm_old_wait(jsonb); drop function public.test_confirm_share(jsonb);');
for (const c of [A, B, C, OP, RS, S]) await c.end();
const passed = results.filter(x => x.ok).length;
mkdirSync(resolve(OUT, 'rehearsal'), { recursive: true });
const head = [`- 실행: ${new Date().toISOString()} · 결과 **${passed} / ${results.length} 통과**`, `- PostgreSQL ${pgVersion} · deadlock_timeout ${deadlockTimeout} · 반복 ${ROUNDS} · 일괄 확인 SQL ${siteRev}`,
  `- 초기화 삭제 계획: ${plan}`];
writeFileSync(resolve(OUT, 'rehearsal', 'batch-confirm-locks-report.md'), ['# ‘확인 필요’ 일괄 확인 — 실제 PostgreSQL 동시 잠금 시험', '', ...head, '',
  '| 결과 | 시험 | 수치 · 메모 |', '|---|---|---|', ...results.map(x => `| ${x.ok ? '통과' : '**실패**'} | ${x.name.replace(/\|/g, '/')} | ${(x.note || '').replace(/\|/g, '/')} |`), '',
  '```json', JSON.stringify(metrics, null, 2), '```', ''].join('\n'));
writeFileSync(resolve(OUT, 'rehearsal', 'batch-confirm-locks-metrics.json'), JSON.stringify({ pgVersion, deadlockTimeout, siteRev, rounds: ROUNDS, passed, total: results.length, metrics }, null, 2));
console.log(`\n${passed} / ${results.length} 통과 → out/rehearsal/batch-confirm-locks-report.md`);
process.exit(passed === results.length ? 0 : 1);
