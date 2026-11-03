/* ===================================================================
   운영 방식(현장대기 · 현장예약) DB 시험 — 로컬 임시 Postgres 위에서
   ───────────────────────────────────────────────────────────────────
   빈 로컬 Postgres(embedded-postgres)를 띄워 replica-20261103.sql(2026-11-03 Production 정의)을 올리고,
   supabase/rollback-booth-live-mode.sql 의 3번(바뀌기 전 다섯 함수)을 올려 md5 를 Production 과 견준 뒤
   migration → 시험 → rollback 을 차례로 해 봅니다. 연결을 여러 개 열어 두 운영자가 같은 부스를
   동시에 다루는 경우도 실제 잠금으로 봅니다. Production 에는 접속하지 않습니다.

   쓰는 법(준비물은 저장소 밖 아무 폴더에):
     mkdir deps && cd deps && npm init -y && npm i embedded-postgres@17.6.0-beta.15 pg@8.13.1
     node scripts/booth-live-mode/test-db.mjs --deps <deps 폴더> [--data <임시 폴더>]
   =================================================================== */
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const req = createRequire(join(resolve(arg('deps')), 'package.json'));
const EmbeddedPostgres = req('embedded-postgres').default;
const pg = req('pg');
const DATA = arg('data', mkdtempSync(join(tmpdir(), 'booth-mode-pg-')));
const PORT = 55400 + Math.floor(Math.random() * 90);

const sql = (f) => readFileSync(resolve(REPO, f), 'utf8');
const MIGRATION = sql('supabase/migration-booth-live-mode.sql');
const ROLLBACK = sql('supabase/rollback-booth-live-mode.sql');
const REPLICA = readFileSync(resolve(HERE, 'replica-20261103.sql'), 'utf8');
const OLD_DEFS = ROLLBACK.slice(ROLLBACK.indexOf('-- 3. 2026-11-03'), ROLLBACK.indexOf('-- 4. 새 함수'));

const PROD_MD5 = {
  'private.booth_op_set(uuid,text,integer,uuid)': '47b39587a259ede1172674269286f543',
  'private.booth_op_touch(uuid,uuid)': 'f4a7c7206aeb1ffaece995cf36e3888b',
  'public.booth_ctrl_set(text,text,integer)': 'c244c2caaaf3cb72efea6af1a90694af',
  'public.booth_ctrl_touch(text)': '133b47076c22d428ce6dcc0591702051',
  'public.admin_set_booth_live(uuid,text,integer)': '778f69b8ceaac6eea38aaea71324c8c4'
};
const PROD_CHECK_MD5 = '935e9a9548dbdd292622c12a13ff47ed';

const B1 = '00000000-0000-4000-8000-000000000001';
const B2 = '00000000-0000-4000-8000-000000000002';
const B3 = '00000000-0000-4000-8000-000000000003';
const ADMIN = '00000000-0000-4000-8000-0000000000ad';

