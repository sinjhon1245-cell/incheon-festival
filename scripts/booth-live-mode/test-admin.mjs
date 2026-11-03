/* ===================================================================
   운영 방식(현장대기 · 현장예약) — main 의 부스 운영 현황(booth-admin.html) 호환 시험 (jsdom)
   ───────────────────────────────────────────────────────────────────
   로그인 · 데이터 읽기를 맡는 core.js 대신 가짜 Core 를 끼웁니다(관리자 세션 · 표 읽기 · 함수 부르기만 흉내).
   화면 코드(booth-admin.js · booth-core.js · ui.js · pin-status.js · admin-demo.js)는 고치지 않고 그대로 씁니다.
   '바뀌기 전과 같음' 은 기준(--base, 기본 origin/main)의 파일로 같은 데이터를 그려 견줍니다. Production 에 닿지 않습니다.

   쓰는 법: node scripts/booth-live-mode/test-admin.mjs --deps <jsdom 폴더> --main-dir <main 작업 폴더> [--base origin/main]
   =================================================================== */
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const { JSDOM } = createRequire(join(resolve(arg('deps')), 'package.json'))('jsdom');
const MAIN = resolve(arg('main-dir'));
const BASE = arg('base', 'origin/main');
const results = [];
function t(name, ok, note = '') { results.push({ name, ok: !!ok, note }); console.log(`${ok ? '통과' : '실패'}  ${name}${note && !ok ? '  — ' + note : ''}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) { const end = Date.now() + ms; while (Date.now() < end) { try { if (fn()) return true; } catch { /* 아직 */ } await sleep(25); } return false; }
const cur = (p) => readFileSync(join(MAIN, p), 'utf8');
const old = (p) => execFileSync('git', ['show', `${BASE}:${p}`], { cwd: MAIN, encoding: 'utf8', maxBuffer: 64 << 20 });
const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

const ADMIN = '00000000-0000-4000-8000-0000000000ad';
const id = (n) => '00000000-0000-4000-8000-00000000000' + n;
const now = new Date().toISOString();
const TABLES = {
  zones: [{ key: 'S', label: '시험 구역', sort_order: 1, is_published: true }],
  booths: [1, 2, 3, 4, 5].map((n) => ({ id: id(n), zone_key: 'S', no: n, code: 'S0' + n, name: '부스' + n, org: '학교', program: '', is_published: true })),
  settings: [{ booth_pin_enabled: true, event_start: '2026-11-06T01:00:00Z', event_end: '2026-11-07T08:00:00Z', time_label: '10:00 – 17:00' }]
};
// 가짜 Core — booth-admin.js 가 부르는 것만
function fakeCore(w, live, modes, calls) {
  const P = (v) => Promise.resolve(v);
  return {
    isConfigured: () => true,
    session: () => P({ access_token: 'x', user: { id: ADMIN } }),
    fetchProfile: () => P({ id: ADMIN, role: 'admin', name: '시험 관리자' }),
    profileFailed: () => false,
    me: () => ({ name: '시험 관리자', role: 'admin' }),
    db: () => null,
    esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    dataMessage: (e) => '읽지 못했습니다 ' + (e && e.code || ''),
    authMessage: () => '', accessMessage: () => '', passwordMessage: () => '',
    signIn: () => P(null), signOut: () => P(null), changePassword: () => P(null),
    select: (table) => {
      if (table === 'booth_live') return P(live);
      if (table === 'booth_live_mode') return modes === 'missing' ? Promise.reject({ code: 'PGRST205' }) : P(modes);
      return P(TABLES[table] || []);
    },
    rpc: (name, args) => {
      calls.push([name, args]);
      if (name === 'admin_booth_credentials') return P(TABLES.booths.map((b) => ({ booth_id: b.id, qr_state: 'on', pin_state: 'on', pin_sessions: 0, pin_failures_1h: 0, live_by: 'pin' })));
      if (name === 'admin_set_booth_live') return P([{ booth_id: args.p_booth_id, congestion: '예약마감', wait_minutes: 0, updated_at: new Date().toISOString() }]);
      return Promise.reject({ code: 'PGRST202' });
    }
  };
}
function adminPage(ver, live, modes) {
  const src = ver === 'old' ? old : cur;
  let html = src('booth-admin.html');
  html = html.replace(/<script src="https:\/\/cdn[^"]*"><\/script>/, '').replace(/<link rel="stylesheet"[^>]*>/g, '');
  const calls = [];
  for (const f of ['config.js', 'ui.js', 'booth-core.js', 'mock-data.js', 'admin-demo.js', 'pin-status.js', 'booth-admin.js']) {
    html = html.replace(`<script src="assets/${f}"></script>`, () => `<script>${src('assets/' + f)}\n</script>`);
  }
  html = html.replace('<script src="assets/core.js"></script>', '<script>window.Core = window.__fakeCore();</script>');
  const dom = new JSDOM(html, {
    url: 'http://localhost/booth-admin.html#live', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {};
      w.__fakeCore = () => fakeCore(w, live, modes, calls);
      w.fetch = () => Promise.reject(new Error('no network'));
    }
  });
  return { dom, w: dom.window, d: dom.window.document, calls };
}
const liveWait = [
  { booth_id: id(1), congestion: '여유', wait_minutes: 5, updated_at: now },
  { booth_id: id(2), congestion: '보통', wait_minutes: 20, updated_at: now },
  { booth_id: id(3), congestion: '중단', wait_minutes: 0, updated_at: now },
  { booth_id: id(4), congestion: '마감', wait_minutes: 0, updated_at: now }
];
const ready = (p) => until(() => p.d.querySelector('.ost__grid') && p.d.querySelectorAll('.lv').length >= 5);

{
  const a = adminPage('old', liveWait, []), b = adminPage('new', liveWait, []);
  await Promise.all([ready(a), ready(b)]);
  const sum = (p) => p.d.querySelector('.ost').outerHTML;
  const list = (p) => [...p.d.querySelectorAll('.lv')].map((x) => x.className + '|' + txt(x)).join('\n');
  t('A1 현장대기만(스위치 꺼짐 · 0줄): 운영 상태 판 = 예전 화면(여섯 칸)', sum(a) === sum(b) && b.d.querySelectorAll('.ost__grid .st').length === 6);
  t('A1 현장대기만: 부스 줄 = 예전 화면', list(a) === list(b), list(b).split('\n')[0]);
  a.w.close(); b.w.close();
  const m = adminPage('new', liveWait, 'missing');
  await ready(m);
  t('A2 DB 적용 전(방식 표 없음): 화면이 열리고 여섯 칸 그대로', m.d.querySelectorAll('.ost__grid .st').length === 6 && !m.d.querySelector('.state--error'));
  m.w.close();
}
{
  const live = [...liveWait.slice(0, 2),
    { booth_id: id(3), congestion: '예약중', wait_minutes: 0, updated_at: now },
    { booth_id: id(4), congestion: '예약마감', wait_minutes: 0, updated_at: now }];
  const p = adminPage('new', live, [{ booth_id: id(3), mode: 'reserve' }, { booth_id: id(4), mode: 'reserve' }, { booth_id: id(5), mode: 'reserve' }]);
  await ready(p);
  const cells = [...p.d.querySelectorAll('.ost__grid .st')].map((x) => x.getAttribute('data-quick') + ':' + txt(x.querySelector('.st__n')));
  t('A3 현장예약 부스가 있으면 일곱 번째 칸 "현장예약 2" (여유 1 · 보통 1 · 미입력 1 — 섞지 않음)',
    p.d.querySelector('.ost__grid--7') && cells.includes('resv:2') && cells.includes('free:1') && cells.includes('normal:1') && cells.includes('missing:1'), cells.join(','));
  const row = (n) => txt([...p.d.querySelectorAll('.lv')].find((x) => /부스/.test(txt(x)) && txt(x).indexOf('부스' + n) >= 0));
  t('A3 줄: 현장예약 운영 중 · 예약 마감 낱말', /현장예약 운영 중/.test(row(3)) && /예약 마감/.test(row(4)), row(3) + ' / ' + row(4));
  const resvCell = p.d.querySelector('.ost__grid .st--resv');
  t('A3 현장예약 칸 아래 줄: 그중 "예약 마감 1"(운영 중과 구분)', resvCell && /예약 마감 1/.test(txt(resvCell.querySelector('.st__o'))), resvCell && txt(resvCell));
  // 긴급 수정: 현장예약 부스는 대기 시간 대신 예약 상태 단추
  let picked = null;
  p.w.UI.pick = (o) => { picked = o; return Promise.resolve('resv_closed'); };
  const btn = [...p.d.querySelectorAll('[data-act="override"]')].find((x) => x.closest('[data-id]') && x.closest('[data-id]').getAttribute('data-id') === id(3))
    || [...p.d.querySelectorAll('[data-act="override"]')][2];
  if (btn) btn.click();
  await until(() => picked && p.calls.some((c) => c[0] === 'admin_set_booth_live'));
  const vs = picked ? picked.choices.map((c) => c.v) : [];
  t('A4 긴급 수정(현장예약 부스): 예약 운영 중 · 예약 마감 · 잠시 중단 · 오늘 마감 · 값 지우기(대기 분 단추 없음)',
    vs.join(',') === 'resv_open,resv_closed,pause,closed,clear', vs.join(','));
  const call = p.calls.find((c) => c[0] === 'admin_set_booth_live');
  t('A4 고른 예약 마감 → admin_set_booth_live(p_mode resv_closed)', call && call[1].p_mode === 'resv_closed' && call[1].p_wait_minutes === null, JSON.stringify(call));
  p.w.close();
  // 스위치를 끈 뒤 남은 예약 상태: 관람객 화면처럼 미입력
  const off = adminPage('new', live, []);
  await ready(off);
  const c2 = [...off.d.querySelectorAll('.ost__grid .st')].map((x) => x.getAttribute('data-quick') + ':' + txt(x.querySelector('.st__n')));
  t('A5 스위치 끔(방식 0줄) + 남은 예약 상태 → 미입력으로 셈 · 여섯 칸', off.d.querySelectorAll('.ost__grid .st').length === 6 && c2.includes('missing:3'), c2.join(','));
  off.w.close();
  // 40분 전에 넣은 예약 상태 · 대기 값: 대기 값만 '확인 필요'
  const old40 = new Date(Date.now() - 40 * 60000).toISOString();
  const st = adminPage('new', [{ booth_id: id(1), congestion: '보통', wait_minutes: 20, updated_at: old40 },
    { booth_id: id(3), congestion: '예약중', wait_minutes: 0, updated_at: old40 }], [{ booth_id: id(3), mode: 'reserve' }]);
  await ready(st);
  const stale = txt(st.d.querySelector('.todo--stale .todo__n'));
  t('A6 30분 넘은 현장예약 상태는 "확인 필요" 로 세지 않음(대기 값만 1곳)', stale === '1', stale);
  st.w.close();
}

/* ── P. 운영 포털(portal.js) — 대기 현황 읽기 조각만 떼어 시험 ─────────── */
{
  const src = cur('assets/portal.js');
  const a = src.indexOf('  // \'예약중\' · \'예약마감\''), b = src.indexOf('  // 색 네모 + 글자.');
  const piece = src.slice(a, b);
  async function portalOf(live, modes) {
    const S = { boothLive: {}, settings: {} };
    const C = {
      selectSoft: (table) => Promise.resolve(table === 'booth_live' ? live : (modes === 'missing' ? [] : modes)),
      isTableMissing: () => false, minLabel: (m) => m + '분'
    };
    const fn = new Function('S', 'C', 'window', piece + '\nreturn { selectBoothLive, applyBoothLive, boothLiveInfo, liveText };');
    const P = fn(S, C, { FESTIVAL_CONFIG: {} });
    P.applyBoothLive(await P.selectBoothLive());
    return (bid) => { const i = P.boothLiveInfo(bid); return i ? P.liveText(i) + (i.stale ? '(흐림)' : '') : '입력 없음'; };
  }
  const t40 = new Date(Date.now() - 40 * 60000).toISOString();
  const live = [{ booth_id: 'a', congestion: '예약중', wait_minutes: 0, updated_at: t40 },
    { booth_id: 'b', congestion: '예약마감', wait_minutes: 0, updated_at: now },
    { booth_id: 'c', congestion: '보통', wait_minutes: 15, updated_at: now }];
  const on = await portalOf(live, [{ booth_id: 'a', mode: 'reserve' }, { booth_id: 'b', mode: 'reserve' }]);
  t('P1 포털: 현장예약 운영 중 · 예약 마감을 "입력 없음" 대신 낱말로(40분 지나도 흐리지 않음)', on('a') === '현장예약 운영 중' && on('b') === '예약 마감' && on('c') === '보통 · 약 15분', [on('a'), on('b'), on('c')].join(' / '));
  const off = await portalOf(live, []);
  t('P2 포털: 스위치 끔(방식 0줄) → 남은 예약 상태는 보이지 않음 · 대기 값은 그대로', off('a') === '입력 없음' && off('b') === '입력 없음' && off('c') === '보통 · 약 15분');
  const mis = await portalOf([{ booth_id: 'a', congestion: '여유', wait_minutes: 5, updated_at: now }], [{ booth_id: 'a', mode: 'reserve' }]);
  t('P3 포털: 현장예약 부스에 남은 대기 값은 보이지 않음(방식 불일치)', mis('a') === '입력 없음');
}

const fail = results.filter((x) => !x.ok);
console.log(`\n${results.length - fail.length}/${results.length} 통과`);
process.exit(fail.length ? 1 : 0);
