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

   두 값이 비어 있으면 사이트는 "서버에 연결할 수 없습니다" 화면만
   보여 줍니다. 데이터를 꾸며내지 않습니다.
   =================================================================== */
window.FESTIVAL_CONFIG = {
  supabaseUrl: 'https://ynixjjqozkbzxjmishbe.supabase.co',
  supabaseAnonKey: 'sb_publishable_qNRplAPHrlJOhOapAR6ybQ_fwOxKgzR'
};