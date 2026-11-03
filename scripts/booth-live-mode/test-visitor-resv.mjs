/* ===================================================================
   관람객 화면 상태 칸 · 상태 상자 시험 — 실제 Chrome 에서 자리 · 크기 · 색을 잽니다(협의용 예시 화면 ?demo=1 · 화면 안내 /example)
   ───────────────────────────────────────────────────────────────────
   서버 · Production 에 닿지 않습니다. 이 파일의 작은 웹 서버가 저장소(또는 --base 커밋)의 파일만 주고,
   예시 화면은 원래 서버를 읽지 않습니다(읽으려 하면 실패로 셉니다). 글꼴(Pretendard, jsDelivr)만 받습니다.

     L  목록      모든 줄의 상태 칸 80px · 숫자 · 칩 · 상자의 오른쪽 끝이 같음 · 상자 80×58 · 칩 80px · 글자 크기 ·
                  낱말('현장 / 예약' · '예약 / 마감' · '잠시 / 중단' · '마감') · 색 · 세로 가운데 · 줄 높이 같음 · 이름이 칸을 넘지 않음 · 두 줄 이름
     G  한눈에    같은 낱말 · 같은 색 · 칸 안에 다 들어감 · 글자 크기 · 번호 자리 같음
     X  예시 화면 일곱 상태(5분 여유 · 20분 보통 · 30분 혼잡 · 현장 / 예약 · 예약 / 마감 · 잠시 중단 · 오늘 마감)가
                  목록 · 한눈에 모두에 · 지금 계신 부스(QR) 상자 · 칩 · 서버 요청 없음 · '실제 화면으로 돌아가기' 로 예시 표시가 사라짐
     E  화면 안내 /example 의 목록 · 한눈에 미리보기가 관람객 화면과 같은 칸 · 상자 · 색(상자 CSS 는 글자 그대로)
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
// 목록 줄마다 오른쪽 상태 칸: 칸 · 그 안의 숫자 · 칩 · 상태 상자의 자리 · 크기 · 글자 · 색
const rowsInfo = (page) => page.evaluate(() => [...document.querySelectorAll('#list .row')].map((row) => {
  const R = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
  const col = row.querySelector('.row__right');
  const parts = [...col.children].filter((k) => !k.classList.contains('sr-only')).map((k) => {
    const cs = getComputedStyle(k);
    return { cls: k.className, box: R(k), fs: parseFloat(cs.fontSize), fw: Number(cs.fontWeight), bg: cs.backgroundColor, ink: cs.color, edge: cs.borderTopColor,
      radius: parseFloat(cs.borderTopLeftRadius), text: k.textContent,
      lines: [...k.querySelectorAll('.sbox__l')].map((l) => ({ t: l.textContent, sw: l.scrollWidth, cw: l.clientWidth })) };
  });
  // 이름 · 학교 글자가 실제로 닿는 오른쪽 끝(줄마다 글자 상자)
  const textRight = Math.max(...[...row.querySelectorAll('.row__name, .row__org')].map((el) => {
    const rg = document.createRange(); rg.selectNodeContents(el); return Math.max(...[...rg.getClientRects()].map((x) => x.right));
  }));
  return { code: row.querySelector('.row__code').textContent, row: R(row), col: R(col), parts, textRight,
    nameLines: Math.round(row.querySelector('.row__name').getBoundingClientRect().height / 22), sr: (col.querySelector('.sr-only') || {}).textContent || '' };
}));
const near = (a, b, e = 0.5) => Math.abs(a - b) <= e;
const isBox = (p) => /\bsbox\b/.test(p.cls);
const isChip = (p) => /\bst\b/.test(p.cls) && !/st--unknown/.test(p.cls);
const COLORS = {
  resv:  { bg: 'rgb(239, 235, 254)', ink: 'rgb(59, 45, 174)', edge: 'rgb(203, 193, 246)' },
  off:   { bg: 'rgb(241, 243, 247)', ink: 'rgb(70, 83, 107)', edge: 'rgb(201, 208, 220)' },
  pause: { bg: 'rgb(255, 255, 255)', ink: 'rgb(90, 107, 133)', edge: 'rgb(138, 147, 171)' }
};
const CHIP = { free: 'rgb(8, 119, 63)', normal: 'rgb(244, 212, 0)', busy: 'rgb(229, 37, 33)' };
// 대기 분이 없는 상태: 낱말 · 색 갈래 · 한 줄 여부
const BOXES = { 'C-05': ['현장/예약', 'resv', false], 'C-06': ['예약/마감', 'off', false], 'B-03': ['잠시/중단', 'pause', false], 'C-01': ['마감', 'off', true] };
const colorOk = (p, k) => !!p && p.bg === COLORS[k].bg && p.ink === COLORS[k].ink && p.edge === COLORS[k].edge;

/* ── L · G · X : 예시 화면, 폭마다 ───────────────────────────────── */
const WIDTHS = [360, 390, 768, 1024, 1440];
const STATES = { 'A-02': ['is-free', '5분', '여유'], 'B-01': ['is-normal', '20분', '보통'], 'A-04': ['is-busy', '30분', '혼잡'],
  'C-05': ['is-resv', '현장', '예약'], 'C-06': ['is-resv-closed', '예약', '마감'], 'B-03': ['is-pause', '잠시', '중단'], 'C-01': ['is-closed', '마감', ''] };
