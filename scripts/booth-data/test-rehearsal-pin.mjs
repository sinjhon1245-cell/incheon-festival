/* ===================================================================
   리허설 공통 PIN 시험 — 로컬 복제 DB 위에서(Production 접속 없음)
   ───────────────────────────────────────────────────────────────────
   복제 DB(lib/replica.mjs)를 2026-10-19 Production 과 같은 단계로 만듭니다.
     migration-booth-preview → C-02 → Q-02 → T-02 → T-03 → migration-booth-rehearsal.sql
     + PIN 함수(migration-booth-pin · example-pin · pin-checked 의 함수 원문 — Production 지문과 견줌)
     + 예시 공통 PIN 스위치 꺼짐 · 예시 50곳과 A~J 구역 비공개 · 실제 84곳 리허설 대기 값(관리자 화면으로 채움)
   그 위에 작업 브랜치의 migration-booth-rehearsal-pin.sql 을 적용하고 화면은 고치지 않은 배포 파일로 봅니다.
     --pin-dir   claude/rehearsal-common-pin (main 421f656 기반)  supabase/*rehearsal-pin.sql · print-qr.html · booth-admin
     --live-dir  booth-live 배포본(7ebf536)                        booth-ctrl.html · visitor · live-snapshot
     --web-dir   claude/rehearsal-common-pin-web (main 421f656 기반) print-qr.html(첫 발급 결과 문구 보완)
     --old-dir   main 배포본(421f656)                               print-qr.html(바뀌기 전 문구 견주기)
   A  migration — 확인 표 · 다시 실행 · 바뀐 함수(대상 판정 하나 + 새 함수 둘) · 데이터 그대로 · 멈춤 조건 · 파일
   B  리허설 기간(지금 시각) — 로그인 · 틀린 PIN · 수정 · 비우기 뒤 다시 입력 · 23시 초기화 · 횟수 제한 · 세션 규칙 ·
      범위 · 전체 스위치 · 익명 직접 호출 · 동시 발급 · 예시 공통 PIN · 공개 출력
   C  운영자 화면(jsdom) — 구역 → 부스 → 공통 PIN → 운영 화면 → 저장
   D  끝나는 때(시험 시계) — 11-05 22:59 · 23:00 · 열린 화면 · 행사 날 · 행사 첫날이 바뀔 때 · 초기화와 따로
   F  되돌리기(= 비상 정지) · 다시 적용
   E  개별 PIN 전환(인쇄 화면 '선택 PIN 발급') — 바뀌기 전 문구 · 새 문구 · 부분 실패(실제 트랜잭션 되돌림) · 다시 발급 ·
      공통 PIN 막힘 · 세션 끊김 · 새 PIN · QR · 끄기 · 다시 열리지 않음
   G  예시 50곳 · 관리자 · 관람객 회귀 · 원문 PIN 흔적 · 마지막 지문
   ⚠️ 열쇠 · PIN · 세션은 이 복제 DB 의 가짜 값이고 출력하지 않습니다(개수와 참 · 거짓만).
   쓰는 법
     node --max-old-space-size=8192 scripts/booth-data/test-rehearsal-pin.mjs --pglite-dir <PGlite 0.4.4> --jsdom-dir <jsdom> \
          --pin-dir ../incheon-festival-rh-pin --live-dir ../incheon-festival-rh-live --old-dir ../incheon-festival-rh-main
   결과: out/rehearsal/rehearsal-pin-test-report.md
   =================================================================== */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readCsv } from './lib/csv.mjs';
import { loadPglite, openReplica, ADMIN } from './lib/replica.mjs';
import { makeRest, fakeSupabase } from './lib/fake-rest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT = resolve(HERE, 'out');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const PIN = resolve(arg('pin-dir', resolve(REPO, '../incheon-festival-rh-pin')));
const LIVE = resolve(arg('live-dir', resolve(REPO, '../incheon-festival-rh-live')));
const OLD = resolve(arg('old-dir', resolve(REPO, '../incheon-festival-rh-main')));
const WEB = resolve(arg('web-dir', PIN));   // print-qr.html 문구 보완 — 따로 둔 브랜치(claude/rehearsal-common-pin-web)
const { JSDOM, VirtualConsole } = createRequire(join(resolve(arg('jsdom-dir')), 'package.json'))('jsdom');
const lib = await loadPglite(arg('pglite-dir'));
const manifest = readCsv(resolve(OUT, 'staging', 'manifest.csv'));
const plan = readCsv(resolve(OUT, 'gate4r', 'plan-R.csv'));
const snap = readCsv(resolve(OUT, readdirSync(OUT).filter(f => /^prod-snapshot-\d{8}\.csv$/.test(f)).sort().pop()));
const R = await openReplica(lib, { snap, manifest });
const db = R.db;
const rest = makeRest(R);
const REAL = plan.map(p => p['부스ID']);
const exIds = snap.map(s => s.id);
const idOf = c => {
  if (/^[0-9a-f-]{36}$/.test(c)) return c;
  const p = plan.find(x => x['표시코드'] === c); if (p) return p['부스ID'];
  const e = snap.find(x => x.code === c); if (e) return e.id;
  throw new Error('부스 없음 ' + c);
};
const git = (dir, ...a) => { try { return execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim(); } catch { return '?'; } };
const sha = s => createHash('sha256').update(s).digest('hex');

const results = [];
let section = '';
function t(name, ok, note = '') { results.push({ section, name, ok: !!ok, note: ok ? '' : String(note).slice(0, 300) }); console.log(`${ok ? '통과' : '실패'}  ${name}${note && !ok ? '  — ' + String(note).slice(0, 300) : ''}`); }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000, step = 40) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await wait(step); } return false; }
const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const q1 = async (sql, p) => (await db.query(sql, p)).rows[0];
async function anon(sql, p) { try { return { ok: true, rows: await R.asAnon(sql, p) }; } catch (e) { return { ok: false, code: e.code, hint: e.hint, message: e.message }; } }
async function admin(sql, p) {
  try { await db.exec(`set test.uid = '${ADMIN}'`); return { ok: true, rows: (await db.query(sql, p)).rows }; }
  catch (e) { return { ok: false, code: e.code, hint: e.hint, message: e.message }; }
  finally { await db.exec("set test.uid = ''"); }
}
async function runAll(sql) {
  try { const r = await db.exec(sql); return { ok: true, rows: r[r.length - 1]?.rows || [] }; }
  catch (e) { try { await db.exec('rollback'); } catch { /* 없음 */ } return { ok: false, error: e.message, code: e.code }; }
}
const allOk = rows => rows.length > 0 && rows.every(x => x['기대'] === x['실제']);
const tableTxt = rows => rows.map(x => `${x['순서']}. ${x['항목']} — 기대 ${x['기대']} · 실제 ${x['실제']}`).join(' | ');

// 운영 준비용 공통 PIN — 서버(private.booth_common_pin_ok)에 이미 있는 값. 이 시험은 그 값을 출력하지 않습니다.
const COMMON = '123456';
let devN = 0;
const dev = () => 'pintestdev' + String(++devN).padStart(8, '0');
async function login(code, pin, d = dev()) {
  const r = await anon('select * from public.booth_pin_login($1, $2, $3)', [code === null ? null : idOf(code), pin, d]);
  return r.ok ? Object.assign({ dev: d }, r.rows[0]) : r;
}
const okSess = r => !!r && r.ok === true && /^[A-Za-z0-9_-]{43}$/.test(r.session || '');
const sset = (s, mode, w) => anon('select * from public.booth_session_set($1, $2, $3)', [s, mode, w]);
const sget = s => anon('select * from public.booth_session_get($1)', [s]);
const stouch = s => anon('select * from public.booth_session_touch($1)', [s]);
const slogout = s => anon('select public.booth_session_logout($1) ok', [s]);
const liveOf = async code => (await q1('select congestion, wait_minutes from public.booth_live where booth_id = $1', [idOf(code)])) || null;
const liveTxt = async code => { const l = await liveOf(code); return l ? `${l.congestion}/${l.wait_minutes}` : '없음'; };
const sessRow = s => q1("select * from public.booth_session where token_hash = extensions.digest($1, 'sha256')", [s]);
const lastEv = () => q1('select * from public.booth_auth_event order by id desc limit 1');
const evMax = async () => +(await q1('select coalesce(max(id), 0) m from public.booth_auth_event')).m;
const evSince = async id => (await db.query('select * from public.booth_auth_event where id > $1 order by id', [id])).rows;
const sessN = async () => +(await q1('select count(*) n from public.booth_session')).n;
const target = async code => (await q1('select private.booth_common_pin_target($1) v', [idOf(code)])).v;
const targetN = async () => +(await q1('select count(*) n from unnest($1::uuid[]) x where private.booth_common_pin_target(x)', [REAL])).n;
const isRevoked = r => !r.ok && r.code === '42501' && r.hint === 'booth_session_revoked';

async function fp() {   // 바뀌면 안 되는 것들(시각 칸 updated_at 은 빼고 견줌)
  return q1(`select
    (select md5(coalesce(string_agg(booth_id::text || token || coalesce(disabled_at::text, '') || created_at::text || coalesce(rotated_at::text, ''), ',' order by booth_id), '')) from public.booth_access) qr,
    (select md5(coalesce(string_agg(booth_id::text || pin_hash || coalesce(disabled_at::text, ''), ',' order by booth_id), '')) from public.booth_pin) pin,
    (select md5(coalesce(string_agg(row(s.*)::text, ',' order by s.id), '')) from public.booth_session s) sess,
    (select concat(count(*), '/', coalesce(max(id), 0)) from public.booth_auth_event) ev,
    (select md5(string_agg((to_jsonb(b) - 'updated_at')::text, ',' order by b.id)) from public.booths b) booths,
    (select md5(string_agg((to_jsonb(z) - 'updated_at')::text, ',' order by z.key)) from public.zones z) zones,
    (select md5((to_jsonb(s) - 'updated_at')::text) from public.settings s where id = 1) settings,
    (select md5(coalesce(string_agg(row(l.*)::text, ',' order by l.booth_id), '')) from public.booth_live l) live,
    (select concat(count(*), '/', coalesce(max(id), 0)) from public.booth_live_log) log`);
}
async function exFp() {  // 예시 50곳: 부스 · 대기 값 · 개별 PIN · QR
  return (await q1(`select md5(concat(
    (select string_agg((to_jsonb(b) - 'updated_at')::text, ',' order by b.id) from public.booths b where b.id = any($1::uuid[])),
    (select coalesce(string_agg(row(l.*)::text, ',' order by l.booth_id), '') from public.booth_live l where l.booth_id = any($1::uuid[])),
    (select coalesce(string_agg(booth_id::text || pin_hash || coalesce(disabled_at::text, ''), ',' order by booth_id), '') from public.booth_pin where booth_id = any($1::uuid[])),
    (select coalesce(string_agg(booth_id::text || token || coalesce(disabled_at::text, ''), ',' order by booth_id), '') from public.booth_access where booth_id = any($1::uuid[])))) h`, [exIds])).h;
}
async function fnMap() {
  const rows = (await db.query(`select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' f,
      md5(replace(pg_get_functiondef(p.oid), E'\\r', '')) h from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prokind = 'f'`)).rows;
  return Object.fromEntries(rows.map(x => [x.f, x.h]));
}
const fnDiff = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => a[k] !== b[k]).sort();

