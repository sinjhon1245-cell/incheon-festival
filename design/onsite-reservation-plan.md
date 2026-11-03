> 최종 동작 · 구조는 design/onsite-reservation-report.md 가 기준입니다(이 문서는 11-03 분석 당시 기록).

# 현장예약 운영 방식 — 분석과 설계 (구현 전 검토용)

- 작성: 2026-11-03 · 기준 `booth-live` 7633e48 · 작업 브랜치 `claude/onsite-reservation`(로컬, 커밋 · 푸시 없음)
- 이번 단계에서 한 일: 코드 읽기와 Production DB **읽기 전용** 조회(SELECT · 카탈로그)뿐. DB · 운영 데이터 · 배포 · 병합은 건드리지 않음.
- 행사: **11-06(금) 10:00 ~ 11-07(토) 17:00**(settings.event_start · event_end). 오늘(11-03) 기준 남은 날은 사흘.

---

## 1. 지금 구조 (확인한 사실)

### 1-1. 배포 두 곳, 공통 파일 두 벌

| 브랜치 | 배포 | 이번 기능과 관련된 화면 |
|---|---|---|
| `booth-live` | Vercel (incheon-live) | 관람객 `visitor.html`, 운영자 `booth-ctrl.html`, `/api/live-snapshot`, `/example/` |
| `main` | GitHub Pages | 운영 현황 `booth-admin.html`, QR·PIN 인쇄/직접 고치기 `print-qr.html`, 관리자 `admin.html`, 포털 `portal.js` |

`assets/booth-core.js` 는 두 브랜치에서 이미 갈라져 있음(diff 127줄). 공통 규칙을 바꾸면 **두 PR에서 따로** 맞춰야 함.

### 1-2. DB (Production에서 직접 확인)

- `booth_live` — 부스당 한 줄(PK booth_id). `congestion` CHECK = 여유·보통·혼잡·중단·마감, `wait_minutes` 0~180, `updated_at`.
  RLS는 SELECT 하나(anon·authenticated)뿐이고, 쓰기는 SECURITY DEFINER 함수로만 함. Realtime 발행 없음.
- `booth_live_log` — source CHECK = set·touch·admin. congestion에는 CHECK 없음.
- `booth_live_check` — 관리자 일괄 확인 기록(seen_congestion은 CHECK 없는 text).
- 부스 134곳 중 공개·번호 있는 곳 84곳(실제 부스 84곳 모두). 활성 QR 열쇠 84 · 활성 PIN 84 → **QR 경로와 PIN 경로 둘 다 살아 있음**.

`booth_live` 에 쓰는 길(모두 `p_mode` = open · pause · closed):

| 함수 | 호출하는 곳 | 비고 |
|---|---|---|
| `booth_session_set` → `private.booth_op_set` | 운영자 PIN 세션 | |
| `booth_session_touch` → `private.booth_op_touch` | '변동 없음 · 지금 확인' | 오늘 값만 시각 갱신 |
| `booth_ctrl_set` · `booth_ctrl_touch` | 운영자 QR 열쇠 | **booth_op_set을 거치지 않고 같은 로직을 따로 가진 사본** |
| `admin_set_booth_live` (+ `clear`) | booth-admin 긴급 수정 · 예시 채우기/비우기 · print-qr 직접 고치기 | |
| `admin_rehearsal_set_live` | 위 함수를 감싼 리허설 전용 | |
| `admin_reset_booth_live` | 전부 지우기(DELETE) | |
| `private.rehearsal_live_reset` | **pg_cron `booth-rehearsal-reset`, 매일 14:00 UTC = 23:00 KST** | 실제 84곳 줄을 **DELETE** |

- 23:00 초기화는 값을 비우는 게 아니라 **줄을 지움**. `rehearsal_closed()` 검사가 없어서 행사 날 밤에도 돌아감.
- `admin_confirm_booth_live`(일괄 확인)는 값을 바꾸지 않고 확인 기록만 남김. '마감'만 skip, 나머지 상태와는 무관하게 동작.

