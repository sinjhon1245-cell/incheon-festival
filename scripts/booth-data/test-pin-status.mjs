/* ===================================================================
   리허설 공통 PIN · 개별 PIN 표시 시험(A-4) — 화면 판정 = 서버 판정인지, 복제 DB · 시험 시계로
   ───────────────────────────────────────────────────────────────────
   복제 DB 를 지금 Production 단계로 만들고(lib/ui-harness prepReplica), 리허설 공통 PIN 판정 함수의 now() 하나만 시험 시계로 바꿉니다.
   부스 운영 현황(booth-admin) · QR · PIN 관리(print-qr) · 관리자 부스 관리(admin)를 jsdom 으로 열어, 상황마다
   화면이 말하는 ‘공통 PIN 사용 가능’ 부스와 서버가 실제로 받는 부스(private.booth_common_pin_target + PIN 보조 로그인 스위치)를 견줍니다.
     U  판정 도구(assets/pin-status.js) · 끝나는 때 = migration · Production 지문
     P  상황: 처음 · 실제 경고 · 개별 PIN 발급(R1) · 끄기 · 비공개 · 스위치 꺼짐 · 22:59:59 / 23:00 · 행사 첫날을 당긴 경우 · 대상 목록이 바뀐 경우
     L  실제 공통 PIN(123456) 로그인으로 서버 쪽 확인
     W  화면이 쓰는 것 없음 · ‘로그인 중’ 같은 말 없음 · 용어(개별 PIN) · 예시 모드 · PIN · 인증 함수 그대로
   ⚠️ 네트워크 · Production 접속 없음. 열쇠 · PIN 은 복제 DB 의 가짜 값이고 출력하지 않습니다(공통 PIN 값은 서버 함수에 이미 있는 값).
   쓰는 법
     node --max-old-space-size=8192 scripts/booth-data/test-pin-status.mjs --pglite-dir <PGlite 0.4.4> --jsdom-dir <jsdom 30> --main-dir <main 작업 폴더>
   결과: out/rehearsal/pin-status-test-report.md
   =================================================================== */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { readCsv } from './lib/csv.mjs';
import { loadPglite, ADMIN } from './lib/replica.mjs';
import { prepReplica, installTestClock, openPage, until, wait, text, click, visibleText } from './lib/ui-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT = resolve(HERE, 'out');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const MAIN = resolve(arg('main-dir', REPO));
const { JSDOM, VirtualConsole } = createRequire(join(resolve(arg('jsdom-dir')), 'package.json'))('jsdom');
const lib = await loadPglite(arg('pglite-dir'));
const manifest = readCsv(resolve(OUT, 'staging', 'manifest.csv'));
const plan = readCsv(resolve(OUT, 'gate4r', 'plan-R.csv'));
const snap = readCsv(resolve(OUT, readdirSync(OUT).filter(f => /^prod-snapshot-\d{8}\.csv$/.test(f)).sort().pop()));
const REAL = plan.map(p => p['부스ID']);
const idOf = c => { const p = plan.find(x => x['표시코드'] === c); if (!p) throw new Error('부스 없음 ' + c); return p['부스ID']; };
const codeOf = id => (plan.find(x => x['부스ID'] === id) || {})['표시코드'] || id;
const git = (...a) => { try { return execFileSync('git', ['-C', MAIN, ...a], { encoding: 'utf8' }).trim(); } catch { return '?'; } };

const results = [], notes = [];
let section = '';
function t(name, ok, note = '') { results.push({ section, name, ok: !!ok, note: ok ? '' : String(note).slice(0, 500) }); console.log(`${ok ? '통과' : '실패'}  ${name}${note && !ok ? '  — ' + String(note).slice(0, 500) : ''}`); }
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

const { R, db, rest } = await prepReplica({ lib, snap, manifest, here: HERE, repo: REPO, mainDir: MAIN });
const q1 = async (sql, p) => (await db.query(sql, p)).rows[0];
async function admin(sql, p) {
  try { await db.exec(`set test.uid = '${ADMIN}'`); return { ok: true, rows: (await db.query(sql, p)).rows }; }
  catch (e) { return { ok: false, code: e.code, message: e.message }; }
  finally { await db.exec("set test.uid = ''"); }
}
const fnFp = async () => (await q1(`select md5(string_agg(p.oid::regprocedure::text || '=' || md5(replace(pg_get_functiondef(p.oid), E'\\r', '')), ',' order by p.oid::regprocedure::text)) f
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prokind = 'f'`)).f;
const fn0 = await fnFp();
const clock = await installTestClock(db, MAIN);
const KST = iso => Date.parse(iso + '+09:00');
async function at(iso) { await clock.setNow(iso + '+09'); return KST(iso); }   // 서버 · 화면 시계를 같은 시각으로

// 서버 판정: 실제 공통 PIN 로그인을 받는 부스 = 스위치 켜짐 · private.booth_common_pin_target(부스)
async function serverOpen() {
  const sw = (await q1('select booth_pin_enabled v from public.settings order by id limit 1')).v === true;
  if (!sw) return [];
  return (await db.query('select x::text id from unnest($1::uuid[]) x where private.booth_common_pin_target(x)', [REAL])).rows.map(r => r.id);
}
let devN = 0;
async function login(code, pin = '123456') {
  try { return (await R.asAnon('select * from public.booth_pin_login($1, $2, $3)', [idOf(code), pin, 'pinstatusdev' + String(++devN).padStart(8, '0')]))[0]; }
  catch (e) { return { ok: false, reason: e.code }; }
}

