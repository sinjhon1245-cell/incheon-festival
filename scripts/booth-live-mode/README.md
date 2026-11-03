# 운영 방식(현장대기 · 현장예약) 시험

어떤 시험도 Production 에 접속하지 않습니다. 준비물은 저장소 밖 아무 폴더에 따로 설치합니다(저장소에 `node_modules` 를 두지 않음).

```bash
mkdir booth-mode-deps && cd booth-mode-deps && npm init -y
npm i embedded-postgres@17.6.0-beta.15 pg@8.13.1 jsdom@30.1.1
```

| 파일 | 하는 일 | 실행 |
|---|---|---|
| `test-db.mjs` | 임시 로컬 PostgreSQL 17.6(Production 과 같은 판)에 `replica-20261103.sql`(2026-11-03 Production 정의) → `supabase/migration-booth-live-mode.sql` → 시험 → `supabase/rollback-booth-live-mode.sql`. 다섯 함수의 md5 를 Production 값과 견주고, 연결 두 개로 동시 조작을 실제 잠금으로 봅니다. | `node scripts/booth-live-mode/test-db.mjs --deps <폴더>` |
| `test-ui.mjs` | 스냅샷 API · 관람객 화면 · 운영자 화면(jsdom). 기준 커밋(기본 `7633e48`)의 파일을 git 에서 꺼내 '바뀌기 전과 같음' 을 견줍니다. | `node scripts/booth-live-mode/test-ui.mjs --deps <폴더>` |
| `test-admin.mjs` | main 의 부스 운영 현황(booth-admin.html) 호환. 로그인 · 데이터 읽기만 가짜 Core 로 바꿉니다. | `node scripts/booth-live-mode/test-admin.mjs --deps <폴더> --main-dir <main 작업 폴더>` |

`replica-20261103.sql` 은 2026-11-03 Production 에서 읽기 전용으로 받은 표 모양 · 함수 정의와 가짜 부스 4곳뿐입니다(운영 데이터 · 열쇠 · PIN 없음).
