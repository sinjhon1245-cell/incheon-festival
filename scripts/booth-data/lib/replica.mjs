// 로컬 복제 DB(PGlite · PostgreSQL 17 · pgcrypto) — Gate 3-C 시험들이 함께 씁니다.
// Production 과 같은 표 · 제약 · 트리거 · 함수 · 공개 규칙에 예시 50곳(스냅샷) · 실제 84곳(manifest)을 넣습니다.
// 열쇠 · PIN 은 이 DB 에서 만든 가짜 값입니다. Production 에 접속하지 않습니다.
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ADMIN = '00000000-0000-4000-8000-00000000a001';
export const TEST_PIN = '246813';   // 시험용 개별 PIN(가짜)

export async function loadPglite(pgliteDir) {
  const dist = join(resolve(pgliteDir), 'node_modules', '@electric-sql', 'pglite', 'dist');
  const { PGlite } = await import(pathToFileURL(join(dist, 'index.js')).href);
  const { pgcrypto } = await import(pathToFileURL(join(dist, 'contrib', 'pgcrypto.js')).href);
  return { PGlite, pgcrypto };
}

export async function openReplica(lib, { snap, manifest }) {
  const db = new lib.PGlite({ extensions: { pgcrypto: lib.pgcrypto } });
  await db.exec('create schema extensions; create extension pgcrypto with schema extensions;');
  await db.exec(readFileSync(resolve(HERE, 'dryrun/replica-schema.sql'), 'utf8'));
  await db.exec(readFileSync(resolve(HERE, 'dryrun/replica-functions.sql'), 'utf8'));
  await db.exec(`insert into public.settings (id, event_start, event_end, booth_pin_enabled, booth_sample_common_pin_enabled)
                 values (1, '2026-11-06 01:00+00', '2026-11-07 08:00+00', true, true);`);
  await db.query("insert into public.staff_profiles (id, role) values ($1, 'admin')", [ADMIN]);
  const zones = [['A', '열린마당', true], ['B', 'AI 스쿨존', true], ['C', 'AI 체험존', true], ['D', '미래채움존', true], ['E', '빅테크존', true],
    ['F', 'F구역', false], ['G', 'G구역', false], ['H', 'H구역', false], ['I', 'I구역', false], ['J', 'J구역', false]];
  for (const [i, [k, l, p]] of zones.entries()) await db.query('insert into public.zones (key, label, sort_order, is_published) values ($1, $2, $3, $4)', [k, l, i + 1, p]);
  for (const s of snap) {
    await db.query(`insert into public.booths (id, zone_key, no, name, org, org_type, is_published, sort_order) values ($1,$2,$3,$4,$5,$6,true,$3)`,
      [s.id, s.zone_key, +s.no, s.name, s.org, s.org_type]);
    await db.query("insert into public.booth_live (booth_id, congestion, wait_minutes) values ($1, '보통', 15)", [s.id]);
    await db.query("insert into public.booth_live_log (booth_id, congestion, wait_minutes, source) values ($1, '보통', 15, 'admin')", [s.id]);
  }
  for (const m of manifest) await db.query(`insert into public.booths (id, name, org, org_type, program, status, is_published, sort_order) values ($1,$2,$3,$4,$5,'준비 전',false,$6)`,
    [m.booth_id, m.name, m.org, m.org_type, m.program, +m.sort_order]);
  const h = helpers(db);
  // 예시 QR 은 Production 과 같은 관리자 함수로, 개별 PIN 2곳은 같은 해시 방식으로(가짜 PIN)
  await h.asAdmin(async () => { await db.query('select count(*) from public.admin_issue_booth_tokens(null)'); });
  for (const code of ['A-01', 'A-03']) {
    const id = snap.find(s => s.code === code).id;
    await db.query("insert into public.booth_pin (booth_id, pin_hash) values ($1, extensions.crypt(private.booth_pin_digest($2), extensions.gen_salt('bf', 10)))", [id, TEST_PIN]);
  }
  return Object.assign({ db }, h);
}

export function helpers(db) {
  return {
    async asAdmin(fn) { await db.exec(`set test.uid = '${ADMIN}'`); try { return await fn(); } finally { await db.exec("set test.uid = ''"); } },
    // 익명 역할은 한 트랜잭션 안에서만(set local) 씁니다. PGlite 는 트랜잭션 동안 다른 쿼리를 기다리게 하므로,
    // 화면이 동시에 여러 번 읽어도 어떤 읽기가 관리자(postgres) 권한으로 새어 나가지 않습니다.
    async asAnon(sql, params) { return db.transaction(async tx => { await tx.exec('set local role anon'); return (await tx.query(sql, params)).rows; }); },
    async run(sql) {
      const notices = [];
      try { const r = await db.exec(sql, { onNotice: n => notices.push(n.message) }); return { ok: true, notices, last: r[r.length - 1]?.rows?.[0] }; }
      catch (e) { try { await db.exec('rollback'); } catch { /* 열린 트랜잭션 없음 */ } return { ok: false, error: e.message, notices }; }
    }
  };
}