// ── 화면 읽기 ──────────────────────────────────────────────────────────
async function readBoothAdmin(atMs, hooks, query = '') {
  const p = await openPage({ JSDOM, VirtualConsole, dir: MAIN, file: 'booth-admin.html', R, rest, at: atMs, hooks, query });
  await until(() => p.d.querySelectorAll('#lv-list .lv').length > 0, 25000);
  if (!query) await until(() => !!text(p.d.getElementById('lv-pin')), 15000);
  await wait(150);
  const flags = {};
  p.d.querySelectorAll('#lv-list .lv[data-id]').forEach(el => { flags[el.getAttribute('data-id')] = text(el.querySelector('.lv__cred')); });
  const strip = text(p.d.getElementById('lv-pin'));
  const m1 = /사용 가능 (\d+)곳/.exec(strip), m2 = /실제 부스 (\d+)곳 중 발급 (\d+)곳 · 미발급 (\d+)곳 · 꺼짐 (\d+)곳/.exec(strip);
  const out = { p, strip, flags, open: m1 ? +m1[1] : null, target: m2 ? +m2[1] : null, on: m2 ? +m2[2] : null, none: m2 ? +m2[3] : null, off: m2 ? +m2[4] : null,
    sum: text(p.d.getElementById('lv-sum')), body: visibleText(p.d), errors: p.errors, calls: p.calls };
  return out;
}
async function detailOf(p, id) {   // 한 줄 펼쳐 ‘접속’ 칸 읽기
  click(p.w, p.d.querySelector(`#lv-list .lv[data-id="${id}"] [data-act="more"]`));
  await until(() => !!p.d.querySelector(`#lv-list .lv[data-id="${id}"] .lvd`), 3000);
  const dd = [...p.d.querySelectorAll(`#lv-list .lv[data-id="${id}"] .lvd > div`)].find(x => text(x.querySelector('dt')) === '접속');
  return dd ? text(dd.querySelector('dd')) : '';
}
async function readPrintPin(atMs, hooks, query = '') {
  const p = await openPage({ JSDOM, VirtualConsole, dir: MAIN, file: 'print-qr.html', R, rest, at: atMs, hooks, query });
  await until(() => p.d.querySelectorAll('#grid-ops .item--ops').length > 0, 30000);
  click(p.w, p.d.getElementById('pinx-toggle'));
  await until(() => !p.d.getElementById('pinx-main').hidden && p.d.querySelectorAll('#pinx-list .prow').length > 0, 25000);
  await wait(150);
  const rows = [...p.d.querySelectorAll('#pinx-list .prow')].map(li => {
    const cb = li.querySelector('input[data-pid]');
    return { id: cb && cb.getAttribute('data-pid'), st: text(li.querySelector('.prow__st')), cmn: !!li.querySelector('.pst--cmn') };
  });
  const notesTxt = text(p.d.getElementById('pinx-notes'));
  const m = /실제 부스 (\d+)곳 중 (\d+)곳이 (.+?)까지/.exec(notesTxt);
  return { p, rows, notes: notesTxt, head: text(p.d.getElementById('pinx-sum')), stats: text(p.d.getElementById('pinx-stats')),
    tagged: rows.filter(r => r.cmn).map(r => r.id), target: m ? +m[1] : null, open: m ? +m[2] : null, end: m ? m[3] : null,
    body: visibleText(p.d), errors: p.errors, calls: p.calls };
}
// 관리자 부스 관리(admin.html)는 포털 표(schedule_items 등)가 있어야 열려 복제 DB 로는 실제 목록을 그리지 못합니다.
// 그래서 같은 그리기 코드(credTags)를 쓰는 협의용 예시(?demo=1)로 열어 용어를 보고, admin.js 글은 따로 봅니다.
async function readAdmin(atMs) {
  const query = '?demo=1';
  const p = await openPage({ JSDOM, VirtualConsole, dir: MAIN, file: 'admin.html', R, rest, at: atMs, query, hash: '#booths' });
  await until(() => /개별 PIN|PIN 발급|PIN 미발급/.test(text(p.d.body)), 25000);
  await wait(300);
  return { p, body: visibleText(p.d), errors: p.errors, calls: p.calls };
}
const closeAll = (...xs) => xs.forEach(x => { try { x.p.dom.window.close(); } catch { /* 없음 */ } });
const realIds = ids => ids.filter(id => REAL.includes(id));
const flagged = (ba, word) => REAL.filter(id => (ba.flags[id] || '').includes(word));

// ══ U 판정 도구 ═════════════════════════════════════════════════════════
section = 'U 판정 도구';
const psSrc = readFileSync(join(MAIN, 'assets/pin-status.js'), 'utf8');
const box = { window: {} }; vm.runInNewContext(psSrc, box);
const PS = box.window.PinStatus;
const migSrc = readFileSync(join(MAIN, 'supabase/migration-booth-rehearsal-pin.sql'), 'utf8');
const untilFp = (await q1("select left(md5(replace(pg_get_functiondef('private.rehearsal_common_pin_until()'::regprocedure), E'\\r', '')), 8) f")).f;
t('U1 끝나는 때 — pin-status.js 의 시각 = migration 의 시각(2026-11-05 23:00 KST) · 복제 DB 함수 지문 = Production(11cc0ed6)',
  PS.END === '2026-11-05T23:00:00+09:00' && /timestamptz '2026-11-05 23:00:00\+09'/.test(migSrc) && untilFp === '11cc0ed6', `${PS.END} ${untilFp}`);
