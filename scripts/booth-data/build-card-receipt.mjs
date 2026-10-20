/* ===================================================================
   운영자 카드 배부 · 수령 확인표(엑셀) + 봉투 안내 쪽지(HTML) — 리허설(R) 회차 · 최종 회차
   ───────────────────────────────────────────────────────────────────
   학교마다 한 줄(공동 운영 부스 S04 는 두 학교 · 같은 QR 사본 2장이라 두 줄). 84곳 + 1 = 85줄 · 쪽지 85장.
   미리 채움: 문서 번호 · 학교명 · 번호(R 회차는 임시 번호 · 최종 회차는 최종 번호 + 이전 임시 번호) · 부스명 · 카드 판 · 장 수
   운영본부가 채움: 전달 방법 · 전달일 · 받은 분 · 수령 확인 · 회수 · 비고

   R 회차   : R1~R4 는 리허설용 임시 번호이며 최종 행사 위치가 아니라는 안내를 표 위 · 쪽지마다 넣습니다.
   최종 회차: 같은 부스(부스 ID 같음) · 같은 QR 로 번호만 바뀐 카드. 이전 R 번호를 옆에 적어 옛 카드를 회수합니다.
              최종 계획에 R1~R4 · A~E 번호가 있거나 부스 ID 가 R 계획과 다르면 만들지 않고 멈춥니다.

   ⚠️ 이 스크립트는 열쇠를 읽지 않습니다(배치 계획 csv 만 읽음). QR 원문 · 운영자 화면 주소 · 카드의 열쇠 끝자리
      4글자는 표 · 쪽지 어디에도 넣지 않습니다(칸도 없음).
   쓰는 법:
     R 회차   : node scripts/booth-data/build-card-receipt.mjs --xlsx-lib <exceljs 설치 폴더> [--issued '10.16 11:26']
     최종 회차: node scripts/booth-data/build-card-receipt.mjs --xlsx-lib <…> --round final --plan <최종 배치 csv>
                [--prev out/gate4r/plan-R.csv] [--issued '10.16 11:26']
     (공통) [--out-dir <폴더>] — 기본 out/placement
     계획 csv 칸: 문서번호 · 부스ID · 학교명 · 부스명 · 표시코드(lib/plan-gate4r.mjs 의 planCsv 와 같은 모양)
   결과: 운영자카드-수령확인표-R.xlsx · 봉투안내-R.html (최종 회차는 …-최종.xlsx · 봉투안내-최종.html)
   =================================================================== */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readCsv } from './lib/csv.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'out');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const ExcelJS = createRequire(join(resolve(arg('xlsx-lib')), 'package.json'))('exceljs');
const issued = arg('issued', '10.16 11:26');   // 카드에 찍힌 '발급 MM.DD HH:MI' (Q-02 · 실제 84곳 같은 시각 · 최종 회차도 열쇠를 바꾸지 않으면 그대로)
const round = arg('round', 'R');
if (!['R', 'final'].includes(round)) throw new Error("--round 는 R 또는 final 입니다");
const FINAL = round === 'final';
const TAG = FINAL ? '최종' : 'R';
const outDir = resolve(arg('out-dir', resolve(OUT, 'placement')));

