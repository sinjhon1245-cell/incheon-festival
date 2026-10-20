/* ===================================================================
   Gate 3-C 로컬 시험 — 사전 안내 · 예시 전환 · QR 사전 발급 · 배치 뒤 접속
   ───────────────────────────────────────────────────────────────────
   PGlite(PostgreSQL 17, pgcrypto)에 Production 과 같은 표 · 제약 · 트리거 · 함수 · 공개 규칙
   (dryrun/replica-schema.sql + dryrun/replica-functions.sql)을 만들고, 예시 50곳 · 실제 84곳을
   넣은 뒤 Gate 3-C SQL(out/gate3c/)과 migration-booth-preview.sql 을 고치지 않고 돌립니다.

   ⚠️ Production 에 접속하지 않습니다. 열쇠 · PIN 은 모두 이 시험에서 만든 가짜 값이고,
      열쇠 값은 출력하지 않습니다(같은지 · 다른지만 봅니다).

   준비: npm install @electric-sql/pglite@0.4.4   (PostgreSQL 17.5 — Production 17.6 과 같은 메이저)
   쓰는 법: node scripts/booth-data/test-gate3c.mjs --pglite-dir <위 폴더>
   결과: out/gate3c/test-report.md
   =================================================================== */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsv } from './lib/csv.mjs';
import { loadPglite, openReplica, helpers, TEST_PIN } from './lib/replica.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT = resolve(HERE, 'out');
const G3 = resolve(OUT, 'gate3c');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const dir = arg('pglite-dir');
if (!dir) { console.error('--pglite-dir 가 필요합니다.'); process.exit(2); }
const lib = await loadPglite(dir);

const SQL = f => readFileSync(resolve(G3, f), 'utf8');
const targets = JSON.parse(readFileSync(resolve(G3, 'targets.json'), 'utf8'));
const manifest = readCsv(resolve(OUT, 'staging', 'manifest.csv'));
const snap = readCsv(resolve(OUT, readdirSync(OUT).filter(f => /^prod-snapshot-\d{8}\.csv$/.test(f)).sort().pop()));
const DEV = 'dryrun-device-000000000001';
const key = k => manifest.find(m => m.doc_key === k).booth_id;

async function fresh() { return (await openReplica(lib, { snap, manifest })).db; }
const asAdmin = (db, fn) => helpers(db).asAdmin(fn);
const asAnon = (db, sql, params) => helpers(db).asAnon(sql, params);
const run = (db, sql) => helpers(db).run(sql);
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0];
const tokenOf = async (db, id) => (await one(db, 'select token from public.booth_access where booth_id = $1', [id]))?.token || null;
const tokensFp = async (db, ids) => (await one(db, 'select md5(coalesce(string_agg(booth_id::text || token, \',\' order by booth_id), \'\')) f from public.booth_access where booth_id = any($1::uuid[])', [ids])).f;
const ctrlRows = async (db, token) => (await db.query('select * from public.booth_ctrl_get($1)', [token])).rows;
const protectedFp = async db => (await one(db, `select concat_ws('|',
  (select md5(coalesce(string_agg(booth_id::text || md5(token) || coalesce(rotated_at::text,'') || coalesce(disabled_at::text,''), ',' order by booth_id), '')) from public.booth_access),
  (select md5(coalesce(string_agg(booth_id::text || md5(pin_hash) || coalesce(disabled_at::text,''), ',' order by booth_id), '')) from public.booth_pin),
  (select md5(coalesce(string_agg(row_to_json(l)::text, ',' order by booth_id), '')) from public.booth_live l),
  (select count(*) || '/' || coalesce(max(id), 0) from public.booth_live_log),
  (select count(*) from public.booth_session)) f`)).f;

const results = [];
function t(name, ok, note = '') { results.push({ name, ok: !!ok, note }); console.log(`${ok ? '통과' : '실패'}  ${name}${note ? '  — ' + note : ''}`); }

// ══ A. 주 흐름 ══════════════════════════════════════════════════════
let db = await fresh();
const seedFp = await protectedFp(db);
const exA01 = snap.find(s => s.code === 'A-01').id, exA02 = snap.find(s => s.code === 'A-02').id;

