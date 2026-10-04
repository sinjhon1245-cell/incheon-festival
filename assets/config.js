/* ===================================================================
   Supabase 연결 정보
   ───────────────────────────────────────────────────────────────────
   Supabase 대시보드 → 왼쪽 아래 Project Settings 에서 두 값을 복사해
   아래에 붙여넣으세요.

     Data API → Project URL                       →  supabaseUrl
     API Keys → Publishable key (sb_publishable_…) →  supabaseAnonKey

   ⚠️ 공개용 키만 넣으세요. Secret key(sb_secret_…)와 service_role 키는
      절대 넣으면 안 됩니다. 공개용 키는 공개되어도 되는 값이고(브라우저에
      노출되도록 설계된 키), 실제 권한은 데이터베이스의 RLS 정책이 막습니다.
      secret · service_role 키는 그 정책을 전부 무시하는 마스터 키라,
      이 파일에 넣으면 누구나 데이터를 지울 수 있게 됩니다.
      예전(Legacy) 키 탭에는 anon public 과 service_role 이 나란히 있어
      헷갈리기 쉽습니다. 관람객 사이트 빌드(live/build.sh)는 Publishable
      key 와 예전 anon 키만 받고, 그 밖의 키가 들어 있으면 멈춥니다.

   두 값이 비어 있으면 사이트는 "서버에 연결할 수 없습니다" 화면만
   보여 줍니다. 데이터를 꾸며내지 않습니다.
   =================================================================== */
