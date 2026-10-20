/* ===================================================================
   실제 부스 배치 입력 양식(엑셀) 만들기
   ───────────────────────────────────────────────────────────────────
   배치도가 확정되면 담당자가 실제 부스 84곳의 구역 코드 · 번호만 적어 보내는 양식입니다.
   부스 ID · 학교명 · 부스명은 manifest(사전 등록 84곳)에서 미리 채우고 잠급니다.

   시트: 안내 · 구역(입력) · 부스 배치(84줄 · 구역 코드 · 번호 입력) · 검증 요약(자동)
   검증(수식): 빠진 행 · 미등록 구역 · 번호 형식(1~999 정수) · 같은 구역 안 번호 중복 ·
              구역 코드 형식 · 코드 중복 · A~E(예시 부스 50곳이 쓰는 구역) · R1~R4(리허설 임시 구역) 사용 불가 — 쓰면 판정이 '제출 가능' 이 되지 않음

   ⚠️ 운영자 QR 원문 · PIN · 연락처는 넣지 않습니다(manifest 에도 없음).
   ⚠️ 구역 · 번호를 미리 채우지 않습니다(실제 배치도 전).
   쓰는 법: node scripts/booth-data/build-placement-template.mjs --xlsx-lib <exceljs · hyperformula 설치 폴더>
            [--out out/placement/부스배치-입력양식-84곳.xlsx] [--stamp 2026-10-16]
   =================================================================== */

import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readCsv } from './lib/csv.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'out');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const req = createRequire(join(resolve(arg('xlsx-lib')), 'package.json'));
const ExcelJS = req('exceljs');
const { HyperFormula } = req('hyperformula');
const outFile = resolve(arg('out', resolve(OUT, 'placement', '부스배치-입력양식-84곳.xlsx')));
const stamp = arg('stamp', new Date().toISOString().slice(0, 10));

const manifest = readCsv(resolve(OUT, 'staging', 'manifest.csv'))
  .slice().sort((a, b) => a.doc_key.localeCompare(b.doc_key));
if (manifest.length !== 84) throw new Error('manifest 가 84줄이 아닙니다: ' + manifest.length);

// ── 칸 배치 ───────────────────────────────────────────────────────
export const Z = { sheet: '구역', head: 5, first: 6, last: 35 };          // 구역 30줄
export const B = { sheet: '부스 배치', head: 4, first: 5, last: 5 + 83 };   // 부스 84줄
export const S = { sheet: '검증 요약' };
// 시트 이름은 늘 따옴표로 감쌉니다(한글 시트 이름 — 엑셀은 그대로 받고, 계산 확인용 엔진도 읽을 수 있게).
const ZK = `'구역'!$A$${Z.first}:$A$${Z.last}`, ZN = `'구역'!$B$${Z.first}:$B$${Z.last}`, ZF = `'구역'!$F$${Z.first}:$F$${Z.last}`;
const BE = `'부스 배치'!$E$${B.first}:$E$${B.last}`, BF = `$F$${B.first}:$F$${B.last}`, BI = `'부스 배치'!$I$${B.first}:$I$${B.last}`;

