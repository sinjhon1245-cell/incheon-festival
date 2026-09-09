/* ===================================================================
   Supabase 연결 정보
   ───────────────────────────────────────────────────────────────────
   Supabase 대시보드 → 왼쪽 아래 Project Settings → Data API 에서
   두 값을 복사해 아래에 붙여넣으세요.

     Project URL   →  supabaseUrl
     anon public   →  supabaseAnonKey

   ⚠️ anon 키만 넣으세요. service_role 키는 절대 넣으면 안 됩니다.
      anon 키는 공개되어도 되는 값이고(브라우저에 노출되도록 설계된 키),
      실제 권한은 데이터베이스의 RLS 정책이 막습니다.
      service_role 키는 그 정책을 전부 무시하는 마스터 키라,
      이 파일에 넣으면 누구나 데이터를 지울 수 있게 됩니다.

   두 값이 비어 있으면 사이트는 assets/fallback-data.js 의 내용으로
   그냥 동작합니다. 그래서 Supabase를 아직 안 만드셨어도 괜찮습니다.
   =================================================================== */
window.FESTIVAL_CONFIG = {
  supabaseUrl: 'https://ynixjjqozkbzxjmishbe.supabase.co',
  supabaseAnonKey: 'sb_publishable_qNRplAPHrlJOhOapAR6ybQ_fwOxKgzR',

  // 관리자 계정 이메일. 적어 두면 로그인 화면에서 이메일 칸이 사라지고
  // 비밀번호만 입력하면 됩니다. (비워 두면 이메일도 함께 입력)
  adminEmail: 'aifest@ice.go.kr'
};
