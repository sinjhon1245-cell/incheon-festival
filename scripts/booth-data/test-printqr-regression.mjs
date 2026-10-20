/* ===================================================================
   QR · PIN 관리(print-qr.html) 회귀 시험 — 지금 사양 기준(실제 부스 84 · 예시 50)
   ───────────────────────────────────────────────────────────────────
   상태: 복제 DB 를 지금 Production 과 같은 단계로(preview → C-02 → Q-02 → T-02 → T-03 → 리허설 → PIN →
         리허설 공통 PIN). 실제 84곳 = R1~R4 공개 · QR 84, 예시 50곳 = 비공개 · QR 50 · 예시 PIN 2.
   견주는 두 판: 예전 = git `--old-ref`(기본 56c3138 — 실제 부스 기본 인쇄 이전의 Production main) ·
                새   = `--new` 파일(같은 폴더의 assets · supabase 를 씀).
   R  두 판이 같아야 하는 것 — 실제 부스 카드 · 안내문 · 포스터 · QR 주소 · 구역 칩 · 화면을 열기만 할 때 쓰기 없음
   P  인쇄 기본값 — 실제 부스만 기본 · 예시는 기본 제외지만 카드 · 구역 칩 + 모두 선택으로 다시 넣을 수 있음
   S  PIN ‘실제 부스 N곳 선택’ — 예시 제외 · 수는 데이터에서 셈
   K  찾기 · 구역과 충돌 없음(인쇄 목록 · PIN 목록)
   I  PIN 발급 · 재발급 그대로 — 함수 본문 · 부르는 DB 함수 · 확인 창 · 결과가 예전 판과 같음(복제 DB 두 벌에서 따로)
   ⚠️ 네트워크 · Production 접속 없음. 열쇠 · PIN 은 복제 DB 의 가짜 값이고 출력하지 않습니다(개수와 참 · 거짓만).
   쓰는 법
     node --max-old-space-size=8192 scripts/booth-data/test-printqr-regression.mjs --pglite-dir <PGlite 0.4.4> --jsdom-dir <jsdom 30> \
          --new <새 print-qr.html> [--old-ref 56c3138] [--assets-dir <새 판 저장소 폴더 — 기본은 --new 의 폴더>]
   결과: out/gate3c/printqr-regression-report.md
   =================================================================== */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readCsv } from './lib/csv.mjs';
import { loadPglite, openReplica } from './lib/replica.mjs';
import { makeRest, fakeSupabase } from './lib/fake-rest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT = resolve(HERE, 'out');
const G3 = resolve(OUT, 'gate3c');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const { JSDOM, VirtualConsole } = createRequire(join(resolve(arg('jsdom-dir')), 'package.json'))('jsdom');
const newPath = resolve(arg('new', resolve(REPO, 'print-qr.html')));
const NEW_DIR = resolve(arg('assets-dir', dirname(newPath)));
const oldRef = arg('old-ref', '56c3138');
const lib = await loadPglite(arg('pglite-dir'));
const manifest = readCsv(resolve(OUT, 'staging', 'manifest.csv'));
const plan = readCsv(resolve(OUT, 'gate4r', 'plan-R.csv'));
const snap = readCsv(resolve(OUT, readdirSync(OUT).filter(f => /^prod-snapshot-\d{8}\.csv$/.test(f)).sort().pop()));
const REAL = plan.map(p => p['부스ID']);
const realSet = new Set(REAL);
const EX = snap.map(s => s.id);
const exSet = new Set(EX);
const codeOf = id => { const p = plan.find(x => x['부스ID'] === id); if (p) return p['표시코드']; const e = snap.find(x => x.id === id); return e ? e.code : id; };
const idOf = c => { const p = plan.find(x => x['표시코드'] === c); if (p) return p['부스ID']; const e = snap.find(x => x.code === c); if (e) return e.id; throw new Error('부스 없음 ' + c); };
const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });

const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const results = [];
let section = '';
function t(name, ok, note = '') { results.push({ section, name, ok: !!ok, note: ok ? '' : String(note).slice(0, 400) }); console.log(`${ok ? '통과' : '실패'}  ${name}${note && !ok ? '  — ' + String(note).slice(0, 400) : ''}`); }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000, step = 40) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await wait(step); } return false; }
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

// ── 두 판의 파일 ─────────────────────────────────────────────────────────
const ASSETS = ['assets/config.js', 'assets/core.js', 'assets/booth-core.js', 'assets/mock-data.js'];
const SRC = {
  old: { html: git('show', `${oldRef}:print-qr.html`), asset: p => git('show', `${oldRef}:${p}`) },
  new: { html: readFileSync(newPath, 'utf8'), asset: p => readFileSync(join(NEW_DIR, p), 'utf8') }
};
function pageHtml(which) {
  const s = SRC[which];
  let html = s.html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>/g, '');
  for (const p of ASSETS) {
    const src = s.asset(p).replace(/<\/script/gi, '<\\/script');
    html = html.replace(new RegExp(`<script src="${p.replace(/[.]/g, '\\.')}"></script>`), () => `<script>${src}</script>`);
  }
  return html.replace(/<link[^>]+stylesheet[^>]*>/g, '');
}

