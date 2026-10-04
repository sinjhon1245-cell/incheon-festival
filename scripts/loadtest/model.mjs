#!/usr/bin/env node
/* ===================================================================
   부스 Live 부하 모델 — 측정이 아니라 계산입니다

   Production 에 부하를 걸지 않고, 관람객 화면 코드의 되풀이 규칙을
   그대로 흉내 내어 단계별(100 … 100,000명) 요청량과 오류를 셉니다.

     A  Phase 1(이전)  관람객 브라우저 → Supabase REST 를 바로 부름
                       (cache:'no-store', CDN 없음, 실패 뒤 10초 고정 재시도)
                       → 관람객 하나하나를 흉내 내는 시뮬레이션
     B  Phase 2(지금)  관람객 브라우저 → Vercel CDN → /api/live-snapshot 함수 → Supabase
                       (live/api/live-snapshot.mjs · visitor.html 의 값 그대로)
                       → 식으로 계산(Supabase 요청이 관람객 수와 무관해짐)
                       운영자 · 관리자는 두 구조 모두 Supabase 직접.

   숫자는 모두 '가정' 위에 서 있습니다. 가장 큰 가정은 Supabase 가 오류 없이
   받아 내는 초당 요청 수(--capacity, 기본 400)입니다. 스테이징(복제 프로젝트)에서
   잰 값으로 바꿔 다시 돌리세요. README.md(이 폴더) 에 가정과 읽는 법이 있습니다.

   쓰는 법
     node scripts/loadtest/model.mjs                    전체 표 (markdown)
     node scripts/loadtest/model.mjs --capacity=900     Supabase 처리 한도를 바꿔서
     node scripts/loadtest/model.mjs --open-every=300   관람객이 페이지를 더 자주 새로 열 때
     node scripts/loadtest/model.mjs --booths=30        부스 수
     node scripts/loadtest/model.mjs --quick            임계점 탐색 생략(빠름)
   의존성 없음 (Node 18+). 네트워크를 쓰지 않습니다.
   =================================================================== */
import { gzipSync } from 'node:zlib';

const opt = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
  if (m) opt[m[1]] = m[2] === undefined ? true : m[2];
}
const num = (k, d) => (opt[k] === undefined ? d : Number(opt[k]));

const STAGES = [100, 1000, 3000, 5000, 10000, 30000, 50000, 100000];

// ── 화면 코드와 같은 값 (visitor.html · booth-core.js · booth-ctrl.html · booth-admin.js) ──
const CLIENT = {
  pollS: 20,      // config.js pollingIntervalMs 20000, poll() 이 ±20% 흩뜨림
  jitter: 0.2,
  fullS: 300,     // visitor.html FULL_MS — 5분마다 load() = GET 4개
  retryS: 10,     // visitor.html RETRY_MS — 실패 뒤 고정 10초, 지수 백오프 없음
  timeoutS: 8,    // booth-core.js TIMEOUT_MS
  loadReqs: 4     // load() = settings · zones · booths · booth_live (Promise.all)
};

// ── 가정 (README '가정' 표와 같은 값) ──
const ASSUME = {
  capacity: num('capacity', 400),   // Supabase REST 가 오류 없이 처리하는 초당 요청 — 측정해서 바꿀 값
  openS: num('open-every', 600),    // 동시 관람객 한 명이 페이지를 새로 여는 평균 간격(새 관람객 교대 포함)
  timeoutShare: 0.5,                // 과부하로 실패한 요청 중 8초 시간 초과 비율(나머지는 5xx)
  fast5xxS: 1,                      // 5xx 가 돌아오기까지
  booths: num('booths', 80),
  sample: num('sample', 4000),      // 흉내 내는 관람객 수(이보다 많으면 무게를 곱함)
  // 지연(ms): 한국 → Supabase 리전 · 한국 → Vercel 엣지. 낮은 부하에서의 로그정규 분포.
  originMedian: 90, originSigma: 0.69,
  cdnMedian: 25, cdnSigma: 0.7,
  serviceMs: 60                     // 대기열이 찰 때 늘어나는 지연의 단위
};

// ── B: Phase 2 구조 (live/api/live-snapshot.mjs · visitor.html 과 같은 값) ──
const CDN = {
  pollS: 20, jitterS: 4,    // visitor.html POLL_MS ± JITTER_MS — 스냅샷 1개
  backoffS: [40, 80, 120],  // 실패가 이어질 때(POLL × 2, × 4, 상한 120초, ±20%)
  ttl: 10, swr: 30, sie: 600,          // Vercel-CDN-Cache-Control
  fnLiveS: 5, fnMasterS: 60,           // 함수 인스턴스 안 memo: booth_live 5초, settings · zones · booths 60초
  fnKeepS: 600, fnPauseS: 5,           // Supabase 실패 때 last-good 유지 · 다시 묻지 않는 시간
  regions: num('regions', 2),          // 가정: 한국 관람객을 받는 엣지 리전 수(icn1 · hnd1)
  instances: num('instances', 3),      // 가정: 함수 인스턴스 수(Fluid compute 가 재사용 — 최악 쪽에 씀)
  fnLatS: 0.6                          // 가정: 함수 → Supabase 왕복(한국 → Supabase 실측 TTFB 0.56~1.3초)
};

