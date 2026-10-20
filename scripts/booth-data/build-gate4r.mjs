/* ===================================================================
   Gate 4-R SQL 만들기 — 리허설용 임시 배치(R1~R4) · 공개
   ───────────────────────────────────────────────────────────────────
   manifest(S01~S84) → 배치안(R1: S01~S21 · R2: S22~S42 · R3: S43~S63 · R4: S64~S84 · 번호 01~21)
   → out/gate4r/ 에 T-01 · T-02 · T-03 · T-04 · T-09a · T-09b 와 배치안 표(plan-R.csv)를 씁니다.
   DB 에 접속하지 않습니다. 열쇠 · PIN 은 다루지 않습니다.

   쓰는 법: node scripts/booth-data/build-gate4r.mjs [--label '실제 위치 아닌 리허설용 임시구역'] [--stamp <ISO>]
   =================================================================== */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsv } from './lib/csv.mjs';
import { rehearsalPlan, planCsv, sha256, manifestSha, DEFAULT_LABEL } from './lib/plan-gate4r.mjs';
import { assignSqls } from './lib/sql-gate4r.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'out');
const DST = resolve(OUT, 'gate4r');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
mkdirSync(DST, { recursive: true });

const checks = [];
const check = (ok, what, note = '') => { checks.push({ ok: !!ok, what, note }); if (!ok) console.error('실패:', what, note); };

const manifestPath = resolve(OUT, 'staging', 'manifest.csv');
const manifest = readCsv(manifestPath);
const msha = manifestSha(manifestPath);
check(msha === readFileSync(resolve(OUT, 'staging', 'manifest.sha256'), 'utf8').split(/\s/)[0], 'manifest 해시 = 승인 기록', msha);
const targets = JSON.parse(readFileSync(resolve(OUT, 'gate3c', 'targets.json'), 'utf8'));
const realIds = manifest.slice().sort((a, b) => a.doc_key.localeCompare(b.doc_key)).map(r => r.booth_id);
check(JSON.stringify(realIds.slice().sort()) === JSON.stringify(targets.realIds.slice().sort()), '실제 84 = Gate 3-C 대상 목록');
check(targets.exampleIds.length === 50 && JSON.stringify(targets.exampleZones) === JSON.stringify(['A', 'B', 'C', 'D', 'E']), '예시 50 · 예시 구역 A~E');

const label = arg('label', DEFAULT_LABEL);
const { zones, plan } = rehearsalPlan(manifest, { label });
const csv = planCsv(plan);
writeFileSync(resolve(DST, 'plan-R.csv'), '﻿' + csv);

// 배치안 정적 검사
const byZone = k => plan.filter(p => p.zone === k);
check(zones.map(z => z.key).join() === 'R1,R2,R3,R4', '구역 R1~R4');
check(zones.every(z => byZone(z.key).length === 21), '구역마다 21곳');
check(['S01~S21', 'S22~S42', 'S43~S63', 'S64~S84'].every((r, i) => { const g = byZone(`R${i + 1}`); return `${g[0].doc}~${g[20].doc}` === r; }), 'R1 S01~S21 · R2 S22~S42 · R3 S43~S63 · R4 S64~S84');
check(zones.every(z => byZone(z.key).map(p => p.no).join() === Array.from({ length: 21 }, (_, i) => i + 1).join()), '구역마다 번호 1~21(빈 번호 · 겹침 없음)');
check(new Set(plan.map(p => p.code)).size === 84 && plan[0].code === 'R1-01' && plan[83].code === 'R4-21', '표시 코드 84개 모두 다름(R1-01 … R4-21)');
check(new Set(plan.map(p => p.id)).size === 84 && plan.every(p => realIds.includes(p.id)), '부스 UUID 84개 = 실제 84 · 겹침 없음');
check(!zones.some(z => targets.exampleZones.includes(z.key)) && !zones.some(z => ['F', 'G', 'H', 'I', 'J'].includes(z.key)), 'A~J(기존 구역)와 코드 겹침 없음');
check(zones.every(z => /^[A-Z][A-Z0-9]{0,2}$/.test(z.key)), '구역 코드 형식(영문 대문자로 시작 · 1~3자)');

const meta = { realIds, exampleIds: targets.exampleIds, exampleZones: targets.exampleZones, sha256: msha,
  planName: 'plan-R.csv', planSha: sha256('﻿' + csv), generatedAt: arg('stamp', new Date().toISOString()) };
const s = assignSqls(meta, plan, zones);
const files = { 'T-01-precheck.sql': s.pre, 'T-02-assign.sql': s.run, 'T-03-publish.sql': s.publish, 'T-04-verify.sql': s.verify,
  'T-09a-unassign.sql': s.unassign, 'T-09b-unpublish.sql': s.unpublish };
for (const [f, body] of Object.entries(files)) writeFileSync(resolve(DST, f), body);

// SQL 정적 검사 — 지우기 · 열쇠/PIN 쓰기 · 예시 쓰기 없음
const writes = Object.entries(files).filter(([f]) => !/precheck|verify/.test(f));
check(Object.values(files).every(b => !/\bdelete\s+from\b|\bdrop\s|\btruncate\b/i.test(b)), 'DELETE · DROP · TRUNCATE 없음');
check(Object.values(files).every(b => !/(insert\s+into|update)\s+public\.(booth_access|booth_pin|booth_live|booth_session|settings)\b/i.test(b)), 'QR · PIN · 대기 값 · 세션 · 설정 쓰기 없음');
check(writes.every(([, b]) => /begin isolation level repeatable read;[\s\S]*set local lock_timeout = '5s';[\s\S]*commit;/.test(b)), '쓰기 파일마다 한 트랜잭션 · lock_timeout 5s');
check(Object.values(files).every(b => !/admin_(issue|rotate|disable)_booth_token|admin_issue_booth_pin|booth_sample_common_pin/.test(b)), 'QR 발급 · 교체 · 끄기 · PIN · 공통 PIN 호출 없음');

const L = ['# Gate 4-R SQL 만들기 — 정적 검사', '',
  `- manifest \`${msha}\` · 배치안 plan-R.csv \`${meta.planSha}\` · ${meta.generatedAt}`,
  `- 구역 이름: ${zones.map(z => `'${z.label}'`).join(' · ')} (관람객 탭에는 'R1 임시구역' 처럼 보임)`, '- 실행하지 않음(DB 접속 없음)', '',
  '| 결과 | 확인 |', '|---|---|', ...checks.map(c => `| ${c.ok ? '통과' : '**실패**'} | ${c.what}${c.note ? ' · ' + c.note : ''} |`), '',
  '| 파일 | sha256 |', '|---|---|', ...Object.entries(files).map(([f, b]) => `| ${f} | \`${sha256(b)}\` |`), `| plan-R.csv | \`${sha256('﻿' + csv)}\` |`];
writeFileSync(resolve(DST, 'build-report.md'), L.join('\n') + '\n');
const ok = checks.every(c => c.ok);
console.log(`${ok ? '통과' : '실패'} ${checks.filter(c => c.ok).length}/${checks.length} · 파일 ${Object.keys(files).length + 1}개 → out/gate4r/`);
process.exit(ok ? 0 : 1);
