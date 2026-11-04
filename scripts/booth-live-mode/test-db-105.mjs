/* ===================================================================
   미래채움존 9곳 등록 SQL 시험(96 → 105) — 로컬 임시 Postgres 위에서 (Production 에 접속하지 않습니다)
   ───────────────────────────────────────────────────────────────────
   replica-20261103.sql 에 운영 방식 · 체험존 SQL 을 차례로 올리고, 공개 자료(fixture-public-96.json)의
   학교 84곳을 넣어 운영과 같은 96곳 상태를 만듭니다. 그래서 migration-booth-future-after-experience.sql 의
   함수 md5 · 학교 · 체험 지문 검사를 파일 그대로 통과시켜 봅니다. 그 위에서
     시작 조건 → 등록 → 다시 실행 → 공개 막힘 → 공개 → 인증 · 상태 저장 → 23:00 초기화 → 숨기기 → 다시 공개
   를 실제로 돌립니다. PIN 값을 맞춰 보는 booth_pin_login 은 replica 에 없어 세션을 직접 넣습니다.

   쓰는 법: node scripts/booth-live-mode/test-db-105.mjs --deps <embedded-postgres · pg 가 설치된 폴더>
   =================================================================== */
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const req = createRequire(join(resolve(arg('deps')), 'package.json'));
const EmbeddedPostgres = req('embedded-postgres').default;
const pg = req('pg');
const DATA = arg('data', mkdtempSync(join(tmpdir(), 'booth-105-pg-')));
const PORT = 55600 + Math.floor(Math.random() * 90);

const file = (f) => readFileSync(resolve(REPO, f), 'utf8').replace(/\r/g, '');
const REPLICA = file('scripts/booth-live-mode/replica-20261103.sql');
const SCHOOLS = JSON.parse(file('scripts/booth-live-mode/fixture-public-96.json'));
const LIVE_MODE = file('supabase/migration-booth-live-mode.sql');
const LIVE_ROLLBACK = file('supabase/rollback-booth-live-mode.sql');
const OLD_DEFS = LIVE_ROLLBACK.slice(LIVE_ROLLBACK.indexOf('-- 3. 2026-11-03'), LIVE_ROLLBACK.indexOf('-- 4. 새 함수'));
const EXP_MIGRATION = file('supabase/migration-booth-experience-zone.sql').replace('v_confirmed constant boolean := false;', 'v_confirmed constant boolean := true;');
const EXP_PUBLISH = file('supabase/publish-booth-experience-zone.sql');
const EXP_ROLLBACK = file('supabase/rollback-booth-experience-zone.sql');
const EXP_REMOVE = EXP_ROLLBACK.slice(EXP_ROLLBACK.indexOf('-- ── 2.')).split('\n').filter((l) => /^-- ?/.test(l) && !/^-- [─]/.test(l) && !/^-- (아래 주석|공개 중이거나)/.test(l))
  .map((l) => l.replace(/^-- ?/, '')).join('\n');
const OLD_TRIGGER = EXP_REMOVE.slice(EXP_REMOVE.indexOf('create or replace function public.booths_before_write'), EXP_REMOVE.indexOf('create or replace function private.rehearsal_live_reset'));
const OLD_RESET = EXP_REMOVE.slice(EXP_REMOVE.indexOf('create or replace function private.rehearsal_live_reset'), EXP_REMOVE.indexOf('commit;'));
const MIGRATION = file('supabase/migration-booth-future-after-experience.sql');
const PUBLISH = file('supabase/publish-booth-future-after-experience.sql');
const ROLLBACK = file('supabase/rollback-booth-future-after-experience.sql');
const CHECK = file('supabase/check-booth-105.sql');

// 2026-11-04 사용자가 준 명단 그대로(이 표는 SQL 파일과 따로 적어 서로 견줍니다)
const FUTURE = [['에듀플라이교육협동조합', 'AI 로봇 플레이존'], ['채울샘 협동조합', '채울샘 SW체험존'], ['허니소프트협동조합', '상상ON! 자율주행 드라이빙 스쿨'],
  ['잇다에듀 협동조합', '재미를 잇다, 상상을 잇다! (잇다풋볼 & 잇다오락실)'], ['코딩랩스 협동조합', 'touch. play. Ai'], ['누구나코딩교육협동조합', 'AI 상상 공작소'],
  ['미래채움교육협동조합', '인천 바다 아케이드 대 탐험'], ['그린플래그 교육협동조합', '아이온과 함께 하는 로봇 배틀 아레나'], ['비트상상협동조합', 'AI · SW와 만나는 미래 융합 탐험대']];

