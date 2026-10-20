/* ===================================================================
   Gate 3-C 관람객 화면 시험 — 스냅샷 서버 + 관람객 화면을 로컬 복제 DB 위에서
   ───────────────────────────────────────────────────────────────────
   로컬 복제 DB(lib/replica.mjs)를 익명(anon) 권한으로 읽는 가짜 PostgREST 를 만들고,
   booth-live 쪽 live/api/live-snapshot.mjs 를 고치지 않고 불러 스냅샷을 만든 뒤,
   visitor.html(+ assets)을 jsdom 에서 그 스냅샷으로 그려 봅니다.

   상태 넷:  S1 지금(Production 과 같음 · migration 전)  S2 migration 만 적용
             S3 전환(예시 비공개 · 실제 사전 안내)        S4 세 곳 배치 · 공개 + QR 사전 발급
   함께 보는 것: 예전 화면(origin/booth-live)이 새 스냅샷을 받아도 깨지지 않는지(배포 순서 안전),
                 S1 에서 새 화면의 목록이 예전 화면과 같은지(회귀), 스냅샷에 열쇠 값이 없는지.

   ⚠️ 네트워크 · Production 접속 없음. 열쇠 · PIN 은 가짜 값이고 출력하지 않습니다.

   쓰는 법
     node scripts/booth-data/test-visitor-preview.mjs --pglite-dir <PGlite 0.4.4> --jsdom-dir <jsdom 30> \
          --live-dir <booth-live 작업 폴더(새 화면)> [--old-ref origin/booth-live]
   결과: out/gate3c/visitor-test-report.md
   =================================================================== */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { readCsv } from './lib/csv.mjs';
import { loadPglite, openReplica } from './lib/replica.mjs';
import { makeRest } from './lib/fake-rest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT = resolve(HERE, 'out');
const G3 = resolve(OUT, 'gate3c');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const liveDir = resolve(arg('live-dir', resolve(REPO, '../incheon-festival-booth-live-preview')));
const oldRef = arg('old-ref', 'origin/booth-live');
// S3-16(배포 순서 안전)은 '배치 준비 중' 을 모르는 옛 화면이 새 스냅샷을 받아도 깨지지 않는지 보는 시험입니다.
// 이 시험을 쓸 때 '예전 화면' 은 origin/booth-live = 6fd46d8 이었습니다. 그 뒤 429535a(배치 준비 중)가 병합되어 origin/booth-live 가
// 그 기능을 담은 판(c6736cb)이 되자, 예전 화면도 '배치 준비 중' 을 그려 '부스 정보 준비 중' 을 찾는 이 항목만 실패했습니다.
// 그래서 이 항목은 그 기능 이전 판에 고정합니다(다른 회귀 비교는 지금처럼 origin/booth-live).
const legacyRef = arg('legacy-ref', '6fd46d8');   // 이 시험을 쓴 10-15 의 origin/booth-live — '배치 준비 중'(429535a) 이전 판
const dumpDir = arg('dump');   // 주면 몇 상태의 그린 화면을 정적 HTML 로 남깁니다(스크린샷용 · 스크립트 없음)
const { JSDOM } = createRequire(join(resolve(arg('jsdom-dir')), 'package.json'))('jsdom');
const lib = await loadPglite(arg('pglite-dir'));

const manifest = readCsv(resolve(OUT, 'staging', 'manifest.csv'));
const snap = readCsv(resolve(OUT, readdirSync(OUT).filter(f => /^prod-snapshot-\d{8}\.csv$/.test(f)).sort().pop()));
const key = k => manifest.find(m => m.doc_key === k).booth_id;
const R = await openReplica(lib, { snap, manifest });
const db = R.db;
const SQL = f => readFileSync(resolve(G3, f), 'utf8');