// ══ 준비: 2026-10-19 Production 과 같은 단계 ════════════════════════════
section = '준비';
await db.exec(readFileSync(resolve(HERE, 'dryrun/replica-functions-extra.sql'), 'utf8'));
for (const f of [resolve(REPO, 'supabase/migration-booth-preview.sql'), resolve(OUT, 'gate3c/C-02-transition.sql'), resolve(OUT, 'gate3c/Q-02-qr-preissue.sql'),
  resolve(OUT, 'gate4r/T-02-assign.sql'), resolve(OUT, 'gate4r/T-03-publish.sql')]) {
  const r = await R.run(readFileSync(f, 'utf8')); if (!r.ok) throw new Error(f + ' ' + r.error);
}
await db.exec(readFileSync(join(PIN, 'supabase/migration-booth-rehearsal.sql'), 'utf8'));
// PIN 함수 — 저장소 migration 의 원문(앞 판 → 예시 공통 PIN 판 → 조건부 발급). pepper 와 client_ip 는 복제 대체 그대로.
const SKIP = new Set(['private.booth_pin_pepper', 'private.booth_client_ip', 'public.admin_booth_credentials', 'public.admin_booth_ip_probe']);
for (const f of ['migration-booth-pin.sql', 'migration-booth-example-pin.sql', 'migration-booth-pin-checked.sql']) {
  const lines = readFileSync(join(PIN, 'supabase', f), 'utf8').replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^create (?:or replace )?function (\S+?)\(/); if (!m) continue;
    let j = i; while (lines[j] !== '$$;') j++;
    if (!SKIP.has(m[1])) await db.exec(lines.slice(i, j + 1).join('\n').replace(/^create function/, 'create or replace function'));
    i = j;
  }
}
await db.exec(`update public.settings set booth_sample_common_pin_enabled = false where id = 1;
  update public.zones set is_published = false where key !~ '^R';
  update public.booths set is_published = false where org ~ '^\\s*\\[예시\\]';`);
// 2026-10-19 Production 읽기 전용 조회의 함수 지문(줄 끝 CR 을 뺀 pg_get_functiondef 의 md5 앞 8자)
const PROD = {
  'private.booth_client_ip': '8788b6d7', 'private.booth_common_pin_ok': '57684373', 'private.booth_common_pin_target': '8a6c426d',
  'private.booth_op_row': 'bfc7b53a', 'private.booth_op_set': '24538d6a', 'private.booth_op_touch': '27409ebc', 'private.booth_pin_digest': '7d9cfa8b',
  'private.booth_pin_generate': '81edb33b', 'private.booth_pin_no': '36e7a468', 'private.booth_pin_retry_after': 'fdd9fcab', 'private.booth_pin_weak': '797f3b63',
  'private.booth_session_resolve': '587f4d79', 'private.booth_session_token': '4bfbd9f5', 'private.booth_tag': '2dfe1354',
  'private.rehearsal_booth_ids': 'd2a7d83a', 'private.rehearsal_closed': '746d61dd', 'private.rehearsal_cutoff': 'b99ce482', 'private.rehearsal_live_reset': '007166b2',
  'public.admin_disable_booth_pin': '72c0bad7', 'public.admin_issue_booth_pin': 'ff87c440', 'public.admin_issue_booth_pin_checked': 'ba79b2cc',
  'public.admin_rehearsal_set_live': '7dc47be2', 'public.admin_rehearsal_status': 'efd7cde6', 'public.booth_pin_login': 'd78e25b9',
  'public.booth_session_get': '74403f9e', 'public.booth_session_logout': 'e158b952', 'public.booth_session_set': 'c752b9b1', 'public.booth_session_touch': '757f1b65',
  'public.admin_booth_access': '1ef3298c', 'public.admin_booth_credentials': '1ffa74d5', 'public.admin_reset_booth_live': '5f6ed44f',
  'public.admin_set_booth_live': '2a914a14', 'public.booth_ctrl_get': '10355a74', 'public.booth_ctrl_set': '4420bf06', 'public.booth_ctrl_touch': '37276258',
  'public.is_admin': '651002b9'
};
const fn0 = await fnMap();
const byName = Object.fromEntries(Object.entries(fn0).map(([k, v]) => [k.replace(/\(.*$/, ''), v.slice(0, 8)]));
const fnMiss = Object.entries(PROD).filter(([k, v]) => byName[k] !== v).map(([k, v]) => `${k} 복제 ${byName[k] || '-'} · Production ${v}`);
const AUTH_FNS = ['private.booth_common_pin_ok', 'private.booth_common_pin_target', 'private.booth_session_resolve', 'public.booth_pin_login', 'public.booth_session_set',
  'public.booth_session_get', 'public.booth_session_touch', 'public.booth_session_logout', 'private.booth_pin_retry_after', 'public.admin_issue_booth_pin',
  'public.admin_issue_booth_pin_checked', 'public.admin_disable_booth_pin', 'private.rehearsal_booth_ids', 'private.rehearsal_cutoff'];
t('A0 복제 DB = Production 단계: 인증 · 발급 · 리허설 함수 지문 Production 과 같음(로그인 · 세션 · 공통 PIN · 발급 · 횟수 제한 · 리허설 목록 포함)',
  AUTH_FNS.every(k => byName[k] === PROD[k]), fnMiss.join(' | '));
const otherMiss = fnMiss.filter(x => !AUTH_FNS.some(k => x.startsWith(k + ' ')));
t(`A0-1 그 밖의 비교 함수(QR · 관리자) — Production 과 다른 것 ${otherMiss.length}개${otherMiss.length ? ': ' + otherMiss.map(x => x.split(' ')[0]).join(', ') : ''}`, true);
const st0 = await q1(`select (select count(*) from public.booths) b, (select count(*) from public.booths where is_published) bp,
  (select string_agg(key, ',' order by key) from public.zones where is_published) zp, (select count(*) from public.booth_pin) pn, (select count(*) from public.booth_session) sn,
  (select booth_pin_enabled::text || '/' || booth_sample_common_pin_enabled::text from public.settings where id = 1) sw`);
t('A0-2 상태 = Production(부스 134 · 공개 84 · 공개 구역 R1~R4 · 개별 PIN 2(예시) · 세션 0 · PIN 로그인 켜짐 · 예시 공통 PIN 꺼짐)',
  +st0.b === 134 && +st0.bp === 84 && st0.zp === 'R1,R2,R3,R4' && +st0.pn === 2 && +st0.sn === 0 && st0.sw === 'true/false', JSON.stringify(st0));

// 관리자 화면(booth-admin · 작업 브랜치 = main 과 같은 파일)으로 84곳 리허설 값 채우기 — 지금 Production 과 같게
const inline = (html, dir, files) => {
  for (const p of files) {
    if (!existsSync(join(dir, p))) continue;   // 그 판에 없는 파일(예: assets/pin-status.js 이전 판)은 건너뜀
    const src = readFileSync(join(dir, p), 'utf8').replace(/<\/script/gi, '<\\/script');
    html = html.replace(new RegExp(`<script src="${p.replace(/[.]/g, '\\.')}"></script>`), () => `<script>${src}</script>`);
  }
  return html.replace(/<link[^>]+stylesheet[^>]*>/g, '');
};
const DATE_KEYS = new Set(['cutoff', 'kst_today']);
const asJson = rows => JSON.parse(JSON.stringify(rows), (k, v) => (DATE_KEYS.has(k) && typeof v === 'string' ? v.slice(0, 10) : v));
function adminClient(hooks = {}) {
  const log = [], calls = [];
  const base = fakeSupabase(R, log).createClient();
  const client = Object.assign({}, base, {
    from: table => { const b = base.from(table); const th = b.then; b.then = (ok, bad) => th.call(b, res => { if (res && res.data) res.data = asJson(res.data); return res; }).then(ok, bad); return b; },
    rpc: async (name, args) => {
      calls.push({ name, id: args && args.p_booth_id });
      if (hooks.before) { const h = await hooks.before(name, args); if (h) return h; }
      const res = await base.rpc(name, args);
      if (res.data) res.data = asJson(res.data);
      return res;
    }
  });
  return { client, log, calls };
}
const quiet = () => { const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); return vc; };
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function openAdmin() {
  const { client, calls } = adminClient();
  const html = readFileSync(join(PIN, 'booth-admin.html'), 'utf8').replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>/g, '');
  const dom = new JSDOM(inline(html, PIN, ['assets/config.js', 'assets/core.js', 'assets/ui.js', 'assets/booth-core.js', 'assets/mock-data.js', 'assets/admin-demo.js', 'assets/pin-status.js', 'assets/booth-admin.js']), {
    url: 'https://sinjhon1245-cell.github.io/incheon-festival/booth-admin.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: quiet(),
    beforeParse(w) {
      w.supabase = { createClient: () => client };
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.scrollTo = () => {}; w.console.warn = () => {};
    }
  });
  const errors = []; dom.window.addEventListener('error', e => errors.push(e.message));
  const d = dom.window.document;
  await until(() => d.querySelectorAll('#lv-list .lv').length > 0, 20000);
  click(dom.window, d.querySelector('[data-rh-toggle]'));
  await until(() => !d.getElementById('lv-rh').hidden && !/확인하는 중/.test(text(d.getElementById('lv-rh'))));
  await wait(50);
  return { dom, d, w: dom.window, calls, errors };
}
const rhPanel = p => text(p.d.getElementById('lv-rh'));
async function rhRun(p, kind) {
  click(p.w, p.d.querySelector(`[data-rh="${kind}"]`));
  await until(() => !!p.d.getElementById('modal-ok'));
  click(p.w, p.d.getElementById('modal-ok'));
  await until(() => /채웠습니다|비웠습니다|실패 \d+곳|닫혔습니다/.test(rhPanel(p)) && !p.d.querySelector('.rhprog'), 60000);
  await wait(80);
  return rhPanel(p);
}
const liveN = async ids => +(await q1('select count(*) n from public.booth_live where booth_id = any($1::uuid[])', [ids])).n;
let ap = await openAdmin();
await rhRun(ap, 'fill');
ap.dom.window.close();
t('A0-3 관리자 화면 [리허설 관리] → 대기시간 자동 채우기: 84곳 값 있음(지금 Production 과 같은 상태)', (await liveN(REAL)) === 84 && !ap.errors.length, ap.errors.join(' | '));
const F0 = await fp(), EX0 = await exFp();
// 개별 PIN 전환 확인 SQL(읽기 전용 · DB 브랜치 supabase/check-booth-pin-conversion.sql) — 순서 → { 기대, 실제 }
const CHECK = readFileSync(join(PIN, 'supabase/check-booth-pin-conversion.sql'), 'utf8');
async function runCheck() { const r = await db.query(CHECK); return Object.fromEntries(r.rows.map(x => [+x['순서'], { e: x['기대'], a: x['실제'] }])); }
const CK0 = await runCheck();
const QR9 = CK0[9].a;   // 복제 DB 의 QR 열쇠 지문(같은 식) — Production 기준값 대신 이것과 견줌
t('A0-4 전환 확인 SQL(읽기 전용) — 전환 전: 실제 84 · 목록 지문 965ec1ec · 발급 0 · 남은 84 · QR 84 · 꺼짐 0 · 바꾼 열쇠 0',
  CK0[1].a === CK0[1].e && CK0[2].a === '0' && CK0[3].a === '84' && CK0[5].a.split(' ').length === 84 && CK0[10].a === '84 · 0' && CK0[11].a === '0',
  JSON.stringify(CK0));

