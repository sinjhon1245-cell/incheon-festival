/* ===================================================================
   운영 방식(현장대기 · 현장예약) 화면 시험 — 스냅샷 API · 관람객 화면 · 운영자 화면 (jsdom)
   ───────────────────────────────────────────────────────────────────
   네트워크 · Production 에 닿지 않습니다. Supabase 대신 이 파일의 가짜 서버가 DB 와 같은 규칙
   (방식에 맞지 않는 쓰기 거부 · 전환 때 상태 지움 · 같은 전환은 아무것도 안 함 · 스위치)으로 답합니다.
   '바뀌기 전과 같음' 은 기준 커밋(--base, 기본 7633e48)의 파일을 git 에서 꺼내 같은 입력으로 견줍니다.

     S  스냅샷 API(live/api/live-snapshot.mjs) — 스위치 꺼짐 = 예전 응답 + opMode · reserve 칸 / 예약 상태 · 불일치 · 때 규칙
     V  관람객 화면 — 예전 화면과 같은 목록(현장대기만) / 두 줄 낱말 · 숫자 · 거르기 · 정렬 · 한눈에 · 지금 계신 부스 / 옛 화면 호환
     O  운영자 화면 — 스위치 꺼짐 = 지금 화면 / 전환 확인 · 실패 · 답 잃음 · 못 보낸 누름 · 다른 기기 · 스위치 끔 · DB 적용 전

   쓰는 법: node scripts/booth-live-mode/test-ui.mjs --deps <jsdom 이 설치된 폴더> [--base 7633e48]
   =================================================================== */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const { JSDOM } = createRequire(join(resolve(arg('deps')), 'package.json'))('jsdom');
const BASE = arg('base', '7633e48');

const results = [];
function t(name, ok, note = '') { results.push({ name, ok: !!ok, note }); console.log(`${ok ? '통과' : '실패'}  ${name}${note && !ok ? '  — ' + note : ''}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* 아직 */ } await sleep(25); } return false; }
const now = () => new Date().toISOString();
const git = (p) => execFileSync('git', ['show', `${BASE}:${p}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20 });
const cur = (p) => readFileSync(resolve(REPO, p), 'utf8');