window.FESTIVAL_CONFIG = {
  /* 부스 Live 사이트를 만들 때 live/build.sh 가 이 두 줄(과 아래 boothHelpLine ·
     맨 아래 두 숫자)을 한 줄씩 읽어 갑니다. 이름: '값', 모양을 한 줄에 그대로 두세요.
     여러 줄로 나누면 그 빌드가 멈춥니다 — 빈 설정으로 배포되는 것보다 낫습니다. */
  supabaseUrl: 'https://ynixjjqozkbzxjmishbe.supabase.co',
  supabaseAnonKey: 'sb_publishable_qNRplAPHrlJOhOapAR6ybQ_fwOxKgzR',

  /* 관리자 아이디에 붙일 도메인.
     관리자는 로그인 화면에 aisw01 처럼 아이디만 칩니다.
     Supabase Auth 는 이메일로만 로그인하므로, 화면에서
     aisw01 → aisw01@aisw.local 로 바꿔 보냅니다.

     이 값은 비밀이 아닙니다. 계정 주소는 어차피 짐작할 수 있고,
     실제로 막는 것은 비밀번호입니다. @ 가 들어간 값을 치면
     그대로 쓰므로 기존 이메일 계정도 그대로 로그인됩니다.

     ⚠️ 바꾸려면 scripts/create-admin-users.mjs 의 ID_DOMAIN 도
        같이 바꿔야 합니다. 두 값이 어긋나면 로그인되지 않습니다. */
  adminIdDomain: 'aisw.local',

  /* ── 부스 실시간 대기 현황 ─────────────────────────────────────
     부스 Live 사이트(live/)에는 이 파일을 그대로 올리지 않습니다.
     live/build.sh 가 supabaseUrl · supabaseAnonKey · pollingIntervalMs ·
     freshnessThresholdMinutes · boothHelpLine 만 골라 새 설정 파일을
     만듭니다. 관리자 도메인이 관람객 휴대폰까지 가지 않게 하려는 것입니다.

     사이트는 둘입니다.
       운영 포털       index.html · admin.html · print-qr.html (QR 인쇄)
       부스 Live 사이트  관람객 화면(첫 화면) + 부스 운영자 화면(booth-ctrl.html)
     QR 인쇄는 관리자 로그인이 필요해 운영 포털에서 하고, 종이에 찍히는
     QR 은 관람객용 · 운영자용 모두 부스 Live 사이트를 가리킵니다.
     그래서 아래 두 주소에는 같은 값(부스 Live 사이트 주소)이 들어갑니다. */

  /* 부스 Live 사이트 주소 — 관람객 QR(부스 앞 안내 · 입구 포스터)이 가리킵니다.
     Vercel 프로젝트 incheon-live 의 운영(Production) 주소입니다. 2026-10-03 에
     첫 화면(/) · 운영자 화면(booth-ctrl.html) 이 열리는 것을 확인하고 채웠습니다.
     미리 보기(preview) 배포 주소는 넣지 않습니다 — 배포마다 바뀝니다.
     주소를 짐작해 바꾸지 마세요 — 없는 주소가 찍힌 QR 은 인쇄해 붙인 뒤에는
     되돌릴 수 없습니다.
     비어 있거나, https 가 아니거나, 내 컴퓨터 주소이거나, 운영 포털 주소
     (Netlify · 그 미리 보기 배포 · GitHub Pages · 인쇄하는 페이지 자신)이면
     인쇄 화면이 관람객용 QR 을 만들지 않습니다 — 관람객이 운영 포털 주소를
     알게 되면 안 되기 때문입니다.
     사이트 첫 화면 주소를 / 로 끝나게 적습니다(…/index.html 이 아니라 …/).
     (부스 Live 사이트에 올라가는 설정 파일에는 원본 값과 관계없이 './' 가
     들어갑니다. 운영자 화면의 '관람객 화면' 링크가 같은 사이트의 첫 화면으로
     가게 하려는 것입니다.) */
  visitorSiteUrl: 'https://incheon-live.vercel.app/',

  /* 운영자 카드 QR 이 가리킬 주소 — 이것도 부스 Live 사이트 주소입니다.
     카드의 QR 은 '이 주소 + booth-ctrl.html#k=열쇠' 가 됩니다. 부스 운영자
     화면은 부스 Live 사이트에 함께 올라가므로 visitorSiteUrl 과 같은 값을
     넣습니다(이름에 staff 가 붙었지만 운영 포털 주소가 아닙니다).
     짐작한 주소로 찍은 카드는 되돌릴 수 없습니다.
     비어 있거나 https 가 아니거나 내 컴퓨터 주소이면 인쇄 화면이 운영자
     카드를 만들지 않습니다. */
  staffSiteUrl: 'https://incheon-live.vercel.app/',

  /* 운영자 화면의 오류 안내와 운영자 카드에 붙는 도움 요청 한 줄.
     QR 이 안 열리거나 카드를 잃어버렸을 때 어디로 가면 되는지 적습니다.
     예: '운영본부: 1층 본부석'
     부스 Live 사이트 빌드가 이 줄을 그대로 옮겨 적습니다. 한 줄에 작은따옴표로
     적고, 글 안에 작은따옴표 · 역슬래시(\)는 넣지 마세요(넣으면 빌드가 멈춥니다). */
  boothHelpLine: '운영본부에 문의해 주세요',

  /* 관람객 화면이 대기 현황을 다시 읽는 간격(밀리초). 기본 60000(60초 ±10초).
     실시간 연결(Realtime) 대신 이 간격으로 읽습니다. Realtime 은 입력
     한 번이 보고 있는 사람 수만큼 메시지가 되어 요금제 한도에 금방
     닿습니다. 관람객 한 번 읽기가 Vercel 요청 1건(무료 플랜은 월 100만 건)
     이라 줄이면 그만큼 한도가 빨리 닳습니다. 15000 보다 작으면 관람객
     사이트 빌드가 멈춥니다. 행사 당일에 더 늦추려면 이 값 대신 Vercel 의
     VISITOR_TRAFFIC_MODE(conserve · manual)를 씁니다(재배포만, 코드 그대로).
     숫자 하나만 적으세요(20 * 1000 · 20_000 같은 모양은 빌드가 읽지
     못해 멈춥니다). */
  pollingIntervalMs: 60000,

  /* 부스 대기 시간이 이 시간(분) 넘게 바뀌지 않으면 숫자를 흐리게
     보여 줍니다. 오래된 대기 시간을 사실처럼 보이지 않게 합니다.
     '마감' 은 그날 안에는 흐려지지 않습니다. 숫자 하나만, 5 이상. */
  freshnessThresholdMinutes: 30
};
