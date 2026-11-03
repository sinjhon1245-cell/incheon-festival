# 현장예약 운영 방식 — 구현 결과 (DB 적용 전 검토용)

- 작성 2026-11-03 · 기준 `booth-live` 7633e48 · `main` 86ceb4c
- 브랜치: `claude/onsite-reservation`(booth-live 기반) · `claude/onsite-reservation-admin`(main 기반)
- **하지 않은 것**: 운영 DB 변경 · 마이그레이션 실행 · 운영 데이터 수정 · PR 생성 · 병합 · Production 배포. Production DB 는 읽기 전용 조회만 했습니다.
- 시험: 자동 119개 모두 통과(DB 64 · 화면 47 · 관리 8) + 브라우저 5개 폭 비교.

---

## 1. 바뀐 파일

### booth-live 브랜치 (`claude/onsite-reservation`)
| 파일 | 내용 |
|---|---|
| `supabase/migration-booth-live-mode.sql` | 새 표 3개(방식 · 스위치 · 전환 기록), 쓰기 다섯 함수 교체(같은 이름 · 인자 · 반환), 전환 함수 2개, 상태 값 2개 추가. 한 트랜잭션, 적용 전 md5 확인 |
| `supabase/rollback-booth-live-mode.sql` | 위를 되돌림. 다섯 함수를 2026-11-03 정의 그대로 복원하고 md5 로 확인 |
| `supabase/ops-booth-live-mode.sql` | 상태 보기 · 켜기 · 끄기 · 남은 예약 상태 지우기 · 테스트 설정 정리(미리 보기 → 적용) |
| `live/api/live-snapshot.mjs` | 방식 읽기, 부스마다 `opMode` · `reserve` 칸, 방식에 맞지 않는 값은 보내지 않음 |
| `assets/booth-core.js` | 예약 상태 이름, 방식-상태 규칙(`modeAllows`), 방식 읽기/전환 API, 시연 저장소 |
| `visitor.html` · `assets/visitor.css` | 목록 두 줄 낱말, 한눈에 칸, QR 직접 진입, 숫자 · 거르기 · 정렬 |
| `booth-ctrl.html` · `assets/booth-ctrl.css` | 선택 줄, 확인창, 겹친 단추판, 전환 흐름, 저장 대기열 연동 |
| `assets/mock-data.js` | 시연 부스 2곳(예약 운영 중 · 예약 마감) |
| `live/example/index.html` · `example.css` | 예시 화면에 예약 두 줄 · 선택 줄 |
| `scripts/booth-live-mode/*` | 시험 3개 + 복제 스키마 + 사용법 |
| `design/onsite-reservation-plan.md` · 이 파일 | 분석 · 결과 보고 |

### main 브랜치 (`claude/onsite-reservation-admin`)
| 파일 | 내용 |
|---|---|
| `assets/booth-core.js` | 예약 상태 이름 · 규칙 · 방식 읽기(main 판) |
| `assets/booth-admin.js` · `booth-admin.css` · `admin.css` | 운영 상태 '현장예약' 칸(있을 때만 7번째), 줄 낱말, 긴급 수정 단추를 방식에 맞게, **일괄 채우기 · 비우기에서 현장예약 부스 제외** |
| `assets/portal.js` · `portal.css` | 운영 포털에서 예약 상태를 '입력 없음' 대신 낱말로 |

QR 인쇄(`print-qr.html`) · 관리자 화면 부스 편집은 바뀌지 않습니다(대기 값을 고치는 칸이 없음).

---

## 2. DB 구조 (주요 SQL)

