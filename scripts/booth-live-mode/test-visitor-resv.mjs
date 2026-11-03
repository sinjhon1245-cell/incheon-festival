/* ===================================================================
   관람객 화면 현장예약 상자 시험 — 실제 Chrome 에서 자리 · 크기를 잽니다(협의용 예시 화면 ?demo=1 · 화면 안내 /example)
   ───────────────────────────────────────────────────────────────────
   서버 · Production 에 닿지 않습니다. 이 파일의 작은 웹 서버가 저장소(또는 --base 커밋)의 파일만 주고,
   예시 화면은 원래 서버를 읽지 않습니다(읽으려 하면 실패로 셉니다). 글꼴(Pretendard, jsDelivr)만 받습니다.

     L  목록      상자 두 줄 '현장 / 예약' · '예약 / 마감' · 80px 칸 안 · 가로 · 세로 가운데 · 줄 높이 그대로 · 두 줄 이름
     G  한눈에    같은 두 줄 · 같은 색 · 칸 안에 다 들어감
     X  예시 화면 일곱 상태(5분 여유 · 20분 보통 · 30분 혼잡 · 현장 / 예약 · 예약 / 마감 · 잠시 중단 · 오늘 마감)가
                  목록 · 한눈에 모두에 · 서버 요청 없음 · '실제 화면으로 돌아가기' 로 예시 표시가 사라짐
     E  화면 안내 /example 의 목록 · 한눈에 미리보기가 관람객 화면과 같은 상자 · 칸 색
   폭: 360 · 390 · 768 · 1024 · 1440

   쓰는 법: node scripts/booth-live-mode/test-visitor-resv.mjs --deps <puppeteer-core 가 설치된 폴더>
              [--chrome <chrome.exe>] [--base <커밋>] [--shots <폴더>]
   =================================================================== */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import http from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const puppeteer = createRequire(join(resolve(arg('deps')), 'package.json'))('puppeteer-core');