// ══ A. migration ═════════════════════════════════════════════════════
section = 'A migration';
const MIG = readFileSync(join(PIN, 'supabase/migration-booth-rehearsal-pin.sql'), 'utf8');
const RB = readFileSync(join(PIN, 'supabase/rollback-booth-rehearsal-pin.sql'), 'utf8');
let r = await runAll(MIG);
t('A1 적용: 확인 표 8줄 모두 기대 = 실제(끝나는 때 11-05 23:00 · 인증 함수 그대로 · 84곳 밖 0 · 대상 84 · 예시 판정 그대로 · 권한)',
  r.ok && r.rows.length === 8 && allOk(r.rows), r.ok ? tableTxt(r.rows) : r.error);
const MIG_ROWS = r.ok ? r.rows : [];
const fn1 = await fnMap();
const changed = fnDiff(fn0, fn1);
t('A2 바뀐 함수 = 대상 판정 하나(booth_common_pin_target) + 새 private 함수 둘 — 로그인 · 세션 확인 · 공통 PIN 비교 · 발급 함수는 그대로',
  changed.join() === 'private.booth_common_pin_target(p_booth uuid),private.rehearsal_common_pin_open(p_booth uuid),private.rehearsal_common_pin_until()', changed.join(' , '));
const F1 = await fp();
t('A3 데이터 그대로: QR · 개별 PIN · 세션 · 보안 기록 · 부스 · 구역 · 설정 · 대기 값 · 대기 기록', JSON.stringify(F0) === JSON.stringify(F1), JSON.stringify([F0, F1]));
r = await runAll(MIG);
t('A4 다시 실행: 같은 확인 표 · 함수 그대로 · 데이터 그대로', r.ok && allOk(r.rows) && fnDiff(fn1, await fnMap()).length === 0 && JSON.stringify(await fp()) === JSON.stringify(F1), r.error || '');
async function migIn(change) {   // 한 트랜잭션 안에서 DB 를 바꾼 뒤 migration 을 돌려 보고 모두 되돌림
  return db.transaction(async tx => { await tx.exec(change); let out = 'applied'; try { await tx.exec(MIG); } catch (e) { out = e.message; } await tx.rollback(); return out; });
}
const pf1 = await migIn(`create or replace function private.booth_common_pin_target(p_booth uuid) returns boolean language sql stable set search_path = '' as $$ select false $$;`);
const pf2 = await migIn(`create or replace function private.booth_common_pin_ok(p_booth uuid, p_pin text) returns boolean language sql stable set search_path = '' as $$ select false $$;`);
const pf3 = await migIn('drop function private.rehearsal_cutoff();');
t('A5 멈춤 조건: 대상 판정이 모르는 판 · 공통 PIN 비교가 다른 판 · 리허설 함수 없음 → 아무것도 바꾸지 않고 멈춤 · 그 뒤 DB 그대로',
  /booth_common_pin_target 이 예상한 판이 아닙니다/.test(pf1) && /예상한 판이 아닙니다/.test(pf2) && /선행 조건 누락: migration-booth-rehearsal\.sql/.test(pf3) &&
  fnDiff(fn1, await fnMap()).length === 0 && JSON.stringify(await fp()) === JSON.stringify(F1), [pf1, pf2, pf3].join(' | '));
// 줄 끝은 저장소에 들어간 파일(git) 기준 — Windows 작업 폴더는 core.autocrlf 로 CRLF 로 풀려 있을 수 있음. git 이 없으면 작업 폴더 파일.
const committed = p => { try { return execFileSync('git', ['-C', PIN, 'show', 'HEAD:' + p], { encoding: 'utf8', maxBuffer: 1 << 26 }); } catch { return null; } };
const MIG_C = committed('supabase/migration-booth-rehearsal-pin.sql') ?? MIG, RB_C = committed('supabase/rollback-booth-rehearsal-pin.sql') ?? RB;
t('A6 SQL 파일 두 개에 공통 PIN 값 · BEGIN/COMMIT 없음 · 줄 끝 LF(저장소 파일) · 작업 폴더 파일과 줄 끝 말고 같음',
  !MIG.includes(COMMON) && !RB.includes(COMMON) && !/^\s*(begin|commit)\s*;/im.test(MIG + RB) && !/\r/.test(MIG_C + RB_C) &&
  MIG.replace(/\r/g, '') === MIG_C && RB.replace(/\r/g, '') === RB_C);

// ══ B. 리허설 기간(지금 시각 = 2026-10-19) ═══════════════════════════════
section = 'B 리허설 기간';
let e0 = await evMax();
const s1 = await login('R1-01', COMMON);
const row1 = okSess(s1) ? await sessRow(s1.session) : null;
const ev1 = await lastEv();
t('T1 실제 부스 R1-01 공통 PIN 로그인 성공 — 세션은 그 부스 하나 · 공통 PIN 세션 표시 · 보안 기록 pin_ok(detail common_pin) · 오늘 24:00 만료',
  okSess(s1) && s1.booth_id === idOf('R1-01') && s1.code === 'R1-01' && row1 && row1.via_common_pin === true && row1.booth_id === idOf('R1-01') && !row1.revoked_at &&
  ev1.event === 'pin_ok' && ev1.detail === 'common_pin' && ev1.booth_id === idOf('R1-01') && /^[0-9a-f]{16}$/.test(ev1.device_tag) &&
  new Date(s1.expires_at).getTime() <= (() => { const k = new Date(Date.now() + 9 * 3600e3); return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + 1) - 9 * 3600e3; })(),
  JSON.stringify({ ok: s1.ok, reason: s1.reason, code: s1.code, via: row1 && row1.via_common_pin, ev: ev1 && [ev1.event, ev1.detail] }));
e0 = await evMax();
const sn0 = await sessN();
const dA = dev(), dB = dev();
const wrong = [await login('R1-02', '654321', dA), await login('R1-02', '000000', dA), await login('R1-02', '12345', dA),
  await login('R1-04', '1234567', dB), await login('R1-04', 'abcdef', dB), await login('R1-04', '', dB), await login('R1-04', null, dev()),
  await login('A-02', COMMON), await login('00000000-0000-4000-8000-000000000999', COMMON), await login(null, COMMON)];
const fails = (await evSince(e0)).filter(x => x.event === 'pin_fail');
t('T2 틀린 PIN 거절 — 다른 6자리 · 5 · 7자리 · 글자 · 빈 값 · null, 예시 부스(스위치 꺼짐) · 없는 부스 · 부스 없음에 공통 PIN → 모두 invalid · 세션 0 · pin_fail 10건',
  wrong.every(x => x.ok === false && x.reason === 'invalid' && !x.session) && (await sessN()) === sn0 && fails.length === 10,
  JSON.stringify(wrong.map(x => [x.ok, x.reason])) + ` fails ${fails.length}`);
const others0 = (await q1('select md5(string_agg(row(l.*)::text, \',\' order by l.booth_id)) h from public.booth_live l where l.booth_id <> $1', [idOf('R1-01')])).h;
const lg0 = +(await q1('select max(id) m from public.booth_live_log')).m;
const a1 = await sset(s1.session, 'open', 15);
const l1 = await q1('select booth_id::text b, source, wait_minutes, session_id from public.booth_live_log where id > $1 order by id desc limit 1', [lg0]);
const a2 = await sset(s1.session, 'pause', null); const v2 = await liveTxt('R1-01');
const a3 = await sset(s1.session, 'closed', null); const v3 = await liveTxt('R1-01');
const a4 = await sset(s1.session, 'open', 5); const v4 = await liveTxt('R1-01');
const a5 = await stouch(s1.session);
const l5 = await q1('select source, session_id from public.booth_live_log order by id desc limit 1');
const g1 = await sget(s1.session);
const others1 = (await q1('select md5(string_agg(row(l.*)::text, \',\' order by l.booth_id)) h from public.booth_live l where l.booth_id <> $1', [idOf('R1-01')])).h;
t('T3 공통 PIN 세션으로 수정 — 15분(보통) · 중단 · 마감 · 5분(여유) · 변동 없음 · 다시 읽기 모두 됨 · 기록 source set/touch + 세션 · 다른 83곳 · 예시 값 그대로',
  a1.ok && a1.rows[0].wait_minutes === 15 && a1.rows[0].congestion === '보통' && l1.b === idOf('R1-01') && l1.source === 'set' && l1.session_id === row1.id &&
  a2.ok && v2 === '중단/0' && a3.ok && v3 === '마감/0' && a4.ok && v4 === '여유/5' && a5.ok && l5.source === 'touch' && l5.session_id === row1.id &&
  g1.ok && g1.rows[0].code === 'R1-01' && others0 === others1,
  JSON.stringify([a1.ok, a2.ok, a3.ok, a4.ok, a5.ok, g1.ok, v2, v3, v4, others0 === others1, a1.message, l1]));
// 비우기 · 다시 입력 · 23시 초기화
ap = await openAdmin();
const clr = await rhRun(ap, 'clear');
const afterClear = await liveN(REAL);
const g2 = await sget(s1.session);
const b1 = await sset(s1.session, 'open', 20);
const v5 = await liveTxt('R1-01');
const sessBefore = (await fp()).sess;
await db.exec('select private.rehearsal_live_reset()');
const afterReset = await liveN(REAL);
const sessAfter = (await fp()).sess;
const b2 = await sset(s1.session, 'open', 25);
const v6 = await liveTxt('R1-01');
await rhRun(ap, 'fill');
const afterRefill = await liveN(REAL);
const b3 = await sset(s1.session, 'open', 30);
const v7 = await liveTxt('R1-01');
ap.dom.window.close();
t('T4 비우기 뒤 다시 입력 — 관리자 [리허설 대기시간 비우기] 84 → 0 · 세션 그대로 · 공통 PIN 화면에서 다시 20분 저장',
  /비웠습니다/.test(clr) && afterClear === 0 && g2.ok && b1.ok && v5 === '보통/20' && !ap.errors.length, `${afterClear} ${g2.ok} ${b1.ok} ${v5} ${clr.slice(0, 120)}`);
t('T4-1 23시 초기화(private.rehearsal_live_reset)는 값만 지움 — 세션 줄 그대로(끊지 않음) · 다시 25분 저장 · 다시 채우기 84 · 운영자 30분이 덮어씀',
  afterReset === 0 && sessBefore === sessAfter && b2.ok && v6 === '보통/25' && afterRefill === 84 && b3.ok && v7 === '혼잡/30',
  `${afterReset} ${sessBefore === sessAfter} ${b2.ok} ${v6} ${afterRefill} ${v7}`);