// ── 운영자 · 관리자 (관람객과 따로 셈) ──
const STAFF = {
  operators: [100, 200],
  admins: [5, 20],
  opReadS: 60,      // booth-ctrl REFRESH_MS — ctrlGet/sessGet POST 1개
  opWriteS: 120,    // 가정: 붐빌 때 부스마다 2분에 한 번 대기 시간을 누름
  adminLiveS: 15,   // booth-admin LIVE_MS — booth_live 1개
  adminMasterS: 60  // booth-admin MASTER_MS — zones · booths · credentials + booth_live = 4개
};
const staffRps = (ops, admins) =>
  ops * (1 / STAFF.opReadS + 1 / STAFF.opWriteS) +
  admins * (1 / STAFF.adminLiveS + 4 / STAFF.adminMasterS);
const STAFF_MAX = staffRps(200, 20);

// 관람객 화면 정적 파일(live/dist gzip, 2026-10-04 빌드): index · booth-core · visitor.css · config · mock-data
const STATIC = { files: 5, firstVisitBytes: 24309 + 18443 + 8433 + 567 + 2905, revalidateBytes: 5 * 300, firstShare: 0.5 };

/* ── 응답 크기: 부스 수만큼 그럴듯한 JSON 을 만들어 gzip 으로 잽니다 ── */
function payloadSizes(nBooths) {
  const hex = (n, s) => { let o = ''; for (let i = 0; i < n; i++) o += ((s * 7919 + i * 104729) % 16).toString(16); return o; };
  const uuid = (s) => [hex(8, s), hex(4, s + 1), hex(4, s + 2), hex(4, s + 3), hex(12, s + 4)].join('-');
  const zones = Array.from({ length: Math.max(3, Math.ceil(nBooths / 12)) }, (_, i) => ({ key: String.fromCharCode(65 + i), label: String.fromCharCode(65 + i) + '구역 · 인공지능 체험', sort_order: i + 1 }));
  const booths = Array.from({ length: nBooths }, (_, i) => ({
    id: uuid(i), no: (i % 12) + 1, code: zones[Math.floor(i / 12) % zones.length].key + '-' + String((i % 12) + 1).padStart(2, '0'),
    zone_key: zones[Math.floor(i / 12) % zones.length].key, name: '생성형 AI 체험 부스 ' + (i + 1),
    org: '인천' + ['미래', '송도', '청라', '부평', '계양'][i % 5] + '초등학교', program: '그림 그리는 인공지능과 함께하는 나만의 동화책 만들기 ' + i
  }));
  const live = booths.map((b, i) => ({ booth_id: b.id, congestion: ['여유', '보통', '혼잡'][i % 3], wait_minutes: (i * 5) % 60, updated_at: '2026-11-07T0' + (i % 8) + ':1' + (i % 6) + ':33.123456+00:00' }));
  const settings = [{ event_title: '2026 인천 AI미래채움 교육페스티벌', venue: '송도컨벤시아', date_label: '2026. 11. 7.(토) ~ 8.(일)', time_label: '10:00 ~ 17:00', event_start: '2026-11-07T01:00:00+00:00', event_end: '2026-11-08T08:00:00+00:00', booth_map_url: 'https://example.invalid/map.png', booth_map_alt: '부스 배치도' }];
  const gz = (o) => gzipSync(Buffer.from(JSON.stringify(o))).length + 400; // + 응답 머리 대략
  // Phase 2 스냅샷 모양(live/api/live-snapshot.mjs compose())
  const s = settings[0];
  const snapshot = {
    version: 1, generatedAt: '2026-11-07T01:00:00.000Z', liveReady: true,
    event: { title: s.event_title, venue: s.venue, dateLabel: s.date_label, timeLabel: s.time_label, start: s.event_start, end: s.event_end, mapUrl: s.booth_map_url, mapAlt: s.booth_map_alt },
    zones: zones.map((z) => ({ key: z.key, label: z.label, order: z.sort_order })),
    booths: booths.map((b, i) => ({ id: b.id, no: b.no, code: b.code, zone: b.zone_key, name: b.name, org: b.org, program: b.program,
      status: live[i].congestion, waitMinutes: live[i].wait_minutes, updatedAt: live[i].updated_at }))
  };
  return {
    settings: gz(settings), zones: gz(zones), booths: gz(booths), live: gz(live),
    snapshot: gz(snapshot), snapshotRaw: JSON.stringify(snapshot).length
  };
}

