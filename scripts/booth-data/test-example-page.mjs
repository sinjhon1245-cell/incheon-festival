/* ===================================================================
   /example/ 화면 안내 페이지 시험 (booth-live 의 live/example)
   ───────────────────────────────────────────────────────────────────
   · 정적: 스크립트 없음 · 확인용 PIN(123456 등 숫자 PIN) 없음 · 체험 단추 = ?demo=1 · 행사 명칭 · 미리보기 문구가 실제 두 화면에 있는 말인지 · 색 값
   · 빌드: sh live/build.sh 통과(운영 포털 흔적 검사 포함) · 배포본에서 example/ 말고는 기준 판(--base-ref) 빌드와 바이트 동일
   · 브라우저(Edge · 390 / 1440): 가로 넘침 · 오류 · 데이터 요청 0 · 체험 단추 → 예시 화면(협의용 예시 띠) · 예시 화면도 데이터 요청 0
     · 같은 브라우저에서 운영자 예시에서 누른 값이 관람객 예시에 보이는지(페이지 문구가 말하는 것) · 실제 관람객 화면은 데이터를 요청함(검출 확인)
   빌드 결과를 incheon-live.vercel.app 주소로 띄우고, Supabase · /api 요청은 모두 막고 셉니다(Production 접속 없음).
   node test-example-page.mjs --live-dir <booth-live 작업 폴더> --pptr-dir <puppeteer-core 가 든 폴더> [--base-ref 63d260b] [--official "…"]
   =================================================================== */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, mkdtempSync } from 'node:fs';
