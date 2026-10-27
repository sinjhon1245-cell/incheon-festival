# ‘확인 필요’ 일괄 확인 — Production 적용 · 리허설 절차

`supabase/migration-booth-live-check.sql` 을 Production 에 적용하는 절차입니다. **적용은 운영 담당자가 별도 최종 지시 뒤 직접 합니다.**
설계는 [ops-batch-confirm-and-notify.md](ops-batch-confirm-and-notify.md) 2장, 읽기 전용 점검 SQL 은 `supabase/check-booth-live-check.sql`.

## 1. 지금 Production (2026-10-28 읽기 전용 확인)

| 항목 | 값 | 판단 |
|---|---|---|
| PostgreSQL | 17.6 | 동시 잠금 시험(PostgreSQL 17.11)과 같은 판 |
| 선행 조건(booth_live · booths · staff_profiles · is_admin() · auth.uid()) | 모두 있음 | 적용 가능 |
| 새 이름(booth_live_check · admin_confirm_booth_live · admin_booth_live_checks) | 아직 없음 | 처음 적용 |
| 23:00 예약 작업 | `booth-rehearsal-reset 0 14 * * *` 켜짐 | 이 SQL 은 건드리지 않음 |
| 초기화 함수 `private.rehearsal_live_reset()` | 저장소 판과 같은 동작(줄바꿈만 CRLF 로 달라 지문이 다름) | 시험한 초기화와 같은 delete 문 |
| booth_live | 50줄 · 지문 `a3ace6a4…` | 적용 뒤에도 같아야 함(그 사이 입력이 없을 때) |
| booth_live_log | 1,065줄 · 마지막 id 1100 | 적용 · 확인만으로는 늘지 않음 |
| authenticated statement_timeout · deadlock_timeout | 8s · 1s | 일괄 확인의 기다림 상한 3s 보다 김 |

## 2. 무엇이 바뀌고 무엇이 그대로인가

- **생김**: 표 `booth_live_check`(RLS 켬 · 정책 없음 · 표 권한 없음 · 외래 키 없음), 함수 `admin_confirm_booth_live(jsonb)` · `admin_booth_live_checks()`.
- **그대로**: `booth_live`(값 · `updated_at`) · `booth_live_log` · 기존 함수 · 정책 · 23:00 예약 작업 · QR · PIN · 관람객 · 운영자 화면.
- 관리자 화면은 함수가 생기면 [새로 고침] 뒤 [일괄 확인] 이 켜지고, 관리 조치에 ‘관리자 확인 · 아직 미확인’ 이 나뉘어 보입니다.

## 3. 적용 전

1. PR #38 이 main 에 병합 · GitHub Pages 배포 완료.
2. 시간: **22:30~23:30 은 피합니다**(23:00 초기화와 겹쳐도 안전하게 설계 · 시험했지만 확인을 위해). 행사 운영 시간(11-06 · 07 10:00~17:00)에는 적용하지 않습니다.
3. `check-booth-live-check.sql` 의 **A** 를 Run → ‘선행 조건 있음’ · ‘새 이름 아직 없음’ 이 true. booth_live 지문 · 대기 기록 줄을 적어 둡니다.
4. (선택) Table Editor → booth_live → Export CSV(비교 기준. 이 SQL 은 이 표를 바꾸지 않습니다).

## 4. 적용

1. SQL Editor 에 `supabase/migration-booth-live-check.sql` 전체를 붙여넣고 Run(한 트랜잭션).
2. 맨 아래 확인 표 **10줄 모두 ‘맞음’ = true**:

| # | 항목 | 기대 |
|---|---|---|
| 1 | booth_live_check 표 · RLS 켬 | true |
| 2 | 정책 수(함수로만 씀) | 0 |
| 3 | 표 직접 읽기 · 쓰기(anon · authenticated) | false |
| 4 | anon 실행(두 함수 중 하나라도) | false |
| 5 | authenticated 실행(두 함수 모두 — 안에서 is_admin) | true |
| 6 | security definer · search_path 빈 값 · volatile | 2 |
| 7 | advisory 잠금 · FOR UPDATE NOWAIT · lock_timeout 3s | true |
| 8 | booth_live · booth_live_log 를 쓰지 않음 | false |
| 9 | 함수 이름마다 정의 1개 | admin_booth_live_checks 1, admin_confirm_booth_live 1 |
| 10 | 기록 표에 외래 키 없음 | 0 |

