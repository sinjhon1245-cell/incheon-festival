/* 관람객 화면 '한눈에' 칸 · 전체 탭을 실제 Chrome 에서 봅니다.
   기준은 short-names-105.md(105곳 검증표)입니다. 실행: node test-visitor-glance.mjs --deps <폴더>

     N  이름   검증표 형식 · 105곳 · 서로 다른 기관이 같은 이름이 아님 · 공식 이름을 바꾸지 않음
     L  폭     320 360 390 768 1024 1440: 표와 일치 · 한 줄 · 넘침 · 겹침 · 칸 높이 · 글자 차례 · 색 · 낱말 · 화면 읽기
     E  예외   표에 없는 긴 이름은 한 줄에 말줄임표 · 공식 이름 유지 · 뜻 모를 약어를 만들지 않음
     T  탭     전체 N곳: 숫자만 강조 · 곳 수 합 · 고른 칸 표시 · 탭 기능
     S  기능   한눈에에서 검색 · 초기화 · 학교급 거르기 · 목록 전환 · 실제 자동 갱신 뒤 검색 유지
*/
import { readFileSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import http from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const puppeteer = createRequire(join(resolve(arg('deps')), 'package.json'))('puppeteer-core');
const CHROME = arg('chrome', ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => { try { readFileSync(p); return true; } catch { return false; } }));
const SHOTS = arg('shots', '');

