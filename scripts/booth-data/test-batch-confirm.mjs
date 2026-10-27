/* ===================================================================
   '확인 필요' 관리자 일괄 확인 시험 — migration-booth-live-check.sql · 관리자 화면(booth-admin)
   ───────────────────────────────────────────────────────────────────
   복제 DB(지금 Production 단계, lib/ui-harness prepReplica)에 --main-dir 의 적용 · 되돌리기 SQL 을 얹어 봅니다.
     S  설치 — 두 번 적용 · 확인 표 · 기존 함수 지문 · booth_live / booth_live_log 그대로
     A  권한 — anon 실행 불가 · 관리자 아닌 로그인 거절 · 표 직접 읽기/쓰기 불가 · 관리자만
     B  판정 — confirmed · fresh · closed · no_value · not_found · duplicate · 형식 오류 · 기록 내용(누가 · 무엇 · 언제)
     C  동시 입력 · 중복 — 미리보기 뒤 운영자(QR · 공통 PIN) 입력 · 관리자 수정 → changed, 확인 뒤 입력 → 확인 풀림,
        같은 요청 두 번 · 다른 관리자 → checked, 30분 지난 뒤 다시 확인, 한 부스 실패가 나머지를 막지 않음
     D  날짜 · 23:00 — 어제 값 → not_today · 어제 확인은 오늘 안 붙음 · 23:00 초기화 뒤 → no_value(기록은 남음)
     E  운영 기록 그대로 — 모든 관리자 확인 호출 앞뒤 booth_live · booth_live_log 지문 같음, 함수 정의에 쓰기 없음 · FOR UPDATE
     F  화면 — 함수 없으면 '준비 중' · 있으면 [일괄 확인] → 처음엔 아무것도 안 고름 · 미리보기 · 결과(확인 완료 · 제외 · 실패)
        · '확인 필요' 표시 · 수는 그대로 + '관리자 확인 HH:MM' 따로 · 화면이 부르는 함수는 두 개뿐
     R  되돌리기 — 두 번 실행 · 함수만 사라지고 기록 표 남음 · 화면 '준비 중' 복귀 · 다시 적용하면 이어 씀
   ⚠️ 한 연결(PGlite)이라 두 요청이 같은 순간에 잠금을 다투는 경우는 여기서 못 봅니다 — 차례를 바꿔 두 순서를 모두 봅니다.
      실제 동시 잠금(FOR UPDATE vs FOR SHARE · 대기 · lock_timeout · 교착)은 test-batch-confirm-locks.mjs(실제 PostgreSQL)에서.
   ⚠️ 네트워크 · Production 접속 없음. 열쇠 · PIN 은 복제 DB 의 가짜 값이고 출력하지 않습니다.
   쓰는 법: node --max-old-space-size=8192 scripts/booth-data/test-batch-confirm.mjs --pglite-dir <> --jsdom-dir <> --main-dir <브랜치 작업 폴더>
   결과: out/rehearsal/batch-confirm-test-report.md
   =================================================================== */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readCsv } from './lib/csv.mjs';
import { loadPglite, ADMIN } from './lib/replica.mjs';
import { prepReplica, openPage, until, wait, text, click } from './lib/ui-harness.mjs';

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
const MIG = readFileSync(join(MAIN, 'supabase/migration-booth-live-check.sql'), 'utf8');
const RB = readFileSync(join(MAIN, 'supabase/rollback-booth-live-check.sql'), 'utf8');
const ADMIN2 = '00000000-0000-4000-8000-00000000a002';
const STAFF = '00000000-0000-4000-8000-00000000a0aa';

const results = [];
let section = '';
function t(name, ok, note = '') { results.push({ section, name, ok: !!ok, note: ok ? '' : String(note).slice(0, 500) }); console.log(`${ok ? '통과' : '실패'}  ${name}${note && !ok ? '  — ' + String(note).slice(0, 500) : ''}`); }

const { R, db, rest } = await prepReplica({ lib, snap, manifest, here: HERE, repo: REPO, mainDir: MAIN });
const q1 = async (sql, p) => (await db.query(sql, p)).rows[0];
const qa = async (sql, p) => (await db.query(sql, p)).rows;
// 자정 직후에는 '30분 넘은 오늘 값' 을 만들 수 없습니다(어제 값이 됨).
const kstMin = +(await q1("select (extract(hour from now() at time zone 'Asia/Seoul') * 60 + extract(minute from now() at time zone 'Asia/Seoul'))::int m")).m;
if (kstMin < 75) { console.error('KST 00:00~01:15 에는 이 시험을 돌리지 마세요(30분 넘은 오늘 값을 만들 수 없음).'); process.exit(2); }

// 한 트랜잭션 안에서만 로그인 표시(test.uid)와 역할을 바꿉니다 — 다른 쿼리에 새지 않게.
async function as(uid, sql, p, role) {
  try {
    return { ok: true, rows: await db.transaction(async tx => {
      if (uid) await tx.query("select set_config('test.uid', $1, true)", [uid]);
      if (role) await tx.exec(`set local role ${role}`);
      return (await tx.query(sql, p)).rows;
    }) };
  } catch (e) { return { ok: false, code: e.code, message: e.message }; }
}
const confirmAs = (uid, items, role) => as(uid, 'select * from public.admin_confirm_booth_live($1::jsonb)', [JSON.stringify(items)], role);
const checksAs = (uid, role) => as(uid, 'select * from public.admin_booth_live_checks()', [], role);
const byCode = rows => Object.fromEntries((rows || []).map(r => [codeOf(r.booth_id), r]));
// 운영 기록 지문 — booth_live 는 시각까지, booth_live_log 는 줄 전체
const liveFp = async () => (await q1(`select md5(coalesce(string_agg(row(l.*)::text, ',' order by l.booth_id), '')) a,
  (select md5(coalesce(string_agg(row(g.*)::text, ',' order by g.id), '')) from public.booth_live_log g) b from public.booth_live l`));
