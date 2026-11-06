/* 대기 현황 09:30 공개를 봅니다. 공개 API(live-snapshot)는 한국시간을 고정해 돌리고, 화면은 실제 Chrome 으로 봅니다.
   실행: node test-live-open.mjs --deps <폴더>     어떤 시험도 Production 에 접속하지 않습니다.

     A  API     11-06 · 11-07 시각별 공개 값 · 09:35 입력 → 09:45 공개 → 10:00 이후 유지 · 경계 · 공식 시간 유지 · 쓰기 없음
     V  화면    같은 시각의 관람객 화면 · 입력 없는 부스 · 현장예약 · 정렬 · 한눈에 · QR · 안내 문구
     O  옛 화면 배포 전에 열어 둔 화면(옛 booth-core)도 재접속 없이 값 표시 · 10:00 에 사라지지 않음
     C  운영자  getSettings() · eventInfo() · applyOpenRule() 가 같은 기준
     R  갱신    열어 둔 화면이 09:30 경계를 넘으면 기존 자동 갱신으로 값이 나타남
*/
import { readFileSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import http from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const puppeteer = createRequire(join(resolve(arg('deps')), 'package.json'))('puppeteer-core');
const CHROME = arg('chrome', ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((p) => { try { readFileSync(p); return true; } catch { return false; } }));
const OLD = arg('old', '4096132');   // 09:30 공개 전 코드

const results = [];
function t(name, ok, note = '') { results.push({ ok: !!ok }); console.log(`${ok ? '통과' : '실패'}  ${name}${!ok && note ? '  — ' + String(note).slice(0, 420) : ''}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const K = (d, hm, sec = '00') => Date.parse(`2026-11-${d}T${hm}:${sec}+09:00`);
const iso = (ms) => new Date(ms).toISOString();

/* ── 자료: 105곳 ────────────────────────────────────────────────── */
const TABLE = readFileSync(join(HERE, 'short-names-105.md'), 'utf8').split(/\r?\n/).filter((l) => l.startsWith('| ') && !l.startsWith('| 번호') && !l.startsWith('| ---')).map((l) => { const [code, zone, official] = l.slice(2, -2).split(' | '); return { code, zone, official }; });
const booths = TABLE.map((r, i) => ({ id: `b${i + 1}`, no: Number(r.code.match(/\d+/)[0]), code: r.code, zone_key: r.zone, name: `시험 ${r.code}`, org: r.zone === '체험' ? '' : r.official, program: '' }));
const idOf = (code) => booths.find((b) => b.code === code).id;
const SETTINGS = { event_title: '시험 행사', venue: '시험 장소', date_label: '11.6~7', time_label: '10:00 ~ 17:00', event_start: '2026-11-06T01:00:00+00:00', event_end: '2026-11-07T08:00:00+00:00', booth_map_url: '', booth_map_alt: '' };
const ZONES = [['초등', 1], ['중등', 2], ['고등', 3], ['특수', 4], ['체험', 5], ['미래', 6]].map(([key, sort_order]) => ({ key, label: key, sort_order }));
// 저장된 값. 시각이 지나기 전에는 표에 없습니다(그때의 DB 처럼).
const row = (code, c, w, at) => ({ booth_id: idOf(code), congestion: c, wait_minutes: w, updated_at: iso(at), _at: at });
const DAY1 = [row('57', '보통', 20, K('06', '09:35')), row('45', '예약중', 0, K('06', '09:40')), row('58', '혼잡', 30, K('06', '10:05')), row('76', '예약마감', 0, K('06', '09:50')),
  row('미래9', '예약중', 0, K('06', '07:50')), row('5', '중단', 0, K('06', '09:17')), row('59', '보통', 15, K('06', '06:50')), row('60', '여유', 5, K('05', '18:00'))];
const DAY2 = [row('57', '보통', 20, K('06', '16:30')), row('61', '여유', 5, K('07', '09:20')), row('62', '혼잡', 30, K('07', '09:40')), row('45', '예약중', 0, K('07', '09:41'))];
const MODES = [{ booth_id: idOf('45'), mode: 'reserve' }, { booth_id: idOf('76'), mode: 'reserve' }, { booth_id: idOf('미래9'), mode: 'reserve' }];
const writes = [];
function tables(list, at) { return { settings: [SETTINGS], zones: ZONES, booths, 'rpc/booth_preview_list': [], booth_live: list.filter((r) => r._at <= at).map(({ _at, ...r }) => r), booth_live_mode: MODES }; }

/* ── 공개 API ───────────────────────────────────────────────────── */
let imp = 0;
const loadApi = () => import(pathToFileURL(resolve(REPO, 'live/api/live-snapshot.mjs')).href + '?o=' + (++imp));
async function callApi(mod, at, list) {
  const realFetch = globalThis.fetch, realNow = Date.now, tb = tables(list, at);
  Date.now = () => at;
  globalThis.fetch = async (url, opt) => {
    if (opt && opt.method && opt.method !== 'GET') writes.push(String(url));
    const name = String(url).split('/rest/v1/')[1].split('?')[0], v = tb[name];
    return v === undefined ? new Response('{"code":"PGRST205"}', { status: 404 }) : new Response(JSON.stringify(v), { status: 200 });
  };
  try {
    const res = await mod.default.fetch(new Request('https://x.test/api/live-snapshot'));
    return JSON.parse(await res.text());
  } finally { globalThis.fetch = realFetch; Date.now = realNow; }
}
const shownOf = (d) => Object.fromEntries(d.booths.filter((b) => b.status || b.reserve).map((b) => [b.code, b.reserve ? `예약:${b.reserve}` : `${b.status}:${b.waitMinutes}`]));
const DAY1_EXPECT = [
  ['09:29', {}],
  ['09:30', { 미래9: '예약:open', 5: '중단:0' }],
  ['09:35', { 57: '보통:20', 미래9: '예약:open', 5: '중단:0' }],
  ['09:45', { 57: '보통:20', 45: '예약:open', 미래9: '예약:open', 5: '중단:0' }],
  ['09:59', { 57: '보통:20', 45: '예약:open', 76: '예약:closed', 미래9: '예약:open', 5: '중단:0' }],
  ['10:00', { 57: '보통:20', 45: '예약:open', 76: '예약:closed', 미래9: '예약:open', 5: '중단:0' }],
  ['10:01', { 57: '보통:20', 45: '예약:open', 76: '예약:closed', 미래9: '예약:open', 5: '중단:0' }],
  ['10:06', { 57: '보통:20', 45: '예약:open', 58: '혼잡:30', 76: '예약:closed', 미래9: '예약:open', 5: '중단:0' }],
  ['16:59', { 57: '보통:20', 45: '예약:open', 58: '혼잡:30', 76: '예약:closed', 미래9: '예약:open', 5: '중단:0' }],
  ['17:00', {}],
  ['23:30', {}],
];
const DAY2_EXPECT = [['09:29', {}], ['09:30', {}], ['09:40', { 62: '혼잡:30' }], ['09:45', { 62: '혼잡:30', 45: '예약:open' }], ['10:00', { 62: '혼잡:30', 45: '예약:open' }], ['16:59', { 62: '혼잡:30', 45: '예약:open' }], ['17:00', {}]];
const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
for (const [hm, want] of DAY1_EXPECT) {
  const d = await callApi(await loadApi(), K('06', hm), DAY1);
  t(`A1 11-06 ${hm} 공개 값 ${Object.keys(want).length}곳(06:50 값 · 어제 값은 없음) · 105곳`, same(sortKeys(shownOf(d)), sortKeys(want)) && d.booths.length === 105, JSON.stringify(shownOf(d)));
}
for (const [hm, want] of DAY2_EXPECT) {
  const d = await callApi(await loadApi(), K('07', hm), DAY2);
  t(`A2 11-07 ${hm} 공개 값 ${Object.keys(want).length}곳(전날 값 · 09:30 전 준비값은 없음)`, same(sortKeys(shownOf(d)), sortKeys(want)), JSON.stringify(shownOf(d)));
}
{
  const d = await callApi(await loadApi(), K('06', '09:45'), DAY1);
  const b = d.booths.find((x) => x.code === '57'), n = d.booths.find((x) => x.code === '61');
  t('A3 09:35 입력 → 09:45: 다시 입력하지 않아도 공개 · 저장 시각 그대로', b.status === '보통' && b.waitMinutes === 20 && b.updatedAt === iso(K('06', '09:35')), JSON.stringify(b));
  t('A4 입력 없는 부스는 값 없음(여유로 만들지 않음)', n.status === null && n.reserve === null && n.waitMinutes === null, JSON.stringify(n));
  t('A5 공식 시간 표시는 10:00 ~ 17:00 그대로 · 화면용 시작은 09:30 · 끝은 그대로', d.event.timeLabel === '10:00 ~ 17:00' && d.event.start === '2026-11-06T00:30:00.000Z' && d.event.end === SETTINGS.event_end, JSON.stringify(d.event));
  const mod = await loadApi();
  const a = await callApi(mod, K('07', '09:29', '59'), DAY2.concat(row('63', '여유', 0, K('07', '09:29', '59'))));
  const c = await callApi(mod, K('07', '09:30', '06'), DAY2.concat(row('63', '보통', 15, K('07', '09:30', '00'))));
  t('A6 같은 인스턴스의 캐시가 09:30 경계를 넘으면 5초 안쪽 받기로 새 값을 공개', Object.keys(shownOf(a)).length === 0 && shownOf(c)['63'] === '보통:15', JSON.stringify([shownOf(a), shownOf(c)]));
  const m2 = await loadApi();
  const x = await callApi(m2, K('06', '09:59', '59'), DAY1), y = await callApi(m2, K('06', '10:00', '01'), DAY1);
  t('A7 10:00 정각을 넘어도 같은 값(사라지지 않음)', same(sortKeys(shownOf(x)), sortKeys(shownOf(y))) && Object.keys(shownOf(y)).length === 5, JSON.stringify(shownOf(y)));
  t('A8 공개 API 는 DB 에 쓰지 않음', writes.length === 0, writes.join(' '));
}

/* ── 화면 ───────────────────────────────────────────────────────── */
const scene = { mod: null, offset: 0, list: DAY1, old: false, snaps: 0, pollMs: 0 };
const git = (f) => execFileSync('git', ['show', `${OLD}:${f}`], { cwd: REPO, maxBuffer: 64 << 20 });
const MAP = { 'visitor.html': 'visitor.html', 'assets/visitor.css': 'assets/visitor.css', 'assets/booth-core.js': 'assets/booth-core.js', 'assets/venue-map.js': 'assets/venue-map.js', 'assets/mock-data.js': 'assets/mock-data.js', 'assets/config.js': 'assets/config.js' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  if (p === 'api/live-snapshot') {
    scene.snaps += 1;
    const body = JSON.stringify(await callApi(scene.mod, Date.now() + scene.offset, scene.list));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); return;
  }
  if (!MAP[p]) { res.writeHead(404); res.end(); return; }
  let out = scene.old && (p === 'visitor.html' || p === 'assets/booth-core.js') ? git(MAP[p]) : readFileSync(join(REPO, MAP[p]));
  if (p === 'assets/config.js') out = out.toString('utf8') + '\nwindow.FESTIVAL_CONFIG.visitorSiteUrl = "./";\n' + (scene.pollMs ? `window.FESTIVAL_CONFIG.pollingIntervalMs = ${scene.pollMs};\n` : '');
  res.writeHead(200, { 'Content-Type': TYPES[extname(MAP[p])] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(out);
});
await new Promise((r) => server.listen(46000 + Math.floor(Math.random() * 900), '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--no-default-browser-check'] });
function pinClock(at) {
  const Real = Date, diff = at - Real.now();
  class Pinned extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + diff); } static now() { return Real.now() + diff; } }
  window.Date = Pinned;
}
async function open(at, list, q = '', opt = {}) {
  scene.mod = await loadApi(); scene.offset = at - Date.now(); scene.list = list; scene.old = !!opt.old; scene.snaps = 0; scene.pollMs = opt.pollMs || 0;
  const ctx = await browser.createBrowserContext(), page = await ctx.newPage(), errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.evaluateOnNewDocument(pinClock, at);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/rest/v1/settings')) { r.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }, body: r.method() === 'OPTIONS' ? '' : JSON.stringify([SETTINGS]) }); return; }
    if (u.startsWith(ORIGIN + '/') || u.startsWith('data:') || /^https:\/\/cdn\.jsdelivr\.net\/gh\/orioncactus\/pretendard/.test(u)) r.continue(); else r.abort();
  });
  await page.goto(ORIGIN + '/visitor.html' + q, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('#list .row') || document.querySelector('.hero__head'), { timeout: 8000 });
  await sleep(180);
  return { ctx, page, errs };
}
const rowText = (page) => page.$$eval('#list .row', (r) => Object.fromEntries(r.map((x) => [x.querySelector('.row__code').textContent, x.querySelector('.row__right').textContent.replace(/\s+/g, '')])));
const hero = (page) => page.evaluate(() => ({ head: (document.querySelector('.hero__head') || {}).textContent || '', free: (document.querySelector('[data-count="여유"] [data-n]') || {}).textContent || '', sync: document.getElementById('sync').textContent, total: (document.getElementById('h-total') || {}).textContent || '' }));

for (const [hm, want, d, list] of [['09:29', 'pre', '06', DAY1], ['09:30', 'live', '06', DAY1], ['09:45', 'live', '06', DAY1], ['09:59', 'live', '06', DAY1], ['10:00', 'live', '06', DAY1], ['10:01', 'live', '06', DAY1], ['17:00', 'closed', '06', DAY1], ['09:29', 'pre', '07', DAY2], ['09:30', 'live', '07', DAY2], ['09:40', 'live', '07', DAY2], ['10:00', 'live', '07', DAY2], ['17:00', 'after', '07', DAY2]]) {
  const at = K(d, hm), { ctx, page, errs } = await open(at, list);
  const r = await rowText(page), h = await hero(page), api = d === '06' ? DAY1_EXPECT : DAY2_EXPECT, exp = (api.find(([x]) => x === hm) || [])[1] || {};
  const filled = Object.entries(r).filter(([, v]) => v && !/정보없음/.test(v)).map(([k]) => k).sort();
  if (want === 'live') {
    t(`V1 11-${d} ${hm} 화면: 공개 값 ${Object.keys(exp).length}곳 = 공개 API · 나머지는 정보 없음 · 105곳 · 자동 갱신 중`, same(filled, Object.keys(exp).sort()) && Object.keys(r).length === 105 && h.total === '105' && h.sync === '자동 갱신 중' && errs.length === 0, JSON.stringify([filled, h, errs]));
  } else {
    const msg = want === 'pre' ? /09:30부터 대기 현황/.test(h.head) : want === 'closed' ? !filled.length : !filled.length;
    t(`V2 11-${d} ${hm} 화면: 값 표시 없음 · ${want === 'pre' ? '09:30 안내' : '종료 규칙'}`, filled.length === 0 && msg && errs.length === 0, JSON.stringify([filled, h, errs]));
  }
  await ctx.close();
}
{
  const { ctx, page, errs } = await open(K('06', '10:06'), DAY1);
  const r = await rowText(page);
  t('V3 현장대기 · 현장예약 · 예약 마감 · 중단 표시', /20분/.test(r['57']) && /보통/.test(r['57']) && /현장예약/.test(r['45']) && /예약마감/.test(r['76']) && /잠시중단/.test(r['5']) && /30분/.test(r['58']), JSON.stringify([r['57'], r['45'], r['76'], r['5'], r['58']]));
  await page.evaluate(() => document.querySelector('[data-sort="wait"]').click()); await sleep(200);
  const first = await page.$eval('#list .row__code', (e) => e.textContent);
  await page.evaluate(() => document.querySelector('[data-view="grid"]').click()); await sleep(200);
  const tile = await page.$$eval('#list .tile', (ts) => { const x = ts.find((e) => e.querySelector('.tile__no').textContent === '57'); return x.className + '|' + x.querySelector('.tile__s').textContent; });
  await page.evaluate(() => document.querySelector('#tabs [data-zone="초등"]').click()); await sleep(200);
  const n = await page.$$eval('#list .tile', (x) => x.length);
  t('V4 대기 짧은 순 · 한눈에 · 학교급 동작', first === '57' && /is-normal/.test(tile) && /20분/.test(tile) && n === 29 && errs.length === 0, JSON.stringify([first, tile, n, errs]));
  await ctx.close();
  const q = await open(K('06', '09:45'), DAY1, `?b=${idOf('57')}`);
  const here = await q.page.$eval('#here', (e) => e.textContent.replace(/\s+/g, ' '));
  t('V5 QR 접속: 지금 계신 부스에 09:35 값 표시', /20\s*분/.test(here) && /보통/.test(here), here.slice(0, 120));
  await q.ctx.close();
}

/* ── 배포 전에 열어 둔 화면 ─────────────────────────────────────── */
for (const hm of ['09:45', '10:00', '10:06']) {
  const { ctx, page, errs } = await open(K('06', hm), DAY1, '', { old: true });
  const r = await rowText(page);
  t(`O1 11-06 ${hm} 옛 화면 코드도 재접속 없이 09:30 이후 값 표시`, /20분/.test(r['57']) && /현장예약/.test(r['45']) && errs.length === 0, JSON.stringify([r['57'], r['45'], errs]));
  await ctx.close();
}

/* ── 운영자 화면 기준 ───────────────────────────────────────────── */
{
  const { ctx, page } = await open(K('06', '10:00'), DAY1);
  const c = await page.evaluate(async (a) => {
    const s = await window.BoothCore.getSettings();
    const info = (ms) => window.BoothCore.eventInfo(s, new Date(ms));
    const i1 = info(a.t0929), i2 = info(a.t0930), i3 = info(a.t1000), i4 = info(a.t1700), i5 = info(a.d2);
    const b = (at) => ({ congestion: '여유', wait_minutes: 0, congestion_updated_at: new Date(at).toISOString() });
    const keep = (i, at) => !!window.BoothCore.applyOpenRule([b(at)], i)[0].congestion;
    return { start: s.event_start, label: s.time_label, ph: [i1.phase, i2.phase, i3.phase, i4.phase], open: i2.openTime, close: i2.closeTime, next: i1.nextOpenLabel, from6: new Date(i3.todayFromAt).toISOString(), from7: new Date(i5.todayFromAt).toISOString(), keep: [keep(i3, a.t0935), keep(i3, a.t0750), keep(i3, a.t0650), keep(i5, a.d2early), keep(i5, a.d2ok)] };
  }, { t0929: K('06', '09:29'), t0930: K('06', '09:30'), t1000: K('06', '10:00'), t1700: K('06', '17:00'), d2: K('07', '10:00'), t0935: K('06', '09:35'), t0750: K('06', '07:50'), t0650: K('06', '06:50'), d2early: K('07', '09:20'), d2ok: K('07', '09:40') });
  t('C1 운영자 설정: 때 판단은 09:30 · 공식 시간 글자는 그대로', c.start === '2026-11-06T00:30:00.000Z' && c.label === '10:00 ~ 17:00' && c.open === '09:30' && c.close === '17:00', JSON.stringify(c));
  t('C2 09:29 준비 · 09:30 공개 · 10:00 공개 · 17:00 마감', same(c.ph, ['preopen', 'open', 'open', 'dayclosed']), JSON.stringify(c.ph));
  t('C3 공개 기준: 11-06 은 07:00 · 11-07 은 09:30', c.from6 === iso(K('06', '07:00')) && c.from7 === iso(K('07', '09:30')), JSON.stringify([c.from6, c.from7]));
  t('C4 applyOpenRule 이 공개 API 와 같은 값만 남김', same(c.keep, [true, true, false, false, true]), JSON.stringify(c.keep));
  await ctx.close();
}

/* ── 기존 자동 갱신으로 경계 넘기 ───────────────────────────────── */
{
  const list = DAY2.concat(row('63', '보통', 15, K('07', '09:30', '02')));
  const { ctx, page, errs } = await open(K('07', '09:29', '52'), list, '', { pollMs: 15000 });
  const before = await rowText(page), s0 = scene.snaps;
  const end = Date.now() + 26000;
  let got = false;
  while (Date.now() < end && !got) { await sleep(500); got = await page.evaluate(() => [...document.querySelectorAll('#list .row')].some((x) => x.querySelector('.row__code').textContent === '63' && /15/.test(x.querySelector('.row__right').textContent))); }
  t('R1 열어 둔 화면이 기존 자동 갱신으로 09:30 뒤 값을 받음 · 요청 폭증 없음', !Object.values(before).some((v) => /분/.test(v)) && got && scene.snaps - s0 <= 3 && errs.length === 0, JSON.stringify([got, scene.snaps - s0, errs]));
  await ctx.close();
}

await browser.close();
server.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} / ${results.length} 통과`);
process.exit(bad.length ? 1 : 0);
