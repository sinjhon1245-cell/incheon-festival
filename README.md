# 2026년 인천 AI·SW미래채움 교육페스티벌 — 행사 운영 포털

행사 관계자가 **준비 단계와 행사 당일 스마트폰으로 실제로 사용하는 운영 포털**입니다.
일반 관람객용 홍보 사이트가 아니라, 지금 무엇이 진행 중인지·어떤 부스에 문제가 있는지·
누구에게 연락해야 하는지를 빠르게 찾는 것이 목적입니다.

로그인하지 않으면 아무 운영정보도 보이지 않습니다.

- 공개 주소: https://incheon-aisw-festival.netlify.app/
- 관리자: `/admin.html` (관리자 권한 계정만)

## 기술 구조

빌드 도구가 없는 **정적 HTML·CSS·JS + Supabase** 구조입니다.
`index.html` 을 정적 호스팅에 올리면 그대로 동작합니다.

```
index.html            관계자 포털 (로그인 게이트 + 앱 셸)
admin.html            운영 콘텐츠 관리자(CMS)
netlify.toml          배포 설정 · 보안 헤더

assets/
  config.js           ★ Supabase 주소 · publishable 키 (직접 채우는 유일한 파일)
  core.js             Supabase 연결 · 인증 · 데이터 접근 공통 계층
  portal.js           포털 화면과 동작
  portal.css          디자인 토큰과 스타일 (관리자도 함께 씀)
  ui.js               공용 모달·확인 대화상자 (prompt/confirm 대체)
  admin.js            관리자 CRUD 엔진
  admin.css           관리자 전용 추가 스타일

supabase/
  schema.sql            최초 설치용 기본 표
  migration-portal.sql  ★ 운영 포털 마이그레이션 (반드시 실행)
  fix-policies.sql      RLS 점검·복구용 (문제 있을 때만)
  functions/invite-staff/  관계자 초대 Edge Function

dev-server.js         로컬 확인용 정적 서버 (배포에는 불필요)
design/               원본 디자인 파일 (참고용)
```

## 화면 구성

| 메뉴 | 내용 |
|---|---|
| 대시보드 | D-day·진행 상태, 운영 숫자 8종, 긴급 공지, 지금/다음 일정 |
| 일정 | 시간순 타임라인, 분류 필터, 검색, 현재 일정 자동 강조 |
| 부스 현황 | 상태·구역 필터, 검색, 상세 드로어에서 상태 변경 |
| 공지 | 긴급/중요/일반, 고정 공지, 상세 보기 |
| 운영 요청 | 현장 문제 보고 등록, 처리 상태 추적 |
| 자료실 | 운영 문서 링크 |
| 연락망 | 검색·카테고리 필터, 모바일 전화 걸기 |
| 행사장 | 배치도와 주요 공간 |
| 운영 FAQ | 관계자용 아코디언 |

모바일에서는 하단 고정 탭(홈·일정·부스·공지·더보기), PC에서는 좌측 사이드바를 씁니다.

## Supabase 설정

### 1. 연결 정보

`assets/config.js` 에 Supabase **Project URL** 과 **publishable(anon) 키**를 넣습니다.

```js
window.FESTIVAL_CONFIG = {
  supabaseUrl: 'https://xxxxx.supabase.co',
  supabaseAnonKey: 'sb_publishable_...'
};
```

> ⚠️ `service_role` 또는 secret 키는 **절대** 넣지 않습니다.
> publishable 키는 브라우저에 노출되도록 설계된 공개 키이고,
> 실제 권한은 데이터베이스의 RLS 정책이 막습니다.

이 파일은 저장소에 커밋되어 Netlify 배포본에도 함께 올라갑니다.
`.gitignore` 에 넣으면 배포본에서 “서버에 연결할 수 없습니다”가 뜹니다.

### 2. 스키마 실행

Supabase 대시보드 → **SQL Editor** 에서 순서대로 실행합니다.

1. `supabase/schema.sql` — 처음 설치할 때만
2. `supabase/migration-portal.sql` — **운영 포털에 반드시 필요**

마이그레이션은 기존 표를 지우지 않고 운영용 칼럼을 덧붙이며,
`staff_profiles` · `notices` · `operation_requests` · `resources` ·
`contacts` · `venue_places` 를 새로 만듭니다. 여러 번 실행해도 안전합니다.

### 3. 계정 만들기

**관리자 계정**

1. Supabase → **Authentication → Users → Add user**
   (이메일·비밀번호 입력, *Auto Confirm User* 켜기)
2. `migration-portal.sql` 이 `aifest@ice.go.kr` 을 자동으로 관리자로 등록합니다.
   다른 주소를 쓰면 마이그레이션 파일 마지막의 이메일을 바꾸세요.

**관계자(staff) 계정**

관리자 → **계정·권한** → `+ 관계자 초대` 에서 이메일·이름·소속/팀·
연락처·권한만 입력하면 됩니다. UUID 를 직접 다룰 필요가 없습니다.
(아래 “관계자 초대 기능 배포”가 선행되어야 합니다.)

