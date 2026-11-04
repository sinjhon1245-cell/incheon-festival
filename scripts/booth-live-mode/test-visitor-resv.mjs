/* ===================================================================
   관람객 화면 상태 칸 · 상태 표시 시험 — 실제 Chrome 에서 자리 · 크기 · 색을 잽니다(협의용 예시 화면 ?demo=1 · 화면 안내 /example)
   ───────────────────────────────────────────────────────────────────
   서버 · Production 에 닿지 않습니다. 이 파일의 작은 웹 서버가 저장소(또는 --base 커밋)의 파일만 주고,
   예시 화면은 원래 서버를 읽지 않습니다(읽으려 하면 실패로 셉니다). 글꼴(Pretendard, jsDelivr)만 받습니다.

     L  목록      모든 줄의 상태 칸 80px · 숫자 · 칩 · 상태 표시가 칸 가운데(숫자 가운데 = 칩 가운데) · 칩 60×22 13px ·
                  상태 표시 76×34 14px 700 한 줄('현장예약' · '예약 마감' · '잠시 중단' · '오늘 마감') · 단추처럼 보이지 않음 · 색 · 대비 ·
                  현장예약만 네 면 같은 진보라 3px 테두리(나머지 1px) · 현장예약 글자 둘레 여백 ·
                  세로 가운데 · 줄 높이 같음(73.4px 이하) · 이름이 칸을 넘지 않음 · 두 줄 이름
     H  상단 요약  다섯 상태(여유 · 보통 · 혼잡 · 현장예약 · 중단·마감) · 막대 · 네모 색 · 집계 기준 줄 · 칸 안에 들어감
     G  한눈에    두 줄 낱말 · 목록과 같은 색 갈래 · 칸 안에 다 들어감(65px 칸) · 글자 크기 · 번호 자리 같음
     X  예시 화면 일곱 상태(5분 여유 · 20분 보통 · 30분 혼잡 · 현장예약 · 예약 마감 · 잠시 중단 · 오늘 마감)가
                  목록 · 한눈에 모두에 · 지금 계신 부스(QR) 표시 · 칩 · 서버 요청 없음 · '실제 화면으로 돌아가기' 로 예시 표시가 사라짐
     E  화면 안내 /example 의 목록 · 한눈에 미리보기가 관람객 화면과 같은 칸 · 표시 · 색(상태 표시 CSS 는 글자 그대로) ·
                  운영자 예시 두 칸(현장대기 아래 현장예약: 같은 폭 · 높이 · 구성) · 미리보기 = 실제 화면 · PIN 안내 · 빈칸 없음
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
// 목록 줄마다 오른쪽 상태 칸: 칸 · 그 안의 숫자 · 칩 · 상태 표시의 자리 · 크기 · 글자 · 색
const rowsInfo = (page) => page.evaluate(() => [...document.querySelectorAll('#list .row')].map((row) => {
  const R = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height, c: (r.left + r.right) / 2 }; };
  const col = row.querySelector('.row__right');
  const parts = [...col.children].filter((k) => !k.classList.contains('sr-only')).map((k) => {
    const cs = getComputedStyle(k);
    const rg = document.createRange(); rg.selectNodeContents(k);
    const lines = new Set([...rg.getClientRects()].map((x) => Math.round(x.top))).size;
    const sides = ['Top', 'Right', 'Bottom', 'Left'], tr = rg.getBoundingClientRect(), kr = k.getBoundingClientRect();
    const ring = { w: sides.map((s) => parseFloat(cs[`border${s}Width`])), c: sides.map((s) => cs[`border${s}Color`]),
      r: ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((s) => parseFloat(cs[`border${s}Radius`])) };
    // 글자 둘레 여백: 테두리 안쪽 가장자리에서 글자 상자까지(왼 · 오 · 위 · 아래)
    const room = [tr.left - kr.left - ring.w[3], kr.right - ring.w[1] - tr.right, tr.top - kr.top - ring.w[0], kr.bottom - ring.w[2] - tr.bottom];
    return { cls: k.className, tag: k.tagName, box: R(k), fs: parseFloat(cs.fontSize), fw: Number(cs.fontWeight), bg: cs.backgroundColor, ink: cs.color, edge: cs.borderTopColor,
      radius: parseFloat(cs.borderTopLeftRadius), shadow: cs.boxShadow, cursor: cs.cursor, text: k.textContent, kids: k.children.length, lines, sw: k.scrollWidth, cw: k.clientWidth, ring, room };
  });
  // 이름 · 학교 글자가 실제로 닿는 오른쪽 끝(줄마다 글자 상자)
  const textRight = Math.max(...[...row.querySelectorAll('.row__name, .row__org')].map((el) => {
    const rg = document.createRange(); rg.selectNodeContents(el); return Math.max(...[...rg.getClientRects()].map((x) => x.right));
  }));
  const num = row.querySelector('.v__n, .v--now');
  return { code: row.querySelector('.row__code').textContent, row: R(row), col: R(col), parts, textRight, numFs: num ? parseFloat(getComputedStyle(num).fontSize) : 0,
    nameLines: Math.round(row.querySelector('.row__name').getBoundingClientRect().height / 22), sr: (col.querySelector('.sr-only') || {}).textContent || '' };
}));
const near = (a, b, e = 0.5) => Math.abs(a - b) <= e;
const isTag = (p) => /\bstag\b/.test(p.cls);
const isChip = (p) => /\bst\b/.test(p.cls) && !/st--unknown/.test(p.cls);
const isNum = (p) => /^v\b|\bv\b/.test(p.cls);
// 글자 대비(WCAG) — 'rgb(r, g, b)' 두 개
const lum = (c) => { const [r, g, b] = c.match(/\d+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const COLORS = {
  resv:      { bg: 'rgb(239, 235, 254)', ink: 'rgb(59, 45, 174)', edge: 'rgb(91, 69, 224)' },
  'resv-off': { bg: 'rgb(243, 241, 250)', ink: 'rgb(90, 83, 133)', edge: 'rgb(218, 213, 238)' },
  off:       { bg: 'rgb(241, 243, 247)', ink: 'rgb(90, 107, 133)' },
  pause:     { bg: 'rgb(255, 255, 255)', ink: 'rgb(90, 107, 133)', edge: 'rgb(213, 218, 227)' }
};
const CHIP = { free: 'rgb(8, 119, 63)', normal: 'rgb(244, 212, 0)', busy: 'rgb(229, 37, 33)' };
// 대기 분이 없는 상태: 목록의 한 줄 글 · 색 갈래 · 한눈에 두 줄
const TAGS = { 'C-05': ['현장예약', 'resv', '현장/예약'], 'C-06': ['예약 마감', 'resv-off', '예약/마감'], 'B-03': ['잠시 중단', 'pause', '잠시/중단'], 'C-01': ['오늘 마감', 'off', '오늘/마감'] };
const colorOk = (p, k) => !!p && p.bg === COLORS[k].bg && p.ink === COLORS[k].ink && (!COLORS[k].edge || p.edge === COLORS[k].edge);
// 현장예약만 네 면 같은 진보라 3px 테두리(안쪽 그림자 없음) · 네 모서리 4px, 나머지 상태 표시는 1px 그대로
const RESV_RING = 'rgb(91, 69, 224)';
const ringOk = (p, k) => !!p && !!p.ring && p.ring.r.every((x) => x === 4) && (k === 'resv'
  ? p.ring.w.every((x) => x === 3) && p.ring.c.every((c) => c === RESV_RING) && p.shadow === 'none'
  : p.ring.w.every((x) => x === 1) && p.ring.c.every((c) => c === p.ring.c[0]));

/* ── L · G · X : 예시 화면, 폭마다 ───────────────────────────────── */
const WIDTHS = [360, 390, 768, 1024, 1440];
const STATES = { 'A-02': ['is-free', '5분', '여유'], 'B-01': ['is-normal', '20분', '보통'], 'A-04': ['is-busy', '30분', '혼잡'],
  'C-05': ['is-resv', '현장', '예약'], 'C-06': ['is-resv-closed', '예약', '마감'], 'B-03': ['is-pause', '잠시', '중단'], 'C-01': ['is-closed', '오늘', '마감'] };
