/* ===================================================================
   /api/notice-push — 운영자 알림을 휴대전화 시스템 알림(Web Push)으로도 보냄

   GET   → { enabled, publicKey }  운영자 화면이 [알림 받기] 를 보여 줄지 · 구독할 때 쓸 공개 열쇠(VAPID 공개 키)
   POST  { notice_id }  + Authorization: Bearer <관리자 로그인 토큰>
         관리자 화면이 알림을 보낸 직후 부릅니다. 이 함수는 관리자 권한을 따로 갖지 않습니다 —
         받은 관리자 토큰 그대로 Supabase 의 admin_notice_push_targets 를 불러(안에서 is_admin) 보낼 곳을 받고,
         푸시 서비스에 보낸 뒤 admin_notice_push_result 로 결과를 적습니다.
         보낼 곳은 서버(DB)가 정합니다: 그 알림을 받은 부스의, 지금도 유효한 QR 열쇠 · PIN 세션으로 등록한 기기만,
         아직 확인 · 시스템 알림 전인 곳만, 만료 전인 알림만. 이 함수는 부스 · 기기를 고르지 않습니다.

   비밀 열쇠: Vercel → Settings → Environment Variables 에만 둡니다(저장소 · 화면에 없음).
     NOTICE_PUSH_VAPID_PUBLIC   VAPID 공개 키(base64url · 65바이트 점)
     NOTICE_PUSH_VAPID_PRIVATE  VAPID 비밀 키(base64url · 32바이트) — 이것이 없으면 GET enabled false · POST 503
     NOTICE_PUSH_SUBJECT        연락처(mailto: 또는 https:) — 없으면 이 사이트 주소
   알림 내용은 알림 번호와 만료 시각뿐입니다(문구 · QR 열쇠 · PIN 세션 · 부스 정보 없음). 기기의 Service Worker 가
   ‘운영본부 알림 · 다시 확인해 주세요.’ 를 보여 주고, 누르면 운영자 화면이 서버에서 다시 읽습니다.
   외부 패키지 없이 node:crypto 로 RFC 8291(aes128gcm) · RFC 8292(VAPID ES256)를 씁니다.
   =================================================================== */
import { createECDH, createPrivateKey, createCipheriv, hkdfSync, randomBytes, sign } from 'node:crypto';
import { supabaseUrl, supabaseAnonKey } from '../lib/public-config.mjs';

const REST = supabaseUrl.replace(/\/+$/, '') + '/rest/v1/';
const ADMIN_ORIGIN = 'https://sinjhon1245-cell.github.io';   // 관리자 화면(GitHub Pages)에서만 부름
const TIMEOUT_MS = 6000;
const MAX_TTL = 30 * 60;
// 브라우저 푸시 서비스 주소만(DB 의 booth_push_op 와 같은 목록)
const PUSH_HOST = /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.samsungosp\.com)\//;

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s || ''), 'base64url');

export function vapidKeys(env = process.env) {
  const pub = String(env.NOTICE_PUSH_VAPID_PUBLIC || '').trim();
  const priv = String(env.NOTICE_PUSH_VAPID_PRIVATE || '').trim();
  const p = unb64u(pub), d = unb64u(priv);
  if (p.length !== 65 || p[0] !== 4 || d.length !== 32) return null;
  const key = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(p.subarray(1, 33)), y: b64u(p.subarray(33, 65)), d: b64u(d) }, format: 'jwk' });
  return { pub, key, subject: String(env.NOTICE_PUSH_SUBJECT || '').trim() || 'https://incheon-live.vercel.app' };
}