// ── 가짜 PostgREST: 익명 권한으로 복제 DB 를 읽습니다(RLS 그대로) ─────────
const rest = makeRest(R);
globalThis.fetch = async (url) => {
  const u = String(url), i = u.indexOf('/rest/v1/');
  if (i < 0) throw new Error('예상 밖 요청: ' + u);
  const r = await rest(u.slice(i + 9));
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
};
let modN = 0;
async function snapshotNow(at) {
  // 모듈 안 캐시(60초)를 피하려고 상태마다 새로 불러옵니다. at 을 주면 그 시각(행사 중 등)으로 만듭니다.
  const mod = await import(pathToFileURL(join(liveDir, 'live/api/live-snapshot.mjs')).href + '?state=' + (++modN));
  const realNow = Date.now;
  if (at) Date.now = () => at;
  try {
    const res = await mod.default.fetch(new Request('https://incheon-live.vercel.app/api/live-snapshot'));
    return { status: res.status, json: JSON.parse(await res.text()) };
  } finally { Date.now = realNow; }
}
// 관람객 화면의 시계를 옮깁니다(행사 당일 · 운영 중 · 끝난 뒤를 미리 봄).
function fakeClock(w, at) {
  const RD = w.Date, off = at - RD.now();
  function FD(...a) { if (!new.target) return new RD(RD.now() + off).toString(); return a.length ? new RD(...a) : new RD(RD.now() + off); }
  FD.prototype = RD.prototype; FD.now = () => RD.now() + off; FD.UTC = RD.UTC; FD.parse = RD.parse;
  w.Date = FD;
}
const KST = iso => Date.parse(iso + '+09:00');

// ── 관람객 화면(jsdom) ─────────────────────────────────────────────
const gitShow = (p, ref = oldRef) => execFileSync('git', ['-C', REPO, 'show', `${ref}:${p}`], { encoding: 'utf8', maxBuffer: 1 << 26 });
const fileOf = (which, p) => which === 'new' ? readFileSync(join(liveDir, p), 'utf8') : gitShow(p, which === 'legacy' ? legacyRef : oldRef);
function pageHtml(which) {
  let html = fileOf(which, 'visitor.html');
  for (const p of ['assets/config.js', 'assets/mock-data.js', 'assets/booth-core.js']) {
    const src = fileOf(which, p).replace(/<\/script/gi, '<\\/script');
    html = html.replace(new RegExp(`<script src="${p.replace(/[.]/g, '\\.')}"></script>`), () => `<script>${src}</script>`);
  }
  return html.replace(/<link[^>]+stylesheet[^>]*>/g, '');
}
async function renderPage(which, snapshotJson, query = '', at = 0) {
  const dom = new JSDOM(pageHtml(which), {
    url: 'https://incheon-live.vercel.app/' + query, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.scrollTo = () => {};
      w.fetch = (u) => {
        if (!String(u).endsWith('/api/live-snapshot')) return Promise.reject(new Error('예상 밖 요청 ' + u));
        const text = JSON.stringify(snapshotJson);
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(text) });
      };
      w.console.warn = () => {};
      if (at) fakeClock(w, at);
    }
  });
  const errors = [];
  dom.window.addEventListener('error', e => errors.push(e.message));
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 50));
    const d = dom.window.document;
    if (d.querySelector('#list .row, #list .empty, #pending .row')) break;
  }
  await new Promise(r => setTimeout(r, 100));
  return { dom, d: dom.window.document, errors };
}
function dump(p, name) {
  if (!dumpDir) return;
  const src = fileOf('new', 'visitor.html');
  const links = [...src.matchAll(/<link[^>]+stylesheet[^>]*>/g)].map(m => m[0]).join('');
  const root = p.d.documentElement.cloneNode(true);
  root.querySelectorAll('script').forEach(x => x.remove());
  root.querySelectorAll('input').forEach(x => { if (x.value) x.setAttribute('value', x.value); });
  const html = '<!doctype html>' + root.outerHTML.replace('<head>', '<head><base href="' + pathToFileURL(liveDir).href + '/">' + links);
  writeFileSync(resolve(dumpDir, name + '.html'), html);
}
const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
function typeSearch(dom, q) {
  const d = dom.window.document;
  const input = d.querySelector('#search input, input[type="search"]');
  if (!input) return false;
  input.value = q;
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  return true;
}

const results = [];
function t(name, ok, note = '') { results.push({ name, ok: !!ok, note }); console.log(`${ok ? '통과' : '실패'}  ${name}${note ? '  — ' + note : ''}`); }
const allTokens = async () => (await db.query('select token from public.booth_access')).rows.map(r => r.token);
const noTokenIn = async json => { const s = JSON.stringify(json); return (await allTokens()).every(tk => !s.includes(tk)); };