// 0. 기준선 — 지금 Production 과 같은 상태
t('0-1 기준: 익명에게 공개 부스 50 · 사전 안내 함수 없음', (await asAnon(db, 'select count(*)::int n from public.booths'))[0].n === 50);
const exTok = await tokenOf(db, exA02);
t('0-2 기준: 예시 QR 로 운영자 화면 열림', (await ctrlRows(db, exTok)).length === 1);
const sess = await one(db, 'select * from public.booth_pin_login($1, $2, $3)', [exA02, '000000', DEV]);
t('0-3 기준: 예시 공통 PIN(시험값) 로그인 성공 · 세션 생김', sess.ok === true && !!sess.session, sess.reason || '');
const pinOk = await one(db, 'select * from public.booth_pin_login($1, $2, $3)', [exA01, TEST_PIN, DEV + '2']);
t('0-4 기준: 예시 A-01 개별 PIN(시험값) 로그인 성공', pinOk.ok === true);

// 1. migration 전에 전환을 돌리면 멈춤
let r = await run(db, SQL('C-02-transition.sql'));
t('1-1 migration 전 전환 → 중단(아무것도 안 바뀜)', !r.ok && /적용되지 않았습니다/.test(r.error) && (await protectedFp(db)) !== null && (await one(db, 'select count(*)::int n from public.booths where is_published')).n === 50, r.error?.slice(0, 60));

// 2. migration-booth-preview.sql
r = await run(db, readFileSync(resolve(REPO, 'supabase/migration-booth-preview.sql'), 'utf8'));
t('2-1 migration 적용 · 확인 쿼리', r.ok, r.error || '');
const chk = (await db.query(readFileSync(resolve(REPO, 'supabase/migration-booth-preview.sql'), 'utf8').split('-- ── 적용 확인')[1].replace(/^[^\n]*\n/, ''))).rows;
t('2-2 migration 확인 5항목 모두 참', chk.length === 5 && chk.every(x => x['맞음'] === true), chk.map(x => `${x['확인']}=${x['맞음']}`).join(' · '));
t('2-3 사전 안내 목록 0(칸 기본값 false)', (await asAnon(db, 'select count(*)::int n from public.booth_preview_list()'))[0].n === 0);
await db.query('update public.booths set preview_listed = true where id = $1', [exA02]);
t('2-4 [예시] 부스는 사전 안내를 켜도 목록에 안 나옴', (await asAnon(db, 'select count(*)::int n from public.booth_preview_list()'))[0].n === 0);
await db.query('update public.booths set preview_listed = false where id = $1', [exA02]);

// 3. 전환
const fpBeforeTransition = await protectedFp(db);
r = await run(db, SQL('C-01-precheck.sql'));
t('3-1 C-01 직전 확인(읽기 전용) 실행', r.ok && r.last['예시'] == 50 && r.last['실제'] == 84 && r.last['실제_공개_또는_배정'] == 0 && r.last['preview_칸'] === true, r.error || `예시 ${r.last?.['예시']} · 실제 ${r.last?.['실제']}`);
r = await run(db, SQL('C-02-transition.sql'));
t('3-2 C-02 전환 성공', r.ok && r.notices.some(n => n.includes('[전환 완료]')), r.error || r.notices.join(' / '));
r = await run(db, SQL('C-03-verify.sql'));
const v = r.last || {};
t('3-3 C-03: 공개 0 · 예시 공개 0 · 예시 구역 공개 0 · 사전 안내 84 · 공통 PIN 끔 · PIN 보조 로그인 그대로',
  r.ok && v['공개_부스'] == 0 && v['예시_공개'] == 0 && v['예시_구역_공개'] == 0 && v['사전_안내'] == 84 && v['사전_안내_실제'] == 84 && v['예시_공통pin'] === false && v['pin_보조로그인'] === true && v['실제_qr'] == 0,
  JSON.stringify(v).slice(0, 160));
