/* ===================================================================
   운영자 알림 시험 — migration-booth-notice.sql · 관리자 화면(booth-admin) · 운영자 화면(booth-ctrl)
   ───────────────────────────────────────────────────────────────────
   복제 DB(지금 Production 단계, lib/ui-harness prepReplica)에 --main-dir 의 적용 · 되돌리기 SQL 을 얹고,
   관리자 화면은 --main-dir(main 기반 브랜치), 운영자 화면은 --live-dir(booth-live 기반 브랜치)에서 엽니다.
     S  설치 — 두 번 적용 · 확인 표 · 기존 함수 지문 · booth_live / booth_live_log 그대로 · 기본 꺼짐
     A  권한 — 관리자 함수 anon · 비관리자 거절 · 표 직접 접근 불가 · 운영자 함수는 열쇠 · 세션으로만 · GET 거절
     B  꺼짐 — 보내기 거절(notice_off) · 운영자 목록 빈 + 꺼짐
     C  보내기 — 대상 다시 셈(확인 필요 · 미입력 · 구역 · 전체) · 고른 부스 중 대상 아님 · 10분 안 같은 종류 제외 · 문구 규칙 · 기록
     D  운영자 — QR · PIN 자기 부스만 · 다른 부스 알림 id 는 없음과 같음 · 표시 · 확인 기록 · 만료 · 끝난 세션 · 꺼진 QR
     E  운영 기록 그대로 — 모든 알림 호출 앞뒤 booth_live · booth_live_log 지문 같음
     F  관리자 화면 — 함수 없음 ‘준비 중’ · 꺼짐 ‘꺼짐’ · 켜짐: 대상 · 문구 · 보내기 · 대기 / 화면에 표시됨 / 운영자 확인 · 10분 제외
     G  운영자 화면 — 설정 꺼짐이면 묻지 않음 · 서버 꺼짐이면 띠 없음 · 띠 · 보일 때만 표시됨 · 확인했어요 · 대기 입력 그대로 ·
        PIN 화면 · 연결 오류는 늘려 다시 묻기 · 함수 없음이면 더 묻지 않음
     R  되돌리기 — 두 번 · 함수만 사라지고 기록 · 켜짐 여부 남음 · 다시 적용
   ⚠️ 네트워크 · Production 접속 없음. 열쇠 · PIN · 세션은 복제 DB 의 가짜 값이고 출력하지 않습니다.
   쓰는 법: node --max-old-space-size=8192 scripts/booth-data/test-booth-notice.mjs --pglite-dir <> --jsdom-dir <> --main-dir <main 브랜치> --live-dir <booth-live 브랜치>
   결과: out/rehearsal/booth-notice-test-report.md
   =================================================================== */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readCsv } from './lib/csv.mjs';
import { loadPglite, ADMIN } from './lib/replica.mjs';
import { prepReplica, openPage, until, wait, text, click, fakeClock } from './lib/ui-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT = resolve(HERE, 'out');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const MAIN = resolve(arg('main-dir', REPO));
const LIVE = resolve(arg('live-dir', REPO));
const { JSDOM, VirtualConsole } = createRequire(join(resolve(arg('jsdom-dir')), 'package.json'))('jsdom');
const lib = await loadPglite(arg('pglite-dir'));
const manifest = readCsv(resolve(OUT, 'staging', 'manifest.csv'));
const plan = readCsv(resolve(OUT, 'gate4r', 'plan-R.csv'));
const snap = readCsv(resolve(OUT, readdirSync(OUT).filter(f => /^prod-snapshot-\d{8}\.csv$/.test(f)).sort().pop()));
const REAL = plan.map(p => p['부스ID']);
const idOf = c => { const p = plan.find(x => x['표시코드'] === c); if (!p) throw new Error('부스 없음 ' + c); return p['부스ID']; };
const codeOf = id => (plan.find(x => x['부스ID'] === id) || {})['표시코드'] || id;
const MIG = readFileSync(join(MAIN, 'supabase/migration-booth-notice.sql'), 'utf8');
const RB = readFileSync(join(MAIN, 'supabase/rollback-booth-notice.sql'), 'utf8');
const ADMIN2 = '00000000-0000-4000-8000-00000000a002';
const STAFF = '00000000-0000-4000-8000-00000000a0aa';
const COMMON = '123456';   // 복제 DB 의 리허설 공통 PIN(서버 함수에 이미 있는 값) — 출력하지 않음

const results = [];
let section = '';
function t(name, ok, note = '') { results.push({ section, name, ok: !!ok, note: ok ? '' : String(note).slice(0, 500) }); console.log(`${ok ? '통과' : '실패'}  ${name}${note && !ok ? '  — ' + String(note).slice(0, 500) : ''}`); }

const { R, db, rest } = await prepReplica({ lib, snap, manifest, here: HERE, repo: REPO, mainDir: MAIN });
const q1 = async (sql, p) => (await db.query(sql, p)).rows[0];
const qa = async (sql, p) => (await db.query(sql, p)).rows;
const kstMin = +(await q1("select (extract(hour from now() at time zone 'Asia/Seoul') * 60 + extract(minute from now() at time zone 'Asia/Seoul'))::int m")).m;
if (kstMin < 75 || kstMin > 20 * 60 + 50) { console.error('KST 01:15~20:50 에 돌려 주세요(30분 넘은 오늘 값 · 3시간 만료를 만들기 위해).'); process.exit(2); }

async function as(uid, sql, p, role, method) {
  try {
    return { ok: true, rows: await db.transaction(async tx => {
      if (uid) await tx.query("select set_config('test.uid', $1, true)", [uid]);
      if (method) await tx.query("select set_config('request.method', $1, true)", [method]);
      if (role) await tx.exec(`set local role ${role}`);
      return (await tx.query(sql, p)).rows;
    }) };
  } catch (e) { return { ok: false, code: e.code, hint: e.hint, message: e.message }; }
}
const send = (uid, kind, zone, ids, body) => as(uid, 'select * from public.admin_send_booth_notice($1, $2, $3::uuid[], $4)', [kind, zone, ids, body], 'authenticated');
const status = (uid = ADMIN) => as(uid, 'select * from public.admin_booth_notice_status(12)', [], 'authenticated');
const ctrl = (tok, action, id, method) => as(null, 'select public.booth_ctrl_notice($1, $2, $3) r', [tok, action, id || null], 'anon', method).then(x => x.ok ? Object.assign(x, { r: x.rows[0].r }) : x);
const sessN = (s, action, id) => as(null, 'select public.booth_session_notice($1, $2, $3) r', [s, action, id || null], 'anon').then(x => x.ok ? Object.assign(x, { r: x.rows[0].r }) : x);
const setOn = on => db.query('update public.booth_notice_config set enabled = $1, updated_at = now() where id = 1', [on]);
const liveFp = async () => (await q1(`select md5(coalesce(string_agg(row(l.*)::text, ',' order by l.booth_id), '')) a,
  (select md5(coalesce(string_agg(row(g.*)::text, ',' order by g.id), '')) from public.booth_live_log g) b from public.booth_live l`));