// ══ S1 지금(migration 전) ═══════════════════════════════════════════
let s = await snapshotNow();
t('S1-1 스냅샷 200 · 부스 50 · unplaced 0(함수 없음 → 빈 목록)', s.status === 200 && s.json.booths.length === 50 && Array.isArray(s.json.unplaced) && s.json.unplaced.length === 0, `status ${s.status}`);
t('S1-2 행사 전: 예시만 대기 값(미리 보기 규칙 그대로)', s.json.booths.every(b => b.status !== null));
t('S1-3 스냅샷에 열쇠 값 없음', await noTokenIn(s.json));
let pNew = await renderPage('new', s.json), pOld = await renderPage('old', s.json);
t('S1-4 새 화면: 목록 50줄 · 배치 준비 중 숨김 · 오류 없음', pNew.d.querySelectorAll('#list .row').length === 50 && pNew.d.getElementById('pending').hidden && !pNew.errors.length, pNew.errors.join(' | '));
t('S1-5 회귀: 새 화면의 목록 HTML = 예전 화면', pNew.d.getElementById('list').innerHTML === pOld.d.getElementById('list').innerHTML && pOld.d.querySelectorAll('#list .row').length === 50);
// 2026-10-19 리허설: 행사 전 값이 보이면 큰 숫자 아래 안내 한 줄(#h-rh)이 더해집니다 — 그 줄을 뺀 나머지가 예전과 같아야 합니다.
const heroNoRh = p => { const h = p.d.getElementById('hero').cloneNode(true); const x = h.querySelector('#h-rh'); if (x) x.remove(); return text(h); };
t('S1-6 회귀: 큰 숫자(리허설 안내 한 줄 빼고) · 결과 줄 = 예전 화면 · 안내 줄 “행사 전 리허설 값이에요 …”', heroNoRh(pNew) === heroNoRh(pOld) && /행사 전 리허설 값이에요/.test(text(pNew.d.getElementById('h-rh'))) && text(pNew.d.getElementById('result')) === text(pOld.d.getElementById('result')), text(pNew.d.getElementById('result')));

// ══ S2 migration 만 ════════════════════════════════════════════════
await R.run(readFileSync(resolve(REPO, 'supabase/migration-booth-preview.sql'), 'utf8'));
s = await snapshotNow();
t('S2-1 migration 만: 부스 50 · unplaced 0(아직 아무도 사전 안내 아님)', s.json.booths.length === 50 && s.json.unplaced.length === 0);
pNew = await renderPage('new', s.json);
t('S2-2 새 화면 그대로(목록 50 · 배치 준비 중 숨김)', pNew.d.querySelectorAll('#list .row').length === 50 && pNew.d.getElementById('pending').hidden);

