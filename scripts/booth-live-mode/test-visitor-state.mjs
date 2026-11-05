/* 관람객 화면의 보기 전환 · 제목(홈)을 실제 Chrome 에서 봅니다.
   자료는 short-names-105.md 의 105곳입니다. 실행: node test-visitor-state.mjs --deps <폴더>

     V  보기    목록 · 한눈에는 표시 방식만 바꿈: 학교급 · 상태 고름 · 검색 · 정렬 유지 · 곳 수와 표시 부스 일치 · 기록 · 요청 없음
     H  제목    학교급 · 보기 · 정렬 · 상태 고름 · 검색 초기화 · 맨 위 · 새로 고침 · 요청 없음 · 뒤로 가기 · 터치 · 키보드 · 모양
     Q  QR      ?b= 로 들어온 지금 계신 부스는 제목을 눌러도 유지
     M  지도    열린 배치도 창을 닫음
     A  갱신    제목을 누른 뒤에도 실제 자동 갱신이 돌고 기본 화면 유지
     D  예시    ?demo=1 도 같은 동작 · 주소의 demo 유지
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

const results = [];
function t(name, ok, note = '') { results.push({ name, ok: !!ok, note }); console.log(`${ok ? '통과' : '실패'}  ${name}${!ok && note ? '  — ' + String(note).slice(0, 420) : ''}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ── 자료 ───────────────────────────────────────────────────────── */
const TABLE = readFileSync(join(HERE, 'short-names-105.md'), 'utf8').split(/\r?\n/)
  .filter((l) => l.startsWith('| ') && !l.startsWith('| 번호') && !l.startsWith('| ---'))
  .map((l) => { const [code, zone, official] = l.slice(2, -2).split(' | '); return { code, zone, official }; });
const STATES = [['wait', '여유', null, 0], ['wait', '여유', null, 5], ['wait', '보통', null, 20], ['wait', '혼잡', null, 45], ['wait', '혼잡', null, 60], ['reserve', null, 'open', null], ['reserve', null, 'closed', null], ['wait', '중단', null, 0], ['wait', '마감', null, 0], ['wait', '보통', null, 15]];
const NOON = Date.parse('2026-11-06T03:00:00Z');
const stamp = new Date(NOON).toISOString();
const booths = TABLE.map((r, i) => {
  const [opMode, status, reserve, waitMinutes] = STATES[i % STATES.length];
  const exp = r.zone === '체험';
  return { id: `s${i + 1}`, no: Number(r.code.match(/\d+/)[0]), code: r.code, zone: r.zone, name: exp ? r.official : `시험 프로그램 ${r.code}`, org: exp ? '' : r.official, program: '', opMode, status, reserve, waitMinutes, updatedAt: stamp };
});
const data = { version: 1, generatedAt: stamp, mode: 'normal', liveReady: true,
  event: { title: '시험 행사', venue: '시험 장소', dateLabel: '시험 날짜', timeLabel: '10:00 ~ 17:00', start: new Date(NOON - 36e5).toISOString(), end: new Date(NOON + 36e5).toISOString(), mapUrl: '' },
  zones: [{ key: '초등', label: '초등', order: 1 }, { key: '중등', label: '중등', order: 2 }, { key: '고등', label: '고등', order: 3 }, { key: '특수', label: '특수', order: 4 }, { key: '체험', label: '체험존', order: 5 }, { key: '미래', label: '미래채움존', order: 6 }],
  booths, unplaced: [] };
// 학교급 탭과 그 탭에 나와야 하는 번호
const TABS = [['', '전체', booths], ['초등', '초등', booths.filter((b) => b.zone === '초등')], ['중등', '중등·특수', booths.filter((b) => b.zone === '중등' || b.zone === '특수')], ['고등', '고등', booths.filter((b) => b.zone === '고등')], ['미래', '미래채움·체험', booths.filter((b) => b.zone === '미래' || b.zone === '체험')]];
const SIZES = { 전체: 105, 초등: 29, '중등·특수': 26, 고등: 29, '미래채움·체험': 21 };