// 구역 코드 한 글자 검사: k 번째 글자가 영문 대문자(첫 글자) 또는 대문자 · 숫자(둘째부터)인가. 글자가 없으면 통과.
// FIND 는 대소문자를 가립니다(DB 의 구역 코드도 가립니다). CODE 는 한글 코드 페이지에 따라 값이 달라 쓰지 않습니다.
const UP = '"ABCDEFGHIJKLMNOPQRSTUVWXYZ"', UPNUM = '"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"';
const inSet = (r, k, set) => `ISNUMBER(FIND(MID(A${r},${k},1),${set}))`;
const fmtOk = r => `AND(LEN(A${r})<=3,${inSet(r, 1, UP)},IF(LEN(A${r})<2,TRUE(),${inSet(r, 2, UPNUM)}),IF(LEN(A${r})<3,TRUE(),${inSet(r, 3, UPNUM)}))`;
// A~E 는 지금 예시 부스 50곳이 쓰는 구역입니다(번호 A-01…E-06 이 이미 있음). 재사용 여부는 따로 정하므로
// 이 양식에서는 쓸 수 없게 합니다 — 구역 표에 적거나 부스에 배정하면 판정이 '제출 가능' 이 되지 않습니다.
const isExample = cell => `OR(EXACT(${cell},"A"),EXACT(${cell},"B"),EXACT(${cell},"C"),EXACT(${cell},"D"),EXACT(${cell},"E"))`;
// R1~R4 는 2026-10-19 부터 실제 부스 84곳이 리허설용으로 쓰는 임시 구역입니다. 최종 배치는 같은 부스를 다른 구역으로
// 옮기는 방식이라(F-02) 최종 구역 코드가 R1~R4 와 겹치면 안 됩니다 — A~E 와 같은 방식으로 막습니다.
const isRehearsal = cell => `OR(EXACT(${cell},"R1"),EXACT(${cell},"R2"),EXACT(${cell},"R3"),EXACT(${cell},"R4"))`;

export const zoneCheck = r =>
  `IF(AND(A${r}="",B${r}="",C${r}="",D${r}=""),"",` +
  `IF(A${r}="","구역 코드 없음",` +
  `IF(${isExample('A' + r)},"사용 불가: A~E 는 예시 부스 구역",` +
  `IF(${isRehearsal('A' + r)},"사용 불가: R1~R4 는 리허설 임시 구역",` +
  `IF(NOT(${fmtOk(r)}),"코드 형식(영문 대문자로 시작 · 1~3자)",` +
  `IF(SUMPRODUCT(--EXACT($A$${Z.first}:$A$${Z.last},A${r}))>1,"코드 중복",` +
  `IF(B${r}="","구역 이름 없음",` +
  `IF(NOT(ISNUMBER(C${r})),"표시 순서(숫자) 없음","OK"))))))))`;
export const zoneCount = r => `IF(A${r}="","",SUMPRODUCT(--EXACT(${BE},A${r})))`;

export const boothCode = r => `IF(OR(E${r}="",F${r}=""),"",E${r}&"-"&IF(ISNUMBER(F${r}),TEXT(F${r},"00"),F${r}))`;
export const boothZoneName = r => `IF(E${r}="","",IFERROR(INDEX(${ZN},MATCH(E${r},${ZK},0)),""))`;
export const boothCheck = r =>
  `IF(AND(E${r}="",F${r}=""),"미입력",` +
  `IF(E${r}="","구역 코드 없음",` +
  `IF(F${r}="","번호 없음",` +
  `IF(SUMPRODUCT(--EXACT(${ZK},E${r}))=0,"미등록 구역",` +
  `IF(${isExample('E' + r)},"예시 구역(A~E) 사용 불가",` +
  `IF(${isRehearsal('E' + r)},"리허설 임시 구역(R1~R4) 사용 불가",` +
  `IF(NOT(ISNUMBER(F${r})),"번호는 1부터 999까지 정수",` +
  `IF(OR(F${r}<>INT(F${r}),F${r}<1,F${r}>999),"번호는 1부터 999까지 정수",` +
  `IF(SUMPRODUCT(EXACT($E$${B.first}:$E$${B.last},E${r})*(${BF}=F${r}))>1,"번호 중복","OK")))))))))`;

