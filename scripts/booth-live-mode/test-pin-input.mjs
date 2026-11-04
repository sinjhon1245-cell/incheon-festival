/* ===================================================================
   부스 운영자 화면(booth-ctrl.html) PIN 칸 시험 — 실제 Chrome · 신뢰된 마우스 · 키보드 · 터치
   ───────────────────────────────────────────────────────────────────
   네트워크 · Production 에 닿지 않습니다.
     - 이 파일의 작은 웹 서버가 저장소(또는 --base 커밋에서 꺼낸) 파일만 줍니다.
     - 설정 파일의 Supabase 주소를 이 서버(/supa)로 바꿔 주고 거기에 가짜 답을 줍니다. 같은 주소라 미리 묻는 요청(CORS)도
       밖으로 나가지 않습니다. 그 밖의 바깥 주소(글꼴 등)는 브라우저 안에서 막습니다.
     - 가짜 서버의 PIN 은 이 파일에만 있는 시험 값입니다. 실제 PIN · 열쇠 · 세션과 관계없습니다.

     E  고치기   칸 누르고 바꾸기 · 첫 칸 · 마지막 칸 · 덮어 쓰기 · 빈 칸 누름 · 화살표
     D  지우기   Backspace 거듭 · 가운데 칸 Backspace · Delete · 전체 선택 후 다시 입력 · 모두 지우기
     P  붙여넣기 '482 915' 처럼 띄어 쓴 PIN · 자판의 클립보드 제안(한 번에 들어오는 글) · 숫자가 아닌 글
     T  터치     모바일 화면(390px · 터치) — 첫 누름 · 가운데 칸 다시 누름 · 숫자 자판(inputmode)
     S  보내기   덜 채움 · 틀린 PIN 뒤 다시 · 맞는 PIN · 횟수 제한 대기 · PIN 이 기록 · 주소 · 저장소에 남지 않음
     M  예시     협의용 예시(?demo, 4자리)도 같은 칸 규칙 · 예시 PIN 으로 열림
     Z  체험존   구역 카드 · 체험1 번호 · 같은 번호(고등 1)와 섞이지 않음 · PIN 로그인 · 머리글 · 긴 이름 · 상태 저장(320 · 390px)

   쓰는 법: node scripts/booth-live-mode/test-pin-input.mjs --deps <puppeteer-core 가 설치된 폴더>
              [--chrome <chrome.exe 경로>] [--base <커밋>] [--shots <폴더>]
              (--base 를 주면 그 커밋의 화면을 시험합니다 · --shots 는 모바일 PIN 칸 모습을 PNG 로 남깁니다)
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
const SHOTS = arg('shots', '');   // 주면 PIN 칸 모습을 그 폴더에 PNG 로 남깁니다(전후 비교용)
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
async function shot(page, name) { if (!SHOTS) return; const el = await page.$('#pin-s3'); await el.screenshot({ path: join(SHOTS, name + '.png') }); }

const results = [];
function t(name, ok, note = '') { results.push({ name, ok: !!ok, note }); console.log(`${ok ? '통과' : '실패'}  ${name}${!ok && note ? '  — ' + note : ''}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* 아직 */ } await sleep(25); } return false; }

/* ── 시험할 파일 ─────────────────────────────────────────────────── */
const FILES = ['booth-ctrl.html', 'assets/booth-ctrl.css', 'assets/booth-core.js', 'assets/mock-data.js', 'assets/config.js'];
let ROOT = REPO, TMP = null;
if (BASE) {
  TMP = mkdtempSync(join(tmpdir(), 'pin-base-'));
  for (const f of FILES) {
    mkdirSync(dirname(join(TMP, f)), { recursive: true });
    writeFileSync(join(TMP, f), execFileSync('git', ['show', `${BASE}:${f}`], { cwd: REPO, maxBuffer: 64 << 20 }));
  }
  ROOT = TMP;
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
let ORIGIN = '';
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/supa/rest/v1/')) {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
      const ans = fakeAnswer(req.method, url.pathname.slice('/supa/rest/v1/'.length) + url.search, body);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(ans));
    });
    return;
  }
  const p = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (!FILES.includes(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  let out = readFileSync(join(ROOT, p));
  // 설정 파일의 Supabase 주소를 이 서버로 바꿉니다(키 값은 그대로 두지만 이 서버 밖으로 나가지 않습니다).
  if (p === 'assets/config.js') out = out.toString('utf8') + `\nwindow.FESTIVAL_CONFIG.supabaseUrl = ${JSON.stringify(ORIGIN + '/supa')};\n`;
  res.end(out);
});
// 아무 포트(0)나 받으면 Chrome 이 막는 포트(6697 등)가 걸릴 수 있어 47000~47999 에서 고릅니다
await new Promise((r) => server.listen(47000 + Math.floor(Math.random() * 1000), '127.0.0.1', r));
ORIGIN = `http://127.0.0.1:${server.address().port}`;

