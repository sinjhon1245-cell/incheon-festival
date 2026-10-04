/* ===================================================================
   Preview 저단계 부하 시험 — 브라우저 탭 안에서 돌리는 판

   Preview 는 Vercel 인증 뒤에 있고, 인증 쿠키는 브라우저가 들고 있습니다(HttpOnly —
   꺼내지 않습니다). 그래서 로그인한 브라우저의 Preview 탭(같은 출처, 예: /robots.txt)
   개발자 도구 콘솔에 이 파일 내용을 붙여 넣고 돌립니다. Node 판은 preview-load.mjs.

     await runLoad(100, 180)     // 관람객 100명 · 3분
     await runLoad(1000, 180)
     await runLoad(3000, 180)

   관람객 한 명 = 처음 0~60초 사이 한 번, 그 뒤 60초 ±10초(normal)마다 /api/live-snapshot 하나
   (visitor.html 과 같은 간격). Production 주소에서는 돌지 않습니다.
   결과: 요청 수 · RPS · 상태 코드(4xx · 429 · 5xx) · x-vercel-cache(HIT/STALE/MISS) ·
   p50/p95/p99 · 서로 다른 generatedAt 수(함수가 Supabase 를 새로 읽은 횟수의 상한).
   Supabase 쪽 실제 요청 수는 시험 시각으로 Supabase 기록(edge_logs, user agent 'node')을 셉니다.
   =================================================================== */
async function runLoad(users, seconds, POLL_S = 60) { // POLL_S: 받는 간격(초) — conserve 를 보려면 120
  if (location.hostname === 'incheon-live.vercel.app' || !/\.vercel\.app$/.test(location.hostname)) {
    throw new Error('Preview(*.vercel.app, Production 별칭 아님)에서만 돌립니다: ' + location.hostname);
  }
  const res = { n: 0, err: 0, status: {}, cache: {}, gen: new Set(), lat: [] };
  const end = Date.now() + seconds * 1000;
  const startedAt = new Date().toISOString();
  async function one() {
    const t = performance.now();
    try {
      const r = await fetch('/api/live-snapshot');
      const body = await r.text();
      res.lat.push(performance.now() - t);
      res.n++;
      res.status[r.status] = (res.status[r.status] || 0) + 1;
      const c = r.headers.get('x-vercel-cache') || '-';
      res.cache[c] = (res.cache[c] || 0) + 1;
      try { const g = JSON.parse(body).generatedAt; if (g) res.gen.add(g); } catch (e) { /* JSON 아님 */ }
    } catch (e) { res.err++; }
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function user() {
    await sleep(Math.random() * POLL_S * 1000);
    while (Date.now() < end) {
      await one();
      const wait = POLL_S * 1000 * (5 / 6 + Math.random() / 3);
      if (Date.now() + wait >= end) break; // 끝 시각을 넘기는 대기는 하지 않습니다
      await sleep(wait);
    }
  }
  await Promise.all(Array.from({ length: users }, user));
  const a = res.lat.slice().sort((x, y) => x - y);
  const q = (p) => (a.length ? Math.round(a[Math.min(a.length - 1, Math.floor(p * a.length))]) : null);
  const by = (lo, hi) => Object.keys(res.status).filter((s) => +s >= lo && +s < hi).reduce((s, k) => s + res.status[k], 0);
  return {
    users, seconds, startedAt, endedAt: new Date().toISOString(),
    requests: res.n, networkErrors: res.err, rps: +(res.n / seconds).toFixed(1),
    status: res.status, s4xx: by(400, 500), s429: res.status[429] || 0, s5xx: by(500, 600),
    xVercelCache: res.cache, distinctGeneratedAt: res.gen.size, p50: q(0.5), p95: q(0.95), p99: q(0.99)
  };
}
