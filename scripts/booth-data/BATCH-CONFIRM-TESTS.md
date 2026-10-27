# ‘확인 필요’ 일괄 확인 시험 (PR #38)

이 브랜치(`claude/batch-confirm-tests`)는 시험 코드만 보관합니다. 화면 · SQL 은 `claude/ops-batch-confirm`(PR #38)에 있습니다.

| 시험 | 무엇 | 어디서 돌리나 |
|---|---|---|
| `test-batch-confirm-locks.mjs` | 실제 PostgreSQL · 독립 연결 6개(관리자 3 · 운영자 · 23:00 초기화 · 준비)로 동시 잠금 | **GitHub Actions** `.github/workflows/batch-confirm-locks.yml`(PostgreSQL 17 서비스 컨테이너) 또는 버려도 되는 로컬 PostgreSQL |
| `test-batch-confirm.mjs` | 복제 DB(PGlite · 한 연결) + 관리자 화면(jsdom) — 설치 · 권한 · 판정 · 순서 · 날짜 · 초기화 · 되돌리기 · 감사 기록 | 로컬(`out/` 의 부스 자료가 있어야 함 — 개인정보가 섞일 수 있어 저장소에 올리지 않음) |

## 다시 돌리기

- Actions: 이 브랜치에 push 하거나, GitHub → Actions → batch-confirm-locks → 실행 → **Re-run jobs**. 결과는 실행 요약과 `batch-confirm-locks-report` 파일.
- 로컬: 빈 PostgreSQL 14 이상 DB 와 `npm i --prefix <폴더> pg@8` 를 준비한 뒤

  ```
  PGURL=postgres://postgres:<암호>@localhost:5432/<빈 DB> node scripts/booth-data/test-batch-confirm-locks.mjs --pg-dir <폴더> --main-dir <PR #38 작업 폴더> --disposable
  ```

시험은 Supabase 주소와 `public.booths` 가 이미 있는 DB 를 거절합니다. Production 에 접속하지 않습니다.
`dryrun/` 의 SQL 은 Production 의 표 · 함수 정의를 옮긴 복제용이고(데이터 없음, PIN pepper 는 시험용 고정값), `lib/` 는 시험 도구입니다.