### 1-3. 읽는 쪽

- `/api/live-snapshot`(Vercel): anon 키로 `booth_live`를 5초 메모하고 CDN에 10초(+swr 30초) 캐시. 때(livePhase)에 맞지 않는 값은 아예 보내지 않음(status·waitMinutes·updatedAt = null).
- 관람객 `visitor.html`: 스냅샷 → `core.fromSnapshot` → `congestion`. 모르는 상태 값은 `bucketOf`='unknown', `core.meta`=UNKNOWN으로 들어가 **"0분 · 정보 없음" 비슷하게 엉터리로 그려짐** → 새 상태 값을 그대로 내보내면 열려 있던 옛 화면이 깨짐.
- 운영자 `booth-ctrl.html`: 누른 값을 localStorage(`pending`)에 남기고, 연결이 돌아오면 다시 보냄. 다른 탭 lease, 다른 기기 변경 감지(reconcile·isMine)까지 있음. 저장이 22023으로 거부되면 그 누름을 버리고 알림(이미 있는 동작).
- `booth-admin.js`(15초)·`admin.js`·`print-qr.html`·`portal.js`는 `booth_live`를 직접 읽음. portal.js는 아는 5개 값만 거르므로 안전. booth-admin.js는 모르는 값을 'open'(대기 중)으로 셈 → 고쳐야 함.
- HTML은 no-cache라 다시 열면 새 판이 옴. 이미 열려 있던 탭만 옛 코드로 남음.

---

## 2. 요구사항과 부딪히는 곳

1. **운영 방식을 `booth_live`에 두면 23:00에 사라짐**(줄 DELETE). → 따로 둬야 함.
2. **`booths`에 칼럼을 더하면** 보호 대상인 원본 표(학교급 구역 트리거 `booths_before_write`, 관리자 편집)를 건드리게 되고, 스냅샷이 booths를 60초마다만 읽어 전환이 최대 60초 넘게 늦게 보임. → 쓰지 않음.
3. **쓰는 길이 다섯 갈래**(세션·QR·관리자, set·touch). 하나라도 막지 않으면 현장예약 부스에 대기 분이 들어갈 수 있음. 특히 QR 경로는 사본 로직.
4. **운영자 화면의 '못 보낸 누름'**: 전환 직전에 눌렀던 대기 분이 전환 뒤에 다시 보내질 수 있음 → 서버가 거부해야 함(화면만으로는 다른 기기·다른 탭까지 막지 못함).
5. **옛 화면 호환**: 새 상태 값(예약 운영 중 등)을 그대로 내보내면 이미 열려 있던 관람객·운영자·관리 화면이 엉터리로 그림.
6. **동시 전환**: 두 기기가 동시에 '전환'과 '대기 분 저장'을 하면 순서에 따라 "현장예약인데 대기 15분"이 남을 수 있음 → 부스 단위로 잠가 순서를 정해야 함.
7. **함수 반환 모양**: `booth_session_get/set/touch`·`booth_ctrl_*`는 RETURNS TABLE이라 칼럼을 더하려면 DROP 후 다시 만들어야 하고, 그동안 권한·PostgREST 캐시가 흔들림 → 기존 함수의 모양은 그대로 두고 새 함수를 더함.
8. **일정**: 행사까지 사흘이고 지금 리허설 중. 기존 쓰기 함수 세 개를 교체해야 하므로 회귀 검증 시간이 필요함.

---

## 3. 제안 구조 (가장 단순하고 되돌리기 쉬운 쪽)

### 3-1. 원칙

- **운영 방식(mode)** 과 **운영 상태(status)** 를 다른 표에 둠.
  - 방식: 새 표 `booth_live_mode` — 23:00 초기화가 건드리지 않음 → **유지**.
  - 상태: 기존 `booth_live` 한 줄 그대로 — 23:00에 지워짐 → **당일 상태만 초기화**. 요구한 동작과 그대로 맞고, 초기화 함수·cron은 손대지 않음.