const results = [];
function t(name, ok, note = '') { results.push({ name, ok: !!ok, note }); console.log(`${ok ? '통과' : '실패'}  ${name}${!ok && note ? '  — ' + note : ''}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 검증표 ─────────────────────────────────────────────────────── */
const TABLE = readFileSync(join(HERE, 'short-names-105.md'), 'utf8').split(/\r?\n/)
  .filter((l) => l.startsWith('| ') && !l.startsWith('| 번호') && !l.startsWith('| ---'))
  .map((l) => { const [code, zone, official, short, len, why] = l.slice(2, -2).split(' | '); return { code, zone, official, short, len: Number(len), why }; });

// 상태는 칸의 모든 갈래가 나오게 돌려 씁니다. [운영 방식, 상태, 예약, 대기 분, 칸 갈래, 대기 글자, 상태 낱말]
const STATES = [
  ['wait', '여유', null, 0, 'is-free', '바로', '여유'], ['wait', '여유', null, 5, 'is-free', '5분', '여유'], ['wait', '보통', null, 20, 'is-normal', '20분', '보통'],
  ['wait', '혼잡', null, 45, 'is-busy', '45분', '혼잡'], ['wait', '혼잡', null, 120, 'is-busy', '120분', '혼잡'], ['reserve', null, 'open', null, 'is-resv', '현장', '예약'],
  ['reserve', null, 'closed', null, 'is-resv-closed', '예약', '마감'], ['wait', '중단', null, 0, 'is-pause', '잠시', '중단'], ['wait', '마감', null, 0, 'is-closed', '오늘', '마감'],
  ['wait', null, null, null, 'is-unknown', '—', '정보 없음'],
];
const NOON = Date.parse('2026-11-06T03:00:00Z');
const stamp = new Date(NOON).toISOString();
const booths = TABLE.map((r, i) => {
  const [opMode, status, reserve, waitMinutes] = STATES[i % STATES.length];
  const m = r.code.match(/\d+/);
  const exp = r.zone === '체험';
  return { id: `g${i + 1}`, no: Number(m[0]), code: r.code, zone: r.zone, name: exp ? r.official : `시험 프로그램 ${r.code}`, org: exp ? '' : r.official, program: '', opMode, status, reserve, waitMinutes, updatedAt: status || reserve ? stamp : null };
});
const want = Object.fromEntries(TABLE.map((r, i) => [r.code, { ...r, st: STATES[i % STATES.length] }]));
const data = { version: 1, generatedAt: stamp, mode: 'normal', liveReady: true,
  event: { title: '시험 행사', venue: '시험 장소', dateLabel: '시험 날짜', timeLabel: '10:00 ~ 17:00', start: new Date(NOON - 36e5).toISOString(), end: new Date(NOON + 36e5).toISOString(), mapUrl: '' },
  zones: [{ key: '초등', label: '초등', order: 1 }, { key: '중등', label: '중등', order: 2 }, { key: '고등', label: '고등', order: 3 }, { key: '특수', label: '특수', order: 4 }, { key: '체험', label: '체험존', order: 5 }, { key: '미래', label: '미래채움존', order: 6 }],
  booths, unplaced: [] };

/* ── N : 표 ─────────────────────────────────────────────────────── */
{
  const count = (z) => TABLE.filter((r) => r.zone === z).length;
  t('N1 105곳 · 구역별 곳 수(초 29 · 중 25 · 특 1 · 고 29 · 미래 9 · 체험 12) · 번호 중복 없음', TABLE.length === 105 && count('초등') === 29 && count('중등') === 25 && count('특수') === 1 && count('고등') === 29 && count('미래') === 9 && count('체험') === 12 && new Set(TABLE.map((r) => r.code)).size === 105, String(TABLE.length));
  t('N2 짧은 이름 누락 없음 · 근거 있음 · 글자 수 표기가 맞음', TABLE.every((r) => r.short && r.why && [...r.short.replace(/\s/g, '')].length === r.len), JSON.stringify(TABLE.filter((r) => !r.short || !r.why)));
  const owner = {};
  for (const r of TABLE) (owner[r.short] = owner[r.short] || new Set()).add(r.official);
  const clash = Object.entries(owner).filter(([, s]) => s.size > 1).map(([k]) => k);
  t('N3 서로 다른 학교 · 기관이 같은 이름으로 보이지 않음', clash.length === 0, JSON.stringify(clash));
  t('N4 학교 이름은 3~6글자 · 그중 6글자는 공식 이름이 긴 3곳뿐', TABLE.filter((r) => r.len > 5 && r.zone !== '체험').map((r) => r.short).sort().join() === '바이오과학고,인하사대부고,인하사대부중' && TABLE.every((r) => r.len >= 3 && r.len <= 6), JSON.stringify(TABLE.filter((r) => r.len > 5).map((r) => r.short)));
  const kept = TABLE.filter((r) => r.zone === '체험' && !r.official.replace(/\s/g, '').includes(r.short.replace(/\s/g, '')));
  t('N5 체험 12곳은 등록된 프로그램명 속 낱말만 씀(없는 기관명 없음)', kept.length === 0, JSON.stringify(kept));
  const fut = TABLE.filter((r) => r.zone === '미래' && !r.official.replace(/\s/g, '').startsWith(r.short));
  t('N6 미래채움 9곳은 등록된 기관명의 앞부분 그대로(끝의 협동조합만 뺌)', fut.length === 0, JSON.stringify(fut));
}

/* ── 서버 ───────────────────────────────────────────────────────── */
const net = { snap: 0, pollMs: 0 };
const MAP = { 'visitor.html': 'visitor.html', 'assets/visitor.css': 'assets/visitor.css', 'assets/booth-core.js': 'assets/booth-core.js', 'assets/venue-map.js': 'assets/venue-map.js', 'assets/mock-data.js': 'assets/mock-data.js', 'assets/config.js': 'assets/config.js' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  if (p === 'api/live-snapshot') { net.snap += 1; res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); return; }
  if (!MAP[p]) { res.writeHead(404); res.end(); return; }
  let out = readFileSync(join(REPO, MAP[p]));
  if (p === 'assets/config.js') out = out.toString('utf8') + '\nwindow.FESTIVAL_CONFIG.visitorSiteUrl = "./";\n' + (net.pollMs ? 'window.FESTIVAL_CONFIG.pollingIntervalMs = ' + net.pollMs + ';\n' : '');
  res.writeHead(200, { 'Content-Type': TYPES[extname(MAP[p])] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(out);
});
await new Promise((r) => server.listen(48000 + Math.floor(Math.random() * 1000), '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--no-default-browser-check'] });

function pinClock(at) {
  const Real = Date, diff = at - Real.now();
  class Pinned extends Real {
    constructor(...a) { if (a.length) super(...a); else super(Real.now() + diff); }
    static now() { return Real.now() + diff; }
  }
  window.Date = Pinned;
}
async function open(W, patch = null) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.evaluateOnNewDocument(pinClock, NOON);
  await page.setViewport({ width: W, height: 844, deviceScaleFactor: 2, isMobile: W < 768, hasTouch: W < 768 });
  await page.setRequestInterception(true);
  page.on('request', (req) => { const u = req.url(); if (u.startsWith(ORIGIN + '/') || u.startsWith('data:') || /^https:\/\/cdn\.jsdelivr\.net\/gh\/orioncactus\/pretendard/.test(u)) req.continue(); else req.abort(); });
  if (patch) patch();
  await page.goto(ORIGIN + '/visitor.html', { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForSelector('#tabs .tab');
  await page.waitForSelector('#list .row');
  await sleep(150);
  return { ctx, page, errs };
}
const click = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
const toGrid = async (page) => { await click(page, '[data-view="grid"]'); await sleep(200); };
const tileNos = (page) => page.$$eval('#list .tile__no', (r) => r.map((x) => x.textContent));
const typeQ = async (page, q) => { await page.click('#q', { clickCount: 3 }); await page.keyboard.type(q); await sleep(120); };

/* ── L : 폭마다 ─────────────────────────────────────────────────── */
const COLS = { 320: 3, 360: 4, 390: 4, 768: 6, 1024: 6, 1440: 6 };
for (const W of Object.keys(COLS).map(Number)) {
  const { ctx, page, errs } = await open(W);
  await toGrid(page);
  const m = await page.evaluate(() => {
    const R = (e) => e.getBoundingClientRect();
    const lines = (e) => { const g = document.createRange(); g.selectNodeContents(e); return new Set([...g.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size; };
    const probe = (v) => { const d = document.createElement('i'); d.style.background = v; document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; };
    const tiles = [...document.querySelectorAll('#list .tile')].map((el) => {
      const no = el.querySelector('.tile__no'), o = el.querySelector('.tile__o'), s = el.querySelector('.tile__s'), v = el.querySelector('.tile__v'), w = el.querySelector('.tile__w');
      const r = R(el), a = R(no), b = R(o), c = R(s), cs = getComputedStyle(el), os = getComputedStyle(o);
      const inner = (e) => { const g = document.createRange(); g.selectNodeContents(e); return g.getBoundingClientRect(); };
      const ai = inner(no), bi = inner(o), ci = inner(s);
      return { code: no.textContent, o: o.textContent, v: v.textContent, w: w.textContent, cls: el.className, title: el.getAttribute('title'), sr: el.querySelector('.sr-only').textContent, oHidden: o.getAttribute('aria-hidden'), sHidden: s.getAttribute('aria-hidden'),
        h: r.height, wd: r.width, offs: [a.top - r.top, b.top - r.top, c.top - r.top], lines: lines(o), oCut: o.scrollWidth > o.clientWidth + 0.5, sCut: s.scrollWidth > s.clientWidth + 0.5, nowrap: os.whiteSpace, ell: os.textOverflow,
        inside: [ai, bi, ci].every((x) => x.left >= r.left + 1 && x.right <= r.right - 1 && x.top >= r.top && x.bottom <= r.bottom), order: a.bottom <= b.top + 0.5 && b.bottom <= c.top + 0.5,
        centred: Math.abs((bi.left + bi.right) / 2 - (r.left + r.right) / 2) <= 1 && Math.abs((ai.left + ai.right) / 2 - (r.left + r.right) / 2) <= 1,
        sizes: [parseFloat(getComputedStyle(no).fontSize), parseFloat(os.fontSize), parseFloat(getComputedStyle(v).fontSize), parseFloat(getComputedStyle(w).fontSize)], weight: os.fontWeight, bg: cs.backgroundColor, shadowEdge: cs.boxShadow };
    });
    const grid = document.querySelector('#list .tiles');
    return { tiles, cols: getComputedStyle(grid).gridTemplateColumns.split(' ').length, ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth, st: { free: probe('var(--st-free)'), normal: probe('var(--st-normal)'), busy: probe('var(--st-busy)') } };
  });
  const T = m.tiles, bad = (f) => JSON.stringify(T.filter(f).slice(0, 4).map((x) => [x.code, x.o, x.wd, x.lines]));
  t(`L1 ${W}px 105곳 모두 표의 이름 · 번호와 이름이 맞음`, T.length === 105 && T.every((x) => want[x.code] && want[x.code].short === x.o), bad((x) => !want[x.code] || want[x.code].short !== x.o));
  t(`L2 ${W}px 이름 한 줄 · 잘림 없음(가장 좁은 칸 ${Math.round(Math.min(...T.map((x) => x.wd)))}px)`, T.every((x) => x.lines === 1 && !x.oCut && x.nowrap === 'nowrap'), bad((x) => x.lines !== 1 || x.oCut));
  t(`L3 ${W}px 칸 높이 · 세 줄 자리가 모두 같음`, T.every((x) => x.h === T[0].h && x.offs.every((y, i) => Math.abs(y - T[0].offs[i]) <= 0.5)), JSON.stringify([...new Set(T.map((x) => x.h))]));
  t(`L4 ${W}px 번호 · 이름 · 상태가 칸 안에 · 겹침 없음 · 가운데`, T.every((x) => x.inside && x.order && x.centred && !x.sCut), bad((x) => !x.inside || !x.order || !x.centred || x.sCut));
  t(`L5 ${W}px 글자 차례: 번호 > 이름 ≥ 상태 · 이름 굵게 · 12px 이상`, T.every((x) => x.sizes[0] >= 16 && x.sizes[0] > x.sizes[1] && x.sizes[1] >= x.sizes[3] && Math.min(...x.sizes) >= 10 && Number(x.weight) >= 700 && x.sizes[3] >= 12), JSON.stringify([...new Set(T.map((x) => x.sizes.join('/')))]));
  t(`L6 ${W}px ${COLS[W]}열 · 가로 넘침 없음`, m.cols === COLS[W] && m.ovf <= 0, JSON.stringify([m.cols, m.ovf]));
  const colour = { 'is-free': m.st.free, 'is-normal': m.st.normal, 'is-busy': m.st.busy };
  t(`L7 ${W}px 상태 갈래 · 대기 글자 · 낱말 · 색 유지`, T.every((x) => { const s = want[x.code].st; return x.cls.includes(s[4]) && x.v === s[5] && x.w === s[6] && (!colour[s[4]] || x.bg === colour[s[4]]); }), bad((x) => { const s = want[x.code].st; return !x.cls.includes(s[4]) || x.v !== s[5] || x.w !== s[6]; }));
  t(`L8 ${W}px 공식 이름은 화면 읽기 · title 에 그대로 · 눈으로 보는 줄은 겹쳐 읽히지 않음`, T.every((x) => x.sr.includes(want[x.code].official) && x.title === want[x.code].official && x.oHidden === 'true' && x.sHidden === 'true'), bad((x) => !x.sr.includes(want[x.code].official)));
  t(`L9 ${W}px 페이지 오류 없음`, errs.length === 0, errs.join(' | '));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `glance-${W}.png`) });
  await ctx.close();
}

/* ── E : 표에 없는 이름 ─────────────────────────────────────────── */
{
  const keep = data.booths.slice(0, 4).map((b) => ({ ...b }));
  const { ctx, page } = await open(320, () => {
    data.booths[0].org = '아주아주아주아주긴이름의기관법인';
    data.booths[1].org = '인천새로운초등학교';
    data.booths[2].org = '';
    data.booths[2].name = '표에 없는 아주 긴 프로그램 이름입니다';
    data.booths[3].org = '[예시] 인천시험중학교';
  });
  await toGrid(page);
  const m = await page.evaluate(() => [...document.querySelectorAll('#list .tile')].map((el) => { const o = el.querySelector('.tile__o'), g = document.createRange(); g.selectNodeContents(o); return { code: el.querySelector('.tile__no').textContent, o: o.textContent, h: el.getBoundingClientRect().height, lines: new Set([...g.getClientRects()].map((r) => Math.round(r.top))).size, cut: o.scrollWidth > o.clientWidth + 0.5, right: o.getBoundingClientRect().right <= el.getBoundingClientRect().right, title: el.getAttribute('title'), sr: el.querySelector('.sr-only').textContent }; }));
  const at = Object.fromEntries(m.map((x) => [x.code, x]));
  const [a, b, c, d] = keep.map((k) => at[k.code]);
  t('E1 표에 없는 긴 기관명: 약어를 만들지 않고 그대로 · 한 줄 말줄임 · 칸 안 · 칸 높이 같음', a.o === '아주아주아주아주긴이름의기관법인' && a.cut && a.lines === 1 && a.right && a.h === m[20].h, JSON.stringify(a));
  t('E2 표에 없는 학교는 같은 규칙으로 줄임', b.o === '새로운초', JSON.stringify(b));
  t('E3 기관명 · 표 모두 없으면 프로그램명 그대로 · 공식 이름은 화면 읽기에', c.o === '표에 없는 아주 긴 프로그램 이름입니다' && c.lines === 1 && c.sr.includes(c.o), JSON.stringify(c));
  t("E4 앞의 '[예시]' 는 이름에 보이지 않음", d.o === '시험중', JSON.stringify(d));
  keep.forEach((k, i) => Object.assign(data.booths[i], k));
  await ctx.close();
}

/* ── T : 전체 탭 ────────────────────────────────────────────────── */
for (const W of [320, 360, 390, 768, 1024, 1440]) {
  const { ctx, page } = await open(W);
  const m = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('#tabs .tab')], a = tabs[0], n = a.querySelector('.tab__n'), b = n.querySelector('b'), bs = getComputedStyle(b), ns = getComputedStyle(n), box = document.getElementById('tabs');
    const others = tabs.slice(1).map((x) => { const e = x.querySelector('.tab__n'); return e ? getComputedStyle(e).display === 'none' ? 0 : parseFloat(getComputedStyle(e).fontSize) : 0; });
    const vals = tabs.slice(1).map((x) => Number((x.getAttribute('aria-label').match(/(\d+)곳/) || [])[1]));
    const tr = a.getBoundingClientRect(), r = tabs.map((x) => x.getBoundingClientRect());
    return { text: a.innerText.replace(/\s+/g, ''), press: a.getAttribute('aria-pressed'), aria: a.getAttribute('aria-label'), n: [parseFloat(bs.fontSize), bs.fontWeight, bs.color], unit: parseFloat(ns.fontSize), others, vals, deco: [bs.backgroundColor, ns.backgroundColor, bs.boxShadow, bs.textShadow, bs.animationName], line: getComputedStyle(a, '::after').backgroundColor, h: tr.height, same: r.every((x) => Math.abs(x.height - tr.height) <= 0.5 && Math.abs(x.top - tr.top) <= 0.5), gaps: r.slice(1).map((x, i) => x.left - r[i].right), scroll: box.scrollWidth - box.clientWidth, more: box.classList.contains('is-more') };
  });
  t(`T1 ${W}px 전체 탭 '전체 105곳' · 숫자만 크고 굵게 · 보라 · 곳은 일반 크기`, m.text === '전체105곳' && m.n[0] === 17 && m.n[1] === '800' && m.n[2] === 'rgb(91, 69, 224)' && m.unit === 13 && m.aria === '전체 부스 105곳', JSON.stringify(m));
  t(`T2 ${W}px 배경 · 그림자 · 움직임 없음`, m.deco.slice(0, 2).every((c) => c === 'rgba(0, 0, 0, 0)') && m.deco.slice(2, 4).every((c) => c === 'none') && m.deco[4] === 'none', JSON.stringify(m.deco));
  t(`T3 ${W}px 다른 탭 숫자는 13px 또는 숨김 그대로 · 구역 곳 수 합 105`, m.others.every((x) => x === 13 || x === 0) && m.vals.reduce((a, b) => a + b, 0) === 105, JSON.stringify([m.others, m.vals]));
  t(`T4 ${W}px 다섯 탭 한 줄 · 같은 높이 · 겹침 · 옆 밀림 없음`, m.same && m.gaps.every((g) => g >= 0) && m.scroll <= 0 && !m.more, JSON.stringify([m.gaps, m.scroll, m.more]));
  await click(page, '#tabs [data-zone="초등"]'); await sleep(120);
  const p = await page.evaluate(() => { const a = document.querySelector('#tabs [data-zone=""]'), b = document.querySelector('#tabs [data-zone="초등"]'); return { all: a.getAttribute('aria-pressed'), school: b.getAttribute('aria-pressed'), line: getComputedStyle(b, '::after').backgroundColor, allLine: getComputedStyle(a, '::after').backgroundColor, num: getComputedStyle(a.querySelector('b')).color, rows: document.querySelectorAll('#list .row').length }; });
  t(`T5 ${W}px 다른 탭을 고르면 눌림 · 밑줄이 옮겨 가고 숫자 색은 그대로 · 거르기 동작`, m.press === 'true' && p.all === 'false' && p.school === 'true' && p.allLine === 'rgba(0, 0, 0, 0)' && p.line !== 'rgba(0, 0, 0, 0)' && p.num === 'rgb(91, 69, 224)' && p.rows === 29, JSON.stringify(p));
  await ctx.close();
}

/* ── S : 기능 ───────────────────────────────────────────────────── */
{
  const { ctx, page, errs } = await open(390);
  await toGrid(page);
  await typeQ(page, '신석');
  t('S1 입력만으로는 칸이 줄지 않음', (await tileNos(page)).length === 105);
  await page.keyboard.press('Enter'); await sleep(250);
  t('S2 검색: 한눈에도 45번 한 칸 · 단추 초기화', JSON.stringify(await tileNos(page)) === '["45"]' && (await page.$eval('#search-btn', (x) => x.textContent)) === '초기화', JSON.stringify(await tileNos(page)));
  await click(page, '#search-btn'); await sleep(250);
  t('S3 초기화: 105칸 · 검색칸 비움', (await tileNos(page)).length === 105 && (await page.$eval('#q', (x) => x.value)) === '');
  const zones = {};
  for (const [k, n] of [['초등', 29], ['중등', 26], ['고등', 29], ['미래', 21]]) { await click(page, `#tabs [data-zone="${k}"]`); await sleep(160); zones[k] = (await tileNos(page)).length; t(`S4 학교급 ${k}: 한눈에 ${n}칸`, zones[k] === n, JSON.stringify(zones)); }
  await click(page, '#tabs [data-zone=""]'); await sleep(160);
  await click(page, '[data-view="list"]'); await sleep(200);
  const row = await page.$$eval('#list .row', (r) => { const x = r.find((e) => e.querySelector('.row__code').textContent === '45'); return x.querySelector('.row__org').textContent; });
  t('S5 목록으로 돌아가면 공식 이름 그대로', row === '인천신석초등학교', row);
  await toGrid(page);
  t('S6 다시 한눈에 · 페이지 오류 없음', (await tileNos(page)).length === 105 && errs.length === 0, errs.join(' | '));
  await ctx.close();
}
{
  // 실제 자동 갱신: 시험 서버의 간격만 15초(앱 하한)로 줄여 진짜 타이머가 돌게 합니다.
  net.pollMs = 15000;
  const { ctx, page } = await open(390);
  await toGrid(page);
  await typeQ(page, '신석');
  await page.keyboard.press('Enter'); await sleep(250);
  const b = data.booths.find((x) => x.code === '45'), keep = { ...b };
  Object.assign(b, { opMode: 'wait', status: '혼잡', reserve: null, waitMinutes: 55 });
  const from = net.snap, end = Date.now() + 24000;
  while (Date.now() < end && net.snap <= from) await sleep(200);
  await sleep(400);
  const m = await page.$eval('#list .tile', (x) => ({ cls: x.className, v: x.querySelector('.tile__v').textContent, w: x.querySelector('.tile__w').textContent, o: x.querySelector('.tile__o').textContent }));
  t('S7 실제 자동 갱신: 검색어 · 결과 유지 · 칸 값만 바뀜 · 이름 그대로', net.snap > from && JSON.stringify(await tileNos(page)) === '["45"]' && (await page.$eval('#q', (x) => x.value)) === '신석' && m.v === '55분' && m.w === '혼잡' && m.cls.includes('is-busy') && m.o === '신석초', JSON.stringify(m));
  Object.assign(b, keep);
  net.pollMs = 0;
  await ctx.close();
}

await browser.close();
server.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} / ${results.length} 통과`);
process.exit(bad.length ? 1 : 0);