// ══ S3 전환 ════════════════════════════════════════════════════════
let r = await R.run(SQL('C-02-transition.sql'));
t('S3-0 전환 SQL 성공', r.ok, r.error || '');
s = await snapshotNow();
const up = s.json.unplaced;
t('S3-1 스냅샷: 부스 0 · unplaced 84', s.json.booths.length === 0 && up.length === 84, `${s.json.booths.length} / ${up.length}`);
t('S3-2 unplaced 칸 = id · name · org · program 뿐 · 대기 값 없음', up.every(b => JSON.stringify(Object.keys(b)) === JSON.stringify(['id', 'name', 'org', 'program'])));
t('S3-3 unplaced 에 [예시] 없음 · 실제 84 UUID 와 같음', up.every(b => !/\[예시\]/.test(b.org)) && up.map(b => b.id).sort().join() === manifest.map(m => m.booth_id).sort().join());
t('S3-4 스냅샷에 열쇠 값 없음', await noTokenIn(s.json));
pNew = await renderPage('new', s.json);
const pend = pNew.d.getElementById('pending');
t('S3-5 새 화면: 배치 준비 중 84줄 · 제목 · 안내', !pend.hidden && pend.querySelectorAll('.row.is-pending').length === 84 && /배치 준비 중\s*84곳/.test(text(pend.querySelector('h2'))) && /배치가 확정되면/.test(text(pend)), text(pend.querySelector('h2')));
t('S3-6 각 줄: 번호 자리 “배치 준비 중” · 학교 · 대기 값 없음', [...pend.querySelectorAll('.row.is-pending')].every(li => /배치\s*준비 중/.test(text(li.querySelector('.row__code'))) && !text(li.querySelector('.row__right'))));
t('S3-7 첫 줄 S01 · 학교명 표시', text(pend.querySelector('.row__name')) === manifest[0].name && text(pend.querySelector('.row__org')) === manifest[0].org);
t('S3-8 “부스 정보 준비 중” 빈 안내 · 예시 입구 없음 · 결과 84곳', !/부스 정보 준비 중/.test(text(pNew.d.getElementById('list'))) && /84곳/.test(text(pNew.d.getElementById('result'))), text(pNew.d.getElementById('result')));
t('S3-9 검색칸 보임(배치 준비 중만 있어도)', !pNew.d.getElementById('bar').hidden && !pNew.d.getElementById('search').hidden);
t('S3-10 큰 숫자: 행사 전 D-day 안내(대기 값 없음)', /D-\d+/.test(text(pNew.d.getElementById('hero'))), text(pNew.d.getElementById('hero')).slice(0, 40));
t('S3-11 오류 없음', !pNew.errors.length, pNew.errors.join(' | '));
dump(pNew, 'visitor-S3-unplaced');
// 검색
typeSearch(pNew.dom, '서운');
await new Promise(r => setTimeout(r, 400));
const hits = [...pNew.d.querySelectorAll('#pending .row.is-pending')].map(li => text(li.querySelector('.row__org')));
dump(pNew, 'visitor-S3-search');
t('S3-12 학교명 검색 “서운” → 서운고등학교 1곳 · 결과 줄', hits.length === 1 && hits[0] === '서운고등학교' && /검색 결과\s*1곳/.test(text(pNew.d.getElementById('result'))), `${hits.join(',')} · ${text(pNew.d.getElementById('result'))}`);
typeSearch(pNew.dom, '드론');
await new Promise(r => setTimeout(r, 400));
const drone = pNew.d.querySelectorAll('#pending .row.is-pending').length;
t('S3-13 주제 검색 “드론” → 여러 곳(부스명에 드론)', drone === manifest.filter(m => m.name.includes('드론')).length && drone > 1, `${drone}곳`);
typeSearch(pNew.dom, '없는부스이름');
await new Promise(r => setTimeout(r, 400));
t('S3-14 맞는 곳 없음 → “찾는 부스가 없어요”', /찾는 부스가 없어요/.test(text(pNew.d.getElementById('list'))) && pNew.d.getElementById('pending').hidden);
// 부스 앞 QR(?b=) — UUID 앞 8자
const s13 = key('S13');
const here = await renderPage('new', s.json, '?b=' + s13.slice(0, 8));
dump(here, 'visitor-S3-here');
t('S3-15 ?b=(UUID 앞 8자) → “지금 계신 부스 · 배치 준비 중” 카드', /배치 준비 중/.test(text(here.d.getElementById('here'))) && text(here.d.getElementById('here')).includes(manifest.find(m => m.doc_key === 'S13').name) && !here.d.getElementById('here').hidden);
// 예전 화면이 새 스냅샷을 받으면(배포 순서: DB 먼저 · 화면 나중)
pOld = await renderPage('legacy', s.json);
t(`S3-16 예전 화면(배치 준비 중 이전 판 ${legacyRef}) + 새 스냅샷: 깨지지 않음(“부스 정보 준비 중”)`, !pOld.errors.length && /부스 정보 준비 중/.test(text(pOld.d.getElementById('list'))), pOld.errors.join(' | '));

