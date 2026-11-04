/* ===================================================================
   체험존 12곳 등록 SQL 시험 — 로컬 임시 Postgres 위에서 (Production 에 접속하지 않습니다)
   ───────────────────────────────────────────────────────────────────
   replica-20261103.sql 에 Production 의 칸 · 제약 · 트리거를 더해 부스 84곳 + 예시 부스를 만들고
     확정 잠금 → 시작 조건 → 등록 → 다시 등록 → 공개 막힘 → 공개 → 인증 · 상태 저장 → 23:00 초기화 → 공개 거두기 → 등록 없애기 → 다시 등록
   을 실제로 돌립니다. 인증 · 상태 저장은 운영 방식 migration 까지 올린 실제 함수(booth_ctrl_get · booth_ctrl_set · booth_session_get ·
   booth_session_set · booth_session_mode)를 부릅니다. PIN 값을 맞춰 보는 booth_pin_login 은 replica 에 없어 세션을 직접 넣습니다. 되돌리기 파일에 적어 둔 옛 함수의 md5 는 Production 값과 견줍니다.

   쓰는 법: node scripts/booth-live-mode/test-db-experience.mjs --deps <embedded-postgres · pg 가 설치된 폴더>
   =================================================================== */
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const req = createRequire(join(resolve(arg('deps')), 'package.json'));
const EmbeddedPostgres = req('embedded-postgres').default;
const pg = req('pg');
const DATA = arg('data', mkdtempSync(join(tmpdir(), 'booth-experience-pg-')));
const PORT = 55500 + Math.floor(Math.random() * 90);

const file = (f) => readFileSync(resolve(REPO, f), 'utf8').replace(/\r/g, '');
const MIGRATION_LOCKED = file('supabase/migration-booth-experience-zone.sql');
// 파일 그대로는 잠겨 있습니다(확정 전 실행 금지). 시험에서만 확정한 것으로 바꿔 돌립니다.
const MIGRATION = MIGRATION_LOCKED.replace('v_confirmed constant boolean := false;', 'v_confirmed constant boolean := true;');
const PUBLISH = file('supabase/publish-booth-experience-zone.sql');
const ROLLBACK = file('supabase/rollback-booth-experience-zone.sql');
const CHECK = file('supabase/check-booth-experience-zone.sql');
const REPLICA = file('scripts/booth-live-mode/replica-20261103.sql');
const LIVE_MODE = file('supabase/migration-booth-live-mode.sql');
const LIVE_ROLLBACK = file('supabase/rollback-booth-live-mode.sql');
const OLD_DEFS = LIVE_ROLLBACK.slice(LIVE_ROLLBACK.indexOf('-- 3. 2026-11-03'), LIVE_ROLLBACK.indexOf('-- 4. 새 함수'));

// 되돌리기 파일: 1번은 그대로, 2번은 주석을 풀어서
const HIDE = ROLLBACK.slice(ROLLBACK.indexOf('begin;'), ROLLBACK.indexOf('-- ── 2.'));
const REMOVE = ROLLBACK.slice(ROLLBACK.indexOf('-- ── 2.')).split('\n').filter((l) => /^-- ?/.test(l) && !/^-- [─]/.test(l) && !/^-- (아래 주석|공개 중이거나)/.test(l))
  .map((l) => l.replace(/^-- ?/, '')).join('\n');
const OLD_TRIGGER = REMOVE.slice(REMOVE.indexOf('create or replace function public.booths_before_write'), REMOVE.indexOf('create or replace function private.rehearsal_live_reset'));

const results = [];
function t(name, ok, note = '') { results.push({ ok: !!ok }); console.log(`${ok ? '통과' : '실패'}  ${name}${!ok && note ? '  — ' + note : ''}`); }
const md5 = (s) => createHash('md5').update(s).digest('hex');

const db = new EmbeddedPostgres({ databaseDir: DATA, user: 'postgres', password: 'pw', port: PORT, persistent: false, onLog: () => {}, onError: () => {} });
await db.initialise();
await db.start();
const c = new pg.Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'pw', database: 'postgres' });
await c.connect();
const q = async (s) => (await c.query(s));
const rows = async (s) => (await c.query(s)).rows;
const one = async (s) => (await rows(s))[0];
// 여러 문장 파일을 돌립니다. 실패하면 메시지를 돌려주고 연결을 깨끗이 합니다.
async function run(sql) { try { await c.query(sql); return ''; } catch (e) { await c.query('rollback').catch(() => {}); return e.message; } }

