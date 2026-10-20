/* ===================================================================
   리허설 대기시간(관리자 채우기 · 비우기 · 23시 자동 초기화 · 관람객 표시) 시험 — 로컬 복제 DB 위에서
   ───────────────────────────────────────────────────────────────────
   복제 DB(lib/replica.mjs)를 지금 Production 과 같은 단계(migration-booth-preview → C-02 → Q-02 → T-02 → T-03)로
   만들고, 작업 브랜치 두 곳의 파일을 고치지 않고 그대로 씁니다.
     --main-dir  claude/rehearsal-fill-admin (main 기반)   supabase/*rehearsal*.sql · booth-admin.html · assets
     --live-dir  claude/rehearsal-fill-live  (booth-live 기반)  live/api/live-snapshot.mjs · visitor.html · booth-ctrl.html
   A  DB 함수 — 관리자만 · 84곳만 · 행사 첫날 전만 · 초기화는 84곳의 지금 값만 · 권한 · 23시(UTC 14시) 예약(가짜 cron 스키마)
   B  관리자 화면(jsdom) — 리허설 관리 칸 · 확인창 · 채우기 · 덮어쓰기 안내 · 부분 실패 · 다시 시도 · 중복 클릭 · 비우기 ·
      행사 시작(보내는 중 포함) · DB 함수 없음 · 예시 현황 채우기 · 비우기(같은 보내기 도구) 회귀
   C  관람객 — 스냅샷(공개 값만 · 열쇠 없음) · 화면(리허설 띠 · 큰 숫자 · 거르기 · 검색 · 정렬 · 구역 · 한눈에 · 상세) ·
      행사 당일(문 열기 전 · 운영 중)에 전날 리허설 값이 '지금 대기' 로 보이지 않음
      (C3~C11 화면 시계 = 스냅샷을 만든 시각 — 복제 DB 가 값을 실제 시각으로 저장하므로 날짜를 고정하지 않음 · C0 이 확인.
       행사 날 · 다음 날 · 23시 뒤는 C12~C15 · E 가 시각과 데이터 시각을 함께 정해 봄. 실제 날짜가 11-06 이후면 A · B 의 DB 함수가 닫혀 실행 불가)
   D  운영자 화면 — 행사 전 안내 · 저장 알림 문구 · 관리자 값과 운영자 값이 서로 덮어씀
   ⚠️ 네트워크 · Production 접속 없음. 열쇠 · PIN 은 가짜 값이고 출력하지 않습니다(개수와 참 · 거짓만).
   쓰는 법
     node --max-old-space-size=8192 scripts/booth-data/test-rehearsal.mjs --pglite-dir <PGlite 0.4.4> --jsdom-dir <jsdom> \
          --main-dir ../incheon-festival-rh-main --live-dir ../incheon-festival-rh-live [--dump <폴더>]
   결과: out/rehearsal/rehearsal-test-report.md
   =================================================================== */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { readCsv } from './lib/csv.mjs';
import { loadPglite, openReplica, ADMIN } from './lib/replica.mjs';
import { makeRest, fakeSupabase } from './lib/fake-rest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT = resolve(HERE, 'out');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const MAIN = resolve(arg('main-dir', resolve(REPO, '../incheon-festival-rh-main')));
const LIVE = resolve(arg('live-dir', resolve(REPO, '../incheon-festival-rh-live')));
const dumpDir = arg('dump');
const { JSDOM } = createRequire(join(resolve(arg('jsdom-dir')), 'package.json'))('jsdom');
const lib = await loadPglite(arg('pglite-dir'));
const manifest = readCsv(resolve(OUT, 'staging', 'manifest.csv'));
const plan = readCsv(resolve(OUT, 'gate4r', 'plan-R.csv'));
const snap = readCsv(resolve(OUT, readdirSync(OUT).filter(f => /^prod-snapshot-\d{8}\.csv$/.test(f)).sort().pop()));
const R = await openReplica(lib, { snap, manifest });
const db = R.db;
const rest = makeRest(R);
const REAL = plan.map(p => p['부스ID']);
const realSet = new Set(REAL);
const exIds = snap.map(s => s.id);
const codeOf = new Map(plan.map(p => [p['부스ID'], p['표시코드']]));
const idOf = c => plan.find(p => p['표시코드'] === c)['부스ID'];

const results = [];
function t(name, ok, note = '') { results.push({ name, ok: !!ok, note }); console.log(`${ok ? '통과' : '실패'}  ${name}${note && !ok ? '  — ' + note : ''}`); }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000, step = 40) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await wait(step); } return false; }
const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const q1 = async (sql, p) => (await db.query(sql, p)).rows[0];
async function runAll(sql) {   // 여러 문장 — 마지막 결과의 모든 줄
  try { const r = await db.exec(sql); return { ok: true, rows: r[r.length - 1]?.rows || [] }; }
  catch (e) { try { await db.exec('rollback'); } catch { /* 없음 */ } return { ok: false, error: e.message, code: e.code }; }
}
async function tryAdmin(sql, p) {
  try { await db.exec(`set test.uid = '${ADMIN}'`); return { ok: true, rows: (await db.query(sql, p)).rows }; }
  catch (e) { return { ok: false, code: e.code, message: e.message, hint: e.hint }; }
  finally { await db.exec("set test.uid = ''"); }
}
async function tryAs(sql, p) { try { return { ok: true, rows: (await db.query(sql, p)).rows }; } catch (e) { return { ok: false, code: e.code, message: e.message }; } }
async function tryAnon(sql, p) { try { return { ok: true, rows: await R.asAnon(sql, p) }; } catch (e) { return { ok: false, code: e.code, message: e.message }; } }
async function fp() {   // 바뀌면 안 되는 것들의 지문
  return q1(`select
    (select md5(coalesce(string_agg(booth_id::text || token || coalesce(disabled_at::text,'') || created_at::text || coalesce(rotated_at::text,''), ',' order by booth_id), '')) from public.booth_access) qr,
    (select md5(coalesce(string_agg(booth_id::text || pin_hash, ',' order by booth_id), '')) from public.booth_pin) pin,
    (select count(*) from public.booth_session) sessions,
    (select md5(string_agg(id::text || coalesce(zone_key,'') || coalesce(no::text,'') || name || org || is_published::text, ',' order by id)) from public.booths) booths,
    (select md5(string_agg(key || label || is_published::text, ',' order by key)) from public.zones) zones,
    (select md5(row(s.*)::text) from public.settings s where id = 1) settings,
    (select md5(coalesce(string_agg(booth_id::text || congestion || wait_minutes || updated_at::text, ',' order by booth_id), '')) from public.booth_live where booth_id = any($1::uuid[])) ex_live,
    (select count(*) from public.booth_live where booth_id = any($1::uuid[])) ex_n,
    (select count(*) from public.booth_live where booth_id = any($2::uuid[])) real_n,
    (select count(*) from public.booth_live_log) log_n,
    (select coalesce(max(id), 0) from public.booth_live_log) log_max`, [exIds, REAL]);
}
const MIG = readFileSync(join(MAIN, 'supabase/migration-booth-rehearsal.sql'), 'utf8');
const SCHED = readFileSync(join(MAIN, 'supabase/schedule-booth-rehearsal-reset.sql'), 'utf8');
const ROLLBACK = readFileSync(join(MAIN, 'supabase/rollback-booth-rehearsal.sql'), 'utf8');

// ══ 준비: 지금 Production 과 같은 단계 ═══════════════════════════════
// admin_set_booth_live · admin_reset_booth_live · booth_ctrl_touch(Production 함수 그대로 옮긴 것)
await db.exec(readFileSync(resolve(HERE, 'dryrun/replica-functions-extra.sql'), 'utf8'));
for (const f of [resolve(REPO, 'supabase/migration-booth-preview.sql'), resolve(OUT, 'gate3c/C-02-transition.sql'), resolve(OUT, 'gate3c/Q-02-qr-preissue.sql'),
  resolve(OUT, 'gate4r/T-02-assign.sql'), resolve(OUT, 'gate4r/T-03-publish.sql')]) {
  const r = await R.run(readFileSync(f, 'utf8'));
  if (!r.ok) throw new Error(f + ' ' + r.error);
}
const st0 = await q1(`select count(*) filter (where is_published) pub, count(*) n from public.booths where id = any($1::uuid[])`, [REAL]);
t('A0 복제 DB = 지금 Production 단계(실제 84곳 공개 · R1~R4 · 예시 비공개 · 예시 대기 값 50줄)',
  +st0.pub === 84 && +(await q1('select count(*) n from public.booth_live')).n === 50 && +(await q1(`select count(*) n from public.booths where is_published and id = any($1::uuid[])`, [exIds])).n === 0);

