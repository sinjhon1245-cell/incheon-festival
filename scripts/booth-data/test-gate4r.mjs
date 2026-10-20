/* ===================================================================
   Gate 4-R 로컬 시험 — 임시 배정(R1~R4) → 공개 → 리허설 → 초기화 → 최종 재배정
   ───────────────────────────────────────────────────────────────────
   로컬 복제 DB(PG17 · PGlite)를 지금 Production 과 같은 단계로 만듭니다:
     migration-booth-preview → C-02 → Q-02 · Production 함수 셋 보충(replica-functions-extra.sql)
   그 위에서 out/gate4r 의 T-02 · T-03 파일을 고치지 않고 실행하고, 화면은 지금 배포된 코드 그대로 봅니다.
     관람객 화면 · 운영자 화면 · 관람객 API = booth-live 작업 폴더(--live-dir)
     운영 포털 · QR 인쇄 화면 = main 작업 폴더(--main-dir)
   최종 재배정은 시험용 가짜 최종안(SW · F)으로 F-02 를 만들어 봅니다(파일로 남기지 않음).

   ⚠️ 네트워크 · Production 접속 없음. 열쇠는 이 시험 DB 의 가짜 값이고 출력하지 않습니다(개수 · 참거짓만).
   쓰는 법
     node scripts/booth-data/test-gate4r.mjs --pglite-dir <PGlite 0.4.4> --jsdom-dir <jsdom 30> --qr-dir <qrcodejs · jsqr>
          [--live-dir ../incheon-festival-h1] [--main-dir ../incheon-festival-p1] [--dump <폴더>]
   결과: out/gate4r/test-report.md
   =================================================================== */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readCsv } from './lib/csv.mjs';
import { loadPglite, openReplica } from './lib/replica.mjs';
import { makeRest, fakeSupabase } from './lib/fake-rest.mjs';
import { rehearsalPlan, codeOf, manifestSha, sha256, planCsv } from './lib/plan-gate4r.mjs';
import { moveSqls } from './lib/sql-gate4r.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT = resolve(HERE, 'out');
const G3 = resolve(OUT, 'gate3c'), G4 = resolve(OUT, 'gate4r');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const liveDir = resolve(arg('live-dir', resolve(REPO, '../incheon-festival-h1')));
const mainDir = resolve(arg('main-dir', resolve(REPO, '../incheon-festival-p1')));
const dumpDir = arg('dump');
if (dumpDir) mkdirSync(dumpDir, { recursive: true });
const { JSDOM } = createRequire(join(resolve(arg('jsdom-dir')), 'package.json'))('jsdom');
const qreq = createRequire(join(resolve(arg('qr-dir')), 'package.json'));
const jsQRmod = qreq('jsqr'); const jsQR = jsQRmod.default || jsQRmod;
const QR_SRC = readFileSync(qreq.resolve('qrcodejs/qrcode.min.js'), 'utf8');
const QR_TAG = '<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>';
const lib = await loadPglite(arg('pglite-dir'));

const manifest = readCsv(resolve(OUT, 'staging', 'manifest.csv'));
const snap = readCsv(resolve(OUT, readdirSync(OUT).filter(f => /^prod-snapshot-\d{8}\.csv$/.test(f)).sort().pop()));
const R = await openReplica(lib, { snap, manifest });
const db = R.db;
const rest = makeRest(R);
const SQL3 = f => readFileSync(resolve(G3, f), 'utf8');
// 포털이 함께 읽는 표 — 이 시험에서는 비어 있으면 됩니다(공개 읽기만 · test-portal-pending 과 같음)
await db.exec(`
  create table public.schedule_items (id uuid primary key default gen_random_uuid(), sort_order int not null default 0,
    event_date date, start_time text, end_time text, title text, place text, category text, team text, owner text,
    memo text, status text, is_highlight boolean not null default false);
  create table public.notices (id uuid primary key default gen_random_uuid(), sort_order int not null default 0,
    pinned boolean not null default false, created_at timestamptz not null default now(), level text, title text, summary text, body text);
  create table public.operation_requests (id uuid primary key default gen_random_uuid(), sort_order int not null default 0,
    created_at timestamptz not null default now(), status text, priority text, title text);
  create table public.resources (id uuid primary key default gen_random_uuid(), sort_order int not null default 0, title text, url text);
  create table public.contacts (id uuid primary key default gen_random_uuid(), sort_order int not null default 0,
    name text, org text, duty text, category text, memo text, is_staff boolean not null default false, role_group text);
  create table public.venue_places (id uuid primary key default gen_random_uuid(), sort_order int not null default 0, name text);
  create table public.faqs (id uuid primary key default gen_random_uuid(), sort_order int not null default 0, q text, a text);
  grant select on public.schedule_items, public.notices, public.operation_requests, public.resources,
    public.contacts, public.venue_places, public.faqs to anon, authenticated;
  alter table public.staff_profiles add column if not exists name text, add column if not exists email text;
`);
const close = x => { try { x && x.dom && x.dom.window.close(); } catch { /* 이미 닫힘 */ } };

const SQL4 = f => readFileSync(resolve(G4, f), 'utf8');
const docs = manifest.slice().sort((a, b) => a.doc_key.localeCompare(b.doc_key));
const idOf = d => docs.find(m => m.doc_key === d).booth_id;
const { plan, zones } = rehearsalPlan(manifest);
const planById = new Map(plan.map(p => [p.id, p]));
const targets = JSON.parse(readFileSync(resolve(G3, 'targets.json'), 'utf8'));

const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function t(name, ok, note = '') { results.push({ name, ok: !!ok, note }); console.log(`${ok ? '통과' : '실패'}  ${name}${note ? '  — ' + note : ''}`); }
function info(name, note) { results.push({ name, ok: true, note, info: true }); console.log(`참고  ${name}  — ${note}`); }
const KST = iso => Date.parse(iso + '+09:00');
const one = async (sql, p) => (await db.query(sql, p)).rows[0];

// 지문: 부스 · 구역 · 열쇠 · 대기 값 · 기록 · 설정(전체) — 실패한 실행이 아무것도 바꾸지 않았는지
const dbFp = async () => (await one(`select md5(string_agg(t, '|' order by t)) fp from (
  select 'b' || md5(coalesce(string_agg(row_to_json(b)::text, ',' order by b.id), '')) t from public.booths b
  union all select 'z' || md5(coalesce(string_agg(row_to_json(z)::text, ',' order by z.key), '')) from public.zones z
  union all select 'a' || md5(coalesce(string_agg(row_to_json(a)::text, ',' order by a.booth_id), '')) from public.booth_access a
  union all select 'l' || md5(coalesce(string_agg(row_to_json(l)::text, ',' order by l.booth_id), '')) from public.booth_live l
  union all select 'g' || count(*) || '/' || coalesce(max(id), 0) from public.booth_live_log
  union all select 's' || md5(row_to_json(s)::text) from public.settings s) x`)).fp;
