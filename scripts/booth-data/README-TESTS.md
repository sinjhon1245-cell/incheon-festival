# scripts/booth-data — 로컬 회귀 시험

부스 화면(운영자 · 관람객 · QR · PIN 관리)과 DB 함수를 **로컬 복제 DB(PGlite)와 jsdom** 위에서 견주는 시험입니다.
어떤 시험도 Production 에 접속하지 않습니다. 열쇠 · PIN 은 복제 DB 안의 가짜 값이고, 결과에는 개수와 참 · 거짓만 적습니다.

이 브랜치에는 **코드만** 있습니다(시험 · 도우미 · 복제 DB SQL · `supabase/migration-booth-preview.sql` — Gate 3-C 에서 Production 에 적용했지만 main 에는 없는 사전 안내 migration 을 시험이 복제 DB 에 다시 적용하므로 함께 둠). 시험이 읽는 운영 데이터(`out/`)는 git 에 넣지 않습니다(`.gitignore`).

## 1. 준비물(한 번)

시험 폴더 밖, 아무 빈 폴더에 따로 설치합니다(저장소에 `node_modules` 를 두지 않음). Node 18 이상.

```bash
mkdir -p ~/booth-test-deps/pglite ~/booth-test-deps/jsdom ~/booth-test-deps/qrlib
cd ~/booth-test-deps/pglite && npm init -y >/dev/null && npm i @electric-sql/pglite@0.4.4
cd ~/booth-test-deps/jsdom  && npm init -y >/dev/null && npm i jsdom@30.1.1
cd ~/booth-test-deps/qrlib  && npm init -y >/dev/null && npm i qrcodejs@1.0.0 jsqr@1.4.0
```

## 2. 운영 데이터(git 밖 — 직접 옮김)

아래 파일을 `scripts/booth-data/out/` 아래 같은 자리에 둡니다. Production 스냅샷 · 명단 · 열쇠 발급 SQL 이 들어 있어
**공개 저장소 · 채팅 · 메일에 올리지 않고**, 기존 컴퓨터의 `out/` 에서 USB 등으로 직접 옮깁니다.

| 파일 | 쓰는 시험 |
|---|---|
| `out/prod-snapshot-YYYYMMDD.csv`(가장 최근 하나) | 모든 복제 DB 시험 |
| `out/staging/manifest.csv` | 모든 복제 DB 시험 |
| `out/gate4r/plan-R.csv` · `out/gate4r/T-0*.sql` | 리허설 · 공통 PIN · 운영자 · QR · PIN 관리 · Gate 4-R |
| `out/gate3c/C-0*.sql` · `out/gate3c/Q-0*.sql` · `out/gate3c/targets.json` | 위와 같음 · 관람객 · QR 종단 |

## 3. 화면 코드(작업 폴더)

시험은 화면 코드를 **고치지 않고** 다른 작업 폴더에서 읽습니다. 같은 저장소에서 worktree 로 만듭니다.

```bash
git fetch origin
git worktree add ../incheon-festival-live origin/booth-live   # 관람객 · 운영자 화면
git worktree add ../incheon-festival-main origin/main         # QR · PIN 관리 · supabase SQL
```

## 4. 실행(저장소 루트에서)

```bash
D=~/booth-test-deps; A="--pglite-dir $D/pglite --jsdom-dir $D/jsdom"
node --max-old-space-size=8192 scripts/booth-data/test-ctrl-school.mjs $A --ctrl-dir ../incheon-festival-live --live-dir <학교명 이전 booth-live 7ebf536 작업 폴더> --pin-dir ../incheon-festival-main
node --max-old-space-size=8192 scripts/booth-data/test-rehearsal.mjs $A --main-dir ../incheon-festival-main --live-dir ../incheon-festival-live
node --max-old-space-size=8192 scripts/booth-data/test-rehearsal-pin.mjs $A --pin-dir ../incheon-festival-main --web-dir ../incheon-festival-main --live-dir ../incheon-festival-live --old-dir <main 421f656 작업 폴더>
node --max-old-space-size=8192 scripts/booth-data/test-printqr-regression.mjs $A --new ../incheon-festival-main/print-qr.html
node --max-old-space-size=8192 scripts/booth-data/test-visitor-preview.mjs $A --live-dir ../incheon-festival-live
node --max-old-space-size=8192 scripts/booth-data/test-qr-e2e.mjs $A --live-dir ../incheon-festival-live --qr-dir $D/qrlib
node --max-old-space-size=8192 scripts/booth-data/test-gate4r.mjs $A --main-dir ../incheon-festival-main --live-dir ../incheon-festival-live --qr-dir $D/qrlib
node --max-old-space-size=8192 scripts/booth-data/test-reset-removed.mjs $A --main-dir ../incheon-festival-main
node --max-old-space-size=8192 scripts/booth-data/test-pin-status.mjs $A --main-dir ../incheon-festival-main
node scripts/booth-data/test-example-page.mjs --live-dir ../incheon-festival-live --main-dir ../incheon-festival-main --pptr-dir <pptr/node_modules/puppeteer-core 가 든 폴더> [--base-ref 0e065b3] [--expect-changed "a,b,…"]
```