for (const W of WIDTHS) {
  const { ctx, page } = await openPage(W, '/visitor.html?demo=1');
  await until(() => page.$$eval('#list .row', (r) => r.length === 14));
  const rows = await rowsInfo(page);
  const by = Object.fromEntries(rows.map((r) => [r.code, r]));
  const edge = rows[0].col.r;
  t(`L1 ${W}px 목록: 오른쪽 상태 칸이 모든 줄에서 80px · 같은 오른쪽 끝`, rows.every((r) => near(r.col.w, 80) && near(r.col.r, edge)), JSON.stringify(rows.map((r) => [r.code, r.col.w, r.col.r])));
  t(`L2 ${W}px 목록: 숫자 · 칩 · 상태 상자의 오른쪽 끝이 모두 칸 끝과 같음`, rows.every((r) => r.parts.every((p) => near(p.box.r, edge))),
    JSON.stringify(rows.map((r) => [r.code, r.parts.map((p) => [p.cls.split(' ')[0], Math.round(p.box.r * 10) / 10])])));
  const boxes = rows.flatMap((r) => r.parts.filter(isBox)), chips = rows.flatMap((r) => r.parts.filter(isChip));
  t(`L3 ${W}px 목록: 상태 상자는 모두 80×58 · 상태 칩은 모두 80px 폭`, boxes.length >= 4 && boxes.every((p) => near(p.box.w, 80) && near(p.box.h, 58)) && chips.length >= 8 && chips.every((p) => near(p.box.w, 80)),
    JSON.stringify({ boxes: boxes.map((p) => [p.box.w, p.box.h]), chips: chips.map((p) => p.box.w) }));
  t(`L4 ${W}px 목록: 상자 낱말 '현장 / 예약' · '예약 / 마감' · '잠시 / 중단' · '마감'(한 줄) · 화면 읽기 한 줄`, Object.entries(BOXES).every(([code, [words, , one]]) => {
    const p = by[code] && by[code].parts[0];
    return !!p && isBox(p) && p.lines.map((x) => x.t).join('/') === words && (one ? /sbox--one/.test(p.cls) : !/sbox--one/.test(p.cls)) && by[code].sr.length > 3;
  }), JSON.stringify(Object.keys(BOXES).map((c) => by[c] && [c, by[c].parts.map((p) => p.lines.map((x) => x.t).join('/') || p.text), by[c].sr])));
  t(`L5 ${W}px 목록: 글자 크기 — 상자 16px 이상(마감 20px) · 칩 15px 이상 · 굵게 · 잘림 없음`,
    boxes.length >= 4 && boxes.every((p) => p.fs >= (/sbox--one/.test(p.cls) ? 20 : 16) && p.fw >= 700 && p.lines.every((x) => x.sw <= x.cw + 0.5)) && chips.every((p) => p.fs >= 15 && p.fw >= 700),
    JSON.stringify({ boxes: boxes.map((p) => [p.fs, p.fw]), chips: chips.map((p) => [p.fs, p.fw]) }));
  t(`L6 ${W}px 목록: 색 — 현장예약 보라 · 예약 마감 · 마감 회색 · 잠시 중단 흰 바탕 + 회색 테두리 · 칩은 예전 색`,
    Object.entries(BOXES).every(([code, [, k]]) => colorOk(by[code] && by[code].parts[0], k))
    && [['A-02', 'free'], ['B-01', 'normal'], ['A-04', 'busy']].every(([code, k]) => { const c = by[code].parts.find(isChip); return !!c && c.bg === CHIP[k]; }),
    JSON.stringify(Object.keys(BOXES).map((c) => by[c] && by[c].parts[0] && [c, by[c].parts[0].bg, by[c].parts[0].ink, by[c].parts[0].edge])));
  t(`L7 ${W}px 목록: 상태 칸이 줄의 세로 가운데(±1.5px)`, rows.every((r) => near((r.col.t + r.col.b) / 2, (r.row.t + r.row.b) / 2, 1.5)), '');
  const oneLine = rows.filter((r) => r.nameLines === 1), hs = [...new Set(oneLine.map((r) => Math.round(r.row.h * 2) / 2))];
  t(`L8 ${W}px 목록: 한 줄 이름 줄은 상태(대기 분 · 상자 · 정보 없음)와 상관없이 높이가 같음`, oneLine.length >= 5 && hs.length === 1, JSON.stringify(rows.map((r) => [r.code, r.nameLines, r.row.h])));
  t(`L9 ${W}px 목록: 부스명 · 학교명이 상태 칸을 넘지 않음(칸 앞 8px 이상)`, rows.every((r) => r.textRight <= r.col.l - 8), JSON.stringify(rows.map((r) => [r.code, Math.round(r.textRight), Math.round(r.col.l)])));
  const ovf = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  t(`L10 ${W}px 목록: 가로 넘침 없음`, ovf <= 0, `넘침 ${ovf}px`);
  const listStates = Object.fromEntries(rows.map((r) => [r.code, r.parts.map((p) => (isBox(p) ? p.lines.map((x) => x.t).join('/') : p.text.replace(/\s+/g, ''))).join('')]));
  const wantList = { 'A-02': '5분여유', 'B-01': '20분보통', 'A-04': '30분혼잡', 'C-05': '현장/예약', 'C-06': '예약/마감', 'B-03': '잠시/중단', 'C-01': '마감' };
  t(`X1 ${W}px 예시 목록: 일곱 상태가 모두 보임`, Object.entries(wantList).every(([k, v]) => listStates[k] === v), JSON.stringify(listStates));
  if (SHOTS && [360, 390, 768, 1440].includes(W)) {
    const groups = await page.$$('#list .group');
    for (const [i, g] of groups.slice(1).entries()) await g.screenshot({ path: join(SHOTS, `list-zone${'BC'[i]}-${W}.png`) });
  }

  // 한눈에
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /한눈에/.test(b.textContent)).click());
  await until(() => page.$$eval('.tile', (x) => x.length === 14));
  const tiles = await page.evaluate(() => [...document.querySelectorAll('.tile')].map((el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const parts = ['.tile__v', '.tile__w'].map((s) => { const x = el.querySelector(s); const xr = x.getBoundingClientRect(); return { t: x.textContent, btm: xr.bottom, sw: x.scrollWidth, cw: x.clientWidth, fs: parseFloat(getComputedStyle(x).fontSize) }; });
    return { no: el.querySelector('.tile__no').textContent, noTop: el.querySelector('.tile__no').getBoundingClientRect().top - r.top, cls: el.className, v: parts[0], w: parts[1], btm: r.bottom, bg: cs.backgroundColor, ink: cs.color };
  }));
  const tb = Object.fromEntries(tiles.map((x) => [x.no, x]));
  t(`G1 ${W}px 한눈에: 일곱 상태 칸(낱말 — 목록과 같음)`, Object.entries(STATES).every(([k, [cls, v, w]]) => tb[k] && tb[k].cls.includes(cls) && tb[k].v.t === v && tb[k].w.t === w),
    JSON.stringify(Object.keys(STATES).map((k) => tb[k] && [k, tb[k].cls, tb[k].v.t, tb[k].w.t])));
  t(`G2 ${W}px 한눈에: 모든 칸 글자가 칸 안에(아래 · 옆 넘침 없음)`, tiles.every((x) => x.v.btm <= x.btm - 1 && x.w.btm <= x.btm - 1 && x.v.sw <= x.v.cw + 0.5 && x.w.sw <= x.w.cw + 0.5),
    JSON.stringify(tiles.filter((x) => !(x.v.btm <= x.btm - 1 && x.w.btm <= x.btm - 1 && x.v.sw <= x.v.cw + 0.5 && x.w.sw <= x.w.cw + 0.5)).map((x) => x.no)));
  t(`G3 ${W}px 한눈에: 글자 크기 — 상태 낱말 12px 이상 · 상자 낱말 14px 이상(마감 18px)`,
    ['A-02', 'B-01', 'A-04'].every((k) => tb[k].w.fs >= 12) && ['C-05', 'C-06', 'B-03'].every((k) => tb[k].v.fs >= 14 && tb[k].w.fs >= 14) && tb['C-01'].v.fs >= 18,
    JSON.stringify(Object.keys(STATES).map((k) => [k, tb[k].v.fs, tb[k].w.fs])));
  t(`G4 ${W}px 한눈에: 목록 상자와 같은 색(보라 · 회색 · 흰 바탕)`, tb['C-05'].bg === COLORS.resv.bg && tb['C-05'].ink === COLORS.resv.ink
    && tb['C-06'].bg === COLORS.off.bg && tb['C-01'].bg === COLORS.off.bg && tb['C-01'].ink === COLORS.off.ink && tb['B-03'].bg === COLORS.pause.bg && tb['B-03'].ink === COLORS.pause.ink,
    JSON.stringify(['C-05', 'C-06', 'C-01', 'B-03'].map((k) => [k, tb[k].bg, tb[k].ink])));
  t(`G5 ${W}px 한눈에: 번호가 칸마다 같은 높이(±1px)`, tiles.every((x) => near(x.noTop, tiles[0].noTop, 1)), JSON.stringify(tiles.map((x) => Math.round(x.noTop * 10) / 10)));
  const tovf = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  t(`G6 ${W}px 한눈에: 가로 넘침 없음`, tovf <= 0, `넘침 ${tovf}px`);
  if (SHOTS && [360, 390, 1440].includes(W)) {
    const groups = await page.$$('#list .group');
    for (const [i, g] of groups.entries()) await g.screenshot({ path: join(SHOTS, `tiles-zone${'ABC'[i]}-${W}.png`) });
  }
  await ctx.close();
}