let tagBg = null, realRow = null;
for (const W of WIDTHS) {
  const { ctx, page } = await openPage(W, '/visitor.html?demo=1');
  await until(() => page.$$eval('#list .row', (r) => r.length === 14));
  const rows = await rowsInfo(page);
  const by = Object.fromEntries(rows.map((r) => [r.code, r]));
  const c0 = rows[0].col;
  t(`L1 ${W}px 목록: 오른쪽 상태 칸이 모든 줄에서 80px · 같은 자리`, rows.every((r) => near(r.col.w, 80) && near(r.col.l, c0.l) && near(r.col.r, c0.r)), JSON.stringify(rows.map((r) => [r.code, r.col.w, r.col.r])));
  t(`L2 ${W}px 목록: 숫자 · 칩 · 상태 표시 · 정보 없음 모두 칸의 가로 가운데(숫자 가운데 = 칩 가운데, ±0.5px)`, rows.every((r) => r.parts.every((p) => near(p.box.c, r.col.c))),
    JSON.stringify(rows.map((r) => [r.code, r.parts.map((p) => [p.cls.split(' ')[0], Math.round((p.box.c - r.col.c) * 10) / 10])])));
  const tags = rows.flatMap((r) => r.parts.filter(isTag)), chips = rows.flatMap((r) => r.parts.filter(isChip));
  t(`L3 ${W}px 목록: 칩 60×22 · 13px 700(숫자 32px 의 보조) · 상태 표시 76×34 · 14px 700`,
    chips.length >= 8 && chips.every((p) => near(p.box.w, 60) && near(p.box.h, 22) && p.fs === 13 && p.fw === 700)
    && rows.filter((r) => r.numFs).every((r) => r.numFs >= 22 && r.parts.filter(isChip).every((p) => p.fs < r.numFs))
    && tags.length === 4 && tags.every((p) => near(p.box.w, 76) && near(p.box.h, 34) && p.fs === 14 && p.fw === 700),
    JSON.stringify({ chips: chips.map((p) => [p.box.w, p.box.h, p.fs, p.fw]), tags: tags.map((p) => [p.box.w, p.box.h, p.fs, p.fw]) }));
  t(`L4 ${W}px 목록: 상태 표시는 한 줄 '현장예약' · '예약 마감' · '잠시 중단' · '오늘 마감'(잘림 없음) · 화면 읽기는 정확한 한 줄`, Object.entries(TAGS).every(([code, [text]]) => {
    const p = by[code] && by[code].parts[0];
    return !!p && isTag(p) && p.text === text && p.lines === 1 && p.sw <= p.cw + 0.5;
  }) && by['C-05'].sr === '현장예약 운영 중' && by['C-06'].sr === '현장예약 마감' && by['B-03'].sr === '잠시 중단' && by['C-01'].sr === '오늘 마감',
  JSON.stringify(Object.keys(TAGS).map((c) => by[c] && [c, by[c].parts.map((p) => [p.text, p.lines]), by[c].sr])));
  t(`L5 ${W}px 목록: 상태 표시는 단추처럼 보이지 않음(글만 · 아이콘 없음 · 바깥 그림자 없음 · 모서리 4px · 누름 손가락 없음 · 단추 · 링크 아님)`,
    tags.every((p) => p.kids === 0 && p.tag === 'SPAN' && !/rgba?\([^)]*\)\s+-?\d+px\s+-?\d+px\s+[1-9]/.test(p.shadow.replace(/inset[^,]*/g, '')) && p.radius <= 4 && p.cursor !== 'pointer'),
    JSON.stringify(tags.map((p) => [p.tag, p.kids, p.shadow, p.radius, p.cursor])));
  t(`L6 ${W}px 목록: 색 — 현장예약 보라(네 면 진보라 테두리) · 예약 마감 채도 낮은 보라 · 잠시 중단 흰 바탕 + 옅은 회색 테두리 · 오늘 마감 옅은 회색 · 칩은 예전 색`,
    Object.entries(TAGS).every(([code, [, k]]) => colorOk(by[code] && by[code].parts[0], k))
    && by['C-06'].parts[0].bg !== by['C-01'].parts[0].bg
    && [['A-02', 'free'], ['B-01', 'normal'], ['A-04', 'busy']].every(([code, k]) => { const c = by[code].parts.find(isChip); return !!c && c.bg === CHIP[k]; }),
    JSON.stringify(Object.keys(TAGS).map((c) => by[c] && by[c].parts[0] && [c, by[c].parts[0].bg, by[c].parts[0].ink, by[c].parts[0].edge, by[c].parts[0].shadow])));
  const rv = by['C-05'] && by['C-05'].parts[0];
  t(`L13 ${W}px 목록: 현장예약 테두리 — 네 면 모두 3px #5B45E0 · 왼쪽 안쪽 그림자 없음 · 네 모서리 4px · 다른 상태 표시는 1px 그대로`,
    Object.entries(TAGS).every(([code, [, k]]) => ringOk(by[code] && by[code].parts[0], k)),
    JSON.stringify(Object.keys(TAGS).map((c) => by[c] && by[c].parts[0] && [c, by[c].parts[0].ring, by[c].parts[0].shadow])));
  t(`L14 ${W}px 목록: 현장예약 글자가 답답하지 않음 — 76×34 그대로 · 테두리 안쪽에서 글자까지 좌우 6px · 위아래 4px 이상 · 좌우 · 위아래 여백이 고름(±1px)`,
    !!rv && near(rv.box.w, 76) && near(rv.box.h, 34) && rv.room[0] >= 6 && rv.room[1] >= 6 && rv.room[2] >= 4 && rv.room[3] >= 4
    && near(rv.room[0], rv.room[1], 1) && near(rv.room[2], rv.room[3], 1), JSON.stringify(rv && rv.room.map((x) => Math.round(x * 10) / 10)));
  const ratios = Object.keys(TAGS).map((c) => contrast(by[c].parts[0].ink, by[c].parts[0].bg));
  t(`L7 ${W}px 목록: 상태 표시 글자 대비 4.5:1 이상`, ratios.every((x) => x >= 4.5), ratios.map((x) => x.toFixed(2)).join(' · '));
  t(`L8 ${W}px 목록: 상태 칸이 줄의 세로 가운데(±1.5px)`, rows.every((r) => near((r.col.t + r.col.b) / 2, (r.row.t + r.row.b) / 2, 1.5)), '');
  const oneLine = rows.filter((r) => r.nameLines === 1), hs = [...new Set(oneLine.map((r) => Math.round(r.row.h * 2) / 2))];
  t(`L9 ${W}px 목록: 한 줄 이름 줄은 상태와 상관없이 같은 높이 · PR #60 전(73.4px)보다 높아지지 않음`, oneLine.length >= 5 && hs.length === 1 && hs[0] <= 73.5,
    JSON.stringify(rows.map((r) => [r.code, r.nameLines, r.row.h])));
  // 화면 안내 목록 그림(E9)이 견줄 실제 화면 값
  if (W === 390) realRow = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#list .row')].find((r) => r.querySelector('.row__code').textContent === 'C-05');
    const s = (el, ...k) => { const cs = getComputedStyle(el); return k.map((x) => cs[x]).join(' '); };
    return { code: s(row.querySelector('.row__code'), 'fontSize', 'fontWeight', 'color'), name: s(row.querySelector('.row__name'), 'fontSize', 'fontWeight', 'lineHeight'), org: s(row.querySelector('.row__org'), 'fontSize', 'fontWeight', 'color'),
      strip: s(row, 'position') + ' ' + getComputedStyle(row, '::before').width + ' ' + getComputedStyle(row, '::before').backgroundColor, h: row.getBoundingClientRect().height };
  });
  t(`L10 ${W}px 목록: 부스명 · 학교명이 상태 칸을 넘지 않음(칸 앞 8px 이상)`, rows.every((r) => r.textRight <= r.col.l - 8), JSON.stringify(rows.map((r) => [r.code, Math.round(r.textRight), Math.round(r.col.l)])));
  const ovf = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  t(`L11 ${W}px 목록: 가로 넘침 없음`, ovf <= 0, `넘침 ${ovf}px`);
  const listStates = Object.fromEntries(rows.map((r) => [r.code, r.parts.map((p) => (isTag(p) ? p.text : p.text.replace(/\s+/g, ''))).join('')]));
  const wantList = { 'A-02': '5분여유', 'B-01': '20분보통', 'A-04': '30분혼잡', 'C-05': '현장예약', 'C-06': '예약 마감', 'B-03': '잠시 중단', 'C-01': '오늘 마감' };
  t(`X1 ${W}px 예시 목록: 일곱 상태가 모두 보임`, Object.entries(wantList).every(([k, v]) => listStates[k] === v), JSON.stringify(listStates));
  const hero = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('[data-count]')].map((b) => { const w = b.querySelector('.count__w'); return { w: w.textContent, n: Number(b.querySelector('[data-n]').textContent), fit: w.getBoundingClientRect().right <= b.getBoundingClientRect().right + 0.5, sq: getComputedStyle(b.querySelector('.sq')).backgroundColor }; });
    const seg = [...document.querySelectorAll('#h-dist .dist__s')].filter((x) => !x.hidden).map((x) => ({ k: x.getAttribute('data-seg'), bg: getComputedStyle(x).backgroundColor }));
    const c = document.querySelector('.counts');
    return { chips, seg, sub: document.getElementById('h-sub').textContent, over: c.scrollWidth - c.clientWidth };
  });
  t(`H1 ${W}px 상단 요약: 다섯 상태 순서 · 예시 3 · 4 · 2 · 1 · 3 · 낱말이 칸 안에 들어감`, JSON.stringify(hero.chips.map((x) => [x.w, x.n])) === JSON.stringify([['여유', 3], ['보통', 4], ['혼잡', 2], ['현장예약', 1], ['중단·마감', 3]]) && hero.chips.every((x) => x.fit) && hero.over <= 0, JSON.stringify(hero.chips));
  t(`H2 ${W}px 막대: 혼잡 다음 현장예약(보라) · 그다음 중단·마감(회색) · 범례 네모와 같은 색`, JSON.stringify(hero.seg.map((x) => x.k)) === JSON.stringify(['free', 'normal', 'busy', 'resv', 'off', 'unknown']) && hero.seg[3].bg === RESV_RING && hero.seg[3].bg === hero.chips[3].sq && hero.seg[4].bg === 'rgb(138, 147, 171)' && hero.seg[4].bg === hero.chips[4].sq, JSON.stringify(hero.seg));
  t(`H3 ${W}px 아래 줄: 집계 기준만 — 13곳(현장예약 · 예약 마감 곳 수는 위 숫자에)`, hero.sub === '현재 운영 상태가 입력된 13곳 기준', hero.sub);
  tagBg = tagBg || Object.fromEntries(Object.entries(TAGS).map(([c, [, k]]) => [k, by[c].parts[0].bg]));
  if (SHOTS && [360, 390, 768, 1024, 1440].includes(W)) {
    const groups = await page.$$('#list .group');
    for (const [i, g] of groups.slice(1).entries()) await g.screenshot({ path: join(SHOTS, `list-zone${'BC'[i]}-${W}.png`) });
  }

  // 한눈에
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /한눈에/.test(b.textContent)).click());
  await until(() => page.$$eval('.tile', (x) => x.length === 14));
  const tiles = await page.evaluate(() => [...document.querySelectorAll('.tile')].map((el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const parts = ['.tile__v', '.tile__w'].map((s) => { const x = el.querySelector(s); const xr = x.getBoundingClientRect(); return { t: x.textContent, btm: xr.bottom, sw: x.scrollWidth, cw: x.clientWidth, fs: parseFloat(getComputedStyle(x).fontSize) }; });
    return { no: el.querySelector('.tile__no').textContent, noTop: el.querySelector('.tile__no').getBoundingClientRect().top - r.top, size: r.width, cls: el.className, v: parts[0], w: parts[1], btm: r.bottom, bg: cs.backgroundColor, ink: cs.color };
  }));
  const tb = Object.fromEntries(tiles.map((x) => [x.no, x]));
  t(`G1 ${W}px 한눈에: 일곱 상태 칸(두 줄 낱말 — 목록과 같은 말)`, Object.entries(STATES).every(([k, [cls, v, w]]) => tb[k] && tb[k].cls.includes(cls) && tb[k].v.t === v && tb[k].w.t === w),
    JSON.stringify(Object.keys(STATES).map((k) => tb[k] && [k, tb[k].cls, tb[k].v.t, tb[k].w.t])));
  t(`G2 ${W}px 한눈에: 모든 칸 글자가 칸 안에(아래 · 옆 넘침 없음, 가장 좁은 칸 ${Math.round(Math.min(...tiles.map((x) => x.size)))}px)`,
    tiles.every((x) => x.v.btm <= x.btm - 1 && x.w.btm <= x.btm - 1 && x.v.sw <= x.v.cw + 0.5 && x.w.sw <= x.w.cw + 0.5),
    JSON.stringify(tiles.filter((x) => !(x.v.btm <= x.btm - 1 && x.w.btm <= x.btm - 1 && x.v.sw <= x.v.cw + 0.5 && x.w.sw <= x.w.cw + 0.5)).map((x) => x.no)));
  t(`G3 ${W}px 한눈에: 글자 크기 — 상태 낱말 12px 이상 · 대기 분이 없는 칸 두 줄 14px`,
    ['A-02', 'B-01', 'A-04'].every((k) => tb[k].w.fs >= 12) && Object.keys(TAGS).every((k) => tb[k].v.fs >= 14 && tb[k].w.fs >= 14),
    JSON.stringify(Object.keys(STATES).map((k) => [k, tb[k].v.fs, tb[k].w.fs])));
  t(`G4 ${W}px 한눈에: 목록 상태 표시와 같은 색 갈래(보라 · 채도 낮은 보라 · 흰 바탕 · 옅은 회색)`, !!tagBg && Object.entries(TAGS).every(([c, [, k]]) => tb[c].bg === tagBg[k] && tb[c].ink === COLORS[k].ink),
    JSON.stringify(Object.keys(TAGS).map((k) => [k, tb[k].bg, tb[k].ink])));
  t(`G5 ${W}px 한눈에: 번호가 칸마다 같은 높이(±1px)`, tiles.every((x) => near(x.noTop, tiles[0].noTop, 1)), JSON.stringify(tiles.map((x) => Math.round(x.noTop * 10) / 10)));
  const tovf = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  t(`G6 ${W}px 한눈에: 가로 넘침 없음`, tovf <= 0, `넘침 ${tovf}px`);
  if (SHOTS && [360, 390, 1440].includes(W)) {
    const groups = await page.$$('#list .group');
    for (const [i, g] of groups.entries()) await g.screenshot({ path: join(SHOTS, `tiles-zone${'ABC'[i]}-${W}.png`) });
  }
  await ctx.close();
}

