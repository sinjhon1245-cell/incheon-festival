/* ===================================================================
   관리자 부스 화면 — 협의용 예시 모드 (admin.html?demo=1#booths)

   실제 부스가 0곳이어도 회의 · 협의 · 관리자 교육에서 부스 관리 화면을
   보여 줄 수 있게 합니다. 관리자 로그인은 그대로 거칩니다(admin.js 의
   문지기). 로그인한 뒤 주소에 ?demo 가 있을 때만 admin.js 가 이 파일을 씁니다.

   데이터베이스에는 아무것도 쓰지 않습니다.
     · 구역 · 부스 · 관리자 전용 정보 · QR · 대기 현황은 모두 이 파일의 메모리에만
       있습니다. 저장 · 공개 · QR 발급 · 대기 입력을 눌러도 Supabase 요청이 나가지
       않고, 새로 고치면 처음 예시로 돌아갑니다(브라우저 저장소에도 남기지 않음).
     · 실제 데이터와 한 배열에 섞지 않습니다 — 예시 모드에서 admin.js 는 Supabase
       대신 아래 store 만 부릅니다.

   예시 부스는 관람객 · 운영자 예시(assets/mock-data.js)의 부스를 같은 id · 번호 ·
   이름으로 빌려 쓰고, 관리자에게만 보이는 값(공개 여부 · 기관 유형 · 운영 상태 ·
   QR · 관리자 전용 정보)을 덧붙입니다. 협의 때 보여야 할 경우를 하나씩 넣었습니다.
     공개 · 비공개 · 미배정 · 구역 비공개(예시 구역 D)
     여유 0 / 5 / 10 · 보통 15 / 20 · 혼잡 30 / 45 · 잠시 중단 · 오늘 마감 · 현황 미등록
     30분 넘게 그대로라 '확인 필요' 인 부스
     QR 발급됨 · QR 미발급 · QR 꺼짐(비활성)

   규칙은 데이터베이스와 같게 흉내 냅니다(supabase/migration-booth-master-data.sql).
     · 표시 번호(code)는 구역 + 두 자리 번호로 만들고, 손으로 보낸 값은 무시합니다.
     · 구역이나 번호가 비면 저절로 비공개. 공개를 켤 때 자리가 없거나 구역이
       비공개면 거절(같은 문구 · 같은 오류 코드 23514).
     · 같은 구역 같은 번호는 거절(23505). 구역 코드를 바꾸면 부스가 따라가고,
       구역을 지우면 부스는 미배정 · 비공개로 남습니다.
     · 혼잡도는 대기 시간으로 정합니다(10분 이하 여유, 25분 이하 보통, 그 위 혼잡).
     · 운영자 입력은 공개(구역도 공개)했고 QR 이 켜진 부스에서만 됩니다.
   =================================================================== */
