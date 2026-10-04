/* 관람객 스냅샷 함수(live/api/live-snapshot.mjs)가 읽는 Supabase 공개 연결 정보.
   assets/config.js 의 supabaseUrl · supabaseAnonKey 와 같아야 합니다 — 다르면
   live/build.sh 가 빌드를 멈춥니다(함수는 빌드 전에 묶여 config.js 를 직접 읽지 못합니다).
   공개용(Publishable) 키만 둡니다. secret · service_role 키는 절대 넣지 마세요.
   실제 권한은 데이터베이스의 RLS 정책이 막습니다(관람객 브라우저가 쓰던 것과 같은 키). */
export const supabaseUrl = 'https://ynixjjqozkbzxjmishbe.supabase.co';
export const supabaseAnonKey = 'sb_publishable_qNRplAPHrlJOhOapAR6ybQ_fwOxKgzR';
