/* ===================================================================
   운영자 알림 — 실제 PostgreSQL(여러 독립 연결) 부하 · 동시성 시험
   ───────────────────────────────────────────────────────────────────
   운영자 84곳이 15~20초마다 알림을 묻는 부하와, 관리자 둘이 같은 순간 보내기 · 운영자 대기 입력 · 23:00 초기화가
   겹칠 때를 실제 연결 여럿으로 봅니다(PGlite · 한 연결 시험 test-booth-notice.mjs 로는 못 보는 것).
     N1 84곳 × 20번 묻기(운영자 연결 24개에 나눠 동시에) + 표시 · 확인 — 오류 0 · 응답 시간(p50 · p95 · 최대) · 확인 한 번씩
     N2 관리자 둘이 같은 순간 같은 종류 보내기(반복) — 부스마다 한 번만(10분 제한이 겹치지 않음)
     N3 알림을 묻는 동안 운영자 84곳이 대기 입력 — 입력 실패 0 · 값 그대로 저장 · 알림 확인이 입력을 막지 않음
     N4 알림을 묻는 동안 23:00 초기화 — 초기화 성공 · 알림 함수는 booth_live 를 잡지 않음
     N5 서버 스위치 끄기 — 다음 묻기부터 enabled false · 보내기 거절
     N6 알림만 다룬 동안 booth_live · booth_live_log 그대로
     N8 (migration-booth-notice-push.sql 이 있으면) 기기 알림 — 84곳 동시 구독 · 같은 기기 두 부스 경쟁 · 관리자 둘이 같은 알림의 보낼 곳 · 결과를 동시에 · 되돌리기 · 다시 적용
   ⚠️ 버려도 되는 빈 PostgreSQL(14 이상 · pgcrypto)에서만. Supabase 주소 · public.booths 가 있는 DB 는 거절합니다.
   쓰는 법: PGURL=postgres://…/<빈 DB> node scripts/booth-data/test-booth-notice-load.mjs --pg-dir <pg 폴더> --main-dir <claude/operator-notice 작업 폴더> --disposable
   결과: out/rehearsal/booth-notice-load-report.md
   =================================================================== */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'out');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const MAIN = resolve(arg('main-dir', resolve(HERE, '..', '..')));
const POLLS = +arg('polls', 20), OPS = +arg('op-conns', 24), ROUNDS = +arg('rounds', 20);
if (!process.argv.includes('--disposable') || !process.env.PGURL) { console.error('버려도 되는 빈 DB 주소(PGURL)와 --disposable 이 필요합니다.'); process.exit(2); }
if (/supabase\.(co|com)|pooler/i.test(process.env.PGURL)) { console.error('Supabase 주소에는 돌리지 않습니다.'); process.exit(2); }
const { Client } = createRequire(join(resolve(arg('pg-dir')), 'package.json'))('pg');

const ADMIN = '00000000-0000-4000-8000-00000000a001', ADMIN2 = '00000000-0000-4000-8000-00000000a002';
const results = [], metrics = {};
function t(name, ok, note = '') { results.push({ name, ok: !!ok, note: String(note).slice(0, 700) }); console.log(`${ok ? '통과' : '실패'}  ${name}${note ? '  — ' + String(note).slice(0, 700) : ''}`); }
const settle = p => p.then(v => ({ ok: true, v }), e => ({ ok: false, code: e.code, hint: e.hint, message: e.message }));
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
async function client(uid) { const c = new Client({ connectionString: process.env.PGURL }); await c.connect(); if (uid) await c.query("select set_config('test.uid', $1, false)", [uid]); return c; }

