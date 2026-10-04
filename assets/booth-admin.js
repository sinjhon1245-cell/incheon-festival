/* ===================================================================
   부스 운영 현황 (booth-admin.html) — 행사 당일 운영 콘솔

   "지금 어느 부스가 문제인가?" 를 빠르게 보여 줍니다. 정보 설정(구역 · 부스 등록 ·
   공개 · 기관 · 담당자 · QR · PIN)은 관리자 화면(admin.html)이 맡고, 이 화면은
   대기 시간 · 혼잡 · 마지막 입력 · 미입력 · 확인 필요 · 중단 · 마감을 봅니다.
   고칠 수 있는 것은 하나뿐입니다 — 관리자 긴급 수정(admin_set_booth_live, 기록에 'admin').
   시연 전 '예시 현황 초기화' 도 같은 함수를 [예시] 부스마다 부를 뿐입니다(아래 resetExamples).

   보안: 관리자 화면과 같은 로그인 · 같은 문지기(staff_profiles.role = 'admin').
   이 파일에는 권한이 없습니다. 읽기는 관리자 RLS, 쓰기는 함수 안의 is_admin() 이 막습니다.

   읽는 것 (실제 모드)
     · booth_live            15초마다(±20%, 화면이 가려지면 쉼) — 관람객 화면(20초)보다 조금 빠르게
     · zones · booths · admin_booth_credentials()   60초마다 — 관리자가 부스를 고칠 수 있어
       관람객 화면(5분)보다 자주. QR · PIN 은 '상태' 만 받습니다(열쇠 · PIN · 해시 없음).
     Realtime 은 쓰지 않습니다(관람객 · 운영자 화면과 같은 까닭 — booth-core.js 머리말).

   규칙은 새로 만들지 않고 공통 엔진(booth-core.js)을 씁니다.
     상태 이름(meta) · 혼잡도(congestionFor: 10분 이하 여유, 25분 이하 보통, 그 위 혼잡) ·
     '확인 필요'(isStale: 마감이 아니고 staleMinutes 분 넘게 그대로) · 'N분 전'(formatAgo) ·
     대기 시간 단추(WAIT_CHOICES) · 오늘(한국 날짜) 값만 쓰는 규칙.

   협의용 예시 (booth-admin.html?demo=1)
     로그인 · 관리자 확인은 그대로 거친 뒤, assets/admin-demo.js 의 메모리 예시만 씁니다.
     Supabase 로는 로그인 확인(staff_profiles) 말고 아무것도 읽지도 쓰지도 않습니다.
     현황 수정도 이 화면 안에서만 바뀌고, 새로 고치면 처음 예시로 돌아갑니다.
   =================================================================== */