// ══ S5 전환 뒤 메인 화면 — 시각별(예시 0 · 배치 0 · 배치 준비 중 84) ══════════════
// 위쪽 숫자가 '0곳' 이 되거나, 구역이 없어 빈 화면처럼 보이면 안 됩니다. 검색 · 목록은 84곳 기준.
const visibleText = d => ['hero', 'result', 'list', 'pending'].map(id => { const el = d.getElementById(id); return el && !el.hidden ? text(el) : ''; }).join(' ');
const zeroCount = d => /(^|[^0-9])0\s*곳/.test(visibleText(d));
const TIMES = [
  ['지금(행사 22일 전)', 0, /D-\d+/],
  ['첫날 09:00(문 열기 전)', KST('2026-11-06T09:00:00'), /문을 열어요/],
  ['첫날 11:00(운영 중)', KST('2026-11-06T11:00:00'), /배치를\s*준비하고 있어요/],
  ['첫날 18:00(그날 마감)', KST('2026-11-06T18:00:00'), /오늘 체험은 끝났어요/],
  ['행사 뒤', KST('2026-11-08T12:00:00'), /행사가 끝났어요/]
];
for (const [label, at, heroRe] of TIMES) {
  const sAt = at ? await snapshotNow(at) : s;
  const pg = await renderPage('new', sAt.json, '', at);
  const d = pg.d, pendN = d.querySelectorAll('#pending .row.is-pending').length;
  t(`S5 ${label}: 위 안내 맞음 · '0곳' 없음 · 결과 84곳 · 배치 준비 중 84줄 · 검색칸 · 빈 안내 없음 · 오류 없음`,
    heroRe.test(text(d.getElementById('hero'))) && !zeroCount(d) && /^84곳$/.test(text(d.getElementById('result'))) && pendN === 84 &&
    !d.getElementById('bar').hidden && !d.getElementById('search').hidden && !d.querySelector('#list .empty') && !pg.errors.length,
    `${text(d.getElementById('hero')).slice(0, 48)} · ${text(d.getElementById('result'))} · ${pendN}줄${pg.errors.length ? ' · ' + pg.errors.join(' | ') : ''}`);
  if (at === KST('2026-11-06T11:00:00')) {
    dump(pg, 'visitor-S5-open-placing');
    typeSearch(pg.dom, '서운');
    await new Promise(r => setTimeout(r, 400));
    t('S5 운영 중 검색 “서운” → 1곳 · 결과 줄', d.querySelectorAll('#pending .row.is-pending').length === 1 && /검색 결과\s*1곳/.test(text(d.getElementById('result'))));
    t('S5 운영 중: 한눈에 · 정렬 · 상태 고르기 줄은 숨김(대기 값 없음)', d.getElementById('controls').hidden);
  }
}

// ══ S4 세 곳 배치 · 공개 + QR 사전 발급 ═════════════════════════════
r = await R.run(SQL('Q-02-qr-preissue.sql'));
t('S4-0 QR 사전 발급 성공', r.ok, r.error || '');
await db.exec("insert into public.zones (key, label, sort_order, is_published) values ('SW', '스쿨존 웨이브홀', 20, true);");
for (const [i, k] of ['S13', 'S04', 'S28'].entries()) await db.query("update public.booths set zone_key = 'SW', no = $2 where id = $1", [key(k), i + 1]);
await db.query('update public.booths set is_published = true where id = any($1::uuid[])', [[key('S13'), key('S04'), key('S28')]]);
await db.query("select * from public.booth_ctrl_set((select token from public.booth_access where booth_id = $1), 'open', 12)", [s13]);
s = await snapshotNow();
t('S4-1 스냅샷: 부스 3(SW) · unplaced 81', s.json.booths.length === 3 && s.json.unplaced.length === 81 && s.json.booths.every(b => b.zone === 'SW'));
// 2026-10-19 리허설 규칙: 행사 전에도 오늘 넣은 값은 보냅니다(관람객 화면이 '리허설 중' 띠를 붙임).
t('S4-2 행사 전: 오늘 넣은 실제 부스 값도 리허설로 보냄(SW-01 12분) · 입력 없는 2곳은 빈 값', s.json.booths.find(b => b.id === s13).waitMinutes === 12 && s.json.booths.filter(b => b.id !== s13).every(b => b.status === null && b.waitMinutes === null));
t('S4-3 스냅샷에 열쇠 값 없음', await noTokenIn(s.json));
pNew = await renderPage('new', s.json);
t('S4-4 새 화면: 배치된 3곳 목록 + 배치 준비 중 81줄 · 결과 84곳',
  pNew.d.querySelectorAll('#list .row').length === 3 && pNew.d.querySelectorAll('#pending .row.is-pending').length === 81 && /84곳/.test(text(pNew.d.getElementById('result'))),
  `${pNew.d.querySelectorAll('#list .row').length} + ${pNew.d.querySelectorAll('#pending .row').length} · ${text(pNew.d.getElementById('result'))}`);