// 횟수 제한 · 세션 규칙은 공통 PIN 에도 그대로
const dL = dev();
for (const pnum of ['111111', '222222', '333333', '444444', '555555']) await login('R2-05', pnum, dL);
e0 = await evMax();
const lim = await login('R2-05', COMMON, dL);
const limEv = await evSince(e0);
const other = await login('R2-05', COMMON);
t('B1 횟수 제한을 건너뛰지 않음 — 같은 기기 틀린 PIN 5번 뒤 공통 PIN 도 limited(세션 없음 · pin_limited 기록) · 다른 기기는 됨',
  lim.ok === false && lim.reason === 'limited' && lim.retry_after > 0 && !lim.session && limEv.some(x => x.event === 'pin_limited') && okSess(other),
  JSON.stringify([lim.ok, lim.reason, lim.retry_after, limEv.map(x => x.event), other.ok]));
for (let i = 0; i < 11; i++) await login('R2-06', COMMON);
const cap = await q1(`select count(*) filter (where revoked_at is null) act, count(*) filter (where revoke_reason = 'session_cap') cut from public.booth_session where booth_id = $1`, [idOf('R2-06')]);
const dS = dev();
const same1 = await login('R2-07', COMMON, dS), same2 = await login('R2-07', COMMON, dS);
const sameRow = await sessRow(same1.session);
t('B2 세션 규칙 그대로 — 부스당 10개(11번째에 가장 오래된 것 session_cap) · 같은 기기 다시 로그인하면 앞 세션 same_device',
  +cap.act === 10 && +cap.cut === 1 && okSess(same2) && sameRow.revoke_reason === 'same_device', JSON.stringify([cap, sameRow && sameRow.revoke_reason]));
// 범위: 84곳 밖 실제 부스 · 비공개
await db.exec(`insert into public.booths (id, zone_key, no, name, org, org_type, is_published, sort_order)
  values ('00000000-0000-4000-8000-0000000000aa', 'R1', 99, '시험 부스', '시험 기관', '기타', true, 999)`);
const outside = await login('00000000-0000-4000-8000-0000000000aa', COMMON);
await db.exec(`delete from public.booths where id = '00000000-0000-4000-8000-0000000000aa'`);
const s7 = await login('R1-07', COMMON);
await db.query('update public.booths set is_published = false where id = $1', [idOf('R1-07')]);
const u1 = await sset(s7.session, 'open', 10), u2 = await login('R1-07', COMMON);
await db.query('update public.booths set is_published = true where id = $1', [idOf('R1-07')]);
t('B3 범위 — 84곳 목록 밖 실제 부스(공개 · 구역 · 번호 있음)는 공통 PIN 거절 · 비공개가 된 부스는 열린 화면 저장 거절(unavailable) · 새 로그인 거절',
  outside.ok === false && outside.reason === 'invalid' && okSess(s7) && !u1.ok && u1.hint === 'booth_session_unavailable' && u2.ok === false,
  JSON.stringify([outside.reason, u1.hint, u2.reason]));
await db.exec('update public.settings set booth_pin_enabled = false where id = 1');
const off1 = await login('R1-08', COMMON), off2 = await sget(s1.session);
await db.exec('update public.settings set booth_pin_enabled = true where id = 1');
const off3 = await sget(s1.session);
t('B4 PIN 로그인 전체 스위치(기존) — 끄면 공통 PIN 로그인 off · 열린 화면 거절(booth_pin_off) · 켜면 다시 됨', off1.reason === 'off' && !off2.ok && off2.hint === 'booth_pin_off' && off3.ok,
  JSON.stringify([off1.reason, off2.hint, off3.ok]));
const d1 = await anon('select private.rehearsal_common_pin_open($1) v', [idOf('R1-01')]);
const d2 = await anon('select private.booth_common_pin_target($1) v', [idOf('R1-01')]);
const d3 = await anon('select private.rehearsal_common_pin_until() v');
const d4 = await rest('rpc/rehearsal_common_pin_open');
t('B5 익명(anon)은 새 함수 · 대상 판정을 직접 부를 수 없음(42501) · 공개 API 에 없음(404)', !d1.ok && !d2.ok && !d3.ok && d1.code === '42501' && d4.status === 404,
  JSON.stringify([d1.code, d2.code, d3.code, d4.status]));
// 동시 발급: 발급 트랜잭션이 세션을 끊은 '뒤에' 공통 PIN 세션이 생긴 경우를 흉내 — 세션을 끊지 않고 PIN · 발급 기록만 남김
const s10 = await login('R2-10', COMMON);
await db.query(`insert into public.booth_pin (booth_id, pin_hash) values ($1, extensions.crypt(private.booth_pin_digest('975318'), extensions.gen_salt('bf', 10)))`, [idOf('R2-10')]);
await db.query(`insert into public.booth_auth_event (event, booth_id, actor) values ('pin_issued', $1, $2)`, [idOf('R2-10'), ADMIN]);
const race1 = await sset(s10.session, 'open', 10), race2 = await login('R2-10', COMMON), race3 = await login('R2-10', '975318');
t('B6 동시 발급(끊기 뒤에 생긴 공통 PIN 세션) — 다음 저장에서 서버가 거절(booth_session_revoked · “운영 준비용 공통 PIN을 더 이상 쓸 수 없습니다.”) · 공통 PIN 로그인 거절 · 개별 PIN 은 됨',
  okSess(s10) && isRevoked(race1) && /운영 준비용 공통 PIN을 더 이상 쓸 수 없습니다/.test(race1.message) && race2.ok === false && okSess(race3) && (await sessRow(race3.session)).via_common_pin === false,
  JSON.stringify([race1.hint, race1.message, race2.reason, race3.ok]));
// 예시 부스 공통 PIN(기존 기능)은 그대로
await db.exec("update public.zones set is_published = true where key = 'A'");
await db.query('update public.booths set is_published = true where id = $1', [idOf('A-02')]);
const ex1 = await login('A-02', COMMON);
await db.exec('update public.settings set booth_sample_common_pin_enabled = true where id = 1');
const ex2 = await login('A-02', COMMON), ex2r = okSess(ex2) ? await sessRow(ex2.session) : null, ex2e = await lastEv();
const ex3 = await login('R1-09', COMMON);
await db.exec('update public.settings set booth_sample_common_pin_enabled = false where id = 1');
const ex4 = await sset(ex2.session, 'open', 10), ex5 = await login('A-02', COMMON), ex6 = await login('R1-09', COMMON);
await db.query('update public.booths set is_published = false where id = $1', [idOf('A-02')]);
await db.exec("update public.zones set is_published = false where key = 'A'");
t('T12-1 예시 부스 공통 PIN 그대로 — 스위치 꺼짐: 거절 · 켜짐: 로그인(common_pin) · 다시 끄면 열린 예시 화면 거절 · 실제 부스는 스위치와 상관없이 리허설 규칙',
  ex1.ok === false && okSess(ex2) && ex2r.via_common_pin === true && ex2e.detail === 'common_pin' && okSess(ex3) && isRevoked(ex4) && ex5.ok === false && okSess(ex6),
  JSON.stringify([ex1.reason, ex2.ok, ex3.ok, ex4.hint, ex5.reason, ex6.ok]));
// 공개 출력: 관람객 스냅샷
globalThis.fetch = async (url) => {
  const u = String(url), i = u.indexOf('/rest/v1/');
  if (i < 0) throw new Error('예상 밖 요청: ' + u);
  const rr = await rest(u.slice(i + 9));
  return new Response(JSON.stringify(rr.body), { status: rr.status, headers: { 'content-type': 'application/json' } });
};
let modN = 0;
async function snapshotNow() {
  const mod = await import(pathToFileURL(join(LIVE, 'live/api/live-snapshot.mjs')).href + '?pin=' + (++modN));
  const res = await mod.default.fetch(new Request('https://incheon-live.vercel.app/api/live-snapshot'));
  return { status: res.status, body: await res.text() };
}
const allSessions = [s1, s7, s10, same2, ex2, ex3, ex6, race3, other].filter(okSess).map(x => x.session);
let sn = await snapshotNow();
let J = JSON.parse(sn.body);
t('B7 관람객 공개 API — 운영자 30분이 보임(R1-01 혼잡 30) · 84곳 · PIN 값 · 세션 · 공통 PIN 표시 없음 · 부스 칸 10개',
  sn.status === 200 && J.booths.length === 84 && J.booths.find(b => b.code === 'R1-01').waitMinutes === 30 && !sn.body.includes(COMMON) &&
  !allSessions.some(s => sn.body.includes(s)) && !/via_common|common_pin|session/i.test(sn.body) && J.booths.every(b => Object.keys(b).length === 10),
  sn.body.slice(0, 200));

