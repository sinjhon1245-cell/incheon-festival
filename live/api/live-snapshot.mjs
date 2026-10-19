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
               예외: 사전 안내로 고른 배치 전 부스는 booth_preview_list() 로
               이름 · 기관 · 체험 내용만 따로 받아 unplaced 에 싣습니다
               (구역 · 번호 · 대기 값 없음, 운영자 접속 조건과 무관).

   응답에 넣는 것은 관람객 화면이 그리는 공개 값뿐입니다. QR 열쇠 · PIN · 세션 ·
   담당자 연락처 · 메모 · booth_private · 관리자 정보는 읽지도 않습니다.
   기관 이름 앞의 '[예시]' 같은 내부 표시도 떼어 냅니다.
   대기 값은 관람객 화면과 같은 때의 규칙(livePhase)을 여기서도 적용해, 보여 주면 안 되는 값은 아예
   보내지 않습니다(칸은 그대로 두고 status · waitMinutes · updatedAt 만 null).
     행사 전(한국 날짜로 첫날 전) — 리허설: 오늘(한국 날짜) 넣은 값만 보냅니다. 관람객 화면이 맨 위에
                                    '리허설 중 · 실제 대기시간이 아닙니다' 띠를 붙입니다.
     행사 날 운영 시간(첫날의 여는 시각 ~ 끝날의 닫는 시각, 기본정보 event_start · event_end)
                                  — 오늘 문을 연 뒤 넣은 값만 보냅니다(전날 리허설 값 · 아침 준비 값 제외).
     행사 날 문 열기 전 · 닫은 뒤 · 행사가 끝난 뒤 — 대기 값을 보내지 않습니다.
   그래서 23시 자동 초기화가 빠졌어도, 남은 리허설 값이 행사 당일 공개 API 로 '지금 대기' 처럼 나가지 않습니다.
   캐시된 응답(마지막 정상본)을 내줄 때도 그 사이 때가 바뀌었으면(10:00 · 17:00 · 자정) 지금 때로 다시 만듭니다.

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

// 관람객 화면의 받기 방식. Vercel → Settings → Environment Variables 의 VISITOR_TRAFFIC_MODE 로 정합니다
// (normal 60초 · conserve 120초 · manual 자동 없음). 값을 바꾼 뒤 Redeploy 하면 관람객 화면이 다음
// 받기부터 따릅니다. 코드 · DB 는 그대로이고, QR · PIN · 운영자 저장 · 관리 화면에는 영향이 없습니다.
// 모르는 값이거나 비어 있으면 normal 입니다.
const MODE = /^(normal|conserve|manual)$/.test(String(process.env.VISITOR_TRAFFIC_MODE || '').trim().toLowerCase())
  ? String(process.env.VISITOR_TRAFFIC_MODE).trim().toLowerCase() : 'normal';

const SAMPLE_RE = /^\s*\[예시\]/;
const KST_MS = 9 * 60 * 60 * 1000;   // 한국은 서머타임이 없어 9시간을 더한 UTC 날짜 · 시각이 곧 한국 날짜 · 시각
const DAY_MS = 24 * 60 * 60 * 1000;

let master = null;    // { at, settings, zones, booths }
let snap = null;      // { at, body, ms, key, m, liveRows } — key: 만들 때의 때(livePhase().key)
let inflight = null;  // 진행 중인 Supabase 읽기
let pauseUntil = 0;

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
  const [settings, zones, booths, unplaced] = await Promise.all([
    get('settings?select=event_title,venue,date_label,time_label,event_start,event_end,booth_map_url,booth_map_alt&order=id.asc&limit=1'),
    get('zones?select=key,label,sort_order&order=sort_order.asc,key.asc'),
    get('booths?select=id,no,code,zone_key,name,org,program'),
    readUnplaced()
  ]);
  return { settings: (settings && settings[0]) || {}, zones: zones || [], booths: booths || [], unplaced: unplaced || [] };
}

