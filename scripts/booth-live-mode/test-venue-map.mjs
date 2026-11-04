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
     Y  구역    크기마다 구역 단추 · 전체 지도에서 강조 → 확대 · 테두리가 그림 좌표와 일치 · 자동 배율 · 미니맵 겹침
     H  강조    주황 색 · 두께 · 흰 외곽선 · 자기 부스를 덮고 이웃 구역 부스를 덮지 않음 · 사이트 보라 유지
     M  미니맵  배치도만 잘라 씀 · 끌기 · 확대 · 축소에 따라 사각형 일치 · 눌러서 이동 · 전체 보기 숨김 · 범례 처리
     Q  순서    프레임마다 배율을 기록해 튀는 횟수를 셈 · 연속 선택 · 취소 · 닫기 · 화면 돌리기 · 움직임 줄이기
     U  속도    폭마다 300 · 1000 · 650ms · 천천히 시작 · 튀지 않음 · 느린 기기 프레임 · 외곽선 유지와 해제
     C  체험존  번호 안내 · 앱 번호와 지도 장소 대응 · 겹침 · 사라지는 때
     S  검색    검색 결과의 지도에서 보기 · zone_key · code 로 구역 판별 · 그림 받기 전 · 뒤로 가기 · 결과 없음 · 폭마다 겹침
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
const objOf = (name) => new Function('return ' + new RegExp('var ' + name + ' = (\\{[\\s\\S]*?\\});').exec(MAP_JS)[1])();
const ZONE_PARTS = objOf('ZONE_PARTS'), MINI = objOf('MINI');
const partsOf = (id) => ZONE_PARTS[id] || [ZONE_RECTS[id]];
const ZONE_RECTS = Object.fromEntries([...MAP_JS.matchAll(/'?([\w-]+)'?: \[(\d+), (\d+), (\d+), (\d+)\]/g)].map((m) => [m[1], m.slice(2).map(Number)]));

/* ── 예시 스냅샷 105곳 ──────────────────────────────────────────── */
const now = new Date().toISOString();
const schools = JSON.parse(readFileSync(join(HERE, 'fixture-public-96.json'), 'utf8'));
const booth = (b, i) => ({ ...b, code: b.code || String(b.no), program: '', opMode: 'wait', status: ['여유', '보통', '혼잡'][i % 3], reserve: null, waitMinutes: 5 + (i % 3) * 10, updatedAt: now });
const data = { version: 1, generatedAt: now, mode: 'normal', liveReady: true,
  event: { title: '2026 인천 AI미래채움 교육페스티벌', venue: '인천 상상플랫폼', dateLabel: '시험 날짜', timeLabel: '10:00 ~ 17:00', start: new Date(Date.now() + 2 * 864e5).toISOString(), end: new Date(Date.now() + 3 * 864e5).toISOString(), mapUrl: '' },
  zones: [{ key: '초등', label: '초등', order: 1 }, { key: '중등', label: '중등', order: 2 }, { key: '고등', label: '고등', order: 3 }, { key: '특수', label: '특수', order: 4 }, { key: '체험', label: '체험존', order: 5 }, { key: '미래', label: '미래채움존', order: 6 }],
  booths: [...schools.map(booth),
    ...Array.from({ length: 12 }, (_, i) => booth({ id: `x${i + 1}`, no: i + 1, code: `체험${i + 1}`, zone: '체험', name: `시험 체험 ${i + 1}`, org: '', type: i < 4 ? '게임' : '교육' }, i)),
    ...Array.from({ length: 9 }, (_, i) => booth({ id: `f${i + 1}`, no: i + 1, code: `미래${i + 1}`, zone: '미래', name: `시험 미래 ${i + 1}`, org: '시험 협동조합' }, i))], unplaced: [] };

/* ── 서버 ───────────────────────────────────────────────────────── */
const FILES = ['visitor.html', 'assets/visitor.css', 'assets/booth-core.js', 'assets/mock-data.js', 'assets/config.js', 'assets/venue-map.js'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const net = { image: 0, fail: false, delay: 0 };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  if (p === 'api/live-snapshot') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); return; }
  if (p === IMAGE_PATH) {
    net.image += 1;
    if (net.fail) { res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end(); return; }
    setTimeout(() => { res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' }); res.end(IMAGE); }, net.delay);
    return;
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
const idle = (page) => page.waitForFunction(() => !document.getElementById('vmap-stage').dataset.phase, { timeout: 5000, polling: 'raf' });
const phaseIs = (page, p) => page.waitForFunction((x) => document.getElementById('vmap-stage').dataset.phase === x, { timeout: 5000, polling: 'raf' }, p);
const tool = (page, id) => page.click('#' + id).then(() => idle(page)).then(() => sleep(60));
const pick = (page, id) => page.evaluate((k) => document.querySelector('[data-vzone="' + k + '"]').click(), id);
const zone = (page, id) => pick(page, id).then(() => page.waitForFunction(() => document.getElementById('vmap-hl').classList.contains('is-soft'), { timeout: 5000, polling: 'raf' })).then(() => sleep(60));
const pressed = (page) => page.evaluate(() => [...document.querySelectorAll('[data-vzone][aria-pressed="true"]')].map((b) => b.dataset.vzone));
// 테두리 안쪽 자리(그림 칸 기준 px)
const hlBoxes = (page) => page.evaluate(() => {
  const st = document.getElementById('vmap-stage').getBoundingClientRect();
  return [...document.querySelectorAll('.vmap__hl-box')].map((b) => { const r = b.getBoundingClientRect(), w = parseFloat(getComputedStyle(b).borderTopWidth); return { l: r.left - st.left + w, t: r.top - st.top + w, w: r.width - 2 * w, h: r.height - 2 * w }; });
});
const hlName = (page) => page.evaluate(() => {
  const st = document.getElementById('vmap-stage').getBoundingClientRect(), n = document.getElementById('vmap-hl-t'), r = n.getBoundingClientRect();
  return { text: n.textContent, l: r.left - st.left, t: r.top - st.top, r: r.right - st.left, b: r.bottom - st.top, soft: document.getElementById('vmap-hl').classList.contains('is-soft') };
});
function aligned(v, id, got) {
  const parts = partsOf(id);
  return got.length === parts.length && parts.every((p, i) => {
    let w = p[2] * v.s, h = p[3] * v.s, l = v.x + p[0] * v.s, t = v.y + p[1] * v.s;
    if (parts.length === 1) { const gw = Math.max(0, 22 - w), gh = Math.max(0, 22 - h); l -= gw / 2; t -= gh / 2; w += gw; h += gh; }
    return near(got[i].l, l) && near(got[i].t, t) && near(got[i].w, w) && near(got[i].h, h);
  });
}
const miniState = (page) => page.evaluate(() => {
  const m = document.getElementById('vmap-mini'), R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; }, n = document.getElementById('vmap-mini-view');
  return { hidden: m.hidden, off: m.classList.contains('is-off'), map: R(document.getElementById('vmap-mini-map')), view: R(n), viewShown: getComputedStyle(n).display !== 'none' };
});
function miniOk(v, m) {
  const l = Math.max(MINI.x, -v.x / v.s), t = Math.max(MINI.y, -v.y / v.s), r = Math.min(MINI.x + MINI.w, (v.vw - v.x) / v.s), b = Math.min(MINI.y + MINI.h, (v.vh - v.y) / v.s);
  if (r - l < 24 || b - t < 24) return m.off && !m.viewShown;
  const k = m.map.w / MINI.w;
  return !m.off && m.viewShown && near(m.view.l, m.map.l + (l - MINI.x) * k) && near(m.view.t, m.map.t + (t - MINI.y) * k) && near(m.view.w, (r - l) * k) && near(m.view.h, (b - t) * k);
}
// 프레임마다 배율 · 단계를 기록합니다. 단추를 차례로 누른 뒤 ms 만큼 더 봅니다.
const trace = (page, clicks, ms) => page.evaluate(async (list, wait) => {
  const img = document.getElementById('vmap-img'), st = document.getElementById('vmap-stage'), out = [], t0 = performance.now();
  let on = true;
  (function f() { out.push({ t: performance.now() - t0, s: +/scale\(([-\d.e]+)\)/.exec(img.style.transform)[1], p: st.dataset.phase || '' }); if (on) requestAnimationFrame(f); })();
  for (const [sel, gap] of list) { document.querySelector(sel).click(); if (gap) await new Promise((r) => setTimeout(r, gap)); }
  await new Promise((r) => setTimeout(r, wait));
  on = false;
  return out;
}, clicks, ms);
// 배율이 늘다 줄거나 줄다 늘어난 횟수
function turns(tr) {
  let n = 0, dir = 0;
  for (let i = 1; i < tr.length; i++) { const d = tr[i].s - tr[i - 1].s; if (Math.abs(d) < 1e-5) continue; const g = Math.sign(d); if (dir && g !== dir) n += 1; dir = g; }
  return n;
}
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
    return { bandBg: band.backgroundColor, border: s.borderTopColor, w: r.width, h: r.height, left: r.left, right: r.right, top: r.top, text: b.innerText.trim(), aria: b.getAttribute('aria-label'), syncR: JSON.parse(JSON.stringify(R(sync))), syncOn: !sync.hidden, titleB: R(title).bottom, titleT: R(title).top, cut: sp.scrollWidth > sp.clientWidth + 0.5, icon: ic.width, bg: s.backgroundColor, color: s.color,
      tabRows: new Set(tabs).size, tabs: tabs.length, tabScroll: box.scrollWidth - box.clientWidth, ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth, vw: document.documentElement.clientWidth,
      overSync: !sync.hidden && hit(r, R(sync)), overTitle: hit(r, R(title)), titleRight: R(title).right };
  });
  t(`B1 ${W}px 아이콘과 문구가 함께 보임 · 잘림 없음`, m.text === (W < 600 ? '배치도' : '배치도 보기') && m.aria === '배치도 보기' && !m.cut && m.icon >= 22 && m.icon <= 24 && m.right <= m.vw + 0.5 && m.left >= 0, JSON.stringify(m));
  t(`B2 ${W}px 높이 약 48px · 터치 영역 44px 이상`, m.h >= 44 && m.h <= 52 && m.w >= 44, JSON.stringify([m.w, m.h]));
  t(`B3 ${W}px 탭 5칸 한 줄 · 가로 스크롤 없음 · 제목 · 갱신 표시와 겹치지 않음`, m.tabs === 5 && m.tabRows === 1 && m.tabScroll <= 0 && m.ovf <= 0 && !m.overSync && !m.overTitle, JSON.stringify(m));
  t(`B4 ${W}px 단추는 제목과 같은 줄 오른쪽`, m.left > m.titleRight && m.top < m.titleB && m.top + m.h > m.titleT, JSON.stringify([m.left, m.titleRight]));
  t(`B4a ${W}px 자동 갱신은 둘째 줄 오른쪽(제목보다 덜 강조)`, !m.syncOn || (m.syncR.top >= m.titleB - 1 && near(m.syncR.right, m.right, 1)), JSON.stringify(m.syncR));
  if (W === 390) {
    t('B4b 흰 바탕 · 보라 글자 대비 4.5:1 이상 · 단추가 띠와 3:1 이상', m.bg === 'rgb(255, 255, 255)' && m.color === m.bandBg && ratio(rgb(m.color), rgb(m.bg)) >= 4.5 && ratio(rgb(m.bg), rgb(m.bandBg)) >= 3, JSON.stringify([m.bg, m.color, ratio(rgb(m.color), rgb(m.bg))]));
  }
  const ev = await page.evaluate(() => { const e = document.getElementById('band-event'), r = document.createRange(); r.selectNodeContents(e); const c = r.getBoundingClientRect(), b = e.getBoundingClientRect(), y = document.getElementById('sync').getBoundingClientRect(); return { text: e.textContent, right: c.right, boxRight: b.right, h: b.height, syncLeft: y.left, cutX: e.scrollWidth > e.clientWidth + 0.5, cutY: e.scrollHeight > e.clientHeight + 0.5 }; });
  t(`B4c ${W}px 실제 행사명 · 장소가 잘리지 않고 자동 갱신과 겹치지 않음 · 두 줄 이하`, ev.text === '2026 인천 AI미래채움 교육페스티벌 · 인천 상상플랫폼' && !ev.cutX && !ev.cutY && ev.right <= ev.syncLeft && ev.h <= 41, JSON.stringify(ev));
  t(`B5 ${W}px 화면 오류 없음`, errs.length === 0, errs.join(' | '));
  if (SHOTS && [320, 390, 1440].includes(W)) await page.screenshot({ path: join(SHOTS, `main-${W}.png`) });
  await ctx.close();
}