// ══ C. 운영자 화면(booth-ctrl · 배포본) ══════════════════════════════════
section = 'C 운영자 화면';
async function anonFetch(u, init = {}) {
  const sx = String(u), i = sx.indexOf('/rest/v1/');
  if (i < 0) throw new Error('예상 밖 요청');
  const path = sx.slice(i + 9), method = String(init.method || 'GET').toUpperCase();
  let status = 200, body;
  if (method === 'GET') { const rr = await rest(path); status = rr.status; body = rr.body; }
  else if (path.startsWith('rpc/')) {
    const name = path.slice(4).split('?')[0];
    const args = init.body ? JSON.parse(init.body) : {};
    const keys = Object.keys(args);
    try { body = await R.asAnon(`select * from public.${name}(${keys.map((k, j) => `${k} => $${j + 1}`).join(', ')})`, keys.map(k => args[k])); }
    catch (e) { status = e.code === '42501' ? 401 : 400; body = { code: e.code, message: e.message, hint: e.hint || null, details: null }; }
  } else { status = 405; body = {}; }
  const out = JSON.stringify(body);
  return { ok: status < 400, status, text: async () => out, json: async () => JSON.parse(out), headers: { get: () => 'application/json' } };
}
const CTRL_HTML = inline(readFileSync(join(LIVE, 'booth-ctrl.html'), 'utf8'), LIVE, ['assets/config.js', 'assets/booth-core.js', 'assets/mock-data.js']);
function openCtrl(seed) {
  const dom = new JSDOM(CTRL_HTML, {
    url: 'https://incheon-live.vercel.app/booth-ctrl.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: quiet(),
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.scrollTo = () => {}; w.fetch = anonFetch; w.console.warn = () => {};
      if (seed) for (const [k, v] of Object.entries(seed)) w.localStorage.setItem(k, v);
    }
  });
  const errors = []; dom.window.addEventListener('error', e => errors.push(e.message));
  return { dom, d: dom.window.document, w: dom.window, errors };
}
const KEY_PIN = 'aisw-boothctrl-pin', KEY_DEVICE = 'aisw-boothctrl-device';
async function ctrlPinLogin(code, pin) {   // 구역 → 부스 → PIN → 운영 시작(맞으면 이 기기에 세션만 남음)
  const c = openCtrl();
  await until(() => !!c.d.querySelector('[data-act="pin-start"]'), 8000);
  await wait(150);
  click(c.w, c.d.querySelector('[data-act="pin-start"]'));
  await until(() => c.d.querySelectorAll('#pin-zones [data-zone]').length > 0, 8000);
  const zones = [...c.d.querySelectorAll('#pin-zones [data-zone]')].map(x => x.getAttribute('data-zone'));
  click(c.w, c.d.querySelector(`#pin-zones [data-zone="${code.slice(0, 2)}"]`));
  await until(() => !!c.d.querySelector(`#pin-booths [data-booth="${idOf(code)}"]`), 8000);
  const booths = c.d.querySelectorAll('#pin-booths [data-booth]').length;
  click(c.w, c.d.querySelector(`#pin-booths [data-booth="${idOf(code)}"]`));
  await until(() => !c.d.getElementById('pin-s3').hidden, 8000);
  const screen = { label: text(c.d.getElementById('pin-input-label')), hint: text(c.d.getElementById('pin-input-hint')), head: text(c.d.getElementById('pin-code')), all: (() => { const b = c.d.body.cloneNode(true); b.querySelectorAll('script').forEach(x => x.remove()); return text(b); })() };
  const input = c.d.getElementById('pin-input');
  input.value = pin;
  input.dispatchEvent(new c.w.Event('input', { bubbles: true }));
  await until(() => !c.d.getElementById('pin-go').disabled, 4000);
  c.d.getElementById('pin-s3').dispatchEvent(new c.w.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => !!c.w.localStorage.getItem(KEY_PIN) || !c.d.getElementById('pin-err').hidden, 15000);
  const stored = c.w.localStorage.getItem(KEY_PIN);
  const ls = Object.keys(c.w.localStorage).map(k => c.w.localStorage.getItem(k)).join('|');
  const out = { zones, booths, screen, stored, device: c.w.localStorage.getItem(KEY_DEVICE), err: c.d.getElementById('pin-err').hidden ? '' : text(c.d.getElementById('pin-err')), pinInStorage: ls.includes(pin), errors: c.errors };
  c.dom.window.close();
  return out;
}
async function ctrlOpenSession(L) {   // 같은 기기(저장된 세션)로 운영 화면 열기
  const c = openCtrl({ [KEY_PIN]: L.stored, [KEY_DEVICE]: L.device });
  await until(() => !c.d.getElementById('v-main').hidden || !c.d.getElementById('v-confirm').hidden || !c.d.getElementById('v-msg').hidden, 10000);
  if (!c.d.getElementById('v-confirm').hidden) { click(c.w, c.d.getElementById('cf-yes')); await until(() => !c.d.getElementById('v-main').hidden, 8000); }
  await wait(150);
  return c;
}
async function ctrlPress(c, minutes) {
  c.d.getElementById('toast').textContent = '';
  click(c.w, c.d.querySelector(`.w[data-wait="${minutes}"]`));
  await until(() => /반영했습니다/.test(text(c.d.getElementById('toast'))) || !c.d.getElementById('v-msg').hidden, 10000);
  await wait(100);
  return { toast: text(c.d.getElementById('toast')), msg: c.d.getElementById('v-msg').hidden ? '' : text(c.d.getElementById('v-msg')) };
}
const L3 = await ctrlPinLogin('R1-03', COMMON);
const L3s = L3.stored ? JSON.parse(L3.stored) : null;
t('C1 운영자 화면: 구역(공개 R1~R4) → 부스 R1-03 → PIN 칸에 공통 PIN 안내 없음(“운영자 PIN 6자리 · 운영본부에서 받은 숫자 6자리…”)',
  L3.zones.join() === 'R1,R2,R3,R4' && L3.booths === 21 && L3.screen.label === '운영자 PIN 6자리' && L3.screen.hint === '운영본부에서 받은 숫자 6자리를 입력해 주세요.' &&
  !L3.screen.all.includes(COMMON), JSON.stringify(Object.assign({}, L3.screen, { all: undefined, zones: L3.zones, booths: L3.booths })));
t('C2 공통 PIN 입력 → 운영 시작: 이 기기에는 세션만 저장(PIN 원문 없음) · 세션 부스 = R1-03', !!L3s && L3s.booth_id === idOf('R1-03') && /^[A-Za-z0-9_-]{43}$/.test(L3s.session) && !L3.pinInStorage && !L3.err,
  L3.err || JSON.stringify(L3.errors));
const c3 = await ctrlOpenSession(L3);
const p15 = await ctrlPress(c3, 15);
const c3row = await sessRow(L3s.session);
const c3log = await q1('select source, session_id from public.booth_live_log where booth_id = $1 order by id desc limit 1', [idOf('R1-03')]);
t('C3 운영 화면에서 15분 → “반영했습니다” · R1-03 보통/15 · 기록의 세션 = 그 공통 PIN 세션',
  /반영했습니다/.test(p15.toast) && (await liveTxt('R1-03')) === '보통/15' && c3row.via_common_pin === true && c3log.session_id === c3row.id && !c3.errors.length,
  JSON.stringify([p15, await liveTxt('R1-03'), c3.errors]));
c3.dom.window.close();

// ══ D. 끝나는 때(시험 시계) ════════════════════════════════════════════
section = 'D 끝나는 때';
const openBlock = (() => { const m = MIG.replace(/\r/g, '').match(/create or replace function private\.rehearsal_common_pin_open[\s\S]*?\n\$\$;/); return m && m[0]; })();
const nowHits = (openBlock.match(/pg_catalog\.now\(\)/g) || []).length;
const clockBlock = openBlock.replace('pg_catalog.now()', 'private.test_now()');
await db.exec(`create function private.test_now() returns timestamptz language sql stable set search_path = '' as $$
  select coalesce(nullif(pg_catalog.current_setting('test.now', true), '')::timestamptz, pg_catalog.now()) $$;`);
await db.exec(clockBlock);
const setNow = iso => db.exec(iso ? `set test.now = '${iso}'` : 'reset test.now');
t('D0 시험 시계: 리허설 갈래 함수의 pg_catalog.now() 한 곳만 시험 시계로 바꿈(나머지 글자 · 대상 판정 · 로그인 · 세션 확인은 그대로)', nowHits === 1 && clockBlock !== openBlock);
await setNow('2026-11-05 22:59:00+09');
const s59 = await login('R2-01', COMMON);
const s59set = await sset(s59.session, 'open', 10);
await setNow('2026-11-05 22:59:59.999+09');
const s59b = await login('R2-02', COMMON);
const L4 = await ctrlPinLogin('R2-04', COMMON);   // 22:59:59.999 에 운영자 화면으로 로그인
const c4 = await ctrlOpenSession(L4);
const p4 = await ctrlPress(c4, 15);
t('T5 11-05 22:59 · 22:59:59.999 — 공통 PIN 로그인 · 저장 됨(R2-01 10분 · R2-02 로그인 · 운영자 화면 R2-04 15분)',
  okSess(s59) && s59set.ok && (await liveTxt('R2-01')) === '여유/10' && okSess(s59b) && !!L4.stored && /반영했습니다/.test(p4.toast),
  JSON.stringify([s59.ok, s59set.ok, s59b.ok, !!L4.stored, p4]));
await setNow('2026-11-05 23:00:00+09');
e0 = await evMax();
const sn23 = await sessN();
const n1 = await login('R2-01', COMMON), n2 = await login('R2-03', COMMON);
const n23ev = await evSince(e0);
t('T6 11-05 23:00 부터 새 로그인 거절 — 맞지 않는 PIN 과 같은 답(invalid) · 세션 생기지 않음 · pin_fail 기록(횟수 제한에 셈)',
  n1.ok === false && n1.reason === 'invalid' && n2.ok === false && (await sessN()) === sn23 && n23ev.filter(x => x.event === 'pin_fail').length === 2,
  JSON.stringify([n1.reason, n2.reason, n23ev.map(x => x.event)]));
const o1 = await sset(s59.session, 'open', 40), o2 = await sget(s59.session), o3 = await stouch(s59.session), o4 = await sset(s59b.session, 'closed', null);
const p4b = await ctrlPress(c4, 20);
const o5 = await slogout(s59b.session);
t('T7 23:00 전에 연 공통 PIN 세션 — 저장 · 다시 읽기 · 변동 없음 모두 서버 거절(42501 booth_session_revoked) · 값 그대로(R2-01 10 · R2-04 15) · 나가기는 됨',
  isRevoked(o1) && isRevoked(o2) && isRevoked(o3) && isRevoked(o4) && (await liveTxt('R2-01')) === '여유/10' && (await liveTxt('R2-04')) === '보통/15' && o5.ok && o5.rows[0].ok === true,
  JSON.stringify([o1.hint, o2.hint, o3.hint, o4.hint, await liveTxt('R2-01'), await liveTxt('R2-04')]));
t('T7-1 열린 운영자 화면(R2-04)에서 23:00 뒤 20분 누름 → 서버 거절 → “운영본부가 이 부스의 PIN을 바꿨습니다.” 안내 · 저장 안 됨',
  /운영본부가 이 부스의 PIN을 바꿨습니다/.test(p4b.msg) && !/반영했습니다/.test(p4b.toast) && (await liveTxt('R2-04')) === '보통/15', JSON.stringify(p4b));
c4.dom.window.close();
const ev = [];
for (const at of ['2026-11-05 23:30:00+09', '2026-11-06 00:00:00+09', '2026-11-06 10:30:00+09', '2026-11-07 12:00:00+09', '2026-11-08 09:00:00+09']) { await setNow(at); ev.push((await login('R3-02', COMMON)).ok); }
t('T6-1 행사 날 · 그 뒤(11-05 23:30 · 11-06 00:00 · 11-06 10:30 · 11-07 12:00 · 11-08) 모두 공통 PIN 로그인 거절', ev.every(x => x === false), JSON.stringify(ev));
// 행사 첫날을 앞당기거나 미루면
await db.exec("update public.settings set event_start = '2026-11-05 10:00:00+09' where id = 1");
const until1 = (await q1("select to_char(private.rehearsal_common_pin_until() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') v")).v;
await setNow('2026-11-04 23:59:59+09');
const ea = await login('R2-08', COMMON);
await setNow('2026-11-05 00:00:00+09');
const eb = await login('R2-08', COMMON), ec = await sset(ea.session, 'open', 10);
await db.exec("update public.settings set event_start = '2026-11-10 01:00:00+00' where id = 1");
const until2 = (await q1("select to_char(private.rehearsal_common_pin_until() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') v")).v;
await db.exec("update public.settings set event_start = '2026-11-06 01:00:00+00' where id = 1");
t('D1 행사 첫날이 11-05 로 앞당겨지면 그날 00:00 KST 에 끝남(11-04 23:59:59 로그인 · 11-05 00:00 거절 · 열린 화면 거절) · 11-10 로 미뤄도 11-05 23:00 을 넘지 않음',
  until1 === '2026-11-05 00:00' && okSess(ea) && eb.ok === false && isRevoked(ec) && until2 === '2026-11-05 23:00', JSON.stringify([until1, ea.ok, eb.reason, ec.hint, until2]));
