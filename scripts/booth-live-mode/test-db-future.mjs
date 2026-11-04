/* ===================================================================
   미래채움존 등록 SQL 시험 — 로컬 임시 Postgres 위에서 (Production 에 접속하지 않습니다)
   ───────────────────────────────────────────────────────────────────
   replica-20261103.sql 에 Production 의 칸 · 제약 · 트리거를 더해 부스 84곳 + 예시 부스를 만들고
     시작 조건 → 등록 → 다시 등록 → 공개 막힘 → 공개 → 23:00 초기화 → 공개 거두기 → 등록 없애기 → 다시 등록
   을 실제로 돌립니다. 되돌리기 파일에 적어 둔 옛 함수의 md5 는 Production 값과 견줍니다.

   쓰는 법: node scripts/booth-live-mode/test-db-future.mjs --deps <embedded-postgres · pg 가 설치된 폴더>
   =================================================================== */
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const req = createRequire(join(resolve(arg('deps')), 'package.json'));
const EmbeddedPostgres = req('embedded-postgres').default;
const pg = req('pg');
const DATA = arg('data', mkdtempSync(join(tmpdir(), 'booth-future-pg-')));
const PORT = 55500 + Math.floor(Math.random() * 90);

const file = (f) => readFileSync(resolve(REPO, f), 'utf8').replace(/\r/g, '');
const MIGRATION = file('supabase/migration-booth-future-zone.sql');
const PUBLISH = file('supabase/publish-booth-future-zone.sql');
const ROLLBACK = file('supabase/rollback-booth-future-zone.sql');
const CHECK = file('supabase/check-booth-future-zone.sql');
const REPLICA = file('scripts/booth-live-mode/replica-20261103.sql');

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
    create table public.booth_live_mode (booth_id uuid primary key references public.booths(id) on delete cascade, mode text not null check (mode = any (array['wait','reserve'])), updated_at timestamptz not null default now());
    alter table public.booth_live drop constraint if exists booth_live_congestion_check;
    alter table public.booth_live add constraint booth_live_congestion_check check (congestion = any (array['여유','보통','혼잡','중단','마감','예약중','예약마감']));
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

  const fp = async () => (await one(`select md5(string_agg(b::text || coalesce(a.token,'') || coalesce(p.pin_hash,''), E'\n' order by b.id)) as v, count(*)::int as n
    from public.booths b left join public.booth_access a on a.booth_id = b.id left join public.booth_pin p on p.booth_id = b.id where b.zone_key in ('초등','중등','고등','특수')`));
  const src = async (fn) => (await one(`select prosrc from pg_proc where oid = '${fn}'::regprocedure`)).prosrc;

  t('R1 되돌리기 파일의 옛 번호 규칙 = Production md5', md5((await src('public.booths_before_write()')).replace(/\r/g, '')) === '7cc3adfefbf22bf5993705352903ea1f', md5(await src('public.booths_before_write()')));
  t('R2 되돌리기 파일의 옛 23:00 초기화 = Production md5', md5((await src('private.rehearsal_live_reset()')).replace(/\r/g, '')) === 'ddfca11ab8541f58ac5cc015a13fbb61', md5(await src('private.rehearsal_live_reset()')));
  const before = await fp();
  t('준비 학교 84곳', before.n === 84, String(before.n));

  /* ── 시작 조건 ───────────────────────────────────────────────────── */
  await q(`insert into public.booths (no, zone_key, name, org) values (2, 'D', 'AI 상상 공작소', '[예시] 겹침')`);
  let err = await run(MIGRATION);
  t('M1 같은 이름의 부스가 있으면 멈추고 아무것도 바꾸지 않음', /같은 이름/.test(err) && (await one(`select count(*)::int n from public.zones where key = '미래'`)).n === 0, err);
  await q(`delete from public.booths where name = 'AI 상상 공작소'`);

  /* ── 등록 ────────────────────────────────────────────────────────── */
  err = await run(MIGRATION);
  t('M2 등록 적용', !err, err);
  const f = await rows(`select id, no, code, name, org, org_type, is_published, status, preview_listed from public.booths where zone_key = '미래' order by no`);
  const NAMES = [['AI 로봇 플레이존', '에듀플라이플라이교육협동조합'], ['채울샘 SW체험존', '채울샘 협동조합'], ['상상ON! 자율주행 드라이빙 스쿨', '허니소프트협동조합'],
    ['재미를 잇다, 상상을 잇다! (잇다풋볼 & 잇다오락실)', '잇다에듀 협동조합'], ['touch. play. ai', '코딩랩스 협동조합'], ['AI 상상 공작소', '누구나코딩교육협동조합'],
    ['인천 바다 아케이드 대 탐험', '미래채움교육협동조합'], ['아이온과 함께 하는 로봇 배틀 아레나', '그린플래그 교육협동조합'], ['AIㆍSW와 만나는 미래 융합 탐험대', '비트상상협동조합']];
  t('M3 9곳 · 번호 미래1 ~ 미래9 · 이름 · 기관 공식 명단 그대로', f.length === 9 && f.every((b, i) => b.code === `미래${i + 1}` && b.no === i + 1 && b.name === NAMES[i][0] && b.org === NAMES[i][1]), JSON.stringify(f.map((b) => [b.code, b.name, b.org])));
  t('M4 비공개 · 학교급 없음(org_type 기관) · 구역 비공개', f.every((b) => !b.is_published && !b.preview_listed && b.org_type === '기관') && !(await one(`select is_published from public.zones where key = '미래'`)).is_published);
  t('M5 고유 ID 는 UUID 로 겹치지 않고 학교 84곳과도 다름', new Set(f.map((b) => b.id)).size === 9 && f.every((b) => !ids.includes(b.id)));
  t('M6 학교 84곳 줄 · QR · PIN 그대로(수정 시각까지)', (await fp()).v === before.v);
  const again = await run(MIGRATION);
  t('M7 다시 실행해도 그대로(9곳 · 84곳)', !again && (await one(`select count(*)::int n from public.booths where zone_key = '미래'`)).n === 9 && (await fp()).v === before.v, again);
  await q(`insert into public.booths (no, zone_key, name, org) values (3, 'D', '다른 구역', '[예시] 학교')`);
  await q(`update public.booths set name = name where no = 5 and zone_key = '고등'`);
  t('M8 다른 구역 번호 규칙 그대로(D-03 · 학교 번호 그대로)', (await one(`select code from public.booths where zone_key = 'D' and no = 3`)).code === 'D-03' && (await one(`select code from public.booths where zone_key = '고등' and no = 5`)).code === '5');
  const dup = await run(`insert into public.booths (no, zone_key, name, org) values (1, '미래', '겹침', '겹침')`);
  t('M9 같은 번호는 DB 가 막음(zone_key + no)', /duplicate key|booths_zone_key_no_key|unique/i.test(dup), dup);
  const dupSchool = await one(`select count(*)::int n from public.booths where no = 1`);
  t('M10 고등 1번과 미래 1번은 함께 있을 수 있고 UUID 로 구분', dupSchool.n >= 2);

  /* ── 공개 ────────────────────────────────────────────────────────── */
  err = await run(PUBLISH);
  t('P1 QR · PIN 이 없으면 공개를 막고 그대로 둠', /QR 0 \/ 9곳/.test(err) && !(await one(`select is_published from public.zones where key = '미래'`)).is_published, err);
  for (const b of f.slice(0, 8)) { await c.query(`insert into public.booth_access (booth_id, token) values ($1, $2)`, [b.id, `tok-${b.no}f`]); await c.query(`insert into public.booth_pin (booth_id, pin_hash) values ($1, $2)`, [b.id, `h-${b.no}f`]); }
  err = await run(PUBLISH);
  t('P2 한 곳이라도 빠지면 공개를 막음(8 / 9)', /QR 8 \/ 9곳/.test(err), err);
  await c.query(`insert into public.booth_access (booth_id, token) values ($1, 'tok-9f')`, [f[8].id]);
  await c.query(`insert into public.booth_pin (booth_id, pin_hash) values ($1, 'h-9f')`, [f[8].id]);
  err = await run(PUBLISH);
  const pub = await one(`select count(*)::int n, count(*) filter (where zone_key = '미래')::int f from public.booths b where b.is_published and b.org !~ '^\\s*\\[예시\\]'`);
  t('P3 공개: 전체 93곳 = 학교 84 + 미래채움 9', !err && pub.n === 93 && pub.f === 9, err || JSON.stringify(pub));
  t('P4 공개해도 학교 84곳 그대로', (await fp()).v === before.v);

  /* ── 23:00 초기화 ────────────────────────────────────────────────── */
  await q(`insert into public.booth_live_mode (booth_id, mode) values ('${f[0].id}', 'reserve');
    insert into public.booth_live (booth_id, congestion, wait_minutes, updated_at) values ('${f[0].id}', '예약중', 0, now()), ('${f[1].id}', '보통', 15, now());
    insert into public.booth_live (booth_id, congestion, wait_minutes, updated_at) select id, '여유', 0, now() from public.booths where zone_key = 'D' and no = 1;`);
  const n = (await one(`select private.rehearsal_live_reset() as n`)).n;
  const left = await one(`select count(*)::int n, count(*) filter (where b.zone_key = '미래')::int f, count(*) filter (where b.zone_key = 'D')::int d from public.booth_live l join public.booths b on b.id = l.booth_id`);
  t('Z1 23:00 초기화: 학교 84 + 미래채움 2 = 86줄 지움 · 예시 구역은 그대로', n === 86 && left.f === 0 && left.d === 1 && left.n === 1, JSON.stringify([n, left]));
  t('Z2 운영 방식은 유지(미래1 현장예약)', (await one(`select mode from public.booth_live_mode where booth_id = '${f[0].id}'`)).mode === 'reserve');
  t('Z3 84곳 목록은 그대로(리허설 · 공통 PIN 대상 안 바뀜)', (await one(`select cardinality(private.rehearsal_booth_ids()) n`)).n === 84);

  /* ── 점검 SQL ────────────────────────────────────────────────────── */
  const chk = (await c.query(CHECK)).rows;
  t('C1 점검 SQL: STOP 없음 · 번호 규칙 · 초기화 대상 적용됨', !chk.some((r) => r['판정'] === 'STOP') && chk.find((r) => r['순서'] === 6)['지금'] === '적용됨' && chk.find((r) => r['순서'] === 7)['지금'] === '미래채움존 포함', JSON.stringify(chk.filter((r) => r['판정'] === 'STOP')));

  /* ── 되돌리기 ────────────────────────────────────────────────────── */
  err = await run(REMOVE);
  t('B1 공개 중에는 등록 없애기를 막음', /공개 중인/.test(err), err);
  err = await run(HIDE);
  const hid = await one(`select count(*) filter (where is_published)::int p, count(*)::int n from public.booths where zone_key = '미래'`);
  t('B2 공개 거두기: 9곳 비공개 · 줄은 남음 · 전체 84곳 · QR · PIN 그대로', !err && hid.p === 0 && hid.n === 9 && (await one(`select count(*)::int n from public.booth_access a join public.booths b on b.id = a.booth_id where b.zone_key = '미래'`)).n === 9 && (await fp()).v === before.v, err);
  await q(`insert into public.booth_live_log (booth_id, congestion, wait_minutes, source) select id, '여유', 5, 'admin' from public.booths where zone_key = '미래' limit 1`).catch(() => {});
  const hasLog = (await one(`select count(*)::int n from public.booth_live_log g join public.booths b on b.id = g.booth_id where b.zone_key = '미래'`)).n > 0;
  if (hasLog) {
    err = await run(REMOVE);
    t('B3 입력 기록이 있으면 등록 없애기를 막음', /입력 기록/.test(err), err);
    await q(`delete from public.booth_live_log where booth_id in (select id from public.booths where zone_key = '미래')`);
  }
  err = await run(REMOVE);
  t('B4 등록 없애기: 9곳 · 구역 없음 · QR · PIN 도 사라짐', !err && (await one(`select count(*)::int n from public.booths where zone_key = '미래'`)).n === 0 && (await one(`select count(*)::int n from public.zones where key = '미래'`)).n === 0 && (await one(`select count(*)::int n from public.booth_access`)).n === 84 + 0, err);
  t('B5 함수가 Production 정의로 돌아옴(md5)', md5((await src('public.booths_before_write()')).replace(/\r/g, '')) === '7cc3adfefbf22bf5993705352903ea1f' && md5((await src('private.rehearsal_live_reset()')).replace(/\r/g, '')) === 'ddfca11ab8541f58ac5cc015a13fbb61');
  t('B6 학교 84곳 그대로', (await fp()).v === before.v);
  err = await run(MIGRATION);
  t('B7 되돌린 뒤 다시 등록할 수 있음', !err && (await one(`select count(*)::int n from public.booths where zone_key = '미래'`)).n === 9, err);
} finally {
  await c.end().catch(() => {});
  await db.stop().catch(() => {});
  try { rmSync(DATA, { recursive: true, force: true }); } catch { /* 임시 폴더 */ }
}
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} 통과`);
process.exit(bad ? 1 : 0);