/* ── L11 : 두 줄 이름 ────────────────────────────────────────────── */
for (const W of [360, 390]) {
  const { ctx, page } = await openPage(W, '/visitor.html?demo=1', { longName: true });
  await until(() => page.$$eval('#list .row', (r) => r.length === 14));
  const rows = await rowsInfo(page);
  const o = rows.find((r) => r.code === 'C-05'), edge = rows[0].col.r;
  t(`L11 ${W}px 두 줄 이름: 상자가 줄 세로 가운데 · 같은 오른쪽 끝 · 이름이 칸을 넘지 않음`, !!o && o.nameLines >= 2 && near((o.col.t + o.col.b) / 2, (o.row.t + o.row.b) / 2, 1.5)
    && o.parts.every((p) => near(p.box.r, edge)) && o.textRight <= o.col.l - 8, JSON.stringify(o));
  if (SHOTS && W === 390) {
    const row = await page.evaluateHandle(() => [...document.querySelectorAll('#list .row')].find((r) => r.querySelector('.row__code').textContent === 'C-05'));
    await row.asElement().screenshot({ path: join(SHOTS, `list-longname-${W}.png`) });
  }
  await ctx.close();
}

/* ── X2 · X3 : 지금 계신 부스(QR) · 실제 화면으로 돌아가기 ─────────── */
for (const [id, words, k] of [['ex-c05', '현장/예약', 'resv'], ['ex-b03', '잠시/중단', 'pause'], ['ex-c01', '마감', 'off'], ['ex-a04', null, null]]) {
  const { ctx, page } = await openPage(390, `/visitor.html?demo=1&b=${id}`);
  await until(() => page.$('#here .here__val'));
  const h = await page.evaluate(() => {
    const v = document.querySelector('#here .here__val'), vr = v.getBoundingClientRect();
    const kids = [...v.children].filter((x) => !x.classList.contains('sr-only')).map((x) => { const r = x.getBoundingClientRect(), cs = getComputedStyle(x); return { cls: x.className, r: r.right, w: r.width, h: r.height, bg: cs.backgroundColor, ink: cs.color, edge: cs.borderTopColor,
      lines: [...x.querySelectorAll('.sbox__l')].map((l) => l.textContent).join('/') }; });
    return { right: vr.right, kids };
  });
  if (words) {
    const b = h.kids[0];
    t(`X2 지금 계신 부스(QR) ${id}: 같은 상태 상자(크게 88×64) '${words}' · 같은 색`, !!b && /sbox--big/.test(b.cls) && b.lines === words && near(b.w, 88) && near(b.h, 64) && colorOk(b, k), JSON.stringify(h));
  } else {
    t('X2 지금 계신 부스(QR) 대기 분: 큰 숫자 · 칩(88px)의 오른쪽 끝이 같음', h.kids.length === 2 && near(h.kids[1].w, 88) && h.kids.every((x) => near(x.r, h.right)), JSON.stringify(h));
  }
  if (SHOTS) await (await page.$('#here')).screenshot({ path: join(SHOTS, `here-${id}-390.png`) });
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
  // 화면 안내의 상태 상자 규칙은 관람객 화면 것을 글자 그대로 옮긴 것이어야 합니다(한쪽만 고치면 모양이 갈라짐)
  const sboxCss = (file) => { const s = readFileSync(join(ROOT, file), 'utf8').replace(/\r/g, ''); const a = s.indexOf('.sbox {'); return a < 0 ? '' : s.slice(a, s.indexOf('}', s.indexOf('.sbox--big.sbox--one {')) + 1); };
  const a = sboxCss('assets/visitor.css'), b = sboxCss('live/example/example.css');
  t('E0 화면 안내 example.css 의 상태 상자 규칙 = visitor.css 와 글자 그대로', a.length > 100 && a === b, `${a.length} · ${b.length}`);
}
for (const W of [390, 1440]) {
  const { ctx, page } = await openPage(W, '/example/');
  const ex = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.vr')].map((row) => {
      const col = row.querySelector('.vr__right'), cr = col.getBoundingClientRect();
      return { code: row.querySelector('.vr__code').textContent, colR: cr.right, colW: cr.width, parts: [...col.children].map((k) => { const r = k.getBoundingClientRect(), cs = getComputedStyle(k); return { cls: k.className, r: r.right, w: r.width, h: r.height, bg: cs.backgroundColor, ink: cs.color, edge: cs.borderTopColor,
        lines: [...k.querySelectorAll('.sbox__l')].map((l) => l.textContent).join('/') }; }) };
    });
    const tile = (cls) => { const el = document.querySelector('.vp__tiles .tile.' + cls); if (!el) return null; const cs = getComputedStyle(el); return { v: el.querySelector('.tile__v').textContent, w: el.querySelector('.tile__w').textContent, bg: cs.backgroundColor, ink: cs.color }; };
    return { rows, tiles: document.querySelectorAll('.vp__tiles .tile').length, tPause: tile('is-pause'), tClosed: tile('is-closed'), tResv: tile('is-resv'), tResvClosed: tile('is-resv-closed'),
      demo: !!document.querySelector('a[href="/?demo=1"]'), ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  const er = Object.fromEntries(ex.rows.map((r) => [r.code, r])), eEdge = ex.rows.length ? ex.rows[0].colR : 0;
  const want = { 'D-03': ['잠시/중단', 'pause'], 'E-01': ['마감', 'off'], 'E-02': ['현장/예약', 'resv'], 'E-03': ['예약/마감', 'off'] };
  const eParts = ex.rows.flatMap((r) => r.parts);
  t(`E1 ${W}px 화면 안내 목록: 상태 칸 80px · 오른쪽 끝 같음 · 상자 80×58 · 칩 80px`, ex.rows.length === 7 && ex.rows.every((r) => near(r.colW, 80) && near(r.colR, eEdge) && r.parts.every((p) => near(p.r, eEdge)))
    && eParts.filter((p) => /\bsbox\b/.test(p.cls)).length === 4 && eParts.filter((p) => /\bsbox\b/.test(p.cls)).every((p) => near(p.w, 80) && near(p.h, 58))
    && eParts.filter((p) => /\bst\b/.test(p.cls)).every((p) => near(p.w, 80)), JSON.stringify(ex.rows));
  t(`E2 ${W}px 화면 안내 목록: 상자 낱말 · 색 = 관람객 화면`, Object.entries(want).every(([c, [w, k]]) => er[c] && er[c].parts[0] && er[c].parts[0].lines === w && colorOk(er[c].parts[0], k)), JSON.stringify(Object.keys(want).map((c) => er[c])));
  t(`E3 ${W}px 화면 안내 한눈에: 일곱 칸 · 낱말 · 색 = 관람객 화면`, ex.tiles === 7 && !!ex.tPause && ex.tPause.v + '/' + ex.tPause.w === '잠시/중단' && ex.tClosed.v === '마감'
    && ex.tResv.v + '/' + ex.tResv.w === '현장/예약' && ex.tResvClosed.v + '/' + ex.tResvClosed.w === '예약/마감'
    && ex.tResv.bg === COLORS.resv.bg && ex.tResvClosed.bg === COLORS.off.bg && ex.tClosed.bg === COLORS.off.bg && ex.tPause.bg === COLORS.pause.bg, JSON.stringify([ex.tPause, ex.tClosed, ex.tResv, ex.tResvClosed]));
  t(`E4 ${W}px 화면 안내: 예시 화면(/?demo=1) 링크 · 가로 넘침 없음`, ex.demo && ex.ovf <= 0, JSON.stringify({ demo: ex.demo, ovf: ex.ovf }));
  if (SHOTS) await (await page.$('.card')).screenshot({ path: join(SHOTS, `example-visitor-card-${W}.png`) });
  await ctx.close();
}

await browser.close();
server.close();
if (TMP) rmSync(TMP, { recursive: true, force: true });
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} / ${results.length} 통과${BASE ? `  (기준 ${BASE})` : ''}`);
process.exit(bad.length ? 1 : 0);