// 초기화와 PIN 끝은 서로 따로
await setNow('2026-11-05 22:30:00+09');
const s9 = await login('R2-09', COMMON);
await sset(s9.session, 'open', 25);
await db.exec('select private.rehearsal_live_reset()');
const r9a = await liveTxt('R2-09'), r9row = await sessRow(s9.session);
const r9b = await sset(s9.session, 'open', 30);
await setNow('2026-11-05 23:00:00+09');
const r9c = await liveTxt('R2-09');
const r9d = await admin("select * from public.admin_rehearsal_set_live($1, 'clear', null)", [idOf('R2-09')]);
const r9e = await liveTxt('R2-09');
t('D2 23시 초기화와 PIN 끝은 따로 — 초기화는 값만 지우고 세션은 그대로(다시 30분 저장) · PIN 이 끝나도 값은 남음(R2-09 30) · 관리자 비우기는 따로 됨',
  r9a === '없음' && !r9row.revoked_at && r9b.ok && r9c === '혼잡/30' && r9d.ok && r9e === '없음', JSON.stringify([r9a, r9row.revoked_at, r9b.ok, r9c, r9d.ok && 'ok', r9e]));
await setNow(null);
await db.exec(openBlock);
await db.exec('drop function private.test_now()');
t('D3 시험 시계 걷어냄 — 리허설 갈래 함수 = migration 판(지문) · 시험 함수 없음', fnDiff(fn1, await fnMap()).length === 0, fnDiff(fn1, await fnMap()).join());

// ══ F. 되돌리기(= 비상 정지) · 다시 적용 ══════════════════════════════════
section = 'F 되돌리기';
const sF = await login('R3-01', COMMON);
const fBefore = await fp();
r = await runAll(RB);
const fAfter = await fp();
const fr1 = await sset(sF.session, 'open', 10), fr2 = await login('R3-01', COMMON);
const fnRb = await fnMap();
t('F1 되돌리기 SQL: 확인 표 4줄 기대 = 실제 · 함수 = migration 전과 같음 · 데이터(QR · PIN · 세션 · 기록 · 부스 · 설정 · 대기 값) 그대로',
  r.ok && r.rows.length === 4 && allOk(r.rows) && fnDiff(fn0, fnRb).length === 0 && JSON.stringify(fBefore) === JSON.stringify(fAfter), r.ok ? tableTxt(r.rows) + ' ' + fnDiff(fn0, fnRb).join() : r.error);
t('F2 되돌린 순간 실제 부스 공통 PIN 끝 — 열린 화면 저장 거절(booth_session_revoked) · 새 로그인 거절', okSess(sF) && isRevoked(fr1) && fr2.ok === false, JSON.stringify([fr1.hint, fr2.reason]));
r = await runAll(MIG);
const fr3 = await sget(sF.session);
const F3_ROWS = r.ok ? tableTxt(r.rows) : r.error;
t('F3 다시 적용: 확인 표 그대로(5번 대상 수만 83 — 동시 발급 시험으로 PIN 을 받은 R2-10 은 다시 열리지 않음) · 함수 = 처음 적용과 같음 · 끝나지 않은 공통 PIN 세션은 다시 쓸 수 있음(되돌리기는 세션을 끊지 않음)',
  r.ok && r.rows.filter(x => +x['순서'] !== 5).every(x => x['기대'] === x['실제']) && r.rows.find(x => +x['순서'] === 5)['실제'] === '83' && fnDiff(fn1, await fnMap()).length === 0 && fr3.ok, F3_ROWS);

// ══ E. 개별 PIN 전환(QR 인쇄 화면의 '운영자 PIN 발급·관리') ══════════════════════
section = 'E 개별 PIN 전환';
const preSess = {};
for (const code of ['R1-02', 'R1-05', 'R4-21', 'R3-05', 'R3-06', 'R3-07']) preSess[code] = await login(code, COMMON);
preSess['R1-01'] = s1; preSess['R1-03'] = { session: L3s.session };
function printHtml(dir) {
  const html = readFileSync(join(dir, 'print-qr.html'), 'utf8').replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>/g, '');
  return inline(html, dir, ['assets/config.js', 'assets/core.js', 'assets/booth-core.js', 'assets/mock-data.js', 'assets/pin-status.js']);
}
async function openPrint(dir, hooks) {
  const { client, calls } = adminClient(hooks);
  const dom = new JSDOM(printHtml(dir), {
    url: 'https://sinjhon1245-cell.github.io/incheon-festival/print-qr.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: quiet(),
    beforeParse(w) {
      w.supabase = { createClient: () => client };
      function QRCode() { /* 그림 없음 */ } QRCode.CorrectLevel = { L: 1, M: 0, Q: 3, H: 2 }; w.QRCode = QRCode;
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.scrollTo = () => {}; w.print = () => {}; w.console.warn = () => {};
      w.fetch = async (u) => { const s = String(u), i = s.indexOf('/rest/v1/'); if (i < 0) throw new Error('예상 밖 요청'); const rr = await rest(s.slice(i + 9)); const tx = JSON.stringify(rr.body); return { ok: rr.status < 400, status: rr.status, text: async () => tx, json: async () => JSON.parse(tx) }; };
    }
  });
  const errors = []; dom.window.addEventListener('error', e => errors.push(e.message));
  const d = dom.window.document, w = dom.window;
  await until(() => d.querySelectorAll('.item--ops').length > 0, 30000);
  click(w, d.getElementById('pinx-toggle'));
  await until(() => !d.getElementById('pinx-main').hidden && d.querySelectorAll('#pinx-list .prow').length > 0, 20000);
  await wait(100);
  return { dom, d, w, calls, errors };
}
async function issueZone(P, zone) {   // 구역 칩 → 보이는 부스 모두 선택 → 선택 PIN 발급 → 확인 → 결과
  const chip = P.d.querySelector(`#pinx-zones [data-pzone="${zone}"]`);
  if (chip.getAttribute('aria-pressed') !== 'true') click(P.w, chip);   // 이미 눌린 칩을 다시 누르면 '전체' 로 풀림
  await wait(60);
  click(P.w, P.d.getElementById('pinx-all'));
  await wait(60);
  const selected = text(P.d.getElementById('pinx-count'));
  click(P.w, P.d.getElementById('pinx-issue'));
  await until(() => !!P.d.querySelector('#pinov-acts [data-ov="go"]') || /없어요/.test(text(P.d.getElementById('pinov-title'))), 15000);
  const confirm = text(P.d.getElementById('pinov-title')) + ' · ' + text(P.d.getElementById('pinov-body'));
  click(P.w, P.d.querySelector('#pinov-acts [data-ov="go"]'));
  await until(() => /PIN 발급 (완료|결과)/.test(text(P.d.getElementById('pinov-title'))), 120000, 100);
  const rows = [...P.d.querySelectorAll('#pinov-body .pinres li')].map(li => ({
    code: text(li.querySelector('.pinres__code')), pin: text(li.querySelector('.pinres__pin')).replace(/\s/g, ''),
    st: text(li.querySelector('.pinres__st')), why: text(li.querySelector('.pinres__why'))
  }));
  const sum = text(P.d.querySelector('#pinov-body .pinov__sum'));
  const same = text(P.d.getElementById('pinov-same'));
  // 결과 창 닫기(PIN 확인 안 함 → 확인하지 않고 닫기)
  click(P.w, P.d.querySelector('#pinov-acts [data-ov="close"]'));
  await wait(50);
  const disc = P.d.querySelector('#pinov-acts [data-ov="discard"]');
  if (disc) click(P.w, disc);
  await until(() => P.d.getElementById('pinov').hidden, 5000);
  const after = text(P.d.getElementById('pinx-after'));
  return { selected, confirm, rows, sum, same, after };
}
const PINS = {};   // 결과 창에서 읽은 새 PIN(복제 DB 의 가짜 값 · 출력하지 않음)
const keep = res => res.rows.forEach(x => { if (/^\d{6}$/.test(x.pin)) PINS[x.code] = x.pin; });
const activeOf = async code => +(await q1('select count(*) n from public.booth_session where booth_id = $1 and revoked_at is null and expires_at > now()', [idOf(code)])).n;
// E0 바뀌기 전 인쇄 화면(main 421f656)으로 R4 — 문구 견주기
const act421 = await activeOf('R4-21');
let P0 = await openPrint(OLD);
const resR4 = await issueZone(P0, 'R4');
P0.dom.window.close();
keep(resR4);
const r421 = resR4.rows.find(x => x.code === 'R4-21');
t('E0 (배포본 print-qr) R4 21곳 발급 성공 — 공통 PIN 세션이 있던 R4-21 줄에 “예상과 달리 … 로그아웃됐어요 … 다른 관리자가 …” 경고(오해 소지 → 작업 브랜치에서 문구 보완)',
  resR4.rows.length === 21 && resR4.rows.every(x => /^\d{6}$/.test(x.pin)) && act421 >= 1 && /예상과 달리 PIN 로그인 기기 \d+대가 로그아웃됐어요/.test(r421.why) && !P0.errors.length,
  JSON.stringify([resR4.rows.length, act421, r421 && r421.why, P0.errors]));
// E1 작업 브랜치 print-qr 로 R1 · R2
const actR1 = { 'R1-01': await activeOf('R1-01'), 'R1-02': await activeOf('R1-02'), 'R1-03': await activeOf('R1-03'), 'R1-05': await activeOf('R1-05') };
let P1 = await openPrint(WEB);
const resR1 = await issueZone(P1, 'R1');
keep(resR1);
const resR2 = await issueZone(P1, 'R2');
keep(resR2);
P1.dom.window.close();
const commonRows = resR1.rows.filter(x => /공통 PIN으로 연 기기/.test(x.why));
t('E1 (웹 브랜치 print-qr) R1 21곳 발급 — 공통 PIN 세션이 있던 줄은 “공통 PIN으로 연 기기 N대가 로그아웃됐어요. 이제 이 부스는 위의 새 PIN으로 들어가요.” · “예상과 달리” 없음',
  resR1.rows.length === 21 && resR1.rows.every(x => /^\d{6}$/.test(x.pin)) &&
  Object.entries(actR1).every(([c, n]) => n > 0 && resR1.rows.find(x => x.code === c).why === `공통 PIN으로 연 기기 ${n}대가 로그아웃됐어요. 이제 이 부스는 위의 새 PIN으로 들어가요.`) &&
  !resR1.rows.some(x => /예상과 달리/.test(x.why)) && !resR1.same && !P1.errors.length,
  JSON.stringify([actR1, commonRows.map(x => x.code + ':' + x.why)]));
t('E1-1 R2 — 동시 발급 시험으로 이미 PIN 이 있는 R2-10 은 확인창에서 ‘기존 정상 PIN 제외’ · 나머지 20곳 발급(세션이 있던 줄은 공통 PIN 문구)',
  /기존 정상 PIN 제외\s*1곳/.test(resR2.confirm) && resR2.rows.length === 20 && !resR2.rows.some(x => x.code === 'R2-10') && resR2.rows.every(x => /^\d{6}$/.test(x.pin)) &&
  !resR2.rows.some(x => /예상과 달리/.test(x.why)), resR2.confirm.slice(0, 200));
// E2 부분 실패: R3-05 · R3-06 의 발급이 마지막 단계(발급 기록)에서 서버 오류 → 그 부스의 발급 전체가 되돌아가는지
await db.exec(`create function public.test_fail_issue() returns trigger language plpgsql as $$
  begin
    if new.event = 'pin_issued' and new.booth_id::text = any (string_to_array(coalesce(current_setting('test.failpin', true), ''), ',')) then
      raise exception 'test failure' using errcode = '57014';
    end if;
    return new;
  end $$;
  create trigger test_fail_issue before insert on public.booth_auth_event for each row execute function public.test_fail_issue();`);