/* ── 지연 ── */
function invNorm(p) { // Acklam
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const q = p < 0.5 ? p : 1 - p;
  let x;
  if (q < 0.02425) { const r = Math.sqrt(-2 * Math.log(q)); x = (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1); }
  else { const r = q - 0.5, s = r * r; x = (((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r / (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1); return p < 0.5 ? x : -x; }
  return p < 0.5 ? x : -x;
}
// 받은 요청의 지연 분위수: 기본(로그정규) + 대기열(지수, 평균 serviceMs·ρ/(1-ρ)). 8초에서 끊김.
function originLatencyAt(q, rho) {
  const r = Math.min(rho, 0.97);
  const base = ASSUME.originMedian * Math.exp(ASSUME.originSigma * invNorm(q));
  const queue = ASSUME.serviceMs * -Math.log(1 - q) * r / (1 - r);
  return Math.min(CLIENT.timeoutS * 1000, base + queue);
}
const cdnLatency = (q) => ASSUME.cdnMedian * Math.exp(ASSUME.cdnSigma * invNorm(q));

function quantiles(samples, qs) {
  samples.sort((x, y) => x[0] - y[0]);
  const total = samples.reduce((s, x) => s + x[1], 0);
  const out = [];
  let acc = 0, j = 0;
  for (const q of qs) {
    while (j < samples.length && acc + samples[j][1] < q * total) { acc += samples[j][1]; j++; }
    out.push(samples.length ? samples[Math.min(j, samples.length - 1)][0] : NaN);
  }
  return out;
}

/* ── 난수 (같은 seed → 같은 표) ── */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ===================================================================
   A — 지금 구조 시뮬레이션
   관람객 한 명(visitor.html)의 규칙:
     · 페이지를 열면 refresh(true) → load() = GET 4개(Promise.all, 하나라도 실패하면 전체 실패)
     · poll() 이 20초 ±20% 마다 refresh(false) — 이미 받는 중이면 건너뜀
     · refresh 는 '한 번도 성공 못 했거나(!S.fresh) 마지막 전체 받기(S.lastFull)가 5분 넘었으면' load(),
       아니면 refreshLive() = GET 1개. S.lastFull 은 load() 가 '성공' 했을 때만 바뀜
       → 5분 넘게 실패하면 그 뒤 모든 재시도가 GET 4개가 됨
     · 실패하면 10초 뒤 고정 재시도(지수 백오프 · 흩뜨림 없음). poll 도 따로 계속 돎
   Supabase 는 초당 capacity 개까지 받고, 넘치면 넘친 비율만큼 실패(평균장 근사).
   운영자 · 관리자 요청도 같은 Supabase 를 함께 씁니다.
   =================================================================== */
function simulateDirect({ nAt, totalS, measureFrom, cap, staff = STAFF_MAX, seed = 1, timeline = 0 }) {
  let maxN = 0;
  for (let t = 0; t < totalS; t++) maxN = Math.max(maxN, nAt(t));
  const M = Math.max(1, Math.min(ASSUME.sample, Math.round(maxN)));
  const r = rng(seed);
  const jit = () => CLIENT.pollS * (1 - CLIENT.jitter + 2 * CLIENT.jitter * r());
  const expo = (mean) => -mean * Math.log(1 - r());

  const nextPoll = new Float64Array(M), nextRetry = new Float64Array(M), nextOpen = new Float64Array(M);
  const resolveAt = new Float64Array(M), lastFull = new Float64Array(M);
  const busy = new Uint8Array(M), fresh = new Uint8Array(M), pendAll = new Uint8Array(M), pendOk = new Uint8Array(M);
  const firing = new Int32Array(M);
  // 정상 상태에서 출발: 모두 한 번은 받았고, 되풀이 · 전체 받기 시점은 흩어져 있음
  for (let i = 0; i < M; i++) {
    fresh[i] = 1; lastFull[i] = -CLIENT.fullS * r(); nextPoll[i] = CLIENT.pollS * r();
    nextRetry[i] = Infinity; nextOpen[i] = expo(ASSUME.openS);
  }

  const m = { s: 0, offered: 0, ok: 0, e5: 0, to: 0, staffOk: 0, bytes: 0, lat: [] };
  const loadBytes = sizes.settings + sizes.zones + sizes.booths + sizes.live;
  const rows = [];
  let win = null;
  const grid = Array.from({ length: 50 }, (_, k) => (k + 0.5) / 50);

  for (let t = 0; t < totalS; t++) {
    const w = nAt(t) / M;
    let nf = 0, reqs = 0, bytes = 0;
    for (let i = 0; i < M; i++) {
      if (busy[i] && resolveAt[i] <= t) {
        busy[i] = 0;
        if (pendOk[i]) { fresh[i] = 1; if (pendAll[i]) lastFull[i] = t; }
        else nextRetry[i] = t + CLIENT.retryS;
      }
      let fire = false;
      if (nextOpen[i] <= t) { // 새로 열기(새로 고침 · 다음 관람객)
        fresh[i] = 0; busy[i] = 0; lastFull[i] = -Infinity; nextRetry[i] = Infinity;
        nextPoll[i] = t + jit(); nextOpen[i] = t + expo(ASSUME.openS); fire = true;
      } else {
        if (nextPoll[i] <= t) { nextPoll[i] += jit(); if (!busy[i]) fire = true; }
        if (nextRetry[i] <= t) { nextRetry[i] = Infinity; if (!busy[i]) fire = true; }
      }
      if (fire) {
        const all = !fresh[i] || t - lastFull[i] > CLIENT.fullS;
        pendAll[i] = all ? 1 : 0; busy[i] = 1; nextRetry[i] = Infinity;
        reqs += all ? CLIENT.loadReqs : 1;
        bytes += all ? loadBytes : sizes.live;
        firing[nf++] = i;
      }
    }
    const offered = reqs * w;
    const total = offered + staff;
    const p = total <= cap ? 1 : cap / total;
    const rho = total / cap;
    let ok = 0, e5 = 0, to = 0;
    for (let f = 0; f < nf; f++) {
      const i = firing[f];
      const k = pendAll[i] ? CLIENT.loadReqs : 1;
      let allOk = true, any5 = false;
      for (let j = 0; j < k; j++) {
        if (r() < p) ok++;
        else { allOk = false; if (r() < ASSUME.timeoutShare) to++; else { e5++; any5 = true; } }
      }
      pendOk[i] = allOk ? 1 : 0;
      resolveAt[i] = t + (allOk ? 1 : (any5 ? ASSUME.fast5xxS : CLIENT.timeoutS));
    }
    if (t >= measureFrom) {
      m.s++; m.offered += offered; m.bytes += bytes * w; m.ok += ok * w; m.e5 += e5 * w; m.to += to * w; m.staffOk += p;
      if (ok) for (const q of grid) m.lat.push([originLatencyAt(q, rho), ok * w / grid.length]);
      if (e5) m.lat.push([ASSUME.fast5xxS * 1000, e5 * w]);
      if (to) m.lat.push([CLIENT.timeoutS * 1000, to * w]);
    }
    if (timeline) {
      if (!win) win = { t0: t, n: 0, offered: 0, ok: 0, bad: 0, p: 0, N: 0 };
      win.n++; win.offered += offered; win.ok += ok * w; win.bad += (e5 + to) * w; win.p += p; win.N += nAt(t);
      if (win.n === timeline) { rows.push(win); win = null; }
    }
  }
  const all = m.ok + m.e5 + m.to || 1;
  const [p50, p95, p99] = quantiles(m.lat, [0.5, 0.95, 0.99]);
  return {
    originRps: m.offered / m.s, servedRps: m.ok / m.s,
    okPct: 100 * m.ok / all, e5Pct: 100 * m.e5 / all, toPct: 100 * m.to / all,
    staffOkPct: 100 * m.staffOk / m.s, gbPerHour: m.bytes / m.s * 3600 / 1e9, p50, p95, p99, rows
  };
}

const steady = (N, cap, seed = 1) => simulateDirect({ nAt: () => N, totalS: 1500, measureFrom: 900, cap, seed });

/* ── B — Phase 2 구조(CDN 스냅샷) 계산 ──
   세 층을 따로 셉니다.
     browser → CDN      관람객 수에 비례(20초마다 1개 + 열 때 1개 + 정적 파일)
     CDN → 함수         최선: 리전마다 만료(10초)당 1번(SWR 백그라운드 갱신 · 묶음 요청)
                        최악: 만료 순간 함수 왕복 동안 들어온 요청이 모두 MISS
     함수 → Supabase    인스턴스마다 booth_live 는 5초에 1번 이하, 목록 3개는 60초에 1번
                        → 최악이어도 instances × (1/5 + 3/60) 를 넘지 않음 */
function cdnModel(N, sizes) {
  const data = N / CDN.pollS + N / ASSUME.openS;
  const staticRps = N / ASSUME.openS * STATIC.files;
  const fnBest = Math.min(data, CDN.regions / CDN.ttl);
  const fnWorst = Math.min(data, CDN.regions / CDN.ttl * (1 + data / CDN.regions * CDN.fnLatS));
  const sbFor = (fn, inst) => Math.min(fn, inst / CDN.fnLiveS) + inst * 3 / CDN.fnMasterS;
  const sbBest = sbFor(fnBest, 1);
  const sbWorst = sbFor(fnWorst, CDN.instances);
  const vercelBytes = data * sizes.snapshot +
    N / ASSUME.openS * (STATIC.firstShare * STATIC.firstVisitBytes + (1 - STATIC.firstShare) * STATIC.revalidateBytes);
  const sbBytes = (b) => (Math.min(b, CDN.instances / CDN.fnLiveS)) * sizes.live + CDN.instances / CDN.fnMasterS * (sizes.settings + sizes.zones + sizes.booths);
  return {
    browserRps: data + staticRps, dataRps: data, staticRps,
    fnBest, fnWorst, sbBest, sbWorst,
    hitBest: 100 * (1 - fnBest / data), hitWorst: 100 * (1 - fnWorst / data),
    p50: cdnLatency(0.5), p95: cdnLatency(0.95), p99: cdnLatency(0.99),
    ampBest: sbBest / (N / CDN.pollS), ampWorst: sbWorst / (N / CDN.pollS),
    gbPerHour: vercelBytes * 3600 / 1e9, sbMbPerHour: sbBytes(sbWorst) * 3600 / 1e6
  };
}

// 장애 때(관람객 1명 기준). 실패가 이어지면 40 → 80 → 120초 → 120초 … 로 받습니다.
const backoffRate = 1 / CDN.backoffS[CDN.backoffS.length - 1];

/* ── 임계점 찾기 ── */
// 정상에서 출발해 오류가 1% 를 넘기 시작하는 동시 관람객 수
function collapseAt(cap) {
  let lo = 100, hi = 400000;
  for (let k = 0; k < 14; k++) {
    const mid = Math.sqrt(lo * hi);
    const s = simulateDirect({ nAt: () => mid, totalS: 1500, measureFrom: 900, cap, seed: 7 });
    if (100 - s.okPct > 1) hi = mid; else lo = mid;
  }
  return lo;
}
// 100,000명으로 무너진 뒤, 몇 명까지 줄어야 20분 안에 스스로 회복하는가
function recoverAt(cap) {
  let lo = 10, hi = 100000;
  for (let k = 0; k < 14; k++) {
    const mid = Math.sqrt(lo * hi);
    const s = simulateDirect({ nAt: (t) => (t < 900 ? 100000 : mid), totalS: 900 + 1200, measureFrom: 900 + 900, cap, seed: 11 });
    if (100 - s.okPct > 1) hi = mid; else lo = mid;
  }
  return lo;
}

/* ── 출력 ── */
const f0 = (x) => (isFinite(x) ? Math.round(x).toLocaleString('en-US') : '—');
const f1 = (x) => (isFinite(x) ? (Math.abs(x) >= 100 ? f0(x) : x.toFixed(1)) : '—');
const f2 = (x) => (x < 0.01 ? x.toFixed(4) : x < 10 ? x.toFixed(2) : f1(x));
const pct = (x) => (x >= 99.995 ? '100' : x < 0.005 ? '0' : x.toFixed(x > 99 || x < 1 ? 2 : 1)) + '%';
const ms = (x) => (x >= 7999 ? '8,000 (timeout)' : f0(x));
const table = (head, rows) => ['| ' + head.join(' | ') + ' |', '|' + head.map(() => '---').join('|') + '|', ...rows.map((r) => '| ' + r.join(' | ') + ' |')].join('\n');

const sizes = payloadSizes(ASSUME.booths);
const cap = ASSUME.capacity;
const out = [];
const say = (s = '') => out.push(s);

say(`# 부스 Live 부하 모델 결과`);
say();
say(`모델 계산값입니다(측정값 아님). Supabase 처리 한도 가정 **${f0(cap)} RPS**, 부스 ${ASSUME.booths}곳, ` +
  `관람객 1명이 ${ASSUME.openS}초마다 페이지를 새로 엶, 화면은 모두 켜져 있음(가장 나쁜 경우), ` +
  `운영자 200명 + 관리자 20명이 함께 씀(${f1(STAFF_MAX)} RPS). 같은 인자로 돌리면 같은 표가 나옵니다.`);
say();
say(`응답 크기(gzip + 머리 400B): settings ${f0(sizes.settings)}B · zones ${f0(sizes.zones)}B · booths ${f0(sizes.booths)}B · ` +
  `booth_live ${f0(sizes.live)}B · (B) 스냅샷 ${f0(sizes.snapshot)}B (압축 전 ${f0(sizes.snapshotRaw)}B)`);
say();

say(`## A. Phase 1(이전) 구조 — 관람객이 Supabase 를 직접 polling`);
say();
const aRows = [];
const aRes = {};
for (const N of STAGES) {
  const s = steady(N, cap);
  aRes[N] = s;
  const staticRps = N / ASSUME.openS * STATIC.files;
  aRows.push([f0(N), f1(staticRps), f1(s.originRps), f1(s.originRps + STAFF_MAX), '0%',
    ms(s.p50), ms(s.p95), ms(s.p99), '0', pct(s.e5Pct), pct(s.toPct),
    f2(s.originRps / (N / CLIENT.pollS)) + '×', pct(s.staffOkPct), f1(s.gbPerHour)]);
}
say(table(['동시 관람객', 'browser→CDN RPS (정적)', 'browser→Supabase RPS (데이터)', 'origin(Supabase) 합계 RPS', '데이터 cache hit',
  'p50 ms', 'p95 ms', 'p99 ms', '429', '5xx', 'timeout', 'origin 증폭', '운영자 저장 성공', 'Supabase egress GB/h'], aRows));
say();
say(`- 데이터 요청은 CDN 을 거치지 않습니다(\`cache: 'no-store'\`, Supabase REST 응답은 캐시되지 않음). browser→Supabase = origin.`);
say(`- origin 증폭 = Supabase 에 닿는 관람객 요청 ÷ (관람객 수 ÷ 20초). 정상이어도 1 보다 큰 까닭: 열 때 · 5분마다 GET 4개.`);
say(`- 429 는 0 으로 둡니다: Supabase REST 에는 기본 요청 한도가 없고, 화면 코드는 429 를 따로 다루지 않습니다(그 밖 4xx 로 처리). ` +
  `Supabase 앞단(Cloudflare)이 행사장 공유 IP 를 막으면 429/403 이 생길 수 있으나 모델에 넣지 않았습니다.`);
say(`- 운영자 저장 성공 = 같은 Supabase 를 쓰는 부스 운영자 · 관리자 요청이 성공할 확률. 관람객 과부하가 운영자 입력을 함께 막습니다.`);
say();

say(`## B. Phase 2(이 브랜치) 구조 — /api/live-snapshot + Vercel CDN`);
say();
say(`값: 관람객 ${CDN.pollS}±${CDN.jitterS}초마다 스냅샷 1개, CDN max-age=${CDN.ttl}s · stale-while-revalidate=${CDN.swr}s · ` +
  `stale-if-error=${CDN.sie}s, 함수 memo booth_live ${CDN.fnLiveS}s · 목록 ${CDN.fnMasterS}s. ` +
  `가정: 엣지 리전 ${CDN.regions}곳, 함수 인스턴스 최선 1 · 최악 ${CDN.instances}, 함수→Supabase ${CDN.fnLatS * 1000}ms. ` +
  `'최선' = 리전마다 만료당 1번만 함수에 감(SWR 백그라운드 갱신 · 묶음 요청), '최악' = 만료 순간 함수 왕복 동안 들어온 요청이 모두 MISS.`);
say();
const bRows = [];
for (const N of STAGES) {
  const b = cdnModel(N, sizes);
  bRows.push([f0(N), f1(b.browserRps), f1(b.dataRps), f2(b.fnBest) + ' / ' + f1(b.fnWorst),
    f2(b.sbBest) + ' / ' + f2(b.sbWorst), f1(b.sbBest + STAFF_MAX) + ' / ' + f1(b.sbWorst + STAFF_MAX),
    pct(b.hitBest) + ' / ' + pct(b.hitWorst), f0(b.p50), f0(b.p95), f0(b.p99), '0', '0', '0',
    f2(b.ampBest) + '× / ' + f2(b.ampWorst) + '×', '100%', f1(b.gbPerHour), f1(b.sbMbPerHour)]);
}
say(table(['동시 관람객', 'browser→CDN RPS (전체)', '그중 스냅샷 RPS', 'CDN→함수 RPS 최선/최악', '관람객 몫 Supabase RPS 최선/최악',
  'Supabase 합계 RPS (운영자 포함)', 'CDN cache hit 최선/최악', 'p50 ms', 'p95 ms', 'p99 ms', '429', '5xx', 'timeout',
  'origin 증폭 최선/최악', '운영자 저장 성공', 'Vercel 전송량 GB/h', 'Supabase egress MB/h (관람객 몫)'], bRows));
say();
say(`- 관람객 몫 Supabase 요청은 관람객 수와 무관하게 최대 ${f2(cdnModel(100000, sizes).sbWorst)} RPS 에서 멈춥니다(함수 memo). ` +
  `CDN 이 최악으로 움직여도 늘어나는 것은 함수 호출이지 Supabase 요청이 아닙니다.`);
say(`- origin 증폭 = 관람객 몫 Supabase 요청 ÷ (관람객 수 ÷ 20초). Phase 1 은 1.26배(정상) ~ 8.5배(붕괴)였습니다.`);
say(`- 429 · 5xx · timeout 0 은 'Vercel 엣지가 이 RPS 를 받는다' 는 가정입니다. 요금제 한도(사용량 초과 시 프로젝트 일시 정지) · ` +
  `DDoS 완화 · 방화벽 규칙이 행사장 공유 IP 에 걸리는지는 따로 확인해야 합니다(README '확인할 것').`);
say();

say(`### B 구조 장애 · 회복 (단계별)`);
say();
const fRows = [];
for (const N of STAGES) {
  const b = cdnModel(N, sizes);
  fRows.push([f0(N), f1(b.dataRps), f1(N * backoffRate * 1.0), pct(100 * (1 - N * backoffRate / b.dataRps)),
    f2(CDN.instances / CDN.fnPauseS * 4), '0', `≤ ${CDN.fnPauseS + CDN.ttl + CDN.pollS + CDN.jitterS}초`, `≤ ${Math.round(CDN.backoffS[CDN.backoffS.length - 1] * 1.2)}초`]);
}
say(table(['동시 관람객', '정상 스냅샷 RPS', 'CDN·함수 장애 중 browser RPS (백오프 120초)', '장애 중 요청 감소',
  'Supabase 장애 중 Supabase GET RPS (최악, 시도당 GET 4개)', 'Supabase 10분 장애 중 관람객 오류', 'Supabase 회복 → 관람객 화면 반영', 'CDN·함수 회복 → 관람객 다시 받음'], fRows));
say();
say(`- Supabase 장애: 함수가 마지막 정상본을 ${CDN.fnKeepS / 60}분까지 200 으로 주고, CDN 도 stale-if-error ${CDN.sie}초 동안 마지막 사본을 줍니다. ` +
  `그동안 관람객은 오류 없이 마지막 값을 보고, 새 스냅샷이 90초 넘게 없으면 '현황 연결이 잠시 지연되고 있습니다.' 한 줄만 봅니다. ` +
  `함수는 실패 뒤 ${CDN.fnPauseS}초 동안 Supabase 에 다시 묻지 않으므로 Supabase 시도는 인스턴스당 ${CDN.fnPauseS}초에 1번 이하입니다.`);
say(`- CDN · 함수 장애: 관람객은 Supabase 로 돌아가지 않습니다(그 길이 없음). 40 → 80 → 120초로 늦추며 같은 주소를 다시 받고, 화면은 마지막 값을 둡니다. ` +
  `Supabase 에 닿는 관람객 요청은 0 입니다.`);
say(`- 회복: 쌓인 재시도가 없고 Supabase 부하가 관람객 수에 비례하지 않으므로, 관람객 수가 줄기를 기다릴 필요 없이 원인이 사라지면 곧바로 돌아옵니다(Phase 1 의 이력 현상 없음).`);
say();

say(`## 운영자 · 관리자 (관람객과 분리한 부하)`);
say();
const sRows = [];
for (const ops of STAFF.operators) for (const ad of STAFF.admins) {
  const rps = staffRps(ops, ad);
  sRows.push([f0(ops), f0(ad), f1(ops * (1 / STAFF.opReadS)), f1(ops / STAFF.opWriteS), f1(ad * (1 / STAFF.adminLiveS + 4 / STAFF.adminMasterS)), f1(rps), pct(100 * rps / cap)]);
}
say(table(['부스 운영자', '관리자', '운영자 읽기 RPS', '운영자 저장 RPS', '관리자 RPS', '합계 RPS', 'Supabase 한도 대비'], sRows));
say();
say(`운영자 · 관리자 요청은 토큰 · 세션 · 로그인이 붙어 캐시할 수 없습니다(POST rpc · 인증 select). 양은 작지만 ` +
  `A 구조에서는 관람객과 같은 Supabase 를 나눠 쓰므로, 관람객이 몰리면 위 '운영자 저장 성공' 만큼만 저장됩니다.`);
say();

/* ── B 보수 시나리오: CDN POP 수 × 함수 memo ──────────────────────────
   위 B 표의 '최선' 은 POP 하나에서 만료당 한 번만 함수에 가는 경우(Preview 에서 실제로 그랬음)에
   가깝습니다. 여기서는 그것을 보장으로 보지 않습니다.
     · CDN 캐시는 POP(엣지 지역)마다 따로 있습니다. 관람객은 POP 들에 고르게 나뉜다고 봅니다.
     · POP 안에서도 묶음 요청이 없다고 봅니다: 만료마다 함수가 다시 만드는 동안(fnWallS) 들어온
       요청이 모두 함수로 갑니다.
     · 함수는 한 리전에서 돌고, 동시에 처리 중인 호출 하나마다 인스턴스가 하나씩 따로 뜬다고
       봅니다(Fluid compute 의 인스턴스 재사용을 빼고 셈).
     · memo 정상: 인스턴스마다 booth_live 5초 · 목록 3개 60초에 한 번.
       memo 무효: 호출마다 GET 4개(차가운 인스턴스가 매번 뜨는 경우와 같음). */
const SENS = { pops: [1, 3, 5, 10], stages: [5000, 10000, 30000, 50000, 100000], fnWallS: 1.0, eventHours: 7 * 2 };
function sensitivity(N, pops, memo) {
  const data = N / CDN.pollS + N / ASSUME.openS;
  const perPop = data / pops;
  const fn = pops * Math.min(perPop, (1 / CDN.ttl) * (1 + perPop * SENS.fnWallS));
  const inst = Math.max(1, Math.ceil(fn * SENS.fnWallS));
  const sb = memo ? Math.min(fn, inst / CDN.fnLiveS) + inst * 3 / CDN.fnMasterS : fn * 4;
  return { fn, inst, sb };
}

say(`## B 보수 시나리오 — CDN POP 수 × 함수 memo`);
say();
say(`가정: POP 마다 캐시가 따로 있고 POP 안 묶음 요청은 없음(만료마다 함수 ${SENS.fnWallS}초 동안 들어온 요청이 모두 함수로), ` +
  `함수 호출 하나 = 인스턴스 하나. memo 무효 = 호출마다 Supabase GET 4개. Preview 실측(POP 하나에서 만료당 갱신 1번)보다 훨씬 나쁘게 잡은 값입니다.`);
say();
say(`### 관람객 수만으로 정해지는 값 (POP · memo 와 무관)`);
say();
const hobbyReq = 1e6, hobbyGb = 100;
say(table(['동시 관람객', 'CDN RPS', 'CDN 요청/시간', 'Vercel 전송 GB/시간', `행사 ${SENS.eventHours}시간 내내 이 수준이면 CDN 요청`, `같은 경우 전송 GB`, 'Hobby 월 100만 건이 바닥나는 시간', 'Hobby 월 100GB 가 바닥나는 시간'],
  SENS.stages.map((N) => {
    const b = cdnModel(N, sizes);
    const perHour = b.browserRps * 3600;
    return [f0(N), f0(b.browserRps), f0(perHour), f1(b.gbPerHour), f0(perHour * SENS.eventHours), f0(b.gbPerHour * SENS.eventHours),
      f0(hobbyReq / perHour * 60) + '분', f1(hobbyGb / b.gbPerHour) + '시간'];
  })));
say();
for (const memo of [true, false]) {
  say(`### Supabase origin RPS · 요청/시간 — 함수 memo ${memo ? '정상' : '무효'}`);
  say();
  say(table(['동시 관람객', ...SENS.pops.map((p) => `POP ${p}: RPS (요청/시간)`)],
    SENS.stages.map((N) => [f0(N), ...SENS.pops.map((p) => { const s = sensitivity(N, p, memo); return `${f1(s.sb)} (${f0(s.sb * 3600)})`; })])));
  say();
}
say(`### 함수 호출 · 동시 인스턴스 (memo 와 무관)`);
say();
say(table(['동시 관람객', ...SENS.pops.map((p) => `POP ${p}: 호출 RPS · 인스턴스 · 호출/시간`)],
  SENS.stages.map((N) => [f0(N), ...SENS.pops.map((p) => { const s = sensitivity(N, p, true); return `${f1(s.fn)} · ${f0(s.inst)} · ${f0(s.fn * 3600)}`; })])));
say();
say(`- Preview 실측(POP 하나에서 만료당 갱신 1번)이 그대로 성립하면 함수 호출은 POP 수 × 0.1 RPS, Supabase 는 memo 정상일 때 ` +
  `POP 10곳이어도 약 ${f2(Math.min(10 / CDN.ttl, 1 / CDN.fnLiveS) + 3 / CDN.fnMasterS)}~${f2(10 / CDN.ttl * 4)} RPS 입니다.`);
say(`- 보수 시나리오에서 Supabase 부하를 키우는 것은 'POP 안 묶음 요청 없음 × 인스턴스 재사용 없음' 의 조합입니다. 둘 다 Preview 에서는 일어나지 않았지만 보장은 아닙니다.`);
say();

if (!opt.quick) {
  say(`## 100,000명 스트레스 — 붕괴 · 회복`);
  say();
  say(`### A 구조 타임라인 (5,000명 → 100,000명 15분 → 5,000명으로 감소)`);
  say();
  const tl = simulateDirect({
    nAt: (t) => (t < 600 ? 5000 : t < 1500 ? 100000 : 5000), totalS: 3300, measureFrom: 0, cap, seed: 3, timeline: 120
  }).rows;
  say(table(['구간(분)', '동시 관람객', 'Supabase 관람객 RPS', '관람객 요청 성공', '운영자 저장 성공'],
    tl.map((w) => [`${w.t0 / 60}–${(w.t0 + w.n) / 60}`, f0(w.N / w.n), f0(w.offered / w.n), pct(100 * w.ok / Math.max(1e-9, w.ok + w.bad)), pct(100 * w.p / w.n)])));
  say();
  say(`### A 구조 임계점 (Supabase 한도별)`);
  say();
  const caps = [200, 400, 800, 1600];
  if (!caps.includes(cap)) caps.push(cap);
  caps.sort((x, y) => x - y);
  say(table(['Supabase 한도 RPS', '무너지기 시작(오류>1%)', '100,000명 뒤 스스로 회복하려면 이 아래로', '회복선 ÷ 붕괴선'],
    caps.map((c) => { const a = collapseAt(c), b = recoverAt(c); return [f0(c), f0(a) + '명', f0(b) + '명', pct(100 * b / a)]; })));
  say();
  say(`회복선이 붕괴선보다 훨씬 낮습니다(이력 현상 · metastable failure). 무너진 관람객은 10초 고정 재시도 + ` +
    `5분이 지나면 매번 GET 4개(Promise.all — 넷 다 성공해야 성공)를 보내므로, 관람객 수가 붕괴선 아래로 내려와도 ` +
    `요청량은 정상의 여러 배로 남습니다.`);
  say();
  say(`### B 구조 (100,000명)`);
  say();
  const b = cdnModel(100000, sizes);
  say(`- 붕괴 여부: 관람객 몫 Supabase 요청이 최선 ${f2(b.sbBest)} RPS, 최악 ${f2(b.sbWorst)} RPS → Supabase 는 관람객 수로 무너지지 않음. ` +
    `CDN→함수 호출은 최선 ${f2(b.fnBest)} · 최악 ${f1(b.fnWorst)} RPS(함수 비용 · 동시 실행 한도 쪽 위험).`);
  say(`- CDN 의 origin 보호: cache hit 최선 ${pct(b.hitBest)}, 최악 ${pct(b.hitWorst)}. 함수 memo 가 그 뒤를 한 번 더 막음.`);
  say(`- 오류 시 backoff · last-good · 자동 회복은 위 '장애 · 회복' 표와 같음. 남는 위험은 Vercel 쪽입니다: 초당 ${f0(b.browserRps)}건, 시간당 ${f1(b.gbPerHour)}GB 를 요금제가 받는가.`);
  say();
}

console.log(out.join('\n'));