const qrFp = async () => (await one(`select md5(string_agg(to_jsonb(a)::text, ',' order by a.booth_id)) fp from public.booth_access a`)).fp;
const exFp = async () => (await one(`select md5(string_agg(row_to_json(b)::text, ',' order by b.id)) fp from public.booths b where b.org ~ '^\\s*\\[예시\\]'`)).fp;
const tokens = async () => new Map((await db.query('select booth_id::text id, token from public.booth_access')).rows.map(x => [x.id, x.token]));
const anon = async (fn, args) => { try { return { rows: await R.asAnon(`select * from public.${fn}(${args.map((_, i) => '$' + (i + 1)).join(', ')})`, args) }; } catch (e) { return { err: e.message, code: e.code }; } };
const admin = sql => R.asAdmin(() => db.query(sql));

// ── 관람객 API(live-snapshot.mjs) ──────────────────────────────────────
globalThis.fetch = async (url) => {
  const u = String(url), i = u.indexOf('/rest/v1/');
  if (i < 0) throw new Error('예상 밖 요청');
  const r = await rest(u.slice(i + 9));
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
};
let modN = 0;
async function snapshotAt(at) {
  const mod = await import(pathToFileURL(join(liveDir, 'live/api/live-snapshot.mjs')).href + '?s=' + (++modN));
  const realNow = Date.now;
  if (at) Date.now = () => at;
  try {
    const res = await mod.default.fetch(new Request('https://incheon-live.vercel.app/api/live-snapshot'));
    return { status: res.status, json: JSON.parse(await res.text()) };
  } finally { Date.now = realNow; }
}
function fakeClock(w, at) {
  const RD = w.Date, off = at - RD.now();
  function FD(...a) { if (!new.target) return new RD(RD.now() + off).toString(); return a.length ? new RD(...a) : new RD(RD.now() + off); }
  FD.prototype = RD.prototype; FD.now = () => RD.now() + off; FD.UTC = RD.UTC; FD.parse = RD.parse;
  w.Date = FD;
}
const inline = (html, dir, files) => {
  for (const p of files) {
    const src = readFileSync(join(dir, p), 'utf8').replace(/<\/script/gi, '<\\/script');
    html = html.replace(new RegExp(`<script src="${p.replace(/[.]/g, '\\.')}"></script>`), () => `<script>${src}</script>`);
  }
  return html.replace(/<link[^>]+stylesheet[^>]*>/g, '');
};
const mm = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
function dump(d, name, dir, cssLinks) {
  if (!dumpDir) return;
  const root = d.documentElement.cloneNode(true);
  root.querySelectorAll('script').forEach(x => x.remove());
  root.querySelectorAll('[data-qr]').forEach(x => { x.innerHTML = ''; x.setAttribute('style', 'aspect-ratio:1;background:repeating-linear-gradient(45deg,#d9dce3 0 3px,#fff 3px 7px)'); });
  // 화면 캡처에는 (가짜) 열쇠 끝자리도 남기지 않습니다 — '끝자리 abcd' · '끝자리 <span>abcd</span>' 모두
  const html = '<!doctype html>' + root.outerHTML.replace(/(끝자리\s*(?:<[^>]*>\s*)*)[A-Za-z0-9_-]{4}/g, '$1••••').replace('<head>', '<head><base href="' + pathToFileURL(dir).href + '/">' + cssLinks);
  writeFileSync(resolve(dumpDir, name + '.html'), html);
}
const linksOf = (dir, f) => [...readFileSync(join(dir, f), 'utf8').matchAll(/<link[^>]+stylesheet[^>]*>/g)].map(m => m[0]).join('');

// 관람객 화면
async function visitor(json, at = 0, query = '') {
  const html = inline(readFileSync(join(liveDir, 'visitor.html'), 'utf8'), liveDir, ['assets/config.js', 'assets/mock-data.js', 'assets/booth-core.js']);
  const dom = new JSDOM(html, {
    url: 'https://incheon-live.vercel.app/' + query, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = mm; w.scrollTo = () => {}; w.console.warn = () => {};
      w.fetch = (u) => String(u).endsWith('/api/live-snapshot')
        ? Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(json)) })
        : Promise.reject(new Error('예상 밖 요청'));
      if (at) fakeClock(w, at);
    }
  });
  const errors = [];
  dom.window.addEventListener('error', e => errors.push(e.message));
  for (let i = 0; i < 60; i++) { await wait(50); if (dom.window.document.querySelector('#list .row, #list .empty, #pending .row')) break; }
  await wait(120);
  return { dom, d: dom.window.document, errors };
}
async function search(v, q) {
  const input = v.d.querySelector('#search input, input[type="search"]');
  input.value = q; input.dispatchEvent(new v.dom.window.Event('input', { bubbles: true }));
  await wait(450);
  return [...v.d.querySelectorAll('#list .row')].map(li => text(li.querySelector('.row__code')));
}

// 운영 포털(익명 · 관리자)
async function portal(hash, anonUser = true) {
  let html = readFileSync(join(mainDir, 'index.html'), 'utf8').replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>/g, '');
  html = inline(html, mainDir, ['assets/config.js', 'assets/core.js', 'assets/ui.js', 'assets/portal.js']);
  const log = [], errors = [];
  const dom = new JSDOM(html, {
    url: 'https://sinjhon1245-cell.github.io/incheon-festival/' + hash, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.supabase = fakeSupabase(R, log, { anon: anonUser });
      w.matchMedia = mm; w.scrollTo = () => {}; w.fetch = async () => { throw new Error('예상 밖 요청'); };
      w.console.warn = () => {}; w.console.error = (...a) => errors.push(a.join(' '));
    }
  });
  dom.window.addEventListener('error', e => errors.push(e.message));
  for (let i = 0; i < 100; i++) { await wait(60); if (log.includes('select:booths')) break; }
  await wait(500);
  return { dom, d: dom.window.document, log, errors };
}

// QR 인쇄 화면(관리자) — 실제 QR 생성기로 그려 다시 읽기
function decodeBox(box) {
  const rows = box ? [...box.querySelectorAll('table tr')] : [];
  const n = rows.length; if (!n) return null;
  const S = 4, Q = 4, W = (n + 2 * Q) * S, px = new Uint8ClampedArray(W * W * 4).fill(255);
  rows.forEach((tr, y) => [...tr.children].forEach((td, x) => {
    if (!/^(#000000|#000|rgb\(0, 0, 0\))$/i.test(td.style.backgroundColor.trim())) return;
    for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) { const i = (((y + Q) * S + dy) * W + (x + Q) * S + dx) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
  }));
  const r = jsQR(px, W, W); return r ? r.data : null;
}
async function printPage() {
  let html = readFileSync(join(mainDir, 'print-qr.html'), 'utf8');
  if (!html.includes(QR_TAG)) throw new Error('print-qr.html 의 QR 생성기 주소가 바뀌었습니다');
  html = html.replace(QR_TAG, () => `<script>${QR_SRC.replace(/<\/script/gi, '<\\/script')}</script>`)
    .replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>/g, '');
  html = inline(html, mainDir, ['assets/config.js', 'assets/core.js', 'assets/booth-core.js', 'assets/mock-data.js']);
  const log = [], errors = [];
  const dom = new JSDOM(html, {
    url: 'https://sinjhon1245-cell.github.io/incheon-festival/print-qr.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.supabase = fakeSupabase(R, log); w.CanvasRenderingContext2D = undefined;
      w.matchMedia = mm; w.scrollTo = () => {}; w.print = () => {}; w.console.warn = () => {};
      w.fetch = async (u) => { const s = String(u), i = s.indexOf('/rest/v1/'); if (i < 0) throw new Error('예상 밖 요청'); const r = await rest(s.slice(i + 9)); const b = JSON.stringify(r.body); return { ok: r.status < 400, status: r.status, text: async () => b, json: async () => r.body }; };
    }
  });
  dom.window.addEventListener('error', e => errors.push(e.message));
  for (let i = 0; i < 160; i++) { await wait(75); if (dom.window.document.querySelectorAll('.item--ops [data-qr] table').length >= 84 && log.includes('rpc:admin_booth_access')) break; }
  await wait(800);
  return { dom, d: dom.window.document, log, errors };
}
const OP_RE = /^https:\/\/incheon-live\.vercel\.app\/booth-ctrl\.html#k=([A-Za-z0-9_-]{24})$/;
function readOps(p) {
  const out = new Map();
  for (const el of p.d.querySelectorAll('.item--ops')) {
    const id = el.getAttribute('data-id');
    if (!planById.has(id)) continue;
    out.set(id, { url: decodeBox(el.querySelector('[data-qr]')), text: text(el), unplaced: el.classList.contains('is-unplaced') });
  }
  return out;
}

