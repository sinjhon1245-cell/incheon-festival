/* ===================================================================
   관람객 화면 학교급 탭 시험 — 실제 Chrome 에서 탭 자리 · 거르기 · 구역 제목 · 정렬 · 검색을 봅니다
   ───────────────────────────────────────────────────────────────────
   서버 · Production 에 닿지 않습니다. 이 파일의 작은 웹 서버가 저장소(또는 --base 커밋)의 파일과
   /api/live-snapshot 자리에 만든 예시 스냅샷(부스 84곳: 초등 29 · 중등 25 · 고등 29 · 특수 1)을 줍니다.

     T  탭      전체 · 초등 · 중등·특수 · 고등 네 칸과 곳 수 · 옆으로 밀지 않고 검색 단추까지 한 화면 · 한 줄 · 글자 · 밑줄
     F  거르기  목록 · 한눈에 곳 수(84 · 29 · 26 · 29) · 구역 제목 · 중등 25 아래 특수 1 · 전체는 초등 → 중등 → 특수 → 고등
     S  정렬    번호순 · 대기 짧은 순 · 상태 고름에서 중등·특수 탭의 구역 제목 · 구역 안 순서 · 전체 탭의 기존 동작
     Q  검색    구역을 가리지 않는 기존 동작 · 특수 부스 찾기(--snapshot 때는 건너뜀)
     D  자료    특수 부스는 특수 구역 그대로 · 번호 그대로 · 상단 집계는 탭과 상관없이 그대로
   폭: 320 · 360 · 375 · 390 · 414 · 768 · 1024 · 1440

   쓰는 법: node scripts/booth-live-mode/test-visitor-tabs.mjs --deps <puppeteer-core 가 설치된 폴더>
              [--chrome <chrome.exe>] [--base <커밋>] [--shots <폴더>] [--snapshot <스냅샷 JSON 파일>]
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
const SNAP_FILE = arg('snapshot', '');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const results = [];
function t(name, ok, note = '') { results.push({ name, ok: !!ok, note }); console.log(`${ok ? '통과' : '실패'}  ${name}${!ok && note ? '  — ' + note : ''}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 예시 스냅샷: 실제 표와 같은 구역 순서(초등 · 중등 · 고등 · 특수), 번호도 구역마다 섞이지 않게 ─── */
function fixture() {
  const now = new Date();
  const zoneOf = (n) => (n <= 29 ? '고등' : n === 48 ? '특수' : n <= 55 ? '중등' : '초등');
  const states = [['여유', 5], ['보통', 15], ['혼잡', 30], ['여유', 10], ['보통', 20], ['혼잡', 45], ['중단', 0]];
  const booths = Array.from({ length: 84 }, (_, i) => {
    const no = i + 1, [status, waitMinutes] = states[no % states.length];
    return { id: `b${no}`, no, code: String(no), zone: zoneOf(no), name: `시험 부스 ${no}`, org: zoneOf(no) === '특수' ? '시험특수학교' : `시험${zoneOf(no)}학교`, program: '',
      opMode: 'wait', status, reserve: null, waitMinutes, updatedAt: now.toISOString() };
  });
  return { version: 1, generatedAt: now.toISOString(), mode: 'normal', liveReady: true,
    event: { title: '시험 행사', venue: '시험 장소', dateLabel: '시험 날짜', timeLabel: '10:00 ~ 17:00', start: new Date(now.getTime() + 3 * 864e5).toISOString(), end: new Date(now.getTime() + 4 * 864e5).toISOString(), mapUrl: '' },
    zones: [{ key: '초등', label: '초등', order: 1 }, { key: '중등', label: '중등', order: 2 }, { key: '고등', label: '고등', order: 3 }, { key: '특수', label: '특수', order: 4 }],
    booths, unplaced: [] };
}
const SNAP = SNAP_FILE ? readFileSync(SNAP_FILE, 'utf8') : JSON.stringify(fixture());
const data = JSON.parse(SNAP);
const nZone = (k) => data.booths.filter((b) => b.zone === k).length;
const N = { all: data.booths.length, e: nZone('초등'), m: nZone('중등'), h: nZone('고등'), s: nZone('특수') };

