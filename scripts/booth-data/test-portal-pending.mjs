/* ===================================================================
   P1 운영 포털 시험 — 배치 준비 중인 실제 부스
   ───────────────────────────────────────────────────────────────────
   운영 포털(index.html)을 jsdom 에서 엽니다. 데이터는 로컬 복제 DB(lib/replica.mjs),
   Supabase 는 가짜(lib/fake-rest.mjs · 익명 방문자 / 관리자 로그인 둘 다)입니다.
   포털이 쓰는 나머지 표(일정 · 공지 · 요청 · 자료 · 연락처 · 장소 · FAQ)는 빈 표로 둡니다.

   상태: S0 migration 전   S1 migration 만   S2 전환 뒤(지금 Production 과 같은 모양)
         S3 함수 거절 · 없음   S4 일부 배치 · 공개   S5 84곳 모두 배치 · 공개
   보는 것: 홈 '전체 부스' 카드 · 부스 현황 화면 · 협의용 예시 · 관람객 화면 단추,
            예전 포털(--old-ref)과 같아야 하는 상태에서는 HTML 이 같은지,
            포털이 부르는 표 · 함수(열쇠 · PIN · 연락처 표 없음) · 화면에 열쇠 값 없음.

   ⚠️ 네트워크 · Production 접속 없음. 열쇠는 가짜 값이고 출력하지 않습니다.
   쓰는 법: node scripts/booth-data/test-portal-pending.mjs --pglite-dir <PGlite 0.4.4> --jsdom-dir <jsdom 30>
            [--portal-dir ../incheon-festival-p1] [--old-ref a9463c5] [--dump <폴더>]
   결과: out/gate3c/portal-pending-test-report.md
   =================================================================== */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readCsv } from './lib/csv.mjs';
import { loadPglite, openReplica } from './lib/replica.mjs';
import { makeRest, fakeSupabase } from './lib/fake-rest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT = resolve(HERE, 'out');
const G3 = resolve(OUT, 'gate3c');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const portalDir = resolve(arg('portal-dir', resolve(REPO, '../incheon-festival-p1')));
const oldRef = arg('old-ref', 'a9463c5');
const dumpDir = arg('dump');
const { JSDOM } = createRequire(join(resolve(arg('jsdom-dir')), 'package.json'))('jsdom');
const lib = await loadPglite(arg('pglite-dir'));

const manifest = readCsv(resolve(OUT, 'staging', 'manifest.csv'));
const snap = readCsv(resolve(OUT, readdirSync(OUT).filter(f => /^prod-snapshot-\d{8}\.csv$/.test(f)).sort().pop()));
const R = await openReplica(lib, { snap, manifest });
const db = R.db;
const rest = makeRest(R);
const SQL = f => readFileSync(resolve(G3, f), 'utf8');

// 포털이 함께 읽는 표 — 이 시험에서는 비어 있으면 됩니다(공개 읽기만).
await db.exec(`
  create table public.schedule_items (id uuid primary key default gen_random_uuid(), sort_order int not null default 0,
    event_date date, start_time text, end_time text, title text, place text, category text, team text, owner text,
    memo text, status text, is_highlight boolean not null default false);
  create table public.notices (id uuid primary key default gen_random_uuid(), sort_order int not null default 0,
    pinned boolean not null default false, created_at timestamptz not null default now(), level text, title text, summary text, body text);
  create table public.operation_requests (id uuid primary key default gen_random_uuid(), sort_order int not null default 0,
    created_at timestamptz not null default now(), status text, priority text, title text);
  create table public.resources (id uuid primary key default gen_random_uuid(), sort_order int not null default 0, title text, url text);
  create table public.contacts (id uuid primary key default gen_random_uuid(), sort_order int not null default 0,
    name text, org text, duty text, category text, memo text, is_staff boolean not null default false, role_group text);
  create table public.venue_places (id uuid primary key default gen_random_uuid(), sort_order int not null default 0, name text);
  create table public.faqs (id uuid primary key default gen_random_uuid(), sort_order int not null default 0, q text, a text);
  grant select on public.schedule_items, public.notices, public.operation_requests, public.resources,
    public.contacts, public.venue_places, public.faqs to anon, authenticated;
  alter table public.staff_profiles add column if not exists name text, add column if not exists email text;
`);

