/* ===================================================================
   관람객 화면 학교급 · 구역 탭 시험 — 실제 Chrome 에서 탭 자리 · 거르기 · 구역 제목 · 정렬 · 검색을 봅니다
   ───────────────────────────────────────────────────────────────────
   서버 · Production 에 닿지 않습니다. 이 파일의 작은 웹 서버가 저장소(또는 --base 커밋)의 파일과
   /api/live-snapshot 자리에 만든 예시 스냅샷을 줍니다. 두 가지 자료로 돌립니다.
     미래채움존 공개 뒤  93곳: 초등 29 · 중등 25 · 특수 1 · 고등 29 · 미래채움존 9
     미래채움존 공개 전  84곳: 같은 코드로 탭 네 칸 · 전체 84(숫자를 고정하지 않음)

     T  탭      PC 전체 · 초등 · 중등·특수 · 고등 · 미래채움, 휴대폰 전체 · 초 · 중·특 · 고 · 미래 · 곳 수 ·
                옆으로 밀지 않고 한 화면 · 잘림 없음 · 글자 15px · 탭 줄 돋보기 없음
     F  거르기  목록 · 한눈에 곳 수 · 구역 제목 · 중등 25 아래 특수 1 · 별도 특수 탭 없음 · 전체 구역 순서 ·
                미래채움 탭(미래1 ~ 미래9 순서 · 이름 · 기관 · 상태)
     S  정렬    번호순 · 대기 짧은 순 · 상태 고름에서 중등·특수 탭의 구역 제목 · 구역 안 순서 · 다른 탭의 기존 동작
     Q  검색    위쪽 검색칸으로 열기 · 구역을 가리지 않는 기존 동작 · 번호(미래3)로 찾기
     D  자료    상단 집계 합 = 전체 · 현장예약 · 정보 없음 · 집계는 탭과 상관없이 그대로
     G  한눈에  곳 수 · 구역 제목 · 번호(미래1)가 칸 안에
     H  지금 계신 부스  QR 주소(?b=)에서 미래5 · 같은 구역 여유 부스 번호가 칸 안에(행사 중)
   폭: 320 · 360 · 375 · 390 · 414 · 768 · 1024 · 1440

   쓰는 법: node scripts/booth-live-mode/test-visitor-tabs.mjs --deps <puppeteer-core 가 설치된 폴더>
              [--chrome <chrome.exe>] [--base <커밋>] [--shots <폴더>] [--snapshot <스냅샷 JSON 파일>]
   --snapshot 은 실제 이름으로 화면을 찍는 용도입니다(미래채움존 9곳을 더해 보여 주고, 자료에 묶인 검사는 건너뜀).
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
const squeeze = (s) => String(s).replace(/\s+/g, '');

/* ── 예시 스냅샷 ─────────────────────────────────────────────────── */
const FUTURE = [['AI 로봇 플레이존', '에듀플라이플라이교육협동조합'], ['채울샘 SW체험존', '채울샘 협동조합'], ['상상ON! 자율주행 드라이빙 스쿨', '허니소프트협동조합'],
  ['재미를 잇다, 상상을 잇다! (잇다풋볼 & 잇다오락실)', '잇다에듀 협동조합'], ['touch. play. ai', '코딩랩스 협동조합'], ['AI 상상 공작소', '누구나코딩교육협동조합'],
  ['인천 바다 아케이드 대 탐험', '미래채움교육협동조합'], ['아이온과 함께 하는 로봇 배틀 아레나', '그린플래그 교육협동조합'], ['AIㆍSW와 만나는 미래 융합 탐험대', '비트상상협동조합']];