```sql
-- 방식: 줄이 없으면 현장대기. 기존 84곳에는 줄을 넣지 않음 → 적용 직후 모두 현장대기
create table public.booth_live_mode (
  booth_id uuid primary key references public.booths(id) on delete cascade,
  mode text not null check (mode in ('wait','reserve')), updated_at timestamptz not null default now(),
  via text not null check (via in ('pin','qr','admin')), session_id uuid references public.booth_session(id) on delete set null);
-- 스위치(기본 false). 꺼지면 공개 읽기에서 방식 줄이 0줄 → 모두 현장대기
create table public.booth_live_mode_config (id smallint primary key default 1 check (id = 1), enabled boolean not null default false, ...);
create policy "공개 부스 운영 방식 열람" on public.booth_live_mode for select to anon, authenticated
  using (public.booth_live_mode_enabled() and exists (select 1 from public.booths b where b.id = booth_live_mode.booth_id));
-- 상태 값: 예약중 · 예약마감 추가(잠시 중단 · 오늘 마감은 기존 '중단' · '마감')
check (congestion = any (array['여유','보통','혼잡','중단','마감','예약중','예약마감']))
```

**쓰기 다섯 길에 같은 문지기** — `private.booth_op_set` · `private.booth_op_touch` · `booth_ctrl_set` · `booth_ctrl_touch` · `admin_set_booth_live`
```sql
perform private.booth_mode_lock(p_booth);          -- pg_advisory_xact_lock(hashtext('booth_live_mode'), hashtext(booth_id))
perform private.booth_mode_check(p_booth, p_mode);  -- open 은 wait 에서만, resv_* 는 reserve 에서만 → 아니면 22023 booth_mode_mismatch
```
- QR 열쇠 함수는 예전에 PIN 함수의 사본이었는데, 이제 같은 함수(`booth_op_set` · `booth_op_touch`)를 그대로 부릅니다. 열쇠 검사 · 오류 문구 · 기록은 그대로입니다.
- '변동 없음 · 지금 확인'도 지금 방식에 맞는 값만 시각을 새로 합니다. 스위치를 끈 뒤 남은 예약 상태는 되살리지 않습니다.

**전환** — `booth_session_mode(p_session, p_mode)` · `booth_ctrl_mode(p_token, p_mode)`. p_mode 가 null 이면 읽기만 합니다.
```sql
perform private.booth_mode_lock(p_booth);
if private.booth_mode_of(p_booth) <> p_mode then      -- 같으면 아무것도 안 함(재전송 안전)
  delete from public.booth_live where booth_id = p_booth returning ...;   -- 과거 대기 · 예약 상태 제거
  insert into public.booth_live_mode ... on conflict do update ...;
  insert into public.booth_live_mode_log (..., cleared_congestion, cleared_wait, ...);
end if;
```
**바꾸지 않는 것**: 23:00 cron · `rehearsal_live_reset` · `admin_reset_booth_live` · `admin_confirm_booth_live` · `booth_session_get/set/touch` · `booth_ctrl_get` · booths · zones · QR · PIN · 세션 · UUID.

---

## 3. 요청하신 안전 상황별 처리와 시험