try {
  /* ── 준비: replica + Production 의 칸 · 제약 ─────────────────────── */
  await q(REPLICA);
  await q(OLD_DEFS);
  await q(LIVE_MODE);
  await q(`update public.settings set booth_pin_enabled = true; update public.booth_live_mode_config set enabled = true;`);
  await q(`
    alter table public.zones add column sub text not null default '', add column range_from integer not null default 1, add column range_to integer not null default 1,
      add column tint text not null default '#D7E6FF', add column solid text not null default '#2563C9', add column deep text not null default '#17458F';
    alter table public.booths add column created_at timestamptz not null default now(), add column program text not null default '', add column hours text not null default '',
      add column needs_power boolean not null default false, add column needs_network boolean not null default false, add column supplies text not null default '',
      add column status text not null default '준비 전', add column updated_at timestamptz not null default now(), add column image_url text not null default '',
      add column image_alt text not null default '', add column image_caption text not null default '', add column org_type text, add column preview_listed boolean not null default false;
    alter table public.booths add constraint booths_org_type_check check (org_type is null or org_type = any (array['초등','중등','고등','기관','기업','기타']));
    alter table public.booths add constraint booths_status_check check (status = any (array['준비 전','준비 완료','운영 중','일시 중단','운영 종료']));
    alter table public.booths add constraint booths_published_needs_slot check (not is_published or (zone_key is not null and no is not null));
    create table if not exists public.booth_pin (booth_id uuid primary key references public.booths(id) on delete cascade, pin_hash text not null,
      issued_at timestamptz not null default now(), reissued_at timestamptz, disabled_at timestamptz, issued_by uuid);
    create schema if not exists cron;
    create table cron.job (jobname text, schedule text, active boolean);
    insert into cron.job values ('booth-rehearsal-reset', '0 14 * * *', true);
    create function private.booth_pin_vault_revoke(p_booth uuid) returns void language sql as $$ select $$;
  `);
  await q(OLD_TRIGGER);
  await q(`create trigger trg_booths_before_write before insert or update on public.booths for each row execute function public.booths_before_write();`);

  /* ── 준비: 학교 84곳 + 예시 구역 ─────────────────────────────────── */
  await q(`delete from public.booths; delete from public.zones;
    insert into public.zones (key, label, sort_order, is_published) values ('초등','초등',1,true), ('중등','중등',2,true), ('고등','고등',3,true), ('특수','특수',4,true), ('D','미래채움존',4,false), ('E','빅테크존',5,false);`);
  const zoneOf = (n) => (n <= 29 ? '고등' : n === 48 ? '특수' : n <= 55 ? '중등' : '초등');
  const ids = Array.from({ length: 84 }, () => randomUUID());
  for (let i = 0; i < 84; i++) {
    await c.query(`insert into public.booths (id, no, zone_key, name, org, org_type, sort_order, is_published, preview_listed) values ($1,$2,$3,$4,$5,$6,$7,true,true)`,
      [ids[i], i + 1, zoneOf(i + 1), `학교 부스 ${i + 1}`, `시험학교 ${i + 1}`, zoneOf(i + 1) === '특수' ? '기타' : zoneOf(i + 1), 1001 + i]);
    await c.query(`insert into public.booth_access (booth_id, token) values ($1, $2)`, [ids[i], `tok-${i}`]);
    await c.query(`insert into public.booth_pin (booth_id, pin_hash) values ($1, $2)`, [ids[i], `hash-${i}`]);
    await c.query(`insert into public.booth_live (booth_id, congestion, wait_minutes, updated_at) values ($1, '여유', 5, now())`, [ids[i]]);
  }
  await q(`insert into public.booths (no, zone_key, name, org, is_published) values (1, 'D', '예시 부스', '[예시] 학교', false);`);
  await q(`create or replace function private.rehearsal_booth_ids() returns uuid[] language sql immutable set search_path to '' as $$ select array[${ids.map((x) => `'${x}'::uuid`).join(',')}] $$;`);
  await q(REMOVE.slice(REMOVE.indexOf('create or replace function private.rehearsal_live_reset'), REMOVE.indexOf('commit;')));

  const fp = async () => (await one(`select md5(string_agg((to_jsonb(b) - 'booth_type')::text || coalesce(a.token,'') || coalesce(p.pin_hash,''), E'\n' order by b.id)) as v, count(*)::int as n
    from public.booths b left join public.booth_access a on a.booth_id = b.id left join public.booth_pin p on p.booth_id = b.id where b.zone_key in ('초등','중등','고등','특수')`));
  const src = async (fn) => (await one(`select prosrc from pg_proc where oid = '${fn}'::regprocedure`)).prosrc;

  t('R1 되돌리기 파일의 옛 번호 규칙 = Production md5', md5((await src('public.booths_before_write()')).replace(/\r/g, '')) === '7cc3adfefbf22bf5993705352903ea1f', md5(await src('public.booths_before_write()')));
  t('R2 되돌리기 파일의 옛 23:00 초기화 = Production md5', md5((await src('private.rehearsal_live_reset()')).replace(/\r/g, '')) === 'ddfca11ab8541f58ac5cc015a13fbb61', md5(await src('private.rehearsal_live_reset()')));
  const before = await fp();
  t('준비 학교 84곳', before.n === 84, String(before.n));

  /* ── 시작 조건 ───────────────────────────────────────────────────── */
  const LIST = [['게임', '카미봇 미션 레이싱 챌린지'], ['게임', '나만의 앨범만들기'], ['게임', '나도 될 수 있다, 케이팝 아이돌'], ['게임', '경찰과 도둑'],
    ['교육', '나는야 아케이드 게임제작자'], ['교육', 'AI 동화책 작가 되기'], ['교육', '스마트 모빌리티의 기초 : 엠봇으로 배우는 로봇제어'], ['교육', '나만의 필터 카메라앱 만들기'],
    ['교육', '내가 만드는 AR 방탈출 - 장면전환과 코딩의마법'], ['교육', '돌려라! 맞춰라! AI Cube 코딩챌린지'], ['교육', '알티노로 배우는 AI 음성인식 자율주행 모빌리티'], ['교육', 'AI와 함께 뚝딱 나만의 4컷 웹툰 만들기']];
  const noExp = async () => (await one(`select count(*)::int n from public.zones where key = '체험'`)).n === 0;
  const hasCol = async () => (await one(`select count(*)::int n from information_schema.columns where table_name = 'booths' and column_name = 'booth_type'`)).n === 1;
  let err = await run(MIGRATION_LOCKED);
  t('L1 파일 그대로 실행하면 확정 잠금으로 멈추고 아무것도 바꾸지 않음', /확정되지 않았습니다/.test(err) && await noExp() && !(await hasCol()), err);
  const pre = (await c.query(CHECK)).rows;
  t('L2 점검 SQL 은 등록 전에도 돌아감(유형 칸이 없어도) · STOP 없음', !pre.some((r) => r['판정'] === 'STOP') && pre.find((r) => r['순서'] === 9)['지금'] === '0', JSON.stringify(pre.filter((r) => r['판정'] === 'STOP')));
  await q(`insert into public.zones (key, label, sort_order, is_published) values ('미래', '미래채움존', 9, false)`);
  err = await run(MIGRATION);
  t('L3 구역 미래가 있으면 지우지 않고 멈춤', /구역 미래가 이미 있습니다/.test(err) && await noExp(), err);
  t('L4 점검 SQL 도 구역 미래를 STOP 으로 알림', (await c.query(CHECK)).rows.find((r) => r['순서'] === 16)['판정'] === 'STOP');
  await q(`delete from public.zones where key = '미래'`);
  await q(`insert into public.booths (no, zone_key, name, org) values (2, 'D', '경찰과 도둑', '[예시] 겹침')`);
  err = await run(MIGRATION);
  t('M1 같은 이름의 부스가 있으면 멈추고 아무것도 바꾸지 않음', /같은 이름/.test(err) && await noExp(), err);
  await q(`delete from public.booths where name = '경찰과 도둑'`);

  /* ── 등록 ────────────────────────────────────────────────────────── */
  err = await run(MIGRATION);
  t('M2 등록 적용', !err, err);
  const f = await rows(`select id, no, code, name, org, org_type, booth_type, is_published, status, preview_listed from public.booths where zone_key = '체험' order by no`);
  t('M3 12곳 · 번호 체험1 ~ 체험12 · 이름은 받은 목록 그대로', f.length === 12 && f.every((b, i) => b.code === `체험${i + 1}` && b.no === i + 1 && b.name === LIST[i][1]), JSON.stringify(f.map((b) => [b.code, b.name])));
  t('M3b 유형은 별도 칸: 게임 4 · 교육 8 · 이름에 괄호 유형 없음', f.filter((b) => b.booth_type === '게임').length === 4 && f.filter((b) => b.booth_type === '교육').length === 8 && f.every((b, i) => b.booth_type === LIST[i][0] && !/\((게임|교육)\)/.test(b.name)));
  t('M3c 운영기관은 지어 내지 않고 비움', f.every((b) => b.org === '' && b.org_type === null));
  t('M4 비공개 · 구역 비공개', f.every((b) => !b.is_published && !b.preview_listed) && !(await one(`select is_published from public.zones where key = '체험'`)).is_published);
  t('M5 고유 ID 는 UUID 로 겹치지 않고 학교 84곳과도 다름', new Set(f.map((b) => b.id)).size === 12 && f.every((b) => !ids.includes(b.id)));
  t('M6 학교 84곳 줄 · QR · PIN 그대로(수정 시각까지) · 유형 칸은 비어 있음', (await fp()).v === before.v && (await one(`select count(*)::int n from public.booths where zone_key <> '체험' and booth_type is not null`)).n === 0);
  const badType = await run(`update public.booths set booth_type = '기타' where id = '${f[0].id}'`);
  t('M6b 유형 칸은 게임 · 교육만 받음', /booths_booth_type_check/.test(badType), badType);
  const again = await run(MIGRATION);
  t('M7 다시 실행해도 그대로(12곳 · 84곳)', !again && (await one(`select count(*)::int n from public.booths where zone_key = '체험'`)).n === 12 && (await fp()).v === before.v, again);
  await q(`insert into public.booths (no, zone_key, name, org) values (3, 'D', '다른 구역', '[예시] 학교')`);
  await q(`update public.booths set name = name where no = 5 and zone_key = '고등'`);
  t('M8 다른 구역 번호 규칙 그대로(D-03 · 학교 번호 그대로)', (await one(`select code from public.booths where zone_key = 'D' and no = 3`)).code === 'D-03' && (await one(`select code from public.booths where zone_key = '고등' and no = 5`)).code === '5');
  const dup = await run(`insert into public.booths (no, zone_key, name, org) values (1, '체험', '겹침', '겹침')`);
  t('M9 같은 번호는 DB 가 막음(zone_key + no)', /duplicate key|booths_zone_key_no_key|unique/i.test(dup), dup);
  t('M10 고등 1번과 체험 1번은 함께 있을 수 있고 UUID 로 구분', (await one(`select count(*)::int n from public.booths where no = 1`)).n >= 2);

  /* ── 공개 ────────────────────────────────────────────────────────── */
  err = await run(PUBLISH);
  t('P1 QR · PIN 이 없으면 공개를 막고 그대로 둠', /QR 0 \/ 12곳/.test(err) && !(await one(`select is_published from public.zones where key = '체험'`)).is_published, err);
  const KEY = Object.fromEntries(f.map((b) => [b.no, randomBytes(18).toString('base64url')]));
  for (const b of f.slice(0, 11)) { await c.query(`insert into public.booth_access (booth_id, token) values ($1, $2)`, [b.id, KEY[b.no]]); await c.query(`insert into public.booth_pin (booth_id, pin_hash) values ($1, $2)`, [b.id, `h-${b.no}f`]); }
  err = await run(PUBLISH);
  t('P2 한 곳이라도 빠지면 공개를 막음(11 / 12)', /QR 11 \/ 12곳/.test(err), err);
  await c.query(`insert into public.booth_access (booth_id, token) values ($1, $2)`, [f[11].id, KEY[12]]);
  await c.query(`insert into public.booth_pin (booth_id, pin_hash) values ($1, 'h-12f')`, [f[11].id]);
  err = await run(PUBLISH);
  const pub = await one(`select count(*)::int n, count(*) filter (where zone_key = '체험')::int f from public.booths b where b.is_published and b.org !~ '^\\s*\\[예시\\]'`);
  t('P3 공개: 전체 96곳 = 학교 84 + 체험존 12', !err && pub.n === 96 && pub.f === 12, err || JSON.stringify(pub));
  t('P4 공개해도 학교 84곳 그대로', (await fp()).v === before.v);

  /* ── 인증 · 상태 저장(실제 함수) ─────────────────────────────────── */
  const call = (text, params) => c.query(text, params).then((r) => r.rows, (e) => ({ error: e.message, hint: e.hint || '' }));
  const firstOf = (r) => (Array.isArray(r) ? r[0] : r);
  const schoolLive = async () => (await one(`select md5(string_agg(l.booth_id::text || l.congestion || coalesce(l.wait_minutes::text, '') || l.updated_at::text, ',' order by l.booth_id)) v from public.booth_live l join public.booths b on b.id = l.booth_id where b.zone_key <> '체험'`)).v;
  const live0 = await schoolLive();
  const sha = (x) => createHash('sha256').update(x, 'utf8').digest();
  const SESS = randomBytes(32).toString('base64url'), SESS_OLD = randomBytes(32).toString('base64url');
  await c.query(`insert into public.booth_session (booth_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day'), ($1, $3, now() - interval '1 minute')`, [f[3].id, sha(SESS), sha(SESS_OLD)]);

  const key = firstOf(await call(`select * from public.booth_ctrl_get($1)`, [KEY[1]]));
  t('A1 QR 열쇠로 체험1 을 찾음: 번호 · 구역 이름 · 프로그램명', key && key.code === '체험1' && key.zone_label === '체험존' && key.name === LIST[0][1], JSON.stringify(key));
  const set = firstOf(await call(`select * from public.booth_ctrl_set($1, 'open', 10)`, [KEY[2]]));
  t('A2 QR 로 대기 10분 저장: 체험2 에만 · 여유', set && set.code === '체험2' && set.congestion === '여유' && set.wait_minutes === 10, JSON.stringify(set));
  const paused = firstOf(await call(`select * from public.booth_ctrl_set($1, 'pause', null)`, [KEY[2]]));
  const closed = firstOf(await call(`select * from public.booth_ctrl_set($1, 'closed', null)`, [KEY[3]]));
  t('A3 잠시 중단 · 오늘 운영 마감 저장', paused && paused.congestion === '중단' && closed && closed.congestion === '마감', JSON.stringify([paused, closed]));
  const sess = firstOf(await call(`select * from public.booth_session_get($1)`, [SESS]));
  t('A4 PIN 세션으로 체험4 를 찾음', sess && sess.code === '체험4' && sess.name === LIST[3][1] && sess.zone_label === '체험존', JSON.stringify(sess));
  const sSet = firstOf(await call(`select * from public.booth_session_set($1, 'open', 30)`, [SESS]));
  t('A5 PIN 세션으로 대기 30분 저장: 혼잡', sSet && sSet.code === '체험4' && sSet.congestion === '혼잡' && sSet.wait_minutes === 30, JSON.stringify(sSet));
  const toResv = firstOf(await call(`select * from public.booth_session_mode($1, 'reserve')`, [SESS]));
  const rOpen = firstOf(await call(`select * from public.booth_session_set($1, 'resv_open', null)`, [SESS]));
  const rClosed = firstOf(await call(`select * from public.booth_session_set($1, 'resv_closed', null)`, [SESS]));
  t('A6 현장예약으로 바꾸고 운영 중 · 예약 마감 저장', !toResv.error && rOpen && rOpen.congestion === '예약중' && rClosed && rClosed.congestion === '예약마감', JSON.stringify([toResv, rOpen, rClosed]));
  const waitInResv = await call(`select * from public.booth_session_set($1, 'open', 10)`, [SESS]);
  t('A7 현장예약 부스에 대기 시간은 서버가 거절', !!waitInResv.error, JSON.stringify(waitInResv));
  t('A8 체험존 저장이 학교 부스 상태를 바꾸지 않음', (await schoolLive()) === live0);
  const wrong = await call(`select * from public.booth_ctrl_get($1)`, ['B'.repeat(24)]);
  const expired = await call(`select * from public.booth_session_get($1)`, [SESS_OLD]);
  t('A9 모르는 열쇠 · 끝난 세션으로는 들어오지 못함', Array.isArray(wrong) && wrong.length === 0 && (!!expired.error || expired.length === 0), JSON.stringify([wrong, expired]));
  await q(`delete from public.booth_live where booth_id in (select id from public.booths where zone_key = '체험');
    delete from public.booth_live_mode where booth_id in (select id from public.booths where zone_key = '체험');`);

  /* ── 23:00 초기화 ────────────────────────────────────────────────── */
  await q(`insert into public.booth_live_mode (booth_id, mode) values ('${f[0].id}', 'reserve');
    insert into public.booth_live (booth_id, congestion, wait_minutes, updated_at) values ('${f[0].id}', '예약중', 0, now()), ('${f[1].id}', '보통', 15, now());
    insert into public.booth_live (booth_id, congestion, wait_minutes, updated_at) select id, '여유', 0, now() from public.booths where zone_key = 'D' and no = 1;`);
  const n = (await one(`select private.rehearsal_live_reset() as n`)).n;
  const left = await one(`select count(*)::int n, count(*) filter (where b.zone_key = '체험')::int f, count(*) filter (where b.zone_key = 'D')::int d from public.booth_live l join public.booths b on b.id = l.booth_id`);
  t('Z1 23:00 초기화: 학교 84 + 체험존 2 = 86줄 지움 · 예시 구역은 그대로', n === 86 && left.f === 0 && left.d === 1 && left.n === 1, JSON.stringify([n, left]));
  t('Z2 운영 방식은 유지(체험1 현장예약)', (await one(`select mode from public.booth_live_mode where booth_id = '${f[0].id}'`)).mode === 'reserve');
  t('Z3 84곳 목록은 그대로(리허설 · 공통 PIN 대상 안 바뀜)', (await one(`select cardinality(private.rehearsal_booth_ids()) n`)).n === 84);

  /* ── 점검 SQL ────────────────────────────────────────────────────── */
  const chk = (await c.query(CHECK)).rows;
  t('C1 점검 SQL: STOP 없음 · 번호 규칙 · 초기화 대상 적용됨 · 유형 4 / 8', !chk.some((r) => r['판정'] === 'STOP') && chk.find((r) => r['순서'] === 6)['지금'] === '적용됨' && chk.find((r) => r['순서'] === 7)['지금'] === '체험존 포함' && chk.find((r) => r['순서'] === 15)['지금'] === '4 / 8', JSON.stringify(chk.filter((r) => r['판정'] === 'STOP')));

  /* ── 되돌리기 ────────────────────────────────────────────────────── */
  err = await run(REMOVE);
  t('B1 공개 중에는 등록 없애기를 막음', /공개 중인/.test(err), err);
  err = await run(HIDE);
  const hid = await one(`select count(*) filter (where is_published)::int p, count(*)::int n from public.booths where zone_key = '체험'`);
  t('B2 공개 거두기: 12곳 비공개 · 줄은 남음 · 전체 84곳 · QR · PIN 그대로', !err && hid.p === 0 && hid.n === 12 && (await one(`select count(*)::int n from public.booth_access a join public.booths b on b.id = a.booth_id where b.zone_key = '체험'`)).n === 12 && (await fp()).v === before.v, err);
  const hiddenKey = await call(`select * from public.booth_ctrl_get($1)`, [KEY[1]]);
  t('B2b 공개를 거두면 그 열쇠로 운영 화면이 열리지 않음', Array.isArray(hiddenKey) && hiddenKey.length === 0, JSON.stringify(hiddenKey));
  await q(`insert into public.booth_live_log (booth_id, congestion, wait_minutes, source) select id, '여유', 5, 'admin' from public.booths where zone_key = '체험' limit 1`).catch(() => {});
  const hasLog = (await one(`select count(*)::int n from public.booth_live_log g join public.booths b on b.id = g.booth_id where b.zone_key = '체험'`)).n > 0;
  if (hasLog) {
    err = await run(REMOVE);
    t('B3 입력 기록이 있으면 등록 없애기를 막음', /입력 기록/.test(err), err);
    await q(`delete from public.booth_live_log where booth_id in (select id from public.booths where zone_key = '체험')`);
  }
  err = await run(REMOVE);
  t('B4 등록 없애기: 12곳 · 구역 · 유형 칸 없음 · QR · PIN 도 사라짐', !err && (await one(`select count(*)::int n from public.booths where zone_key = '체험'`)).n === 0 && await noExp() && !(await hasCol()) && (await one(`select count(*)::int n from public.booth_access`)).n === 84, err);
  t('B5 함수가 Production 정의로 돌아옴(md5)', md5((await src('public.booths_before_write()')).replace(/\r/g, '')) === '7cc3adfefbf22bf5993705352903ea1f' && md5((await src('private.rehearsal_live_reset()')).replace(/\r/g, '')) === 'ddfca11ab8541f58ac5cc015a13fbb61');
  t('B6 학교 84곳 그대로', (await fp()).v === before.v);
  err = await run(MIGRATION);
  t('B7 되돌린 뒤 다시 등록할 수 있음', !err && (await one(`select count(*)::int n from public.booths where zone_key = '체험'`)).n === 12, err);
} finally {
  await c.end().catch(() => {});
  await db.stop().catch(() => {});
  try { rmSync(DATA, { recursive: true, force: true }); } catch { /* 임시 폴더 */ }
}
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} 통과`);
process.exit(bad ? 1 : 0);