// 운영자 화면(익명)
const ctrlCalls = [];
async function anonFetch(u, init = {}) {
  const s = String(u), i = s.indexOf('/rest/v1/');
  if (i < 0) throw new Error('예상 밖 요청');
  const path = s.slice(i + 9), method = String(init.method || 'GET').toUpperCase();
  let status = 200, body;
  if (method === 'GET') { const r = await rest(path); status = r.status; body = r.body; }
  else if (path.startsWith('rpc/')) {
    const name = path.slice(4).split('?')[0], args = init.body ? JSON.parse(init.body) : {}, keys = Object.keys(args);
    try { body = await R.asAnon(`select * from public.${name}(${keys.map((k, j) => `${k} => $${j + 1}`).join(', ')})`, keys.map(k => args[k])); }
    catch (e) { status = e.code === '42883' ? 404 : (e.code === '42501' ? 401 : 400); body = { code: e.code, message: e.message, hint: e.hint }; }
  } else { status = 405; body = {}; }
  ctrlCalls.push(method + ' ' + path.split('?')[0]);
  const out = JSON.stringify(body);
  return { ok: status < 400, status, text: async () => out, json: async () => body, headers: { get: () => 'application/json' } };
}
async function ctrl(url) {
  const html = inline(readFileSync(join(liveDir, 'booth-ctrl.html'), 'utf8'), liveDir, ['assets/config.js', 'assets/booth-core.js', 'assets/mock-data.js']);
  const dom = new JSDOM(html, { url, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) { w.matchMedia = mm; w.scrollTo = () => {}; w.fetch = anonFetch; w.console.warn = () => {}; } });
  const errors = []; dom.window.addEventListener('error', e => errors.push(e.message));
  const d = dom.window.document;
  for (let i = 0; i < 80; i++) { await wait(75); if (!d.getElementById('v-confirm').hidden || !d.getElementById('v-msg').hidden) break; }
  await wait(150);
  return { dom, d, errors, shown: !d.getElementById('v-confirm').hidden ? 'confirm' : (!d.getElementById('v-msg').hidden ? 'msg' : 'none') };
}
const click = (dom, el) => el && el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

// ══ 0. 준비 — 지금 Production 과 같은 단계 ═════════════════════════════════════
let r = await R.run(readFileSync(resolve(REPO, 'supabase/migration-booth-preview.sql'), 'utf8'));
t('0-1 migration-booth-preview', r.ok, r.error || '');
r = await R.run(SQL3('C-02-transition.sql')); t('0-2 C-02 전환(파일 그대로)', r.ok, r.error || '');
r = await R.run(SQL3('Q-02-qr-preissue.sql')); t('0-3 Q-02 실제 84 QR 사전 발급(파일 그대로)', r.ok, r.error || '');
r = await R.run(readFileSync(resolve(HERE, 'dryrun/replica-functions-extra.sql'), 'utf8')); t('0-4 Production 함수 보충(touch · 직접 고치기 · 모두 지우기)', r.ok, r.error || '');
// Production 함수 본문 지문(2026-10-16 · MCP 읽기 전용 · md5(pg_get_functiondef) — 줄 끝 CR 을 뺀 값.
// booth_preview_list 는 SQL Editor 에 Windows 파일을 붙여 만들어 본문 줄 끝이 CRLF 입니다(내용은 같음).
const PROD_MD5 = { admin_booth_access: '1ef3298cd2ea3b8d977dca47e95dff68', admin_issue_booth_tokens: 'a63bd7f54a161ecfefe6bdc2653c4304',
  admin_reset_booth_live: '5f6ed44f10ddb5110fc94d2473fd3030', admin_rotate_booth_token: 'ddbf92b602ea361753b4d698480f6a14',
  admin_set_booth_live: '2a914a1413d39f12085333a73dddf404', booth_ctrl_get: '10355a74877bfa99f2595bdb155981d3',
  booth_ctrl_set: '4420bf06f1330e9653fa31c03e5c96f7', booth_ctrl_touch: '37276258653ede4a09688cc75e4341f6',
  booth_preview_list: 'aa88e946e418f160300aa9b6741304c5', booths_before_write: '290995f381a65c9a475d264b89f73b6b' };
const repMd5 = Object.fromEntries((await db.query(`select proname, md5(replace(pg_get_functiondef(oid), chr(13), '')) m from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)`, [Object.keys(PROD_MD5)])).rows.map(x => [x.proname, x.m]));
const diffFns = Object.keys(PROD_MD5).filter(k => repMd5[k] !== PROD_MD5[k]);
t('0-5 복제 DB 함수 10개 본문 = Production(md5 · 줄 끝 CR 제외)', !diffFns.length, diffFns.join(',') || '10/10');
let st = await one(`select (select count(*) from public.booths) b, (select count(*) from public.booths where is_published) p, (select count(*) from public.booths where preview_listed) pv,
  (select count(*) from public.zones where is_published) zp, (select count(*) from public.booth_access) a, (select count(*) from public.booth_access where booth_id = any($1::uuid[])) ra`, [targets.realIds]);
t('0-6 출발 상태 = Production 지금(부스 134 · 공개 0 · 사전 안내 84 · 공개 구역 0 · QR 134 · 실제 QR 84)',
  +st.b === 134 && +st.p === 0 && +st.pv === 84 && +st.zp === 0 && +st.a === 134 && +st.ra === 84, JSON.stringify(st));
const fileSha = f => sha256(SQL4(f));
const rep = readFileSync(resolve(G4, 'build-report.md'), 'utf8');
t('0-7 시험하는 SQL 파일 = 빌드 보고서의 해시(T-02 · T-03)', rep.includes(fileSha('T-02-assign.sql')) && rep.includes(fileSha('T-03-publish.sql')));
const QR0 = await qrFp(), EX0 = await exFp();

// 처음 인쇄(배치 미정 카드) — 이 QR 이 끝까지 그대로여야 합니다
let p0 = await printPage();
const printed0 = readOps(p0);
close(p0);
const tk0 = await tokens();
t('0-8 처음 인쇄 화면: 실제 84 카드 · 모두 배치 미정 · 84장 QR 을 다시 읽어 그 부스 열쇠와 같음',
  printed0.size === 84 && [...printed0.values()].every(v => v.unplaced) && [...printed0].every(([id, v]) => OP_RE.exec(v.url || '')?.[1] === tk0.get(id)), `${printed0.size}장`);

