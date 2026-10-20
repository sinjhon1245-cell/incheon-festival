/* ===================================================================
   Gate 3-C 운영자 QR 종단 시험 — 사전 발급(Q-02) → QR 인쇄 화면 → 찍기 → 운영자 화면
   ───────────────────────────────────────────────────────────────────
   로컬 복제 DB(lib/replica.mjs)에 migration-booth-preview.sql · C-02 · Q-02 를 고치지 않고 돌린 뒤,
   print-qr.html 을 jsdom 에서 관리자로 열고 실제 QR 생성기(qrcodejs@1.0.0 — print-qr.html 이 CDN 에서
   받는 파일과 같은 바이트인지 해시로 확인)로 카드마다 QR 을 그립니다. 그린 QR 을 jsQR 로 다시 읽어
     · 운영자 카드(① 부스 운영자용): booth-ctrl.html#k=열쇠 — 그 열쇠가 DB 에서 카드의 부스 UUID 와 이어지는지
     · 부스 앞 안내(② 관람객용): 관람객 화면 ?b=부스UUID — 열쇠가 없는지
   를 봅니다. 읽어 낸 주소 그대로 booth-ctrl.html(booth-live 작업 폴더)을 jsdom 에서 열어
     공개 전: '쓸 수 없는 QR' 안내(운영자 화면 안 열림)
     구역 · 번호 배정 + 공개 뒤: 같은 QR 로 그 부스(SW-01 · 이름 · 학교)가 열림
     번호를 바꾼 뒤(SW-07): 같은 QR 그대로 · 인쇄 화면의 QR 도 글자 하나 다르지 않음
   을 확인합니다. 열쇠가 공개 API · 저장소에 없는지도 봅니다.

   ⚠️ 네트워크 · Production 접속 없음. 열쇠는 이 시험 DB 의 가짜 값이고, 파일 · 화면 · 보고서 · 출력에
      쓰지 않습니다(개수와 참 · 거짓만).
   쓰는 법
     node scripts/booth-data/test-qr-e2e.mjs --pglite-dir <PGlite 0.4.4> --jsdom-dir <jsdom 30> \
          --qr-dir <qrcodejs@1.0.0 · jsqr@1.4.0 설치 폴더> [--live-dir <booth-live 작업 폴더>]
   결과: out/gate3c/qr-e2e-report.md
   =================================================================== */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readCsv } from './lib/csv.mjs';
import { loadPglite, openReplica } from './lib/replica.mjs';
import { makeRest, fakeSupabase } from './lib/fake-rest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT = resolve(HERE, 'out');
const G3 = resolve(OUT, 'gate3c');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const liveDir = resolve(arg('live-dir', resolve(REPO, '../incheon-festival-booth-live-preview')));
const { JSDOM } = createRequire(join(resolve(arg('jsdom-dir')), 'package.json'))('jsdom');
const qreq = createRequire(join(resolve(arg('qr-dir')), 'package.json'));
const jsQRmod = qreq('jsqr');
const jsQR = jsQRmod.default || jsQRmod;
const QR_PATH = qreq.resolve('qrcodejs/qrcode.min.js');
const QR_SRC = readFileSync(QR_PATH, 'utf8');
// https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js (print-qr.html 이 실제로 받는 파일)의 SHA-256
const QR_CDN_SHA = 'c541ef06327885a8415bca8df6071e14189b4855336def4f36db54bde8484f36';
const dumpDir = arg('dump');   // 주면 마지막 인쇄 화면의 카드 몇 장을 정적 HTML 로 남깁니다(스크린샷용 · QR 은 빗금 자리 — 열쇠 그림 없음)
const QR_TAG = '<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>';

const lib = await loadPglite(arg('pglite-dir'));
const manifest = readCsv(resolve(OUT, 'staging', 'manifest.csv'));
const snap = readCsv(resolve(OUT, readdirSync(OUT).filter(f => /^prod-snapshot-\d{8}\.csv$/.test(f)).sort().pop()));
const key = k => manifest.find(m => m.doc_key === k).booth_id;
const R = await openReplica(lib, { snap, manifest });
const db = R.db;
const rest = makeRest(R);
const SQL = f => readFileSync(resolve(G3, f), 'utf8');