- `test-example-page.mjs`(/example/ 화면 안내): booth-live 작업 폴더를 `sh live/build.sh` 로 빌드해 Edge(puppeteer-core)로 엽니다.
  두 단추가 실제 운영 화면(`/` · `/booth-ctrl`, `?demo` 없음)을 여는지 · 공개 PIN 이 운영자 단추 위 PIN 줄(`.pinhint`) 한 곳뿐인지
  (값 = booth-ctrl 의 공통 PIN 값 · 그 밖의 6자리 숫자 없음 · 예전 큰 PIN 상자 `.pinnote` 없음) · 줄에 적은 사용 기간이 main 의 리허설 SQL 기한보다
  늦지 않은지 · 23:00 초기화는 `booth_live` 만 지우고 페이지가 초기화로 PIN 이 끝난다고 말하지 않는지 · PIN 줄(한 줄 구조 · 줄 전체 바탕 · 테두리 · 여백 없음 ·
  390 · 1440 한 줄 · 높이 = 숫자 배지 · 숫자 배지 굵게 · 자간 · 모서리가 살짝 둥근 직사각형(4~8px · 그림자 · 그라데이션 없음) · 은은한 보라 바탕 · 테두리 ·
  대비 7:1 · 라벨이 사용 기간보다 굵고 진함 · 크기 390: 숫자 20~22px · 배지 32px 이하 / 1440: 라벨 17~18px 굵게 · 숫자 28~30px · 배지 44~48px · 기간 15~16px ·
  숫자가 라벨의 1.5배 이상) · 1440 은 운영자 미리보기와 단추 사이 남는 높이의 가운데(위아래 여백 차 4px 이하 · 20~30px) · 두 단추 위 · 아래 끝과 크기 같음 ·
  390 은 미리보기 아래 16~24px · 단추 위 8~24px · 미리보기 말이 지금 두 화면에 있는지 ·
  배포본에서 `--expect-changed`(쉼표, 자산 지문 뗀 이름 · 기본 example/ 둘) 말고는 `--base-ref` 빌드와 바이트 같은지 봅니다.
  UI 최종(PR #21, e314ee8)은 `--base-ref 0e065b3 --expect-changed "assets/booth-ctrl.css,assets/visitor.css,booth-ctrl.html,example/example.css,index.html"`.
- `test-rehearsal.mjs` D1(UI 최종): 행사 전 운영자 화면에 값이 보이고 현재 대기 카드 아래 리허설 안내가 없어야 합니다(리허설 처리는 D2 저장 알림이 확인).
- `test-ctrl-school.mjs` S1-6 · S6-7(UI 최종): 운영자 CSS 는 UI 최종 규칙 16개(현재 대기 세 단 · 운영 상태 위 맞춤 · 860px 이상 subgrid 줄 격자)를
  선언 · 순서까지 못 박고 그 밖의 규칙은 앞 판과 하나씩 같아야 하며, booth-ctrl.html 은 리허설 안내를 뺀 정해 둔 여섯 줄만 더 바뀔 수 있습니다. 실제 관람객 화면에는 시험용 스냅샷(`GET /api/live-snapshot`, 부스 A-01 하나)을
  돌려주고, Supabase 는 사전 확인(OPTIONS)만 통과시키고 실제 요청은 세고 막습니다 — 두 실제 화면을 열기만 했을 때 요청이 조회뿐인지
  (관람객 `GET /api/live-snapshot` · 운영자 Supabase GET settings · zones · booths, RPC · 로그인 없음) 봅니다. 행사 명칭은 `--official`(기본 settings.event_title 값).

- `test-reset-removed.mjs`(A-1): 인쇄 화면에서 ‘실시간 값 모두 지우기’ 를 뺀 판 기준. 예전 판은 `--old-ref`(기본 6a34872)로 git 에서 읽습니다.
  D4-3 은 README 가 ‘단추만 뺐고 DB 함수 · 관리자 RPC 실행 권한은 그대로’ 라고 적는지, D4-4 는 복제 DB 에서 그 권한이 그대로인지
  (authenticated 실행 가능 · anon 42501 · 관리자가 아닌 계정 거절 · 관리자 RPC 는 지금도 전체를 지움) 봅니다.
- `test-pin-status.mjs`(A-4): 리허설 공통 PIN · 개별 PIN 표시가 서버 판정(`private.booth_common_pin_target` + PIN 보조 로그인 스위치)과 같은지 —
  복제 DB 의 공통 PIN 판정 함수에만 시험 시계를 겁니다(`lib/ui-harness.mjs`). 관리자 부스 관리는 포털 표가 없어 협의용 예시로 봅니다.
  경계: U5 · B1–B3 은 PIN 보조 로그인 설정을 못 읽을 때(`hooks.fromError('settings')`) ‘사용 가능’ 수를 말하지 않는지,
  B4 · B5 는 끝나기 27시간 전부터 열어 둔 QR · PIN 관리가 23:00 에 바뀌는지(1시간 넘는 타이머를 모아 두고 화면 시계를 옮겨 부름 —
  `openPage({ longTimers: true })` · `w.__setNow`), B6 은 부스 운영 현황이 화면 복귀 · 주기 읽기로 바뀌는지 봅니다.

- 비교용 옛 판(7ebf536 · 421f656 · 56c3138 · 6fd46d8)은 `git worktree add <폴더> <커밋>` 으로 만들거나, 시험이 git 으로 직접 읽습니다.
- 결과 보고서는 `out/rehearsal/` · `out/gate3c/` · `out/gate4r/` 에 씁니다(git 제외).
- 리허설 시험의 A · B 묶음은 DB 함수가 행사 첫날(2026-11-06 KST) 전에만 열리므로 그 전에만 그대로 통과합니다.
- 2026-10-20 결과(1차 UI 수정 병합 전): 운영자 29 · 리허설 82 · QR · PIN 관리 28 · 관람객 48 · 공통 PIN 61 · QR 종단 30 · Gate 4-R 88 — 모두 통과.
- 2026-10-21 결과(A-1 #15 026b1e4 + A-4 #16 6635197 합친 판 · booth-live 63d260b): 전체 지우기 제거 15 · 공통 · 개별 PIN 표시 32 ·
  QR · PIN 관리 28 · 공통 PIN 61 · 리허설 82 · Gate 4-R 88 · 운영자 29 · 관람객 48 · QR 종단 30 — 413 / 413 통과.
  보완 전 커밋에서는 새 항목만 실패(A-4 22351b3 26 / 32 · A-1 a225f25 14 / 15).
- 2026-10-21 결과(/example/ PR #17 3b9d1a3): 화면 안내 11 · 관람객 48 · 운영자 29 · 공통 PIN 61 · QR 종단 30 — 179 / 179 통과.
  바꾸기 전 판(63d260b)에서는 새 항목만 실패(4 / 11).
- 2026-10-21 결과(/example/ 관람객 실제 화면 링크 0f47c88 · 기준 3b9d1a3): 화면 안내 12 · 관람객 48 · 운영자 29 · 공통 PIN 61 · QR 종단 30 — 180 / 180 통과.
  바꾸기 전 판(3b9d1a3)에서는 링크 · 문구 · 변경 · 새 탭 연결 항목만 실패(8 / 12 — X2 · X2b · X7 · X9).
- 2026-10-21 결과(/example/ 두 단추 실제 화면 · 리허설 공통 PIN 안내 3212ef7 · 기준 0f47c88 · main f3b61b1): 화면 안내 13 · 관람객 48 · 운영자 29 ·
  공통 PIN 61 · QR 종단 30 — 181 / 181 통과. 바꾸기 전 판(0f47c88)에서는 PIN 안내 · 링크 · 문구 · 변경 · 화면 · 새 탭 항목만 실패(5 / 13).
- 2026-10-21 결과(/example/ PIN 작은 보조 줄 3e575d2 · 기준 3212ef7): 화면 안내 13 · 관람객 48 · 운영자 29 · 공통 PIN 61 · QR 종단 30 — 181 / 181 통과.
  바꾸기 전 판(3212ef7 · 큰 PIN 상자)에서는 PIN 보조 줄 · 변경 · 화면 항목만 실패(9 / 13 — X1 · X1b · X7 · X8).
- 2026-10-21 결과(/example/ PIN 보조 줄 문구 “운영자 공통 PIN 123456 · 11월 4일까지 사용” 0e065b3 · 기준 3212ef7): 181 / 181 통과(13 · 48 · 29 · 61 · 30).
  바꾸기 전 문구(3e575d2)에서는 문구 항목만 실패(12 / 13 — X1b). ‘N월 N일까지 사용’ 은 운영상 사용 기간(만료일 아님) — 서버 기한보다 늦지 않은지만 봅니다.
- 2026-10-21 결과(UI 최종 a803ed7 · 기준 0e065b3 · main f3b61b1): 화면 안내 13 · 관람객 48 · 운영자 29 · 리허설 82 · 공통 PIN 61 · Gate 4-R 88 ·
  QR 종단 30 · 공통 · 개별 PIN 표시 32 · 전체 지우기 제거 15 · QR · PIN 관리 28 — 426 / 426 통과.
  보호 규칙 확인(일부러 망가뜨린 사본): 상관없는 운영자 CSS · UI 최종 규칙 값 바꿈 → S1-6, 상관없는 운영자 글자 · 리허설 안내 줄 바꿈 → S6-7(+ 리허설 D1),
  booth-core.js 한 줄 → 안내 X7 이 각각 실패. 바꾸기 전 판(0e065b3)은 안내 X7 · X8, 리허설 D1 만 실패.
- 2026-10-21 결과(PR #21 후속 — PIN 처음 한 줄 구조 + 숫자 배지 강조 964d74f · 넓은 화면 PIN 을 운영자 미리보기 바로 아래로 b64c279):
  두 판 모두 426 / 426 통과. 보호 규칙 확인(964d74f 사본)도 위와 같게 실패. 직전 판 964d74f(PIN 이 미리보기에서 86px)에 새 안내 시험 → X8 만 실패(12 / 13).
- 2026-10-22 결과(PR #21 후속 — 넓은 화면 PIN 을 남는 높이 가운데로 bd7241f · PIN 확대 0b443de · 숫자 배지 모서리 6px 직사각형 e314ee8):
  세 판 모두 426 / 426 통과. 새 안내 시험을 바로 앞 판에 돌리면 각각 X8 만 실패(b64c279 · bd7241f · 0b443de, 12 / 13).
- 2026-10-22 결과(QR · PIN 관리 인쇄 1 · 2 · 4장 + 포스터 범례 색 main 6aac21a · booth-live e314ee8): QR · PIN 관리 38(Q1 ~ Q10 새로 · R2 는 범례 네모 클래스만 허용) · 공통 · 개별 PIN 표시 32 ·
  전체 지우기 제거 15 · Gate 4-R 88 · 리허설 82 · 공통 PIN 61 · QR 종단 30 · 화면 안내 13 · 관람객 48 · 운영자 29 — 436 / 436 통과.
  일부러 망가뜨린 사본 7개(쪽수 · 범례 색 · 종이 방향 · 기본 QR 칸 · 탭 이동 초기화 · QR 다시 그림 · 노랑 테두리)는 각각 의도한 Q 항목이 실패.
- 2026-10-22 결과(후속 main af459af — ② 2장 QR 아래 주소 글 4mm · QR 아래 흰 여백 2.7 → 4.5칸): 436 / 436 통과(38 · 32 · 15 · 88 · 82 · 61 · 30 · 13 · 48 · 29). Q9 가 그 규칙을 고정.