t('U2 행사 첫날이 앞당겨지면 그날 00:00(서버와 같은 식 least) · 날짜를 모르면 11-05 23:00 · 표시 “11월 5일(목) 23:00”',
  PS.endOf('2026-11-06') === KST('2026-11-05T23:00:00') && PS.endOf('2026-11-05') === KST('2026-11-05T00:00:00') && PS.endOf('2026-11-10') === KST('2026-11-05T23:00:00') &&
  PS.endOf('') === KST('2026-11-05T23:00:00') && PS.endText(PS.endOf('2026-11-06')) === '11월 5일(목) 23:00' && PS.endText(PS.endOf('2026-11-05')) === '11월 5일(목) 00:00');
const base = { target: true, shown: true, pinState: 'none', switchOn: true, end: 100, now: 50 };
const k = o => PS.common(Object.assign({}, base, o)).key;
t('U3 판정 순서 — 사용 가능 · 개별 PIN(발급 · 꺼짐)이면 닫힘 · 끝남 · 비공개 · 스위치 꺼짐 · 대상 아님 · 모름',
  k({}) === 'open' && k({ pinState: 'on' }) === 'closed' && k({ pinState: 'off' }) === 'closed' && k({ now: 100 }) === 'ended' &&
  k({ shown: false }) === 'hidden' && k({ switchOn: false }) === 'off' && k({ target: false }) === 'na' &&
  k({ target: null }) === 'unknown' && k({ pinState: null }) === 'unknown');
t('U5 PIN 보조 로그인 설정을 못 읽으면(null · 없음) ‘사용 가능’ 이 아니라 ‘상태 확인 불가’(unchecked) — 켜졌다고 확인한 때(true)만 사용 가능 · 셈에서도 따로',
  k({ switchOn: null }) === 'unchecked' && k({ switchOn: undefined }) === 'unchecked' && k({ switchOn: 'yes' }) === 'unchecked' && k({ switchOn: true }) === 'open' &&
  PS.common(Object.assign({}, base, { switchOn: null })).label.includes('상태 확인 불가') &&
  PS.summarize([{ target: true, pinState: 'none', common: PS.common(Object.assign({}, base, { switchOn: null })) }]).open === 0 &&
  PS.summarize([{ target: true, pinState: 'none', common: PS.common(Object.assign({}, base, { switchOn: null })) }]).unchecked === 1);