const FUTURE_ZONE = { key: '미래', label: '미래채움존', order: 5 };
function futureBooths(now) {
  const st = [['reserve', null, 'open', null], ['wait', '여유', null, 5], ['wait', null, null, null], ['wait', '보통', null, 15], ['wait', '혼잡', null, 30], ['reserve', null, 'closed', null], ['wait', '중단', null, 0], ['wait', '마감', null, 0], ['wait', '여유', null, 10]];
  return FUTURE.map(([name, org], i) => { const [opMode, status, reserve, waitMinutes] = st[i]; return { id: `f${i + 1}`, no: i + 1, code: `미래${i + 1}`, zone: '미래', name, org, program: '', opMode, status, reserve, waitMinutes, updatedAt: status || reserve ? now : null }; });
}
function fixture(withFuture) {
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
    zones: [{ key: '초등', label: '초등', order: 1 }, { key: '중등', label: '중등', order: 2 }, { key: '고등', label: '고등', order: 3 }, { key: '특수', label: '특수', order: 4 }, ...(withFuture ? [FUTURE_ZONE] : [])],
    booths: withFuture ? [...booths, ...futureBooths(now.toISOString())] : booths, unplaced: [] };
}
function snapshotFile() {
  const d = JSON.parse(readFileSync(SNAP_FILE, 'utf8'));
  d.zones = [...d.zones.filter((z) => z.key !== '미래'), FUTURE_ZONE];
  d.booths = [...d.booths.filter((b) => b.zone !== '미래'), ...futureBooths(new Date().toISOString())];
  return d;
}
let data = SNAP_FILE ? snapshotFile() : fixture(true);
const nZone = (k) => data.booths.filter((b) => b.zone === k).length;
const counts = () => ({ all: data.booths.length, e: nZone('초등'), m: nZone('중등'), h: nZone('고등'), s: nZone('특수'), f: nZone('미래') });

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
  if (p === 'api/live-snapshot') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); return; }
  if (!MAP[p]) { res.writeHead(404); res.end(); return; }
  let out = readFileSync(join(ROOT, MAP[p]));
  if (p === 'assets/config.js') out = out.toString('utf8') + '\nwindow.FESTIVAL_CONFIG.visitorSiteUrl = "./";\n';
  res.writeHead(200, { 'Content-Type': TYPES[extname(MAP[p])] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(out);
});
await new Promise((r) => server.listen(47000 + Math.floor(Math.random() * 1000), '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--no-default-browser-check'] });

async function open(W, q = '') {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: W, height: 844, deviceScaleFactor: 2, isMobile: W < 768, hasTouch: W < 768 });
  await page.setRequestInterception(true);
  page.on('request', (req) => { const u = req.url(); if (u.startsWith(ORIGIN + '/') || u.startsWith('data:') || /^https:\/\/cdn\.jsdelivr\.net\/gh\/orioncactus\/pretendard/.test(u)) req.continue(); else req.abort(); });
  await page.goto(ORIGIN + '/visitor.html' + q, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForSelector('#tabs .tab');
  await page.waitForSelector('#list .row');
  await sleep(150);
  return { ctx, page };
}
const click = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
const tabSel = (key) => `#tabs [data-zone="${key}"]`;
const heads = (page) => page.$$eval('#list .zone', (h) => h.map((x) => x.textContent.replace(/\s+/g, '')));
const listNos = (page) => page.$$eval('#list .row__code', (r) => r.map((x) => x.textContent));
const groupNos = (page) => page.$$eval('#list .group', (g) => g.map((x) => [...x.querySelectorAll('.row__code, .tile__no')].map((c) => c.textContent)));
const rowCount = (page) => page.$$eval('#list .row, #list .tile', (r) => r.length);
const heroNums = (page) => page.$$eval('[data-count] [data-n]', (n) => n.map((x) => Number(x.textContent)));
const asc = (a) => a.every((x, i) => i === 0 || Number(a[i - 1]) < Number(x));
const H = (z, n) => `${z}${n}곳`;