- **줄이 없으면 '현장대기'**. 84곳에 데이터를 넣는 마이그레이션이 없음 → 적용 직후 동작이 지금과 똑같음.
- 전환할 때 서버가 같은 트랜잭션 안에서 `booth_live` 줄을 지움 → 과거 대기시간이 보이지 않고, 다시 현장대기로 돌아가도 이전 값이 살아나지 않음.
- 모든 쓰기 함수는 **방식이 맞지 않는 값을 22023으로 거부**(이중 안전장치).
- 화면은 서버가 성공을 알려 준 뒤에만 전환함(낙관적 전환 없음, 오프라인 줄 세우기 없음) → 저장에 실패하면 화면과 DB가 그대로임.

### 3-2. DB (마이그레이션 파일 1 + 되돌리기 1, 적용은 사용자 승인 뒤 사용자가)

1. 새 표 `public.booth_live_mode`
   - `booth_id uuid PK → booths(id) on delete cascade`
   - `mode text not null check (mode in ('wait','reserve'))`
   - `updated_at timestamptz not null default now()`, `session_id uuid null → booth_session on delete set null`, `source text check (source in ('set','admin'))`
   - RLS 켜기 + `booth_live`와 같은 SELECT 정책(anon·authenticated). 쓰기 권한 없음.
2. 기록 표 `public.booth_live_mode_log`(booth_id, from_mode, to_mode, source, session_id, created_at). `booth_live_log`는 congestion이 NOT NULL이라 '지움'을 적을 수 없어서 따로 둠.
3. `booth_live.congestion` CHECK에 **'예약중' · '예약마감'** 두 값을 더함. 잠시 중단·오늘 마감은 기존 '중단'·'마감'을 같이 씀(뜻이 같고 23:00·일괄 확인·포털이 이미 앎).
4. `private.booth_mode_of(uuid)` → `coalesce(mode,'wait')`.
5. 쓰기 함수 교체(`CREATE OR REPLACE`, 인자·반환 모양 그대로라 권한 유지):
   `private.booth_op_set`, `public.booth_ctrl_set`, `public.admin_set_booth_live`
   - 새 p_mode `resv_open`(→ '예약중', 0분), `resv_closed`(→ '예약마감', 0분)
   - open은 wait 방식일 때만, resv_* 는 reserve 방식일 때만 받음. pause·closed·admin clear는 두 방식 모두에서 받음.
   - 맞지 않으면 `22023`, hint `booth_mode_mismatch`, "운영 방식이 바뀌었어요. 화면을 새로 고쳐 주세요."
   - 시작할 때 `pg_advisory_xact_lock(hashtext('booth_live_mode'), hashtext(booth_id::text))`로 부스 단위로 줄을 세움(2-int 키라 일괄 확인의 1-int 잠금과 겹치지 않음).
   - touch 두 함수는 그대로(지금 상태가 무엇이든 시각만 새로 함).
6. 새 함수(기존 함수는 그대로 둠)
   - `public.booth_session_mode(p_session text, p_mode text default null)`
   - `public.booth_ctrl_mode(p_token text, p_mode text default null)`
   - p_mode가 null이면 읽기만. 'wait'·'reserve'이면 전환. **현재와 같으면 아무것도 하지 않음**(응답을 잃고 다시 보내도 상태를 지우지 않게, 멱등).
   - 바꿀 때: 같은 잠금 → `booth_live` 그 부스 줄 DELETE → mode upsert → mode_log 기록.
   - 반환: `op_mode, mode_updated_at, congestion, wait_minutes, updated_at`. GET·HEAD를 거부하는 규칙은 기존 get 함수와 같게.
   - 인증·권한은 기존 set 함수와 같은 경로(`booth_session_resolve(..., true)` · 열쇠 검사)를 그대로 씀.
