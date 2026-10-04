/* ===================================================================
   GET /api/live-snapshot — 관람객 화면이 읽는 공개 스냅샷 하나

   관람객 브라우저는 Supabase 를 직접 부르지 않고 이 주소 하나만 20초 안팎마다
   읽습니다. Vercel CDN 이 응답을 10초 캐시하고(이후 30초는 낡은 사본을 주며
   뒤에서 새로 받음), 이 함수는 CDN 이 놓친 요청만 받습니다. 그래서 Supabase 에
   닿는 요청은 관람객 수와 거의 무관합니다(scripts/loadtest/README.md).

     브라우저 ─ Cache-Control: no-store            (브라우저에 오래 남기지 않음)
     Vercel CDN ─ Vercel-CDN-Cache-Control: max-age=10, stale-while-revalidate=30,
                                            stale-if-error=600
     이 함수 ─ 인스턴스 안에서 한 번 더 막습니다
               · booth_live 는 5초, 부스 목록 · 구역 · 기본정보는 60초 동안 다시 읽지 않음
               · 같은 때 들어온 요청은 Supabase 읽기 하나를 함께 기다림(single-flight)
               · Supabase 가 실패하면 마지막 정상본을 10분까지 그대로 줌(last-good),
                 실패 뒤 5초는 Supabase 에 다시 묻지 않음
     Supabase ─ 관람객 브라우저와 같은 공개용 키(anon/publishable)로 읽으므로
               RLS 가 공개하지 않은 부스 · 구역은 처음부터 오지 않습니다.

   응답에 넣는 것은 관람객 화면이 그리는 공개 값뿐입니다. QR 열쇠 · PIN · 세션 ·
   담당자 연락처 · 메모 · booth_private · 관리자 정보는 읽지도 않습니다.
   기관 이름 앞의 '[예시]' 같은 내부 표시도 떼어 내고, 행사 전에는 예시 부스가
   아닌 부스의 대기 값을 빼고 보냅니다(관람객 화면과 같은 규칙을 여기서 적용).

   질의 문자열(?…)이 붙은 요청은 400 으로 돌려보냅니다. 캐시 주소가 하나여야
   CDN 이 막아 주고, 시각 · 난수를 붙여 캐시를 우회하는 요청이 생기지 않습니다.
   =================================================================== */
import { supabaseUrl, supabaseAnonKey } from '../lib/public-config.mjs';

const REST = supabaseUrl.replace(/\/+$/, '') + '/rest/v1/';
const LIVE_MS = 5 * 1000;          // booth_live 를 다시 읽는 최소 간격(이 인스턴스)
const MASTER_MS = 60 * 1000;       // settings · zones · booths 를 다시 읽는 간격
const KEEP_MS = 10 * 60 * 1000;    // Supabase 실패 때 마지막 정상본을 줄 수 있는 시간
const PAUSE_MS = 5 * 1000;         // 실패 뒤 Supabase 에 다시 묻지 않는 시간
const TIMEOUT_MS = 4 * 1000;       // Supabase 읽기 하나의 시간 초과

const CDN_OK = 'max-age=10, stale-while-revalidate=30, stale-if-error=600';
const CDN_ERR = 'max-age=5';

const KST_MS = 9 * 60 * 60 * 1000;
const SAMPLE_RE = /^\s*\[예시\]/;

let master = null;    // { at, settings, zones, booths }
let snap = null;      // { at, body, generatedAt }
let inflight = null;  // 진행 중인 Supabase 읽기
let pauseUntil = 0;

function kstDay(v) {
  const ms = typeof v === 'number' ? v : Date.parse(String(v || ''));
  return Number.isNaN(ms) ? '' : new Date(ms + KST_MS).toISOString().slice(0, 10);
}