// ── 계획 읽기 · 확인 ──
const COLS = ['문서번호', '부스ID', '학교명', '부스명', '표시코드'];
function checkPlan(rows, label) {
  if (rows.length !== 84) throw new Error(`${label}: 84줄이 아닙니다(${rows.length}줄)`);
  const miss = COLS.filter(k => !(k in rows[0]));
  if (miss.length) throw new Error(`${label}: 칸이 없습니다 — ${miss.join(', ')}`);
  if (rows.some(r => COLS.some(k => !String(r[k]).trim()))) throw new Error(`${label}: 빈 칸이 있습니다`);
  if (new Set(rows.map(r => r['문서번호'])).size !== 84 || new Set(rows.map(r => r['표시코드'])).size !== 84) throw new Error(`${label}: 문서 번호나 표시코드가 겹칩니다`);
}
const prevFile = resolve(arg('prev', resolve(OUT, 'gate4r', 'plan-R.csv')));
const prev = readCsv(prevFile);
checkPlan(prev, 'R 계획');
if (prev.some(r => !/^R[1-4]-\d{2}$/.test(r['표시코드']))) throw new Error('R 계획에 R1~R4 가 아닌 번호가 있습니다');
let plan = prev;
if (FINAL) {
  if (!arg('plan')) throw new Error('--round final 에는 --plan <최종 배치 csv> 가 필요합니다');
  plan = readCsv(resolve(arg('plan')));
  checkPlan(plan, '최종 계획');
  const banned = plan.filter(r => /^(R[1-4]|[A-E])-/.test(r['표시코드']));
  if (banned.length) throw new Error(`최종 계획에 R1~R4(리허설 임시) · A~E(예시) 번호가 있습니다: ${banned.map(r => r['문서번호']).join(', ')}`);
  const byDoc = new Map(prev.map(r => [r['문서번호'], r]));
  const moved = plan.filter(r => byDoc.get(r['문서번호'])?.['부스ID'] !== r['부스ID']);
  if (moved.length) throw new Error(`부스 ID 가 R 계획과 다릅니다(같은 부스 · 같은 QR 이어야 함): ${moved.map(r => r['문서번호']).join(', ')}`);
}
const prevCode = new Map(prev.map(r => [r['문서번호'], r['표시코드']]));

// 학교마다 한 줄 — 학교명에 쉼표로 여러 학교가 있으면(공동 운영) 학교마다 같은 QR 사본 1장
const rows = [];
for (const p of plan) {
  const schools = p['학교명'].split(/\s*,\s*/).filter(Boolean);
  schools.forEach((school, i) => rows.push({
    doc: p['문서번호'], school, code: p['표시코드'], prev: prevCode.get(p['문서번호']), name: p['부스명'],
    copies: schools.length > 1 ? `같은 QR 사본 ${i + 1}/${schools.length}` : '1',
    partners: schools.filter(s => s !== school),
  }));
}
const joint = [...new Set(rows.filter(r => r.partners.length).map(r => r.doc))].map(d => `${d} ${rows.filter(r => r.doc === d).length}장`);
const countLine = `${rows.length}줄(84곳${joint.length ? ' · ' + joint.join(' · ') : ''})`;

const NOTICE = FINAL
  ? '최종 부스 번호 카드입니다. QR(열쇠)은 R 카드와 같습니다 — 새 카드를 드리면서 이전 R 번호 카드를 받아 \'R 카드 회수\' 칸에 적습니다. R 카드를 찾을 수 없으면 분실로 보고 QR 교체를 판단합니다(GATE-4A-FIELD-OPS §3).'
  : 'R1~R4 는 리허설용 임시 번호입니다 — 최종 행사 위치가 아닙니다. 최종 배치가 정해지면 같은 QR 로 번호만 바뀐 카드를 다시 드리고, 그때 이 R 카드는 회수(또는 폐기 확인)합니다.';

// ── 엑셀 ──
const FONT = '맑은 고딕';
const C = { ink: 'FF1F2430', muted: 'FF6B7280', line: 'FFD9DCE3', head: 'FFF1F2F5', input: 'FFFFF2CC', accent: 'FFB42318' };
const thin = { style: 'thin', color: { argb: C.line } };
const box = { top: thin, left: thin, bottom: thin, right: thin };
const font = (o = {}) => ({ name: FONT, size: 10, color: { argb: C.ink }, ...o });

const pre = FINAL
  ? [['문서 번호', 9, r => r.doc], ['학교명', 18, r => r.school], ['부스 번호', 10, r => r.code], ['이전 임시 번호', 10, r => r.prev], ['부스명', 46, r => r.name], ['카드 판', 15, () => `발급 ${issued}`], ['장 수', 15, r => r.copies]]
  : [['문서 번호', 9, r => r.doc], ['학교명', 18, r => r.school], ['임시 번호', 10, r => r.code], ['부스명', 46, r => r.name], ['카드 판', 15, () => `발급 ${issued}`], ['장 수', 15, r => r.copies]];
const inputs = [['전달 방법', 13], ['전달일', 11], ['받은 분(성명 · 직위)', 18], ['수령 확인(서명/회신)', 16], [FINAL ? 'R 카드 회수' : '회수', 11], ['비고(재인쇄 · 교체)', 22]];
const head = [...pre.map(c => c[0]), ...inputs.map(c => c[0])];
const nPre = pre.length, nAll = head.length;
const colOf = h => head.indexOf(h) + 1;
const lastCol = String.fromCharCode(64 + nAll);