const results = [];
function t(name, ok, note = '') {
  results.push({ name, ok: !!ok, note });
  console.log(`${ok ? '통과' : '실패'}  ${name}${note && !ok ? '  — ' + note : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const db = new EmbeddedPostgres({ databaseDir: DATA, user: 'postgres', password: 'pw', port: PORT, persistent: false,
  onLog: () => {}, onError: () => {} });
await db.initialise();
await db.start();
const conns = [];
async function connect(role, uid) {
  const c = new pg.Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'pw', database: 'postgres' });
  await c.connect();
  conns.push(c);
  if (uid) await c.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  if (role) await c.query(`set role ${role}`);
  return c;
}
async function call(c, text, params) {
  try { return { rows: (await c.query(text, params)).rows }; }
  catch (e) { return { err: { code: e.code, hint: e.hint || '', message: e.message } }; }
}

try {
  const su = await connect(null);
  await su.query(REPLICA);
  await su.query(OLD_DEFS);
  // 2026-11-03 Production 과 같은 권한(다섯 함수)
  await su.query(`
    revoke all on function private.booth_op_set(uuid,text,integer,uuid) from public;
    revoke all on function private.booth_op_touch(uuid,uuid) from public;
    revoke all on function public.admin_set_booth_live(uuid,text,integer) from public;
    grant execute on function public.admin_set_booth_live(uuid,text,integer) to authenticated;
    grant execute on function public.booth_ctrl_set(text,text,integer) to anon, authenticated;
    grant execute on function public.booth_ctrl_touch(text) to anon, authenticated;`);

  // 세션(두 운영자가 같은 부스 B1 · 다른 부스 B2) · QR 열쇠
  const tok = () => randomBytes(32).toString('base64url');            // 43자
  const sha = (s) => createHash('sha256').update(s, 'utf8').digest();
  const S1a = tok(), S1b = tok(), S2 = tok(), S3 = tok(), SX = tok();
  for (const [s, b, exp] of [[S1a, B1, '1 day'], [S1b, B1, '1 day'], [S2, B2, '1 day'], [S3, B3, '1 day'], [SX, B1, '-1 minute']]) {
    await su.query(`insert into public.booth_session (booth_id, token_hash, expires_at) values ($1, $2, now() + $3::interval)`, [b, sha(s), exp]);
  }
  const K1 = randomBytes(18).toString('base64url'), K3 = randomBytes(18).toString('base64url');   // 24자
  await su.query(`insert into public.booth_access (booth_id, token) values ($1, $2), ($3, $4)`, [B1, K1, B3, K3]);

  const md5s = async () => {
    const out = {};
    for (const sig of Object.keys(PROD_MD5)) out[sig] = (await su.query(`select md5(prosrc) h from pg_proc where oid = $1::regprocedure`, [sig])).rows[0]?.h;
    out.check = (await su.query(`select md5(pg_get_constraintdef(oid)) h from pg_constraint where conname = 'booth_live_congestion_check'`)).rows[0]?.h;
    return out;
  };
  // 공식 부스 · QR 열쇠 · 세션(사용 시각 제외)의 지문 — migration · 시험 · rollback 내내 같아야 합니다.
  const fingerprint = async () => (await su.query(`select md5(
      coalesce((select string_agg(row(b.*)::text, ',' order by b.id) from public.booths b), '') ||
      coalesce((select string_agg(row(a.booth_id, a.token, a.created_at, a.disabled_at)::text, ',' order by a.booth_id) from public.booth_access a), '') ||
      coalesce((select string_agg(row(s.id, s.booth_id, s.token_hash, s.expires_at, s.revoked_at)::text, ',' order by s.id) from public.booth_session s), '')) h`)).rows[0].h;
  const fp0 = await fingerprint();
  const m0 = await md5s();
  t('T0 시험 기준 다섯 함수 = 2026-11-03 Production(md5)', Object.keys(PROD_MD5).every((k) => m0[k] === PROD_MD5[k]),
    JSON.stringify(m0));
  t('T0 booth_live CHECK = Production(md5)', m0.check === PROD_CHECK_MD5, m0.check);

  const anon = await connect('anon');
  const anon2 = await connect('anon');
  const admin = await connect('authenticated', ADMIN);

  const sSet = (c, s, mode, w) => call(c, `select * from public.booth_session_set($1, $2, $3)`, [s, mode, w]);
  const sTouch = (c, s) => call(c, `select * from public.booth_session_touch($1)`, [s]);
  const kSet = (c, k, mode, w) => call(c, `select * from public.booth_ctrl_set($1, $2, $3)`, [k, mode, w]);
  const kTouch = (c, k) => call(c, `select * from public.booth_ctrl_touch($1)`, [k]);
  const aSet = (id, mode, w) => call(admin, `select * from public.admin_set_booth_live($1, $2, $3)`, [id, mode, w]);
  const live = async (id) => (await su.query(`select congestion, wait_minutes, updated_at from public.booth_live where booth_id = $1`, [id])).rows[0] || null;
  const logN = async () => Number((await su.query(`select count(*) n from public.booth_live_log`)).rows[0].n);

  // 바뀌기 전과 같은가: 같은 입력 순서를 migration 전 · 뒤(스위치 꺼짐)에 넣어 결과 · 기록 · 오류를 견줍니다.
  async function scenario() {
    const out = [];
    const rec = async (label, r) => {
      const l = await live(B3);
      out.push([label, r.err ? `E:${r.err.code}:${r.err.message}` : 'ok', l ? `${l.congestion}/${l.wait_minutes}` : '-']);
    };
    await su.query(`delete from public.booth_live where booth_id = $1`, [B3]);
    await rec('touch-empty', await sTouch(anon, S3));
    for (const w of [15, 0, 60, 180, 181, -1]) await rec(`open ${w}`, await sSet(anon, S3, 'open', w));
    await rec('open null', await sSet(anon, S3, 'open', null));
    await rec('pause', await sSet(anon, S3, 'pause', null));
    await rec('touch', await sTouch(anon, S3));
    await rec('closed', await sSet(anon, S3, 'closed', 5));
    await rec('bogus', await sSet(anon, S3, 'bogus', 5));
    await rec('null', await sSet(anon, S3, null, 5));
    await rec('qr open 30', await kSet(anon, K3, 'open', 30));
    await rec('qr touch', await kTouch(anon, K3));
    await rec('qr bogus', await kSet(anon, K3, 'x', 1));
    await rec('qr bad token', await kSet(anon, 'short', 'open', 1));
    await rec('qr unknown token', await kSet(anon, 'A'.repeat(24), 'open', 1));
    await rec('admin open 45', await aSet(B3, 'open', 45));
    await rec('admin pause', await aSet(B3, 'pause', null));
    await rec('admin clear', await aSet(B3, 'clear', null));
    await rec('qr touch empty', await kTouch(anon, K3));
    await rec('admin bogus', await aSet(B3, 'bogus', null));
    await rec('admin missing booth', await aSet('00000000-0000-4000-8000-0000000000ff', 'open', 1));
    await rec('anon admin', await call(anon, `select * from public.admin_set_booth_live($1, 'open', 5)`, [B3]));
    await rec('expired session', await sSet(anon, SX, 'open', 5));
    const logs = (await su.query(`select congestion, wait_minutes, source, session_id is not null s from public.booth_live_log where booth_id = $1 order by id`, [B3])).rows;
    return { out, logs: logs.map((g) => `${g.congestion}/${g.wait_minutes}/${g.source}/${g.s}`) };
  }
  const before = await scenario();
  await su.query(`delete from public.booth_live_log`);
  const liveBefore = (await su.query(`select booth_id, congestion, wait_minutes, updated_at from public.booth_live order by booth_id`)).rows;
  await su.query(`insert into public.booth_live (booth_id, congestion, wait_minutes) values ($1, '보통', 20) on conflict (booth_id) do update set congestion = '보통', wait_minutes = 20`, [B2]);
  const liveB2 = await live(B2);

  // ── migration ──
  const mig = await call(su, MIGRATION);
  t('T1 migration 적용(한 트랜잭션, 확인 칸 통과)', !mig.err, mig.err && mig.err.message);
  t('T1 다시 적용하면 STOP(아무것도 바꾸지 않음)', !!(await call(su, MIGRATION)).err);
  await su.query('rollback').catch(() => {});
  t('T1 기존 상태 값은 그대로(B2 보통 20 · 시각 같음)', JSON.stringify(await live(B2)) === JSON.stringify(liveB2));
  t('T1 방식 줄 0 · 스위치 꺼짐', (await su.query(`select (select count(*) from public.booth_live_mode)::int n, (select enabled from public.booth_live_mode_config) e`)).rows[0].n === 0);

  // ── 스위치 꺼짐 = 바뀌기 전과 같음 ──
  const after = await scenario();
  const diff = before.out.map((r, i) => JSON.stringify(r) === JSON.stringify(after.out[i]) ? '' : `${JSON.stringify(r)} ≠ ${JSON.stringify(after.out[i])}`).filter(Boolean);
  t(`T2 스위치 꺼짐: 입력 ${before.out.length}가지의 결과 · 오류 문구 · 값이 바뀌기 전과 같음`, diff.length === 0, diff.join(' | '));
  t('T2 스위치 꺼짐: 기록(booth_live_log) 줄 · 출처 · 세션이 바뀌기 전과 같음', JSON.stringify(before.logs) === JSON.stringify(after.logs),
    `${before.logs.length} vs ${after.logs.length}`);
  let r = await sSet(anon, S3, 'resv_open', null);
  t('T2 스위치 꺼짐: 예약 상태 저장은 거부(22023 booth_mode_mismatch)', r.err && r.err.code === '22023' && r.err.hint === 'booth_mode_mismatch', JSON.stringify(r));
  r = await call(anon, `select * from public.booth_session_mode($1, 'reserve')`, [S1a]);
  t('T2 스위치 꺼짐: 방식 전환 거부(booth_mode_off)', r.err && r.err.hint === 'booth_mode_off', JSON.stringify(r));
  r = await call(anon, `select * from public.booth_session_mode($1, null)`, [S1a]);
  t('T2 스위치 꺼짐: 읽기 = wait · reserve_enabled false', r.rows && r.rows[0].op_mode === 'wait' && r.rows[0].reserve_enabled === false, JSON.stringify(r));

  // ── 권한 ──
  t('T3 anon: 방식 표에 쓰기 불가', !!(await call(anon, `insert into public.booth_live_mode (booth_id, mode) values ($1, 'reserve')`, [B1])).err);
  t('T3 anon: 공개 열(booth_id · mode)만 읽기 — 바꾼 시각 · 전체 열(select *)은 거부',
    !(await call(anon, `select booth_id, mode from public.booth_live_mode`)).err
    && !!(await call(anon, `select updated_at from public.booth_live_mode`)).err
    && !!(await call(anon, `select * from public.booth_live_mode`)).err);
  t('T3 anon: 스위치 표 읽기 · 켜기 불가', !!(await call(anon, `select * from public.booth_live_mode_config`)).err
    && !!(await call(anon, `update public.booth_live_mode_config set enabled = true`)).err);
  t('T3 anon: private 전환 함수 직접 호출 불가', !!(await call(anon, `select * from private.booth_mode_op($1, 'reserve', null)`, [B1])).err);
  await anon.query(`select set_config('request.method', 'GET', false)`);
  r = await call(anon, `select * from public.booth_session_mode($1, 'reserve')`, [S1a]);
  t('T3 GET 요청은 빈 결과(전환 안 함)', r.rows && r.rows.length === 0, JSON.stringify(r));
  await anon.query(`select set_config('request.method', '', false)`);
  const defs = (await su.query(`select p.proname, p.prosecdef, array_to_string(p.proconfig, ',') cfg from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.proname in ('booth_session_mode', 'booth_ctrl_mode', 'booth_live_mode_enabled', 'booth_mode_op', 'booth_mode_of', 'booth_mode_check', 'booth_mode_lock', 'booth_live_kind')`)).rows;
  t('T3 새 함수 8개: 공개 RPC 3개만 SECURITY DEFINER · 모두 search_path 비움',
    defs.length === 8 && defs.every((d) => d.cfg === 'search_path=""' && d.prosecdef === ['booth_session_mode', 'booth_ctrl_mode', 'booth_live_mode_enabled'].includes(d.proname)),
    JSON.stringify(defs));

  // ── 켜기 · 한 번에 현장예약 ──
  await su.query(`update public.booth_live_mode_config set enabled = true`);
  await sSet(anon, S1a, 'open', 15);
  const log0 = await logN();
  r = await call(anon, `select * from public.booth_session_mode($1, 'reserve')`, [S1a]);
  t('T4 현장대기 → 현장예약 한 번: 방식과 "현장예약 운영 중"(예약중)이 함께 저장 · 과거 대기 15분 없음',
    r.rows && r.rows[0].op_mode === 'reserve' && r.rows[0].congestion === '예약중' && (await live(B1)).congestion === '예약중' && (await live(B1)).wait_minutes === 0, JSON.stringify(r));
  const lg = (await su.query(`select congestion, source, session_id is not null s from public.booth_live_log where booth_id = $1 order by id desc limit 1`, [B1])).rows[0];
  t('T4 기록: booth_live_log 에 예약중 · set · 세션 한 줄(운영자 저장과 같은 기록)', lg && lg.congestion === '예약중' && lg.source === 'set' && lg.s && (await logN()) === log0 + 1, JSON.stringify(lg));
  const anonSees = (await anon2.query(`select booth_id, mode from public.booth_live_mode`)).rows;
  t('T4 공개 읽기: 그 부스가 reserve 로 보임(booth_id · mode 만)', anonSees.length === 1 && anonSees[0].mode === 'reserve' && Object.keys(anonSees[0]).length === 2);
  await sSet(anon, S1b, 'resv_closed', null);                                                // 다른 운영자가 예약 마감
  const log1 = await logN();
  r = await call(anon, `select * from public.booth_session_mode($1, 'reserve')`, [S1a]);     // 첫 기기가 응답을 잃고 다시 보냄
  t('T4 같은 전환 재전송: 그사이 고른 예약 마감을 덮지 않음(기록도 늘지 않음)',
    r.rows && (await live(B1)).congestion === '예약마감' && (await logN()) === log1, JSON.stringify(r));

  // ── 현장예약에서 쓰기 ──
  r = await sSet(anon, S1b, 'open', 15);    // 다른 운영자(옛 화면 · 못 보낸 누름)
  t('T5 현장예약: 대기 분(open) 거부 — PIN 세션', r.err && r.err.hint === 'booth_mode_mismatch' && (await live(B1)).congestion === '예약마감', JSON.stringify(r));
  r = await kSet(anon, K1, 'open', 20);
  t('T5 현장예약: 대기 분(open) 거부 — QR 열쇠', r.err && r.err.hint === 'booth_mode_mismatch' && (await live(B1)).congestion === '예약마감', JSON.stringify(r));
  r = await aSet(B1, 'open', 10);
  t('T5 현장예약: 대기 분(open) 거부 — 관리자 긴급 수정 · 일괄 채우기', r.err && r.err.hint === 'booth_mode_mismatch' && (await live(B1)).congestion === '예약마감', JSON.stringify(r));
  for (const [m, want] of [['resv_open', '예약중'], ['pause', '중단'], ['resv_open', '예약중'], ['resv_closed', '예약마감'], ['closed', '마감'], ['resv_open', '예약중']]) {
    r = await sSet(anon, S1b, m, null);
    t(`T5 현장예약: ${m} → ${want}`, !r.err && (await live(B1)).congestion === want && (await live(B1)).wait_minutes === 0, JSON.stringify(r.err || ''));
  }
  r = await kSet(anon, K1, 'resv_closed', null);
  t('T5 현장예약: QR 열쇠로 예약 마감', !r.err && r.rows[0].congestion === '예약마감', JSON.stringify(r.err || ''));
  r = await sTouch(anon, S1a);
  t('T5 현장예약: 변동 없음 · 지금 확인(예약마감 시각만 새로)', !r.err && (await live(B1)).congestion === '예약마감');
  r = await aSet(B1, 'resv_open', null);
  t('T5 관리자: 현장예약 부스에 예약 운영 중 넣기', !r.err && (await live(B1)).congestion === '예약중', JSON.stringify(r.err || ''));
  r = await sSet(anon, S2, 'resv_open', null);
  t('T5 현장대기 부스(B2)는 예약 상태 거부', r.err && r.err.hint === 'booth_mode_mismatch' && (await live(B2)).congestion === '보통');

  // ── 다른 부스 · 끝난 세션 ──
  r = await call(anon, `select * from public.booth_session_mode($1, 'reserve')`, [S2]);
  t('T6 B2 세션은 B2만 바꿈(B1 그대로)', r.rows && (await su.query(`select mode from public.booth_live_mode where booth_id = $1`, [B1])).rows[0].mode === 'reserve'
    && (await su.query(`select mode from public.booth_live_mode where booth_id = $1`, [B2])).rows[0].mode === 'reserve' && (await live(B2)).congestion === '예약중');
  await call(anon, `select * from public.booth_session_mode($1, 'wait')`, [S2]);
  r = await call(anon, `select * from public.booth_session_mode($1, 'wait')`, [SX]);
  t('T6 끝난 세션으로 전환 거부(42501)', r.err && r.err.code === '42501');
  r = await call(anon, `select * from public.booth_ctrl_mode($1, 'wait')`, ['B'.repeat(24)]);
  t('T6 모르는 QR 열쇠로 전환 거부(42501 booth_token_invalid)', r.err && r.err.hint === 'booth_token_invalid');
  r = await call(anon, `select * from public.booth_session_mode($1, 'both')`, [S1a]);
  t('T6 모르는 방식 값 거부(22023)', r.err && r.err.code === '22023');

  // ── 현장예약 → 현장대기 → (이전 값이 되살아나지 않음) ──
  r = await call(anon, `select * from public.booth_ctrl_mode($1, 'wait')`, [K1]);
  t('T7 현장예약 → 현장대기(QR): 예약 상태가 지워짐(정보 없음)', r.rows && r.rows[0].op_mode === 'wait' && r.rows[0].congestion === null && !(await live(B1)), JSON.stringify(r));
  r = await sTouch(anon, S1a);
  t('T7 현장대기로 돌아온 뒤 확인: 값 없음(이전 대기 15분 · 예약 상태가 되살아나지 않음)', r.err && r.err.code === '22023' && !(await live(B1)));
  r = await sSet(anon, S1a, 'open', 5);
  t('T7 현장대기로 돌아온 뒤 새 대기 분 저장', !r.err && (await live(B1)).congestion === '여유');
  r = await sSet(anon, S1b, 'resv_open', null);   // 예약 때 못 보낸 누름
  t('T7 현장예약 때 못 보낸 누름은 현장대기에서 거부', r.err && r.err.hint === 'booth_mode_mismatch' && (await live(B1)).congestion === '여유');
  r = await call(anon, `select * from public.booth_ctrl_mode($1, 'reserve')`, [K1]);
  t('T7 QR 열쇠로 현장예약 한 번: 예약중 바로 저장', r.rows && r.rows[0].congestion === '예약중' && (await live(B1)).congestion === '예약중', JSON.stringify(r));

  // ── 23:00 초기화 ──
  r = await call(su, `select private.rehearsal_live_reset() n`);
  t('T8 23:00 초기화: 당일 상태만 지움 · 방식(reserve) 유지', r.rows && !(await live(B1)) && (await su.query(`select mode from public.booth_live_mode where booth_id = $1`, [B1])).rows[0].mode === 'reserve');
  r = await sSet(anon, S1a, 'open', 10);
  t('T8 초기화 뒤에도 현장예약 부스에 대기 분 거부', r.err && r.err.hint === 'booth_mode_mismatch');
  r = await call(anon, `select * from public.booth_session_mode($1, 'reserve')`, [S1a]);
  t('T8 초기화 뒤 같은 방식 요청: 아무것도 바꾸지 않음(운영자가 "현장예약 운영 중" 을 눌러 그날 상태를 정함)', r.rows && r.rows[0].op_mode === 'reserve' && r.rows[0].congestion === null);
  r = await sSet(anon, S1a, 'resv_open', null);
  t('T8 초기화 뒤 현장예약 운영 중 저장', !r.err && (await live(B1)).congestion === '예약중');
  r = await call(admin, `select public.admin_reset_booth_live() n`);
  t('T8 관리자 전체 지우기도 방식은 유지', r.rows && (await su.query(`select count(*)::int n from public.booth_live_mode where mode = 'reserve'`)).rows[0].n === 1);

  // ── 관리자 일괄 확인 ──
  await sSet(anon, S1a, 'resv_open', null);
  await su.query(`update public.booth_live set updated_at = now() - interval '31 minutes' where booth_id = $1`, [B1]);
  // 마이크로초까지(JS Date 는 밀리초에서 잘림) — 관리 화면도 받은 글자 그대로 돌려보냅니다.
  const seen = (await su.query(`select updated_at::text t from public.booth_live where booth_id = $1`, [B1])).rows[0].t;
  r = await call(admin, `select * from public.admin_confirm_booth_live($1::jsonb)`, [JSON.stringify([{ booth_id: B1, seen_updated_at: seen }])]);
  t('T9 일괄 확인: 예약 운영 중도 확인 기록(값은 그대로)', r.rows && r.rows[0].status === 'confirmed' && (await live(B1)).congestion === '예약중', JSON.stringify(r));

  // ── 동시 조작(연결 두 개 · 실제 잠금) ──
  async function race(firstSql, firstArgs, secondSql, secondArgs) {
    const c1 = await connect('anon'), c2 = await connect('anon');
    await c1.query('begin');
    const a = await call(c1, firstSql, firstArgs);
    let done = false;
    const p = call(c2, secondSql, secondArgs).then((x) => { done = true; return x; });
    await sleep(400);
    const waited = !done;
    await c1.query('commit');
    const b = await p;
    return { a, b, waited };
  }
  // (1) 전환이 먼저 잡고, 그 사이 다른 운영자가 대기 분 저장
  await call(anon, `select * from public.booth_session_mode($1, 'wait')`, [S1a]);
  await sSet(anon, S1a, 'open', 15);
  let x = await race(`select * from public.booth_session_mode($1, 'reserve')`, [S1a], `select * from public.booth_session_set($1, 'open', 30)`, [S1b]);
  t('T10 동시: 전환 중 들어온 대기 분은 기다렸다가 거부 · 남는 것은 "현장예약 + 예약중"',
    x.waited && x.b.err && x.b.err.hint === 'booth_mode_mismatch' && (await live(B1)).congestion === '예약중', JSON.stringify({ waited: x.waited, b: x.b.err }));
  // (2) 대기 분 저장이 먼저 잡고, 그 사이 전환
  await call(anon, `select * from public.booth_session_mode($1, 'wait')`, [S1a]);
  x = await race(`select * from public.booth_session_set($1, 'open', 45)`, [S1b], `select * from public.booth_session_mode($1, 'reserve')`, [S1a]);
  t('T10 동시: 저장 뒤 전환 — 전환이 기다렸다가 그 값을 지우고 예약중 · 남는 것은 "현장예약 + 예약중"',
    x.waited && !x.a.err && x.b.rows && x.b.rows[0].op_mode === 'reserve' && x.b.rows[0].congestion === '예약중' && (await live(B1)).congestion === '예약중', JSON.stringify({ waited: x.waited, a: x.a.err, b: x.b.err }));
  // (3) 두 운영자가 같은 전환을 동시에
  await call(anon, `select * from public.booth_session_mode($1, 'wait')`, [S1a]);
  const nBefore = await logN();
  x = await race(`select * from public.booth_session_mode($1, 'reserve')`, [S1a], `select * from public.booth_session_mode($1, 'reserve')`, [S1b]);
  t('T10 동시: 같은 전환 두 번 → 한 번만 적힘(예약중 기록 1줄)', x.waited && !x.b.err && (await logN()) === nBefore + 1 && (await live(B1)).congestion === '예약중');
  // (4) 서로 반대 전환을 동시에 — 나중 것이 이김
  x = await race(`select * from public.booth_session_mode($1, 'wait')`, [S1a], `select * from public.booth_ctrl_mode($1, 'reserve')`, [K1]);
  t('T10 동시: 반대 전환 — 나중 요청 방식(reserve)으로 끝남 · 방식과 상태가 맞음(예약중)', x.waited && !x.b.err && (await su.query(`select mode from public.booth_live_mode where booth_id = $1`, [B1])).rows[0].mode === 'reserve' && (await live(B1)).congestion === '예약중');
  // (5) 23:00 초기화와 전환이 겹침
  {
    const c1 = await connect('anon');
    await c1.query('begin');
    await call(c1, `select * from public.booth_session_mode($1, 'wait')`, [S1a]);
    const p = call(su, `select private.rehearsal_live_reset() n`);
    await sleep(200);
    await c1.query('commit');
    const rr = await p;
    t('T10 23:00 초기화와 전환이 겹침: 둘 다 성공 · 방식 wait · 상태 없음', !rr.err && (await su.query(`select mode from public.booth_live_mode where booth_id = $1`, [B1])).rows[0].mode === 'wait' && !(await live(B1)));
  }
  {
    const c1 = await connect('anon');
    await c1.query('begin');
    await call(c1, `select * from public.booth_session_mode($1, 'reserve')`, [S1a]);
    const p = call(su, `select private.rehearsal_live_reset() n`);
    await sleep(200);
    await c1.query('commit');
    const rr = await p;
    // 커밋 전 전환이 넣은 '예약중' 은 초기화가 보지 못하므로(초기화가 먼저 끝난 것과 같음) 남는 것은 "현장예약 + 예약중".
    t('T10 초기화와 현장예약 전환이 겹침: 둘 다 성공 · 방식 reserve + 예약중(방식과 상태가 엇갈리지 않음)',
      !rr.err && (await su.query(`select mode from public.booth_live_mode where booth_id = $1`, [B1])).rows[0].mode === 'reserve' && (await live(B1)).congestion === '예약중');
  }

  // ── 스위치 끄기(긴급 비활성화) ──
  await sSet(anon, S1a, 'resv_open', null);
  const anonSeesOn = (await anon2.query(`select count(*)::int n from public.booth_live_mode`)).rows[0].n;
  const rowsBeforeOff = (await su.query(`select (select count(*) from public.booth_live_mode)::int m, (select count(*) from public.booth_live)::int l`)).rows[0];
  await su.query(`update public.booth_live_mode_config set enabled = false`);
  t('T11 끄기: 공개 읽기에서 방식 줄 0(켜져 있을 때는 보임) · 운영 데이터는 지우지 않음', anonSeesOn >= 1 && (await anon2.query(`select count(*)::int n from public.booth_live_mode`)).rows[0].n === 0
    && JSON.stringify((await su.query(`select (select count(*) from public.booth_live_mode)::int m, (select count(*) from public.booth_live)::int l`)).rows[0]) === JSON.stringify(rowsBeforeOff));
  r = await call(anon, `select * from public.booth_session_mode($1, null)`, [S1a]);
  t('T11 끄기: 운영자 읽기 = wait · 남은 상태 예약중이 함께 옴(화면이 숨김)', r.rows && r.rows[0].op_mode === 'wait' && r.rows[0].reserve_enabled === false && r.rows[0].congestion === '예약중', JSON.stringify(r));
  r = await sTouch(anon, S1a);
  t('T11 끄기: 남은 예약 상태를 확인으로 되살리지 않음(22023)', r.err && r.err.hint === 'booth_mode_mismatch');
  r = await sSet(anon, S1a, 'open', 20);
  t('T11 끄기: 대기 분을 누르면 바로 덮어씀', !r.err && (await live(B1)).congestion === '보통');
  r = await sSet(anon, S1a, 'resv_closed', null);
  t('T11 끄기: 예약 상태 저장 거부', r.err && r.err.hint === 'booth_mode_mismatch');
  await su.query(`update public.booth_live_mode_config set enabled = true`);
  r = await call(anon, `select * from public.booth_session_mode($1, null)`, [S1a]);
  t('T11 다시 켜면 정해 둔 방식(reserve)이 살아남', r.rows && r.rows[0].op_mode === 'reserve');
  r = await sTouch(anon, S1a);
  t('T11 다시 켠 뒤 끈 동안 넣은 대기 값은 확인으로 되살리지 않음', r.err && r.err.hint === 'booth_mode_mismatch');

  // ── ops D: 테스트 설정 정리(승인 절차) ──
  const OPS = sql('supabase/ops-booth-live-mode.sql');
  const cleanup = OPS.slice(OPS.indexOf('do $cleanup$'));
  const reserveN = async () => (await su.query(`select count(*)::int n from public.booth_live_mode where mode = 'reserve'`)).rows[0].n;
  await call(anon, `select * from public.booth_session_mode($1, 'reserve')`, [S3]);
  const n0 = await reserveN();
  r = await call(su, cleanup);
  t('T12 정리 그대로 실행(번호 없음 · 전부 아님): 아무 부스도 고르지 않음', !r.err && (await reserveN()) === n0 && n0 === 2, JSON.stringify(r.err || n0));
  r = await call(su, cleanup.replace('v_all     boolean := false', 'v_all     boolean := true'));
  t('T12 v_all 만 켬(승인 문구 없음): 미리 보기만', !r.err && (await reserveN()) === n0);
  r = await call(su, cleanup.replace('v_all     boolean := false', 'v_all     boolean := true').replace("v_confirm text    := ''", "v_confirm text    := '1곳 정리'"));
  t('T12 승인 문구의 곳 수가 다름(1곳 ≠ 2곳): 바꾸지 않음', !r.err && (await reserveN()) === n0);
  r = await call(su, cleanup.replace("array[]::text[]", "array['S03']").replace("v_confirm text    := ''", "v_confirm text    := '1곳 정리'"));
  t('T12 번호(S03) + 맞는 승인 문구: 그 부스만 현장대기 · 상태 지움', !r.err && (await reserveN()) === n0 - 1 && !(await live(B3))
    && (await su.query(`select mode from public.booth_live_mode where booth_id = $1`, [B3])).rows[0].mode === 'wait' && (await live(B1)).congestion !== null, JSON.stringify(r.err || ''));
  r = await call(su, cleanup.replace("array[]::text[]", "array['S01']").replace('v_all     boolean := false', 'v_all     boolean := true'));
  t('T12 번호와 전부를 함께 쓰면 멈춤', !!r.err);

  // ── 공식 부스 · QR · PIN · 세션은 그대로 ──
  t('T14 부스 · QR 열쇠 · 세션 표가 migration · 시험 내내 그대로', (await fingerprint()) === fp0, '');

  // ── 되돌리기 ──
  await sSet(anon, S1a, 'resv_open', null);
  const b2Before = await live(B2);
  r = await call(su, ROLLBACK);
  t('T13 되돌리기 적용(한 트랜잭션, md5 확인 통과)', !r.err, r.err && r.err.message);
  const m1 = await md5s();
  t('T13 되돌린 다섯 함수 · CHECK = 2026-11-03 Production(md5)', Object.keys(PROD_MD5).every((k) => m1[k] === PROD_MD5[k]) && m1.check === PROD_CHECK_MD5);
  t('T13 예약 상태 줄만 지워지고 다른 부스 값은 그대로', !(await live(B1)) && JSON.stringify(await live(B2)) === JSON.stringify(b2Before));
  t('T13 새 표 · 함수 없음 · 부스별 방식은 private 백업으로', (await su.query(`select to_regclass('public.booth_live_mode') a, to_regclass('private.booth_live_mode_backup') b, to_regprocedure('public.booth_session_mode(text,text)') c`)).rows
    .every((y) => y.a === null && y.b !== null && y.c === null));
  const fp = (await su.query(`select has_function_privilege('anon','public.booth_ctrl_set(text,text,integer)','EXECUTE') a,
                                     has_function_privilege('anon','public.admin_set_booth_live(uuid,text,integer)','EXECUTE') b,
                                     has_function_privilege('authenticated','public.admin_set_booth_live(uuid,text,integer)','EXECUTE') c`)).rows[0];
  t('T13 함수 권한 그대로(anon: QR 저장 O · 관리자 수정 X)', fp.a === true && fp.b === false && fp.c === true, JSON.stringify(fp));
  r = await sSet(anon, S1a, 'open', 15);
  t('T13 되돌린 뒤 저장 정상', !r.err && (await live(B1)).congestion === '보통');
  t('T14 되돌린 뒤에도 부스 · QR 열쇠 · 세션 표 그대로', (await fingerprint()) === fp0);
  r = await call(su, MIGRATION);
  t('T13 되돌린 뒤 migration 을 다시 적용할 수 있음', !r.err, r.err && r.err.message);
} catch (e) {
  t('시험 진행 중 오류', false, e.stack || String(e));
} finally {
  for (const c of conns) await c.end().catch(() => {});
  await db.stop().catch(() => {});
  try { rmSync(DATA, { recursive: true, force: true }); } catch { /* 무시 */ }
}

const fail = results.filter((x) => !x.ok);
console.log(`\n${results.length - fail.length}/${results.length} 통과`);
process.exit(fail.length ? 1 : 0);