t('U4 pin-status.js 는 읽기만 — DB 호출 · 네트워크 · 저장 없음', !/rpc\(|fetch\(|localStorage|\.from\(|XMLHttpRequest/.test(psSrc));

// ══ P 상황별 ═══════════════════════════════════════════════════════════
section = 'P 상황별';
let T = await at('2026-10-25T15:00:00');
let srv = await serverOpen();
let ba = await readBoothAdmin(T), pq = await readPrintPin(T);
t('P1 처음(10-25 15:00) — 서버가 받는 부스 84곳 = 운영 현황 “11월 5일(목) 23:00까지 · 사용 가능 84곳” = QR · PIN 관리 ‘공통 PIN’ 84줄(같은 부스)',
  srv.length === 84 && ba.open === 84 && /리허설 공통 PIN\s?11월 5일\(목\) 23:00까지 · 사용 가능 84곳/.test(ba.strip) &&
  sameSet(pq.tagged, srv) && pq.target === 84 && pq.open === 84 && pq.end === '11월 5일(목) 23:00', `${srv.length} ${ba.strip} | ${pq.notes.slice(0, 160)} ${pq.tagged.length}`);
t('P2 개별 PIN 줄 — “실제 부스 84곳 중 발급 0곳 · 미발급 84곳 · 꺼짐 0곳” · 관리 수 칩 “개별 PIN 발급됨 2(예시) · 미발급 132 · 꺼짐 0”',
  ba.target === 84 && ba.on === 0 && ba.none === 84 && ba.off === 0 && /개별 PIN 발급됨 2 · 미발급 132 · 꺼짐 0/.test(pq.head) && /개별PIN미발급132/.test(pq.stats.replace(/\s/g, '')),
  `${ba.strip} | ${pq.head} | ${pq.stats}`);
t('P3 정상 리허설 상태는 경고로 안 보임 — 실제 84줄 ‘확인할 것’ 에 ‘개별 PIN 미발급’ 없음(공통 PIN 사용 가능) · 펼친 상세에는 “개별 PIN 미발급 · 리허설 공통 PIN 사용 가능(11월 5일(목) 23:00까지)”',
  flagged(ba, '개별 PIN 미발급').length === 0 && flagged(ba, 'PIN 미발급').length === 0 &&
  /개별 PIN 미발급 · 리허설 공통 PIN 사용 가능\(11월 5일\(목\) 23:00까지\)/.test(await detailOf(ba.p, idOf('R3-01'))), JSON.stringify(flagged(ba, '미발급').slice(0, 3)));
closeAll(ba, pq);
// 실제 경고: R2-01 열쇠 끄기 · R2-02 최근 1시간 PIN 실패 10번(복제 DB)
const dis = await admin('select public.admin_disable_booth_token($1)', [idOf('R2-01')]);
await db.query(`insert into public.booth_auth_event (event, booth_id, at) select 'pin_fail', $1, now() - interval '5 minutes' from generate_series(1, 10)`, [idOf('R2-02')]);
ba = await readBoothAdmin(T);
t('P4 실제 경고는 그대로 — R2-01 ‘QR 꺼짐’ · R2-02 ‘PIN 실패 많음’ · 요약 카드 ‘PIN 확인 1’ · 두 부스 모두 공통 PIN 사용 가능은 그대로(열쇠 · 실패는 공통 PIN 판정과 따로)',
  dis.ok && /QR 꺼짐/.test(ba.flags[idOf('R2-01')]) && /PIN 실패 많음/.test(ba.flags[idOf('R2-02')]) && /1PIN확인/.test(ba.sum.replace(/\s/g, '')) && ba.open === 84 && (await serverOpen()).length === 84,
  `${ba.flags[idOf('R2-01')]} | ${ba.flags[idOf('R2-02')]} | ${ba.sum}`);
closeAll(ba);
// R1 21곳 개별 PIN 발급(복제 DB · 조건부 발급 함수 그대로)
const R1 = REAL.filter(id => codeOf(id).startsWith('R1-'));
let issued = 0;
for (const id of R1) { const r = await admin("select * from public.admin_issue_booth_pin_checked($1, 'none', null)", [id]); if (r.ok) issued++; }
srv = await serverOpen();
ba = await readBoothAdmin(T); pq = await readPrintPin(T);
t('P5 R1 21곳 개별 PIN 발급 → 서버 63곳 = 운영 현황 “사용 가능 63곳 · 개별 PIN 발급으로 닫힘 21곳” = ‘공통 PIN’ 63줄(R1 없음) · “발급 21곳 · 미발급 63곳”',
  issued === 21 && srv.length === 63 && ba.open === 63 && /개별 PIN 발급으로 닫힘 21곳/.test(ba.strip) && ba.on === 21 && ba.none === 63 &&
  sameSet(pq.tagged, srv) && !pq.tagged.some(id => R1.includes(id)) && pq.open === 63, `${issued} ${srv.length} ${ba.strip} | ${pq.tagged.length}`);
t('P6 발급한 R1 줄 — ‘개별 PIN 발급됨’ · ‘공통 PIN’ 표 없음 · 운영 현황 줄 표시 없음(정상) · 상세 “개별 PIN 발급됨 · 리허설 공통 PIN 닫힘(개별 PIN 발급)”',
  R1.every(id => /개별 PIN 발급됨/.test((pq.rows.find(r => r.id === id) || {}).st || '')) && R1.every(id => !ba.flags[id]) &&
  /개별 PIN 발급됨 · 리허설 공통 PIN 닫힘\(개별 PIN 발급\)/.test(await detailOf(ba.p, idOf('R1-03'))), JSON.stringify(R1.slice(0, 2).map(id => [ba.flags[id], (pq.rows.find(r => r.id === id) || {}).st])));
closeAll(ba, pq);
// 끄기: R1-01 — 서버는 끈 기록 때문에 공통 PIN 을 다시 열지 않음
const off = await admin('select * from public.admin_disable_booth_pin($1)', [idOf('R1-01')]);
srv = await serverOpen();
ba = await readBoothAdmin(T);
t('P7 R1-01 개별 PIN 끄기 → 서버는 공통 PIN 을 다시 열지 않음(63곳 그대로) = 화면도 63 · R1-01 줄 ‘개별 PIN 꺼짐’ · “발급 20곳 · 미발급 63곳 · 꺼짐 1곳”',
  off.ok && srv.length === 63 && !srv.includes(idOf('R1-01')) && ba.open === 63 && /개별 PIN 꺼짐/.test(ba.flags[idOf('R1-01')]) && ba.on === 20 && ba.none === 63 && ba.off === 1,
  `${off.ok} ${srv.length} ${ba.strip} | ${ba.flags[idOf('R1-01')]}`);
closeAll(ba);
// 비공개: R2-03(복제 DB) — 서버는 공개 부스만 받음
await db.query('update public.booths set is_published = false where id = $1', [idOf('R2-03')]);
srv = await serverOpen();
ba = await readBoothAdmin(T); pq = await readPrintPin(T);
const lgHidden = await login('R2-03');
t('P8 R2-03 비공개 → 서버 62곳(로그인도 거절) = 화면 62 · “비공개라 못 씀 1곳” · ‘공통 PIN’ 62줄',
  srv.length === 62 && !lgHidden.ok && ba.open === 62 && /비공개라 못 씀 1곳/.test(ba.strip) && sameSet(pq.tagged, srv), `${srv.length} ${lgHidden.ok} ${ba.strip} ${pq.tagged.length}`);
closeAll(ba, pq);
await db.query('update public.booths set is_published = true where id = $1', [idOf('R2-03')]);
// PIN 보조 로그인 스위치 끄기 — 로그인 함수가 먼저 막음
await db.exec('update public.settings set booth_pin_enabled = false where id = 1');
const lgOff = await login('R3-01');
ba = await readBoothAdmin(T); pq = await readPrintPin(T);
t('P9 PIN 보조 로그인 꺼짐 → 서버는 공통 PIN 로그인 거절(off) = 운영 현황 “PIN 보조 로그인이 꺼져 있어 지금은 쓸 수 없어요” · ‘공통 PIN’ 표 0 · 줄에는 ‘개별 PIN 미발급’ 다시 보임',
  !lgOff.ok && lgOff.reason === 'off' && /PIN 보조 로그인이 꺼져 있어 지금은 쓸 수 없어요/.test(ba.strip) && pq.tagged.length === 0 &&
  /PIN 보조 로그인이 꺼져 있어/.test(pq.notes) && flagged(ba, '개별 PIN 미발급').length === 63, `${lgOff.reason} ${ba.strip} | ${pq.tagged.length} ${flagged(ba, '개별 PIN 미발급').length}`);
closeAll(ba, pq);
await db.exec('update public.settings set booth_pin_enabled = true where id = 1');

// ══ L 실제 로그인으로 확인 ══════════════════════════════════════════════
section = 'L 실제 로그인';
const lg1 = await login('R3-01'), lg2 = await login('R1-02'), lgW = await login('R3-02', '000000');
t('L1 공통 PIN 123456 리허설 로그인 그대로 — 화면이 ‘사용 가능’ 이라 한 R3-01 은 로그인됨 · ‘닫힘’ 인 R1-02(개별 PIN 발급)는 거절 · 틀린 PIN 거절',
  lg1.ok === true && /^[A-Za-z0-9_-]{43}$/.test(lg1.session || '') && lg2.ok === false && lgW.ok === false, JSON.stringify([lg1.ok, lg1.reason, lg2.ok, lg2.reason, lgW.reason]));

// ══ P 끝나는 때 ═════════════════════════════════════════════════════════
section = 'P 끝나는 때';
T = await at('2026-11-05T22:59:59');
srv = await serverOpen();
ba = await readBoothAdmin(T); pq = await readPrintPin(T);
t('P10 11-05 22:59:59 — 서버 63곳 = 화면 63(아직 사용 가능)', srv.length === 63 && ba.open === 63 && pq.open === 63 && sameSet(pq.tagged, srv), `${srv.length} ${ba.open} ${pq.open}`);
closeAll(ba, pq);
T = await at('2026-11-05T23:00:00');
srv = await serverOpen();
const lgEnd = await login('R3-05');
ba = await readBoothAdmin(T); pq = await readPrintPin(T);
t('P11 11-05 23:00:00 — 서버 0곳 · 로그인 거절 = 운영 현황 “11월 5일(목) 23:00에 끝났어요” · QR · PIN 관리 “… 끝났어요. 개별 PIN이 없는 실제 부스 63곳은 운영자 QR로만 …” · ‘공통 PIN’ 표 0',
  srv.length === 0 && !lgEnd.ok && /리허설 공통 PIN\s?11월 5일\(목\) 23:00에 끝났어요/.test(ba.strip) &&
  /리허설 공통 PIN은 11월 5일\(목\) 23:00에 끝났어요\. 개별 PIN이 없는 실제 부스 63곳은 운영자 QR로만 열 수 있어요/.test(pq.notes) && pq.tagged.length === 0,
  `${srv.length} ${lgEnd.ok} ${ba.strip} | ${pq.notes.slice(0, 120)}`);
t('P12 끝난 뒤에는 개별 PIN 이 없는 63줄에 ‘개별 PIN 미발급’ 을 다시 띄움(손이 가야 할 일) · R1-01 ‘개별 PIN 꺼짐’ · 발급한 20줄은 표시 없음',
  flagged(ba, '개별 PIN 미발급').length === 63 && /개별 PIN 꺼짐/.test(ba.flags[idOf('R1-01')]) && R1.filter(id => id !== idOf('R1-01')).every(id => !/PIN/.test(ba.flags[id] || '')),
  `${flagged(ba, '개별 PIN 미발급').length}`);
closeAll(ba, pq);
// 행사 첫날을 11-05 로 당기면 끝나는 때 = 11-05 00:00 (서버 · 화면 같은 식)
await db.exec("update public.settings set event_start = '2026-11-05 01:00:00+00' where id = 1");
T = await at('2026-11-04T23:59:59');
const srvA = await serverOpen();
ba = await readBoothAdmin(T);
const baA = { open: ba.open, strip: ba.strip };
closeAll(ba);
T = await at('2026-11-05T00:00:00');
const srvB = await serverOpen();
ba = await readBoothAdmin(T);
t('P13 행사 첫날을 11-05 로 당기면 — 11-04 23:59:59 서버 63 = 화면 “11월 5일(목) 00:00까지 · 사용 가능 63곳” · 11-05 00:00 서버 0 = 화면 “00:00에 끝났어요”',
  srvA.length === 63 && baA.open === 63 && /11월 5일\(목\) 00:00까지/.test(baA.strip) && srvB.length === 0 && /11월 5일\(목\) 00:00에 끝났어요/.test(ba.strip),
  `${srvA.length} ${baA.strip} | ${srvB.length} ${ba.strip}`);
closeAll(ba);
await db.exec("update public.settings set event_start = '2026-11-06 01:00:00+00' where id = 1");
// 대상 수는 DB 목록에서 — 목록에서 R4-21 을 뺀 답을 화면에 주면 83곳으로 셈(고정 84 아님)
T = await at('2026-10-25T15:00:00');
const drop = idOf('R4-21');
const hooks = { rpc: (name, args, res) => (name === 'admin_rehearsal_status' && res.data ? { data: res.data.map(r => Object.assign({}, r, { target_ids: r.target_ids.filter(x => x !== drop) })), error: null } : null) };
ba = await readBoothAdmin(T, hooks); pq = await readPrintPin(T, hooks);
t('P14 실제 부스 수는 DB 대상 목록에서 — 목록이 83곳이면 “실제 부스 83곳 중 …” · 사용 가능 62 · 빠진 R4-21 은 ‘공통 PIN’ 표 없음',
  ba.target === 83 && ba.open === 62 && pq.target === 83 && pq.open === 62 && !pq.tagged.includes(drop), `${ba.strip} | ${pq.notes.slice(0, 100)}`);
closeAll(ba, pq);

// ══ B 경계 조건 — 설정을 못 읽을 때 · 오래 열어 둔 화면의 끝나는 때 ══════════════════════
section = 'B 경계 조건';
const failSettings = { fromError: tb => tb === 'settings' };
srv = await serverOpen();
ba = await readBoothAdmin(T, failSettings); pq = await readPrintPin(T, failSettings);
const lgUnk = await login('R3-03');
const b1Detail = await detailOf(ba.p, idOf('R3-04'));
t('B1 PIN 보조 로그인 설정을 못 읽으면(스위치는 실제로 켜짐 · 서버는 63곳 받음) — 운영 현황 “상태 확인 불가 — PIN 보조 로그인 설정을 읽지 못했어요” · ‘사용 가능 N곳’ 을 말하지 않음 · QR · PIN 관리 안내 “상태 확인 불가” · ‘공통 PIN’ 표 0 · 줄 상세 “리허설 공통 PIN 상태 확인 불가”',
  srv.length === 63 && /상태 확인 불가 — PIN 보조 로그인 설정을 읽지 못했어요/.test(ba.strip) && ba.open === null && !/사용 가능 \d+곳/.test(ba.strip) &&
  /리허설 공통 PIN: 상태 확인 불가/.test(pq.notes) && pq.open === null && pq.tagged.length === 0 && /리허설 공통 PIN 상태 확인 불가/.test(b1Detail),
  `${srv.length} | ${ba.strip} | ${pq.notes.slice(0, 120)} | ${pq.tagged.length} | ${b1Detail}`);
t('B2 확인 불가일 때 줄은 예전처럼 ‘개별 PIN 미발급’ 을 띄움(정상이라고 단정하지 않음) · 서버 쪽 공통 PIN 123456 로그인은 그대로 됨(화면 설정 읽기와 무관)',
  flagged(ba, '개별 PIN 미발급').length === 63 && lgUnk.ok === true, `${flagged(ba, '개별 PIN 미발급').length} ${lgUnk.ok} ${lgUnk.reason}`);
closeAll(ba, pq);
await db.exec('update public.settings set booth_pin_enabled = false where id = 1');
const srvOff = await serverOpen();
ba = await readBoothAdmin(T, failSettings);
t('B3 스위치가 실제로 꺼졌는데 설정까지 못 읽어도 — 서버 0곳 · 화면은 ‘사용 가능’ 수를 말하지 않고 “상태 확인 불가”(어긋난 수 없음)',
  srvOff.length === 0 && /상태 확인 불가/.test(ba.strip) && ba.open === null, `${srvOff.length} ${ba.strip}`);
closeAll(ba);
await db.exec('update public.settings set booth_pin_enabled = true where id = 1');
// 오래 열어 둔 QR · PIN 관리: 끝나기 27시간 전(11-04 20:00)에 열고, 1시간 넘는 타이머는 시험이 시계를 옮겨 직접 부름
async function openPinPage(atMs) {
  const p = await openPage({ JSDOM, VirtualConsole, dir: MAIN, file: 'print-qr.html', R, rest, at: atMs, longTimers: true });
  await until(() => p.d.querySelectorAll('#grid-ops .item--ops').length > 0, 30000);
  click(p.w, p.d.getElementById('pinx-toggle'));
  await until(() => !p.d.getElementById('pinx-main').hidden && p.d.querySelectorAll('#pinx-list .prow').length > 0, 25000);
  await wait(150);
  return p;
}
const notesOf = p => text(p.d.getElementById('pinx-notes'));
const tagsOf = p => p.d.querySelectorAll('#pinx-list .pst--cmn').length;
const END_MS = KST('2026-11-05T23:00:00');
let T0 = await at('2026-11-04T20:00:00');
let lp = await openPinPage(T0);
const firstTimers = [...lp.w.__long.values()].map(x => x.ms);
const steps = [];
for (let guard = 0; guard < 12 && lp.w.__long.size; guard++) {
  const [id, tm] = [...lp.w.__long.entries()].sort((a, b) => (a[1].from + a[1].ms) - (b[1].from + b[1].ms))[0];
  lp.w.__long.delete(id);
  const due = tm.from + tm.ms;
  lp.w.__setNow(due); await clock.setNow(new Date(due).toISOString());
  tm.fn(); await wait(80);
  steps.push({ at: new Date(due + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' '), open: /까지 쓸 수 있어요/.test(notesOf(lp)), ended: /에 끝났어요/.test(notesOf(lp)), tags: tagsOf(lp), next: lp.w.__long.size });
}
const srvEnd = await serverOpen();
const last = steps[steps.length - 1] || {};
t('B4 끝나기 27시간 전부터 열어 둔 QR · PIN 관리 — 처음 6시간짜리 예약 하나(예전 코드는 24시간 넘으면 예약 없음) · 6시간마다 다시 예약 · 마지막 예약이 11-05 23:00 직후 → “23:00에 끝났어요” · ‘공통 PIN’ 표 0 · 더 예약 없음 · 서버도 0',
  firstTimers.length === 1 && firstTimers[0] === 6 * 3600e3 && steps.length === 5 && steps.slice(0, 4).every(s => s.open && !s.ended && s.tags === 63 && s.next === 1) &&
  last.ended && last.tags === 0 && last.next === 0 && /11-05 23:00/.test(last.at) && srvEnd.length === 0 && !lp.errors.length,
  JSON.stringify({ firstTimers, steps, srv: srvEnd.length }));
lp.dom.window.close();
// 화면으로 돌아오기 · 창 다시 고르기: 타이머가 멈췄던 경우(잠자기 · 숨김) — 시계만 23:00 뒤로 옮기고 이벤트로 다시 봄
T0 = await at('2026-11-04T20:00:00');
const v1 = await openPinPage(T0), v2 = await openPinPage(T0);
const beforeV = [/까지 쓸 수 있어요/.test(notesOf(v1)), tagsOf(v1)];
const AFTER = END_MS + 5000;
v1.w.__setNow(AFTER); v2.w.__setNow(AFTER); await clock.setNow('2026-11-05 23:00:05+09');
v1.d.dispatchEvent(new v1.w.Event('visibilitychange')); v2.w.dispatchEvent(new v2.w.Event('focus'));
await wait(150);
t('B5 타이머가 돌지 않았어도 화면으로 돌아오면(visibilitychange) · 창을 다시 고르면(focus) 바로 “23:00에 끝났어요” · ‘공통 PIN’ 표 0',
  beforeV[0] && beforeV[1] === 63 && /에 끝났어요/.test(notesOf(v1)) && tagsOf(v1) === 0 && /에 끝났어요/.test(notesOf(v2)) && tagsOf(v2) === 0 && !v1.errors.length && !v2.errors.length,
  JSON.stringify([beforeV, notesOf(v1).slice(0, 60), tagsOf(v1), notesOf(v2).slice(0, 60), tagsOf(v2)]));
v1.dom.window.close(); v2.dom.window.close();
// 오래 열어 둔 부스 운영 현황: 15초마다 다시 그리기 · 돌아오면 3초 안에 다시 읽기(BoothCore.poll)
T0 = await at('2026-11-04T20:00:00');
const ba1 = await readBoothAdmin(T0), ba2 = await readBoothAdmin(T0);
const b6before = [ba1.open, ba2.open];
ba1.p.w.__setNow(AFTER); ba2.p.w.__setNow(AFTER); await clock.setNow('2026-11-05 23:00:05+09');
ba1.p.d.dispatchEvent(new ba1.p.w.Event('visibilitychange'));
const viaVisible = await until(() => /23:00에 끝났어요/.test(text(ba1.p.d.getElementById('lv-pin'))), 6000, 100);
const viaPoll = await until(() => /23:00에 끝났어요/.test(text(ba2.p.d.getElementById('lv-pin'))), 25000, 200);
t('B6 끝나기 27시간 전부터 열어 둔 부스 운영 현황 — 돌아오면 3초 안에 · 그대로 두어도 다음 15초 다시 읽기에서 “23:00에 끝났어요” 로 바뀜(별도 타이머 없이 주기 다시 읽기로)',
  b6before[0] === 63 && b6before[1] === 63 && viaVisible && viaPoll && !ba1.errors.length && !ba2.errors.length,
  JSON.stringify([b6before, viaVisible, viaPoll, text(ba2.p.d.getElementById('lv-pin')).slice(0, 80)]));
closeAll(ba1, ba2);
T = await at('2026-10-25T15:00:00');

// ══ W 쓰기 · 말 · 용어 ═════════════════════════════════════════════════
section = 'W 쓰기 · 말 · 용어';
ba = await readBoothAdmin(T); pq = await readPrintPin(T); const ad = await readAdmin(T);
const WRITE = /^admin_(issue|rotate|disable|set_booth_live|reset_booth_live|rehearsal_set_live)/;
const writes = [...ba.calls, ...pq.calls, ...ad.calls].filter(c => WRITE.test(c.name) && c.args.p_booth_id !== null);
t('W1 세 화면을 열고 읽기만 — 발급 · 끄기 · 열쇠 · 대기 값 쓰기 호출 없음(조건부 발급 함수 점검용 빈 호출 제외)', writes.length === 0, JSON.stringify(writes.slice(0, 3)));
const bodies = [ba.body, pq.body, ad.body];
const adminSrc = readFileSync(join(MAIN, 'assets/admin.js'), 'utf8');
t('W2 ‘로그인 중’ · ‘지금 PIN 로그인’ 같은 말 없음 — 세션 수는 “유효한 PIN 세션 N개”(운영 현황 상세 · 관리자 부스 관리 글)',
  bodies.every(b => !/로그인 중|지금 PIN 로그인|PIN 로그인 \d+대/.test(b)) && /유효한 PIN 세션 1개/.test(await detailOf(ba.p, idOf('R3-01'))) &&
  !/지금 PIN 로그인|'PIN 로그인 ' \+/.test(adminSrc) && (adminSrc.match(/유효한 PIN 세션 /g) || []).length === 2,
  bodies.map(b => (b.match(/로그인 중|지금 PIN 로그인|PIN 로그인 \d+대/) || [''])[0]).join('|'));
const bare = b => b.match(/(?<!개별 )PIN (발급됨|미발급|꺼짐)/g) || [];
t('W3 용어 — 세 화면의 상태 표시는 ‘개별 PIN 발급됨 · 미발급 · 꺼짐’(앞에 ‘개별’ 없는 상태 낱말 없음) · 관리자 부스 관리에도 ‘개별 PIN 미발급’',
  bodies.every(b => bare(b).length === 0) && /개별 PIN (미발급|발급됨)/.test(ad.body) && !/['"]PIN (발급됨|미발급|꺼짐)/.test(adminSrc),
  bodies.map(b => bare(b).slice(0, 2).join(',')).join(' | ') + ' | 관리자 ' + (ad.body.match(/.{20}개별 PIN.{10}/) || [''])[0]);
t('W4 화면 오류 없음(세 화면 · 모든 상황)', ![ba, pq, ad].some(x => x.errors.length), [ba, pq, ad].flatMap(x => x.errors).join(' | '));
closeAll(ba, pq, ad);
const dba = await readBoothAdmin(0, undefined, '?demo=1'), dpq = await openPage({ JSDOM, VirtualConsole, dir: MAIN, file: 'print-qr.html', R, rest, query: '?demo=1' });
await until(() => dpq.d.querySelectorAll('#grid-ops .item--ops').length > 0, 20000); await wait(200);
const dad = await readAdmin(0);
t('W5 협의용 예시(?demo) 세 화면 — 오류 없음 · 리허설 공통 PIN 요약은 그리지 않음(예시에는 리허설 없음)',
  !dba.errors.length && !dpq.errors.length && !dad.errors.length && !text(dba.p.d.getElementById('lv-pin')), [...dba.errors, ...dpq.errors, ...dad.errors].join(' | '));
closeAll(dba, dad); try { dpq.dom.window.close(); } catch { /* 없음 */ }
await clock.restore();
t('W6 시험이 바꾼 DB 함수 없음 — 시험 시계를 걷어 낸 뒤 복제 DB 함수 전체 지문 = 시험 전(이 PR 은 SQL 을 바꾸지 않음)', (await fnFp()) === fn0);

// 참고: 화면이 볼 수 없는 경우(개별 PIN 줄을 SQL 로 직접 지움 · 발급 기록은 남음) — 서버는 닫힘, 화면은 사용 가능으로 봄
await db.query('delete from public.booth_pin where booth_id = $1', [idOf('R1-05')]);
const srvRef = await serverOpen();
ba = await readBoothAdmin(Date.now());
notes.push(`참고(알려진 차이): R1-05 개별 PIN 줄을 SQL 로 직접 지우면 서버는 발급 기록 때문에 닫힘(${srvRef.includes(idOf('R1-05')) ? '열림?' : '닫힘'}) · 화면은 ‘사용 가능’ 으로 셈(${ba.open}곳). 앱의 발급 · 끄기 · 재발급으로는 생기지 않는 경우입니다.`);
closeAll(ba);

const passed = results.filter(x => x.ok).length;
mkdirSync(resolve(OUT, 'rehearsal'), { recursive: true });
const md = ['# 리허설 공통 PIN · 개별 PIN 표시 시험(A-4)', '',
  `- 실행: ${new Date().toISOString()} · 결과 **${passed} / ${results.length} 통과**`,
  `- 화면: ${MAIN.replace(/\\/g, '/')} (${git('rev-parse', '--abbrev-ref', 'HEAD')} @ ${git('rev-parse', '--short', 'HEAD')}) · 복제 DB = 지금 Production 단계 · 시험 시계는 리허설 공통 PIN 판정 함수에만`,
  '- 서버 판정 = PIN 보조 로그인 스위치 · private.booth_common_pin_target(부스). 열쇠 · PIN 은 가짜 값이며 적지 않습니다.', '',
  '| 묶음 | 결과 | 시험 | 메모 |', '|---|---|---|---|',
  ...results.map(x => `| ${x.section} | ${x.ok ? '통과' : '**실패**'} | ${x.name.replace(/\|/g, '/')} | ${(x.note || '').replace(/\|/g, '/')} |`), '',
  ...notes.map(n => '- ' + n), ''].join('\n');
writeFileSync(resolve(OUT, 'rehearsal', 'pin-status-test-report.md'), md);
console.log(notes.join('\n'));
console.log(`\n${passed} / ${results.length} 통과 → out/rehearsal/pin-status-test-report.md`);
process.exit(passed === results.length ? 0 : 1);