t('3-4 QR · PIN · 대기 값 · 기록 · 세션 그대로(지문)', (await protectedFp(db)) === fpBeforeTransition);
r = await run(db, SQL('C-02-transition.sql'));
t('3-5 전환 다시 실행 → 성공 · 변화 없음', r.ok && (await protectedFp(db)) === fpBeforeTransition && (await one(db, 'select count(*)::int n from public.booths where is_published')).n === 0);

// 4. 관람객(익명) 시점
const anonBooths = (await asAnon(db, 'select count(*)::int n from public.booths'))[0].n;
const preview = await asAnon(db, 'select * from public.booth_preview_list()');
t('4-1 익명: 공개 부스 0 · 사전 안내 84', anonBooths === 0 && preview.length === 84);
t('4-2 사전 안내 칸은 id · name · org · program 넷뿐', JSON.stringify(Object.keys(preview[0])) === JSON.stringify(['id', 'name', 'org', 'program']), Object.keys(preview[0]).join(','));
t('4-3 익명: 대기 값 0 · 공개 구역 0', (await asAnon(db, 'select count(*)::int n from public.booth_live'))[0].n === 0 && (await asAnon(db, 'select count(*)::int n from public.zones'))[0].n === 0);
t('4-4 사전 안내 순서 = 문서 순서(S01 먼저)', preview[0].id === key('S01') && preview[83].id === key('S84'));

// 5. 예시 접근 차단
t('5-1 예시 QR → 운영자 화면 안 열림', (await ctrlRows(db, exTok)).length === 0);
const pinNow = await one(db, 'select * from public.booth_pin_login($1, $2, $3)', [exA01, TEST_PIN, DEV + '3']);
t('5-2 예시 A-01 개별 PIN → 거절', pinNow.ok === false, pinNow.reason);
const commonNow = await one(db, 'select * from public.booth_pin_login($1, $2, $3)', [exA02, '000000', DEV + '4']);
t('5-3 예시 공통 PIN → 거절', commonNow.ok === false, commonNow.reason);
r = await run(db, `select * from public.booth_session_set('${sess.session}', 'open', 10)`);
t('5-4 전환 전에 열린 공통 PIN 세션 → 더 못 씀', !r.ok && /운영할 수 없습니다|더 이상 쓸 수 없습니다/.test(r.error), r.error?.slice(0, 50));

// 6. QR 사전 발급
const fpBeforeQr = await protectedFp(db);
const exTokensBefore = await tokensFp(db, targets.exampleIds);
r = await run(db, SQL('Q-01-precheck.sql'));
t('6-1 Q-01 직전 확인', r.ok && r.last['실제'] == 84 && r.last['실제_qr'] == 0, JSON.stringify(r.last));
r = await run(db, SQL('Q-02-qr-preissue.sql'));
t('6-2 Q-02 사전 발급 성공(84)', r.ok && r.notices.some(n => /새로 84 곳/.test(n)), r.error || r.notices.join(' / '));
const realTokFp = await tokensFp(db, targets.realIds);
t('6-3 실제 84곳 모두 열쇠 · 24자', (await one(db, "select count(*)::int n from public.booth_access where booth_id = any($1::uuid[]) and token ~ '^[A-Za-z0-9_-]{24}$' and disabled_at is null", [targets.realIds])).n === 84);
t('6-4 예시 열쇠 그대로', (await tokensFp(db, targets.exampleIds)) === exTokensBefore);
let opened = 0;
for (const id of targets.realIds) opened += (await ctrlRows(db, await tokenOf(db, id))).length;
t('6-5 사전 발급 QR 84개 모두 운영자 화면 안 열림', opened === 0);
r = await run(db, SQL('Q-02-qr-preissue.sql'));
t('6-6 다시 실행 → 새로 0 · 열쇠 그대로', r.ok && r.notices.some(n => /새로 0 곳/.test(n)) && (await tokensFp(db, targets.realIds)) === realTokFp, r.notices.join(' / '));
await asAdmin(db, async () => { await db.query('select * from public.admin_issue_booth_tokens(null)'); });
t('6-7 관리자 화면 일괄 발급(기존 함수)을 눌러도 실제 열쇠 그대로', (await tokensFp(db, targets.realIds)) === realTokFp);
t('6-8 실제 부스 PIN 로그인 → 거절(PIN 없음 · 비공개)', (await one(db, 'select * from public.booth_pin_login($1, $2, $3)', [key('S13'), TEST_PIN, DEV + '5'])).ok === false);

