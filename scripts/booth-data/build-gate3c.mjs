/* ===================================================================
   Gate 3-C — 예시 → 실제 전환 · QR 사전 발급 SQL 만들기
   ───────────────────────────────────────────────────────────────────
   승인된 manifest(실제 84곳)와 Production 스냅샷(예시 50곳)에서 대상 UUID 를 꺼내
   SQL 초안을 만듭니다. 실행하지 않습니다(DB 접속 없음).

   쓰는 법
     node scripts/booth-data/build-gate3c.mjs [--snapshot out/prod-snapshot-YYYYMMDD.csv]

   결과(out/gate3c/, git 제외)
     C-01-precheck.sql · C-02-transition.sql · C-03-verify.sql · C-09-transition-rollback.sql
     Q-01-precheck.sql · Q-02-qr-preissue.sql · Q-09-qr-rollback.sql
     targets.json(대상 UUID · 해시) · build-report.md(정적 검사)

   선행 DB 변경: supabase/migration-booth-preview.sql(칸 · 함수). C-02 는 그것이 없으면 멈춥니다.
   =================================================================== */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readCsv } from './lib/csv.mjs';
import { plannedBoothId, UUID_V5_RE } from './lib/uuid.mjs';
import { writeStatements } from './lib/sql.mjs';
import { transitionSqls, qrSqls } from './lib/sql-gate3c.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'out');
const DST = resolve(OUT, 'gate3c');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const snapshotPath = arg('snapshot', resolve(OUT, readdirSync(OUT).filter(f => /^prod-snapshot-\d{8}\.csv$/.test(f)).sort().pop() || 'none'));
const manifestPath = resolve(OUT, 'staging', 'manifest.csv');
for (const f of [snapshotPath, manifestPath]) if (!existsSync(f)) { console.error(`없음: ${f}`); process.exit(2); }

const checks = [];
const check = (ok, what, detail = '') => { checks.push({ ok: !!ok, what, detail: String(detail) }); return ok; };

// 실제 84 — 승인된 manifest 그대로(다시 만들지 않음)
const manifestText = readFileSync(manifestPath, 'utf8').replace(/^﻿/, '');
const sha256 = createHash('sha256').update(manifestText, 'utf8').digest('hex');
const recorded = readFileSync(resolve(OUT, 'staging', 'manifest.sha256'), 'utf8').split(/\s/)[0];
check(sha256 === recorded, 'manifest 해시 = 승인 기록', sha256);
const manifest = readCsv(manifestPath);
const realIds = manifest.map(m => m.booth_id);
check(realIds.length === 84 && new Set(realIds).size === 84, '실제 84곳 · UUID 고유', `${new Set(realIds).size}`);
check(manifest.every(m => UUID_V5_RE.test(m.booth_id) && plannedBoothId(m.doc_key) === m.booth_id), '실제 UUID = 문서키 재계산', '');

// 예시 50 — 스냅샷에서 '[예시]' 인 줄만
const snap = readCsv(snapshotPath);
const examples = snap.filter(s => /^\s*\[예시\]/.test(s.org));
const exampleIds = examples.map(s => s.id);
const exampleZones = [...new Set(examples.map(s => s.zone_key))].sort();
check(exampleIds.length === 50 && new Set(exampleIds).size === 50, '예시 50곳 · UUID 고유', `${exampleIds.length}`);
check(examples.length === snap.length, '스냅샷의 모든 부스가 [예시]', `${examples.length}/${snap.length}`);
check(JSON.stringify(exampleZones) === JSON.stringify(['A', 'B', 'C', 'D', 'E']), '예시 구역 = A~E', exampleZones.join(','));
check(!exampleIds.some(id => realIds.includes(id)), '예시 · 실제 UUID 겹침 없음', '');

rmSync(DST, { recursive: true, force: true });
mkdirSync(DST, { recursive: true });
const meta = { real: realIds.length, examples: exampleIds.length, sha256, generatedAt: arg('stamp', new Date().toISOString()), exampleIds, realIds, exampleZones };
const t = transitionSqls(meta), qr = qrSqls(meta);
const files = {
  'C-01-precheck.sql': t.pre, 'C-02-transition.sql': t.run, 'C-03-verify.sql': t.verify, 'C-09-transition-rollback.sql': t.rollback,
  'Q-01-precheck.sql': qr.pre, 'Q-02-qr-preissue.sql': qr.run, 'Q-09-qr-rollback.sql': qr.rollback
};
for (const [f, s] of Object.entries(files)) writeFileSync(resolve(DST, f), s);
writeFileSync(resolve(DST, 'targets.json'), JSON.stringify({ manifest_sha256: sha256, snapshot: basename(snapshotPath), realIds, exampleIds, exampleZones }, null, 2));