// 검증 요약 — [항목, 수식, 기준, 설명]
// COUNTIF 의 찾는 말에는 '~' 를 넣지 않습니다(엑셀에서 '~' 는 와일드카드 이스케이프). 확인 칸 글에 '~' 가 있어도
// 찾는 말을 '*사용 불가' · '사용 불가*' 처럼 뒷부분 · 앞부분 + * 로 씁니다.
const cnt = s => `COUNTIF(${BI},"${s}")`;
export const SUMMARY = [
  ['부스 행', `COUNTA('부스 배치'!$B$${B.first}:$B$${B.last})`, '84', '미리 채운 사전 등록 부스(바꾸지 않습니다)'],
  ['입력 완료', cnt('OK'), '84', '구역 코드 · 번호가 모두 맞는 행'],
  ['빠진 행', `${cnt('미입력')}+${cnt('구역 코드 없음')}+${cnt('번호 없음')}`, '0', '구역 코드나 번호가 비어 있는 행'],
  ['미등록 구역', cnt('미등록 구역'), '0', "'구역' 시트에 없는 코드를 쓴 행(대소문자 · 띄어쓰기까지 같아야 합니다)"],
  ['사용 불가 구역 배정', cnt('*사용 불가'), '0', 'A~E(예시 부스) · R1~R4(리허설 임시 구역)에 배정한 행 — 쓸 수 없음'],
  ['번호 형식', cnt('번호는 1부터 999까지 정수'), '0', '번호가 1~999 정수가 아닌 행'],
  ['번호 중복', cnt('번호 중복'), '0', '같은 구역 안에서 번호가 겹친 행 수'],
  ['구역 표 오류', `SUMPRODUCT((${ZF}<>"")*(${ZF}<>"OK")*(LEFT(${ZF},5)<>"사용 불가"))`, '0', "'구역' 시트의 코드 없음 · 형식 · 중복 · 이름 · 순서"],
  ['사용 불가 구역 등록', `COUNTIF(${ZF},"사용 불가*")`, '0', "'구역' 시트에 A~E · R1~R4 를 적은 줄(지우거나 다른 코드로)"],
  ['등록 구역 수', `SUMPRODUCT(--(${ZK}<>""))`, '', "'구역' 시트에 적은 구역"]
];
// 판정: 요약 줄은 5행부터 SUMMARY 순서대로. 이름으로 행을 찾아 수식을 만듭니다(줄을 더해도 어긋나지 않게).
const rowOf = name => 5 + SUMMARY.findIndex(s => s[0] === name);
export const VERDICT = `IF(AND(B${rowOf('부스 행')}=84,B${rowOf('입력 완료')}=84,B${rowOf('사용 불가 구역 배정')}=0,` +
  `B${rowOf('구역 표 오류')}=0,B${rowOf('사용 불가 구역 등록')}=0),"제출 가능","수정 필요")`;

// ── 값 · 수식 모형(HyperFormula 로 계산해 미리 값을 채웁니다) ─────────
function model() {
  const zone = [], booth = [], sum = [];
  for (let r = Z.first; r <= Z.last; r++) zone[r - 1] = [null, null, null, null, '=' + zoneCount(r), '=' + zoneCheck(r)];
  manifest.forEach((m, i) => {
    const r = B.first + i;
    booth[r - 1] = [m.doc_key, m.booth_id, m.org, m.name, null, null, '=' + boothCode(r), '=' + boothZoneName(r), '=' + boothCheck(r)];
  });
  SUMMARY.forEach((s, i) => { sum[4 + i] = [s[0], '=' + s[1], s[2], s[3]]; });
  sum[4 + SUMMARY.length] = ['판정', '=' + VERDICT, '제출 가능', "모두 기준과 같으면 '제출 가능'"];
  const fill = a => { for (let i = 0; i < a.length; i++) if (!a[i]) a[i] = []; return a; };
  return { '구역': fill(zone), '부스 배치': fill(booth), '검증 요약': fill(sum) };
}
export function hfFrom(sheets) {
  return HyperFormula.buildFromSheets(sheets, { licenseKey: 'gpl-v3', useArrayArithmetic: true });
}
const hf = hfFrom(model());
const sid = n => hf.getSheetId(n);
const val = (sheet, r, c) => hf.getCellValue({ sheet: sid(sheet), row: r - 1, col: c });

// ── 엑셀 ──────────────────────────────────────────────────────────
const FONT = '맑은 고딕';
const C = { ink: 'FF1F2430', muted: 'FF6B7280', line: 'FFD9DCE3', head: 'FFF1F2F5', input: 'FFFFF2CC', accent: 'FF5B45E0',
  badFill: 'FFFDE2E1', badInk: 'FF9B1C1C', okInk: 'FF1F7A3A' };