// ══ A. DB 함수 ═════════════════════════════════════════════════════
let r = await runAll(MIG);
const checks = r.ok ? r.rows : [];
t('A1 migration-booth-rehearsal.sql 적용 · 확인 표 9줄 모두 기대 = 실제', r.ok && checks.length === 9 && checks.every(x => x['기대'] === x['실제']),
  r.error || JSON.stringify(checks.filter(x => x['기대'] !== x['실제'])));
r = await runAll(MIG);
t('A2 다시 실행해도 안전(같은 결과)', r.ok && r.rows.every(x => x['기대'] === x['실제']), r.error || '');
let s = await tryAdmin('select * from public.admin_rehearsal_status()');
const st = s.ok ? s.rows[0] : {};
t('A3 상태(관리자): 대상 84 = 실제 부스 UUID 전부 · 예시 없음 · 열림 · 닫히는 날 11-06 · 자동 초기화 none',
  s.ok && st.target_ids.length === 84 && st.target_ids.every(id => realSet.has(id)) && st.closed === false &&
  new Date(st.cutoff).toISOString().slice(0, 10) === '2026-11-06' && st.reset_state === 'none', JSON.stringify(s.ok ? { n: st.target_ids.length, c: st.closed, r: st.reset_state } : s));
let x1 = await tryAs('select * from public.admin_rehearsal_status()');
let x2 = await tryAnon('select * from public.admin_rehearsal_status()');
t('A4 상태 — 로그인했지만 관리자 아님: 42501 · 익명: 실행 권한 없음', !x1.ok && x1.code === '42501' && !x2.ok && x2.code === '42501', `${x1.code} ${x2.code}`);
const f0 = await fp();
const S01 = idOf('R1-01');
s = await tryAdmin(`select * from public.admin_rehearsal_set_live($1, 'open', 15)`, [S01]);
const f1 = await fp();
const lg = await q1('select source, congestion, wait_minutes from public.booth_live_log order by id desc limit 1');
t('A5 넣기(관리자 · R1-01 · 15분): 보통 15 · 기록 +1 source admin · 예시 · QR · PIN · 부스 · 구역 · 설정 그대로',
  s.ok && s.rows[0].congestion === '보통' && s.rows[0].wait_minutes === 15 && +f1.log_n === +f0.log_n + 1 && lg.source === 'admin' &&
  f1.qr === f0.qr && f1.pin === f0.pin && f1.booths === f0.booths && f1.zones === f0.zones && f1.settings === f0.settings && f1.ex_live === f0.ex_live);
x1 = await tryAdmin(`select * from public.admin_rehearsal_set_live($1, 'open', 15)`, [exIds[0]]);
x2 = await tryAdmin(`select * from public.admin_rehearsal_set_live($1, 'clear', null)`, ['00000000-0000-4000-8000-000000000999']);
let x3 = await tryAdmin(`select * from public.admin_rehearsal_set_live(null, 'clear', null)`);
t('A6 대상 밖 거절(예시 부스 · 없는 부스 · 빈 값): 22023 "리허설 대상(실제 부스 84곳)이 아닌 부스"',
  [x1, x2, x3].every(x => !x.ok && x.code === '22023' && /리허설 대상/.test(x.message)) && (await fp()).ex_live === f0.ex_live, [x1, x2, x3].map(x => x.code).join(','));
x1 = await tryAs(`select * from public.admin_rehearsal_set_live($1, 'open', 5)`, [S01]);
x2 = await tryAnon(`select * from public.admin_rehearsal_set_live($1, 'open', 5)`, [S01]);
t('A7 관리자 아님: 42501 · 익명: 실행 권한 없음 · 값 그대로', !x1.ok && x1.code === '42501' && !x2.ok && x2.code === '42501' &&
  (await q1('select wait_minutes w from public.booth_live where booth_id = $1', [S01])).w === 15);
x1 = await tryAdmin(`select * from public.admin_rehearsal_set_live($1, 'foo', 5)`, [S01]);
x2 = await tryAdmin(`select * from public.admin_rehearsal_set_live($1, 'open', 999)`, [S01]);
t('A8 잘못된 모드 · 대기 분은 원래 함수 규칙대로 거절(22023)', !x1.ok && x1.code === '22023' && !x2.ok && x2.code === '22023');
await db.exec("update public.settings set event_start = now() - interval '1 day' where id = 1");
x1 = await tryAdmin(`select * from public.admin_rehearsal_set_live($1, 'open', 30)`, [S01]);
x2 = await tryAdmin(`select * from public.admin_rehearsal_set_live($1, 'clear', null)`, [S01]);
s = await tryAdmin('select * from public.admin_rehearsal_status()');
t('A9 행사 첫날(한국 날짜) 이후: 넣기 · 지우기 모두 거절(P0001 · hint rehearsal_closed) · 상태 closed',
  !x1.ok && x1.code === 'P0001' && /행사가 시작되어/.test(x1.message) && (x1.hint === undefined || x1.hint === 'rehearsal_closed') && !x2.ok && x2.code === 'P0001' &&
  s.ok && s.rows[0].closed === true && (await q1('select wait_minutes w from public.booth_live where booth_id = $1', [S01])).w === 15, `${x1.code} ${x1.hint}`);
await db.exec("update public.settings set event_start = '2026-12-01 01:00+00' where id = 1");
const cut1 = (await q1('select private.rehearsal_cutoff()::text c')).c;
const cut2 = await db.transaction(async tx => { await tx.exec('delete from public.settings'); const c = (await tx.query('select private.rehearsal_cutoff()::text c')).rows[0].c; await tx.rollback(); return c; });
await db.exec("update public.settings set event_start = '2026-11-06 01:00+00' where id = 1");
t('A10 닫히는 날은 늦어도 11-06(행사 날짜를 뒤로 고치거나 기본정보 줄이 없어도)', cut1 === '2026-11-06' && cut2 === '2026-11-06', `${cut1} ${cut2}`);
for (const id of REAL) await tryAdmin(`select * from public.admin_rehearsal_set_live($1, 'open', 5)`, [id]);
const f2 = await fp();
const n1 = (await q1('select private.rehearsal_live_reset() n')).n;
const f3 = await fp();
const n2 = (await q1('select private.rehearsal_live_reset() n')).n;
t('A11 초기화 함수: 84곳 지움 · 다시 불러도 0(중복 안전) · 예시 50줄 · 대기 기록 · QR · PIN · 세션 · 부스 · 구역 · 설정 그대로',
  +f2.real_n === 84 && n1 === 84 && n2 === 0 && +f3.real_n === 0 && f3.ex_live === f0.ex_live && +f3.ex_n === 50 && f3.log_n === f2.log_n && f3.log_max === f2.log_max &&
  f3.qr === f0.qr && f3.pin === f0.pin && f3.sessions === f0.sessions && f3.booths === f0.booths && f3.zones === f0.zones && f3.settings === f2.settings, JSON.stringify({ n1, n2 }));
x1 = await tryAnon('select private.rehearsal_live_reset()');
x2 = await db.transaction(async tx => { try { await tx.exec('set local role authenticated'); await tx.query('select private.rehearsal_live_reset()'); return { ok: true }; } catch (e) { return { ok: false, code: e.code }; } });
t('A12 초기화 함수는 익명 · 로그인 역할이 부를 수 없음(private 스키마)', !x1.ok && !x2.ok && x1.code === '42501' && x2.code === '42501', `${x1.code} ${x2.code}`);

// 23시 예약 — pg_cron 대신 같은 모양의 가짜 cron 스키마(같은 이름이면 고쳐 쓰는 cron.schedule)
await db.exec(`create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text, schedule text not null, command text not null, active boolean not null default true);
  create table cron.job_run_details (runid bigserial primary key, jobid bigint, start_time timestamptz, end_time timestamptz, status text, return_message text);
  create function cron.schedule(p_name text, p_sched text, p_cmd text) returns bigint language plpgsql as $$
  declare v bigint; begin
    update cron.job set schedule = p_sched, command = p_cmd where jobname = p_name returning jobid into v;
    if v is null then insert into cron.job (jobname, schedule, command) values (p_name, p_sched, p_cmd) returning jobid into v; end if;
    return v; end $$;
  create function cron.unschedule(p_name text) returns boolean language plpgsql as $$ begin delete from cron.job where jobname = p_name; return found; end $$;`);
const SCHED_LOCAL = SCHED.replace('create extension if not exists pg_cron with schema pg_catalog;', '-- (로컬: 가짜 cron 스키마)');
t('A13 예약 SQL 은 Supabase 문서의 pg_cron 켜기 SQL 을 그대로 담음', SCHED.includes('create extension if not exists pg_cron with schema pg_catalog;') &&
  SCHED.includes('grant usage on schema cron to postgres;'));
r = await runAll(SCHED_LOCAL);
t('A14 예약 등록 · 확인 표: 하나 · 0 14 * * *(UTC) · 켜짐 · GMT · 다음 실행 23:00 KST',
  r.ok && r.rows.slice(0, 5).every(x => x['기대'] === x['실제']) && / 23:00 KST$/.test(r.rows[5]['실제']), r.error || JSON.stringify(r.rows));