/* ── T : 탭 줄, 폭마다 ───────────────────────────────────────────── */
async function tabsAt(W, N) {
  const { ctx, page } = await open(W);
  const m = await page.evaluate(() => {
    const R = (el) => el.getBoundingClientRect();
    const box = document.getElementById('tabs');
    const tabs = [...box.querySelectorAll('.tab')].map((b) => { const r = R(b), s = getComputedStyle(b), n = b.querySelector('.tab__n'); return { t: b.innerText.replace(/\s+/g, ''), l: r.left, r: r.right, fs: parseFloat(s.fontSize), nfs: parseFloat(getComputedStyle(n).fontSize), h: r.height, top: Math.round(R(b.querySelector('.tab__t')).top), ntop: Math.round(R(n).top) }; });
    return { tabs, icon: !!document.getElementById('search-open'), field: !document.getElementById('search-field').hidden, scroll: box.scrollWidth - box.clientWidth, more: box.classList.contains('is-more'), vw: document.documentElement.clientWidth, ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  const mobile = W < 768;
  const name = (wide, short) => (mobile ? short : wide);
  const want = [`전체${N.all}`, `${name('초등', '초')}${N.e}`, `${name('중등·특수', '중·특')}${N.m + N.s}`, `${name('고등', '고')}${N.h}`, ...(N.f ? [`${name('미래채움', '미래')}${N.f}`] : [])];
  t(`T1 ${W}px${N.f ? '' : ' (공개 전)'} 탭 ${want.join(' | ')}`, JSON.stringify(m.tabs.map((x) => x.t)) === JSON.stringify(want), JSON.stringify(m.tabs.map((x) => x.t)));
  t(`T2 ${W}px${N.f ? '' : ' (공개 전)'} 옆으로 밀지 않고 모두 한 화면 · 끝 흐림 없음 · 잘림 없음`, m.scroll <= 0 && !m.more && m.tabs.every((x) => x.l >= 0 && x.r <= m.vw + 0.5) && m.ovf <= 0, JSON.stringify({ scroll: m.scroll, more: m.more, last: m.tabs[m.tabs.length - 1], vw: m.vw }));
  t(`T3 ${W}px 글자 15px · 숫자 13px 그대로`, m.tabs.every((x) => x.fs === 15 && x.nfs === 13), JSON.stringify(m.tabs.map((x) => [x.fs, x.nfs])));
  t(`T4 ${W}px 탭 줄 돋보기 없음 · 위쪽 검색칸은 있음`, !m.icon && m.field, JSON.stringify({ icon: m.icon, field: m.field }));
  if (SHOTS && N.f) {
    await (await page.$('#bar')).screenshot({ path: join(SHOTS, `tabs-${W}.png`) });
    if (W === 320 || W === 390) await page.screenshot({ path: join(SHOTS, `top-${W}.png`) });
  }
  await ctx.close();
}
const N = counts();
for (const W of [320, 360, 375, 390, 414, 768, 1024, 1440]) await tabsAt(W, N);

/* ── 거르기 · 구역 제목(390) ─────────────────────────────────────── */
{
  const { ctx, page } = await open(390);
  const hero0 = await heroNums(page);
  const unknown = data.booths.filter((b) => !b.status && !b.reserve).length;
  const sum = hero0.reduce((a, b) => a + b, 0);
  const total = await page.$eval('#h-total', (x) => Number(x.textContent));
  const sub = await page.$eval('#h-sub', (x) => x.textContent);
  t(`D1 상단 집계 합 ${sum} + 정보 없음 ${unknown} = 전체 ${N.all} · 기준 문구 일치`, sum + unknown === N.all && total === N.all && sub === `현재 운영 상태가 입력된 ${sum}곳 기준`, JSON.stringify({ hero0, total, sub }));
  if (!SNAP_FILE) t('D2 미래채움존도 같은 규칙으로 집계(현장예약 1 · 중단·마감에 예약 마감 포함)', JSON.stringify(hero0.slice(3)) === JSON.stringify([1, data.booths.filter((b) => b.status === '중단' || b.status === '마감' || b.reserve === 'closed').length]), JSON.stringify(hero0));

  const allHeads = [H('초등', N.e), H('중등', N.m), H('특수', N.s), H('고등', N.h), H('미래채움존', N.f)];
  t(`F1 전체: 목록 ${N.all}곳 · 구역 초등 → 중등 → 특수 → 고등 → 미래채움존`, (await rowCount(page)) === N.all && JSON.stringify(await heads(page)) === JSON.stringify(allHeads), JSON.stringify(await heads(page)));
  t('F2 별도 특수 탭 없음', !(await page.$(tabSel('특수'))));
  await click(page, tabSel('초등')); await sleep(80);
  t(`F3 초등: ${N.e}곳`, (await rowCount(page)) === N.e && JSON.stringify(await heads(page)) === JSON.stringify([H('초등', N.e)]), JSON.stringify(await heads(page)));
  await click(page, tabSel('고등')); await sleep(80);
  t(`F4 고등: ${N.h}곳`, (await rowCount(page)) === N.h && JSON.stringify(await heads(page)) === JSON.stringify([H('고등', N.h)]), JSON.stringify(await heads(page)));
  await click(page, tabSel('미래')); await sleep(80);
  t(`F5 미래채움: ${N.f}곳 · 미래1 ~ 미래9 순서`, (await rowCount(page)) === N.f && JSON.stringify(await listNos(page)) === JSON.stringify(FUTURE.map((_, i) => `미래${i + 1}`)), JSON.stringify(await listNos(page)));
  const fut = await page.$$eval('#list .row', (r) => r.map((x) => ({ name: x.querySelector('.row__name').textContent, org: x.querySelector('.row__org').textContent, right: x.querySelector('.row__right').textContent.replace(/\s+/g, ''), box: (() => { const c = x.querySelector('.row__code'); return c.scrollWidth <= c.clientWidth + 0.5; })() })));
  t('F6 미래채움: 부스명 · 운영 기관 · 상태 표시 · 번호 잘림 없음', fut.every((x, i) => x.name === FUTURE[i][0] && x.org === FUTURE[i][1] && x.right.length > 0 && x.box), JSON.stringify(fut.slice(0, 3)));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'list-future-390.png') });
  await click(page, tabSel('중등')); await sleep(80);
  const under = await page.evaluate(() => { const b = document.querySelector('#tabs [data-zone="중등"]'), s = getComputedStyle(b), a = getComputedStyle(b, '::after'); return { pressed: b.getAttribute('aria-pressed'), color: s.color, bar: a.backgroundColor, h: a.height }; });
  t('F7 중등·특수 선택: 눌림 · 기존 밑줄(2px 남색) · 글자 남색', under.pressed === 'true' && under.h === '2px' && under.bar === 'rgb(22, 32, 60)' && under.color === 'rgb(22, 32, 60)', JSON.stringify(under));
  t(`F8 중등·특수: ${N.m + N.s}곳 = 중등 ${N.m} + 특수 ${N.s}, 구역 제목 둘(중등이 먼저)`, (await rowCount(page)) === N.m + N.s && JSON.stringify(await heads(page)) === JSON.stringify([H('중등', N.m), H('특수', N.s)]), JSON.stringify(await heads(page)));
  const g = await groupNos(page);
  const spec = data.booths.filter((b) => b.zone === '특수').map((b) => String(b.code));
  t('F9 특수 구역은 마지막 중등 부스 바로 아래 · 특수 부스 번호 그대로', g.length === 2 && g[0].length === N.m && JSON.stringify(g[1]) === JSON.stringify(spec) && asc(g[0]), JSON.stringify(g));
  const pos = await page.evaluate(() => { const gs = [...document.querySelectorAll('#list .group')]; if (gs.length < 2) return { lastBottom: 1, headTop: 0 }; const last = gs[0].querySelector('.row:last-child').getBoundingClientRect(), h = gs[1].querySelector('.zone').getBoundingClientRect(); return { lastBottom: last.bottom, headTop: h.top }; });
  t('F10 특수 제목이 마지막 중등 줄 아래에 옴', pos.headTop >= pos.lastBottom, JSON.stringify(pos));
  t('D3 상단 집계는 탭을 바꿔도 그대로', JSON.stringify(await heroNums(page)) === JSON.stringify(hero0), JSON.stringify(await heroNums(page)));
  if (SHOTS) {
    await page.screenshot({ path: join(SHOTS, 'list-middle-390.png') });
    const sec = (await page.$$('#list .group'))[1];
    if (sec) await sec.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await sleep(120);
    await page.screenshot({ path: join(SHOTS, 'list-special-390.png') });
  }

  // 대기 짧은 순
  await click(page, '[data-sort="wait"]'); await sleep(100);
  const waitOf = Object.fromEntries(data.booths.map((b) => [String(b.code), b.status === '중단' ? 1e6 : b.waitMinutes ?? 2e6]));
  const gw = await groupNos(page);
  const nondec = (a) => a.every((x, i) => i === 0 || waitOf[a[i - 1]] <= waitOf[x]);
  t('S1 중등·특수 + 대기 짧은 순: 구역 제목 유지(중등 → 특수) · 구역 안은 대기 짧은 순', JSON.stringify(await heads(page)) === JSON.stringify([H('중등', N.m), H('특수', N.s)]) && !!gw[0] && gw[0].length === N.m && (!!SNAP_FILE || nondec(gw[0])), JSON.stringify([await heads(page), (gw[0] || []).slice(0, 6)]));
  await click(page, tabSel('')); await sleep(100);
  t('S2 전체 + 대기 짧은 순: 기존대로 구역 제목 없이 한 목록', (await heads(page)).length === 0 && (await rowCount(page)) === N.all, JSON.stringify(await heads(page)));
  await click(page, tabSel('초등')); await sleep(100);
  t('S3 초등 + 대기 짧은 순: 기존대로 구역 제목 없음', (await heads(page)).length === 0 && (await rowCount(page)) === N.e, JSON.stringify(await heads(page)));
  await click(page, '[data-sort="code"]'); await sleep(100);

  // 상태 고름
  await click(page, tabSel('중등')); await sleep(80);
  await click(page, '[data-count="off"]'); await sleep(120);
  const inTab = (b) => b.zone === '중등' || b.zone === '특수';
  const off = data.booths.filter((b) => inTab(b) && (b.status === '중단' || b.status === '마감' || b.reserve === 'closed'));
  const offWant = ['중등', '특수'].filter((z) => off.some((b) => b.zone === z)).map((z) => H(z, off.filter((b) => b.zone === z).length));
  t('S4 중등·특수 + 상태 고름: 그 안에서만 거르고 구역 제목 유지', (await rowCount(page)) === off.length && JSON.stringify(await heads(page)) === JSON.stringify(offWant), JSON.stringify([await rowCount(page), off.length, await heads(page)]));
  const res = await page.$eval('#result, .result', (x) => x.textContent).catch(() => '');
  t('S5 결과 줄이 탭 이름을 함께 알림', /중등·특수/.test(res), res);
  await click(page, '[data-count="off"]'); await sleep(100);

  // 검색(위쪽 검색칸)
  await click(page, tabSel('')); await sleep(60);
  await click(page, '#search-field'); await sleep(100);
  const opened = await page.evaluate(() => !document.getElementById('search').hidden && document.getElementById('bar-tabs').hidden);
  t('Q1 위쪽 검색칸을 누르면 검색이 열림', opened);
  const type = async (v) => { await page.evaluate((x) => { const i = document.getElementById('q'); i.value = x; i.dispatchEvent(new Event('input', { bubbles: true })); }, v); await sleep(260); };
  await type('미래3');
  t('Q2 번호로 찾기: 미래3', JSON.stringify(await listNos(page)) === JSON.stringify(['미래3']) && (await heads(page)).length === 0, JSON.stringify(await listNos(page)));
  await type('잇다에듀');
  t('Q3 운영 기관으로 찾기: 잇다에듀', JSON.stringify(await listNos(page)) === JSON.stringify(['미래4']), JSON.stringify(await listNos(page)));
  if (!SNAP_FILE) {
    await type('시험특수학교');
    t('Q4 특수 부스 찾기', (await rowCount(page)) === N.s, String(await rowCount(page)));
    await type('시험 부스 1');
    t('Q5 구역을 가리지 않고 찾음', (await rowCount(page)) > 1 && (await heads(page)).length === 0, String(await rowCount(page)));
  }
  await click(page, '#search-cancel'); await sleep(120);
  t('Q6 검색 닫으면 전체로 · 탭 줄 돌아옴', (await rowCount(page)) === N.all && await page.evaluate(() => !document.getElementById('bar-tabs').hidden), String(await rowCount(page)));

  // 한눈에
  await click(page, '[data-view="grid"]'); await sleep(120);
  t(`G1 한눈에: 전체 ${N.all}칸 · 구역 순서`, (await rowCount(page)) === N.all && JSON.stringify(await heads(page)) === JSON.stringify(allHeads), JSON.stringify(await heads(page)));
  await click(page, tabSel('중등')); await sleep(120);
  t(`G2 한눈에 중등·특수: ${N.m + N.s}칸 · 구역 제목 둘(중등 위, 특수 아래)`, (await rowCount(page)) === N.m + N.s && JSON.stringify(await heads(page)) === JSON.stringify([H('중등', N.m), H('특수', N.s)]), JSON.stringify(await heads(page)));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'grid-middle-390.png') });
  await click(page, tabSel('미래')); await sleep(120);
  t(`G3 한눈에 미래채움: ${N.f}칸`, (await rowCount(page)) === N.f && JSON.stringify(await heads(page)) === JSON.stringify([H('미래채움존', N.f)]), JSON.stringify(await heads(page)));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'grid-future-390.png') });
  await ctx.close();
}
for (const W of [320, 360, 390]) {
  const { ctx, page } = await open(W);
  await click(page, '[data-view="grid"]'); await sleep(120);
  await click(page, tabSel('미래')); await sleep(120);
  const fit = await page.$$eval('#list .tile', (ts) => ts.map((x) => { const r = x.getBoundingClientRect(), n = x.querySelector('.tile__no'), rg = document.createRange(); rg.selectNodeContents(n); return { t: n.textContent, in: rg.getBoundingClientRect().right <= r.right - 3, w: Math.round(r.width) }; }));
  t(`G4 ${W}px 한눈에 번호(미래1)가 칸 안에`, fit.length === N.f && fit.every((x) => x.in), JSON.stringify(fit.slice(0, 2)));
  await ctx.close();
}