const thin = { style: 'thin', color: { argb: C.line } };
const box = { top: thin, left: thin, bottom: thin, right: thin };
const font = (o = {}) => ({ name: FONT, size: 10, color: { argb: C.ink }, ...o });

const wb = new ExcelJS.Workbook();
wb.creator = '행사 운영 포털';
wb.created = new Date(stamp + 'T00:00:00+09:00');
wb.modified = wb.created;
wb.calcProperties.fullCalcOnLoad = true;   // 엑셀이 열 때 다시 계산합니다

function title(ws, text, sub) {
  ws.getCell('A1').value = text;
  ws.getCell('A1').font = font({ size: 14, bold: true });
  if (sub) { ws.getCell('A2').value = sub; ws.getCell('A2').font = font({ color: { argb: C.muted } }); }
}
function header(ws, row, names) {
  names.forEach((n, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = n; c.font = font({ bold: true }); c.border = box;
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.head } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  ws.getRow(row).height = 22;
}
const fx = (ws, addr, formula, sheet, r, c) => {
  let result = val(sheet, r, c);
  if (result && typeof result === 'object') result = undefined;   // 계산 오류는 미리 값으로 넣지 않습니다(시험에서 따로 잡습니다)
  ws.getCell(addr).value = { formula, result };
};
const lockFree = cell => { cell.protection = { locked: false }; };
const protect = ws => ws.protect(undefined, { selectLockedCells: true, selectUnlockedCells: true, autoFilter: true, formatColumns: true });

// 1) 안내
{
  const ws = wb.addWorksheet('안내', { properties: { tabColor: { argb: C.accent } } });
  ws.columns = [{ width: 4 }, { width: 22 }, { width: 22 }, { width: 18 }, { width: 14 }, { width: 12 }, { width: 14 }, { width: 44 }];
  title(ws, '실제 부스 배치 입력 양식 — 2026 인천 AI미래채움 교육페스티벌',
    `사전 등록 부스 ${manifest.length}곳 · 기준일 ${stamp} · 이 파일만으로는 사이트가 바뀌지 않습니다(검토 · 승인 뒤 반영).`);
  const lines = [
    ['작성 순서', ''],
    ['1단계', "'구역' 시트에 구역 코드 · 구역 이름 · 표시 순서를 적습니다(부제는 선택)."],
    ['2단계', "'부스 배치' 시트의 노란 칸 — 구역 코드(목록에서 선택) · 번호 — 만 채웁니다."],
    ['3단계', "'검증 요약' 의 판정이 '제출 가능' 인지 확인하고 보내 주세요."],
    ['', ''],
    ['규칙', ''],
    ['구역 코드', '영문 대문자로 시작하는 대문자 · 숫자 1~3자(예: SW, B2). 같은 코드를 두 번 쓰지 않습니다.'],
    ['A~E', "쓸 수 없습니다. 지금 협의용 예시 부스 50곳이 쓰는 구역입니다(재사용 여부는 따로 정합니다). 적으면 판정이 '수정 필요' 가 됩니다."],
    ['R1~R4', "쓸 수 없습니다. 지금 실제 부스 84곳이 리허설용으로 쓰는 임시 구역입니다(최종 배치로 옮길 때 겹치면 안 됨). 적으면 판정이 '수정 필요' 가 됩니다."],
    ['그 밖의 코드', 'F~J 를 포함한 다른 코드는 실제 확정 자료를 받은 뒤 함께 검토합니다(양식에서는 막지 않습니다).'],
    ['번호', '1~999 정수. 같은 구역 안에서 겹치지 않게. 화면에는 구역-번호로 보입니다(한 자리 번호는 앞에 0: SW-07).'],
    ['84곳', '모든 부스를 한 번씩 배치합니다. 행을 지우거나 순서를 바꾸지 않습니다(부스 ID 로 대조합니다).'],
    ['', ''],
    ['칸 색', ''],
    ['노란 칸', '입력하는 칸'],
    ['흰 칸', '미리 채운 칸(잠금) · 자동 계산 칸'],
    ['확인 칸', "OK 가 아니면 붉게 보입니다. 붉은 줄이 하나라도 있으면 판정은 '수정 필요' 입니다."],
    ['', ''],
    ['넣지 않은 것', '운영자 QR 원문 · PIN · 담당자 연락처는 이 파일에 없습니다. 적지 마세요.'],
    ['시트 보호', "실수로 지우지 않게 잠가 두었습니다(암호 없음 · 검토 → 시트 보호 해제). 필터는 쓸 수 있습니다."]
  ];
  lines.forEach(([k, v], i) => {
    const r = 4 + i;
    ws.getCell(r, 2).value = k || null; ws.getCell(r, 3).value = v || null;
    ws.mergeCells(r, 3, r, 8);
    const sec = k && !v;
    ws.getCell(r, 2).font = font({ bold: true, size: sec ? 11 : 10, color: { argb: sec ? C.accent : C.ink } });
    ws.getCell(r, 2).alignment = { vertical: 'middle' };
    ws.getCell(r, 3).font = font(); ws.getCell(r, 3).alignment = { vertical: 'middle' };
    ws.getRow(r).height = sec ? 22 : 18;
  });
  // 작성 예시(형식만)
  let r = 4 + lines.length + 1;
  ws.getCell(r, 2).value = '작성 예시 — 형식만 보여 줍니다(실제 배치 아님)';
  ws.getCell(r, 2).font = font({ bold: true, size: 11, color: { argb: C.accent } });
  r += 1;
  const ex1 = [['구역 시트', '구역 코드', '구역 이름', '표시 순서', '부제'], ['', 'SW', '스쿨존 1관', 1, '(비워도 됨)']];
  const ex2 = [['부스 배치 시트', '문서 번호', '학교명', '구역 코드', '번호', '표시 코드', '확인'], ['', 'S00', '○○초등학교', 'SW', 7, 'SW-07', 'OK']];
  for (const t of [ex1, ex2]) {
    t.forEach((row, j) => row.forEach((v, k) => {
      if (k === 0) { if (j === 0) { ws.getCell(r, 2).value = v; ws.getCell(r, 2).font = font({ bold: true }); } return; }
      const c = ws.getCell(r + j, 2 + k);
      c.value = v; c.border = box;
      c.font = font({ bold: j === 0, color: { argb: j === 0 ? C.ink : C.muted } });
      if (j === 0) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.head } };
      c.alignment = { horizontal: 'center' };
    }));
    r += t.length + 1;
  }
  ws.views = [{ showGridLines: false }];
  protect(ws);
}