// 7. 나중의 구역 배치 — 같은 UUID · 같은 열쇠로 정식 운영
const s13 = key('S13'), s04 = key('S04'), s28 = key('S28');
const tok13 = await tokenOf(db, s13);
await db.exec("insert into public.zones (key, label, sort_order, is_published) values ('SW', '스쿨존 웨이브홀', 20, false);");
await db.query("update public.booths set zone_key = 'SW', no = 1 where id = $1", [s13]);
await db.query("update public.booths set zone_key = 'SW', no = 2 where id = $1", [s04]);
await db.query("update public.booths set zone_key = 'SW', no = 3 where id = $1", [s28]);
t('7-1 배정만 하면(비공개) 운영자 화면 안 열림', (await ctrlRows(db, tok13)).length === 0);
r = await run(db, `update public.booths set zone_key = 'SW', no = 2 where id = '${s28}'`);
t('7-2 같은 구역 · 번호 중복 배정 → DB 가 거절', !r.ok && /booths_zone_no_key|duplicate/.test(r.error));
await db.exec("update public.zones set is_published = true where key = 'SW';");
await db.query('update public.booths set is_published = true where id = any($1::uuid[])', [[s13, s04, s28]]);
const live13 = await ctrlRows(db, tok13);
t('7-3 공개 뒤: 사전 발급한 같은 열쇠로 운영자 화면 열림 · 번호 SW-01', live13.length === 1 && live13[0].code === 'SW-01' && live13[0].booth_id === s13, live13[0]?.code);
t('7-4 열쇠 그대로(배치 · 공개가 열쇠를 바꾸지 않음)', (await tokenOf(db, s13)) === tok13);
r = await run(db, `select * from public.booth_ctrl_set('${tok13}', 'open', 12)`);
t('7-5 대기 시간 입력(보통 12분) 성공', r.ok && (await one(db, 'select congestion from public.booth_live where booth_id = $1', [s13])).congestion === '보통');
await db.query('update public.booths set no = 7 where id = $1', [s13]);
const moved = await ctrlRows(db, tok13);
t('7-6 번호를 바꿔도 같은 열쇠 · 같은 UUID · 새 번호 SW-07', moved.length === 1 && moved[0].code === 'SW-07' && (await tokenOf(db, s13)) === tok13, moved[0]?.code);
t('7-7 공개된 3곳은 사전 안내 목록에서 빠지고 공개 목록으로', (await asAnon(db, 'select count(*)::int n from public.booth_preview_list()'))[0].n === 81 && (await asAnon(db, 'select count(*)::int n from public.booths'))[0].n === 3);
const rot = await asAdmin(db, async () => (await db.query('select * from public.admin_rotate_booth_token($1)', [s13])).rows[0]);
t('7-8 열쇠 바꾸기 → 옛 열쇠 거절 · 새 열쇠 열림', (await ctrlRows(db, tok13)).length === 0 && (await ctrlRows(db, rot.token)).length === 1);
r = await run(db, SQL('Q-09-qr-rollback.sql'));
t('7-9 공개 · 기록이 생긴 뒤 QR 되돌리기 → 거절', !r.ok && /공개된 실제 부스|대기 값/.test(r.error), r.error?.slice(0, 50));
r = await run(db, SQL('C-09-transition-rollback.sql'));
t('7-10 배치된 뒤 전환 되돌리기 → 거절', !r.ok && /이미 배정/.test(r.error), r.error?.slice(0, 50));
await db.close();