/* ── S. 스냅샷 API ───────────────────────────────────────────────── */
const TMP = mkdtempSync(join(tmpdir(), 'booth-mode-ui-'));
mkdirSync(join(TMP, 'old', 'api'), { recursive: true });
mkdirSync(join(TMP, 'old', 'lib'), { recursive: true });
writeFileSync(join(TMP, 'old', 'api', 'live-snapshot.mjs'), git('live/api/live-snapshot.mjs'));
writeFileSync(join(TMP, 'old', 'lib', 'public-config.mjs'), git('live/lib/public-config.mjs'));
let imp = 0;
async function snapshotOf(file, tables) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const name = u.split('/rest/v1/')[1].split('?')[0];
    const v = tables[name];
    if (v === undefined || v === 404) return new Response('{"code":"PGRST205","message":"missing"}', { status: 404 });
    if (v === 500) return new Response('{"message":"boom"}', { status: 500 });
    return new Response(JSON.stringify(v), { status: 200 });
  };
  try {
    const mod = await import(pathToFileURL(file).href + '?i=' + (++imp));
    const res = await mod.default.fetch(new Request('https://x.test/api/live-snapshot'));
    return { status: res.status, body: res.status === 200 ? JSON.parse(await res.text()) : null };
  } finally { globalThis.fetch = realFetch; }
}
const SNAP_NEW = resolve(REPO, 'live/api/live-snapshot.mjs');
const SNAP_OLD = join(TMP, 'old', 'api', 'live-snapshot.mjs');
const ids = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'].map((x) => '00000000-0000-4000-8000-0000000000' + x.slice(1).padStart(2, '0'));
const booths = ids.map((id, i) => ({ id, no: i + 1, code: 'S' + String(i + 1).padStart(2, '0'), zone_key: 'S', name: '부스' + (i + 1), org: '학교', program: '' }));
const base = {
  settings: [{ event_title: '시험', venue: '', date_label: '', time_label: '', event_start: '2026-11-06T01:00:00Z', event_end: '2026-11-07T08:00:00Z', booth_map_url: '', booth_map_alt: '' }],
  zones: [{ key: 'S', label: '시험', sort_order: 1 }],
  booths,
  'rpc/booth_preview_list': []
};
const t0 = now();
const liveWait = [
  { booth_id: ids[0], congestion: '여유', wait_minutes: 5, updated_at: t0 },
  { booth_id: ids[1], congestion: '보통', wait_minutes: 15, updated_at: t0 },
  { booth_id: ids[2], congestion: '혼잡', wait_minutes: 45, updated_at: t0 },
  { booth_id: ids[3], congestion: '중단', wait_minutes: 0, updated_at: t0 },
  { booth_id: ids[4], congestion: '마감', wait_minutes: 0, updated_at: t0 },
  { booth_id: ids[5], congestion: '여유', wait_minutes: 0, updated_at: '2026-11-01T03:00:00Z' }   // 지난 날
];
{
  const o = await snapshotOf(SNAP_OLD, { ...base, booth_live: liveWait });
  for (const [label, modes] of [['표 없음(DB 적용 전)', undefined], ['스위치 꺼짐(0줄)', []]]) {
    const n = await snapshotOf(SNAP_NEW, { ...base, booth_live: liveWait, booth_live_mode: modes });
    const strip = (b) => b.booths.map(({ opMode, reserve, ...x }) => x);
    t(`S1 ${label}: 부스 값 = 예전 응답과 같음(새 칸 opMode · reserve 만 더함)`,
      o.status === 200 && n.status === 200 && JSON.stringify(strip(n.body)) === JSON.stringify(o.body.booths)
      && n.body.booths.every((b) => b.opMode === 'wait' && b.reserve === null),
      JSON.stringify(n.body && n.body.booths[0]));
  }
  const live2 = [
    ...liveWait.slice(0, 5),
    { booth_id: ids[5], congestion: '예약중', wait_minutes: 0, updated_at: t0 },
    { booth_id: ids[6], congestion: '예약마감', wait_minutes: 0, updated_at: t0 }
  ];
  const modes = [{ booth_id: ids[5], mode: 'reserve' }, { booth_id: ids[6], mode: 'reserve' }, { booth_id: ids[3], mode: 'reserve' }];
  const n = await snapshotOf(SNAP_NEW, { ...base, booth_live: live2, booth_live_mode: modes });
  const by = (i) => n.body.booths[i];
  t('S2 예약 운영 중 → status null · reserve open · opMode reserve', by(5).status === null && by(5).reserve === 'open' && by(5).opMode === 'reserve' && by(5).updatedAt === t0);
  t('S2 예약 마감 → reserve closed', by(6).status === null && by(6).reserve === 'closed');
  t('S2 현장예약 부스의 잠시 중단은 status 그대로(옛 화면도 앎)', by(3).status === '중단' && by(3).reserve === null && by(3).opMode === 'reserve');
  const mis = await snapshotOf(SNAP_NEW, { ...base, booth_live: [
    { booth_id: ids[0], congestion: '여유', wait_minutes: 5, updated_at: t0 },        // reserve 인데 대기 값
    { booth_id: ids[1], congestion: '예약중', wait_minutes: 0, updated_at: t0 }       // wait 인데 예약 값
  ], booth_live_mode: [{ booth_id: ids[0], mode: 'reserve' }] });
  t('S3 방식에 맞지 않는 값은 보내지 않음(현장예약인데 대기 분 · 현장대기인데 예약 상태)',
    mis.body.booths[0].status === null && mis.body.booths[0].waitMinutes === null && mis.body.booths[1].status === null && mis.body.booths[1].reserve === null);
  const old = await snapshotOf(SNAP_NEW, { ...base, booth_live: [{ booth_id: ids[5], congestion: '예약중', wait_minutes: 0, updated_at: '2026-11-01T03:00:00Z' }], booth_live_mode: modes });
  t('S4 지난 날의 예약 상태는 보내지 않음(때 규칙 그대로)', old.body.booths[5].reserve === null && old.body.booths[5].status === null);
  const fail = await snapshotOf(SNAP_NEW, { ...base, booth_live: liveWait, booth_live_mode: 500 });
  t('S5 방식 읽기 실패(5xx)는 대기 읽기 실패와 같이 다룸(정상본 없으면 503 — 방식을 모른 채 내보내지 않음)', fail.status === 503);
}

/* ── 화면 조립 ───────────────────────────────────────────────────── */
function page(htmlSrc, files, url, setup) {
  let html = htmlSrc;
  for (const [name, src] of Object.entries(files)) {
    html = html.replace(`<script src="assets/${name}"></script>`, () => `<script>${src}\n</script>`);
  }
  html = html.replace(/<link rel="stylesheet"[^>]*>/g, '');
  const dom = new JSDOM(html, {
    url, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
      w.scrollTo = () => {};
      w.Element.prototype.scrollIntoView = function () {};
      w.navigator.vibrate = () => true;
      setup(w);
    }
  });
  return dom;
}
const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
// jsdom 에는 fetch Response 가 없어 화면이 쓰는 만큼만(ok · status · text) 흉내 냅니다.
function fakeRes(body, init) {
  const status = (init && init.status) || 200;
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(String(body)) };
}

