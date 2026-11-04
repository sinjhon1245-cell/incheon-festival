/* ===================================================================
   행사장 배치도 시험 — 실제 Chrome 에서 버튼 · 지도 창 · 확대 · 이동을 봅니다
   ───────────────────────────────────────────────────────────────────
   서버 · Production 에 닿지 않습니다. 이 파일의 작은 웹 서버가 저장소 파일(실제 공식 배치도)과
   예시 스냅샷(105곳)을 줍니다.
   터치는 Chrome 의 터치 입력 시뮬레이션(CDP)입니다. 실제 기기 시험이 아닙니다.

     B  단추    폭마다 보임 · 글자 잘림 없음 · 44px 이상 · 탭 줄 한 줄 · 가로 스크롤 없음 · 그림을 미리 받지 않음 · 대비
     O  창      열기 · 제목 · 포커스 · 비율 · 전체 보기 · 안내 문구 · 닫기 단추 · Esc · 포커스 복원 · 다시 열기
     Z  확대    휠(커서 기준) · + · − · 범위 제한 · 초기화 · 자판
     P  이동    끌기 · 가장자리 제한 · 작은 쪽 가운데
     T  터치    두 손가락 확대(가운데 기준) · 한 손가락 이동 · 뒤 화면이 움직이지 않음
     R  크기    창 크기 변경 뒤 다시 맞춤
     Y  구역    폭마다 구역 단추 · 누르면 그 구역이 화면 안 · 읽을 배율 · 직접 움직이면 표시 해제 · 터치
     E  오류    그림을 못 받을 때 안내 · 다시 불러오기
     K  유지    닫은 뒤 검색어 · 고른 탭 · 스크롤 · 뒤로 가기로 닫기 · 줄을 눌러도 창이 열리지 않음

   쓰는 법: node scripts/booth-live-mode/test-venue-map.mjs --deps <puppeteer-core 가 설치된 폴더> [--shots <폴더>]
   =================================================================== */
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import http from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const puppeteer = createRequire(join(resolve(arg('deps')), 'package.json'))('puppeteer-core');
const CHROME = arg('chrome', ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find((p) => existsSync(p)));
const SHOTS = arg('shots', '');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const results = [];
function t(name, ok, note = '') { results.push({ ok: !!ok }); console.log(`${ok ? '통과' : '실패'}  ${name}${!ok && note ? '  — ' + note : ''}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, d = 1) => Math.abs(a - b) <= d;

/* ── 공식 배치도 그림 ─────────────────────────────────────────────── */
const MAP_JS = readFileSync(join(REPO, 'assets/venue-map.js'), 'utf8');
const IMAGE_PATH = /src: '([^']+)'/.exec(MAP_JS)[1];
const IMAGE = readFileSync(join(REPO, IMAGE_PATH));
const IW = 1600, IH = 1076;
const ZONE_RECTS = Object.fromEntries([...MAP_JS.matchAll(/'?([\w-]+)'?: \[(\d+), (\d+), (\d+), (\d+)\]/g)].map((m) => [m[1], m.slice(2).map(Number)]));

/* ── 예시 스냅샷 105곳 ──────────────────────────────────────────── */
const now = new Date().toISOString();
const schools = JSON.parse(readFileSync(join(HERE, 'fixture-public-96.json'), 'utf8'));
const booth = (b, i) => ({ ...b, code: b.code || String(b.no), program: '', opMode: 'wait', status: ['여유', '보통', '혼잡'][i % 3], reserve: null, waitMinutes: 5 + (i % 3) * 10, updatedAt: now });
const data = { version: 1, generatedAt: now, mode: 'normal', liveReady: true,
  event: { title: '시험 행사', venue: '시험 장소', dateLabel: '시험 날짜', timeLabel: '10:00 ~ 17:00', start: new Date(Date.now() + 2 * 864e5).toISOString(), end: new Date(Date.now() + 3 * 864e5).toISOString(), mapUrl: '' },
  zones: [{ key: '초등', label: '초등', order: 1 }, { key: '중등', label: '중등', order: 2 }, { key: '고등', label: '고등', order: 3 }, { key: '특수', label: '특수', order: 4 }, { key: '체험', label: '체험존', order: 5 }, { key: '미래', label: '미래채움존', order: 6 }],
  booths: [...schools.map(booth),
    ...Array.from({ length: 12 }, (_, i) => booth({ id: `x${i + 1}`, no: i + 1, code: `체험${i + 1}`, zone: '체험', name: `시험 체험 ${i + 1}`, org: '', type: i < 4 ? '게임' : '교육' }, i)),
    ...Array.from({ length: 9 }, (_, i) => booth({ id: `f${i + 1}`, no: i + 1, code: `미래${i + 1}`, zone: '미래', name: `시험 미래 ${i + 1}`, org: '시험 협동조합' }, i))], unplaced: [] };

/* ── 서버 ───────────────────────────────────────────────────────── */
const FILES = ['visitor.html', 'assets/visitor.css', 'assets/booth-core.js', 'assets/mock-data.js', 'assets/config.js', 'assets/venue-map.js'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const net = { image: 0, fail: false };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  if (p === 'api/live-snapshot') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); return; }
  if (p === IMAGE_PATH) {
    net.image += 1;
    if (net.fail) { res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' }); res.end(IMAGE); return;
  }
  if (!FILES.includes(p)) { res.writeHead(404); res.end(); return; }
  let out = readFileSync(join(REPO, p));
  if (p === 'assets/config.js') out = out.toString('utf8') + '\nwindow.FESTIVAL_CONFIG.visitorSiteUrl = "./";\n';
  res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(out);
});
await new Promise((r) => server.listen(47000 + Math.floor(Math.random() * 1000), '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--no-default-browser-check'] });

async function openPage(W, H = 844) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const mobile = W < 768;
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', (req) => { const u = req.url(); if (u.startsWith(ORIGIN + '/') || u.startsWith('data:') || /^https:\/\/cdn\.jsdelivr\.net\/gh\/orioncactus\/pretendard/.test(u)) req.continue(); else req.abort(); });
  await page.goto(ORIGIN + '/visitor.html', { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForSelector('#list .row');
  await sleep(120);
  return { ctx, page, errs };
}
const state = (page) => page.evaluate(() => {
  const i = document.getElementById('vmap-img'), st = document.getElementById('vmap-stage').getBoundingClientRect();
  const m = /translate3d\(([-\d.e]+)px,\s*([-\d.e]+)px,\s*0(?:px)?\)\s*scale\(([-\d.e]+)\)/.exec(i.style.transform) || [];
  return { x: +m[1], y: +m[2], s: +m[3], W: i.naturalWidth, H: i.naturalHeight, vw: st.width, vh: st.height, left: st.left, top: st.top };
});
const inBounds = (v) => { const w = v.W * v.s, h = v.H * v.s; const okx = w <= v.vw + 0.5 ? near(v.x, (v.vw - w) / 2) : v.x <= 0.5 && v.x + w >= v.vw - 0.5; const oky = h <= v.vh + 0.5 ? near(v.y, (v.vh - h) / 2) : v.y <= 0.5 && v.y + h >= v.vh - 0.5; return okx && oky; };
const isOpen = (page) => page.evaluate(() => document.getElementById('vmap').open);
async function openMap(page) {
  await page.click('#map-open');
  await page.waitForFunction(() => { const n = document.getElementById('vmap-img'); return document.getElementById('vmap').open && n.complete && n.naturalWidth > 0 && !n.hidden; }, { timeout: 8000 });
  await sleep(120);
}
const tool = (page, id) => page.click('#' + id).then(() => sleep(60));
const zone = (page, id) => page.evaluate((k) => document.querySelector('[data-vzone="' + k + '"]').click(), id).then(() => sleep(380));
const pressed = (page) => page.evaluate(() => [...document.querySelectorAll('[data-vzone][aria-pressed="true"]')].map((b) => b.dataset.vzone));
// 지금 화면에 보이는 그림 자리(그림 좌표)
const seen = (v) => ({ l: -v.x / v.s, t: -v.y / v.s, r: (v.vw - v.x) / v.s, b: (v.vh - v.y) / v.s });
const lum = (c) => { const f = c.map((n) => { n /= 255; return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
const ratio = (p, q) => { const [x, y] = [lum(p), lum(q)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const rgb = (c) => c.match(/[\d.]+/g).map(Number);

/* ── I : 공식 그림 ─────────────────────────────────────────────── */
t('I1 구역 좌표 일곱 곳이 모두 그림 안', Object.keys(ZONE_RECTS).length === 7 && Object.values(ZONE_RECTS).every(([x, y, w, h]) => x >= 0 && y >= 0 && x + w <= IW && y + h <= IH), JSON.stringify(ZONE_RECTS));
t('I2 그림 파일 크기 700KB 이하', IMAGE.length <= 700 * 1024, String(IMAGE.length));

/* ── B : 단추, 폭마다 ───────────────────────────────────────────── */
for (const W of [320, 360, 375, 390, 414, 768, 1024, 1440]) {
  const { ctx, page, errs } = await openPage(W);
  const m = await page.evaluate(() => {
    const R = (e) => e.getBoundingClientRect();
    const b = document.getElementById('map-open'), s = getComputedStyle(b), box = document.getElementById('tabs'), ic = R(b.querySelector('svg')), sp = b.querySelector('span');
    const tabs = [...box.querySelectorAll('.tab')].map((x) => Math.round(R(x).top));
    const sync = document.getElementById('sync'), title = document.querySelector('.band__title');
    const hit = (a, c) => !(a.right <= c.left || c.right <= a.left || a.bottom <= c.top || c.bottom <= a.top);
    const r = R(b), band = getComputedStyle(document.querySelector('.band'));
    return { bandBg: band.backgroundColor, border: s.borderTopColor, w: r.width, h: r.height, left: r.left, right: r.right, top: r.top, text: b.innerText.trim(), cut: sp.scrollWidth > sp.clientWidth + 0.5, icon: ic.width, bg: s.backgroundColor, color: s.color,
      tabRows: new Set(tabs).size, tabs: tabs.length, tabScroll: box.scrollWidth - box.clientWidth, ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth, vw: document.documentElement.clientWidth,
      overSync: !sync.hidden && hit(r, R(sync)), overTitle: hit(r, R(title)), titleRight: R(title).right };
  });
  t(`B1 ${W}px 아이콘과 문구가 함께 보임 · 잘림 없음`, m.text === '배치도 보기' && !m.cut && m.icon >= 22 && m.icon <= 24 && m.right <= m.vw + 0.5 && m.left >= 0, JSON.stringify(m));
  t(`B2 ${W}px 높이 약 48px · 터치 영역 44px 이상`, m.h >= 44 && m.h <= 52 && m.w >= 44, JSON.stringify([m.w, m.h]));
  t(`B3 ${W}px 탭 5칸 한 줄 · 가로 스크롤 없음 · 제목 · 갱신 표시와 겹치지 않음`, m.tabs === 5 && m.tabRows === 1 && m.tabScroll <= 0 && m.ovf <= 0 && !m.overSync && !m.overTitle, JSON.stringify(m));
  if (W >= 768) t(`B4 ${W}px 단추는 제목 오른쪽`, m.left > m.titleRight, JSON.stringify([m.left, m.titleRight]));
  if (W === 390) {
    const band = rgb(m.bandBg), [br, bg, bb, ba] = rgb(m.border), edge = [br, bg, bb].map((n, i) => n * ba + band[i] * (1 - ba));
    t('B4b 글자 대비 4.5:1 이상 · 테두리가 띠와 3:1 이상', ratio(rgb(m.color), rgb(m.bg)) >= 4.5 && ratio(edge, band) >= 3, JSON.stringify([ratio(rgb(m.color), rgb(m.bg)), ratio(edge, band)]));
  }
  t(`B5 ${W}px 화면 오류 없음`, errs.length === 0, errs.join(' | '));
  if (SHOTS && [320, 390, 1440].includes(W)) await page.screenshot({ path: join(SHOTS, `main-${W}.png`) });
  await ctx.close();
}

/* ── O · Z · P · R : PC ─────────────────────────────────────────── */
{
  net.image = 0;
  const { ctx, page, errs } = await openPage(1440, 900);
  t('O0 창을 열기 전에는 그림을 받지 않음', net.image === 0, String(net.image));
  await openMap(page);
  const a = await page.evaluate(() => { const d = document.getElementById('vmap'), f = document.activeElement; return { title: document.getElementById(d.getAttribute('aria-labelledby')).textContent, modal: d.matches(':modal'), inside: d.contains(f), fid: f.id, hint: document.getElementById('vmap-hint').textContent, hintOn: !document.getElementById('vmap-hint').hidden, lock: getComputedStyle(document.documentElement).overflow, alt: document.getElementById('vmap-img').alt }; });
  t('O1 제목 · 모달 · 포커스가 창 안으로 · 대체 글', a.title === '행사장 배치도' && a.modal && a.inside && a.fid === 'vmap-stage' && /배치도/.test(a.alt), JSON.stringify(a));
  t('O2 PC 안내 문구', a.hintOn && a.hint === '마우스 휠로 확대하고 드래그하여 이동하세요.', a.hint);
  t('O3 그림은 처음 열 때 한 번만 받음', net.image === 1, String(net.image));
  const v0 = await state(page);
  const shown = await page.evaluate(() => { const r = document.getElementById('vmap-img').getBoundingClientRect(); return { w: r.width, h: r.height }; });
  t('O4 비율 유지 · 전체가 화면 안 · 가운데', near(shown.w / shown.h, IW / IH, 0.01) && shown.w <= v0.vw + 1 && shown.h <= v0.vh + 1 && inBounds(v0), JSON.stringify([shown, v0]));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'modal-1440.png') });

  // 휠: 커서가 가리키는 그림 자리가 그대로(그림이 화면보다 큰 뒤부터. 작은 쪽은 가운데에 묶임)
  const cx = v0.left + v0.vw * 0.3, cy = v0.top + v0.vh * 0.4;
  await page.mouse.move(cx, cy);
  await page.mouse.wheel({ deltaY: -120 });
  await sleep(100);
  const w1 = await state(page);
  t('Z1 휠로 확대 · 범위 안', w1.s > v0.s && inBounds(w1), JSON.stringify([v0.s, w1.s]));
  t('Z1b 조작하면 안내 문구가 사라짐', await page.$eval('#vmap-hint', (e) => e.hidden));
  for (let i = 0; i < 4; i++) await page.mouse.wheel({ deltaY: -120 });
  await sleep(100);
  const w2 = await state(page);
  const px = (cx - w2.left - w2.x) / w2.s, py = (cy - w2.top - w2.y) / w2.s;
  await page.mouse.wheel({ deltaY: -120 });
  await sleep(100);
  const v1 = await state(page);
  t('Z1c 화면보다 큰 그림은 커서 자리 고정', v1.s > w2.s && near(v1.x + px * v1.s, cx - v1.left, 1.5) && near(v1.y + py * v1.s, cy - v1.top, 1.5), JSON.stringify([w2.s, v1.s, v1.x + px * v1.s, cx - v1.left]));
  for (let i = 0; i < 30; i++) await page.mouse.wheel({ deltaY: -160 });
  await sleep(120);
  const vMax = await state(page);
  t('Z2 확대 상한(전체 보기의 6배) · 범위 안', near(vMax.s / v0.s, 6, 0.01) && inBounds(vMax), JSON.stringify(vMax.s / v0.s));
  t('Z2b 상한에서 + 단추 꺼짐', await page.$eval('#vmap-in', (b) => b.disabled));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'zoom-1440.png') });
  for (let i = 0; i < 40; i++) await page.mouse.wheel({ deltaY: 160 });
  await sleep(120);
  const vMin = await state(page);
  t('Z3 축소 하한(전체 보기) · 가운데로 돌아옴', near(vMin.s, v0.s, 1e-4) && near(vMin.x, v0.x) && near(vMin.y, v0.y), JSON.stringify([vMin, v0]));
  t('Z3b 하한에서 − 단추 꺼짐', await page.$eval('#vmap-out', (b) => b.disabled));

  await tool(page, 'vmap-in');
  const v2 = await state(page);
  t('Z4 + 단추: 1.6배 · 범위 안', near(v2.s / v0.s, 1.6, 0.01) && inBounds(v2), String(v2.s / v0.s));
  await tool(page, 'vmap-in'); await tool(page, 'vmap-out');
  const v3 = await state(page);
  t('Z5 − 단추: 되돌아감', near(v3.s / v0.s, 1.6, 0.01), String(v3.s / v0.s));

  // 끌기
  const sx = v0.left + v0.vw / 2, sy = v0.top + v0.vh / 2;
  await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx - 120, sy - 60, { steps: 6 }); await page.mouse.up();
  await sleep(80);
  const v4 = await state(page);
  t('P1 끌면 그만큼 이동', near(v4.x, Math.max(v3.vw - v3.W * v3.s, v3.x - 120), 2) && near(v4.y, Math.max(v3.vh - v3.H * v3.s, v3.y - 60), 2), JSON.stringify([v3.x, v4.x, v3.y, v4.y]));
  await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 3000, sy + 3000, { steps: 8 }); await page.mouse.up();
  await sleep(80);
  const v5 = await state(page);
  t('P2 화면 밖으로 사라지지 않음(가장자리 제한)', inBounds(v5) && near(v5.x, 0) , JSON.stringify(v5));
  await tool(page, 'vmap-fit');
  const v6 = await state(page);
  t('Z6 전체 보기 단추: 처음 상태', near(v6.s, v0.s, 1e-4) && near(v6.x, v0.x) && near(v6.y, v0.y), JSON.stringify(v6));

  // 자판
  await page.focus('#vmap-stage');
  await page.keyboard.press('+'); await sleep(60);
  const k1 = await state(page);
  await page.keyboard.press('ArrowLeft'); await sleep(60);
  const k2 = await state(page);
  await page.keyboard.press('-'); await sleep(60);
  const k3 = await state(page);
  await page.keyboard.press('+'); await sleep(40); await page.keyboard.press('0'); await sleep(60);
  const k4 = await state(page);
  t('Z7 자판: + · 방향키 · − · 0', k1.s > v0.s && k2.x > k1.x - 1 && k2.x !== k1.x && k3.s < k1.s && near(k4.s, v0.s, 1e-4), JSON.stringify([k1.s, k1.x, k2.x, k3.s, k4.s]));

  // 크기 변경
  await tool(page, 'vmap-in');
  await page.setViewport({ width: 1100, height: 700, deviceScaleFactor: 2 });
  await sleep(200);
  const r1 = await state(page);
  t('R1 창 크기를 바꿔도 범위 안', inBounds(r1), JSON.stringify(r1));
  await tool(page, 'vmap-fit');
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await sleep(200);
  const r2 = await state(page);
  t('R2 전체 보기였으면 다시 전체 보기', near(r2.s, v0.s, 1e-4) && inBounds(r2), JSON.stringify(r2));

  // 닫기 · 다시 열기
  await tool(page, 'vmap-in');
  await page.keyboard.press('Escape'); await sleep(100);
  t('O5 Esc 로 닫힘 · 단추로 포커스 복원 · 스크롤 잠금 풀림', !(await isOpen(page)) && await page.evaluate(() => document.activeElement.id === 'map-open' && getComputedStyle(document.documentElement).overflow !== 'hidden'));
  await openMap(page);
  const v7 = await state(page);
  t('O6 다시 열면 전체 보기 · 그림을 다시 받지 않음 · 안내 없음', near(v7.s, v0.s, 1e-4) && near(v7.x, v0.x) && net.image === 1 && await page.$eval('#vmap-hint', (e) => e.hidden), JSON.stringify([v7.s, net.image]));
  await page.click('#vmap-close'); await sleep(100);
  t('O7 닫기 단추로 닫힘 · 포커스 복원', !(await isOpen(page)) && await page.evaluate(() => document.activeElement.id === 'map-open'));
  for (let i = 0; i < 5; i++) { await openMap(page); await page.click('#vmap-close'); await sleep(40); }
  await openMap(page);
  const b0 = await state(page);
  await tool(page, 'vmap-in');
  const b1 = await state(page);
  t('O8 여섯 번 열고 닫아도 한 번 누르면 한 번만 확대(이벤트 중복 없음)', near(b1.s / b0.s, 1.6, 0.01), String(b1.s / b0.s));
  const trap = await page.evaluate(() => { const out = document.getElementById('search-field'); return document.getElementById('vmap').contains(document.elementFromPoint(5, 5)) || !out; });
  t('O9 창이 열린 동안 뒤 화면은 눌리지 않음', trap);
  t('O10 화면 오류 없음', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ── O · T : 폭마다 창, 휴대폰 터치 ─────────────────────────────── */
for (const W of [320, 360, 375, 390, 414, 768, 1024, 1440]) {
  const { ctx, page } = await openPage(W);
  await openMap(page);
  const m = await page.evaluate(() => {
    const R = (id) => document.getElementById(id).getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const ids = ['vmap-close', 'vmap-in', 'vmap-out', 'vmap-fit'].map((id) => ({ id, ...JSON.parse(JSON.stringify(R(id))) }));
    return { ids, vw, vh, ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  const v = await state(page);
  t(`O11 ${W}px 닫기 · 확대 · 축소 · 전체 보기가 화면 안 · 44px 이상 · 전체 그림이 화면 안`, m.ids.every((b) => b.left >= 0 && b.right <= m.vw + 0.5 && b.top >= 0 && b.bottom <= m.vh + 0.5 && b.width >= 44 && b.height >= 44) && inBounds(v) && m.ovf <= 0, JSON.stringify(m.ids.map((b) => [b.id, Math.round(b.right), Math.round(b.bottom), b.width])));
  if (SHOTS && W === 390) await page.screenshot({ path: join(SHOTS, 'modal-390.png') });
  await ctx.close();
}
{
  const { ctx, page, errs } = await openPage(390);
  await page.evaluate(() => window.scrollTo(0, 500));
  await sleep(80);
  const y0 = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => document.getElementById('map-open').scrollIntoView());
  await page.evaluate((y) => window.scrollTo(0, y), 0);
  await openMap(page);
  t('T0 휴대폰 안내 문구', (await page.$eval('#vmap-hint', (e) => e.textContent)) === '두 손가락으로 확대하고 드래그하여 이동하세요.');
  const cdp = await page.createCDPSession();
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const v0 = await state(page);
  const cx = v0.left + v0.vw * 0.5, cy = v0.top + v0.vh * 0.5;   // 가운데라 작은 쪽의 가운데 묶임과 겹칩니다
  const px = (cx - v0.left - v0.x) / v0.s, py = (cy - v0.top - v0.y) / v0.s;
  const two = (d) => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }];
  await touch('touchStart', two(40));
  for (const d of [50, 60, 70, 80]) { await touch('touchMove', two(d)); await sleep(20); }
  await touch('touchEnd', []);
  await sleep(120);
  const v1 = await state(page);
  t('T1 두 손가락 벌리면 2배 · 두 손가락 가운데 자리 고정', near(v1.s / v0.s, 2, 0.05) && near(v1.x + px * v1.s, cx - v0.left, 2) && near(v1.y + py * v1.s, cy - v0.top, 2), JSON.stringify([v1.s / v0.s, v1.x + px * v1.s, cx - v0.left]));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'zoom-390.png') });
  await touch('touchStart', [{ x: cx, y: cy, id: 1 }]);
  for (const d of [20, 40, 60, 80]) { await touch('touchMove', [{ x: cx - d, y: cy, id: 1 }]); await sleep(20); }
  await touch('touchEnd', []);
  await sleep(100);
  const v2 = await state(page);
  t('T2 한 손가락으로 이동 · 범위 안', near(v2.x, v1.x - 80, 3) && inBounds(v2), JSON.stringify([v1.x, v2.x]));
  await touch('touchStart', two(80));
  for (const d of [60, 40, 30, 20]) { await touch('touchMove', two(d)); await sleep(20); }
  await touch('touchEnd', []);
  await sleep(120);
  const v3 = await state(page);
  t('T3 두 손가락 오므리면 전체 보기 아래로 가지 않음', near(v3.s, v0.s, 1e-4) && inBounds(v3), JSON.stringify(v3.s / v0.s));
  await page.tap('#vmap-in'); await sleep(80);
  const v4 = await state(page);
  t('T4 + 단추 터치', near(v4.s / v0.s, 1.6, 0.02), String(v4.s / v0.s));
  await page.tap('#vmap-fit'); await sleep(80);
  t('T5 전체 보기 단추 터치', near((await state(page)).s, v0.s, 1e-4));
  const yNow = await page.evaluate(() => window.scrollY);
  t('T6 지도를 움직여도 뒤 화면이 스크롤되지 않음', yNow === 0, String(yNow));
  t('T7 화면 오류 없음', errs.length === 0 && y0 >= 0, errs.join(' | '));
  await ctx.close();
}

/* ── Y : 구역 이동 ─────────────────────────────────────────────── */
for (const [W, H] of [[320, 568], [360, 740], [390, 844], [414, 896], [568, 320], [844, 390], [768, 1024], [1024, 768], [1440, 900]]) {
  const { ctx, page, errs } = await openPage(W, H);
  await openMap(page);
  const c = await page.evaluate(() => {
    const box = document.getElementById('vmap-zones'), R = (e) => e.getBoundingClientRect();
    const list = [...box.querySelectorAll('[data-vzone]')].map((b) => ({ id: b.dataset.vzone, h: R(b).height, cut: b.scrollWidth > b.clientWidth + 0.5, off: b.disabled, out: R(b).right > innerWidth + 0.5 || R(b).left < 0, top: Math.round(R(b).top) }));
    const tools = R(document.querySelector('.vmap__tools')), st = R(document.getElementById('vmap-stage'));
    return { list, toolsIn: tools.top >= st.top - 0.5, ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth, boxB: R(box).bottom, stageT: R(document.getElementById('vmap-stage')).top };
  });
  t(`Y1 ${W}×${H} 구역 단추 일곱 개 · 44px 이상 · 글자 잘림 없음 · 쓸 수 있음 · 그림 칸과 겹치지 않음`, c.list.length === 7 && c.list.every((b) => b.h >= 44 && !b.cut && !b.off) && c.ovf <= 0 && c.boxB <= c.stageT + 0.5, JSON.stringify(c));
  if (H > 420) t(`Y1b ${W}×${H} 구역 단추 일곱 개가 밀지 않아도 모두 보임 · 두 줄 이하`, c.list.every((b) => !b.out) && new Set(c.list.map((b) => b.top)).size <= 2, JSON.stringify(c.list));
  t(`Y1c ${W}×${H} 조작 단추가 그림 칸 안`, c.toolsIn, JSON.stringify(c.toolsIn));
  const v0 = await state(page);
  const bad = [];
  for (const id of Object.keys(ZONE_RECTS)) {
    await zone(page, id);
    const v = await state(page), [zx, zy, zw, zh] = ZONE_RECTS[id], w = seen(v);
    const inX = zw * v.s <= v.vw + 1 ? w.l <= zx + 1 && w.r >= zx + zw - 1 : near(w.l, Math.min(zx, IW - v.vw / v.s), 2);
    const inY = zh * v.s <= v.vh + 1 ? w.t <= zy + 1 && w.b >= zy + zh - 1 : near(w.t, Math.min(zy, IH - v.vh / v.s), 2);
    const read = v.s >= Math.min(0.8, v0.s * 6) - 1e-6 && v.s <= 2 + 1e-6;
    const p = await pressed(page);
    if (!(inX && inY && read && inBounds(v) && p.length === 1 && p[0] === id)) bad.push([id, v.s, w, p]);
    if (SHOTS && [390, 1440].includes(W)) await page.screenshot({ path: join(SHOTS, `zone-${id}-${W}.png`) });
  }
  t(`Y2 ${W}×${H} 구역 일곱 곳: 그 자리가 화면 안 · 읽을 배율 · 범위 안 · 고른 단추 표시`, bad.length === 0, JSON.stringify(bad));
  await page.evaluate(() => document.getElementById('vmap-fit').click());
  await sleep(80);
  const f = await state(page);
  t(`Y3 ${W}×${H} 전체 보기로 돌아오고 고른 표시가 풀림`, near(f.s, v0.s, 1e-4) && (await pressed(page)).length === 0, JSON.stringify(f));
  t(`Y4 ${W}×${H} 화면 오류 없음`, errs.length === 0, errs.join(' | '));
  await ctx.close();
}
{
  const { ctx, page, errs } = await openPage(1440, 900);
  await openMap(page);
  await zone(page, 'school-b');
  const a = await state(page);
  await page.mouse.move(a.left + 200, a.top + 200); await page.mouse.down(); await page.mouse.move(a.left + 140, a.top + 170, { steps: 4 }); await page.mouse.up();
  await sleep(80);
  const b = await state(page);
  t('Y5 끌면 구역 표시가 풀리고 그만큼 움직임 · 부드러운 움직임 꺼짐', (await pressed(page)).length === 0 && near(b.x, a.x - 60, 2) && !(await page.$eval('#vmap-img', (i) => i.classList.contains('is-glide'))), JSON.stringify([a.x, b.x]));
  await zone(page, 'list');
  await page.mouse.move(a.left + 300, a.top + 300); await page.mouse.wheel({ deltaY: -120 }); await sleep(100);
  t('Y6 휠로 움직여도 구역 표시가 풀림', (await pressed(page)).length === 0);
  await zone(page, 'future');
  await page.keyboard.press('Escape'); await sleep(120);
  await openMap(page);
  const c = await state(page);
  t('Y7 닫았다 열면 전체 보기 · 구역 표시 없음', (await pressed(page)).length === 0 && inBounds(c) && near(c.s, Math.min(c.vw / IW, c.vh / IH), 1e-3), JSON.stringify(c));
  const k = await page.evaluate(() => { const n = document.querySelector('[data-vzone="future"]'); n.focus(); return document.activeElement === n; });
  await page.keyboard.press('Enter'); await sleep(380);
  t('Y8 자판 Enter 로 구역 이동', k && (await pressed(page))[0] === 'future');
  t('Y9 화면 오류 없음', errs.length === 0, errs.join(' | '));
  await ctx.close();
}
{
  const { ctx, page, errs } = await openPage(390);
  await openMap(page);
  await page.tap('[data-vzone="school-a"]'); await sleep(380);
  t('Y11 휴대폰: 구역 단추 터치', (await pressed(page))[0] === 'school-a');
  const v = await state(page);
  t('Y12 휴대폰: 스쿨 01~44 는 글자를 읽을 배율(원본 이상)로 열림', v.s >= 1, String(v.s));
  const [ax, , aw] = ZONE_RECTS['school-a'], toolL = await page.$eval('.vmap__tools', (e) => e.getBoundingClientRect().left);
  t('Y12b 휴대폰: 스쿨 01~44 가 조작 단추에 가리지 않음', v.left + v.x + (ax + aw) * v.s <= toolL + 1, JSON.stringify([v.left + v.x + (ax + aw) * v.s, toolL]));
  t('Y13 화면 오류 없음', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ── E : 그림을 받지 못할 때 ────────────────────────────────────── */
{
  net.fail = true;
  const { ctx, page, errs } = await openPage(390);
  await page.click('#map-open');
  await page.waitForFunction(() => !document.getElementById('vmap-retry').hidden, { timeout: 8000 });
  const e = await page.evaluate(() => ({ t: document.getElementById('vmap-note-t').textContent, close: !!document.getElementById('vmap-close'), img: document.getElementById('vmap-img').hidden, zoom: document.getElementById('vmap-in').disabled, zones: [...document.querySelectorAll('[data-vzone]')].every((b) => b.disabled) }));
  t('E1 그림을 못 받으면 안내 · 다시 불러오기 · 깨진 그림 없음 · 조작 단추 꺼짐', e.t === '배치도를 불러오지 못했어요' && e.img && e.zoom && e.zones, JSON.stringify(e));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'error-390.png') });
  net.fail = false;
  await page.click('#vmap-retry');
  await page.waitForFunction(() => { const n = document.getElementById('vmap-img'); return n.naturalWidth > 0 && !n.hidden; }, { timeout: 8000 });
  await sleep(120);
  t('E2 다시 불러오면 전체 보기로 표시', inBounds(await state(page)) && await page.$eval('#vmap-note', (n) => n.hidden));
  await page.click('#vmap-close'); await sleep(100);
  t('E3 닫기 정상 · 화면 오류 없음', !(await isOpen(page)) && errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ── K : 뒤 화면 상태 유지 ──────────────────────────────────────── */
{
  const { ctx, page, errs } = await openPage(390);
  await page.evaluate(() => document.querySelector('#tabs [data-zone="미래"]').click());
  await sleep(100);
  await page.evaluate(() => window.scrollTo(0, 420));
  await sleep(120);
  const before = await page.evaluate(() => ({ y: window.scrollY, rows: document.querySelectorAll('#list .row').length, pressed: document.querySelector('#tabs [aria-pressed="true"]').dataset.zone, url: location.href }));
  await page.evaluate(() => document.getElementById('map-open').click());
  await page.waitForFunction(() => { const n = document.getElementById('vmap-img'); return document.getElementById('vmap').open && n.naturalWidth > 0; }, { timeout: 8000 });
  await sleep(100);
  await page.click('#vmap-close'); await sleep(200);
  const after = await page.evaluate(() => ({ y: window.scrollY, rows: document.querySelectorAll('#list .row').length, pressed: document.querySelector('#tabs [aria-pressed="true"]').dataset.zone, url: location.href }));
  t('K1 닫은 뒤 고른 탭 · 목록 · 스크롤 · 주소 그대로', JSON.stringify(before) === JSON.stringify(after), JSON.stringify([before, after]));
  await page.evaluate(() => document.getElementById('map-open').click());
  await page.waitForFunction(() => document.getElementById('vmap').open);
  await sleep(120);
  await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(250);
  const back = await page.evaluate(() => ({ open: document.getElementById('vmap').open, rows: document.querySelectorAll('#list .row').length, pressed: document.querySelector('#tabs [aria-pressed="true"]').dataset.zone, lock: document.documentElement.classList.contains('vmap-on') }));
  t('K2 뒤로 가기는 창만 닫고 화면은 그대로', !back.open && back.rows === before.rows && back.pressed === '미래' && !back.lock, JSON.stringify(back));
  await page.evaluate(() => { const i = document.getElementById('search-field'); i.click(); });
  await sleep(100);
  await page.evaluate(() => { const i = document.getElementById('q'); i.value = '체험3'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(300);
  await page.evaluate(() => document.getElementById('map-open').click());
  await page.waitForFunction(() => document.getElementById('vmap').open);
  await sleep(100);
  await page.keyboard.press('Escape'); await sleep(200);
  const q = await page.evaluate(() => ({ v: document.getElementById('q').value, rows: [...document.querySelectorAll('#list .row__code')].map((x) => x.textContent) }));
  t('K3 닫은 뒤 검색어 · 결과 그대로(Esc 가 검색을 닫지 않음)', q.v === '체험3' && JSON.stringify(q.rows) === JSON.stringify(['체험3']), JSON.stringify(q));
  await page.evaluate(() => document.getElementById('search-cancel').click());
  await sleep(150);
  await page.evaluate(() => document.querySelector('#list .row').click());
  await sleep(120);
  t('K4 줄을 눌러도 창이 열리지 않음(줄은 읽기 전용 그대로)', !(await isOpen(page)));
  t('K5 화면 오류 없음', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await browser.close();
server.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad} / ${results.length} 통과`);
process.exit(bad ? 1 : 0);