import { join, resolve, dirname, extname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const LIVE = resolve(arg('live-dir'));
const BASE_REF = arg('base-ref', '63d260b');
const OFFICIAL = arg('official', '2026 인천 AI미래채움 교육페스티벌');   // settings.event_title (Production 읽기 확인 2026-10-21)
const VENUE = arg('venue', '인천 상상플랫폼');
const puppeteer = createRequire(join(resolve(arg('pptr-dir')), 'pptr', 'package.json'))('puppeteer-core');
const EDGE = arg('edge', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
const OUT = resolve(HERE, 'out', 'example'); mkdirSync(OUT, { recursive: true });

const results = [];
function t(name, ok, note = '') { results.push({ name, ok: !!ok, note: ok ? '' : String(note).slice(0, 400) }); console.log(`${ok ? '통과' : '실패'}  ${name}${note && !ok ? '  — ' + String(note).slice(0, 300) : ''}`); }
const git = (...a) => execFileSync('git', ['-C', LIVE, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const read = p => readFileSync(join(LIVE, p), 'utf8').replace(/\r/g, '');
const HTML = read('live/example/index.html'), CSS = read('live/example/example.css');
const VIS = read('visitor.html'), CTRL = read('booth-ctrl.html'), CORE = read('assets/booth-core.js');
const VCSS = read('assets/visitor.css'), CCSS = read('assets/booth-ctrl.css');
const textOf = h => h.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#x2197;&#xFE0E;/g, '').replace(/\s+/g, ' ').trim();
const TEXT = textOf(HTML);

// ── 1. 정적 ─────────────────────────────────────────────────────
t('X1 스크립트 없음 · 확인용 PIN 없음 — 123456 도, 6자리 숫자 PIN 도, “확인용 PIN” 글도 없음(주석 포함)',
  !/<script/i.test(HTML) && !/123456/.test(HTML) && !/\b\d{6}\b/.test(HTML) && !/확인용 PIN/.test(HTML) && !/facts__pin|123456/.test(CSS),
  [/<script/i.test(HTML), /123456/.test(HTML), (HTML.match(/\b\d{6}\b/g) || []).length, /확인용 PIN/.test(HTML)].join(' '));
const links = [...HTML.matchAll(/<a\s[^>]*>/g)].map(m => m[0]);
const href = a => (a.match(/href="([^"]*)"/) || [])[1];
t('X2 체험 단추 둘 = 협의용 예시 화면(/?demo=1 · /booth-ctrl?demo=1) · 새 탭 · noopener · 다른 링크 없음(실제 화면 · 운영 포털로 가는 링크 없음)',
  links.length === 2 && href(links[0]) === '/?demo=1' && href(links[1]) === '/booth-ctrl?demo=1' &&
  links.every(a => /target="_blank"/.test(a) && /rel="[^"]*noopener/.test(a)) && /관람객 화면 체험하기/.test(TEXT) && /부스 운영자 화면 체험하기/.test(TEXT),
  JSON.stringify(links.map(href)));
const names = [...TEXT.matchAll(/20\d\d ?인천[^·]{0,30}?(?:페스티벌|축제)/g)].map(m => m[0].trim());
t(`X3 행사 명칭 = 공식 명칭 “${OFFICIAL}”(머리 · 관람객 미리보기 띠 모두) · 장소 “${VENUE}” · 다른 표기 없음`,
  names.length >= 2 && names.every(n => n === OFFICIAL) && TEXT.includes(`${OFFICIAL} · ${VENUE}`), JSON.stringify(names));
// 미리보기 문구가 실제 화면(visitor.html · booth-ctrl.html · booth-core.js)에 있는 말인지
const SRC = VIS + CTRL + CORE;
const PHRASES = ['부스 대기 현황', '자동 갱신', '지금 여유로운 부스', '중단·마감', '잠시 중단', '마감', '현재 대기', '마지막 입력', '변동 없음 · 지금 확인',
  '값은 그대로 두고 확인한 시각만 새로 저장해요', '대기시간', '누르면 바로 저장돼요', '운영 상태', '점심·재료 준비·회차 사이', '오늘 운영 마감', '재료 소진·운영 끝', '바로', '이상'];
const missing = PHRASES.filter(p => !TEXT.includes(p) || !SRC.includes(p));
t('X4 미리보기 문구 18개가 지금 관람객 · 운영자 화면 소스에 그대로 있음(줄인 그림과 실제 화면의 말이 같음)', !missing.length, missing.join(' | '));
// 미리보기 숫자 · 상태가 두 화면 규칙(10분 이하 여유 · 25분 이하 보통 · 그 위 혼잡)과 맞고, 큰 숫자 · 상태별 수가 목록과 맞음
const rule = w => (w <= 10 ? '여유' : (w <= 25 ? '보통' : '혼잡'));
const rows = [...HTML.matchAll(/<li class="vr[^"]*">([\s\S]*?)<\/li>/g)].map(m => textOf(m[1]));
const rowState = r => { const m = r.match(/(\d+) 분 (여유|보통|혼잡)/); return m ? [Number(m[1]), m[2]] : (/잠시 중단/.test(r) ? 'pause' : /마감/.test(r) ? 'closed' : null); };
const rs = rows.map(rowState);
const counts = { 여유: 0, 보통: 0, 혼잡: 0, off: 0 }; rs.forEach(s => { if (Array.isArray(s)) counts[s[1]]++; else if (s) counts.off++; });
const heroN = (HTML.match(/class="vp__num">(\d+)</) || [])[1], heroT = (HTML.match(/class="vp__total">전체 <b>(\d+)</) || [])[1];
const cntN = [...HTML.matchAll(/class="cnt__n">(\d+)</g)].map(m => Number(m[1]));
const pads = [...HTML.matchAll(/class="w w--(\w+)[^"]*"><span class="w__v">(바로|\d+)분?/g)].map(m => [m[2] === '바로' ? 0 : Number(m[2]), m[1]]);
const PADKEY = { free: '여유', normal: '보통', busy: '혼잡' };
t('X5 미리보기 값이 두 화면의 상태 규칙(booth-core: 10분 이하 여유 · 25분 이하 보통)과 맞고, 큰 숫자 · 분포 · 상태별 수 = 목록(여유 1 · 보통 1 · 혼잡 1 · 중단마감 2 · 전체 5) · 운영자 현재 대기 5분 = 보라로 고른 단추',
  /w <= 10 \? '여유' : \(w <= 25 \? '보통' : '혼잡'\)/.test(CORE) && rs.filter(Array.isArray).every(([w, s]) => rule(w) === s) &&
  Number(heroN) === counts.여유 && Number(heroT) === rows.length && JSON.stringify(cntN) === JSON.stringify([counts.여유, counts.보통, counts.혼잡, counts.off]) &&
  pads.length === 8 && pads.every(([w, k]) => rule(w) === PADKEY[k]) && /w w--free is-on"><span class="w__v">5분/.test(HTML) && /cp__nownum">5</.test(HTML) && /cp__nowstate">여유</.test(HTML),
  JSON.stringify({ rs, counts, heroN, heroT, cntN, pads }));
const tok = (css, name) => ((css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`)) || [])[1] || '').toUpperCase();
const colorPairs = [['v-free', VCSS, 'st-free'], ['v-normal', VCSS, 'st-normal'], ['v-busy', VCSS, 'st-busy'], ['v-off', VCSS, 'st-off'], ['off-mark', VCSS, 'st-off-mark'],
  ['free', CCSS, 'free'], ['normal', CCSS, 'normal'], ['busy', CCSS, 'busy'], ['accent', CCSS, 'accent'], ['danger', CCSS, 'danger']];
const badColor = colorPairs.filter(([a, css, b]) => !tok(CSS, a) || tok(CSS, a) !== tok(css, b)).map(([a, , b]) => `${a}=${tok(CSS, a)} vs ${b}=${tok(colorPairs.find(x => x[0] === a)[1], b)}`);
t('X6 색 값이 두 화면 CSS 와 같음(관람객 --st-* · 운영자 상태색 · 보라 · 마감 빨강 10개)', !badColor.length, badColor.join(' | '));

// ── 2. 빌드 ─────────────────────────────────────────────────────
function build(dir) { return execFileSync('sh', ['live/build.sh'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
function walk(d, base = d, out = []) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, base, out); else out.push(relative(base, p).replace(/\\/g, '/')); } return out; }
let buildOk = true, buildErr = '';
try { build(LIVE); } catch (e) { buildOk = false; buildErr = (e.stderr || e.message || '').toString(); }
const BASE = mkdtempSync(join(tmpdir(), 'example-base-'));
execFileSync('sh', ['-c', `git -C "${LIVE}" -c core.autocrlf=false archive ${BASE_REF} | tar -x -C "${BASE}"`]);
let baseOk = true; try { build(BASE); } catch (e) { baseOk = false; }
const DIST = join(LIVE, 'live', 'dist'), BDIST = join(BASE, 'live', 'dist');
const files = buildOk ? walk(DIST).sort() : [], bfiles = baseOk ? walk(BDIST).sort() : [];
const same = files.filter(f => existsSync(join(BDIST, f)) && readFileSync(join(DIST, f)).equals(readFileSync(join(BDIST, f))));
const changed = files.filter(f => !same.includes(f));
t(`X7 sh live/build.sh 통과(운영 포털 흔적 검사 포함) · 배포본 파일 목록이 기준 판 ${BASE_REF} 와 같고, 바뀐 파일은 example/ 둘뿐(관람객 · 운영자 화면 바이트 동일)`,
  buildOk && baseOk && JSON.stringify(files) === JSON.stringify(bfiles) && JSON.stringify(changed) === JSON.stringify(['example/example.css', 'example/index.html']),
  `${buildOk} ${baseOk} ${buildErr.slice(0, 120)} changed=${JSON.stringify(changed)} files=${files.length}/${bfiles.length}`);

// ── 3. 브라우저 ─────────────────────────────────────────────────
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.txt': 'text/plain' };
const REWRITE = { '/': 'index.html', '/visitor.html': 'index.html', '/booth-ctrl': 'booth-ctrl.html', '/example': 'example/index.html', '/example/': 'example/index.html' };
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--lang=ko-KR', '--hide-scrollbars'] });
const VP = { m: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, d: { width: 1440, height: 900 } };
const wait = ms => new Promise(r => setTimeout(r, ms));
function guard(p, log) {
  p.on('request', req => {
    const u = new URL(req.url());
    if (u.hostname === 'incheon-live.vercel.app') {
      if (u.pathname.startsWith('/api/')) { log.data.push(u.pathname); return req.respond({ status: 503, body: 'blocked' }); }
      const f = join(DIST, REWRITE[u.pathname] || u.pathname.replace(/^\//, ''));
      return existsSync(f) ? req.respond({ status: 200, contentType: TYPES[extname(f)] || 'application/octet-stream', body: readFileSync(f) }) : req.respond({ status: 404, body: 'nf' });
    }
    if (u.hostname.endsWith('supabase.co')) { log.data.push('supabase'); return req.respond({ status: 503, body: 'blocked' }); }
    if (!/cdn\.jsdelivr\.net/.test(u.hostname)) log.other.push(u.hostname);
    return req.continue();
  });
  p.on('pageerror', e => log.err.push(e.message.slice(0, 120)));
}
async function page(ctx, vp, path) {
  const p = await ctx.newPage(); await p.setViewport(VP[vp]);
  const log = { data: [], other: [], err: [] }; await p.setRequestInterception(true); guard(p, log);
  await p.goto('https://incheon-live.vercel.app' + path, { waitUntil: 'networkidle0', timeout: 60000 }); await wait(800);
  return { p, log };
}
const geo = {};
for (const vp of ['m', 'd']) {
  const ctx = await browser.createBrowserContext();
  const { p, log } = await page(ctx, vp, '/example/');
  const g = await p.evaluate(() => {
    const r = s => document.querySelector(s).getBoundingClientRect();
    const ctas = [...document.querySelectorAll('.cta')].map(a => Math.round(a.getBoundingClientRect().top + scrollY));
    return { sw: document.documentElement.scrollWidth, iw: innerWidth, ctas, two: r('.cards > .card:nth-child(2)').top < r('.cards > .card:first-child').bottom - 10 };
  });
  await p.screenshot({ path: `${OUT}/example-${vp}.jpg`, type: 'jpeg', quality: 82, fullPage: true });
  geo[vp] = { ...g, log };
  // 체험 단추 → 새 탭(협의용 예시)
  const tabs = [];
  for (const i of [0, 1]) {
    const target = new Promise(res => browser.once('targetcreated', res));
    await p.evaluate(k => document.querySelectorAll('.cta')[k].click(), i);
    const tg = await target; const np = await tg.page();
    await np.setViewport(VP[vp]); await np.setRequestInterception(true);
    const nlog = { data: [], other: [], err: [] }; guard(np, nlog);
    await np.reload({ waitUntil: 'networkidle0' }); await wait(800);
    tabs.push({ url: new URL(np.url()).pathname + new URL(np.url()).search, demo: await np.evaluate(() => { const b = document.getElementById('demobar'); return !!b && !b.hidden && /협의용 예시/.test(b.textContent); }), log: nlog });
    await np.close();
  }
  geo[vp].tabs = tabs;
  await ctx.close();
}
const L = v => `${v.sw}/${v.iw} data=${v.log.data.length} err=${v.log.err.length} other=${v.log.other.length}`;
t('X8 /example/ 390 · 1440 — 가로 넘침 없음 · 페이지 오류 0 · 데이터 요청 0 · 1440 은 두 카드 나란히 · 두 체험 단추 높이 같음',
  ['m', 'd'].every(vp => geo[vp].sw <= geo[vp].iw && !geo[vp].log.err.length && !geo[vp].log.data.length) && geo.d.two && geo.d.ctas[0] === geo.d.ctas[1],
  `m ${L(geo.m)} · d ${L(geo.d)} two=${geo.d.two} ctas=${geo.d.ctas}`);
t('X9 체험 단추 → 새 탭에서 협의용 예시 화면(“협의용 예시” 띠)이 열리고, 그 화면도 데이터 요청 0 · 오류 0(390 · 1440 · 관람객 · 운영자)',
  ['m', 'd'].every(vp => geo[vp].tabs.length === 2 && geo[vp].tabs[0].url === '/?demo=1' && geo[vp].tabs[1].url === '/booth-ctrl?demo=1' &&
    geo[vp].tabs.every(x => x.demo && !x.log.data.length && !x.log.err.length)),
  JSON.stringify(['m', 'd'].map(vp => geo[vp].tabs.map(x => [x.url, x.demo, x.log.data.length, x.log.err.length]))));
// 같은 브라우저: 운영자 예시에서 A-01 을 30분으로 → 관람객 예시(먼저 열어 둔 탭 · 새로 연 탭)
{
  const ctx = await browser.createBrowserContext();
  const vis = await page(ctx, 'm', '/?demo=1');
  const a01 = pg => pg.evaluate(() => { const r = [...document.querySelectorAll('.row')].find(x => /A-01/.test((x.querySelector('.row__code') || {}).textContent || '')); return r ? r.textContent.replace(/\s+/g, ' ').trim() : ''; });
  const before = await a01(vis.p);
  const ctl = await page(ctx, 'm', '/booth-ctrl?demo=1');
  await ctl.p.evaluate(() => { const b = [...document.querySelectorAll('[data-act="demo-direct"]')].find(x => x.offsetParent !== null); b && b.click(); });
  await wait(1200);
  const code = await ctl.p.evaluate(() => (document.getElementById('h-code') || {}).textContent);
  await ctl.p.evaluate(() => { const b = document.querySelector('#waits [data-wait="30"]'); b && b.click(); });
  await wait(1500);
  // 열어 둔 관람객 예시가 새로 고치지 않고도 바뀌는지는 참고로만 적습니다 — 관람객 화면은 보이는 동안 · 마지막으로 읽은 지
  // 5초가 지났을 때만 곧바로 다시 읽고, 아니면 다음 자동 갱신 차례를 기다립니다(visitor.html resume). 페이지 문구도 그만큼만 말합니다.
  await vis.p.bringToFront();
  let live = ''; for (let i = 0; i < 20 && !/30\s*분/.test(live); i++) { await wait(300); live = await a01(vis.p); }
  await vis.p.reload({ waitUntil: 'networkidle0' }); await wait(600); const reloaded = await a01(vis.p);
  const fresh = await page(ctx, 'm', '/?demo=1'); const after = await a01(fresh.p);
  const real = await page(ctx, 'm', '/');   // 검출 확인: 실제 화면은 데이터를 요청(여기서는 막힘)
  t('X10 페이지 문구대로 — 같은 브라우저에서 운영자 예시(A-01)에서 30분을 누르면, 열어 둔 관람객 예시를 새로 고치거나 새로 연 관람객 예시에 A-01 30분 혼잡 · 그동안 데이터 요청 0',
    code === 'A-01' && !/30\s*분/.test(before) && /30\s*분.*혼잡/.test(reloaded) && /30\s*분.*혼잡/.test(after) && !vis.log.data.length && !ctl.log.data.length && !fresh.log.data.length &&
    /새로 고치면 바로 보입니다/.test(TEXT),
    JSON.stringify({ code, before, reloaded, after, data: [vis.log.data.length, ctl.log.data.length, fresh.log.data.length] }));
  console.log(`  (참고) 새로 고치지 않은 관람객 예시 탭 6초 안 반영: ${/30\s*분/.test(live) ? '예' : '아니오 — 다음 자동 갱신 차례에 반영'}`);
  t('X11 검출 확인 — 같은 방법으로 실제 관람객 화면(/)을 열면 데이터 요청이 잡힘(예시 화면의 ‘요청 0’ 이 검사 누락이 아님)', real.log.data.length > 0, JSON.stringify(real.log.data));
  await ctx.close();
}
await browser.close();

const ok = results.filter(r => r.ok).length;
const md = ['# /example/ 화면 안내 페이지 시험', '', `- 대상: ${LIVE} (${git('rev-parse', '--short', 'HEAD').trim()}) · 기준 판 ${BASE_REF}`, `- 공식 명칭: ${OFFICIAL} · ${VENUE}`, '',
  '| 결과 | 항목 | 메모 |', '|---|---|---|', ...results.map(r => `| ${r.ok ? '통과' : '**실패**'} | ${r.name} | ${r.note.replace(/\|/g, '/')} |`), '', `**${ok} / ${results.length} 통과**`].join('\n');
writeFileSync(join(OUT, 'example-page-test-report.md'), md);
console.log(`\n${ok} / ${results.length} 통과 → out/example/example-page-test-report.md`);
process.exit(ok === results.length ? 0 : 1);