> 이 포털에는 회원가입이 없습니다. `staff_profiles` 에 줄이 없는 계정은
> 로그인에 성공해도 **아무 데이터도 볼 수 없고 즉시 로그아웃됩니다.**
> 계정 생성만으로 내부 정보가 열리지 않게 하는 잠금장치입니다.

### 관계자 초대 기능 배포 (Edge Function)

관리자에서 `+ 관계자 초대`로 계정을 만들려면 Edge Function 한 개를
배포해야 합니다. Auth 사용자 생성에는 `service_role` 키가 필요한데,
그 키는 브라우저에 두면 안 되기 때문입니다.

```bash
npm i -g supabase
supabase login
supabase link --project-ref ynixjjqozkbzxjmishbe
supabase functions deploy invite-staff
supabase secrets set SERVICE_ROLE_KEY=<service_role 키>
```

`service_role` 키는 **Function Secret 에만** 넣습니다. 저장소에 커밋하거나
`assets/config.js` 에 넣지 마세요.

배포 전에도 관리자 화면은 정상 동작하며, 계정 목록은 데이터베이스
기준으로 표시되고 초대 버튼만 안내 문구와 함께 실패합니다.

함수가 하는 일:

1. 호출자가 admin 인지 확인 (아니면 403)
2. Auth 사용자 초대 또는 생성
3. 받은 UUID 로 `staff_profiles` 자동 생성
4. 이름·팀·연락처·권한 저장

메일 발송이 막힌 프로젝트에서는 초대 대신 임시 비밀번호를 발급하고
관리자 화면에 한 번만 보여 줍니다.

마지막 남은 admin 계정은 삭제와 권한 강등이 서버에서 차단됩니다.

### 권한 구조

| | admin | staff |
|---|---|---|
| 전체 데이터 열람 | ✔ | ✔ |
| 운영 요청 등록 | ✔ | ✔ |
| 부스 상태 변경 | ✔ | ✔ |
| 일정·공지·자료실·연락망·FAQ 편집 | ✔ | — |
| 운영 요청 상태 변경 | ✔ | — |
| 계정·권한 관리 | ✔ | — |
| 관리자 페이지 접근 | ✔ | — |

데이터베이스의 RLS 가 강제하므로, 관리자 주소를 알아내도 권한이 없으면
아무것도 바꿀 수 없습니다.

## 로컬 실행

```bash
node dev-server.js
```

`http://localhost:8321` 로 접속합니다. Supabase 는 원격이라 로컬에서도
실제 데이터로 동작합니다.

## 데이터 수정 방법

행사 내용은 **모두 관리자 화면에서** 고칩니다. 코드를 만질 필요가 없습니다.

| 고칠 내용 | 위치 |
|---|---|
| 행사명·일시·장소·배치도 주소 | 관리자 → 행사 기본정보 |
| 운영 일정 | 관리자 → 일정 관리 |
| 부스와 담당자 | 관리자 → 부스 관리 |
| 공지 | 관리자 → 공지 관리 |
| 운영 요청 처리 | 관리자 → 운영 요청 관리 |
| 자료·연락망·행사장·FAQ | 각 관리 메뉴 |

## 실제 행사 정보 입력 위치

현재 들어 있는 일정·부스·주소 등은 **기능 확인용 예시 데이터**입니다.
확정된 정보로 바꿔야 하는 항목입니다.

- **행사 장소·주소** — 관리자 → 행사 기본정보
- **배치도 이미지** — 행사 기본정보의 “배치도 이미지 주소”.
  비어 있으면 포털에 “배치도 준비 중”으로 표시됩니다.
- **운영 일정** — 시작·종료 시각은 `HH:MM` 형식이어야 현재 일정 강조가 동작합니다.
- **부스 목록과 담당자 연락처**
- **운영 연락망** — 전화번호는 로그인한 관계자에게만 보입니다.
- **자료실 링크**

확인되지 않은 값을 사실처럼 채우지 마세요. 비워 두면 화면에
“미정 / 준비 중”으로 표시되도록 만들어 두었습니다.

## Netlify 배포

GitHub `main` 브랜치에 push 하면 자동 배포됩니다.
`netlify.toml` 이 publish 경로와 보안 헤더(noindex 포함)를 지정합니다.

빌드 명령이 없는 정적 사이트라 환경변수 설정은 필요 없습니다.
Supabase 연결 정보는 `assets/config.js` 로 함께 배포됩니다.

## 문제가 생겼을 때

| 증상 | 확인할 곳 |
|---|---|
| “서버에 연결할 수 없습니다” | `assets/config.js` 값이 비었거나 `.gitignore` 에 걸렸는지 |
| 로그인은 되는데 바로 로그아웃됨 | `staff_profiles` 에 해당 계정 줄이 있는지 |
| “데이터베이스가 최신 구조가 아닙니다” | `migration-portal.sql` 실행 여부 |
| 저장·삭제가 “0건” | 로그인 만료 → 재로그인. 그래도 안 되면 `fix-policies.sql` |
| 관리자에서 “권한 없음” | `staff_profiles.role` 이 `admin` 인지 |
| 배포본만 옛 화면 | Netlify 최신 배포 로그와 캐시 확인 |

자세한 오류는 브라우저 개발자도구 콘솔에 `[portal]` · `[admin]` 으로 남습니다.