(function () {
  'use strict';

  var C = window.Core;
  var BC = window.BoothCore;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = C.esc;

  var DEMO = (function () {
    try { return new URLSearchParams(window.location.search).has('demo'); } catch (e) { return false; }
  })() && !!window.AdminDemo;
  var AD = window.AdminDemo;
  var DEMO_TEXT = '협의용 예시 · 실제 행사 정보가 아닙니다.';

  var LIVE_MS = 15000;
  var MASTER_MS = 60000;
  var PIN_FAIL_WARN = 10;   // 관리자 화면의 'PIN 실패 많음' 과 같은 기준

  var SORTS = [['ops', '운영 우선'], ['code', '부스번호'], ['wait', '대기시간 높은 순'], ['oldest', '최근 입력 오래된 순']];
  /* 맨 위 요약 = 걸러 보기. 행사 당일 '손이 가야 하는 부스' 중심으로만 둡니다(운영 중 수는 결과 줄과
     구역 현황이 말합니다). 빨강 = 혼잡 · 확인 필요, 주황 = 미입력(주의), 회색 = 중단 · 마감.
     QR 문제 · PIN 확인은 해당 부스가 있을 때만 붙습니다(summaryHtml). */
  var QUICK = [
    ['all', '전체'], ['busy', '혼잡', 'danger'], ['stale', '확인 필요', 'danger'],
    ['missing', '미입력', 'warn'], ['pause', '일시 중단'], ['closed', '운영 종료']
  ];
  var BY = { qr: '운영자 QR', pin: '운영자 PIN', admin: '관리자 입력' };

  var data = { zones: [], booths: [], live: {}, creds: null, liveAt: null, masterAt: null, failAt: null };
  var ui = { view: 'live', quick: 'all', zone: '', q: '', sort: 'ops', hidden: false, more: '' };
  var busy = {};
  var stops = [];
  var started = false;

  /* ── 알림 ───────────────────────────────────────────────────── */
  var toastTimer;
  function toast(msg, isError) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('is-error', !!isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, isError ? 6000 : 2600);
  }

  /* ── 데이터 ─────────────────────────────────────────────────── */
  function loadMaster() {
    if (DEMO) { demoPull(); return Promise.resolve(); }
    return Promise.all([
      C.select('zones', { columns: 'key,label,sort_order,is_published', order: [['sort_order', true], ['key', true]] }),
      C.select('booths', { columns: 'id,zone_key,no,code,name,org,program,is_published', order: false }),
      // PIN 기능 전(함수 없음)이거나 못 읽으면 접속 칸만 비웁니다.
      C.rpc('admin_booth_credentials').then(null, function () { return null; })
    ]).then(function (r) {
      data.zones = r[0] || [];
      data.booths = r[1] || [];
      data.creds = r[2] ? indexBy(r[2], 'booth_id') : null;
      data.masterAt = new Date();
    });
  }
  function loadLive() {
    if (DEMO) { demoPull(); data.liveAt = new Date(); data.failAt = null; return Promise.resolve(); }
    return C.select('booth_live', { columns: 'booth_id,congestion,wait_minutes,updated_at', order: false }).then(function (rows) {
      data.live = indexBy(rows || [], 'booth_id');
      data.liveAt = new Date();
      data.failAt = null;
    });
  }
  function indexBy(rows, k) {
    var m = {};
    rows.forEach(function (r) { m[r[k]] = r; });
    return m;
  }
  // 예시: admin-demo.js 의 메모리 상태를 이 화면의 모양으로 옮깁니다(복사본).
  function demoPull() {
    var live = {}, creds = {};
    data.zones = AD.rowsOf('zones');
    data.booths = AD.rowsOf('booths');
    data.booths.forEach(function (b) {
      var l = AD.liveOf(b.id);
      if (l) live[b.id] = { booth_id: b.id, congestion: l.congestion, wait_minutes: l.wait_minutes, updated_at: l.updated_at, by: l.by };
      var p = AD.pinOf(b.id);
      creds[b.id] = { booth_id: b.id, qr_state: AD.accessOf(b.id), pin_state: p.state, pin_sessions: p.sessions,
                      pin_failures_1h: p.failures, live_by: l ? l.by : null };
    });
    data.live = live;
    data.creds = creds;
    data.masterAt = new Date();
  }

  /* ── 한 부스의 지금 모습 ───────────────────────────────────────── */
  function zoneMap() {
    var m = {};
    data.zones.forEach(function (z, i) { m[z.key] = { z: z, i: i }; });
    return m;
  }
  function rowsNow() {
    var zm = zoneMap();
    var today = BC.kstDay(Date.now());
    return data.booths.map(function (b) {
      var zz = b.zone_key ? zm[b.zone_key] : null;
      var slot = !!b.zone_key && b.no !== null && b.no !== undefined && b.no !== '';
      var shown = !!(b.is_published && slot && zz && zz.z.is_published);
      var l = data.live[b.id];
      // 오늘(한국 날짜) 넣은 값만 지금 값입니다(관람객 화면과 같은 규칙).
      var t = l && l.congestion && BC.kstDay(l.updated_at) === today ? l : null;
      var cred = data.creds ? (data.creds[b.id] || { qr_state: 'none', pin_state: 'none', pin_sessions: 0, pin_failures_1h: 0, live_by: null }) : null;
      var r = {
        id: b.id, b: b, slot: slot, shown: shown,
        code: b.code || (slot ? b.zone_key + '-' + BC.pad2(b.no) : ''),
        zone_key: b.zone_key || '', zone_label: zz ? (zz.z.label || b.zone_key + '구역') : '', zone_rank: zz ? zz.i : 999,
        no: slot ? Number(b.no) : null, name: b.name || '', org: b.org || '', program: b.program || '',
        congestion: t ? t.congestion : null,
        wait: t ? Number(t.wait_minutes) || 0 : null,
        at: t ? t.updated_at : null,
        by: t ? (t.by || (cred && cred.live_by) || null) : null,
        cred: cred
      };
      r.state = !r.congestion ? 'missing' : (r.congestion === '중단' ? 'pause' : (r.congestion === '마감' ? 'closed' : 'open'));
      r.stale = BC.isStale({ congestion: r.congestion, congestion_updated_at: r.at });
      r.qrIssue = !!(cred && shown && cred.qr_state !== 'on' && cred.pin_state !== 'on');
      r.pinIssue = !!(cred && cred.pin_failures_1h >= PIN_FAIL_WARN);
      return r;
    });
  }
  function inQuick(r, q) {
    if (q === 'open') return r.state === 'open' && !r.stale;
    if (q === 'busy') return r.state === 'open' && !r.stale && r.congestion === '혼잡';
    if (q === 'stale') return r.stale;
    if (q === 'missing') return r.state === 'missing';
    if (q === 'pause') return r.state === 'pause';
    if (q === 'closed') return r.state === 'closed';
    if (q === 'qr') return r.qrIssue;
    if (q === 'pin') return r.pinIssue;
    return true;
  }
  /* 운영 우선: 손이 가야 하는 부스가 위로.
       확인 필요(값이 오래됨) → 미입력 → 혼잡(긴 대기부터) → 잠시 중단 → 운영 중(긴 대기부터) → 오늘 마감
     마감은 맨 아래 — 정상 운영 부스를 가리지 않게 합니다. */
  function prio(r) {
    if (r.stale) return 0;
    if (r.state === 'missing') return 1;
    if (r.congestion === '혼잡') return 2;
    if (r.state === 'pause') return 3;
    if (r.state === 'open') return 4;
    return 5;
  }
  function byCode(a, b) {
    return (a.zone_rank - b.zone_rank) || ((a.no == null ? 1e6 : a.no) - (b.no == null ? 1e6 : b.no)) ||
      BC.compareCode(a.name, b.name);
  }
  function sorter(kind) {
    if (kind === 'code') return byCode;
    if (kind === 'wait') {
      return function (a, b) {
        var wa = a.state === 'open' ? a.wait : -1, wb = b.state === 'open' ? b.wait : -1;
        return (wb - wa) || byCode(a, b);
      };
    }
    if (kind === 'oldest') {
      return function (a, b) {
        // 한 번도 안 넣은 부스가 가장 오래된 것입니다. 마감은 확인할 일이 없어 뒤로.
        var ta = a.state === 'closed' ? Infinity : (a.at ? Date.parse(a.at) : -Infinity);
        var tb = b.state === 'closed' ? Infinity : (b.at ? Date.parse(b.at) : -Infinity);
        return (ta - tb) || byCode(a, b);
      };
    }
    return function (a, b) {
      return (prio(a) - prio(b)) || (a.state === 'open' && b.state === 'open' ? b.wait - a.wait : 0) || byCode(a, b);
    };
  }

  /* ── 그리기 조각 ─────────────────────────────────────────────── */
  function stateText(r) {
    return { open: '운영 중', pause: '잠시 중단', closed: '오늘 마감', missing: '현황 미입력' }[r.state];
  }
  function tone(r) {
    if (r.state === 'open') return BC.meta(r.congestion).key;   // free · normal · busy
    return r.state;                                              // pause · closed · missing
  }
  /* 한 부스 = 한 줄(휴대폰 약 72px · 데스크톱 약 64px). 줄에는 부스번호 · 이름 · 지금 대기/상태 ·
     마지막 입력 · 손이 가야 할 표시만 둡니다. 운영기관 · 프로그램 · 접속(QR · PIN) 자세히 · 입력 주체는
     줄을 눌러(데스크톱은 ⋯) 펼친 칸에서 봅니다. 정상인 접속(QR 정상 · PIN 정상)은 줄에 쓰지 않습니다. */
  function waitHtml(r) {
    if (r.state === 'open') {
      var big = r.wait === 0 ? '바로' : String(r.wait);
      return '<span class="lv__val"><span class="lv__num' + (r.wait === 0 ? ' lv__num--word' : '') + '">' + esc(big) + '</span>' +
        (r.wait === 0 ? '' : '<span class="lv__unit">' + (r.wait >= 60 ? '분 이상' : '분') + '</span>') + '</span>' +
        '<span class="lv__cong">' + esc(r.congestion) + '</span>';
    }
    if (r.state === 'missing') return '<span class="lv__val"><span class="lv__num lv__num--none">—</span></span><span class="lv__cong">미입력</span>';
    // 중단 · 마감: 휴대폰은 이 칸에 낱말을, 데스크톱은 '운영상태' 칸이 말하므로 여기는 — 만
    return '<span class="lv__val"><span class="lv__word">' + esc(stateText(r)) + '</span><span class="lv__dash" aria-hidden="true">—</span></span>';
  }
  // 줄에 띄울 '손이 가야 할 표시' — 정상은 쓰지 않습니다. 빨강: 확인 필요 · QR 문제 · PIN 실패 많음,
  // 주황: QR 미발급(PIN 은 있음), 회색: PIN 미발급 · PIN 꺼짐(QR 이 기본 길이라 약하게).
  function flag(text, kind) { return '<span class="flag flag--' + kind + '">' + esc(text) + '</span>'; }
  function credFlags(r) {
    var c = r.cred;
    if (!c) return '';
    var out = '';
    if (c.qr_state === 'off') out += flag('QR 꺼짐', 'bad');
    else if (c.qr_state !== 'on') out += flag('QR 미발급', r.qrIssue ? 'bad' : 'warn');
    if (c.pin_state === 'off') out += flag('PIN 꺼짐', 'off');
    else if (c.pin_state !== 'on') out += flag('PIN 미발급', 'off');
    if (r.pinIssue) out += flag('PIN 실패 많음', 'bad');
    return out;
  }
  function credText(r) {
    var c = r.cred;
    if (!c) return '접속 정보를 읽지 못했습니다';
    var qr = { on: 'QR 정상', off: 'QR 꺼짐' }[c.qr_state] || 'QR 미발급';
    var pin = c.pin_state === 'on' ? 'PIN 정상' : (c.pin_state === 'off' ? 'PIN 꺼짐' : 'PIN 미발급');
    return qr + ' · ' + pin + (c.pin_sessions > 0 ? ' · PIN 로그인 ' + c.pin_sessions + '대' : '') +
      (c.pin_failures_1h ? ' · 최근 1시간 PIN 실패 ' + c.pin_failures_1h + '번' : '');
  }
  function agoHtml(r) {
    if (!r.at) return '<span class="lv__agov">' + (r.state === 'missing' ? '입력 없음' : '') + '</span>';
    return '<span class="lv__agov">' + esc(BC.formatAgo(r.at)) + '</span>' +
      '<span class="lv__clock">' + esc(BC.formatClock(r.at)) + '</span>';
  }
  function attention(r) { return !!(r.stale || r.state === 'missing' || r.qrIssue || r.pinIssue); }
  function urgent(r) { return !!(r.stale || r.qrIssue || r.pinIssue); }
  function actClass(r) { return urgent(r) ? 'btn--primary' : (r.state === 'missing' ? 'btn--soft' : 'btn--ghost'); }
  function actLabel(r) { return urgent(r) ? '확인·수정' : (r.state === 'missing' ? '입력' : '수정'); }
  function adminHref(r) {
    var q = r.code || r.name;
    return 'admin.html?' + (DEMO ? 'demo=1&' : '') + 'find=' + encodeURIComponent(q) + '#booths';
  }
  function moreHtml(r) {
    function row(k, v) { return v ? '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>' : ''; }
    return '<dl class="lvd">' +
        row('운영기관', r.org) + row('프로그램', r.program) + row('구역', r.zone_label) +
        row('접속', credText(r)) +
        row('마지막 입력', r.at ? BC.formatClock(r.at) + ' · ' + BC.formatAgo(r.at) + (r.by && BY[r.by] ? ' · ' + BY[r.by] : '') : '입력 없음') +
      '</dl>' +
      '<div class="lv__links">' +
        '<a class="btn btn--ghost btn--sm" href="' + esc(adminHref(r)) + '">부스 정보 관리</a>' +
        '<a class="btn btn--ghost btn--sm" href="' + esc(adminHref(r)) + '">PIN 관리</a>' +
        (DEMO ? '' : '<a class="btn btn--ghost btn--sm" href="print-qr.html" target="_blank" rel="noopener">QR 관리</a>') +
      '</div>';
  }
  function rowHtml(r) {
    var open = ui.more === r.id;
    var attn = attention(r);
    var name = (r.code ? r.code + ' ' : '') + (r.name || '(이름 없음)');
    var hiddenTag = r.shown ? '' : '<span class="badge badge--' + (r.slot ? 'off' : 'warn') + '">' + (r.slot ? '비공개' : '미배정') + '</span>';
    return '<article class="lv lv--' + tone(r) + (r.stale ? ' is-stale' : '') + (attn ? ' is-attn' : '') + (open ? ' is-open' : '') +
        (r.shown ? '' : ' is-hidden') + '" data-id="' + esc(r.id) + '">' +
      '<div class="lv__booth">' +
        '<span class="lv__code">' + esc(r.code || '번호 미정') + '</span>' +
        '<span class="lv__name">' + esc(r.name || '(이름 없음)') + '</span>' + hiddenTag +
      '</div>' +
      '<div class="lv__meta">' +
        '<span class="lv__state"><i class="lv__dot" aria-hidden="true"></i>' + esc(stateText(r)) + '</span>' +
        '<span class="lv__flags">' + (r.stale ? flag('확인 필요', 'bad') : '') +
          '<span class="lv__cred">' + credFlags(r) + '</span></span>' +
        '<span class="lv__ago">' + agoHtml(r) + '</span>' +
      '</div>' +
      '<div class="lv__wait">' + waitHtml(r) + '</div>' +
      '<div class="lv__act">' +
        // 단추 무게: 확인 필요 · QR/PIN 문제 = 진한 단추(확인·수정), 미입력 = 연한 보라(입력), 나머지 = 옅은 단추(수정)
        '<button class="btn ' + actClass(r) + ' btn--sm" type="button" data-act="override"' + (busy[r.id] ? ' disabled' : '') + '>' +
          (busy[r.id] ? '저장 중…' : actLabel(r)) + '</button>' +
        // 휴대폰에서는 줄의 왼쪽(부스 · 표시) 전체를 덮는 투명 단추, 데스크톱에서는 ⋯ 단추
        '<button class="lv__morebtn" type="button" data-act="more" aria-expanded="' + open + '" ' +
          'aria-label="' + esc(name) + ' 자세히"><span aria-hidden="true">⋯</span></button>' +
      '</div>' +
      '<div class="lv__more"' + (open ? '' : ' hidden') + '>' + moreHtml(r) + '</div>' +
    '</article>';
  }

  /* 검색칸 안내 글: 넓으면 무엇을 찾는지, 좁으면 짧게. 찾는 대상은 같습니다. */
  function searchPh() {
    var narrow = false;
    try { narrow = window.matchMedia('(max-width: 680px)').matches; } catch (e) { narrow = false; }
    return narrow ? '부스 검색' : '부스번호 · 부스명 · 기관 · 프로그램 검색';
  }

  /* ── 부스 운영 현황 ─────────────────────────────────────────── */
  function base(all) { return ui.hidden ? all : all.filter(function (r) { return r.shown; }); }
  // 부스 번호는 'B-03' · 'b03' · 'b3' · 'b-3' 어느 꼴로 쳐도 맞게 합니다(관람객 · 인쇄 화면 검색과 같음).
  function codeHay(code) {
    var c = String(code || '').toLowerCase(), m = /^([a-z]+)-?0*(\d+)$/.exec(c);
    return [c, c.replace(/-/g, ''), m ? m[1] + m[2] + ' ' + m[1] + '-' + m[2] : ''].join(' ');
  }
  function filtered(all) {
    var q = ui.q.trim().toLowerCase();
    return base(all).filter(function (r) {
      if (!inQuick(r, ui.quick)) return false;
      if (ui.zone && r.zone_key !== ui.zone) return false;
      if (!q) return true;
      return [codeHay(r.code), r.name, r.org, r.program, r.zone_label].join(' ').toLowerCase().indexOf(q) >= 0;
    }).sort(sorter(ui.sort));
  }
  function summaryHtml(all) {
    var set = base(all);
    var cards = QUICK.map(function (o) {
      var n = o[0] === 'all' ? set.length : set.filter(function (r) { return inQuick(r, o[0]); }).length;
      return [o[0], o[1], n, o[2]];
    });
    var qr = set.filter(function (r) { return r.qrIssue; }).length;
    var pin = set.filter(function (r) { return r.pinIssue; }).length;
    if (qr || ui.quick === 'qr') cards.push(['qr', 'QR 문제', qr, 'danger']);
    if (pin || ui.quick === 'pin') cards.push(['pin', 'PIN 확인', pin, 'danger']);
    return cards.map(function (c) {
      var on = ui.quick === c[0];
      return '<button class="mini mini--btn sum' + (c[3] ? ' sum--' + c[3] : '') + (on ? ' is-on' : '') + (c[2] ? '' : ' is-zero') + '" ' +
        'type="button" data-quick="' + c[0] + '" aria-pressed="' + on + '"' +
        (c[0] === 'qr' ? ' title="QR이 없거나 꺼져 있고 PIN도 없는 공개 부스"' : '') + '>' +
        '<span class="mini__n">' + c[2] + '</span><span class="mini__l">' + esc(c[1]) + '</span></button>';
    }).join('');
  }
  function metaHtml() {
    var t = data.liveAt ? BC.formatClock(data.liveAt) + ':' + BC.pad2(data.liveAt.getSeconds()) : '';
    var stale = data.failAt && data.liveAt;
    return '<span class="lvmeta__t' + (data.failAt ? ' is-bad' : '') + '">' +
      (data.failAt ? (stale ? '연결이 불안정해요 · ' + esc(t) + ' 기준 값' : '아직 읽지 못했어요') : (t ? esc(t) + ' 기준' : '불러오는 중')) +
      '</span><span class="lvmeta__s">' + (DEMO ? '협의용 예시 · 이 화면 안에서만 바뀝니다' : '15초마다 새로 읽습니다') +
      ' · 확인 필요 = ' + BC.staleMinutes() + '분 넘게 그대로</span>';
  }
  function zoneOptions() {
    var used = {};
    base(rowsNow()).forEach(function (r) { if (r.zone_key) used[r.zone_key] = true; });
    var zs = data.zones.filter(function (z) { return used[z.key]; });
    if (ui.zone && !used[ui.zone]) ui.zone = '';
    // 좁은 고르기 칸에서도 어느 구역인지 보이게 구역 코드를 앞에 둡니다(A · 읽걷쓰AI 스쿨존).
    return '<option value="">구역 전체</option>' + zs.map(function (z) {
      return '<option value="' + esc(z.key) + '"' + (ui.zone === z.key ? ' selected' : '') + '>' +
        esc(z.key + ' · ' + (z.label || z.key + '구역')) + '</option>';
    }).join('');
  }
  function emptyHtml(all) {
    if (!base(all).length) {
      var none = !all.length;
      return '<div class="state state--empty">' +
        '<p class="state__title">' + (none ? '아직 등록된 부스가 없습니다.' : '공개된 부스가 없습니다.') + '</p>' +
        '<p class="state__hint">부스를 등록하고 공개하면(공개한 구역 안) 여기에 대기 현황이 보입니다.' +
          (none ? '' : ' 비공개 · 미배정 부스는 “비공개 · 미배정도 보기” 로 볼 수 있습니다.') + '</p>' +
        '<div class="state__act"><a class="btn btn--primary btn--sm" href="admin.html' + (DEMO ? '?demo=1' : '') + '#booths">부스 정보 관리</a></div>' +
        (DEMO ? '' : '<div class="state__alt"><p class="state__altlead">화면 구성을 먼저 확인해 보시겠어요?</p>' +
          '<a class="btn btn--ghost btn--sm" href="booth-admin.html?demo=1">협의용 예시 화면 보기</a></div>') +
        '</div>';
    }
    return '<div class="state state--empty"><p class="state__title">조건에 맞는 부스가 없습니다.</p>' +
      '<p class="state__hint">검색어 · 구역 · 걸러 보기를 바꿔 보세요.</p>' +
      '<div class="state__act"><button class="btn btn--ghost btn--sm" type="button" data-reset>조건 지우기</button></div></div>';
  }

  function renderLiveShell() {
    $('#view').innerHTML =
      '<div class="page lvpage">' +
        '<div class="page__head"><div><h1 class="page__title">부스 운영 현황</h1>' +
          '<p class="page__desc">행사 당일 모든 공개 부스의 대기 시간과 손이 가야 하는 부스를 봅니다. ' +
          '부스 정보 · QR · PIN 설정은 관리자 화면에서 합니다.</p></div>' +
          '<div class="page__actions">' +
            // 운영 준비용 예시 부스가 공개돼 있을 때만 보입니다(paintExampleBtn). 협의용 예시(?demo)에는 없습니다.
            '<button class="btn btn--ghost btn--sm" type="button" id="lv-example" data-example-reset hidden>↻ 예시 현황 초기화</button>' +
            '<button class="btn btn--ghost btn--sm" type="button" data-refresh>새로 고침</button>' +
            '<a class="btn btn--ghost btn--sm" href="admin.html' + (DEMO ? '?demo=1' : '') + '#booths">부스 정보 관리</a>' +
          '</div></div>' +
        (DEMO ? '<p class="demohint">' + esc(DEMO_TEXT) + ' 현황 수정을 눌러도 실제 DB에 반영되지 않고, 새로 고치면 처음 예시로 돌아갑니다.</p>' : '') +
        '<p class="lvmeta" id="lv-meta" aria-live="polite"></p>' +
        '<div class="minigrid sumgrid" id="lv-sum" role="group" aria-label="걸러 보기"></div>' +
        // 검색 · 구역 · 정렬 · 지금 걸러 보는 것은 스크롤해도 맨 위에 붙어 있습니다(데스크톱은 표 머리도 함께).
        '<div class="lvbar" id="lv-bar">' +
          '<div class="tools lvtools">' +
            '<div class="lvtools__row">' +
              '<div class="search"><label class="sr-only" for="lv-q">검색</label>' +
                '<input class="input" id="lv-q" type="search" placeholder="' + esc(searchPh()) + '" value="' + esc(ui.q) + '" /></div>' +
              '<label class="listsel"><span class="sr-only">구역</span><select class="select select--sm" id="lv-zone"></select></label>' +
              '<label class="listsel"><span class="sr-only">정렬</span><select class="select select--sm" id="lv-sort">' +
                SORTS.map(function (s) { return '<option value="' + s[0] + '"' + (ui.sort === s[0] ? ' selected' : '') + '>' + esc(s[1]) + '</option>'; }).join('') +
              '</select></label>' +
            '</div>' +
          '</div>' +
          '<div class="lvactive" id="lv-active" hidden></div>' +
          '<div class="lvhead" aria-hidden="true"><span>부스</span><span>운영상태</span><span>대기시간</span>' +
            '<span>마지막 입력</span><span>확인할 것</span><span>관리</span></div>' +
        '</div>' +
        '<div class="lvcount"><p class="resultline" id="lv-count"></p>' +
          '<button class="lvtoggle" type="button" id="lv-hidden" aria-pressed="' + ui.hidden + '"></button></div>' +
        '<div class="lvlist" id="lv-list"></div>' +
      '</div>';
  }
  function paintLive() {
    if (!$('#lv-list')) renderLiveShell();
    var all = rowsNow();
    var rows = filtered(all);
    $('#lv-meta').innerHTML = metaHtml();
    $('#lv-sum').innerHTML = summaryHtml(all);
    var sel = $('#lv-zone');
    if (document.activeElement !== sel) sel.innerHTML = zoneOptions();
    var total = base(all).length;
    var narrowed = ui.quick !== 'all' || !!ui.zone || !!ui.q.trim();
    $('#lv-count').innerHTML = (narrowed ? '전체 ' + total + '곳 중 <b>' + rows.length + '곳</b>' : '전체 ' + total + '곳') +
      (narrowed ? ' <button class="linkreset" type="button" data-reset>초기화</button>' : '');
    $('#lv-count').hidden = !total && !ui.hidden;
    var hb = $('#lv-hidden');
    hb.textContent = ui.hidden ? '공개 부스만 보기' : '비공개 · 미배정도 보기';
    hb.setAttribute('aria-pressed', String(ui.hidden));
    sel.classList.toggle('is-set', !!ui.zone);
    // 붙박이 줄의 '지금 걸러 보는 것' — 위의 요약 카드가 화면 밖으로 지나가도 무엇을 보고 있는지 알 수 있게
    var act = $('#lv-active');
    var q = QUICK.concat([['qr', 'QR 문제'], ['pin', 'PIN 확인']]).filter(function (o) { return o[0] === ui.quick; })[0];
    if (ui.quick !== 'all' && q) {
      act.hidden = false;
      act.innerHTML = '<span class="lvactive__t"><b>' + esc(q[1]) + '</b>만 보는 중 · ' + rows.length + '곳</span>' +
        '<button class="lvactive__x" type="button" data-quick="all">전체 보기</button>';
    } else {
      act.hidden = true;
      act.innerHTML = '';
    }
    document.querySelector('.lvhead').hidden = !rows.length;
    $('#lv-list').innerHTML = rows.length ? rows.map(rowHtml).join('') : emptyHtml(all);
    paintExampleBtn(all);
  }

  /* ── 구역 현황 ─────────────────────────────────────────────── */
  function paintZones() {
    var all = base(rowsNow());
    var groups = data.zones.map(function (z) {
      var rs = all.filter(function (r) { return r.zone_key === z.key; });
      var open = rs.filter(function (r) { return r.state === 'open' && !r.stale; });
      var top = open.slice().sort(function (a, b) { return b.wait - a.wait; })[0] || null;
      function n(q) { return rs.filter(function (r) { return inQuick(r, q); }).length; }
      return { z: z, rs: rs, open: open.length, busy: n('busy'), stale: n('stale'), missing: n('missing'),
               pause: n('pause'), closed: n('closed'), top: top };
    }).filter(function (g) { return g.rs.length; });
    var head = '<div class="page__head"><div><h1 class="page__title">구역 현황</h1>' +
      '<p class="page__desc">구역마다 운영 중 · 혼잡 · 확인 필요 부스 수와 가장 긴 대기를 봅니다. 구역을 누르면 그 구역 부스만 봅니다.</p></div></div>' +
      (DEMO ? '<p class="demohint">' + esc(DEMO_TEXT) + '</p>' : '') +
      '<p class="lvmeta">' + metaHtml() + '</p>';
    var body = groups.length ? '<div class="zgrid">' + groups.map(function (g) {
      function c(v, label, cls) { return '<span class="zc__n' + (v && cls ? ' ' + cls : '') + '"><b>' + v + '</b>' + esc(label) + '</span>'; }
      return '<button class="zc" type="button" data-zone="' + esc(g.z.key) + '">' +
        '<span class="zc__head"><span class="zc__key">' + esc(g.z.key) + '</span><span class="zc__label">' + esc(g.z.label || g.z.key + '구역') + '</span>' +
          '<span class="zc__all">부스 ' + g.rs.length + '곳</span></span>' +
        '<span class="zc__top">' + (g.top ? '가장 긴 대기 <b>' + (g.top.wait === 0 ? '바로' : g.top.wait + '분') + '</b> · ' + esc(g.top.code + ' ' + g.top.name)
          : '운영 중인 부스의 대기 값이 없습니다') + '</span>' +
        '<span class="zc__nums">' + c(g.open, '운영 중', 'is-ok') + c(g.busy, '혼잡', 'is-bad') + c(g.stale, '확인 필요', 'is-warn') +
          c(g.missing, '미입력', 'is-warn') + c(g.pause, '중단', '') + c(g.closed, '마감', '') + '</span>' +
      '</button>';
    }).join('') + '</div>' : emptyHtml(rowsNow());
    $('#view').innerHTML = '<div class="page lvpage">' + head + body + '</div>';
  }

  function paint() {
    if (ui.view === 'zones') paintZones(); else paintLive();
  }

  /* ── 관리자 긴급 수정 (admin_set_booth_live — 새 공개 쓰기 함수를 만들지 않습니다) ── */
  function liveLabel(r) {
    if (r.state === 'open') return (r.wait === 0 ? '바로' : r.wait + '분') + ' · ' + r.congestion;
    return stateText(r);
  }
  function override(r) {
    var choices = (BC.WAIT_CHOICES || [0, 5, 10, 15, 20, 30, 45, 60]).map(function (w) {
      var c = BC.congestionFor(w);
      return { v: 'open:' + w, label: w === 0 ? '바로' : w + '분', sub: (w === 60 ? '이상 · ' : '') + c, tone: BC.meta(c).key };
    }).concat([
      { v: 'pause', label: '잠시 중단', sub: '대기 0분', tone: 'pause' },
      { v: 'closed', label: '오늘 마감', sub: '관람객에게 마감', tone: 'closed' },
      { v: 'clear', label: '값 지우기 (현황 미입력으로)', tone: 'clear' }
    ]);
    UI.pick({
      title: (r.code ? r.code + ' ' : '') + r.name + ' · 현황 수정',
      desc: '지금: ' + liveLabel(r) + (r.at ? ' · ' + BC.formatAgo(r.at) + ' 입력' : '') +
        (r.stale ? ' — ' + BC.staleMinutes() + '분 넘게 그대로입니다. 운영자와 확인한 값을 눌러 주세요.' : ''),
      choices: choices,
      note: DEMO ? '협의용 예시 · 이 화면 안에서만 바뀝니다.'
        : '관리자가 고친 값은 관람객 화면에 바로 보이고, 기록에는 “관리자 입력” 으로 남습니다. 운영자가 다시 누르면 그 값이 이깁니다.'
    }).then(function (v) {
      if (!v) return;
      if (v === 'clear') {
        return UI.confirm({
          title: '대기 값을 지울까요?',
          message: '“' + (r.code ? r.code + ' ' : '') + r.name + '” 부스가 관람객 화면에서 “정보 없음” 으로 바뀝니다. 운영자가 다시 누르면 돌아옵니다.',
          confirmLabel: '값 지우기', danger: true
        }).then(function (ok) { if (ok) apply(r, 'clear', null); });
      }
      if (v === 'closed') {
        return UI.confirm({
          title: '오늘 마감으로 바꿀까요?',
          message: '“' + (r.code ? r.code + ' ' : '') + r.name + '” 부스가 관람객 화면에 “마감” 으로 보여 발길을 돌리게 됩니다.',
          confirmLabel: '오늘 마감'
        }).then(function (ok) { if (ok) apply(r, 'closed', null); });
      }
      if (v === 'pause') return apply(r, 'pause', null);
      apply(r, 'open', Number(v.slice(5)));
    });
  }
  function apply(r, mode, wait) {
    var name = (r.code ? r.code + ' ' : '') + r.name;
    if (DEMO) {
      var why = AD.adminSetLive(r.id, mode, wait);
      if (why) { toast(why, true); return; }
      demoPull();
      paint();
      toast(name + ' — ' + (mode === 'clear' ? '대기 값을 지웠습니다.' : '현황을 바꿨습니다.') + ' (협의용 예시)');
      return;
    }
    busy[r.id] = true;
    paint();
    C.rpc('admin_set_booth_live', { p_booth_id: r.id, p_mode: mode, p_wait_minutes: mode === 'open' ? wait : null })
      .then(function (rows) {
        var x = Object.prototype.toString.call(rows) === '[object Array]' ? rows[0] : rows;
        if (mode === 'clear' || !x || !x.congestion) delete data.live[r.id];
        else data.live[r.id] = { booth_id: r.id, congestion: x.congestion, wait_minutes: x.wait_minutes, updated_at: x.updated_at, by: 'admin' };
        if (data.creds && data.creds[r.id]) data.creds[r.id].live_by = mode === 'clear' ? null : 'admin';
        busy[r.id] = false;
        paint();
        toast(name + ' — ' + (mode === 'clear' ? '대기 값을 지웠습니다.' : '현황을 바꿨습니다.'));
      })
      .catch(function (e) {
        busy[r.id] = false;
        paint();
        console.error('[booth-admin] 현황 수정 실패', e && (e.code || e.message));
        toast(C.dataMessage(e), true);
      });
  }

  /* ── 시연 전 예시 현황 초기화 ──────────────────────────────────────
     운영 준비용 예시 부스(기관이 '[예시]' 로 시작)의 대기 값을 시연용 처음 값으로 다시 넣습니다.
     30분 '확인 필요' · 자정 초기화 같은 실제 규칙은 그대로 두고, 시연 직전에 값을 새로 넣는 도구일 뿐입니다.
     새 쓰기 함수 없이 부스마다 관리자 긴급 수정과 같은 admin_set_booth_live 를 부릅니다 — 미입력은 그 함수의
     'clear'(부스 하나의 값 지우기, '값 지우기' 단추와 같은 길). 모든 부스를 지우는 admin_reset_booth_live 는
     실제 부스까지 지우므로 쓰지 않습니다.
     대상: 누르는 순간 서버에서 다시 읽은 부스 중 기관이 '[예시]' 로 시작하고(BoothCore.isSample), 공개 · 구역 공개 ·
     번호가 있으며, 아래 표에 그 부스 번호가 있는 곳만. '[예시]' 를 지운 실제 부스는 같은 번호여도 건드리지 않고,
     부스마다 UUID(r.id)로 보냅니다. 값은 대기 시간 단추(WAIT_CHOICES) · 중단 · 마감 · 미입력만 씁니다. */
  var EXAMPLE_PRESET = {
    'A-01': ['open', 5],  'A-02': ['open', 15], 'A-03': ['open', 30], 'A-04': ['clear'],
    'B-01': ['open', 10], 'B-02': ['open', 20], 'B-03': ['pause'],    'B-04': ['closed'],
    'C-01': ['open', 5],  'C-02': ['open', 15], 'C-03': ['open', 30], 'C-04': ['clear']
  };
  var exampleBusy = false;
  function presetOf(r) {
    var p = Object.prototype.hasOwnProperty.call(EXAMPLE_PRESET, r.code) ? EXAMPLE_PRESET[r.code] : null;
    if (!p) return null;
    if (p[0] === 'open' && (BC.WAIT_CHOICES || []).indexOf(p[1]) < 0) return null;
    return p;
  }
  function exampleTargets(rows) {
    return rows.filter(function (r) { return r.shown && BC.isSample(r.b) && !!presetOf(r); });
  }
  function paintExampleBtn(all) {
    var b = $('#lv-example');
    if (!b) return;
    b.hidden = DEMO || !exampleTargets(all || rowsNow()).length;
    b.disabled = exampleBusy;
    b.textContent = exampleBusy ? '초기화하는 중…' : '↻ 예시 현황 초기화';
  }
  function resetExamples() {
    if (DEMO || exampleBusy) return;
    if (!exampleTargets(rowsNow()).length) { toast('초기화할 예시 부스가 없습니다.', true); return; }
    UI.confirm({
      title: '예시 현황을 초기화할까요?',
      message: '현재 공개된 운영 준비용 예시 부스의 대기 상태를 시연용 초기값으로 다시 설정합니다.\n\n' +
        '[예시] 부스에만 적용되며 실제 부스 정보에는 영향을 주지 않습니다.',
      confirmLabel: '초기화'
    }).then(function (ok) {
      if (!ok) return;
      exampleBusy = true;
      paintExampleBtn();
      var done = [], failed = [];
      // 누르는 순간의 부스 정보로 다시 고릅니다(그 사이 다른 화면에서 '[예시]' 를 지웠을 수 있음).
      loadMaster().then(function () {
        var targets = exampleTargets(rowsNow());
        // 하나씩 차례로 보내 성공 · 실패를 부스마다 정확히 셉니다.
        return targets.reduce(function (p, r) {
          return p.then(function () {
            var s = presetOf(r);
            return C.rpc('admin_set_booth_live', { p_booth_id: r.id, p_mode: s[0], p_wait_minutes: s[0] === 'open' ? s[1] : null })
              .then(function () { done.push(r.code); }, function (e) {
                failed.push(r.code);
                console.warn('[booth-admin] 예시 현황 초기화 실패', r.code, e && e.code);
              });
          });
        }, Promise.resolve());
      }).then(function () {
        exampleBusy = false;
        // 결과를 기다리지 않고 바로 다시 읽어 요약 · 카드를 새 값으로 그립니다.
        return refreshMaster().then(function () {
          if (!failed.length) { toast('예시 부스 ' + done.length + '곳의 현황을 초기화했어요.'); return; }
          toast((done.length ? done.length + '곳 완료 · ' : '') + failed.length + '곳 실패 — ' +
            failed.join(', ') + ' 현황을 변경하지 못했습니다.', true);
        });
      }, function (e) {
        exampleBusy = false;
        paintExampleBtn();
        console.warn('[booth-admin] 예시 현황 초기화 — 부스 목록을 읽지 못했습니다', e && (e.code || e.message));
        toast(C.dataMessage(e), true);
      });
    });
  }

  /* ── 다시 읽기 ─────────────────────────────────────────────── */
  function refreshLive() {
    return loadLive().then(paint, function (e) {
      data.failAt = new Date();
      console.warn('[booth-admin] 대기 현황을 읽지 못했습니다', e && (e.code || e.message));
      paint();
    });
  }
  function refreshMaster() {
    return loadMaster().then(loadLive).then(paint, function (e) {
      data.failAt = new Date();
      console.warn('[booth-admin] 부스 목록을 읽지 못했습니다', e && (e.code || e.message));
      paint();
    });
  }
  function startPolls() {
    if (stops.length) return;
    stops.push(BC.poll(refreshLive, LIVE_MS));
    stops.push(BC.poll(refreshMaster, MASTER_MS));
  }
  function stopPolls() {
    stops.forEach(function (s) { try { s(); } catch (e) { /* 무시 */ } });
    stops = [];
  }

  /* ── 메뉴 · 이동 ───────────────────────────────────────────── */
  function route() {
    var h = (window.location.hash || '').replace(/^#/, '');
    return h === 'zones' ? 'zones' : 'live';
  }
  function paintNav() {
    var demoQ = DEMO ? '?demo=1' : '';
    function a(h, label) {
      var on = ui.view === h;
      return '<a href="#' + h + '" class="' + (on ? 'is-on' : '') + '"' + (on ? ' aria-current="page"' : '') + '>' + esc(label) + '</a>';
    }
    $('#sidenav').innerHTML = '<p class="side__group">' + (DEMO ? '협의용 예시 · 행사 당일' : '행사 당일') + '</p>' +
      a('live', '부스 운영 현황') + a('zones', '구역 현황') +
      '<p class="side__group">정보 설정</p><a href="admin.html' + demoQ + '#booths">관리자 화면 (부스 정보)</a>';
    $('#tabbar').innerHTML =
      '<a href="#live" class="' + (ui.view === 'live' ? 'is-on' : '') + '"><span class="tab__dot">현</span><span>현황</span></a>' +
      '<a href="#zones" class="' + (ui.view === 'zones' ? 'is-on' : '') + '"><span class="tab__dot">구</span><span>구역</span></a>' +
      '<a href="admin.html' + demoQ + '#booths"><span class="tab__dot">관</span><span>부스 정보</span></a>' +
      '<button type="button" data-open-sheet><span class="tab__dot">⋯</span><span>더보기</span></button>';
    $('#sheetnav').innerHTML = '<p class="sheet__group">이동</p><a href="admin.html' + demoQ + '#booths">관리자 화면 (부스 정보)</a>' +
      (DEMO ? '' : '<a href="print-qr.html" target="_blank" rel="noopener">부스 QR 인쇄</a>');
    var me = C.me() || {};
    $('#side-who').innerHTML = esc(me.name || me.email || '') + '<br /><span class="badge badge--plain">관리자</span>';
    $('#sheet-who').textContent = (me.name || me.email || '') + ' · 관리자';
    $('#topbar-title').textContent = ui.view === 'zones' ? '구역 현황' : '부스 운영 현황';
    document.title = (DEMO ? '협의용 예시 · ' : '') + (ui.view === 'zones' ? '구역 현황' : '부스 운영 현황') + ' · 관리자';
  }
  function go() {
    ui.view = route();
    ui.more = '';
    paintNav();
    if (ui.view === 'live') $('#view').innerHTML = '';
    paint();
    $('#sheet').hidden = true;
    document.body.style.overflow = '';
  }

  function rowOf(el) {
    var art = el.closest('.lv');
    if (!art) return null;
    var id = art.getAttribute('data-id');
    return rowsNow().filter(function (r) { return r.id === id; })[0] || null;
  }

  function bind() {
    window.addEventListener('hashchange', go);
    document.addEventListener('click', function (e) {
      var t = e.target;
      var so = t.closest('[data-signout]');
      if (so) { signOutNow(so); return; }
      if (t.closest('[data-pwchange]')) { openPasswordChange(); return; }
      if (t.closest('[data-open-sheet]')) { $('#sheet').hidden = false; document.body.style.overflow = 'hidden'; return; }
      if (t.closest('[data-close-sheet]')) { $('#sheet').hidden = true; document.body.style.overflow = ''; return; }
      if (t.closest('[data-refresh]')) { refreshMaster().then(function () { toast('새로 읽었습니다.'); }); return; }
      if (t.closest('[data-example-reset]')) { resetExamples(); return; }
      if (t.closest('#lv-hidden')) { ui.hidden = !ui.hidden; paintLive(); return; }
      if (t.closest('[data-reset]')) { ui.quick = 'all'; ui.zone = ''; ui.q = ''; var qi = $('#lv-q'); if (qi) qi.value = ''; paint(); return; }
      var qb = t.closest('[data-quick]');
      if (qb) { var v = qb.getAttribute('data-quick'); ui.quick = ui.quick === v && v !== 'all' ? 'all' : v; paint(); return; }
      var zb = t.closest('[data-zone]');
      if (zb) { ui.zone = zb.getAttribute('data-zone'); ui.quick = 'all'; window.location.hash = '#live'; return; }
      var act = t.closest('[data-act]');
      if (act) {
        var r = rowOf(act);
        if (!r) return;
        if (act.getAttribute('data-act') === 'override') { override(r); return; }
        if (act.getAttribute('data-act') === 'more') { ui.more = ui.more === r.id ? '' : r.id; paint(); return; }
      }
      if (ui.more && !t.closest('.lv__more')) { ui.more = ''; paint(); }
    });
    document.addEventListener('input', function (e) {
      if (e.target.id !== 'lv-q') return;
      ui.q = e.target.value;
      paintLive();
    });
    document.addEventListener('change', function (e) {
      if (e.target.id === 'lv-zone') { ui.zone = e.target.value; paintLive(); }
      else if (e.target.id === 'lv-sort') { ui.sort = e.target.value; paintLive(); }

    });
    try {
      var mq = window.matchMedia('(max-width: 680px)');
      var onWidth = function () { var q = $('#lv-q'); if (q) q.placeholder = searchPh(); };
      if (mq.addEventListener) mq.addEventListener('change', onWidth); else mq.addListener(onWidth);
    } catch (e3) { /* 옛 브라우저 */ }
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('#sheet').hidden) { $('#sheet').hidden = true; document.body.style.overflow = ''; return; }
      if (ui.more) { ui.more = ''; paint(); }
    });
  }

  /* ── 문지기 (관리자 화면 admin.js 와 같은 규칙) ─────────────────── */
  var GATES = ['gate-setup', 'gate-login', 'gate-denied'];
  function gate(id) {
    stopPolls();
    GATES.forEach(function (g) { $('#' + g).hidden = g !== id; });
    $('#app').hidden = true;
    $('#view').innerHTML = '';
    $('#side-who').innerHTML = '';
    $('#sheet-who').textContent = '';
    UI.close();
    UI.hidePasswords($('#loginform'));
  }
  function signOutNow(btn) {
    if (btn) btn.disabled = true;
    $('#sheet').hidden = true;
    document.body.style.overflow = '';
    gate('gate-login');
    C.signOut().then(function () { window.location.replace('index.html'); });
  }
  function openPasswordChange() {
    $('#sheet').hidden = true;
    document.body.style.overflow = '';
    UI.form({
      title: '내 비밀번호 변경',
      desc: '바꾸면 이 기기는 그대로 로그인되어 있고, 다른 기기의 로그인은 끝납니다.',
      submitLabel: '비밀번호 변경',
      busyLabel: '바꾸는 중…',
      fields: [
        { k: 'current', label: '현재 비밀번호', type: 'password', autocomplete: 'current-password', required: true, wide: true },
        { k: 'next', label: '새 비밀번호', type: 'password', autocomplete: 'new-password', required: true, wide: true,
          hint: '8자 이상. 다른 곳에서 쓰지 않는 비밀번호로 정해 주세요.' },
        { k: 'again', label: '새 비밀번호 확인', type: 'password', autocomplete: 'new-password', required: true, wide: true }
      ],
      validate: function (v) {
        if (v.next.length < 8) return { message: '새 비밀번호는 8자 이상이어야 합니다.', field: 'next' };
        if (v.next !== v.again) return { message: '새 비밀번호와 확인이 다릅니다. 다시 입력해 주세요.', field: 'again' };
        if (v.next === v.current) return { message: '새 비밀번호가 지금 비밀번호와 같습니다.', field: 'next' };
        return null;
      },
      submit: function (v) {
        return C.changePassword(v.current, v.next).catch(function (e) { throw C.passwordMessage(e); });
      }
    }).then(function (done) {
      if (done) toast('비밀번호를 바꿨습니다. 다른 기기의 로그인은 끝났습니다.');
    });
  }
  // 협의용 예시 띠 — 관리자 예시와 같은 말 · 같은 모양. 돌아가기는 ?demo 없는 이 화면.
  function paintDemoBar() {
    if (!DEMO || $('#demobar')) return;
    document.documentElement.classList.add('is-demo');
    var bar = document.createElement('div');
    bar.className = 'demobar';
    bar.id = 'demobar';
    bar.setAttribute('role', 'note');
    bar.innerHTML = '<p class="demobar__t"><span class="demotag">협의용 예시</span>' +
      '<span class="sr-only"> · </span><span class="demobar__w">실제 행사 정보가 아닙니다.</span></p>' +
      '<a class="demobar__exit" href="booth-admin.html">실제 운영 현황으로 돌아가기</a>';
    var wrap = $('.main-wrap');
    wrap.insertBefore(bar, wrap.firstChild);
    function fit() { document.documentElement.style.setProperty('--demo-h', bar.offsetHeight + 'px'); }
    fit();
    if (window.ResizeObserver) new ResizeObserver(fit).observe(bar);
    window.addEventListener('resize', fit);
  }
  function enter() {
    GATES.forEach(function (g) { $('#' + g).hidden = true; });
    $('#app').hidden = false;
    paintDemoBar();
    if (DEMO && !started) AD.prepareLiveDemo();
    started = true;
    ui.view = route();
    paintNav();
    $('#view').innerHTML = '<div class="state">부스 현황을 불러오는 중입니다.</div>';
    return loadMaster().then(loadLive).then(function () {
      $('#view').innerHTML = '';
      paint();
      startPolls();
    }).catch(function (e) {
      console.error('[booth-admin] 불러오기 실패', e && (e.code || e.message));
      $('#view').innerHTML = '<div class="state state--error">' + esc(C.dataMessage(e)) +
        '<div class="state__act"><button class="btn btn--ghost btn--sm" type="button" data-refresh>다시 시도</button></div></div>';
      startPolls();
    });
  }
  function admitOrGate(sess) {
    if (!sess) { gate('gate-login'); return; }
    return C.fetchProfile(sess.user.id).then(function (p) {
      if (!p) {
        gate(C.profileFailed() ? 'gate-login' : 'gate-denied');
        if (C.profileFailed()) toast(C.accessMessage(), true);
        return;
      }
      if (p.role !== 'admin') { gate('gate-denied'); return; }
      return enter();
    });
  }

  if (!C.isConfigured()) { gate('gate-setup'); return; }
  bind();
  UI.passwordToggle($('#login-pw'));

  $('#loginform').addEventListener('submit', function (e) {
    e.preventDefault();
    var who = $('#login-email'), pw = $('#login-pw');
    var err = $('#login-error'), btn = $('#login-btn');
    err.hidden = true;
    if (!who.value.trim() || !pw.value) {
      err.textContent = '아이디와 비밀번호를 모두 입력해 주세요.';
      err.hidden = false;
      (!who.value.trim() ? who : pw).focus();
      return;
    }
    btn.disabled = true; btn.textContent = '확인 중…';
    C.signIn(who.value.trim(), pw.value).then(function (sess) {
      pw.value = '';
      UI.hidePasswords($('#loginform'));
      return admitOrGate(sess);
    }).catch(function (e2) {
      err.textContent = C.authMessage(e2);
      err.hidden = false;
      pw.focus();
    }).then(function () {
      btn.disabled = false; btn.textContent = '로그인';
    });
  });
  $('#denied-signout').addEventListener('click', function (e) {
    e.currentTarget.disabled = true;
    C.signOut().then(function () { window.location.reload(); });
  });
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    C.session().then(admitOrGate).catch(function () { gate('gate-login'); });
  });
  var client = C.db();
  if (client) {
    client.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') gate('gate-login');
    });
  }
  C.session().then(admitOrGate).catch(function (e) {
    console.error('[booth-admin] 시작 실패', e);
    gate('gate-login');
  });
})();