| 상황 | 처리 | 시험 |
|---|---|---|
| 오프라인에서 누른 대기시간이 저장 대기열에 남음 | 누름에 그때의 방식을 적어 둠. 방식이 바뀌면 화면이 버림. 보내더라도 서버가 22023 으로 거부 → 화면이 누름을 버리고 다시 읽음 | O4 · O5 · T5 · T7 |
| 저장 대기열이 남은 채 운영 방식 변경 | 연결이 끊겼거나 보내는 중이면 전환을 받지 않음. 온라인이면 확인창에 "저장되지 않은 값은 버려요"를 알리고, 전환에 성공하면 그 누름을 버림 | O4 · O6 |
| 두 운영자가 같은 부스를 동시에 조작 | 부스 단위 잠금으로 순서를 정함. 전환 중 들어온 대기 분은 기다렸다가 거부, 저장 뒤 전환은 그 값을 지움. 같은 전환 두 번은 기록 1번, 반대 전환은 나중 것으로 끝남. 다른 기기는 다음 읽기(1분 안)에서 알림 | T10(실제 연결 2개) · O4 · 브라우저 2창 |
| 현장대기 → 현장예약 → 현장대기 | 전환할 때마다 상태 줄을 지움. 예전 값이 되살아나지 않음 | T7 · O7 |
| 전환 응답을 못 받아 재전송 | 서버는 같은 방식이면 아무것도 바꾸지 않음. 화면은 원래 방식으로 둔 채 다시 읽어 맞추고, "이 기기가 바꾼 것"으로 알림 | T4 · O6 |
| 이전 버전 운영자 화면이 열린 채 방식 변경 | 옛 화면이 보내는 대기 분은 서버가 거부(오류 문구 표시, 값은 안 들어감) | T5(PIN · QR) |
| QR 열쇠 경로로 과거 대기시간 전송 | QR 함수도 같은 문지기를 거침 | T5 · T6 · T7 |
| 23:00 초기화 직전 · 직후 전환 | 초기화는 상태 줄만 지우고 방식 표는 건드리지 않음. 겹쳐도 둘 다 성공해 "방식 유지 · 상태 없음" | T8 · T10(겹침) |
| 관리자 일괄 입력이 현장예약 상태를 덮어씀 | 화면: 리허설 · 예시 일괄 채우기 · 비우기 대상에서 현장예약 부스 제외. 서버: 현장예약 부스의 대기 분은 거부. 긴급 수정은 방식에 맞는 단추만. 일괄 확인은 값을 바꾸지 않아 그대로 | T5 · A4 |
| 기능 비활성화 시 기존과 동일 | 스위치 끔(기본): 26가지 입력의 결과 · 오류 문구 · 기록이 바뀌기 전과 같음. 관람객 스냅샷 · 목록 · 숫자 · 관리 판이 예전 화면과 같음 | T2 · S1 · V1 · O0 · O10 · A1 · A2 |

---

## 4. 시험 결과

| 묶음 | 결과 | 어떻게 |
|---|---|---|
| DB `test-db.mjs` | **64/64** | 로컬 PostgreSQL **17.6**(Production 과 같은 판)에 Production 정의를 올려 migration → 시험 → rollback. 기준 다섯 함수 md5 = Production, 되돌린 뒤 md5 = Production |
| 화면 `test-ui.mjs` | **47/47** | 스냅샷 8 · 관람객 16 · 운영자 23. '바뀌기 전과 같음'은 7633e48 파일로 같은 입력을 그려 비교 |
| 관리 `test-admin.mjs` | **8/8** | main 판 booth-admin 을 origin/main 판과 비교 |
| 빌드 | 통과 | `sh live/build.sh` |

**화면 폭 비교(브라우저, 협의용 예시)**

| 폭 | 관람객: 가로 넘침 · 오른쪽 열 · 줄 높이(예약/일반) · 한눈에 칸 | 운영자: 전환 전후 움직임 · 단추판 높이(대기/예약) |
|---|---|---|
| 360 | 0 · 80px · 73/73 · 75×75 | 0px · 136/136 |
| 390 | 0 · 80px · 73/73 · 65×65 | 0px · 136/136 |
| 768 | 0 · 80px · 73/73 · 67×67 | 0px · 136/136 |
| 1024 | 0 · 80px · 73/73 · 67×67 | 0px · 148/148 |
| 1440 | 0 · 80px · 73/73 · 67×67 | 0px · 148/148 |

운영자 '움직임 0px' = 선택 줄 · 현재 상태 판 · 단추판 제목 · 단추판 · 잠시 중단 · 오늘 운영 마감의 위치 · 크기가 현장대기 → 현장예약 → 현장대기 전환 내내 같음.

---

## 5. 기능을 끄면(복구 절차)

1. `ops-booth-live-mode.sql` C: `update public.booth_live_mode_config set enabled = false ...` — 배포 없이 바로.
2. 그 순간부터:
   - 서버는 모든 부스를 현장대기로 봅니다. 예약 상태 저장은 거부하고, 대기 분은 받습니다.
   - 관람객 화면은 스냅샷 캐시가 지나면(최대 약 40초) 예약 부스를 '정보 없음'으로 보여 줍니다.
   - 운영자 화면은 다음 읽기(1분 안)에서 선택 줄이 사라지고 현장대기 단추판이 됩니다. "운영본부가 현장예약을 꺼서 …" 알림이 뜨고, 남은 예약 상태는 '아직 입력 전'으로 보입니다.
   - 관리 화면은 남은 예약 상태를 '미입력'으로 셉니다(관람객과 같음).