// ── 복제 DB: 지금 Production 과 같은 단계 ─────────────────────────────────
const DATE_KEYS = new Set(['cutoff', 'kst_today']);
const asJson = rows => JSON.parse(JSON.stringify(rows), (k, v) => (DATE_KEYS.has(k) && typeof v === 'string' ? v.slice(0, 10) : v));
async function prep() {
  const R = await openReplica(lib, { snap, manifest });
  const db = R.db;
  await db.exec(readFileSync(resolve(HERE, 'dryrun/replica-functions-extra.sql'), 'utf8'));
  for (const f of [resolve(REPO, 'supabase/migration-booth-preview.sql'), resolve(G3, 'C-02-transition.sql'), resolve(G3, 'Q-02-qr-preissue.sql'),
    resolve(OUT, 'gate4r/T-02-assign.sql'), resolve(OUT, 'gate4r/T-03-publish.sql')]) {
    const r = await R.run(readFileSync(f, 'utf8')); if (!r.ok) throw new Error(f + ' ' + r.error);
  }
  await db.exec(readFileSync(join(NEW_DIR, 'supabase/migration-booth-rehearsal.sql'), 'utf8'));
  const SKIP = new Set(['private.booth_pin_pepper', 'private.booth_client_ip', 'public.admin_booth_credentials', 'public.admin_booth_ip_probe']);
  for (const f of ['migration-booth-pin.sql', 'migration-booth-example-pin.sql', 'migration-booth-pin-checked.sql']) {
    const lines = readFileSync(join(NEW_DIR, 'supabase', f), 'utf8').replace(/\r/g, '').split('\n');
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
  await db.exec(readFileSync(join(NEW_DIR, 'supabase/migration-booth-rehearsal-pin.sql'), 'utf8'));
  return { R, db, rest: makeRest(R) };
}
function adminClient(ctx) {
  const log = [], calls = [];
  const base = fakeSupabase(ctx.R, log).createClient();
  const client = Object.assign({}, base, {
    from: table => { const b = base.from(table); const th = b.then; b.then = (ok, bad) => th.call(b, res => { if (res && res.data) res.data = asJson(res.data); return res; }).then(ok, bad); return b; },
    rpc: async (name, args) => {
      calls.push({ name, args: args || {} });
      const res = await base.rpc(name, args);
      if (res.data) res.data = asJson(res.data);
      return res;
    }
  });
  return { client, log, calls };
}
const quiet = () => { const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); return vc; };
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function openPage(which, ctx) {
  const { client, log, calls } = adminClient(ctx);
  const qr = new Map();
  const dom = new JSDOM(pageHtml(which), {
    url: 'https://sinjhon1245-cell.github.io/incheon-festival/print-qr.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: quiet(),
    beforeParse(w) {
      w.supabase = { createClient: () => client };
      // QR 그림 대신 넣은 주소만 기억합니다(메모리에만 · 출력 안 함).
      function QRCode(el, o) { const item = el.closest('[data-id]'); const key = item ? item.className.split(' ')[1] + ':' + item.getAttribute('data-id') : (el.id || 'poster'); qr.set(key, o.text); }
      QRCode.CorrectLevel = { L: 1, M: 0, Q: 3, H: 2 };
      w.QRCode = QRCode;
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.scrollTo = () => {}; w.print = () => {}; w.console.warn = () => {};
      w.fetch = async (u) => {
        const s = String(u), i = s.indexOf('/rest/v1/');
        if (i < 0) throw new Error('예상 밖 요청');
        const r = await ctx.rest(s.slice(i + 9)); const b = JSON.stringify(r.body);
        return { ok: r.status < 400, status: r.status, text: async () => b, json: async () => JSON.parse(b) };
      };
    }
  });
  const errors = []; dom.window.addEventListener('error', e => errors.push(e.message));
  const d = dom.window.document, w = dom.window;
  await until(() => d.querySelectorAll('#grid-ops .item--ops').length >= 134 && calls.some(c => c.name === 'admin_booth_access'), 30000);
  await wait(400);
  return { which, dom, d, w, log, calls, qr, errors };
}
async function openPin(P) {
  click(P.w, P.d.getElementById('pinx-toggle'));
  await until(() => !P.d.getElementById('pinx-main').hidden && P.d.querySelectorAll('#pinx-list .prow').length > 0, 20000);
  await wait(100);
}

// 인쇄 목록 도우미
const itemsOf = (P, kind) => [...P.d.querySelectorAll(`#grid-${kind} .item`)];
const printIds = (P, kind) => itemsOf(P, kind).filter(el => !['is-filtered', 'is-off', 'is-keyoff', 'is-nokey'].some(c => el.classList.contains(c))).map(el => el.getAttribute('data-id'));
const countTxt = (P, kind) => text(P.d.getElementById('count-' + kind));
const btnTxt = P => text(P.d.getElementById('print-btn'));
const itemEl = (P, kind, id) => P.d.querySelector(`#grid-${kind} .item[data-id="${id}"]`);
function pick(P, kind, id, on) {
  const box = itemEl(P, kind, id).querySelector('input[data-act="pick"]');
  box.checked = on; box.dispatchEvent(new P.w.Event('change', { bubbles: true }));
}
const chip = (P, kind, z) => click(P.w, P.d.querySelector(`.zchip[data-list="${kind}"][data-zone-f="${z}"]`));
const pickAll = (P, kind, on) => click(P.w, P.d.querySelector(`[data-pick="${on ? 'all' : 'none'}"][data-list="${kind}"]`));
function searchList(P, kind, v) { const q = P.d.getElementById('q-' + kind); q.value = v; q.dispatchEvent(new P.w.Event('input', { bubbles: true })); }
const tab = (P, kind) => click(P.w, P.d.getElementById('tab-' + kind));
// PIN 목록 도우미
const pinChecked = P => [...P.d.querySelectorAll('#pinx-list input[data-pid]:checked')].map(x => x.getAttribute('data-pid'));
const pinRows = P => [...P.d.querySelectorAll('#pinx-list input[data-pid]')].map(x => x.getAttribute('data-pid'));
function pinSearch(P, v) { const q = P.d.getElementById('pinx-q'); q.value = v; q.dispatchEvent(new P.w.Event('input', { bubbles: true })); }
const pinZone = (P, z) => click(P.w, P.d.querySelector(`#pinx-zones [data-pzone="${z}"]`));
const pinCount = P => text(P.d.getElementById('pinx-count'));
const pinMsg = P => text(P.d.getElementById('pinx-msg'));

