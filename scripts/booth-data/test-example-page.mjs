/* ===================================================================
   /example/ 화면 안내 페이지 시험 (booth-live 의 live/example)
   ───────────────────────────────────────────────────────────────────
   · 정적: 스크립트 없음 · 공개 PIN 은 운영자 단추 위 리허설 공통 PIN 보조 줄 한 곳뿐(값 = 운영자 화면의 공통 PIN 값 · 그 밖의 6자리 숫자 없음)
     · 보조 줄의 기한이 서버 기한(main 의 리허설 SQL)보다 늦지 않음 · 23:00 초기화는 대기시간만(초기화로 PIN 이 끝난다고 말하지 않음)
     · 두 단추 = 실제 운영 화면(/ · /booth-ctrl, ?demo 없음) · 안내 문구 · 행사 명칭 · 미리보기 문구가 실제 두 화면에 있는 말인지 · 색 값
   · 빌드: sh live/build.sh 통과(운영 포털 흔적 검사 포함) · 배포본에서 example/ 말고는 기준 판(--base-ref) 빌드와 바이트 동일
   · 브라우저(Edge · 390 / 1440): 가로 넘침 · 오류 · 데이터 요청 0 · 1440 두 단추 같은 높이
     · PIN 보조 줄: 작게(단추 글자보다 작음 · 두 줄 이하) · 읽히게(대비 4.5:1 이상) · 미리보기 아래 · 단추 바로 위(8~24px)
     · 관람객 단추 → 실제 관람객 화면 · 운영자 단추 → 실제 운영자 화면(둘 다 협의용 예시 띠 없음 · 예시 저장소 안 만듦)
     · 두 실제 화면을 열기만 했을 때의 요청은 조회뿐(관람객 GET /api/live-snapshot · 운영자 Supabase GET — 로그인 · 쓰기 · RPC 없음)
   빌드 결과를 incheon-live.vercel.app 주소로 띄웁니다. GET /api/live-snapshot 에는 시험용 스냅샷(부스 A-01 하나)을 돌려주고,
   다른 /api · Supabase 요청은 모두 막고 셉니다(Production 접속 없음).
   node test-example-page.mjs --live-dir <booth-live 작업 폴더> --main-dir <main 작업 폴더> --pptr-dir <puppeteer-core 가 든 폴더> [--base-ref 3212ef7] [--official "…"]
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
const BASE_REF = arg('base-ref', '3212ef7');
const MAIN = resolve(arg('main-dir'));   // main 작업 폴더 — 리허설 공통 PIN · 초기화 SQL(supabase/) 을 읽습니다
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
// 공개 PIN 은 운영 요청(2026-10-21)으로 리허설 공통 PIN 하나만 — 운영자 단추 바로 위 작은 보조 줄(.pinhint) 한 곳에 ·
// 운영자 화면이 쓰는 공통 PIN 값과 같게. 그 밖의 6자리 숫자(개별 PIN 처럼 보이는 값) · 예시 PIN · ‘확인용 PIN’ 은 여전히 없어야 합니다.
const COMMON = (CTRL.match(/var COMMON_PIN_HINT = '(\d+)';/) || [])[1];
const six = HTML.match(/\b\d{6}\b/g) || [];
const ctrlCard = HTML.split('id="ctrl-who"')[1] || '';
const HINTS = HTML.match(/<p class="card__note pinhint">[\s\S]*?<\/p>/g) || [];
const at = s => ctrlCard.indexOf(s);
t('X1 스크립트 없음 · 공개 PIN 은 운영자 카드의 단추 위 보조 줄(.pinhint) 한 곳뿐(운영 상태 미리보기 뒤 · “부스 운영자 실제 화면 열기” 앞) — 6자리 숫자는 그 값 하나(주석 포함) · 값 = 운영자 화면의 공통 PIN 값(booth-ctrl COMMON_PIN_HINT) · 예전 큰 PIN 상자(.pinnote) 없음(HTML · CSS) · ‘확인용 PIN’ · 예시 PIN 없음 · CSS 에 6자리 숫자 없음(색 값 #xxxxxx 제외)',
  !/<script/i.test(HTML) && !!COMMON && /^\d{6}$/.test(COMMON) && six.length === 1 && six[0] === COMMON &&
  HINTS.length === 1 && HINTS[0].includes(`<b class="pinhint__v">${COMMON}</b>`) && at(HINTS[0]) > at('class="cp__offs"') && at(HINTS[0]) < at('<a class="cta"') &&
  !/pinnote/.test(HTML + CSS) && !/확인용 PIN|예시 PIN/.test(HTML) && !/facts__pin/.test(CSS) && !/\b\d{6}\b/.test(CSS.replace(/#[0-9A-Fa-f]{3,8}\b/g, '')),
  JSON.stringify({ script: /<script/i.test(HTML), COMMON, six, hints: HINTS.length, order: HINTS[0] ? [at('class="cp__offs"'), at(HINTS[0]), at('<a class="cta"')] : null, pinnote: /pinnote/.test(HTML + CSS) }));
// 보조 줄의 ‘N월 N일까지 사용’ 은 운영상 안내하는 사용 기간(만료일 아님 — 서버보다 이르게 적어도 됨). 서버 기한(main 의 SQL)보다
// 늦게 적으면 안 되고, 페이지가 그날을 PIN 만료로 말하지도 않아야 합니다.
// 23:00 초기화가 대기시간만 지운다는 것은 초기화 함수에서 읽고, 페이지가 ‘초기화로 PIN 이 끝난다’ 고 말하지 않는지 봅니다.
const msql = p => readFileSync(join(MAIN, 'supabase', p), 'utf8').replace(/\r/g, '');
const PIN_SQL = msql('migration-booth-rehearsal-pin.sql'), REH_SQL = msql('migration-booth-rehearsal.sql');
const untilLit = (PIN_SQL.match(/rehearsal_common_pin_until\(\)\s*returns[\s\S]*?least\(timestamptz '(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):00\+09'/) || []);
const untilMs = untilLit.length ? Date.parse(`${untilLit[1]}-${untilLit[2]}-${untilLit[3]}T${untilLit[4]}:${untilLit[5]}:00+09:00`) : NaN;
const resetFn = (REH_SQL.match(/function private\.rehearsal_live_reset\(\)[\s\S]*?\$function\$;/) || [''])[0];
const HINT = textOf(HINTS[0] || '');
const hd = HINT.match(/· (\d{1,2})월 (\d{1,2})일까지 사용$/);
const hintEndMs = hd && untilLit.length ? Date.parse(`${untilLit[1]}-${hd[1].padStart(2, '0')}-${hd[2].padStart(2, '0')}T00:00:00+09:00`) + 24 * 3600e3 : NaN;   // 그날 끝(다음 날 0시)
const CTRL_PIN_LEN = (CTRL.match(/var PIN_LEN = isMock \? (\d) : (\d);/) || []);
t(`X1b PIN 보조 줄 = 짧은 한 줄 “운영자 공통 PIN ${COMMON} · N월 N일까지 사용” · 적은 사용 기간(그날 끝)이 서버 기한(${untilLit.slice(1, 4).join('-')} ${untilLit[4]}:${untilLit[5]} KST) 보다 늦지 않음 · 페이지에 ‘만료’ 라는 말 없음 · 23:00 초기화는 대기시간만(함수: booth_live 만 지움)이고 페이지가 초기화로 PIN 이 끝난다고 말하지 않음 · 자릿수 = 실제 운영자 화면 PIN 칸(6)`,
  !!hd && HINT === `운영자 공통 PIN ${COMMON} · ${hd[1]}월 ${hd[2]}일까지 사용` && hintEndMs <= untilMs && !/만료/.test(TEXT) &&
  /delete from public\.booth_live as l where l\.booth_id = any \(private\.rehearsal_booth_ids\(\)\)/.test(resetFn) && !/booth_pin|booth_session|booth_access/.test(resetFn) &&
  !/초기화[^.]*(PIN|핀)[^.]*(끝|무효|만료|쓸 수 없|사용할 수 없|막히|중지)/.test(TEXT) && !/(PIN|핀)[^.]*초기화(되|하)/.test(TEXT) &&
  CTRL_PIN_LEN[2] === String(COMMON.length),
  JSON.stringify({ HINT, hintEnd: Number.isNaN(hintEndMs) ? null : new Date(hintEndMs).toISOString(), until: Number.isNaN(untilMs) ? null : new Date(untilMs).toISOString(), resetFn: resetFn.length, pinLen: CTRL_PIN_LEN.slice(1) }));
const links = [...HTML.matchAll(/<a\s[^>]*>/g)].map(m => m[0]);
const href = a => (a.match(/href="([^"]*)"/) || [])[1];
const ctaText = a => textOf((HTML.split(a)[1] || '').split('</a>')[0]);
t('X2 단추 둘 = 실제 운영 화면 — 관람객 “관람객 실제 화면 보기” → / · 운영자 “부스 운영자 실제 화면 열기” → /booth-ctrl(?demo 없음) · 새 탭 · noopener · 다른 링크 없음(운영 포털로 가는 링크 없음)',
  links.length === 2 && href(links[0]) === '/' && href(links[1]) === '/booth-ctrl' && links.every(a => !/demo/.test(href(a))) &&
  links.every(a => /target="_blank"/.test(a) && /rel="[^"]*noopener/.test(a)) &&
  /^관람객 실제 화면 보기 /.test(ctaText(links[0])) && /^부스 운영자 실제 화면 열기 /.test(ctaText(links[1])) && !/체험하기/.test(TEXT),
  JSON.stringify(links.map(a => [href(a), ctaText(a)])));
const LEAD = textOf((HTML.match(/<p class="top__lead">([\s\S]*?)<\/p>/) || [])[1] || '');
const FLOW = textOf((HTML.match(/<p class="flow__text">([\s\S]*?)<\/p>/) || [])[1] || '');
t('X2b 안내 문구 — 머리 · 연결 안내 모두: 두 단추 = 실제 운영 화면 · 운영자 입력 → 실제 관람객 화면 반영 · 미리보기의 부스명 · 대기시간은 예시 · 리허설 값은 시험용 · 23:00 초기화 / 지금 연결과 맞지 않는 글(협의용 예시 · 체험 · 바뀌지 않음 · 관람객 예시) 없음',
  /두 단추 모두 실제 운영 화면을 새 탭에서 엽니다/.test(LEAD) && /부스 운영자가 입력한 대기시간은 실제 관람객 화면에 반영됩니다/.test(LEAD) &&
  /미리보기에 보이는 부스명과 대기시간은 예시입니다/.test(LEAD) && /리허설 중 입력한 값은 시험용이며 매일 23:00에 초기화됩니다/.test(LEAD) &&
  /운영자 화면에 입력한 대기시간은 실제 관람객 화면에 자동으로 반영됩니다/.test(FLOW) && /리허설 기간에 입력한 값은 시험용이며 매일 23:00에 초기화됩니다/.test(FLOW) &&
  /미리보기의 부스명과 대기시간은 예시입니다/.test(FLOW) &&
  !/협의용 예시|체험 화면|체험하기|바뀌지 않|반영되지 않|나타나지 않|관람객 예시|새로 고치면/.test(TEXT),
  JSON.stringify({ LEAD, FLOW }));
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
// 실제 관람객 화면(/)이 읽는 같은 사이트 스냅샷의 시험용 응답(live/api/live-snapshot.mjs 의 compose 모양). 부스는 A-01 하나 · 여유 5분.
const FIX_AT = new Date().toISOString();
const FIXTURE = JSON.stringify({ version: 1, generatedAt: FIX_AT, mode: 'normal', liveReady: true,
  event: { title: OFFICIAL, venue: VENUE, dateLabel: '', timeLabel: '', start: null, end: null, mapUrl: '', mapAlt: '' },
  zones: [{ key: 'A', label: 'A 구역', order: 1 }],
  booths: [{ id: 'fx-a01', no: 1, code: 'A-01', zone: 'A', name: '시험용 실제 부스', org: '시험 학교', program: '', status: '여유', waitMinutes: 5, updatedAt: FIX_AT }],
  unplaced: [] });
function guard(p, log) {
  p.on('request', req => {
    const u = new URL(req.url());
    if (u.hostname === 'incheon-live.vercel.app') {
      if (u.pathname.startsWith('/api/')) {
        log.data.push(req.method() + ' ' + u.pathname);
        if (u.pathname === '/api/live-snapshot' && req.method() === 'GET') return req.respond({ status: 200, contentType: 'application/json; charset=utf-8', body: FIXTURE });
        return req.respond({ status: 503, body: 'blocked' });
      }
      const f = join(DIST, REWRITE[u.pathname] || u.pathname.replace(/^\//, ''));
      return existsSync(f) ? req.respond({ status: 200, contentType: TYPES[extname(f)] || 'application/octet-stream', body: readFileSync(f) }) : req.respond({ status: 404, body: 'nf' });
    }
    // Supabase: 브라우저의 사전 확인(OPTIONS)은 통과시켜 실제 요청(GET · POST …)이 나가게 하고, 그 실제 요청을 세고 막습니다.
    if (u.hostname.endsWith('supabase.co')) {
      const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' };
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS, body: '' });
      log.data.push(req.method() + ' supabase' + u.pathname); return req.respond({ status: 503, headers: CORS, body: 'blocked' });
    }
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
const realLogs = { vis: [], ctrl: [] };   // 실제 두 화면이 보낸 데이터 요청 전부(X10 · X11)
const rgb = s => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
for (const vp of ['m', 'd']) {
  const ctx = await browser.createBrowserContext();
  const { p, log } = await page(ctx, vp, '/example/');
  const g = await p.evaluate(() => {
    const r = s => document.querySelector(s).getBoundingClientRect();
    const ctas = [...document.querySelectorAll('.cta')].map(a => Math.round(a.getBoundingClientRect().top + scrollY));
    const card = document.querySelectorAll('.card')[1], h = card.querySelector('.pinhint'), v = h && h.querySelector('.pinhint__v');
    const cta = card.querySelector('.cta'), cp = card.querySelector('.cp');
    // 보조 줄의 위 여백(padding-top)은 미리보기와의 간격이므로, 글이 차지하는 칸(위 여백을 뺀 상자)으로 잽니다.
    const hc = h && getComputedStyle(h), vc = v && getComputedStyle(v), hb = h && h.getBoundingClientRect();
    const hr = h && { top: hb.top + parseFloat(hc.paddingTop), bottom: hb.bottom, right: hb.right, width: hb.width, height: hb.height - parseFloat(hc.paddingTop) };
    return { sw: document.documentElement.scrollWidth, iw: innerWidth, ctas, two: r('.cards > .card:nth-child(2)').top < r('.cards > .card:first-child').bottom - 10,
      bigBox: !!document.querySelector('.pinnote'),
      pin: v ? { text: v.textContent, fs: parseFloat(hc.fontSize), vfs: parseFloat(vc.fontSize), ctaFs: parseFloat(getComputedStyle(cta).fontSize), height: Math.round(hr.height),
        color: hc.color, bg: getComputedStyle(card).backgroundColor, shown: hr.width > 0 && hc.display !== 'none' && hc.visibility !== 'hidden',
        fits: h.scrollWidth <= h.clientWidth && hr.right <= innerWidth,
        gapToCta: Math.round(cta.getBoundingClientRect().top - hr.bottom), gapFromPv: Math.round(hr.top - cp.getBoundingClientRect().bottom) } : null };
  });
  await p.screenshot({ path: `${OUT}/example-${vp}.jpg`, type: 'jpeg', quality: 82, fullPage: true });
  geo[vp] = { ...g, log };
  // 단추 → 새 탭(둘 다 실제 운영 화면). 운영자 화면은 열기만 합니다(로그인 · 입력 없음).
  const tabs = [];
  for (const i of [0, 1]) {
    const target = new Promise(res => browser.once('targetcreated', res));
    await p.evaluate(k => document.querySelectorAll('.cta')[k].click(), i);
    const tg = await target; const np = await tg.page();
    await np.setViewport(VP[vp]); await np.setRequestInterception(true);
    const nlog = { data: [], other: [], err: [] }; guard(np, nlog);
    await np.reload({ waitUntil: 'networkidle0' }); await wait(1000);
    tabs.push({ url: new URL(np.url()).pathname + new URL(np.url()).search,
      ...(await np.evaluate(() => {
        const b = document.getElementById('demobar'), pd = document.getElementById('pin-demo');
        let store = null; try { store = localStorage.getItem('aisw-booth-demo-v3'); } catch (e) { store = 'err'; }
        return { demo: !!b && !b.hidden, demoPin: !!pd && !pd.hidden, store: store !== null, fx: /시험용 실제 부스/.test(document.body.innerText) };
      })), log: nlog });
    realLogs[i ? 'ctrl' : 'vis'].push(...nlog.data);
    await np.screenshot({ path: `${OUT}/example-${vp}-${i ? 'ctrl' : 'visitor'}-tab.jpg`, type: 'jpeg', quality: 78 });
    await np.close();
  }
  geo[vp].tabs = tabs;
  await ctx.close();
}
const L = v => `${v.sw}/${v.iw} data=${v.log.data.length} err=${v.log.err.length} other=${v.log.other.length}`;
console.log(`  (기록) PIN 보조 줄 ${JSON.stringify(['m', 'd'].map(vp => geo[vp].pin && { vp, ...geo[vp].pin, cr: +contrast(geo[vp].pin.color, geo[vp].pin.bg).toFixed(1), ctas: geo[vp].ctas }))}`);
t('X8 /example/ 390 · 1440 — 가로 넘침 없음 · 페이지 오류 0 · 데이터 요청 0 · 1440 은 두 카드 나란히 · 두 단추 높이 같음 · 큰 PIN 상자 없음 · PIN 보조 줄은 작고(글자 14px 이하 · 단추 글자보다 작음 · 두 줄 이하) 읽히며(바탕 대비 4.5:1 이상) 카드 안에 들어가고, 미리보기 아래(12px 이상) · 단추 바로 위(8~24px)',
  ['m', 'd'].every(vp => { const q = geo[vp], k = q.pin; return q.sw <= q.iw && !q.log.err.length && !q.log.data.length && !q.bigBox && k && k.text === COMMON && k.shown && k.fits &&
    k.fs <= 14 && k.fs < k.ctaFs && k.vfs < k.ctaFs && k.height <= 48 && contrast(k.color, k.bg) >= 4.5 && k.gapToCta >= 8 && k.gapToCta <= 24 && k.gapFromPv >= 12; }) &&
    geo.d.two && geo.d.ctas[0] === geo.d.ctas[1],
  `m ${L(geo.m)} · d ${L(geo.d)} two=${geo.d.two} ctas=${geo.d.ctas} pin=${JSON.stringify(['m', 'd'].map(vp => geo[vp].pin && { ...geo[vp].pin, cr: contrast(geo[vp].pin.color, geo[vp].pin.bg).toFixed(1) }))}`);
t('X9 단추 → 새 탭 = 실제 운영 화면(390 · 1440) — 관람객 / (시험용 스냅샷의 부스를 그림) · 운영자 /booth-ctrl · 둘 다 협의용 예시 띠 없음 · 예시 PIN 상자 없음 · 예시 저장소를 만들지 않음 · 페이지 오류 0',
  ['m', 'd'].every(vp => geo[vp].tabs.length === 2 && geo[vp].tabs[0].url === '/' && geo[vp].tabs[1].url === '/booth-ctrl' && geo[vp].tabs[0].fx &&
    geo[vp].tabs.every(x => !x.demo && !x.demoPin && !x.store && !x.log.err.length)),
  JSON.stringify(['m', 'd'].map(vp => geo[vp].tabs.map(x => [x.url, x.demo, x.demoPin, x.store, x.fx, x.log.data.length, x.log.err.length]))));
// 열기만 했을 때 운영자 화면이 보내는 요청: Supabase REST GET(설정 · 구역 · 부스)뿐이어야 합니다 — PIN 로그인(booth_pin_login) · 대기시간 저장(booth_ctrl_set · touch) 같은 RPC(POST) 없음.
const ctrlBad = realLogs.ctrl.filter(x => !/^GET supabase\/rest\/v1\/(settings|zones|booths)$/.test(x));
t('X10 실제 운영자 화면(/booth-ctrl)을 열기만 하면 조회뿐 — 데이터 요청이 모두 Supabase GET(settings · zones · booths) · RPC · 로그인 · 쓰기 0(이 시험은 Supabase 를 막고 셉니다)',
  realLogs.ctrl.length > 0 && !ctrlBad.length, `${realLogs.ctrl.length}건 ${JSON.stringify([...new Set(realLogs.ctrl)])} · 그 밖 ${JSON.stringify(ctrlBad)}`);
console.log(`  (기록) 운영자 화면 요청 ${realLogs.ctrl.length}건: ${JSON.stringify([...new Set(realLogs.ctrl)])} · 관람객 화면 요청 ${realLogs.vis.length}건: ${JSON.stringify([...new Set(realLogs.vis)])}`);
const realBad = realLogs.vis.filter(x => x !== 'GET /api/live-snapshot');
t('X11 실제 관람객 화면의 요청은 조회뿐 — 모든 데이터 요청이 GET /api/live-snapshot(같은 사이트 · CDN 캐시 주소) · Supabase 직접 요청 0 · 쓰기(POST · PATCH · PUT · DELETE) 0',
  realLogs.vis.length > 0 && !realBad.length, `${realLogs.vis.length}건 · 그 밖 ${JSON.stringify(realBad)}`);
await browser.close();

const ok = results.filter(r => r.ok).length;
const md = ['# /example/ 화면 안내 페이지 시험', '', `- 대상: ${LIVE} (${git('rev-parse', '--short', 'HEAD').trim()}) · 기준 판 ${BASE_REF}`, `- 공식 명칭: ${OFFICIAL} · ${VENUE}`, '',
  '| 결과 | 항목 | 메모 |', '|---|---|---|', ...results.map(r => `| ${r.ok ? '통과' : '**실패**'} | ${r.name} | ${r.note.replace(/\|/g, '/')} |`), '', `**${ok} / ${results.length} 통과**`].join('\n');
writeFileSync(join(OUT, 'example-page-test-report.md'), md);
console.log(`\n${ok} / ${results.length} 통과 → out/example/example-page-test-report.md`);
process.exit(ok === results.length ? 0 : 1);