/* ── 파일 · 서버 ─────────────────────────────────────────────────── */
const MAP = { 'visitor.html': 'visitor.html', 'assets/visitor.css': 'assets/visitor.css', 'assets/booth-core.js': 'assets/booth-core.js', 'assets/mock-data.js': 'assets/mock-data.js', 'assets/config.js': 'assets/config.js' };
let ROOT = REPO, TMP = null;
if (BASE) {
  TMP = mkdtempSync(join(tmpdir(), 'tabs-base-'));
  for (const f of Object.values(MAP)) {
    mkdirSync(dirname(join(TMP, f)), { recursive: true });
    writeFileSync(join(TMP, f), execFileSync('git', ['show', `${BASE}:${f}`], { cwd: REPO, maxBuffer: 64 << 20 }));
  }
  ROOT = TMP;
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  if (p === 'api/live-snapshot') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(SNAP); return; }
  if (!MAP[p]) { res.writeHead(404); res.end(); return; }
  let out = readFileSync(join(ROOT, MAP[p]));
  if (p === 'assets/config.js') out = out.toString('utf8') + '\nwindow.FESTIVAL_CONFIG.visitorSiteUrl = "./";\n';
  res.writeHead(200, { 'Content-Type': TYPES[extname(MAP[p])] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(out);
});
await new Promise((r) => server.listen(47000 + Math.floor(Math.random() * 1000), '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--no-default-browser-check'] });