const wb = new ExcelJS.Workbook();
wb.creator = '행사 운영 포털';
const ws = wb.addWorksheet('수령 확인');
ws.columns = [...pre, ...inputs].map(c => ({ width: c[1] }));
ws.getCell('A1').value = FINAL
  ? `운영자 카드 배부 · 수령 확인표 — 최종 부스 번호(같은 QR 재인쇄) · ${countLine}`
  : `운영자 카드 배부 · 수령 확인표 — 리허설용 임시 번호(R1~R4 · 최종 행사 위치 아님) · ${countLine}`;
ws.getCell('A1').font = font({ size: 13, bold: true });
ws.getCell('A2').value = '노란 칸만 적습니다. QR 원문 · 운영자 화면 주소 · 카드의 열쇠 끝자리 글자는 이 표에 적지 않습니다(사진 공유 금지). 교사 개인 연락처도 적지 않습니다.';
ws.getCell('A2').font = font({ color: { argb: C.muted } });
ws.getCell('A3').value = FINAL
  ? `카드 판: 열쇠를 바꾸지 않았으므로 R 카드와 같은 '발급 ${issued}' 입니다 — R 카드와는 카드에 찍힌 번호로 구분합니다. 그 사이 교체한 부스는 새 발급 일시로 고치고 비고에 적습니다.`
  : `카드 판: 카드 아래쪽 '발급 ${issued}' 과 같은지 확인. 분실 · 유출로 교체하면 새 발급 일시로 고치고 비고에 사유를 적습니다. 최종 배치 뒤 같은 QR 로 다시 인쇄한 카드는 새 표(최종 회차)로 관리합니다.`;
ws.getCell('A3').font = font({ color: { argb: C.muted } });
ws.getCell('A4').value = NOTICE;
ws.getCell('A4').font = font({ bold: true, color: { argb: C.accent } });
head.forEach((h, i) => { const c = ws.getCell(5, i + 1); c.value = h; c.font = font({ bold: true }); c.border = box; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.head } }; });
ws.getRow(5).height = 30;
const centered = new Set(['문서 번호', '임시 번호', '부스 번호', '이전 임시 번호', '장 수']);
rows.forEach((r, i) => {
  const rr = 6 + i;
  pre.forEach(([h, , get], k) => { const c = ws.getCell(rr, k + 1); c.value = get(r); c.border = box; c.font = font({ color: { argb: h === '카드 판' || h === '장 수' || h === '이전 임시 번호' ? C.muted : C.ink } }); if (centered.has(h)) c.alignment = { horizontal: 'center' }; });
  for (let k = nPre + 1; k <= nAll; k++) { const c = ws.getCell(rr, k); c.border = box; c.font = font(); c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.input } }; }
});
for (let rr = 6; rr < 6 + rows.length; rr++) {
  ws.getCell(rr, colOf('전달 방법')).dataValidation = { type: 'list', allowBlank: true, formulae: ['"교육청 경유,직접 전달,당일 운영본부,기타"'] };
  ws.getCell(rr, colOf(FINAL ? 'R 카드 회수' : '회수')).dataValidation = { type: 'list', allowBlank: true, formulae: ['"회수,폐기 확인,미회수"'] };
}
ws.autoFilter = `A5:${lastCol}${5 + rows.length}`;
ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 5, showGridLines: false }];
ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '5:5' };

mkdirSync(outDir, { recursive: true });
const xlsxFile = join(outDir, `운영자카드-수령확인표-${TAG}.xlsx`);
await wb.xlsx.writeFile(xlsxFile);