const sameFp = (x, y) => x.a === y.a && x.b === y.b;
// 함수 지문(새 두 함수 빼고) — 기존 함수가 하나도 안 바뀌었는지
const fnFp = async () => (await q1(`select md5(string_agg(n.nspname || '.' || p.proname || md5(pg_get_functiondef(p.oid)), ',' order by n.nspname, p.proname, p.oid)) h, count(*) n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private', 'auth') and p.prokind = 'f' and p.proname not in ('admin_confirm_booth_live', 'admin_booth_live_checks')`));
// 값 넣기(시험 준비 — 복제 DB 에서 직접). ago = 몇 분 전 입력.
// 밀리초로 자릅니다 — 화면 시험의 가짜 Supabase 는 시각을 JS Date(밀리초)로 넘기기 때문(실제 PostgREST 는 마이크로초까지 그대로 넘김).
async function setLive(code, cong, wait, ago) {
  await db.query(`insert into public.booth_live (booth_id, congestion, wait_minutes, updated_at) values ($1, $2, $3, date_trunc('milliseconds', now() - make_interval(mins => $4)))
    on conflict (booth_id) do update set congestion = excluded.congestion, wait_minutes = excluded.wait_minutes, updated_at = excluded.updated_at`, [idOf(code), cong, wait, ago]);
}
const atOf = async code => (await q1('select updated_at::text t from public.booth_live where booth_id = $1', [idOf(code)]) || {}).t || null;
const item = async code => ({ booth_id: idOf(code), seen_updated_at: await atOf(code) });
const checkN = async code => +(await q1('select count(*) n from public.booth_live_check where booth_id = $1', [idOf(code)])).n;

// ══ S 설치 ══════════════════════════════════════════════════════════════
section = 'S 설치';
await db.query("insert into public.staff_profiles (id, role, name) values ($1, 'admin', '두번째 관리자'), ($2, 'staff', '일반 직원') on conflict do nothing", [ADMIN2, STAFF]);
await db.query("update public.staff_profiles set name = '시험 관리자' where id = $1", [ADMIN]);
// 지금 Production 처럼 값이 좀 있는 상태
await db.exec('delete from public.booth_live where booth_id = any(array[' + REAL.map(x => `'${x}'`).join(',') + ']::uuid[])');
const fn0 = await fnFp(), live0 = await liveFp();
const m1 = await R.run(MIG);
const m2 = await R.run(MIG);
const conf = await qa(MIG.slice(MIG.lastIndexOf('select v."항목"')));
t('S1 적용 SQL 두 번 실행 — 둘 다 성공(여러 번 실행해도 안전)', m1.ok && m2.ok, (m1.error || '') + ' ' + (m2.error || ''));
t(`S2 확인 표 ${conf.length}줄 모두 기대 = 실제`, conf.length === 10 && conf.every(r => r['맞음'] === true), JSON.stringify(conf.filter(r => !r['맞음'])));
const fn1 = await fnFp(), live1 = await liveFp();
t(`S3 기존 함수 ${fn0.n}개 정의 그대로(지문 같음) · 새 함수는 두 개만`, fn0.h === fn1.h && fn0.n === fn1.n &&
  +(await q1("select count(*) n from pg_proc where proname in ('admin_confirm_booth_live', 'admin_booth_live_checks')")).n === 2, JSON.stringify({ fn0, fn1 }));
t('S4 적용해도 booth_live · booth_live_log 그대로(줄 · 값 · 시각)', sameFp(live0, live1), JSON.stringify({ live0, live1 }));
const tdef = await qa(`select column_name c, data_type d, is_nullable n from information_schema.columns where table_schema = 'public' and table_name = 'booth_live_check' order by ordinal_position`);
t('S5 기록 표 칸 = id · batch_id · booth_id · booth_code · booth_name · seen_updated_at · seen_congestion · seen_wait · checked_by · checked_at(모두 not null) · 외래 키 없음',
  tdef.map(r => r.c).join(',') === 'id,batch_id,booth_id,booth_code,booth_name,seen_updated_at,seen_congestion,seen_wait,checked_by,checked_at' && tdef.every(r => r.n === 'NO') &&
  +(await q1("select count(*) n from pg_constraint where conrelid = 'public.booth_live_check'::regclass and contype = 'f'")).n === 0, JSON.stringify(tdef));

// ══ A 권한 ══════════════════════════════════════════════════════════════
section = 'A 권한';
await setLive('R1-01', '보통', 20, 45);
const A1 = await confirmAs(null, [await item('R1-01')], 'anon');
const A2 = await as(null, 'select * from public.admin_booth_live_checks()', [], 'anon');
t('A1 anon(로그인 안 함) — 두 함수 모두 실행 권한 없음(42501)', !A1.ok && A1.code === '42501' && !A2.ok && A2.code === '42501', JSON.stringify([A1, A2]));
const A3 = await confirmAs(STAFF, [await item('R1-01')], 'authenticated');
const A4 = await checksAs(STAFF, 'authenticated');
const A5 = await confirmAs(null, [await item('R1-01')], 'authenticated');
t('A2 로그인했지만 관리자 아님(staff) · 로그인 표시 없음 — 거절(42501 · 관리자만)', !A3.ok && A3.code === '42501' && /관리자만/.test(A3.message) &&
  !A4.ok && A4.code === '42501' && !A5.ok && A5.code === '42501', JSON.stringify([A3, A4, A5]));
const A6 = await as(ADMIN, 'select count(*) n from public.booth_live_check', [], 'authenticated');
const A7 = await as(ADMIN, "insert into public.booth_live_check (batch_id, booth_id, seen_updated_at, seen_congestion, seen_wait, checked_by) values (gen_random_uuid(), $1, now(), '보통', 1, $2)", [idOf('R1-01'), ADMIN], 'authenticated');
const A8 = await as(null, 'select count(*) n from public.booth_live_check', [], 'anon');
t('A3 기록 표 직접 읽기 · 쓰기 — 관리자 로그인(authenticated)도 · anon 도 불가(함수로만)', !A6.ok && A6.code === '42501' && !A7.ok && A7.code === '42501' && !A8.ok && A8.code === '42501',
  JSON.stringify([A6, A7, A8].map(x => x.code || x.rows)));
