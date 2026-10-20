/* ===================================================================
   Q-02 먼저 순서 시험 — migration → Q-02(C-02 전) → 예시 공통 PIN 리허설 → C-02 → C-03 → 배치 · 공개 후 같은 QR
   ───────────────────────────────────────────────────────────────────
   2026-10-16 운영 방침(방안 A): 실제 84곳은 고유 QR, 공통 PIN 은 예시 리허설까지만, 실행 순서 Q-02 → C-01 → C-02 → C-03.
   로컬 PG17 복제 DB(lib/replica.mjs) · out/gate3c 의 SQL 을 고치지 않고 돌립니다. 공통 PIN 은 복제본의 흉내 값(000000)이고 실제 값과 무관합니다.
   ⚠️ 네트워크 · Production 접속 없음. 열쇠는 가짜 값이고 출력하지 않습니다.
   쓰는 법: node scripts/booth-data/test-q02-first.mjs <scripts/booth-data 폴더> <PGlite 0.4.4 가 든 폴더의 상위(scratchpad)>
   =================================================================== */
import { readFileSync, readdirSync } from 'node:fs'; import { resolve } from 'node:path'; import { pathToFileURL } from 'node:url';
const [here, sp] = process.argv.slice(2);
const imp = p => import(pathToFileURL(resolve(here, p)).href);
const { loadPglite, openReplica } = await imp('lib/replica.mjs');
const { readCsv } = await imp('lib/csv.mjs');
const OUT = resolve(here, 'out'), G3 = resolve(OUT, 'gate3c');
const manifest = readCsv(resolve(OUT, 'staging', 'manifest.csv'));
const snap = readCsv(resolve(OUT, readdirSync(OUT).filter(f => /^prod-snapshot-\d{8}\.csv$/.test(f)).sort().pop()));
const R = await openReplica(await loadPglite(sp + '/pglite-0.4.4'), { snap, manifest }); const db = R.db;
const SQL = f => readFileSync(resolve(G3, f), 'utf8');
const res = []; const t = (n, ok, note = '') => { res.push(ok); console.log(`${ok ? '통과' : '실패'}  ${n}${note ? '  — ' + note : ''}`); };
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const real = manifest.map(m => m.booth_id), s13 = manifest.find(m => m.doc_key === 'S13').booth_id;
const exA01 = snap.find(s => s.code === 'A-01').id;
const ctrlOpen = async id => { const tk = (await one('select token from public.booth_access where booth_id = $1', [id]) || {}).token; if (!tk) return 0; return (await R.asAnon('select * from public.booth_ctrl_get($1)', [tk])).length; };
// 복제본의 공통 PIN 흉내 값은 '000000'(lib/replica.mjs 설명). 실제 값과 무관합니다.
const pin = async (id, p) => (await R.asAnon("select ok, reason from public.booth_pin_login($1, $2, 'order-check')", [id, p]))[0];
const accFp = async () => (await one("select md5(string_agg(booth_id::text || token, ',' order by booth_id)) f from public.booth_access")).f;

let r = await R.run(readFileSync(resolve(here, '../../supabase/migration-booth-preview.sql'), 'utf8')); t('migration', r.ok, r.error || '');
r = await R.run(SQL('Q-02-qr-preissue.sql')); t('Q-02 를 C-02 전에 실행 → 성공', r.ok, r.error || '');
t('실제 84 열쇠 · 운영자 화면 열림 0(미배정 · 비공개)', (await one('select count(*)::int n from public.booth_access where booth_id = any($1::uuid[])', [real])).n === 84 && (await ctrlOpen(s13)) === 0);
t('예시 운영은 그대로: 예시 QR 열림 · 예시 공통 PIN 로그인 성공', (await ctrlOpen(exA01)) === 1 && (await pin(exA01, '000000')).ok === true);
const pr = await pin(s13, '000000');
t('예시 공통 PIN 으로 실제 부스 로그인 → 거절(대상 아님)', pr.ok === false, pr.reason);
const fpQ = await accFp();
r = await R.run(SQL('C-02-transition.sql')); t('그 뒤 C-02 → 성공(Q-02 와 순서 무관)', r.ok, r.error || '');
t('C-02 는 열쇠를 바꾸지 않음(84 + 예시 50 지문 그대로)', (await accFp()) === fpQ);
t('C-02 뒤: 예시 QR · 예시 공통 PIN 모두 막힘', (await ctrlOpen(exA01)) === 0 && (await pin(exA01, '000000')).ok === false);
r = await R.run(SQL('C-03-verify.sql')); t('C-03 실행', r.ok, r.error || '');
const c3 = r.last || {};
t('C-03: 공개 0 · 사전 안내 84 · 실제 QR 84(사전 발급분) · 공통 PIN 꺼짐', c3['공개_부스'] == 0 && c3['사전_안내'] == 84 && c3['실제_qr'] == 84 && c3['예시_공통pin'] === false, JSON.stringify({ 공개: c3['공개_부스'], 사전안내: c3['사전_안내'], 실제qr: c3['실제_qr'], 공통pin: c3['예시_공통pin'] }));
await db.exec("insert into public.zones (key, label, sort_order, is_published) values ('SW', '스쿨존', 20, true);");
await db.query("update public.booths set zone_key = 'SW', no = 1, is_published = true where id = $1", [s13]);
t('배치 · 공개 뒤: 공통 PIN 이 꺼져 있어도 사전 발급 QR 그대로 열림', (await ctrlOpen(s13)) === 1 && (await accFp()) === fpQ);
t('배치 · 공개 뒤에도 공통 PIN(꺼짐)으로 실제 부스 로그인 → 거절', (await pin(s13, '000000')).ok === false);
console.log(res.every(Boolean) ? `순서 확인 통과 — ${res.length}/${res.length}` : `순서 확인 실패 — ${res.filter(Boolean).length}/${res.length}`);
await db.close();
