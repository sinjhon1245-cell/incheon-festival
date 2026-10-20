/* ===================================================================
   운영자 PIN 로그인 — 부스 고르기 화면 학교명 표시 · 찾기 시험 (로컬 복제 DB · Production 접속 없음)
   ───────────────────────────────────────────────────────────────────
   복제 DB 를 2026-10-19 Production 과 같은 단계로 만들고(test-rehearsal-pin.mjs 와 같은 준비 + 리허설 공통 PIN 적용),
   booth-ctrl.html 두 판을 jsdom 에서 엽니다.
     --ctrl-dir  시험할 판 — 지금은 claude/ux-ctrl-status(PR #12 · 학교명 #11 + 운영 상태 단추 · ‘지금 확인’ 설명)
     --live-dir  견줄 앞 판 booth-live 7ebf536(학교명 #11 이전)
     --pin-dir   리허설 공통 PIN SQL 이 있는 main 작업 폴더(로그인 흐름 확인용)
     --base-ref  #12 이전 Production booth-live(기본 7ff890f) — S6 의 ‘바뀐 줄’ 확인용(--ctrl-dir 저장소의 git 으로 읽음)
   S1 표시 — 84곳 모두 둘째 줄 = DB 기관(학교)명 그대로 · 공동 운영 부스 · 첫 줄은 앞 판과 같음 ·
      CSS 는 규칙 단위로 앞 판과 견줘 의도한 규칙(학교명 줄 · 운영 상태 단추 · ‘지금 확인’)만 바뀌고 나머지는 그대로
   S2 찾기 — 84곳 각각: 학교명 전체 · 일부 · 띄어쓰기 · 부스명 · 번호(R4-07 · r4-07 · R407 · 전각 · 07 · 7) · 다른 구역에서
   S3 앞 판 동작 유지 — 번호 · 부스명 찾기 결과가 앞 판과 같은 순서로 앞에 옴
   S4 Enter · 안내 글 · 결과 없음 문구 · 예시 부스 · 예시 모드(?demo)
   S5 로그인 — 학교명으로 찾아 고른 부스에 공통 PIN 로그인 · 저장 · QR 로 열기 · DB 쓰기는 로그인 · 저장만
   S6 운영 상태 단추 · ‘지금 확인’(PR #12) — 잠시 중단 · 오늘 마감을 고르면 대기시간 단추와 같은 ‘선택됨’ 모양 ·
      둘째 줄 설명 · 보내는 중에도 설명 유지 · 저장 · 확인 동작과 DB 결과는 앞 판과 같음 · 바뀐 줄은 이 둘뿐
   ⚠️ 열쇠 · PIN · 세션은 복제 DB 의 가짜 값이고 출력하지 않습니다.
   쓰는 법: node --max-old-space-size=8192 scripts/booth-data/test-ctrl-school.mjs --pglite-dir <> --jsdom-dir <> \
              --ctrl-dir ../incheon-festival-ux-ctrl --live-dir ../incheon-festival-rh-live --pin-dir ../incheon-festival-rh-pin
   결과: out/rehearsal/ctrl-school-test-report.md
   =================================================================== */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readCsv } from './lib/csv.mjs';
import { loadPglite, openReplica } from './lib/replica.mjs';
import { makeRest } from './lib/fake-rest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT = resolve(HERE, 'out');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const CTRL = resolve(arg('ctrl-dir', resolve(REPO, '../incheon-festival-rh-ctrl-school')));
const LIVE = resolve(arg('live-dir', resolve(REPO, '../incheon-festival-rh-live')));
const PIN = resolve(arg('pin-dir', resolve(REPO, '../incheon-festival-rh-pin')));
const BASE_REF = arg('base-ref', '7ff890f');
const { JSDOM, VirtualConsole } = createRequire(join(resolve(arg('jsdom-dir')), 'package.json'))('jsdom');
const lib = await loadPglite(arg('pglite-dir'));
const manifest = readCsv(resolve(OUT, 'staging', 'manifest.csv'));
const plan = readCsv(resolve(OUT, 'gate4r', 'plan-R.csv'));
const snap = readCsv(resolve(OUT, readdirSync(OUT).filter(f => /^prod-snapshot-\d{8}\.csv$/.test(f)).sort().pop()));
const R = await openReplica(lib, { snap, manifest });
const db = R.db;
const rest = makeRest(R);
const git = (dir, ...a) => { try { return execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim(); } catch { return '?'; } };
const results = [];
function t(name, ok, note = '') { results.push({ name, ok: !!ok, note: ok ? '' : String(note).slice(0, 400) }); console.log(`${ok ? '통과' : '실패'}  ${name}${note && !ok ? '  — ' + String(note).slice(0, 400) : ''}`); }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000, step = 30) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await wait(step); } return false; }
const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const q1 = async (sql, p) => (await db.query(sql, p)).rows[0];
const COMMON = '123456';   // 운영 준비용 공통 PIN(서버에 이미 있는 값) — 출력하지 않음

// ── 준비: Production 과 같은 단계 + 리허설 공통 PIN ──────────────────────
await db.exec(readFileSync(resolve(HERE, 'dryrun/replica-functions-extra.sql'), 'utf8'));
for (const f of [resolve(REPO, 'supabase/migration-booth-preview.sql'), resolve(OUT, 'gate3c/C-02-transition.sql'), resolve(OUT, 'gate3c/Q-02-qr-preissue.sql'),
  resolve(OUT, 'gate4r/T-02-assign.sql'), resolve(OUT, 'gate4r/T-03-publish.sql')]) {
  const r = await R.run(readFileSync(f, 'utf8')); if (!r.ok) throw new Error(f + ' ' + r.error);
}
await db.exec(readFileSync(join(PIN, 'supabase/migration-booth-rehearsal.sql'), 'utf8'));
const SKIP = new Set(['private.booth_pin_pepper', 'private.booth_client_ip', 'public.admin_booth_credentials', 'public.admin_booth_ip_probe']);
for (const f of ['migration-booth-pin.sql', 'migration-booth-example-pin.sql', 'migration-booth-pin-checked.sql']) {
  const lines = readFileSync(join(PIN, 'supabase', f), 'utf8').replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^create (?:or replace )?function (\S+?)\(/); if (!m) continue;
    let j = i; while (lines[j] !== '$$;') j++;
    if (!SKIP.has(m[1])) await db.exec(lines.slice(i, j + 1).join('\n').replace(/^create function/, 'create or replace function'));
    i = j;
  }
}
await db.exec(`update public.settings set booth_sample_common_pin_enabled = false where id = 1;
  update public.zones set is_published = false where key !~ '^R';
  update public.booths set is_published = false where org ~ '^\\s*\\[예시\\]';`);