const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const results = [];
function t(name, ok, note = '') { results.push({ name, ok: !!ok, note }); console.log(`${ok ? '통과' : '실패'}  ${name}${note ? '  — ' + note : ''}`); }
const wait = ms => new Promise(r => setTimeout(r, ms));
const inline = (html, dir, files) => {
  for (const p of files) {
    const src = readFileSync(join(dir, p), 'utf8').replace(/<\/script/gi, '<\\/script');
    html = html.replace(new RegExp(`<script src="${p.replace(/[.]/g, '\\.')}"></script>`), () => `<script>${src}</script>`);
  }
  return html.replace(/<link[^>]+stylesheet[^>]*>/g, '');
};
const OP_RE = /^https:\/\/incheon-live\.vercel\.app\/booth-ctrl\.html#k=([A-Za-z0-9_-]{24})$/;
const allTokens = async () => new Map((await db.query('select booth_id::text id, token from public.booth_access')).rows.map(x => [x.id, x.token]));

// ── QR 다시 읽기: qrcodejs 는 캔버스가 없으면 칸을 표(td 배경색)로 그립니다 → 칸 행렬 → 그림 → jsQR ──
function decodeBox(box) {
  const rows = box ? [...box.querySelectorAll('table tr')] : [];
  const n = rows.length;
  if (!n) return null;
  const S = 4, Q = 4, W = (n + 2 * Q) * S;
  const px = new Uint8ClampedArray(W * W * 4).fill(255);
  rows.forEach((tr, y) => [...tr.children].forEach((td, x) => {
    if (!/^(#000000|#000|rgb\(0, 0, 0\))$/i.test(td.style.backgroundColor.trim())) return;
    for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
      const i = (((y + Q) * S + dy) * W + (x + Q) * S + dx) * 4;
      px[i] = px[i + 1] = px[i + 2] = 0;
    }
  }));
  const r = jsQR(px, W, W);
  return r ? r.data : null;
}

// ── QR 인쇄 화면(관리자) ─────────────────────────────────────────────
function printHtml() {
  let html = readFileSync(resolve(REPO, 'print-qr.html'), 'utf8');
  if (!html.includes(QR_TAG)) throw new Error('print-qr.html 의 QR 생성기 주소가 바뀌었습니다 — 시험을 맞춰 주세요');
  html = html.replace(QR_TAG, () => `<script>${QR_SRC.replace(/<\/script/gi, '<\\/script')}</script>`);
  html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>/g, '');
  return inline(html, REPO, ['assets/config.js', 'assets/core.js', 'assets/booth-core.js', 'assets/mock-data.js']);
}
async function openPrint() {
  const log = [];
  const dom = new JSDOM(printHtml(), {
    url: 'https://sinjhon1245-cell.github.io/incheon-festival/print-qr.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.supabase = fakeSupabase(R, log);
      w.CanvasRenderingContext2D = undefined;   // qrcodejs 가 표로 그리게(칸을 읽을 수 있게)
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.scrollTo = () => {};
      w.print = () => {};
      w.fetch = async (u) => {
        const s = String(u), i = s.indexOf('/rest/v1/');
        if (i < 0) throw new Error('예상 밖 요청');
        const r = await rest(s.slice(i + 9));
        const body = JSON.stringify(r.body);
        return { ok: r.status < 400, status: r.status, text: async () => body, json: async () => r.body };
      };
      w.console.warn = () => {};
    }
  });
  const errors = [];
  dom.window.addEventListener('error', e => errors.push(e.message));
  for (let i = 0; i < 120; i++) {
    await wait(75);
    if (dom.window.document.querySelectorAll('.item--ops [data-qr] table').length && log.includes('rpc:admin_booth_access')) break;
  }
  await wait(600);
  return { dom, d: dom.window.document, log, errors };
}