// ── 포털 화면 ─────────────────────────────────────────────────────
const FILES = ['assets/config.js', 'assets/core.js', 'assets/ui.js', 'assets/portal.js'];
const gitShow = p => execFileSync('git', ['-C', portalDir, 'show', `${oldRef}:${p}`], { encoding: 'utf8', maxBuffer: 1 << 26 });
const src = (variant, p) => variant === 'old' ? gitShow(p) : readFileSync(resolve(portalDir, p), 'utf8');
function pageHtml(variant) {
  let html = src(variant, 'index.html');
  html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>/g, '');
  for (const p of FILES) {
    const code = src(variant, p).replace(/<\/script/gi, '<\\/script');
    html = html.replace(new RegExp(`<script src="${p.replace(/[.]/g, '\\.')}"></script>`), () => `<script>${code}</script>`);
  }
  return html.replace(/<link[^>]+stylesheet[^>]*>/g, '');
}
const text = el => (el ? el.textContent : '').replace(/\s+/g, ' ').trim();

async function openPortal(variant, { anon = true, hash = '', sample = false } = {}) {
  const log = [], warns = [], errors = [];
  const dom = new JSDOM(pageHtml(variant), {
    url: 'https://sinjhon1245-cell.github.io/incheon-festival/' + hash, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.supabase = fakeSupabase(R, log, { anon });
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.scrollTo = () => {};
      w.fetch = async u => { throw new Error('예상 밖 요청 ' + u); };
      if (sample) w.sessionStorage.setItem('portal.sample', JSON.stringify({ booths: true, sched: true }));
      w.console.warn = (...a) => warns.push(a.map(String).join(' '));
      w.console.error = (...a) => errors.push(a.map(String).join(' '));
    }
  });
  dom.window.addEventListener('error', e => errors.push(e.message));
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 60));
    if (log.includes('select:booths') && !dom.window.document.querySelector('.skel, .is-loading, [aria-busy="true"]')) break;
  }
  await new Promise(r => setTimeout(r, 500));
  return { dom, d: dom.window.document, w: dom.window, log, warns, errors };
}
async function view(variant, hash, opts = {}) {
  const p = await openPortal(variant, { ...opts, hash });
  const main = p.d.getElementById('main');
  const out = { ...p, main, html: main ? main.innerHTML : '', txt: text(main) };
  out.stat = p.d.querySelector('.stat--booth');
  out.close = () => p.dom.window.close();
  return out;
}
// 숫자 · 이름 · 아랫줄(→ 빼고). '—' 는 화면 읽기용 '없음' 과 함께 나옵니다.
const statText = v => ['.stat__n', '.stat__l', '.stat__sub'].map(c => text(v.stat && v.stat.querySelector(c)).replace(/\s*→$/, '')).join(' ');

function dump(v, name) {
  if (!dumpDir) return;
  mkdirSync(dumpDir, { recursive: true });
  const d = v.d.cloneNode(true);
  d.querySelectorAll('script').forEach(s => s.remove());
  const head = d.querySelector('head');
  const link = d.createElement('link'); link.rel = 'stylesheet'; link.href = pathToFileURL(resolve(portalDir, 'assets/portal.css')).href;
  head.appendChild(link);
  writeFileSync(resolve(dumpDir, name + '.html'), '<!doctype html>\n' + d.documentElement.outerHTML);
}