const sameFp = (x, y) => x.a === y.a && x.b === y.b;
const fnFp = async () => (await q1(`select md5(string_agg(n.nspname || '.' || p.proname || md5(pg_get_functiondef(p.oid)), ',' order by n.nspname, p.proname, p.oid)) h, count(*) n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private', 'auth') and p.prokind = 'f'
    and p.proname not in ('booth_ctrl_notice', 'booth_session_notice', 'admin_booth_notice_enabled', 'admin_send_booth_notice', 'admin_booth_notice_status', 'booth_notice_op', 'booth_notice_on')`));
async function setLive(code, cong, w, ago) {
  await db.query(`insert into public.booth_live (booth_id, congestion, wait_minutes, updated_at) values ($1, $2, $3, date_trunc('milliseconds', now() - make_interval(mins => $4)))
    on conflict (booth_id) do update set congestion = excluded.congestion, wait_minutes = excluded.wait_minutes, updated_at = excluded.updated_at`, [idOf(code), cong, w, ago]);
}
const tokOf = async code => (await q1('select token from public.booth_access where booth_id = $1', [idOf(code)])).token;
const targetOf = async (nid, code) => q1('select * from public.booth_notice_target where notice_id = $1 and booth_id = $2', [nid, idOf(code)]);

// ══ S 설치 ══════════════════════════════════════════════════════════════
section = 'S 설치';
await db.query("insert into public.staff_profiles (id, role, name) values ($1, 'admin', '두번째 관리자'), ($2, 'staff', '일반 직원') on conflict do nothing", [ADMIN2, STAFF]);
await db.query("update public.staff_profiles set name = '시험 관리자' where id = $1", [ADMIN]);
await db.query('delete from public.booth_live where booth_id = any($1::uuid[])', [REAL]);
const fn0 = await fnFp(), live0 = await liveFp();
const m1 = await R.run(MIG), m2 = await R.run(MIG);
const conf = await qa(MIG.slice(MIG.lastIndexOf('select v."항목"'), MIG.indexOf('-- ── 켜기')));
t('S1 적용 SQL 두 번 실행 — 둘 다 성공', m1.ok && m2.ok, (m1.error || '') + ' ' + (m2.error || ''));
t(`S2 확인 표 ${conf.length}줄 모두 기대 = 실제(기본 꺼짐 포함)`, conf.length === 11 && conf.every(r => r['맞음'] === true), JSON.stringify(conf.filter(r => !r['맞음'])));
t('S3 기존 함수 정의 그대로 · booth_live · booth_live_log 그대로', (await fnFp()).h === fn0.h && sameFp(live0, await liveFp()), '');

// ══ A 권한 ══════════════════════════════════════════════════════════════
section = 'A 권한';
await setOn(true);
await setLive('R1-01', '보통', 20, 45);
const tok01 = await tokOf('R1-01'), tok02 = await tokOf('R1-02');
const a1 = await Promise.all([as(null, 'select public.admin_booth_notice_enabled()', [], 'anon'), as(null, "select * from public.admin_send_booth_notice('stale', null, null, null)", [], 'anon'),
  as(null, 'select * from public.admin_booth_notice_status(12)', [], 'anon')]);
t('A1 anon — 관리자 함수 셋 모두 실행 권한 없음(42501)', a1.every(x => !x.ok && x.code === '42501'), JSON.stringify(a1.map(x => x.code)));
const a2 = [await send(STAFF, 'stale', null, null, null), await status(STAFF), await as(STAFF, 'select public.admin_booth_notice_enabled()', [], 'authenticated'), await send(null, 'stale', null, null, null)];
t('A2 관리자가 아닌 로그인 · 로그인 표시 없음 — 거절(42501)', a2.every(x => !x.ok && x.code === '42501'), JSON.stringify(a2.map(x => x.code)));
const a3 = [];
for (const tb of ['booth_notice_config', 'booth_notice', 'booth_notice_target']) for (const role of ['anon', 'authenticated']) a3.push(await as(ADMIN, `select count(*) from public.${tb}`, [], role));
t('A3 세 표 직접 읽기 — anon · 관리자 로그인 모두 불가(함수로만)', a3.every(x => !x.ok && x.code === '42501'), JSON.stringify(a3.map(x => x.code)));
const a4 = [await ctrl('x'.repeat(24), 'list'), await ctrl('short', 'list'), await ctrl(tok01, 'list', null, 'GET'), await sessN('y'.repeat(43), 'list')];
t('A4 운영자 함수 — 없는 열쇠 · 형식 틀림 · GET 요청 · 없는 세션 모두 42501(부스 id 를 받지 않음)', a4.every(x => !x.ok && x.code === '42501'), JSON.stringify(a4.map(x => x.code + ':' + x.hint)));
const a5 = await ctrl(tok01, 'list');
t('A5 운영자 함수 — 바른 QR 열쇠면 anon 으로 실행됨(켜짐 · 15~20초 간격 안내)', a5.ok && a5.r.enabled === true && a5.r.poll_ms >= 15000 && a5.r.poll_ms <= 20000 && Array.isArray(a5.r.notices), JSON.stringify(a5.r || a5));
const a6 = [await ctrl(tok01, 'nope'), await ctrl(tok01, 'shown')];
t('A6 운영자 함수 — 모르는 동작 · 알림 id 없이 표시 → 22023', a6.every(x => !x.ok && x.code === '22023'), JSON.stringify(a6.map(x => x.code)));

// ══ B 꺼짐 ══════════════════════════════════════════════════════════════
section = 'B 꺼짐';
await setOn(false);
const b1 = await send(ADMIN, 'stale', null, null, null);
const b2 = await ctrl(tok01, 'list');
const b3 = await as(ADMIN, 'select public.admin_booth_notice_enabled() v', [], 'authenticated');
t('B1 꺼짐 — 관리자 보내기 거절(55000 · notice_off) · 기록 0', !b1.ok && b1.code === '55000' && b1.hint === 'notice_off' && +(await q1('select count(*) n from public.booth_notice')).n === 0, JSON.stringify(b1));
t('B2 꺼짐 — 운영자 목록은 빈 목록 + enabled false + 5분 간격 · 관리자 켜짐 여부 false', b2.ok && b2.r.enabled === false && b2.r.notices.length === 0 && b2.r.poll_ms === 300000 && b3.rows[0].v === false, JSON.stringify(b2.r));