/* ── 가짜 Supabase ───────────────────────────────────────────────── */
const PIN_OK = '482915';   // 이 시험의 가짜 서버만 아는 값
const BOOTH = { id: '00000000-0000-4000-8000-000000000007', no: 7, code: '7', zone_key: 'A', name: '시험 부스', org: '시험 학교', program: '' };
const BOOTH2 = { id: '00000000-0000-4000-8000-000000000008', no: 8, code: '8', zone_key: 'A', name: '시험 부스 둘', org: '시험 학교', program: '' };
// 체험존 12곳과 번호가 같은 학교 부스(고등 1 ~ 12). 구역이 10곳 이상이면 찾기 칸이 나옵니다. 체험존은 운영기관을 비워 둡니다.
const FUT = Array.from({ length: 12 }, (_, i) => ({ id: `00000000-0000-4000-8000-0000000001${i + 10}`, no: i + 1, code: `체험${i + 1}`, zone_key: '체험', name: i === 0 ? '스마트 모빌리티의 기초 : 엠봇으로 배우는 로봇제어' : `시험 체험 ${i + 1}`, org: '', program: '' }));
const HIGH = Array.from({ length: 12 }, (_, i) => ({ id: `00000000-0000-4000-8000-0000000002${i + 10}`, no: i + 1, code: String(i + 1), zone_key: '고등', name: `시험 고등 부스 ${i + 1}`, org: '시험 고등학교', program: '' }));
const ZONE_NAME = { A: 'A구역', 고등: '고등', 체험: '체험존' };
const fake = { logins: [], limited: 0, outside: [], who: BOOTH, sets: [] };
const boothRow = (b) => ({ booth_id: b.id, id: b.id, code: b.code, no: b.no, name: b.name, org: b.org, zone_key: b.zone_key, zone_label: ZONE_NAME[b.zone_key],
  congestion: null, wait_minutes: null, updated_at: null, expires_at: new Date(Date.now() + 8 * 3600e3).toISOString() });
function fakeAnswer(method, path, body) {
  const name = path.split('?')[0];
  if (method === 'GET' && name === 'settings') return [{ booth_pin_enabled: true, booth_sample_common_pin_enabled: false }];
  if (method === 'GET' && name === 'zones') return [{ key: 'A', label: 'A구역', sort_order: 1 }, { key: '고등', label: '고등', sort_order: 3 }, { key: '체험', label: '체험존', sort_order: 5 }];
  if (method === 'GET' && name === 'booths') return [BOOTH, BOOTH2, ...HIGH, ...FUT];
  if (method === 'POST' && name === 'rpc/booth_pin_login') {
    fake.logins.push(body);
    if (fake.limited) return [{ ok: false, reason: 'limited', retry_after: fake.limited }];
    const hit = [BOOTH, ...FUT].find((b) => b.id === (body && body.p_booth_id));
    if (hit && body.p_pin === PIN_OK) { fake.who = hit; return [{ ok: true, session: 'S'.repeat(43), ...boothRow(hit) }]; }
    return [{ ok: false, reason: 'invalid', retry_after: 0 }];
  }
  if (method === 'POST' && name.startsWith('rpc/booth_session')) {
    if (name === 'rpc/booth_session_set') fake.sets.push(body);
    return [boothRow(fake.who)];
  }
  return [];
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--no-default-browser-check'] });
const consoleLines = [];

async function openPage({ mobile = false, demo = false } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  if (mobile) await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36' });
  else await page.setViewport({ width: 1024, height: 900 });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith(ORIGIN + '/') || u.startsWith('data:')) { req.continue(); return; }
    fake.outside.push(u);
    req.abort();
  });
  page.on('console', (m) => consoleLines.push(m.text()));
  await page.goto(`${ORIGIN}/booth-ctrl.html${demo ? '?demo' : ''}`, { waitUntil: 'domcontentloaded' });
  return { ctx, page };
}