// 2) 구역
{
  const ws = wb.addWorksheet('구역');
  ws.columns = [{ width: 12 }, { width: 26 }, { width: 11 }, { width: 30 }, { width: 10 }, { width: 34 }];
  title(ws, '구역 — 노란 칸에 실제 구역을 적습니다', '구역 코드는 영문 대문자 · 숫자 1~3자 · A~E(예시) · R1~R4(리허설 임시)는 사용 불가 · 부제는 선택');
  ws.getCell('A3').value = '부스 배치 시트의 구역 코드 목록은 이 표의 코드에서 나옵니다. 비어 있는 줄은 그대로 두면 됩니다.';
  ws.getCell('A3').font = font({ color: { argb: C.muted } });
  header(ws, Z.head, ['구역 코드', '구역 이름(관람객에게 보임)', '표시 순서', '부제(선택)', '부스 수', '확인']);
  for (let r = Z.first; r <= Z.last; r++) {
    for (let c = 1; c <= 4; c++) {
      const cell = ws.getCell(r, c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.input } };
      cell.border = box; cell.font = font(); lockFree(cell);
      if (c === 1) cell.alignment = { horizontal: 'center' };
    }
    fx(ws, `E${r}`, zoneCount(r), '구역', r, 4);
    fx(ws, `F${r}`, zoneCheck(r), '구역', r, 5);
    for (const c of [5, 6]) { const cell = ws.getCell(r, c); cell.border = box; cell.font = font({ color: { argb: C.muted } }); }
    ws.getCell(r, 5).alignment = { horizontal: 'center' };
  }
  // 코드 · 순서 입력 도움(막지는 않고 안내만 — 실제 판단은 확인 칸이 합니다)
  for (let r = Z.first; r <= Z.last; r++) {
    ws.getCell(`A${r}`).dataValidation = { type: 'textLength', operator: 'between', formulae: [1, 3], allowBlank: true,
      showErrorMessage: true, errorStyle: 'warning', errorTitle: '구역 코드', error: '구역 코드는 영문 대문자 · 숫자 1~3자입니다.',
      showInputMessage: true, promptTitle: '구역 코드', prompt: '영문 대문자로 시작 · 1~3자(예: SW). A~E · R1~R4 는 쓸 수 없습니다.' };
    ws.getCell(`C${r}`).dataValidation = { type: 'whole', operator: 'between', formulae: [1, 999], allowBlank: true,
      showErrorMessage: true, errorStyle: 'stop', errorTitle: '표시 순서', error: '표시 순서는 1 이상의 정수입니다.' };
  }
  const rng = `F${Z.first}:F${Z.last}`;
  ws.addConditionalFormatting({ ref: rng, rules: [
    { type: 'expression', priority: 2, formulae: [`AND($F${Z.first}<>"",$F${Z.first}<>"OK")`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.badFill } }, font: { color: { argb: C.badInk }, bold: true } } },
    { type: 'expression', priority: 3, formulae: [`$F${Z.first}="OK"`], style: { font: { color: { argb: C.okInk }, bold: true } } }
  ] });
  ws.views = [{ state: 'frozen', ySplit: Z.head, showGridLines: false }];
  protect(ws);
}