const A9 = await confirmAs(ADMIN, [await item('R1-01')], 'authenticated');
t('A4 관리자(authenticated 역할 + staff_profiles admin) — 실행됨 · confirmed', A9.ok && A9.rows.length === 1 && A9.rows[0].status === 'confirmed', JSON.stringify(A9));
await db.exec('delete from public.booth_live_check');

// ══ B 판정 ══════════════════════════════════════════════════════════════
section = 'B 판정';
await setLive('R1-02', '혼잡', 45, 50);     // 확인 필요(운영 중)
await setLive('R1-03', '중단', 0, 40);      // 확인 필요(중단)
await setLive('R1-04', '여유', 5, 10);      // 최근 입력
await setLive('R1-05', '마감', 0, 90);      // 마감
await db.query('delete from public.booth_live where booth_id = $1', [idOf('R1-06')]);   // 미입력
const fpB = await liveFp();
const it2 = await item('R1-02');
const B = await confirmAs(ADMIN, [it2, await item('R1-03'), await item('R1-04'), await item('R1-05'),
  { booth_id: idOf('R1-06'), seen_updated_at: '2026-10-27T10:00:00+09:00' }, { booth_id: '00000000-0000-4000-8000-0000000fffff', seen_updated_at: it2.seen_updated_at }, it2]);
const b = byCode(B.rows);
const bStat = B.ok ? B.rows.map(r => codeOf(r.booth_id) + ':' + r.status).join(' ') : B.message;
t('B1 결과는 부스마다 한 줄(같은 부스 두 번 → 두 줄) · 같은 묶음 id', B.ok && B.rows.length === 7 && new Set(B.rows.map(r => r.batch_id)).size === 1, bStat);
t('B2 30분 넘은 운영 중 · 중단 → confirmed', b['R1-02'] && B.rows.filter(r => codeOf(r.booth_id) === 'R1-02').map(r => r.status).join() === 'confirmed,skipped:duplicate' &&
  b['R1-03'].status === 'confirmed', bStat);
t('B3 최근 입력 → skipped:fresh · 마감 → skipped:closed · 미입력 → skipped:no_value · 없는 부스 → skipped:not_found',
  b['R1-04'].status === 'skipped:fresh' && b['R1-05'].status === 'skipped:closed' && b['R1-06'].status === 'skipped:no_value' &&
  B.rows.some(r => r.booth_id === '00000000-0000-4000-8000-0000000fffff' && r.status === 'skipped:not_found'), bStat);
t('B4 같은 요청 안의 같은 부스는 처음 것만 처리(두 번째 = skipped:duplicate) · 기록 1줄', B.rows.filter(r => r.status === 'skipped:duplicate').length === 1 && (await checkN('R1-02')) === 1, bStat);
const rec = await q1('select * from public.booth_live_check where booth_id = $1', [idOf('R1-02')]);
const l2 = await q1('select * from public.booth_live where booth_id = $1', [idOf('R1-02')]);
t('B5 기록 = 확인한 값(혼잡 45분 · 그 입력 시각) · 그때의 부스번호 · 이름 · 확인한 관리자 id · 확인 시각(지금) · 묶음 id',
  rec && rec.booth_code === 'R1-02' && rec.booth_name.length > 0 && rec.seen_congestion === '혼잡' && rec.seen_wait === 45 && +rec.seen_updated_at === +l2.updated_at && rec.checked_by === ADMIN &&
  Math.abs(Date.now() - +rec.checked_at) < 60000 && rec.batch_id === B.rows[0].batch_id, JSON.stringify(rec));
t('B6 판정 내내 booth_live · booth_live_log 그대로(값 · updated_at · 기록 줄)', sameFp(fpB, await liveFp()));
const bad = [];
for (const [label, v] of [['빈 배열', []], ['배열 아님', { booth_id: idOf('R1-02') }], ['101곳', Array.from({ length: 101 }, () => it2)], ['booth_id 없음', [{ seen_updated_at: it2.seen_updated_at }]],
  ['시각 없음', [{ booth_id: idOf('R1-02') }]], ['uuid 아님', [{ booth_id: 'R1-02', seen_updated_at: it2.seen_updated_at }]], ['시각 형식 틀림', [{ booth_id: idOf('R1-02'), seen_updated_at: '어제' }]],
  ['숫자 시각', [{ booth_id: idOf('R1-02'), seen_updated_at: 12345 }]]]) {
  const r = await confirmAs(ADMIN, v);
  bad.push(label + ':' + (r.ok ? 'ok' : r.code));
}
const badNull = await as(ADMIN, 'select * from public.admin_confirm_booth_live(null)', []);
t('B7 형식이 틀리면 통째로 거절(22023) — 빈 배열 · 객체 · 101곳 · 칸 빠짐 · uuid 아님 · 시각 틀림 · null', bad.every(x => x.endsWith(':22023')) && !badNull.ok && badNull.code === '22023', bad.join(' ') + ' null:' + badNull.code);
t('B8 거절된 요청은 아무것도 기록하지 않음(기록 수 그대로 2줄)', +(await q1('select count(*) n from public.booth_live_check')).n === 2);
const ch = await checksAs(ADMIN, 'authenticated');
const chm = byCode(ch.rows);
t('B9 확인 읽기 — R1-02 · R1-03 두 곳 · 지금 값 시각 · 내가 확인함 · 이름', ch.ok && ch.rows.length === 2 && chm['R1-02'] && chm['R1-03'] &&
  +chm['R1-02'].live_updated_at === +l2.updated_at && chm['R1-02'].checked_by_me === true && chm['R1-02'].checked_by_name === '시험 관리자', JSON.stringify(ch));
const ch2 = await checksAs(ADMIN2, 'authenticated');
t('B10 다른 관리자가 읽으면 checked_by_me = false · 확인한 사람 이름은 그대로', ch2.ok && byCode(ch2.rows)['R1-02'].checked_by_me === false && byCode(ch2.rows)['R1-02'].checked_by_name === '시험 관리자', JSON.stringify(ch2.rows && ch2.rows[0]));