r = await runAll(SCHED_LOCAL);
t('A15 다시 실행해도 예약은 하나(같은 이름은 고쳐 씀)', r.ok && +(await q1("select count(*) n from cron.job")).n === 1, r.error || '');
await db.exec("set cron.timezone = 'Asia/Seoul'");
r = await runAll(SCHED_LOCAL);
await db.exec("reset cron.timezone");
t('A16 pg_cron 시각 기준이 UTC 가 아니면 등록하지 않음', !r.ok && /cron.timezone/.test(r.error), r.error || '');
await db.exec("insert into cron.job (jobname, schedule, command) values ('other-reset', '0 15 * * *', 'select private.rehearsal_live_reset()')");
r = await runAll(SCHED_LOCAL);
await db.exec("delete from cron.job where jobname = 'other-reset'");
t('A17 이름이 다른 같은 초기화 예약이 있으면 멈춤(두 번 돌지 않게)', !r.ok && /다른 이름의 예약/.test(r.error), r.error || '');
const kst = await q1(`select bool_and(extract(hour from ((d::date + time '14:00') at time zone 'UTC') at time zone 'Asia/Seoul') = 23
                                      and extract(minute from ((d::date + time '14:00') at time zone 'UTC') at time zone 'Asia/Seoul') = 0) ok
                      from generate_series(date '2026-10-19', date '2026-11-30', interval '1 day') d`);
t('A18 0 14 * * *(UTC) = 매일 23:00 한국 시각(10-19 ~ 11-30 · 서머타임 없음)', kst.ok === true);
for (const id of REAL.slice(0, 10)) await tryAdmin(`select * from public.admin_rehearsal_set_live($1, 'open', 20)`, [id]);
const job = await q1("select jobid, command from cron.job where jobname = 'booth-rehearsal-reset'");
const before23 = await fp();
await db.exec(job.command);
const after23 = await fp();
await db.query("insert into cron.job_run_details (jobid, start_time, end_time, status, return_message) values ($1, '2026-10-19 14:00:00+00', '2026-10-19 14:00:01+00', 'succeeded', '1 row')", [job.jobid]);
s = await tryAdmin('select * from public.admin_rehearsal_status()');
t('A19 예약이 부르는 명령 그대로 실행: 실제 10곳 지움 · 예시 그대로 · 상태 on · 마지막 실행 10-19 23:00 KST 성공',
  +before23.real_n === 10 && +after23.real_n === 0 && after23.ex_live === f0.ex_live && s.ok && s.rows[0].reset_state === 'on' &&
  s.rows[0].reset_schedule === '0 14 * * *' && s.rows[0].last_status === 'succeeded' && new Date(s.rows[0].last_run_at).toISOString() === '2026-10-19T14:00:00.000Z');
r = await runAll(ROLLBACK);
const gone = await q1("select to_regprocedure('public.admin_rehearsal_set_live(uuid, text, integer)') is null a, (select count(*) from cron.job) j");
t('A20 되돌리기: 예약 지움 · 함수 지움 · 예시 대기 값 그대로', r.ok && gone.a === true && +gone.j === 0 && (await fp()).ex_live === f0.ex_live, r.error || '');
r = await runAll(MIG);
const r2 = await runAll(SCHED_LOCAL);
t('A21 다시 적용(함수 · 예약) 가능', r.ok && r2.ok && +(await q1("select count(*) n from cron.job")).n === 1);
await db.exec("delete from cron.job_run_details");
async function migIn(change, p) {   // 한 트랜잭션 안에서 DB 를 바꾼 뒤 migration 을 돌려 보고 모두 되돌림
  return db.transaction(async tx => { await tx.query(change, p); let out = 'applied'; try { await tx.exec(MIG); } catch (e) { out = e.message; } await tx.rollback(); return out; });
}
const pf1 = await migIn("update public.booths set org = '[예시] ' || org where id = $1", [S01]);
const pf2 = await migIn('delete from public.booths where id = $1', [idOf('R4-21')]);
t('A22 migration 의 대상 확인: 84곳 중 하나가 예시(기관 [예시])로 바뀌었거나 없으면 아무것도 바꾸지 않고 멈춤 · 그 뒤 DB 그대로',
  /DB 와 맞지 않습니다/.test(pf1) && /예시 1곳/.test(pf1) && /DB 와 맞지 않습니다/.test(pf2) && /DB 에 있음 83곳/.test(pf2) &&
  +(await q1(`select count(*) n from public.booths where id = any($1::uuid[]) and org !~ '^\\s*\\[예시\\]'`, [REAL])).n === 84, `${pf1} | ${pf2}`);

// ══ B. 관리자 화면(jsdom) ═══════════════════════════════════════════
const inline = (html, dir, files) => {
  for (const p of files) {
    const src = readFileSync(join(dir, p), 'utf8').replace(/<\/script/gi, '<\\/script');
    html = html.replace(new RegExp(`<script src="${p.replace(/[.]/g, '\\.')}"></script>`), () => `<script>${src}</script>`);
  }
  return html.replace(/<link[^>]+stylesheet[^>]*>/g, '');
};
const ADMIN_LINKS = [...readFileSync(join(MAIN, 'booth-admin.html'), 'utf8').matchAll(/<link[^>]+stylesheet[^>]*>/g)].map(m => m[0]).join('');
function adminHtml() {
  const html = readFileSync(join(MAIN, 'booth-admin.html'), 'utf8').replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>/g, '');
  return inline(html, MAIN, ['assets/config.js', 'assets/core.js', 'assets/ui.js', 'assets/booth-core.js', 'assets/mock-data.js', 'assets/admin-demo.js', 'assets/booth-admin.js']);
}
const DATE_KEYS = new Set(['cutoff', 'kst_today']);
// PostgREST 처럼: date 는 'YYYY-MM-DD', timestamptz 는 ISO 글자
const asJson = rows => JSON.parse(JSON.stringify(rows), (k, v) => (DATE_KEYS.has(k) && typeof v === 'string' ? v.slice(0, 10) : v));
async function openAdmin(hooks = {}) {
  const log = [], calls = [];
  const base = fakeSupabase(R, log).createClient();
  const client = Object.assign({}, base, {
    // PostgREST 처럼 JSON 으로(시각은 ISO 글자) — 가짜 클라이언트는 Date 객체를 그대로 넘깁니다
    from: table => { const b = base.from(table); const th = b.then; b.then = (ok, bad) => th.call(b, res => { if (res && res.data) res.data = asJson(res.data); return res; }).then(ok, bad); return b; },
    rpc: async (name, args) => {
      calls.push({ name, id: args && args.p_booth_id, mode: args && args.p_mode, wait: args && args.p_wait_minutes });
      if (hooks.before) { const h = await hooks.before(name, args, calls); if (h) return h; }
      const res = await base.rpc(name, args);
      if (res.data) res.data = asJson(res.data);
      return res;
    }
  });
  const dom = new JSDOM(adminHtml(), {
    url: 'https://sinjhon1245-cell.github.io/incheon-festival/booth-admin.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.supabase = { createClient: () => client };
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.scrollTo = () => {};
      w.console.warn = () => {};
    }
  });
  const errors = [];
  dom.window.addEventListener('error', e => errors.push(e.message));
  const d = dom.window.document;
  await until(() => d.querySelectorAll('#lv-list .lv').length > 0, 20000);
  return { dom, d, w: dom.window, log, calls, errors };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function openPanel(p) {
  click(p.w, p.d.querySelector('[data-rh-toggle]'));
  await until(() => !p.d.getElementById('lv-rh').hidden && !/확인하는 중/.test(text(p.d.getElementById('lv-rh'))));
  await wait(50);
}
const panel = p => text(p.d.getElementById('lv-rh'));
const modal = p => ({ title: text(p.d.getElementById('modal-title')), desc: (p.d.querySelector('.modal__desc') || {}).textContent || '', ok: p.d.getElementById('modal-ok') });
async function press(p, kind) {
  click(p.w, p.d.querySelector(`[data-rh="${kind}"]`));
  await until(() => !!p.d.getElementById('modal-ok'));
  return modal(p);
}
async function finish(p) { await until(() => /채웠습니다|비웠습니다|실패 \d+곳|닫혔습니다/.test(panel(p)) && !p.d.querySelector('.rhprog'), 30000); await wait(80); }
const toastText = p => text(p.d.getElementById('toast'));
const liveCount = async ids => +(await q1('select count(*) n from public.booth_live where booth_id = any($1::uuid[])', [ids])).n;
function dumpAdmin(p, name) {
  if (!dumpDir) return;
  const root = p.d.documentElement.cloneNode(true);
  root.querySelectorAll('script').forEach(x => x.remove());
  writeFileSync(resolve(dumpDir, name + '.html'), '<!doctype html>' + root.outerHTML.replace('<head>', '<head><base href="' + pathToFileURL(MAIN).href + '/">' + ADMIN_LINKS));
}
if (dumpDir) mkdirSync(dumpDir, { recursive: true });