/* ── 서버 ───────────────────────────────────────────────────────── */
const net = { snap: 0, pollMs: 0 };
const MAP = { 'visitor.html': 'visitor.html', 'assets/visitor.css': 'assets/visitor.css', 'assets/booth-core.js': 'assets/booth-core.js', 'assets/venue-map.js': 'assets/venue-map.js', 'assets/mock-data.js': 'assets/mock-data.js', 'assets/config.js': 'assets/config.js', 'assets/map/venue-map-v1.jpg': 'assets/map/venue-map-v1.jpg' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  if (p === 'api/live-snapshot') { net.snap += 1; res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); return; }
  if (!MAP[p]) { res.writeHead(404); res.end(); return; }
  let out = readFileSync(join(REPO, MAP[p]));
  if (p === 'assets/config.js') out = out.toString('utf8') + '\nwindow.FESTIVAL_CONFIG.visitorSiteUrl = "./";\n' + (net.pollMs ? 'window.FESTIVAL_CONFIG.pollingIntervalMs = ' + net.pollMs + ';\n' : '');
  res.writeHead(200, { 'Content-Type': TYPES[extname(MAP[p])] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(out);
});
await new Promise((r) => server.listen(49000 + Math.floor(Math.random() * 900), '127.0.0.1', r));
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
async function open(W, q = '') {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.evaluateOnNewDocument(pinClock, NOON);
  await page.setViewport({ width: W, height: 844, deviceScaleFactor: 2, isMobile: W < 768, hasTouch: W < 768 });
  await page.setRequestInterception(true);
  page.on('request', (req) => { const u = req.url(); if (u.startsWith(ORIGIN + '/') || u.startsWith('data:') || /^https:\/\/cdn\.jsdelivr\.net\/gh\/orioncactus\/pretendard/.test(u)) req.continue(); else req.abort(); });
  await page.goto(ORIGIN + '/visitor.html' + q, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForSelector('#list .row');
  await page.evaluate(() => { window.__sameDocument = true; });
  await sleep(120);
  return { ctx, page, errs };
}
const click = async (page, sel, ms = 130) => { await page.evaluate((s) => document.querySelector(s).click(), sel); await sleep(ms); };
const tab = (k) => `#tabs [data-zone="${k}"]`;
const shown = (page) => page.evaluate(() => {
  const on = (s) => { const e = document.querySelector(s); return e ? e.getAttribute('data-zone') ?? e.getAttribute('data-view') ?? e.getAttribute('data-sort') : null; };
  return { zone: on('#tabs [aria-pressed="true"]'), view: on('[data-view][aria-pressed="true"]'), sort: on('[data-sort][aria-pressed="true"]'), rows: [...document.querySelectorAll('#list .row__code')].map((x) => x.textContent), tiles: [...document.querySelectorAll('#list .tile__no')].map((x) => x.textContent), q: document.getElementById('q').value, btn: document.getElementById('search-btn').textContent, sortHidden: document.getElementById('sort-seg').hidden, y: Math.round(window.scrollY), mark: !!window.__sameDocument, url: location.pathname + location.search };
});
// 제목은 부드럽게 올라가므로 맨 위에 닿을 때까지 기다립니다(최대 2.5초).
const atTop = async (page) => { const end = Date.now() + 2500; while (Date.now() < end && (await page.evaluate(() => window.scrollY)) > 0) await sleep(50); await sleep(120); };
const isHome = (s) => s.zone === '' && s.view === 'list' && s.sort === 'code' && s.q === '' && s.btn === '검색' && s.rows.length === 105 && s.tiles.length === 0;
const applyQ = async (page, q) => { await page.click('#q', { clickCount: 3 }); await page.keyboard.type(q); await page.keyboard.press('Enter'); await sleep(200); };
const sorted = (a) => a.slice().sort();

for (const W of [320, 390, 1440]) {
  /* ── V : 보기 전환 ───────────────────────────────────────────── */
  {
    const { ctx, page, errs } = await open(W);
    const snap0 = net.snap, len0 = await page.evaluate(() => history.length);
    for (const [key, label, list] of TABS) {
      const want = sorted(list.map((b) => b.code));
      await click(page, tab(key));
      const a = await shown(page);
      await click(page, '[data-view="grid"]');
      const b = await shown(page);
      await click(page, '[data-view="list"]');
      const c = await shown(page);
      t(`V1 ${W}px ${label} 선택 → 한눈에 ${SIZES[label]}곳 → 목록 ${SIZES[label]}곳 · 탭 유지 · 표시 부스 = 그 학교급`, a.zone === key && same(sorted(a.rows), want) && b.zone === key && b.view === 'grid' && same(sorted(b.tiles), want) && b.rows.length === 0 && c.zone === key && c.view === 'list' && same(sorted(c.rows), want) && want.length === SIZES[label], JSON.stringify([a.zone, a.rows.length, b.zone, b.tiles.length, c.zone, c.rows.length]));
    }
    await click(page, '[data-view="grid"]');
    let keep = true;
    for (const [key, , list] of TABS) { await click(page, tab(key)); const s = await shown(page); keep = keep && s.view === 'grid' && s.zone === key && s.tiles.length === list.length; }
    t(`V2 ${W}px 한눈에 상태에서 학교급을 바꿔도 한눈에 유지 · 곳 수 일치`, keep);
    await click(page, tab(''));
    await click(page, '[data-view="list"]');
    keep = true;
    for (const [key, , list] of TABS) { await click(page, tab(key)); const s = await shown(page); keep = keep && s.view === 'list' && s.zone === key && s.rows.length === list.length; }
    t(`V3 ${W}px 목록 상태에서 학교급을 바꿔도 목록 유지 · 곳 수 일치`, keep);

    await click(page, tab('초등'));
    await click(page, '[data-sort="wait"]');
    const w0 = await shown(page);
    await click(page, '[data-view="grid"]');
    const w1 = await shown(page);
    await click(page, '[data-view="list"]');
    const w2 = await shown(page);
    t(`V4 ${W}px 대기 짧은 순 → 한눈에 → 목록: 정렬 · 순서 · 학교급 유지(한눈에는 정렬 단추만 숨김)`, w0.sort === 'wait' && w1.sortHidden && w1.zone === '초등' && w2.sort === 'wait' && !w2.sortHidden && same(w2.rows, w0.rows) && w2.zone === '초등', JSON.stringify([w0.sort, w1.sortHidden, w2.sort]));
    await click(page, '[data-sort="code"]');
    await click(page, tab(''));

    await click(page, '[data-count="여유"]');
    const c0 = await shown(page);
    await click(page, '[data-view="grid"]');
    const c1 = await shown(page);
    await click(page, '[data-view="list"]');
    const c2 = await shown(page);
    t(`V5 ${W}px 상태 고름(여유)도 보기를 바꿔도 유지`, c0.rows.length > 0 && c0.rows.length < 105 && same(sorted(c1.tiles), sorted(c0.rows)) && same(c2.rows, c0.rows), JSON.stringify([c0.rows.length, c1.tiles.length, c2.rows.length]));
    await click(page, '[data-count="여유"]');

    await applyQ(page, '신석');
    const q0 = await shown(page);
    await click(page, '[data-view="grid"]');
    const q1 = await shown(page);
    await click(page, '[data-view="list"]');
    const q2 = await shown(page);
    t(`V6 ${W}px 검색도 보기를 바꿔도 유지(검색어 · 결과 · 초기화 단추)`, same(q0.rows, ['45']) && same(q1.tiles, ['45']) && same(q2.rows, ['45']) && q1.q === '신석' && q2.btn === '초기화', JSON.stringify([q1.tiles, q2.rows, q2.q, q2.btn]));
    await click(page, '#search-btn');
    await click(page, tab('고등'));
    await applyQ(page, '신석');
    const q3 = await shown(page);
    await click(page, tab('초등'));
    const q4 = await shown(page);
    t(`V7 ${W}px 검색과 탭의 기존 규칙 그대로(검색하면 전체 · 탭을 고르면 검색 풀림)`, q3.zone === '' && same(q3.rows, ['45']) && q4.zone === '초등' && q4.q === '' && q4.rows.length === 29, JSON.stringify([q3.zone, q4.zone, q4.q]));
    t(`V8 ${W}px 보기 전환은 서버 요청 · 기록 칸을 늘리지 않음 · 페이지 오류 없음`, net.snap === snap0 && errs.length === 0, JSON.stringify([net.snap - snap0, await page.evaluate(() => history.length) - len0, errs]));
    await ctx.close();
  }

  /* ── H : 제목 ────────────────────────────────────────────────── */
  {
    const { ctx, page, errs } = await open(W);
    const snap0 = net.snap;
    await click(page, tab('고등'));
    await click(page, '[data-sort="wait"]');
    await click(page, '[data-count="보통"]');
    await click(page, '[data-view="grid"]');
    await page.evaluate(() => window.scrollTo(0, 900)); await sleep(150);
    const before = await shown(page);
    await page.evaluate(() => document.querySelector('.band__home').scrollIntoView({ block: 'center' })); await sleep(120);
    await page.click('.band__home'); await atTop(page);
    const s = await shown(page);
    t(`H1 ${W}px 제목: 학교급 전체 · 목록 · 번호순 · 상태 고름 풀림 · 맨 위`, before.zone === '고등' && before.view === 'grid' && isHome(s) && s.y === 0 && !(await page.$('#result .result__clear')), JSON.stringify([before.zone, before.view, s.zone, s.view, s.sort, s.rows.length, s.y]));
    t(`H2 ${W}px 새로 고침 없음 · 서버 요청 없음 · 주소 그대로`, s.mark && net.snap === snap0 && s.url === '/visitor.html', JSON.stringify([s.mark, net.snap - snap0, s.url]));

    await applyQ(page, '신석');
    await page.click('#q'); await page.keyboard.press('End'); await page.keyboard.type('초'); await sleep(120);
    await page.click('.band__home'); await sleep(500);
    const s2 = await shown(page);
    t(`H3 ${W}px 적용된 검색 + 입력 중인 글 모두 초기화 · 단추 검색`, isHome(s2) && (await page.evaluate(() => document.activeElement !== document.getElementById('q'))), JSON.stringify([s2.q, s2.btn, s2.rows.length]));
    await page.click('#q'); await page.keyboard.type('입력만'); await sleep(100);
    await page.click('.band__home'); await sleep(400);
    t(`H4 ${W}px 적용 전 입력만 있어도 초기화`, isHome(await shown(page)));

    // 뒤로 가기: 구역 → 상태 고름(칸 2개) → 제목이면 기본 칸으로 돌아가고, 푼 고름으로 되돌아가지 않음
    await click(page, tab('초등'));
    await click(page, '[data-count="여유"]');
    const n0 = await page.evaluate(() => history.state.n);
    await page.click('.band__home'); await sleep(500);
    const st = await page.evaluate(() => ({ n: history.state.n, zone: history.state.zone, count: history.state.count }));
    t(`H5 ${W}px 뒤로 가기 기록: 쌓인 칸을 거두고 기본 칸으로`, n0 === 3 && st.n === 1 && st.zone === '' && st.count === '' && isHome(await shown(page)), JSON.stringify([n0, st]));
    await page.evaluate(() => history.back()); await sleep(350);
    const toast = await page.$eval('#exit-toast', (x) => x.textContent);
    t(`H6 ${W}px 제목 뒤 뒤로 가기는 풀린 고름으로 돌아가지 않고 나가기 안내`, isHome(await shown(page)) && toast.includes('한 번 더'), toast);
    await sleep(2300);

    // 모양(방금 누른 마우스가 제목 위에 남아 있지 않게 치웁니다)
    await page.mouse.move(2, 500); await sleep(120);
    const look = await page.evaluate(() => {
      const h = document.querySelector('.band__title'), b = h.querySelector('.band__home'), hs = getComputedStyle(h), bs = getComputedStyle(b), r = b.getBoundingClientRect(), a = getComputedStyle(b, '::after');
      const cx = r.left + r.width / 2;
      const hitTop = document.elementFromPoint(cx, r.top - 4), hitBot = document.elementFromPoint(cx, r.bottom + 4);
      return { tag: b.tagName, type: b.type, text: b.textContent, name: b.getAttribute('aria-label'), kids: b.children.length, size: [hs.fontSize, bs.fontSize], weight: bs.fontWeight, line: bs.lineHeight, color: bs.color, bg: bs.backgroundColor, border: bs.borderTopWidth, shadow: bs.boxShadow, cursor: bs.cursor, deco: bs.textDecorationLine, left: r.left - h.getBoundingClientRect().left, hit: [hitTop === b, hitBot === b], areaH: r.height + parseFloat(a.top) * -1 + parseFloat(a.bottom) * -1, ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    t(`H7 ${W}px 제목 모양 그대로(24px · 800 · 흰색 · 배경 · 테두리 · 아이콘 없음) · 손가락 자리 44px`, look.tag === 'BUTTON' && look.type === 'button' && look.text === '부스 대기 현황' && look.kids === 0 && same(look.size, ['24px', '24px']) && look.weight === '800' && look.line === '32px' && look.color === 'rgb(255, 255, 255)' && look.bg === 'rgba(0, 0, 0, 0)' && look.border === '0px' && look.shadow === 'none' && look.cursor === 'pointer' && look.left === 0 && look.deco === 'none' && look.areaH >= 44 && look.hit.every(Boolean) && look.ovf <= 0, JSON.stringify(look));
    t(`H8 ${W}px 화면 읽기 이름에 제목 글자 포함 · 제목은 h1 안`, look.name.startsWith('부스 대기 현황') && look.name.includes('처음 화면') && (await page.$('h1 .band__home')) !== null, look.name);

    // 키보드
    await click(page, tab('중등'));
    // 제목 다음 칸(배치도 단추)에서 Shift+Tab 으로 닿으면 Tab 차례 안에 있다는 뜻입니다.
    await page.focus('#map-open');
    await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
    const tabs = 1, onTitle = await page.evaluate(() => document.activeElement.classList.contains('band__home'));
    await page.keyboard.press('Enter'); await sleep(450);
    const kb = await page.evaluate(() => ({ focus: document.activeElement.className, ring: getComputedStyle(document.activeElement).outlineStyle }));
    t(`H9 ${W}px 키보드: Tab 으로 닿고 Enter 로 동작 · 초점 유지 · 초점 표시`, onTitle && isHome(await shown(page)) && kb.focus === 'band__home' && kb.ring !== 'none', JSON.stringify([tabs, kb]));
    await click(page, tab('중등'));
    await page.focus('.band__home'); await page.keyboard.press('Space'); await sleep(450);
    t(`H10 ${W}px 키보드: Space 도 동작`, isHome(await shown(page)));

    if (W < 768) {
      await click(page, tab('고등'));
      await page.evaluate(() => window.scrollTo(0, 0)); await sleep(150);
      const r = await page.$eval('.band__home', (b) => { const x = b.getBoundingClientRect(); return { x: x.left + x.width / 2, y: x.top + x.height / 2 }; });
      await page.touchscreen.tap(r.x, r.y); await sleep(500);
      t(`H11 ${W}px 터치로 동작`, isHome(await shown(page)));
    } else {
      await page.hover('.band__home');
      const u = await page.$eval('.band__home', (b) => getComputedStyle(b).textDecorationLine);
      t(`H11 ${W}px 마우스를 올리면 밑줄로 눌리는 곳임을 알림`, u === 'underline', u);
    }
    t(`H12 ${W}px 페이지 오류 없음 · 요청 그대로`, errs.length === 0 && net.snap === snap0, JSON.stringify([errs, net.snap - snap0]));
    await ctx.close();
  }

  /* ── Q : QR ──────────────────────────────────────────────────── */
  {
    const b = booths.find((x) => x.code === '57');
    const { ctx, page, errs } = await open(W, `?b=${b.id}`);
    const snap0 = net.snap;
    const here = () => page.evaluate(() => { const h = document.getElementById('here'); return { on: !!h && !h.hidden && h.textContent.length > 0, text: h ? h.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) : '' }; });
    const h0 = await here();
    await click(page, tab('고등'));
    await click(page, '[data-view="grid"]');
    await applyQ(page, '신석');
    await page.evaluate(() => window.scrollTo(0, 700)); await sleep(120);
    await page.evaluate(() => document.querySelector('.band__home').click()); await atTop(page);
    const s = await shown(page), h1 = await here();
    const st = await page.evaluate(() => ({ here: history.state.here, n: history.state.n, search: location.search }));
    t(`Q1 ${W}px QR 접속: 제목을 눌러도 지금 계신 부스 · ?b= 유지 · 목록만 초기화`, h0.on && h1.on && h1.text === h0.text && st.here === true && st.search === `?b=${b.id}` && isHome({ ...s, url: '' }) && s.y === 0, JSON.stringify([h1.on, h1.text === h0.text, st, s.zone, s.view, s.sort, s.q, s.btn, s.rows.length, s.tiles.length, s.y]));
    t(`Q2 ${W}px QR 접속: 새로 고침 · 서버 요청 없음`, s.mark && net.snap === snap0 && errs.length === 0, JSON.stringify([s.mark, net.snap - snap0, errs]));
    await click(page, tab('초등'));
    await page.evaluate(() => document.querySelector('.band__home').click()); await sleep(500);
    t(`Q3 ${W}px 고름을 다시 쌓고 제목: QR 칸으로 돌아감`, (await here()).on && (await page.evaluate(() => history.state.here && history.state.n === 2 && location.search.includes('b='))));
    await ctx.close();
  }

  /* ── M : 지도 ────────────────────────────────────────────────── */
  {
    const { ctx, page, errs } = await open(W);
    const snap0 = net.snap;
    await click(page, tab('초등'));
    await page.evaluate(() => document.getElementById('map-open').click()); await sleep(400);
    const on = await page.evaluate(() => window.VenueMap.isOpen() && document.documentElement.classList.contains('vmap-on'));
    await page.evaluate(() => document.querySelector('.band__home').click()); await sleep(600);
    const m = await page.evaluate(() => ({ open: window.VenueMap.isOpen(), lock: document.documentElement.classList.contains('vmap-on'), dialog: document.querySelector('dialog[open]') !== null, map: history.state.map }));
    t(`M1 ${W}px 열린 배치도 창을 닫고 처음 화면으로 · 잠금 풀림`, on && !m.open && !m.lock && !m.dialog && !m.map && isHome(await shown(page)), JSON.stringify(m));
    await page.evaluate(() => document.getElementById('map-open').click()); await sleep(400);
    const again = await page.evaluate(() => window.VenueMap.isOpen());
    await page.evaluate(() => window.VenueMap.close()); await sleep(250);
    t(`M2 ${W}px 닫은 뒤 배치도를 다시 열 수 있음 · 오류 · 요청 없음`, again && errs.length === 0 && net.snap === snap0, JSON.stringify([again, errs]));
    await ctx.close();
  }
}

/* ── A : 실제 자동 갱신 ─────────────────────────────────────────── */
{
  net.pollMs = 15000;
  const { ctx, page } = await open(390);
  await click(page, tab('초등'));
  await click(page, '[data-view="grid"]');
  await page.click('.band__home'); await sleep(300);
  const b = booths.find((x) => x.code === '1'), keep = { ...b };
  Object.assign(b, { opMode: 'wait', status: '혼잡', reserve: null, waitMinutes: 55 });
  const from = net.snap, end = Date.now() + 24000;
  while (Date.now() < end && net.snap <= from) await sleep(200);
  await sleep(450);
  const row = await page.$$eval('#list .row', (r) => { const x = r.find((e) => e.querySelector('.row__code').textContent === '1'); return x.querySelector('.row__right').textContent; });
  const sync = await page.$eval('#sync', (x) => x.textContent);
  t('A1 제목을 누른 뒤에도 실제 자동 갱신이 돌고 값만 바뀜 · 기본 화면 유지', net.snap > from && row.includes('55') && sync === '자동 갱신 중' && isHome(await shown(page)), JSON.stringify([net.snap - from, row, sync]));
  Object.assign(b, keep);
  net.pollMs = 0;
  await ctx.close();
}

/* ── D : 협의용 예시 ────────────────────────────────────────────── */
for (const W of [320, 390, 1440]) {
  const { ctx, page, errs } = await open(W, '?demo=1');
  await click(page, '#tabs [data-zone="B"]');
  await click(page, '[data-view="grid"]');
  const a = await shown(page);
  await click(page, '[data-view="list"]');
  const b = await shown(page);
  await click(page, '[data-view="grid"]');
  await page.evaluate(() => document.querySelector('.band__home').click()); await sleep(500);
  const c = await shown(page);
  t(`D1 ${W}px 예시: 구역 유지 · 제목으로 처음 화면 · ?demo=1 유지 · 예시 띠 유지`, a.zone === 'B' && a.tiles.length === 4 && b.zone === 'B' && b.rows.length === 4 && c.zone === '' && c.view === 'list' && c.rows.length === 14 && c.url.endsWith('?demo=1') && !(await page.$eval('#demobar', (x) => x.hidden)) && errs.length === 0, JSON.stringify([a.zone, b.rows.length, c.rows.length, c.url, errs]));
  await ctx.close();
}

await browser.close();
server.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} / ${results.length} 통과`);
process.exit(bad.length ? 1 : 0);
