/* 운영자 카드 · PIN 배부표의 인쇄 순서를 실제 Chrome 의 PDF 로 봅니다.
   print-qr.html?demo 에 가상 부스 105곳과 가상 PIN 을 넣어 돌립니다. 서버 · 실제 PIN 에는 닿지 않습니다.

     node scripts/test-pin-print-order.mjs --deps <puppeteer-core · pdfjs-dist 를 깐 폴더>

     C  카드      화면 · PDF 번호순, 왼쪽→오른쪽 · 위→아래, 쪽이 넘어가도 이어짐, 누락 · 중복 없음
     Z  구역별    '구역별로 새 페이지' 를 켜면 구역마다 새 쪽, 그 안에서 번호순
     P  배부표    조회 뒤 배부표: 번호순 · 부스 · 기관 · PIN 짝 · A4 · 잘림 없음
     Q  QR + PIN  'QR코드 + 개별 PIN' 카드: 번호순 · PIN 짝
*/
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import http from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = resolve(arg('root', resolve(HERE, '..')));
const DEPS = resolve(arg('deps'));
const OUT = arg('out', '');
const need = createRequire(join(DEPS, 'package.json'));
const puppeteer = need('puppeteer-core');
const pdfjs = await import(pathToFileURL(need.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
const CHROME = arg('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe');

const results = [];
function t(name, ok, note = '') { results.push({ ok: !!ok }); console.log(`${ok ? '통과' : '실패'}  ${name}${!ok && note ? '  — ' + String(note).slice(0, 500) : ''}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 가상 자료: 번호가 구역을 넘나드는 실제 배치를 흉내 냅니다 ─────────────── */
const zoneOfNo = (n) => (n === 48 ? '특수' : ['초등', '중등', '고등'][n % 3]);
const ZONES = ['초등', '중등', '고등', '특수', '체험', '미래'];
const raw = [];
for (let n = 1; n <= 84; n += 1) raw.push({ code: String(n), zone: zoneOfNo(n) });
raw.push({ code: '7', zone: '체험' });            // 다른 구역의 같은 번호: 구역 순서를 지켜야 합니다
for (let n = 1; n <= 12; n += 1) raw.push({ code: `체험${n}`, zone: '체험' });
for (let n = 1; n <= 9; n += 1) raw.push({ code: `미래${n}`, zone: '미래' });
const BOOTHS = ZONES.flatMap((z) => raw.filter((b) => b.zone === z)).map((b, i) => ({
  id: `v-${i + 1}`, code: b.code, zone_key: b.zone, zone_label: b.zone, name: `시험부스${b.zone}${b.code}호`, org: `시험기관${b.zone}${b.code}`, program: '', congestion: '여유', wait_minutes: 5, age_min: 1,
}));
// 시연의 PIN 규칙은 번호 하나에 PIN 하나라, 같은 번호의 두 부스는 같은 가상 PIN 을 씁니다.
const fakePin = (b) => String(1000 + BOOTHS.findIndex((x) => x.code === b.code));
const num = (c) => (/^\d+$/.test(c) ? Number(c) : NaN);
// 기대하는 차례: 숫자 번호는 크기순(같은 번호는 구역 순서) → 체험 → 미래
const EXPECT = [...BOOTHS.filter((b) => /^\d+$/.test(b.code)).map((b, i) => ({ b, i })).sort((x, y) => num(x.b.code) - num(y.b.code) || x.i - y.i).map((x) => x.b), ...BOOTHS.filter((b) => !/^\d+$/.test(b.code))];
const WANT = EXPECT.map((b) => b.name);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const MOCK = `\n;window.MOCK_BOOTHS = ${JSON.stringify(BOOTHS)};\nwindow.MOCK_DEMO_PIN = function (code) { var m = ${JSON.stringify(Object.fromEntries(BOOTHS.map((b) => [b.code, fakePin(b)])))}; return m[code] || ''; };\n`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const p = decodeURIComponent(new URL(q.url, 'http://x').pathname).replace(/^\/+/, '');
  const f = resolve(ROOT, p);
  if (!f.startsWith(ROOT) || !existsSync(f) || !statSync(f).isFile()) { r.writeHead(404); r.end(); return; }
  let out = readFileSync(f);
  if (p === 'assets/mock-data.js') out = out.toString('utf8') + MOCK;
  r.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  r.end(out);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--no-default-browser-check'] });
const pdfjsOpts = { useSystemFonts: true, disableFontFace: true, verbosity: 0 };

// PDF 쪽마다 글자를 위→아래 · 왼쪽→오른쪽으로 읽습니다.
async function readPdf(buf) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), ...pdfjsOpts }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const pg = await doc.getPage(i), vp = pg.getViewport({ scale: 1 }), tc = await pg.getTextContent();
    // Chrome 의 PDF 는 글자를 낱낱으로 내보냅니다. 같은 높이에서 이어지는 글자를 한 덩이로 묶습니다.
    const raw = tc.items.filter((x) => x.str.length).map((x) => ({ s: x.str, x: x.transform[4], y: x.transform[5], r: x.transform[4] + x.width }));
    raw.sort((a, b) => (Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x));
    const items = [];
    for (const c of raw) {
      const last = items[items.length - 1];
      if (last && Math.abs(last.y - c.y) <= 2 && c.x - last.r < 14) { last.s += c.s; last.r = Math.max(last.r, c.r); } else items.push({ ...c });
    }
    pages.push({ w: vp.width, h: vp.height, items: items.filter((x) => x.s.trim()) });
  }
  return pages;
}
// 카드 · 쪽지는 한 줄에 두 칸입니다. 이름 글자의 자리로 위→아래, 왼쪽→오른쪽 차례를 정합니다.
function namesInOrder(page) {
  const hits = page.items.filter((x) => /시험부스/.test(x.s)).map((x) => ({ name: (x.s.match(/시험부스\S+?호/) || [x.s])[0], x: x.x, y: x.y }));
  hits.sort((a, b) => (Math.abs(a.y - b.y) > 6 ? b.y - a.y : a.x - b.x));
  return hits;
}
const printPdf = (page) => page.pdf({ preferCSSPageSize: true, printBackground: true });
// --out 을 주면 인쇄 화면의 첫 부분을 그림으로도 남깁니다.
async function printShot(page, name) {
  if (!OUT) return;
  await page.emulateMediaType('print');
  await page.setViewport({ width: 794, height: 1123 });
  await page.screenshot({ path: join(OUT, name) });
  await page.setViewport({ width: 1280, height: 900 });
  await page.emulateMediaType(null);
}

async function open() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.setViewport({ width: 1280, height: 900 });
  // 인쇄 창을 대신합니다. PIN 카드는 인쇄 창이 닫히면 바로 숫자를 지우므로, 창이 열린 그 순간의 카드를 남겨 둡니다.
  await page.evaluateOnNewDocument(() => {
    window.__prints = 0;
    window.print = () => {
      window.__prints += 1;
      const g = document.getElementById('grid-ops');
      if (!document.body.classList.contains('is-pinfill') || !g) return;
      window.__snap = { html: g.innerHTML, cards: [...g.querySelectorAll('.item')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => { const r = e.getBoundingClientRect(); return { name: e.querySelector('.card__name').textContent, pin: (e.querySelector('.card__pin-v') || { textContent: '' }).textContent.replace(/\D/g, ''), top: Math.round(r.top + window.scrollY), left: Math.round(r.left) }; }) };
    };
  });
  await page.goto(`${ORIGIN}/print-qr.html?demo`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#grid-ops .item', { timeout: 20000 });
  await sleep(500);
  return { ctx, page, errs };
}
const screenOrder = (page, sel) => page.$$eval(sel, (els) => els.filter((e) => getComputedStyle(e).display !== 'none').map((e) => { const r = e.getBoundingClientRect(); return { name: e.querySelector('.card__name').textContent, top: Math.round(r.top + window.scrollY), left: Math.round(r.left) }; }));

/* ── C : 카드 ───────────────────────────────────────────────────── */
const { ctx, page, errs } = await open();
{
  const s = await screenOrder(page, '#grid-ops .item');
  s.sort((a, b) => a.top - b.top || a.left - b.left);
  t(`C1 화면 카드 ${s.length}장이 위→아래 · 왼쪽→오른쪽으로 번호순`, same(s.map((x) => x.name), WANT), JSON.stringify(s.slice(0, 10).map((x) => x.name)));
  const buf = await printPdf(page);
  if (OUT) writeFileSync(join(OUT, 'pin-cards.pdf'), buf);
  await printShot(page, 'pin-cards.png');
  const pages = await readPdf(buf);
  const seq = pages.flatMap((p) => namesInOrder(p).map((x) => x.name));
  t(`C2 PDF ${pages.length}쪽 전체가 번호순(쪽이 넘어가도 이어짐)`, same(seq, WANT), JSON.stringify(seq.slice(0, 12)));
  t('C3 누락 · 중복 없음', new Set(seq).size === BOOTHS.length && seq.length === BOOTHS.length, `${seq.length}/${new Set(seq).size}`);
  t('C4 A4 · 쪽마다 4장 · 쪽 수 = 올림(곳 수 / 4)', pages.every((p) => Math.abs(p.w - 595.3) < 2 && Math.abs(p.h - 841.9) < 2) && pages.length === Math.ceil(BOOTHS.length / 4) && pages.slice(0, -1).every((p) => namesInOrder(p).length === 4), JSON.stringify([pages.length, pages[0].w, pages[0].h]));
  const first = namesInOrder(pages[0]);
  t('C5 쪽 안 왼쪽 위 → 오른쪽 위 → 왼쪽 아래 → 오른쪽 아래', first[0].x < first[1].x && Math.abs(first[0].y - first[1].y) <= 6 && first[2].y < first[0].y - 50 && first[2].x < first[3].x, JSON.stringify(first));
  const nos = seq.map((n) => (n.match(/(\d+)호$/) || [])[1]).slice(0, 85).map(Number);
  t('C6 숫자 크기순(1 → 2 → 3 → 10 → 11, 글자 순서가 아님)', nos.every((n, k) => !k || nos[k - 1] <= n) && nos.indexOf(2) < nos.indexOf(10) && nos.indexOf(10) < nos.indexOf(11) && nos[nos.length - 1] === 84, JSON.stringify(nos.slice(0, 14)));
  const dup = WANT.filter((n) => /7호$/.test(n) && !/체험7호|미래7호|\d7호/.test(n.replace(/시험부스\S\S/, '')) ).slice(0, 2);
  t('C7 같은 번호(7)는 구역 순서: 학교 구역 먼저, 체험 구역이 뒤', dup.length === 2 && !dup[0].includes('체험') && dup[1].includes('체험') && WANT.indexOf(dup[1]) === WANT.indexOf(dup[0]) + 1, JSON.stringify(dup));
}

/* ── Z : 구역별 새 페이지 ───────────────────────────────────────── */
{
  await page.click('#opt-zonebreak'); await sleep(250);
  const pages = await readPdf(await printPdf(page));
  const zoneOfName = (n) => n.slice(4, 6);
  const perPage = pages.map((p) => namesInOrder(p).map((x) => x.name));
  const seq = perPage.flat();
  const zones = ZONES.filter((z) => BOOTHS.some((b) => b.zone_key === z));
  const wantSeq = zones.flatMap((z) => BOOTHS.filter((b) => b.zone_key === z).map((b) => b.name));
  t('Z1 켜면 구역 순서 · 구역 안 번호순', same(seq, wantSeq), JSON.stringify(seq.slice(0, 10)));
  t('Z2 한 쪽에 두 구역이 섞이지 않음', perPage.every((p) => new Set(p.map(zoneOfName)).size <= 1), JSON.stringify(perPage.map((p) => [...new Set(p.map(zoneOfName))])));
  await page.click('#opt-zonebreak'); await sleep(250);
  const back = (await readPdf(await printPdf(page))).flatMap((p) => namesInOrder(p).map((x) => x.name));
  t('Z3 끄면 다시 번호순', same(back, WANT), JSON.stringify(back.slice(0, 8)));
}

/* ── P : PIN 배부표 ─────────────────────────────────────────────── */
const ovBtn = (name) => page.evaluate((n) => { const b = document.querySelector(`[data-ov="${n}"]`); if (b && !b.disabled) { b.click(); return true; } return false; }, name);
const waitOv = async (name, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await page.$(`[data-ov="${name}"]:not([disabled])`)) return true; await sleep(150); } return false; };
{
  await page.evaluate(() => { const b = document.getElementById('pinx-toggle'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); });
  await sleep(200);
  // 시연 예시 범위 안내가 있으면 모두 보이게 둡니다
  await page.evaluate(() => document.getElementById('pinx-all').click()); await sleep(200);
  await page.evaluate(() => document.getElementById('pinx-issue').click());
  t('P0 가상 발급 시작(시연 메모리에만)', await waitOv('go', 15000));
  await ovBtn('go');
  t('P0 가상 발급 끝', await waitOv('print', 90000));
  await page.evaluate(() => { const c = document.querySelector('.ov [type="checkbox"], #pinov input[type="checkbox"]'); if (c) c.click(); });
  await ovBtn('print'); await sleep(300);
  const dom = await page.$$eval('#pinsheet .pslip', (s) => s.map((x) => ({ who: x.querySelector('.pslip__who').textContent, org: x.querySelector('.pslip__org').textContent, pin: x.querySelector('.pslip__pin').textContent.replace(/\D/g, '') })));
  const wantWho = EXPECT.map((b) => `${b.code} ${b.name}`);
  t(`P1 배부표 ${dom.length}곳 번호순`, same(dom.map((x) => x.who), wantWho), JSON.stringify(dom.slice(0, 6).map((x) => x.who)));
  t('P2 부스 · 기관 · PIN 짝이 그대로', dom.length === EXPECT.length && dom.every((x, i) => x.org.startsWith(EXPECT[i].org) && x.pin === fakePin(EXPECT[i])), JSON.stringify(dom.find((x, i) => !x.org.startsWith(EXPECT[i].org) || x.pin !== fakePin(EXPECT[i]))));
  t('P3 누락 · 중복 없음', new Set(dom.map((x) => x.who)).size === EXPECT.length);
  await printShot(page, 'pin-sheet.png');   // PDF 를 만들면 afterprint 로 배부표가 지워지므로 먼저 찍습니다
  const buf = await printPdf(page);
  if (OUT) writeFileSync(join(OUT, 'pin-sheet.pdf'), buf);
  const pages = await readPdf(buf);
  const seq = pages.flatMap((p) => namesInOrder(p).map((x) => x.name));
  t(`P4 PDF ${pages.length}쪽 번호순 · A4`, same(seq, WANT) && pages.every((p) => Math.abs(p.w - 595.3) < 2 && Math.abs(p.h - 841.9) < 2), JSON.stringify(seq.slice(0, 8)));
  t('P5 글자가 쪽 안에(잘림 없음) · 쪽지 글이 모두 있음', pages.every((p) => p.items.every((x) => x.x >= 0 && x.x < p.w && x.y > 0 && x.y < p.h)) && pages.flatMap((p) => p.items).filter((x) => /운영자 PIN · 관람객용 아님/.test(x.s)).length === EXPECT.length, String(pages.flatMap((p) => p.items).filter((x) => /관람객용 아님/.test(x.s)).length));
  t('P6 인쇄 창을 한 번 열었음', (await page.evaluate(() => window.__prints)) === 1);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint'))); await sleep(200);
  t('P7 인쇄 뒤 배부표를 지움', (await page.$$eval('#pinsheet .pslip', (s) => s.length)) === 0);
  await page.evaluate(() => { const c = document.querySelector('[data-ov="ack"], .pinov__ack input'); if (c && !c.checked) c.click(); });
  await ovBtn('close'); await sleep(300);
  await page.evaluate(() => { const y = document.querySelector('[data-ov="close-anyway"], [data-ov="closeok"]'); if (y) y.click(); });
  await sleep(300);
}

/* ── Q : QR + 개별 PIN 카드 ─────────────────────────────────────── */
{
  const ready = await page.evaluate(() => { const r = document.getElementById('opt-pin'); if (r.disabled) return false; r.click(); return true; });
  await sleep(300);
  t('Q0 QR코드 + 개별 PIN 켜짐', ready);
  await page.evaluate(() => document.getElementById('print-btn').click());
  const end = Date.now() + 20000; let printed = 0;
  while (Date.now() < end) { printed = await page.evaluate(() => window.__prints); if (printed >= 2) break; await sleep(150); }
  t('Q1 서버 확인(시연) 뒤 인쇄 창', printed >= 2, String(printed));
  const cards = await page.evaluate(() => (window.__snap ? window.__snap.cards : []));
  cards.sort((a, b) => a.top - b.top || a.left - b.left);
  t('Q2 카드 번호순 · 부스와 PIN 짝이 그대로', same(cards.map((x) => x.name), WANT) && cards.every((x, i) => x.pin === fakePin(EXPECT[i])), JSON.stringify(cards.slice(0, 3)));
  // 인쇄 창이 열렸던 순간의 카드 그대로 PDF 로 냅니다.
  await page.evaluate(() => { document.getElementById('grid-ops').innerHTML = window.__snap.html; document.body.classList.add('is-pinfill'); });
  const buf = await printPdf(page);
  if (OUT) writeFileSync(join(OUT, 'pin-qr-cards.pdf'), buf);
  const pages = await readPdf(buf);
  const seq = pages.flatMap((p) => namesInOrder(p).map((x) => x.name));
  t(`Q3 PDF ${pages.length}쪽 번호순`, same(seq, WANT), JSON.stringify(seq.slice(0, 8)));
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint'))); await sleep(200);
}
t('E1 페이지 오류 없음', errs.length === 0, errs.join(' | '));
await ctx.close();
await browser.close();
server.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} / ${results.length} 통과`);
process.exit(bad.length ? 1 : 0);