let p = await openAdmin();
t('B1 관리자 화면: 머리에 “리허설 관리” 단추 · 칸은 닫힘 · 오류 없음',
  text(p.d.querySelector('[data-rh-toggle]')) === '리허설 관리' && p.d.getElementById('lv-rh').hidden && !p.errors.length, p.errors.join(' | '));
await openPanel(p);
t('B2 칸 열기: 실제 부스 84곳 · 지금 값 있음 0 / 84곳 · 자동 초기화 “매일 23:00 · 켜짐 · 아직 실행 전” · 11월 5일(목)까지 · 단추 둘',
  /실제 부스 84곳/.test(panel(p)) && /지금 값 있음\s*0 \/ 84곳/.test(panel(p)) && /매일 23:00 · 켜짐 · 아직 실행 전/.test(panel(p)) &&
  /11월 5일\(목\)까지/.test(panel(p)) && !!p.d.querySelector('[data-rh="fill"]') && !!p.d.querySelector('[data-rh="clear"]') &&
  /리허설 중 · 실제 대기시간이 아닙니다/.test(panel(p)), panel(p));
dumpAdmin(p, 'admin-panel');
let fA = await fp();
let m = await press(p, 'fill');
t('B3 채우기 확인창: 84곳 · 여유 32 · 보통 25 · 혼잡 17 · 잠시 중단 5 · 오늘 마감 5 · 관람객 사이트 리허설 안내 · 덮어쓰기 줄 없음',
  m.title === '리허설 대기시간을 채울까요?' && /실제 부스 84곳/.test(m.desc) && /여유 32 · 보통 25 · 혼잡 17 · 잠시 중단 5 · 오늘 마감 5곳/.test(m.desc) &&
  /리허설 중/.test(m.desc) && !/덮어씁니다/.test(m.desc) && text(m.ok) === '채우기', m.desc);
dumpAdmin(p, 'admin-confirm-fill');
const callsBefore = p.calls.length;
const seen = [];
let pokes = 0;
const mo = new p.w.MutationObserver(() => {
  const tx = panel(p), fb = p.d.querySelector('[data-rh="fill"]');
  seen.push({ tx, dis: !!(fb && fb.disabled) });
  // 보내는 중 다시 누름(채우기 · 비우기) — 무시돼야 함
  if (/채우는 중 \d+\/84/.test(tx) && pokes < 3) { pokes++; click(p.w, fb); click(p.w, p.d.querySelector('[data-rh="clear"]')); }
});
mo.observe(p.d.getElementById('lv-rh'), { childList: true, subtree: true, characterData: true });
click(p.w, m.ok);
await finish(p);
mo.disconnect();
const sawProgress = seen.some(x => /채우는 중 \d+\/84/.test(x.tx) && x.dis) && seen.some(x => /채우는 중 84\/84/.test(x.tx)) && pokes > 0 && !p.d.getElementById('modal-ok');
const progNote = `보임 ${seen.length} · 누름 ${pokes}`;
let fB = await fp();
const sent = p.calls.slice(callsBefore).filter(c => c.name === 'admin_rehearsal_set_live');
const dist = await q1(`select count(*) filter (where congestion = '여유') a, count(*) filter (where congestion = '보통') b, count(*) filter (where congestion = '혼잡') c,
  count(*) filter (where congestion = '중단') d, count(*) filter (where congestion = '마감') e from public.booth_live where booth_id = any($1::uuid[])`, [REAL]);
t('B4 채우기: 진행 표시 · 보내는 중 단추 잠김 · 함수 84번(중복 없음) · 실제 84줄 = 32 · 25 · 17 · 5 · 5',
  sawProgress && sent.length === 84 && new Set(sent.map(c => c.id)).size === 84 && sent.every(c => realSet.has(c.id)) &&
  +fB.real_n === 84 && [dist.a, dist.b, dist.c, dist.d, dist.e].map(Number).join() === '32,25,17,5,5', `${sent.length} ${JSON.stringify(dist)} ${progNote}`);
t('B5 예시 50줄 · QR · PIN · 세션 · 부스 · 구역 · 설정 그대로 · 대기 기록 +84(source admin) · admin_reset_booth_live 안 부름',
  fB.ex_live === fA.ex_live && fB.qr === fA.qr && fB.pin === fA.pin && fB.sessions === fA.sessions && fB.booths === fA.booths && fB.zones === fA.zones &&
  fB.settings === fA.settings && +fB.log_n === +fA.log_n + 84 &&
  +(await q1(`select count(*) n from public.booth_live_log where id > $1 and source <> 'admin'`, [fA.log_max])).n === 0 &&
  !p.calls.some(c => c.name === 'admin_reset_booth_live' || c.name === 'admin_set_booth_live'));
t('B6 끝: 알림 “실제 부스 84곳에 리허설 대기시간을 채웠습니다.” · 칸 결과 줄 · 지금 값 있음 84 / 84곳 · 단추 다시 열림',
  /실제 부스 84곳에 리허설 대기시간을 채웠습니다/.test(toastText(p)) && /실제 부스 84곳을 채웠습니다/.test(panel(p)) && /지금 값 있음\s*84 \/ 84곳/.test(panel(p)) &&
  !p.d.querySelector('[data-rh="fill"]').disabled, panel(p));
dumpAdmin(p, 'admin-filled');
// 같은 계획: 다시 채우면 같은 부스에 같은 값(UUID 순서)
const snapVals = async () => (await db.query('select booth_id::text id, congestion, wait_minutes from public.booth_live where booth_id = any($1::uuid[]) order by booth_id', [REAL])).rows.map(x => x.id + x.congestion + x.wait_minutes).join();
const vals1 = await snapVals();

// 운영자가 한 곳 입력(QR) → 다시 채우기 확인창에 덮어쓰기 안내
const tok = (await q1('select token from public.booth_access where booth_id = $1', [idOf('R2-05')])).token;
await R.asAnon(`select * from public.booth_ctrl_set($1, 'open', 45)`, [tok]);
p.dom.window.close();
p = await openAdmin();
await openPanel(p);
m = await press(p, 'fill');
t('B7 다시 채우기 확인창: “지금 값이 있는 84곳(운영자 입력 1곳 포함)은 새 시험 값으로 덮어씁니다.”',
  /지금 값이 있는 84곳\(운영자 입력 1곳 포함\)은 새 시험 값으로 덮어씁니다/.test(m.desc), m.desc);
click(p.w, p.d.querySelector('.modal [data-cancel], [data-cancel]'));
await wait(150);
t('B8 취소하면 아무것도 보내지 않음(운영자 값 45분 그대로)', !p.calls.some(c => c.name === 'admin_rehearsal_set_live') &&
  (await q1('select wait_minutes w from public.booth_live where booth_id = $1', [idOf('R2-05')])).w === 45);
p.dom.window.close();

// 부분 실패(네트워크) → 다시 시도
const failIds = new Set([idOf('R1-03'), idOf('R3-12')]);
let failOn = true;
p = await openAdmin({ before: (name, a) => (failOn && name === 'admin_rehearsal_set_live' && failIds.has(a.p_booth_id)
  ? { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } } : null) });
await openPanel(p);
m = await press(p, 'fill');
click(p.w, m.ok);
await finish(p);
t('B9 부분 실패: “성공 82곳 · 실패 2곳 (R1-03, R3-12)” · 까닭(네트워크) · “실패한 2곳 다시 시도” 단추 · 알림도 같은 수',
  /성공 82곳 · 실패 2곳 \(R1-03, R3-12\)/.test(panel(p)) && /네트워크에 연결하지 못했습니다/.test(panel(p)) &&
  text(p.d.querySelector('[data-rh="retry"]')) === '실패한 2곳 다시 시도' && /성공 82곳 · 실패 2곳/.test(toastText(p)), panel(p));
dumpAdmin(p, 'admin-partial');
failOn = false;
const nCalls = p.calls.length;
click(p.w, p.d.querySelector('[data-rh="retry"]'));
await finish(p);
const retried = p.calls.slice(nCalls).filter(c => c.name === 'admin_rehearsal_set_live');
t('B10 다시 시도: 그 2곳만 · 같은 계획 값 · “실제 부스 2곳을 채웠습니다.” · 84곳 모두 처음 채우기와 같은 값',
  retried.length === 2 && retried.every(c => failIds.has(c.id)) && /실제 부스 2곳을 채웠습니다/.test(panel(p)) && (await snapVals()) === vals1,
  `${retried.length} ${panel(p)}`);
p.dom.window.close();