// 시작 화면 → 'PIN 으로 시작' → 구역 → 부스 → PIN 칸
async function toPinStep(page, { demo = false } = {}) {
  if (!demo) {
    await until(() => page.$eval('#start-pin', (e) => !e.hidden));
    await page.click('[data-act="pin-start"]');
  }
  await until(() => page.$eval('#pin-s1', (e) => !e.hidden));
  await page.click('[data-zone="A"]');
  await until(() => page.$eval('#pin-s2', (e) => !e.hidden));
  await page.click(`[data-booth="${demo ? 'ex-a01' : BOOTH.id}"]`);
  await until(() => page.$eval('#pin-s3', (e) => !e.hidden));
  await until(() => page.evaluate(() => document.activeElement && document.activeElement.id === 'pin-input'));
}

const val = (page) => page.$eval('#pin-input', (e) => e.value);
const shown = (page) => page.$$eval('#pin-slots .pinslot', (s) => s.map((x) => x.textContent || '·').join(''));
const slotXY = (page, i) => page.$$eval('#pin-slots .pinslot', (s, i) => { const r = s[i].getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, i);
// 칸 그림에서 '지금 고칠 자리' 로 보이는 칸(보라 테두리)
const marked = (page) => page.$$eval('#pin-slots .pinslot', (s) => s.map((x, i) => (/\bis-(next|sel|caret|end)\b/.test(x.className) ? i : -1)).filter((i) => i >= 0));
async function clickSlot(page, i) { const [x, y] = await slotXY(page, i); await page.mouse.click(x, y); await sleep(30); }
async function tapSlot(page, i) { const [x, y] = await slotXY(page, i); await page.touchscreen.tap(x, y); await sleep(60); }
async function clear(page) {
  await page.focus('#pin-input');
  await page.evaluate(() => { const e = document.getElementById('pin-input'); e.setSelectionRange(0, e.value.length); });
  await page.keyboard.press('Backspace');
}
async function fill(page, v) { await clear(page); await page.keyboard.type(v); await sleep(20); }

/* ── E · D · P : 6자리(실제 모드, 1024px · 마우스 · 키보드) ─────── */
{
  const { ctx, page } = await openPage();
  await toPinStep(page);
  t('준비  PIN 칸에 커서 · 숫자 자판(inputmode=numeric)', await page.$eval('#pin-input', (e) => e.inputMode === 'numeric' && document.activeElement === e));

  await page.keyboard.type(PIN_OK);
  t('E1  처음부터 순서대로 6자리', (await val(page)) === PIN_OK && (await shown(page)) === PIN_OK && await page.$eval('#pin-go', (b) => !b.disabled),
    `값 ${await val(page)} · 칸 ${await shown(page)}`);

  await clickSlot(page, 2);
  t('E2  가운데(3번째) 칸을 누르면 그 칸이 고칠 자리로 보임', JSON.stringify(await marked(page)) === '[2]', `표시 ${JSON.stringify(await marked(page))}`);
  await page.keyboard.type('7');
  t('E3  가운데 칸 누르고 7 → 그 칸만 바뀜(482915 → 487915)', (await val(page)) === '487915', `값 ${await val(page)}`);

  await fill(page, PIN_OK);
  await clickSlot(page, 0); await page.keyboard.type('9');
  t('E4  첫 번째 칸 누르고 9 → 982915', (await val(page)) === '982915', `값 ${await val(page)}`);
  await clickSlot(page, 5); await page.keyboard.type('0');
  t('E5  마지막 칸 누르고 0 → 982910', (await val(page)) === '982910', `값 ${await val(page)}`);

  await fill(page, PIN_OK);
  await clickSlot(page, 1); await page.keyboard.type('1111');
  t('E6  두 번째 칸부터 1111 → 그 칸부터 차례로 덮어 씀(411115)', (await val(page)) === '411115', `값 ${await val(page)}`);

  await fill(page, '48');
  await clickSlot(page, 4);
  t('E7  빈 칸(5번째)을 누르면 다음에 채울 칸(3번째)에 커서', JSON.stringify(await marked(page)) === '[2]', `표시 ${JSON.stringify(await marked(page))}`);
  await page.keyboard.type('2915');
  t('E8  이어서 입력 → 482915', (await val(page)) === PIN_OK, `값 ${await val(page)}`);

  await fill(page, PIN_OK);
  await clickSlot(page, 3); await page.keyboard.press('ArrowLeft'); await page.keyboard.type('0');
  t('E9  4번째 칸 → ← → 0 : 3번째 칸이 바뀜(480915)', (await val(page)) === '480915', `값 ${await val(page)}`);

  // D. 지우기
  await fill(page, PIN_OK);
  const steps = [];
  for (let i = 0; i < 7; i++) { await page.keyboard.press('Backspace'); steps.push(await val(page)); }
  t('D1  Backspace 거듭 → 끝에서부터 한 자리씩(빈 칸에서 한 번 더 눌러도 그대로)', steps.join(',') === '48291,4829,482,48,4,,', steps.join(','));

  await fill(page, PIN_OK);
  await clickSlot(page, 2); await page.keyboard.press('Backspace');
  const d2 = await val(page);
  await page.keyboard.type('3');
  t('D2  3번째 칸 누르고 Backspace → 그 숫자만 지워지고, 3 을 넣으면 그 자리에(483915)', d2 === '48915' && (await val(page)) === '483915', `지운 뒤 ${d2} · 넣은 뒤 ${await val(page)}`);

  await fill(page, PIN_OK);
  await clickSlot(page, 2); await page.keyboard.press('Delete');
  const d3 = await val(page);
  await page.keyboard.type('7');
  t('D3  3번째 칸 누르고 Delete → 그 숫자만 지워지고, 7 을 넣으면 그 자리에(487915)', d3 === '48915' && (await val(page)) === '487915', `지운 뒤 ${d3} · 넣은 뒤 ${await val(page)}`);

  await fill(page, PIN_OK);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.type('135790');
  t('D4  전체 선택(Ctrl+A) 후 다시 입력 → 135790', (await val(page)) === '135790', `값 ${await val(page)}`);

  await fill(page, PIN_OK);
  const clr = await page.$('#pin-clear');
  if (clr) {
    t('D5  숫자가 있으면 \'모두 지우기\' 가 보임', await page.$eval('#pin-clear', (b) => getComputedStyle(b).visibility === 'visible' && !b.disabled));
    await page.click('#pin-clear');
    t('D6  \'모두 지우기\' → 빈 칸 · 커서는 첫 칸 · 보내기 꺼짐', (await val(page)) === '' && await page.evaluate(() => document.activeElement.id === 'pin-input')
      && JSON.stringify(await marked(page)) === '[0]' && await page.$eval('#pin-go', (b) => b.disabled));
  } else {
    t('D5  숫자가 있으면 \'모두 지우기\' 가 보임', false, '단추 없음');
    t('D6  \'모두 지우기\' → 빈 칸 · 커서는 첫 칸 · 보내기 꺼짐', false, '단추 없음');
  }

  // P. 붙여넣기 · 한 번에 들어오는 글(자판의 클립보드 제안 · 자동 채움은 글 한 덩이로 들어옵니다)
  await clear(page);
  await page.keyboard.sendCharacter('482 915');
  t('P1  띄어 쓴 PIN(482 915)이 한 번에 들어옴 → 482915', (await val(page)) === PIN_OK, `값 ${await val(page)}`);
  await fill(page, '11');
  await page.keyboard.sendCharacter('482915');
  t('P2  두 자리 넣은 뒤 PIN 6자리가 한 번에 들어옴 → 그 PIN 으로 바뀜(482915)', (await val(page)) === PIN_OK, `값 ${await val(page)}`);
  await clear(page);
  await page.keyboard.sendCharacter('PIN: 482-915');
  t('P3  글이 섞인 PIN(PIN: 482-915) → 숫자만 482915', (await val(page)) === PIN_OK, `값 ${await val(page)}`);
  await fill(page, '48');
  await page.keyboard.sendCharacter('abc');
  t('P4  숫자가 없는 글 → 그대로(48)', (await val(page)) === '48', `값 ${await val(page)}`);

  // 진짜 붙여넣기(Ctrl+V). 시험 브라우저의 클립보드를 쓸 수 있을 때만 봅니다.
  await ctx.overridePermissions(ORIGIN, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  const clip = await page.evaluate(() => navigator.clipboard.writeText('482 915').then(() => true, () => false));
  if (clip) {
    await fill(page, '9');
    await page.evaluate(() => { const e = document.getElementById('pin-input'); e.setSelectionRange(0, 1); });
    await page.keyboard.down('Control'); await page.keyboard.press('KeyV', { commands: ['paste'] }); await page.keyboard.up('Control');
    await sleep(50);
    t('P5  Ctrl+V 로 \'482 915\' 붙여넣기 → 482915', (await val(page)) === PIN_OK, `값 ${await val(page)}`);
  } else {
    console.log('건너뜀  P5  시험 브라우저 클립보드를 쓸 수 없음');
  }

  // 빠른 입력: 칸을 누르자마자 숫자를 연달아
  await fill(page, '000000');
  const [x1, y1] = await slotXY(page, 0);
  await page.mouse.click(x1, y1);
  await page.keyboard.type(PIN_OK, { delay: 0 });
  t('E10 첫 칸을 누르자마자 빠르게 6자리 → 482915', (await val(page)) === PIN_OK, `값 ${await val(page)}`);
  await ctx.close();
}

/* ── T : 모바일(390px · 터치 · 가상 자판 자리) ──────────────────── */
{
  const { ctx, page } = await openPage({ mobile: true });
  await toPinStep(page);
  await page.evaluate(() => document.activeElement.blur());
  await tapSlot(page, 0);
  t('T1  칸을 눌러 PIN 칸에 들어감(가상 자판이 뜨는 글칸)', await page.evaluate(() => document.activeElement && document.activeElement.id === 'pin-input'));
  await page.keyboard.type(PIN_OK);
  await shot(page, 'pin-1-full');
  await tapSlot(page, 3); await shot(page, 'pin-2-tap-4th'); await page.keyboard.type('0');
  t('T2  입력 뒤 4번째 칸을 눌러 0 → 482015', (await val(page)) === '482015', `값 ${await val(page)}`);
  await tapSlot(page, 0); await page.keyboard.type('7');
  t('T3  첫 칸을 눌러 7 → 782015', (await val(page)) === '782015', `값 ${await val(page)}`);
  await tapSlot(page, 2); await page.keyboard.press('Backspace'); await shot(page, 'pin-3-after-delete');
  t('T4  3번째 칸을 눌러 지우기 → 78015', (await val(page)) === '78015', `값 ${await val(page)}`);
  await page.evaluate(() => document.activeElement.blur());
  await tapSlot(page, 4); await page.keyboard.type('9');
  t('T5  자판을 닫은 뒤 5번째 칸을 다시 눌러 9 → 78019', (await val(page)) === '78019', `값 ${await val(page)}`);
  // 안드로이드의 뒤로 단추는 자판만 닫고 커서는 글칸에 남깁니다. 그 글칸을 다시 누를 때 화면이 누름을 막으면
  // 자판이 다시 뜨지 않으므로, 커서가 있는 칸을 누를 때도 누름(touchend)을 막지 않아야 합니다.
  await page.evaluate(() => { window.__tp = []; window.addEventListener('touchend', (e) => window.__tp.push(e.defaultPrevented)); });
  await tapSlot(page, 1); await tapSlot(page, 3);
  const tp = await page.evaluate(() => window.__tp);
  t('T7  커서가 있는 칸을 다시 눌러도 브라우저의 누름을 막지 않음(자판이 다시 뜰 수 있게)', tp.length === 2 && tp.every((x) => x === false), JSON.stringify(tp));
  await page.keyboard.type('5');
  t('T8  그 누름으로 4번째 칸을 골라 5 → 78059', (await val(page)) === '78059', `값 ${await val(page)}`);
  const wrapW = await page.$eval('#pin-wrap', (e) => [e.getBoundingClientRect().right, document.documentElement.clientWidth]);
  t('T6  390px 에서 PIN 칸이 화면 안에(가로 넘침 없음)', wrapW[0] <= wrapW[1] && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), JSON.stringify(wrapW));
  await ctx.close();
}

/* ── W : 폭마다(360 · 390 · 768 · 1024 · 1440) — 칸 누르고 고치기 · 넘침 · '모두 지우기' 자리 ─────── */
for (const W of [360, 390, 768, 1024, 1440]) {
  const mobile = W < 768;
  const { ctx, page } = await openPage({ mobile });
  if (!mobile) await page.setViewport({ width: W, height: 900 });
  else if (W !== 390) await page.setViewport({ width: W, height: 800, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await toPinStep(page);
  await page.keyboard.type(PIN_OK);
  if (mobile) await tapSlot(page, 1); else await clickSlot(page, 1);
  await page.keyboard.type('0');
  const g = await page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    const slots = [...document.querySelectorAll('#pin-slots .pinslot')].map((s) => s.getBoundingClientRect());
    const c = document.getElementById('pin-clear');
    return { wrapR: r('pin-wrap').right, clearR: c ? c.getBoundingClientRect().right : 1e9, vw: document.documentElement.clientWidth,
      ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth, minW: Math.min(...slots.map((s) => s.width)), h: slots[0].height };
  });
  t(`W ${W}px  2번째 칸 고치기(402915) · 가로 넘침 없음 · 칸 폭 ${Math.round(g.minW)}px · '모두 지우기' 가 칸 줄 끝 안쪽`,
    (await val(page)) === '402915' && g.ovf <= 0 && g.wrapR <= g.vw && g.minW >= 36 && g.clearR - 6 <= g.wrapR + 1 && g.clearR <= g.vw, JSON.stringify(g));   // 단추 오른쪽 6px 는 누르는 넓이(여백)라 글자 끝 = 칸 줄 끝
  if (SHOTS && (W === 360 || W === 1440)) await shot(page, `pin-w${W}`);
  await ctx.close();
}

/* ── S : 보내기 · 보안 ───────────────────────────────────────────── */
{
  const { ctx, page } = await openPage();
  await toPinStep(page);
  fake.logins.length = 0;
  await page.keyboard.type('4829');
  await page.keyboard.press('Enter');
  await sleep(150);
  t('S1  4자리만 넣고 Enter → 보내지 않음 · 보내기 꺼짐', fake.logins.length === 0 && await page.$eval('#pin-go', (b) => b.disabled));

  await fill(page, '111111');
  await page.keyboard.press('Enter');
  await until(() => page.$eval('#pin-err', (e) => !e.hidden));
  t('S2  틀린 PIN → 한 번만 보냄 · 오류 문구 · 칸 비움 · 커서 그대로', fake.logins.length === 1 && fake.logins[0].p_pin === '111111'
    && (await val(page)) === '' && await page.evaluate(() => document.activeElement.id === 'pin-input'),
    JSON.stringify({ n: fake.logins.length, v: await val(page) }));
  await page.keyboard.type('4');
  t('S3  다시 입력하면 오류 문구가 사라짐', await page.$eval('#pin-err', (e) => e.hidden));
  await clear(page);

  fake.limited = 2;
  await page.keyboard.type('222222'); await page.keyboard.press('Enter');
  await until(() => page.$eval('#pin-go', (b) => /초 뒤/.test(b.textContent)));
  await page.keyboard.type('333333'); await page.keyboard.press('Enter');
  await sleep(150);
  t('S4  횟수 제한 → 기다리는 동안 Enter 를 눌러도 보내지 않음', fake.logins.length === 2, `보낸 횟수 ${fake.logins.length}`);
  fake.limited = 0;
  await until(() => page.$eval('#pin-go', (b) => !/초 뒤/.test(b.textContent)), 5000);

  await fill(page, PIN_OK);
  await clickSlot(page, 2); await page.keyboard.type('9'); await clickSlot(page, 2); await page.keyboard.type('2');
  await page.keyboard.press('Enter');
  await until(() => page.evaluate(() => { try { return !!localStorage.getItem('aisw-boothctrl-pin'); } catch { return false; } }), 5000);
  const store = await page.evaluate(() => JSON.stringify({ ls: Object.assign({}, localStorage), ss: Object.assign({}, sessionStorage), url: location.href }));
  t('S5  고친 뒤 맞는 PIN → 6자리 그대로 한 번 보내고 세션을 받음', fake.logins.length === 3 && fake.logins[2].p_pin === PIN_OK && fake.logins.every((b) => /^\d{6}$/.test(b.p_pin)) && /S{43}/.test(store),
    JSON.stringify(fake.logins.map((b) => b.p_pin.length)));
  const pins = ['111111', '222222', '333333', PIN_OK, '4829'];
  t('S6  PIN 이 기기 저장소 · 주소에 남지 않음', pins.every((p) => !store.includes(p)), store.slice(0, 200));
  await ctx.close();
}

/* ── M : 협의용 예시(?demo, 4자리) ───────────────────────────────── */
{
  const { ctx, page } = await openPage({ demo: true });
  await toPinStep(page, { demo: true });
  t('M1  예시는 4칸', (await page.$$eval('#pin-slots .pinslot', (s) => s.length)) === 4);
  await page.keyboard.type('0091');
  await clickSlot(page, 2); await page.keyboard.type('0');
  t('M2  예시 3번째 칸 누르고 0 → 0001', (await val(page)) === '0001', `값 ${await val(page)}`);
  await clear(page);
  await page.keyboard.sendCharacter('00 01');
  t('M3  예시 띄어 쓴 PIN(00 01) → 0001', (await val(page)) === '0001', `값 ${await val(page)}`);
  await fill(page, '0002'); await page.keyboard.press('Enter');
  await until(() => page.$eval('#pin-err', (e) => !e.hidden));
  t('M4  예시 틀린 PIN → 오류 · 칸 비움', (await val(page)) === '');
  await page.keyboard.type('0001'); await page.keyboard.press('Enter');
  t('M5  예시 맞는 PIN → 예시 운영 화면', await until(() => page.evaluate(() => !document.getElementById('v-main').hidden), 6000));
  await ctx.close();
}

/* ── Z : 체험존 운영자 ───────────────────────────────────────── */
for (const W of [390, 320]) {
  const { ctx, page } = await openPage({ mobile: true });
  if (W !== 390) await page.setViewport({ width: W, height: 800, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await until(() => page.$eval('#start-pin', (e) => !e.hidden));
  await page.click('[data-act="pin-start"]');
  await until(() => page.$eval('#pin-s1', (e) => !e.hidden));
  const card = await page.$eval('[data-zone="체험"]', (e) => e.innerText.replace(/\s+/g, ' ').trim());
  t(`Z1 ${W}px 구역 카드: 체험 · 체험존 · 부스 12곳`, card === '체험 체험존 부스 12곳', card);
  await page.click('[data-zone="체험"]');
  await until(() => page.$eval('#pin-s2', (e) => !e.hidden));
  const pick = await page.evaluate(() => ({ zone: document.getElementById('pin-zone-name').textContent, find: document.getElementById('pin-find').hidden,
    no: [...document.querySelectorAll('#pin-booths .pick__k')].map((x) => x.textContent), ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  t(`Z2 ${W}px 부스 고르기: 체험1 ~ 체험12 번호 · 구역 안내 · 찾기 칸 · 가로 넘침 없음`, pick.zone === '체험존 · 부스 12곳' && !pick.find && JSON.stringify(pick.no) === JSON.stringify(FUT.map((b) => b.code)) && pick.ovf <= 0, JSON.stringify(pick));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `ctrl-exp-pick-${W}.png`) });
  await page.click(`[data-booth="${FUT[0].id}"]`);
  await until(() => page.$eval('#pin-s3', (e) => !e.hidden));
  const code = await page.$eval('#pin-code', (e) => e.textContent);
  t(`Z3 ${W}px PIN 칸 위 번호: 체험1`, code === '체험1', code);
  fake.logins.length = 0; fake.sets.length = 0;
  await until(() => page.evaluate(() => document.activeElement && document.activeElement.id === 'pin-input'));
  await page.keyboard.type(PIN_OK); await page.keyboard.press('Enter');
  const opened = await until(() => page.evaluate(() => !document.getElementById('v-main').hidden), 6000);
  const head = await page.evaluate(() => { const c = document.getElementById('h-code'); const hn = document.getElementById('h-name'); return { code: c.textContent, name: hn.textContent, whole: hn.scrollHeight <= hn.clientHeight + 1 && getComputedStyle(hn).overflowY !== 'hidden', org: document.getElementById('h-org').textContent, zone: document.getElementById('h-zone').textContent,
    fit: (() => { const g = document.createRange(); g.selectNodeContents(c); return g.getBoundingClientRect().right <= c.getBoundingClientRect().right; })(), ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
  t(`Z4 ${W}px PIN 로그인은 그 부스 UUID 로 · 머리글 체험1 · 긴 이름 전체가 보임 · 기관 없음 · 구역 · 넘침 없음`, opened && fake.logins.length === 1 && fake.logins[0].p_booth_id === FUT[0].id && head.code === '체험1' && head.name === FUT[0].name && head.org === '' && head.zone === '체험존' && head.whole && head.fit && head.ovf <= 0, JSON.stringify(head));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `ctrl-exp-main-${W}.png`) });
  await page.click('#btn-pause');
  const saved = await until(() => fake.sets.length > 0 || page.$eval('#mode-ask', (e) => !e.hidden), 3000);
  if (!fake.sets.length && await page.$eval('#mode-ask', (e) => !e.hidden)) { await page.click('[data-act="mode-yes"]'); await until(() => fake.sets.length > 0, 3000); }
  t(`Z5 ${W}px 잠시 중단 저장은 같은 세션 함수로`, saved && fake.sets.length >= 1 && fake.sets[0].p_mode === 'pause', JSON.stringify(fake.sets.map((x) => x.p_mode)));
  await ctx.close();
}
{
  const { ctx, page } = await openPage({ mobile: true });
  await until(() => page.$eval('#start-pin', (e) => !e.hidden));
  await page.click('[data-act="pin-start"]');
  await until(() => page.$eval('#pin-s1', (e) => !e.hidden));
  await page.click('[data-zone="고등"]');
  await until(() => page.$eval('#pin-s2', (e) => !e.hidden));
  const type = async (v) => { await page.$eval('#pin-q', (e, x) => { e.value = x; e.dispatchEvent(new Event('input', { bubbles: true })); }, v); await sleep(120); };
  const rows = () => page.$$eval('#pin-booths .pick', (r) => r.map((x) => [x.dataset.booth, x.querySelector('.pick__k').textContent]));
  await type('1');
  const one = await rows();
  t('Z6 고등 구역에서 1 은 고등 1 부스가 맨 위(체험1 과 섞이지 않음)', one[0] && one[0][0] === HIGH[0].id && one[0][1] === '01' && !one.some((x) => x[0] === FUT[0].id), JSON.stringify(one.slice(0, 3)));
  await type('체험3');
  const three = await rows();
  t('Z7 고등 구역에서 체험3 을 치면 다른 구역 부스로 찾음', three[0] && three[0][0] === FUT[2].id && three[0][1] === '체험3', JSON.stringify(three));
  await ctx.close();
}

t('보안  PIN 이 화면 기록(console)에 남지 않음', !consoleLines.some((l) => /482915|111111|222222|333333/.test(l)), consoleLines.join(' | ').slice(0, 300));
t('보안  Supabase 요청은 모두 이 시험 서버로(운영 주소로 가는 요청 없음)', !fake.outside.some((u) => /supabase\.co/.test(u)), fake.outside.join(' '));
if (fake.outside.length) console.log(`참고  막은 바깥 요청 ${fake.outside.length}개: ${[...new Set(fake.outside.map((u) => new URL(u).host))].join(', ')}`);

await browser.close();
server.close();
if (TMP) rmSync(TMP, { recursive: true, force: true });
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} / ${results.length} 통과${BASE ? `  (기준 ${BASE})` : ''}`);
process.exit(bad.length ? 1 : 0);
