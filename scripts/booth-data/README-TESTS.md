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
```

- `test-reset-removed.mjs`(A-1): 인쇄 화면에서 ‘실시간 값 모두 지우기’ 를 뺀 판 기준. 예전 판은 `--old-ref`(기본 6a34872)로 git 에서 읽습니다.
- `test-pin-status.mjs`(A-4): 리허설 공통 PIN · 개별 PIN 표시가 서버 판정(`private.booth_common_pin_target` + PIN 보조 로그인 스위치)과 같은지 —
  복제 DB 의 공통 PIN 판정 함수에만 시험 시계를 겁니다(`lib/ui-harness.mjs`). 관리자 부스 관리는 포털 표가 없어 협의용 예시로 봅니다.

- 비교용 옛 판(7ebf536 · 421f656 · 56c3138 · 6fd46d8)은 `git worktree add <폴더> <커밋>` 으로 만들거나, 시험이 git 으로 직접 읽습니다.
- 결과 보고서는 `out/rehearsal/` · `out/gate3c/` · `out/gate4r/` 에 씁니다(git 제외).
- 리허설 시험의 A · B 묶음은 DB 함수가 행사 첫날(2026-11-06 KST) 전에만 열리므로 그 전에만 그대로 통과합니다.
- 2026-10-20 결과(1차 UI 수정 병합 전): 운영자 29 · 리허설 82 · QR · PIN 관리 28 · 관람객 48 · 공통 PIN 61 · QR 종단 30 · Gate 4-R 88 — 모두 통과.