const results = [];
function t(name, ok, note = '') { results.push({ ok: !!ok }); console.log(`${ok ? '통과' : '실패'}  ${name}${!ok && note ? '  — ' + note : ''}`); }
const md5 = (s) => createHash('md5').update(s).digest('hex');
const sha = (x) => createHash('sha256').update(x, 'utf8').digest();
const key24 = () => randomBytes(18).toString('base64url');

const db = new EmbeddedPostgres({ databaseDir: DATA, user: 'postgres', password: 'pw', port: PORT, persistent: false, onLog: () => {}, onError: () => {} });
await db.initialise();
await db.start();
const c = new pg.Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'pw', database: 'postgres' });
await c.connect();
const q = async (s, p) => (await c.query(s, p));
const rows = async (s, p) => (await c.query(s, p)).rows;
const one = async (s, p) => (await rows(s, p))[0];
async function run(sql) { try { await c.query(sql); return ''; } catch (e) { await c.query('rollback').catch(() => {}); return e.message; } }
const call = (text, params) => c.query(text, params).then((r) => r.rows, (e) => ({ error: e.message, hint: e.hint || '' }));
const first = (r) => (Array.isArray(r) ? r[0] : r);
const count = async (where) => (await one(`select count(*)::int n from public.booths where ${where}`)).n;