// ── 결과 ──────────────────────────────────────────────────────────
const results = [];
function t(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + detail : ''}`); }
const tokens = (await db.query('select token from public.booth_access')).rows.map(r => r.token);
const noToken = html => tokens.every(k => !html.includes(k)) && !/#k=/.test(html);
// 그려진 화면만(인라인으로 넣은 스크립트 원문 — config.js 주석의 '#k=' 설명 — 은 빼고)
const shown = d => { const c = d.documentElement.cloneNode(true); c.querySelectorAll('script').forEach(s => s.remove()); return c.outerHTML; };
const BAD_TABLES = ['booth_access', 'booth_pin', 'booth_private', 'booth_session', 'booth_auth_event', 'contact_private'];
const okCalls = log => log.every(c => !BAD_TABLES.some(b => c === 'select:' + b || c === 'rpc:' + b));
const realNames = manifest.map(m => m.name);
const VIS = 'https://incheon-live.vercel.app/';

// ══ S0 migration 전(함수 없음) · 예시 50 공개 ══════════════════════
{
  const h = await view('new', '', {}), ho = await view('old', '', {});
  t('S0-1 홈: 전체 부스 50 · 부스 현황 보기', /^50 전체 부스 부스 현황 보기$/.test(statText(h)), statText(h));
  t('S0-2 홈 카드 HTML = 예전 포털', h.stat && ho.stat && h.stat.outerHTML === ho.stat.outerHTML);
  t('S0-3 함수가 없어도(PGRST202) 경고 · 오류 없음', !h.warns.length && !h.errors.length, h.warns.concat(h.errors).join(' | '));
  const b = await view('new', '#booths'), bo = await view('old', '#booths');
  t('S0-4 부스 현황 = 예전 포털(50곳)', b.html === bo.html && b.d.querySelectorAll('.boothgrid .booth').length === 50);
  [h, ho, b, bo].forEach(v => v.close());
}

// ══ S1 migration 만(사전 안내 0) ═══════════════════════════════════
{
  const r = await R.run(readFileSync(resolve(REPO, 'supabase/migration-booth-preview.sql'), 'utf8'));
  t('S1-0 migration 적용', r.ok, r.error || '');
  const h = await view('new', ''), ho = await view('old', '');
  const b = await view('new', '#booths'), bo = await view('old', '#booths');
  t('S1-1 홈 카드 · 부스 현황 = 예전 포털', h.stat.outerHTML === ho.stat.outerHTML && b.html === bo.html);
  t('S1-2 함수를 부름 · 경고 없음', h.log.includes('rpc:booth_preview_list') && !h.warns.length);
  [h, ho, b, bo].forEach(v => v.close());
}

// ══ S2 전환 뒤 — 지금 Production 과 같은 모양(공개 0 · 사전 안내 84) ════
{
  const r = await R.run(SQL('C-02-transition.sql'));
  t('S2-0 전환 SQL 성공', r.ok, r.error || '');
  const api = await rest('rpc/booth_preview_list');
  t('S2-1 공개 함수: 84줄 · 칸 id · name · org · program 뿐', api.status === 200 && api.body.length === 84 &&
    api.body.every(x => JSON.stringify(Object.keys(x)) === '["id","name","org","program"]'));

  for (const anon of [true, false]) {
    const who = anon ? '익명' : '관리자 로그인';
    const h = await view('new', '', { anon });
    t(`S2-2 홈(${who}): 전체 부스 84 · 배치 준비 중`, /^84 전체 부스 배치 준비 중$/.test(statText(h)), statText(h));
    const b = await view('new', '#booths', { anon });
    const box = b.d.querySelector('.state--empty');
    t(`S2-3 부스 현황(${who}): 배치 확정 전 · 실제 부스 84곳 · 관람객 화면 안내`,
      /부스 배치 확정 전/.test(text(box)) && /실제 부스 84곳이 등록되어 있습니다/.test(text(box)) && /배치 준비 중/.test(text(box)), text(box));
    const a = box && box.querySelector('a');
    t(`S2-4 관람객 화면 단추(${who}): visitorSiteUrl · 새 탭 · noopener`,
      a && a.getAttribute('href') === VIS && a.getAttribute('target') === '_blank' && /noopener/.test(a.getAttribute('rel')));
    t(`S2-5 협의용 예시 없음(${who}): 미리보기 · A-01 · 예시 단추 없음`,
      !b.d.querySelector('.sprev, .samplebar, [data-sampleon]') && !/A-01|협의용 예시/.test(b.txt));
    const namesIn = realNames.filter(n => b.html.includes(n) || h.html.includes(n));
    t(`S2-6 포털은 수만 씀(${who}): 실제 부스 이름 0 · 열쇠 값 0 · 열쇠 표 안 부름`,
      !namesIn.length && noToken(shown(b.d)) && noToken(shown(h.d)) && okCalls(b.log) && okCalls(h.log),
      `이름 ${namesIn.length}개 · 열쇠 ${noToken(shown(b.d)) && noToken(shown(h.d)) ? '없음' : '있음'} · 부른 것 ${[...new Set(b.log.concat(h.log))].join(',')}`);
    t(`S2-7 오류 · 경고 없음(${who})`, !h.errors.length && !b.errors.length && !h.warns.length && !b.warns.length, h.errors.concat(b.errors, h.warns, b.warns).join(' | '));
    if (anon) { dump(h, 'portal-S2-home'); dump(b, 'portal-S2-booths'); }
    [h, b].forEach(v => v.close());
  }
  // 예전에 예시를 켜 둔 탭이어도 부스 예시는 나오지 않습니다(일정 예시는 그대로).
  const bs = await view('new', '#booths', { sample: true });
  t('S2-8 예시를 켜 둔 탭: 부스 예시 띠 · 예시 카드 없음 · 배치 확정 전 안내', !bs.d.querySelector('.samplebar, .is-sample') && /부스 배치 확정 전/.test(bs.txt));
  const sNew = await view('new', '#schedule', { sample: true }), sOld = await view('old', '#schedule', { sample: true });
  const sNew0 = await view('new', '#schedule'), sOld0 = await view('old', '#schedule');
  // 일정 화면 위 시계(초 단위)는 두 번 여는 사이에 바뀌므로 빼고 비교합니다.
  const noClock = v => { const c = v.main.cloneNode(true); c.querySelectorAll('.schedlive__clock').forEach(e => e.remove()); return c.innerHTML; };
  const firstDiff = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i < Math.max(a.length, b.length) ? `@${i}: ${a.slice(i, i + 60)} ≠ ${b.slice(i, i + 60)}` : ''; };
  t('S2-9 일정 화면(예시 켬 · 끔) = 예전 포털(시계 제외)', noClock(sNew) === noClock(sOld) && noClock(sNew0) === noClock(sOld0) && !!sNew.d.querySelector('.samplebar'),
    firstDiff(noClock(sNew), noClock(sOld)) + ' / ' + firstDiff(noClock(sNew0), noClock(sOld0)));
  const bo = await view('old', '#booths'), ho = await view('old', '');
  t('S2-10 (작업 전 확인) 예전 포털: 아직 미등록 · 부스 정보 준비 중 + 협의용 예시', /아직 미등록/.test(statText(ho)) && /부스 정보 준비 중/.test(bo.txt) && !!bo.d.querySelector('.sprev'));
  dump(bo, 'portal-S2-booths-old'); dump(ho, 'portal-S2-home-old');
  [bs, sNew, sOld, sNew0, sOld0, bo, ho].forEach(v => v.close());
}

// ══ S3 함수를 읽지 못할 때 — 예전 화면으로(포털은 멈추지 않음) ═════════
{
  await db.exec('revoke execute on function public.booth_preview_list() from anon;');
  const h = await view('new', ''), ho = await view('old', '');
  const b = await view('new', '#booths'), bo = await view('old', '#booths');
  t('S3-1 권한 거절: 홈 · 부스 현황 = 예전 포털(아직 미등록 · 예시 미리보기)', h.stat.outerHTML === ho.stat.outerHTML && b.html === bo.html && /아직 미등록/.test(statText(h)));
  t('S3-2 권한 거절: 경고 한 줄 · 오류 화면 아님', h.warns.length === 1 && /배치 준비 중 부스를 읽지 못했습니다/.test(h.warns[0]) && !h.d.querySelector('.state--error'), h.warns.join(' | '));
  await db.exec('grant execute on function public.booth_preview_list() to anon;');
  [h, ho, b, bo].forEach(v => v.close());
  await db.exec('alter function public.booth_preview_list() rename to booth_preview_list_off;');
  const h2 = await view('new', ''), b2 = await view('new', '#booths'), bo2 = await view('old', '#booths');
  t('S3-3 함수 없음(PGRST202): 예전 화면 · 경고 없음', /아직 미등록/.test(statText(h2)) && b2.html === bo2.html && !h2.warns.length);
  await db.exec('alter function public.booth_preview_list_off() rename to booth_preview_list;');
  [h2, b2, bo2].forEach(v => v.close());
}

// ══ S4 일부 배치 · 공개(시험용 구역 K · 3곳) ════════════════════════
const ids = manifest.slice().sort((a, b) => a.doc_key.localeCompare(b.doc_key)).map(m => m.booth_id);
async function place(n) {
  await db.exec("insert into public.zones (key, label, sort_order, is_published) values ('K', 'K구역', 11, true) on conflict (key) do nothing;");
  for (let i = 0; i < n; i++) await db.query('update public.booths set zone_key = $1, no = $2, is_published = true where id = $3', ['K', i + 1, ids[i]]);
}
{
  await place(3);
  const api = await rest('rpc/booth_preview_list');
  t('S4-0 공개 함수: 배치 · 공개된 3곳은 빠지고 81줄', api.body.length === 81 && !api.body.some(x => ids.slice(0, 3).includes(x.id)));
  for (const anon of [true, false]) {
    const who = anon ? '익명' : '관리자 로그인';
    const h = await view('new', '', { anon });
    t(`S4-1 홈(${who}): 전체 부스 84 · 배치 준비 중 81곳`, /^84 전체 부스 배치 준비 중 81곳$/.test(statText(h)), statText(h));
    const b = await view('new', '#booths', { anon });
    t(`S4-2 부스 현황(${who}): 배치된 부스 3개 · 배치 준비 중 81곳 · 카드 K-01~K-03`,
      /배치된 부스 3개 · 배치 준비 중 81곳/.test(text(b.d.querySelector('.countline'))) &&
      [...b.d.querySelectorAll('.boothgrid .booth__code')].map(text).join() === 'K-01,K-02,K-03', text(b.d.querySelector('.countline')));
    t(`S4-3 예시 · 배치 확정 전 안내 없음 · 오류 없음(${who})`, !b.d.querySelector('.sprev, .samplebar, .is-sample') && !/배치 확정 전/.test(b.txt) && !b.errors.length && !h.errors.length);
    if (anon) { dump(h, 'portal-S4-home'); dump(b, 'portal-S4-booths'); }
    [h, b].forEach(v => v.close());
  }
}

// ══ S5 84곳 모두 배치 · 공개 — 원래 화면으로 저절로 ═══════════════════
{
  await place(84);
  const api = await rest('rpc/booth_preview_list');
  t('S5-0 공개 함수: 0줄', api.status === 200 && api.body.length === 0);
  const h = await view('new', ''), ho = await view('old', '');
  const b = await view('new', '#booths'), bo = await view('old', '#booths');
  t('S5-1 홈: 전체 부스 84 · 부스 현황 보기 = 예전 포털', /^84 전체 부스 부스 현황 보기$/.test(statText(h)) && h.stat.outerHTML === ho.stat.outerHTML, statText(h));
  t('S5-2 부스 현황 = 예전 포털(전체 부스 84개 · 카드 84)', b.html === bo.html && /전체 부스 84개/.test(text(b.d.querySelector('.countline'))) && b.d.querySelectorAll('.boothgrid .booth').length === 84);
  const ba = await view('new', '#booths', { anon: false }), boa = await view('old', '#booths', { anon: false });
  t('S5-3 관리자 로그인도 예전 포털과 같음', ba.html === boa.html);
  dump(b, 'portal-S5-booths');
  [h, ho, b, bo, ba, boa].forEach(v => v.close());
}

const pass = results.filter(r => r.ok).length;
const L = ['# P1 운영 포털 시험 결과 — 배치 준비 중인 실제 부스', '',
  `- 포털: ${portalDir} (작업본) · 비교: ${oldRef}(main)`, '- DB: PGlite · PostgreSQL 17(lib/replica.mjs) — 익명(RLS) · 관리자 로그인 둘 다',
  '- 열쇠는 가짜 값이고 출력하지 않습니다.', '', `**${pass}/${results.length} 통과**`, '',
  '| 결과 | 확인 |', '|---|---|', ...results.map(r => `| ${r.ok ? 'PASS' : 'FAIL'} | ${r.name.replace(/\|/g, '/')} |`)];
writeFileSync(resolve(G3, 'portal-pending-test-report.md'), L.join('\n') + '\n');
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