// ══ C 보내기 ════════════════════════════════════════════════════════════
section = 'C 보내기';
await setOn(true);
await db.query('delete from public.booth_live where booth_id = any($1::uuid[])', [REAL]);
for (const [c, w, a] of [['R1-01', 20, 45], ['R1-02', 45, 50], ['R1-03', 0, 40]]) await setLive(c, w <= 10 ? '여유' : w <= 25 ? '보통' : '혼잡', w, a);
await setLive('R1-04', '여유', 5, 5);          // 최근
await setLive('R1-05', '마감', 0, 90);         // 마감
await setLive('R1-06', '중단', 0, 35);         // 확인 필요(중단)
const fpC = await liveFp();
const c1 = await send(ADMIN, 'stale', null, null, '');
const c1q = (c1.rows || []).filter(r => r.status === 'queued').map(r => r.booth_code).sort();
t('C1 확인 필요 — 공개 부스 중 오늘 값 · 마감 아님 · 30분 넘은 곳만(R1-01 · 02 · 03 · 06), 최근 · 마감 · 미입력 제외', c1.ok && c1q.join() === 'R1-01,R1-02,R1-03,R1-06', JSON.stringify(c1.rows || c1));
const n1 = c1.rows[0].notice_id;
const rec1 = await q1('select * from public.booth_notice where id = $1', [n1]);
const kstEnd = await q1("select ((((now() at time zone 'Asia/Seoul')::date + 1)::timestamp) at time zone 'Asia/Seoul') e");
t('C2 기록 — 종류 stale · 비운 문구는 정해진 문구 · 보낸 관리자 id · 이름 · 만료(3시간 안 · 그날 자정 전)',
  rec1.kind === 'stale' && /30분 넘게 그대로/.test(rec1.body) && rec1.created_by === ADMIN && rec1.created_by_name === '시험 관리자' &&
  +rec1.expires_at <= Date.now() + 3 * 3600e3 + 60e3 && +rec1.expires_at <= +kstEnd.e, JSON.stringify(rec1));
const c3 = await send(ADMIN, 'stale', null, [idOf('R1-01'), idOf('R1-04'), idOf('R1-02')], '다시 확인해 주세요');
const c3m = Object.fromEntries((c3.rows || []).map(r => [r.booth_code, r.status]));
t('C3 고른 부스로 다시 — 10분 안에 같은 종류 받은 곳 skipped:recent · 지금 대상 아닌 곳 skipped:not_target · 보낼 곳 없으면 알림 기록도 안 만듦',
  c3m['R1-01'] === 'skipped:recent' && c3m['R1-02'] === 'skipped:recent' && c3m['R1-04'] === 'skipped:not_target' && +(await q1('select count(*) n from public.booth_notice')).n === 1, JSON.stringify(c3.rows));
const c4 = await send(ADMIN2, 'stale', null, null, null);
t('C4 다른 관리자가 같은 종류를 바로 — 모두 skipped:recent(줄 세우기 · 10분 제한)', c4.ok && c4.rows.every(r => r.status === 'skipped:recent'), JSON.stringify(c4.rows));
const c5 = await send(ADMIN, 'missing', null, null, null);
const c5q = c5.rows.filter(r => r.status === 'queued');
const pubN = +(await q1(`select count(*) n from public.booths b join public.zones z on z.key = b.zone_key and z.is_published where b.is_published and b.no is not null`)).n;
t(`C5 미입력 — 공개 부스(${pubN}) 중 오늘 값 없는 곳 모두 · 값 있는 6곳 제외(종류가 달라 10분 제한과 무관)`, c5.ok && c5q.length === pubN - 6 && !c5q.some(r => /^R1-0[1-6]$/.test(r.booth_code)), c5q.length);
const c6 = [await send(ADMIN, 'zone', null, null, '구역 안내'), await send(ADMIN, 'zone', 'A', null, '구역 안내'), await send(ADMIN, 'all', null, null, '   '), await send(ADMIN, 'all', null, null, 'x'.repeat(121)), await send(ADMIN, 'bad', null, null, 'x')];
t('C6 구역 없음 · 비공개 구역 · 전체 공지 빈 문구 · 121자 · 모르는 종류 → 22023(기록 안 만듦)', c6.every(x => !x.ok && x.code === '22023'), JSON.stringify(c6.map(x => x.code)));
const c7 = await send(ADMIN, 'zone', 'R2', null, '  R2   구역\n 점검  안내 ');
t('C7 구역 R2 — R2 공개 부스 21곳 · 문구 공백 정리(“R2 구역 점검 안내”)', c7.ok && c7.rows.filter(r => r.status === 'queued').length === 21 &&
  (await q1('select body from public.booth_notice where id = $1', [c7.rows[0].notice_id])).body === 'R2 구역 점검 안내', JSON.stringify((c7.rows || []).length));
await db.query("update public.booth_notice set created_at = created_at - interval '11 minutes' where kind = 'stale'");
const c8 = await send(ADMIN, 'stale', null, [idOf('R1-01')], null);
t('C8 10분 지난 뒤에는 같은 종류를 다시 보냄(queued)', c8.ok && c8.rows[0].status === 'queued', JSON.stringify(c8.rows));
// 부스 1곳(booth) — p_booth_ids 에 정확히 1곳 · 공개 부스만 · 같은 종류 10분 제한
const c10e = [await send(ADMIN, 'booth', null, null, '확인 부탁'), await send(ADMIN, 'booth', null, [idOf('R1-04'), idOf('R1-05')], '확인 부탁'), await send(ADMIN, 'booth', null, [idOf('R1-04')], '  ')];
const c10 = await send(ADMIN, 'booth', null, [idOf('R1-04')], 'R1-04 대기 상태를 확인해 주세요');
const c10r = c10.ok && await q1('select kind, body, zone_key from public.booth_notice where id = $1', [c10.rows[0].notice_id]);
const c10b = await send(ADMIN, 'booth', null, [idOf('R1-04')], '다시');
await db.query('update public.booths set is_published = false where id = $1', [idOf('R4-21')]);
const c10h = await send(ADMIN, 'booth', null, [idOf('R4-21')], '비공개 부스');
await db.query('update public.booths set is_published = true where id = $1', [idOf('R4-21')]);
t('C10 부스 1곳 — 없음 · 2곳 · 빈 문구는 22023 · R1-04 한 곳 queued(kind booth · 문구 그대로) · 10분 안 다시 skipped:recent · 비공개 부스는 skipped:not_target(기록 안 만듦)',
  c10e.every(x => !x.ok && x.code === '22023') && c10.ok && c10.rows.length === 1 && c10.rows[0].booth_code === 'R1-04' && c10.rows[0].status === 'queued' &&
  c10r.kind === 'booth' && c10r.body === 'R1-04 대기 상태를 확인해 주세요' && !c10r.zone_key && c10b.ok && c10b.rows[0].status === 'skipped:recent' &&
  c10h.ok && c10h.rows.length === 1 && c10h.rows[0].status === 'skipped:not_target' && c10h.rows[0].notice_id === null,
  JSON.stringify({ e: c10e.map(x => x.code), c10: c10.rows, b: c10b.rows, h: c10h.rows }));
t('C9 보내기 내내 booth_live · booth_live_log 그대로', sameFp(fpC, await liveFp()), '');

// ══ D 운영자 ════════════════════════════════════════════════════════════
section = 'D 운영자';
const fpD = await liveFp();
const d1 = await ctrl(tok01, 'list');
const d1ids = d1.r.notices.map(n => n.id);
t('D1 R1-01 QR 목록 — 내 부스 알림만(확인 필요 2건 · 미입력 아님) · 최신 먼저 · 아직 표시 안 됨', d1.ok && d1.r.notices.length === 2 && d1.r.notices.every(n => n.kind === 'stale' && n.shown === false) &&
  Date.parse(d1.r.notices[0].created_at) >= Date.parse(d1.r.notices[1].created_at), JSON.stringify(d1.r));