// 비우기
p = await openAdmin();
await openPanel(p);
fA = await fp();
m = await press(p, 'clear');
t('B11 비우기 확인창: 84곳의 지금 대기 값 · 기록 · QR · PIN · 부스 · 예시 그대로 · 빨간 단추 “비우기”',
  m.title === '리허설 대기시간을 비울까요?' && /실제 부스 84곳의 지금 대기 값을 지워/.test(m.desc) && /지금 값 있는 곳 84곳/.test(m.desc) &&
  /대기 기록 · QR · PIN · 부스 정보 · 예시 부스는 그대로/.test(m.desc) && text(m.ok) === '비우기' && m.ok.classList.contains('btn--danger'), m.desc);
click(p.w, m.ok);
await finish(p);
fB = await fp();
t('B12 비우기: 실제 0줄 · 예시 50줄 그대로 · 대기 기록 그대로(지우기는 기록 없음) · QR · PIN 그대로 · “실제 부스 84곳을 비웠습니다.”',
  +fB.real_n === 0 && fB.ex_live === fA.ex_live && +fB.ex_n === 50 && fB.log_n === fA.log_n && fB.qr === fA.qr && fB.pin === fA.pin &&
  /실제 부스 84곳을 비웠습니다/.test(panel(p)) && /지금 값 있음\s*0 \/ 84곳/.test(panel(p)), panel(p));
p.dom.window.close();

// 보내는 중에 행사 시작(서버가 거절) → 남은 곳은 보내지 않음
let flipped = false;
p = await openAdmin({ before: async (name, a, calls) => {
  if (name === 'admin_rehearsal_set_live' && !flipped && calls.filter(c => c.name === 'admin_rehearsal_set_live').length > 20) {
    flipped = true; await db.exec("update public.settings set event_start = now() - interval '1 day' where id = 1");
  }
  return null;
} });
await openPanel(p);
m = await press(p, 'fill');
click(p.w, m.ok);
await finish(p);
const midSent = p.calls.filter(c => c.name === 'admin_rehearsal_set_live').length;
const midRows = await liveCount(REAL);
t('B13 보내는 중 행사 시작: 남은 부스는 보내지 않음 · 넣은 곳 = 성공 수 · 알림 “… 멈춤 — 성공 N곳 · 넣지 못함 M곳” · 칸은 “닫힘” + 마지막 실행 줄 · 다시 시도 단추 없음',
  flipped && midSent < 84 && midRows === midSent - (p.calls.filter(c => c.name === 'admin_rehearsal_set_live').length - midRows) &&
  /닫힘 · 행사 기간/.test(panel(p)) && /리허설 관리는 닫혔습니다/.test(panel(p)) && !p.d.querySelector('[data-rh="retry"]') &&
  /행사가 시작되어 .*멈춤 — 성공 \d+곳 · 넣지 못함 \d+곳/.test(toastText(p)) && /마지막 실행 .* · 성공 \d+곳 · 넣지 못함 \d+곳/.test(panel(p)) &&
  !p.d.querySelector('[data-rh="fill"]'), `보냄 ${midSent} · 줄 ${midRows} · ${toastText(p)} · ${panel(p).slice(-120)}`);
dumpAdmin(p, 'admin-closed');
p.dom.window.close();
p = await openAdmin();
await openPanel(p);
const closedCalls = p.calls.length;
t('B14 행사 기간에 열면: 닫힘 안내 · 채우기 · 비우기 단추 없음(서버도 거절 — A9)',
  /리허설 관리는 닫혔습니다/.test(panel(p)) && !p.d.querySelector('[data-rh="fill"]') && !p.d.querySelector('[data-rh="clear"]') &&
  !p.calls.slice(closedCalls).some(c => c.name === 'admin_rehearsal_set_live'));
p.dom.window.close();
await db.exec("update public.settings set event_start = '2026-11-06 01:00+00' where id = 1");
await db.exec('select private.rehearsal_live_reset()');

// DB 함수가 아직 없을 때(관리자 웹을 먼저 배포한 경우)
await runAll(ROLLBACK);
p = await openAdmin();
await openPanel(p);
t('B15 DB 함수 전: “리허설 관리용 DB 함수가 아직 없습니다” · 단추 없음 · 화면 오류 없음 · 나머지 현황 그대로',
  /DB 함수가 아직 없습니다/.test(panel(p)) && !p.d.querySelector('[data-rh="fill"]') && !p.errors.length && p.d.querySelectorAll('#lv-list .lv').length > 0, panel(p));
p.dom.window.close();
await runAll(MIG);
await runAll(SCHED_LOCAL);

// 예시 현황 채우기 · 비우기(같은 보내기 도구로 바꿈) 회귀 — 예시를 잠깐 공개해 봄
await db.exec("update public.zones set is_published = true where key in ('A','B','C','D','E')");
await db.exec(`update public.booths set is_published = true where id = any('{${exIds.join(',')}}'::uuid[])`);
await db.exec(`delete from public.booth_live where booth_id = any('{${exIds.join(',')}}'::uuid[])`);
p = await openAdmin();
const exBtn = p.d.getElementById('lv-example-fill');
click(p.w, exBtn);
await until(() => !!p.d.getElementById('modal-ok'));
click(p.w, p.d.getElementById('modal-ok'));
await until(() => /예시 부스 50곳에 현황을 채웠습니다/.test(toastText(p)), 20000);
const exN = await liveCount(exIds), realAfterEx = await liveCount(REAL);
const exDist = await q1(`select count(*) filter (where congestion = '여유') a, count(*) filter (where congestion = '보통') b, count(*) filter (where congestion = '혼잡') c,
  count(*) filter (where congestion = '중단') d, count(*) filter (where congestion = '마감') e from public.booth_live where booth_id = any($1::uuid[])`, [exIds]);
t('B16 회귀: 예시 현황 채우기 50곳 = 19 · 15 · 10 · 3 · 3 · 실제 부스 0곳 그대로 · admin_set_booth_live 만',
  exN === 50 && realAfterEx === 0 && [exDist.a, exDist.b, exDist.c, exDist.d, exDist.e].map(Number).join() === '19,15,10,3,3' &&
  !p.calls.some(c => c.name === 'admin_rehearsal_set_live'), JSON.stringify(exDist));
click(p.w, p.d.getElementById('lv-example-clear'));
await until(() => !!p.d.getElementById('modal-ok'));
click(p.w, p.d.getElementById('modal-ok'));
await until(() => /예시 부스 50곳의 현황을 비웠습니다/.test(toastText(p)), 20000);
t('B17 회귀: 예시 현황 비우기 50곳 → 0', (await liveCount(exIds)) === 0);
p.dom.window.close();
await db.exec(`update public.booths set is_published = false where id = any('{${exIds.join(',')}}'::uuid[])`);
await db.exec("update public.zones set is_published = false where key in ('A','B','C','D','E')");
for (const sx of snap) await db.query("insert into public.booth_live (booth_id, congestion, wait_minutes) values ($1, '보통', 15) on conflict (booth_id) do update set congestion = '보통', wait_minutes = 15", [sx.id]);

// ══ C. 관람객: 스냅샷 · 화면 ════════════════════════════════════════
globalThis.fetch = async (url) => {
  const u = String(url), i = u.indexOf('/rest/v1/');
  if (i < 0) throw new Error('예상 밖 요청: ' + u);
  const rr = await rest(u.slice(i + 9));
  return new Response(JSON.stringify(rr.body), { status: rr.status, headers: { 'content-type': 'application/json' } });
};
let modN = 0;
async function snapshotNow() {
  const mod = await import(pathToFileURL(join(LIVE, 'live/api/live-snapshot.mjs')).href + '?state=' + (++modN));
  const res = await mod.default.fetch(new Request('https://incheon-live.vercel.app/api/live-snapshot'));
  return { status: res.status, body: await res.text() };
}
// 관리자 화면으로 리허설 채우기(B 와 같은 길)
p = await openAdmin();
await openPanel(p);
m = await press(p, 'fill');
click(p.w, m.ok);
await finish(p);
p.dom.window.close();
const sn = await snapshotNow();
const J = JSON.parse(sn.body);
const withVal = J.booths.filter(b => b.status);
const tokens = (await db.query('select token from public.booth_access')).rows.map(x => x.token);
const pinHashes = (await db.query('select pin_hash from public.booth_pin')).rows.map(x => x.pin_hash);
t('C1 스냅샷(행사 전): 공개 부스 84곳 모두 대기 값(32 · 25 · 17 · 중단 5 · 마감 5) · 예시(비공개) 없음',
  sn.status === 200 && J.booths.length === 84 && withVal.length === 84 && J.booths.every(b => realSet.has(b.id)) &&
  ['여유', '보통', '혼잡', '중단', '마감'].map(c => J.booths.filter(b => b.status === c).length).join() === '32,25,17,5,5');