// VAPID(RFC 8292) — 받는 푸시 서비스(aud)에만 맞는 12시간짜리 서명
export function vapidHeader(endpoint, keys, now = Date.now()) {
  const enc = (o) => b64u(Buffer.from(JSON.stringify(o)));
  const data = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject });
  const sig = sign('sha256', Buffer.from(data), { key: keys.key, dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + data + '.' + b64u(sig) + ', k=' + keys.pub;
}

// 내용 암호화(RFC 8291 · RFC 8188 aes128gcm, 기록 하나)
// salt · ecdh 는 시험에서만 넘깁니다(평소에는 보낼 때마다 새로 만듦).
export function encrypt(payload, p256dh, auth, salt = randomBytes(16), ecdh = null) {
  const ua = unb64u(p256dh), secret = unb64u(auth);
  if (ua.length !== 65 || secret.length !== 16) throw new Error('bad subscription keys');
  if (!ecdh) { ecdh = createECDH('prime256v1'); ecdh.generateKeys(); }
  const as = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(ua);
  const ikm = Buffer.from(hkdfSync('sha256', shared, secret, Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = 65;
  return Buffer.concat([head, as, body]);
}

async function sendOne(t, keys, noticeId) {
  if (!PUSH_HOST.test(String(t.endpoint || ''))) return 400;
  const exp = Date.parse(t.expires_at);
  const ttl = Math.max(0, Math.min(MAX_TTL, Math.floor((exp - Date.now()) / 1000)));
  if (!ttl) return 0;
  const body = encrypt(JSON.stringify({ n: noticeId, e: exp }), t.p256dh, t.auth);
  try {
    const res = await fetch(t.endpoint, {
      method: 'POST',
      headers: { Authorization: vapidHeader(t.endpoint, keys), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
        TTL: String(ttl), Urgency: 'high', Topic: 'n' + noticeId },
      body, signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    return res.status;
  } catch { return 0; }
}

async function rpc(name, args, bearer) {
  const res = await fetch(REST + 'rpc/' + name, {
    method: 'POST',
    headers: { apikey: supabaseAnonKey, Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(args), signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) { const e = new Error('rpc ' + res.status); e.status = res.status; e.code = data && data.code; throw e; }
  return data;
}

function cors(request) {
  const o = request.headers.get('origin');
  return o === ADMIN_ORIGIN ? { 'Access-Control-Allow-Origin': o, Vary: 'Origin' } : { Vary: 'Origin' };
}
function reply(request, status, obj, extra) {
  return new Response(JSON.stringify(obj), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...cors(request), ...extra } });
}

export default {
  async fetch(request) {
    const keys = vapidKeys();
    if (request.method === 'GET') return reply(request, 200, { enabled: !!keys, publicKey: keys ? keys.pub : null });
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors(request), 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Max-Age': '600' } });
    }
    if (request.method !== 'POST') return reply(request, 405, { error: 'method' }, { Allow: 'GET, POST, OPTIONS' });
    const origin = request.headers.get('origin');
    if (origin && origin !== ADMIN_ORIGIN) return reply(request, 403, { error: 'origin' });
    if (!keys) return reply(request, 503, { error: 'off' });
    const m = /^Bearer\s+([A-Za-z0-9._-]{20,4096})$/.exec(request.headers.get('authorization') || '');
    if (!m) return reply(request, 401, { error: 'auth' });
    let id = 0;
    try { id = Number((await request.json()).notice_id); } catch { id = 0; }
    if (!Number.isSafeInteger(id) || id <= 0) return reply(request, 400, { error: 'notice_id' });

    let targets;
    try { targets = await rpc('admin_notice_push_targets', { p_notice_id: id }, m[1]); }
    catch (e) { return reply(request, e.status === 401 || e.status === 403 ? 403 : 502, { error: 'targets', code: e.code || '' }); }
    if (!Array.isArray(targets) || !targets.length) return reply(request, 200, { ok: true, booths: 0, sent: 0, gone: 0, failed: 0 });

    const statuses = await Promise.all(targets.slice(0, 500).map((t) => sendOne(t, keys, id)));
    const results = targets.slice(0, 500).map((t, i) => ({ sub_id: t.sub_id, booth_id: t.booth_id, status: statuses[i] }));
    let r = null;
    try { r = await rpc('admin_notice_push_result', { p_notice_id: id, p_results: results }, m[1]); }
    catch (e) { console.error('[notice-push] result', e.status || '', e.code || ''); }
    const booths = new Set(results.filter((x) => x.status >= 200 && x.status < 300).map((x) => x.booth_id)).size;
    console.log('[notice-push]', { notice: id, subs: results.length, booths });
    return reply(request, 200, { ok: true, booths, sent: r ? r.sent : null, gone: r ? r.gone : null, failed: r ? r.failed : null });
  }
};
