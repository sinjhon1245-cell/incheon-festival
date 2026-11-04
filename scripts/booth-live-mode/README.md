# 운영 방식(현장대기 · 현장예약) 시험

어떤 시험도 Production 에 접속하지 않습니다. 준비물은 저장소 밖 아무 폴더에 따로 설치합니다(저장소에 `node_modules` 를 두지 않음).

```bash
mkdir booth-mode-deps && cd booth-mode-deps && npm init -y
npm i embedded-postgres@17.6.0-beta.15 pg@8.13.1 jsdom@30.1.1
npm i puppeteer-core@24   # 실제 Chrome 시험(test-pin-input · test-visitor-resv). 브라우저는 내려받지 않고 설치된 Chrome · Edge 를 씁니다
```

| 파일 | 하는 일 | 실행 |
|---|---|---|
| `test-db.mjs` | 임시 로컬 PostgreSQL 17.6(Production 과 같은 판)에 `replica-20261103.sql`(2026-11-03 Production 정의) → `supabase/migration-booth-live-mode.sql` → 시험 → `supabase/rollback-booth-live-mode.sql`. 다섯 함수의 md5 를 Production 값과 견주고, 연결 두 개로 동시 조작을 실제 잠금으로 봅니다. | `node scripts/booth-live-mode/test-db.mjs --deps <폴더>` |
| `test-ui.mjs` | 스냅샷 API · 관람객 화면 · 운영자 화면(jsdom). 기준 커밋(기본 `7633e48`)의 파일을 git 에서 꺼내 '바뀌기 전과 같음' 을 견줍니다. | `node scripts/booth-live-mode/test-ui.mjs --deps <폴더>` |
| `test-pin-input.mjs` | 부스 운영자 화면의 PIN 칸을 실제 Chrome 에서 신뢰된 마우스 · 키보드 · 터치로 조작합니다. 칸 누르고 고치기 · Backspace · Delete · 전체 선택 · 붙여넣기('482 915') · 빠른 입력 · 모바일 터치 · 폭 360~1440 · 덜 채운 PIN 안 보냄 · 틀린 PIN 뒤 다시 · 횟수 제한 · PIN 이 저장소 · 주소 · 기록에 남지 않음 · 협의용 예시(4자리). Supabase 주소는 이 시험의 작은 서버로 바꿔 가짜 답을 줍니다. `--base <커밋>` 은 그 커밋의 화면을 시험(고치기 전 재현), `--shots <폴더>` 는 PIN 칸 모습을 PNG 로 남깁니다. | `node scripts/booth-live-mode/test-pin-input.mjs --deps <폴더> [--base 12a07e7] [--shots <폴더>]` |
| `test-visitor-resv.mjs` | 관람객 화면 오른쪽 상태 칸을 실제 Chrome 에서 잽니다(협의용 예시 `?demo=1` · 화면 안내 `/example`). 폭 360 · 390 · 768 · 1024 · 1440 에서 80px 칸 · 숫자 · 칩 · 상태 표시 가운데 · 칩 60×22 · 상태 표시 76×34 한 줄 · 현장예약만 네 면 3px 진보라 테두리 · 글자 둘레 여백 · 색 · 대비 · 줄 높이 그대로 · 두 줄 이름 · 한눈에 칸 안 · 예시 화면 일곱 상태 · 서버 요청 없음 · '실제 화면으로 돌아가기'. | `node scripts/booth-live-mode/test-visitor-resv.mjs --deps <폴더> [--base 12a07e7] [--shots <폴더>]` |
| `test-visitor-tabs.mjs` | 관람객 화면 탭을 실제 Chrome 에서 봅니다(예시 스냅샷 93곳 · 공개 전 84곳). 폭 320~1440 에서 다섯 칸이 옆으로 밀지 않고 한 화면에 드는지, PC 전체 · 초등 · 중등·특수 · 고등 · 미래채움과 휴대폰 전체 · 초 · 중·특 · 고 · 미래, 탭 줄 돋보기 없음 · 위쪽 검색칸, 목록 · 한눈에의 구역 제목(중등 아래 특수 · 맨 끝 미래채움존), 미래1~미래9 순서 · 이름 · 기관 · 상태, 상단 집계, 번호순 · 대기 짧은 순 · 상태 고름 · 검색. `--base <커밋>` 은 그 커밋의 화면을 시험, `--snapshot <파일>` 은 실제 스냅샷에 미래채움존 9곳을 더해 화면을 찍습니다. | `node scripts/booth-live-mode/test-visitor-tabs.mjs --deps <폴더> [--base <커밋>] [--shots <폴더>] [--snapshot <파일>]` |
| `test-db-future.mjs` | 미래채움존 SQL 시험. 임시 로컬 PostgreSQL 에 `replica-20261103.sql` → `supabase/migration-booth-future-zone.sql`(등록) → 다시 실행 → `publish-booth-future-zone.sql`(QR · PIN 없으면 거절) → 23:00 초기화(학교 84곳 목록은 그대로 · 미래 9곳 포함) → `check-booth-future-zone.sql` → `rollback-booth-future-zone.sql` → 다시 등록. | `node scripts/booth-live-mode/test-db-future.mjs --deps <폴더>` |
| `test-admin.mjs` | main 의 부스 운영 현황(booth-admin.html) 호환 · 미래채움존 구역(번호가 같은 학교 부스와 섞이지 않음). 로그인 · 데이터 읽기만 가짜 Core 로 바꿉니다. | `node scripts/booth-live-mode/test-admin.mjs --deps <폴더> --main-dir <main 작업 폴더>` |

`replica-20261103.sql` 은 2026-11-03 Production 에서 읽기 전용으로 받은 표 모양 · 함수 정의와 가짜 부스 4곳뿐입니다(운영 데이터 · 열쇠 · PIN 없음).