t('S4-5 배치된 부스는 번호(SW-01) · 구역 제목', /SW-01/.test(text(pNew.d.getElementById('list'))));
t('S4-6 오류 없음', !pNew.errors.length, pNew.errors.join(' | '));
dump(pNew, 'visitor-S4-placed');
// ══ S7 검색 안내 · 결과 줄 · 체험 내용 찾기(1차 UI 수정 V-1 · V-2) ═══════════════
{
  const d = pNew.d;
  const field = text(d.getElementById('search-field')), ph = d.getElementById('q').getAttribute('placeholder');
  t('S7-1 검색 안내에 학교명 — 찾기 칸 “부스 이름 · 번호 · 학교명으로 찾기” · 입력 칸 “부스 이름 · 번호 · 학교명”(‘체험 내용’ 대신 · 10-20 확정)',
    field === '부스 이름 · 번호 · 학교명으로 찾기' && ph === '부스 이름 · 번호 · 학교명', `${field} | ${ph}`);
  const b0 = s.json.booths.find(b => b.code === 'SW-03');
  typeSearch(pNew.dom, b0.org);
  await new Promise(r => setTimeout(r, 150));
  const res = d.getElementById('result');
  const loose = [...res.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
  const hit = [...d.querySelectorAll('#list .row')].filter(el => !el.hidden).map(el => text(el));
  t('S7-2 학교명으로 찾기(SW-03 학교명 전체) → 그 부스 · 결과 줄 “검색 결과 N곳” — 글자와 굵은 수가 한 덩이(span.result__t) 안이라 flex 줄에서도 띄어쓰기 유지',
    hit.some(x => /SW-03/.test(x)) && /^검색 결과 \d+곳$/.test(text(res)) && res.firstElementChild && res.firstElementChild.className === 'result__t' &&
    res.firstElementChild.querySelector('b') && loose.length === 0, `${text(res)} · ${res.innerHTML.slice(0, 120)} · ${hit.length}`);
  typeSearch(pNew.dom, '없는부스이름');
  await new Promise(r => setTimeout(r, 150));
  t('S7-3 결과 없음 안내 “부스 이름 · 번호 · 학교명의 일부로 찾아 보세요.”', /찾는 부스가 없어요/.test(text(d.getElementById('list'))) &&
    /부스 이름 · 번호 · 학교명의 일부로 찾아 보세요\./.test(text(d.getElementById('list'))), text(d.getElementById('list')).slice(0, 120));
  // 체험 내용 찾기는 그대로 — 지금 Production 은 체험 내용이 모두 비어 있어, 시험 스냅샷 한 곳에만 글을 넣어 봄(DB 는 그대로)
  const sp = JSON.parse(JSON.stringify(s.json));
  const target = sp.booths.find(b => b.code === 'SW-02');
  target.program = '드론으로 그리는 하늘 지도';
  const pp = await renderPage('new', sp);
  typeSearch(pp.dom, '하늘 지도');
  await new Promise(r => setTimeout(r, 150));
  const progHit = [...pp.d.querySelectorAll('#list .row')].filter(el => !el.hidden).map(el => text(el));
  t('S7-4 체험 내용으로 찾기 그대로 — 시험 스냅샷의 SW-02 체험 내용 일부(‘하늘 지도’) → SW-02 한 곳 · 오류 없음',
    progHit.length === 1 && /SW-02/.test(progHit[0]) && /^검색 결과 1곳$/.test(text(pp.d.getElementById('result'))) && !pp.errors.length,
    `${progHit.length} ${text(pp.d.getElementById('result'))} ${pp.errors.join('|')}`);
  pp.dom.window.close();
  typeSearch(pNew.dom, '');
  await new Promise(r => setTimeout(r, 100));
}
// 운영 중(첫날 11:00): 배치된 3곳 + 배치 준비 중 81곳 — 위 '전체' 는 아래 목록과 같은 84곳
{
  const at = KST('2026-11-06T11:00:00');
  // 입력 시각을 그 시각 2분 전으로(시험 DB 만 · 오래된 값으로 세지 않게)
  await db.query('update public.booth_live set updated_at = to_timestamp($1::double precision / 1000) where booth_id = $2', [at - 120000, s13]);
  const sAt = await snapshotNow(at);
  t('S4-7 운영 중 스냅샷: 실제 부스 대기 값 보임(SW-01 12분) · unplaced 81 · 열쇠 없음',
    sAt.json.booths.some(b => b.code === 'SW-01' && b.waitMinutes === 12) && sAt.json.unplaced.length === 81 && await noTokenIn(sAt.json));
  const pg = await renderPage('new', sAt.json, '', at), d = pg.d;
  t('S4-8 운영 중 위 숫자: “지금 여유로운 부스” · 전체 84곳 · 입력 1곳 기준 · 배치 준비 중 81곳 안내 · 결과 84곳',
    /지금 여유로운 부스/.test(text(d.getElementById('hero'))) && /입력된 1곳 기준/.test(text(d.getElementById('h-sub'))) && text(d.getElementById('h-total')) === '84' && /배치 준비 중 81곳/.test(text(d.getElementById('h-sub'))) &&
    /^84곳$/.test(text(d.getElementById('result'))) && !pg.errors.length,
    `${text(d.getElementById('hero')).slice(0, 70)} · ${text(d.getElementById('result'))}`);
  dump(pg, 'visitor-S4-open-mixed');
}

// ══ S6 사전 안내 함수만 실패할 때(권한 · 5xx · 시간 초과) — 스냅샷 전체는 계속 ══════════
// 실패를 그대로 던지면 부스 · 구역 읽기까지 실패로 보고 10분 뒤 관람객 API 가 503 이 됩니다.
{
  const req = () => new Request('https://incheon-live.vercel.app/api/live-snapshot');
  const realNow = Date.now, base = realNow();
  let fake = base;
  Date.now = () => fake;
  const quiet = console.error;
  console.error = () => {};
  try {
    const mod = await import(pathToFileURL(join(liveDir, 'live/api/live-snapshot.mjs')).href + '?state=fail-a');
    let res = await mod.default.fetch(req()), j = JSON.parse(await res.text());
    const okBefore = res.status === 200 && j.booths.length === 3 && j.unplaced.length === 81;
    await db.exec('revoke execute on function public.booth_preview_list() from anon;');
    const denied = await rest('rpc/booth_preview_list');
    fake = base + 61 * 1000;   // 부스 목록을 다시 읽을 때(60초 뒤)
    res = await mod.default.fetch(req()); j = JSON.parse(await res.text());
    t('S6-1 함수 실행 권한이 빠져도(401 · 42501) 스냅샷 200 · 부스 3 그대로 · 사전 안내는 지난 목록 81 유지',
      okBefore && denied.status === 401 && res.status === 200 && j.booths.length === 3 && j.unplaced.length === 81 && new Date(j.generatedAt).getTime() === fake,
      `HTTP ${res.status} · 부스 ${j.booths.length} · unplaced ${j.unplaced.length}`);
    fake = base + 15 * 60 * 1000;   // 10분(마지막 정상본 한도)을 넘겨도
    res = await mod.default.fetch(req()); j = JSON.parse(await res.text());
    t('S6-2 15분 뒤에도 503 이 아님(부스 · 구역은 새로 읽음)', res.status === 200 && j.booths.length === 3, `HTTP ${res.status}`);
    const denied2 = await rest('rpc/booth_preview_list');
    const mod2 = await import(pathToFileURL(join(liveDir, 'live/api/live-snapshot.mjs')).href + '?state=fail-b');
    res = await mod2.default.fetch(req()); j = JSON.parse(await res.text());
    t('S6-3 새 서버 인스턴스(지난 목록 없음)도 200 · 부스 3 · 사전 안내 빈 목록', res.status === 200 && j.booths.length === 3 && j.unplaced.length === 0,
      `HTTP ${res.status} · 부스 ${j.booths.length} · unplaced ${j.unplaced.length} · 함수 직접 ${denied2.status}`);
  } finally {
    Date.now = realNow;
    console.error = quiet;
    await db.exec('grant execute on function public.booth_preview_list() to anon;');
  }
}
await db.close();

const pass = results.every(x => x.ok);
const L = ['# Gate 3-C 관람객 화면 시험 결과', '', '- DB: PGlite · PostgreSQL 17.5(lib/replica.mjs) — 익명 권한(RLS)으로 읽는 가짜 PostgREST',
  `- 스냅샷 서버: ${liveDir.replace(/\\/g, '/')}/live/api/live-snapshot.mjs(고치지 않고 불러 실행)`,
  `- 화면: 새 visitor.html(같은 작업 폴더) · 예전 화면 ${oldRef} — jsdom 30.1.1, 네트워크 없음`, '- 열쇠 값은 출력하지 않음', '',
  `## 판정: ${pass ? '통과' : '실패'} (${results.filter(x => x.ok).length}/${results.length})`, '', '| 결과 | 시험 | 내용 |', '|---|---|---|'];
for (const x of results) L.push(`| ${x.ok ? '통과' : '**실패**'} | ${x.name} | ${String(x.note).replace(/\|/g, '\\|')} |`);
writeFileSync(resolve(G3, 'visitor-test-report.md'), L.join('\n') + '\n');
console.log(`${pass ? '관람객 화면 시험 통과' : '관람객 화면 시험 실패'} — ${results.filter(x => x.ok).length}/${results.length}`);
process.exit(pass ? 0 : 1);
