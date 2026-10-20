/* ===================================================================
   STAGING READY — 실제 부스 비공개 등록 준비
   ───────────────────────────────────────────────────────────────────
   extract-plan.mjs 결과(out/official-booths.csv)에서 이번 등록 대상만 골라
   검사하고, 승인용 manifest 와 SQL 초안을 만듭니다.

   ⚠️ 데이터베이스에 접속하지 않습니다. SQL 은 만들기만 하고 실행하지 않습니다.
      실행은 승인 뒤 관리자가 Supabase SQL Editor 에서 합니다(TRANSITION-PLAN.md).

   쓰는 법
     node scripts/booth-data/build-registration.mjs [--scope "AI 스쿨존"] [--validator <validate-collection.ps1>]
                                                    [--snapshot out/prod-snapshot-YYYYMMDD.csv]

   결과(out/staging/, git 제외)
     manifest.csv · manifest.sha256 · approved-ids.txt   승인 대상(이 목록 밖은 등록 · 되돌리기 모두 안 됨)
     booth-registration-staging.xlsx                      수합 양식 v1.0(대상만) — 기존 검증기 입력
     validate/                                            기존 검증기 결과
     01-precheck.sql · 02-register.sql · 03-verify.sql · 09-rollback.sql · 20-golive-db-check.sql
     staging-report.md                                    STAGING READY 판정

   STAGING READY 기준
     부스 수 · 문서키 · 학교명 · 부스명 정확 / UUID 고유 · 재계산 일치 · 예시와 겹치지 않음 /
     구역 · 번호 미배정 허용 / 모두 비공개 / QR · PIN 쓰기 없음 / 중복 등록 방지 /
     기존 검증기: 부스번호 · 구역코드 필수 오류 말고는 ERROR 0
   =================================================================== */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readCsv, toCsv, writeCsv } from './lib/csv.mjs';
import { writeXlsx } from './lib/xlsx.mjs';
import { workbookV1, boothRowV1 } from './lib/form-v1.mjs';
import { plannedBoothId, UUID_V5_RE } from './lib/uuid.mjs';
import { precheckSql, registerSql, verifySql, rollbackSql, goLiveDbCheckSql, writeStatements } from './lib/sql.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'out');
const STG = resolve(OUT, 'staging');
const REPO = resolve(HERE, '..', '..');

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const SCOPE = arg('scope', 'AI 스쿨존').split(',').map(s => s.trim());
const validatorPath = arg('validator', [resolve(REPO, 'scripts/import/validate-collection.ps1'), resolve(REPO, '../incheon-festival/scripts/import/validate-collection.ps1')].find(existsSync));
const snapshotPath = arg('snapshot', (() => { try { const f = readdirSync(OUT).filter(f => /^prod-snapshot-\d{8}\.csv$/.test(f)).sort().pop(); return f && resolve(OUT, f); } catch { return null; } })());

for (const f of ['official-booths.csv', 'school-zone-schools.csv', 'extract-report.md', 'linebreak-evidence.csv'])
  if (!existsSync(resolve(OUT, f))) { console.error(`out/${f} 가 없습니다. extract-plan.mjs 를 먼저 돌리세요.`); process.exit(2); }
rmSync(STG, { recursive: true, force: true });
mkdirSync(STG, { recursive: true });

const checks = [];
const check = (ok, what, detail = '') => { checks.push({ ok: !!ok, what, detail: String(detail) }); return ok; };

const official = readCsv(resolve(OUT, 'official-booths.csv'));
const schools = readCsv(resolve(OUT, 'school-zone-schools.csv'));
const evidence = readCsv(resolve(OUT, 'linebreak-evidence.csv'));
const extractReport = readFileSync(resolve(OUT, 'extract-report.md'), 'utf8');