const S = await client();
if ((await S.query("select to_regclass('public.booths') r")).rows[0].r) { console.error('public.booths 가 이미 있습니다 — 빈 DB 에서만.'); process.exit(2); }
const pgVersion = (await S.query('show server_version')).rows[0].server_version;
await S.query('create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions;');
for (const f of ['replica-schema.sql', 'replica-functions.sql', 'replica-functions-extra.sql']) await S.query(readFileSync(resolve(HERE, 'dryrun', f), 'utf8'));
await S.query(`insert into public.settings (id, event_start, event_end, booth_pin_enabled, booth_sample_common_pin_enabled) values (1, '2026-11-06 01:00+00', '2026-11-07 08:00+00', true, false)`);
await S.query("insert into public.staff_profiles (id, role, name) values ($1, 'admin', '관리자 A'), ($2, 'admin', '관리자 B')", [ADMIN, ADMIN2]);
for (const [i, k] of ['R1', 'R2', 'R3', 'R4'].entries()) await S.query("insert into public.zones (key, label, sort_order, is_published) values ($1, '리허설 임시구역', $2, true)", [k, i + 1]);
const REH = readFileSync(join(MAIN, 'supabase/migration-booth-rehearsal.sql'), 'utf8');
const idsBody = REH.slice(REH.indexOf('function private.rehearsal_booth_ids()'), REH.indexOf('$function$;', REH.indexOf('function private.rehearsal_booth_ids()')));
const R = [...new Set(idsBody.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g))].sort();
for (const [i, id] of R.entries()) await S.query("insert into public.booths (id, zone_key, no, name, org, org_type, is_published, sort_order) values ($1, $2, $3, $4, '시험 기관', '기관', true, $5)",
  [id, 'R' + (1 + Math.floor(i / 21)), (i % 21) + 1, '시험 부스 ' + (i + 1), i + 1]);