await db.exec(`set test.failpin = '${idOf('R3-05')},${idOf('R3-06')}'`);
const actR3 = { 'R3-05': await activeOf('R3-05'), 'R3-06': await activeOf('R3-06') };
let P2 = await openPrint(WEB);
const resR3 = await issueZone(P2, 'R3');
keep(resR3);
const f35 = resR3.rows.find(x => x.code === 'R3-05'), f36 = resR3.rows.find(x => x.code === 'R3-06');
const pinRow35 = await q1('select count(*) n from public.booth_pin where booth_id = $1', [idOf('R3-05')]);
const k1 = await sget(preSess['R3-05'].session), k2 = await login('R3-06', COMMON), k3 = await sget(preSess['R3-07'].session);
t('E2 부분 실패 — R3 21곳 중 19곳 성공 · R3-05 · R3-06 실패(서버 오류 → 그 부스 발급 전체 되돌림: PIN 줄 없음 · 세션 그대로) → 그 두 곳만 공통 PIN 유지 · 성공한 R3-07 은 끊김',
  resR3.rows.length === 21 && resR3.rows.filter(x => /^\d{6}$/.test(x.pin)).length === 19 && f35.st === '실패' && f36.st === '실패' &&
  +pinRow35.n === 0 && actR3['R3-05'] === await activeOf('R3-05') && k1.ok && okSess(k2) && isRevoked(k3) && (await targetN()) === 2,
  JSON.stringify([resR3.sum, f35, f36, pinRow35.n, k1.ok, k2.ok, k3.hint, await targetN()]));
const ck2 = await runCheck();
const act2 = +(await q1(`select count(*) n from public.booth_session where via_common_pin and revoked_at is null and expires_at > now() and booth_id = any($1::uuid[])`, [[idOf('R3-05'), idOf('R3-06')]])).n;
t('E2-1 전환 확인 SQL — 부분 실패 뒤: 발급 82 · 미발급 2 · 다시 발급할 부스 “R3-05 R3-06” · 공통 PIN 열린 부스 2 · 쓸 수 있는 공통 세션 = 그 두 부스 세션 · QR 그대로',
  ck2[2].a === '82' && ck2[3].a === '2' && ck2[5].a === 'R3-05 R3-06' && ck2[6].a === '2' && ck2[7].a === String(act2) && act2 > 0 && ck2[9].a === QR9 && ck2[10].a === '84 · 0',
  JSON.stringify([ck2[2], ck2[3], ck2[5], ck2[6], ck2[7], act2]));
await db.exec('reset test.failpin');
await db.exec('drop trigger test_fail_issue on public.booth_auth_event; drop function public.test_fail_issue();');
const resR3b = await issueZone(P2, 'R3');
keep(resR3b);
P2.dom.window.close();
const k4 = await sget(preSess['R3-05'].session);
t('E3 다시 ‘선택 PIN 발급’ — 확인창이 이미 발급된 19곳 제외 · 남은 2곳만 발급 → 그 순간 공통 PIN 끝(열린 화면 거절 · 대상 0곳)',
  /기존 정상 PIN 제외\s*19곳/.test(resR3b.confirm) && resR3b.rows.length === 2 && resR3b.rows.every(x => /^\d{6}$/.test(x.pin)) && isRevoked(k4) && (await targetN()) === 0,
  JSON.stringify([resR3b.confirm.slice(0, 160), resR3b.rows.length, k4.hint, await targetN()]));
// T8 · T9 · T10 · T11
const pinCodes = Object.keys(PINS);
const weak = (await q1('select count(*) filter (where private.booth_pin_weak(p)) n from unnest($1::text[]) p', [Object.values(PINS)])).n;
const pin84 = +(await q1('select count(*) n from public.booth_pin where booth_id = any($1::uuid[])', [REAL])).n;
const dup = Object.values(PINS).length - new Set(Object.values(PINS)).size;
const cm = [];
for (const code of ['R1-01', 'R1-02', 'R2-05', 'R3-05', 'R4-21', 'R4-01']) cm.push((await login(code, COMMON)).ok);
t('T8 개별 PIN 일괄 발급 → 공통 PIN 차단 — 84곳 모두 PIN 줄(83곳 화면 발급 + 동시 발급 시험 1곳) · 새 PIN 6자리 · 약한 PIN 0 · 공통 PIN 로그인 모두 거절 · 대상 0곳',
  pinCodes.length === 83 && pin84 === 84 && +weak === 0 && !Object.values(PINS).includes(COMMON) && cm.every(x => x === false) && (await targetN()) === 0,
  JSON.stringify([pinCodes.length, pin84, weak, cm, await targetN(), `같은 숫자 ${dup}쌍`]));
const rv = [];
for (const code of ['R1-01', 'R1-02', 'R1-03', 'R1-05', 'R4-21', 'R3-07']) rv.push(await sset(preSess[code].session, 'open', 10));
const revoked = await q1(`select count(*) filter (where revoke_reason = 'pin_reissued') n,
    count(*) filter (where revoked_at is null and expires_at > now() and via_common_pin and private.booth_common_pin_target(booth_id)) still
  from public.booth_session where booth_id = any($1::uuid[])`, [REAL]);
const c3b = await ctrlOpenSession(L3);
const p3b = await ctrlPress(c3b, 20);
c3b.dom.window.close();
t('T9 전환 뒤 공통 PIN 세션 무효 — 열린 화면 저장 모두 거절(“운영본부가 PIN을 변경했습니다.” · pin_reissued) · 살아 있는 공통 PIN 세션 0 · 운영자 화면(R1-03)은 “운영본부가 이 부스의 PIN을 바꿨습니다.”',
  rv.every(x => isRevoked(x) && /운영본부가 PIN을 변경했습니다/.test(x.message)) && +revoked.n > 0 && +revoked.still === 0 && /운영본부가 이 부스의 PIN을 바꿨습니다/.test(p3b.msg),
  JSON.stringify([rv.map(x => x.hint), revoked, p3b]));
e0 = await evMax();
const nA = await login('R1-01', PINS['R1-01']);
const nArow = okSess(nA) ? await sessRow(nA.session) : null, nAev = await lastEv();
const nB = await sset(nA.session, 'open', 12);
const otherCode = pinCodes.find(c => c !== 'R1-01' && PINS[c] !== PINS['R1-01']);
const nC = await login(otherCode, PINS['R1-01']);
const L5 = await ctrlPinLogin('R1-03', PINS['R1-03']);
const c5 = await ctrlOpenSession(L5);
const p5 = await ctrlPress(c5, 30);
c5.dom.window.close();
t('T10 새 개별 PIN — 그 부스 로그인 됨(공통 PIN 표시 없음 · 기록 detail 없음) · 저장 됨 · 다른 부스에서는 거절 · 운영자 화면(R1-03)도 새 PIN 으로 저장',
  okSess(nA) && nArow.via_common_pin === false && nAev.event === 'pin_ok' && nAev.detail === null && nB.ok && (await liveTxt('R1-01')) === '보통/12' &&
  nC.ok === false && !!L5.stored && !L5.pinInStorage && /반영했습니다/.test(p5.toast) && (await liveTxt('R1-03')) === '혼잡/30',
  JSON.stringify([nA.ok, nArow && nArow.via_common_pin, nAev.detail, nB.ok, nC.reason, !!L5.stored, p5]));
const tok = async code => (await q1('select token from public.booth_access where booth_id = $1', [idOf(code)])).token;
const qa = await anon('select * from public.booth_ctrl_get($1)', [await tok('R1-03')]);
const qb = await anon('select * from public.booth_ctrl_set($1, $2, $3)', [await tok('R1-03'), 'open', 35]);
const qc = await anon('select * from public.booth_ctrl_set($1, $2, $3)', [await tok('R3-05'), 'pause', null]);
const qrNow = (await fp()).qr;
t('T11 QR 그대로 — 열쇠 다시 발급 없음(QR 지문 처음과 같음) · 전환한 부스 QR 로 읽기 · 저장 됨',
  qa.ok && qa.rows[0].code === 'R1-03' && qb.ok && (await liveTxt('R1-03')) === '혼잡/35' && qc.ok && (await liveTxt('R3-05')) === '중단/0' && qrNow === F0.qr,
  JSON.stringify([qa.ok, qb.ok, qc.ok, qrNow === F0.qr]));
// 다시 열리지 않음: PIN 끄기 · (흉내) PIN 줄 손으로 지움 · 다시 발급
const dz = await admin('select * from public.admin_disable_booth_pin($1)', [idOf('R1-10')]);
const dz1 = await login('R1-10', COMMON);
await db.query('delete from public.booth_pin where booth_id = $1', [idOf('R1-10')]);
const dz2 = await login('R1-10', COMMON), dzT = await target('R1-10');
const dz3 = await admin("select * from public.admin_issue_booth_pin_checked($1, 'none', null)", [idOf('R1-10')]);
const dz4 = dz3.ok ? await login('R1-10', dz3.rows[0].pin) : { ok: false };
t('E4 공통 PIN 은 다시 열리지 않음 — PIN 끄기 뒤 거절 · PIN 줄을 손으로 지워도(보안 기록의 발급 · 끄기가 남아) 거절 · 다시 발급한 개별 PIN 은 됨',
  dz.ok && dz1.ok === false && dz2.ok === false && dzT === false && dz3.ok && okSess(dz4), JSON.stringify([dz.ok, dz1.reason, dz2.reason, dzT, dz3.ok, dz4.ok]));
const ck9 = await runCheck();
const ckMiss = [1, 2, 3, 4, 5, 6, 7, 10, 11].filter(k => ck9[k].a !== ck9[k].e);
t('E5 전환 확인 SQL — 다 넘어간 뒤: 1~7 · 10 · 11 기대 = 실제(발급 84 · 미발급 0 · 꺼짐 0 · 남은 부스 - · 공통 PIN 열린 부스 0 · 쓸 수 있는 공통 세션 0) · QR 열쇠 지문 처음과 같음 · 끊긴 공통 세션 > 0',
  ckMiss.length === 0 && ck9[9].a === QR9 && +ck9[8].a > 0, JSON.stringify([ckMiss, ck9]));

// ══ G. 예시 · 관리자 · 관람객 회귀 · 원문 흔적 ═══════════════════════════
section = 'G 회귀';
t('T12 예시 50곳 그대로 — 부스 · 대기 값 · 개별 PIN 2곳 · QR 지문 처음과 같음', (await exFp()) === EX0 && +(await q1('select count(*) n from public.booth_pin where booth_id = any($1::uuid[])', [exIds])).n === 2);
ap = await openAdmin();
const pnl = rhPanel(ap);
const fillTxt = await rhRun(ap, 'fill');
const nFill = await liveN(REAL);
const clrTxt = await rhRun(ap, 'clear');
const nClr = await liveN(REAL);
ap.dom.window.close();
let P3 = await openPrint(WEB);
const pinxSum = text(P3.d.getElementById('pinx-sum'));
P3.dom.window.close();
t('T13-1 관리자 회귀 — [리허설 관리] 84곳 · 채우기 84 · 비우기 0 · 오류 없음 · QR 인쇄 화면 PIN 요약(발급됨 86 = 실제 84 + 예시 2)',
  /실제 부스 84곳/.test(pnl) && /채웠습니다/.test(fillTxt) && nFill === 84 && /비웠습니다/.test(clrTxt) && nClr === 0 && !ap.errors.length && /PIN 발급됨 86/.test(pinxSum) && !P3.errors.length,
  JSON.stringify([pnl.slice(0, 100), nFill, nClr, pinxSum, ap.errors, P3.errors]));
