/* ===================================================================
   Gate 3-C QR 인쇄 화면 시험 — '배치 미정' 운영자 카드
   ───────────────────────────────────────────────────────────────────
   print-qr.html 을 jsdom 에서 관리자로 로그인한 상태로 엽니다. 데이터는 로컬 복제 DB
   (lib/replica.mjs), Supabase 는 가짜(lib/fake-rest.mjs), QR 그림 라이브러리는 빈 흉내입니다.

   상태 셋: P1 전환 뒤 · QR 사전 발급 전   P2 QR 사전 발급 뒤   P3 한 곳 배치(SW-01 · 비공개)
   보는 것: 배치 미정 묶음 · 칩 · 카드 글(번호 대신 '배치 미정' · 부스 ID 앞 8자리),
            발급 단추 · 일괄 발급 · 직접 고치기에서 빠짐, 안내문(② 부스 앞)에서 빠짐,
            화면을 열기만 해서는 발급 · 교체 · 끄기를 부르지 않음, 화면 글에 열쇠 값이 없음.

   ⚠️ 네트워크 · Production 접속 없음. 열쇠는 가짜 값이고 출력하지 않습니다.
   쓰는 법: node scripts/booth-data/test-printqr.mjs --pglite-dir <PGlite 0.4.4> --jsdom-dir <jsdom 30>
   결과: out/gate3c/printqr-test-report.md
   =================================================================== */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { readCsv } from './lib/csv.mjs';
import { loadPglite, openReplica } from './lib/replica.mjs';
import { makeRest, fakeSupabase } from './lib/fake-rest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT = resolve(HERE, 'out');
const G3 = resolve(OUT, 'gate3c');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const { JSDOM } = createRequire(join(resolve(arg('jsdom-dir')), 'package.json'))('jsdom');
const lib = await loadPglite(arg('pglite-dir'));
const dumpDir = arg('dump');   // 주면 그린 화면을 정적 HTML 로 남깁니다(스크린샷용 · 스크립트 없음 · QR 은 빈 칸)
const manifest = readCsv(resolve(OUT, 'staging', 'manifest.csv'));
const snap = readCsv(resolve(OUT, readdirSync(OUT).filter(f => /^prod-snapshot-\d{8}\.csv$/.test(f)).sort().pop()));
const key = k => manifest.find(m => m.doc_key === k).booth_id;
const R = await openReplica(lib, { snap, manifest });
const db = R.db;
const rest = makeRest(R);
const SQL = f => readFileSync(resolve(G3, f), 'utf8');

function pageHtml() {
  let html = readFileSync(resolve(REPO, 'print-qr.html'), 'utf8');
  html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>/g, '');
  for (const p of ['assets/config.js', 'assets/core.js', 'assets/booth-core.js', 'assets/mock-data.js']) {
    const src = readFileSync(resolve(REPO, p), 'utf8').replace(/<\/script/gi, '<\\/script');
    html = html.replace(new RegExp(`<script src="${p.replace(/[.]/g, '\\.')}"></script>`), () => `<script>${src}</script>`);
  }
  return html.replace(/<link[^>]+stylesheet[^>]*>/g, '');
}
async function openPage() {
  const log = [];
  const dom = new JSDOM(pageHtml(), {
    url: 'https://sinjhon1245-cell.github.io/incheon-festival/print-qr.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.supabase = fakeSupabase(R, log);
      function QRCode() { /* 그림은 그리지 않습니다(열쇠가 담긴 주소를 남기지 않음) */ }
      QRCode.CorrectLevel = { L: 1, M: 0, Q: 3, H: 2 };
      w.QRCode = QRCode;
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.scrollTo = () => {};
      w.print = () => {};
      w.fetch = async (u) => {
        const s = String(u), i = s.indexOf('/rest/v1/');
        if (i < 0) throw new Error('예상 밖 요청 ' + s);
        const r = await rest(s.slice(i + 9));
        const text = JSON.stringify(r.body);
        return { ok: r.status < 400, status: r.status, text: async () => text, json: async () => r.body };
      };
      w.console.warn = () => {};
    }
  });
  const errors = [];
  dom.window.addEventListener('error', e => errors.push(e.message));
  for (let i = 0; i < 80; i++) {
    await new Promise(r => setTimeout(r, 75));
    if (dom.window.document.querySelectorAll('.item--ops').length && log.includes('rpc:admin_booth_access')) break;
  }
  await new Promise(r => setTimeout(r, 400));
  return { dom, d: dom.window.document, log, errors };
}
function dump(p, name) {
  if (!dumpDir) return;
  const src = readFileSync(resolve(REPO, 'print-qr.html'), 'utf8');
  const links = [...src.matchAll(/<link[^>]+stylesheet[^>]*>/g)].map(m => m[0]).join('');
  const root = p.d.documentElement.cloneNode(true);
  root.querySelectorAll('script').forEach(x => x.remove());
  root.querySelectorAll('input').forEach(x => { if (x.value) x.setAttribute('value', x.value); });
  root.querySelectorAll('[data-qr]').forEach(x => { x.setAttribute('style', 'aspect-ratio:1;background:repeating-linear-gradient(45deg,#d9dce3 0 3px,#fff 3px 7px)'); });
  const html = '<!doctype html>' + root.outerHTML.replace('<head>', '<head><base href="' + pathToFileURL(REPO).href + '/">' + links);
  writeFileSync(resolve(dumpDir, name + '.html'), html);
}
const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const results = [];
function t(name, ok, note = '') { results.push({ name, ok: !!ok, note }); console.log(`${ok ? '통과' : '실패'}  ${name}${note ? '  — ' + note : ''}`); }
const MUTATING = ['admin_issue_booth_tokens', 'admin_rotate_booth_token', 'admin_disable_booth_token', 'admin_set_booth_live', 'admin_reset_booth_live', 'admin_issue_booth_pin', 'admin_issue_booth_pin_checked', 'admin_disable_booth_pin'];
const mutated = log => log.filter(x => x.startsWith('rpc:') && MUTATING.includes(x.slice(4)) && x !== 'rpc:admin_issue_booth_pin_checked');