async function get(path) {
  const res = await fetch(REST + path, {
    headers: { apikey: supabaseAnonKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = new Error('supabase ' + res.status);
    err.status = res.status;
    err.code = data && data.code ? String(data.code) : '';
    throw err;
  }
  return data;
}

async function readMaster() {
  const [settings, zones, booths] = await Promise.all([
    get('settings?select=event_title,venue,date_label,time_label,event_start,event_end,booth_map_url,booth_map_alt&order=id.asc&limit=1'),
    get('zones?select=key,label,sort_order&order=sort_order.asc,key.asc'),
    get('booths?select=id,no,code,zone_key,name,org,program')
  ]);
  return { settings: (settings && settings[0]) || {}, zones: zones || [], booths: booths || [] };
}

// 표가 아직 없으면(DB 설정 전 — PGRST205) null: 관람객 화면이 '행사 당일부터 표시' 로 그립니다.
async function readLive() {
  try {
    return (await get('booth_live?select=booth_id,congestion,wait_minutes,updated_at')) || [];
  } catch (err) {
    if (err.code === 'PGRST205') return null;
    throw err;
  }
}

function compose(m, liveRows, now) {
  const s = m.settings || {};
  // 행사 전(한국 날짜로 첫날 전)에는 예시 부스의 값만 미리 보여 줍니다(관람객 화면과 같은 규칙).
  const before = !!s.event_start && kstDay(now) < kstDay(s.event_start);
  const live = new Map();
  (liveRows || []).forEach((l) => { if (l && l.booth_id) live.set(l.booth_id, l); });
  const str = (v) => (v === null || v === undefined ? '' : String(v));
  return {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    liveReady: liveRows !== null,
    event: {
      title: str(s.event_title), venue: str(s.venue), dateLabel: str(s.date_label), timeLabel: str(s.time_label),
      start: s.event_start || null, end: s.event_end || null,
      mapUrl: str(s.booth_map_url), mapAlt: str(s.booth_map_alt)
    },
    zones: (m.zones || []).map((z) => ({ key: str(z.key), label: str(z.label), order: z.sort_order ?? null })),
    booths: (m.booths || []).map((b) => {
      const l = live.get(b.id);
      const show = !!(l && l.congestion) && (!before || SAMPLE_RE.test(str(b.org)));
      return {
        id: b.id,
        no: b.no ?? null,
        code: str(b.code),
        zone: str(b.zone_key),
        name: str(b.name),
        org: str(b.org).replace(/^\s*\[예시\]\s*/, ''),
        program: str(b.program),
        status: show ? String(l.congestion) : null,
        waitMinutes: show ? Number(l.wait_minutes ?? 0) : null,
        updatedAt: show ? l.updated_at : null
      };
    })
  };
}

// Supabase 에서 새로 읽어 snap 을 바꿉니다. 부스 목록 등은 60초가 지났을 때만 함께 읽고,
// 그 읽기가 실패해도 10분 안의 이전 목록이 있으면 그것으로 대기 값만 새로 만듭니다.
async function rebuild() {
  const t0 = Date.now();
  const needMaster = !master || t0 - master.at >= MASTER_MS;
  const [m, liveRows] = await Promise.all([
    needMaster
      ? readMaster().then((v) => { master = { at: t0, ...v }; return master; },
        (err) => { if (master && t0 - master.at < KEEP_MS) return master; throw err; })
      : master,
    readLive()
  ]);
  const body = JSON.stringify(compose(m, liveRows, t0));
  snap = { at: t0, body, ms: Date.now() - t0 };
  console.log('[live-snapshot] supabase read', { master: needMaster, ms: snap.ms });
}

function headers(extra) {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra
  };
}

function reply(request, status, body, extra) {
  return new Response(request.method === 'HEAD' ? null : body, { status, headers: headers(extra) });
}

export default {
  async fetch(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return reply(request, 405, '{"error":"method"}', { Allow: 'GET, HEAD', 'Vercel-CDN-Cache-Control': 'no-store' });
    }
    if (new URL(request.url).search) {
      return reply(request, 400, '{"error":"query"}', { 'Vercel-CDN-Cache-Control': 'max-age=3600' });
    }

    const now = Date.now();
    let source = 'memo';
    if (!snap || now - snap.at >= LIVE_MS) {
      if (!inflight && now >= pauseUntil) {
        inflight = rebuild().catch((err) => {
          pauseUntil = Date.now() + PAUSE_MS;
          console.error('[live-snapshot] supabase read failed', err.status || '', err.code || err.message);
          throw err;
        }).finally(() => { inflight = null; });
      }
      if (inflight) {
        try { await inflight; source = 'fresh'; } catch { source = 'last-good'; }
      } else {
        source = 'last-good';
      }
    }

    if (snap && Date.now() - snap.at < KEEP_MS) {
      const extra = { 'Vercel-CDN-Cache-Control': CDN_OK, 'X-Snapshot-Source': source };
      if (source === 'fresh') extra['Server-Timing'] = 'origin;dur=' + snap.ms;
      return reply(request, 200, snap.body, extra);
    }
    return reply(request, 503, '{"error":"unavailable"}', { 'Vercel-CDN-Cache-Control': CDN_ERR, 'Retry-After': '20' });
  }
};