await sset(nA.session, 'open', 12);
sn = await snapshotNow();
J = JSON.parse(sn.body);
const sessTokens = [s1, s7, s10, nA, ...Object.values(preSess)].filter(x => x && x.session).map(x => x.session);
t('T13-2 관람객 회귀 — 공개 API 200 · 84곳 · R1-01 개별 PIN 운영자 값 12분 · 새 PIN · 공통 PIN · 세션 · 열쇠 없음 · 구조 그대로',
  sn.status === 200 && J.booths.length === 84 && J.booths.find(b => b.code === 'R1-01').waitMinutes === 12 && !sn.body.includes(COMMON) &&
  !Object.values(PINS).some(p => sn.body.includes(`"${p}"`)) && !sessTokens.some(s => sn.body.includes(s)) &&
  Object.keys(J).sort().join() === 'booths,event,generatedAt,liveReady,mode,unplaced,version,zones', sn.body.slice(0, 160));
const leak = await q1(`select
  (select count(*) from public.booth_pin p where left(p.pin_hash, 7) not in ('$2a$10$', '$2b$10$', '$2x$10$', '$2y$10$') or p.pin_hash = any ($1::text[])) pinraw,
  (select count(*) from public.booth_auth_event e where concat_ws('|', e.event, e.limit_kind, e.detail) ~ any ($1::text[])) ev,
  (select count(*) from public.booth_session s where coalesce(s.revoke_reason, '') ~ any ($1::text[])) sess,
  (select count(*) from public.booth_live_log g where concat_ws('|', g.congestion, g.source) ~ any ($1::text[])) log`, [[COMMON, ...Object.values(PINS)]]);
t('T13-3 PIN 원문 흔적 없음 — PIN 표는 bcrypt 해시만 · 보안 기록 · 세션 · 대기 기록의 글 칸에 공통 PIN · 새 개별 PIN 숫자 0건(기기 · IP 표식은 HMAC 16자)',
  +leak.pinraw === 0 && +leak.ev === 0 && +leak.sess === 0 && +leak.log === 0, JSON.stringify(leak));
const F9 = await fp();
t('T13-4 마지막 지문 — QR · 부스 · 구역 · 설정은 처음과 같음(84곳 UUID · QR 열쇠 · 구역 · 번호 · 공개 그대로)',
  F9.qr === F0.qr && F9.booths === F0.booths && F9.zones === F0.zones && F9.settings === F0.settings, JSON.stringify([F0, F9]));
t('T13-5 마지막 함수 — 처음 적용 판과 같음(시험 대체 함수 · 트리거 없음)', fnDiff(fn1, await fnMap()).length === 0 &&
  +(await q1("select count(*) n from pg_trigger where tgname = 'test_fail_issue'")).n === 0, fnDiff(fn1, await fnMap()).join());

// ══ H. 같은 PIN 알림(인쇄 화면 결과 창 · 발급 방식 그대로) ═════════════════════
section = 'H 같은 PIN';
// 무작위 생성기를 이 시험에서만 고정 값으로 바꿔 겹침을 일부러 만듭니다(test.dup 이 켜졌을 때만) — 끝나면 원래 본문으로 되돌림.
const genSrc = (() => {
  const lines = readFileSync(join(PIN, 'supabase/migration-booth-pin.sql'), 'utf8').replace(/\r/g, '').split('\n');
  const i = lines.findIndex(l => l.startsWith('create function private.booth_pin_generate()'));
  let j = i; while (lines[j] !== '$$;') j++;
  return lines.slice(i, j + 1).join('\n').replace(/^create function/, 'create or replace function');
})();
await db.exec(`create or replace function private.booth_pin_generate() returns text language plpgsql volatile set search_path = '' as $$
  begin
    if pg_catalog.current_setting('test.dup', true) = 'on' then return '482913'; end if;
    return lpad((floor(random() * 1000000))::int::text, 6, '0');
  end $$;`);
await db.exec("set test.dup = 'on'");
let P4 = await openPrint(WEB);
click(P4.w, P4.d.getElementById('pinx-none'));
const dupCodes = ['R4-01', 'R4-02', 'R4-03'];
for (const c of dupCodes) { const cb = P4.d.querySelector(`#pinx-list input[data-pid="${idOf(c)}"]`); cb.checked = true; cb.dispatchEvent(new P4.w.Event('change', { bubbles: true })); }
await wait(60);
click(P4.w, P4.d.getElementById('pinx-reissue'));
await until(() => !!P4.d.getElementById('pinov-word') || !!P4.d.querySelector('#pinov-acts [data-ov="go"]'), 15000);
const word = P4.d.getElementById('pinov-word');
if (word) { word.value = '재발급'; word.dispatchEvent(new P4.w.Event('input', { bubbles: true })); await wait(50); }
click(P4.w, P4.d.querySelector('#pinov-acts [data-ov="go"]'));
await until(() => /PIN 재발급 (완료|결과)/.test(text(P4.d.getElementById('pinov-title'))), 60000, 100);
const dupWarn = text(P4.d.getElementById('pinov-same'));
const dupRows = [...P4.d.querySelectorAll('#pinov-body .pinres li')].map(li => ({ code: text(li.querySelector('.pinres__code')), why: text(li.querySelector('.pinres__why.is-unk')) }));
const dupHtmlHasPin = P4.d.getElementById('pinov-same').textContent.includes('482913') || dupRows.some(x => x.why.includes('482913'));
click(P4.w, P4.d.querySelector('#pinov-acts [data-ov="close"]')); await wait(50);
const disc4 = P4.d.querySelector('#pinov-acts [data-ov="discard"]'); if (disc4) click(P4.w, disc4);
await until(() => P4.d.getElementById('pinov').hidden, 5000);
const dupAfter = text(P4.d.getElementById('pinx-after'));
await db.exec('reset test.dup');
await db.exec(genSrc);
t('H1 한 결과 창에서 같은 PIN 을 받은 부스(일부러 겹치게 한 3곳) → 맨 위 “같은 PIN을 받은 부스가 1묶음 있어요: R4-01 · R4-02 · R4-03” · 줄마다 “… 부스와 같은 PIN이에요.” · 안내 글에 PIN 숫자 없음',
  /같은 PIN을 받은 부스가 1묶음 있어요: R4-01 · R4-02 · R4-03/.test(dupWarn) && /묶음마다 한 곳을 ‘선택 PIN 재발급’/.test(dupWarn) &&
  dupRows.length === 3 && dupRows.every(x => x.why === dupCodes.filter(c => c !== x.code).join(' · ') + ' 부스와 같은 PIN이에요.') && !dupHtmlHasPin && !P4.errors.length,
  JSON.stringify([dupWarn, dupRows]));
t('H2 결과 창을 닫은 뒤 패널 요약에도 “같은 PIN을 받은 부스: R4-01 · R4-02 · R4-03 — 묶음마다 한 곳을 재발급해 주세요.”(부스 번호만)',
  /같은 PIN을 받은 부스: R4-01 · R4-02 · R4-03 — 묶음마다 한 곳을 재발급해 주세요\./.test(dupAfter) && !dupAfter.includes('482913'), dupAfter);
t('H3 겹치지 않은 결과 창(R1 · R2 · R3 발급)에는 같은 PIN 안내 없음 · 생성기 원래 본문으로 되돌림(지문 = 처음 적용 판)',
  !resR1.same && !resR2.same && !resR3.same && !resR3b.same && fnDiff(fn1, await fnMap()).length === 0, fnDiff(fn1, await fnMap()).join());
// 84곳을 한 결과 창에서 견주는 길: 찾기 칸 '임시구역' → 찾은 84곳 모두 선택
const qbox = P4.d.getElementById('pinx-q');
qbox.value = '임시구역'; qbox.dispatchEvent(new P4.w.Event('input', { bubbles: true }));
await wait(80);
const allLabel = text(P4.d.getElementById('pinx-all'));
const shown = P4.d.querySelectorAll('#pinx-list .prow').length;
P4.dom.window.close();
t('H4 한 번에 발급하는 길 — 찾기 칸 ‘임시구역’ → 실제 84곳만 보이고 “찾은 84곳 모두 선택”(예시 50곳 빠짐)', shown === 84 && allLabel === '찾은 84곳 모두 선택', `${shown} ${allLabel}`);

// ══ 보고서 ═════════════════════════════════════════════════════════════
const passed = results.filter(x => x.ok).length;
const files = [[PIN, 'supabase/migration-booth-rehearsal-pin.sql'], [PIN, 'supabase/rollback-booth-rehearsal-pin.sql'], [WEB, 'print-qr.html']]
  .map(([dir, f]) => `| ${f} | ${sha(readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n'))} |`);
const md = [
  '# 리허설 공통 PIN — 로컬 시험 결과', '',
  `- 실행: ${new Date().toISOString()} · 결과 **${passed} / ${results.length} 통과**`,
  `- DB ${git(PIN, 'rev-parse', '--abbrev-ref', 'HEAD')} @ ${git(PIN, 'rev-parse', '--short', 'HEAD')} · 웹 ${git(WEB, 'rev-parse', '--abbrev-ref', 'HEAD')} @ ${git(WEB, 'rev-parse', '--short', 'HEAD')} · 배포본 booth-live ${git(LIVE, 'rev-parse', '--short', 'HEAD')} · main ${git(OLD, 'rev-parse', '--short', 'HEAD')}`,
  '- 복제 DB: PGlite(PostgreSQL 17) · Production 과 같은 단계 · 인증 · 발급 · 리허설 함수 지문 = Production(10-19 읽기 전용 조회)',
  '- 열쇠 · PIN · 세션은 복제 DB 의 가짜 값이며 이 보고서에 적지 않습니다.', '',
  '| 파일(LF 기준) | SHA-256 |', '|---|---|', ...files, '',
  '## migration 확인 표(복제 DB)', '', '| 순서 | 항목 | 기대 | 실제 |', '|---|---|---|---|',
  ...MIG_ROWS.map(x => `| ${x['순서']} | ${x['항목']} | ${x['기대']} | ${x['실제']} |`), '',
  '## 결과', '', '| 구역 | 시험 | 결과 | 메모 |', '|---|---|---|---|',
  ...results.map(x => `| ${x.section} | ${x.name.replace(/\|/g, '/')} | ${x.ok ? '통과' : '**실패**'} | ${(x.note || '').replace(/\|/g, '/').replace(/\n/g, ' ')} |`), ''
].join('\n');
mkdirSync(resolve(OUT, 'rehearsal'), { recursive: true });
writeFileSync(resolve(OUT, 'rehearsal', 'rehearsal-pin-test-report.md'), md);
console.log(`\n${passed} / ${results.length} 통과 → out/rehearsal/rehearsal-pin-test-report.md`);
process.exit(passed === results.length ? 0 : 1);