const d2 = await ctrl(tok02, 'list');
const other = await ctrl(tok02, 'ack', d1ids[0]);
const other2 = await ctrl(tok02, 'shown', 999999);
// d1ids[0] = C8 에서 R1-01 한 곳에만 보낸 알림(d1ids[1] 은 R1-01 · 02 · 03 · 06 이 함께 받은 알림)
t('D2 다른 부스(R1-02)가 R1-01 에만 간 알림 id 로 확인 · 없는 id 로 표시 → 둘 다 ok false(같은 답) · R1-01 기록 그대로 · R1-02 목록에 그 알림 없음',
  other.ok && other.r.ok === false && other2.ok && other2.r.ok === false && !(await targetOf(d1ids[0], 'R1-01')).acked_at &&
  !d2.r.notices.some(n => n.id === d1ids[0]) && !(await targetOf(d1ids[0], 'R1-02')), JSON.stringify([other.r, other2.r]));
const d3 = await ctrl(tok01, 'shown', d1ids[0]);
const tg3 = await targetOf(d1ids[0], 'R1-01');
const st3 = (await status()).rows.find(r => r.notice_id === d1ids[0] && r.booth_code === 'R1-01');
t('D3 표시(shown) → shown_at · shown_via qr · 관리자 상태 ‘shown’(확인은 아직 없음)', d3.r.ok === true && tg3.shown_at && tg3.shown_via === 'qr' && !tg3.acked_at && st3.state === 'shown', JSON.stringify({ tg3, st3 }));
const d4 = await ctrl(tok01, 'ack', d1ids[0]);
const tg4 = await targetOf(d1ids[0], 'R1-01');
const d4l = await ctrl(tok01, 'list');
t('D4 확인(ack) → acked_at · acked_via qr · 목록에서 빠짐 · 상태 ‘acked’ · 두 번 눌러도 처음 시각 그대로',
  d4.r.ok && tg4.acked_at && tg4.acked_via === 'qr' && !d4l.r.notices.some(n => n.id === d1ids[0]) &&
  (await status()).rows.find(r => r.notice_id === d1ids[0] && r.booth_code === 'R1-01').state === 'acked' &&
  (await ctrl(tok01, 'ack', d1ids[0])).r.ok && +(await targetOf(d1ids[0], 'R1-01')).acked_at === +tg4.acked_at, JSON.stringify(tg4));
const lg = await as(null, 'select * from public.booth_pin_login($1, $2, $3)', [idOf('R1-02'), COMMON, 'pintestdev80000001'], 'anon');
const ses = lg.ok && lg.rows[0].session;
const d5 = ses ? await sessN(ses, 'list') : lg;
const pn = d5.ok && d5.r.notices[0];
const d5a = pn ? await sessN(ses, 'ack', pn.id) : null;
const tg5 = pn ? await targetOf(pn.id, 'R1-02') : null;
const sid = ses ? (await q1("select id from public.booth_session where token_hash = extensions.digest($1, 'sha256')", [ses])).id : null;
t('D5 PIN(리허설 공통 PIN) 세션 — 자기 부스(R1-02) 알림만 · 확인 → acked_via pin · acked_session = 그 세션',
  lg.ok && d5.ok && d5.r.notices.length >= 1 && d5a && d5a.r.ok && tg5.acked_via === 'pin' && tg5.acked_session === sid && tg5.shown_via === 'pin', JSON.stringify({ lg: lg.ok || lg.code, d5: d5.r, tg5 }));
const tgBefore6 = await targetOf(d1ids[0], 'R1-01');
const d6x = ses ? await sessN(ses, 'ack', d1ids[0]) : null;
t('D6 PIN 세션(R1-02)으로 R1-01 에만 간 알림 확인 → ok false · R1-01 기록(확인 시각 · 방법) 그대로 · R1-02 기록 생기지 않음',
  d6x && d6x.r.ok === false && JSON.stringify(await targetOf(d1ids[0], 'R1-01')) === JSON.stringify(tgBefore6) && !(await targetOf(d1ids[0], 'R1-02')), JSON.stringify(d6x && d6x.r));
await as(null, 'select public.booth_session_logout($1)', [ses], 'anon');
const d7 = await sessN(ses, 'list');
await db.query('update public.booth_access set disabled_at = now() where booth_id = $1', [idOf('R1-03')]);
const d7b = await ctrl(await tokOf('R1-03'), 'list');
await db.query('update public.booth_access set disabled_at = null where booth_id = $1', [idOf('R1-03')]);
t('D7 끝낸 PIN 세션 · 꺼진 QR → 42501(기존 운영자 함수와 같은 거절)', !d7.ok && d7.code === '42501' && !d7b.ok && d7b.code === '42501', JSON.stringify([d7.code + ':' + d7.hint, d7b.code + ':' + d7b.hint]));
await db.query('update public.booth_notice set expires_at = now() - interval \'1 second\' where id = $1', [d1ids[1]]);
const d8 = await ctrl(tok01, 'list');
const st8 = (await status()).rows.find(r => r.notice_id === d1ids[1] && r.booth_code === 'R1-01');
t('D8 만료된 알림 — 운영자 목록에서 빠짐 · 관리자 상태 ‘expired’(대기인 채로 만료)', !d8.r.notices.some(n => n.id === d1ids[1]) && st8.state === 'expired', JSON.stringify(st8));
t('D9 운영자 목록 · 표시 · 확인 · PIN 로그인 내내 booth_live · booth_live_log 그대로(알림 확인으로 대기 값이 바뀌지 않음)', sameFp(fpD, await liveFp()), '');

// ══ E 정의 ══════════════════════════════════════════════════════════════
section = 'E 정의';
const defs = await qa(`select p.proname n, pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where p.proname in ('booth_ctrl_notice', 'booth_session_notice', 'booth_notice_op', 'admin_send_booth_notice', 'admin_booth_notice_status', 'admin_booth_notice_enabled', 'booth_notice_on')`);
t('E1 새 함수 일곱 — booth_live · booth_live_log 에 insert · update · delete 없음 · 운영자 함수는 부스 id 인자 없음',
  defs.length === 7 && defs.every(f => !/(insert\s+into|update|delete\s+from)\s+public\.booth_live(_log)?\b(?!_)/i.test(f.d)) &&
  !/p_booth/i.test(defs.find(f => f.n === 'booth_ctrl_notice').d.split('as $')[0]) && !/p_booth/i.test(defs.find(f => f.n === 'booth_session_notice').d.split('as $')[0]), defs.map(f => f.n).join());