t('C2 스냅샷에 열쇠 · PIN 해시 · 세션 · 연락처 · [예시] 표시 없음 · 부스 칸은 공개 칸 10개뿐',
  !tokens.some(tk => sn.body.includes(tk)) && !pinHashes.some(h => sn.body.includes(h)) && !/token|pin_hash|session|contact|phone|email|\[예시\]/i.test(sn.body) &&
  J.booths.every(b => Object.keys(b).sort().join() === 'code,id,name,no,org,program,status,updatedAt,waitMinutes,zone'));

function fakeClock(w, at) {
  const RD = w.Date, off = at - RD.now();
  function FD(...a) { if (!new.target) return new RD(RD.now() + off).toString(); return a.length ? new RD(...a) : new RD(RD.now() + off); }
  FD.prototype = RD.prototype; FD.now = () => RD.now() + off; FD.UTC = RD.UTC; FD.parse = RD.parse;
  w.Date = FD;
}
const KST = iso => Date.parse(iso + '+09:00');
const VISITOR_LINKS = [...readFileSync(join(LIVE, 'visitor.html'), 'utf8').matchAll(/<link[^>]+stylesheet[^>]*>/g)].map(mm => mm[0]).join('');
function visitorHtml() {
  let html = readFileSync(join(LIVE, 'visitor.html'), 'utf8');
  for (const pth of ['assets/config.js', 'assets/mock-data.js', 'assets/booth-core.js']) {
    const src = readFileSync(join(LIVE, pth), 'utf8').replace(/<\/script/gi, '<\\/script');
    html = html.replace(new RegExp(`<script src="${pth.replace(/[.]/g, '\\.')}"></script>`), () => `<script>${src}</script>`);
  }
  return html.replace(/<link[^>]+stylesheet[^>]*>/g, '');
}
async function visitor(json, at) {
  const dom = new JSDOM(visitorHtml(), {
    url: 'https://incheon-live.vercel.app/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.scrollTo = () => {};
      w.fetch = u => (String(u).endsWith('/api/live-snapshot') ? Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(json)) }) : Promise.reject(new Error('예상 밖 ' + u)));
      w.console.warn = () => {};
      fakeClock(w, at);
    }
  });
  const errors = [];
  dom.window.addEventListener('error', e => errors.push(e.message));
  const d = dom.window.document;
  await until(() => d.querySelector('#list .row, #list .empty'), 8000, 40);
  await wait(120);
  return { dom, d, w: dom.window, errors };
}
function dumpVisitor(v, name) {
  if (!dumpDir) return;
  const root = v.d.documentElement.cloneNode(true);
  root.querySelectorAll('script').forEach(x => x.remove());
  writeFileSync(resolve(dumpDir, name + '.html'), '<!doctype html>' + root.outerHTML.replace('<head>', '<head><base href="' + pathToFileURL(LIVE).href + '/">' + VISITOR_LINKS));
}
const rows = v => [...v.d.querySelectorAll('#list .row')].filter(el => !el.hidden);
// 시험 시각과 데이터 기준일 맞추기: 복제 DB 는 값을 실제 시각(now())으로 저장하고, 스냅샷도 실제 시각에 만듭니다.
// 그래서 관람객 화면의 시계를 날짜 하나(예전: 10-19 15:00)로 고정하면, 다른 날 돌릴 때 ‘오늘 넣은 값’ 이 미래 · 어제 값이 되어
// 리허설 표시가 사라집니다(10-20 실행에서 C3~C11 실패). 이 묶음은 ‘행사 전 · 오늘 넣은 값’ 을 보는 시험이므로 화면 시계를
// 스냅샷을 만든 시각(generatedAt)에 맞춥니다. 행사 날 · 다음 날 · 23시 뒤는 아래 C12~C15 · E 에서 시각을 따로 정해 봅니다.
const kstDay = ms => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
const DATA_AT = Date.parse(J.generatedAt);
const valueDays = [...new Set(J.booths.filter(b => b.updatedAt).map(b => kstDay(Date.parse(b.updatedAt))))];
t('C0 시험 기준 시각 = 스냅샷을 만든 시각 · 값 84곳의 저장일(KST)이 모두 그날 · 행사 첫날(11-06) 전',
  Number.isFinite(DATA_AT) && valueDays.length === 1 && valueDays[0] === kstDay(DATA_AT) && kstDay(DATA_AT) < '2026-11-06',
  `${J.generatedAt} · 값 저장일 ${valueDays.join(',')}`);
let v = await visitor(J, DATA_AT);
const bar = v.d.getElementById('rhbar');
t('C3 관람객(행사 전 · 값 있음): 맨 위 “리허설 중 · 실제 대기시간이 아닙니다.” 띠 · html.is-rehearsal · 오류 없음',
  !bar.hidden && text(bar) === '리허설 중 · 실제 대기시간이 아닙니다.' && v.d.documentElement.classList.contains('is-rehearsal') && !v.errors.length, text(bar) + v.errors.join('|'));
t('C4 큰 숫자: 지금 여유로운 부스 32곳 · 전체 84곳 · 아래 “행사 전 리허설 값이에요. 실제 대기시간은 11월 6일(금) 10:00부터 표시돼요.”',
  text(v.d.getElementById('h-free')) === '32' && text(v.d.getElementById('h-total')) === '84' &&
  text(v.d.getElementById('h-rh')) === '행사 전 리허설 값이에요. 실제 대기시간은 11월 6일(금) 10:00부터 표시돼요.', text(v.d.getElementById('hero')));
const countN = k => text(v.d.querySelector(`[data-count="${k}"] [data-n]`));
t('C5 상태별 수: 여유 32 · 보통 25 · 혼잡 17 · 중단·마감 10', ['여유', '보통', '혼잡', 'off'].map(countN).join() === '32,25,17,10');
t('C6 목록 84줄 · 줄마다 대기 값(정보 없음 없음)', rows(v).length === 84 && !rows(v).some(el => /정보 없음/.test(text(el))), `${rows(v).length}`);
dumpVisitor(v, 'visitor-rehearsal');
click(v.w, v.d.querySelector('[data-count="혼잡"]'));
await wait(150);
t('C7 거르기(혼잡): 17줄 · 모두 혼잡', rows(v).length === 17 && rows(v).every(el => /혼잡/.test(text(el))), `${rows(v).length}`);
click(v.w, v.d.querySelector('[data-count="혼잡"]'));
await wait(100);
const tabs = [...v.d.querySelectorAll('#tabs button')].map(text);
t('C8 구역 탭: R1 · R2 · R3 · R4(리허설용 임시구역)', ['R1', 'R2', 'R3', 'R4'].every(z => tabs.some(tx => tx.includes(z))), tabs.join(' / '));
const input = v.d.querySelector('#q');
input.value = '인천신석초등학교';
input.dispatchEvent(new v.w.Event('input', { bubbles: true }));
await wait(200);
t('C9 검색 “인천신석초등학교”: R1-01 한 줄 · 대기 값 보임', rows(v).length === 1 && /R1-01/.test(text(rows(v)[0])) && /(바로|\d+분|중단|마감)/.test(text(rows(v)[0])), rows(v).length + ' ' + rows(v).map(el => text(el).slice(0, 12)).join(' / '));
input.value = '';
input.dispatchEvent(new v.w.Event('input', { bubbles: true }));
await wait(150);
click(v.w, v.d.querySelector('[data-sort="wait"]'));
await wait(150);
const firstW = text(rows(v)[0]);
t('C10 정렬 “대기 짧은 순”: 맨 위가 바로 입장(0분)', /바로/.test(firstW), firstW.slice(0, 60));
click(v.w, v.d.querySelector('[data-view="grid"]'));
await wait(150);
const zov = text(v.d.querySelector('.zov'));
t('C11a 한눈에(구역별 현황): R1 ~ R4 구역마다 시험 값 요약', !!v.d.querySelector('.zov') && ['R1', 'R2', 'R3', 'R4'].every(z => zov.includes(z)), zov.slice(0, 160));
dumpVisitor(v, 'visitor-overview');
click(v.w, [...v.d.querySelectorAll('#tabs button')].find(b => /R1/.test(text(b))));
await wait(150);
const tile = v.d.querySelector('.tile');
click(v.w, tile);
await wait(150);
t('C11 한눈에 · 구역 탭 R1 → 타일(84칸) · 누르면 아래 상세에 그 부스 대기 값', v.d.querySelectorAll('.tile').length === 84 && !v.d.getElementById('sheet').hidden &&
  /(바로|분|중단|마감)/.test(text(v.d.getElementById('sheet-body'))), `${v.d.querySelectorAll('.tile').length} sheet:${v.d.getElementById('sheet').hidden} ${text(v.d.getElementById('sheet-body')).slice(0, 80)}`);