window.AdminDemo = (function () {
  'use strict';

  var STALE_MIN = 30;   // 관람객 화면과 같은 기준(config freshnessThresholdMinutes 기본값)

  /* ── 예시 구역 ───────────────────────────────────────────────── */
  var ZONES = [
    { key: 'A', label: '예시 구역 A', sub: '협의용 예시', is_published: true },
    { key: 'B', label: '예시 구역 B', sub: '협의용 예시', is_published: true },
    { key: 'C', label: '예시 구역 C', sub: '협의용 예시', is_published: true },
    // 아직 공개하지 않은 구역 — '현재 구역이 비공개 상태입니다' 를 보여 주는 자리입니다.
    { key: 'D', label: '예시 구역 D', sub: '협의용 예시 · 준비 중', is_published: false }
  ];

  /* ── 관리자에게만 보이는 값(assets/mock-data.js 의 같은 id 에 덧붙임) ─────────
     pub: 부스 공개 · qr: 'on' 발급됨 | 'off' 꺼짐 | null 미발급 */
  var MEMO = '협의용 예시 메모 — 실제 정보가 아닙니다';
  var OVERLAY = {
    'ex-a01': { pub: true, org_type: '초등', status: '운영 중', qr: 'on', power: true,
                supplies: '테이블 2 · 멀티탭 1', manager: '예시 담당 선생님' },
    'ex-a02': { pub: true, org_type: '중등', status: '운영 중', qr: 'on', net: true },
    'ex-a03': { pub: true, org_type: '기관', status: '운영 중', qr: 'on', power: true, net: true,
                manager: '예시 담당자', memo: MEMO },
    'ex-a04': { pub: true, org_type: '고등', status: '운영 중', qr: 'on' },
    'ex-b01': { pub: true, org_type: '초등', status: '운영 중', qr: 'on', power: true },
    'ex-b02': { pub: true, org_type: '기업', status: '운영 중', qr: 'on', power: true, net: true },
    'ex-b03': { pub: true, org_type: '중등', status: '일시 중단', qr: 'on' },
    // 카드를 잃어버려 QR 을 꺼 둔 부스 — 마지막 값이 50분째 그대로라 '확인 필요'.
    'ex-b04': { pub: true, org_type: '고등', status: '운영 중', qr: 'off', power: true,
                manager: '예시 담당 선생님', notes: '협의용 예시 — 운영자 카드 분실로 QR 을 꺼 둠' },
    'ex-c01': { pub: true, org_type: '기관', status: '운영 종료', qr: 'on' },
    'ex-c02': { pub: false, org_type: '초등', status: '준비 전', qr: null },
    'ex-c04': { pub: false, org_type: '중등', status: '준비 완료', qr: null, net: true, memo: MEMO }
  };
  // 관람객 · 운영자 예시에는 없는 미배정 부스(구역 · 번호 미정).
  var UNASSIGNED = {
    id: 'ex-u01', name: '드론 코딩 체험', org: '협의용 예시 기관',
    program: '블록코딩으로 작은 드론의 비행 경로를 짜 봅니다.',
    org_type: '기관', status: '준비 전', pub: false, qr: null, power: true
  };

  /* 부스 운영 현황(booth-admin.html?demo=1)에서 쓰는 운영자 PIN 상태 · 마지막 입력 주체.
     PIN 은 상태만 흉내 냅니다(실제 PIN · 세션은 만들지 않습니다).
     state: 'on' 발급됨 · 'off' 꺼짐 · 없으면 미발급 / sessions: PIN 로그인 기기 수 / failures: 최근 1시간 실패 */
  var PIN_OVERLAY = {
    'ex-a01': { state: 'on', sessions: 2 },
    'ex-a03': { state: 'on', sessions: 0 },
    'ex-b02': { state: 'off', sessions: 0 },
    'ex-b03': { state: 'on', sessions: 0, failures: 12 },
    // 운영자 카드를 잃어버려 QR 을 꺼 두고 PIN 으로 운영하는 부스
    'ex-b04': { state: 'on', sessions: 1 }
  };
  var LIVE_BY = { 'ex-a01': 'pin', 'ex-b04': 'pin', 'ex-c01': 'admin' };

  var state = null;
  var seq = 0;

  function nowMs() { return Date.now(); }
  function isoAgo(min) { return new Date(nowMs() - min * 60000).toISOString(); }
  function copy(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function hasSlot(b) { return !!(b && b.zone_key && b.no != null && b.no !== ''); }
  function codeOf(b) {
    if (!hasSlot(b)) return '';
    var n = String(b.no);
    while (n.length < 2) n = '0' + n;
    return b.zone_key + '-' + n;
  }
  function err(code, message) { var e = new Error(message); e.code = code; return e; }
  function newId(prefix) { seq += 1; return 'ex-' + prefix + '-' + nowMs().toString(36) + '-' + seq; }

  /* 처음 예시를 펼칩니다. 페이지를 열 때마다 새로 — 저장해 두지 않습니다. */
  function seed() {
    var src = (window.MOCK_BOOTHS || []).filter(function (m) { return OVERLAY[m.id]; });
    var zones = ZONES.map(function (z, i) {
      return { id: 'ex-zone-' + z.key, key: z.key, label: z.label, sub: z.sub,
               is_published: z.is_published, sort_order: i + 1 };
    });
    var booths = [], priv = [], live = {}, access = {};
    function addBooth(m, o, zoneKey, no, i) {
      booths.push({
        id: m.id, zone_key: zoneKey, no: no, code: '',
        name: m.name, org: m.org, org_type: o.org_type || null, program: m.program || '',
        hours: '10:00 ~ 17:00', supplies: o.supplies || '',
        needs_power: !!o.power, needs_network: !!o.net,
        status: o.status || '준비 전', is_published: !!o.pub,
        image_url: '', image_alt: '', image_caption: '', sort_order: i + 1
      });
      if (o.manager || o.memo || o.notes) {
        priv.push({ id: 'ex-priv-' + m.id, booth_id: m.id, manager: o.manager || '', manager_phone: '',
                    memo: o.memo || '', notes: o.notes || '' });
      }
      if (m.congestion) live[m.id] = { congestion: m.congestion, wait_minutes: m.wait_minutes || 0,
                                       updated_at: isoAgo(m.age_min || 0), by: LIVE_BY[m.id] || 'qr' };
      if (o.qr) access[m.id] = { on: o.qr === 'on', issued_at: isoAgo(60 * 24) };
    }
    src.forEach(function (m, i) {
      addBooth(m, OVERLAY[m.id], m.zone_key, Number(String(m.code).split('-')[1]), i);
    });
    addBooth(UNASSIGNED, UNASSIGNED, null, null, src.length);
    booths.forEach(function (b) { b.code = codeOf(b); if (!hasSlot(b)) b.is_published = false; });
    state = { zones: zones, booths: booths, booth_private: priv, live: live, access: access, pin: copy(PIN_OVERLAY) };
  }

  function rows(table) {
    if (!state) seed();
    return state[table] || null;
  }
  function find(table, id) {
    return (rows(table) || []).filter(function (r) { return r.id === id; })[0] || null;
  }
  function zoneOf(key) {
    return key ? rows('zones').filter(function (z) { return z.key === key; })[0] || null : null;
  }

  /* 데이터베이스 저장 트리거(booths_before_write)와 같은 일을 합니다. */
  function boothRules(nw, old) {
    if (nw.no != null && nw.no !== '' && (Number(nw.no) < 1 || Number(nw.no) > 999)) {
      throw err('23514', '부스 번호는 1~999 사이여야 합니다.');
    }
    nw.code = codeOf(nw);
    var opening = !!nw.is_published && !(old && old.is_published);
    if (!hasSlot(nw)) {
      if (opening) throw err('23514', '구역과 부스 번호를 먼저 지정해 주세요.');
      nw.is_published = false;
    } else if (opening) {
      var z = zoneOf(nw.zone_key);
      if (!z || !z.is_published) throw err('23514', '현재 구역이 비공개 상태입니다. 구역을 먼저 공개해 주세요.');
    }
    if (hasSlot(nw)) {
      var dup = rows('booths').some(function (b) {
        return b.id !== nw.id && b.zone_key === nw.zone_key && Number(b.no) === Number(nw.no);
      });
      if (dup) throw err('23505', 'duplicate key value violates unique constraint "booths_zone_no_key"');
    }
    if (nw.zone_key && !zoneOf(nw.zone_key)) throw err('23503', '없는 구역입니다.');
    return nw;
  }

  function resolve(v) { return Promise.resolve(copy(v)); }
  function reject(e) { return Promise.reject(e); }
  function onlyDemo(table) {
    return reject(err('42501', '협의용 예시 화면에서는 부스 · 구역만 다룹니다. 실제 관리자 화면으로 돌아가 주세요.'));
  }

  /* ── admin.js 가 Supabase 대신 부르는 store (Core 와 같은 모양 · 같은 Promise) ── */
  var store = {
    select: function (table) {
      var r = rows(table);
      return resolve(r ? r.slice().sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); }) : []);
    },
    selectSoft: function (table) { return store.select(table); },

    insert: function (table, values) {
      try {
        if (table === 'zones') {
          var key = String(values.key || '').trim();
          if (zoneOf(key)) throw err('23505', 'duplicate key value violates unique constraint "zones_pkey"');
          var z = Object.assign({ label: '', sub: '', is_published: false, sort_order: rows('zones').length + 1 },
                                values, { id: newId('zone'), key: key });
          rows('zones').push(z);
          return resolve(z);
        }
        if (table === 'booths') {
          var b = Object.assign({ zone_key: null, no: null, name: '', org: '', org_type: null, program: '',
                                  hours: '', supplies: '', needs_power: false, needs_network: false,
                                  status: '준비 전', is_published: false, image_url: '', image_alt: '',
                                  image_caption: '', sort_order: rows('booths').length + 1 },
                                values, { id: newId('booth') });
          boothRules(b, null);
          rows('booths').push(b);
          return resolve(b);
        }
        if (table === 'booth_private') return store.upsert(table, values, 'booth_id');
        return onlyDemo(table);
      } catch (e) { return reject(e); }
    },

    update: function (table, id, patch) {
      try {
        if (table === 'zones') {
          var z = find('zones', id);
          if (!z) throw err('PGRST116', '없는 구역입니다.');
          var nk = patch.key != null ? String(patch.key).trim() : z.key;
          if (nk !== z.key && zoneOf(nk)) throw err('23505', 'duplicate key value violates unique constraint "zones_pkey"');
          var oldKey = z.key;
          Object.assign(z, patch, { key: nk });
          // on update cascade + 저장 트리거: 부스가 새 코드를 따라가고 표시 번호도 다시 셉니다.
          if (nk !== oldKey) {
            rows('booths').forEach(function (b) {
              if (b.zone_key === oldKey) { b.zone_key = nk; b.code = codeOf(b); }
            });
          }
          return resolve(z);
        }
        if (table === 'booths') {
          var old = find('booths', id);
          if (!old) throw err('PGRST116', '없는 부스입니다.');
          var nw = boothRules(Object.assign({}, old, patch, { id: id }), old);
          Object.assign(old, nw);
          return resolve(old);
        }
        if (table === 'booth_private') {
          var p = find('booth_private', id);
          if (!p) throw err('PGRST116', '없는 줄입니다.');
          Object.assign(p, patch);
          return resolve(p);
        }
        return onlyDemo(table);
      } catch (e) { return reject(e); }
    },

    remove: function (table, id) {
      if (table === 'zones') {
        var z = find('zones', id);
        if (z) {
          // on delete set null + 저장 트리거: 부스는 남고 미배정 · 비공개가 됩니다.
          rows('booths').forEach(function (b) {
            if (b.zone_key === z.key) { b.zone_key = null; b.code = ''; b.is_published = false; }
          });
          state.zones = rows('zones').filter(function (x) { return x.id !== id; });
        }
        return Promise.resolve();
      }
      if (table === 'booths') {
        // 부스를 지우면 딸린 관리자 전용 정보 · QR · 대기 현황도 함께 지워집니다(on delete cascade).
        state.booths = rows('booths').filter(function (x) { return x.id !== id; });
        state.booth_private = rows('booth_private').filter(function (x) { return x.booth_id !== id; });
        delete state.live[id];
        delete state.access[id];
        return Promise.resolve();
      }
      return onlyDemo(table);
    },

    upsert: function (table, payload) {
      if (table !== 'booth_private') return onlyDemo(table);
      var p = rows('booth_private').filter(function (x) { return x.booth_id === payload.booth_id; })[0];
      if (p) Object.assign(p, payload);
      else { p = Object.assign({ id: newId('priv'), manager: '', manager_phone: '', memo: '', notes: '' }, payload); rows('booth_private').push(p); }
      return resolve(p);
    }
  };

  /* ── QR(운영자 카드) 흉내 — 실제 열쇠는 만들지 않습니다 ─────────────
     상태만 바꿉니다: 미발급 → 발급됨 → 꺼짐 → (새 열쇠로) 다시 켜짐. */
  function accessOf(id) {
    if (!state) seed();
    var a = state.access[id];
    return a ? (a.on ? 'on' : 'off') : 'none';
  }
  function issue(id) {
    var b = find('booths', id);
    if (!b) return '없는 부스입니다.';
    if (!hasSlot(b)) return '구역 · 번호가 정해진 부스에만 운영자 QR을 발급할 수 있습니다.';
    if (state.access[id]) return '이미 발급된 부스입니다.';
    state.access[id] = { on: true, issued_at: new Date().toISOString() };
    return '';
  }
  function disable(id) {
    var a = state && state.access[id];
    if (!a || !a.on) return '켜진 운영자 QR이 없습니다.';
    a.on = false;
    return '';
  }
  function rekey(id) {
    var a = state && state.access[id];
    if (!a) return '아직 발급하지 않은 부스입니다. 먼저 발급해 주세요.';
    a.on = true; a.issued_at = new Date().toISOString();
    return '';
  }

  /* ── 대기 현황 흉내(운영자 화면에서 누르는 것과 같은 규칙) ─────────────── */
  function congestionFor(w) { return w <= 10 ? '여유' : (w <= 25 ? '보통' : '혼잡'); }
  function liveOf(id) {
    if (!state) seed();
    return copy(state.live[id] || null);
  }
  function setLive(id, mode, wait) {
    var b = find('booths', id);
    if (!b) return '없는 부스입니다.';
    var z = zoneOf(b.zone_key);
    if (!(b.is_published && hasSlot(b) && z && z.is_published)) {
      return '공개한 부스(구역도 공개)만 운영자 화면에서 입력할 수 있습니다.';
    }
    if (accessOf(id) !== 'on') return '운영자 QR이 켜진 부스만 입력할 수 있습니다.';
    var c = mode === 'pause' ? '중단' : (mode === 'closed' ? '마감' : congestionFor(Number(wait) || 0));
    state.live[id] = { congestion: c, wait_minutes: mode === 'open' ? (Number(wait) || 0) : 0,
                       updated_at: new Date().toISOString(), by: 'qr' };
    return '';
  }

  /* ── 부스 운영 현황(booth-admin.html?demo=1) 전용 ───────────────────
     관리자 직접 수정은 실제 admin_set_booth_live 처럼 QR · 공개와 상관없이 됩니다('clear' = 값 지우기).
     PIN 은 상태만 돌려줍니다. */
  function adminSetLive(id, mode, wait) {
    var b = find('booths', id);
    if (!b) return '없는 부스입니다.';
    if (mode === 'clear') { delete state.live[id]; return ''; }
    if (mode !== 'open' && mode !== 'pause' && mode !== 'closed') return '허용되지 않는 상태입니다.';
    var w = Number(wait);
    if (mode === 'open' && (isNaN(w) || w < 0 || w > 180)) return '대기 시간은 0~180분이어야 합니다.';
    var c = mode === 'pause' ? '중단' : (mode === 'closed' ? '마감' : congestionFor(w));
    state.live[id] = { congestion: c, wait_minutes: mode === 'open' ? w : 0, updated_at: new Date().toISOString(), by: 'admin' };
    return '';
  }
  function pinOf(id) {
    if (!state) seed();
    var p = state.pin[id];
    return p ? { state: p.state, sessions: p.sessions || 0, failures: p.failures || 0 } : { state: 'none', sessions: 0, failures: 0 };
  }
  /* ── 운영자 PIN 흉내(관리자 예시) ───────────────────────────────────
     상태만 바꿉니다: 미발급 → 발급됨 → (재발급) → 꺼짐 → (새 PIN 으로) 다시 켜짐.
     보여 주는 PIN 은 운영자 예시와 같은 4자리 규칙(mock-data.js 의 MOCK_DEMO_PIN)이라
     관리자 예시에서 본 PIN 으로 운영자 예시 화면을 바로 열어 볼 수 있습니다. 실제 PIN · 세션 ·
     데이터베이스와는 관계가 없고, 재발급해도 예시 PIN 값은 바뀌지 않습니다. */
  function demoPin(id) {
    var b = find('booths', id);
    return (b && hasSlot(b) && typeof window.MOCK_DEMO_PIN === 'function') ? window.MOCK_DEMO_PIN(codeOf(b)) : '';
  }
  function pinIssue(id) {
    var b = find('booths', id);
    if (!b) return { error: '없는 부스입니다.' };
    if (!hasSlot(b)) return { error: '구역과 부스 번호를 먼저 지정해 주세요.' };
    var old = state.pin[id];
    var revoked = old && old.state === 'on' ? (old.sessions || 0) : 0;
    state.pin[id] = { state: 'on', sessions: 0, failures: 0 };
    return { pin: demoPin(id), revoked: revoked, before: old ? old.state : 'none' };
  }
  function pinOff(id) {
    var p = state && state.pin[id];
    if (!p || p.state !== 'on') return { error: '켜진 운영자 PIN이 없습니다.' };
    var revoked = p.sessions || 0;
    state.pin[id] = { state: 'off', sessions: 0, failures: 0 };
    return { revoked: revoked };
  }
  /* 행사 당일 화면에서 보여 줄 경우를 더 채웁니다(이 화면을 열 때만, 관리자 예시에는 영향 없음).
       C-02  공개 · QR 미발급 · PIN 으로 넣은 값이 38분째 그대로 → '확인 필요'
       C-04  공개 · QR · PIN 미발급 · 아직 아무도 누르지 않음 → '현황 미입력' */
  function prepareLiveDemo() {
    if (!state) seed();
    ['ex-c02', 'ex-c04'].forEach(function (id) { var b = find('booths', id); if (b && hasSlot(b)) b.is_published = true; });
    if (find('booths', 'ex-c02')) {
      state.live['ex-c02'] = { congestion: '보통', wait_minutes: 20, updated_at: isoAgo(38), by: 'pin' };
      state.pin['ex-c02'] = { state: 'on', sessions: 0 };
    }
    delete state.live['ex-c04'];
  }
  function minutesAgo(l) { return l ? Math.max(0, Math.floor((nowMs() - Date.parse(l.updated_at)) / 60000)) : null; }
  // 30분 넘게 그대로면 '확인 필요'. 마감은 그날 안에는 흐려지지 않습니다(관람객 화면과 같음).
  function isStale(l) { return !!l && l.congestion !== '마감' && minutesAgo(l) > STALE_MIN; }
  function liveLabel(l) {
    if (!l) return '현황 미등록';
    if (l.congestion === '중단') return '잠시 중단';
    if (l.congestion === '마감') return '오늘 마감';
    return l.congestion + ' · ' + (l.wait_minutes ? '약 ' + l.wait_minutes + '분' : '바로');
  }

  return {
    store: store,
    accessOf: accessOf, issue: issue, disable: disable, rekey: rekey,
    liveOf: liveOf, setLive: setLive, isStale: isStale, liveLabel: liveLabel, minutesAgo: minutesAgo,
    staleMinutes: STALE_MIN,
    adminSetLive: adminSetLive, pinOf: pinOf, prepareLiveDemo: prepareLiveDemo,
    demoPin: demoPin, pinIssue: pinIssue, pinOff: pinOff,
    // 부스 운영 현황 예시가 그 자리에서 그리도록 구역 · 부스의 복사본을 바로 돌려줍니다.
    rowsOf: function (table) { return copy(rows(table) || []); }
  };
})();