7. 23:00 초기화 · `admin_reset_booth_live` · `admin_confirm_booth_live`: **변경 없음**.
8. 되돌리기: 새 함수와 표 삭제 → '예약*' 상태 줄 DELETE → CHECK 원복 → 쓰기 함수 세 개를 지금 정의로 원복(지금 정의를 그대로 파일에 보관).

### 3-3. 공개 스냅샷 (`live/api/live-snapshot.mjs`)

- `booth_live_mode?select=booth_id,mode`를 `booth_live`와 함께 5초 주기로 읽음(아주 작은 표). 표가 없으면(PGRST205) 모두 wait → DB보다 먼저 배포돼도 안전.
- 부스마다 `opMode: 'wait'|'reserve'`를 더함.
- **옛 화면 호환**: `status`에는 기존 5개 값이나 null만 넣음. 예약 상태는 새 칸 `reserve: 'open'|'closed'`로 보내고 그 부스의 status는 null → 옛 화면에는 "정보 없음"으로만 보임.
- **이중 안전장치**: 방식이 reserve인데 대기 값(여유·보통·혼잡)이 있거나, wait인데 예약 값이 있으면 보내지 않음.

### 3-4. 관람객 화면 (booth-live)

| 운영 상태 | 목록(80px 칸 그대로) | 한눈에 칸 | QR 직접 진입(지금 계신 부스) |
|---|---|---|---|
| 현장대기 | 지금과 같음 | 지금과 같음 | 지금과 같음 |
| 예약 운영 중 | `현장`/`예약` 두 줄 | 시안 필요(예: 큰 글자 '예약', 작은 글자 '현장 예약') | '현장 예약 운영 중' |
| 예약 마감 | `예약`/`마감` 두 줄 | 시안 필요 | '현장 예약 마감' |
| 잠시 중단 | 잠시 중단 | 중단 | 잠시 중단 |
| 오늘 마감 | 마감 | 마감 | 마감 |

- 색: 예약 상태에 초록·노랑·빨강을 쓰지 않음(혼잡도로 읽히지 않게). 남색 글자에 중립 칠 — 시안으로 확인.
- 화면 읽기 문장(statusSpeech·tileLabel)도 같은 말로.
- 행 · 칸은 지금처럼 읽기 전용.

### 3-5. 운영자 화면 (booth-live)

- 부스 정보 머리 아래 높이가 고정된 두 칸 선택 줄 `현장대기 | 현장예약`.
- 단추판(`.pad`)의 박스 높이를 지금 8개 단추 판의 높이로 고정. 현장예약이면 같은 자리에 큰 단추 두 개 `예약 운영 중`·`예약 마감`. 그 아래 '운영 상태'(잠시 중단·오늘 운영 마감)는 위치·크기 그대로 → 전환해도 아래 요소가 움직이지 않음.
- '현재 대기' 판 제목은 현장예약이면 '현재 상태'로(같은 자리, 같은 높이).
- 전환 절차: 다른 칸을 누르면 **겹쳐 뜨는 확인창**(본문을 밀지 않음).
  "현장예약으로 바꿀까요? 지금 입력된 대기 상태가 지워져요. 바꾼 뒤 아래에서 지금 상태를 눌러 주세요."
- 저장 중에는 선택 줄을 '바꾸는 중'으로 잠그고, 성공 응답이 온 뒤에만 칸을 바꿈. 실패하면 원래 칸으로 두고 알림. 오프라인이면 전환을 받지 않음.
- 못 보낸 누름(pending)이 보내지는 중이면 전환을 막음. 전환에 성공하면 그 부스의 pending을 강제로 비움. pending에 `opMode`를 함께 적어, 방식이 다른 누름은 기기에서도 버림(서버 거부와 이중).
- 주기 읽기에 `booth_*_mode(null)`을 써서 다른 기기의 전환을 알아챔 → "다른 기기에서 운영 방식을 바꿨어요" 알림, pending 비움.
- 문구 손볼 곳: askHtml·valueLabel·nudge('N분 넘게 그대로예요…')·touch 오류 문구('먼저 대기 시간을…').
- `?demo=1`·`/example/` 예시 저장소: 방식 전환을 흉내 내거나 예시에서는 선택 줄을 숨김(결정 필요).