await R.run(readFileSync(resolve(REPO, 'supabase/migration-booth-preview.sql'), 'utf8'));
let r = await R.run(SQL('C-02-transition.sql'));
t('P0 전환 SQL 성공', r.ok, r.error || '');

// ══ P1 전환 뒤 · QR 사전 발급 전 ════════════════════════════════════
let p = await openPage();
let ops = [...p.d.querySelectorAll('.item--ops')];
let un = ops.filter(el => el.classList.contains('is-unplaced'));
t('P1-1 화면 열림 · 오류 없음 · 운영자 카드 134(예시 50 + 배치 미정 84)', !p.errors.length && ops.length === 134 && un.length === 84, `${ops.length} / ${un.length} ${p.errors.join(' | ')}`);
const sect = [...p.d.querySelectorAll('.zsect')].find(s => s.getAttribute('data-zone') === '__unplaced');
const opsSects = sect ? [...sect.parentElement.querySelectorAll(':scope > .zsect')] : [];
t('P1-2 운영자 카드 맨 뒤 ‘배치 미정’ 묶음', !!sect && text(sect.querySelector('.zsect__h')) === '배치 미정' && opsSects[opsSects.length - 1] === sect, `${text(sect?.querySelector('.zsect__h'))} · 묶음 ${opsSects.length}개 중 마지막`);
const chip = [...p.d.querySelectorAll('.zchip')].find(c => c.getAttribute('data-zone-f') === '__unplaced');
t('P1-3 ‘배치 미정 84’ 칩', !!chip && /배치 미정\s*84/.test(text(chip)), text(chip));
t('P1-4 배치 미정 카드 모두 QR 미발급(is-nokey) · 발급 단추 없음', un.every(el => el.classList.contains('is-nokey') && !el.querySelector('[data-act="issue"]')));
t('P1-5 배치 미정 카드 안내: 사전 발급 SQL', un.every(el => /사전 발급 SQL/.test(text(el))));
t('P1-6 배치 미정 카드에 ‘대기 값 직접 고치기’ 없음', un.every(el => !el.querySelector('[data-act="fix"]')));
const s13 = key('S13');
const card13 = un.find(el => el.getAttribute('data-id') === s13);
t('P1-7 카드: 번호 자리 “배치 미정” · 부스명 · 학교 · 부스 ID 앞 8자리', !!card13 && text(card13.querySelector('.card__code')) === '배치 미정'
  && text(card13.querySelector('.card__name')) === manifest.find(m => m.doc_key === 'S13').name
  && text(card13.querySelector('.card__org')) === '인천심곡초등학교' && text(card13.querySelector('.card__bid')) === '부스 ID ' + s13.slice(0, 8), text(card13?.querySelector('.card__bid')));
t('P1-8 화면을 열기만 해서는 발급 · 교체 · 끄기 · 값 고치기를 부르지 않음', mutated(p.log).length === 0, mutated(p.log).join(','));
t('P1-9 ② 부스 앞 안내문에는 배치 미정 없음', ![...p.d.querySelectorAll('.item--sign, [data-list="signs"] .item')].some(el => el.classList.contains('is-unplaced')));