// ══ F 관리자 화면 ════════════════════════════════════════════════════════
section = 'F 관리자 화면';
await db.exec('delete from public.booth_notice');
await db.query('delete from public.booth_live where booth_id = any($1::uuid[])', [REAL]);
for (const [c, w, a] of [['R1-01', 20, 45], ['R1-02', 45, 50], ['R1-07', 10, 70]]) await setLive(c, w <= 10 ? '여유' : w <= 25 ? '보통' : '혼잡', w, a);
async function openAdmin() {
  const p = await openPage({ JSDOM, VirtualConsole, dir: MAIN, file: 'booth-admin.html', R, rest, hash: '#live' });
  await until(() => p.d.querySelectorAll('#lv-list .lv').length >= 20, 30000);
  await until(() => p.calls.some(c => c.name === 'admin_booth_notice_enabled'), 20000);
  await wait(400);
  return p;
}
const soonOf = d => [...d.querySelectorAll('.oact__soon button')].map(b => ({ t: text(b), dis: b.disabled, k: b.getAttribute('data-notice') || '' }));
await setOn(false);
let P = await openAdmin();
const f1 = soonOf(P.d);
t('F1 서버 스위치 꺼짐 — [운영자 알림] 은 누를 수 없음 ‘꺼짐’', f1[1] && /운영자 알림/.test(f1[1].t) && /꺼짐/.test(f1[1].t) && f1[1].dis, JSON.stringify(f1));
P.dom.window.close();
await setOn(true);
P = await openAdmin();
const { d: D, w: W } = P;
const f2 = soonOf(D);
t('F2 켜짐 — [운영자 알림] 누를 수 있음', f2[1] && f2[1].k === 'open' && !f2[1].dis, JSON.stringify(f2));
click(W, D.querySelector('[data-notice="open"]')); await wait(300);
const box = () => D.getElementById('lv-notice');
const who = () => D.getElementById('nt-who');
const kindN = k => +text(D.querySelector(`[data-nkind="${k}"] b`));
const pickK = async k => { click(W, D.querySelector(`[data-nkind="${k}"]`)); await wait(200); };
const act = async k => { const b = D.querySelector(`[data-notice="${k}"]`); if (b && !b.disabled) click(W, b); await wait(250); return !!b && !b.disabled; };
const typeBody = async v => { const ta = D.getElementById('nt-body'); ta.value = v; ta.dispatchEvent(new W.Event('input', { bubbles: true })); await wait(120); return ta; };
const sends = () => P.calls.filter(c => c.name === 'admin_send_booth_notice');
const stalePub = 3, missPub = pubN - 3;
t(`F3 칸 열림 — 받을 부스 다섯 가지(확인 필요 ${stalePub} · 미입력 ${missPub} · 구역 · 전체 공개 ${pubN} · 부스 1곳) · 처음엔 아무것도 안 고름 · 문구 칸 · 보내기 단추 없음`,
  !box().hidden && kindN('stale') === stalePub && kindN('missing') === missPub && kindN('all') === pubN && !!D.querySelector('[data-nkind="booth"]') &&
  [...D.querySelectorAll('[data-nkind]')].every(b => b.getAttribute('aria-checked') === 'false') && !D.getElementById('nt-body') &&
  !D.querySelector('[data-notice="send"]') && !D.querySelector('[data-notice="preview"]') && /먼저 받을 부스를 고르세요/.test(text(box())) &&
  /대기 · 화면에 표시됨 · 운영자 확인/.test(text(box())), text(box()).slice(0, 300));
await pickK('stale');
t('F4 ‘확인 필요’ 고름 — 정해진 문구 · 받을 부스 3곳 · [미리보기] 만(보내기 단추는 아직 없음)',
  /30분 넘게 그대로/.test(D.getElementById('nt-body').value) && /3곳/.test(text(D.querySelector('.ntcount'))) &&
  !D.querySelector('[data-notice="preview"]').disabled && !D.querySelector('[data-notice="send"]'), text(who()));
await act('preview');
const pv = text(who());
t('F5 미리보기 — ‘아직 보내지 않았습니다’ · 받을 부스번호 R1-01 · R1-02 · R1-07 · 3곳 · 운영자 화면에 보일 문구 그대로 · 고르기 · 문구 칸 잠김 · 보내기 요청 0',
  /미리보기 — 아직 보내지 않았습니다/.test(pv) && [...who().querySelectorAll('.ntcodes li')].map(li => text(li)).join() === 'R1-01,R1-02,R1-07' &&
  /3곳/.test(text(who().querySelector('.ntcount'))) && /30분 넘게 그대로예요\. 지금 상태를 다시 눌러 주세요\./.test(text(who().querySelector('.ntmsg'))) &&
  D.getElementById('nt-body').disabled && D.querySelector('[data-nkind="all"]').disabled && !D.querySelector('[data-notice="send"]') && sends().length === 0, pv.slice(0, 300));
await act('confirm');
const sendBtn = () => D.querySelector('[data-notice="send"]');
const f6a = sendBtn() && sendBtn().disabled && /보내기 \(3곳\)/.test(text(sendBtn())) && /마지막 확인/.test(text(who()));
const sure = D.getElementById('nt-sure'); sure.checked = true; sure.dispatchEvent(new W.Event('change', { bubbles: true })); await wait(120);
const f6b = !sendBtn().disabled && sends().length === 0;
t('F6 마지막 확인 — 체크 전에는 [보내기 (3곳)] 꺼짐 · 체크하면 켜짐 · 아직 요청 0', f6a && f6b, text(who()).slice(0, 200));
const cb6 = P.calls.length;
click(W, sendBtn());
await until(() => /보냄 3곳/.test(text(box())), 10000); await wait(300);
const s6 = P.calls.slice(cb6).find(c => c.name === 'admin_send_booth_notice');
t('F7 보내기 → 보낸 것 = 미리보기 3곳 id · 종류 stale · 문구 그대로 · 결과 ‘화면에서 고른 3곳 → 보냄 3곳 — 같습니다’ · 상태 대기 3 · 쓰기 칸은 처음으로(대상 없음)',
  s6 && s6.args.p_kind === 'stale' && s6.args.p_booth_ids.length === 3 && /^대기 상태가 30분 넘게 그대로예요/.test(s6.args.p_body) &&
  /화면에서 고른 3곳 → 보냄 3곳/.test(text(D.querySelector('.ntres'))) && !D.querySelector('.ntres.is-diff') && /대기 3/.test(text(D.querySelector('.ntst__c'))) &&
  [...D.querySelectorAll('[data-nkind]')].every(b => b.getAttribute('aria-checked') === 'false'), text(box()).slice(0, 400));
await pickK('stale');
t('F8 10분 안에 같은 종류 다시 — 0곳 · ‘보낼 부스가 없습니다’ · [미리보기] 꺼짐', /0곳/.test(text(D.querySelector('.ntcount'))) &&
  /보낼 부스가 없습니다/.test(text(who())) && D.querySelector('[data-notice="preview"]').disabled, text(who()));
await pickK('all');
const f9a = D.querySelector('[data-notice="preview"]').disabled && D.getElementById('nt-body').value === '';
await typeBody('오후 4시 30분에 체험을 마감해 주세요');
await act('preview'); await act('confirm');
const wide = D.querySelector('#nt-who .ntcount.is-wide');
t(`F9 ‘전체 공개’ — 문구 없으면 미리보기 못 함 · 미리보기 · 마지막 확인에 ${pubN}곳을 크게(여러 부스에 한꺼번에) · 부스번호 ${pubN}개`,
  f9a && wide && +text(wide.querySelector('b')) === pubN && /여러 부스에 한꺼번에/.test(text(wide)) && who().querySelectorAll('.ntcodes li').length === pubN &&
  new RegExp('보내기 \\(' + pubN + '곳\\)').test(text(sendBtn())) && sendBtn().disabled, text(who()).slice(0, 200));