v.dom.window.close();
// 값이 하나도 없으면(23시 초기화 뒤 등): 띠 없음 · 원래 행사 전 화면
const J0 = JSON.parse(JSON.stringify(J)); J0.booths.forEach(b => { b.status = null; b.waitMinutes = null; b.updatedAt = null; });
v = await visitor(J0, KST('2026-10-19T23:30'));
t('C12 값이 없으면(23시 초기화 뒤): 리허설 띠 없음 · “개막까지 D-18” 행사 전 화면 그대로',
  v.d.getElementById('rhbar').hidden && !v.d.documentElement.classList.contains('is-rehearsal') && /개막까지/.test(text(v.d.getElementById('hero'))) && /D-18/.test(text(v.d.getElementById('hero'))),
  text(v.d.getElementById('hero')));
v.dom.window.close();
// 행사 당일: 전날(10-19 · 11-05)의 리허설 값 — 23시 초기화가 빠졌어도 '지금 대기' 로 안 보임
const stale = JSON.parse(JSON.stringify(J)); stale.booths.forEach(b => { b.updatedAt = '2026-11-05T22:50:00+09:00'; });
v = await visitor(stale, KST('2026-11-06T09:20'));
t('C13 행사 당일 09:20(문 열기 전): 전날 리허설 값 모두 숨김 · 리허설 띠 없음 · “오늘 10:00에 문을 열어요”',
  v.d.getElementById('rhbar').hidden && /10:00에 문을 열어요/.test(text(v.d.getElementById('hero'))) && rows(v).every(el => !/\d+분|바로/.test(text(el).replace(/R\d-\d+/, ''))),
  text(v.d.getElementById('hero')));
v.dom.window.close();
const mixed = JSON.parse(JSON.stringify(stale));
const live1 = mixed.booths.find(b => b.code === 'R1-01'); live1.status = '혼잡'; live1.waitMinutes = 40; live1.updatedAt = '2026-11-06T10:30:00+09:00';
const early = mixed.booths.find(b => b.code === 'R1-02'); early.status = '여유'; early.waitMinutes = 5; early.updatedAt = '2026-11-06T09:40:00+09:00';
v = await visitor(mixed, KST('2026-11-06T11:00'));
const rowOf = c => rows(v).find(el => text(el).includes(c));
t('C14 행사 당일 11:00(운영 중): 전날 값 · 문 열기 전(09:40) 값은 “정보 없음” · 10:30 운영자 값만 보임(40분) · 리허설 띠 없음',
  v.d.getElementById('rhbar').hidden && text(v.d.getElementById('h-free')) === '0' && /40/.test(text(rowOf('R1-01'))) &&
  /정보 없음/.test(text(rowOf('R1-02'))) && /정보 없음/.test(text(rowOf('R4-21'))), `${text(rowOf('R1-01'))} | ${text(rowOf('R1-02'))}`);
v.dom.window.close();

const yest = JSON.parse(JSON.stringify(J)); yest.booths.forEach(b => { b.updatedAt = '2026-10-19T15:00:00+09:00'; });
v = await visitor(yest, KST('2026-10-20T09:00'));
t('C15 행사 전 다음 날(10-20) · 어제 값이 담긴 스냅샷(브라우저에 남은 것 등): 화면도 어제 값은 안 씀 · 리허설 띠 없음 · D-day',
  v.d.getElementById('rhbar').hidden && /개막까지/.test(text(v.d.getElementById('hero'))) && rows(v).every(el => !/\d+분|바로/.test(text(el).replace(/R\d-\d+/, ''))));
v.dom.window.close();

// ══ D. 운영자 화면(booth-ctrl) ═════════════════════════════════════
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
    catch (e) { status = e.code === '42501' ? 401 : 400; body = { code: e.code, message: e.message }; }
  } else { status = 405; body = {}; }
  const out = JSON.stringify(body);
  return { ok: status < 400, status, text: async () => out, json: async () => body, headers: { get: () => 'application/json' } };
}
function ctrlHtml() {
  let html = readFileSync(join(LIVE, 'booth-ctrl.html'), 'utf8');
  for (const pth of ['assets/config.js', 'assets/booth-core.js', 'assets/mock-data.js']) {
    const src = readFileSync(join(LIVE, pth), 'utf8').replace(/<\/script/gi, '<\\/script');
    html = html.replace(new RegExp(`<script src="${pth.replace(/[.]/g, '\\.')}"></script>`), () => `<script>${src}</script>`);
  }
  return html.replace(/<link[^>]+stylesheet[^>]*>/g, '');
}
const t421 = (await q1('select token from public.booth_access where booth_id = $1', [idOf('R4-21')])).token;
const cdom = new JSDOM(ctrlHtml(), {
  url: 'https://incheon-live.vercel.app/booth-ctrl.html#k=' + t421, runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(w) {
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    w.scrollTo = () => {}; w.fetch = anonFetch; w.console.warn = () => {};
    fakeClock(w, Date.now());
  }
});
const cd = cdom.window.document, cw = cdom.window;
const cerr = []; cw.addEventListener('error', e => cerr.push(e.message));
await until(() => !cd.getElementById('v-confirm').hidden, 8000);
click(cw, cd.getElementById('cf-yes'));
await until(() => !cd.getElementById('now-note').hidden, 8000);
const note = text(cd.getElementById('now-note'));
const nowBefore = text(cd.getElementById('now'));
const logMax0 = +(await q1('select max(id) m from public.booth_live_log')).m;
click(cw, cd.querySelector('.w[data-wait="15"]'));
await until(() => /반영했습니다/.test(text(cd.getElementById('toast'))), 8000);
const ctoast = text(cd.getElementById('toast'));
const lastLog = await q1('select booth_id::text id, source, wait_minutes from public.booth_live_log where id > $1 order by id desc limit 1', [logMax0]);
t('D1 운영자 화면(행사 전): 관리자가 채운 값이 보이고 · 안내 “행사 전 리허설이에요. 누른 값은 관람객 화면에 ‘리허설 중’ 안내와 함께 보여요.”',
  /(바로|\d+|중단|마감)/.test(nowBefore) && note === '행사 전 리허설이에요. 누른 값은 관람객 화면에 ‘리허설 중’ 안내와 함께 보여요.' && !cerr.length, note);
t('D2 운영자 15분 누름 → 관리자 값을 덮어씀(기록 source set) · 알림 “관람객 화면에 ‘리허설 중’ 안내와 함께 보여요.”',
  lastLog && lastLog.id === idOf('R4-21') && lastLog.source === 'set' && lastLog.wait_minutes === 15 && /관람객 화면에 ‘리허설 중’ 안내와 함께 보여요/.test(ctoast), ctoast);
cdom.window.close();
const sn2 = JSON.parse((await snapshotNow()).body);
t('D3 관람객 스냅샷에 운영자 값 반영(R4-21 보통 15분)', sn2.booths.find(b => b.code === 'R4-21').waitMinutes === 15 && sn2.booths.find(b => b.code === 'R4-21').status === '보통');
p = await openAdmin();
await openPanel(p);
m = await press(p, 'fill');
t('D4 관리자 다시 채우기 확인창이 운영자 입력 1곳을 알림(덮어쓰기 전 안내)', /운영자 입력 1곳 포함/.test(m.desc), m.desc);
click(p.w, m.ok);
await finish(p);
t('D5 관리자 채우기가 운영자 값을 다시 덮어씀(R4-21 = 처음 계획 값) · 다음 운영자 입력이 다시 이김(서로 같은 표 · 같은 규칙)',
  (await snapVals()) === vals1);
p.dom.window.close();
await db.exec('select private.rehearsal_live_reset()');

// ══ E. 공개 API(스냅샷)의 때 규칙 — 브라우저와 같은 규칙을 서버가 먼저 적용 ═══════════════
async function snapAt(at, mod) {
  mod = mod || await import(pathToFileURL(join(LIVE, 'live/api/live-snapshot.mjs')).href + '?state=' + (++modN));
  const real = Date.now; Date.now = () => at;
  try {
    const res = await mod.default.fetch(new Request('https://incheon-live.vercel.app/api/live-snapshot'));
    return { mod, status: res.status, src: res.headers.get('x-snapshot-source'), json: JSON.parse(await res.text()) };
  } finally { Date.now = real; }
}
const isoK = k => new Date(KST(k)).toISOString();
const setAt = (when, ids = REAL) => db.query(`insert into public.booth_live (booth_id, congestion, wait_minutes, updated_at)
  select x, '보통', 15, $2::timestamptz from unnest($1::uuid[]) x
  on conflict (booth_id) do update set congestion = '보통', wait_minutes = 15, updated_at = excluded.updated_at`, [ids, isoK(when)]);
const shownN = j => j.booths.filter(b => b.status !== null).length;
const shownCodes = j => j.booths.filter(b => b.status !== null).map(b => b.code).sort().join(',');
const realRows = async () => liveCount(REAL);
await setAt('2026-10-19T15:00:00');
let e = await snapAt(KST('2026-10-19T15:30:00'));
t('E1 행사 전(10-19 15:30) · 오늘 넣은 값: 공개 API 84곳 모두 값(리허설)', shownN(e.json) === 84);
t('E2 응답 구조 그대로: version · generatedAt · mode · liveReady · event · zones · booths · unplaced · 부스 칸 10개',
  Object.keys(e.json).sort().join() === 'booths,event,generatedAt,liveReady,mode,unplaced,version,zones' && e.json.booths.every(b => Object.keys(b).length === 10));
