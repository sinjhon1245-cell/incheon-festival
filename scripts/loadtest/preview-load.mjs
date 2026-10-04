#!/usr/bin/env node
/* ===================================================================
   Preview 저단계 부하 시험 — 관람객 N명이 /api/live-snapshot 을 읽는 모양 그대로

     node scripts/loadtest/preview-load.mjs <Preview 주소> <관람객 수> <초> [쿠키]

   관람객 한 명 = 처음 0~20초 사이 아무 때나 한 번, 그 뒤 20초 ±4초마다 한 번
   (visitor.html 과 같은 간격). 결과로 상태 코드 · x-vercel-cache(HIT/MISS/STALE …) ·
   지연 p50/p95/p99 · 서로 다른 generatedAt 개수(= 함수가 Supabase 를 새로 읽은 횟수의
   상한)를 냅니다.

   Production 에는 돌리지 않습니다. Production 주소(incheon-live.vercel.app)나
   Supabase 주소를 주면 멈춥니다. 쿠키는 Vercel 보호를 넘는 임시 공유 링크가 준
   _vercel_jwt 같은 값이며, 화면에 찍지 않습니다.
   의존성 없음 (Node 18+).
   =================================================================== */
const [base, usersArg, secsArg, cookie] = process.argv.slice(2);
if (!base || !usersArg) {
  console.error('쓰는 법: node scripts/loadtest/preview-load.mjs <Preview 주소> <관람객 수> <초> [쿠키]');
  process.exit(2);
}
const host = new URL(base).hostname;
if (host === 'incheon-live.vercel.app' || host.endsWith('supabase.co') || !host.endsWith('.vercel.app')) {
  console.error('멈춤: Preview(*.vercel.app, Production 별칭 아님) 주소만 받습니다: ' + host);
  process.exit(2);
}
const URL_ = new URL('/api/live-snapshot', base).href;
const USERS = Number(usersArg), SECS = Number(secsArg || 60);
const headers = { Accept: 'application/json' };
if (cookie) headers.Cookie = cookie;

const res = { n: 0, status: {}, cache: {}, source: {}, gen: new Set(), lat: [], err: 0 };
const t0 = Date.now(), end = t0 + SECS * 1000;

async function one() {
  const t = Date.now();
  try {
    const r = await fetch(URL_, { headers, redirect: 'manual' });
    const body = await r.text();
    res.lat.push(Date.now() - t);
    res.n++;
    res.status[r.status] = (res.status[r.status] || 0) + 1;
    const c = r.headers.get('x-vercel-cache') || '-';
    res.cache[c] = (res.cache[c] || 0) + 1;
    const s = r.headers.get('x-snapshot-source') || '-';
    res.source[s] = (res.source[s] || 0) + 1;
    try { const g = JSON.parse(body).generatedAt; if (g) res.gen.add(g); } catch { /* 본문이 JSON 이 아님 */ }
  } catch {
    res.err++;
  }
}

function user() {
  const loop = () => {
    if (Date.now() >= end) return Promise.resolve();
    return one().then(() => new Promise((r) => setTimeout(r, 16000 + Math.random() * 8000))).then(loop);
  };
  return new Promise((r) => setTimeout(r, Math.random() * 20000)).then(loop);
}

await Promise.all(Array.from({ length: USERS }, user));
const secs = (Date.now() - t0) / 1000;
const q = (p) => { const a = res.lat.slice().sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN; };
console.log(JSON.stringify({
  url: URL_, users: USERS, seconds: Math.round(secs), requests: res.n, errors: res.err,
  rps: +(res.n / secs).toFixed(1), status: res.status, xVercelCache: res.cache, xSnapshotSource: res.source,
  distinctGeneratedAt: res.gen.size, p50: q(0.5), p95: q(0.95), p99: q(0.99)
}, null, 2));