// ══ B. 되돌리기 흐름 ═══════════════════════════════════════════════
db = await fresh();
const seed2 = await protectedFp(db);
await run(db, readFileSync(resolve(REPO, 'supabase/migration-booth-preview.sql'), 'utf8'));
await run(db, SQL('C-02-transition.sql'));
await run(db, SQL('Q-02-qr-preissue.sql'));
r = await run(db, SQL('Q-09-qr-rollback.sql'));
t('8-1 QR 되돌리기(배치 전) → 84줄 삭제 · 예시 열쇠 그대로', r.ok && r.notices.some(n => /84 줄 삭제/.test(n)) && (await one(db, 'select count(*)::int n from public.booth_access')).n === 50, r.error || r.notices.join(' / '));
r = await run(db, SQL('C-09-transition-rollback.sql'));
t('8-2 전환 되돌리기 → 예시 50 공개 · A~E 공개 · 사전 안내 0 · 공통 PIN 켬', r.ok && (await one(db, 'select count(*)::int n from public.booths where is_published')).n === 50
  && (await one(db, "select count(*)::int n from public.zones where key in ('A','B','C','D','E') and is_published")).n === 5
  && (await one(db, 'select count(*)::int n from public.booth_preview_list()')).n === 0
  && (await one(db, 'select booth_sample_common_pin_enabled b from public.settings')).b === true, r.error || '');
t('8-3 되돌린 뒤 QR · PIN · 대기 값 · 기록이 처음과 같음', (await protectedFp(db)) === seed2);
t('8-4 되돌린 뒤 예시 QR 다시 열림', (await ctrlRows(db, await tokenOf(db, exA02))).length === 1);
r = await run(db, readFileSync(resolve(REPO, 'supabase/rollback-booth-preview.sql'), 'utf8'));
t('8-5 rollback-booth-preview.sql → 칸 · 함수 지움', r.ok && (await one(db, "select count(*)::int n from information_schema.columns where table_name = 'booths' and column_name = 'preview_listed'")).n === 0);
await db.close();

// ══ C. 전환 안전장치 ═══════════════════════════════════════════════
db = await fresh();
await run(db, readFileSync(resolve(REPO, 'supabase/migration-booth-preview.sql'), 'utf8'));
await db.exec("insert into public.zones (key, label, sort_order, is_published) values ('SW', 'SW', 20, false);");
await db.query("update public.booths set zone_key = 'SW', no = 1 where id = $1", [key('S01')]);
const fpC = await protectedFp(db);
r = await run(db, SQL('C-02-transition.sql'));
t('9-1 실제 부스가 이미 배정된 상태에서 전환 → 중단 · 변화 없음', !r.ok && /이미 공개되었거나 구역/.test(r.error) && (await protectedFp(db)) === fpC
  && (await one(db, 'select count(*)::int n from public.booths where is_published')).n === 50, r.error?.slice(0, 60));
await db.close();

const pass = results.every(x => x.ok);
const L = ['# Gate 3-C 로컬 시험 결과', '', `- DB: PGlite · PostgreSQL 17.5 · pgcrypto(extensions) — 메모리 안 DB`,
  `- 시드: 예시 ${snap.length}(QR · 대기 값 · 기록 · 개별 PIN 2 — 가짜 값) · 실제 ${manifest.length}(비공개 · 미배정)`,
  `- SQL: out/gate3c/*.sql · supabase/migration-booth-preview.sql · rollback-booth-preview.sql 을 고치지 않고 실행`,
  '- 열쇠 · PIN 값은 출력하지 않음(지문으로 같은지만 비교)', '',
  `## 판정: ${pass ? '통과' : '실패'} (${results.filter(x => x.ok).length}/${results.length})`, '', '| 결과 | 시험 | 내용 |', '|---|---|---|'];
for (const x of results) L.push(`| ${x.ok ? '통과' : '**실패**'} | ${x.name} | ${String(x.note).replace(/\|/g, '\\|')} |`);
writeFileSync(resolve(G3, 'test-report.md'), L.join('\n') + '\n');
console.log(`${pass ? '로컬 시험 통과' : '로컬 시험 실패'} — ${results.filter(x => x.ok).length}/${results.length} · ${resolve(G3, 'test-report.md')}`);
process.exit(pass ? 0 : 1);
