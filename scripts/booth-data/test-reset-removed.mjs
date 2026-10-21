/* ===================================================================
   ‘실시간 값 모두 지우기’ 제거 시험(A-1) — 인쇄 화면에서 단추 · 확인 칸 · 처리 코드를 뺀 뒤에도 인쇄 · PIN 관리가 그대로인지
   ───────────────────────────────────────────────────────────────────
   새 판(--main-dir) · 예전 판(--old-ref, 기본 6a34872 = 단추가 있던 Production main)을 복제 DB(지금 Production 단계)에서 견줍니다.
     D1 화면 · 코드에서 사라짐(단추 · 확인 칸 · 알림 줄 · 처리 함수 · 단추만 쓰던 관리자 표시) · 어느 화면도 전체 지우기 함수를 부르지 않음
     D2 인쇄 화면 그대로 — 머리 단추(구역별 새 페이지 · 인쇄 화면으로 보기 · 인쇄하기) · 실제 84장 · 탭 · PIN 관리 · 실제 부스 선택 · 오류 없음
     D3 남는 길 — 리허설 대기시간 비우기(실제 부스 · 행사 첫날 전) 로 실제 부스 값만 비워짐 · 23:00 자동 초기화 표시 · 부스별 ‘값 지우기’
     D4 DB 그대로 — admin_reset_booth_live · rehearsal_live_reset 함수 지문 = Production · 문서
   ⚠️ 네트워크 · Production 접속 없음. 열쇠 · PIN 은 가짜 값이고 출력하지 않습니다.
   쓰는 법: node --max-old-space-size=8192 scripts/booth-data/test-reset-removed.mjs --pglite-dir <> --jsdom-dir <> --main-dir <main 작업 폴더> [--old-ref 6a34872]
   결과: out/gate3c/reset-removed-test-report.md
   =================================================================== */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readCsv } from './lib/csv.mjs';
import { loadPglite, ADMIN } from './lib/replica.mjs';
import { prepReplica, openPage, until, wait, text, click, visibleText } from './lib/ui-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT = resolve(HERE, 'out');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const MAIN = resolve(arg('main-dir', REPO));
const OLD_REF = arg('old-ref', '6a34872');
const { JSDOM, VirtualConsole } = createRequire(join(resolve(arg('jsdom-dir')), 'package.json'))('jsdom');
const lib = await loadPglite(arg('pglite-dir'));
const manifest = readCsv(resolve(OUT, 'staging', 'manifest.csv'));
const plan = readCsv(resolve(OUT, 'gate4r', 'plan-R.csv'));
const snap = readCsv(resolve(OUT, readdirSync(OUT).filter(f => /^prod-snapshot-\d{8}\.csv$/.test(f)).sort().pop()));
const REAL = plan.map(p => p['부스ID']);
const EX = snap.map(s => s.id);
const git = (...a) => execFileSync('git', ['-C', MAIN, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });

const results = [];
let section = '';
function t(name, ok, note = '') { results.push({ section, name, ok: !!ok, note: ok ? '' : String(note).slice(0, 400) }); console.log(`${ok ? '통과' : '실패'}  ${name}${note && !ok ? '  — ' + String(note).slice(0, 400) : ''}`); }

// 예전 판 파일(print-qr · assets)을 임시 폴더에 꺼내 같은 방법으로 엽니다.
const OLD_DIR = mkdtempSync(join(tmpdir(), 'reset-old-'));
mkdirSync(join(OLD_DIR, 'assets'), { recursive: true });
for (const f of ['print-qr.html', 'assets/config.js', 'assets/core.js', 'assets/booth-core.js', 'assets/mock-data.js']) writeFileSync(join(OLD_DIR, f), git('show', `${OLD_REF}:${f}`));

const { R, db, rest } = await prepReplica({ lib, snap, manifest, here: HERE, repo: REPO, mainDir: MAIN });
const q1 = async (sql, p) => (await db.query(sql, p)).rows[0];
const liveN = async ids => +(await q1('select count(*) n from public.booth_live where booth_id = any($1::uuid[])', [ids])).n;