// 3) 부스 배치
{
  const ws = wb.addWorksheet('부스 배치');
  // 머리글 오른쪽에 필터 단추가 붙으므로 짧은 칸도 머리글 글자 + 단추 폭을 둡니다.
  ws.columns = [{ width: 12 }, { width: 38 }, { width: 24 }, { width: 50 }, { width: 13 }, { width: 9 }, { width: 13 }, { width: 18 }, { width: 22 }];
  title(ws, `부스 배치 — 노란 칸(구역 코드 · 번호)만 입력 · ${manifest.length}곳`,
    "구역 코드는 목록에서 고릅니다('구역' 시트에 먼저 등록). 번호는 1~999 정수, 같은 구역 안에서 겹치지 않게.");
  header(ws, B.head, ['문서 번호', '부스 ID', '학교명', '부스명', '구역 코드', '번호', '표시 코드', '구역 이름', '확인']);
  manifest.forEach((m, i) => {
    const r = B.first + i;
    const put = (c, v, o = {}) => { const cell = ws.getCell(r, c); cell.value = v; cell.border = box; cell.font = font(o.font); if (o.align) cell.alignment = o.align; return cell; };
    put(1, m.doc_key, { align: { horizontal: 'center' } });
    put(2, m.booth_id, { font: { color: { argb: C.muted }, size: 9 } });
    put(3, m.org);
    put(4, m.name, { align: { wrapText: false } });
    for (const c of [5, 6]) {
      const cell = put(c, null, { align: { horizontal: 'center' } });
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.input } };
      lockFree(cell);
    }
    fx(ws, `G${r}`, boothCode(r), '부스 배치', r, 6);
    fx(ws, `H${r}`, boothZoneName(r), '부스 배치', r, 7);
    fx(ws, `I${r}`, boothCheck(r), '부스 배치', r, 8);
    for (const c of [7, 8, 9]) { const cell = ws.getCell(r, c); cell.border = box; cell.font = font({ color: { argb: C.muted } }); }
    ws.getCell(r, 7).alignment = { horizontal: 'center' };
    ws.getCell(`E${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['ZoneKeys'],
      showErrorMessage: true, errorStyle: 'stop', errorTitle: '구역 코드', error: "'구역' 시트에 먼저 등록한 코드만 고를 수 있습니다.",
      showInputMessage: true, promptTitle: '구역 코드', prompt: "'구역' 시트의 코드에서 고릅니다." };
    ws.getCell(`F${r}`).dataValidation = { type: 'whole', operator: 'between', formulae: [1, 999], allowBlank: true,
      showErrorMessage: true, errorStyle: 'stop', errorTitle: '번호', error: '번호는 1~999 정수입니다.' };
  });
  const rng = `I${B.first}:I${B.last}`;
  ws.addConditionalFormatting({ ref: rng, rules: [
    { type: 'expression', priority: 1, formulae: [`$I${B.first}="OK"`], style: { font: { color: { argb: C.okInk }, bold: true } } },
    { type: 'expression', priority: 2, formulae: [`$I${B.first}="미입력"`], style: { font: { color: { argb: C.muted } } } },
    { type: 'expression', priority: 3, formulae: [`AND($I${B.first}<>"OK",$I${B.first}<>"미입력")`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.badFill } }, font: { color: { argb: C.badInk }, bold: true } } }
  ] });
  ws.autoFilter = `A${B.head}:I${B.last}`;
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: B.head, showGridLines: false }];
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${B.head}:${B.head}` };
  protect(ws);
}