// ── 봉투 안내 쪽지(A4 한 장에 8장 · 점선대로 잘라 봉투 겉면에 붙이거나 카드와 함께 넣음) ──
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slip = r => `<section class="slip" data-doc="${esc(r.doc)}" data-code="${esc(r.code)}">
  <p class="band${FINAL ? '' : ' band--temp'}">${FINAL ? '최종 부스 번호 · 행사 당일 위치' : '리허설용 임시 번호 · 최종 행사 위치 아님'}</p>
  <p class="code">${esc(r.code)}${FINAL ? ` <span class="was">이전 임시 번호 ${esc(r.prev)}</span>` : ''}</p>
  <p class="name">${esc(r.name)}</p>
  <p class="org">${esc(r.school)}${r.partners.length ? ` <span>· ${esc(r.partners.join(', '))} 와 공동 운영</span>` : ''}</p>
  <p class="meta">${esc(r.doc)} · 운영자 카드 1장${r.partners.length ? `(${esc(r.copies)})` : ''}</p>
  <p class="note">${FINAL
    ? '행사 당일 이 번호로 안내됩니다. 먼저 받은 R 번호 카드는 운영본부에 돌려주세요(QR 은 같습니다).'
    : 'R1~R4 는 리허설용 임시 번호 · 실제 행사 위치가 아닙니다. 최종 배치 뒤 같은 QR 로 번호만 바꾼 카드를 다시 드립니다.'}</p>
  <p class="foot"><span>카드 QR 은 사진 · 공유 금지</span><span>운영본부 〔　　　　　〕</span></p>
</section>`;
const pages = [];
for (let i = 0; i < rows.length; i += 8) pages.push(`<div class="sheet">\n${rows.slice(i, i + 8).map(slip).join('\n')}\n</div>`);
const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>봉투 안내 쪽지 ${TAG}</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: #1f2430; font-family: 'Pretendard', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  p { margin: 0; }
  .howto { max-width: 190mm; margin: 8mm auto 4mm; font-size: 10pt; line-height: 1.5; color: #4b5263; }
  .howto b { color: #1f2430; }
  .sheet { width: 190mm; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 68mm; break-after: page; }
  .sheet:last-child { break-after: auto; }
  .slip { border: 1px dashed #b8bdc8; margin: -0.5px; padding: 4mm 5.5mm 3.5mm; display: flex; flex-direction: column; overflow: hidden; break-inside: avoid; }
  .slip > * { flex-shrink: 0; }
  .band { align-self: flex-start; font-size: 8.5pt; font-weight: 700; line-height: 1.3; color: #fff; background: #1f2430; padding: .8mm 2.2mm; letter-spacing: .01em; }
  .band--temp { background: #b42318; }
  .code { font-size: 24pt; font-weight: 800; line-height: 1; margin-top: 2.2mm; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
  .was { font-size: 9pt; font-weight: 600; color: #6b7280; letter-spacing: 0; margin-left: 2mm; }
  .name { font-size: 10pt; font-weight: 600; line-height: 1.3; margin-top: 1.8mm; }
  .org { font-size: 9pt; line-height: 1.35; margin-top: 1mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .org span, .meta { color: #6b7280; }
  .meta { font-size: 8pt; line-height: 1.35; margin-top: .4mm; }
  .note { margin-top: auto; padding-top: 1.6mm; border-top: 1px solid #d9dce3; font-size: 8.2pt; line-height: 1.4; }
  .foot { display: flex; justify-content: space-between; gap: 3mm; margin-top: 1mm; font-size: 7.5pt; line-height: 1.3; color: #6b7280; white-space: nowrap; }
  @media print { .howto { display: none; } .sheet { margin: 0; } }
</style>
</head>
<body>
<div class="howto">
  <p><b>봉투 안내 쪽지 — ${FINAL ? '최종 부스 번호' : '리허설용 임시 번호(R1~R4)'} · ${rows.length}장 · A4 ${pages.length}쪽</b></p>
  <p>A4 · 배율 100% 로 인쇄 → 점선대로 잘라 학교별 봉투 겉면에 붙이거나 카드와 함께 넣습니다. 이 쪽지에는 QR · 운영자 화면 주소 · 열쇠 끝자리가 없습니다. 이 안내 글은 인쇄되지 않습니다.</p>
</div>
${pages.join('\n')}
</body>
</html>
`;
const htmlFile = join(outDir, `봉투안내-${TAG}.html`);
writeFileSync(htmlFile, html);

console.log('작성:', xlsxFile, `· ${rows.length}줄`);
console.log('작성:', htmlFile, `· 쪽지 ${rows.length}장 · A4 ${pages.length}쪽`);
console.log(`회차 ${TAG} · 공동 운영 ${joint.join(' / ') || '없음'} · 첫 줄 ${[rows[0].doc, rows[0].school, rows[0].code, rows[0].name].join(' | ')}`);