/* ── 지금 계신 부스(QR 주소 ?b=) · 행사 중: 낱말 번호가 칸 안에 ─ */
if (!SNAP_FILE) {
  data = fixture(true);
  data.event.start = new Date(Date.now() - 36e5).toISOString();
  data.event.end = new Date(Date.now() + 36e5).toISOString();
  for (const W of [320, 390]) {
    const { ctx, page } = await open(W, '?b=f5');
    const h = await page.evaluate(() => {
      const inside = (el) => { const g = document.createRange(); g.selectNodeContents(el); const a = g.getBoundingClientRect(), b = el.parentElement.getBoundingClientRect(); return a.left >= b.left - 0.5 && a.right <= b.right + 0.5; };
      const code = document.querySelector('.here__code');
      const alts = [...document.querySelectorAll('.alt')].map((x) => { const c = x.querySelector('.alt__code'), n = x.querySelector('.alt__name'), g = document.createRange(); g.selectNodeContents(c); return { t: c.textContent, clear: g.getBoundingClientRect().right <= n.getBoundingClientRect().left, in: inside(c) }; });
      return { code: code && code.textContent, alts, ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    t(`H1 ${W}px 지금 계신 부스 미래5 · 같은 구역 여유 부스 번호가 이름과 겹치지 않음`, h.code === '미래5' && h.alts.length >= 2 && h.alts.every((x) => /^미래/.test(x.t) && x.clear && x.in) && h.ovf <= 0, JSON.stringify(h));
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `here-future-${W}.png`) });
    await ctx.close();
  }
}

/* ── 미래채움존 공개 전(84곳): 숫자를 고정하지 않음 ──────────────── */
if (!SNAP_FILE) {
  data = fixture(false);
  const N0 = counts();
  for (const W of [320, 390, 1024]) await tabsAt(W, N0);
  const { ctx, page } = await open(390);
  const h = await page.$eval('#h-total', (x) => x.textContent);
  t('P1 공개 전: 전체 84 · 구역 넷(미래채움존 없음)', h === '84' && JSON.stringify(await heads(page)) === JSON.stringify([H('초등', N0.e), H('중등', N0.m), H('특수', N0.s), H('고등', N0.h)]), JSON.stringify([h, await heads(page)]));
  await ctx.close();
}

await browser.close();
server.close();
if (TMP) rmSync(TMP, { recursive: true, force: true });
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} / ${results.length} 통과${BASE ? `  (기준 ${BASE})` : ''}`);
process.exit(bad.length ? 1 : 0);
