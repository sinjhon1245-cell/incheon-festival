/* ===================================================================
   실제 부스 배치 입력 양식(엑셀) 시험
   ───────────────────────────────────────────────────────────────────
   만든 파일을 다시 읽어(수식은 파일에 적힌 그대로) 확인합니다.
     구조   시트 · 84줄 = manifest · 미리 채운 칸 잠금 · 입력 칸만 풀림 · 목록 · 번호 제한 · 이름 범위
     보안   QR 원문 · PIN · 열쇠 모양 값 · '#k=' · 외부 연결 · 매크로 없음, 구역 · 번호 미리 채움 없음
     수식   HyperFormula 로 여러 입력을 넣어 확인 칸 · 요약 · 판정이 맞게 나오는지, 오류 값 0
   쓰는 법: node scripts/booth-data/test-placement-template.mjs --xlsx-lib <exceljs · hyperformula 설치 폴더> [--file <xlsx>]
   결과: out/placement/placement-template-test-report.md
   =================================================================== */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { inflateRawSync } from 'node:zlib';
import { readCsv } from './lib/csv.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'out');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const req = createRequire(join(resolve(arg('xlsx-lib')), 'package.json'));
const ExcelJS = req('exceljs');
const { HyperFormula } = req('hyperformula');
const file = resolve(arg('file', resolve(OUT, 'placement', '부스배치-입력양식-84곳.xlsx')));
const manifest = readCsv(resolve(OUT, 'staging', 'manifest.csv')).slice().sort((a, b) => a.doc_key.localeCompare(b.doc_key));