await act('back'); await act('edit');
t('F10 [미리보기로] · [고치기] → 쓰기로 돌아옴 · 쓴 문구 유지 · 보내기 요청 0(전체 공개는 보내지 않음)',
  !D.getElementById('nt-body').disabled && D.getElementById('nt-body').value === '오후 4시 30분에 체험을 마감해 주세요' && sends().length === 1, text(who()).slice(0, 120));
await pickK('zone');
const f11a = D.querySelector('[data-notice="preview"]').disabled;
const zs = D.getElementById('nt-zone'); zs.value = 'R3'; zs.dispatchEvent(new W.Event('change', { bubbles: true })); await wait(200);
t('F11 ‘구역’ — 구역 고르기 전에는 미리보기 못 함 · R3 → 21곳을 크게 · 쓴 문구 유지',
  f11a && D.querySelector('#nt-who .ntcount.is-wide') && +text(D.querySelector('#nt-who .ntcount b')) === 21 && D.getElementById('nt-body').value === '오후 4시 30분에 체험을 마감해 주세요', text(who()).slice(0, 120));
// 부스 1곳 — 공개 부스 목록에서만
await pickK('booth');
const bs = D.getElementById('nt-booth');
const f12a = bs && bs.options.length === pubN + 1 && D.querySelector('[data-notice="preview"]').disabled;
bs.value = idOf('R1-02'); bs.dispatchEvent(new W.Event('change', { bubbles: true })); await wait(200);
await typeBody('R1-02 부스 대기 상태를 확인해 주세요');
await act('preview');
const f12b = [...who().querySelectorAll('.ntcodes li')].map(li => text(li)).join() === 'R1-02' && !D.querySelector('#nt-who .ntcount.is-wide') && /부스 R1-02/.test(text(who()));
await act('confirm');
const s12s = D.getElementById('nt-sure'); s12s.checked = true; s12s.dispatchEvent(new W.Event('change', { bubbles: true })); await wait(100);
const cb12 = P.calls.length;
click(W, sendBtn());
await until(() => /보냄 1곳/.test(text(box())), 10000); await wait(300);
const s12 = P.calls.slice(cb12).find(c => c.name === 'admin_send_booth_notice');
const t12 = await qa("select t.booth_code from public.booth_notice_target t join public.booth_notice n on n.id = t.notice_id where n.kind = 'booth'");
t('F12 ‘부스 1곳’ — 공개 부스 목록(+고르기 전 미리보기 못 함) · R1-02 만 미리보기 · 보낸 것 kind booth · id 1개 · 받은 부스 R1-02 뿐 · 상태 목록 ‘부스 R1-02’',
  f12a && f12b && s12 && s12.args.p_kind === 'booth' && s12.args.p_booth_ids.join() === idOf('R1-02') && t12.map(r => r.booth_code).join() === 'R1-02' &&
  /부스 R1-02/.test(text(D.querySelector('.ntst'))), JSON.stringify({ f12a, f12b, t12 }));
// 미리보기 뒤 상태가 바뀜 → 서버가 뺀 부스를 결과에 따로 크게
await pickK('missing');
await act('preview'); await act('confirm');
const mPick = [...who().querySelectorAll('.ntcodes li')].map(li => text(li));
await setLive(mPick[0], '보통', 15, 1);   // 미리보기 뒤 그 부스 운영자가 입력 → 더는 미입력이 아님
const s13s = D.getElementById('nt-sure'); s13s.checked = true; s13s.dispatchEvent(new W.Event('change', { bubbles: true })); await wait(100);
const cb13 = P.calls.length;
click(W, sendBtn());
await until(() => /보냄 \d+곳/.test(text(D.querySelector('.ntres'))), 10000); await wait(300);
const s13 = P.calls.slice(cb13).find(c => c.name === 'admin_send_booth_notice');
const r13 = text(D.querySelector('.ntres'));
t(`F13 미리보기 뒤 ${mPick[0]} 이 입력 → 서버가 뺌: 결과에 ‘화면에서 고른 부스와 서버가 확인한 부스가 다릅니다’ · ‘지금 대상 아님 1곳 ${mPick[0]}’ · 보냄 ${mPick.length - 1}곳`,
  s13 && s13.args.p_booth_ids.length === mPick.length && D.querySelector('.ntres.is-diff') && /화면에서 고른 부스와 서버가 확인한 부스가 다릅니다/.test(r13) &&
  new RegExp('지금 대상 아님\\(그 사이 상태가 바뀌어 서버가 뺌\\) 1곳 ' + mPick[0]).test(r13) && new RegExp('보냄 ' + (mPick.length - 1) + '곳').test(r13), r13.slice(0, 300));
await db.query("update public.booth_notice set expires_at = now() - interval '1 second' where kind <> 'stale'");   // 아래 운영자 화면 시험이 ‘확인 필요’ 알림을 맨 위에 보게
click(W, D.querySelector('[data-notice="close"]')); await wait(100);
t('F14 화면이 부른 함수 — 원래 읽기 + 알림 셋(켜짐 · 상태 · 보내기)뿐 · 보내기는 [보내기] 누른 3번뿐 · 오류 없음',
  [...new Set(P.calls.map(c => c.name))].every(n => ['admin_booth_credentials', 'admin_rehearsal_status', 'admin_booth_live_checks', 'admin_booth_notice_enabled', 'admin_booth_notice_status', 'admin_send_booth_notice'].includes(n)) &&
  sends().length === 3 && !P.errors.length, [...new Set(P.calls.map(c => c.name))].join() + P.errors.join('|'));
const sentNotice = +(await q1("select max(id) n from public.booth_notice where kind = 'stale'")).n;