await db.exec(readFileSync(join(PIN, 'supabase/migration-booth-rehearsal-pin.sql'), 'utf8'));

const REAL = (await db.query(`select b.id, b.zone_key, b.no, b.name, b.org,
    coalesce(nullif(b.code, ''), b.zone_key || '-' || lpad(b.no::text, 2, '0')) code
  from public.booths b where coalesce(b.org, '') !~ '^\\s*\\[예시\\]' order by b.zone_key, b.no`)).rows;
const byCode = Object.fromEntries(REAL.map(b => [b.code, b]));
const fpData = (await q1(`select md5(string_agg(b.id::text || ':' || coalesce(b.org, '') || ':' || coalesce(b.name, '') || ':' || coalesce(b.zone_key, '') || ':' || coalesce(b.no::text, ''), ',' order by b.id)) h
  from public.booths b where coalesce(b.org, '') !~ '^\\s*\\[예시\\]'`)).h;
const anonRows = await rest('booths?select=id,org');
t('S0 데이터 — 실제 84곳 기관(학교)명 모두 있음 · 복제 DB 의 id · 기관명 · 부스명 · 구역 · 번호 지문 = Production(10-19 f99da8b2) · 공개 API(익명)로 기관명이 읽힘(추가 API 필요 없음)',
  REAL.length === 84 && REAL.every(b => (b.org || '').trim()) && fpData === 'f99da8b2d99cbb76aa03cb6562222b54' &&
  anonRows.status === 200 && anonRows.body.filter(x => REAL.some(b => b.id === x.id) && x.org).length === 84, `${REAL.length} ${fpData} ${anonRows.status}`);

// ── 화면 ────────────────────────────────────────────────────────────────
const inline = (html, dir, files) => {
  for (const p of files) {
    const src = readFileSync(join(dir, p), 'utf8').replace(/<\/script/gi, '<\\/script');
    html = html.replace(new RegExp(`<script src="${p.replace(/[.]/g, '\\.')}"></script>`), () => `<script>${src}</script>`);
  }
  return html.replace(/<link[^>]+stylesheet[^>]*>/g, '');
};
async function anonFetch(u, init = {}) {
  const sx = String(u), i = sx.indexOf('/rest/v1/');
  if (i < 0) throw new Error('예상 밖 요청');
  const path = sx.slice(i + 9), method = String(init.method || 'GET').toUpperCase();
  let status = 200, body;
  if (method === 'GET') { const rr = await rest(path); status = rr.status; body = rr.body; }
  else if (path.startsWith('rpc/')) {
    const name = path.slice(4).split('?')[0];
    const args = init.body ? JSON.parse(init.body) : {};
    const keys = Object.keys(args);
    try { body = await R.asAnon(`select * from public.${name}(${keys.map((k, j) => `${k} => $${j + 1}`).join(', ')})`, keys.map(k => args[k])); }
    catch (e) { status = e.code === '42501' ? 401 : 400; body = { code: e.code, message: e.message, hint: e.hint || null, details: null }; }
  } else { status = 405; body = {}; }
  const out = JSON.stringify(body);
  return { ok: status < 400, status, text: async () => out, json: async () => JSON.parse(out), headers: { get: () => 'application/json' } };
}
const HTML = { new: inline(readFileSync(join(CTRL, 'booth-ctrl.html'), 'utf8'), CTRL, ['assets/config.js', 'assets/booth-core.js', 'assets/mock-data.js']),
               old: inline(readFileSync(join(LIVE, 'booth-ctrl.html'), 'utf8'), LIVE, ['assets/config.js', 'assets/booth-core.js', 'assets/mock-data.js']) };