await S.query(REH);
await S.query(readFileSync(join(MAIN, 'supabase/migration-booth-notice.sql'), 'utf8'));
// 리허설 모드 추가 SQL(있으면) — 기본 리허설 모드. N1~N4 는 행사 모드로, N7 에서 리허설 모드를 봅니다.
const HAS_REH = existsSync(join(MAIN, 'supabase/migration-booth-notice-rehearsal.sql'));
if (HAS_REH) await S.query(readFileSync(join(MAIN, 'supabase/migration-booth-notice-rehearsal.sql'), 'utf8'));
// 30분 · 기기 알림(Web Push) 추가 SQL(있으면) — 확인 표는 N8 에서 봅니다
const PUSH_SQL = join(MAIN, 'supabase/migration-booth-notice-push.sql'), PUSH_RB = join(MAIN, 'supabase/rollback-booth-notice-push.sql');
const HAS_PUSH = existsSync(PUSH_SQL);
const lastRows = r => (Array.isArray(r) ? r[r.length - 1] : r).rows;
const pushConf = HAS_PUSH ? lastRows(await S.query(readFileSync(PUSH_SQL, 'utf8'))) : null;
const setMode = r => HAS_REH ? S.query('update public.booth_notice_config set rehearsal_only = $1 where id = 1', [r]) : null;
const siteRev = (() => { try { return execFileSync('git', ['-C', MAIN, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return '?'; } })();
await S.query("select set_config('test.uid', $1, false)", [ADMIN]);
await S.query('select count(*) from public.admin_issue_booth_tokens(null)');
const TOK = Object.fromEntries((await S.query('select booth_id::text b, token from public.admin_booth_access()')).rows.map(r => [r.b, r.token]));
await S.query("select set_config('test.uid', '', false)");
await S.query('update public.booth_notice_config set enabled = true where id = 1');
const modeAtInstall = HAS_REH ? (await S.query('select rehearsal_only from public.booth_notice_config where id = 1')).rows[0].rehearsal_only : null;
await setMode(false);
t(`준비 — PostgreSQL ${pgVersion} · 리허설 84곳 · QR 열쇠 84 · 운영자 알림 SQL(${siteRev}) · 켜짐`, R.length === 84 && R.every(id => TOK[id]), '');

async function refill() {
  await S.query('delete from public.booth_notice');
  await S.query('delete from public.booth_live where booth_id = any($1::uuid[])', [R]);
  for (const id of R) await S.query("insert into public.booth_live (booth_id, congestion, wait_minutes, updated_at) values ($1, '보통', 20, now() - interval '45 minutes')", [id]);
}
const fp = async () => (await S.query(`select md5(coalesce(string_agg(row(l.*)::text, ',' order by l.booth_id), '')) a,
  (select md5(coalesce(string_agg(row(g.*)::text, ',' order by g.id), '')) from public.booth_live_log g) b from public.booth_live l`)).rows[0];
const A = await client(ADMIN), B = await client(ADMIN2), RS = await client();
const OPC = []; for (let i = 0; i < OPS; i++) OPC.push(await client());
const send = (c, kind, body, ids = null) => c.query('select * from public.admin_send_booth_notice($1, null, $2::uuid[], $3)', [kind, ids, body]).then(r => r.rows);
const op = (c, id, action, nid) => c.query('select public.booth_ctrl_notice($1, $2, $3) r', [TOK[id], action, nid || null]).then(r => r.rows[0].r);
// 운영자 84곳을 연결 OPS 개에 나눠, 연결마다 차례로(한 연결 = 한 번에 하나) 일을 돌립니다
async function onOps(jobsPerBooth) {
  const lanes = OPC.map(() => []);
  R.forEach((id, i) => lanes[i % OPS].push(id));
  return Promise.all(lanes.map(async (ids, li) => { const out = []; for (const id of ids) out.push(...await jobsPerBooth(OPC[li], id)); return out; }));
}

// ══ N1 부하 ══════════════════════════════════════════════════════════
await refill();
const fp0 = await fp();
const n1send = await send(A, 'all', '부하 시험 알림');
const nid = Number(n1send.find(r => r.status === 'queued').notice_id);   // pg 는 bigint 를 글자로 돌려줌 — jsonb 의 id(숫자)와 견주려고 숫자로
const lat = []; let errs = 0;
const t0 = Date.now();
await onOps(async (c, id) => {
  const o = [];
  for (let k = 0; k < POLLS; k++) {
    const s = Date.now(); const r = await settle(op(c, id, 'list')); lat.push(Date.now() - s);
    if (!r.ok || !r.v.enabled || !r.v.notices.some(n => Number(n.id) === nid)) errs++;
    if (k === 0) { const r2 = await settle(op(c, id, 'shown', nid)); if (!r2.ok || !r2.v.ok) errs++; }
  }
  const r3 = await settle(op(c, id, 'ack', nid)); if (!r3.ok || !r3.v.ok) errs++;
  return o;
});
const wall = Date.now() - t0;
const total = R.length * (POLLS + 2);
const acked = +(await S.query('select count(*) n from public.booth_notice_target where notice_id = $1 and acked_at is not null and shown_at is not null', [nid])).rows[0].n;
metrics.N1 = { booths: 84, pollsPerBooth: POLLS, opConnections: OPS, calls: total, wallMs: wall, throughputPerSec: +(total / (wall / 1000)).toFixed(1),
  listMs: { p50: pct(lat, 0.5), p95: pct(lat, 0.95), max: Math.max(...lat) }, errors: errs, ackedTargets: acked,
  productionRatePerSec: +(84 / 18).toFixed(1) };
t(`N1 84곳 × ${POLLS}번 묻기 + 표시 · 확인(연결 ${OPS}개 동시) — 오류 0 · 84곳 모두 표시 · 확인 한 번씩 · 처리량 ${metrics.N1.throughputPerSec}/초(행사 예상 ${metrics.N1.productionRatePerSec}/초)`,
  errs === 0 && acked === 84 && metrics.N1.throughputPerSec > metrics.N1.productionRatePerSec * 5, JSON.stringify(metrics.N1));
t('N6 알림만 다룬 동안 booth_live · booth_live_log 그대로', JSON.stringify(fp0) === JSON.stringify(await fp()), '');

// ══ N2 관리자 둘이 같은 순간 보내기 ════════════════════════════════════
let dup = 0, odd = 0; const st2 = {};
for (let i = 0; i < ROUNDS; i++) {
  await refill();
  const [ra, rb] = await Promise.all([settle(send(A, 'stale', '')), settle(send(B, 'stale', ''))]);
  if (!ra.ok || !rb.ok) { odd++; continue; }
  [...ra.v, ...rb.v].forEach(r => { st2[r.status] = (st2[r.status] || 0) + 1; });
  const per = (await S.query('select booth_id, count(*)::int n from public.booth_notice_target group by 1')).rows;
  if (per.length !== 84 || per.some(p => p.n !== 1)) dup++;
}
metrics.N2 = { rounds: ROUNDS, statuses: st2, roundsWithDuplicates: dup, errors: odd };
t(`N2 관리자 둘이 같은 순간 ‘확인 필요’ 보내기 ${ROUNDS}번 — 부스마다 한 번만(queued 84 · skipped:recent 84) · 중복 0 · 오류 0`,
  dup === 0 && odd === 0 && st2.queued === 84 * ROUNDS && st2['skipped:recent'] === 84 * ROUNDS, JSON.stringify(metrics.N2));

// ══ N2b 관리자 둘이 같은 순간 같은 ‘부스 1곳’ 보내기 ════════════════════════
let dupB = 0, oddB = 0, wrongB = 0; const stB = {};
for (let i = 0; i < ROUNDS; i++) {
  await S.query('delete from public.booth_notice');
  const one = R[i % R.length];
  const [ra, rb] = await Promise.all([settle(send(A, 'booth', '부스 1곳 시험', [one])), settle(send(B, 'booth', '부스 1곳 시험', [one]))]);
  if (!ra.ok || !rb.ok) { oddB++; continue; }
  [...ra.v, ...rb.v].forEach(r => { stB[r.status] = (stB[r.status] || 0) + 1; if (r.booth_id !== one) wrongB++; });
  const per = (await S.query('select booth_id, count(*)::int n from public.booth_notice_target group by 1')).rows;
  if (per.length !== 1 || per[0].booth_id !== one || per[0].n !== 1) dupB++;
}
metrics.N2b = { rounds: ROUNDS, statuses: stB, roundsWithDuplicates: dupB, otherBooth: wrongB, errors: oddB };
t(`N2b 관리자 둘이 같은 순간 같은 ‘부스 1곳’ ${ROUNDS}번 — 그 부스에만 · 한 번만(queued 1 · skipped:recent 1) · 다른 부스 0 · 오류 0`,
  dupB === 0 && oddB === 0 && wrongB === 0 && stB.queued === ROUNDS && stB['skipped:recent'] === ROUNDS, JSON.stringify(metrics.N2b));

// ══ N3 묻는 동안 운영자 대기 입력 ═══════════════════════════════════════
await refill();
const n3 = (await send(A, 'all', '입력 겹침 시험')).find(r => r.status === 'queued').notice_id;
const inLat = []; let inErr = 0, lost = 0;
await onOps(async (c, id) => {
  for (let k = 0; k < 3; k++) await settle(op(c, id, 'list'));
  const s = Date.now(); const r = await settle(c.query('select wait_minutes from public.booth_ctrl_set($1, $2, $3)', [TOK[id], 'open', 15])); inLat.push(Date.now() - s);
  if (!r.ok) inErr++;
  await settle(op(c, id, 'ack', n3));
  return [];
});
lost = +(await S.query("select count(*) n from public.booth_live where booth_id = any($1::uuid[]) and not (wait_minutes = 15 and congestion = '보통')", [R])).rows[0].n;
metrics.N3 = { inputs: 84, inputErrors: inErr, valueNotSaved: lost, inputMs: { p50: pct(inLat, 0.5), p95: pct(inLat, 0.95), max: Math.max(...inLat) } };
t('N3 알림을 묻는 사이 84곳 대기 입력(15분) — 입력 실패 0 · 84곳 모두 그대로 저장 · 알림 함수가 입력을 막지 않음', inErr === 0 && lost === 0, JSON.stringify(metrics.N3));

// ══ N4 묻는 동안 23:00 초기화 ══════════════════════════════════════════
await refill();
const n4 = (await send(A, 'all', '초기화 겹침 시험')).find(r => r.status === 'queued').notice_id;
const polling = onOps(async (c, id) => { for (let k = 0; k < 5; k++) await settle(op(c, id, k === 2 ? 'ack' : 'list', n4)); return []; });
const rr = await settle(RS.query('select private.rehearsal_live_reset() n'));
await polling;
const left = +(await S.query('select count(*) n from public.booth_live where booth_id = any($1::uuid[])', [R])).rows[0].n;
metrics.N4 = { resetOk: rr.ok, deleted: rr.ok ? rr.v.rows[0].n : rr.code, left };
t('N4 알림을 묻고 확인하는 사이 23:00 초기화 — 초기화 성공 · 84곳 지움 · 남은 값 0', rr.ok && rr.v.rows[0].n === 84 && left === 0, JSON.stringify(metrics.N4));

// ══ N7 리허설 모드(부스 1곳만) — 관리자 여럿이 동시에 ═══════════════════════
if (HAS_REH) {
  await setMode(true);
  await S.query('delete from public.booth_notice');
  const fp7 = await fp();
  // 관리자 둘이 같은 순간: 한쪽은 일괄(확인 필요 · 전체 공개), 다른 쪽은 부스 1곳 — ROUNDS 번, 매번 다른 부스
  let bulkOk = 0, bulkWrongErr = 0, oneBad = 0, otherBooth = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const one = R[i % R.length];   // 판마다 다른 부스(같은 부스면 10분 중복 방지에 걸림)
    const [ra, rb] = await Promise.all([settle(send(A, i % 2 ? 'all' : 'stale', i % 2 ? '전체' : '')), settle(send(B, 'booth', '[리허설] 동시 시험', [one]))]);
    if (ra.ok) bulkOk++; else if (!(ra.code === '55000' && ra.hint === 'rehearsal_only')) bulkWrongErr++;
    if (!rb.ok || rb.v.length !== 1 || rb.v[0].booth_id !== one || rb.v[0].status !== 'queued') oneBad++;
  }
  const per = (await S.query('select n.kind, count(distinct t.booth_id)::int b, count(*)::int t from public.booth_notice n join public.booth_notice_target t on t.notice_id = n.id group by 1')).rows;
  const maxPer = (await S.query('select coalesce(max(c), 0)::int m from (select count(*) c from public.booth_notice_target group by notice_id) x')).rows[0].m;
  // 서로 다른 부스 1곳씩 24곳 동시(관리자 연결 둘을 번갈아)
  await S.query('delete from public.booth_notice');
  const par = await Promise.all(R.slice(0, 24).map((id, k) => settle(send(k % 2 ? A : B, 'booth', '[리허설] 여러 부스', [id]))));
  const parBad = par.filter((x, k) => !x.ok || x.v.length !== 1 || x.v[0].booth_id !== R[k] || x.v[0].status !== 'queued').length;
  const maxPer2 = (await S.query('select coalesce(max(c), 0)::int m, count(*)::int n from (select count(*) c from public.booth_notice_target group by notice_id) x')).rows[0];
  metrics.N7 = { rounds: ROUNDS, modeAtInstall, bulkAccepted: bulkOk, bulkOtherError: bulkWrongErr, singleBad: oneBad, kinds: per, maxTargetsPerNotice: maxPer, parallel24: { bad: parBad, notices: maxPer2.n, maxTargetsPerNotice: maxPer2.m } };
  t(`N7 리허설 모드(설치 기본 ${modeAtInstall}) — 관리자 둘 동시 ${ROUNDS}번: 일괄 발송 모두 거절(55000 rehearsal_only) · 부스 1곳은 모두 그 1곳에 · 알림마다 대상 최대 1곳 · 24곳 동시 각 1곳 · 대기 값 그대로`,
    modeAtInstall === true && bulkOk === 0 && bulkWrongErr === 0 && oneBad === 0 && maxPer === 1 && per.every(r => r.kind === 'booth') && parBad === 0 && maxPer2.n === 24 && maxPer2.m === 1 &&
    JSON.stringify(fp7) === JSON.stringify(await fp()), JSON.stringify(metrics.N7));
  await setMode(false);
}

// ══ N8 기기 알림(Web Push) — 실제 연결 여럿으로 구독 · 보낼 곳 · 결과가 겹칠 때 ═══════════════
if (HAS_PUSH) {
  const fp8 = await fp();
  await setMode(true);
  await S.query('delete from public.booth_notice');
  await S.query('update public.booth_notice_config set push_enabled = true where id = 1');
  const b64 = n => randomBytes(n).toString('base64url');
  const sub = tag => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/' + tag + '-' + b64(9), keys: { p256dh: b64(65), auth: b64(16) } });
  const opPush = (c, id, action, s) => c.query('select public.booth_ctrl_push($1, $2, $3::jsonb) r', [TOK[id], action, JSON.stringify(s)]).then(r => r.rows[0].r);
  // ① 84곳이 같은 순간 [알림 받기](앞 24곳은 기기 2대)
  const subsBy = {};
  R.forEach((id, i) => { subsBy[id] = [sub('b' + i)].concat(i < 24 ? [sub('c' + i)] : []); });
  const jobs = R.flatMap((id, i) => subsBy[id].map(s => ({ id, s })));
  const sr = await Promise.all(jobs.map((j, k) => settle(opPush(OPC[k % OPC.length], j.id, 'subscribe', j.s))));
  const subRows = (await S.query('select booth_id::text b, count(*)::int n from public.booth_push_sub group by 1')).rows;
  // ② 같은 기기가 두 부스로 같은 순간 [알림 받기](부스 옮김 경쟁) — 한 줄만 남음
  const mv = sub('move');
  const mr = await Promise.all([settle(opPush(OPC[0], R[30], 'subscribe', mv)), settle(opPush(OPC[1], R[31], 'subscribe', mv))]);
  const mvRows = (await S.query('select booth_id::text b from public.booth_push_sub where endpoint = $1', [mv.endpoint])).rows;
  // ③ 부스 1곳 알림 24개(동시) → 관리자 둘이 같은 알림의 보낼 곳을 같은 순간 묻고 · 결과(201)도 같은 순간 적음
  const nots = await Promise.all(R.slice(0, 24).map((id, k) => send(k % 2 ? A : B, 'booth', '', [id])));
  const ids = nots.map(r => r[0].notice_id);
  const tg = async (c, nid) => (await c.query('select * from public.admin_notice_push_targets($1)', [nid])).rows;
  const res = (c, nid, rows) => c.query('select public.admin_notice_push_result($1, $2::jsonb) r', [nid, JSON.stringify(rows.map(x => ({ sub_id: x.sub_id, booth_id: x.booth_id, status: 201 })))]);
  let wrongBooth = 0, sizes = [], errs8 = 0;
  await Promise.all(ids.map(async (nid, k) => {
    const [ta, tb] = await Promise.all([tg(A, nid), tg(B, nid)]);
    sizes.push(ta.length);
    if (ta.some(x => x.booth_id !== R[k]) || tb.some(x => x.booth_id !== R[k])) wrongBooth++;
    const rr = await Promise.all([settle(res(A, nid, ta)), settle(res(B, nid, tb))]);
    errs8 += rr.filter(x => !x.ok).length;
  }));
  const after = await Promise.all(ids.map(nid => tg(A, nid)));
  const sentRows = (await S.query('select count(*)::int n, count(push_sent_at)::int s from public.booth_notice_target where notice_id = any($1::bigint[])', [ids])).rows[0];
  // ④ QR 을 다시 발급한 부스는 빠짐 · 확인한 부스도 빠짐
  const n2 = await send(A, 'booth', '', [R[40]]);
  const before40 = (await tg(A, n2[0].notice_id)).length;
  await S.query("update public.booth_access set token = $2 where booth_id = $1", [R[40], b64(18)]);
  const after40 = (await tg(A, n2[0].notice_id)).length;
  await S.query("update public.booth_access set token = $2 where booth_id = $1", [R[40], TOK[R[40]]]);
  // ⑤ 되돌리기 → 다시 적용(실제 PostgreSQL 에서 두 SQL 이 끝까지 돎)
  const rb = await settle(S.query(readFileSync(PUSH_RB, 'utf8')));
  const rbConf = rb.ok ? lastRows(rb.v) : [];
  const re = await settle(S.query(readFileSync(PUSH_SQL, 'utf8')));
  const reConf = re.ok ? lastRows(re.v) : [];
  metrics.N8 = { installConf: pushConf.filter(r => r['맞음']).length + '/' + pushConf.length, subscribeErrors: sr.filter(x => !x.ok).length, subRows: subRows.length,
    move: { ok: mr.map(x => x.ok), rows: mvRows.length }, notices: ids.length, targetSizes: [Math.min(...sizes), Math.max(...sizes)], wrongBooth, resultErrors: errs8,
    targetsAfterResult: after.reduce((a, x) => a + x.length, 0), pushSent: sentRows, reissue: [before40, after40],
    rollback: rbConf.filter(r => r['맞음']).length + '/' + rbConf.length, reapply: reConf.filter(r => r['맞음']).length + '/' + reConf.length };
  t('N8 기기 알림 — 설치 확인 표 모두 맞음 · 84곳(108대) 동시 구독 오류 0 · 같은 기기 두 부스 동시 등록 → 한 줄 · 알림 24개를 관리자 둘이 동시에 보낼 곳 · 결과: 다른 부스 기기 0 · 결과 뒤 보낼 곳 0(한 번만) · QR 재발급 부스 빠짐 · 되돌리기 · 다시 적용 확인 표 모두 맞음 · 대기 값 그대로',
    pushConf.every(r => r['맞음']) && sr.every(x => x.ok && x.v.ok) && subRows.length === 84 && mr.every(x => x.ok) && mvRows.length === 1 &&
    wrongBooth === 0 && errs8 === 0 && Math.min(...sizes) >= 1 && after.every(x => x.length === 0) && sentRows.n === 24 && sentRows.s === 24 &&
    before40 === 1 && after40 === 0 && rbConf.length && rbConf.every(r => r['맞음']) && reConf.length && reConf.every(r => r['맞음']) &&
    JSON.stringify(fp8) === JSON.stringify(await fp()), JSON.stringify(metrics.N8));
  await setMode(false);
}

// ══ N5 스위치 끄기 ════════════════════════════════════════════════════
await S.query('update public.booth_notice_config set enabled = false where id = 1');
const n5a = await settle(op(OPC[0], R[0], 'list'));
const n5b = await settle(send(A, 'all', '꺼진 뒤'));
t('N5 서버 스위치 끄기 — 바로 다음 묻기부터 enabled false · 빈 목록 · 5분 간격 / 보내기 거절(55000)', n5a.ok && n5a.v.enabled === false && n5a.v.notices.length === 0 && n5a.v.poll_ms === 300000 &&
  !n5b.ok && n5b.code === '55000', JSON.stringify({ a: n5a.v, b: n5b.code }));

for (const c of [A, B, RS, S, ...OPC]) await c.end();
const passed = results.filter(x => x.ok).length;
mkdirSync(resolve(OUT, 'rehearsal'), { recursive: true });
writeFileSync(resolve(OUT, 'rehearsal', 'booth-notice-load-report.md'), ['# 운영자 알림 — 실제 PostgreSQL 부하 · 동시성 시험', '',
  `- 실행: ${new Date().toISOString()} · 결과 **${passed} / ${results.length} 통과** · PostgreSQL ${pgVersion} · 운영자 알림 SQL ${siteRev}`, '',
  '| 결과 | 시험 | 수치 · 메모 |', '|---|---|---|', ...results.map(x => `| ${x.ok ? '통과' : '**실패**'} | ${x.name.replace(/\|/g, '/')} | ${(x.note || '').replace(/\|/g, '/')} |`), '',
  '```json', JSON.stringify(metrics, null, 2), '```', ''].join('\n'));
writeFileSync(resolve(OUT, 'rehearsal', 'booth-notice-load-metrics.json'), JSON.stringify({ pgVersion, siteRev, passed, total: results.length, metrics }, null, 2));
console.log(`\n${passed} / ${results.length} 통과 → out/rehearsal/booth-notice-load-report.md`);
process.exit(passed === results.length ? 0 : 1);