/* ── L12 : 두 줄 이름 ────────────────────────────────────────────── */
for (const W of [360, 390]) {
  const { ctx, page } = await openPage(W, '/visitor.html?demo=1', { longName: true });
  await until(() => page.$$eval('#list .row', (r) => r.length === 14));
  const rows = await rowsInfo(page);
  const o = rows.find((r) => r.code === 'C-05');
  t(`L12 ${W}px 두 줄 이름: 상태 표시가 줄 세로 가운데 · 칸 가운데 · 이름이 칸을 넘지 않음`, !!o && o.nameLines >= 2 && near((o.col.t + o.col.b) / 2, (o.row.t + o.row.b) / 2, 1.5)
    && o.parts.every((p) => near(p.box.c, o.col.c)) && o.textRight <= o.col.l - 8, JSON.stringify(o));
  if (SHOTS && W === 390) {
    const row = await page.evaluateHandle(() => [...document.querySelectorAll('#list .row')].find((r) => r.querySelector('.row__code').textContent === 'C-05'));
    await row.asElement().screenshot({ path: join(SHOTS, `list-longname-${W}.png`) });
  }
  await ctx.close();
}

/* ── X2 · X3 : 지금 계신 부스(QR) · 실제 화면으로 돌아가기 ─────────── */
for (const [id, text, k] of [['ex-c05', '현장예약', 'resv'], ['ex-c06', '예약 마감', 'resv-off'], ['ex-b03', '잠시 중단', 'pause'], ['ex-c01', '오늘 마감', 'off'], ['ex-a04', null, null]]) {
  const { ctx, page } = await openPage(390, `/visitor.html?demo=1&b=${id}`);
  await until(() => page.$('#here .here__val'));
  const h = await page.evaluate(() => {
    const v = document.querySelector('#here .here__val'), vr = v.getBoundingClientRect();
    const kids = [...v.children].filter((x) => !x.classList.contains('sr-only')).map((x) => { const r = x.getBoundingClientRect(), cs = getComputedStyle(x); return { cls: x.className, c: (r.left + r.right) / 2, w: r.width, h: r.height,
      fs: parseFloat(cs.fontSize), bg: cs.backgroundColor, ink: cs.color, edge: cs.borderTopColor, text: x.textContent, shadow: cs.boxShadow,
      ring: { w: ['Top', 'Right', 'Bottom', 'Left'].map((s) => parseFloat(cs[`border${s}Width`])), c: ['Top', 'Right', 'Bottom', 'Left'].map((s) => cs[`border${s}Color`]),
        r: ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((s) => parseFloat(cs[`border${s}Radius`])) } }; });
    return { c: (vr.left + vr.right) / 2, kids };
  });
  if (text) {
    const b = h.kids[0];
    t(`X2 지금 계신 부스(QR) ${id}: 같은 한 줄 표시 '${text}'(목록보다 조금 크게 · 88×64 보다 작게) · 같은 색`, !!b && /stag--big/.test(b.cls) && b.text === text
      && b.h <= 40 && b.h > 34 && b.fs === 15 && b.w * b.h < 88 * 64 && colorOk(b, k) && ringOk(b, k), JSON.stringify(h));
  } else {
    t('X2 지금 계신 부스(QR) 대기 분: 큰 숫자 가운데 = 칩(68×24) 가운데', h.kids.length === 2 && near(h.kids[1].w, 68) && near(h.kids[1].h, 24) && near(h.kids[0].c, h.kids[1].c), JSON.stringify(h));
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
  // 화면 안내의 상태 표시 규칙은 관람객 화면 것을 글자 그대로 옮긴 것이어야 합니다(한쪽만 고치면 모양이 갈라짐)
  const tagCss = (file) => { const s = readFileSync(join(ROOT, file), 'utf8').replace(/\r/g, ''); const a = s.indexOf('.stag {'); return a < 0 ? '' : s.slice(a, s.indexOf('}', s.indexOf('.stag--big {')) + 1); };
  const a = tagCss('assets/visitor.css'), b = tagCss('live/example/example.css');
  t('E0 화면 안내 example.css 의 상태 표시 규칙 = visitor.css 와 글자 그대로', a.length > 100 && a === b, `${a.length} · ${b.length}`);
}
for (const W of WIDTHS) {
  const { ctx, page } = await openPage(W, '/example/');
  const ex = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.vr')].map((row) => {
      const col = row.querySelector('.vr__right'), cr = col.getBoundingClientRect();
      return { code: row.querySelector('.vr__code').textContent, colC: (cr.left + cr.right) / 2, colW: cr.width, parts: [...col.children].map((k) => { const r = k.getBoundingClientRect(), cs = getComputedStyle(k); return { cls: k.className, c: (r.left + r.right) / 2, w: r.width, h: r.height,
        bg: cs.backgroundColor, ink: cs.color, edge: cs.borderTopColor, text: k.textContent, shadow: cs.boxShadow,
        ring: { w: ['Top', 'Right', 'Bottom', 'Left'].map((s) => parseFloat(cs[`border${s}Width`])), c: ['Top', 'Right', 'Bottom', 'Left'].map((s) => cs[`border${s}Color`]),
          r: ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((s) => parseFloat(cs[`border${s}Radius`])) } }; }) };
    });
    const tile = (cls) => { const el = document.querySelector('.vp__tiles .tile.' + cls); if (!el) return null; const cs = getComputedStyle(el); return { v: el.querySelector('.tile__v').textContent, w: el.querySelector('.tile__w').textContent, bg: cs.backgroundColor, ink: cs.color }; };
    const cnt = [...document.querySelectorAll('.vp__counts .cnt')].map((x) => [x.querySelector('.cnt__w').textContent, Number(x.querySelector('.cnt__n').textContent), x.querySelector('.cnt__w').getBoundingClientRect().right <= x.getBoundingClientRect().right + 0.5]);
    const dist = [...document.querySelectorAll('.vp__dist .dist')].map((x) => x.className.replace('dist dist--', ''));
    return { rows, cnt, dist, tiles: document.querySelectorAll('.vp__tiles .tile').length, tPause: tile('is-pause'), tClosed: tile('is-closed'), tResv: tile('is-resv'), tResvClosed: tile('is-resv-closed'),
      demo: [...document.querySelectorAll('a.sublink')].map((a) => a.getAttribute('href') + ' ' + a.firstChild.textContent), ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  const er = Object.fromEntries(ex.rows.map((r) => [r.code, r]));
  const want = { 'D-03': ['잠시 중단', 'pause'], 'E-01': ['오늘 마감', 'off'], 'E-02': ['현장예약', 'resv'], 'E-03': ['예약 마감', 'resv-off'] };
  const eParts = ex.rows.flatMap((r) => r.parts);
  t(`E1 ${W}px 화면 안내 목록: 상태 칸 80px · 숫자 · 칩 · 상태 표시 가운데 · 칩 60×22 · 상태 표시 76×34`, ex.rows.length === 7 && ex.rows.every((r) => near(r.colW, 80) && r.parts.every((p) => near(p.c, r.colC)))
    && eParts.filter((p) => /\bstag\b/.test(p.cls)).length === 4 && eParts.filter((p) => /\bstag\b/.test(p.cls)).every((p) => near(p.w, 76) && near(p.h, 34))
    && eParts.filter((p) => /\bst\b/.test(p.cls)).every((p) => near(p.w, 60) && near(p.h, 22)), JSON.stringify(ex.rows));
  t(`E2 ${W}px 화면 안내 목록: 상태 표시 글 · 색 · 테두리(현장예약 네 면 3px) = 관람객 화면`, Object.entries(want).every(([c, [w, k]]) => er[c] && er[c].parts[0] && er[c].parts[0].text === w && colorOk(er[c].parts[0], k) && ringOk(er[c].parts[0], k)), JSON.stringify(Object.keys(want).map((c) => er[c])));
  t(`E3 ${W}px 화면 안내 한눈에: 일곱 칸 · 두 줄 낱말 · 색 = 관람객 화면`, ex.tiles === 7 && !!ex.tPause && ex.tPause.v + '/' + ex.tPause.w === '잠시/중단' && ex.tClosed.v + '/' + ex.tClosed.w === '오늘/마감'
    && ex.tResv.v + '/' + ex.tResv.w === '현장/예약' && ex.tResvClosed.v + '/' + ex.tResvClosed.w === '예약/마감' && !!tagBg
    && ex.tResv.bg === tagBg.resv && ex.tResvClosed.bg === tagBg['resv-off'] && ex.tClosed.bg === tagBg.off && ex.tPause.bg === tagBg.pause, JSON.stringify([ex.tPause, ex.tClosed, ex.tResv, ex.tResvClosed]));
  t(`E4 ${W}px 화면 안내: 두 카드에 예시 화면 살펴보기 링크 · 가로 넘침 없음`, JSON.stringify(ex.demo) === JSON.stringify(['/?demo=1 관람객 예시 화면 살펴보기', '/booth-ctrl?demo 부스 운영자 예시 화면 살펴보기']) && ex.ovf <= 0, JSON.stringify({ demo: ex.demo, ovf: ex.ovf }));
  t(`E11 ${W}px 화면 안내 상단 요약: 실제 화면과 같은 다섯 상태 · 일곱 부스 합 · 막대에 현장예약 구간`, JSON.stringify(ex.cnt.map((x) => [x[0], x[1]])) === JSON.stringify([['여유', 1], ['보통', 1], ['혼잡', 1], ['현장예약', 1], ['중단·마감', 3]]) && ex.cnt.every((x) => x[2]) && JSON.stringify(ex.dist) === JSON.stringify(['free', 'normal', 'busy', 'resv', 'off']), JSON.stringify([ex.cnt, ex.dist]));
  const op = await page.evaluate(() => {
    const R = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
    const panels = [...document.querySelectorAll('.cpx:not(.cpx--both)')].map((x) => ({ box: R(x), name: x.querySelector('.cpx__t').textContent, what: x.querySelector('.cpx__d').textContent,
      rows: ['.cp__modes', '.cp__now', '.cpx__seen', '.cp__pad'].map((s) => Math.round(R(x.querySelector(s)).t - R(x).t)) }));
    const top = getComputedStyle(document.querySelector('.cpx--resv .cpx__top'));
    const inside = [...document.querySelectorAll('.cp .w, .cp .rv, .cp .off, .cp .seen__cell, .cp .cp__mode')].filter((x) => x.scrollWidth > x.clientWidth + 0.5).map((x) => x.className);
    const css = (el, ...k) => { const cs = getComputedStyle(el); return k.map((x) => cs[x]).join(' '); };
    const vr = [...document.querySelectorAll('.vr')].find((r) => r.querySelector('.vr__code').textContent === 'E-02');
    const pv = { code: css(vr.querySelector('.vr__code'), 'fontSize', 'fontWeight', 'color'), name: css(vr.querySelector('.vr__name'), 'fontSize', 'fontWeight', 'lineHeight'), org: css(vr.querySelector('.vr__org'), 'fontSize', 'fontWeight', 'color'),
      strip: css(vr, 'position') + ' ' + getComputedStyle(vr, '::before').width + ' ' + getComputedStyle(vr, '::before').backgroundColor, h: vr.getBoundingClientRect().height };
    const pageText = document.body.innerText;
    const pins = [...document.querySelectorAll('.pins dt')].map((x) => x.textContent);
    const rvs = [...document.querySelectorAll('.cpx--resv .rv__t')].map((x) => x.textContent);
    const cp = R(document.querySelector('.card__pv.cp')), cta = R(document.querySelectorAll('.card__foot .cta')[1]);
    const vp = R(document.querySelector('.card__pv.vp')), cta0 = R(document.querySelectorAll('.card__foot .cta')[0]);
    return { panels, ring: [top.borderTopWidth, top.borderRightWidth, top.borderBottomWidth, top.borderLeftWidth, top.borderTopColor], head: R(document.querySelector('.cp__head')), inside,
      gapUnderOperator: cta.t - cp.b, gapUnderVisitor: cta0.t - vp.b, ctaSame: Math.abs(cta.t - cta0.t), previewBottom: Math.abs(vp.b - cp.b), cards: [...document.querySelectorAll('.card')].map((c) => R(c).w),
      pv, pins, rvs, extra: document.querySelectorAll('.resv-how').length, oldPin: /123456|11월 4일/.test(pageText), guide: /현장예약 부스는 대기시간 대신/.test(document.querySelector('.card__guide').textContent),
      noQr: !document.querySelector('.vq') && !/부스 앞 QR/.test(pageText), both: [...document.querySelectorAll('.cpx--both .off__t')].map((x) => x.textContent), seenTag: !!document.querySelector('.seen__cell .stag--resv') };
  });
  const [pw, pr] = op.panels;
  t(`E5 ${W}px 운영자 예시: 부스 정보 카드 아래 현장대기 · 그 밑에 현장예약 · 같은 폭 · 같은 높이(±1px)`,
    op.panels.length === 2 && pw.name === '현장대기' && pr.name === '현장예약' && pw.box.t >= op.head.b && near(pw.box.l, pr.box.l) && pr.box.t >= pw.box.b && near(pw.box.w, pr.box.w) && near(pw.box.h, pr.box.h, 1), JSON.stringify(op.panels.map((p) => [p.name, p.box])));
  t(`E6 ${W}px 운영자 예시: 두 칸의 구성 자리가 같음(선택 줄 · 현재 상태 · 상태 칸 · 단추판, ±1px) · 칸 안 글자 넘침 없음 · 공통 단추는 맨 아래 한 번`,
    pw.rows.every((y, i) => near(y, pr.rows[i], 1)) && op.inside.length === 0 && JSON.stringify(op.both) === JSON.stringify(['변동 없음 · 지금 확인', '잠시 중단', '오늘 운영 마감']), JSON.stringify([pw.rows, pr.rows, op.inside, op.both]));
  t(`E7 ${W}px 현장예약 구분: 칸 머리 네 면 3px #5B45E0 · '대기시간 입력 없이 예약으로 운영' · '현장예약 운영 중' · '예약 마감' 단추 · 상태 칸에 같은 표시`,
    op.ring.slice(0, 4).every((x) => x === '3px') && op.ring[4] === RESV_RING && pr.what === '대기시간 입력 없이 예약으로 운영' && op.seenTag
    && JSON.stringify(op.rvs) === JSON.stringify(['현장예약 운영 중', '예약 마감']), JSON.stringify([op.ring, op.rvs]));
  t(`E9 ${W}px 미리보기: 실제 화면에 없는 설명을 넣지 않음 · 설명은 바깥 안내 문장 · QR 미리보기 없음`, op.extra === 0 && op.guide && op.noQr, JSON.stringify([op.extra, op.guide, op.noQr]));
  if (W === 390) t('E9 390px 목록 미리보기 = 실제 목록: 번호 띠 · 번호 · 이름 · 학교 글자 · 줄 높이(±1px)', ['code', 'name', 'org', 'strip'].every((k) => op.pv[k] === realRow[k]) && near(op.pv.h, realRow.h, 1), JSON.stringify([op.pv, realRow]));
  t(`E10 ${W}px PIN 안내: 예시 화면 · 실제 화면을 나눠 적고 번호 · 날짜가 없음(리허설이 끝나도 틀리지 않음)`, JSON.stringify(op.pins) === JSON.stringify(['예시 화면', '실제 화면']) && !op.oldPin, JSON.stringify([op.pins, op.oldPin]));
  if (W >= 1024) t(`E8 ${W}px 두 카드 나란히: 같은 폭 · 두 미리보기 아래 끝과 두 단추가 같은 줄 · 빈칸 없음(미리보기 아래 ${Math.round(op.gapUnderVisitor)} · ${Math.round(op.gapUnderOperator)}px)`,
    near(op.cards[0], op.cards[1], 1) && op.ctaSame <= 0.5 && op.previewBottom <= 0.5 && op.gapUnderVisitor <= 40 && op.gapUnderOperator <= 40, JSON.stringify([op.cards, op.ctaSame, op.previewBottom, op.gapUnderVisitor, op.gapUnderOperator]));
  if (SHOTS) {
    const cards = await page.$$('.card');
    await cards[0].screenshot({ path: join(SHOTS, `example-visitor-card-${W}.png`) });
    await cards[1].screenshot({ path: join(SHOTS, `example-op-card-${W}.png`) });
  }
  await ctx.close();
}

await browser.close();
server.close();
if (TMP) rmSync(TMP, { recursive: true, force: true });
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} / ${results.length} 통과${BASE ? `  (기준 ${BASE})` : ''}`);
process.exit(bad.length ? 1 : 0);
