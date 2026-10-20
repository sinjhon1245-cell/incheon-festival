/* 운영자 카드 수령 확인표 · 봉투 안내 쪽지 점검(로컬 · 읽기만)
   R 회차(plan-R.csv 그대로)와 최종 회차(가짜 최종 계획)를 임시 폴더에 만들어 봅니다. out/placement 는 건드리지 않습니다.
   쓰는 법: node scripts/booth-data/test-card-receipt.mjs --xlsx-lib <exceljs 설치 폴더> */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readCsv, writeCsv } from './lib/csv.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const LIB = resolve(arg('xlsx-lib'));
const ExcelJS = createRequire(join(LIB, 'package.json'))('exceljs');
const BUILD = join(HERE, 'build-card-receipt.mjs');
const planR = readCsv(join(HERE, 'out', 'gate4r', 'plan-R.csv'));
const TMP = mkdtempSync(join(tmpdir(), 'card-receipt-'));

let pass = 0, fail = 0;
const t = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !info ? '' : ' — ' + info}`); };
const run = (...a) => spawnSync(process.execPath, [BUILD, '--xlsx-lib', LIB, ...a], { encoding: 'utf8' });
async function sheet(file) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('수령 확인');
  const val = (r, c) => { const v = ws.getCell(r, c).value; return v == null ? '' : String(v); };
  const head = []; for (let c = 1; c <= ws.columnCount; c++) head.push(val(5, c));
  const rows = []; for (let r = 6; val(r, 1); r++) rows.push(Object.fromEntries(head.map((h, i) => [h, val(r, i + 1)])));
  const all = []; ws.eachRow({ includeEmpty: false }, row => row.eachCell(c => all.push(String(c.value ?? ''))));
  return { ws, val, head, rows, all };
}
// 열쇠 · 주소처럼 보이는 것: 주소 · 해시 경로 · '끝자리 XXXX' · 20자 넘는 base64url 덩어리
const leaky = s => /https?:|\/live\/|#k=|#t=|끝자리\s*[A-Za-z0-9_-]{4}|[A-Za-z0-9_-]{20,}/.test(s);

// ── 1. R 회차 ──
const outR = join(TMP, 'R');
let p = run('--out-dir', outR);
t('R-01 R 회차 만들기 성공', p.status === 0, p.stderr.slice(0, 300));
const R = await sheet(join(outR, '운영자카드-수령확인표-R.xlsx'));
t('R-02 칸 12개 · 순서 그대로', R.head.join('|') === '문서 번호|학교명|임시 번호|부스명|카드 판|장 수|전달 방법|전달일|받은 분(성명 · 직위)|수령 확인(서명/회신)|회수|비고(재인쇄 · 교체)', R.head.join('|'));
t('R-03 85줄(84곳 + S04 한 줄 더)', R.rows.length === 85, String(R.rows.length));
const docsR = new Set(R.rows.map(r => r['문서 번호']));
t('R-04 S01~S84 모두 · 번호 · 부스명이 plan-R.csv 와 같음', docsR.size === 84 && planR.every(pr => R.rows.filter(r => r['문서 번호'] === pr['문서번호']).every(r => r['임시 번호'] === pr['표시코드'] && r['부스명'] === pr['부스명'])));
const s04 = R.rows.filter(r => r['문서 번호'] === 'S04');
t('R-05 S04 두 줄: 인천연일학교 1/2 · 인천청선학교 2/2 · 같은 R1-04', s04.length === 2 && s04[0]['학교명'] === '인천연일학교' && s04[1]['학교명'] === '인천청선학교' && s04[0]['장 수'] === '같은 QR 사본 1/2' && s04[1]['장 수'] === '같은 QR 사본 2/2' && s04.every(r => r['임시 번호'] === 'R1-04'));
t('R-06 S04 말고는 장 수 1 · 학교명에 쉼표 없음', R.rows.filter(r => r['문서 번호'] !== 'S04').every(r => r['장 수'] === '1' && !r['학교명'].includes(',')));
t('R-07 모든 번호가 R1~R4-01~21', R.rows.every(r => /^R[1-4]-(0[1-9]|1\d|2[01])$/.test(r['임시 번호'])));
t("R-08 카드 판은 모두 '발급 10.16 11:26'", R.rows.every(r => r['카드 판'] === '발급 10.16 11:26'));
t('R-09 제목에 리허설용 임시 번호 · 최종 행사 위치 아님 · 85줄', /리허설용 임시 번호\(R1~R4 · 최종 행사 위치 아님\)/.test(R.val(1, 1)) && /85줄\(84곳 · S04 2장\)/.test(R.val(1, 1)), R.val(1, 1));
t('R-10 4행 안내: 최종 행사 위치가 아님 · 같은 QR 로 번호만 바뀐 카드 · R 카드 회수', /최종 행사 위치가 아닙니다/.test(R.val(4, 1)) && /같은 QR 로 번호만 바뀐 카드/.test(R.val(4, 1)) && /회수/.test(R.val(4, 1)));
t('R-11 2행 안내: QR 원문 · 주소 · 끝자리는 적지 않음', /QR 원문 · 운영자 화면 주소 · 카드의 열쇠 끝자리 글자는 이 표에 적지 않습니다/.test(R.val(2, 1)));
t('R-12 표 어디에도 주소 · 열쇠 · 끝자리 모양 글자 없음', !R.all.some(leaky), R.all.filter(leaky).slice(0, 2).join(' / '));
t('R-13 QR · 주소 · 끝자리 칸 없음', !R.head.some(h => /QR|주소|끝자리|열쇠|URL|토큰/i.test(h)));
const dvR = [R.ws.getCell(6, 7).dataValidation, R.ws.getCell(90, 11).dataValidation];
t('R-14 전달 방법 · 회수 목록(첫 줄 · 마지막 줄)', dvR[0]?.formulae?.[0] === '"교육청 경유,직접 전달,당일 운영본부,기타"' && dvR[1]?.formulae?.[0] === '"회수,폐기 확인,미회수"');
const htmlR = readFileSync(join(outR, '봉투안내-R.html'), 'utf8');
const slipsR = [...htmlR.matchAll(/<section class="slip" data-doc="([^"]+)" data-code="([^"]+)">([\s\S]*?)<\/section>/g)];
t('R-15 쪽지 85장 · A4 11쪽(한 쪽 8장)', slipsR.length === 85 && (htmlR.match(/<div class="sheet">/g) || []).length === 11);
t('R-16 쪽지마다 빨간 띠 \'리허설용 임시 번호 · 최종 행사 위치 아님\' · \'실제 행사 위치가 아닙니다\'', slipsR.every(m => m[3].includes('<p class="band band--temp">리허설용 임시 번호 · 최종 행사 위치 아님</p>') && m[3].includes('실제 행사 위치가 아닙니다')));
t('R-17 쪽지 번호 · 순서가 표와 같음', slipsR.map(m => m[1] + m[2]).join() === R.rows.map(r => r['문서 번호'] + r['임시 번호']).join());
const s04Slips = slipsR.filter(m => m[1] === 'S04').map(m => m[3]);
t('R-18 S04 쪽지 2장: 학교마다 · 상대 학교와 공동 운영 · 사본 1/2 · 2/2', s04Slips.length === 2 && /인천연일학교 <span>· 인천청선학교 와 공동 운영/.test(s04Slips[0]) && /같은 QR 사본 1\/2/.test(s04Slips[0]) && /인천청선학교 <span>· 인천연일학교 와 공동 운영/.test(s04Slips[1]) && /같은 QR 사본 2\/2/.test(s04Slips[1]));
t('R-19 쪽지에 주소 · 스크립트 · 그림 · 열쇠 모양 글자 없음', !/https?:|<script|<img|<svg|data-qr|#k=/.test(htmlR) && !slipsR.some(m => leaky(m[3].replace(/<[^>]+>/g, ' '))));
t('R-20 인쇄 설정: A4 · 여백 10mm · 색 그대로 · 안내 글은 인쇄 안 함', /@page \{ size: A4; margin: 10mm; \}/.test(htmlR) && /print-color-adjust: exact/.test(htmlR) && /@media print \{ \.howto \{ display: none; \}/.test(htmlR));

// ── 2. 최종 회차(가짜 최종 계획: 같은 부스 · 새 구역 SW · AI · MK · DT) ──
const zones = ['SW', 'AI', 'MK', 'DT'];
const fake = planR.map((r, i) => ({ ...r, 구역: zones[i % 4], 번호: String(Math.floor(i / 4) + 1), 표시코드: `${zones[i % 4]}-${String(Math.floor(i / 4) + 1).padStart(2, '0')}` }));
const COLS = Object.keys(planR[0]);
const writePlan = (name, rows) => { const f = join(TMP, name); writeCsv(f, COLS, rows.map(r => COLS.map(k => r[k]))); return f; };
const outF = join(TMP, 'F');
p = run('--round', 'final', '--plan', writePlan('final.csv', fake), '--out-dir', outF);
t('F-01 최종 회차 만들기 성공', p.status === 0, p.stderr.slice(0, 300));
const F = await sheet(join(outF, '운영자카드-수령확인표-최종.xlsx'));
t('F-02 칸 13개: 부스 번호 · 이전 임시 번호 · R 카드 회수', F.head.join('|') === '문서 번호|학교명|부스 번호|이전 임시 번호|부스명|카드 판|장 수|전달 방법|전달일|받은 분(성명 · 직위)|수령 확인(서명/회신)|R 카드 회수|비고(재인쇄 · 교체)', F.head.join('|'));
const fakeBy = new Map(fake.map(r => [r['문서번호'], r])), rBy = new Map(planR.map(r => [r['문서번호'], r]));
t('F-03 85줄 · 새 번호와 이전 R 번호가 문서 번호마다 맞음', F.rows.length === 85 && F.rows.every(r => r['부스 번호'] === fakeBy.get(r['문서 번호'])['표시코드'] && r['이전 임시 번호'] === rBy.get(r['문서 번호'])['표시코드']));
t('F-04 S04 두 줄 · SW-01 · 이전 R1-04', F.rows.filter(r => r['문서 번호'] === 'S04').length === 2 && F.rows.filter(r => r['문서 번호'] === 'S04').every(r => r['이전 임시 번호'] === 'R1-04' && r['부스 번호'] === fakeBy.get('S04')['표시코드']));
t('F-05 제목 · 4행: 최종 부스 번호 · 같은 QR · R 카드 회수', /최종 부스 번호\(같은 QR 재인쇄\) · 85줄/.test(F.val(1, 1)) && /QR\(열쇠\)은 R 카드와 같습니다/.test(F.val(4, 1)) && /R 카드 회수/.test(F.val(4, 1)));
t('F-06 R 카드 회수 목록', F.ws.getCell(6, 12).dataValidation?.formulae?.[0] === '"회수,폐기 확인,미회수"');
t('F-07 표에 주소 · 열쇠 모양 글자 없음', !F.all.some(leaky));
const htmlF = readFileSync(join(outF, '봉투안내-최종.html'), 'utf8');
const slipsF = [...htmlF.matchAll(/<section class="slip" data-doc="([^"]+)" data-code="([^"]+)">([\s\S]*?)<\/section>/g)];
t('F-08 최종 쪽지 85장 · 검은 띠 \'최종 부스 번호\' · 이전 임시 번호 · R 카드 돌려주기 · 임시 띠 없음', slipsF.length === 85 && slipsF.every(m => m[3].includes('<p class="band">최종 부스 번호 · 행사 당일 위치</p>') && m[3].includes(`이전 임시 번호 ${rBy.get(m[1])['표시코드']}`) && m[3].includes('R 번호 카드는 운영본부에 돌려주세요')) && !htmlF.includes('class="band band--temp"'));

// ── 3. 최종 회차가 멈춰야 하는 경우 ──
const bad = (name, rows, re, extra = []) => { const q = run('--round', 'final', '--plan', writePlan(name, rows), '--out-dir', join(TMP, 'X'), ...extra); t(`X ${name}`, q.status !== 0 && re.test(q.stderr), (q.stderr.match(/Error: .*/) || [q.status])[0]); };
bad('R 번호 남음', fake.map((r, i) => i === 10 ? { ...r, 표시코드: 'R2-05' } : r), /R1~R4\(리허설 임시\) · A~E\(예시\) 번호가 있습니다: S11/);
bad('예시 구역 번호', fake.map((r, i) => i === 0 ? { ...r, 표시코드: 'C-03' } : r), /번호가 있습니다: S01/);
bad('부스 ID 바뀜', fake.map((r, i) => i === 5 ? { ...r, 부스ID: '00000000-0000-5000-8000-000000000000' } : r), /부스 ID 가 R 계획과 다릅니다.*S06/);
bad('83줄', fake.slice(1), /84줄이 아닙니다\(83줄\)/);
bad('번호 겹침', fake.map((r, i) => i === 1 ? { ...r, 표시코드: fake[0]['표시코드'] } : r), /겹칩니다/);
bad('빈 학교명', fake.map((r, i) => i === 2 ? { ...r, 학교명: '' } : r), /빈 칸/);
const q = run('--round', 'final', '--out-dir', join(TMP, 'X'));
t('X --plan 없이 최종 회차', q.status !== 0 && /--plan/.test(q.stderr));
const q2 = run('--round', 'last', '--out-dir', join(TMP, 'X'));
t('X 모르는 회차 이름', q2.status !== 0 && /--round 는 R 또는 final/.test(q2.stderr));

// ── 4. 스크립트가 열쇠를 읽지 않음 ──
const src = readFileSync(BUILD, 'utf8');
t('S-01 만드는 스크립트는 계획 csv 만 읽음(DB · 열쇠 함수 · 네트워크 없음)', !/booth_access|admin_booth_access|supabase|fetch\(|https?:\/\//.test(src));

rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} 통과`);
process.exit(fail ? 1 : 0);