const results = [];
function t(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + detail : ''}`); }

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const names = wb.worksheets.map(w => w.name);
t('구조-1 시트 넷: 안내 · 구역 · 부스 배치 · 검증 요약', JSON.stringify(names) === JSON.stringify(['안내', '구역', '부스 배치', '검증 요약']), names.join(','));
const zs = wb.getWorksheet('구역'), bs = wb.getWorksheet('부스 배치'), ss = wb.getWorksheet('검증 요약');
const v = c => { const x = c.value; return x && typeof x === 'object' && 'formula' in x ? { f: x.formula } : x; };

// ── 구조 ──────────────────────────────────────────────────────────
const rows = [];
for (let r = 5; r <= 88; r++) rows.push([1, 2, 3, 4, 5, 6].map(c => v(bs.getCell(r, c))));
t('구조-2 부스 84줄 = manifest(문서 번호 · 부스 ID · 학교명 · 부스명 · 순서까지)',
  rows.length === 84 && rows.every((x, i) => x[0] === manifest[i].doc_key && x[1] === manifest[i].booth_id && x[2] === manifest[i].org && x[3] === manifest[i].name));
t('구조-3 89행 이후 · 머리글 위에 부스 줄 없음', !v(bs.getCell(89, 1)) && !v(bs.getCell(89, 2)) && v(bs.getCell(4, 1)) === '문서 번호');
t('구조-4 구역 코드 · 번호 비어 있음(미리 배정하지 않음)', rows.every(x => x[4] == null && x[5] == null));
let zoneEmpty = true;
for (let r = 6; r <= 35; r++) for (let c = 1; c <= 4; c++) if (v(zs.getCell(r, c)) != null) zoneEmpty = false;
t('구조-5 구역 표 비어 있음(구역을 미리 만들지 않음)', zoneEmpty);
const locked = c => !(c.protection && c.protection.locked === false);
let lockOk = true;
for (let r = 5; r <= 88; r++) {
  for (const c of [1, 2, 3, 4, 7, 8, 9]) if (!locked(bs.getCell(r, c))) lockOk = false;
  for (const c of [5, 6]) if (locked(bs.getCell(r, c))) lockOk = false;
}
for (let r = 6; r <= 35; r++) {
  for (const c of [1, 2, 3, 4]) if (locked(zs.getCell(r, c))) lockOk = false;
  for (const c of [5, 6]) if (!locked(zs.getCell(r, c))) lockOk = false;
}
t('구조-6 잠금: 부스 ID · 학교 · 부스명 · 자동 칸 잠김, 구역 코드 · 번호 · 구역 표 입력 칸만 풀림', lockOk);
t('구조-7 네 시트 모두 보호(암호 없음) · 필터 허용', wb.worksheets.every(w => w.sheetProtection && w.sheetProtection.sheet && !w.sheetProtection.hashValue && !w.sheetProtection.password) &&
  bs.sheetProtection.autoFilter !== false);
let dvOk = true;
for (let r = 5; r <= 88; r++) {
  const e = bs.getCell(r, 5).dataValidation, f = bs.getCell(r, 6).dataValidation;
  if (!e || e.type !== 'list' || String(e.formulae[0]) !== 'ZoneKeys') dvOk = false;
  if (!f || f.type !== 'whole' || +f.formulae[0] !== 1 || +f.formulae[1] !== 999) dvOk = false;
}
t('구조-8 입력 제한: 구역 코드 = 구역 표 목록(ZoneKeys) · 번호 = 1~999 정수', dvOk);
const dn = wb.definedNames.getRanges('ZoneKeys');
t("구조-9 이름 범위 ZoneKeys = '구역'!$A$6:$A$35", dn && dn.ranges && dn.ranges.length === 1 && /^'?구역'?!\$A\$6:\$A\$35$/.test(dn.ranges[0]), JSON.stringify(dn));

// ── 보안: 파일 안 모든 글(압축 풀어 XML 그대로) ─────────────────────────
function unzipTexts(buf) {
  const out = {};
  let i = 0;
  while (i < buf.length - 4) {
    if (buf.readUInt32LE(i) !== 0x04034b50) { i++; continue; }
    const method = buf.readUInt16LE(i + 8), csize = buf.readUInt32LE(i + 18), nlen = buf.readUInt16LE(i + 26), xlen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nlen).toString('utf8');
    const data = buf.slice(i + 30 + nlen + xlen, i + 30 + nlen + xlen + csize);
    out[name] = (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    i += 30 + nlen + xlen + csize;
  }
  return out;
}
const parts = unzipTexts(readFileSync(file));
const all = Object.values(parts).join('\n');
const partNames = Object.keys(parts);
t('구조-10 엑셀이 열 때 다시 계산(workbook.xml fullCalcOnLoad)', /<calcPr[^>]*fullCalcOnLoad="1"/.test(parts['xl/workbook.xml'] || ''));
t('보안-1 매크로 · 외부 연결 · 숨은 연결 없음', !partNames.some(n => /vbaProject|externalLink|connections\.xml/i.test(n)), partNames.join(','));
const uuids = new Set(manifest.map(m => m.booth_id));
// 열쇠는 24자 base64url(Production 형식). UUID · 서식 이름 · 수식 말고 그런 모양의 낱말이 있는지 봅니다.
const tokenLike = [...all.matchAll(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{24}(?![A-Za-z0-9_-])/g)].map(m => m[0])
  .filter(s => /[0-9]/.test(s) && /[A-Za-z]/.test(s) && !/^[0-9a-f-]+$/i.test(s));
t("보안-2 열쇠 모양(24자 base64url) 값 · '#k=' · booth-ctrl 주소 없음", !tokenLike.length && !/#k=|booth-ctrl/.test(all), tokenLike.length + '개');
t('보안-3 PIN · 비밀번호 · 연락처 모양 없음(4~6자리 숫자 낱말 · 휴대전화 · 이메일)',
  !/\b(pin_hash|password)\b/i.test(all) && !/01[016789]-?\d{3,4}-?\d{4}/.test(all) && !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/i.test(all.replace(/xmlns[^"]*"[^"]*"/g, '')));
const strs = [];
wb.worksheets.forEach(w => w.eachRow(r => r.eachCell(c => { const x = v(c); if (typeof x === 'string') strs.push(x); })));
t('보안-4 부스 ID 는 사전 등록 84곳 것만(공개 목록과 같은 값)', strs.filter(s => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(s)).every(s => uuids.has(s)) &&
  strs.filter(s => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(s)).length === 84);

// ── 수식: 파일에 적힌 수식 그대로 계산 ─────────────────────────────────
function sheetArr(ws, maxR, maxC) {
  const a = [];
  for (let r = 1; r <= maxR; r++) {
    const row = [];
    for (let c = 1; c <= maxC; c++) { const x = v(ws.getCell(r, c)); row.push(x && x.f ? '=' + x.f : (x && typeof x === 'object' ? null : x)); }
    a.push(row);
  }
  return a;
}
const base = { '안내': [[null]], '구역': sheetArr(zs, 35, 6), '부스 배치': sheetArr(bs, 88, 9), '검증 요약': sheetArr(ss, 15, 4) };
const formulaCount = Object.values(base).flat(2).filter(x => typeof x === 'string' && x.startsWith('=')).length;
t('수식-0 수식 칸 수(구역 60 · 부스 252 · 요약 11)', formulaCount === 323, String(formulaCount));

function scenario({ zones = [], booths = {} }) {
  const s = JSON.parse(JSON.stringify(base));
  zones.forEach((z, i) => { for (let c = 0; c < 4; c++) s['구역'][5 + i][c] = z[c] === undefined ? null : z[c]; });
  for (const [doc, [zk, no]] of Object.entries(booths)) {
    const i = manifest.findIndex(m => m.doc_key === doc);
    s['부스 배치'][4 + i][4] = zk; s['부스 배치'][4 + i][5] = no;
  }
  const hf = HyperFormula.buildFromSheets(s, { licenseKey: 'gpl-v3', useArrayArithmetic: true });
  const g = (sh, r, c) => hf.getCellValue({ sheet: hf.getSheetId(sh), row: r - 1, col: c - 1 });
  const errs = [];
  for (const sh of ['구역', '부스 배치', '검증 요약']) s[sh].forEach((row, r) => row.forEach((x, c) => {
    if (typeof x === 'string' && x.startsWith('=')) { const y = g(sh, r + 1, c + 1); if (y && typeof y === 'object') errs.push(`${sh}!R${r + 1}C${c + 1} ${y.value}`); }
  }));
  const check = doc => g('부스 배치', 5 + manifest.findIndex(m => m.doc_key === doc), 9);
  const code = doc => g('부스 배치', 5 + manifest.findIndex(m => m.doc_key === doc), 7);
  const zname = doc => g('부스 배치', 5 + manifest.findIndex(m => m.doc_key === doc), 8);
  const sum = k => g('검증 요약', 5 + ['부스 행', '입력 완료', '빠진 행', '미등록 구역', '사용 불가 구역 배정', '번호 형식', '번호 중복', '구역 표 오류', '사용 불가 구역 등록', '등록 구역 수', '판정'].indexOf(k), 2);
  const zcheck = i => g('구역', 6 + i, 6), zcount = i => g('구역', 6 + i, 5);
  return { errs, check, code, zname, sum, zcheck, zcount };
}
const docs = manifest.map(m => m.doc_key);
const allIn = (assign) => Object.fromEntries(docs.map((d, i) => [d, assign(i)]));

let s = scenario({});
t('수식-1 빈 양식: 부스 84 · 입력 완료 0 · 빠진 행 84 · 판정 수정 필요 · 오류 값 0',
  s.sum('부스 행') === 84 && s.sum('입력 완료') === 0 && s.sum('빠진 행') === 84 && s.sum('판정') === '수정 필요' && !s.errs.length && s.check('S01') === '미입력', s.errs.slice(0, 3).join(' | '));

s = scenario({ zones: [['SW', '스쿨존 1관', 1], ['K2', '스쿨존 2관', 2, '2층']], booths: allIn(i => i < 42 ? ['SW', i + 1] : ['K2', i - 41]) });
t('수식-2 84곳 모두 맞게: 입력 완료 84 · 판정 제출 가능 · 오류 값 0', s.sum('입력 완료') === 84 && s.sum('판정') === '제출 가능' && s.sum('등록 구역 수') === 2 && !s.errs.length, `${s.sum('입력 완료')} ${s.sum('판정')} ${s.errs.slice(0, 2).join('|')}`);
t('수식-3 표시 코드 두 자리(SW-01 · SW-42 · K2-07) · 구역 이름 · 구역별 부스 수 42/42',
  s.code('S01') === 'SW-01' && s.code('S42') === 'SW-42' && s.code('S49') === 'K2-07' && s.zname('S49') === '스쿨존 2관' && s.zcount(0) === 42 && s.zcount(1) === 42 && s.zcheck(0) === 'OK' && s.zcheck(1) === 'OK',
  `${s.code('S01')} ${s.code('S49')} ${s.zname('S49')} ${s.zcount(0)}/${s.zcount(1)}`);

s = scenario({ zones: [['SW', '스쿨존 1관', 1]], booths: allIn(i => ['SW', i + 1]) });
t('수식-4 세 자리 번호도 그대로(번호 123 → SW-123 · 84 → SW-84)', scenario({ zones: [['SW', 'x', 1]], booths: { S01: ['SW', 123] } }).code('S01') === 'SW-123' && s.code('S84') === 'SW-84');

const dup = allIn(i => ['SW', i + 1]); dup.S02 = ['SW', 1];
s = scenario({ zones: [['SW', '스쿨존 1관', 1]], booths: dup });
t('수식-5 같은 구역 같은 번호: 두 줄 모두 번호 중복 · 요약 2 · 판정 수정 필요', s.check('S01') === '번호 중복' && s.check('S02') === '번호 중복' && s.sum('번호 중복') === 2 && s.sum('입력 완료') === 82 && s.sum('판정') === '수정 필요');
const otherZone = allIn(i => ['SW', i + 1]); otherZone.S02 = ['K2', 1];
s = scenario({ zones: [['SW', 'a', 1], ['K2', 'b', 2]], booths: otherZone });
t('수식-6 다른 구역의 같은 번호는 중복 아님(SW-01 · K2-01)', s.check('S01') === 'OK' && s.check('S02') === 'OK' && s.sum('판정') === '제출 가능');

s = scenario({ zones: [['SW', 'a', 1]], booths: { S01: ['XX', 1], S02: ['sw', 2], S03: ['SW ', 3], S04: ['SW', 4] } });
t('수식-7 미등록 구역: 없는 코드 · 소문자 · 뒤 띄어쓰기 → 미등록 구역(3) · 맞는 줄은 OK',
  ['S01', 'S02', 'S03'].every(d => s.check(d) === '미등록 구역') && s.check('S04') === 'OK' && s.sum('미등록 구역') === 3);

s = scenario({ zones: [['SW', 'a', 1]], booths: { S01: ['SW', 0], S02: ['SW', 1000], S03: ['SW', 2.5], S04: ['SW', '가'], S05: ['SW', 999], S06: ['SW', 1] } });
t('수식-8 번호 형식: 0 · 1000 · 2.5 · 글자 → 번호는 1~999 정수(4) · 999 · 1 은 OK',
  ['S01', 'S02', 'S03', 'S04'].every(d => s.check(d) === '번호는 1부터 999까지 정수') && s.check('S05') === 'OK' && s.check('S06') === 'OK' && s.sum('번호 형식') === 4 && !s.errs.length,
  ['S01', 'S02', 'S03', 'S04', 'S05', 'S06'].map(d => d + ':' + s.check(d)).join(' ') + ' 요약 ' + s.sum('번호 형식') + ' ' + s.errs.slice(0, 2).join('|'));

s = scenario({ zones: [['SW', 'a', 1]], booths: { S01: ['SW', null], S02: [null, 5] } });
t('수식-9 빠진 칸: 번호 없음 · 구역 코드 없음 · 빠진 행 84(82 미입력 + 2)', s.check('S01') === '번호 없음' && s.check('S02') === '구역 코드 없음' && s.sum('빠진 행') === 84);

s = scenario({ zones: [['sw', 'a', 1], ['S-W', 'a', 2], ['ABCD', 'a', 3], ['1A', 'a', 4], ['가', 'a', 5], ['SW', 'a', 6], ['SW', 'b', 7], ['NM', null, 8], ['NO', 'c'], ['D', 'd', 9], ['DX', 'e', 10], ['D1', 'f', 11], [null, '이름만', 12]] });
const zc = [...Array(13).keys()].map(i => s.zcheck(i));
t('수식-10 구역 표: 형식 오류 5 · 코드 중복 2 · 이름 없음 · 순서 없음 · 코드 없음',
  zc.slice(0, 5).every(x => /^코드 형식/.test(x)) && zc[5] === '코드 중복' && zc[6] === '코드 중복' && zc[7] === '구역 이름 없음' && zc[8] === '표시 순서(숫자) 없음' && zc[12] === '구역 코드 없음', zc.join(' / '));
t("수식-11 구역 표의 'D'(예시 부스 구역) → 사용 불가 · 'DX' · 'D1' 은 OK", /^사용 불가/.test(zc[9]) && zc[10] === 'OK' && zc[11] === 'OK', zc[9]);
t('수식-12 요약: 구역 표 오류 10 · 예시 구역 등록 1 · 판정 수정 필요', s.sum('구역 표 오류') === 10 && s.sum('사용 불가 구역 등록') === 1 && s.sum('판정') === '수정 필요', `${s.sum('구역 표 오류')} / ${s.sum('사용 불가 구역 등록')}`);

s = scenario({ zones: [['D', '미래 구역', 1]], booths: allIn(i => ['D', i + 1]) });
t("수식-13 84곳을 모두 D 에 배정: 줄마다 예시 구역 사용 불가 · 입력 완료 0 · 예시 구역 배정 84 · 판정 수정 필요",
  docs.every(d => s.check(d) === '예시 구역(A~E) 사용 불가') && s.sum('입력 완료') === 0 && s.sum('사용 불가 구역 배정') === 84 && s.sum('사용 불가 구역 등록') === 1 && s.sum('판정') === '수정 필요' && !s.errs.length,
  `${s.check('S01')} ${s.sum('입력 완료')} ${s.sum('사용 불가 구역 배정')} ${s.sum('판정')}`);
s = scenario({ zones: [['SW', 'a', 1], ['SW', 'b', 2]], booths: allIn(i => ['SW', i + 1]) });
t("수식-14 구역 코드가 겹치면 부스가 모두 OK 여도 판정 '수정 필요'", s.sum('구역 표 오류') === 2 && s.sum('판정') === '수정 필요');

s = scenario({ zones: [['A', 'a', 1], ['B', 'b', 2], ['C', 'c', 3], ['D', 'd', 4], ['E', 'e', 5], ['F', 'f', 6], ['AB', 'g', 7], ['EA', 'h', 8], ['J', 'j', 9]] });
const z5 = [...Array(9).keys()].map(i => s.zcheck(i));
t('수식-15 구역 표: A · B · C · D · E 다섯 모두 사용 불가 · F · AB · EA · J 는 OK(따로 막지 않음)',
  z5.slice(0, 5).every(x => /^사용 불가/.test(x)) && z5.slice(5).every(x => x === 'OK') && s.sum('사용 불가 구역 등록') === 5 && s.sum('구역 표 오류') === 0, z5.join(' / '));

s = scenario({ zones: [['SW', 'a', 1], ['D', 'd', 2]], booths: allIn(i => ['SW', i + 1]) });
t("수식-16 D 를 구역 표에만 적고 부스는 모두 맞게: 입력 완료 84 여도 판정 '수정 필요'", s.sum('입력 완료') === 84 && s.sum('사용 불가 구역 등록') === 1 && s.sum('판정') === '수정 필요');

s = scenario({ zones: [['SW', 'a', 1]], booths: { ...allIn(i => ['SW', i + 1]), S84: ['D', 1] } });
t('수식-17 구역 표에 없는 D 를 부스에 쓰면 미등록 구역 · 판정 수정 필요', s.check('S84') === '미등록 구역' && s.sum('판정') === '수정 필요');

s = scenario({ zones: [['SW', 'a', 1], ['E', 'e', 2]], booths: { ...allIn(i => ['SW', i + 1]), S84: ['E', 1] } });
t('수식-18 한 곳만 E 에 배정: 그 줄 예시 구역 사용 불가 · 입력 완료 83 · 예시 구역 배정 1 · 판정 수정 필요',
  s.check('S84') === '예시 구역(A~E) 사용 불가' && s.check('S83') === 'OK' && s.sum('입력 완료') === 83 && s.sum('사용 불가 구역 배정') === 1 && s.sum('판정') === '수정 필요');
s = scenario({ zones: [['SW', 'a', 1], ['K2', 'b', 2]], booths: allIn(i => i < 42 ? ['SW', i + 1] : ['K2', i - 41]) });
t("수식-19 판정 값은 '제출 가능' 과 '수정 필요' 둘뿐('확인 후 제출' 없음)", s.sum('판정') === '제출 가능' &&
  !Object.values(base['검증 요약']).flat().some(x => typeof x === 'string' && x.includes('확인 후 제출')));

// R1~R4(리허설 임시 구역) 금지 — 2026-10-19 추가
s = scenario({ zones: [['R1', 'a', 1], ['R2', 'b', 2], ['R3', 'c', 3], ['R4', 'd', 4], ['R5', 'e', 5], ['R', 'f', 6], ['RA', 'g', 7], ['R12', 'h', 8], ['r1', 'i', 9]] });
const zr = [...Array(9).keys()].map(i => s.zcheck(i));
t('수식-20 구역 표: R1 · R2 · R3 · R4 넷 모두 사용 불가 · R5 · R · RA · R12 는 OK · 소문자 r1 은 형식 오류',
  zr.slice(0, 4).every(x => x === '사용 불가: R1~R4 는 리허설 임시 구역') && zr.slice(4, 8).every(x => x === 'OK') && /^코드 형식/.test(zr[8]) && s.sum('사용 불가 구역 등록') === 4 && s.sum('구역 표 오류') === 1, zr.join(' / '));
s = scenario({ zones: [['SW', 'a', 1], ['R2', 'r', 2]], booths: { ...allIn(i => ['SW', i + 1]), S84: ['R2', 1] } });
t('수식-21 한 곳만 R2 에 배정: 그 줄 리허설 임시 구역 사용 불가 · 입력 완료 83 · 사용 불가 배정 1 · 등록 1 · 판정 수정 필요',
  s.check('S84') === '리허설 임시 구역(R1~R4) 사용 불가' && s.check('S83') === 'OK' && s.sum('입력 완료') === 83 && s.sum('사용 불가 구역 배정') === 1 && s.sum('사용 불가 구역 등록') === 1 && s.sum('판정') === '수정 필요' && !s.errs.length, `${s.check('S84')} ${s.sum('판정')}`);
s = scenario({ zones: [['SW', 'a', 1], ['R4', 'r', 2]], booths: allIn(i => ['SW', i + 1]) });
t("수식-22 R4 를 구역 표에만 적고 부스는 모두 맞게: 입력 완료 84 여도 판정 '수정 필요'", s.sum('입력 완료') === 84 && s.sum('사용 불가 구역 등록') === 1 && s.sum('판정') === '수정 필요');
s = scenario({ zones: [['SW', 'a', 1], ['D', 'd', 2], ['R1', 'r', 3]], booths: { ...allIn(i => ['SW', i + 1]), S01: ['D', 1], S02: ['R1', 1] } });
t('수식-23 A~E 와 R1~R4 를 섞어도 각각 다른 말로 · 사용 불가 배정 2 · 등록 2 · 판정 수정 필요',
  s.check('S01') === '예시 구역(A~E) 사용 불가' && s.check('S02') === '리허설 임시 구역(R1~R4) 사용 불가' && s.sum('사용 불가 구역 배정') === 2 && s.sum('사용 불가 구역 등록') === 2 && s.sum('판정') === '수정 필요');

const pass = results.filter(r => r.ok).length;
const L = ['# 실제 부스 배치 입력 양식 시험 결과', '', `- 파일: ${file}`, '- 수식은 파일에 적힌 그대로 HyperFormula 2.7.1 로 계산했습니다(엑셀 2007 함수만 씀).', '',
  `**${pass}/${results.length} 통과**`, '', '| 결과 | 확인 |', '|---|---|', ...results.map(r => `| ${r.ok ? 'PASS' : 'FAIL'} | ${r.name.replace(/\|/g, '/')} |`)];
writeFileSync(resolve(OUT, 'placement', 'placement-template-test-report.md'), L.join('\n') + '\n');
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