3. 운영자가 대기 시간을 누르면 바로 덮어씁니다. 누르지 않아도 23:00 에 지워집니다. 바로 정리하려면 C-2(남은 예약 상태 지우기)를 실행합니다.
4. 다시 켜면 정해 둔 방식이 그대로 살아납니다(방식 줄은 지우지 않음).

**테스트 설정 정리(결정 5)**: `ops-booth-live-mode.sql` D 는 부스 번호(또는 전부)를 고르고 `v_apply=false`(미리 보기) → `true`(적용) 순서로 실행합니다. 방식을 현장대기로 바꾸고 그 부스의 상태를 지우며, 기록에는 `via=admin` 으로 남깁니다. 11-05 밤 일괄 초기화는 하지 않습니다.

---

## 6. 배포 순서 (각 단계 승인 뒤, DB 실행은 사용자)

1. **DB** `migration-booth-live-mode.sql` 실행. 스위치가 꺼진 채 들어가므로 동작은 지금과 같습니다(T2). 끝의 확인 쿼리가 mode_rows 0 · enabled false · live_rows 그대로 · 84 이면 정상입니다.
2. **main** PR(관리 화면) 병합 → Pages. DB 보다 먼저 배포해도 됩니다(표가 없으면 현장대기로 봄, A2).
3. **booth-live** PR(스냅샷 · 관람객 · 운영자 · 예시) 병합 → Vercel Production. DB 보다 먼저여도 됩니다(함수가 없으면 지금과 같은 화면, O10 · S1).
4. **실기기 검증**: 스위치를 켜고(B) 예시 부스나 실제 한 곳에서 PIN · QR 두 길로 전환 · 저장 · 오프라인 · 두 기기를 확인한 뒤, 관람객 화면을 확인합니다.
5. **11-05 정오까지 검증을 끝내지 못하면**: 스위치를 끈 채로 둡니다(C). 코드는 배포돼 있어도 지금 시스템과 같게 돕니다.

## 7. 롤백 절차

| 단계 | 방법 | 영향 |
|---|---|---|
| 가장 빠름 | 스위치 끄기(ops C) | 배포 · DB 구조 그대로, 모든 화면이 현장대기 |
| 화면 되돌리기 | Vercel 이전 배포로 Promote / main 되돌림 커밋 | DB 가 적용돼 있어도 옛 화면은 그대로 돎(새 칸은 무시) |
| DB 되돌리기 | `rollback-booth-live-mode.sql` | 예약 상태 줄만 지우고, 다섯 함수를 11-03 정의로 복원(md5 확인), 새 표 · 함수 제거, 전환 기록은 private 백업 |

---

## 8. 남은 일 · 한계

- **실기기 검증 전**입니다(휴대폰 브라우저 · 실제 PIN · QR · 현장 와이파이). 위 시험은 로컬 DB와 jsdom, 데스크톱 브라우저의 예시 화면입니다.
- 다른 기기의 전환을 알아채는 시간은 운영자 화면의 읽기 주기(1분)를 따릅니다. 저장을 누르면 그 자리에서 서버가 거부하고 바로 맞춥니다.
- `/example/` 예시는 정적 화면이라 스위치와 상관없이 예약 두 줄 · 선택 줄이 보입니다. 리허설 뒤 그 페이지를 내릴 예정이면 그대로 두어도 됩니다.
- 운영 포털(main)은 방식 표를 읽지 않아, 스위치를 끈 뒤 남은 예약 상태가 23:00 전까지 낱말로 보일 수 있습니다(관리 화면 · 관람객은 숨김).
- Supabase Security Advisor 는 적용 뒤 한 번 확인하기를 권합니다. 새 표는 RLS 켜짐 · anon 은 SELECT 만, 함수 권한은 post 확인 칸에서 검사합니다.