/* ── L : 그림을 받은 순간 ───────────────────────────────────────── */
{
  const { ctx, page, errs } = await openPage(390);
  // 그림의 load 처리 바로 뒤(같은 작업 안)에서 단추 상태를 읽습니다. 다음 프레임을 기다리면 첫 탭을 놓칩니다.
  await page.evaluate(() => { const i = document.getElementById('vmap-img'); i.addEventListener('load', () => queueMicrotask(() => { window.__ready = [...document.querySelectorAll('.vmap__zone')].every((b) => !b.disabled); })); });
  await openMap(page);
  t('L1 그림을 받은 바로 그 순간 구역 단추가 켜짐', await page.evaluate(() => window.__ready === true), String(await page.evaluate(() => window.__ready)));
  t('L2 화면 오류 없음', errs.length === 0, errs.join(' | '));
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
  await page.keyboard.press('+'); await sleep(40); await page.keyboard.press('0'); await idle(page); await sleep(60);
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
  const pm = await miniState(page);
  t('T1b 두 손가락으로 확대하면 미니맵이 나오고 사각형이 일치', !pm.hidden && miniOk(v1, pm), JSON.stringify(pm));
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
  await page.tap('#vmap-fit'); await sleep(40); await idle(page); await sleep(60);
  t('T5 전체 보기 단추 터치', near((await state(page)).s, v0.s, 1e-4));
  const yNow = await page.evaluate(() => window.scrollY);
  t('T6 지도를 움직여도 뒤 화면이 스크롤되지 않음', yNow === 0, String(yNow));
  t('T7 화면 오류 없음', errs.length === 0 && y0 >= 0, errs.join(' | '));
  await ctx.close();
}

