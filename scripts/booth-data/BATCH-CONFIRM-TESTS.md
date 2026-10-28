# ‘확인 필요’ 일괄 확인 시험 (PR #38)

이 브랜치(`claude/batch-confirm-tests`)는 시험 코드만 보관합니다. 화면 · SQL 은 PR #38(10-28 main 에 병합 · Production SQL 은 아직 적용 안 함)에 있습니다. Actions 는 main 의 SQL 을 시험합니다.

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

## 실제 PostgreSQL 시험 항목(L1~L11) — 10-28 실행 40611129475 · 20/20

| 묶음 | 확인하는 것 |
|---|---|
| L1 · L4 | 두 · 세 관리자가 같은 부스를 동시에 · 순서를 바꿔 확인 → 부스마다 기록 1줄 · 교착 0 |
| L2 · L3 | 운영자 입력과 겹침(NOWAIT → 그 부스만 failed:busy) · 다른 관리자가 3초 넘게 잡음(전체 failed:busy · 정상 응답) |
| L5 | 23:00 초기화와 겹침 — 초기화 실패 0(처음 설계와 비교) |
| L6 | 확인만으로 booth_live · booth_live_log 그대로 |
| L9 | 뒤섞기: 관리자 셋 · 운영자 둘 · 초기화 · 낡은 미리보기 — 요청 전체 실패 0 · 뜻밖의 결과 0 |
| L10 | 한 부스에서 뜻밖의 오류 → 그 부스만 failed, 요청은 정상 응답 |
| L11 | 부스 삭제 — 기록 남음 · skipped:not_found · 확인 중 삭제는 기다렸다가 성공 |

모든 호출 뒤 **결과 = 기록** 을 셉니다: confirmed 는 기록 정확히 1줄(확인 시각 · 확인한 값 시각까지 같음), skipped · failed 는 0줄, 결과에 없는 기록 0.

다른 시험의 알려진 실패(test-rehearsal **D1** · test-reset-removed **D4-1**)는 일괄 확인과 무관한 기존 실패입니다 — 원인과 판단 기준은 PR #41 브랜치(`claude/batch-confirm-apply-day`)의 `docs/ops-batch-confirm-apply.md` 8장.