// ══ C 동시 입력 · 중복 ═══════════════════════════════════════════════════
section = 'C 동시 입력 · 중복';
// 운영자 QR 열쇠(복제 DB 의 가짜 값 · 출력하지 않음)
const tokens = await as(ADMIN, 'select booth_id, token from public.admin_booth_access()', []);
const tokOf = code => (tokens.rows.find(r => r.booth_id === idOf(code)) || {}).token;
const anon = (sql, p) => as(null, sql, p, 'anon');
// C1 미리보기 뒤 운영자 QR 입력(같은 값을 다시 눌러도 시각이 바뀜)
await setLive('R2-01', '보통', 20, 45);
const pv1 = await item('R2-01');
const op1 = await anon('select * from public.booth_ctrl_set($1, $2, $3)', [tokOf('R2-01'), 'open', 20]);
const c1 = byCode((await confirmAs(ADMIN, [pv1])).rows)['R2-01'];
const l1 = await q1('select congestion, wait_minutes, updated_at from public.booth_live where booth_id = $1', [idOf('R2-01')]);
t('C1 미리보기 뒤 운영자 QR 입력(같은 20분) → skipped:changed · 기록 없음 · 운영자 값 · 시각 그대로', op1.ok && c1.status === 'skipped:changed' && (await checkN('R2-01')) === 0 &&
  l1.wait_minutes === 20 && +l1.updated_at === +op1.rows[0].updated_at, JSON.stringify({ op: op1.ok || op1.code, c1 }));
// C2 미리보기 뒤 운영자 '변동 없음 · 지금 확인'(touch)
await setLive('R2-02', '여유', 5, 45);
const pv2 = await item('R2-02');
const op2 = await anon('select * from public.booth_ctrl_touch($1)', [tokOf('R2-02')]);
const c2 = byCode((await confirmAs(ADMIN, [pv2])).rows)['R2-02'];
t('C2 미리보기 뒤 운영자 ‘변동 없음 · 지금 확인’(QR touch) → skipped:changed(이미 최신) · 기록 없음', op2.ok && c2.status === 'skipped:changed' && (await checkN('R2-02')) === 0, JSON.stringify({ op: op2.ok || op2.code, c2 }));
// C3 미리보기 뒤 운영자 공통 PIN 로그인 → 입력
await setLive('R2-03', '혼잡', 30, 45);
const pv3 = await item('R2-03');
const lg = await anon('select * from public.booth_pin_login($1, $2, $3)', [idOf('R2-03'), '123456', 'pintestdev90000001']);
const op3 = lg.ok ? await anon('select * from public.booth_session_set($1, $2, $3)', [lg.rows[0].session, 'open', 30]) : lg;
const c3 = byCode((await confirmAs(ADMIN, [pv3])).rows)['R2-03'];
t('C3 미리보기 뒤 운영자 PIN(리허설 공통 PIN) 입력 → skipped:changed · 기록 없음', lg.ok && op3.ok && c3.status === 'skipped:changed' && (await checkN('R2-03')) === 0, JSON.stringify({ lg: lg.ok || lg.code, op: op3.ok || op3.code, c3 }));
// C4 미리보기 뒤 다른 관리자의 [수정]
await setLive('R2-04', '보통', 15, 45);
const pv4 = await item('R2-04');
const ad4 = await as(ADMIN2, 'select * from public.admin_set_booth_live($1, $2, $3)', [idOf('R2-04'), 'open', 15]);
const c4 = byCode((await confirmAs(ADMIN, [pv4])).rows)['R2-04'];
t('C4 미리보기 뒤 다른 관리자의 [수정](값 입력) → skipped:changed', ad4.ok && c4.status === 'skipped:changed', JSON.stringify({ ad4: ad4.ok || ad4.code, c4 }));
// C5 확인한 뒤 운영자 입력 → 확인이 지금 값에서 풀림(기록은 남음)
await setLive('R2-05', '보통', 20, 45);
const c5a = byCode((await confirmAs(ADMIN, [await item('R2-05')])).rows)['R2-05'];
const before5 = !!byCode((await checksAs(ADMIN)).rows)['R2-05'];
const op5 = await anon('select * from public.booth_ctrl_set($1, $2, $3)', [tokOf('R2-05'), 'open', 25]);
const after5 = !!byCode((await checksAs(ADMIN)).rows)['R2-05'];
t('C5 확인 뒤 운영자가 새로 입력 → 그 확인은 지금 값에서 빠짐(관리자 화면 표시 사라짐) · 기록 1줄은 남음', c5a.status === 'confirmed' && before5 && op5.ok && !after5 && (await checkN('R2-05')) === 1,
  JSON.stringify({ c5a: c5a.status, before5, after5 }));
// C6 같은 요청 두 번(두 번 누름 · 응답 못 받고 다시 보냄)
await setLive('R2-06', '혼잡', 40, 50);
const it6 = await item('R2-06');
const [d1, d2] = await Promise.all([confirmAs(ADMIN, [it6]), confirmAs(ADMIN, [it6])]);
const s6 = [d1, d2].map(x => byCode(x.rows)['R2-06']);
t('C6 같은 요청 두 번 → 한 번은 confirmed, 다른 한 번은 skipped:checked(앞 확인 시각을 돌려줌) · 기록 1줄', s6.map(x => x.status).sort().join() === 'confirmed,skipped:checked' &&
  +s6[0].checked_at === +s6[1].checked_at && (await checkN('R2-06')) === 1, JSON.stringify(s6));