// ══ 1. T-01 직전 확인 ═══════════════════════════════════════════════════════
const t01 = (await db.query(SQL4('T-01-precheck.sql'))).rows[0];
t('1-1 T-01: 실제 84 · 공개/배정 0 · 사전 안내 84 · 예시 비공개 50 · R1~R4 없음 · 쓰는 부스 0 · 공개 구역 0 · QR 134/84 · 열리는 QR 0',
  +t01['실제'] === 84 && +t01['실제_공개_또는_배정'] === 0 && +t01['실제_사전안내'] === 84 && +t01['예시_비공개'] === 50 && +t01['예시_ae_자리'] === 50
  && +t01['임시구역_이미있음'] === 0 && +t01['임시구역_사용부스'] === 0 && +t01['공개_구역'] === 0 && +t01['qr_전체'] === 134 && +t01['실제_qr'] === 84 && +t01['열리는_qr'] === 0,
  JSON.stringify(t01).replace(/"qr_지문":"[0-9a-f]+",?/, ''));

// ══ 2. 가드 — 틀린 상태에서는 아무것도 바꾸지 않고 멈춤 ══════════════════════════
async function mustAbort(name, sql, re, arrange, undo) {
  if (arrange) await db.exec(arrange);
  const before = await dbFp();
  const x = await R.run(sql);
  const after = await dbFp();
  if (undo) await db.exec(undo);
  t(name, !x.ok && re.test(x.error || '') && before === after, (x.error || 'OK?').split('\n')[0].slice(0, 90));
}
await mustAbort('2-1 T-03 을 T-02 보다 먼저 → 중단 · 변화 없음', SQL4('T-03-publish.sql'), /T-02 배정이 배치안대로가 아닙니다/);
await mustAbort('2-2 R2 구역이 이미 있으면 T-02 중단', SQL4('T-02-assign.sql'), /임시 구역 코드\(R2\)가 이미 있습니다/,
  "insert into public.zones (key, label, sort_order) values ('R2', '누가 만든 R2', 30);", "delete from public.zones where key = 'R2';");
await mustAbort('2-3 실제 부스 하나가 이미 배정돼 있으면 T-02 중단', SQL4('T-02-assign.sql'), /이미 공개되었거나 구역 · 번호가 있는 곳/,
  `update public.booths set zone_key = 'F', no = 1 where id = '${idOf('S10')}';`, `update public.booths set zone_key = null, no = null where id = '${idOf('S10')}';`);
await mustAbort('2-4 예시 부스가 공개돼 있으면 T-02 중단(예시는 건드리지 않음)', SQL4('T-02-assign.sql'), /예시 부스 · 예시 구역\(A~E\) 중 공개된 것/,
  "update public.zones set is_published = true where key = 'A';", "update public.zones set is_published = false where key = 'A';");
t('2-5 가드 시험 뒤 상태 = 처음(QR · 예시 지문)', await qrFp() === QR0 && await exFp() === EX0);

// ══ 3. T-02 임시 구역 + 배정(비공개) ═════════════════════════════════════════
r = await R.run(SQL4('T-02-assign.sql'));
t('3-1 T-02 실행 성공', r.ok, r.error || JSON.stringify(r.last));
const res2 = r.last && (r.last['결과'] || r.last);
t('3-2 결과 줄: 부스 134 · 공개 0 · 배치안대로 84 · R1~R4 비공개 · 사전 안내 84 · 열리는 QR 0',
  res2 && res2.booths === 134 && res2.published === 0 && res2.real_at_plan === 84 && res2.zones === 'R1:false,R2:false,R3:false,R4:false' && res2.preview === 84 && res2.operator_qr_open === 0, JSON.stringify(res2));
const codes = (await db.query(`select id::text, zone_key, no, code from public.booths where id = any($1::uuid[])`, [targets.realIds])).rows;
t('3-3 84곳 구역 · 번호 · 표시 코드 = 배치안(R1: S01~S21 … R4: S64~S84 · 01~21)', codes.length === 84 && codes.every(x => { const p = planById.get(x.id); return p && x.zone_key === p.zone && +x.no === p.no && x.code === p.code; }));
t('3-4 QR · 예시 그대로', await qrFp() === QR0 && await exFp() === EX0);
let s = await snapshotAt();
t('3-5 관람객 API 그대로(비공개라): 부스 0 · 배치 준비 중 84', s.json.booths.length === 0 && s.json.unplaced.length === 84);
const fp3 = await dbFp();
r = await R.run(SQL4('T-02-assign.sql'));
t('3-6 T-02 한 번 더 → "이미 적용" · 바꾼 것 없음', r.ok && r.notices.some(n => /이미 적용/.test(n)) && await dbFp() === fp3, r.notices.join(' | '));
let c = await ctrl(printed0.get(idOf('S01')).url);
t('3-7 공개 전: S01 카드 QR → "이 QR은 지금 쓸 수 없어요"(운영자 화면 안 열림)', c.shown === 'msg' && /지금 쓸 수 없어요/.test(text(c.d.getElementById('v-msg'))), c.shown);
close(c);

// ══ 4. T-03 공개 ═════════════════════════════════════════════════════════════
r = await R.run(SQL4('T-03-publish.sql'));
t('4-1 T-03 실행 성공', r.ok, r.error || '');
const res3 = r.last && (r.last['결과'] || r.last);
t('4-2 결과 줄: 공개 84 · 배치안대로 84 · R1~R4 공개 · 사전 안내 0 · 열리는 QR 84',
  res3 && res3.published === 84 && res3.real_published === 84 && res3.zones === 'R1:true,R2:true,R3:true,R4:true' && res3.preview === 0 && res3.operator_qr_open === 84, JSON.stringify(res3));
st = await one(`select (select string_agg(key, ',' order by key) from public.zones where is_published) zp,
  (select count(*) from public.booths where is_published and org ~ '^\\s*\\[예시\\]') exp`);
t('4-3 공개 구역 = R1~R4 뿐(A~J 비공개 그대로) · 예시 공개 0', st.zp === 'R1,R2,R3,R4' && +st.exp === 0, st.zp);
t('4-4 QR · 예시 그대로(공개해도 열쇠 같음)', await qrFp() === QR0 && await exFp() === EX0);
const fp4 = await dbFp();
r = await R.run(SQL4('T-03-publish.sql'));
t('4-5 T-03 한 번 더 → "이미 공개" · 바꾼 것 없음', r.ok && r.notices.some(n => /이미 공개/.test(n)) && await dbFp() === fp4);
const t04 = (await db.query(SQL4('T-04-verify.sql'))).rows[0];
t('4-6 T-04: 다른 공개 구역 0 · 실제 밖 공개 0 · 실제 대기 값 0 · QR 지문 = T-01', +t04['다른_공개구역'] === 0 && +t04['실제밖_공개부스'] === 0 && +t04['실제_대기값'] === 0 && t04['qr_지문'] === t01['qr_지문']);