// ── 운영자 화면(booth-ctrl.html · 익명) ─────────────────────────────────
const ctrlCalls = [];
async function anonFetch(u, init = {}) {
  const s = String(u), i = s.indexOf('/rest/v1/');
  if (i < 0) throw new Error('예상 밖 요청');
  const path = s.slice(i + 9), method = String(init.method || 'GET').toUpperCase();
  let status = 200, body;
  if (method === 'GET') { const r = await rest(path); status = r.status; body = r.body; }
  else if (path.startsWith('rpc/')) {
    const name = path.slice(4).split('?')[0];
    const args = init.body ? JSON.parse(init.body) : {};
    const keys = Object.keys(args);
    try { body = await R.asAnon(`select * from public.${name}(${keys.map((k, j) => `${k} => $${j + 1}`).join(', ')})`, keys.map(k => args[k])); }
    catch (e) { status = e.code === '42883' ? 404 : (e.code === '42501' ? 401 : 400); body = { code: e.code === '42883' ? 'PGRST202' : e.code, message: e.message }; }
  } else { status = 405; body = {}; }
  ctrlCalls.push(method + ' ' + path.split('?')[0]);
  const out = JSON.stringify(body);
  return { ok: status < 400, status, text: async () => out, json: async () => body, headers: { get: () => 'application/json' } };
}
function ctrlHtml() {
  return inline(readFileSync(join(liveDir, 'booth-ctrl.html'), 'utf8'), liveDir, ['assets/config.js', 'assets/booth-core.js', 'assets/mock-data.js']);
}
async function openCtrl(url) {
  const dom = new JSDOM(ctrlHtml(), {
    url, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.scrollTo = () => {};
      w.fetch = anonFetch;
      w.console.warn = () => {};
    }
  });
  const errors = [];
  dom.window.addEventListener('error', e => errors.push(e.message));
  const d = dom.window.document;
  for (let i = 0; i < 80; i++) {
    await wait(75);
    if (!d.getElementById('v-confirm').hidden || !d.getElementById('v-msg').hidden) break;
  }
  await wait(150);
  const shown = !d.getElementById('v-confirm').hidden ? 'confirm' : (!d.getElementById('v-msg').hidden ? 'msg' : 'none');
  return { dom, d, errors, shown };
}

// ══ 준비: migration → C-02 전환 → Q-02 사전 발급 (파일 그대로) ══════════════
t('E0-1 QR 생성기 = print-qr.html 이 받는 CDN 파일과 같은 바이트(qrcodejs@1.0.0)',
  createHash('sha256').update(readFileSync(QR_PATH)).digest('hex') === QR_CDN_SHA);
let r = await R.run(readFileSync(resolve(REPO, 'supabase/migration-booth-preview.sql'), 'utf8'));
t('E0-2 migration-booth-preview.sql', r.ok, r.error || '');
r = await R.run(SQL('C-02-transition.sql'));
t('E0-3 C-02 전환', r.ok, r.error || '');
r = await R.run(SQL('Q-02-qr-preissue.sql'));
t('E0-4 Q-02 사전 발급(84)', r.ok, r.error || '');
const realIds = new Set(manifest.map(m => m.booth_id));

// ══ E1 인쇄 화면: 실제 QR 을 그려 다시 읽기 ════════════════════════════════
let p = await openPrint();
const unCards = [...p.d.querySelectorAll('.item--ops.is-unplaced')];
t('E1-1 배치 미정 운영자 카드 84장 · 모두 실제 QR 그림', unCards.length === 84 && unCards.every(el => el.querySelector('[data-qr] table')), `${unCards.length}장`);
const printed = new Map();   // 부스 UUID → QR 에서 읽은 주소(메모리에만)
for (const el of unCards) printed.set(el.getAttribute('data-id'), decodeBox(el.querySelector('[data-qr]')));
t('E1-2 84장 모두 QR 을 다시 읽음(jsQR)', [...printed.values()].filter(Boolean).length === 84, `${[...printed.values()].filter(Boolean).length}/84`);
t('E1-3 운영자 QR 주소 = 부스 Live 사이트 booth-ctrl.html#k=열쇠(24자) · 열쇠는 # 뒤(서버 · 접속 기록에 안 남음)', [...printed.values()].every(v => OP_RE.test(v || '')));
let acc = await allTokens();
const linked = [...printed].filter(([id, v]) => realIds.has(id) && OP_RE.exec(v || '')?.[1] === acc.get(id)).length;
t('E1-4 카드마다 QR 열쇠 = DB 에서 그 카드 부스 UUID 의 열쇠 (실제 84곳)', linked === 84, `${linked}/84`);
const owners = new Map([...acc].map(([id, tk]) => [tk, id]));
const wrong = [...printed].filter(([id, v]) => owners.get(OP_RE.exec(v || '')?.[1]) !== id).length;
t('E1-5 거꾸로: QR 열쇠의 주인 부스 = 그 카드 부스 · 84개 모두 다름', wrong === 0 && new Set([...printed.values()]).size === 84);
t('E1-6 카드 글: “부스 운영자용 · 관람객용 아님” · 배치 미정 · 부스 ID = 그 UUID 앞 8자',
  unCards.every(el => /부스 운영자용/.test(text(el)) && /관람객용 아님/.test(text(el)) && /배치 미정/.test(text(el)) && text(el).includes('부스 ID ' + el.getAttribute('data-id').slice(0, 8))));