/* ── Y : 구역 이동 · 위치 강조 · 자동 배율 · 미니맵, 크기마다 ──────── */
const hit = (a, c) => !(a.right <= c.left || c.right <= a.left || a.bottom <= c.top || c.bottom <= a.top);
for (const [W, H] of [[320, 568], [360, 740], [375, 812], [390, 844], [414, 896], [568, 320], [844, 390], [768, 1024], [1024, 768], [1440, 900]]) {
  const { ctx, page, errs } = await openPage(W, H);
  await openMap(page);
  const shot = (name) => (SHOTS && [320, 390, 1440].includes(W) ? page.screenshot({ path: join(SHOTS, `${name}-${W}.png`) }) : null);
  await page.evaluate(() => document.getElementById('vmap-hint').setAttribute('hidden', ''));
  await shot('full');
  const c = await page.evaluate(() => {
    const box = document.getElementById('vmap-zones'), R = (e) => e.getBoundingClientRect();
    const list = [...box.querySelectorAll('button')].map((b) => ({ id: b.dataset.vzone || b.id, h: R(b).height, cut: b.scrollWidth > b.clientWidth + 0.5, off: b.disabled, out: R(b).right > innerWidth + 0.5 || R(b).left < 0, top: Math.round(R(b).top) }));
    const tools = R(document.querySelector('.vmap__tools')), st = R(document.getElementById('vmap-stage'));
    return { list, toolsIn: tools.top >= st.top - 0.5, stageH: st.height, ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth, boxB: R(box).bottom, stageT: st.top };
  });
  t(`Y1 ${W}×${H} 구역 단추 일곱 개 + 전체 보기 · 44px 이상 · 글자 잘림 없음 · 쓸 수 있음 · 그림 칸과 겹치지 않음`, c.list.length === 8 && c.list.every((b) => b.h >= 44 && !b.cut && !b.off) && c.ovf <= 0 && c.boxB <= c.stageT + 0.5, JSON.stringify(c));
  if (H > 420) t(`Y1b ${W}×${H} 단추가 밀지 않아도 모두 보임 · 두 줄 이하`, c.list.every((b) => !b.out) && new Set(c.list.map((b) => b.top)).size <= 2, JSON.stringify(c.list));
  t(`Y1c ${W}×${H} 조작 단추가 그림 칸 안`, c.toolsIn, String(c.stageH));
  t(`Y1d ${W}×${H} 처음 전체 보기: 미니맵 숨김 · 전체 보기 단추가 눌린 상태`, (await miniState(page)).hidden && await page.$eval('#vmap-fit', (b) => b.getAttribute('aria-pressed') === 'true'));
  const v0 = await state(page);
  const cap = Math.max(1.25, v0.s * 1.8), badHold = [], badZone = [], badMini = [];
  for (const id of Object.keys(ZONE_RECTS)) {
    await pick(page, id);
    await phaseIs(page, 'hold');
    await sleep(40);
    const h = await state(page), hm = await miniState(page), hb = await hlBoxes(page), name = await hlName(page);
    const inStage = name.l >= 0 && name.t >= 0 && name.r <= h.vw + 0.5 && name.b <= h.vh + 0.5;
    if (!(near(h.s, v0.s, 1e-3) && hm.hidden && aligned(h, id, hb) && !name.soft && inStage)) badHold.push([id, h.s, hm.hidden, name]);
    await shot(`hl-${id}`);
    await page.waitForFunction(() => document.getElementById('vmap-hl').classList.contains('is-soft'), { timeout: 5000 });
    await sleep(240);
    const v = await state(page), [zx, zy, zw, zh] = ZONE_RECTS[id], w = seen(v), p = await pressed(page), m = await miniState(page), b = await hlBoxes(page);
    const whole = w.l <= zx + 1 && w.t <= zy + 1 && w.r >= zx + zw - 1 && w.b >= zy + zh - 1;
    const around = w.l <= Math.max(0, zx - 20) + 1 && w.r >= Math.min(IW, zx + zw + 20) - 1 && w.t <= Math.max(0, zy - 20) + 1 && w.b >= Math.min(IH, zy + zh + 20) - 1;
    const scale = id === 'list' ? v.s >= Math.min(0.8, v0.s * 6) - 1e-6 && w.t <= zy + 1 && w.l <= zx + 1 : whole && around && v.s <= cap + 1e-6;
    if (!(scale && inBounds(v) && p.length === 1 && p[0] === id && aligned(v, id, b))) badZone.push([id, v.s, w, p]);
    if (!(v.s > v0.s && !m.hidden && miniOk(v, m))) badMini.push([id, v.s, m]);
    await shot(`zone-${id}`);
  }
  t(`Y2 ${W}×${H} 일곱 곳: 전체 지도에서 강조 · 테두리가 그림 좌표와 일치 · 이름표가 화면 안 · 미니맵 숨김`, badHold.length === 0, JSON.stringify(badHold));
  t(`Y3 ${W}×${H} 일곱 곳: 구역 전체 + 둘레가 보임 · 배율 상한 ${cap.toFixed(2)} · 범위 안 · 고른 단추 표시 · 확대 뒤에도 테두리 일치`, badZone.length === 0, JSON.stringify(badZone));
  t(`Y4 ${W}×${H} 일곱 곳: 미니맵 표시 · 주황 사각형이 실제 보이는 자리와 1px 안에서 일치`, badMini.length === 0, JSON.stringify(badMini));
  // 미니맵 겹침
  await zone(page, 'future');
  const g = await page.evaluate(() => {
    const R = (e) => JSON.parse(JSON.stringify(e.getBoundingClientRect())), q = (s) => document.querySelector(s);
    return { mini: R(q('#vmap-mini')), tools: R(q('.vmap__tools')), close: R(q('#vmap-close')), zones: R(q('#vmap-zones')), stage: R(q('#vmap-stage')) };
  });
  const lo = W < 600 ? [100, 120] : [140, 160];
  t(`Y5 ${W}×${H} 미니맵 폭 ${lo[0]}~${lo[1]}px · 터치 44px 이상 · 닫기 · 조작 단추 · 구역 메뉴와 겹치지 않음 · 그림 칸 안`, g.mini.width >= lo[0] && g.mini.width <= lo[1] && g.mini.height >= 44 && g.mini.height <= 62 && !hit(g.mini, g.tools) && !hit(g.mini, g.close) && !hit(g.mini, g.zones) && g.mini.top >= g.stage.top && g.mini.right <= g.stage.right + 0.5, JSON.stringify(g));
  await tool(page, 'vmap-fit');
  const f = await state(page);
  t(`Y6 ${W}×${H} 전체 보기로 돌아오고 고른 표시 · 미니맵이 사라짐`, near(f.s, v0.s, 1e-4) && (await pressed(page)).length === 0 && (await miniState(page)).hidden && await page.$eval('#vmap-hl', (e) => e.hidden), JSON.stringify(f));
  t(`Y7 ${W}×${H} 화면 오류 없음`, errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ── H : 주황 강조 ──────────────────────────────────────────────── */
{
  // 공식 그림의 색 경계로 잰 부스 덩어리(대조용). 고른 구역의 테두리는 자기 부스를 모두 덮고 이웃 구역 부스를 덮지 않아야 합니다.
  const C = {
    'school-a': [[1224, 160, 68, 58], [1317, 160, 137, 58], [1224, 237, 68, 59], [1317, 238, 103, 58], [1224, 316, 68, 58], [1317, 316, 103, 59], [1224, 395, 68, 59], [1317, 395, 137, 59]],
    'school-b': [[394, 124, 103, 29], [531, 124, 414, 29], [365, 198, 138, 29], [602, 198, 310, 29], [602, 236, 310, 29], [661, 306, 103, 29]],
    future: [[312, 236, 208, 29], [363, 350, 104, 29]],
    experience: [[215, 329, 49, 49], [289, 329, 49, 49]],
    bigtech: [[122, 126, 92, 67], [229, 126, 92, 67]],
    promo: [[1113, 350, 32, 28], [1148, 350, 33, 58]]
  };
  // 전체 지도에서 이름표가 어느 구역의 부스도 덮지 않습니다.
  for (const W of [390, 1440]) {
    const { ctx, page } = await openPage(W, W < 768 ? 844 : 900);
    await openMap(page);
    const bad = [];
    for (const id of Object.keys(ZONE_RECTS)) {
      await pick(page, id);
      await phaseIs(page, 'hold');
      const v = await state(page), n = await hlName(page);
      const box = [(n.l - v.x) / v.s, (n.t - v.y) / v.s, (n.r - n.l) / v.s, (n.b - n.t) / v.s];
      const under = Object.values(C).flat().filter((a) => a[0] < box[0] + box[2] && box[0] < a[0] + a[2] && a[1] < box[1] + box[3] && box[1] < a[1] + a[3]);
      if (under.length) bad.push([id, box.map(Math.round), under]);
      await tool(page, 'vmap-fit');
    }
    t(`H0 ${W}px 전체 지도의 구역 이름표가 부스를 덮지 않음`, bad.length === 0, JSON.stringify(bad));
    await ctx.close();
  }
  const inside = (a, p) => a[0] >= p[0] && a[1] >= p[1] && a[0] + a[2] <= p[0] + p[2] && a[1] + a[3] <= p[1] + p[3];
  const touch = (a, p) => a[0] < p[0] + p[2] && p[0] < a[0] + a[2] && a[1] < p[1] + p[3] && p[1] < a[1] + a[3];
  for (const id of Object.keys(C)) {
    const parts = partsOf(id), others = Object.entries(C).filter(([k]) => k !== id).flatMap(([, b]) => b);
    t(`H1 ${id} 테두리가 자기 부스를 모두 덮음`, C[id].every((a) => parts.some((p) => inside(a, p))), JSON.stringify(parts));
    t(`H2 ${id} 테두리가 이웃 구역 부스에 닿지 않음`, !others.some((a) => parts.some((p) => touch(a, p))), JSON.stringify(parts));
  }
  const { ctx, page, errs } = await openPage(1440, 900);
  await openMap(page);
  await pick(page, 'future');
  await phaseIs(page, 'hold');
  await sleep(420);
  const s1 = await page.evaluate(() => {
    const b = getComputedStyle(document.querySelector('.vmap__hl-box')), n = getComputedStyle(document.getElementById('vmap-hl-t'));
    return { bc: b.borderTopColor, bw: b.borderTopWidth, bg: b.backgroundColor, sh: b.boxShadow, nb: n.backgroundColor, nc: n.color, band: getComputedStyle(document.querySelector('.band')).backgroundColor, top: getComputedStyle(document.querySelector('.vmap__top') || document.getElementById('vmap')).backgroundColor };
  });
  const alpha = rgb(s1.bg)[3];
  t('H3 강조: #FF7900 테두리 3px · 흰 외곽선 2px · 안쪽 투명 10~12%', s1.bc === 'rgb(255, 121, 0)' && s1.bw === '3px' && /rgb\(255, 255, 255\) 0px 0px 0px 2px/.test(s1.sh) && alpha >= 0.1 && alpha <= 0.12, JSON.stringify(s1));
  t('H4 구역 이름표 글자 대비 4.5:1 이상', ratio(rgb(s1.nc), rgb(s1.nb)) >= 4.5, String(ratio(rgb(s1.nc), rgb(s1.nb))));
  t('H5 사이트 강조색은 보라 그대로', s1.band === 'rgb(91, 69, 224)', s1.band);
  await page.waitForFunction(() => document.getElementById('vmap-hl').classList.contains('is-soft'), { timeout: 5000 });
  await sleep(420);
  const s2 = await page.evaluate(() => { const b = getComputedStyle(document.querySelector('.vmap__hl-box')); return { bc: b.borderTopColor, bw: b.borderTopWidth, bg: b.backgroundColor, sh: b.boxShadow, op: getComputedStyle(document.getElementById('vmap-hl-t')).opacity, mv: getComputedStyle(document.getElementById('vmap-mini-view')).borderTopColor }; });
  t('H6 확대 뒤에는 강조가 옅어짐(안쪽 비움 · 이름표 숨김)', rgb(s2.bg)[3] === 0 && s2.sh === 'none' && s2.op === '0', JSON.stringify(s2));
  const edge = rgb(s2.bc);
  t('H6b 확대 뒤에도 주황 외곽선 유지(3px · 투명도 0.4~0.7)', edge[0] === 255 && edge[1] === 121 && edge[2] === 0 && edge[3] >= 0.4 && edge[3] <= 0.7 && s2.bw === '3px', JSON.stringify(s2));
  t('H7 미니맵 사각형은 주황', s2.mv === 'rgb(255, 121, 0)', s2.mv);
  const text = await page.$eval('#vmap', (d) => d.textContent);
  t('H8 GPS 로 오해할 말을 쓰지 않음', !/내 위치|현재 위치/.test(text));
  t('H9 화면 오류 없음', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ── M : 미니맵 ─────────────────────────────────────────────────── */
for (const W of [390, 1440]) {
  const mobile = W < 768;
  const { ctx, page, errs } = await openPage(W, mobile ? 844 : 900);
  await openMap(page);
  await zone(page, 'school-b');
  const crop = await page.evaluate(() => { const m = document.getElementById('vmap-mini-map'), c = getComputedStyle(m), r = m.getBoundingClientRect(); return { img: c.backgroundImage, pos: c.backgroundPositionY, size: c.backgroundSize, ratio: r.width / r.height }; });
  t(`M1 ${W}px 미니맵은 같은 그림의 배치도 부분만 씀(아래 범례 제외)`, crop.img.includes(IMAGE_PATH) && near(parseFloat(crop.pos), MINI.y / (IH - MINI.h) * 100, 0.05) && near(crop.ratio, MINI.w / MINI.h, 0.05), JSON.stringify(crop));
  // 끌기
  const a = await state(page), ma = await miniState(page);
  const sx = a.left + a.vw * 0.45, sy = a.top + a.vh * 0.45;
  if (mobile) {
    const cdp = await page.createCDPSession();
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    await touch('touchStart', [{ x: sx, y: sy, id: 1 }]);
    for (const d of [20, 40, 60, 80]) { await touch('touchMove', [{ x: sx - d, y: sy, id: 1 }]); await sleep(20); }
    await touch('touchEnd', []);
  } else {
    await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx - 80, sy, { steps: 5 }); await page.mouse.up();
  }
  await sleep(120);
  const b = await state(page), mb = await miniState(page);
  t(`M2 ${W}px 끌면 사각형이 그만큼 움직이고 실제 보이는 자리와 일치`, b.x < a.x - 40 && mb.view.l > ma.view.l && miniOk(b, mb), JSON.stringify([a.x, b.x, ma.view.l, mb.view.l]));
  t(`M3 ${W}px 직접 움직여도 고른 구역 · 외곽선이 남고 그림과 일치 · 사각형은 실제 자리`, (await pressed(page))[0] === 'school-b' && !(await page.$eval('#vmap-hl', (e) => e.hidden)) && aligned(b, 'school-b', await hlBoxes(page)) && !mb.hidden);
  // 확대 · 축소
  await tool(page, 'vmap-in');
  const c1 = await state(page), m1 = await miniState(page);
  await tool(page, 'vmap-out'); await tool(page, 'vmap-out');
  const c2 = await state(page), m2 = await miniState(page);
  t(`M4 ${W}px 확대하면 사각형이 작아지고 축소하면 커짐 · 언제나 일치`, m1.view.w < mb.view.w && m2.view.w > m1.view.w && miniOk(c1, m1) && miniOk(c2, m2), JSON.stringify([mb.view.w, m1.view.w, m2.view.w]));
  await tool(page, 'vmap-in');
  // 미니맵 누르기
  const pre = await miniState(page);
  const tx = pre.map.l + pre.map.w * 0.35, ty = pre.map.t + pre.map.h * 0.5;
  if (mobile) {
    const cdp = await page.createCDPSession();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx, y: ty, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else await page.mouse.click(tx, ty);
  await sleep(40);
  await idle(page);
  await sleep(80);
  const d = await state(page), md = await miniState(page), w = seen(d);
  const wantX = MINI.x + MINI.w * 0.35, wantY = MINI.y + MINI.h * 0.5;
  const tol = MINI.w / pre.map.w + 1;   // 터치 자리는 정수 px 로 오므로 미니맵 1px 만큼 어긋날 수 있습니다
  const okX = near((w.l + w.r) / 2, wantX, tol) || near(w.l, 0, 1), okY = near((w.t + w.b) / 2, wantY, tol) || near(w.t, 0, 1) || d.H * d.s <= d.vh;
  t(`M5 ${W}px 미니맵을 누르면 그 자리가 가운데로 옴`, okX && okY && miniOk(d, md), JSON.stringify([(w.l + w.r) / 2, wantX, (w.t + w.b) / 2, wantY]));
  await tool(page, 'vmap-fit');
  t(`M6 ${W}px 전체 보기에서 미니맵 숨김`, (await miniState(page)).hidden);
  await tool(page, 'vmap-in');
  const re = await state(page), mr = await miniState(page);
  t(`M7 ${W}px 다시 확대하면 미니맵 자동 표시`, !mr.hidden && miniOk(re, mr), JSON.stringify(mr));
  // 아래 범례만 볼 때
  for (let i = 0; i < 4; i++) await tool(page, 'vmap-in');
  await page.focus('#vmap-stage');
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown');
  await sleep(120);
  const l = await state(page), ml = await miniState(page);
  const off = await page.$eval('.vmap__mini-off', (e) => ({ d: getComputedStyle(e).display, t: e.textContent }));
  t(`M8 ${W}px 아래 인쇄 목록만 보면 자리를 그리지 않고 '원본 목록 보는 중'`, seen(l).t >= MINI.y + MINI.h - 24 && ml.off && !ml.viewShown && off.d === 'flex' && off.t === '원본 목록 보는 중', JSON.stringify([seen(l).t, ml.off, off]));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `legend-${W}.png`) });
  t(`M9 ${W}px 화면 오류 없음`, errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ── Q : 전체 → 강조 → 확대 순서 · 취소 ─────────────────────────── */
{
  const { ctx, page, errs } = await openPage(390);
  await openMap(page);
  const v0 = await state(page);
  const a = await trace(page, [['[data-vzone="future"]', 0]], 1900);
  const hold = a.filter((f) => f.p === 'hold'), inn = a.filter((f) => f.p === 'in');
  t('Q1 전체 지도에서 먼저 강조한 뒤 한 번에 확대', hold.length > 0 && hold.every((f) => near(f.s, v0.s, 1e-4)) && inn.length > 3 && turns(a) === 0, JSON.stringify([hold.length, turns(a)]));
  // 확대한 상태에서 다른 구역
  const b = await trace(page, [['[data-vzone="school-a"]', 0]], 2200);
  const out = b.filter((f) => f.p === 'out'), low = Math.min(...b.map((f) => f.s));
  t('Q4 확대 상태에서 고르면 전체 지도로 물러났다 한 번만 다시 확대', out.length > 3 && near(low, v0.s, 1e-3) && turns(b) === 1, JSON.stringify([out.length, low, turns(b)]));
  t('Q5 끝난 뒤 고른 구역 표시 · 옅은 강조', (await pressed(page))[0] === 'school-a' && await page.$eval('#vmap-hl', (e) => e.classList.contains('is-soft')));
  // 연속으로 고르기(확대 상태)
  const c = await trace(page, [['[data-vzone="promo"]', 70], ['[data-vzone="bigtech"]', 70], ['[data-vzone="future"]', 70], ['[data-vzone="list"]', 0]], 2300);
  t('Q6 확대 상태에서 연달아 네 번 골라도 한 번만 물러났다 확대 · 마지막 구역으로', turns(c) === 1 && (await pressed(page))[0] === 'list' && (await hlName(page)).text === '배치도 원본 목록', JSON.stringify([turns(c), await pressed(page)]));
  await tool(page, 'vmap-fit');
  // 연속으로 고르기(전체 보기)
  const d = await trace(page, [['[data-vzone="promo"]', 110], ['[data-vzone="bigtech"]', 110], ['[data-vzone="experience"]', 0]], 2000);
  t('Q7 전체 보기에서 연달아 골라도 그림이 튀지 않고 마지막 구역으로 한 번만 확대', turns(d) === 0 && (await pressed(page))[0] === 'experience', JSON.stringify([turns(d), await pressed(page)]));
  // 같은 구역을 또 눌러도 다시 움직이지 않음
  const e = await trace(page, [['[data-vzone="experience"]', 0]], 500);
  t('Q8 같은 구역을 또 눌러도 움직이지 않음', new Set(e.map((f) => f.s)).size === 1, String(new Set(e.map((f) => f.s)).size));
  await tool(page, 'vmap-fit');
  // 강조 중 직접 조작하면 취소
  await pick(page, 'future');
  await phaseIs(page, 'hold');
  const cdp = await page.createCDPSession();
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const f0 = await state(page);
  await touch('touchStart', [{ x: f0.left + 60, y: f0.top + 200, id: 1 }]);
  await touch('touchEnd', []);
  await sleep(1400);
  const f1 = await state(page);
  t('Q9 강조 중 지도를 만지면 자동 이동만 멈추고 고른 구역 · 외곽선은 남음', near(f1.s, f0.s, 1e-4) && near(f1.x, f0.x) && (await pressed(page))[0] === 'future' && !(await page.$eval('#vmap-hl', (x) => x.hidden)) && !(await page.$eval('#vmap-stage', (x) => x.dataset.phase)), JSON.stringify([f0.s, f1.s]));
  // 확대 중 + 단추
  await pick(page, 'promo');
  await phaseIs(page, 'in');
  await sleep(90);
  await page.evaluate(() => document.getElementById('vmap-in').click());
  await sleep(60);
  const g0 = await state(page);
  await sleep(800);
  const g1 = await state(page);
  t('Q10 확대 중 + 단추를 누르면 자동 이동이 끊기고 튀지 않음', near(g1.s, g0.s, 1e-4) && near(g1.x, g0.x) && !(await page.$eval('#vmap-stage', (x) => x.dataset.phase)), JSON.stringify([g0.s, g1.s]));
  await tool(page, 'vmap-fit');
  // 강조 중 닫기 → 다시 열기
  await pick(page, 'bigtech');
  await phaseIs(page, 'hold');
  await page.click('#vmap-close');
  await sleep(1300);
  await openMap(page);
  await sleep(500);
  const h = await state(page);
  t('Q11 강조 중 닫고 다시 열면 전체 보기 · 남은 동작 없음', near(h.s, v0.s, 1e-4) && (await pressed(page)).length === 0 && await page.$eval('#vmap-hl', (x) => x.hidden) && (await miniState(page)).hidden, JSON.stringify(h));
  // 강조 중 전체 보기
  await pick(page, 'bigtech');
  await phaseIs(page, 'hold');
  await page.evaluate(() => document.getElementById('vmap-fit').click());
  await sleep(1300);
  t('Q12 강조 중 전체 보기를 누르면 확대하지 않고 강조 해제', near((await state(page)).s, v0.s, 1e-4) && (await pressed(page)).length === 0 && await page.$eval('#vmap-hl', (x) => x.hidden));
  // 화면 돌리기
  await zone(page, 'future');
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(350);
  const r = await state(page), [zx, zy, zw, zh] = ZONE_RECTS.future, w = seen(r), mr = await miniState(page);
  t('Q13 화면을 돌려도 고른 구역이 화면 안 · 테두리 · 미니맵 일치', w.l <= zx + 1 && w.r >= zx + zw - 1 && w.t <= zy + 1 && w.b >= zy + zh - 1 && aligned(r, 'future', await hlBoxes(page)) && miniOk(r, mr), JSON.stringify(r));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'landscape-844.png') });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(350);
  const r2 = await state(page), w2 = seen(r2);
  t('Q14 다시 세로로 돌려도 일치', w2.l <= zx + 1 && w2.r >= zx + zw - 1 && miniOk(r2, await miniState(page)), JSON.stringify(r2));
  t('Q15 화면 오류 없음', errs.length === 0, errs.join(' | '));
  await ctx.close();
}
{
  const { ctx, page, errs } = await openPage(390);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await openMap(page);
  const a = await trace(page, [['[data-vzone="future"]', 0]], 1400);
  t('Q16 움직임 줄이기: 강조는 보여 주고 확대는 한 번에 바뀜(중간 프레임 없음)', new Set(a.map((f) => f.s.toFixed(5))).size === 2 && a.some((f) => f.p === 'hold'), String(new Set(a.map((f) => f.s.toFixed(5))).size));
  const b = await trace(page, [['[data-vzone="promo"]', 0]], 1400);
  t('Q17 움직임 줄이기: 다른 구역도 중간 프레임 없음', new Set(b.map((f) => f.s.toFixed(5))).size <= 3 && (await pressed(page))[0] === 'promo', String(new Set(b.map((f) => f.s.toFixed(5))).size));
  t('Q18 화면 오류 없음', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ── U : 이동 속도 · 외곽선 유지 ────────────────────────────────── */
const span = (tr, p) => { const f = tr.filter((x) => x.p === p); return f.length ? f.at(-1).t - f[0].t : 0; };
for (const [W, H] of [[320, 568], [390, 844], [1440, 900]]) {
  const { ctx, page, errs } = await openPage(W, H);
  await openMap(page);
  // 시험 기계가 잠깐 멈춘 프레임(120ms 넘게)이 기록되면 그 판만 다시 잽니다. 세 번 모두 그러면 그대로 실패합니다.
  let a = [];
  for (let i = 0; i < 3; i++) {
    a = await trace(page, [['[data-vzone="future"]', 0]], 1950);
    const g = a.filter((x) => x.p === 'in'), worst = Math.max(...g.slice(1).map((x, n) => x.t - g[n].t));
    if (worst <= 120) break;
    console.log(`참고  ${W}px 확대 중 ${worst.toFixed(0)}ms 프레임 지연 기록 — ${i < 2 ? '다시 잼' : '세 번째도 지연'}`);
    if (i < 2) await tool(page, 'vmap-fit');
  }
  const hold = span(a, 'hold'), inn = span(a, 'in');
  t(`U1 ${W}px 전체 지도에서 약 1000ms 강조 · 약 650ms 확대`, hold >= 930 && hold <= 1100 && inn >= 590 && inn <= 720, JSON.stringify([hold, inn]));
  const b = await trace(page, [['[data-vzone="school-a"]', 0]], 2250);
  const out = span(b, 'out');
  t(`U2 ${W}px 확대 상태에서 고르면 약 300ms 물러남`, out >= 250 && out <= 370, String(out));
  // 천천히 시작해 천천히 멈춤 · 프레임 사이가 튀지 않음
  const f = a.filter((x) => x.p === 'in'), lo = f[0].s, hi = f.at(-1).s, part = (x) => Math.log(x.s / lo) / Math.log(hi / lo);
  const at = (r) => f.find((x) => x.t >= f[0].t + inn * r);
  t(`U3 ${W}px 시작 15% 동안 움직임 5% 미만 · 절반에서 절반쯤 · 끝 15% 동안 움직임 5% 미만`, part(at(0.15)) < 0.05 && part(at(0.5)) > 0.35 && part(at(0.5)) < 0.65 && 1 - part(at(0.85)) < 0.05, JSON.stringify([part(at(0.15)), part(at(0.5)), part(at(0.85))]));
  const jump = Math.max(...f.slice(1).map((x, i) => x.s / f[i].s));
  t(`U4 ${W}px 프레임 사이 배율 변화가 작음(갑작스러운 이동 없음)`, jump < 1.3, String(jump));
  if (SHOTS) {
    await tool(page, 'vmap-fit');
    await pick(page, 'experience');
    await phaseIs(page, 'hold');
    await page.screenshot({ path: join(SHOTS, `flow1-hold-${W}.png`) });
    await phaseIs(page, 'in');
    await sleep(325);
    await page.screenshot({ path: join(SHOTS, `flow2-mid-${W}.png`) });
    await page.waitForFunction(() => document.getElementById('vmap-hl').classList.contains('is-soft'), { timeout: 5000 });
    await sleep(420);
    await page.screenshot({ path: join(SHOTS, `flow3-end-${W}.png`) });
  }
  t(`U5 ${W}px 화면 오류 없음`, errs.length === 0, errs.join(' | '));
  await ctx.close();
}
{
  // 느린 기기: CPU 4배 느리게 해도 프레임이 이어지고 시간이 늘어나지 않음
  const { ctx, page, errs } = await openPage(390);
  await openMap(page);
  await page.emulateCPUThrottling(4);
  const a = await trace(page, [['[data-vzone="school-b"]', 0]], 1950);
  await page.emulateCPUThrottling(null);
  const f = a.filter((x) => x.p === 'in'), gaps = f.slice(1).map((x, i) => x.t - f[i].t).sort((p, q) => p - q);
  const mid = gaps[gaps.length >> 1], worst = gaps.at(-1), inn = span(a, 'in');
  console.log(`참고  CPU 4배 느림: 프레임 ${f.length}개 · 가운데 간격 ${mid.toFixed(1)}ms · 가장 긴 간격 ${worst.toFixed(1)}ms · 확대 ${inn.toFixed(0)}ms`);
  t('U6 느린 기기에서도 프레임이 이어지고(가운데 간격 34ms 이하) 확대 시간은 그대로', mid <= 34 && inn >= 590 && inn <= 760, JSON.stringify([mid, worst, inn]));
  t('U7 화면 오류 없음', errs.length === 0, errs.join(' | '));
  await ctx.close();
}
{
  // 외곽선 유지 · 해제
  const { ctx, page, errs } = await openPage(390);
  await openMap(page);
  const edge = () => page.evaluate(() => { const h = document.getElementById('vmap-hl'), b = document.querySelector('.vmap__hl-box'); return { on: !h.hidden, soft: h.classList.contains('is-soft'), color: b ? getComputedStyle(b).borderTopColor : '' }; });
  await pick(page, 'future');
  await phaseIs(page, 'hold');
  await sleep(420);
  const e1 = await edge();
  t('U8 위치를 보여 줄 때는 선명(불투명 주황)', e1.on && !e1.soft && e1.color === 'rgb(255, 121, 0)', JSON.stringify(e1));
  await page.waitForFunction(() => document.getElementById('vmap-hl').classList.contains('is-soft'), { timeout: 5000 });
  await sleep(420);
  const e2 = await edge(), a = await state(page), keep = await hlBoxes(page);
  t('U9 확대가 끝나도 외곽선 유지 · 옅어짐 · 그림과 일치', e2.on && e2.soft && rgb(e2.color)[3] >= 0.4 && rgb(e2.color)[3] <= 0.7 && aligned(a, 'future', keep), JSON.stringify(e2));
  await sleep(1500);
  const e3 = await edge();
  t('U10 시간이 지나도 외곽선이 사라지지 않음', e3.on && e3.soft, JSON.stringify(e3));
  // 끌기 · 두 손가락 · 단추로 움직여도 유지되고 그림을 따라감
  const cdp = await page.createCDPSession();
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const sx = a.left + 190, sy = a.top + 300;
  await touch('touchStart', [{ x: sx, y: sy, id: 1 }]);
  for (const d of [20, 40, 60]) { await touch('touchMove', [{ x: sx - d, y: sy, id: 1 }]); await sleep(20); }
  await touch('touchEnd', []);
  await sleep(120);
  const b1 = await state(page);
  t('U11 끌어도 고른 구역 유지 · 외곽선이 그림을 따라감 · 미니맵은 실제 자리', (await pressed(page))[0] === 'future' && aligned(b1, 'future', await hlBoxes(page)) && miniOk(b1, await miniState(page)) && !near(b1.x, a.x, 5), JSON.stringify([a.x, b1.x]));
  await tool(page, 'vmap-in');
  const b2 = await state(page);
  t('U12 확대 단추를 눌러도 외곽선이 그림과 일치 · 미니맵은 실제 자리', (await pressed(page))[0] === 'future' && aligned(b2, 'future', await hlBoxes(page)) && miniOk(b2, await miniState(page)), JSON.stringify(b2.s));
  // 미니맵이 외곽선 위에 있어 가려지지 않음
  const order = await page.evaluate(() => { const st = document.getElementById('vmap-stage'), k = [...st.children]; return { hl: k.indexOf(document.getElementById('vmap-hl')), mini: k.indexOf(document.getElementById('vmap-mini')), tools: k.indexOf(document.querySelector('.vmap__tools')) }; });
  t('U13 외곽선은 미니맵 · 조작 단추 아래에 그려짐', order.hl < order.mini && order.hl < order.tools, JSON.stringify(order));
  // 직접 옮긴 뒤 같은 구역을 다시 누르면 다시 찾아감
  await zone(page, 'future');
  const z = await state(page), zb = await hlBoxes(page);
  t('U14 직접 옮긴 뒤 같은 구역을 다시 누르면 그 구역으로 돌아감', near(z.s, a.s, 1e-3) && near(z.x, a.x) && aligned(z, 'future', zb), JSON.stringify([z.s, a.s]));
  // 다른 구역 · 전체 보기 · 닫기에서 해제
  await zone(page, 'promo');
  t('U15 다른 구역을 고르면 앞 구역 강조가 풀리고 새 구역만 표시', (await pressed(page))[0] === 'promo' && (await pressed(page)).length === 1 && (await hlBoxes(page)).length === 1, JSON.stringify(await hlBoxes(page)));
  await tool(page, 'vmap-fit');
  t('U16 전체 보기에서 강조 해제', !(await edge()).on && (await pressed(page)).length === 0);
  await zone(page, 'bigtech');
  await page.click('#vmap-close');
  await sleep(120);
  await openMap(page);
  t('U17 닫았다 열면 강조 해제', !(await edge()).on && (await pressed(page)).length === 0);
  // 직접 옮긴 뒤 화면을 돌려도 고른 구역으로 튀지 않음
  await zone(page, 'future');
  await tool(page, 'vmap-in');
  await page.focus('#vmap-stage');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
  await sleep(120);
  const r0 = seen(await state(page)), rc = (r0.l + r0.r) / 2;
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(350);
  const r1 = await state(page), w1 = seen(r1);
  t('U18 직접 옮긴 뒤 화면을 돌리면 보던 자리를 지킴(가장자리 제한 안에서) · 고른 구역은 유지', near((w1.l + w1.r) / 2, Math.max(rc, (w1.r - w1.l) / 2), 3) && (await pressed(page))[0] === 'future' && aligned(r1, 'future', await hlBoxes(page)), JSON.stringify([rc, (w1.l + w1.r) / 2]));
  t('U19 화면 오류 없음', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ── C : 체험존 안내 ────────────────────────────────────────────── */
for (const [W, H] of [[320, 568], [390, 844], [844, 390], [1440, 900]]) {
  const { ctx, page, errs } = await openPage(W, H);
  await openMap(page);
  t(`C0 ${W}×${H} 처음에는 안내 없음`, await page.$eval('#vmap-tip', (e) => e.hidden));
  await zone(page, 'experience');
  const a = await page.evaluate(() => {
    const e = document.getElementById('vmap-tip'), R = (x) => JSON.parse(JSON.stringify(x.getBoundingClientRect()));
    return { on: !e.hidden, t: e.querySelector('.vmap__tip-t').textContent, d: e.querySelector('.vmap__tip-d').textContent, box: R(e), tools: R(document.querySelector('.vmap__tools')), mini: R(document.getElementById('vmap-mini')), stage: R(document.getElementById('vmap-stage')) };
  });
  t(`C1 ${W}×${H} 체험존을 고르면 번호 안내 · 앱 번호와 지도 장소 대응`, a.on && a.t === '체험 프로그램 번호와 배치도 장소 번호는 다를 수 있어요.' && a.d === '앱 체험1~2 → 체험 01 · 체험3~4 → 체험 02 · 체험5~12 → 3층', JSON.stringify(a));
  t(`C2 ${W}×${H} 안내가 그림 칸 안 · 조작 단추 · 미니맵과 겹치지 않음`, a.box.left >= a.stage.left && a.box.right <= a.stage.right && a.box.bottom <= a.stage.bottom + 0.5 && !hit(a.box, a.tools) && !hit(a.box, a.mini), JSON.stringify(a.box));
  const v = await state(page), [px, py, pw, ph] = partsOf('experience')[0];
  const boxTop = a.box.top - a.stage.top;
  t(`C3 ${W}×${H} 안내가 체험 01 · 02 를 가리지 않음`, v.y + (py + ph) * v.s <= boxTop + 1, JSON.stringify([v.y + (py + ph) * v.s, boxTop]));
  if (SHOTS && [320, 390, 1440].includes(W)) await page.screenshot({ path: join(SHOTS, `tip-${W}.png`) });
  await zone(page, 'future');
  t(`C4 ${W}×${H} 다른 구역을 고르면 안내가 사라짐`, await page.$eval('#vmap-tip', (e) => e.hidden));
  await zone(page, 'experience');
  await tool(page, 'vmap-fit');
  t(`C5 ${W}×${H} 전체 보기에서 안내가 사라짐`, await page.$eval('#vmap-tip', (e) => e.hidden));
  await zone(page, 'experience');
  await page.keyboard.press('Escape'); await sleep(120);
  await openMap(page);
  t(`C6 ${W}×${H} 닫았다 열면 안내 없음 · 화면 오류 없음`, await page.$eval('#vmap-tip', (e) => e.hidden) && errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ── Y : 조작 ───────────────────────────────────────────────────── */
{
  const { ctx, page, errs } = await openPage(1440, 900);
  await openMap(page);
  await zone(page, 'list');
  const a = await state(page);
  await page.mouse.move(a.left + 300, a.top + 300); await page.mouse.wheel({ deltaY: -120 }); await sleep(100);
  t('Y8 휠로 움직여도 고른 구역과 외곽선이 남음', (await pressed(page))[0] === 'list' && !(await page.$eval('#vmap-hl', (x) => x.hidden)));
  await zone(page, 'future');
  await page.keyboard.press('Escape'); await sleep(120);
  await openMap(page);
  const c = await state(page);
  t('Y9 닫았다 열면 전체 보기 · 구역 표시 없음', (await pressed(page)).length === 0 && inBounds(c) && near(c.s, Math.min(c.vw / IW, c.vh / IH), 1e-3), JSON.stringify(c));
  const k = await page.evaluate(() => { const n = document.querySelector('[data-vzone="future"]'); n.focus(); return document.activeElement === n; });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('vmap-hl').classList.contains('is-soft'), { timeout: 5000 });
  t('Y10 자판 Enter 로 구역 이동', k && (await pressed(page))[0] === 'future');
  t('Y11 화면 오류 없음', errs.length === 0, errs.join(' | '));
  await ctx.close();
}
{
  const { ctx, page, errs } = await openPage(390);
  await openMap(page);
  await page.tap('[data-vzone="school-a"]');
  await page.waitForFunction(() => document.getElementById('vmap-hl').classList.contains('is-soft'), { timeout: 5000 });
  t('Y12 휴대폰: 구역 단추 터치', (await pressed(page))[0] === 'school-a');
  const v = await state(page);
  t('Y13 휴대폰: 스쿨존 01~44 는 글자를 읽을 배율(원본 이상)로 열림', v.s >= 1, String(v.s));
  const [ax, , aw] = ZONE_RECTS['school-a'], toolL = await page.$eval('.vmap__tools', (e) => e.getBoundingClientRect().left);
  t('Y14 휴대폰: 스쿨존 01~44 가 조작 단추에 가리지 않음', v.left + v.x + (ax + aw) * v.s <= toolL + 1, JSON.stringify([v.left + v.x + (ax + aw) * v.s, toolL]));
  t('Y15 화면 오류 없음', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ── S : 검색 결과 → 배치도 ─────────────────────────────────────── */
const SOFT = () => document.getElementById('vmap-hl').classList.contains('is-soft');
const find = async (page, q) => {
  await page.evaluate((v) => {
    const f = document.getElementById('search-field');
    if (f && !f.hidden) f.click();
    const i = document.getElementById('q');
    i.value = v;
    i.dispatchEvent(new Event('input', { bubbles: true }));
  }, q);
  await sleep(320);
};
const rowMap = (page, code) => page.evaluateHandle((c) => { const r = [...document.querySelectorAll('#list .row')].find((x) => x.querySelector('.row__code').textContent === c); return r ? r.querySelector('.row__map') : null; }, code);
const tipBooth = (page) => page.evaluate(() => { const e = document.getElementById('vmap-tip-b'); return e.hidden ? '' : e.textContent; });
const hl3f = /parts: (\[\[.*?\]\])/.exec(MAP_JS)[1], EXP_3F = JSON.parse(hl3f);
{
  // 105곳 전부: zone_key · code 로만 구역을 고름
  const { ctx, page, errs } = await openPage(390);
  const list = data.booths.map((b) => ({ zone_key: b.zone, code: b.code, name: b.name, no: b.no }));
  const got = await page.evaluate((a) => a.map((b) => window.VenueMap.zoneOf(b)), list);
  const wantOf = (b) => b.zone_key === '미래' ? 'future' : b.zone_key === '체험' ? 'experience' : b.no <= 44 ? 'school-a' : 'school-b';
  const wrong = list.filter((b, i) => got[i] !== wantOf(b));
  const count = (k) => got.filter((x) => x === k).length;
  t('S1 105곳 전부 맞는 구역(학교 1~44 · 45~84 · 미래 9 · 체험 12)', list.length === 105 && !wrong.length && count('school-a') === 44 && count('school-b') === 40 && count('future') === 9 && count('experience') === 12, JSON.stringify(wrong.slice(0, 5)));
  const nos = data.booths.filter((b) => !['체험', '미래'].includes(b.zone)).map((b) => b.no).sort((a, b) => a - b);
  t('S2 학교 번호 1~84 가 빠짐없이 한 번씩(공식 배치도 스쿨 01~84 와 같은 번호)', nos.length === 84 && nos.every((n, i) => n === i + 1));
  const bad = [{ zone_key: '고등', code: '85' }, { zone_key: '고등', code: '0' }, { zone_key: '고등', code: '' }, { zone_key: '고등', code: '체험6' }, { zone_key: '고등' }, { zone_key: '미래', code: '미래10' }, { zone_key: '미래', code: '3' }, { zone_key: '체험', code: '체험13' }, { zone_key: '체험', code: '체험0' }, { zone_key: 'A', code: '47' }, { code: '47' }, { zone_key: '고등', code: '47', name: '' , x: 0 }];
  const b2 = await page.evaluate((a) => a.map((b) => window.VenueMap.zoneOf(b)).concat(window.VenueMap.zoneOf(null)), bad);
  t('S3 잘못된 번호 · 구역을 모르는 자료는 지도 구역 없음', b2.slice(0, 11).every((x) => x === '') && b2[11] === 'school-b' && b2[12] === '', JSON.stringify(b2));
  const n1 = await page.$$eval('.row__map', (e) => e.length);
  t('S4 검색 전 목록에는 단추가 없음(줄은 그대로)', n1 === 0, String(n1));
  await find(page, '60초');
  const hit = await page.$$eval('#list .row__code', (e) => e.map((x) => x.textContent));
  t('S5 이름에 든 숫자는 번호가 아님: 60초 → 9번(구역 01~44)', hit[0] === '9', JSON.stringify(hit));
  t('S6 화면 오류 없음', errs.length === 0, errs.join(' | '));
  await ctx.close();
}
{
  const { ctx, page, errs } = await openPage(390);
  const org = (no) => data.booths.find((b) => !['체험', '미래'].includes(b.zone) && b.no === no).org;
  const CASES = [
    ['1', '1', 'school-a', `1번 · ${org(1)} / 스쿨존 01~44`],
    ['44', '44', 'school-a', `44번 · ${org(44)} / 스쿨존 01~44`],
    ['45', '45', 'school-b', `45번 · ${org(45)} / 스쿨존 45~84`],
    ['84', '84', 'school-b', `84번 · ${org(84)} / 스쿨존 45~84`],
    ['47', '47', 'school-b', `47번 · ${org(47)} / 스쿨존 45~84`],
    ['미래3', '미래3', 'future', '미래3 · 시험 미래 3 / 미래채움존'],
    ['체험2', '체험2', 'experience', '체험2 · 시험 체험 2 / 체험존'],
    ['체험6', '체험6', 'experience', '체험6 · 시험 체험 6 / 체험존 3층'],
    ['인천신석초', '45', 'school-b', `45번 · ${org(45)} / 스쿨존 45~84`],
    ['인천고잔', '1', 'school-a', `1번 · ${org(1)} / 스쿨존 01~44`]
  ];
  for (const [q, code, want, text] of CASES) {
    await find(page, q);
    const btn = await rowMap(page, code);
    const ok = !!(await btn.evaluate((e) => !!e));
    if (!ok) { t(`S7 '${q}' → ${code} 결과의 단추`, false, 'no button'); continue; }
    await btn.click();
    await phaseIs(page, 'hold');
    const h = await state(page);
    const third = text.endsWith('체험존 3층');
    const parts = third ? EXP_3F : partsOf(want);
    const boxes = await hlBoxes(page);
    const fit = near(h.s, Math.min(h.vw / IW, h.vh / IH), 1e-3);
    const inBox = parts.length === boxes.length && parts.every((p, i) => { const w = p[2] * h.s, hh = p[3] * h.s, gw = parts.length === 1 ? Math.max(0, 22 - w) : 0, gh = parts.length === 1 ? Math.max(0, 22 - hh) : 0; return near(boxes[i].l, h.x + p[0] * h.s - gw / 2) && near(boxes[i].t, h.y + p[1] * h.s - gh / 2) && near(boxes[i].w, w + gw) && near(boxes[i].h, hh + gh); });
    t(`S7 '${q}' → ${code}: 창이 열리고 전체 지도에서 그 구역을 주황으로 강조`, fit && inBox && (await pressed(page))[0] === want, JSON.stringify([fit, inBox, await pressed(page)]));
    await page.waitForFunction(SOFT, { timeout: 5000 });
    await sleep(80);
    const v = await state(page), m = await miniState(page), [zx, zy, zw, zh] = ZONE_RECTS[want], w = seen(v);
    t(`S8 '${q}' → ${code}: 확대 후 구역이 화면 안 · 외곽선 유지 · 미니맵 일치 · 부스 안내 표시`, w.l <= zx + 1 && w.r >= zx + zw - 1 && w.t <= zy + 1 && w.b >= zy + zh - 1 && !(await page.$eval('#vmap-hl', (e) => e.hidden)) && miniOk(v, m) && (await tipBooth(page)) === text, JSON.stringify([await tipBooth(page), text]));
    if (third || code === '체험2') t(`S9 '${q}': 체험존 층별 안내 유지 · ${third ? '3층 안내 자리만 표시(1층 체험 01 · 02 를 가리키지 않음)' : '체험 01 · 02 표시'}`, await page.$eval('.vmap__tip-t', (e) => e.offsetParent !== null) && (await hlName(page)).text === (third ? '체험존 3층' : '체험존'), JSON.stringify(await hlName(page)));
    await page.click('#vmap-close');
    await sleep(120);
    const after = await page.evaluate(() => ({ q: document.getElementById('q').value, focus: document.activeElement.className, open: document.getElementById('vmap').open, lock: document.documentElement.classList.contains('vmap-on') }));
    t(`S10 '${q}': 닫으면 검색어 그대로 · 단추로 초점 복귀 · 뒤 화면 잠금 풀림`, after.q === q && after.focus === 'row__map' && !after.open && !after.lock, JSON.stringify(after));
  }
  // 창 안의 기능은 그대로
  await find(page, '47');
  await (await rowMap(page, '47')).click();
  await page.waitForFunction(SOFT, { timeout: 5000 });
  await zone(page, 'promo');
  t('S11 지도 안에서 다른 구역을 고르면 부스 안내가 사라짐', (await tipBooth(page)) === '' && (await pressed(page))[0] === 'promo');
  await page.click('#vmap-close');
  await sleep(120);
  await find(page, '47');
  await (await rowMap(page, '47')).click();
  await page.waitForFunction(SOFT, { timeout: 5000 });
  await tool(page, 'vmap-fit');
  t('S12 전체 보기로 강조 · 부스 안내가 풀림', (await tipBooth(page)) === '' && (await pressed(page)).length === 0 && (await miniState(page)).hidden);
  await page.click('#vmap-close');
  await sleep(120);
  // 뒤로 가기: 강조 중 · 확대 뒤
  for (const when of ['hold', 'soft']) {
    await find(page, '45');
    const rows0 = await page.$$eval('#list .row', (e) => e.length);
    await (await rowMap(page, '45')).click();
    if (when === 'hold') await phaseIs(page, 'hold'); else await page.waitForFunction(SOFT, { timeout: 5000 });
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(300);
    const a = await page.evaluate(() => ({ open: document.getElementById('vmap').open, q: document.getElementById('q').value, rows: document.querySelectorAll('#list .row').length, lock: document.documentElement.classList.contains('vmap-on'), url: location.pathname }));
    t(`S13 뒤로 가기(${when}): 창만 닫히고 검색어 · 결과 · 주소 그대로`, !a.open && a.q === '45' && a.rows === rows0 && !a.lock, JSON.stringify(a));
    await sleep(1300);
    t(`S14 뒤로 간 뒤(${when}) 남은 자동 이동 없음`, !(await page.$eval('#vmap-stage', (e) => e.dataset.phase)));
  }
  // 다시 열면 일반 전체 보기
  await page.evaluate(() => document.getElementById('map-open').click());
  await sleep(200);
  t('S15 배치도 단추로 열면 부스 안내 없이 전체 보기', (await tipBooth(page)) === '' && (await pressed(page)).length === 0 && (await miniState(page)).hidden);
  await page.keyboard.press('Escape');
  await sleep(120);
  // 결과 없음 · 지운 뒤 · 한눈에
  await find(page, '999');
  const none = await page.evaluate(() => ({ rows: document.querySelectorAll('#list .row').length, btn: document.querySelectorAll('.row__map').length, text: document.getElementById('list').textContent }));
  t('S16 없는 번호: 기존 안내 그대로 · 단추 없음', none.rows === 0 && none.btn === 0 && none.text.includes('찾는 부스가 없어요'), JSON.stringify(none));
  await find(page, '없는학교이름');
  t('S17 없는 이름: 단추 없음', (await page.$$eval('.row__map', (e) => e.length)) === 0);
  await find(page, '47');
  const n47 = await page.$$eval('.row__map', (e) => e.length);
  await find(page, '');
  await page.evaluate(() => document.getElementById('search-cancel').click());
  await sleep(250);
  t('S18 검색을 끝내면 단추가 사라지고 줄은 원래대로', n47 >= 1 && (await page.$$eval('.row__map', (e) => e.length)) === 0, String(n47));
  await page.evaluate(() => document.querySelector('#list .row').click());
  await sleep(120);
  t('S19 줄을 눌러도 창이 열리지 않음(단추만 염)', !(await isOpen(page)));
  t('S20 화면 오류 없음', errs.length === 0, errs.join(' | '));
  await ctx.close();
}
{
  // 그림을 받기 전에 고른 경우
  const { ctx, page, errs } = await openPage(390);
  net.delay = 1500;
  net.image = 0;
  await find(page, '47');
  await (await rowMap(page, '47')).click();
  await sleep(250);
  const a = await page.evaluate(() => ({ open: document.getElementById('vmap').open, note: document.getElementById('vmap-note-t').textContent, hl: document.getElementById('vmap-hl').hidden, btn: document.querySelector('[data-vzone="school-b"]').disabled, img: document.getElementById('vmap-img').hidden }));
  t('S21 그림 받기 전: 창이 열리고 불러오는 안내 · 강조 아직 없음', a.open && a.note === '배치도를 불러오는 중이에요' && a.hl && a.img, JSON.stringify(a));
  await phaseIs(page, 'hold');
  const h = await state(page);
  t('S22 그림을 받은 뒤 전체 지도에서 강조부터 시작', near(h.s, Math.min(h.vw / IW, h.vh / IH), 1e-3) && aligned(h, 'school-b', await hlBoxes(page)) && (await pressed(page))[0] === 'school-b', JSON.stringify(h));
  await page.waitForFunction(SOFT, { timeout: 5000 });
  await sleep(80);
  const v = await state(page), w = seen(v), [zx, zy, zw, zh] = ZONE_RECTS['school-b'];
  t('S23 그림을 받은 뒤 고른 구역으로 정확히 이동 · 그림은 한 번만 받음', w.l <= zx + 1 && w.r >= zx + zw - 1 && w.t <= zy + 1 && w.b >= zy + zh - 1 && aligned(v, 'school-b', await hlBoxes(page)) && net.image === 1, JSON.stringify([v.s, net.image]));
  t('S24 화면 오류 없음', errs.length === 0, errs.join(' | '));
  net.delay = 0;
  await ctx.close();
}
{
  // 받는 중에 닫기 · 받기 실패 뒤 다시 불러오기
  const { ctx, page, errs } = await openPage(390);
  net.delay = 700;
  await find(page, '84');
  await (await rowMap(page, '84')).click();
  await sleep(150);
  await page.click('#vmap-close');
  await sleep(1400);
  net.delay = 0;
  t('S25 그림을 받는 중 닫으면 받은 뒤에도 창이 열리지 않고 움직이지 않음', !(await isOpen(page)) && !(await page.$eval('#vmap-stage', (e) => e.dataset.phase)));
  await page.evaluate(() => document.getElementById('map-open').click());
  await sleep(300);
  t('S26 다시 열면 고른 구역 없이 전체 보기', (await pressed(page)).length === 0 && (await tipBooth(page)) === '' && (await page.$eval('#vmap-hl', (e) => e.hidden)));
  await page.keyboard.press('Escape');
  await sleep(120);
  await ctx.close();
  const b = await openPage(390);
  net.fail = true;
  await find(b.page, '미래3');
  await (await rowMap(b.page, '미래3')).click();
  await b.page.waitForFunction(() => !document.getElementById('vmap-retry').hidden, { timeout: 8000 });
  net.fail = false;
  await b.page.click('#vmap-retry');
  await b.page.waitForFunction(SOFT, { timeout: 8000 });
  t('S27 그림을 못 받았다가 다시 불러오면 고른 구역으로 이동', (await pressed(b.page))[0] === 'future' && (await tipBooth(b.page)).startsWith('미래3 · '));
  t('S28 화면 오류 없음', errs.length === 0 && b.errs.length === 0, errs.concat(b.errs).join(' | '));
  await b.ctx.close();
}
for (const [W, H] of [[320, 568], [390, 844], [768, 1024], [1440, 900]]) {
  const { ctx, page, errs } = await openPage(W, H);
  const shot = (n) => (SHOTS ? page.screenshot({ path: join(SHOTS, `${n}-${W}.png`) }) : null);
  // 가장 긴 학교 이름
  await find(page, '인하대학교사범대학부속고등학교');
  const g = await page.evaluate(() => {
    const R = (e) => JSON.parse(JSON.stringify(e.getBoundingClientRect()));
    const rows = [...document.querySelectorAll('#list .row')].map((r) => ({ b: R(r.querySelector('.row__map')), body: R(r.querySelector('.row__body')), right: R(r.querySelector('.row__right')), name: R(r.querySelector('.row__name')), org: R(r.querySelector('.row__org')), row: R(r) }));
    return { rows, ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth, vw: innerWidth };
  });
  const hitR = (a, c) => !(a.right <= c.left || c.right <= a.left || a.bottom <= c.top || c.bottom <= a.top);
  t(`S29 ${W}px 단추 44px 이상 · 줄 안 · 번호 칸 · 상태 칸 · 이름과 겹치지 않음 · 가로 스크롤 없음`, g.rows.length === 1 && g.ovf <= 0 && g.rows.every((r) => r.b.height >= 44 && r.b.width >= 44 && r.b.right <= r.right.left + 0.5 && r.b.bottom <= r.row.bottom + 0.5 && !hitR(r.b, r.right) && !hitR(r.b, r.name) && r.b.right <= g.vw), JSON.stringify(g.rows[0]));
  await shot('search');
  const btn = await rowMap(page, '30');
  await btn.click();
  await phaseIs(page, 'hold');
  await sleep(200);
  await shot('search-hold');
  await page.waitForFunction(SOFT, { timeout: 5000 });
  await sleep(420);
  const m = await page.evaluate(() => {
    const R = (e) => JSON.parse(JSON.stringify(e.getBoundingClientRect())), q = (s) => document.querySelector(s);
    const tEl = document.getElementById('vmap-tip-b');
    return { tip: R(q('#vmap-tip')), tools: R(q('.vmap__tools')), mini: R(q('#vmap-mini')), stage: R(q('#vmap-stage')), cut: tEl.scrollWidth > tEl.clientWidth + 0.5, close: R(q('#vmap-close')) };
  });
  t(`S30 ${W}px 부스 안내가 그림 칸 안 · 잘림 없음 · 조작 단추 · 미니맵 · 닫기와 겹치지 않음`, m.tip.left >= m.stage.left && m.tip.right <= m.stage.right && m.tip.bottom <= m.stage.bottom + 0.5 && !m.cut && !hitR(m.tip, m.tools) && !hitR(m.tip, m.mini) && !hitR(m.tip, m.close), JSON.stringify(m.tip));
  await shot('search-end');
  await page.click('#vmap-close');
  await sleep(120);
  // 체험존 3층 안내 + 번호 안내가 함께 있을 때
  await find(page, '체험6');
  await (await rowMap(page, '체험6')).click();
  await phaseIs(page, 'hold');
  await sleep(200);
  await shot('search-exp-hold');
  await page.waitForFunction(SOFT, { timeout: 5000 });
  await sleep(420);
  const c = await page.evaluate(() => { const R = (e) => JSON.parse(JSON.stringify(e.getBoundingClientRect())), q = (s) => document.querySelector(s); return { tip: R(q('#vmap-tip')), tools: R(q('.vmap__tools')), mini: R(q('#vmap-mini')), stage: R(q('#vmap-stage')) }; });
  const v = await state(page), [px, py, pw, ph] = EXP_3F[0], top = c.tip.top - c.stage.top;
  t(`S31 ${W}px 체험존 안내가 조작 단추 · 미니맵과 겹치지 않고 그림 칸 절반 아래만 차지`, !hitR(c.tip, c.tools) && !hitR(c.tip, c.mini) && c.tip.height <= c.stage.height * 0.5, JSON.stringify([c.tip.height, c.stage.height]));
  t(`S32 ${W}px 체험존 안내가 3층 안내 자리를 가리지 않음`, v.y + (py + ph) * v.s <= top + 1, JSON.stringify([v.y + (py + ph) * v.s, top]));
  await shot('search-exp-end');
  t(`S33 ${W}px 화면 오류 없음`, errs.length === 0, errs.join(' | '));
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