// ══ 4b. 되돌리기 파일(비상용) — 실행해 보고 다시 공개 상태로 ═══════════════════════
await mustAbort('4b-1 공개 뒤 T-09a(배정 되돌리기) → 중단(공개 전 전용)', SQL4('T-09a-unassign.sql'), /이미 공개된 부스가 있습니다/);
r = await R.run(SQL4('T-09b-unpublish.sql'));
let rb = r.last && (r.last['결과'] || r.last);
t('4b-2 T-09b(공개 되돌리기) → 공개 0 · R1~R4 비공개 · 사전 안내 84 · 열리는 QR 0 · 배정은 그대로 · QR 그대로',
  r.ok && rb.published === 0 && rb.zones === 'R1:false,R2:false,R3:false,R4:false' && rb.preview === 84 && rb.operator_qr_open === 0 && rb.real_at_plan === 84 && await qrFp() === QR0, r.error || JSON.stringify(rb));
s = await snapshotAt();
t('4b-3 T-09b 뒤 관람객 API: 부스 0 · 배치 준비 중 84(번호 없이)', s.json.booths.length === 0 && s.json.unplaced.length === 84);
r = await R.run(SQL4('T-09a-unassign.sql'));
rb = r.last && (r.last['결과'] || r.last);
t('4b-4 이어서 T-09a(배정 되돌리기) → 84곳 배치 미정 · R1~R4 행은 남김(비공개) · QR 그대로',
  r.ok && rb.real_at_plan === 0 && rb.zones === 'R1:false,R2:false,R3:false,R4:false' && rb.preview === 84 && await qrFp() === QR0 && await exFp() === EX0, r.error || JSON.stringify(rb));
const zc4 = +(await one(`select count(*) n from public.zones`)).n;
r = await R.run(SQL4('T-02-assign.sql'));
rb = r.last && (r.last['결과'] || r.last);
t('4b-5 남은 R1~R4(이 배치안이 만든 빈 비공개 구역)를 그대로 다시 써서 T-02 → 배치안대로 84 · 구역 행 수 그대로(새로 만들거나 지우지 않음)',
  r.ok && rb.real_at_plan === 84 && rb.published === 0 && +(await one(`select count(*) n from public.zones`)).n === zc4 && await qrFp() === QR0, r.error || JSON.stringify(rb));
r = await R.run(SQL4('T-03-publish.sql'));
t('4b-6 다시 T-03 → 공개 84 · QR · 예시 그대로', r.ok && (r.last['결과'] || r.last).published === 84 && await qrFp() === QR0 && await exFp() === EX0, r.error || '');

// ══ 5. 공개 뒤 화면 ══════════════════════════════════════════════════════════
s = await snapshotAt();
const LABEL = zones[0].label.replace(/^R1 /, '');   // 공통 말 · 구역 이름은 'R1 ' + 이 말
const zLabel = z => `${z} ${LABEL}`;
t('5-1 관람객 API: 부스 84(모두 실제) · 배치 준비 중 0 · 구역 4(R1~R4 · 이름)',
  s.json.booths.length === 84 && s.json.unplaced.length === 0 && s.json.zones.map(z => z.key).join() === 'R1,R2,R3,R4' && s.json.zones.every(z => z.label === zLabel(z.key)));