// ══ 준비 ════════════════════════════════════════════════════════════════
section = 'R 두 판이 같아야 하는 것';
const A = await prep();
const st = (await A.db.query(`select
  (select count(*)::int from public.booths) booths,
  (select count(*)::int from public.booths where is_published and org !~ '^\\s*\\[예시\\]') real_pub,
  (select count(*)::int from public.booths where is_published and org ~ '^\\s*\\[예시\\]') ex_pub,
  (select count(*)::int from public.booth_access a join public.booths b on b.id = a.booth_id where b.org !~ '^\\s*\\[예시\\]' and a.disabled_at is null) real_qr,
  (select count(*)::int from public.booth_access a join public.booths b on b.id = a.booth_id where b.org ~ '^\\s*\\[예시\\]' and a.disabled_at is null) ex_qr,
  (select count(*)::int from public.zones where is_published) zones_pub`)).rows[0];
t('R0 상태 = 지금 Production 단계: 부스 134 · 실제 84 공개 · QR 84 · 예시 50 비공개 · QR 50 · 공개 구역 R1~R4',
  st.booths === 134 && st.real_pub === 84 && st.ex_pub === 0 && st.real_qr === 84 && st.ex_qr === 50 && st.zones_pub === 4, JSON.stringify(st));
const accessFp = async ctx => (await ctx.db.query("select md5(coalesce(string_agg(booth_id::text || token || coalesce(disabled_at::text, ''), ',' order by booth_id), '')) f from public.booth_access")).rows[0].f;
const fp0 = await accessFp(A);
const oldP = await openPage('old', A);
const newP = await openPage('new', A);
const html = (P, kind) => new Map(itemsOf(P, kind).map(el => [el.getAttribute('data-id'), el.outerHTML]));
// 예시 카드에서 '인쇄에 포함' 상태(is-off · checked)만 떼고 견줌 — 그 밖의 글자는 같아야 함
// (jsdom 은 체크 상태를 checked="" 로 적습니다)
const unpick = s => s.replace(/ is-off(?=[ "])/g, '').replace(/(data-act="pick") checked(="")?/g, '$1');
for (const kind of ['ops', 'signs']) {
  const o = html(oldP, kind), n = html(newP, kind);
  const realSame = REAL.filter(id => o.get(id) && o.get(id) === n.get(id)).length;
  const exSame = EX.filter(id => o.get(id) && unpick(o.get(id)) === unpick(n.get(id))).length;
  const exOffNew = EX.filter(id => itemEl(newP, kind, id).classList.contains('is-off')).length;
  const exOffOld = EX.filter(id => itemEl(oldP, kind, id).classList.contains('is-off')).length;
  const label = kind === 'ops' ? '① 운영자 카드' : '② 부스 앞 안내';
  t(`R1-${kind} ${label} 134장: 실제 84장 HTML 글자 하나까지 같음 · 예시 50장은 ‘인쇄에 포함’ 표시(is-off · 체크)만 다름(새 판 50장 꺼짐 · 예전 판 0)`,
    o.size === 134 && n.size === 134 && realSame === 84 && exSame === 50 && exOffNew === 50 && exOffOld === 0, `${o.size}/${n.size} 실제 ${realSame} 예시 ${exSame} 꺼짐 ${exOffOld}→${exOffNew}`);
}
const poster = P => (P.d.getElementById('panel-poster') || {}).innerHTML || '';
t('R2 ③ 입구 포스터 HTML 같음', poster(oldP) === poster(newP) && poster(newP).length > 0);
const qrSame = [...oldP.qr].every(([k, v]) => newP.qr.get(k) === v) && oldP.qr.size === newP.qr.size;
t('R3 QR 에 넣는 주소가 모두 같음(운영자 134 · 안내문 134 · 포스터)', oldP.qr.size >= 269 && qrSame, `${oldP.qr.size} → ${newP.qr.size}`);
t('R4 운영자 QR = booth-ctrl.html#k=(열쇠 # 뒤 24자) · 안내문 QR = 관람객 화면 ?b=UUID(열쇠 없음)',
  [...newP.qr].filter(([k]) => k.startsWith('item--ops:')).every(([, v]) => /^https:\/\/incheon-live\.vercel\.app\/booth-ctrl\.html#k=[A-Za-z0-9_-]{24}$/.test(v)) &&
  [...newP.qr].filter(([k]) => k.startsWith('item--sign:')).every(([k, v]) => v === 'https://incheon-live.vercel.app/?b=' + k.split(':')[1]));
const chips = (P, kind) => [...P.d.querySelectorAll(`.zchip[data-list="${kind}"]`)].map(c => text(c)).join(' | ');
t('R5 구역 칩 같음(① · ② 모두 “전체 134 · A~E · R1~R4 21”)', chips(oldP, 'ops') === chips(newP, 'ops') && chips(oldP, 'signs') === chips(newP, 'signs') &&
  /^전체134 \| A6 \| B20 \| C10 \| D8 \| E6 \| R121 \| R221 \| R321 \| R421$/.test(chips(newP, 'ops')), chips(newP, 'ops'));
const issueAll = P => { const b = P.d.getElementById('issue-all'); return b ? (b.hidden ? '숨김' : text(b)) : '없음'; };
t('R6 QR 일괄 발급 단추 · 카드 단추(발급 · 교체 · 끄기 · 직접 고치기) 같음',
  issueAll(oldP) === issueAll(newP) && itemsOf(newP, 'ops').every(el => {
    const o = itemEl(oldP, 'ops', el.getAttribute('data-id'));
    const acts = x => [...x.querySelectorAll('[data-act]')].map(b => b.getAttribute('data-act')).join(',');
    return acts(o) === acts(el);
  }), `${issueAll(oldP)} → ${issueAll(newP)}`);
const WRITES = /^admin_(issue_booth_tokens|rotate_booth_token|disable_booth_token|set_booth_live|reset_booth_live|issue_booth_pin|issue_booth_pin_checked|disable_booth_pin|rehearsal_set_live)$/;
const readsOf = P => [...new Set(P.calls.map(c => c.name))].sort().join(',');
t('R7 두 판 모두 열기만 해서는 발급 · 교체 · 끄기 · 값 쓰기 호출 없음(점검용 빈 호출 제외) · 부른 함수 목록 같음 · DB 열쇠 지문 그대로',
  ![...oldP.calls, ...newP.calls].some(c => WRITES.test(c.name) && c.args.p_booth_id !== null) && readsOf(oldP) === readsOf(newP) && (await accessFp(A)) === fp0, readsOf(newP));
const toks = (await A.db.query('select token from public.booth_access')).rows.map(x => x.token);
t('R8 새 판 HTML(글 · 속성 · title)에 열쇠 없음', toks.every(tk => !newP.d.documentElement.outerHTML.includes(tk)));
const printCss = P => (P.d.querySelector('style').textContent.match(/\.item\.is-off, \.item\.is-filtered, \.item\.is-keyoff, \.item\.is-nokey \{ display: none !important; \}/) || [''])[0];
t('R9 인쇄 CSS 그대로 — ‘인쇄에 포함’ 꺼진 카드(is-off) · 찾기로 가린 카드는 종이에 나가지 않음', !!printCss(newP) && printCss(oldP) === printCss(newP));

// ══ P 인쇄 기본값 ═══════════════════════════════════════════════════════
section = 'P 인쇄 기본값';
const opsN0 = printIds(newP, 'ops'), opsO0 = printIds(oldP, 'ops');
t('P1 ① 기본 인쇄 대상 = 실제 84곳(UUID 일치) · 예시 0 · “인쇄하기 (84장)” · 수 줄 “인쇄할 카드 84장 · A4 21쪽 · 전체 134곳 · 예시 부스 50곳 제외(넣으려면 카드의 ‘인쇄에 포함’)” — 예전 판은 134장(예시 포함)',
  sameSet(opsN0, REAL) && btnTxt(newP) === '인쇄하기 (84장)' &&
  countTxt(newP, 'ops') === '인쇄할 카드 84장 · A4 21쪽 · 전체 134곳 · 예시 부스 50곳 제외(넣으려면 카드의 ‘인쇄에 포함’)' &&
  opsO0.length === 134 && btnTxt(oldP) === '인쇄하기 (134장)', `${opsN0.length} ${btnTxt(newP)} | ${countTxt(newP, 'ops')} | 예전 ${opsO0.length}`);
tab(newP, 'signs'); tab(oldP, 'signs'); await wait(60);
const sigN0 = printIds(newP, 'signs');
t('P2 ② 기본 인쇄 대상 = 실제 84곳 · “인쇄하기 (84장)” · “인쇄할 안내문 84장 · A4 42쪽 · 전체 134곳 · 예시 부스 50곳 제외(넣으려면 안내문의 ‘인쇄에 포함’)” — 예전 판 134장',
  sameSet(sigN0, REAL) && btnTxt(newP) === '인쇄하기 (84장)' &&
  countTxt(newP, 'signs') === '인쇄할 안내문 84장 · A4 42쪽 · 전체 134곳 · 예시 부스 50곳 제외(넣으려면 안내문의 ‘인쇄에 포함’)' &&
  printIds(oldP, 'signs').length === 134, `${sigN0.length} ${btnTxt(newP)} | ${countTxt(newP, 'signs')}`);
tab(newP, 'ops'); tab(oldP, 'ops'); await wait(60);
const B01 = idOf('B-01');
pick(newP, 'ops', B01, true); await wait(40);
const p3a = printIds(newP, 'ops'), p3c = countTxt(newP, 'ops'), p3s = printIds(newP, 'signs');
pick(newP, 'ops', B01, false); await wait(40);
const p3b = printIds(newP, 'ops');
t('P3 예시 카드 한 장(B-01) ‘인쇄에 포함’ 켜기 → 85장(B-01 포함) · 수 줄 “예시 부스 1장 포함 · 예시 부스 49곳 제외” · ② 안내문은 그대로 84 · 다시 끄면 84',
  p3a.length === 85 && p3a.includes(B01) && /예시 부스 1장 포함 · 예시 부스 49곳 제외/.test(p3c) && sameSet(p3s, REAL) && sameSet(p3b, REAL), `${p3a.length} | ${p3c} | ② ${p3s.length} | ${p3b.length}`);
chip(newP, 'ops', 'A'); await wait(40);
const p4c0 = countTxt(newP, 'ops');
pickAll(newP, 'ops', true); await wait(40);
const p4a = printIds(newP, 'ops'), p4c1 = countTxt(newP, 'ops');
chip(newP, 'ops', 'A'); await wait(40);
const p4b = printIds(newP, 'ops');
const aIds = EX.filter(id => codeOf(id).startsWith('A-'));
t('P4 구역 칩 A → 예시 6곳만 보이고 0장(“예시 부스 6곳 제외”) → ‘모두 선택’ → 6장(“예시 부스 6장 포함”) → 칩 풀면 90장(실제 84 + A 6)',
  /^인쇄할 카드 0장 · A4 0쪽 · 찾은 부스 6곳 \/ 전체 134곳 · 예시 부스 6곳 제외/.test(p4c0) && sameSet(p4a, aIds) && /예시 부스 6장 포함/.test(p4c1) &&
  p4b.length === 90 && aIds.every(id => p4b.includes(id)) && REAL.every(id => p4b.includes(id)), `${p4c0} | ${p4a.length} ${p4c1} | ${p4b.length}`);
pickAll(newP, 'ops', true); await wait(40);
const p5a = printIds(newP, 'ops');
pickAll(newP, 'ops', false); await wait(40);
const p5b = printIds(newP, 'ops'), p5btn = btnTxt(newP);
t('P5 전체에서 ‘모두 선택’ → 134장(예시까지 직접 고른 경우) · ‘모두 해제’ → 0장 · 인쇄 단추 꺼짐 — 예시는 늘 사람이 고를 때만 들어감',
  p5a.length === 134 && p5b.length === 0 && newP.d.getElementById('print-btn').disabled, `${p5a.length} ${p5b.length} ${p5btn}`);

// ══ K 찾기 · 구역과 충돌 없음(인쇄 목록) ═════════════════════════════════════
section = 'K 찾기 · 구역';
const fresh = await openPage('new', A);
const oldK = await openPage('old', A);
const pairs = [];
for (const [how, act] of [['찾기 ‘삼산’', P => searchList(P, 'ops', '삼산')], ['찾기 ‘임시구역’', P => searchList(P, 'ops', '임시구역')], ['구역 R1', P => chip(P, 'ops', 'R1')]]) {
  act(fresh); act(oldK); await wait(60);
  pairs.push([how, printIds(fresh, 'ops'), printIds(oldK, 'ops')]);
  searchList(fresh, 'ops', ''); searchList(oldK, 'ops', '');
  if (how === '구역 R1') { chip(fresh, 'ops', 'R1'); chip(oldK, 'ops', 'R1'); }
  await wait(40);
}
t('K1 실제 부스만 걸리는 찾기 · 구역(‘삼산’ 2 · ‘임시구역’ 84 · R1 21) — 인쇄 대상이 예전 판과 같음',
  pairs.every(([, a, b]) => sameSet(a, b)) && pairs[0][1].length === 2 && pairs[1][1].length === 84 && pairs[2][1].length === 21,
  pairs.map(([h, a, b]) => `${h} ${a.length}/${b.length}`).join(' | '));
searchList(fresh, 'ops', 'B-01'); searchList(oldK, 'ops', 'B-01'); await wait(60);
const k2n = printIds(fresh, 'ops'), k2c = countTxt(fresh, 'ops'), k2o = printIds(oldK, 'ops');
pick(fresh, 'ops', B01, true); await wait(40);
const k2n2 = printIds(fresh, 'ops');
searchList(fresh, 'ops', ''); searchList(oldK, 'ops', ''); await wait(60);
const k2all = printIds(fresh, 'ops');
chip(fresh, 'ops', 'R1'); await wait(40);
const k2r1 = printIds(fresh, 'ops');
chip(fresh, 'ops', 'R1'); await wait(40);
const k2back = printIds(fresh, 'ops');
t('K2 예시를 찾으면(‘B-01’) 0장 · “예시 부스 1곳 제외” 안내(예전 판은 1장) → 찾은 채로 ‘인쇄에 포함’ 켜면 1장 → 찾기를 지우면 85장 → 구역 R1 이면 21장(B-01 가려짐) → 풀면 다시 85장(고른 상태 유지)',
  k2n.length === 0 && /예시 부스 1곳 제외/.test(k2c) && k2o.length === 1 && sameSet(k2n2, [B01]) && k2all.length === 85 && k2all.includes(B01) &&
  k2r1.length === 21 && !k2r1.includes(B01) && k2back.length === 85, `${k2n.length} ${k2c} 예전${k2o.length} | ${k2n2.length} | ${k2all.length} | ${k2r1.length} | ${k2back.length}`);
fresh.dom.window.close(); oldK.dom.window.close();

// ══ S PIN ‘실제 부스 N곳 선택’ ═══════════════════════════════════════════
section = 'S PIN 실제 부스 선택';
await openPin(newP);
await openPin(oldP);
// 단추가 없는 판(예전 판을 --new 로 준 판별력 확인 등)에서도 멈추지 않고 실패로 적히게, 없으면 숨은 빈 단추로 대신합니다.
const realBtn = newP.d.getElementById('pinx-real') || Object.assign(newP.d.createElement('button'), { hidden: true });
const dbReal = (await A.db.query("select count(*)::int n from public.booths where coalesce(org, '') !~ '^\\s*\\[예시\\]'")).rows[0].n;
t('S1 PIN 관리에 ‘실제 부스 84곳 선택’(84 = 복제 DB 의 예시 아닌 부스 수) · 예전 판에는 없음 · 목록 134줄',
  !realBtn.hidden && text(realBtn) === `실제 부스 ${dbReal}곳 선택` && dbReal === 84 && !oldP.d.getElementById('pinx-real') && pinRows(newP).length === 134,
  `${text(realBtn)} db ${dbReal}`);
click(newP.w, realBtn); await wait(60);
const s2 = pinChecked(newP);
t('S2 누르면 실제 84곳만 고름(예시 0) · “선택 84곳 · 발급 대상 84곳 · 재발급 대상 0곳” · “선택 PIN 발급 (84곳)”',
  sameSet(s2, REAL) && !s2.some(id => exSet.has(id)) && pinCount(newP) === '선택 84곳발급 대상 84곳 · 재발급 대상 0곳' && text(newP.d.getElementById('pinx-issue')) === '선택 PIN 발급 (84곳)',
  `${s2.length} | ${pinCount(newP)} | ${text(newP.d.getElementById('pinx-issue'))}`);
click(newP.w, newP.d.getElementById('pinx-none')); await wait(40);
// 수는 데이터에서 — 복제 DB 에만 시험 부스 1곳(실제 · R1-99)을 잠시 넣고 패널을 새로 엶
const TMP = '00000000-0000-4000-8000-000000000299';
await A.db.query(`insert into public.booths (id, zone_key, no, name, org, org_type, is_published, sort_order) values ($1, 'R1', 99, '시험 부스', '시험용가나다학교', '기타', true, 9099)`, [TMP]);
const tmpP = await openPage('new', A);
await openPin(tmpP);
const s3label = text(tmpP.d.getElementById('pinx-real'));
click(tmpP.w, tmpP.d.getElementById('pinx-real')); await wait(60);
const s3 = pinChecked(tmpP);
tmpP.dom.window.close();
await A.db.query('delete from public.booths where id = $1', [TMP]);
const tmpGone = (await A.db.query('select count(*)::int n from public.booths where id = $1', [TMP])).rows[0].n === 0;
t('S3 수는 고정값이 아님 — 실제 부스가 85곳이면 ‘실제 부스 85곳 선택’ · 누르면 85곳(시험 부스 포함 · 예시 0) · 시험 부스는 뒤에 지움',
  s3label === '실제 부스 85곳 선택' && s3.length === 85 && s3.includes(TMP) && !s3.some(id => exSet.has(id)) && tmpGone, `${s3label} ${s3.length}`);

// ══ K PIN 목록: 찾기 · 구역과 충돌 없음 ══════════════════════════════════
section = 'K 찾기 · 구역';
pinSearch(newP, '삼산'); await wait(40);
pinZone(newP, 'R3'); await wait(40);
const k3before = pinRows(newP).length;
click(newP.w, newP.d.getElementById('pinx-real')); await wait(60);
const k3sel = pinChecked(newP), k3rows = pinRows(newP);
const zonePressed = [...newP.d.querySelectorAll('#pinx-zones [data-pzone]')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.getAttribute('data-pzone'));
t('K3 찾기 ‘삼산’ + 구역 R3 로 좁힌 상태에서 눌러도 → 찾기 칸 비움 · 구역 ‘전체’ · 134줄 모두 보임 · 고른 84곳이 모두 화면에 있음(가려진 선택 없음)',
  k3before < 134 && newP.d.getElementById('pinx-q').value === '' && zonePressed.join() === '' && k3rows.length === 134 && sameSet(k3sel, REAL) && k3sel.every(id => k3rows.includes(id)),
  `${k3before} → ${k3rows.length} q='${newP.d.getElementById('pinx-q').value}' z=${zonePressed.join()} sel ${k3sel.length}`);
pinSearch(newP, 'R2'); await wait(40);
const k4a = [pinChecked(newP).length, pinMsg(newP)];
click(newP.w, newP.d.getElementById('pinx-real')); await wait(60);
pinZone(newP, 'R2'); await wait(40);
const k4b = [pinChecked(newP).length, pinMsg(newP)];
pinZone(newP, 'R2'); await wait(40);
// 예전 판 '전체 134곳 선택' 뒤 찾기 · 구역 — 같은 규칙인지
click(oldP.w, oldP.d.getElementById('pinx-all')); await wait(60);
pinSearch(oldP, 'R2'); await wait(40);
const k4o = [pinChecked(oldP).length, pinMsg(oldP)];
pinSearch(oldP, ''); await wait(40);
t('K4 고른 뒤 찾기나 구역을 바꾸면 선택을 풂(“검색어가 바뀌어 …” · “구역이 바뀌어 …”) — 예전 판 ‘전체 선택’ 뒤와 같은 규칙',
  k4a[0] === 0 && /검색어가 바뀌어 PIN 선택을 풀었어요/.test(k4a[1]) && k4b[0] === 0 && /구역이 바뀌어 PIN 선택을 풀었어요/.test(k4b[1]) &&
  k4o[0] === 0 && k4o[1] === k4a[1], JSON.stringify([k4a, k4b, k4o]));
pinSearch(newP, ''); await wait(40);
oldP.dom.window.close(); newP.dom.window.close();

// ══ I PIN 발급 · 재발급 그대로 ════════════════════════════════════════════
section = 'I PIN 발급 · 재발급';
// I1 소스: 발급 · 재발급 흐름의 함수 본문이 예전 판과 글자 하나까지 같음 · DB 함수를 부르는 곳이 같음
const FLOW = ['fmtPin', 'pinOk', 'credOf', 'stateOf', 'readCreds', 'probeChecked', 'refreshCreds', 'selectedIds', 'selectable', 'clearSel', 'countSel', 'planOf',
  'start', 'driftLine', 'checkLine', 'showNothing', 'skipList', 'showConfirmIssue', 'showConfirmReissue', 'run', 'paintProgress', 'sendOne', 'classify',
  'finish', 'unknownWhy', 'tally', 'samePinGroups', 'showResult', 'askClose', 'closeResult', 'endJob'];
function fnBody(src, name) {
  const lines = src.replace(/\r/g, '').split('\n');
  const i = lines.findIndex(l => l.startsWith(`    function ${name}(`));
  if (i < 0) return null;
  if (lines[i].trimEnd().endsWith('}')) return lines[i];
  let j = i + 1; while (j < lines.length && lines[j] !== '    }') j++;
  return lines.slice(i, j + 1).join('\n');
}
const fnDiff = FLOW.filter(n => { const a = fnBody(SRC.old.html, n), b = fnBody(SRC.new.html, n); return !a || a !== b; });
const rpcSites = s => (s.match(/rpc\('[a-z_]+'/g) || []).sort().join(',');
const lineSet = s => s.replace(/\r/g, '').split('\n');
const oldLines = lineSet(SRC.old.html), newLines = new Set(lineSet(SRC.new.html));
const removed = oldLines.filter(l => !newLines.has(l));
t(`I1 소스: 발급 · 재발급 흐름 함수 ${FLOW.length}개 본문이 예전 판과 같음 · DB 함수 부르는 곳(rpc) 같음 · 예전 판에서 사라진 줄은 인쇄 목록 상태 한 줄(lists)뿐`,
  fnDiff.length === 0 && rpcSites(SRC.old.html) === rpcSites(SRC.new.html) && removed.length <= 1 && removed.every(l => /lists: \{ ops: \{ q: '', zone: '', off: \{\} \}/.test(l)),
  `다름 ${fnDiff.join(',')} | 사라진 줄 ${removed.length}`);
// I2 · I3 동작: 복제 DB 두 벌 — 예전 판은 '임시구역' 찾기 + 찾은 84곳 모두 선택(예전 길), 새 판은 '실제 부스 84곳 선택'
async function runJob(P, kind) {
  click(P.w, P.d.getElementById(kind === 'issue' ? 'pinx-issue' : 'pinx-reissue'));
  await until(() => !!P.d.getElementById('pinov-word') || !!P.d.querySelector('#pinov-acts [data-ov="go"]') || /없어요/.test(text(P.d.getElementById('pinov-title'))), 15000);
  const confirm = text(P.d.getElementById('pinov-title')) + ' · ' + text(P.d.getElementById('pinov-body'));
  const word = P.d.getElementById('pinov-word');
  if (word) { word.value = '재발급'; word.dispatchEvent(new P.w.Event('input', { bubbles: true })); await wait(50); }
  const n0 = P.calls.length;
  click(P.w, P.d.querySelector('#pinov-acts [data-ov="go"]'));
  const re = kind === 'issue' ? /PIN 발급 (완료|결과)/ : /PIN 재발급 (완료|결과)/;
  await until(() => re.test(text(P.d.getElementById('pinov-title'))), 90000, 100);   // 84곳 발급은 복제 DB 에서 몇 초
  const calls = P.calls.slice(n0).filter(c => WRITES.test(c.name));
  const rows = [...P.d.querySelectorAll('#pinov-body .pinres li')].map(li => ({ code: text(li.querySelector('.pinres__code')), ok: /^\d{6}$/.test(text(li.querySelector('.pinres__pin')).replace(/\s/g, '')) }));
  const sum = text(P.d.querySelector('#pinov-body .pinov__sum'));
  click(P.w, P.d.querySelector('#pinov-acts [data-ov="close"]')); await wait(50);
  const disc = P.d.querySelector('#pinov-acts [data-ov="discard"]'); if (disc) click(P.w, disc);
  await until(() => P.d.getElementById('pinov').hidden, 5000);
  return { confirm, calls, rows, sum, after: text(P.d.getElementById('pinx-after')) };
}
async function selectReal(P) {
  if (P.which === 'new') { click(P.w, P.d.getElementById('pinx-real')); await wait(60); return; }
  pinSearch(P, '임시구역'); await wait(60);
  click(P.w, P.d.getElementById('pinx-all')); await wait(60);
}
// 인자 비교: 부스 id 는 따로 견주고, 시각 값(재발급이 보내는 ‘발급 시각’)은 두 복제 DB 에서 다를 수밖에 없어 자리만 견줌
const isTime = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v);
const sig = calls => calls.map(c => c.name + ':' + JSON.stringify(Object.fromEntries(Object.entries(c.args).filter(([k]) => k !== 'p_booth_id')
  .map(([k, v]) => [k, isTime(v) ? '<시각>' : v]).sort()))).sort();
const exPinOf = async ctx => (await ctx.db.query("select md5(coalesce(string_agg(p.booth_id::text || p.pin_hash || coalesce(p.disabled_at::text, ''), ',' order by p.booth_id), '')) f, count(*)::int n from public.booth_pin p join public.booths b on b.id = p.booth_id where b.org ~ '^\\s*\\[예시\\]'")).rows[0];
const ids = calls => calls.map(c => c.args.p_booth_id);
const job = {};
for (const which of ['old', 'new']) {
  const ctx = await prep();
  const exPin0 = await exPinOf(ctx);
  const P = await openPage(which, ctx);
  await openPin(P);
  await selectReal(P);
  const sel = pinChecked(P);
  const issue = await runJob(P, 'issue');
  const pinRowsAfter = (await ctx.db.query("select count(*)::int n from public.booth_pin p join public.booths b on b.id = p.booth_id where b.org !~ '^\\s*\\[예시\\]'")).rows[0].n;
  await selectReal(P);
  const sel2 = pinChecked(P);
  const reissue = await runJob(P, 'reissue');
  const exPin = await exPinOf(ctx);
  job[which] = { sel, sel2, issue, reissue, pinRowsAfter, exPin0, exPin, errors: P.errors };
  P.dom.window.close();
  // 복제 DB 는 닫지 않습니다 — PGlite 한 벌을 닫은 뒤 다음 벌을 준비하면(확장 · 함수 만들기) 멈추는 일이 있어, 시험이 끝날 때 함께 정리합니다.
}
const O = job.old, N = job.new;
t('I2 발급: 고른 84곳 같음(예전 길 = ‘임시구역’ 찾기 + 찾은 84곳 모두 선택) · 확인 창 글 같음 · 부른 DB 함수와 인자 같음(admin_issue_booth_pin_checked × 84 · 실제 84곳) · 결과 84줄 모두 6자리 · 실제 부스 PIN 84줄',
  sameSet(O.sel, REAL) && sameSet(N.sel, REAL) && O.issue.confirm === N.issue.confirm &&
  JSON.stringify(sig(O.issue.calls)) === JSON.stringify(sig(N.issue.calls)) && sameSet(ids(O.issue.calls), REAL) && sameSet(ids(N.issue.calls), REAL) &&
  N.issue.calls.every(c => c.name === 'admin_issue_booth_pin_checked') && N.issue.rows.length === 84 && N.issue.rows.every(x => x.ok) && O.issue.rows.length === 84 &&
  O.issue.sum === N.issue.sum && O.pinRowsAfter === 84 && N.pinRowsAfter === 84,
  JSON.stringify([O.sel.length, N.sel.length, O.issue.calls.length, N.issue.calls.length, N.issue.rows.length, O.issue.sum, N.issue.sum, O.issue.confirm === N.issue.confirm]));
t('I3 재발급: 다시 고른 84곳 같음 · 확인 창(‘재발급’ 입력) 글 같음 · 부른 DB 함수와 인자 같음 · 결과 84줄 모두 6자리',
  sameSet(O.sel2, REAL) && sameSet(N.sel2, REAL) && O.reissue.confirm === N.reissue.confirm &&
  JSON.stringify(sig(O.reissue.calls)) === JSON.stringify(sig(N.reissue.calls)) && sameSet(ids(N.reissue.calls), REAL) &&
  N.reissue.rows.length === 84 && N.reissue.rows.every(x => x.ok) && O.reissue.sum === N.reissue.sum,
  JSON.stringify([O.sel2.length, N.sel2.length, O.reissue.calls.length, N.reissue.calls.length, N.reissue.rows.length, O.reissue.sum, N.reissue.sum,
    'confirm같음 ' + (O.reissue.confirm === N.reissue.confirm), 'sig같음 ' + (JSON.stringify(sig(O.reissue.calls)) === JSON.stringify(sig(N.reissue.calls))), sig(N.reissue.calls)[0]]));
t('I4 예시 부스 PIN 은 건드리지 않음(각 복제 DB 에서 발급 · 재발급 전후 예시 PIN 2줄 지문 그대로 · 예시 부스로 가는 호출 0) · 발급 화면 오류 없음',
  O.exPin0.n === 2 && N.exPin0.n === 2 && O.exPin.f === O.exPin0.f && N.exPin.f === N.exPin0.f &&
  ![...ids(O.issue.calls), ...ids(O.reissue.calls), ...ids(N.issue.calls), ...ids(N.reissue.calls)].some(id => exSet.has(id)) && !O.errors.length && !N.errors.length,
  JSON.stringify([O.exPin0.n, N.exPin0.n, O.exPin.f === O.exPin0.f, N.exPin.f === N.exPin0.f, O.errors, N.errors]));
t('R10 화면 오류 없음(시험에 쓴 모든 화면)', ![...oldP.errors, ...newP.errors].length, [...oldP.errors, ...newP.errors].join(' | '));
await A.db.close();

const passed = results.filter(x => x.ok).length;
const pass = passed === results.length;
mkdirSync(G3, { recursive: true });
const L = ['# QR · PIN 관리 회귀 시험 결과(지금 사양)', '',
  `- 실행: ${new Date().toISOString()} · 결과 **${passed} / ${results.length} 통과**`,
  `- 예전: \`${oldRef}:print-qr.html\`(같은 커밋의 assets) · 새: \`${newPath.replace(/\\/g, '/')}\` · 새 판 assets · supabase: \`${NEW_DIR.replace(/\\/g, '/')}\``,
  '- 상태: 지금 Production 단계(실제 84 = R1~R4 공개 · QR 84 / 예시 50 = 비공개 · QR 50 · 예시 PIN 2) · 로컬 PGlite 복제 DB · jsdom · 네트워크 없음',
  '- 열쇠 · PIN 은 복제 DB 의 가짜 값이며 출력하지 않음. 발급 · 재발급 비교는 복제 DB 두 벌에서 따로.', '',
  '| 묶음 | 결과 | 시험 | 메모 |', '|---|---|---|---|'];
for (const x of results) L.push(`| ${x.section} | ${x.ok ? '통과' : '**실패**'} | ${x.name.replace(/\|/g, '/')} | ${String(x.note).replace(/\|/g, '/')} |`);
writeFileSync(resolve(G3, 'printqr-regression-report.md'), L.join('\n') + '\n');
console.log(`${pass ? 'QR 인쇄 회귀 시험 통과' : 'QR 인쇄 회귀 시험 실패'} — ${passed}/${results.length}`);
process.exit(pass ? 0 : 1);