e = await snapAt(KST('2026-10-20T09:00:00'));
t('E3 행사 전 다음 날(10-20 09:00) · 23시 초기화가 빠져 어제 값이 남음: 공개 API 0', shownN(e.json) === 0 && (await realRows()) === 84);
await setAt('2026-11-05T22:50:00');
e = await snapAt(KST('2026-11-05T23:30:00'));
t('E4 11-05 23:30 · 그날 넣은 값(23시 초기화 실패 가정): 아직 행사 전이라 리허설로 84(화면은 리허설 띠)', shownN(e.json) === 84);
for (const [when, label] of [['2026-11-06T00:00:30', '00:00:30'], ['2026-11-06T00:30:00', '00:30'], ['2026-11-06T09:59:00', '09:59']]) {
  e = await snapAt(KST(when));
  t(`E5 11-06 ${label}(행사 날 · 문 열기 전): 전날 리허설 값 84줄이 남아 있어도 공개 API 0`, shownN(e.json) === 0 && (await realRows()) === 84);
}
await setAt('2026-11-06T09:40:00', [idOf('R1-02')]);
await setAt('2026-11-06T10:20:00', [idOf('R1-01')]);
e = await snapAt(KST('2026-11-06T10:30:00'));
t('E6 11-06 10:30(운영 중): 10:20 값(R1-01)만 · 09:40 개장 전 값(R1-02) · 전날 리허설 값 82곳은 공개 API 에서 빠짐', shownCodes(e.json) === 'R1-01', shownCodes(e.json).slice(0, 80));
for (const [when, label] of [['2026-11-06T17:00:00', '11-06 17:00(닫음)'], ['2026-11-06T23:00:00', '11-06 23:00'], ['2026-11-07T09:30:00', '11-07 09:30(둘째 날 문 열기 전)']]) {
  e = await snapAt(KST(when));
  t(`E7 ${label}: 공개 API 0`, shownN(e.json) === 0);
}
await setAt('2026-11-07T10:15:00', [idOf('R1-03')]);
e = await snapAt(KST('2026-11-07T11:00:00'));
t('E8 11-07 11:00(둘째 날 운영 중): 그날 10:15 값(R1-03)만 · 첫날 값(R1-01 10:20) 빠짐', shownCodes(e.json) === 'R1-03', shownCodes(e.json).slice(0, 80));
for (const [when, label] of [['2026-11-07T17:30:00', '11-07 17:30(행사 끝)'], ['2026-11-08T12:00:00', '11-08(행사 뒤)']]) {
  e = await snapAt(KST(when));
  t(`E9 ${label}: 공개 API 0`, shownN(e.json) === 0);
}
// 마지막 정상본(Supabase 장애) — 때가 바뀌면 받아 둔 값으로 다시 만듦
const realFetch = globalThis.fetch;
const down = async () => { throw new Error('supabase 장애(시험)'); };
await db.exec('select private.rehearsal_live_reset()');   // 앞 시험의 11-07 값(미래 시각)을 지움
await setAt('2026-11-06T10:20:00', [idOf('R1-01')]);
let m1 = await snapAt(KST('2026-11-06T16:59:50'));
globalThis.fetch = down;
let m2 = await snapAt(KST('2026-11-06T17:00:10'), m1.mod);
globalThis.fetch = realFetch;
t('E10 마지막 정상본(16:59:50 · R1-01 보임)을 Supabase 장애 중 17:00:10 에 내줄 때: 지금 때로 다시 만들어 대기 값 0',
  shownCodes(m1.json) === 'R1-01' && m2.status === 200 && m2.src === 'last-good' && shownN(m2.json) === 0, `${m2.status} ${m2.src} ${shownN(m2.json)}`);
await setAt('2026-11-05T22:50:00');
m1 = await snapAt(KST('2026-11-05T23:59:50'));
globalThis.fetch = down;
m2 = await snapAt(KST('2026-11-06T00:00:10'), m1.mod);
globalThis.fetch = realFetch;
t('E11 자정 경계: 11-05 23:59:50 정상본(리허설 84)을 장애 중 11-06 00:00:10 에 내줄 때 0',
  shownN(m1.json) === 84 && m2.src === 'last-good' && shownN(m2.json) === 0, `${shownN(m1.json)} → ${shownN(m2.json)} ${m2.src}`);
t('E12 공개 API 응답에 열쇠 · PIN 해시 · 세션 · 연락처 없음(때마다)', [m1, m2, e].every(x => !tokens.some(tk => JSON.stringify(x.json).includes(tk)) && !/token|pin_hash|session|contact|phone|email/i.test(JSON.stringify(x.json))));
await db.exec('select private.rehearsal_live_reset()');

// ══ F. 최종 배치로 옮긴 뒤 — 구역 · 번호 · 기관 이름이 바뀌어도 같은 84곳 ═══════════════════
await db.exec("insert into public.zones (key, label, sort_order, is_published) values ('SW', '시험 최종 스쿨존', 30, true), ('AI', '시험 최종 AI존', 31, true)");
for (const [i, id] of REAL.entries()) await db.query('update public.booths set zone_key = $2, no = $3 where id = $1', [id, i < 42 ? 'SW' : 'AI', (i % 42) + 1]);
await db.exec("update public.zones set is_published = false where key in ('R1', 'R2', 'R3', 'R4')");
await db.query("update public.booths set org = org || ' (기관명 수정)' where id = $1", [S01]);
const moved = await q1(`select count(*) filter (where zone_key in ('SW', 'AI') and is_published) n, min(code) filter (where id = $2) c from public.booths where id = any($1::uuid[])`, [REAL, S01]);
s = await tryAdmin('select * from public.admin_rehearsal_status()');
x1 = await tryAdmin(`select * from public.admin_rehearsal_set_live($1, 'open', 5)`, [idOf('R4-21')]);
t('F1 최종 배치 흉내(84곳 → SW · AI 구역 · 새 번호, R1~R4 비공개, R1-01 기관명 수정): 대상 84 그대로 · 옮긴 부스(AI-42) 넣기 됨',
  +moved.n === 84 && moved.c === 'SW-01' && s.ok && s.rows[0].target_ids.length === 84 && s.rows[0].target_ids.every(id => realSet.has(id)) && x1.ok && x1.rows[0].wait_minutes === 5, JSON.stringify(moved));
fA = await fp();
p = await openAdmin();
await openPanel(p);
m = await press(p, 'fill');
click(p.w, m.ok);
await finish(p);
fB = await fp();
const fSent = p.calls.filter(c => c.name === 'admin_rehearsal_set_live');
t('F2 관리자 화면(최종 배치 뒤): 채우기 84번 · 실제 84줄 · 목록에 새 번호(SW-01) · 예시 · QR · PIN 그대로',
  fSent.length === 84 && fSent.every(c => realSet.has(c.id)) && +fB.real_n === 84 && fB.ex_live === fA.ex_live && fB.qr === fA.qr && fB.pin === fA.pin &&
  /실제 부스 84곳을 채웠습니다/.test(panel(p)) && /SW-01/.test(text(p.d.getElementById('lv-list'))), panel(p).slice(-60));
p.dom.window.close();
const nReset = (await q1('select private.rehearsal_live_reset() n')).n;
t('F3 최종 배치 뒤 23시 초기화: 84곳 지움 · 예시 50줄 그대로', nReset === 84 && (await liveCount(REAL)) === 0 && (await fp()).ex_live === fA.ex_live && +(await fp()).ex_n === 50);

// ══ 보고 ═════════════════════════════════════════════════════════════
const pass = results.filter(x => x.ok).length;
mkdirSync(resolve(OUT, 'rehearsal'), { recursive: true });
writeFileSync(resolve(OUT, 'rehearsal', 'rehearsal-test-report.md'), [
  '# 리허설 대기시간 기능 — 로컬 시험 결과', '',
  `- 관리자 · SQL: ${MAIN.replace(/\\/g, '/')} · 관람객 · 운영자 · API: ${LIVE.replace(/\\/g, '/')}`,
  '- 복제 DB: 지금 Production 단계(migration-booth-preview → C-02 → Q-02 → T-02 → T-03) · 열쇠 · PIN 은 가짜 값(출력 없음)',
  `- 결과: ${pass}/${results.length} 통과`, '',
  '| 결과 | 항목 | 비고 |', '|---|---|---|',
  ...results.map(x => `| ${x.ok ? '통과' : '**실패**'} | ${x.name.replace(/\|/g, '/')} | ${x.ok ? '' : String(x.note).replace(/\|/g, '/').slice(0, 200)} |`)
].join('\n') + '\n');
console.log(`\n${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
