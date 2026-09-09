/* ===================================================================
   Supabase 연결 계층 — 공개 사이트와 관리자 사이트가 함께 씁니다.

   설계 원칙 하나: 이 파일이 실패해도 공개 사이트는 죽지 않습니다.
   Supabase 설정이 비었거나 연결이 안 되면 fallback-data.js 의
   내용으로 그냥 보여 줍니다. 행사 안내 페이지가 네트워크 문제로
   백지가 되는 일은 없어야 하니까요.
   =================================================================== */
window.FestivalData = (function () {
  'use strict';

  var cfg = window.FESTIVAL_CONFIG || {};
  var client = null;

  /* 순서를 지켜야 하는 표들. 관리자에서 ↑↓ 로 바꾸는 그 순서입니다. */
  var TABLES = ['programs', 'schedule_items', 'zones', 'booths', 'faqs'];

  function isConfigured() {
    return !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  }

  function getClient() {
    if (client) return client;
    if (!isConfigured()) return null;
    if (!window.supabase || !window.supabase.createClient) return null;
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    return client;
  }

  /* ── 화면이 쓰는 모양으로 바꿉니다 ─────────────────────────────
     데이터베이스 칼럼 이름(time_label, zone_key…)과 화면에서 쓰던
     이름(time, zone…)이 달라서, 여기서 한 번에 맞춥니다. */
  function shape(raw) {
    var s = raw.settings || {};
    return {
      source: raw.source,
      settings: s,
      programs: (raw.programs || []).map(function (p) {
        return { no: p.no, title: p.title, desc: p.description, meta: p.meta, tint: p.tint, deep: p.deep };
      }),
      schedule: (raw.schedule_items || []).map(function (r) {
        return { half: r.half, time: r.time_label, dur: r.duration, title: r.title, place: r.place, cat: r.category };
      }),
      zones: (raw.zones || []).map(function (z) {
        return { key: z.key, label: z.label, sub: z.sub, from: z.range_from, to: z.range_to,
                 tint: z.tint, solid: z.solid, deep: z.deep };
      }),
      booths: (raw.booths || []).map(function (b) {
        return { no: b.no, zone: b.zone_key, name: b.name, org: b.org };
      }),
      faqs: (raw.faqs || []).map(function (f) {
        return { q: f.question, a: f.answer };
      })
    };
  }

  function fallback(reason) {
    var f = window.FESTIVAL_FALLBACK || {};
    return shape({
      source: 'local',
      reason: reason,
      settings: f.settings,
      programs: f.programs,
      schedule_items: f.schedule_items,
      zones: f.zones,
      booths: f.booths,
      faqs: f.faqs
    });
  }

  /* 공개 사이트가 부르는 함수. 무슨 일이 있어도 resolve 합니다. */
  function load() {
    var db = getClient();
    if (!db) {
      return Promise.resolve(fallback(isConfigured() ? 'supabase-js 를 불러오지 못했습니다' : '설정 없음'));
    }

    var queries = TABLES.map(function (t) {
      return db.from(t).select('*').order('sort_order', { ascending: true });
    });
    queries.push(db.from('settings').select('*').eq('id', 1).maybeSingle());

    return Promise.all(queries).then(function (res) {
      var firstError = res.find(function (r) { return r.error; });
      if (firstError) throw firstError.error;

      var out = { source: 'supabase' };
      TABLES.forEach(function (t, i) { out[t] = res[i].data || []; });
      out.settings = res[TABLES.length].data || (window.FESTIVAL_FALLBACK || {}).settings || {};

      // 표가 비어 있으면(스키마만 만들고 데이터를 안 넣은 상태) 기본 내용으로.
      if (!out.programs.length && !out.schedule_items.length && !out.booths.length) {
        return fallback('Supabase 에 데이터가 아직 없습니다');
      }
      return shape(out);
    }).catch(function (e) {
      console.warn('[FestivalData] Supabase 를 읽지 못해 기본 내용으로 표시합니다:', e && e.message);
      return fallback('연결 실패');
    });
  }

  return {
    load: load,
    getClient: getClient,
    isConfigured: isConfigured,
    TABLES: TABLES
  };
})();