/* ── V. 관람객 화면 ───────────────────────────────────────────────── */
// Live 배포본(live/build.sh)처럼 관람객 주소를 같은 사이트('./')로 둡니다 — 저장소의 config.js 는 운영 포털 설정이라
// 그대로 쓰면 관람객 화면이 공식 주소로 옮겨 갑니다.
const LIVE_CFG = '\nwindow.FESTIVAL_CONFIG.visitorSiteUrl = "./";';
function visitorPage(ver, snap, extra = '') {
  const src = ver === 'old'
    ? { html: git('visitor.html'), files: { 'config.js': git('assets/config.js') + LIVE_CFG, 'booth-core.js': git('assets/booth-core.js'), 'mock-data.js': git('assets/mock-data.js') } }
    : { html: cur('visitor.html'), files: { 'config.js': cur('assets/config.js') + LIVE_CFG, 'booth-core.js': cur('assets/booth-core.js'), 'mock-data.js': cur('assets/mock-data.js') } };
  return page(src.html, src.files, 'http://localhost/' + extra, (w) => {
    w.fetch = async (u) => {
      const s = String(u);
      if (s.indexOf('/api/live-snapshot') >= 0) return fakeRes(JSON.stringify(snap), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return fakeRes('[]', { status: 200 });
    };
  });
}
async function snapFor(live, modes) { return (await snapshotOf(SNAP_NEW, { ...base, booth_live: live, booth_live_mode: modes })).body; }
const rowsOf = (d) => [...d.querySelectorAll('#list .row')].map((r) => ({ code: txt(r.querySelector('.row__code')), right: r.querySelector('.row__right').innerHTML, cls: r.className }));
// 한 줄 상태 표시(대기 분이 없는 상태): 눈으로 보는 글 · 화면 읽기 문장 · 모양
const tagOf = (el) => { const b = el && el.querySelector('.stag'); return b ? { text: txt(b), cls: b.className, hidden: b.getAttribute('aria-hidden'), sr: txt(el.querySelector('.sr-only')) } : null; };
{
  const snapW = await snapFor(liveWait, []);
  const a = visitorPage('old', snapW), b = visitorPage('new', snapW);
  const ready = (d) => until(() => d.window.document.querySelectorAll('#list .row').length === 7 && d.window.document.getElementById('h-free'));
  await Promise.all([ready(a), ready(b)]);
  const ra = rowsOf(a.window.document), rb = rowsOf(b.window.document);
  // 대기 분이 있는 줄 · 지난 값 줄은 예전과 같은 마크업. 잠시 중단 · 마감 줄만 같은 크기의 상태 상자로 바뀌었습니다(PR #60).
  const same = [0, 1, 2, 5, 6];
  t('V1 현장대기만 있을 때: 대기 분 줄 · 지난 값 줄(번호 · 오른쪽 값 · 줄 모양) = 예전 화면', ra.length === 7 && rb.length === 7
    && JSON.stringify(same.map((i) => ra[i])) === JSON.stringify(same.map((i) => rb[i])), JSON.stringify(rb[0]));
  const bd = b.window.document, rowR = (i) => bd.querySelectorAll('#list .row')[i].querySelector('.row__right');
  const bp = tagOf(rowR(3)), bc = tagOf(rowR(4));
  t('V1 잠시 중단 = 한 줄 "잠시 중단"(흰 바탕) · 마감 = 한 줄 "오늘 마감"(옅은 회색) · 화면 읽기는 "잠시 중단" · "오늘 마감"',
    !!bp && bp.text === '잠시 중단' && /stag--pause/.test(bp.cls) && bp.hidden === 'true' && bp.sr === '잠시 중단'
    && !!bc && bc.text === '오늘 마감' && /stag--off/.test(bc.cls) && bc.sr === '오늘 마감', JSON.stringify([bp, bc]));
  const hero = (d) => [txt(d.getElementById('h-free')), txt(d.getElementById('h-total')), txt(d.getElementById('h-sub')),
    [...d.querySelectorAll('[data-count] [data-n]')].map(txt).join(',')].join('|');
  t('V1 현장대기만 있을 때: 큰 숫자 · 전체 · 아래 줄 · 상태 칩 = 예전 화면', hero(a.window.document) === hero(b.window.document), hero(b.window.document));
  a.window.close(); b.window.close();

  const live2 = [...liveWait.slice(0, 5),
    { booth_id: ids[5], congestion: '예약중', wait_minutes: 0, updated_at: t0 },
    { booth_id: ids[6], congestion: '예약마감', wait_minutes: 0, updated_at: t0 }];
  const modes = [{ booth_id: ids[5], mode: 'reserve' }, { booth_id: ids[6], mode: 'reserve' }, { booth_id: ids[3], mode: 'reserve' }];
  const snapR = await snapFor(live2, modes);
  const v = visitorPage('new', snapR);
  const d = v.window.document;
  await until(() => d.querySelectorAll('#list .row').length === 7 && txt(d.getElementById('h-sub')));
  const r = rowsOf(d);
  const rowEl = (i) => d.querySelectorAll('#list .row')[i].querySelector('.row__right');
  const b5 = tagOf(rowEl(5)), b6 = tagOf(rowEl(6));
  t('V2 목록: 현장예약 운영 중 = 한 줄 "현장예약"(보라 · 숫자 · 칩 · "분" · "운영 중" 글자 없음)', !!b5 && b5.text === '현장예약' && /stag--resv\b/.test(b5.cls) && !/resv-off/.test(b5.cls)
    && !/v__n|st--|분/.test(r[5].right) && !/운영 중/.test(b5.text) && /is-resv/.test(r[5].cls), r[5].right);
  t('V2 목록: 예약 마감 = 한 줄 "예약 마감"(채도 낮은 보라 — 오늘 마감과 다른 갈래)', !!b6 && b6.text === '예약 마감' && /stag--resv-off/.test(b6.cls) && /is-resv-closed/.test(r[6].cls), r[6].right);
  t('V2 목록: 화면 읽기 — 상자는 감추고 뜻 한 줄("현장예약 운영 중" · "현장예약 마감")', b5 && b5.hidden === 'true' && b5.sr === '현장예약 운영 중' && b6.hidden === 'true' && b6.sr === '현장예약 마감', JSON.stringify([b5, b6]));
  t('V2 목록: 현장예약 부스의 잠시 중단 = 잠시 중단', /잠시 중단/.test(r[3].right));
  t('V2 큰 숫자: 여유 1곳(현장예약 제외) · 전체 7곳', txt(d.getElementById('h-free')) === '1' && txt(d.getElementById('h-total')) === '7');
  t('V2 아래 줄: "· 현장예약 1곳 · 예약 마감 1곳" 따로 셈(입력 없음 · 0분 대기로 세지 않음)',
    /현장예약 1곳 · 예약 마감 1곳/.test(txt(d.getElementById('h-sub'))) && /입력된 5곳/.test(txt(d.getElementById('h-sub'))), txt(d.getElementById('h-sub')));
  const chips = [...d.querySelectorAll('[data-count]')].map((x) => x.getAttribute('data-count') + ':' + txt(x.querySelector('[data-n]'))).join(',');
  t('V2 상태 칩: 여유 1 · 보통 1 · 혼잡 1 · 중단·마감 2(칩 수 그대로 네 개)', chips === '여유:1,보통:1,혼잡:1,off:2', chips);
  d.querySelector('[data-count="여유"]').click();
  await sleep(50);
  t('V2 여유로 거르면 현장예약 부스는 빠짐', rowsOf(d).every((x) => !/예약/.test(x.right)) && rowsOf(d).length === 1);
  d.querySelector('[data-count="여유"]').click();
  await sleep(50);
  const sortBtn = d.querySelector('[data-sort="wait"]') || [...d.querySelectorAll('button')].find((x) => /대기 짧은 순/.test(x.textContent));
  if (sortBtn) sortBtn.click();
  await until(() => rowsOf(d)[0] && rowsOf(d)[0].code !== 'S01' || true, 300);
  await sleep(80);
  const order = rowsOf(d).map((x) => x.code).join(',');
  t('V2 대기 짧은 순: 대기 있음 → 예약 운영 중 → 예약 마감 → 잠시 중단 → 오늘 마감', !!sortBtn && order === 'S01,S02,S03,S06,S07,S04,S05', order);
  v.window.close();

  const vm = visitorPage('new', snapR);
  const dm = vm.window.document;
  await until(() => dm.querySelectorAll('#list .row').length === 7);
  const mapBtn = [...dm.querySelectorAll('button')].find((x) => /한눈에/.test(x.textContent));
  if (mapBtn) mapBtn.click();
  await until(() => dm.querySelectorAll('.tile').length === 7, 1500);
  const tile = (i) => { const el = dm.querySelectorAll('.tile')[i]; return el ? el.className + '|' + txt(el.querySelector('.tile__v')) + '|' + txt(el.querySelector('.tile__w')) : ''; };
  t('V3 한눈에: 현장예약 칸 = 목록과 같은 두 줄 "현장 / 예약"(칸 크기 그대로 · "운영 중" 없음)', /is-resv\b/.test(tile(5)) && /\|현장\|예약$/.test(tile(5)), tile(5));
  t('V3 한눈에: 예약 마감 칸 = "예약 · 마감"', /is-resv-closed/.test(tile(6)) && /\|예약\|마감$/.test(tile(6)), tile(6));
  const lbl = dm.querySelectorAll('.tile')[5] ? txt(dm.querySelectorAll('.tile')[5].querySelector('.sr-only')) : '';
  t('V3 한눈에: 화면 읽기 문장 "현장예약 운영 중"', /현장예약 운영 중/.test(lbl), lbl);
  vm.window.close();

  const vh = visitorPage('new', snapR, '?b=S06');
  const dh = vh.window.document;
  await until(() => txt(dh.getElementById('here')).length > 0);
  const bh = tagOf(dh.querySelector('#here .here__val'));
  t('V4 QR 직접 진입(지금 계신 부스): 같은 한 줄 표시(조금 크게) "현장예약" + 짧은 안내(예약 시간 · 인원은 만들지 않음)',
    !!bh && bh.text === '현장예약' && /stag--big/.test(bh.cls) && /현장에서 예약을 진행하는 부스예요/.test(txt(dh.getElementById('here')))
    && !/분/.test(txt(dh.querySelector('#here .here__val'))) && !/시간|명|인원/.test(txt(dh.getElementById('here')).replace('대기', '')), txt(dh.getElementById('here')));
  vh.window.close();
  const vh2 = visitorPage('new', snapR, '?b=S07');
  const dh2 = vh2.window.document;
  await until(() => txt(dh2.getElementById('here')).length > 0);
  const bh2 = tagOf(dh2.querySelector('#here .here__val'));
  t('V4 QR 직접 진입: 예약 마감 = 한 줄 "예약 마감" + 바로 갈 수 있는 부스 안내', !!bh2 && bh2.text === '예약 마감' && /stag--resv-off/.test(bh2.cls) && /바로 갈 수 있는/.test(txt(dh2.getElementById('here'))), txt(dh2.getElementById('here')));
  vh2.window.close();

  const vo = visitorPage('old', snapR);
  const dov = vo.window.document;
  await until(() => dov.querySelectorAll('#list .row').length === 7);
  const ro = rowsOf(dov);
  t('V5 옛 화면(배포 전에 열어 둔 탭)이 새 스냅샷을 받아도 현장예약 부스는 "정보 없음"으로만(0분 · 엉뚱한 칩 없음)',
    /정보 없음/.test(ro[5].right) && /정보 없음/.test(ro[6].right) && !/v__n/.test(ro[5].right + ro[6].right), ro[5].right);
  vo.window.close();
}

/* ── O. 운영자 화면 ───────────────────────────────────────────────── */
const TOKEN = 'TestTokenForModeAbcd1234';   // 24자
function makeServer(opts = {}) {
  const s = { enabled: false, mode: 'wait', live: null, offline: false, dropReply: false, noModeFn: false, switches: 0, writes: [], ...opts };
  const kind = (c) => (['여유', '보통', '혼잡'].includes(c) ? 'wait' : ['예약중', '예약마감'].includes(c) ? 'reserve' : 'any');
  s.modeOf = () => (s.enabled ? s.mode : 'wait');
  const row = () => ({ booth_id: 'b-1', code: 'S01', zone_key: 'S', zone_label: '시험 구역', name: '시험 부스', org: '시험초',
    congestion: s.live ? s.live.c : null, wait_minutes: s.live ? s.live.w : null, updated_at: s.live ? s.live.at : null,
    issued_at: '2026-10-20T00:00:00Z', token_tail: 'abcd' });
  const err = (code, message, hint) => ({ status: 400, body: { code, message, hint: hint || null } });
  const mismatch = () => err('22023', '운영 방식이 바뀌었습니다. 화면을 새로 고쳐 주세요.', 'booth_mode_mismatch');
  s.calls = [];
  s.rpc = (name, a) => {
    s.calls.push(name + (a && a.p_mode !== undefined ? ':' + a.p_mode : ''));
    if (name === 'booth_ctrl_get') return { status: 200, body: [row()] };
    if (name === 'booth_ctrl_set') {
      const m = a.p_mode, w = a.p_wait_minutes;
      const v = m === 'open' ? { c: w <= 10 ? '여유' : w <= 25 ? '보통' : '혼잡', w } : m === 'pause' ? { c: '중단', w: 0 } : m === 'closed' ? { c: '마감', w: 0 }
        : m === 'resv_open' ? { c: '예약중', w: 0 } : m === 'resv_closed' ? { c: '예약마감', w: 0 } : null;
      if (!v) return err('22023', '허용되지 않는 상태입니다.');
      if (kind(v.c) !== 'any' && kind(v.c) !== s.modeOf()) return mismatch();
      s.live = { ...v, at: now() };
      s.writes.push(v.c + '/' + v.w);
      return { status: 200, body: [row()] };
    }
    if (name === 'booth_ctrl_touch') {
      if (!s.live) return err('22023', '아직 입력한 값이 없습니다. 먼저 대기 시간을 눌러 주세요.');
      if (kind(s.live.c) !== 'any' && kind(s.live.c) !== s.modeOf()) return mismatch();
      s.live.at = now();
      return { status: 200, body: [row()] };
    }
    if (name === 'booth_ctrl_mode') {
      if (s.noModeFn) return { status: 404, body: { code: 'PGRST202', message: 'Could not find the function' } };
      if (a.p_mode) {
        if (!s.enabled) return err('22023', '지금은 운영 방식을 바꿀 수 없습니다.', 'booth_mode_off');
        // DB 와 같게: 현장예약은 지금 상태를 지우고 '예약중' 을 함께 적고, 현장대기는 지움. 같은 방식이면 아무것도 안 함.
        if (s.modeOf() !== a.p_mode) {
          s.mode = a.p_mode; s.switches++;
          s.live = a.p_mode === 'reserve' ? { c: '예약중', w: 0, at: now() } : null;
          if (a.p_mode === 'reserve') s.writes.push('예약중/0');
        }
      }
      return { status: 200, body: [{ op_mode: s.modeOf(), mode_updated_at: null, reserve_enabled: s.enabled,
        congestion: s.live ? s.live.c : null, wait_minutes: s.live ? s.live.w : null, updated_at: s.live ? s.live.at : null }] };
    }
    return { status: 200, body: [] };
  };
  return s;
}
function ctrlPage(srv) {
  const files = { 'config.js': cur('assets/config.js'), 'booth-core.js': cur('assets/booth-core.js'), 'mock-data.js': cur('assets/mock-data.js') };
  const dom = page(cur('booth-ctrl.html'), files, 'http://localhost/booth-ctrl.html#k=' + TOKEN, (w) => {
    w.localStorage.setItem('aisw-boothctrl-ok-' + TOKEN.slice(-6), JSON.stringify({ at: Date.now() }));
    w.fetch = async (u, init) => {
      const s = String(u);
      if (srv.offline) throw new w.TypeError('Failed to fetch');
      if (s.indexOf('/rest/v1/rpc/') >= 0) {
        const name = s.split('/rpc/')[1].split('?')[0];
        const r = srv.rpc(name, init && init.body ? JSON.parse(init.body) : {});
        if (srv.dropReply && name === 'booth_ctrl_mode' && init && JSON.parse(init.body).p_mode) { srv.dropReply = false; throw new w.TypeError('Failed to fetch'); }
        return fakeRes(JSON.stringify(r.body), { status: r.status });
      }
      if (s.indexOf('/rest/v1/settings') >= 0) {
        return fakeRes(JSON.stringify([{ event_title: '시험', event_start: '2026-11-06T01:00:00Z', event_end: '2026-11-07T08:00:00Z', time_label: '', date_label: '', venue: '',
          booth_pin_enabled: false, booth_sample_common_pin_enabled: false }]), { status: 200 });
      }
      return fakeRes('[]', { status: 200 });
    };
  });
  const w = dom.window, d = w.document;
  const $ = (id) => d.getElementById(id);
  return {
    dom, w, d, $,
    state: () => txt($('now-state')),
    toast: () => txt($('toast')),
    modesShown: () => !$('modes').hidden,
    resvLive: () => !$('resvs').classList.contains('is-away') && $('waits').classList.contains('is-away') && $('waits').hasAttribute('inert'),
    waitLive: () => !$('waits').classList.contains('is-away') && $('resvs').classList.contains('is-away') && $('resvs').hasAttribute('inert'),
    wait: (n) => d.querySelector('.w[data-wait="' + n + '"]').click(),
    tab: (m) => d.querySelector('.modes__b[data-opmode="' + m + '"]').click(),
    online: () => w.dispatchEvent(new w.Event('online')),
    // 다시 읽기(1분 주기 대신 'online' 으로 당김). 저장과 겹친 읽기는 화면이 일부러 버리므로, 조건이 맞을 때까지 몇 번 당깁니다.
    syncUntil: async (cond, ms = 6000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (cond()) return true;
        w.dispatchEvent(new w.Event('online'));
        await sleep(250);
      }
      return cond();
    },
    pendingStored: () => !!w.localStorage.getItem('aisw-boothctrl-pending-' + TOKEN.slice(-6)),
    close: () => w.close()
  };
}
{
  // O0 스위치 꺼짐
  const srv = makeServer();
  const p = ctrlPage(srv);
  await until(() => p.d.querySelectorAll('.w').length === 8 && /입력 전|여유|보통/.test(p.state()));
  await sleep(150);
  t('O0 스위치 꺼짐: 선택 줄 없음 · 대기시간 단추판 · 제목 "대기시간" · "현재 대기"',
    !p.modesShown() && p.waitLive() && txt(p.$('pad-title')) === '대기시간' && txt(p.$('now-cap')) === '현재 대기');
  p.wait(15);
  await until(() => srv.live && srv.live.c === '보통');
  t('O0 스위치 꺼짐: 15분 저장 → 서버 보통 15(지금과 같음)', srv.live && srv.live.c === '보통' && srv.live.w === 15);
  await until(() => p.state() === '보통');
  // O1 켜기 → 다음 읽기에서 선택 줄
  srv.enabled = true;
  await p.syncUntil(() => p.modesShown());
  t('O1 스위치 켬 → 다음 읽기에서 선택 줄(현장대기 고름) · 값 그대로', p.modesShown() && p.d.querySelector('.modes__b.is-on').getAttribute('data-opmode') === 'wait' && p.state() === '보통',
    srv.calls.join(' '));
  // O2 저장된 대기 값이 있으면 확인창 한 번 — 아니요
  p.tab('reserve');
  t('O2 저장된 대기시간(보통 15분)이 있으면 확인창 한 번: 지워진다는 것 · 바로 "현장예약 운영 중" 으로 보인다는 것',
    !p.$('mode-ask').hidden && /현장예약으로 바꿀까요/.test(txt(p.$('mode-ask-t'))) && /보통 15분/.test(txt(p.$('mode-ask-d'))) && /현장예약 운영 중/.test(txt(p.$('mode-ask-d'))) && srv.mode === 'wait',
    txt(p.$('mode-ask-d')));
  p.d.querySelector('[data-act="mode-no"]').click();
  await sleep(50);
  t('O2 아니요 → 아무것도 바뀌지 않음', p.$('mode-ask').hidden && srv.mode === 'wait' && srv.live.c === '보통' && p.waitLive());
  // O3 예 → 한 번에 현장예약 운영 중
  const w3 = srv.writes.length;
  p.tab('reserve');
  p.$('mode-yes').click();
  await until(() => p.resvLive() && p.state() === '현장예약 운영 중');
  t('O3 현장예약 한 번: 서버에 방식 + "현장예약 운영 중"(예약중) 함께 저장 → 화면 "현장예약 운영 중" · 단추 눌림(두 번째 단추를 누르지 않음)',
    srv.mode === 'reserve' && srv.live && srv.live.c === '예약중' && p.state() === '현장예약 운영 중' && p.$('btn-resv-open').getAttribute('aria-pressed') === 'true'
    && srv.writes.slice(w3).join(',') === '예약중/0' && srv.calls.filter((x) => x === 'booth_ctrl_set:resv_open').length === 0, p.state());
  t('O3 제목 "예약 상태" · "현재 상태" · 안내 알림', txt(p.$('pad-title')) === '예약 상태' && txt(p.$('now-cap')) === '현재 상태' && /현장예약 운영 중/.test(p.toast()), p.toast());
  t('O3 숨긴 대기시간 단추는 누를 수 없음(inert · 눌러도 저장 안 함)', (() => { const before = srv.writes.length; p.wait(5); return srv.writes.length === before; })());
  // O3b 현장예약 안에서 상태 바꾸기
  p.$('btn-resv-closed').click();
  await until(() => srv.live && srv.live.c === '예약마감' && p.state() === '예약 마감');
  t('O3b 현장예약 → 예약 마감', srv.live.c === '예약마감' && p.$('btn-resv-closed').getAttribute('aria-pressed') === 'true');
  p.$('btn-pause').click();
  await until(() => srv.live && srv.live.c === '중단' && p.state() === '잠시 중단');
  p.$('btn-resv-open').click();
  await until(() => srv.live && srv.live.c === '예약중' && p.state() === '현장예약 운영 중');
  t('O3b 현장예약 → 잠시 중단 → 현장예약 운영 중 복귀(방식은 그대로)', srv.mode === 'reserve' && srv.live.c === '예약중' && p.resvLive());
  p.tab('reserve');
  await sleep(50);
  t('O3b 이미 현장예약인 칸을 다시 눌러도 아무것도 하지 않음(확인창 · 서버 전환 없음)', p.$('mode-ask').hidden && srv.calls.filter((x) => x === 'booth_ctrl_mode:reserve').length === 1);

  // O4 못 보낸 누름 + 다른 기기 전환
  srv.offline = true;
  p.$('btn-resv-closed').click();
  await until(() => p.pendingStored());
  await until(() => !p.$('bar-pending').hidden || /저장 안 됨/.test(txt(p.$('now-when'))), 2000);   // 보내기 실패까지
  t('O4 오프라인에서 누른 예약 마감 → 저장 대기열(이 기기)', p.pendingStored() && srv.live.c === '예약중');
  p.tab('wait');
  await sleep(50);
  t('O4 저장 대기열 · 연결 끊김 중에는 방식 전환을 받지 않음(확인창 없음 · 안내)', p.$('mode-ask').hidden && /연결을 확인/.test(p.toast()));
  srv.offline = false;
  srv.mode = 'wait'; srv.live = null;   // 다른 기기가 현장대기로 바꿈
  const w0 = srv.writes.length;
  await p.syncUntil(() => p.waitLive() && !p.pendingStored());
  await sleep(200);
  t('O4 연결 복귀: 다른 기기의 전환을 알아채고 못 보낸 "예약 마감"은 버림(서버에 쓰지 않음)',
    p.waitLive() && !p.pendingStored() && srv.writes.length === w0 && srv.live === null, JSON.stringify({ writes: srv.writes.slice(w0), toast: p.toast() }));
  t('O4 안내: 다른 기기에서 바꿨다는 알림', /다른 기기에서 운영 방식을|운영 방식이 바뀌어/.test(p.toast()), p.toast());

  // O5 서버가 방식이 맞지 않는다고 거부(이 화면은 아직 모름)
  srv.mode = 'reserve'; srv.live = { c: '예약중', w: 0, at: now() };   // 다른 기기가 현장예약으로 바꿈(서버가 예약중까지 적음)
  p.wait(10);
  await until(() => p.resvLive() && p.state() === '현장예약 운영 중', 5000);
  t('O5 이 화면이 모르는 사이 다른 기기가 현장예약으로 바꿈 → 대기 분 저장은 서버가 거부 → 누름 버리고 "현장예약 운영 중" 으로 맞춤',
    p.resvLive() && !p.pendingStored() && !srv.writes.some((x) => /^여유\/10/.test(x)) && p.state() === '현장예약 운영 중', p.toast());

  // O6 답을 잃은 전환
  srv.dropReply = true;
  p.tab('wait');
  p.$('mode-yes').click();
  await until(() => srv.mode === 'wait');
  await until(() => p.waitLive(), 5000);
  t('O6 전환 답을 잃음: 서버는 바뀌었고, 화면은 다시 읽어 현장대기로 맞춤("이 기기가 바꾼 것" 으로 안내)',
    srv.mode === 'wait' && p.waitLive() && /바뀐 것을 확인|현장대기로 바꿨어요/.test(p.toast()), p.toast());
  const sw = srv.switches;
  p.tab('wait');
  await sleep(50);
  t('O6 이미 그 방식이면 다시 누르지 않음(확인창 없음 · 서버 전환 없음)', p.$('mode-ask').hidden && srv.switches === sw);
  // 저장을 보내는 중에 방식을 누르면: 확인창 없이 안내만, 그때 '네' 가 눌려도 아무것도 보내지 않음
  srv.offline = false;
  const c0 = srv.calls.length;
  p.wait(20);
  p.tab('reserve');
  const blocked = p.$('mode-ask').hidden && /저장하는 중/.test(p.toast());
  p.$('mode-yes').click();
  await until(() => p.state() === '보통');
  t('O6 저장 중에는 전환을 받지 않음 · 열리지 않은 확인창의 "네" 는 아무것도 보내지 않음',
    blocked && !srv.calls.slice(c0).some((x) => /booth_ctrl_mode:(reserve|wait|)$/.test(x) && x !== 'booth_ctrl_mode:null') && srv.mode === 'wait', srv.calls.slice(c0).join(' '));

  // O7 현장대기 → 현장예약 → 현장대기: 이전 값이 살아나지 않음 · 새 대기시간 입력 안내
  p.wait(30);
  await until(() => srv.live && srv.live.c === '혼잡' && p.state() === '혼잡');
  await sleep(100);
  p.tab('reserve'); p.$('mode-yes').click();
  await until(() => p.resvLive() && p.state() === '현장예약 운영 중');
  p.tab('wait');
  t('O7 현장예약 → 현장대기도 확인창 한 번(예약 상태가 지워지고 "정보 없음" 으로 보인다는 것)', !p.$('mode-ask').hidden && /현장예약 운영 중/.test(txt(p.$('mode-ask-d'))) && /정보 없음/.test(txt(p.$('mode-ask-d'))));
  p.$('mode-yes').click();
  await until(() => p.waitLive() && p.state() === '아직 입력 전');
  t('O7 현장대기 → 현장예약 → 현장대기: 예전 "혼잡 30분" 이 되살아나지 않음 · 새 대기시간 입력 안내',
    srv.live === null && p.state() === '아직 입력 전' && p.d.querySelectorAll('.w.is-on').length === 0 && /대기 시간을 눌러/.test(txt(p.$('now-when')) + p.toast()),
    JSON.stringify({ live: srv.live, state: p.state(), when: txt(p.$('now-when')), toast: p.toast() }));
  // O7b 저장된 값이 없으면 확인창 없이 바로
  p.tab('reserve');
  await until(() => p.resvLive() && p.state() === '현장예약 운영 중');
  t('O7b 지울 값이 없으면 확인창 없이 한 번에 "현장예약 운영 중"', p.$('mode-ask').hidden && srv.live.c === '예약중');
  p.wait(5);   // 숨긴 단추 — 무시
  p.$('btn-resv-open').click();
  await sleep(200);

  // O8 스위치 끔(예약 상태가 남은 채)
  srv.enabled = false;
  await p.syncUntil(() => !p.modesShown() && p.waitLive());
  await sleep(100);
  t('O8 운영본부가 스위치를 끔: 선택 줄 사라짐 · 현장대기 단추판 · 남은 예약 상태는 "아직 입력 전" 으로(관람객과 같음)',
    !p.modesShown() && p.waitLive() && p.state() === '아직 입력 전' && /현장예약을 꺼서/.test(p.toast()), p.state() + ' / ' + p.toast());
  p.wait(10);
  await until(() => srv.live && srv.live.c === '여유');
  t('O8 끈 뒤 대기 시간을 누르면 바로 덮어씀', srv.live.c === '여유' && srv.live.w === 10);
  p.close();
}
{
  // O9 다시 열기: 방식 유지
  const srv = makeServer({ enabled: true, mode: 'reserve', live: { c: '예약마감', w: 0, at: now() } });
  const p = ctrlPage(srv);
  await until(() => p.modesShown() && p.resvLive(), 5000);
  t('O9 다시 열어도(새로 고침 · 재접속) 서버의 방식 유지: 현장예약 고름 · 예약 마감 눌림',
    p.d.querySelector('.modes__b.is-on').getAttribute('data-opmode') === 'reserve' && p.state() === '예약 마감' && p.$('btn-resv-closed').getAttribute('aria-pressed') === 'true');
  p.close();
}
{
  // O10 DB 적용 전(함수 없음)
  const srv = makeServer({ noModeFn: true, live: { c: '보통', w: 20, at: now() } });
  const p = ctrlPage(srv);
  await until(() => p.state() === '보통', 5000);
  await sleep(300);
  t('O10 DB 적용 전(booth_ctrl_mode 없음): 지금과 같은 화면 · 오류 화면 없음', !p.modesShown() && p.waitLive() && p.state() === '보통' && p.$('view-msg') ? p.$('view-msg').hidden !== false : true);
  p.wait(45);
  await until(() => srv.live.c === '혼잡');
  t('O10 DB 적용 전: 저장 정상', srv.live.c === '혼잡' && srv.live.w === 45);
  p.close();
}
{
  // O11 두 기기: 한쪽이 현장예약으로 바꾸면 다른 쪽도 다음 읽기에서 "현장예약 운영 중"
  const srv = makeServer({ enabled: true });
  const a = ctrlPage(srv), b = ctrlPage(srv);
  await until(() => a.modesShown() && b.modesShown(), 5000);
  a.tab('reserve');
  await until(() => a.resvLive() && a.state() === '현장예약 운영 중');
  await b.syncUntil(() => b.resvLive() && b.state() === '현장예약 운영 중');
  t('O11 두 기기: A 가 현장예약 → B 도 아무것도 누르지 않고 "현장예약 운영 중" · 알림', b.resvLive() && b.state() === '현장예약 운영 중' && /다른 기기에서/.test(b.toast()), b.toast());
  b.$('btn-resv-closed').click();
  await until(() => srv.live.c === '예약마감');
  await a.syncUntil(() => a.state() === '예약 마감');
  t('O11 두 기기: B 의 예약 마감이 A 에도 반영', a.state() === '예약 마감');
  a.close(); b.close();
}

rmSync(TMP, { recursive: true, force: true });
const fail = results.filter((x) => !x.ok);
console.log(`\n${results.length - fail.length}/${results.length} 통과`);
process.exit(fail.length ? 1 : 0);