let html = p.d.documentElement.outerHTML;
t('E1-7 인쇄 화면 HTML(글 · 속성 · title)에 열쇠 없음 — QR 그림 안에만', [...acc.values()].every(tk => !html.includes(tk)));
let signs = [...p.d.querySelectorAll('.item--sign')];
t('E1-8 ② 부스 앞 안내(관람객용)에는 배치 미정 부스 없음', signs.length > 0 && !signs.some(el => realIds.has(el.getAttribute('data-id'))), `안내문 ${signs.length}장(예시)`);
const signRead = signs.slice(0, 6).map(el => [el.getAttribute('data-id'), decodeBox(el.querySelector('[data-qr]'))]);
t('E1-9 부스 앞 안내 QR = 관람객 화면 ?b=부스UUID · 열쇠 없음 · 운영자 화면 아님',
  signRead.length === 6 && signRead.every(([id, v]) => v === 'https://incheon-live.vercel.app/?b=' + id && !/#k=|booth-ctrl/.test(v)));
t('E1-10 화면을 열기만 해서는 발급 · 교체 · 끄기 없음 · 오류 없음',
  !p.log.some(x => /^rpc:admin_(issue|rotate|disable)_booth_token$/.test(x)) && !p.errors.length, p.errors.join(' | '));

// ══ E2 공개 전에 찍으면: 운영자 화면 안 열림 ═══════════════════════════════
const s13 = key('S13'), s04 = key('S04');
const m13 = manifest.find(m => m.doc_key === 'S13'), m04 = manifest.find(m => m.doc_key === 'S04');
let c = await openCtrl(printed.get(s13));
t('E2-1 공개 전 S13 카드 QR 로 열기 → “이 QR은 지금 쓸 수 없어요” · 부스 화면 안 열림',
  c.shown === 'msg' && /지금 쓸 수 없어요/.test(text(c.d.getElementById('v-msg'))) && !text(c.d.getElementById('cf-name')), c.shown);
t('E2-2 운영자 화면은 읽기만(booth_ctrl_get) · 저장 호출 없음 · 오류 없음',
  ctrlCalls.includes('POST rpc/booth_ctrl_get') && !ctrlCalls.some(x => /booth_ctrl_(set|touch)/.test(x)) && !c.errors.length, c.errors.join(' | '));

// ══ E3 구역 · 번호 배정(비공개) → 공개: 같은 QR 로 열림 ════════════════════════
await db.exec("insert into public.zones (key, label, sort_order, is_published) values ('SW', '스쿨존 웨이브홀', 20, false);");
await db.query("update public.booths set zone_key = 'SW', no = 1 where id = $1", [s13]);
await db.query("update public.booths set zone_key = 'SW', no = 2 where id = $1", [s04]);
c = await openCtrl(printed.get(s13));
t('E3-1 배정만(비공개) → 아직 안 열림', c.shown === 'msg', c.shown);
await db.exec("update public.zones set is_published = true where key = 'SW';");
await db.query('update public.booths set is_published = true where id = any($1::uuid[])', [[s13, s04]]);
acc = await allTokens();
t('E3-2 배정 · 공개해도 열쇠 그대로(인쇄한 QR 과 같음)', OP_RE.exec(printed.get(s13))[1] === acc.get(s13) && OP_RE.exec(printed.get(s04))[1] === acc.get(s04));
c = await openCtrl(printed.get(s13));
t('E3-3 공개 뒤 같은 S13 카드 QR → 확인 화면: SW-01 · 부스 이름 · 학교',
  c.shown === 'confirm' && text(c.d.getElementById('cf-code')).includes('SW-01') && text(c.d.getElementById('cf-name')) === m13.name && text(c.d.getElementById('cf-org')).includes(m13.org),
  `${c.shown} · ${text(c.d.getElementById('cf-code'))}`);
c = await openCtrl(printed.get(s04));
t('E3-4 S04 카드 QR → SW-02 · 공동 운영 학교', c.shown === 'confirm' && text(c.d.getElementById('cf-code')).includes('SW-02') && text(c.d.getElementById('cf-name')) === m04.name && text(c.d.getElementById('cf-org')).includes(m04.org),
  `${c.shown} · ${text(c.d.getElementById('cf-code'))}`);
const other = [...printed.keys()].find(id => id !== s13 && id !== s04);
c = await openCtrl(printed.get(other));
t('E3-5 아직 배치 · 공개 안 된 다른 부스 카드 QR → 여전히 안 열림', c.shown === 'msg', c.shown);
t('E3-6 운영자 화면 오류 없음', !c.errors.length, c.errors.join(' | '));

// ══ E4 번호 변경(SW-01 → SW-07): 같은 QR · 인쇄 화면 QR 도 같음 ══════════════
await db.query('update public.booths set no = 7 where id = $1', [s13]);
c = await openCtrl(printed.get(s13));
t('E4-1 번호를 바꿔도 같은 QR → SW-07 로 열림', c.shown === 'confirm' && text(c.d.getElementById('cf-code')).includes('SW-07'), text(c.d.getElementById('cf-code')));
p = await openPrint();
const card13 = p.d.querySelector(`.item--ops[data-id="${s13}"]`);
const again13 = decodeBox(card13 && card13.querySelector('[data-qr]'));
t('E4-2 인쇄 화면: S13 카드가 배치 미정에서 빠져 SW-07 로 · QR 주소는 처음 인쇄한 것과 글자 하나 다르지 않음',
  !!card13 && !card13.classList.contains('is-unplaced') && /SW-07/.test(text(card13)) && again13 === printed.get(s13));
const sign13 = p.d.querySelector(`.item--sign[data-id="${s13}"]`);
const signV = decodeBox(sign13 && sign13.querySelector('[data-qr]'));
t('E4-3 배치 뒤 생긴 S13 부스 앞 안내 QR = ?b=UUID(번호가 아니라 UUID · 열쇠 없음)', signV === 'https://incheon-live.vercel.app/?b=' + s13);
acc = await allTokens();
html = p.d.documentElement.outerHTML;
t('E4-4 다시 연 인쇄 화면에도 열쇠 글 없음 · 발급 · 교체 없음',
  [...acc.values()].every(tk => !html.includes(tk)) && !p.log.some(x => /^rpc:admin_(issue|rotate|disable)_booth_token$/.test(x)));

// 화면 캡처용: 운영자 카드(SW-07) · 배치 미정 카드 · 부스 앞 안내(SW-07)만 남기고 QR 은 빗금 자리로 바꿉니다.
if (dumpDir) {
  const d = p.d, keepOps = new Set([s13, other]);
  d.querySelectorAll('#grid-ops .item').forEach(el => { if (!keepOps.has(el.getAttribute('data-id'))) el.remove(); });
  d.querySelectorAll('#grid-signs .item').forEach(el => { if (el.getAttribute('data-id') !== s13) el.remove(); });
  d.querySelectorAll('.zsect').forEach(z => { if (!z.querySelector('.item')) z.remove(); });
  d.getElementById('panel-signs').hidden = false;
  d.querySelectorAll('[data-qr]').forEach(x => { x.innerHTML = ''; x.setAttribute('style', 'aspect-ratio:1;background:repeating-linear-gradient(45deg,#d9dce3 0 3px,#fff 3px 7px)'); });
  d.querySelectorAll('script').forEach(x => x.remove());
  const links = [...readFileSync(resolve(REPO, 'print-qr.html'), 'utf8').matchAll(/<link[^>]+stylesheet[^>]*>/g)].map(m => m[0]).join('');
  const out = '<!doctype html>' + d.documentElement.outerHTML.replace('<head>', '<head><base href="' + pathToFileURL(REPO).href + '/">' + links);
  if ([...acc.values()].some(tk => out.includes(tk))) throw new Error('캡처 HTML 에 열쇠가 남음');
  writeFileSync(resolve(dumpDir, 'printqr-final-cards.html'), out);
}

// ══ E5 노출: 공개 API · 저장소 ═════════════════════════════════════════
const anonAccess = await rest('booth_access?select=booth_id,token&limit=1');
t('E5-1 익명(공개 키)으로 열쇠 표(booth_access) 읽기 → 거절', anonAccess.status >= 400, `HTTP ${anonAccess.status}`);
const prev = await rest('rpc/booth_preview_list');
const prevText = JSON.stringify(prev.body);
t('E5-2 사전 안내 목록(booth_preview_list): 4칸뿐 · 열쇠 없음',
  prev.status === 200 && prev.body.every(b => JSON.stringify(Object.keys(b).sort()) === JSON.stringify(['id', 'name', 'org', 'program'])) && [...acc.values()].every(tk => !prevText.includes(tk)));
const pubBooths = await rest('booths?select=*');
const pubText = JSON.stringify(pubBooths.body);
t('E5-3 공개 부스 표(익명)에도 열쇠 없음', [...acc.values()].every(tk => !pubText.includes(tk)));
// 저장소: 두 작업 폴더의 추적 · 새 파일(무시 목록 제외)과 모든 커밋 기록에서 'booth-ctrl.html#k=열쇠' 모양을 찾습니다.
const KEY_IN_URL = '#k=[A-Za-z0-9_-]{24}';
const grepRepo = dir => {
  let hits = 0;
  try { hits += execFileSync('git', ['-C', dir, 'grep', '-I', '-c', '-E', '--untracked', KEY_IN_URL], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length; } catch { /* 없음 = 종료 1 */ }
  const log = execFileSync('git', ['-C', dir, 'log', '--all', '--oneline', '-G', KEY_IN_URL], { encoding: 'utf8' }).trim();
  return hits + (log ? log.split('\n').length : 0);
};
const repoHits = grepRepo(REPO) + grepRepo(liveDir);
t('E5-4 저장소(두 작업 폴더 · 모든 커밋)에 “#k=열쇠” 모양 없음', repoHits === 0, `${repoHits}건`);
await db.close();

// ── 보고서(개수 · 참거짓만) ───────────────────────────────────────────────
const pass = results.every(x => x.ok);
const L = ['# Gate 3-C 운영자 QR 종단 시험 결과', '',
  '- 흐름: migration → C-02 → Q-02(파일 그대로) → print-qr.html(관리자 · jsdom) 실제 QR 그림 → jsQR 로 읽기 → booth-ctrl.html(익명 · jsdom)',
  '- QR 생성기: qrcodejs@1.0.0(print-qr.html 이 받는 CDN 파일과 같은 SHA-256) · 읽기: jsqr@1.4.0',
  `- 운영자 화면: ${liveDir.replace(/\\/g, '/')}/booth-ctrl.html`,
  '- 네트워크 · Production 접속 없음. 열쇠는 시험 DB 의 가짜 값이며 이 보고서에 쓰지 않음', '',
  `## 판정: ${pass ? '통과' : '실패'} (${results.filter(x => x.ok).length}/${results.length})`, '', '| 결과 | 시험 | 내용 |', '|---|---|---|'];
for (const x of results) L.push(`| ${x.ok ? '통과' : '**실패**'} | ${x.name} | ${String(x.note).replace(/\|/g, '\\|')} |`);
writeFileSync(resolve(G3, 'qr-e2e-report.md'), L.join('\n') + '\n');
console.log(`${pass ? 'QR 종단 시험 통과' : 'QR 종단 시험 실패'} — ${results.filter(x => x.ok).length}/${results.length}`);
process.exit(pass ? 0 : 1);