try {
  /* ── 준비: replica + 운영 방식 + Production 의 칸 · 제약 ─────────── */
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

  /* ── 준비: 학교 84곳(공개 자료) → 체험존 12곳 등록 · 공개 = 운영과 같은 96곳 ─ */
  await q(`delete from public.booths; delete from public.zones;
    insert into public.zones (key, label, sort_order, is_published) values ('초등','초등',1,true), ('중등','중등',2,true), ('고등','고등',3,true), ('특수','특수',4,true), ('D','미래채움존',4,false), ('E','빅테크존',5,false);`);
  for (const [i, b] of SCHOOLS.entries()) {
    await q(`insert into public.booths (id, no, zone_key, name, org, org_type, sort_order, is_published, preview_listed) values ($1,$2,$3,$4,$5,$6,$7,true,true)`,
      [b.id, b.no, b.zone, b.name, b.org, b.zone === '특수' ? '기타' : b.zone, 1001 + i]);
    await q(`insert into public.booth_access (booth_id, token) values ($1, $2)`, [b.id, key24()]);
    await q(`insert into public.booth_pin (booth_id, pin_hash) values ($1, $2)`, [b.id, `hash-${i}`]);
    if (i % 3) await q(`insert into public.booth_live (booth_id, congestion, wait_minutes, updated_at) values ($1, '여유', 5, now())`, [b.id]);
  }
  await q(`insert into public.booths (no, zone_key, name, org, is_published) values (1, 'D', '예시 부스', '[예시] 학교', false);`);
  await q(`create or replace function private.rehearsal_booth_ids() returns uuid[] language sql immutable set search_path to '' as $$ select array[${SCHOOLS.map((b) => `'${b.id}'::uuid`).join(',')}] $$;`);
  await q(OLD_RESET);
  let err = await run(EXP_MIGRATION);
  t('준비 체험존 12곳 등록', !err, err);
  for (const b of await rows(`select id, no from public.booths where zone_key = '체험'`)) {
    await q(`insert into public.booth_access (booth_id, token) values ($1, $2)`, [b.id, key24()]);
    await q(`insert into public.booth_pin (booth_id, pin_hash) values ($1, $2)`, [b.id, `exp-${b.no}`]);
  }
  await q(`insert into public.booth_live (booth_id, congestion, wait_minutes, updated_at) select id, '예약중', 0, now() from public.booths where zone_key = '체험' and no = 1;
    insert into public.booth_live_mode (booth_id, mode) select id, 'reserve' from public.booths where zone_key = '체험' and no = 1;`);
  err = await run(EXP_PUBLISH);
  t('준비 체험존 공개 · 공개 96곳', !err && (await count('is_published')) === 96, err);

  const src = async (fn) => (await one(`select prosrc from pg_proc where oid = '${fn}'::regprocedure`)).prosrc;
  t('R1 시험의 96곳 함수 md5 = 운영 값', md5((await src('public.booths_before_write()')).replace(/\r/g, '')) === '4412167746be88a9b52251eb9741abd0' && md5((await src('private.rehearsal_live_reset()')).replace(/\r/g, '')) === 'b201023f5f8602f6b1fb3fb28f0dc8c3');

  // 기존 96곳의 모든 값: 부스 줄(수정 시각까지) · QR · PIN · 대기 상태 · 운영 방식
  const fp = async () => (await one(`select md5(
      coalesce((select string_agg(to_jsonb(b)::text, E'\\n' order by b.id) from public.booths b where b.zone_key in ('초등','중등','고등','특수','체험')), '') ||
      coalesce((select string_agg(to_jsonb(a)::text, E'\\n' order by a.booth_id) from public.booth_access a join public.booths b on b.id = a.booth_id where b.zone_key <> '미래'), '') ||
      coalesce((select string_agg(to_jsonb(p)::text, E'\\n' order by p.booth_id) from public.booth_pin p join public.booths b on b.id = p.booth_id where b.zone_key <> '미래'), '') ||
      coalesce((select string_agg(to_jsonb(l)::text, E'\\n' order by l.booth_id) from public.booth_live l join public.booths b on b.id = l.booth_id where b.zone_key <> '미래'), '') ||
      coalesce((select string_agg(to_jsonb(m)::text, E'\\n' order by m.booth_id) from public.booth_live_mode m join public.booths b on b.id = m.booth_id where b.zone_key <> '미래'), '')) v`)).v;

  /* 점검 SQL 의 QR · PIN 지문은 운영 값이라, 시험에서는 이 DB 의 값으로 바꿔 돌립니다 */
  const fps = await one(`with school as (select b.* from public.booths b where b.zone_key in ('초등','중등','고등','특수') and b.is_published), exp as (select b.* from public.booths b where b.zone_key = '체험') select
    (select md5(string_agg(md5(a.token) || coalesce(a.rotated_at::text, ''), E'\\n' order by a.booth_id)) from public.booth_access a join school s on s.id = a.booth_id) sq,
    (select md5(string_agg(p.booth_id::text || coalesce(p.reissued_at::text, '') || coalesce(p.disabled_at::text, ''), E'\\n' order by p.booth_id)) from public.booth_pin p join school s on s.id = p.booth_id) sp,
    (select md5(string_agg(md5(a.token), E'\\n' order by a.booth_id)) from public.booth_access a join exp e on e.id = a.booth_id) eq,
    (select md5(string_agg(p.booth_id::text || coalesce(p.reissued_at::text, p.issued_at::text) || coalesce(p.disabled_at::text, ''), E'\\n' order by p.booth_id)) from public.booth_pin p join exp e on e.id = p.booth_id) ep`);
  const CHECK_T = CHECK.split('311d94b4d8169d98798dd1b25b452725').join(fps.sq).split('99524eb9b9b2166a44904707b6aa1d2c').join(fps.sp).split('b02bbd2635ff52f555f654423fabd829').join(fps.eq).split('9c08e63c8f942dc5923d5c2d84aefe80').join(fps.ep);
  const check = async () => { const r = await c.query(CHECK_T); return { items: r[0].rows, list: r[1].rows }; };

  /* ── 시작 조건 ───────────────────────────────────────────────────── */
  const pre = await check();
  t('C0 점검 SQL(등록 전): 학교 · 체험 지문이 운영 값과 같음 · STOP 없음', !pre.items.some((r) => r['판정'] === 'STOP') && pre.items.find((r) => r['번호'] === 3)['현재'] === '0', JSON.stringify(pre.items.filter((r) => r['판정'] === 'STOP')));
  const school0 = SCHOOLS[0];
  await q(`update public.booths set name = name || ' 변경' where id = $1`, [school0.id]);
  err = await run(MIGRATION);
  t('G1 학교 이름이 기준과 다르면 멈추고 아무것도 바꾸지 않음', /지문이 기준과 다릅니다/.test(err) && (await count(`zone_key = '미래'`)) === 0 && !(await one(`select count(*)::int n from public.zones where key = '미래'`)).n, err);
  await q(`update public.booths set name = $2 where id = $1`, [school0.id, school0.name]);
  await q(OLD_RESET);
  err = await run(MIGRATION);
  t('G2 초기화 함수가 96곳 판이 아니면 멈춤(체험존을 잃지 않음)', /현재 함수가 검증한 96곳 버전과 다릅니다/.test(err), err);
  await run(EXP_MIGRATION);
  const base = await fp();

  /* ── 등록 ────────────────────────────────────────────────────────── */
  err = await run(MIGRATION);
  t('M1 등록 적용', !err, err);
  const f = await rows(`select id, no, code, name, org, org_type, booth_type, is_published, status, preview_listed from public.booths where zone_key = '미래' order by no`);
  t('M2 9곳 · 번호 미래1 ~ 미래9 · 기관 · 프로그램명이 명단과 글자까지 같음', f.length === 9 && f.every((b, i) => b.code === `미래${i + 1}` && b.no === i + 1 && b.org === FUTURE[i][0] && b.name === FUTURE[i][1]), JSON.stringify(f.map((b) => [b.code, b.org, b.name])));
  t('M3 PR #66 오타(플라이플라이) 없음', !/플라이플라이/.test(MIGRATION) && !/플라이플라이/.test(CHECK) && f[0].org === '에듀플라이교육협동조합');
  t('M4 비공개 · 구역 비공개 · 유형 칸 비움 · 공개 96곳 그대로', f.every((b) => !b.is_published && !b.preview_listed && b.booth_type === null && b.org_type === '기관') && !(await one(`select is_published from public.zones where key = '미래'`)).is_published && (await count('is_published')) === 96);
  const ids96 = (await rows(`select id from public.booths where zone_key in ('초등','중등','고등','특수','체험')`)).map((b) => b.id);
  t('M5 UUID 는 9곳끼리 · 기존 96곳과 겹치지 않음', new Set(f.map((b) => b.id)).size === 9 && f.every((b) => !ids96.includes(b.id)));
  t('M6 기존 96곳 줄 · QR · PIN · 대기 상태 · 운영 방식 그대로(수정 시각까지)', (await fp()) === base);
  const before = (await rows(`select count(*)::int n from public.booths`))[0].n;
  err = await run(MIGRATION);
  t('M7 다시 실행하면 멈추고 줄이 늘지 않음', /체험존 수 또는 미래채움존 사전 등록 상태|시작 조건 불일치|버전과 다릅니다/.test(err) && (await rows(`select count(*)::int n from public.booths`))[0].n === before, err);
  await q('begin');
  await q(`insert into public.booths (no, zone_key, name, org) values (13, '체험', '시험', ''), (10, '미래', '시험', ''), (99, '초등', '시험', ''), (3, 'D', '시험', '[예시] 학교')`);
  const codes = (await rows(`select zone_key, code from public.booths where name = '시험' order by no`)).map((r) => r.code);
  await q('rollback');
  t('M8 번호 규칙: 학교 · 체험 · 미래 · 그 밖의 구역 모두 지원', JSON.stringify(codes) === JSON.stringify(['D-03', '미래10', '체험13', '99']), JSON.stringify(codes));
  const dup = await run(`insert into public.booths (no, zone_key, name, org) values (1, '미래', '겹침', '겹침')`);
  t('M9 같은 번호는 DB 가 막음(zone_key + no)', /duplicate key|unique/i.test(dup), dup);

  /* ── 공개 전 보안 ───────────────────────────────────────────────── */
  const asAnon = async (sql) => { await q('set role anon'); try { return await c.query(sql).then((r) => r.rows, (e) => ({ error: e.message })); } finally { await q('reset role'); } };
  t('S1 anon: 비공개 미래 부스 · 구역은 보이지 않음', (await asAnon(`select id from public.booths where zone_key = '미래'`)).length === 0 && (await asAnon(`select key from public.zones where key = '미래'`)).length === 0);
  const leak = await asAnon(`select token from public.booth_access limit 1`), leak2 = await asAnon(`select pin_hash from public.booth_pin limit 1`);
  t('S2 anon: QR · PIN 표는 읽지 못함', !Array.isArray(leak) || leak.length === 0, JSON.stringify(leak).slice(0, 80));
  t('S2b anon: PIN 표 읽기 거절 또는 0줄', !Array.isArray(leak2) || leak2.length === 0, JSON.stringify(leak2).slice(0, 80));

  /* ── 공개 막힘 ───────────────────────────────────────────────────── */
  err = await run(PUBLISH);
  t('P1 QR · PIN 이 없으면 공개를 막고 그대로 둠', /QR 0\/9/.test(err) && (await count('is_published')) === 96, err);
  const KEY = Object.fromEntries(f.map((b) => [b.no, key24()]));
  for (const b of f.slice(0, 8)) { await q(`insert into public.booth_access (booth_id, token) values ($1, $2)`, [b.id, KEY[b.no]]); await q(`insert into public.booth_pin (booth_id, pin_hash) values ($1, $2)`, [b.id, `f-${b.no}`]); }
  err = await run(PUBLISH);
  t('P2 한 곳이라도 빠지면 공개를 막음(8/9)', /QR 8\/9/.test(err), err);
  await q(`insert into public.booth_access (booth_id, token) values ($1, $2)`, [f[8].id, KEY[9]]);
  err = await run(PUBLISH);
  t('P3 PIN 만 빠져도 공개를 막음', /PIN 8\/9/.test(err), err);
  await q(`insert into public.booth_pin (booth_id, pin_hash) values ($1, 'f-9')`, [f[8].id]);
  const hiddenKey = await call(`select * from public.booth_ctrl_get($1)`, [KEY[1]]);
  t('P4 공개 전에는 QR 로 운영 화면이 열리지 않음', Array.isArray(hiddenKey) && hiddenKey.length === 0, JSON.stringify(hiddenKey));

  /* ── 공개 ────────────────────────────────────────────────────────── */
  err = await run(PUBLISH);
  t('P5 공개: 전체 105곳 = 학교 84 + 체험 12 + 미래 9', !err && (await count('is_published')) === 105 && (await count(`zone_key = '미래' and is_published`)) === 9 && (await count(`zone_key = '체험' and is_published`)) === 12, err);
  t('P6 공개해도 기존 96곳 그대로', (await fp()) === base);
  t('P7 표시 번호 105개가 겹치지 않음', (await one(`select count(distinct code)::int n from public.booths where is_published`)).n === 105);
  t('S3 anon: 공개 뒤 105곳이 보임', (await asAnon(`select id from public.booths`)).length === 105);

  /* ── 인증 · 상태 저장(실제 함수) ─────────────────────────────────── */
  const SESS = randomBytes(32).toString('base64url');
  await q(`insert into public.booth_session (booth_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')`, [f[3].id, sha(SESS)]);
  let ok = 0;
  for (const b of f) {
    const g = first(await call(`select * from public.booth_ctrl_get($1)`, [KEY[b.no]]));
    const s1 = first(await call(`select * from public.booth_ctrl_set($1, 'open', 20)`, [KEY[b.no]]));
    if (g && g.code === b.code && g.zone_label === '미래채움존' && g.name === b.name && g.org === b.org && s1 && s1.congestion === '보통' && s1.code === b.code) ok += 1;
  }
  t('A1 9곳 모두 QR 인증 · 대기 저장', ok === 9, String(ok));
  const sess = first(await call(`select * from public.booth_session_get($1)`, [SESS]));
  const p1 = first(await call(`select * from public.booth_session_set($1, 'pause', null)`, [SESS]));
  const c1 = first(await call(`select * from public.booth_session_set($1, 'closed', null)`, [SESS]));
  t('A2 세션: 미래4 찾기 · 잠시 중단 · 오늘 마감', sess && sess.code === '미래4' && p1.congestion === '중단' && c1.congestion === '마감', JSON.stringify([sess, p1, c1]));
  const m1 = first(await call(`select * from public.booth_session_mode($1, 'reserve')`, [SESS]));
  const r1 = first(await call(`select * from public.booth_session_set($1, 'resv_open', null)`, [SESS]));
  const r2 = first(await call(`select * from public.booth_session_set($1, 'resv_closed', null)`, [SESS]));
  t('A3 세션: 현장예약 운영 중 · 예약 마감', !m1.error && r1.congestion === '예약중' && r2.congestion === '예약마감', JSON.stringify([m1, r1, r2]));
  const wrong = await call(`select * from public.booth_ctrl_get($1)`, ['B'.repeat(24)]);
  t('A4 모르는 열쇠로는 들어오지 못함', Array.isArray(wrong) && wrong.length === 0);
  t('A5 미래채움존 저장이 기존 96곳을 바꾸지 않음', (await fp()) === base);
  const school = await one(`select a.token from public.booth_access a join public.booths b on b.id = a.booth_id where b.zone_key = '고등' and b.no = 1`);
  const exp = await one(`select a.token from public.booth_access a join public.booths b on b.id = a.booth_id where b.zone_key = '체험' and b.no = 2`);
  await q('begin');
  const sOk = first(await call(`select * from public.booth_ctrl_set($1, 'open', 10)`, [school.token]));
  const eOk = first(await call(`select * from public.booth_ctrl_set($1, 'open', 10)`, [exp.token]));
  await q('rollback');
  t('A6 학교 · 체험 부스 인증과 저장은 그대로 동작(번호 1 · 2 겹침 없음)', sOk && sOk.code === '1' && eOk && eOk.code === '체험2', JSON.stringify([sOk, eOk]));

  /* ── 23:00 초기화 ────────────────────────────────────────────────── */
  await q(`delete from public.booth_live where booth_id in (select id from public.booths where zone_key = '미래');`);
  await q('begin');
  await q(`insert into public.booth_live (booth_id, congestion, wait_minutes, updated_at)
    select b.id, '여유', 0, now() from public.booths b where b.is_published on conflict (booth_id) do nothing;
    insert into public.booth_live (booth_id, congestion, wait_minutes, updated_at) select id, '여유', 0, now() from public.booths where zone_key = 'D' and no = 1;`);
  const n = (await one(`select private.rehearsal_live_reset() as n`)).n;
  const left = await one(`select count(*)::int n, count(*) filter (where b.zone_key = 'D')::int d from public.booth_live l join public.booths b on b.id = l.booth_id`);
  const modes = await one(`select count(*) filter (where b.zone_key = '미래')::int f, count(*) filter (where b.zone_key = '체험')::int e from public.booth_live_mode m join public.booths b on b.id = m.booth_id`);
  await q('rollback');
  t('Z1 23:00 초기화: 학교 84 + 체험 12 + 미래 9 = 105줄 지움 · 예시 구역은 그대로', n === 105 && left.n === 1 && left.d === 1, JSON.stringify([n, left]));
  t('Z2 운영 방식은 유지(체험1 · 미래4 현장예약)', modes.f === 1 && modes.e === 1, JSON.stringify(modes));
  t('Z3 84곳 목록 · 예약 일정 그대로', (await one(`select cardinality(private.rehearsal_booth_ids()) n`)).n === 84 && (await one(`select schedule, active from cron.job where jobname = 'booth-rehearsal-reset'`)).schedule === '0 14 * * *');

  /* ── 점검 SQL ────────────────────────────────────────────────────── */
  const chk = await check();
  t('C1 점검 SQL(공개 뒤): STOP 없음 · 번호 규칙 · 초기화 대상 적용됨', !chk.items.some((r) => r['판정'] === 'STOP') && chk.items.find((r) => r['번호'] === 12)['현재'] === '체험·미래 지원' && chk.items.find((r) => r['번호'] === 13)['현재'] === '84+체험+미래', JSON.stringify(chk.items.filter((r) => r['판정'] === 'STOP')));
  t('C2 점검 SQL: 명단 9곳 모두 OK', chk.list.length === 9 && chk.list.every((r) => r['판정'] === 'OK'), JSON.stringify(chk.list));

  /* ── 숨기기 · 다시 공개 ──────────────────────────────────────────── */
  await q('begin');
  await q(`update public.booths set is_published = false where zone_key = '체험' and no = 1`);
  await q('commit');
  err = await run(ROLLBACK);
  t('B1 부스 수가 예상과 다르면 숨기기를 멈춤', /예상과 달라/.test(err) && (await count(`zone_key = '미래' and is_published`)) === 9, err);
  await q(`update public.booths set is_published = true where zone_key = '체험' and no = 1`);
  const mid = await fp();
  err = await run(ROLLBACK);
  t('B2 숨기기: 공개 96곳 · 미래 9줄 · QR · PIN 남음', !err && (await count('is_published')) === 96 && (await count(`zone_key = '미래'`)) === 9 && (await one(`select count(*)::int n from public.booth_access a join public.booths b on b.id = a.booth_id where b.zone_key = '미래'`)).n === 9 && (await one(`select count(*)::int n from public.booth_pin p join public.booths b on b.id = p.booth_id where b.zone_key = '미래'`)).n === 9, err);
  t('B3 숨겨도 학교 · 체험 96곳 그대로', (await fp()) === mid);
  const hid = await call(`select * from public.booth_ctrl_get($1)`, [KEY[1]]);
  t('B4 숨기면 그 열쇠로 운영 화면이 열리지 않음', Array.isArray(hid) && hid.length === 0, JSON.stringify(hid));
  err = await run(PUBLISH);
  t('B5 다시 공개하면 105곳 · 같은 QR 로 열림', !err && (await count('is_published')) === 105 && first(await call(`select * from public.booth_ctrl_get($1)`, [KEY[1]])).code === '미래1', err);
} finally {
  await c.end().catch(() => {});
  await db.stop().catch(() => {});
  try { rmSync(DATA, { recursive: true, force: true }); } catch { /* 임시 폴더 */ }
}
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} 통과`);
process.exit(bad ? 1 : 0);