### 3-6. 관리 화면 (main)

- `booth-core.js`(main 판): STATES·META·bucket·deriveLive에 예약 두 값을 더함.
- `booth-admin.js`: 상태 'resv'(예약 운영 중·예약 마감)를 더하고 혼잡·대기 수에 넣지 않음. 방식 표시. 긴급 수정 단추를 방식에 맞게 바꿈.
- `print-qr.html` 직접 고치기: 방식에 맞는 단추만.
- `admin.js` 요약 색: 지금도 모르는 값은 'off'라 깨지지는 않음. 문구만 손봄.
- 관리자가 방식을 바꾸는 기능은 **1차에서 넣지 않음**(요구는 "각 부스 운영자가 직접"). 필요하면 2차.

---

## 4. 배포 순서 (각 단계마다 승인 필요)

1. DB 마이그레이션(사용자가 실행). 표가 비어 있으니 동작은 지금과 같음 — CHECK만 넓어짐.
2. `main` PR(관리 화면이 예약 값을 읽을 수 있게) → Pages.
3. `booth-live` PR(스냅샷 · 관람객 · 운영자). 설정 `boothReserveMode: false`면 선택 줄을 숨김 → Vercel.
4. 예시 부스나 실제 한 곳에서 실기기 확인 → 설정 켬 → Redeploy.
5. 문제가 생기면: 설정 끄기(선택 줄이 숨겨짐) → 필요하면 모든 방식을 wait로 되돌리는 SQL(준비해 둠) → 되돌리기 SQL.

---

## 5. 구현 단계

1. SQL: `supabase/migration-booth-live-mode.sql`, `rollback-booth-live-mode.sql`, 검증 쿼리(읽기 전용). 롤백만 하는 시험 스크립트(`begin … rollback`)를 같이 둠.
2. 스냅샷 + booth-core(booth-live 판): opMode·reserve 칸, 방어 규칙, 기존 응답 모양 유지.
3. 관람객: rightHtml·bigHtml·tileParts·statusSpeech·bucketOf·waitRank·counts.
4. 운영자: 선택 줄, 단추판 바꾸기, 확인창, 전환 흐름, pending·poll 연동, 문구.
5. main: booth-core(main 판)·booth-admin·print-qr·admin.
6. 시안(관람객 목록·한눈에·지금 계신 부스, 운영자 두 방식)을 먼저 보여 드린 뒤 다듬기.
7. 아래 검증 → PR 두 개(Draft) → 승인 뒤 병합.

---

## 6. 검증 시나리오

**DB (롤백 스크립트로)**
- D1 적용 직후: 84곳 모두 wait, `booth_live` 값·개수가 그대로.
- D2 wait에서 open·pause·closed — 지금과 같은 결과·기록.
- D3 reserve로 전환 → `booth_live` 줄이 지워지고 mode_log 1줄. 같은 전환을 다시 보내면 아무것도 바뀌지 않음.
- D4 reserve에서 open → 22023, resv_open·resv_closed·pause·closed는 됨.
- D5 wait로 다시 전환 → 줄이 지워짐(예전 대기 값이 살아나지 않음).
- D6 QR 열쇠 경로(booth_ctrl_set·mode)도 D2~D5와 같음. 다른 부스의 세션·열쇠로는 거부.
- D7 `rehearsal_live_reset()` 뒤 — mode는 남고 상태 줄만 없어짐.
- D8 `admin_set_booth_live` — reserve 부스에 open이면 거부, resv_*·clear는 됨. `admin_confirm_booth_live`는 예약 상태에서도 확인 기록이 남음.
- D9 동시성: 두 세션에서 전환과 open을 동시에 → 결과가 둘 중 하나로만 끝남("reserve + 대기값"이 남지 않음).
- D10 되돌리기 SQL 뒤 지금 정의와 같음(함수 정의 diff).