const quiet = () => { const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); return vc; };
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
function openCtrl(which, { url = 'https://incheon-live.vercel.app/booth-ctrl.html', seed } = {}) {
  const dom = new JSDOM(HTML[which], {
    url, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: quiet(),
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.scrollTo = () => {}; w.fetch = anonFetch; w.console.warn = () => {};
      // jsdom 에는 scrollIntoView 가 없습니다(브라우저에는 있음) — ‘오늘 마감’ 묻는 칸을 열 때 부르므로 빈 함수로 둡니다.
      w.Element.prototype.scrollIntoView = function () {};
      if (seed) for (const [k, v] of Object.entries(seed)) w.localStorage.setItem(k, v);
    }
  });
  const errors = []; dom.window.addEventListener('error', e => errors.push(e.message));
  return { dom, d: dom.window.document, w: dom.window, errors };
}
async function toZone(which, zone) {   // 시작 → 'PIN으로 시작' → 구역
  const c = openCtrl(which);
  await until(() => !!c.d.querySelector('[data-act="pin-start"]'), 8000);
  await wait(100);
  click(c.w, c.d.querySelector('[data-act="pin-start"]'));
  await until(() => c.d.querySelectorAll('#pin-zones [data-zone]').length > 0, 8000);
  click(c.w, c.d.querySelector(`#pin-zones [data-zone="${zone}"]`));
  await until(() => c.d.querySelectorAll('#pin-booths [data-booth]').length > 0, 8000);
  return c;
}
function cards(c) {
  return [...c.d.querySelectorAll('#pin-booths .pick')].map(el => {
    const tt = el.querySelector('.pick__t');
    const own = tt ? [...tt.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('') : '';
    return { id: el.getAttribute('data-booth'), k: text(el.querySelector('.pick__k')), name: own.trim(), org: text(el.querySelector('.pick__o')),
             sub: text(el.querySelector('.pick__s')), other: el.classList.contains('pick--other'), all: text(el) };
  });
}
function search(c, v) {
  const q = c.d.getElementById('pin-q');
  q.value = v; q.dispatchEvent(new c.w.Event('input', { bubbles: true }));
  return { cards: cards(c), note: c.d.getElementById('pin-find-none').hidden ? '' : text(c.d.getElementById('pin-find-none')) };
}
const disp = org => String(org == null ? '' : org).replace(/^\s*\[예시\]\s*/, '');
const ZONES = ['R1', 'R2', 'R3', 'R4'];
const fp0 = await q1(`select (select concat(count(*), '/', coalesce(max(id), 0)) from public.booth_live_log) log, (select count(*) from public.booth_session) sess,
  (select md5(coalesce(string_agg(row(l.*)::text, ',' order by l.booth_id), '')) from public.booth_live l) live`);

// ══ S1 표시 ═══════════════════════════════════════════════════════════════
const C = {}, O = {};
for (const z of ZONES) { C[z] = await toZone('new', z); O[z] = await toZone('old', z); }
const shownNew = ZONES.flatMap(z => cards(C[z]).map(x => Object.assign({ zone: z }, x)));
const wrong = shownNew.filter(x => { const b = REAL.find(r => r.id === x.id); return !b || x.org !== disp(b.org) || x.name !== b.name || x.k !== String(b.no).padStart(2, '0'); });
t('S1-1 84곳 모두 — 첫 줄 번호 + 부스명, 둘째 줄 = DB 기관(학교)명 그대로(구역마다 21곳)',
  shownNew.length === 84 && ZONES.every(z => cards(C[z]).length === 21) && wrong.length === 0, JSON.stringify(wrong.slice(0, 3)));
const j04 = shownNew.find(x => x.id === byCode['R1-04'].id);
t('S1-2 공동 운영 부스 R1-04 — 둘째 줄 “인천연일학교, 인천청선학교”(DB 값 그대로 · 두 학교 모두)', j04 && j04.org === '인천연일학교, 인천청선학교', j04 && j04.org);
const sameFirst = ZONES.every(z => {
  const a = cards(C[z]), b = cards(O[z]);
  return a.length === b.length && a.every((x, i) => x.id === b[i].id && x.k === b[i].k && x.name === b[i].name && !b[i].org);
});
t('S1-3 앞 판과 같은 부스 · 같은 순서 · 같은 번호 · 같은 부스명 — 바뀐 것은 둘째 줄(학교명)뿐', sameFirst);
const markup = C.R1.d.querySelector('#pin-booths .pick');
t('S1-4 마크업 — 학교명은 부스명 칸(.pick__t) 안의 둘째 줄(.pick__o) · 화면 읽기 순서 “번호 → 부스명 → 학교명”',
  !!markup.querySelector('.pick__t > .pick__o') && markup.querySelector('.pick__t').firstChild.nodeType === 3);
// CSS 를 규칙(선택자 + 선언 목록) 단위로 읽어 앞 판과 견줍니다. 주석 · 빈칸 · 줄 끝 차이는 보지 않고,
// @media · @supports 안의 규칙은 그 조건을 앞에 붙여 따로 셉니다.
function cssRules(src) {
  const s = src.replace(/\r/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = []; let i = 0;
  (function parse(prefix) {
    while (i < s.length) {
      const open = s.indexOf('{', i), close = s.indexOf('}', i);
      if (close !== -1 && (open === -1 || close < open)) { i = close + 1; return; }
      if (open === -1) { i = s.length; return; }
      const sel = s.slice(i, open).trim().replace(/\s+/g, ' ');
      i = open + 1;
      if (/^@(media|supports|keyframes)/.test(sel)) { parse(prefix + sel + ' » '); continue; }
      const c = s.indexOf('}', i);
      out.push({ sel: prefix + sel, decl: s.slice(i, c).split(';').map(x => x.trim().replace(/\s+/g, ' ')).filter(Boolean) });
      i = c + 1;
    }
  })('');
  return out;
}
const rulesNew = cssRules(readFileSync(join(CTRL, 'assets/booth-ctrl.css'), 'utf8'));
const rulesOld = cssRules(readFileSync(join(LIVE, 'assets/booth-ctrl.css'), 'utf8'));
const ruleOf = (rs, sel) => rs.filter(r => r.sel === sel);
const declOf = (rs, sel) => { const r = ruleOf(rs, sel); return r.length === 1 ? r[0].decl : null; };
const pickO = declOf(rulesNew, '.pick__o') || [];
t('S1-5 스타일 — .pick__o 13px(부스명 15px 보다 작게) · 보조 글자색(--muted) · 위 간격 3px · 줄 바꿈 허용(부모 overflow-wrap)',
  pickO.includes('font-size: 13px') && pickO.includes('color: var(--muted)') && pickO.includes('margin-top: 3px') && !declOf(rulesOld, '.pick__o'), pickO.join('; '));
// 앞 판(7ebf536)에서 의도해 바꾼 규칙 — 학교명 줄(#11) · ‘지금 확인’ 설명(C-2) · 운영 상태 고른 모양(C-1)
const INTENDED = ['.pick__o', '.still', '.still__s', '.off.is-on', '.off.is-on .off__s, #btn-closed.is-on .off__t', '#btn-closed.is-on'];
const restKey = rs => rs.filter(r => !INTENDED.includes(r.sel)).map(r => r.sel + ' {' + r.decl.join('; ') + '}');
const restO = restKey(rulesOld), restN = restKey(rulesNew);
const restDiff = restO.filter((x, k) => restN[k] !== x).concat(restN.slice(restO.length));
const stillO = declOf(rulesOld, '.still') || [], stillN = declOf(rulesNew, '.still') || [];
const stillAdded = stillN.filter(x => !stillO.includes(x));
t(`S1-6 CSS 규칙 ${rulesNew.length}개를 앞 판과 하나씩 견줌 — 의도한 규칙 말고는 선택자 · 선언 · 순서 모두 같음(${restN.length}개) · ‘지금 확인’ 단추(.still)는 앞 판 선언을 모두 지키고 두 줄 배치(세로 flex · 가운데 · 간격 2px · 안쪽 여백)만 더함 · 고르지 않은 ‘오늘 운영 마감’ 빨간 글자 그대로`,
  restDiff.length === 0 && restO.length === restN.length && stillO.length > 0 && stillO.every(x => stillN.includes(x)) &&
  sameList(stillAdded, ['display: flex', 'flex-direction: column', 'align-items: center', 'justify-content: center', 'gap: 2px', 'padding: 8px 12px']) &&
  sameList(declOf(rulesNew, '#btn-closed .off__t') || [], ['color: var(--danger)']),
  `다른 규칙 ${restDiff.length}: ${restDiff.slice(0, 3).join(' / ')} | .still 더함 ${stillAdded.join('; ')}`);
function sameList(a, b) { return a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|'); }

// ══ S2 찾기 정확도(84곳) ═══════════════════════════════════════════════════
const fails = [];
const firstIs = (r, id) => r.cards.length > 0 && r.cards[0].id === id;
const has = (r, id) => r.cards.some(x => x.id === id);
const spaced = s => s.split('').join(' ');
const fw = s => s.replace(/[A-Za-z0-9-]/g, ch => (ch === '-' ? '－' : String.fromCharCode(ch.charCodeAt(0) + 0xFEE0)));
for (const b of REAL) {
  const c = C[b.zone_key];
  const org = disp(b.org), z = b.zone_key, nn = String(b.no).padStart(2, '0');
  const part = org.replace(/^인천/, '').slice(0, 2);
  const checks = [
    ['학교명 전체', firstIs(search(c, org), b.id)],
    ['학교명 일부 ' + part, has(search(c, part), b.id)],
    ['학교명 띄어쓰기', firstIs(search(c, spaced(org)), b.id)],
    ['부스명 전체', firstIs(search(c, b.name), b.id)],
    [`${z}-${nn}`, firstIs(search(c, `${z}-${nn}`), b.id)],
    [`소문자`, firstIs(search(c, `${z}-${nn}`.toLowerCase()), b.id)],
    [`붙임 ${z}${nn}`, firstIs(search(c, `${z}${nn}`), b.id)],
    ['전각', firstIs(search(c, fw(`${z}-${nn}`)), b.id)],
    ['공백 섞음', firstIs(search(c, ` ${z} - ${nn} `), b.id)],
    [nn, firstIs(search(c, nn), b.id)],
    [String(b.no), firstIs(search(c, String(b.no)), b.id)]
  ];
  const oz = ZONES.find(x => x !== z), oc = C[oz];
  const r1 = search(oc, `${z}-${nn}`), r2 = search(oc, org);
  checks.push(['다른 구역에서 번호', r1.cards[0] && r1.cards[0].id === b.id && r1.cards[0].other]);
  checks.push(['다른 구역에서 학교명', r2.cards.some(x => x.id === b.id && x.other && /다른 구역/.test(x.sub))]);
  for (const [k, ok] of checks) if (!ok) fails.push(`${b.code} ${k}`);
}
for (const z of ZONES) search(C[z], '');
t('S2-1 84곳 × 13가지 찾기 — 학교명 전체 · 일부(2자) · 띄어쓰기 · 부스명 · R4-07 · 소문자 · 붙임(R407) · 전각 · 공백 섞음 · 07 · 7 · 다른 구역에서 번호 · 다른 구역에서 학교명',
  fails.length === 0, `${fails.length}건: ${fails.slice(0, 12).join(' | ')}`);
const ex = [['삼산', 'R1'], ['로봇', 'R1'], ['R4-07', 'R4'], ['R4-07', 'R1'], ['청선', 'R1'], ['인천 신석 초', 'R1']].map(([v, z]) => {
  const r = search(C[z], v); search(C[z], '');
  return `${v}@${z} → ${r.cards.map(x => (x.other ? REAL.find(b => b.id === x.id).code + '*' : x.k)).join(',') || '없음'}`;
});
const exOk = ex[0] === '삼산@R1 → R3-21*,R4-07*' && ex[2] === 'R4-07@R4 → 07' && ex[3] === 'R4-07@R1 → R4-07*' && ex[4] === '청선@R1 → 04' && ex[5] === '인천 신석 초@R1 → 01' && /^로봇@R1 → \d/.test(ex[1]);
t('S2-2 요청 예시 — ‘삼산’(R1 에서: 다른 구역 R3-21 · R4-07) · ‘로봇’ · ‘R4-07’(R4 에서 07, 다른 구역에서 맨 위) · ‘청선’(공동 운영) · ‘인천 신석 초’', exOk, ex.join(' | '));
const many = search(C.R1, '중학교'); search(C.R1, '');
const noneR = search(C.R1, '없는학교이름'); search(C.R1, '');
t('S2-3 결과 없음 문구 “… 검색 결과가 없어요. 부스 번호 · 부스명 · 학교명을 다시 확인해 주세요.” · 이 구역에 맞는 부스가 있으면 다른 구역은 섞지 않음',
  noneR.cards.length === 0 && noneR.note === '“없는학교이름” 검색 결과가 없어요. 부스 번호 · 부스명 · 학교명을 다시 확인해 주세요.' &&
  many.cards.length > 0 && many.cards.every(x => !x.other), JSON.stringify([noneR.note, many.cards.length]));
// 다른 구역 결과가 5곳을 넘으면 5곳 + 안내
// 실제 데이터에는 '이 구역엔 없고 다른 구역 6곳 이상' 인 글이 없어, 복제 DB 에만 시험 부스 6곳(R2-90~95)을 잠시 넣어 봄
const TEST_IDS = [0, 1, 2, 3, 4, 5].map(i => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`);
for (const [i, id] of TEST_IDS.entries()) {
  await db.query(`insert into public.booths (id, zone_key, no, name, org, org_type, is_published, sort_order) values ($1, 'R2', $2, $3, '시험용가나다학교', '기타', true, 9000 + $2)`, [id, 90 + i, '시험 부스 ' + i]);
}
const cutC = await toZone('new', 'R1');
const cut = search(cutC, '가나다');
await db.query('delete from public.booths where id = any($1::uuid[])', [TEST_IDS]);
cutC.dom.window.close();
t('S2-4 다른 구역에서 찾은 부스가 5곳 넘으면 5곳만(구역 · 번호 순) · “다른 구역에서 더 찾았어요. 학교명이나 부스명을 조금 더 입력해 주세요.”(시험 부스 6곳은 뒤에 지움)',
  cut.cards.length === 5 && cut.cards.every(x => x.other && TEST_IDS.includes(x.id)) && cut.cards[0].id === TEST_IDS[0] &&
  cut.note === '다른 구역에서 더 찾았어요. 학교명이나 부스명을 조금 더 입력해 주세요.' && +(await q1('select count(*) n from public.booths where id = any($1::uuid[])', [TEST_IDS])).n === 0,
  JSON.stringify([cut.cards.length, cut.note]));

// ══ S3 앞 판 동작 유지 ════════════════════════════════════════════════════
const diffs = [];
const oldR4 = [];
for (const z of ZONES) {
  const qs = new Set();
  for (const b of REAL.filter(x => x.zone_key === z)) {
    qs.add(String(b.no)); qs.add(String(b.no).padStart(2, '0')); qs.add(b.name); qs.add(b.name.replace(/\s+/g, '').slice(0, 2)); qs.add(b.name.split(/\s+/)[0]);
  }
  for (const other of ZONES.filter(x => x !== z)) qs.add(`${other.slice(0, 1)}-1`);
  for (const v of qs) {
    const a = search(C[z], v).cards.map(x => x.id + (x.other ? '*' : '')), o = search(O[z], v).cards.map(x => x.id + (x.other ? '*' : ''));
    if (o.some((id, i) => a[i] !== id)) diffs.push(`${z} “${v}” 앞 ${o.length} · 새 ${a.length}`);
  }
  const bz = REAL.find(x => x.zone_key === z);
  oldR4.push(search(O[z], bz.code).cards.length);
  search(C[z], ''); search(O[z], '');
}
t('S3-1 번호 · 부스명 · 부스명 일부로 찾을 때 앞 판의 결과가 같은 순서로 맨 앞에 옴(새 판은 학교명이 맞는 부스를 그 뒤에 더할 뿐)',
  diffs.length === 0, diffs.slice(0, 8).join(' | '));
t('S3-2 (고친 점) 앞 판은 숫자가 든 구역 번호 ‘R1-01’ 꼴을 자기 구역에서 찾지 못함(결과 0) → 새 판은 찾음(S2-1)', oldR4.every(n => n === 0), JSON.stringify(oldR4));

// ══ S4 Enter · 안내 글 · 예시 ═════════════════════════════════════════════
const e1 = C.R4, q = e1.d.getElementById('pin-q');
q.value = 'R4-07'; q.dispatchEvent(new e1.w.Event('input', { bubbles: true }));
q.dispatchEvent(new e1.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
await wait(50);
const ent1 = !e1.d.getElementById('pin-s3').hidden && text(e1.d.getElementById('pin-code')) === 'R4-07';
const e2 = await toZone('new', 'R1'), q2 = e2.d.getElementById('pin-q');
q2.value = disp(byCode['R3-21'].org); q2.dispatchEvent(new e2.w.Event('input', { bubbles: true }));
q2.dispatchEvent(new e2.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
await wait(50);
const ent2 = !e2.d.getElementById('pin-s3').hidden && text(e2.d.getElementById('pin-code')) === 'R3-21' && text(e2.d.getElementById('pin-name')) === byCode['R3-21'].name;
t('S4-1 Enter — ‘R4-07’ → R4-07 PIN 입력으로 · 다른 구역 학교명 하나만 맞으면(R1 에서 ‘삼산중학교’) 그 부스(R3-21) PIN 입력으로 — 구역 → 부스 → PIN 흐름 그대로',
  ent1 && ent2, JSON.stringify([text(e1.d.getElementById('pin-code')), text(e2.d.getElementById('pin-code'))]));
const ph = C.R1.d.getElementById('pin-q').getAttribute('placeholder'), lb = text(C.R1.d.querySelector('label[for="pin-q"]'));
t('S4-2 찾기 칸 안내 글 “부스 번호 · 부스명 · 학교명으로 찾기”(화면 · 화면 읽기 이름 모두)', ph === '부스 번호 · 부스명 · 학교명으로 찾기' && lb === ph, `${ph} | ${lb}`);
// 예시 부스(운영 준비용)가 공개되면 '[예시]' 를 떼고 보임 — 시험 뒤 되돌림
await db.exec("update public.zones set is_published = true where key = 'A'");
await db.exec(`update public.booths set is_published = true where zone_key = 'A' and org ~ '^\\s*\\[예시\\]'`);
const exA = await toZone('new', 'A');
const exCards = cards(exA);
const exRows = (await db.query(`select id, org from public.booths where zone_key = 'A' and is_published`)).rows;
await db.exec(`update public.booths set is_published = false where zone_key = 'A' and org ~ '^\\s*\\[예시\\]'`);
await db.exec("update public.zones set is_published = false where key = 'A'");
t('S4-3 예시 부스(공개될 때) — 둘째 줄은 ‘[예시]’ 를 뗀 기관명(관람객 화면과 같은 규칙) · 예시 부스 행은 바꾸지 않음(시험 뒤 비공개로 되돌림)',
  exCards.length === exRows.length && exCards.length > 0 && exCards.every(x => x.org === disp(exRows.find(r => r.id === x.id).org) && !x.org.includes('[예시]')),
  JSON.stringify(exCards.slice(0, 2)));
const demo = openCtrl('new', { url: 'https://incheon-live.vercel.app/booth-ctrl.html?demo=1' });
await until(() => !!demo.d.querySelector('[data-act="pin-start"]'), 8000); await wait(100);
click(demo.w, demo.d.querySelector('[data-act="pin-start"]'));
await until(() => demo.d.querySelectorAll('#pin-zones [data-zone]').length > 0, 8000);
click(demo.w, demo.d.querySelector('#pin-zones [data-zone]'));
await until(() => demo.d.querySelectorAll('#pin-booths .pick').length > 0, 8000);
const dc = cards(demo);
t('S4-4 협의용 예시 모드(?demo) — 예시 부스 칸에도 둘째 줄 기관명 · 오류 없음', dc.length > 0 && dc.every(x => !!x.org) && !demo.errors.length, JSON.stringify([dc.length, demo.errors]));
demo.dom.window.close();

// ══ S5 로그인 · QR ═════════════════════════════════════════════════════
const fpMid = await q1(`select (select concat(count(*), '/', coalesce(max(id), 0)) from public.booth_live_log) log, (select count(*) from public.booth_session) sess,
  (select md5(coalesce(string_agg(row(l.*)::text, ',' order by l.booth_id), '')) from public.booth_live l) live`);
t('S5-0 여기까지 화면을 열고 찾기만 했을 때 DB 쓰기 없음(대기 값 · 기록 · 세션 그대로)', JSON.stringify(fp0) === JSON.stringify(fpMid), JSON.stringify([fp0, fpMid]));
const KEY_PIN = 'aisw-boothctrl-pin', KEY_DEVICE = 'aisw-boothctrl-device';
const L = await toZone('new', 'R2');
const lq = L.d.getElementById('pin-q');
lq.value = disp(byCode['R2-05'].org).replace(/^인천/, ''); lq.dispatchEvent(new L.w.Event('input', { bubbles: true }));
const pickEl = L.d.querySelector(`#pin-booths [data-booth="${byCode['R2-05'].id}"]`);
click(L.w, pickEl);
await until(() => !L.d.getElementById('pin-s3').hidden, 5000);
const pinInput = L.d.getElementById('pin-input');
pinInput.value = COMMON; pinInput.dispatchEvent(new L.w.Event('input', { bubbles: true }));
await until(() => !L.d.getElementById('pin-go').disabled, 4000);
L.d.getElementById('pin-s3').dispatchEvent(new L.w.Event('submit', { bubbles: true, cancelable: true }));
await until(() => !!L.w.localStorage.getItem(KEY_PIN) || !L.d.getElementById('pin-err').hidden, 15000);
const stored = L.w.localStorage.getItem(KEY_PIN), device = L.w.localStorage.getItem(KEY_DEVICE);
const sess = stored ? JSON.parse(stored) : null;
const M = openCtrl('new', { seed: { [KEY_PIN]: stored, [KEY_DEVICE]: device } });
await until(() => !M.d.getElementById('v-main').hidden || !M.d.getElementById('v-confirm').hidden || !M.d.getElementById('v-msg').hidden, 10000);
if (!M.d.getElementById('v-confirm').hidden) { click(M.w, M.d.getElementById('cf-yes')); await until(() => !M.d.getElementById('v-main').hidden, 8000); }
await wait(120);
click(M.w, M.d.querySelector('.w[data-wait="15"]'));
await until(() => /반영했습니다/.test(text(M.d.getElementById('toast'))), 10000);
const saved = await q1('select congestion, wait_minutes from public.booth_live where booth_id = $1', [byCode['R2-05'].id]);
t('S5-1 학교명 일부로 찾아 고른 부스(R2-05) → 공통 PIN 로그인 → 운영 화면 15분 저장(리허설 공통 PIN 기간 규칙 그대로)',
  !!sess && sess.booth_id === byCode['R2-05'].id && /반영했습니다/.test(text(M.d.getElementById('toast'))) && saved && saved.wait_minutes === 15 && !L.errors.length && !M.errors.length,
  JSON.stringify([!!sess, text(M.d.getElementById('toast')), saved, L.errors, M.errors]));
M.dom.window.close(); L.dom.window.close();
const tok = (await q1('select token from public.booth_access where booth_id = $1', [byCode['R3-02'].id])).token;
const Q = openCtrl('new', { url: 'https://incheon-live.vercel.app/booth-ctrl.html#k=' + tok });
await until(() => !Q.d.getElementById('v-confirm').hidden || !Q.d.getElementById('v-main').hidden, 10000);
if (!Q.d.getElementById('v-confirm').hidden) { click(Q.w, Q.d.getElementById('cf-yes')); await until(() => !Q.d.getElementById('v-main').hidden, 8000); }
await wait(120);
click(Q.w, Q.d.querySelector('.w[data-wait="20"]'));
await until(() => /반영했습니다/.test(text(Q.d.getElementById('toast'))), 10000);
const qsaved = await q1('select wait_minutes from public.booth_live where booth_id = $1', [byCode['R3-02'].id]);
t('S5-2 QR(운영자 카드 #k=열쇠)로 열기 → 20분 저장 — QR 흐름 그대로', /반영했습니다/.test(text(Q.d.getElementById('toast'))) && qsaved && qsaved.wait_minutes === 20 && !Q.errors.length,
  JSON.stringify([text(Q.d.getElementById('toast')), qsaved, Q.errors]));
Q.dom.window.close();
const errAll = [...Object.values(C), ...Object.values(O), e2, exA].flatMap(c => c.errors);
t('S5-3 화면 오류 없음(두 판 · 모든 구역)', errAll.length === 0, errAll.join(' | '));

// ══ S6 운영 상태 단추 · ‘지금 확인’ 설명(PR #12) ═════════════════════════════
// 새 판(R3-05)과 앞 판(R3-06)을 운영자 QR 로 열어 같은 순서로 누릅니다: 15분 → 지금 확인 → 잠시 중단 → 오늘 마감(묻기 → 네) → 10분.
// 단추의 고른 상태(class · aria-pressed)와 DB 결과가 두 판에서 같아야 하고(동작 그대로), 새 판은 모양 규칙 · 설명 줄을 따로 봅니다.
async function openQr(which, code) {
  const tk = (await q1('select token from public.booth_access where booth_id = $1', [byCode[code].id])).token;
  const c = openCtrl(which, { url: 'https://incheon-live.vercel.app/booth-ctrl.html#k=' + tk });
  await until(() => !c.d.getElementById('v-confirm').hidden || !c.d.getElementById('v-main').hidden, 10000);
  if (!c.d.getElementById('v-confirm').hidden) { click(c.w, c.d.getElementById('cf-yes')); await until(() => !c.d.getElementById('v-main').hidden, 8000); }
  await wait(120);
  return c;
}
const liveRow = code => q1('select congestion, wait_minutes, updated_at from public.booth_live where booth_id = $1', [byCode[code].id]);
const logRows = async (code, after) => (await db.query('select source, congestion, wait_minutes from public.booth_live_log where booth_id = $1 and id > $2 order by id', [byCode[code].id, after])).rows;
const btnState = c => {
  const on = id => { const b = c.d.getElementById(id); return (b.classList.contains('is-on') ? 'on' : 'off') + '/' + b.getAttribute('aria-pressed'); };
  return `중단 ${on('btn-pause')} · 마감 ${on('btn-closed')} · 대기 ${[...c.d.querySelectorAll('#waits .w.is-on')].map(b => b.getAttribute('data-wait')).join(',') || '-'}`;
};
async function statusRun(which, code) {
  const c = await openQr(which, code);
  const log0 = +(await q1('select coalesce(max(id), 0) m from public.booth_live_log')).m;
  const out = { steps: [], c };
  const step = async (label, act, done) => { act(); const ok = await until(done, 10000); await wait(80); out.steps.push({ label, ok, st: btnState(c), db: await liveRow(code) }); };
  await step('15분', () => click(c.w, c.d.querySelector('#waits .w[data-wait="15"]')), async () => ((await liveRow(code)) || {}).wait_minutes === 15 && !c.d.getElementById('still').hidden);
  // ‘지금 확인’: 누른 바로 그 순간(보내는 중)의 단추 글자, 끝난 뒤 글자 · DB
  const before = await liveRow(code);
  const still = c.d.getElementById('still');
  out.markup = { tag: still.tagName, type: still.getAttribute('type'), act: still.getAttribute('data-act'),
    t: text(c.d.getElementById('still-t')), s: text(still.querySelector('.still__s')), n: still.children.length, all: text(still) };
  click(c.w, still);
  out.during = { t: text(c.d.getElementById('still-t')) || text(still), s: text(still.querySelector('.still__s')), all: text(still) };
  await until(async () => { const r = await liveRow(code); return r && new Date(r.updated_at) > new Date(before.updated_at); }, 10000);
  await until(() => !/확인하는 중/.test(text(still)), 8000);
  await wait(80);
  out.after = { t: text(c.d.getElementById('still-t')) || text(still), s: text(still.querySelector('.still__s')), all: text(still) };
  out.touch = { before, after: await liveRow(code) };
  await step('잠시 중단', () => click(c.w, c.d.getElementById('btn-pause')), async () => ((await liveRow(code)) || {}).congestion === '중단');
  click(c.w, c.d.getElementById('btn-closed')); await wait(80);
  out.ask = { shown: !c.d.getElementById('ask-close').hidden, db: (await liveRow(code)).congestion, st: btnState(c) };
  await step('오늘 마감(네)', () => click(c.w, c.d.querySelector('[data-act="close-yes"]')), async () => ((await liveRow(code)) || {}).congestion === '마감');
  await step('10분', () => click(c.w, c.d.querySelector('#waits .w[data-wait="10"]')), async () => ((await liveRow(code)) || {}).wait_minutes === 10 && (await liveRow(code)).congestion !== '마감');
  out.log = (await logRows(code, log0)).map(r => `${r.source}:${r.congestion}/${r.wait_minutes}`);
  return out;
}
const SN = await statusRun('new', 'R3-05');
const SO = await statusRun('old', 'R3-06');
const stN = SN.steps.map(x => x.st), stO = SO.steps.map(x => x.st);
const dbTxt = s => s.steps.map(x => `${x.db.congestion}/${x.db.wait_minutes}`).join(' → ');
t('S6-1 잠시 중단 · 오늘 마감을 누르면 그 단추만 고른 상태(class is-on · aria-pressed true) — 대기시간을 다시 누르면 둘 다 풀림 · 앞 판과 같은 상태 순서',
  SN.steps.every(x => x.ok) && stN[1] === '중단 on/true · 마감 off/false · 대기 -' && stN[2] === '중단 off/false · 마감 on/true · 대기 -' &&
  stN[3] === '중단 off/false · 마감 off/false · 대기 10' && JSON.stringify(stN) === JSON.stringify(stO), JSON.stringify([stN, stO]));
const wOn = declOf(rulesNew, '.w.is-on') || [], offOn = declOf(rulesNew, '.off.is-on') || [];
const offOnText = declOf(rulesNew, '.off.is-on .off__s, #btn-closed.is-on .off__t') || [];
t('S6-2 고른 상태의 모양 = 대기시간 단추를 고를 때와 같은 규칙(보라 바탕 --accent · 테두리 --accent · 흰 글자 --on) · 보조 글 · 마감 글자도 흰색 · 예전 회색/옅은 빨강 규칙 없음',
  wOn.length === 3 && sameList(offOn, wOn) && sameList(offOn, ['background: var(--accent)', 'border-color: var(--accent)', 'color: var(--on)']) &&
  sameList(offOnText, ['color: var(--on)']) && !ruleOf(rulesNew, '#btn-closed.is-on').length &&
  sameList(declOf(rulesOld, '.off.is-on') || [], ['background: var(--off-t)', 'border-color: var(--off)']),
  JSON.stringify([offOn, wOn, offOnText]));
t('S6-3 오늘 마감은 한 번 더 물음 — 첫 누름에는 묻는 칸만 열리고 DB 는 그대로(중단) · 단추도 아직 안 고름 · ‘네’ 를 눌러야 마감 저장(앞 판과 같음)',
  SN.ask.shown && SN.ask.db === '중단' && SN.ask.st === stN[1] && SO.ask.shown && SO.ask.db === '중단', JSON.stringify([SN.ask, SO.ask]));
const C2T = '변동 없음 · 지금 확인', C2S = '값은 그대로 두고 확인한 시각만 새로 저장해요';
t(`S6-4 ‘지금 확인’ 단추 — 첫 줄 “${C2T}” · 둘째 줄 “${C2S}”(.still__s) · 단추 하나(button · data-act touch) 안에 두 줄`,
  SN.markup.tag === 'BUTTON' && SN.markup.type === 'button' && SN.markup.act === 'touch' && SN.markup.n === 2 && SN.markup.t === C2T && SN.markup.s === C2S &&
  SN.markup.all === C2T + ' ' + C2S, JSON.stringify(SN.markup));
t('S6-5 누른 순간(보내는 중) 첫 줄만 “확인하는 중…” · 둘째 줄 설명은 그대로 · 끝나면 첫 줄이 되돌아옴(앞 판은 단추 글자 전체를 바꿈)',
  SN.during.t === '확인하는 중…' && SN.during.s === C2S && SN.after.t === C2T && SN.after.s === C2S &&
  SO.during.all === '확인하는 중…' && SO.after.all === C2T, JSON.stringify([SN.during, SN.after, SO.during, SO.after]));
t('S6-6 ‘지금 확인’ 저장 결과 그대로 — 값(보통 15분)은 바뀌지 않고 확인 시각만 새로 · 기록은 touch 한 줄(두 판 모두) · 전체 기록 순서가 두 판에서 같음',
  SN.touch.before.congestion === SN.touch.after.congestion && SN.touch.after.wait_minutes === 15 && new Date(SN.touch.after.updated_at) > new Date(SN.touch.before.updated_at) &&
  JSON.stringify(SN.log) === JSON.stringify(SO.log) && SN.log.filter(x => x.startsWith('touch:')).length === 1 && SN.log[1] === 'touch:보통/15' && dbTxt(SN) === dbTxt(SO),
  JSON.stringify([SN.log, SO.log, dbTxt(SN)]));
// 바뀐 줄: #12 이전 Production(--base-ref)과 견줘 booth-ctrl.html 은 ‘지금 확인’ 단추 줄 · 그 글자를 바꾸는 한 줄뿐
let diffLines = null;
try {
  diffLines = execFileSync('git', ['-C', CTRL, 'diff', '-U0', BASE_REF, '--', 'booth-ctrl.html'], { encoding: 'utf8' }).replace(/\r/g, '').split('\n')
    .filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
} catch (e) { diffLines = null; }
const offDiff = diffLines ? diffLines.filter(l => !/still|^[+-]\s*<\/button>\s*$/.test(l)) : null;
t(`S6-7 #12 이전 Production(${BASE_REF})과 견줘 booth-ctrl.html 에서 바뀐 줄은 ‘지금 확인’ 단추 마크업 · 그 글자를 바꾸는 한 줄뿐 — 저장 · QR · PIN · 로그인 코드는 그대로`,
  !!diffLines && offDiff.length === 0 && diffLines.filter(l => l.startsWith('-')).length <= 2, diffLines ? `바뀐 줄 ${diffLines.length} · 그 밖 ${offDiff.length}: ${offDiff.slice(0, 3).join(' / ')}` : 'git diff 실패');
SN.c.dom.window.close(); SO.c.dom.window.close();
t('S6-8 화면 오류 없음(두 판)', !SN.c.errors.length && !SO.c.errors.length, [...SN.c.errors, ...SO.c.errors].join(' | '));

// ── 보고서 ─────────────────────────────────────────────────────────────
const passed = results.filter(x => x.ok).length;
const md = ['# 운영자 화면 — 부스 고르기 학교명 · 운영 상태 단추 · ‘지금 확인’ 시험', '',
  `- 실행: ${new Date().toISOString()} · 결과 **${passed} / ${results.length} 통과**`,
  `- 바뀐 판 ${git(CTRL, 'rev-parse', '--abbrev-ref', 'HEAD')} @ ${git(CTRL, 'rev-parse', '--short', 'HEAD')} · 앞 판 booth-live ${git(LIVE, 'rev-parse', '--short', 'HEAD')} · 바뀐 줄 기준 ${BASE_REF} · 리허설 공통 PIN ${git(PIN, 'rev-parse', '--short', 'HEAD')}`,
  '- 복제 DB: 실제 84곳 id · 기관명 · 부스명 · 구역 · 번호 지문 = Production(f99da8b2). 열쇠 · PIN · 세션은 가짜 값이며 적지 않습니다.', '',
  '| 시험 | 결과 | 메모 |', '|---|---|---|',
  ...results.map(x => `| ${x.name.replace(/\|/g, '/')} | ${x.ok ? '통과' : '**실패**'} | ${(x.note || '').replace(/\|/g, '/')} |`), ''].join('\n');
mkdirSync(resolve(OUT, 'rehearsal'), { recursive: true });
writeFileSync(resolve(OUT, 'rehearsal', 'ctrl-school-test-report.md'), md);
console.log(`\n${passed} / ${results.length} 통과 → out/rehearsal/ctrl-school-test-report.md`);
process.exit(passed === results.length ? 0 : 1);