// ══ G 운영자 화면 ════════════════════════════════════════════════════════
section = 'G 운영자 화면';
const ctrlCalls = [];
let failNotice = false;
async function anonFetch(u, init = {}) {
  const sx = String(u), i = sx.indexOf('/rest/v1/');
  if (i < 0) throw new Error('예상 밖 요청');
  const path = sx.slice(i + 9), method = String(init.method || 'GET').toUpperCase();
  let st = 200, body;
  if (method === 'GET') { const rr = await rest(path); st = rr.status; body = rr.body; }
  else if (path.startsWith('rpc/')) {
    const name = path.slice(4).split('?')[0];
    const args = init.body ? JSON.parse(init.body) : {};
    ctrlCalls.push({ name, args, at: Date.now() });
    if (failNotice && /_notice$/.test(name)) throw new TypeError('Failed to fetch');
    const has = (await db.query("select 1 from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace", [name])).rows.length;
    if (!has) { st = 404; body = { code: 'PGRST202', message: 'Could not find the function public.' + name }; }
    else {
      const keys = Object.keys(args);
      try {
        const rows = await R.asAnon(`select * from public.${name}(${keys.map((k, j) => `${k} => $${j + 1}`).join(', ')})`, keys.map(k => args[k]));
        body = /_notice$/.test(name) ? rows[0][name] : rows;
      } catch (e) { st = e.code === '42501' ? 401 : 400; body = { code: e.code, message: e.message, hint: e.hint }; }
    }
  } else { st = 405; body = {}; }
  const out = JSON.stringify(body);
  return { ok: st < 400, status: st, text: async () => out, json: async () => body, headers: { get: () => 'application/json' } };
}
function ctrlHtml(flag) {
  let html = readFileSync(join(LIVE, 'booth-ctrl.html'), 'utf8');
  for (const pth of ['assets/config.js', 'assets/booth-core.js', 'assets/mock-data.js']) {
    let src = readFileSync(join(LIVE, pth), 'utf8');
    if (pth === 'assets/config.js') src = src.replace(/^\s*boothNotices:\s*(true|false),?$/m, `  boothNotices: ${flag},`);
    src = src.replace(/<\/script/gi, '<\\/script');
    html = html.replace(new RegExp(`<script src="${pth.replace(/[.]/g, '\\.')}"></script>`), () => `<script>${src}</script>`);
  }
  return html.replace(/<link[^>]+stylesheet[^>]*>/g, '');
}
async function openCtrl({ flag, hash = '', pinRec = null }) {
  ctrlCalls.length = 0;
  let hidden = false;
  const dom = new JSDOM(ctrlHtml(flag), {
    url: 'https://incheon-live.vercel.app/booth-ctrl.html' + hash, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.scrollTo = () => {}; w.fetch = anonFetch; w.console.warn = () => {};
      Object.defineProperty(w.document, 'hidden', { get: () => hidden, configurable: true });
      Object.defineProperty(w.document, 'visibilityState', { get: () => (hidden ? 'hidden' : 'visible'), configurable: true });
      if (pinRec) w.localStorage.setItem('aisw-boothctrl-pin', JSON.stringify(pinRec));
      fakeClock(w, Date.now());
    }
  });
  const d = dom.window.document, w = dom.window, errs = [];
  w.addEventListener('error', e => errs.push(e.message));
  await until(() => !d.getElementById('v-confirm').hidden || !d.getElementById('v-main').hidden, 10000);
  if (!d.getElementById('v-confirm').hidden) click(w, d.getElementById('cf-yes'));
  await until(() => !d.getElementById('v-main').hidden, 8000);
  await wait(300);
  return { dom, d, w, errs, setHidden: v => { hidden = v; d.dispatchEvent(new w.Event('visibilitychange')); } };
}
const nCalls = n => ctrlCalls.filter(c => c.name === n).length;
// G1 설정 꺼짐(기본) — 알림을 묻지 않음
let C = await openCtrl({ flag: false, hash: '#k=' + tok01 });
await wait(2500);
// 꺼짐이면 다시 보임 · 연결 돌아옴(online) 에도 묻지 않음
C.setHidden(true); C.setHidden(false); C.w.dispatchEvent(new C.w.Event('online'));
await wait(2000);
t('G1 설정 꺼짐(boothNotices false · 기본) — 4.5초 · 다시 보임 · 연결 돌아옴(online) 에도 알림 함수를 한 번도 부르지 않음 · 띠 숨김 · 대기 화면 정상', nCalls('booth_ctrl_notice') === 0 && C.d.getElementById('notice').hidden &&
  nCalls('booth_ctrl_get') >= 1 && !C.errs.length, JSON.stringify(ctrlCalls.map(c => c.name)));
C.dom.window.close();
// G2 설정 켜짐 · 서버 꺼짐 — 한 번 묻고 띠 없음, 다음은 5분 뒤
await setOn(false);
C = await openCtrl({ flag: true, hash: '#k=' + tok01 });
await until(() => nCalls('booth_ctrl_notice') >= 1, 6000); await wait(3000);
t('G2 서버 스위치 꺼짐 — 한 번 묻고(enabled false) 띠 없음 · 다음 묻기는 5분 뒤(3초 동안 더 안 물음)', nCalls('booth_ctrl_notice') === 1 && C.d.getElementById('notice').hidden, nCalls('booth_ctrl_notice'));
C.dom.window.close();
await setOn(true);
// G3 켜짐 — 띠 · 표시됨 · 확인했어요
const fpG = await liveFp();
C = await openCtrl({ flag: true, hash: '#k=' + tok01 });
await until(() => !C.d.getElementById('notice').hidden, 8000); await wait(500);
const tgS = await targetOf(sentNotice, 'R1-01');
t('G3 켜짐 — 띠에 ‘운영본부 알림 · HH:MM’ + 보낸 문구 · 그린 뒤 ‘화면에 표시됨’(shown_at · qr) 기록 · 확인은 아직',
  /운영본부 알림 · \d{1,2}:\d{2}/.test(text(C.d.getElementById('notice-k'))) && /30분 넘게 그대로/.test(text(C.d.getElementById('notice-t'))) &&
  tgS.shown_at && tgS.shown_via === 'qr' && !tgS.acked_at, JSON.stringify({ k: text(C.d.getElementById('notice-k')), tgS }));
// G4 가려진 동안 새 알림 — 묻지도 표시하지도 않음, 다시 보이면 묻고 표시
await db.query("update public.booth_notice set created_at = created_at - interval '11 minutes' where id = $1", [sentNotice]);
const g4 = await send(ADMIN, 'stale', null, [idOf('R1-01')], '두 번째 알림');
const n2 = g4.rows[0].notice_id;
C.setHidden(true);
const before4 = nCalls('booth_ctrl_notice');
await wait(4000);
const mid4 = nCalls('booth_ctrl_notice'), shownMid = (await targetOf(n2, 'R1-01')).shown_at;
C.setHidden(false);
await until(() => /두 번째 알림/.test(text(C.d.getElementById('notice-t'))), 8000); await wait(500);
const shownAfter = (await targetOf(n2, 'R1-01')).shown_at;
t('G4 화면이 가려진 동안 — 알림을 묻지 않고 ‘화면에 표시됨’ 도 남기지 않음 · 다시 보이면 3초 안에 묻고 새 알림을 위에 · 그때 표시됨',
  mid4 === before4 && !shownMid && !!shownAfter && /다음 알림 1개/.test(text(C.d.getElementById('notice-more'))), JSON.stringify({ before4, mid4, shownMid, shownAfter }));
// G5 확인했어요 — 맨 위 알림만 확인 · 대기 값 그대로
click(C.w, C.d.getElementById('notice-ack'));
await until(() => /확인했어요/.test(text(C.d.getElementById('toast'))), 6000); await wait(300);
const tg5a = await targetOf(n2, 'R1-01'), tg5b = await targetOf(sentNotice, 'R1-01');
t('G5 [확인했어요] — 그 알림만 운영자 확인(acked · qr) · 띠는 다음 알림으로 · booth_live · booth_live_log 그대로',
  tg5a.acked_at && tg5a.acked_via === 'qr' && !tg5b.acked_at && /30분 넘게 그대로/.test(text(C.d.getElementById('notice-t'))) && sameFp(fpG, await liveFp()), JSON.stringify({ tg5a, tg5b: !!tg5b.acked_at }));