t('5-2 관람객 API: 부스마다 코드 · 구역 = 배치안 · 대기 값 없음(행사 전)', s.json.booths.every(b => { const p = planById.get(b.id); return p && b.code === p.code && b.zone === p.zone && b.status === null; }));
const allTk = [...(await tokens()).values()];
t('5-3 관람객 API 에 열쇠 · #k= 없음', allTk.every(tk => !JSON.stringify(s.json).includes(tk)) && !/#k=/.test(JSON.stringify(s.json)));
let v = await visitor(s.json);
const heads = [...v.d.querySelectorAll('#list .zone')].map(text);
const tabs = [...v.d.querySelectorAll('#tabs .tab')].map(text);
t('5-4 관람객 화면: 84줄 · 구역 제목 4개 "R1 실제 위치 아닌 리허설용 임시구역 21곳" …',
  v.d.querySelectorAll('#list .row').length === 84 && heads.length === 4 && heads.every((h, i) => h.startsWith(zLabel(`R${i + 1}`)) && /21곳/.test(h)), heads[0]);
t('5-5 구역 탭: 전체 84 · R1 임시구역 21 · R2 … R4', tabs.join('|') === '전체84|R1 임시구역21|R2 임시구역21|R3 임시구역21|R4 임시구역21', tabs.join('|'));
t('5-6 첫 줄 R1-01 · S01 부스 · 학교 / 끝 줄 R4-21 · S84',
  text(v.d.querySelector('#list .row .row__code')) === 'R1-01' && text(v.d.querySelector('#list .row .row__name')) === docs[0].name
  && text([...v.d.querySelectorAll('#list .row .row__code')].pop()) === 'R4-21');
t('5-7 행사 전: 대기 값 칸 비어 있음 · 큰 글씨 "개막까지 D-" · 배치 준비 중 묶음 없음 · 오류 0',
  [...v.d.querySelectorAll('#list .row__right')].every(x => !text(x)) && /개막까지\s*D-\d+/.test(text(v.d.getElementById('hero'))) && v.d.getElementById('pending').hidden && !v.errors.length, v.errors.join(' | '));
if (dumpDir) dump(v.d, 'visitor-R-published', liveDir, linksOf(liveDir, 'visitor.html'));
t('5-8 검색 "R1-07" → R1-07 하나', (await search(v, 'R1-07')).join() === 'R1-07');
t('5-9 검색 "r107"(붙여 씀) → R1-07 하나', (await search(v, 'r107')).join() === 'R1-07');
t('5-10 검색 "서운"(학교) → 1곳', (await search(v, '서운')).length === 1);
t('5-11 검색 "임시구역"(구역 이름) → 84곳', (await search(v, '임시구역')).length === 84);
const loose = await search(v, 'R1-7');
info('5-12 검색 "R1-7"(앞 0 뺌)', loose.length ? loose.join(',') : '0곳 — 구역 코드에 숫자가 있는 R1~R4 는 앞 0 을 뺀 검색이 안 맞습니다("R1-07" · "r107" 은 됨)');
close(v);
// 포털
let pt = await portal('#home');
const homeStat = text(pt.d.querySelector('.stat--booth')); close(pt);
t('5-13 포털 홈: 전체 부스 84 · 부스 현황 보기', /^84\s*전체 부스\s*부스 현황 보기/.test(homeStat.replace(/→/, '').trim()), homeStat);
pt = await portal('#booths');
const chips = [...pt.d.querySelectorAll('.filterrow')].map(text).join(' / ');
t('5-14 포털 부스 현황: 카드 84 · 첫 R1-01 · 구역 칩(전체 + R1~R4 이름) · 배치 확정 전 안내 없음 · 오류 0',
  pt.d.querySelectorAll('.boothgrid .booth').length === 84 && text(pt.d.querySelector('.boothgrid .booth__code')) === 'R1-01'
  && ['R1', 'R2', 'R3', 'R4'].every(k => chips.includes(zLabel(k))) && !/부스 배치 확정 전/.test(text(pt.d.getElementById('main'))) && !pt.errors.length, chips.slice(0, 80));
if (dumpDir) dump(pt.d, 'portal-R-booths', mainDir, `<link rel="stylesheet" href="assets/portal.css">`);
close(pt);
// 인쇄
let p1 = await printPage();
const printed1 = readOps(p1);
t('5-15 인쇄 화면: 실제 84 카드에 R 코드 · 배치 미정 0', printed1.size === 84 && [...printed1].every(([id, x]) => !x.unplaced && x.text.includes(planById.get(id).code)));
t('5-16 인쇄 화면 84장 QR = 처음(배치 미정) 인쇄한 QR 과 글자 하나 다르지 않음', [...printed1].every(([id, x]) => x.url && x.url === printed0.get(id).url));
const signs = [...p1.d.querySelectorAll('.item--sign')].filter(el => planById.has(el.getAttribute('data-id')));
const signOk = signs.filter(el => decodeBox(el.querySelector('[data-qr]')) === 'https://incheon-live.vercel.app/?b=' + el.getAttribute('data-id')).length;
t('5-17 부스 앞 안내(관람객용) 84장 · QR = ?b=부스UUID(열쇠 없음)', signs.length === 84 && signOk === 84, `${signs.length}장 · ${signOk}`);
t('5-18 인쇄 화면 HTML 에 열쇠 글 없음 · 발급 · 교체 · 끄기 호출 없음', allTk.every(tk => !p1.d.documentElement.outerHTML.includes(tk)) && !p1.log.some(x => /admin_(issue|rotate|disable)_booth_token/.test(x)));
if (dumpDir) {
  const d = p1.d, keep = new Set([idOf('S01'), idOf('S04'), idOf('S22')]);
  d.querySelectorAll('.item').forEach(el => { if (!keep.has(el.getAttribute('data-id'))) el.remove(); });
  dump(d, 'print-R-cards', mainDir, linksOf(mainDir, 'print-qr.html'));
}
close(p1);

// ══ 6. 실제 QR 84개로 운영자 접속 · 입력 ══════════════════════════════════════
let okGet = 0, okSet = 0, okTouch = 0;
for (const [id, x] of printed1) {
  const tk = OP_RE.exec(x.url)[1];
  const g = await anon('booth_ctrl_get', [tk]);
  if (g.rows && g.rows.length === 1 && g.rows[0].booth_id === id && g.rows[0].code === planById.get(id).code && g.rows[0].zone_label === zLabel(planById.get(id).zone)) okGet++;
  const w = 5 * ((planById.get(id).no % 6) + 1);
  const sset = await anon('booth_ctrl_set', [tk, 'open', w]);
  if (sset.rows && sset.rows[0] && sset.rows[0].wait_minutes === w) okSet++;
  const th = await anon('booth_ctrl_touch', [tk]);
  if (th.rows && th.rows[0] && th.rows[0].booth_id === id) okTouch++;
}
t('6-1 인쇄한 QR 84개 모두 운영자 접속(booth_ctrl_get) → 그 부스 · 배치안 코드 · 구역 이름', okGet === 84, `${okGet}/84`);
t('6-2 84개 모두 대기 값 입력(booth_ctrl_set) · "지금 확인"(touch) 성공', okSet === 84 && okTouch === 84, `${okSet} · ${okTouch}`);
const exTk = (await db.query(`select a.token from public.booth_access a join public.booths b on b.id = a.booth_id where b.org ~ '^\\s*\\[예시\\]'`)).rows.map(x => x.token);
let exRej = 0;
for (const tk of exTk) { const g = await anon('booth_ctrl_get', [tk]); if (g.err || !g.rows.length) exRej++; }
t('6-3 예시 50 의 QR 은 여전히 안 열림', exRej === 50, `${exRej}/50`);
ctrlCalls.length = 0;
let uiOk = 0;
const UI = ['S01', 'S04', 'S21', 'S22', 'S84'];
for (const dk of UI) {
  const id = idOf(dk), p = planById.get(id);
  c = await ctrl(printed1.get(id).url);
  const okConfirm = c.shown === 'confirm' && text(c.d.getElementById('cf-code')).includes(p.code) && text(c.d.getElementById('cf-name')) === p.name && text(c.d.getElementById('cf-org')).includes(zLabel(p.zone));
  click(c.dom, c.d.getElementById('cf-yes'));
  await wait(200);
  click(c.dom, c.d.querySelector('.w[data-wait="20"]'));
  await wait(700);
  const live = await one('select congestion, wait_minutes from public.booth_live where booth_id = $1', [id]);
  if (okConfirm && live && +live.wait_minutes === 20 && !c.errors.length) uiOk++;
  if (dumpDir && dk === 'S04') dump(c.d, 'ctrl-R-S04', liveDir, linksOf(liveDir, 'booth-ctrl.html'));
  close(c);
}
t('6-4 운영자 화면(실제 화면 코드): S01 · S04(공동) · S21 · S22 · S84 — 확인 화면 코드 · 부스 · 구역 이름 → "맞아요" → 20분 눌러 저장', uiOk === UI.length, `${uiOk}/${UI.length}`);
t('6-5 운영자 화면이 부른 것: booth_ctrl_get · booth_ctrl_set 만(열쇠 · PIN 관리 호출 없음)', ctrlCalls.some(x => /booth_ctrl_set/.test(x)) && !ctrlCalls.some(x => /admin_|booth_pin/.test(x)));

// ══ 7. 행사 전 리허설 표시 · 행사 날 공개 API 보호(2026-10-19 리허설 규칙) ══════════════════
// 예전 기준(행사 전 실제 값 비노출)은 리허설 기능으로 바뀌었습니다: 행사 전에는 오늘 넣은 값을 '리허설 중' 띠와 함께,
// 행사 날에는 운영 시간 · 그날 문 연 뒤 값만 — 공개 API 가 직접 거릅니다.
st = await one(`select count(*) n from public.booth_live where booth_id = any($1::uuid[])`, [targets.realIds]);
s = await snapshotAt();
t('7-1 지금(10월 · 행사 전): 오늘 넣은 실제 대기 값 84줄 → 관람객 API 84곳 모두 값(리허설)', +st.n === 84 && s.json.booths.filter(b => b.status !== null).length === 84);
close(v); v = await visitor(s.json);
t('7-2 관람객 화면(행사 전): “리허설 중 · 실제 대기시간이 아닙니다.” 띠 · 대기 칸에 값', !v.d.getElementById('rhbar').hidden && [...v.d.querySelectorAll('#list .row__right')].every(x => !!text(x)));
s = await snapshotAt(KST('2026-11-05T23:30:00'));
t('7-3 11-05 23:30: 값을 넣은 날(10-19)이 지나 관람객 API 대기 값 0(23시 초기화가 빠져도 다음 날엔 안 나감)', s.json.booths.every(b => b.status === null));
s = await snapshotAt(KST('2026-11-06T00:30:00'));
const exposed = s.json.booths.filter(b => b.status !== null).length;
t('7-4 11-06 00:30(행사 날 · 문 열기 전): 남은 값이 있어도 관람객 API 대기 값 0', exposed === 0 && +(await one(`select count(*) n from public.booth_live where booth_id = any($1::uuid[])`, [targets.realIds])).n === 84, `${exposed}곳`);
close(v); v = await visitor(s.json, KST('2026-11-06T00:30:00'));
t('7-5 그래도 관람객 화면(00:30 · 문 열기 전)은 대기 칸을 그리지 않음', [...v.d.querySelectorAll('#list .row__right')].every(x => !text(x)));
s = await snapshotAt(KST('2026-11-06T10:30:00'));
close(v); v = await visitor(s.json, KST('2026-11-06T10:30:00'));
const rights = [...v.d.querySelectorAll('#list .row__right')].map(text);
t('7-6 11-06 10:30: 10:00 전에 들어온 값은 공개 API 에서 빠지고 화면은 "정보 없음"(84곳 모두)', s.json.booths.every(b => b.status === null) && rights.length === 84 && rights.every(x => x === '정보 없음'), rights[0]);
await db.query(`update public.booth_live set updated_at = $2 where booth_id = $1`, [idOf('S01'), new Date(KST('2026-11-06T10:20:00')).toISOString()]);
s = await snapshotAt(KST('2026-11-06T10:30:00'));
close(v); v = await visitor(s.json, KST('2026-11-06T10:30:00'));
const r01 = text([...v.d.querySelectorAll('#list .row')].find(li => text(li.querySelector('.row__code')) === 'R1-01').querySelector('.row__right'));
t('7-7 11-06 10:20 에 입력한 값은 10:30 에 보임(R1-01 · 20분)', /20\s*분/.test(r01), r01);

// ══ 8. 리허설 종료 → 초기화 → 새 입력 감시 → 다시 초기화 ══════════════════════════
const logBefore = await one('select count(*) n, max(id) m from public.booth_live_log');
const del = (await admin('select public.admin_reset_booth_live() n')).rows[0].n;
st = await one('select (select count(*) from public.booth_live) live, (select count(*) n from public.booth_live_log) logn');
t('8-1 실시간 값 모두 지우기: 지운 줄 134(실제 84 + 예시 50) · 대기 값 0 · 대기 기록 그대로', +del === 134 && +st.live === 0 && +st.logn === +logBefore.n, `지움 ${del}`);
const L0 = (await one('select max(id) m from public.booth_live_log')).m;
const s01tk = OP_RE.exec(printed1.get(idOf('S01')).url)[1];
const th = await anon('booth_ctrl_touch', [s01tk]);
t('8-2 초기화 뒤 "지금 확인"(touch) → "아직 입력한 값이 없습니다" · 기록 안 남음', /아직 입력한 값이 없습니다/.test(th.err || '') && (await one('select max(id) m from public.booth_live_log')).m === L0);
await anon('booth_ctrl_set', [OP_RE.exec(printed1.get(idOf('S05')).url)[1], 'open', 10]);
const stray = (await db.query(`select b.code, count(*) n from public.booth_live_log g join public.booths b on b.id = g.booth_id where g.id > $1 group by b.code`, [L0])).rows;
t('8-3 감시 쿼리: 초기화 뒤 새 입력 1건(R1-05) 찾아냄', stray.length === 1 && stray[0].code === 'R1-05', JSON.stringify(stray));
await admin('select public.admin_reset_booth_live()');
t('8-4 다시 초기화 → 대기 값 0 · QR 그대로', +(await one('select count(*) n from public.booth_live')).n === 0 && await qrFp() === QR0);
s = await snapshotAt(KST('2026-11-06T10:30:00'));
close(v); v = await visitor(s.json, KST('2026-11-06T10:30:00'));
t('8-5 행사 날 10:30 관람객 화면: 84곳 모두 "정보 없음"에서 시작', [...v.d.querySelectorAll('#list .row__right')].map(text).every(x => x === '정보 없음'));

// ══ 9. 최종 재배정(시험용 가짜 최종안) — 같은 부스 · 같은 QR ════════════════════════
const meta = { realIds: docs.map(m => m.booth_id), exampleIds: targets.exampleIds, exampleZones: targets.exampleZones,
  sha256: manifestSha(resolve(OUT, 'staging', 'manifest.csv')), planName: '시험 최종안', planSha: 'test', generatedAt: 'test' };
const finalZones = [
  { key: 'SW', label: '스쿨존 웨이브홀(시험)', sub: '', order: 21, from: 1, to: 42 },
  { key: 'F', label: '체험관 1층(시험)', sub: '', order: 22, from: 101, to: 142 }];
const finalPlan = docs.map((m, i) => i < 42
  ? { id: m.booth_id, zone: 'SW', no: 42 - i, code: codeOf('SW', 42 - i) }
  : { id: m.booth_id, zone: 'F', no: 101 + (i - 42), code: codeOf('F', 101 + (i - 42)) });
const fwd = moveSqls(meta, { name: '시험 최종안', fromKeys: zones.map(z => z.key), plan: finalPlan, zones: finalZones });
// 리허설 값이 있는 채로 옮겨 봅니다(값 · 기록 그대로여야 함)
for (const dk of ['S02', 'S50']) await anon('booth_ctrl_set', [OP_RE.exec(printed1.get(idOf(dk)).url)[1], 'open', 30]);
const live9 = await one(`select md5(string_agg(row_to_json(l)::text, ',' order by l.booth_id)) fp, count(*) n from public.booth_live l`);
// 가드
const bad = (name, mv) => moveSqls(meta, { name, fromKeys: zones.map(z => z.key), ...mv }).run;
await mustAbort('9-1 최종안 구역이 R2(보내는 구역)와 겹치면 중단', bad('겹침', { plan: finalPlan.map(p => p.zone === 'SW' ? { ...p, zone: 'R2', code: codeOf('R2', p.no) } : p), zones: [{ ...finalZones[0], key: 'R2' }, finalZones[1]] }), /받는 구역과 보내는 구역이 겹칩니다/);
await mustAbort('9-2 최종안에 A(예시 구역)가 있으면 중단', bad('A', { plan: finalPlan.map(p => p.zone === 'SW' ? { ...p, zone: 'A', code: codeOf('A', p.no) } : p), zones: [{ ...finalZones[0], key: 'A' }, finalZones[1]] }), /예시 구역\(A~E\)/);
await mustAbort('9-3 같은 구역 번호 중복이면 중단', bad('중복', { plan: finalPlan.map((p, i) => i === 1 ? { ...p, no: 42, code: 'SW-42' } : p), zones: finalZones }), /같은 구역 번호 중복/);
await mustAbort('9-4 83곳만 있는 최종안이면 중단', bad('83', { plan: finalPlan.slice(0, 83), zones: finalZones }), /실제 84곳과 정확히 같지 않습니다/);
t('9-5 가드 뒤 QR · 예시 · 대기 값 그대로', await qrFp() === QR0 && await exFp() === EX0 && (await one(`select md5(string_agg(row_to_json(l)::text, ',' order by l.booth_id)) fp from public.booth_live l`)).fp === live9.fp);
const f01 = (await db.query(fwd.pre)).rows[0];
t('9-6 F-01: 실제 공개 84 · 보내는 구역 안 84 · 받는 구역 부스 0(F 는 빈 구역) · 열리는 QR 84',
  +f01['실제_공개'] === 84 && +f01['보내는구역_안'] === 84 && +f01['받는구역_부스'] === 0 && +f01['열리는_qr'] === 84 && /F:false/.test(f01['받는구역_이미있음'] || ''), JSON.stringify(f01).replace(/"qr_지문":"[0-9a-f]+",?/, ''));
r = await R.run(fwd.run);
t('9-7 F-02 옮기기 성공', r.ok, r.error || '');
const res9 = r.last && (r.last['결과'] || r.last);
t('9-8 결과 줄: 공개 84 · 최종안대로 84 · SW · F 공개 · R1~R4 비공개 부스 0 · 사전 안내 0 · 열리는 QR 84',
  res9 && res9.published === 84 && res9.real_at_plan === 84 && res9.to_zones === 'SW:true,F:true' && res9.from_zones === 'R1:false:0,R2:false:0,R3:false:0,R4:false:0' && res9.preview === 0 && res9.operator_qr_open === 84, JSON.stringify(res9));
t('9-9 QR · 예시 · 대기 값(리허설 값) · 기록 그대로', await qrFp() === QR0 && await exFp() === EX0 && (await one(`select md5(string_agg(row_to_json(l)::text, ',' order by l.booth_id)) fp from public.booth_live l`)).fp === live9.fp);
st = await one(`select (select string_agg(key || ':' || label, ',' order by key) from public.zones where key in ('F','G','H','I','J')) fj, (select string_agg(key, ',' order by key) from public.zones where is_published) zp`);
t('9-10 빈 구역 F 는 새로 만들지 않고 이름만 고쳐 공개 · G~J 그대로 · 공개 구역 = F · SW', /F:체험관 1층\(시험\),G:G구역,H:H구역,I:I구역,J:J구역/.test(st.fj) && st.zp === 'F,SW', `${st.fj} / ${st.zp}`);
const fp9 = await dbFp();
r = await R.run(fwd.run);
t('9-11 F-02 한 번 더 → "이미 적용" · 바꾼 것 없음', r.ok && r.notices.some(n => /이미 적용/.test(n)) && await dbFp() === fp9);
s = await snapshotAt();
t('9-12 관람객 API: 84곳 새 코드(S01 → SW-42 · S84 → F-142) · 구역 SW · F · R 코드 없음',
  s.json.booths.length === 84 && s.json.booths.find(b => b.id === idOf('S01')).code === 'SW-42' && s.json.booths.find(b => b.id === idOf('S84')).code === 'F-142'
  && !JSON.stringify(s.json).includes('"R1') && s.json.zones.map(z => z.key).sort().join() === 'F,SW');
close(v); v = await visitor(s.json);
t('9-13 관람객 화면: 84줄 · 구역 제목 2개(시험 이름) · "임시구역" 글 없음 · 오류 0',
  v.d.querySelectorAll('#list .row').length === 84 && v.d.querySelectorAll('#list .zone').length === 2 && !/임시구역/.test(text(v.d.getElementById('list'))) && !v.errors.length);
c = await ctrl(printed0.get(idOf('S01')).url);
t('9-14 처음 인쇄한 S01 카드(배치 미정 때 QR) → 운영자 화면이 새 코드 SW-42 로 열림', c.shown === 'confirm' && text(c.d.getElementById('cf-code')).includes('SW-42'), text(c.d.getElementById('cf-code')));
close(c); close(v);
let okFinal = 0;
for (const [id, x] of printed0) { const g = await anon('booth_ctrl_get', [OP_RE.exec(x.url)[1]]); const p = finalPlan.find(f => f.id === id); if (g.rows && g.rows[0] && g.rows[0].code === p.code) okFinal++; }
t('9-15 처음 인쇄한 QR 84개 모두 새 코드로 접속', okFinal === 84, `${okFinal}/84`);
const p2 = await printPage();
const printed2 = readOps(p2);
close(p2);
t('9-16 인쇄 화면: 카드 코드만 새 번호 · QR 84장은 처음 인쇄와 글자 하나 다르지 않음',
  [...printed2].every(([id, x]) => x.url === printed0.get(id).url && x.text.includes(finalPlan.find(f => f.id === id).code)), `${printed2.size}장`);

// 되돌리기(최종 → R) 와 다시 앞으로
const back = moveSqls(meta, { name: '되돌리기(최종 → R)', fromKeys: finalZones.map(z => z.key), plan: plan.map(p => ({ id: p.id, zone: p.zone, no: p.no, code: p.code })), zones });
r = await R.run(back.run);
const resB = r.last && (r.last['결과'] || r.last);
t('9-17 되돌리기(최종 → R1~R4) 성공 · R 공개 · SW · F 비공개 · QR 그대로',
  r.ok && resB.real_at_plan === 84 && resB.to_zones === 'R1:true,R2:true,R3:true,R4:true' && /^F:false:0,SW:false:0$|^SW:false:0,F:false:0$/.test(resB.from_zones) && await qrFp() === QR0, r.error || JSON.stringify(resB));
r = await R.run(fwd.run);
t('9-18 다시 최종안으로 옮기기 성공(SW 는 빈 비공개 구역 → 이름 그대로 다시 공개)', r.ok && (r.last['결과'] || r.last).real_at_plan === 84 && await qrFp() === QR0, r.error || '');

// ══ 10. 노출 · 기록 ══════════════════════════════════════════════════════════
const anonAcc = await rest('booth_access?select=booth_id,token&limit=1');
t('10-1 익명으로 열쇠 표 읽기 → 거절', anonAcc.status >= 400, `HTTP ${anonAcc.status}`);
const pubB = JSON.stringify((await rest('booths?select=*')).body);
t('10-2 공개 부스 표(익명) · 관람객 API 에 열쇠 없음', allTk.every(tk => !pubB.includes(tk)));
const KEY_IN_URL = '#k=[A-Za-z0-9_-]{24}';
let hits = 0;
try { hits = execFileSync('git', ['-C', REPO, 'grep', '-I', '-c', '-E', '--untracked', KEY_IN_URL], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length; } catch { hits = 0; }
t('10-3 저장소(작업 폴더 · 새 파일)에 "#k=열쇠" 모양 없음', hits === 0, `${hits}건`);
await db.close();

const pass = results.filter(x => !x.info).every(x => x.ok);
const nTest = results.filter(x => !x.info).length, nPass = results.filter(x => !x.info && x.ok).length;
const L = ['# Gate 4-R 로컬 시험 결과 — 임시 배정 → 공개 → 리허설 → 초기화 → 최종 재배정', '',
  '- DB: PGlite · PostgreSQL 17(lib/replica.mjs) — migration-booth-preview → C-02 → Q-02 → Production 함수 보충',
  `- 화면 코드: 관람객 · 운영자 · 관람객 API = ${liveDir.replace(/\\/g, '/')} · 포털 · 인쇄 = ${mainDir.replace(/\\/g, '/')}`,
  '- 시험 SQL: out/gate4r/T-01~T-04(파일 그대로) · 최종 재배정은 시험용 가짜 최종안(SW · F)으로 만든 F-01/F-02',
  '- 네트워크 · Production 접속 없음. 열쇠는 시험 DB 의 가짜 값이며 보고서에 쓰지 않음', '',
  `## 판정: ${pass ? '통과' : '실패'} (${nPass}/${nTest}) · 참고 ${results.filter(x => x.info).length}`, '', '| 결과 | 시험 | 내용 |', '|---|---|---|',
  ...results.map(x => `| ${x.info ? '참고' : x.ok ? '통과' : '**실패**'} | ${x.name} | ${String(x.note).replace(/\|/g, '\\|')} |`)];
writeFileSync(resolve(G4, 'test-report.md'), L.join('\n') + '\n');
console.log(`${pass ? 'Gate 4-R 로컬 시험 통과' : 'Gate 4-R 로컬 시험 실패'} — ${nPass}/${nTest}`);
process.exit(pass ? 0 : 1);