// 배치 준비 중(사전 안내) 부스 — supabase/migration-booth-preview.sql 의 booth_preview_list().
// 이름 · 기관 · 체험 내용만 옵니다(구역 · 번호 · 대기 값 없음). 운영자 접속과는 무관합니다.
// 함수가 아직 없으면(PGRST202 · 404) 빈 목록 — 화면은 지금과 같게 그립니다.
// 다른 실패(권한 · 시간 초과 · 5xx)는 부스 · 구역 · 기본정보 읽기까지 막지 않습니다. 이 인스턴스의
// 지난 목록을 그대로 쓰고(처음이면 빈 목록), 공개 부스 · 대기 값은 평소대로 새로 그립니다.
async function readUnplaced() {
  try {
    return (await get('rpc/booth_preview_list')) || [];
  } catch (err) {
    if (err.code === 'PGRST202' || err.status === 404) return [];
    console.error('[live-snapshot] booth_preview_list failed', err.status || '', err.code || err.message);
    return (master && master.unplaced) || [];
  }
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

/* 지금 어떤 대기 값을 보내도 되는가 — 관람객 화면(booth-core eventInfo · applyOpenRule · visitor.html derive)과
   같은 읽기입니다. 여는 시각 = event_start 의 한국 시각, 닫는 시각 = event_end 의 한국 시각, 행사 날 = 두 날짜 사이.
     { key, from }  from(ms) 이후에 넣은 값만 보냄 · from 이 null 이면 아무 값도 보내지 않음
     key           때가 바뀌는 곳(자정 · 여는 시각 · 닫는 시각)마다 달라지는 이름 — 캐시한 응답을 다시 만들지 정할 때 씀
   일정이 비었거나 읽을 수 없으면 거르지 않습니다(관람객 화면도 그때는 늘 '운영 중' 으로 그림). */
function livePhase(s, now) {
  const a = Date.parse(String((s && s.event_start) || '')), b = Date.parse(String((s && s.event_end) || ''));
  if (Number.isNaN(a) || Number.isNaN(b)) return { key: 'always', from: 0 };
  const day = Math.floor((now + KST_MS) / DAY_MS);
  const first = Math.floor((a + KST_MS) / DAY_MS), last = Math.floor((b + KST_MS) / DAY_MS);
  const min = Math.floor(((now + KST_MS) % DAY_MS) / 60000);
  const openMin = Math.floor(((a + KST_MS) % DAY_MS) / 60000);
  let closeMin = Math.floor(((b + KST_MS) % DAY_MS) / 60000);
  if (closeMin <= openMin) closeMin = 24 * 60;   // 닫는 시각이 여는 시각보다 이르면 그날 끝까지(관람객 화면과 같음)
  const dayStart = day * DAY_MS - KST_MS;         // 오늘 0시(한국)
  if (day < first) return { key: 'before:' + day, from: dayStart };              // 리허설: 오늘 넣은 값만
  if (day > last) return { key: 'after', from: null };
  if (min < openMin) return { key: 'preopen:' + day, from: null };
  if (min >= closeMin) return { key: 'closed:' + day, from: null };
  return { key: 'open:' + day, from: dayStart + openMin * 60000 };               // 오늘 문 연 뒤 값만
}

function compose(m, liveRows, now) {
  const s = m.settings || {};
  const phase = livePhase(s, now);
  const live = new Map();
  (liveRows || []).forEach((l) => { if (l && l.booth_id) live.set(l.booth_id, l); });
  const str = (v) => (v === null || v === undefined ? '' : String(v));
  return {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    mode: MODE,
    liveReady: liveRows !== null,
    event: {
      title: str(s.event_title), venue: str(s.venue), dateLabel: str(s.date_label), timeLabel: str(s.time_label),
      start: s.event_start || null, end: s.event_end || null,
      mapUrl: str(s.booth_map_url), mapAlt: str(s.booth_map_alt)
    },
    zones: (m.zones || []).map((z) => ({ key: str(z.key), label: str(z.label), order: z.sort_order ?? null })),
    booths: (m.booths || []).map((b) => {
      const l = live.get(b.id);
      // 지금 때에 보여도 되는 값만(livePhase). 값을 넣은 시각을 읽을 수 없으면 보내지 않습니다.
      const at = l ? Date.parse(String(l.updated_at || '')) : NaN;
      const show = !!(l && l.congestion) && phase.from !== null && !Number.isNaN(at) && at >= phase.from;
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
    }),
    // 배치 준비 중: booths 와 따로 둡니다. 예전 화면(이 칸을 모름)은 그대로 booths 만 그립니다.
    // 대기 값은 싣지 않습니다(배치 · 공개 전에는 운영자가 입력할 수도 없음).
    unplaced: (m.unplaced || []).filter((b) => b && b.id && !SAMPLE_RE.test(str(b.org))).map((b) => ({
      id: b.id,
      name: str(b.name),
      org: str(b.org),
      program: str(b.program)
    }))
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
  snap = { at: t0, body, ms: Date.now() - t0, key: livePhase(m.settings, t0).key, m, liveRows };
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
      // 만든 뒤 때가 바뀌었으면(예: 16:59 에 만든 마지막 정상본을 17:00 뒤에 내줄 때) 지금 때로 다시 만듭니다.
      // Supabase 를 다시 읽지 않고 받아 둔 값으로만 만들며, 만든 시각(at · 마지막 정상본 10분 기준)은 그대로 둡니다.
      const t1 = Date.now(), key = livePhase(snap.m.settings, t1).key;
      if (key !== snap.key) snap = { ...snap, key, body: JSON.stringify(compose(snap.m, snap.liveRows, t1)) };
      const extra = { 'Vercel-CDN-Cache-Control': CDN_OK, 'X-Snapshot-Source': source };
      if (source === 'fresh') extra['Server-Timing'] = 'origin;dur=' + snap.ms;
      return reply(request, 200, snap.body, extra);
    }
    return reply(request, 503, '{"error":"unavailable"}', { 'Vercel-CDN-Cache-Control': CDN_ERR, 'Retry-After': '20' });
  }
};