const CHROME = arg('chrome', ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find((p) => existsSync(p)));
const BASE = arg('base', '');
const SHOTS = arg('shots', '');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const results = [];
function t(name, ok, note = '') { results.push({ name, ok: !!ok, note }); console.log(`${ok ? '통과' : '실패'}  ${name}${!ok && note ? '  — ' + note : ''}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* 아직 */ } await sleep(25); } return false; }

/* ── 파일 · 서버 ─────────────────────────────────────────────────── */
// 주소 → 저장소 파일. /example 은 Live 배포본(live/build.sh)처럼 사이트 뿌리의 /example/ 에 둡니다.
const MAP = {
  'visitor.html': 'visitor.html', 'assets/visitor.css': 'assets/visitor.css', 'assets/booth-core.js': 'assets/booth-core.js',
  'assets/mock-data.js': 'assets/mock-data.js', 'assets/config.js': 'assets/config.js',
  'example/index.html': 'live/example/index.html', 'example/example.css': 'live/example/example.css'
};
let ROOT = REPO, TMP = null;
if (BASE) {
  TMP = mkdtempSync(join(tmpdir(), 'resv-base-'));
  for (const f of Object.values(MAP)) {
    mkdirSync(dirname(join(TMP, f)), { recursive: true });
    writeFileSync(join(TMP, f), execFileSync('git', ['show', `${BASE}:${f}`], { cwd: REPO, maxBuffer: 64 << 20 }));
  }
  ROOT = TMP;
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  if (p === 'example/' || p === 'example') p = 'example/index.html';
  if (!MAP[p]) { res.writeHead(404); res.end(); return; }
  let out = readFileSync(join(ROOT, MAP[p]));
  // Live 배포본처럼 관람객 주소를 같은 사이트로(저장소 config.js 는 운영 포털 설정이라 공식 주소로 옮겨 갑니다)
  if (p === 'assets/config.js') out = out.toString('utf8') + '\nwindow.FESTIVAL_CONFIG.visitorSiteUrl = "./";\n';
  res.writeHead(200, { 'Content-Type': TYPES[extname(MAP[p])] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(out);
});
// 아무 포트(0)나 받으면 Chrome 이 막는 포트(6697 등)가 걸릴 수 있어 47000~47999 에서 고릅니다
await new Promise((r) => server.listen(47000 + Math.floor(Math.random() * 1000), '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--no-default-browser-check'] });
const outside = [];
let demoPhase = true;      // 예시 화면을 보는 동안 서버(Supabase · /api) 요청이 있으면 모두 적어 둡니다
const demoCalls = [];
async function openPage(width, path, { longName = false } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height: 900, deviceScaleFactor: 2, isMobile: width < 768, hasTouch: width < 768 });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (demoPhase && /supabase|\/api\//.test(u)) demoCalls.push(u);
    if (u.startsWith(ORIGIN + '/') || u.startsWith('data:') || /^https:\/\/cdn\.jsdelivr\.net\/gh\/orioncactus\/pretendard/.test(u)) { req.continue(); return; }
    outside.push(u);
    req.abort();
  });
  // 두 줄 이름 시험: 예시 부스 C-05(현장예약)의 이름만 길게(이 시험 탭 안에서만)
  if (longName) {
    await page.evaluateOnNewDocument(() => {
      let m;
      Object.defineProperty(window, 'MOCK_BOOTHS', { configurable: true, get() { return m; },
        set(v) { (v || []).forEach((b) => { if (b.code === 'C-05') b.name = '가상현실로 떠나는 우주 탐험과 행성 관찰 체험'; }); m = v; } });
    });
  }
  await page.goto(ORIGIN + path, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  return { ctx, page };
}
const rowRight = (page, code) => page.evaluate((code) => {
  const row = [...document.querySelectorAll('#list .row')].find((r) => (r.querySelector('.row__code') || {}).textContent === code);
  if (!row) return null;
  const rr = row.getBoundingClientRect(), col = row.querySelector('.row__right').getBoundingClientRect();
  const box = row.querySelector('.rbox');
  const b = box && box.getBoundingClientRect();
  const lines = box ? [...box.querySelectorAll('.rbox__l')].map((l) => { const r = l.getBoundingClientRect(); return { t: l.textContent, l: r.left, r: r.right, w: l.scrollWidth, cw: l.clientWidth }; }) : [];
  const cs = box && getComputedStyle(box);
  return { rowH: rr.height, rowTop: rr.top, rowBottom: rr.bottom, col: { l: col.left, r: col.right, w: col.width },
    box: b && { l: b.left, r: b.right, t: b.top, btm: b.bottom, w: b.width, h: b.height }, lines,
    style: cs && { bg: cs.backgroundColor, ink: cs.color, edge: cs.borderTopColor, radius: cs.borderTopLeftRadius, fs: cs.fontSize, fw: cs.fontWeight },
    name: row.querySelector('.row__name').getBoundingClientRect().height };
}, code);

/* ── L · G · X : 예시 화면, 폭마다 ───────────────────────────────── */
const WIDTHS = [360, 390, 768, 1024, 1440];
const STATES = { 'A-02': ['is-free', '5분', '여유'], 'B-01': ['is-normal', '20분', '보통'], 'A-04': ['is-busy', '30분', '혼잡'],
  'C-05': ['is-resv', '현장', '예약'], 'C-06': ['is-resv-closed', '예약', '마감'], 'B-03': ['is-pause', '중단', ''], 'C-01': ['is-closed', '마감', ''] };
let boxColor = null, tileColor = null;
for (const W of WIDTHS) {
  const { ctx, page } = await openPage(W, '/visitor.html?demo=1');
  await until(() => page.$$eval('#list .row', (r) => r.length === 14));
  const o = await rowRight(page, 'C-05'), c = await rowRight(page, 'C-06'), w = await rowRight(page, 'C-04');
  const ok = o && o.box && c && c.box;
  t(`L1 ${W}px 목록: '현장 / 예약' · '예약 / 마감' 두 줄 상자`, ok && o.lines.map((x) => x.t).join('/') === '현장/예약' && c.lines.map((x) => x.t).join('/') === '예약/마감', JSON.stringify(o && o.lines));
  if (ok) {
    t(`L2 ${W}px 목록: 상자가 80px 칸 안 · 가로 가운데(±1px)`, o.col.w === 80 && o.box.l >= o.col.l - 0.5 && o.box.r <= o.col.r + 0.5
      && Math.abs((o.box.l + o.box.r) / 2 - (o.col.l + o.col.r) / 2) <= 1, JSON.stringify({ col: o.col, box: o.box }));
    t(`L3 ${W}px 목록: 상자가 줄의 세로 가운데(±1.5px)`, Math.abs((o.box.t + o.box.btm) / 2 - (o.rowTop + o.rowBottom) / 2) <= 1.5, JSON.stringify(o));
    t(`L4 ${W}px 목록: 줄 높이 = 같은 모양의 대기 줄(C-04 · 한 줄 이름)`, Math.abs(o.rowH - w.rowH) < 0.5 && Math.abs(c.rowH - w.rowH) < 0.5, `${o.rowH} · ${c.rowH} · 대기 ${w.rowH}`);
    t(`L5 ${W}px 목록: 두 상자 크기 같음 · 글자 잘림 없음`, o.box.w === c.box.w && o.box.h === c.box.h && [...o.lines, ...c.lines].every((x) => x.w <= x.cw + 0.5 && x.l >= o.box.l - 400),
      JSON.stringify([o.box, c.box]));
    t(`L6 ${W}px 목록: 색 — 현장예약 옅은 보라 · 진한 보라 · 보라 테두리 / 예약 마감 옅은 회색 · 진한 회색 · 회색 테두리 · 둥근 모서리`,
      o.style.bg === 'rgb(239, 235, 254)' && o.style.ink === 'rgb(59, 45, 174)' && o.style.edge === 'rgb(203, 193, 246)'
      && c.style.bg === 'rgb(241, 243, 247)' && c.style.ink === 'rgb(70, 83, 107)' && c.style.edge === 'rgb(201, 208, 220)'
      && parseFloat(o.style.radius) >= 4 && Number(o.style.fw) >= 700 && parseFloat(o.style.fs) >= 16, JSON.stringify([o.style, c.style]));
    boxColor = boxColor || [o.style.bg, o.style.ink, c.style.bg, c.style.ink];
  }
  const ovf = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  t(`L7 ${W}px 목록: 가로 넘침 없음`, ovf <= 0, `넘침 ${ovf}px`);
  // 예시 화면의 일곱 상태(목록)
  const listStates = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#list .row')].map((r) => [r.querySelector('.row__code').textContent,
    (r.querySelector('.rbox') ? [...r.querySelectorAll('.rbox__l')].map((x) => x.textContent).join('/') : r.querySelector('.row__right').textContent.replace(/\s+/g, ''))])));
  const wantList = { 'A-02': '5분여유', 'B-01': '20분보통', 'A-04': '30분혼잡', 'C-05': '현장/예약', 'C-06': '예약/마감', 'B-03': '잠시중단', 'C-01': '마감' };
  t(`X1 ${W}px 예시 목록: 일곱 상태가 모두 보임`, Object.entries(wantList).every(([k, v]) => listStates[k] === v), JSON.stringify(listStates));
  if (SHOTS && (W === 390 || W === 1440)) {
    const zone = await page.evaluateHandle(() => [...document.querySelectorAll('#list .group')].pop() || [...document.querySelectorAll('#list .zone')].pop());
    await zone.asElement().screenshot({ path: join(SHOTS, `list-zoneC-${W}.png`) });
  }

  // 한눈에
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /한눈에/.test(b.textContent)).click());
  await until(() => page.$$eval('.tile', (x) => x.length === 14));
  const tiles = await page.evaluate(() => [...document.querySelectorAll('.tile')].map((el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const parts = ['.tile__v', '.tile__w'].map((s) => { const x = el.querySelector(s); const xr = x.getBoundingClientRect(); return { t: x.textContent, btm: xr.bottom, r: xr.right, sw: x.scrollWidth, cw: x.clientWidth }; });
    return { no: el.querySelector('.tile__no').textContent, cls: el.className, v: parts[0], w: parts[1], btm: r.bottom, right: r.right, size: r.width, bg: cs.backgroundColor, ink: cs.color };
  }));
  const byNo = Object.fromEntries(tiles.map((x) => [x.no, x]));
  t(`G1 ${W}px 한눈에: 일곱 상태 칸(색 · 두 줄 낱말)`, Object.entries(STATES).every(([k, [cls, v, w]]) => byNo[k] && byNo[k].cls.includes(cls) && byNo[k].v.t === v && byNo[k].w.t === w),
    JSON.stringify(Object.keys(STATES).map((k) => byNo[k] && [k, byNo[k].cls, byNo[k].v.t, byNo[k].w.t])));
  const rv = byNo['C-05'], rc = byNo['C-06'];
  t(`G2 ${W}px 한눈에: 현장예약 칸 글자가 칸 안에(아래 · 오른쪽 넘침 없음)`, [rv, rc].every((x) => x && x.v.btm <= x.btm - 1 && x.w.btm <= x.btm - 1 && x.v.sw <= x.v.cw + 0.5 && x.w.sw <= x.w.cw + 0.5),
    JSON.stringify([rv, rc]));
  t(`G3 ${W}px 한눈에: 목록 상자와 같은 색`, rv && boxColor && rv.bg === boxColor[0] && rv.ink === boxColor[1] && rc.bg === boxColor[2] && rc.ink === boxColor[3], JSON.stringify([rv && [rv.bg, rv.ink], rc && [rc.bg, rc.ink], boxColor]));
  const tovf = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  t(`G4 ${W}px 한눈에: 가로 넘침 없음`, tovf <= 0, `넘침 ${tovf}px`);
  if (SHOTS && (W === 360 || W === 390 || W === 1440)) {
    const zone = await page.evaluateHandle(() => [...document.querySelectorAll('#list .group')].filter((z) => z.querySelector('.tile')).pop());
    await zone.asElement().screenshot({ path: join(SHOTS, `tiles-zoneC-${W}.png`) });
  }
  if (SHOTS && W === 390) await page.screenshot({ path: join(SHOTS, `tiles-full-${W}.png`), fullPage: true });
  await ctx.close();
}

/* ── L8 : 두 줄 이름 ─────────────────────────────────────────────── */
for (const W of [360, 390]) {
  const { ctx, page } = await openPage(W, '/visitor.html?demo=1', { longName: true });
  await until(() => page.$$eval('#list .row', (r) => r.length === 14));
  const o = await rowRight(page, 'C-05');
  t(`L8 ${W}px 두 줄 이름: 상자가 줄 세로 가운데 · 80px 칸 안`, o && o.box && o.name > 30 && Math.abs((o.box.t + o.box.btm) / 2 - (o.rowTop + o.rowBottom) / 2) <= 1.5
    && o.box.l >= o.col.l - 0.5 && o.box.r <= o.col.r + 0.5, JSON.stringify(o));
  if (SHOTS && W === 390) {
    const row = await page.evaluateHandle(() => [...document.querySelectorAll('#list .row')].find((r) => r.querySelector('.row__code').textContent === 'C-05'));
    await row.asElement().screenshot({ path: join(SHOTS, `list-longname-${W}.png`) });
  }
  await ctx.close();
}

/* ── X2 · X3 : 지금 계신 부스 · 실제 화면으로 돌아가기 ────────────── */
{
  const { ctx, page } = await openPage(390, '/visitor.html?demo=1&b=ex-c05');
  await until(() => page.$('#here .here__val'));
  const here = await page.evaluate(() => { const b = document.querySelector('#here .rbox'); return b ? [...b.querySelectorAll('.rbox__l')].map((x) => x.textContent).join('/') + '|' + b.className : ''; });
  t('X2 지금 계신 부스(QR): 같은 두 줄 상자(크게)', here === '현장/예약|rbox rbox--big', here);
  if (SHOTS) await (await page.$('#here')).screenshot({ path: join(SHOTS, 'here-390.png') });
  await ctx.close();
}
{
  const { ctx, page } = await openPage(390, '/visitor.html?demo=1');
  await until(() => page.$$eval('#list .row', (r) => r.length === 14));
  demoPhase = false;   // 여기서부터는 실제 화면(서버를 읽는 것이 맞음)
  const nav = page.waitForNavigation({ waitUntil: 'domcontentloaded' });
  await page.click('[data-act="demo-exit"]');
  await nav;
  await sleep(300);
  const after = await page.evaluate(() => ({ url: location.href, demo: document.documentElement.classList.contains('is-demo'), bar: !document.getElementById('demobar').hidden,
    rows: [...document.querySelectorAll('#list .row__code')].map((x) => x.textContent) }));
  t('X3 \'실제 화면으로 돌아가기\' → 주소에 demo 없음 · 예시 표시 · 예시 부스 사라짐', !/demo/.test(after.url) && !after.demo && !after.bar && !after.rows.some((c) => /^[ABC]-0\d$/.test(c)), JSON.stringify(after));
  await ctx.close();
}
t('X4 예시 화면(목록 · 한눈에 · 지금 계신 부스)은 서버(Supabase · /api)를 읽지 않음', demoCalls.length === 0, demoCalls.join(' '));

/* ── E : 화면 안내(/example) ─────────────────────────────────────── */
{
  // 화면 안내의 상자 규칙은 관람객 화면 것을 글자 그대로 옮긴 것이어야 합니다(한쪽만 고치면 모양이 갈라짐)
  const rboxCss = (file) => { const s = readFileSync(join(ROOT, file), 'utf8').replace(/\r/g, ''); const a = s.indexOf('.rbox {'); return a < 0 ? '' : s.slice(a, s.indexOf('}', s.indexOf('.rbox--closed {')) + 1); };
  const a = rboxCss('assets/visitor.css'), b = rboxCss('live/example/example.css');
  t('E0 화면 안내 example.css 의 상자 규칙 = visitor.css 와 글자 그대로', a.length > 100 && a === b, `${a.length} · ${b.length}`);
}
for (const W of [390, 1440]) {
  const { ctx, page } = await openPage(W, '/example/');
  const ex = await page.evaluate(() => {
    const box = (sel) => { const b = document.querySelector(sel); if (!b) return null; const cs = getComputedStyle(b); return { lines: [...b.querySelectorAll('.rbox__l')].map((x) => x.textContent).join('/'), bg: cs.backgroundColor, ink: cs.color, w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height }; };
    const tile = (cls) => { const el = document.querySelector('.vp__tiles .tile.' + cls); if (!el) return null; const cs = getComputedStyle(el); return { v: el.querySelector('.tile__v').textContent, w: el.querySelector('.tile__w').textContent, bg: cs.backgroundColor, ink: cs.color }; };
    return { open: box('.vr .rbox:not(.rbox--closed)'), closed: box('.vr .rbox--closed'), tOpen: tile('is-resv'), tClosed: tile('is-resv-closed'),
      tiles: document.querySelectorAll('.vp__tiles .tile').length, demo: !!document.querySelector('a[href="/?demo=1"]'), ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  t(`E1 ${W}px 화면 안내: 목록 미리보기 상자 = 관람객 화면(두 줄 · 색 · 크기)`, ex.open && ex.open.lines === '현장/예약' && ex.closed.lines === '예약/마감' && boxColor
    && ex.open.bg === boxColor[0] && ex.open.ink === boxColor[1] && ex.closed.bg === boxColor[2] && ex.closed.ink === boxColor[3] && ex.open.w === 64 && ex.open.h === 50, JSON.stringify(ex));
  t(`E2 ${W}px 화면 안내: 한눈에 미리보기 일곱 칸 · 현장예약 칸 = 관람객 화면 색 · 낱말`, ex.tiles === 7 && ex.tOpen && ex.tOpen.v + '/' + ex.tOpen.w === '현장/예약' && ex.tClosed.v + '/' + ex.tClosed.w === '예약/마감'
    && boxColor && ex.tOpen.bg === boxColor[0] && ex.tClosed.bg === boxColor[2], JSON.stringify(ex));
  t(`E3 ${W}px 화면 안내: 예시 화면(/?demo=1) 링크 · 가로 넘침 없음`, ex.demo && ex.ovf <= 0, JSON.stringify(ex));
  if (SHOTS) await (await page.$('.card')).screenshot({ path: join(SHOTS, `example-visitor-card-${W}.png`) });
  await ctx.close();
}

await browser.close();
server.close();
if (TMP) rmSync(TMP, { recursive: true, force: true });
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} / ${results.length} 통과${BASE ? `  (기준 ${BASE})` : ''}`);
process.exit(bad.length ? 1 : 0);
