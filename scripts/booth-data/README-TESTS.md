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
node scripts/booth-data/test-example-page.mjs --live-dir ../incheon-festival-live --main-dir ../incheon-festival-main --pptr-dir <pptr/node_modules/puppeteer-core 가 든 폴더> [--base-ref 3212ef7]
```

- `test-example-page.mjs`(/example/ 화면 안내): booth-live 작업 폴더를 `sh live/build.sh` 로 빌드해 Edge(puppeteer-core)로 엽니다.
  두 단추가 실제 운영 화면(`/` · `/booth-ctrl`, `?demo` 없음)을 여는지 · 공개 PIN 이 운영자 단추 바로 위 보조 줄(`.pinhint`) 한 곳뿐인지
  (값 = booth-ctrl 의 공통 PIN 값 · 그 밖의 6자리 숫자 없음 · 예전 큰 PIN 상자 `.pinnote` 없음) · 보조 줄에 적은 기한이 main 의 리허설 SQL 기한보다
  늦지 않은지 · 23:00 초기화는 `booth_live` 만 지우고 페이지가 초기화로 PIN 이 끝난다고 말하지 않는지 · 보조 줄이 작고(단추 글자보다 작음 · 두 줄 이하)
  읽히는지(대비 4.5:1) · 단추 바로 위(8~24px)에 있는지 · 미리보기 말이 지금 두 화면에 있는지 ·
  배포본에서 `example/` 말고는 `--base-ref` 빌드와 바이트 같은지 봅니다. 실제 관람객 화면에는 시험용 스냅샷(`GET /api/live-snapshot`, 부스 A-01 하나)을
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