// C7 다른 관리자가 같은 부스
const c7 = byCode((await confirmAs(ADMIN2, [it6])).rows)['R2-06'];
t('C7 다른 관리자가 같은 값을 30분 안에 → skipped:checked · 기록 1줄', c7.status === 'skipped:checked' && (await checkN('R2-06')) === 1, JSON.stringify(c7));
// C8 30분 지난 뒤(값은 그대로) 다시 확인 → 새 기록
await db.query("update public.booth_live_check set checked_at = checked_at - interval '31 minutes' where booth_id = $1", [idOf('R2-06')]);
const c8 = byCode((await confirmAs(ADMIN2, [it6])).rows)['R2-06'];
const ch8 = byCode((await checksAs(ADMIN)).rows)['R2-06'];
t('C8 확인 뒤 30분이 지나도 값이 그대로면 다시 확인 가능(confirmed · 기록 2줄) · 읽기는 마지막 확인(두번째 관리자)', c8.status === 'confirmed' && (await checkN('R2-06')) === 2 &&
  ch8 && ch8.checked_by_name === '두번째 관리자' && ch8.checked_by_me === false, JSON.stringify({ c8, ch8 }));
// C9 한 부스에서 오류가 나도 나머지는 계속(시험용 트리거로 R2-08 기록만 실패시킴 — 복제 DB 에서만)
await setLive('R2-07', '보통', 15, 45); await setLive('R2-08', '보통', 15, 45); await setLive('R2-09', '보통', 15, 45);
await db.exec(`create function public.test_fail_one() returns trigger language plpgsql as $f$ begin if new.booth_id = '${idOf('R2-08')}' then raise exception 'test'; end if; return new; end $f$;
  create trigger test_fail_one before insert on public.booth_live_check for each row execute function public.test_fail_one();`);
const C9 = byCode((await confirmAs(ADMIN, [await item('R2-09'), await item('R2-08'), await item('R2-07')])).rows);
await db.exec('drop trigger test_fail_one on public.booth_live_check; drop function public.test_fail_one();');
t('C9 한 부스 기록이 실패해도(failed) 나머지는 confirmed · 실패한 부스는 기록 없음', C9['R2-07'].status === 'confirmed' && C9['R2-08'].status === 'failed' && C9['R2-09'].status === 'confirmed' &&
  (await checkN('R2-08')) === 0, JSON.stringify(Object.values(C9).map(r => codeOf(r.booth_id) + ':' + r.status)));
const B9 = await confirmAs(ADMIN, [await item('R2-08')]);
t('C10 실패한 부스만 다시 시도 → confirmed', byCode(B9.rows)['R2-08'].status === 'confirmed', JSON.stringify(B9.rows));
const ord = await confirmAs(ADMIN, ['R3-05', 'R3-01', 'R3-03'].map(c => ({ booth_id: idOf(c), seen_updated_at: it6.seen_updated_at })));
const sorted = REAL.filter(x => ['R3-05', 'R3-01', 'R3-03'].map(idOf).includes(x)).sort();
t('C11 여러 부스는 booth_id 순서로 처리(두 관리자 묶음이 엇갈려 잠그지 않게)', ord.ok && ord.rows.map(r => r.booth_id).join() === sorted.join(), JSON.stringify(ord.rows && ord.rows.map(r => r.booth_id)));

// ══ D 날짜 · 23:00 ══════════════════════════════════════════════════════
section = 'D 날짜 · 23:00';
await db.query("insert into public.booth_live (booth_id, congestion, wait_minutes, updated_at) values ($1, '보통', 15, now() - interval '1 day') on conflict (booth_id) do update set congestion = '보통', wait_minutes = 15, updated_at = now() - interval '1 day'", [idOf('R3-10')]);
const d1r = byCode((await confirmAs(ADMIN, [await item('R3-10')])).rows)['R3-10'];
t('D1 어제(KST) 값 → skipped:not_today(관리자 화면에서도 미입력으로 보이는 값)', d1r.status === 'skipped:not_today', JSON.stringify(d1r));
// 오늘 확인한 뒤 날짜가 바뀐 것처럼(값 시각 · 확인 시각을 하루 앞으로 — 같은 값에 붙은 확인)
await setLive('R3-11', '보통', 15, 45);
await confirmAs(ADMIN, [await item('R3-11')]);
await db.query("update public.booth_live set updated_at = updated_at - interval '1 day' where booth_id = $1", [idOf('R3-11')]);
await db.query("update public.booth_live_check set seen_updated_at = seen_updated_at - interval '1 day', checked_at = checked_at - interval '1 day' where booth_id = $1", [idOf('R3-11')]);
const d2r = byCode((await checksAs(ADMIN)).rows)['R3-11'];
t('D2 어제 한 확인은 오늘 읽기에 붙지 않음(같은 값이어도)', !d2r, JSON.stringify(d2r));
// 23:00 자동 초기화(리허설 84곳 booth_live 지움) 뒤
await setLive('R4-01', '혼잡', 40, 45);
const d3a = byCode((await confirmAs(ADMIN, [await item('R4-01')])).rows)['R4-01'];
const recN = +(await q1('select count(*) n from public.booth_live_check')).n;
const seen4 = await item('R4-01');
await db.query('select private.rehearsal_live_reset()');
const d3b = byCode((await checksAs(ADMIN)).rows);
const d3c = byCode((await confirmAs(ADMIN, [seen4])).rows)['R4-01'];
t('D3 23:00 초기화 뒤 — 확인 표시 모두 사라짐 · 다시 확인하면 skipped:no_value · 확인 기록(감사 기록)은 그대로', d3a.status === 'confirmed' &&
  REAL.every(x => !d3b[codeOf(x)]) && d3c.status === 'skipped:no_value' && +(await q1('select count(*) n from public.booth_live_check')).n === recN, JSON.stringify({ d3a: d3a.status, d3c, recN }));
t('D4 초기화 함수(private.rehearsal_live_reset)는 그대로 — 기록 표에 손대지 않음', !/booth_live_check/.test((await q1("select pg_get_functiondef('private.rehearsal_live_reset()'::regprocedure) d")).d));