// 정적 검사 — 쓰기 문 · 출력
const w = Object.fromEntries(Object.entries(files).map(([f, s]) => [f, writeStatements(s).map(x => x.replace(/\s+/g, ' '))]));
const updates = s => [...s.replace(/--[^\n]*/g, '').matchAll(/\bupdate\s+(public\.[a-z_]+)\s+set\s+([a-z_]+)/gi)].map(m => `${m[1]}.${m[2]}`);
check(['C-01-precheck.sql', 'C-03-verify.sql', 'Q-01-precheck.sql'].every(f => w[f].length === 0), '확인용 SQL 은 쓰기 문 없음', '');
check(JSON.stringify(updates(t.run).sort()) === JSON.stringify(['public.booths.is_published', 'public.booths.preview_listed', 'public.settings.booth_sample_common_pin_enabled', 'public.zones.is_published'].sort())
  && !/\b(insert\s+into|delete\s+from)\s+public\./i.test(t.run.replace(/--[^\n]*/g, '')), '전환 SQL 쓰기 = booths(공개 · 사전 안내) · zones(공개) · settings(공통 PIN)뿐 · INSERT/DELETE 없음', updates(t.run).join(' · '));
check(JSON.stringify(w['Q-02-qr-preissue.sql']) === JSON.stringify(['insert into public.booth_access']) && updates(qr.run).length === 0, 'QR 사전 발급 쓰기 = booth_access INSERT 하나뿐', w['Q-02-qr-preissue.sql'].join(' · '));
check(JSON.stringify(w['Q-09-qr-rollback.sql']) === JSON.stringify(['delete from public.booth_access']), 'QR 되돌리기 쓰기 = booth_access DELETE 하나뿐', w['Q-09-qr-rollback.sql'].join(' · '));
check(!/on conflict[^;]*do update/i.test(qr.run) && /on conflict on constraint booth_access_pkey do nothing/.test(qr.run), 'QR 사전 발급은 기존 열쇠를 바꾸지 않음(do nothing)', '');
const outputs = Object.values(files).join('\n').replace(/--[^\n]*/g, '');
check(!/select[^;]*\btoken\b\s*(,|from|as)/i.test(outputs.replace(/md5\(a\.token\)|a\.token\)|token ~ '[^']*'|booth_ctrl_get\(a\.token\)/g, '')), 'SQL 결과에 열쇠 값이 나오지 않음', '');
check(!/event_start\s*=|event_end\s*=|booth_pin_enabled\s*=/i.test(outputs), '행사 시각 · PIN 보조 로그인 스위치를 바꾸지 않음', '');

const okN = checks.filter(c => c.ok).length, ready = okN === checks.length;
const L = ['# Gate 3-C SQL 만들기 — 정적 검사', '', `- manifest \`${sha256}\` · 스냅샷 \`${basename(snapshotPath)}\` · ${meta.generatedAt}`, '- 실행하지 않음(DB 접속 없음)', '',
  `## 판정: ${ready ? '통과' : '실패'} (${okN}/${checks.length})`, '', '| 결과 | 검사 | 내용 |', '|---|---|---|'];
for (const c of checks) L.push(`| ${c.ok ? '통과' : '**실패**'} | ${c.what} | ${c.detail.replace(/\|/g, '\\|')} |`);
L.push('', '| 파일 | 쓰기 |', '|---|---|');
for (const [f, s] of Object.entries(files)) L.push(`| \`${f}\` | ${[...w[f], ...updates(s).map(u => 'update ' + u)].join(' · ') || '없음(읽기 전용)'} |`);
writeFileSync(resolve(DST, 'build-report.md'), L.join('\n') + '\n');
console.log(`${ready ? '통과' : '실패'} — 검사 ${okN}/${checks.length} · 실제 ${realIds.length} · 예시 ${exampleIds.length} · 결과 ${DST}`);
for (const c of checks.filter(c => !c.ok)) console.log(`  실패: ${c.what} — ${c.detail}`);
process.exit(ready ? 0 : 1);