**운영자 화면**
- O1 전환 중 탭·단추 위치 측정(전환 전후 getBoundingClientRect 같음) — 375px·넓은 화면.
- O2 확인창에서 '아니요' → 아무것도 바뀌지 않음.
- O3 비행기 모드에서 전환 → 거부, 화면은 원래 방식 그대로.
- O4 대기 분을 오프라인으로 누른 뒤 다른 기기에서 현장예약으로 전환 → 연결되면 그 누름이 버려지고 알림, DB에 대기 값이 들어가지 않음.
- O5 두 기기(PIN·QR 하나씩): 한쪽 전환 → 다른 쪽이 다음 읽기에서 따라옴.
- O6 새로 고침·재접속 뒤 방식 유지. 23:00 뒤 방식은 유지되고 상태는 '아직 입력 전'.
- O7 '변동 없음 · 지금 확인'·20분 묻기·30분 확인 필요가 예약 상태에서도 맞는 문구로.

**관람객 화면**
- V1 목록 80px 칸 두 줄(현장/예약, 예약/마감)이 줄 높이를 바꾸지 않음(375px·320px).
- V2 한눈에 칸 · QR 직접 진입 · 화면 읽기 문장.
- V3 '지금 여유로운 부스' 숫자 · 상태 거르기 · 대기 정렬에서 예약 부스가 정해 둔 대로 빠지거나 놓임.
- V4 옛 화면(배포 전에 열어 둔 탭)이 새 스냅샷을 받으면 예약 부스는 '정보 없음'으로만 보임.
- V5 행사 전/당일 개장 전·운영 중·마감 뒤 때 규칙 그대로. 스냅샷 캐시 헤더 그대로.

**회귀**
- R1 기존 84곳·구역·QR·PIN·UUID 개수와 값이 그대로(전후 비교 쿼리).
- R2 booth-admin 15초 갱신 · 일괄 확인 · 긴급 수정 · print-qr 직접 고치기.
- R3 포털(main)의 대기 표시.

---

## 7. 결정해 주실 것

1. **전환 직후 상태**: (권장) 비워 둠 → 관람객에게는 '정보 없음', 운영자는 '예약 운영 중'을 한 번 누름. / 또는 전환하면서 바로 '예약 운영 중'(현장대기로 돌아갈 때는 비움).
2. **관람객 숫자·거르기**: (권장) 예약 부스는 '지금 여유로운 부스'와 여유·보통·혼잡 칩에서 빠지고 '전체'에서만 보임. 잠시 중단·오늘 마감은 지금처럼 '중단·마감'에 셈.
3. **대기순 정렬 자리**: (권장) 대기 있음 → 예약 운영 중 → 잠시 중단 → 정보 없음 → 예약 마감·오늘 마감.
4. **30분 '확인 필요'**: (권장) 예약 운영 중·예약 마감에도 적용(오늘 마감만 제외, 지금 규칙과 같음).
5. **리허설이 끝날 때(11-05 23:00) 방식 초기화**: 리허설 중에 바꾼 방식을 행사 날까지 둘지, 모두 현장대기로 되돌리는 SQL을 그때 한 번 돌릴지.
6. **예시 화면(?demo=1·/example/)**: 전환을 흉내 낼지, 선택 줄을 숨길지.
7. **일정**: (권장) 11-05 정오까지 실기기 확인을 끝내지 못하면 이번 행사에는 설정을 꺼 둔 채로 둠. DB 변경은 비어 있으면 동작이 같으므로 먼저 적용해도 됨.