async function open(W) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: W, height: 844, deviceScaleFactor: 2, isMobile: W < 768, hasTouch: W < 768 });
  await page.setRequestInterception(true);
  page.on('request', (req) => { const u = req.url(); if (u.startsWith(ORIGIN + '/') || u.startsWith('data:') || /^https:\/\/cdn\.jsdelivr\.net\/gh\/orioncactus\/pretendard/.test(u)) req.continue(); else req.abort(); });
  await page.goto(ORIGIN + '/visitor.html', { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForSelector('#tabs .tab');
  await page.waitForSelector('#list .row');
  return { ctx, page };
}
const click = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
const tabSel = (word) => `[data-zone="${word}"]`;
const heads = (page) => page.$$eval('#list .zone', (h) => h.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
const listNos = (page) => page.$$eval('#list .row__code', (r) => r.map((x) => x.textContent));
const groupNos = (page) => page.$$eval('#list .group', (g) => g.map((x) => [...x.querySelectorAll('.row__code, .tile__no')].map((c) => c.textContent)));
const rowCount = (page) => page.$$eval('#list .row, #list .tile', (r) => r.length);
const heroNums = (page) => page.$$eval('[data-count] [data-n]', (n) => n.map((x) => x.textContent).join(','));
const asc = (a) => a.every((x, i) => i === 0 || Number(a[i - 1]) < Number(x));

/* ── T : 탭 줄, 폭마다 ───────────────────────────────────────────── */
for (const W of [320, 360, 375, 390, 414, 768, 1024, 1440]) {
  const { ctx, page } = await open(W);
  const m = await page.evaluate(() => {
    const R = (el) => el.getBoundingClientRect();
    const tabsBox = document.getElementById('tabs'), icon = R(document.getElementById('search-open'));
    const tabs = [...tabsBox.querySelectorAll('.tab')].map((b) => { const r = R(b), s = getComputedStyle(b); const rg = document.createRange(); rg.selectNodeContents(b); return { t: b.textContent.replace(/\s+/g, ' ').trim(), l: r.left, r: r.right, fs: parseFloat(s.fontSize), lines: new Set([...rg.getClientRects()].map((x) => Math.round(x.bottom))).size }; });
    return { tabs, icon: { l: icon.left, r: icon.right }, scroll: tabsBox.scrollWidth - tabsBox.clientWidth, more: tabsBox.classList.contains('is-more'), vw: document.documentElement.clientWidth, ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  const text = m.tabs.map((x) => x.t.replace(/\s/g, ' ')).join(' | ');
  t(`T1 ${W}px 탭 네 칸: 전체 ${N.all} · 초등 ${N.e} · 중등·특수 ${N.m + N.s} · 고등 ${N.h}`, text === `전체${N.all} | 초등${N.e} | 중등·특수${N.m + N.s} | 고등${N.h}`, text);
  t(`T2 ${W}px 옆으로 밀지 않고 네 칸 · 검색 단추가 한 화면에`, m.scroll <= 0 && !m.more && m.tabs.every((x) => x.l >= 0 && x.r <= m.icon.l + 0.5) && m.icon.r <= m.vw + 0.5 && m.ovf <= 0, JSON.stringify({ scroll: m.scroll, more: m.more, last: m.tabs[m.tabs.length - 1], icon: m.icon, vw: m.vw }));
  t(`T3 ${W}px 탭 낱말 한 줄 · 글자 15px 그대로`, m.tabs.every((x) => x.fs === 15) && m.tabs[2] && m.tabs[2].t.startsWith('중등·특수'), JSON.stringify(m.tabs));
  if (SHOTS && W <= 414) await (await page.$('#bar')).screenshot({ path: join(SHOTS, `tabs-${W}.png`) });
  await ctx.close();
}

/* ── 선택 밑줄 · 거르기 · 구역 제목(390) ─────────────────────────── */
{
  const { ctx, page } = await open(390);
  const hero0 = await heroNums(page);
  t(`F1 전체: 목록 ${N.all}곳 · 구역 초등 → 중등 → 특수 → 고등`, (await rowCount(page)) === N.all && JSON.stringify(await heads(page)) === JSON.stringify([`초등${N.e}곳`, `중등${N.m}곳`, `특수${N.s}곳`, `고등${N.h}곳`]), JSON.stringify(await heads(page)));
  await click(page, tabSel('초등')); await sleep(80);
  t(`F2 초등: ${N.e}곳`, (await rowCount(page)) === N.e && JSON.stringify(await heads(page)) === JSON.stringify([`초등${N.e}곳`]), JSON.stringify(await heads(page)));
  await click(page, tabSel('고등')); await sleep(80);
  t(`F3 고등: ${N.h}곳`, (await rowCount(page)) === N.h && JSON.stringify(await heads(page)) === JSON.stringify([`고등${N.h}곳`]), JSON.stringify(await heads(page)));
  await click(page, tabSel('중등')); await sleep(80);
  const under = await page.evaluate(() => { const b = document.querySelector('[data-zone="중등"]'), s = getComputedStyle(b), a = getComputedStyle(b, '::after'); return { pressed: b.getAttribute('aria-pressed'), color: s.color, bar: a.backgroundColor, h: a.height }; });
  t('F4 중등·특수 선택: 눌림 · 기존 밑줄(2px 남색) · 글자 남색', under.pressed === 'true' && under.h === '2px' && under.bar === 'rgb(22, 32, 60)' && under.color === 'rgb(22, 32, 60)', JSON.stringify(under));
  t(`F5 중등·특수: ${N.m + N.s}곳 = 중등 ${N.m} + 특수 ${N.s}, 구역 제목 둘(중등이 먼저)`, (await rowCount(page)) === N.m + N.s && JSON.stringify(await heads(page)) === JSON.stringify([`중등${N.m}곳`, `특수${N.s}곳`]), JSON.stringify(await heads(page)));
  const g = await groupNos(page);
  const spec = data.booths.filter((b) => b.zone === '특수').map((b) => String(b.code));
  t('F6 특수 구역은 마지막 중등 부스 바로 아래 · 특수 부스 번호 그대로', g.length === 2 && g[0].length === N.m && JSON.stringify(g[1]) === JSON.stringify(spec) && asc(g[0]), JSON.stringify(g));
  const pos = await page.evaluate(() => { const gs = [...document.querySelectorAll('#list .group')]; if (gs.length < 2) return { lastBottom: 1, headTop: 0 }; const last = gs[0].querySelector('.row:last-child').getBoundingClientRect(), h = gs[1].querySelector('.zone').getBoundingClientRect(); return { lastBottom: last.bottom, headTop: h.top }; });
  t('F7 특수 제목이 마지막 중등 줄 아래에 옴', pos.headTop >= pos.lastBottom, JSON.stringify(pos));
  t('D1 상단 다섯 집계는 탭을 바꿔도 그대로', (await heroNums(page)) === hero0, `${hero0} → ${await heroNums(page)}`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'list-middle-390.png') });
  if (SHOTS) {
    const sec = (await page.$$('#list .group'))[1];
    if (sec) await sec.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await sleep(120);
    await page.screenshot({ path: join(SHOTS, 'list-special-390.png') });
  }

  // 대기 짧은 순
  await click(page, '[data-sort="wait"]'); await sleep(100);
  const waitOf = Object.fromEntries(data.booths.map((b) => [String(b.code), b.status === '중단' ? 1e6 : b.waitMinutes]));
  const gw = await groupNos(page);
  const nondec = (a) => a.every((x, i) => i === 0 || waitOf[a[i - 1]] <= waitOf[x]);
  t('S1 중등·특수 + 대기 짧은 순: 구역 제목 유지(중등 → 특수) · 구역 안은 대기 짧은 순', JSON.stringify(await heads(page)) === JSON.stringify([`중등${N.m}곳`, `특수${N.s}곳`]) && !!gw[0] && gw[0].length === N.m && nondec(gw[0]), JSON.stringify([await heads(page), (gw[0] || []).slice(0, 6)]));
  await click(page, tabSel('')); await sleep(100);
  t('S2 전체 + 대기 짧은 순: 기존대로 구역 제목 없이 한 목록', (await heads(page)).length === 0 && (await rowCount(page)) === N.all && (!!SNAP_FILE || nondec(await listNos(page))), JSON.stringify((await heads(page))));
  await click(page, tabSel('초등')); await sleep(100);
  t('S3 초등 + 대기 짧은 순: 기존대로 구역 제목 없음', (await heads(page)).length === 0 && (await rowCount(page)) === N.e, JSON.stringify(await heads(page)));
  await click(page, '[data-sort="code"]'); await sleep(100);

  // 상태 고름
  await click(page, tabSel('중등')); await sleep(80);
  await click(page, '[data-count="off"]'); await sleep(120);
  const off = data.booths.filter((b) => (b.zone === '중등' || b.zone === '특수') && b.status === '중단');
  const offHeads = [...new Set(off.map((b) => b.zone))];
  const offWant = ['중등', '특수'].filter((z) => offHeads.includes(z)).map((z) => `${z}${off.filter((b) => b.zone === z).length}곳`);
  t('S4 중등·특수 + 상태 고름: 그 안에서만 거르고 구역 제목 유지', (await rowCount(page)) === off.length && JSON.stringify(await heads(page)) === JSON.stringify(offWant), JSON.stringify([await rowCount(page), off.length, await heads(page)]));
  const res = await page.$eval('#result, .result', (x) => x.textContent).catch(() => '');
  t('S5 결과 줄이 탭 이름을 함께 알림', /중등·특수/.test(res), res);
  await click(page, '[data-count="off"]'); await sleep(100);

  // 검색
  await click(page, tabSel('')); await sleep(60);
  await click(page, '#search-open'); await sleep(80);
  const type = async (q) => { await page.evaluate((v) => { const i = document.getElementById('q'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }, q); await sleep(260); };
  // --snapshot 은 실제 이름으로 화면을 찍는 용도라, 예시 자료에 묶인 검색어 검사는 예시 자료에서만 봅니다
  if (!SNAP_FILE) {
  await type('시험특수학교');
  t('Q1 검색: 특수 부스 찾음(구역 제목 없는 기존 결과 목록)', (await rowCount(page)) === N.s && (await heads(page)).length === 0, JSON.stringify([await rowCount(page), await heads(page)]));
  await type('시험 부스 1');
  const qn = await rowCount(page);
  t('Q2 검색: 구역을 가리지 않음 · 이름으로 여러 구역에서 찾음', qn > 1 && (await heads(page)).length === 0, String(qn));
  }
  await click(page, '#search-cancel'); await sleep(120);
  t('Q3 검색 닫으면 전체로', (await rowCount(page)) === N.all, String(await rowCount(page)));

  // 한눈에
  await click(page, '[data-view="grid"]'); await sleep(120);
  t(`G1 한눈에: 전체 ${N.all}칸 · 구역 초등 → 중등 → 특수 → 고등`, (await rowCount(page)) === N.all && JSON.stringify(await heads(page)) === JSON.stringify([`초등${N.e}곳`, `중등${N.m}곳`, `특수${N.s}곳`, `고등${N.h}곳`]), JSON.stringify(await heads(page)));
  await click(page, tabSel('중등')); await sleep(120);
  t(`G2 한눈에 중등·특수: ${N.m + N.s}칸 · 구역 제목 둘(중등 위, 특수 아래)`, (await rowCount(page)) === N.m + N.s && JSON.stringify(await heads(page)) === JSON.stringify([`중등${N.m}곳`, `특수${N.s}곳`]), JSON.stringify(await heads(page)));
  await click(page, '[data-sort="wait"]').catch(() => {}); await sleep(100);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'grid-middle-390.png') });
  await ctx.close();
}

await browser.close();
server.close();
if (TMP) rmSync(TMP, { recursive: true, force: true });
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} / ${results.length} 통과${BASE ? `  (기준 ${BASE})` : ''}`);
process.exit(bad.length ? 1 : 0);