// ══ E 운영 기록 그대로 ═══════════════════════════════════════════════════
section = 'E 운영 기록 그대로';
await setLive('R4-02', '보통', 20, 45); await setLive('R4-03', '혼잡', 40, 60); await setLive('R4-04', '중단', 0, 35);
const fpE0 = await liveFp();
const visitor0 = await as(null, 'select booth_id, congestion, wait_minutes, updated_at from public.booth_live order by booth_id', [], 'anon');
const E1 = await confirmAs(ADMIN, await Promise.all(['R4-02', 'R4-03', 'R4-04'].map(item)));
await checksAs(ADMIN);
const fpE1 = await liveFp();
const visitor1 = await as(null, 'select booth_id, congestion, wait_minutes, updated_at from public.booth_live order by booth_id', [], 'anon');
t('E1 확인 3곳(confirmed) 앞뒤 booth_live(값 · updated_at) · booth_live_log 지문 같음', E1.rows.every(r => r.status === 'confirmed') && sameFp(fpE0, fpE1), JSON.stringify({ fpE0, fpE1 }));
t('E2 관람객이 읽는 값(anon booth_live) 앞뒤 같음 — 30분 넘은 값은 그대로 30분 넘은 값(관람객 화면 ‘정보 없음’ 유지)',
  JSON.stringify(visitor0.rows) === JSON.stringify(visitor1.rows), '');
const defC = (await q1("select pg_get_functiondef('public.admin_confirm_booth_live(jsonb)'::regprocedure) d")).d;
const defR = (await q1("select pg_get_functiondef('public.admin_booth_live_checks()'::regprocedure) d")).d;
t('E3 일괄 확인 정의 — 관리자끼리 advisory 잠금(줄 잡기 전) · booth_live 는 FOR UPDATE NOWAIT(FOR SHARE · 기다리는 FOR UPDATE 아님) · booth_live / booth_live_log 에 insert · update · delete 없음 · lock_timeout 3s',
  /pg_advisory_xact_lock[\s\S]*from public\.booth_live as l[\s\S]*?for update nowait/i.test(defC) && !/for share/i.test(defC) && !/for update(?!\s+nowait)/i.test(defC) && !/(insert\s+into|update|delete\s+from)\s+public\.booth_live(_log)?\b(?!_)/i.test(defC) && /lock_timeout TO '3s'/i.test(defC), '');
t('E4 확인 읽기 정의 — 읽기만(insert · update · delete 없음)', !/\b(insert|update|delete)\b/i.test(defR.replace(/--.*$/gm, '')), '');

// ══ F 화면 ══════════════════════════════════════════════════════════════
section = 'F 화면';
// 화면용 상태: R1 확인 필요 몇 곳 · 최근 · 미입력
await db.exec('delete from public.booth_live_check');
await db.query('delete from public.booth_live where booth_id = any($1::uuid[])', [REAL]);   // 앞 묶음에서 넣은 값 비우기
for (const [c, w, a] of [['R1-01', 20, 45], ['R1-02', 45, 50], ['R1-07', 10, 70], ['R2-10', 15, 40], ['R1-08', 5, 3]]) await setLive(c, w <= 10 ? '여유' : w <= 25 ? '보통' : '혼잡', w, a);
const staleCodes = ['R1-01', 'R1-02', 'R1-07', 'R2-10'];
async function openAdmin() {
  const p = await openPage({ JSDOM, VirtualConsole, dir: MAIN, file: 'booth-admin.html', R, rest, hash: '#live' });
  await until(() => p.d.querySelectorAll('#lv-list .lv').length >= 20, 30000);
  await until(() => p.calls.some(c => c.name === 'admin_booth_live_checks'), 20000);
  await wait(400);
  return p;
}
const P = await openAdmin();
const { d: D, w: W } = P;
const soon = () => [...D.querySelectorAll('.oact__soon button')].map(b => ({ t: text(b), dis: b.disabled, k: b.getAttribute('data-batch') || '' }));
const s0 = soon();
t('F1 함수가 있으면 [일괄 확인] 누를 수 있음 · 운영자 알림은 그대로 ‘준비 중’', s0.length === 2 && s0[0].t === '일괄 확인' && !s0[0].dis && s0[0].k === 'open' &&
  /운영자 알림/.test(s0[1].t) && /준비 중/.test(s0[1].t) && s0[1].dis, JSON.stringify(s0));
const staleTodo = () => +text(D.querySelector('.todo--stale .todo__n'));
const staleN0 = staleTodo();
click(W, D.querySelector('[data-batch="open"]')); await wait(200);
const boxes = () => [...D.querySelectorAll('#lv-list input[data-bsel]')];
t(`F2 [일괄 확인] → ‘확인 필요’ ${staleCodes.length}곳만 보이고 체크칸 ${staleCodes.length}개 · 처음엔 아무것도 안 고름`, boxes().length === staleCodes.length && boxes().every(b => !b.checked) &&
  D.querySelectorAll('#lv-list .lv').length === staleCodes.length && /고른 0곳/.test(text(D.getElementById('lv-bsel'))), text(D.getElementById('lv-bsel')) + ' boxes=' + boxes().length);
const pv0 = D.querySelector('[data-batch="preview"]');
t('F3 하나도 안 고르면 [미리보기] 누를 수 없음', pv0 && pv0.disabled, pv0 && pv0.outerHTML.slice(0, 120));
// R1 구역 모두 고르기 → R1 의 확인 필요 3곳
const zsel = D.getElementById('lv-bzone');
zsel.value = 'R1'; zsel.dispatchEvent(new W.Event('change', { bubbles: true })); await wait(150);
const picked = () => boxes().filter(b => b.checked).map(b => codeOf(b.getAttribute('data-bsel'))).sort();
t('F4 ‘R1 구역의 확인 필요 모두 고르기’ → R1 3곳만 고름(R2 는 그대로)', picked().join() === 'R1-01,R1-02,R1-07', picked().join());
// 하나 빼기 + R2-10 넣기(체크칸)
const box = code => boxes().find(b => b.getAttribute('data-bsel') === idOf(code));
box('R1-07').checked = false; box('R1-07').dispatchEvent(new W.Event('change', { bubbles: true })); await wait(100);
box('R2-10').checked = true; box('R2-10').dispatchEvent(new W.Event('change', { bubbles: true })); await wait(100);
t('F5 체크칸으로 빼고 더하기 → R1-01 · R1-02 · R2-10', picked().join() === 'R1-01,R1-02,R2-10' && /고른 3곳/.test(text(D.getElementById('lv-bsel'))), picked().join());
click(W, D.querySelector('[data-batch="preview"]')); await wait(150);
const pvBox = D.getElementById('lv-batch');
const pvRows = [...pvBox.querySelectorAll('.bc__row')].map(r => text(r));
t('F6 미리보기 — 고른 3곳의 번호 · 이름 · 마지막 상태 · 대기 · 마지막 입력 시각 · 입력 주체 + ‘관람객 화면 값과 운영자 입력 시각은 바뀌지 않습니다’',
  !pvBox.hidden && pvRows.length === 3 && pvRows.every(x => /R[12]-\d\d/.test(x) && /\d{1,2}:\d{2}/.test(x) && /분 전/.test(x)) && /혼잡/.test(pvRows.join()) &&
  /관람객 화면 값과 운영자 입력 시각은 바뀌지 않습니다/.test(text(pvBox)) && /확인 기록 남기기 \(3곳\)/.test(text(pvBox.querySelector('[data-batch="send"]'))), text(pvBox).slice(0, 400));
