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
| `test-visitor-tabs.mjs` | 관람객 화면 탭을 실제 Chrome 에서 봅니다(예시 스냅샷 105곳 · 공개 전 96곳). 폭 320~1440 에서 다섯 칸이 옆으로 밀지 않고 한 화면에 드는지, PC 전체 · 초등 · 중등·특수 · 고등 · 미래채움·체험과 휴대폰 전체 · 초 · 중·특 · 고 · 미래·체험, 화면 읽기의 전체 이름 · 곳 수, 묶인 탭 안의 구역 제목(중등 아래 특수 · 미래채움존 아래 체험존), 게임 · 교육 배지, 이름 묶음 · 번호 · 상태 칸의 세로 가운데, 상단 집계, 번호순 · 대기 짧은 순 · 상태 고름 · 검색. `--base <커밋>` 은 그 커밋의 화면을 시험, `--snapshot <파일>` 은 실제 스냅샷에 두 구역을 더해 화면을 찍습니다. | `node scripts/booth-live-mode/test-visitor-tabs.mjs --deps <폴더> [--base <커밋>] [--shots <폴더>] [--snapshot <파일>]` |
| `test-venue-map.mjs` | 관람객 화면의 `배치도 보기` 단추와 지도 창을 실제 Chrome 에서 봅니다(폭 320~1440). 단추 크기 · 잘림 · 탭 줄, 그림을 미리 받지 않음, 휠 · 끌기 · 두 손가락(Chrome 터치 시뮬레이션) · 단추 · 자판, 범위 제한, 크기 변경, 구역 이동(일곱 곳 · 가로 화면 포함) · 주황 강조가 그림 좌표와 이웃 구역에 맞는지 · 자동 배율 · 미니맵 사각형(1px 안) · 프레임별 배율 기록으로 튐 · 이동 시간(300 · 1000 · 650ms) · 연속 선택 · 취소 · 외곽선 유지와 해제 · 움직임 줄이기 · 체험존 번호 안내, 단추 대비, Esc · 포커스 복원, 그림 오류, 닫은 뒤 검색어 · 탭 · 스크롤 유지, 뒤로 가기. 저장소의 실제 공식 배치도로 시험합니다. | `node scripts/booth-live-mode/test-venue-map.mjs --deps <폴더> [--shots <폴더>]` |
| `test-db-experience.mjs` | 체험존 SQL 시험. 임시 로컬 PostgreSQL 에 `replica-20261103.sql` → 운영 방식 migration → `supabase/migration-booth-experience-zone.sql`(잠금 확인 뒤 등록) → 다시 실행 → `publish-booth-experience-zone.sql`(QR · PIN 없으면 거절) → 실제 함수로 QR · 세션 인증 · 상태 저장 · 현장예약 → 23:00 초기화(학교 84곳 목록은 그대로 · 체험존 포함) → `check-booth-experience-zone.sql` → `rollback-booth-experience-zone.sql` → 다시 등록. | `node scripts/booth-live-mode/test-db-experience.mjs --deps <폴더>` |
| `test-db-105.mjs` | 미래채움존 SQL(96 → 105) 시험. 임시 로컬 PostgreSQL 에 운영 방식 · 체험존 SQL 과 공개 자료 `fixture-public-96.json`(학교 84곳)을 올려 운영과 같은 96곳을 만들고, `migration-booth-future-after-experience.sql` 의 지문 검사를 파일 그대로 통과시킨 뒤 등록 → 공개 막힘 → 공개 → 실제 함수로 QR · 세션 인증 · 상태 저장 → 23:00 초기화 → `check-booth-105.sql` → 숨기기 → 다시 공개. | `node scripts/booth-live-mode/test-db-105.mjs --deps <폴더>` |
| `test-admin.mjs` | main 의 부스 운영 현황(booth-admin.html) 호환 · 체험존 · 미래채움존 구역(번호가 같은 학교 부스와 섞이지 않음). 로그인 · 데이터 읽기만 가짜 Core 로 바꿉니다. | `node scripts/booth-live-mode/test-admin.mjs --deps <폴더> --main-dir <main 작업 폴더>` |

`replica-20261103.sql` 은 2026-11-03 Production 에서 읽기 전용으로 받은 표 모양 · 함수 정의와 가짜 부스 4곳뿐입니다(운영 데이터 · 열쇠 · PIN 없음).