// ══ P2 QR 사전 발급 뒤 ══════════════════════════════════════════════
r = await R.run(SQL('Q-02-qr-preissue.sql'));
t('P2-0 QR 사전 발급 SQL 성공', r.ok, r.error || '');
const tokensBefore = (await db.query('select md5(string_agg(booth_id::text || token, \',\' order by booth_id)) f from public.booth_access')).rows[0].f;
p = await openPage();
ops = [...p.d.querySelectorAll('.item--ops')];
un = ops.filter(el => el.classList.contains('is-unplaced'));
t('P2-1 배치 미정 84 카드 모두 QR 있음(is-nokey 아님) · 인쇄 대상', un.length === 84 && un.every(el => !el.classList.contains('is-nokey') && !el.classList.contains('is-keyoff') && el.querySelector('[data-qr]')));
const tails = Object.fromEntries((await db.query('select booth_id, right(token, 4) t from public.booth_access')).rows.map(x => [x.booth_id, x.t]));
t('P2-2 카드: QR 끝자리 4자만(DB 열쇠 끝 4자와 같음 · 전체 열쇠 아님)', un.every(el => {
  const m = /끝자리\s*(\S{4})$/.exec(text(el.querySelector('.card__meta')));
  return m && m[1] === tails[el.getAttribute('data-id')];
}));
const allTokens = (await db.query('select token from public.booth_access')).rows.map(x => x.token);
const html = p.d.documentElement.outerHTML;
t('P2-3 화면 HTML 에 열쇠 값(24자) 없음', allTokens.every(tk => !html.includes(tk)));
t('P2-4 화면을 다시 열어도 발급 · 교체 없음 · 열쇠 그대로', mutated(p.log).length === 0 && (await db.query('select md5(string_agg(booth_id::text || token, \',\' order by booth_id)) f from public.booth_access')).rows[0].f === tokensBefore);
t('P2-5 배치 미정 카드: 화면 안내 “구역 · 번호가 정해져 공개되면 이 QR로 접속”', un.every(el => /공개되면 이 QR로 접속/.test(text(el))));
t('P2-6 오류 없음', !p.errors.length, p.errors.join(' | '));
dump(p, 'printqr-P2-unplaced');
// 배부용 인쇄: '배치 미정' 칩만 눌러 84장(A4 21쪽) · 예시 카드는 섞이지 않음
const unChip = [...p.d.querySelectorAll('.zchip')].find(c => c.getAttribute('data-zone-f') === '__unplaced' && c.getAttribute('data-list') === 'ops');
unChip.dispatchEvent(new p.dom.window.MouseEvent('click', { bubbles: true }));
const countEl = [...p.d.querySelectorAll('p, div, span')].find(el => !el.children.length && /^인쇄할 카드 /.test(text(el)));
t('P2-7 배치 미정 칩 → 인쇄할 카드 84장 · A4 21쪽 · 예시 없음 · 발급 · 교체 없음',
  !!countEl && /^인쇄할 카드 84장 · A4 21쪽/.test(text(countEl)) && !/예시/.test(text(countEl)) && mutated(p.log).length === 0, countEl ? text(countEl) : '개수 줄 없음');

// ══ P3 한 곳 배치(SW-01 · 아직 비공개) ═══════════════════════════════
await db.exec("insert into public.zones (key, label, sort_order, is_published) values ('SW', '스쿨존 웨이브홀', 20, false);");
await db.query("update public.booths set zone_key = 'SW', no = 1 where id = $1", [s13]);
p = await openPage();
ops = [...p.d.querySelectorAll('.item--ops')];
const placed13 = ops.find(el => el.getAttribute('data-id') === s13);
t('P3-1 배치된 S13: 배치 미정에서 빠지고 SW-01 카드 · 같은 QR(열쇠 그대로)', !!placed13 && !placed13.classList.contains('is-unplaced') && text(placed13.querySelector('.card__code')) === 'SW-01'
  && !placed13.classList.contains('is-nokey') && ops.filter(el => el.classList.contains('is-unplaced')).length === 83
  && (await db.query('select md5(string_agg(booth_id::text || token, \',\' order by booth_id)) f from public.booth_access')).rows[0].f === tokensBefore, text(placed13?.querySelector('.card__code')));
t('P3-2 SW 구역 묶음 · 칩', [...p.d.querySelectorAll('.zsect')].some(s => s.getAttribute('data-zone') === 'SW') && [...p.d.querySelectorAll('.zchip')].some(c => c.getAttribute('data-zone-f') === 'SW'));
t('P3-3 오류 없음 · 발급 · 교체 없음', !p.errors.length && mutated(p.log).length === 0, p.errors.join(' | '));
await db.close();

const pass = results.every(x => x.ok);
const L = ['# Gate 3-C QR 인쇄 화면 시험 결과', '', '- 화면: print-qr.html(이 브랜치) — jsdom 30.1.1, 관리자 로그인 흉내, QR 그림 라이브러리 빈 흉내',
  '- 데이터: 로컬 복제 DB(PostgreSQL 17.5) — 전환 · QR 사전 발급 SQL 을 고치지 않고 실행', '- 열쇠 값은 출력하지 않음', '',
  `## 판정: ${pass ? '통과' : '실패'} (${results.filter(x => x.ok).length}/${results.length})`, '', '| 결과 | 시험 | 내용 |', '|---|---|---|'];
for (const x of results) L.push(`| ${x.ok ? '통과' : '**실패**'} | ${x.name} | ${String(x.note).replace(/\|/g, '\\|')} |`);
writeFileSync(resolve(G3, 'printqr-test-report.md'), L.join('\n') + '\n');
console.log(`${pass ? 'QR 인쇄 화면 시험 통과' : 'QR 인쇄 화면 시험 실패'} — ${results.filter(x => x.ok).length}/${results.length}`);
process.exit(pass ? 0 : 1);