// 4) 검증 요약
{
  const ws = wb.addWorksheet('검증 요약');
  ws.columns = [{ width: 18 }, { width: 14 }, { width: 10 }, { width: 76 }];
  title(ws, '검증 요약 — 자동 계산', "모든 값이 기준과 같고 판정이 '제출 가능' 이면 보내 주세요.");
  header(ws, 4, ['항목', '값', '기준', '설명']);
  const rows = SUMMARY.concat([['판정', VERDICT, '제출 가능', "모두 기준과 같으면 '제출 가능' · 하나라도 다르면(A~E · R1~R4 사용 포함) '수정 필요'"]]);
  rows.forEach((s, i) => {
    const r = 5 + i, last = i === rows.length - 1;
    ws.getCell(r, 1).value = s[0];
    fx(ws, `B${r}`, s[1], '검증 요약', r, 1);
    ws.getCell(r, 3).value = s[2] === '' ? null : (/^\d+$/.test(s[2]) ? Number(s[2]) : s[2]);
    ws.getCell(r, 4).value = s[3];
    for (let c = 1; c <= 4; c++) {
      const cell = ws.getCell(r, c);
      cell.border = box; cell.font = font({ bold: last || c === 2, size: last ? 11 : 10, color: { argb: c === 3 || c === 4 ? C.muted : C.ink } });
      cell.alignment = { vertical: 'middle', horizontal: c === 2 || c === 3 ? 'center' : 'left', wrapText: c === 4 };
    }
    ws.getRow(r).height = last ? 24 : 20;
  });
  const vr = 5 + SUMMARY.length;
  // 기준과 다르면 붉게(판정 줄은 문구로)
  ws.addConditionalFormatting({ ref: `B5:B${vr - 1}`, rules: [
    { type: 'expression', priority: 1, formulae: ['AND($C5<>"",$B5<>$C5)'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.badFill } }, font: { color: { argb: C.badInk }, bold: true } } }
  ] });
  ws.addConditionalFormatting({ ref: `B${vr}`, rules: [
    { type: 'expression', priority: 2, formulae: [`$B${vr}="제출 가능"`], style: { font: { color: { argb: C.okInk }, bold: true } } },
    { type: 'expression', priority: 4, formulae: [`$B${vr}="수정 필요"`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.badFill } }, font: { color: { argb: C.badInk }, bold: true } } }
  ] });
  ws.views = [{ showGridLines: false }];
  protect(ws);
}

wb.definedNames.add(`'구역'!$A$${Z.first}:$A$${Z.last}`, 'ZoneKeys');
wb.views = [{ activeTab: 0 }];
mkdirSync(dirname(outFile), { recursive: true });
await wb.xlsx.writeFile(outFile);
console.log('작성:', outFile);
console.log('미리 계산 — 부스 행', val('검증 요약', 5, 1), '· 입력 완료', val('검증 요약', 6, 1), '· 빠진 행', val('검증 요약', 7, 1), '· 판정', val('검증 요약', 5 + SUMMARY.length, 1));