// ── 1. 대상 고르기 ─────────────────────────────────────────────────────
const inScope = official.filter(o => SCOPE.includes(o['공식 분류']));
const held = official.filter(o => !SCOPE.includes(o['공식 분류']));
const EXPECT = { 'AI 스쿨존': 84, '미래채움존': 9, '빅테크존': 2, '홍보존': 2 };
const expected = SCOPE.reduce((n, s) => n + (EXPECT[s] ?? NaN), 0);

check(/## 판정: 통과/.test(extractReport), '공식 명단 추출 · 교차검증 통과(extract-report.md)', (extractReport.match(/## 판정: .+/) || [''])[0]);
check(official.length === 97, '공식 명단 97개', `${official.length}개`);
check(inScope.length === expected, `등록 대상 ${expected}개(${SCOPE.join(' · ')})`, `${inScope.length}개 · 보류 ${held.length}개(${[...new Set(held.map(h => h['공식 분류']))].join(' · ')})`);
const keys = inScope.map(o => o['문서키']);
if (SCOPE.length === 1 && SCOPE[0] === 'AI 스쿨존')
  check(keys.every((k, i) => k === `S${String(i + 1).padStart(2, '0')}`), '문서키 S01~S84 빠짐 · 중복 없음', keys.length ? `${keys[0]}~${keys[keys.length - 1]}` : '');
check(new Set(keys).size === keys.length, '문서키 중복 없음', '');

// ── 2. 학교명 · 부스명 · 프로그램 ──────────────────────────────────────
const schoolsByKey = {};
schools.forEach(s => (schoolsByKey[s['문서키']] = schoolsByKey[s['문서키']] || []).push(s['학교명']));
const school = inScope.filter(o => o['공식 분류'] === 'AI 스쿨존');
const orgMismatch = school.filter(o => (schoolsByKey[o['문서키']] || []).join(', ') !== o['운영기관']).map(o => o['문서키']);
check(orgMismatch.length === 0, '운영기관 = 참여학교 명단(공동 부스는 ", ")', orgMismatch.join(', ') || `${school.length}부스 · ${school.reduce((n, o) => n + (schoolsByKey[o['문서키']] || []).length, 0)}교`);
if (school.length === 84) check(school.reduce((n, o) => n + (schoolsByKey[o['문서키']] || []).length, 0) === 85, '참여학교 85교', '');
const topicMismatch = school.filter(o => o['부스명'] !== (schools.find(s => s['문서키'] === o['문서키']) || {})['부스 주제']).map(o => o['문서키']);
check(topicMismatch.length === 0, '부스명 = 문서의 부스 주제', topicMismatch.join(', ') || '정상');
check(inScope.every(o => o['부스명'].trim() && o['운영기관'].trim()), '부스명 · 운영기관 빈칸 없음', inScope.filter(o => !o['부스명'].trim() || !o['운영기관'].trim()).map(o => o['문서키']).join(', ') || '정상');
check(inScope.every(o => ['초등', '중등', '고등', '기관', '기업', '기타'].includes(o['기관유형'])), '기관유형이 DB 허용값', inScope.filter(o => !['초등', '중등', '고등', '기관', '기업', '기타'].includes(o['기관유형'])).map(o => o['문서키']).join(', ') || '정상');
// 검증기와 같은 규칙: 자리표시 · 예시 표시 · 공개 칸 개인정보
const RX_PLACEHOLDER = /\[TEST\]|예시|○○|△△|□□|^예\s*[:：]/;
const RX_MOBILE = /(?<!\d)01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/;
const RX_EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const pub = o => [o['부스명'], o['운영기관'], o['체험·전시 내용']].join(' ');
check(inScope.every(o => !RX_PLACEHOLDER.test(pub(o)) && !/^\s*\[예시\]/.test(o['운영기관'])), '자리표시 · [예시] 표시 없음', '');
check(inScope.every(o => !RX_MOBILE.test(pub(o)) && !RX_EMAIL.test(pub(o))), '공개 칸에 휴대전화 · 이메일 없음', '');
check(school.every(o => o['체험·전시 내용'] === ''), '스쿨존 체험·전시 내용은 빈칸(문서에 상세 없음 — 부스명이 문서의 주제)', '');
const evIn = evidence.filter(e => keys.includes(e['문서키']));
check(evIn.every(e => e['윗줄 끝 공백'] === 'Y' || e['윗줄 끝 공백'] === 'N'), `줄바꿈 결합 ${evIn.length}곳 원문 좌표 근거 있음`,
  `공백 ${evIn.filter(e => e['윗줄 끝 공백'] === 'Y').length} · 붙임 ${evIn.filter(e => e['윗줄 끝 공백'] === 'N').map(e => `${e['문서키']}(${e['칸']})`).join(', ')}`);

// ── 3. UUID · 구역 · 번호 · 공개 · 중복 ────────────────────────────────
const ids = inScope.map(o => o['계획 UUID']);
check(ids.every(id => UUID_V5_RE.test(id)), 'UUID 형식(v5)', '');
check(new Set(ids).size === ids.length, 'UUID 중복 없음', `${new Set(ids).size}/${ids.length}`);
const recomputed = inScope.filter(o => plannedBoothId(o['문서키']) !== o['계획 UUID']).map(o => o['문서키']);
check(recomputed.length === 0, 'UUID = 문서키에서 다시 계산한 값(손으로 고친 값 없음)', recomputed.join(', ') || '정상');
const allIds = official.map(o => o['계획 UUID']);
check(new Set(allIds).size === allIds.length, '공식 명단 97개 UUID 전체 중복 없음(보류분 포함)', '');
if (snapshotPath && existsSync(snapshotPath)) {
  const snapIds = new Set(readCsv(snapshotPath).map(s => s.id));
  const clash = ids.filter(id => snapIds.has(id));
  check(clash.length === 0, `기존 Production 부스 UUID 와 겹치지 않음(${basename(snapshotPath)} ${snapIds.size}개)`, clash.join(', ') || '정상');
} else check(false, '기존 Production 부스 UUID 와 겹치지 않음', '스냅샷 없음 — --snapshot 으로 넘기세요');
check(inScope.every(o => !o['현장 구역코드'] && !o['현장 부스번호']), '구역 · 번호 미배정(등록 SQL 은 NULL 로 넣음)', '');
check(inScope.every(o => o['공개'] === 'N'), '모두 비공개(등록 SQL 은 is_published = false)', '');
const dupBiz = inScope.map(o => `${o['운영기관']}|${o['부스명']}`).filter((k, i, a) => a.indexOf(k) !== i);
check(dupBiz.length === 0, '운영기관 · 부스명 중복 없음', dupBiz.join(' / ') || '정상');

// ── 4. manifest · SQL ───────────────────────────────────────────────────
const manifestRows = inScope.map(o => ({
  booth_id: o['계획 UUID'], doc_key: o['문서키'], category: o['공식 분류'], name: o['부스명'], org: o['운영기관'],
  org_type: o['기관유형'], program: o['체험·전시 내용'], sort_order: 1000 + Number(o['문서 연번'])
}));
const MANIFEST_HEAD = ['booth_id', 'doc_key', 'category', 'name', 'org', 'org_type', 'program', 'sort_order', 'zone_key', 'no', 'is_published'];
const manifestText = toCsv(MANIFEST_HEAD, manifestRows.map(r => [r.booth_id, r.doc_key, r.category, r.name, r.org, r.org_type, r.program, r.sort_order, '', '', 'false']));
const sha256 = createHash('sha256').update(manifestText, 'utf8').digest('hex');
writeFileSync(resolve(STG, 'manifest.csv'), '﻿' + manifestText);
writeFileSync(resolve(STG, 'manifest.sha256'), `${sha256}  manifest.csv\n`);
writeFileSync(resolve(STG, 'approved-ids.txt'), manifestRows.map(r => `${r.booth_id}  ${r.doc_key}`).join('\n') + '\n');

const meta = { count: manifestRows.length, scope: SCOPE.join(' · '), sha256, generatedAt: new Date().toISOString() };
const sqls = {
  '01-precheck.sql': precheckSql(manifestRows, meta),
  '02-register.sql': registerSql(manifestRows, meta),
  '03-verify.sql': verifySql(manifestRows, meta),
  '09-rollback.sql': rollbackSql(manifestRows, meta),
  '20-golive-db-check.sql': goLiveDbCheckSql(manifestRows, meta)
};
for (const [f, s] of Object.entries(sqls)) writeFileSync(resolve(STG, f), s);

// 정적 검사 — 쓰기 문은 정해진 것만
const w = Object.fromEntries(Object.entries(sqls).map(([f, s]) => [f, writeStatements(s)]));
check(['01-precheck.sql', '03-verify.sql', '20-golive-db-check.sql'].every(f => w[f].length === 0), '확인용 SQL 세 개는 쓰기 문 없음', '');
check(JSON.stringify(w['02-register.sql'].filter(x => !/ _reg$/.test(x))) === JSON.stringify(['insert into public.booths']), '등록 SQL 의 쓰기는 public.booths INSERT 하나뿐(QR · PIN · 대기 값 · 설정 쓰기 없음)', w['02-register.sql'].join(' · '));
check(JSON.stringify(w['09-rollback.sql']) === JSON.stringify(['delete from public.booths']), '되돌리기 SQL 의 쓰기는 public.booths DELETE 하나뿐', w['09-rollback.sql'].join(' · '));
check(/is_published, sort_order\)\s+select id, name, org, org_type, program, null, null, '준비 전', false/.test(sqls['02-register.sql']), '등록 값: 구역 · 번호 NULL · 상태 준비 전 · 비공개', '');
check(/on conflict \(id\) do nothing/.test(sqls['02-register.sql']) && /부분 등록 상태/.test(sqls['02-register.sql']), '다시 실행 안전(모두 있으면 변경 없음 · 일부만 있으면 중단 · UUID 충돌 무시 후 건수 확인)', '');
check(!/token|pin_hash|token_hash|device_tag|ip_tag/.test(Object.values(sqls).join('\n').replace(/--[^\n]*/g, '')), 'SQL 이 인증정보 칸(token · pin_hash · token_hash · 기기/IP 태그)을 읽지 않음', '');