// ══ D1 사라진 것 ═══════════════════════════════════════════════════════
section = 'D1 사라진 것';
const pq = readFileSync(join(MAIN, 'print-qr.html'), 'utf8');
const pqOld = readFileSync(join(OLD_DIR, 'print-qr.html'), 'utf8');
const GONE = /id="reset-(btn|confirm|yes|no|msg)"|실시간 값 모두 지우기|function resetLive|\$\('reset-/;
t('D1-1 인쇄 화면 — 단추 · 확인 칸(“모두 지우기” · “그만두기”) · 알림 줄 · 처리 함수가 없음(예전 판에는 있음)', !GONE.test(pq) && GONE.test(pqOld));
t('D1-2 단추만 쓰던 코드도 없음 — 관리자 표시(setAdmin · checkAdmin · S.isAdmin) · 알림 줄 모양(tb__msg)', !/setAdmin|checkAdmin|S\.isAdmin|isAdmin: false|tb__msg/.test(pq) && /setAdmin/.test(pqOld));
const uiFiles = ['print-qr.html', 'booth-admin.html', 'admin.html', 'index.html', ...readdirSync(join(MAIN, 'assets')).filter(f => f.endsWith('.js')).map(f => 'assets/' + f)];
const callers = uiFiles.filter(f => { try { return /rpc\(\s*['"]admin_reset_booth_live['"]/.test(readFileSync(join(MAIN, f), 'utf8')); } catch { return false; } });
t(`D1-3 어느 화면 파일(${uiFiles.length}개)도 전체 지우기 함수(admin_reset_booth_live)를 부르지 않음(예전 인쇄 화면은 불렀음)`, callers.length === 0 && /rpc\('admin_reset_booth_live'\)/.test(pqOld), callers.join(','));

// ══ D2 인쇄 · PIN 관리 그대로 ═══════════════════════════════════════════
section = 'D2 인쇄 · PIN 관리';
async function openPrint(dir) {
  const p = await openPage({ JSDOM, VirtualConsole, dir, file: 'print-qr.html', R, rest });
  await until(() => p.d.querySelectorAll('#grid-ops .item--ops').length >= 134 && p.calls.some(c => c.name === 'admin_booth_access'), 30000);
  await wait(400);
  return p;
}
const N = await openPrint(MAIN), O = await openPrint(OLD_DIR);
const acts = p => [...p.d.querySelectorAll('.tb__acts > *')].map(el => el.id || (el.querySelector('input') || {}).id || el.tagName).join(',');
t('D2-1 머리 단추 = 구역별로 새 페이지 · 인쇄 화면으로 보기 · 인쇄하기 · ‘지우기’ 글 없음(예전 판은 관리자에게 빨간 ‘실시간 값 모두 지우기’ 가 보였음)',
  acts(N) === 'opt-zonebreak,opt-printview,print-btn' && !/지우기/.test(text(N.d.querySelector('.tb__acts'))) && !N.d.querySelector('[id^="reset-"]') &&
  !!O.d.getElementById('reset-btn') && !O.d.getElementById('reset-btn').hidden, `${acts(N)} | 예전 ${acts(O)} hidden=${O.d.getElementById('reset-btn') && O.d.getElementById('reset-btn').hidden}`);
t('D2-2 인쇄하기(84장) · 수 줄 그대로 — 예전 판과 같은 글', text(N.d.getElementById('print-btn')) === '인쇄하기 (84장)' && text(N.d.getElementById('count-ops')) === text(O.d.getElementById('count-ops')),
  `${text(N.d.getElementById('print-btn'))} | ${text(N.d.getElementById('count-ops'))}`);
const tabsOk = [];
for (const k of ['signs', 'poster', 'ops']) { click(N.w, N.d.getElementById('tab-' + k)); await wait(60); tabsOk.push(N.d.getElementById('tab-' + k).getAttribute('aria-selected') === 'true' && !N.d.getElementById('panel-' + k).hidden); }
const pv = N.d.getElementById('opt-printview'); pv.checked = true; pv.dispatchEvent(new N.w.Event('change', { bubbles: true })); await wait(40);
const pvOn = N.d.body.classList.contains('is-printview'); pv.checked = false; pv.dispatchEvent(new N.w.Event('change', { bubbles: true }));
t('D2-3 탭 ②③① 바꾸기 · 인쇄 화면으로 보기 켜고 끄기 그대로', tabsOk.every(Boolean) && pvOn, JSON.stringify(tabsOk));
click(N.w, N.d.getElementById('pinx-toggle'));
await until(() => !N.d.getElementById('pinx-main').hidden && N.d.querySelectorAll('#pinx-list .prow').length > 0, 20000); await wait(100);
click(N.w, N.d.getElementById('pinx-real')); await wait(80);
const sel = [...N.d.querySelectorAll('#pinx-list input[data-pid]:checked')].map(x => x.getAttribute('data-pid'));
t('D2-4 PIN 관리 그대로 — 목록 134줄 · ‘실제 부스 84곳 선택’ → 84곳(예시 0) · “선택 PIN 발급 (84곳)”',
  N.d.querySelectorAll('#pinx-list .prow').length === 134 && sel.length === 84 && sel.every(id => REAL.includes(id)) && text(N.d.getElementById('pinx-issue')) === '선택 PIN 발급 (84곳)',
  `${sel.length} ${text(N.d.getElementById('pinx-issue'))}`);
t('D2-5 화면을 쓰는 동안 전체 지우기 · 발급 · 끄기 호출 없음 · 오류 없음(두 판)',
  !N.calls.some(c => /admin_reset_booth_live|admin_issue_booth_pin$|admin_disable/.test(c.name) || (c.name === 'admin_issue_booth_pin_checked' && c.args.p_booth_id !== null)) &&
  !N.errors.length && !O.errors.length, [...N.errors, ...O.errors].join(' | '));
N.dom.window.close(); O.dom.window.close();

// ══ D3 남는 길 ═══════════════════════════════════════════════════════════
section = 'D3 남는 길';
// 실제 3곳 · 예시 2곳에 지금 값을 넣어 둠(복제 DB · 관리자 함수)
await db.exec(`set test.uid = '${ADMIN}'`);
for (const id of [...REAL.slice(0, 3), ...EX.slice(0, 2)]) await db.query("select * from public.admin_set_booth_live($1, 'open', 15)", [id]);
await db.exec("set test.uid = ''");
const exBefore = await liveN(EX);
const A = await openPage({ JSDOM, VirtualConsole, dir: MAIN, file: 'booth-admin.html', R, rest });
await until(() => A.d.querySelectorAll('#lv-list .lv').length > 0, 25000);
click(A.w, A.d.querySelector('[data-rh-toggle]'));
await until(() => !A.d.getElementById('lv-rh').hidden && !/확인하는 중/.test(text(A.d.getElementById('lv-rh'))), 15000); await wait(80);
const panelTxt = text(A.d.getElementById('lv-rh'));
t('D3-1 부스 운영 현황 › 리허설 관리 — ‘대기시간 자동 채우기’ · ‘리허설 대기시간 비우기’ 그대로 · 실제 부스 84곳 · 자동 초기화(23:00) 표시 · ‘모두 지우기’ 없음',
  /대기시간 자동 채우기/.test(panelTxt) && /리허설 대기시간 비우기/.test(panelTxt) && /실제 부스 84곳/.test(panelTxt) && /23:00/.test(panelTxt) && !/모두 지우기|실시간 값/.test(panelTxt), panelTxt.slice(0, 200));
click(A.w, A.d.querySelector('[data-rh="clear"]'));
await until(() => !!A.d.getElementById('modal-ok'), 10000);
click(A.w, A.d.getElementById('modal-ok'));
await until(() => /비웠습니다|실패 \d+곳|닫혔습니다/.test(text(A.d.getElementById('lv-rh'))) && !A.d.querySelector('.rhprog'), 40000); await wait(100);
t('D3-2 ‘리허설 대기시간 비우기’ 실행(복제 DB) → 실제 부스 지금 값 0 · 예시 부스 값은 그대로(전체 지우기와 다름)',
  (await liveN(REAL)) === 0 && (await liveN(EX)) === exBefore && exBefore >= 2 && !A.errors.length, `${await liveN(REAL)} ${await liveN(EX)}/${exBefore} ${A.errors.join('|')}`);
A.dom.window.close();
const ba = readFileSync(join(MAIN, 'assets/booth-admin.js'), 'utf8');
t('D3-3 부스 하나 지우기(현황 수정 창 ‘값 지우기’ → admin_set_booth_live clear)는 그대로 있음', /data-mode="clear"|'clear'/.test(ba) && /admin_set_booth_live/.test(ba));

// ══ D4 DB · 문서 ════════════════════════════════════════════════════════
section = 'D4 DB · 문서';
const fp = async f => (await q1(`select left(md5(replace(pg_get_functiondef('${f}'::regprocedure), E'\\r', '')), 8) f`)).f;
t('D4-1 DB 함수 그대로 — admin_reset_booth_live 5f6ed44f · private.rehearsal_live_reset 007166b2(Production 10-20 지문과 같음) · SQL 파일 바뀜 없음',
  (await fp('public.admin_reset_booth_live()')) === '5f6ed44f' && (await fp('private.rehearsal_live_reset()')) === '007166b2' &&
  git('diff', '--stat', OLD_REF, '--', 'supabase').trim() === '', `${await fp('public.admin_reset_booth_live()')} ${await fp('private.rehearsal_live_reset()')}`);
const readme = readFileSync(join(MAIN, 'README.md'), 'utf8');
t('D4-2 README — 인쇄 화면 단추를 누르라는 안내 없음 · 리허설 대기시간 비우기 · 23:00 자동 초기화 · 뺀 까닭과 날짜가 적힘',
  !/인쇄 화면의 \*\*‘실시간 값 모두 지우기’\*\*/.test(readme) && /리허설 대기시간 비우기/.test(readme) && /23:00\(KST\) 자동 초기화/.test(readme) && /2026-10-21/.test(readme));
t('D4-3 README 설명이 정확함 — ‘단추만’ 뺐고 DB 함수 · 실행 권한은 그대로(관리자 계정은 RPC · SQL Editor 로 지금도 부를 수 있음 · anon 은 못 부름) · “SQL Editor 에서만” 같은 말 없음',
  /\*\*인쇄 화면의 단추만\*\* 뺐습니다/.test(readme) && /\*\*DB 함수와 실행 권한은 그대로입니다\*\*/.test(readme) && /RPC `admin_reset_booth_live`/.test(readme) &&
  /익명 `anon` 은 부를 수 없음/.test(readme) && /DB 함수와 관리자 RPC 실행 권한은 그대로/.test(readme) && !/SQL Editor 에서 상황을 확인한 뒤 실행합니다/.test(readme));
// README 가 말하는 권한이 실제와 같은지(복제 DB = Production 권한 · 함수 본문 지문 같음) — 함수 · 권한은 바꾸지 않음
const priv = await q1(`select has_function_privilege('authenticated', 'public.admin_reset_booth_live()', 'EXECUTE') a,
  has_function_privilege('anon', 'public.admin_reset_booth_live()', 'EXECUTE') n`);
let anonErr = null;
try { await R.asAnon('select public.admin_reset_booth_live() n'); } catch (e) { anonErr = e.code; }
let notAdminErr = null;
try { await db.exec("set test.uid = '00000000-0000-4000-8000-0000000000aa'"); await db.query('select public.admin_reset_booth_live() n'); } catch (e) { notAdminErr = e.code; } finally { await db.exec("set test.uid = ''"); }
const liveBefore = +(await q1('select count(*) n from public.booth_live')).n;
await db.exec(`set test.uid = '${ADMIN}'`);
const delN = +(await q1('select public.admin_reset_booth_live() n')).n;
await db.exec("set test.uid = ''");
const liveAfter = +(await q1('select count(*) n from public.booth_live')).n;
t('D4-4 (복제 DB에서만) 권한 그대로 — authenticated 실행 가능 · anon 실행 불가(42501) · 관리자가 아닌 로그인 계정 거절(42501) · 관리자 RPC 로는 지금도 전체 지움(단추가 없어도 함수는 살아 있음)',
  priv.a === true && priv.n === false && anonErr === '42501' && notAdminErr === '42501' && delN === liveBefore && liveBefore > 0 && liveAfter === 0,
  JSON.stringify({ priv, anonErr, notAdminErr, liveBefore, delN, liveAfter }));

rmSync(OLD_DIR, { recursive: true, force: true });
const passed = results.filter(x => x.ok).length;
mkdirSync(resolve(OUT, 'gate3c'), { recursive: true });
writeFileSync(resolve(OUT, 'gate3c', 'reset-removed-test-report.md'), ['# ‘실시간 값 모두 지우기’ 제거 시험(A-1)', '',
  `- 실행: ${new Date().toISOString()} · 결과 **${passed} / ${results.length} 통과**`,
  `- 새 판: ${MAIN.replace(/\\/g, '/')} · 예전 판: ${OLD_REF} · 복제 DB = 지금 Production 단계 · 네트워크 없음`, '',
  '| 묶음 | 결과 | 시험 | 메모 |', '|---|---|---|---|',
  ...results.map(x => `| ${x.section} | ${x.ok ? '통과' : '**실패**'} | ${x.name.replace(/\|/g, '/')} | ${(x.note || '').replace(/\|/g, '/')} |`), ''].join('\n'));
console.log(`\n${passed} / ${results.length} 통과 → out/gate3c/reset-removed-test-report.md`);
process.exit(passed === results.length ? 0 : 1);