// 미리보기 뒤 운영자가 R2-10 을 새로 입력 → 보내면 그 부스는 제외(바뀜)
const opF = await anon('select * from public.booth_ctrl_set($1, $2, $3)', [tokOf('R2-10'), 'open', 15]);
const fpF0 = await liveFp();
const callsBefore = P.calls.length;
click(W, D.querySelector('[data-batch="send"]'));
await until(() => /확인 완료/.test(text(D.getElementById('lv-batch'))), 15000); await wait(300);
const resTxt = text(D.getElementById('lv-batch'));
t('F7 결과 — 확인 완료 2 · 제외 1(그 사이 새 입력) · 실패 0, 부스별 까닭', opF.ok && /확인 완료 2/.test(resTxt) && /제외 1/.test(resTxt) && /실패 0/.test(resTxt) && /R2-10[^]*새 입력/.test(resTxt), resTxt.slice(0, 500));
t('F8 화면이 보낸 것은 admin_confirm_booth_live 한 번 · 고른 3곳의 미리보기 시각 그대로', P.calls.slice(callsBefore).filter(c => c.name === 'admin_confirm_booth_live').length === 1 &&
  (() => { const a = P.calls.slice(callsBefore).find(c => c.name === 'admin_confirm_booth_live').args.p_items; return a.length === 3 && a.every(x => x.booth_id && x.seen_updated_at); })(),
  JSON.stringify(P.calls.slice(callsBefore).map(c => c.name)));
t('F9 화면에서 확인해도 booth_live · booth_live_log 그대로(운영자 R2-10 입력 말고는)', sameFp(fpF0, await liveFp()), '');
click(W, D.querySelector('[data-batch="close"]')); await wait(200);
await until(() => D.querySelectorAll('#lv-list .flag--checked').length >= 2, 20000);
const rowOfCode = code => [...D.querySelectorAll('#lv-list .lv')].find(a => text(a.querySelector('.lv__code')) === code);
const r01 = rowOfCode('R1-01');
t('F10 확인한 줄 — ‘확인 필요’ 표는 그대로 + ‘관리자 확인 HH:MM’ 따로(30분 넘은 표시 유지)', r01 && r01.classList.contains('is-stale') && !!r01.querySelector('.flag--stale') &&
  /관리자 확인 \d{1,2}:\d{2}/.test(text(r01.querySelector('.flag--checked'))), r01 && text(r01).slice(0, 200));
const oldCells = [...D.querySelectorAll('.ost .st__o')].map(e => text(e)).join(' ');
const splitN = k => +text(D.querySelector('.tsplit__b--' + k + ' .tsplit__n'));
t(`F11 관리 조치 — 확인 필요 ${staleN0 - 1}(30분 기준 그대로 · R2-10 만 운영자 새 입력으로 빠짐) = 관리자 확인 2 + 아직 미확인 ${staleN0 - 3} · ‘운영 상태 갱신이 아니어서 그대로’ 설명 · 운영 상태 칸 점선 합도 같음`,
  staleN0 === staleCodes.length && staleTodo() === staleN0 - 1 && splitN('checked') === 2 && splitN('unchecked') === staleN0 - 3 &&
  /운영 상태 갱신이 아니어서 확인 필요 수는 그대로/.test(text(D.querySelector('.tsplit'))) &&
  [...oldCells.matchAll(/확인 필요 (\d+)/g)].reduce((a, m) => a + +m[1], 0) === staleN0 - 1, text(D.querySelector('.todo-stack')) + ' | ' + oldCells);
click(W, D.querySelector('.tsplit__b--unchecked')); await wait(150);
const unc = [...D.querySelectorAll('#lv-list .lv__code')].map(e => text(e));
click(W, D.querySelector('.tsplit__b--checked')); await wait(150);
const chk = [...D.querySelectorAll('#lv-list .lv__code')].map(e => text(e)).sort();
click(W, D.querySelector('.ost__all')); await wait(100);
t('F11b ‘아직 미확인’ · ‘관리자 확인’ 을 누르면 그 부스만(R1-07 / R1-01 · R1-02)', unc.join() === 'R1-07' && chk.join() === 'R1-01,R1-02', unc.join() + ' | ' + chk.join());
click(W, D.querySelector('[data-batch="open"]')); await wait(200);
const r01b = boxes().find(b => b.getAttribute('data-bsel') === idOf('R1-01'));
t('F12 다시 [일괄 확인] — 이미 확인한 부스는 체크칸 없이 ‘확인함’ · 나머지(R1-07 · R2-10 은 R2-10 이 최근이라 빠짐)만 고를 수 있음', !r01b &&
  /확인함/.test(text(rowOfCode('R1-01'))) && boxes().map(b => codeOf(b.getAttribute('data-bsel'))).sort().join() === 'R1-07', boxes().map(b => codeOf(b.getAttribute('data-bsel'))).join());