// ── 5. 기존 검증기 ─────────────────────────────────────────────────────
const xlsx = resolve(STG, 'booth-registration-staging.xlsx');
writeXlsx(xlsx, workbookV1([
  `2026 인천 AI미래채움 교육페스티벌 — 비공개 등록 대상 ${manifestRows.length}개(${SCOPE.join(' · ')}) · 양식 v1.0`,
  '부스번호 · 구역코드는 현장 배치 확정 후 적습니다(GO-LIVE 단계). 지금은 비워 둔 채 STAGING 검사만 합니다.',
  `manifest sha256 ${sha256}`
], inScope.map(o => boothRowV1({
  key: o['문서키'], category: o['공식 분류'], policy: o['정책학교 종류'], level: o['학교급'], doc_place: o['문서상 장소'], source_page: o['출처 쪽(문서 표기)'],
  name: o['부스명'], org: o['운영기관'], org_type: o['기관유형'], program: o['체험·전시 내용'],
  school_count: Number(o['참여학교 수'] || 0), schools: schoolsByKey[o['문서키']] || []
}))));
let validator = { ran: false };
if (validatorPath && existsSync(validatorPath)) {
  const before = createHash('sha256').update(readFileSync(validatorPath)).digest('hex');
  const vout = resolve(STG, 'validate');
  try { execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', validatorPath, '-Path', xlsx, '-OutDir', vout], { stdio: 'pipe' }); } catch { /* NOT READY 는 종료 코드 1 */ }
  const after = createHash('sha256').update(readFileSync(validatorPath)).digest('hex');
  const summary = JSON.parse(readFileSync(resolve(vout, 'summary.json'), 'utf8').replace(/^﻿/, ''));
  const issues = existsSync(resolve(vout, 'issues.csv')) ? readCsv(resolve(vout, 'issues.csv')) : [];
  const errs = issues.filter(i => i.level === 'ERROR');
  const allowed = errs.filter(i => i.code === 'REQUIRED' && ['부스번호', '구역코드'].includes(i.column));
  const other = errs.filter(i => !allowed.includes(i));
  validator = { ran: true, path: validatorPath, sha256: before, unchanged: before === after, summary, allowed: allowed.length, other };
  check(before === after, '기존 검증기 파일 변경 없음', `sha256 ${before.slice(0, 16)}…`);
  check(summary.rows.booths === manifestRows.length, `기존 검증기가 읽은 부스 ${manifestRows.length}행`, `${summary.rows.booths}행`);
  check(other.length === 0, '기존 검증기 ERROR 는 부스번호 · 구역코드 필수(미배정)뿐', `허용 ${allowed.length} · 그 밖 ${other.length}${other.length ? ' — ' + [...new Set(other.map(i => `${i.code}/${i.column}`))].join(', ') : ''}`);
} else check(false, '기존 검증기 실행', '검증기를 찾지 못함 — --validator 로 넘기세요');

// ── 6. 보고서 ─────────────────────────────────────────────────────────
const okN = checks.filter(c => c.ok).length, ready = okN === checks.length;
const L = [];
L.push('# STAGING READY 판정', '');
L.push(`- 대상: **${manifestRows.length}개**(${SCOPE.join(' · ')}) · 보류 ${held.length}개(${held.map(h => h['문서키']).join(' · ')})`);
L.push(`- manifest sha256: \`${sha256}\``, `- 만든 시각: ${meta.generatedAt}`, '- DB 접속 없음 · SQL 은 만들기만 함', '');
L.push(`## 판정: ${ready ? 'STAGING READY' : 'NOT READY'} (${okN}/${checks.length})`, '');
L.push('| 결과 | 검사 | 내용 |', '|---|---|---|');
for (const c of checks) L.push(`| ${c.ok ? '통과' : '**실패**'} | ${c.what} | ${c.detail.replace(/\|/g, '\\|')} |`);
if (validator.ran) {
  const s = validator.summary;
  L.push('', '## 기존 검증기 결과', '', `- \`${validator.path}\` (sha256 \`${validator.sha256}\` · 실행 전후 같음: ${validator.unchanged ? '예' : '아니오'})`);
  L.push(`- 판정 ${s.verdict} · ERROR ${s.errors} · WARNING ${s.warnings} — ERROR 중 부스번호 · 구역코드 필수(미배정) ${validator.allowed}건, 그 밖 ${validator.other.length}건`);
  L.push(`- 기관유형: ${Object.entries(s.booths_by_org_type || {}).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
}
L.push('', '## 만든 SQL(실행하지 않음)', '', '| 파일 | 쓰기 문 |', '|---|---|');
for (const [f, ws] of Object.entries(w)) L.push(`| \`${f}\` | ${ws.length ? ws.join(' · ') : '없음(읽기 전용)'} |`);
writeFileSync(resolve(STG, 'staging-report.md'), L.join('\n') + '\n');

console.log(`${ready ? 'STAGING READY' : 'NOT READY'} — 검사 ${okN}/${checks.length} · 대상 ${manifestRows.length} · 보류 ${held.length} · manifest ${sha256.slice(0, 16)}…`);
for (const c of checks.filter(c => !c.ok)) console.log(`  실패: ${c.what} — ${c.detail}`);
console.log(`결과: ${STG}`);
process.exit(ready ? 0 : 1);