// G6 대기 입력은 그대로 동작
const logMax = +(await q1('select max(id) m from public.booth_live_log')).m;
click(C.w, C.d.querySelector('.w[data-wait="15"]'));
await until(() => /반영했습니다|저장/.test(text(C.d.getElementById('toast'))) && !!ctrlCalls.find(c => c.name === 'booth_ctrl_set'), 8000); await wait(500);
const lastLog = await q1('select booth_id::text id, source, wait_minutes from public.booth_live_log where id > $1 order by id desc limit 1', [logMax]);
t('G6 알림 띠가 있는 채로 대기 15분 누름 → 기존 저장(booth_ctrl_set · 기록 set · 15분) 그대로 · 화면 오류 없음',
  lastLog && lastLog.id === idOf('R1-01') && lastLog.source === 'set' && lastLog.wait_minutes === 15 && !C.errs.length, JSON.stringify({ lastLog, errs: C.errs }));
// G7 연결 오류 — 늘려 다시 묻기(20초부터)
failNotice = true;
const before7 = nCalls('booth_ctrl_notice');
C.setHidden(true); C.setHidden(false);
await until(() => nCalls('booth_ctrl_notice') > before7, 5000);
await wait(6000);
const after7 = nCalls('booth_ctrl_notice');
failNotice = false;
const bannerKept7 = !C.d.getElementById('notice').hidden;
t('G7 연결 오류(Failed to fetch) — 한 번 실패한 뒤 6초 동안 다시 묻지 않음(20초 · 40초 … 5분까지 늘림) · 띠 · 대기 화면 그대로', after7 === before7 + 1 && !C.errs.length, JSON.stringify({ before7, after7 }));
// G7b 연결이 돌아오면(online) — 늘린 간격을 기다리지 않고 3초 안에 다시 묻기
const before7b = nCalls('booth_ctrl_notice');
C.w.dispatchEvent(new C.w.Event('online'));
await until(() => nCalls('booth_ctrl_notice') > before7b, 5000); await wait(600);
t('G7b 연결이 돌아오면(online) — 20초를 기다리지 않고 3초 안에 다시 물어 성공 · 실패 동안에도 띠 그대로 · 오류 없음',
  nCalls('booth_ctrl_notice') >= before7b + 1 && bannerKept7 && !C.d.getElementById('notice').hidden && !C.errs.length, JSON.stringify({ before7b, now: nCalls('booth_ctrl_notice'), bannerKept7 }));
C.dom.window.close();
// G8 PIN 으로 연 화면
const lg2 = await as(null, 'select * from public.booth_pin_login($1, $2, $3)', [idOf('R1-02'), COMMON, 'pintestdev80000002'], 'anon');
const row2 = lg2.rows[0];
C = await openCtrl({ flag: true, pinRec: { session: row2.session, booth_id: idOf('R1-02'), zone_key: 'R1', code: 'R1-02', name: '', org: '', zone_name: '', expires_at: row2.expires_at } });
await until(() => !C.d.getElementById('notice').hidden, 8000); await wait(300);
const pinCalls = ctrlCalls.filter(c => /_notice$/.test(c.name));
click(C.w, C.d.getElementById('notice-ack'));
await until(() => /확인했어요/.test(text(C.d.getElementById('toast'))), 6000);
const tg8 = await targetOf(sentNotice, 'R1-02');
t('G8 PIN 으로 연 화면 — booth_session_notice 만 부름(세션만 보냄 · 부스 id 없음) · 확인 → acked_via pin',
  pinCalls.length >= 1 && pinCalls.every(c => c.name === 'booth_session_notice' && !('p_booth_id' in c.args) && !('p_token' in c.args)) && tg8.acked_via === 'pin', JSON.stringify({ n: pinCalls.map(c => c.name), tg8 }));
C.dom.window.close();
// G9 함수 없음(되돌린 뒤) — 한 번 묻고 이 화면에서는 더 묻지 않음
await R.run(RB);
C = await openCtrl({ flag: true, hash: '#k=' + tok01 });
await until(() => nCalls('booth_ctrl_notice') >= 1, 6000);
C.setHidden(true); C.setHidden(false); await wait(4000);
t('G9 함수 없음(PGRST202) — 한 번 묻고 이 화면에서는 더 묻지 않음(다시 보여도) · 띠 숨김 · 대기 화면 정상', nCalls('booth_ctrl_notice') === 1 && C.d.getElementById('notice').hidden && !C.errs.length, nCalls('booth_ctrl_notice'));
C.dom.window.close();

// ══ R 되돌리기 ═══════════════════════════════════════════════════════════
section = 'R 되돌리기';
const r2 = await R.run(RB);
const rconf = await qa(RB.slice(RB.indexOf('select v."항목"'), RB.indexOf('-- ── 표까지')));
t('R1 되돌리기 두 번 — 둘 다 성공 · 함수 모두 없음 · 기록 표 남음', r2.ok && rconf.every(r => r['맞음'] === true), JSON.stringify(rconf));
const recN = +(await q1('select count(*) n from public.booth_notice_target')).n;
P.dom.window.close();
P = await openAdmin().catch(() => null) || await openPage({ JSDOM, VirtualConsole, dir: MAIN, file: 'booth-admin.html', R, rest, hash: '#live' });
await until(() => P.calls.some(c => c.name === 'admin_booth_notice_enabled'), 15000); await wait(400);
const r3 = soonOf(P.d);
t('R2 되돌린 뒤 관리자 화면 — [운영자 알림] ‘준비 중’', r3[1] && /준비 중/.test(r3[1].t) && r3[1].dis, JSON.stringify(r3));
P.dom.window.close();
const m3 = await R.run(MIG);
t('R3 다시 적용 — 기록 · 켜짐 여부(켜짐) 그대로 이어 씀', m3.ok && +(await q1('select count(*) n from public.booth_notice_target')).n === recN && recN > 0 &&
  (await q1('select enabled from public.booth_notice_config where id = 1')).enabled === true, '');

const passed = results.filter(x => x.ok).length;
mkdirSync(resolve(OUT, 'rehearsal'), { recursive: true });
writeFileSync(resolve(OUT, 'rehearsal', 'booth-notice-test-report.md'), ['# 운영자 알림 시험', '',
  `- 실행: ${new Date().toISOString()} · 결과 **${passed} / ${results.length} 통과**`,
  `- 관리자 화면: ${MAIN.replace(/\\/g, '/')} · 운영자 화면: ${LIVE.replace(/\\/g, '/')} · 복제 DB = 지금 Production 단계 · 네트워크 없음`, '',
  '| 묶음 | 결과 | 시험 | 메모 |', '|---|---|---|---|',
  ...results.map(x => `| ${x.section} | ${x.ok ? '통과' : '**실패**'} | ${x.name.replace(/\|/g, '/')} | ${(x.note || '').replace(/\|/g, '/')} |`), ''].join('\n'));
console.log(`\n${passed} / ${results.length} 통과 → out/rehearsal/booth-notice-test-report.md`);
process.exit(passed === results.length ? 0 : 1);