3. A 를 다시 Run → booth_live 지문 · 대기 기록 줄이 3단계와 같음(그 사이 운영자 입력이 없었다면).
4. 하나라도 다르면 5장 되돌리기.

## 5. 되돌리기

- `supabase/rollback-booth-live-check.sql` 을 Run → 두 함수만 지워지고 확인 표 4줄이 맞음. 관리자 화면은 [새로 고침] 하면 ‘준비 중’ 으로 돌아갑니다.
- 기록 표는 감사 기록으로 남습니다(아무도 읽거나 쓰지 못함). 지우려면 CSV 로 내려받은 뒤 파일 맨 아래 주석의 drop 을 따로 승인 받아 실행.
- 현황 데이터는 처음부터 바뀌지 않으므로 되돌릴 데이터가 없습니다. 다시 켜려면 적용 SQL 을 다시 Run(기록 이어 씀).

## 6. 리허설(적용 직후 · 리허설 기간 낮 시간)

목적: 일괄 확인이 **관람객 대기시간과 `booth_live.updated_at` 을 바꾸지 않고** 관리자 확인 기록만 남기는지 실제 Production 에서 확인합니다.

| 단계 | 하는 일 | 통과 기준 |
|---|---|---|
| 1 | 관리자 화면에서 리허설 부스 두 곳(예: R1-01 · R1-02)이 ‘확인 필요’(30분 넘게 그대로)인 상태를 고름 — 없으면 리허설 관리로 값을 넣고 30분 기다림 | 두 곳 모두 ‘확인 필요’ |
| 2 | `check-booth-live-check.sql` **B** 의 부스 목록을 그 두 곳으로 바꿔 Run(전) | 지문 · 마지막 입력 · 대기 기록 줄을 적어 둠 |
| 3 | 관람객 화면에서 두 부스를 봄 | ‘정보 없음’(30분 넘은 값) — 적어 둠 |
| 4 | 관리자 화면 [새로 고침] → [일괄 확인] → 두 곳 고르기 → 미리보기 → 확인 기록 남기기 | 결과 ‘확인 완료 2’ |
| 5 | B 다시 Run(뒤) | **지문 · 마지막 입력(updated_at) · 대기 기록 줄이 전과 같음**, 관리자 확인 기록 수만 +1 |
| 6 | 관람객 화면 다시 봄 | 여전히 ‘정보 없음’(값 · 시각이 그대로라서) |
| 7 | 운영자 화면(그 부스 QR 또는 PIN) | ‘마지막 입력 N분 전’ 그대로 · 입력 · 인증 정상 |
| 8 | 관리자 화면 | 줄에 ‘확인 필요’ + ‘관리자 확인 HH:MM’, 관리 조치 확인 필요 수 그대로 · ‘관리자 확인 2 · 아직 미확인 n’ |
| 9 | 운영자가 그 부스에서 새로 입력 | 관리자 화면에서 그 부스가 확인 필요 · 관리자 확인에서 빠짐(새 입력이 이김) |
| 10 | **C** Run | 두 줄 — 확인한 관리자 이름 · 부스번호 · 확인한 값 · 그 값의 입력 시각 |
| 11 | 다음 날 아침 `select status, start_time from cron.job_run_details order by start_time desc limit 3` | 23:00 초기화 succeeded |

하나라도 기준과 다르면 바로 5장 되돌리기 후 원인을 봅니다.

## 7. 시험 근거

- 실제 PostgreSQL 17(GitHub Actions 서비스 컨테이너, 독립 연결 6개) **17/17** — 실행 40499692269. 두 관리자 중복 0 · 운영자 값 유지 80/80 · 23:00 초기화와 겹쳐도 초기화 실패 0(처음 설계는 4~7/40 실패).
- 복제 DB(지금 Production 단계) 59/59 · 관리자 화면 72/72 · 기존 화면 점검 523/523.
- 시험 코드: 브랜치 `claude/batch-confirm-tests`(`scripts/booth-data/BATCH-CONFIRM-TESTS.md`).