click(W, D.querySelector('[data-batch="close"]')); await wait(100);
const names = [...new Set(P.calls.map(c => c.name))].sort();
t('F13 이 화면이 부른 함수 — 원래 읽기 함수 + 새 두 함수뿐(admin_set_booth_live · 발급 · 지우기 없음)', names.every(n => ['admin_booth_credentials', 'admin_rehearsal_status', 'admin_booth_live_checks', 'admin_confirm_booth_live'].includes(n)), names.join(','));
t('F14 화면 오류 없음', P.errors.length === 0, P.errors.join(' | '));
P.dom.window.close();

// ══ R 되돌리기 ═══════════════════════════════════════════════════════════
section = 'R 되돌리기';
const recR = +(await q1('select count(*) n from public.booth_live_check')).n;
const fpR0 = await liveFp();
const r1 = await R.run(RB), r2 = await R.run(RB);
const rconf = await qa(RB.slice(RB.indexOf('select v."항목"'), RB.indexOf('-- ── 표까지')));
t('R1 되돌리기 SQL 두 번 실행 — 둘 다 성공 · 확인 표 모두 맞음', r1.ok && r2.ok && rconf.length === 4 && rconf.every(r => r['맞음'] === true), (r1.error || '') + JSON.stringify(rconf));
t(`R2 함수만 사라지고 기록 ${recR}줄 그대로 · booth_live · booth_live_log 그대로 · 기존 함수 지문 그대로`, +(await q1('select count(*) n from public.booth_live_check')).n === recR && recR > 0 &&
  sameFp(fpR0, await liveFp()) && (await fnFp()).h === fn0.h, '');
const P2 = await openAdmin();
const s2 = [...P2.d.querySelectorAll('.oact__soon button')].map(b => ({ t: text(b), dis: b.disabled }));
t('R3 되돌린 뒤 화면 — [일괄 확인] 은 다시 ‘준비 중’(누를 수 없음) · ‘관리자 확인’ 표시 없음 · 오류 없음', s2.length === 2 && s2.every(x => x.dis && /준비 중/.test(x.t)) &&
  !P2.d.querySelector('.flag--checked') && !P2.d.querySelector('.tsplit') && P2.errors.length === 0, JSON.stringify(s2) + P2.errors.join('|'));
// 함수가 없다고 본 뒤에는 15초 새로 읽기에서 다시 묻지 않음 — [새로 고침] 을 누를 때만 한 번 더
const ckN = () => P2.calls.filter(c => c.name === 'admin_booth_live_checks').length;
const liveReads = () => P2.log.filter(x => x === 'select:booth_live').length;
const n0 = ckN(), lr0 = liveReads();
await wait(19000);
const n1 = ckN(), lr1 = liveReads();
click(P2.w, P2.d.querySelector('[data-refresh]'));
await until(() => ckN() > n1, 8000); await wait(300);
const n2 = ckN();
t(`R3b 함수 없음(PGRST202)을 본 뒤 — 15초 새로 읽기(booth_live ${lr1 - lr0}번)에는 다시 묻지 않음(${n0} → ${n1}) · [새로 고침] 에서만 한 번 더(→ ${n2})`,
  n0 === 1 && lr1 > lr0 && n1 === n0 && n2 === n1 + 1, JSON.stringify({ n0, n1, n2, lr0, lr1 }));
P2.dom.window.close();
const m3 = await R.run(MIG);
const back = await checksAs(ADMIN);
t('R4 다시 적용하면 기록을 이어 씀(표 · 줄 그대로 · 지금 값에 붙은 확인이 다시 보임)', m3.ok && +(await q1('select count(*) n from public.booth_live_check')).n === recR && back.ok && back.rows.length >= 2, JSON.stringify({ m3: m3.ok, n: back.rows && back.rows.length }));

// ══ G 감사 기록 보존 ═════════════════════════════════════════════════════
section = 'G 감사 기록 보존';
const gId = idOf('R1-01');
const gBefore = await qa('select booth_code, booth_name, checked_by from public.booth_live_check where booth_id = $1', [gId]);
const gDel = await R.run(`delete from public.booths where id = '${gId}'`);   // 복제 DB 에서만 — 부스 삭제
const gAfter = await qa('select booth_code, booth_name, checked_by from public.booth_live_check where booth_id = $1', [gId]);
t('G1 부스를 지워도 그 부스의 관리자 확인 기록은 남음(외래 키 없음) · 그때의 부스번호 · 이름 · 관리자로 알아볼 수 있음',
  gDel.ok && gBefore.length >= 1 && JSON.stringify(gAfter) === JSON.stringify(gBefore) && gAfter[0].booth_code === 'R1-01' && !(await q1('select 1 x from public.booths where id = $1', [gId])),
  JSON.stringify({ del: gDel.ok || gDel.error, gBefore, gAfter }));

const passed = results.filter(x => x.ok).length;
mkdirSync(resolve(OUT, 'rehearsal'), { recursive: true });
writeFileSync(resolve(OUT, 'rehearsal', 'batch-confirm-test-report.md'), ['# ‘확인 필요’ 관리자 일괄 확인 시험', '',
  `- 실행: ${new Date().toISOString()} · 결과 **${passed} / ${results.length} 통과**`,
  `- 판: ${MAIN.replace(/\\/g, '/')} · 복제 DB = 지금 Production 단계(PGlite · 한 연결) · 네트워크 없음`,
  '- 실제 동시 잠금(두 연결)은 test-batch-confirm-locks.mjs(실제 PostgreSQL 필요)', '',
  '| 묶음 | 결과 | 시험 | 메모 |', '|---|---|---|---|',
  ...results.map(x => `| ${x.section} | ${x.ok ? '통과' : '**실패**'} | ${x.name.replace(/\|/g, '/')} | ${(x.note || '').replace(/\|/g, '/')} |`), ''].join('\n'));
console.log(`\n${passed} / ${results.length} 통과 → out/rehearsal/batch-confirm-test-report.md`);
process.exit(passed === results.length ? 0 : 1);
