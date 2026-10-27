/* ===================================================================
   부스 운영 현황 (booth-admin.html) — 행사 당일 운영 콘솔

   "지금 어느 부스가 문제인가?" 를 빠르게 보여 줍니다. 정보 설정(구역 · 부스 등록 ·
   공개 · 기관 · 담당자 · QR · PIN)은 관리자 화면(admin.html)이 맡고, 이 화면은
   대기 시간 · 혼잡 · 마지막 입력 · 미입력 · 확인 필요 · 중단 · 마감을 봅니다.
   고칠 수 있는 것은 하나뿐입니다 — 관리자 긴급 수정(admin_set_booth_live, 기록에 'admin').
   준비 기간 '예시 현황 채우기 · 비우기' 도 같은 함수를 [예시] 부스마다 부를 뿐입니다(아래 runExamples).
   행사 전 '리허설 관리'(실제 부스 84곳 채우기 · 비우기)는 같은 도구를 admin_rehearsal_set_live 로 부릅니다
   — 84곳 · 행사 전만 통과시키고 안에서 admin_set_booth_live 를 부르는 문지기 함수입니다(아래 runRehearsal).

   보안: 관리자 화면과 같은 로그인 · 같은 문지기(staff_profiles.role = 'admin').
   이 파일에는 권한이 없습니다. 읽기는 관리자 RLS, 쓰기는 함수 안의 is_admin() 이 막습니다.

   읽는 것 (실제 모드)
     · booth_live            15초마다(±20%, 화면이 가려지면 쉼) — 관람객 화면(60초)보다 빠르게
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
  var PS = window.PinStatus;   // 리허설 공통 PIN · 개별 PIN 판정(assets/pin-status.js)
  var DEMO_TEXT = '협의용 예시 · 실제 행사 정보가 아닙니다.';

  var LIVE_MS = 15000;
  var MASTER_MS = 60000;
  var PIN_FAIL_WARN = 10;   // 관리자 화면의 'PIN 실패 많음' 과 같은 기준

  var SORTS = [['ops', '운영 우선'], ['code', '부스번호'], ['wait', '대기시간 높은 순'], ['oldest', '최근 입력 오래된 순']];
  /* 맨 위 요약 = 걸러 보기. 두 묶음입니다.
       운영 상태 — 전체 부스(머리의 큰 수) · 여유 · 보통 · 혼잡 · 일시 중단 · 운영 종료 · 미입력. 마지막 입력 기준이라 부스 한 곳 = 한 칸,
         여섯 칸의 합 = 전체 부스. 30분 넘게 그대로인 값(확인 필요)도 마지막 상태로 세되 칸 아래 점선 '확인 필요 ○' 로 따로 쓰고,
         칸의 부스가 모두 오래된 값이면 수를 흐리게 — 오래된 값이 지금 확인된 값처럼 보이지 않게 합니다.
       관리 조치 — 확인 필요 · 미입력(데이터 점검, 주황)과, 있을 때만 QR 준비 필요(주황) · PIN 확인(빨강).
         일괄 확인 · 운영자 알림은 DB 함수 · 발송 기능 승인 전이라 '준비 중'(누를 수 없음)으로만 둡니다.
     빨강 = 혼잡과 장애, 주황 = 데이터 점검, 회색 = 중단 · 마감. 운영 시간 밖이면 확인 필요도 회색(offHours).
     QR 준비 필요 = 공개 부스인데 쓸 수 있는 QR(미발급 · 꺼짐)도 PIN 도 없음 — 장애가 아니라 '발급할 일' 이라 주황. */
  var QUICK = [
    ['all', '전체'], ['free', '여유', 'ok'], ['normal', '보통', 'normal'], ['busy', '혼잡', 'danger'], ['stale', '확인 필요', 'warn'],
    ['missing', '미입력', 'warn'], ['pause', '일시 중단'], ['closed', '운영 종료']
  ];
  var BY = { qr: '운영자 QR', pin: '운영자 PIN', admin: '관리자 입력' };

  // pinOn: PIN 보조 로그인 스위치(settings.booth_pin_enabled) — true · false · null(모름)
  // event: 행사 날짜 · 시간(settings.event_start · event_end · time_label) — 운영 시간 밖 표시에만 씁니다(못 읽으면 null = 운영 중으로 봄)
  var data = { zones: [], booths: [], live: {}, creds: null, pinOn: null, event: null, liveAt: null, masterAt: null, failAt: null };
  // 기본 정렬은 부스번호순(R1-01, R1-02 …). 고른 정렬은 새로 읽어도 그대로입니다(ui 에만 두고 다시 그릴 때 바꾸지 않음).
  // zref: 구역 현황 '최장 대기 부스' 의 참고 값 펼침(15초마다 다시 그려도 열린 채로)
  var ui = { view: 'live', quick: 'all', zone: '', q: '', sort: 'code', hidden: false, more: '', zref: false };
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
      C.rpc('admin_booth_credentials').then(null, function () { return null; }),
      // 공통 PIN 도 이 스위치가 꺼지면 로그인되지 않습니다(로그인 함수가 먼저 봄). 못 읽으면 모름(null).
      C.select('settings', { columns: 'booth_pin_enabled', order: false, limit: 1 }).then(null, function () { return null; }),
      // 행사 날짜는 따로 읽습니다 — 못 읽어도 PIN 스위치 값(위)에는 영향이 없게.
      C.select('settings', { columns: 'event_start,event_end,time_label', order: false, limit: 1 }).then(null, function () { return null; })
    ]).then(function (r) {
      data.zones = r[0] || [];
      data.booths = r[1] || [];
      data.creds = r[2] ? indexBy(r[2], 'booth_id') : null;
      var st = r[3] && r[3][0];
      data.pinOn = st && typeof st.booth_pin_enabled === 'boolean' ? st.booth_pin_enabled : null;
      data.event = (r[4] && r[4][0]) || null;
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

  /* ── 운영 시간 밖(표시 전용) ──────────────────────────────────
     행사 운영 시간(settings 의 행사 날짜 · 여는 시각 · 닫는 시각, BC.eventInfo)이 아닐 때 — 행사 전(리허설 기간) ·
     오늘 문 열기 전 · 오늘 운영 끝 · 행사 끝 — 30분 넘게 그대로인 값은 당연한 일이라 긴급하게 보이지 않게 합니다.
     '확인 필요' 판정(isStale · 30분)과 수는 그대로이고, 주황 대신 회색으로만 바뀌며 맨 위에 까닭 한 줄이 붙습니다.
     날짜를 못 읽거나 협의용 예시면 운영 중으로 봅니다(지금까지와 같음). */
  function offHours() {
    if (DEMO || !data.event) return null;
    var i = BC.eventInfo(data.event, Date.now());
    if (i.phase === 'open') return null;
    var mins = BC.staleMinutes();
    var why = { before: '행사 전(리허설 기간)', preopen: '오늘 운영 시작(' + i.openTime + ') 전', dayclosed: '오늘 운영 끝(' + i.closeTime + ')', after: '행사 끝' }[i.phase] || '운영 시간 밖';
    return { phase: i.phase, text: '<b>운영 시간 밖 · ' + esc(why) + '</b><span>' + mins + '분 넘게 그대로인 값은 참고용이며 긴급 확인 대상이 아닙니다' +
      (i.nextOpenLabel ? ' · 다음 운영 ' + esc(i.nextOpenLabel) : '') + '</span>' };
  }
  function offHtml(o) { return '<p class="lvoff" id="lv-off"' + (o ? '' : ' hidden') + '>' + (o ? o.text : '') + '</p>'; }

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
    // 여유 · 보통 · 혼잡 = 마지막 입력 기준(운영 상태 칸의 수와 같음). 30분 넘은 값도 들어가며, 줄에서는 점선 표로 구분됩니다.
    if (q === 'free') return r.state === 'open' && r.congestion === '여유';
    if (q === 'normal') return r.state === 'open' && r.congestion === '보통';
    if (q === 'busy') return r.state === 'open' && r.congestion === '혼잡';
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
    // 같은 순위 안에서는 운영 중(긴 대기부터) → 그 밖(부스번호순). 운영 중 · 잠시 중단이 함께 있는 '확인 필요' 묶음에서도
    // 순서가 늘 같도록(대기 비교와 번호 비교가 엇갈리지 않게) 운영 중이 아니면 대기를 -1 로 셉니다.
    return function (a, b) {
      var wa = a.state === 'open' ? a.wait : -1, wb = b.state === 'open' ? b.wait : -1;
      return (prio(a) - prio(b)) || (wb - wa) || byCode(a, b);
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
      // 30분 넘게 그대로면 마지막 입력값 — 흐린 글자(현재 대기처럼 보이지 않게, booth-admin.css 의 .lv.is-stale)
      return '<span class="lv__val"' + (r.stale ? ' title="마지막 입력값 · ' + BC.staleMinutes() + '분 이상 미갱신(현재 대기 아님)"' : '') + '>' +
        (r.stale ? '<span class="sr-only">마지막 입력값 </span>' : '') +
        '<span class="lv__num' + (r.wait === 0 ? ' lv__num--word' : '') + '">' + esc(big) + '</span>' +
        (r.wait === 0 ? '' : '<span class="lv__unit">' + (r.wait >= 60 ? '분 이상' : '분') + '</span>') + '</span>' +
        '<span class="lv__cong lvb lvb--' + tone(r) + (r.stale ? ' is-old' : '') + '">' + esc(r.congestion) + '</span>';
    }
    if (r.state === 'missing') return '<span class="lv__val"><span class="lv__num lv__num--none">—</span></span><span class="lv__cong">미입력</span>';
    // 중단 · 마감: 휴대폰은 이 칸에 낱말을, 데스크톱은 '운영상태' 칸이 말하므로 여기는 — 만
    return '<span class="lv__val"><span class="lv__word">' + esc(stateText(r)) + '</span><span class="lv__dash" aria-hidden="true">—</span></span>';
  }
  // 줄에 띄울 '손이 가야 할 표시' — 정상은 쓰지 않습니다. 빨강: QR 꺼짐 · PIN 실패 많음,
  // 주황: QR 미발급(발급하면 되는 준비 일), 회색: 개별 PIN 미발급 · 개별 PIN 꺼짐(QR 이 기본 길이라 약하게).
  // 리허설 공통 PIN 을 쓸 수 있는 동안(실제 부스 · 11-04 23:00 까지 · 개별 PIN 병행)의 '개별 PIN 미발급' 은 정상이라
  // 줄에 띄우지 않습니다 — 위 요약 줄과 펼친 상세(접속)에는 그대로 보입니다. 끝나는 때가 지나면 다시 띄웁니다.
  function flag(text, kind) { return '<span class="flag flag--' + kind + '">' + esc(text) + '</span>'; }
  function commonEnd() { return rh.st ? PS.endOf(rh.st.cutoff) : 0; }
  // 리허설 공통 PIN 상태 — 대상 목록(rh.st)을 아직 못 읽었으면 'unknown'(그때는 예전처럼 '미발급' 을 띄움)
  function commonOf(r) {
    var c = r.cred;
    return PS.common({ target: rh.st ? !!rh.st.ids[r.id] : null, shown: r.shown, pinState: c ? c.pin_state : null,
                       switchOn: data.pinOn, end: commonEnd(), now: Date.now() });
  }
  function credFlags(r) {
    var c = r.cred;
    if (!c) return '';
    var out = '';
    if (c.qr_state === 'off') out += flag('QR 꺼짐', 'bad');
    else if (c.qr_state !== 'on') out += flag('QR 미발급', 'warn');
    if (c.pin_state === 'off') out += flag('개별 PIN 꺼짐', 'off');
    else if (c.pin_state !== 'on' && commonOf(r).key !== 'open') out += flag('개별 PIN 미발급', 'off');
    if (r.pinIssue) out += flag('PIN 실패 많음', 'bad');
    return out;
  }
  function credText(r) {
    var c = r.cred;
    if (!c) return '접속 정보를 읽지 못했습니다';
    var qr = { on: 'QR 정상', off: 'QR 꺼짐' }[c.qr_state] || 'QR 미발급';
    var cp = commonOf(r);
    var cmn = cp.key === 'open' ? ' · ' + cp.label + '(' + PS.endText(commonEnd()) + '까지)' : (cp.label ? ' · ' + cp.label : '');
    // pin_sessions = 끝나지 않은 PIN 세션 수(지금 화면을 보고 있는지는 알 수 없음)
    return qr + ' · ' + PS.individual(c.pin_state).label + cmn +
      (c.pin_sessions > 0 ? ' · 유효한 PIN 세션 ' + c.pin_sessions + '개' : '') +
      (c.pin_failures_1h ? ' · 최근 1시간 PIN 실패 ' + c.pin_failures_1h + '번' : '');
  }
  // 요약 두 줄 — 리허설 공통 PIN / 개별 PIN. 실제 부스 = DB 의 리허설 대상(admin_rehearsal_status), 수는 고정하지 않습니다.
  function pinHtml(all) {
    if (DEMO || !rh.st) return '';
    var end = commonEnd(), endTxt = PS.endText(end);
    var s = PS.summarize(all.map(function (r) {
      return { target: !!rh.st.ids[r.id], pinState: r.cred ? r.cred.pin_state : null, common: commonOf(r) };
    }));
    var l1;
    if (!(Date.now() < end)) l1 = esc(endTxt) + '에 끝났어요';
    else if (!data.creds) l1 = esc(endTxt) + '까지 · 부스별 상태를 읽지 못했어요';
    else if (data.pinOn === false) l1 = 'PIN 보조 로그인이 꺼져 있어 지금은 쓸 수 없어요(관리자 → 기본정보)';
    // 설정을 못 읽으면 서버가 받을지 알 수 없어 수를 세지 않습니다(‘사용 가능’ 으로 단정하지 않음).
    else if (data.pinOn !== true) l1 = '상태 확인 불가 — PIN 보조 로그인 설정을 읽지 못했어요(끝나는 때 ' + esc(endTxt) + ')';
    else l1 = esc(endTxt) + '까지 · 사용 가능 <b>' + s.open + '곳</b>' +
      (s.closed ? ' · 개별 PIN 꺼짐으로 차단 ' + s.closed + '곳' : '') + (s.hidden ? ' · 비공개라 못 씀 ' + s.hidden + '곳' : '');
    var l2 = !data.creds ? '상태를 읽지 못했어요'
      : '실제 부스 ' + s.target + '곳 중 발급 <b>' + s.on + '곳</b> · 미발급 ' + s.none + '곳 · 꺼짐 ' + s.offPin + '곳' +
        (s.unk ? ' · 확인 불가 ' + s.unk + '곳' : '') +
        ' · <a href="print-qr.html" target="_blank" rel="noopener">QR · PIN 관리</a>';
    return '<p class="lvpin__row"><span class="lvpin__k">리허설 공통 PIN</span><span>' + l1 + '</span></p>' +
      '<p class="lvpin__row"><span class="lvpin__k">개별 PIN</span><span>' + l2 + '</span></p>';
  }
  function agoHtml(r) {
    if (!r.at) return '<span class="lv__agov">' + (r.state === 'missing' ? '입력 없음' : '') + '</span>';
    return '<span class="lv__agov">' + esc(BC.formatAgo(r.at)) + '</span>' +
      '<span class="lv__clock">' + esc(BC.formatClock(r.at)) + '</span>';
  }
  function attention(r) { return !!(r.stale || r.state === 'missing' || r.qrIssue || r.pinIssue); }
  // 진한 단추(확인·수정)는 QR · PIN 문제만 — 30분 넘게 그대로인 것(확인 필요)은 운영자가 갱신하는 것이 기본이라
  // 주황 '확인 필요' 표로만 알리고 단추는 보통 무게(수정)입니다. 관리자는 필요한 부스에만 손댑니다.
  function urgent(r) { return !!(r.qrIssue || r.pinIssue); }
  function actClass(r) { return urgent(r) ? 'btn--primary' : (r.state === 'missing' ? 'btn--soft' : 'btn--ghost'); }
  function actLabel(r) { return urgent(r) ? '확인·수정' : (r.state === 'missing' ? '입력' : '수정'); }
  function adminHref(r) {
    var q = r.code || r.name;
    return 'admin.html?' + (DEMO ? 'demo=1&' : '') + 'find=' + encodeURIComponent(q) + '#booths';
  }
  function moreHtml(r) {
    function row(k, v) { return v ? '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>' : ''; }
    return '<dl class="lvd">' +
        row('운영기관', BC.displayOrganization(r.org)) + row('프로그램', r.program) + row('구역', r.zone_label) +
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
    // 예시 부스('[예시]' 기관)는 이름 뒤 작은 테두리 표 하나로만 알립니다 — 운영 상태보다 앞서 읽히지 않게.
    var sampleTag = BC.isSample(r.b) ? '<span class="badge badge--plain badge--sample lv__ex">예시</span>' : '';
    return '<article class="lv lv--' + tone(r) + (r.stale ? ' is-stale' : '') + (attn ? ' is-attn' : '') + (open ? ' is-open' : '') +
        (r.shown ? '' : ' is-hidden') + '" data-id="' + esc(r.id) + '">' +
      '<div class="lv__booth">' +
        '<span class="lv__code">' + esc(r.code || '번호 미정') + '</span>' +
        '<span class="lv__name">' + esc(r.name || '(이름 없음)') + '</span>' + sampleTag + hiddenTag +
      '</div>' +
      '<div class="lv__meta">' +
        '<span class="lv__state"><i class="lv__dot" aria-hidden="true"></i>' + esc(stateText(r)) + '</span>' +
        '<span class="lv__flags">' + (r.stale ? '<span class="flag flag--warn flag--stale">확인 필요</span>' : '') +
          '<span class="lv__cred">' + credFlags(r) + '</span></span>' +
        '<span class="lv__ago">' + agoHtml(r) + '</span>' +
      '</div>' +
      '<div class="lv__wait">' + waitHtml(r) + '</div>' +
      '<div class="lv__act">' +
        // 단추 무게: QR/PIN 문제 = 진한 단추(확인·수정), 미입력 = 연한 보라(입력), 나머지(확인 필요 포함) = 옅은 단추(수정)
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
      return [codeHay(r.code), r.name, BC.displayOrganization(r.org), r.program, r.zone_label].join(' ').toLowerCase().indexOf(q) >= 0;
    }).sort(sorter(ui.sort));
  }
  /* 운영 상태 · 관리 조치 — 부스 운영 현황과 구역 현황이 같은 조각을 씁니다(구역 현황에서 누르면 그 걸러 보기로 부스 운영 현황).
     ST = 운영 상태 여섯 칸(마지막 입력 기준, 서로 겹치지 않음). 열쇠는 tone() 과 같은 값입니다. */
  var ST = [['free', '여유'], ['normal', '보통'], ['busy', '혼잡'], ['pause', '일시 중단'], ['closed', '운영 종료'], ['missing', '미입력']];
  function stateCount(rs) {
    var c = { total: rs.length, stale: 0, staleOpen: 0, stalePause: 0, qr: 0, pin: 0 };
    ST.forEach(function (x) { c[x[0]] = { n: 0, old: 0 }; });
    rs.forEach(function (r) {
      var k = c[tone(r)] ? tone(r) : 'missing';
      c[k].n++;
      if (r.stale) { c[k].old++; c.stale++; if (r.state === 'open') c.staleOpen++; else if (r.state === 'pause') c.stalePause++; }
      if (r.qrIssue) c.qr++;
      if (r.pinIssue) c.pin++;
    });
    c.open = c.free.n + c.normal.n + c.busy.n;
    return c;
  }
  // 상태 막대 — 칸마다 최근 확인(진한 색)과 30분 넘은 값(옅은 색)
  function stBar(c) {
    var segs = [];
    ST.forEach(function (x) {
      var v = c[x[0]];
      if (v.n - v.old > 0) segs.push([x[0], v.n - v.old]);
      if (v.old > 0) segs.push([x[0] + '-old', v.old]);
    });
    return '<span class="stbar" aria-hidden="true">' + segs.map(function (g) {
      return '<i class="stbar__s stbar__s--' + g[0] + '" style="flex-grow:' + g[1] + '"></i>';
    }).join('') + '</span>';
  }
  function statusHtml(c) {
    var mins = BC.staleMinutes();
    var cells = ST.map(function (x) {
      var v = c[x[0]], on = ui.view === 'live' && ui.quick === x[0];
      var allOld = v.n > 0 && v.old === v.n;
      return '<button class="st st--' + x[0] + (v.n ? '' : ' is-zero') + (allOld ? ' is-old' : '') + (on ? ' is-on' : '') + '" type="button" ' +
          'data-quick="' + x[0] + '" aria-pressed="' + on + '" aria-label="' + esc(x[1] + ' ' + v.n + '곳' +
          (v.old ? ' · 그중 확인 필요 ' + v.old + '곳(' + mins + '분 넘게 그대로)' : '') + ' — 이 부스만 보기') + '">' +
        '<span class="st__l"><i aria-hidden="true"></i>' + x[1] + '</span>' +
        '<b class="st__n">' + v.n + '</b>' +
        '<span class="st__o">' + (v.old ? '확인 필요 ' + v.old : '') + '</span>' +
      '</button>';
    }).join('');
    var allOn = ui.view === 'live' && ui.quick === 'all';
    return '<section class="opanel ost" aria-label="운영 상태">' +
      '<div class="opanel__head"><h2 class="opanel__t">운영 상태</h2>' +
        '<span class="opanel__cap">마지막 입력 기준 · <span class="dashkey">점선</span> = ' + mins + '분 넘게 그대로</span>' +
        '<button class="ost__all' + (allOn ? ' is-on' : '') + '" type="button" data-quick="all" aria-pressed="' + allOn + '">전체 부스 <b>' + c.total + '</b>곳</button></div>' +
      '<div class="ost__grid" role="group" aria-label="운영 상태로 걸러 보기">' + cells + '</div>' +
      stBar(c) +
    '</section>';
  }
  function todoBtn(k, label, n, sub, kind) {
    var on = ui.view === 'live' && ui.quick === k;
    return '<button class="todo todo--' + kind + (n ? '' : ' is-zero') + (on ? ' is-on' : '') + '" type="button" data-quick="' + k + '" aria-pressed="' + on + '">' +
      // 수를 먼저(읽는 순서 '21 확인 필요') — 자리는 CSS 격자가 정하고, '곳' 은 CSS 로 붙입니다.
      '<b class="todo__n">' + n + '</b><span class="todo__l">' + esc(label) + '</span>' +
      '<span class="todo__s">' + esc(sub) + '</span><span class="todo__go" aria-hidden="true">' + (n ? '보기 ›' : '') + '</span></button>';
  }
  function actionHtml(c) {
    var mins = BC.staleMinutes();
    return '<section class="opanel oact" aria-label="관리 조치">' +
      '<div class="opanel__head"><h2 class="opanel__t">관리 조치</h2></div>' +
      '<div class="oact__list">' +
        todoBtn('stale', '확인 필요', c.stale, c.stale ? mins + '분 넘게 그대로 · 운영 중 ' + c.staleOpen + ' · 중단 ' + c.stalePause : mins + '분 안에 모두 입력', 'stale') +
        todoBtn('missing', '미입력', c.missing.n, '오늘 입력된 상태 없음', 'missing') +
        (c.qr || ui.quick === 'qr' ? todoBtn('qr', 'QR 준비 필요', c.qr, 'QR이 없거나 꺼져 있고 PIN도 없음', 'qr') : '') +
        (c.pin || ui.quick === 'pin' ? todoBtn('pin', 'PIN 확인', c.pin, '1시간 PIN 실패 ' + PIN_FAIL_WARN + '번 이상', 'pin') : '') +
      '</div>' +
      // 아직 없는 기능 — 누를 수 없고 '준비 중' 이라고 씁니다(확인 시각 전용 DB 함수 · 알림 저장/발송 승인 뒤 구현)
      '<div class="oact__soon">' +
        '<button class="soon" type="button" disabled title="확인 시각만 바꾸는 DB 함수 승인 뒤 구현">일괄 확인<span>준비 중</span></button>' +
        '<button class="soon" type="button" disabled title="알림 저장 · 발송 기능 승인 뒤 구현">운영자 알림<span>준비 중</span></button>' +
      '</div>' +
    '</section>';
  }
  function summaryHtml(all) {
    var c = stateCount(base(all));
    return statusHtml(c) + actionHtml(c);
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
    // 이름 앞에 코드가 또 있으면 뗍니다(zoneName) — 'R1 · R1 실제 …' 가 아니라 'R1 · 실제 …', 이름이 'F구역' 뿐이면 'F구역'.
    return '<option value="">구역 전체</option>' + zs.map(function (z) {
      var nm = zoneName(z);
      return '<option value="' + esc(z.key) + '"' + (ui.zone === z.key ? ' selected' : '') + '>' +
        esc(nm ? z.key + ' · ' + nm : z.key + '구역') + '</option>';
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
          '<p class="page__desc">공개 부스의 혼잡 · 대기와 손이 가야 하는 부스를 봅니다.</p></div>' +
          '<div class="page__actions">' +
            // 행사 전 리허설 — 실제 부스 84곳(아래 리허설 관리). 협의용 예시(?demo)에는 없습니다.
            (DEMO ? '' : '<button class="btn btn--ghost btn--sm" type="button" id="lv-rh-toggle" data-rh-toggle aria-expanded="' + rh.open +
              '" aria-controls="lv-rh">리허설 관리</button>') +
            // 운영 준비용 예시 부스가 공개돼 있을 때만 보입니다(paintExampleBtn). 협의용 예시(?demo)에는 없습니다.
            '<button class="btn btn--ghost btn--sm" type="button" id="lv-example-fill" data-example="fill" hidden>예시 현황 채우기</button>' +
            '<button class="btn btn--ghost btn--sm" type="button" id="lv-example-clear" data-example="clear" hidden>예시 현황 비우기</button>' +
            '<button class="btn btn--ghost btn--sm" type="button" data-refresh>새로 고침</button>' +
            '<a class="btn btn--ghost btn--sm" href="admin.html' + (DEMO ? '?demo=1' : '') + '#booths">부스 정보 관리</a>' +
          '</div></div>' +
        (DEMO ? '<p class="demohint">' + esc(DEMO_TEXT) + ' 현황 수정을 눌러도 실제 DB에 반영되지 않고, 새로 고치면 처음 예시로 돌아갑니다.</p>' : '') +
        (DEMO ? '' : '<section class="card rhpanel" id="lv-rh" aria-labelledby="lv-rh-title"' + (rh.open ? '' : ' hidden') + '></section>') +
        '<p class="lvmeta" id="lv-meta" aria-live="polite"></p>' + offHtml(null) +
        '<div class="lvpin" id="lv-pin"></div>' +
        '<div class="odash" id="lv-sum"></div>' +
        // 검색 · 구역 · 정렬 · 지금 걸러 보는 것은 스크롤해도 맨 위에 붙어 있습니다(데스크톱은 표 머리도 함께).
        '<div class="lvbar" id="lv-bar">' +
          '<div class="tools lvtools">' +
            '<div class="lvtools__row">' +
              '<div class="search"><label class="sr-only" for="lv-q">검색</label>' +
                '<input class="input" id="lv-q" type="search" placeholder="' + esc(searchPh()) + '" value="' + esc(ui.q) + '" /></div>' +
              '<label class="listsel"><span class="sr-only">구역</span><select class="select select--sm" id="lv-zone"></select></label>' +
              // '운영 우선' 의 순서는 prio() — 고르기 칸에 마우스를 올리면 보입니다.
              '<label class="listsel"><span class="sr-only">정렬</span><select class="select select--sm" id="lv-sort" ' +
                'title="운영 우선: 확인 필요 → 미입력 → 혼잡(긴 대기부터) → 잠시 중단 → 운영 중(긴 대기부터) → 오늘 마감">' +
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
    var off = offHours(), ob = $('#lv-off');
    ob.hidden = !off; ob.innerHTML = off ? off.text : '';
    $('.lvpage').classList.toggle('is-off', !!off);
    $('#lv-pin').innerHTML = pinHtml(all);
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
    var q = QUICK.concat([['qr', 'QR 준비 필요'], ['pin', 'PIN 확인']]).filter(function (o) { return o[0] === ui.quick; })[0];
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
    paintRehearsal(all);
  }

  /* ── 구역 현황 ─────────────────────────────────────────────── */
  /* 맨 위 운영 상태 · 관리 조치(부스 운영 현황과 같은 조각) → 구역 카드 R1~R4 → 최장 대기 부스.
     구역 카드는 여유 · 보통 · 혼잡 · 중단 · 종료를 바로 견주게 다섯 칸으로(마지막 입력 기준, 칸의 부스가 모두 30분 넘은 값이면 흐리게),
     미입력은 작은 표로, 확인 필요는 강조 없이 회색 한 줄로만 씁니다(챙기는 곳은 위 관리 조치).
     최장 대기는 최근 확인된 값만 크게 쓰고, 오래된 값은 '참고' 로만(작고 흐리게) 보입니다. 판정(rowsNow · isStale · 30분)은 그대로입니다. */
  /* 구역 이름에서 앞의 구역 코드를 뗍니다 — 카드 · 구역 고르기 칸은 코드를 따로 씁니다.
       'R1 실제 위치 …' → '실제 위치 …' · 'F구역' → '' · 'A 구역 열린마당' → '열린마당'
     코드 바로 뒤가 끝 · 빈칸 · 나눔표 · '구역' 일 때만 코드로 봅니다 — 'AI 스쿨존'(A) · 'R10 …'(R1) 은 그대로. */
  function zoneName(z) {
    var label = String(z.label || '').trim(), key = String(z.key || '');
    var m = key && new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s*구역)?(?=$|[\\s·:\\-–|/(])').exec(label);
    if (m) label = label.slice(m[0].length).replace(/^[\s·:\-–|/]+/, '');
    return label === '구역' ? '' : label;
  }
  // 대기가 긴 순(같으면 부스번호순) — 최장 대기 · 최장 대기 부스 목록
  function byWait(a, b) { return (b.wait - a.wait) || byCode(a, b); }
  // 부스 묶음 하나(전체 또는 한 구역)의 수 — 운영 상태(stateCount)와 최장 대기(최근 확인 · 참고)
  function tally(rs) {
    var t = stateCount(rs);
    var openRows = rs.filter(function (r) { return r.state === 'open'; });
    t.top = openRows.filter(function (r) { return !r.stale; }).sort(byWait)[0] || null;   // 최근 확인된 최장 대기
    t.ref = openRows.filter(function (r) { return r.stale; }).sort(byWait)[0] || null;    // 30분 넘은 값 — 참고
    return t;
  }
  function zoneGroups() {
    var all = base(rowsNow());
    return data.zones.map(function (z) {
      var rs = all.filter(function (r) { return r.zone_key === z.key; });
      var g = tally(rs);
      g.z = z; g.name = zoneName(z); g.rs = rs;
      return g;
    }).filter(function (g) { return g.rs.length; });
  }
  /* 모든 카드의 구역 이름(코드를 뗀 것)이 같으면 — 리허설 임시구역 R1~R4 처럼 — 카드마다 되풀이하지 않고
     카드 위 공통 안내로 한 번만 씁니다. 카드에는 '리허설' 이 들어간 이름이면 짧은 표만 남깁니다. */
  function zoneCommon(groups) {
    if (groups.length < 2 || !groups[0].name) return '';
    for (var i = 1; i < groups.length; i++) if (groups[i].name !== groups[0].name) return '';
    return groups[0].name;
  }
  function waitText(w) { return w === 0 ? '바로' : w + (w >= 60 ? '분 이상' : '분'); }
  function zoneCard(g, common) {
    var tag = common && /리허설/.test(common) ? '<span class="zc__tag">리허설</span>' : '';
    var name = common ? '' : g.name;
    var t = g.top, f = g.ref, mins = BC.staleMinutes();
    // 최장 대기: 최근 확인된 값만 크게. 없으면 그렇다고 쓰고, 오래된 값은 '참고' 로만.
    var top;
    if (t) {
      top = '<span class="zc__topr"><span class="zc__topk">최장 대기</span><b class="zc__topw zc__topw--' + tone(t) + '">' + esc(waitText(t.wait)) + '</b>' +
          '<b class="zc__topc">' + esc(t.code || '') + '</b><span class="zc__topn">' + esc(t.name || '(이름 없음)') + '</span></span>' +
        '<span class="zc__tops">최근 확인 · ' + esc(BC.formatClock(t.at)) + ' 입력</span>';
    } else {
      top = '<span class="zc__topr"><span class="zc__topk">최장 대기</span><span class="zc__topnone">최근 확인된 대기 없음</span></span>' +
        '<span class="zc__tops">' + (f ? '<span class="zref">참고</span> 마지막 입력 ' + esc(waitText(f.wait)) + ' · ' + esc(f.code || '') + ' · ' + esc(BC.formatAgo(f.at))
          : (g.open ? '' : '운영 중으로 입력된 부스 없음')) + '</span>';
    }
    var cells = ST.slice(0, 5).map(function (x) {
      var v = g[x[0]];
      return '<span class="zst zst--' + x[0] + (v.n ? '' : ' is-zero') + (v.n && v.old === v.n ? ' is-old' : '') + '">' +
        '<span class="zst__l"><i aria-hidden="true"></i>' + (x[0] === 'pause' ? '중단' : x[0] === 'closed' ? '종료' : x[1]) + '</span>' +
        '<b class="zst__n">' + v.n + '</b></span>';
    }).join('');
    var label = g.z.key + ' 구역 · 부스 ' + g.total + '곳 · 마지막 입력 기준 ' + ST.map(function (x) { return x[1] + ' ' + g[x[0]].n; }).join(' · ') +
      ' · 확인 필요(' + mins + '분 넘게 그대로) ' + g.stale +
      ' · 최장 대기 ' + (t ? waitText(t.wait) + '(' + (t.code || '') + ')' : '최근 확인된 값 없음') + ' — 이 구역 부스 보기';
    return '<button class="zc" type="button" data-zone="' + esc(g.z.key) + '" aria-label="' + esc(label) + '">' +
      '<span class="zc__head">' +
        '<span class="zc__key">' + esc(g.z.key) + '</span>' +
        '<span class="zc__id">' + tag + (name ? '<span class="zc__name" title="' + esc(name) + '">' + esc(name) + '</span>' : '') + '</span>' +
        '<span class="zc__all">부스 <b>' + g.total + '</b>곳</span>' +
      '</span>' +
      '<span class="zc__sts">' + cells + '</span>' +
      stBar(g) +
      '<span class="zc__foot">' +
        '<span class="zc__miss' + (g.missing.n ? ' is-on' : '') + '">미입력 <b>' + g.missing.n + '</b></span>' +
        '<span class="zc__old">확인 필요 <b>' + g.stale + '</b></span>' +
      '</span>' +
      '<span class="zc__top">' + top + '</span>' +
    '</button>';
  }
  /* 구역 카드 아래 '최장 대기 부스' — 최근 확인된 대기만 순위로. 없으면 그렇다고 쓰고,
     30분 이상 미갱신 값은 접힌 '참고' 묶음 안에만 둡니다(흐린 글자 · '마지막 입력' · '오래된 참고값'). 누르면 그 부스 상세. */
  var LONG_N = 5;
  function longRow(r, old) {
    return '<li><button class="zl' + (old ? ' is-old' : '') + '" type="button" data-booth="' + esc(r.id) + '" ' +
        'aria-label="' + esc((r.code || '') + ' ' + (r.name || '') + ' · ' + r.zone_key + ' 구역 · ' + (old ? '마지막 입력 ' : '대기 ') + waitText(r.wait) +
          ' · ' + BC.formatClock(r.at) + ' 입력 · ' + (old ? '오래된 참고값' : '최근 확인') + ' — 상세 보기') + '">' +
      '<span class="zl__code">' + esc(r.code || '') + '</span>' +
      '<span class="zl__name">' + esc(r.name || '(이름 없음)') + '</span>' +
      '<span class="zl__zone">' + esc(r.zone_key) + '</span>' +
      '<span class="zl__wait' + (old ? '' : ' zl__wait--' + tone(r)) + '">' + (old ? '<small>마지막 입력</small>' : '') + esc(waitText(r.wait)) + '</span>' +
      '<span class="zl__at">' + esc(BC.formatClock(r.at)) + '<small>' + esc(BC.formatAgo(r.at)) + '</small></span>' +
      '<span class="zl__fresh"><span class="zbadge zbadge--' + (old ? 'old' : 'new') + '">' + (old ? '오래된 참고값' : '최근 확인') + '</span></span>' +
    '</button></li>';
  }
  function longestHtml(all) {
    var open = all.filter(function (r) { return r.state === 'open'; });
    var fresh = open.filter(function (r) { return !r.stale; }).sort(byWait).slice(0, LONG_N);
    var old = open.filter(function (r) { return r.stale; }).sort(byWait);
    var mins = BC.staleMinutes();
    return '<section class="zlong" aria-labelledby="zlong-title">' +
      '<div class="zlong__head"><h2 class="zlong__title" id="zlong-title">최장 대기 부스</h2>' +
        '<p class="zlong__sub">최근 확인(' + mins + '분 안에 입력)된 대기 · 상위 ' + LONG_N + '곳 · 누르면 그 부스 상세</p></div>' +
      (fresh.length
        ? '<ol class="zlist">' + fresh.map(function (r) { return longRow(r, false); }).join('') + '</ol>'
        : '<p class="zlong__empty"><b>현재 확인 가능한 대기정보 없음</b><span>' + mins + '분 안에 입력된 운영 중 부스가 없습니다.</span></p>') +
      (old.length
        ? '<details class="zlong__ref"' + (ui.zref ? ' open' : '') + ' data-zd="zref"><summary>참고 · ' + mins + '분 이상 미갱신된 마지막 입력값 ' + old.length + '곳' +
            '<span>현재 대기가 아닙니다</span></summary>' +
            '<ol class="zlist zlist--old">' + old.slice(0, LONG_N).map(function (r) { return longRow(r, true); }).join('') + '</ol></details>'
        : '') +
    '</section>';
  }
  function paintZones() {
    var all = base(rowsNow());
    var groups = zoneGroups();
    var common = zoneCommon(groups);
    var head = '<div class="page__head"><div><h1 class="page__title">구역 현황</h1>' +
      '<p class="page__desc">구역을 누르면 그 구역 부스만 봅니다.</p></div></div>' +
      (DEMO ? '<p class="demohint">' + esc(DEMO_TEXT) + '</p>' : '') +
      '<p class="lvmeta">' + metaHtml() + '</p>' + offHtml(offHours());
    var body = groups.length
      ? '<div class="odash">' + summaryHtml(all) + '</div>' +
        (common ? '<p class="znote"><b>' + esc(groups.map(function (g) { return g.z.key; }).join(' · ')) + '</b><span>' + esc(common) + '</span></p>' : '') +
        '<div class="zgrid' + (groups.length === 4 ? ' zgrid--4' : '') + '">' + groups.map(function (g) { return zoneCard(g, common); }).join('') + '</div>' +
        longestHtml(all)
      : emptyHtml(rowsNow());
    $('#view').innerHTML = '<div class="page lvpage' + (offHours() ? ' is-off' : '') + '">' + head + body + '</div>';
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

  /* ── 준비 기간 예시 현황: 채우기 · 비우기 ───────────────────────────
     이미 예시로 판별되는 부스(기관이 '[예시]' 로 시작)의 지금 대기 값만 한 번에 넣거나 비웁니다.
     부스를 예시로 만들거나 '[예시]' 를 붙이고 떼는 기능이 아닙니다 — 예시 여부는 DB 의 기관 이름이 정하고,
     부스 정보 · 공개 여부 · QR · PIN · 세션 · 공통 PIN 은 건드리지 않습니다(booth_live 한 줄만).
       · 채우기 — 예시 부스가 몇 곳이든 아래 비율(EXAMPLE_MIX)로 나눠 여유 · 보통 · 혼잡 · 잠시 중단 · 오늘 마감이
         고르게 섞여 보이게. 50곳이면 여유 19 · 보통 15 · 혼잡 10 · 잠시 중단 3 · 오늘 마감 3.
         다시 눌러도 같은 부스에 같은 값이 들어갑니다(부스 UUID 순서로 나눔 — A-01 같은 표시 번호와 무관).
       · 비우기 — 값을 지워 입력 전('정보 없음')으로. 다른 예시 값을 넣지 않습니다.
         (화면 이름은 '비우기'. 코드 안의 kind 는 서버 함수의 모드 이름을 따라 'clear' 그대로입니다.)
     30분 '확인 필요' · 자정 초기화 같은 실제 규칙은 그대로 두고, 값을 넣고 빼는 도구일 뿐입니다.
     새 쓰기 함수 없이 부스마다 관리자 긴급 수정과 같은 admin_set_booth_live 를 부릅니다(비우기는 그 함수의
     'clear' — '값 지우기' 단추와 같은 길). 모든 부스를 지우는 admin_reset_booth_live 는 실제 부스까지
     지우므로 쓰지 않습니다.
     대상: 서버에서 다시 읽은 부스 중 기관이 '[예시]' 로 시작하고(BoothCore.isSample), 공개 · 구역 공개 ·
     번호가 있는 곳만. 확인창의 숫자도 누르는 순간 다시 읽은 값이고, 실행 직전에 한 번 더 읽어 그 사이
     '[예시]' 를 지운 부스는 빠집니다. 부스마다 UUID(r.id)로 보냅니다. 값은 대기 시간 단추(WAIT_CHOICES) ·
     중단 · 마감만 씁니다.
     혼잡도는 늘 서버가 대기 시간으로 정합니다(10분 이하 여유 · 25분 이하 보통 · 그 위 혼잡) — 아래 값은
     그 규칙에 맞춰 고른 것이고, 여기서 혼잡도를 따로 정하지 않습니다.
     관람객 · 운영자 화면에는 '예시' 라는 말이 나가지 않습니다(관람객 화면은 기관 이름 앞 '[예시]' 를 떼고 보여 줍니다). */
  // 채우기 비율(몇 곳이든 이 비율로 나눔). share 는 50곳일 때의 곳 수, waits 는 그 상태 안에서 돌려 쓰는 대기 분.
  // 혼잡도는 서버가 대기 분으로 정하므로(10분 이하 여유 · 25분 이하 보통 · 그 위 혼잡) 그 칸에 맞는 값만 둡니다.
  var EXAMPLE_MIX = [
    { mode: 'open',   share: 19, waits: [5, 0, 10] },         // 여유 — 바로 · 5 · 10분
    { mode: 'open',   share: 15, waits: [15, 20] },           // 보통 — 15 · 20분
    { mode: 'open',   share: 10, waits: [30, 45, 30, 60] },   // 혼잡 — 30 · 45 · 60분
    { mode: 'pause',  share: 3 },                             // 잠시 중단
    { mode: 'closed', share: 3 }                              // 오늘 마감
  ];
  var EXAMPLE_POOL = 4;   // 동시에 보내는 요청 수(50곳을 하나씩 보내면 10초 넘게 걸려서)
  var exampleBusy = '';   // '' | 'check'(확인창 전 다시 읽는 중) | 'fill' | 'clear'
  var exampleProg = '';   // 단추에 붙는 '12/50'

  /* 채우기 계획: 대상 n 곳 → 부스마다 [모드, 대기 분].
     1) 곳 수 — 비율대로 내림하고 남는 자리는 나머지가 큰 상태부터(50곳이면 19 · 15 · 10 · 3 · 3 그대로).
     2) 순서 — 가중 라운드 로빈으로 섞어 같은 상태가 줄줄이 붙지 않게.
     3) 부스 — UUID 순서로 줄 세워 차례로 받습니다(표시 번호를 바꿔도 같은 부스는 같은 값). */
  function examplePlan(targets) {
    var n = targets.length, total = 0;
    EXAMPLE_MIX.forEach(function (m) { total += m.share; });
    var cnt = EXAMPLE_MIX.map(function (m) { return Math.floor(n * m.share / total); });
    var left = n - cnt.reduce(function (a, b) { return a + b; }, 0);
    EXAMPLE_MIX.map(function (m, i) { return { i: i, rem: n * m.share / total - cnt[i] }; })
      .sort(function (a, b) { return b.rem - a.rem || a.i - b.i; })
      .slice(0, left).forEach(function (x) { cnt[x.i]++; });
    var cur = cnt.map(function () { return 0; }), used = cnt.map(function () { return 0; });
    var order = targets.slice().sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    return order.map(function (r) {
      var k = 0;
      cur.forEach(function (c, i) { cur[i] += cnt[i]; if (cur[i] > cur[k]) k = i; });
      cur[k] -= n;
      var m = EXAMPLE_MIX[k], j = used[k]++;
      return { r: r, s: m.mode === 'open' ? ['open', m.waits[j % m.waits.length]] : [m.mode] };
    });
  }
  function exampleTargets(rows) {
    return rows.filter(function (r) { return r.shown && BC.isSample(r.b); });
  }
  function paintExampleBtn(all) {
    var rows = all || rowsNow();
    [['#lv-example-fill', 'fill', '예시 현황 채우기', '채우는 중…'],
     ['#lv-example-clear', 'clear', '예시 현황 비우기', '비우는 중…']].forEach(function (d) {
      var b = $(d[0]);
      if (!b) return;
      b.hidden = DEMO || !exampleTargets(rows).length;
      b.disabled = !!exampleBusy;
      b.textContent = exampleBusy === d[1] ? d[3] + (exampleProg ? ' ' + exampleProg : '') : d[2];
    });
  }
  // 부스 코드 목록은 길면 앞의 몇 곳만(토스트 한 줄에 들어가게).
  function codeList(codes) {
    return codes.length > 5 ? codes.slice(0, 5).join(', ') + ' 외 ' + (codes.length - 5) + '곳' : codes.join(', ');
  }
  function runExamples(kind) {
    if (DEMO || exampleBusy) return;
    var fill = kind === 'fill';
    // 확인창의 숫자가 지금 서버의 대상 수가 되도록 먼저 다시 읽습니다.
    exampleBusy = 'check';
    paintExampleBtn();
    loadMaster().then(function () {
      exampleBusy = '';
      paintExampleBtn();
      var n = exampleTargets(rowsNow()).length;
      if (!n) { toast('예시 부스가 없습니다.', true); return; }
      return UI.confirm({
        title: fill ? '예시 현황을 채울까요?' : '예시 현황을 비울까요?',
        message: (fill
          ? '현재 공개된 예시 부스 ' + n + '곳에 다양한 대기 상태를 입력합니다.'
          : '현재 공개된 예시 부스 ' + n + '곳의 대기 상태를 모두 미입력으로 되돌립니다.') +
          '\n실제 부스에는 적용되지 않습니다.',
        confirmLabel: fill ? '채우기' : '비우기'
      }).then(function (ok) { if (ok) sendExamples(kind); });
    }, function (e) {
      exampleBusy = '';
      paintExampleBtn();
      console.warn('[booth-admin] 예시 현황 — 부스 목록을 읽지 못했습니다', e && (e.code || e.message));
      toast(C.dataMessage(e), true);
    });
  }
  function sendExamples(kind) {
    var fill = kind === 'fill';
    exampleBusy = kind;
    exampleProg = '';
    paintExampleBtn();
    var done = [], failed = [];
    // 실행 직전에 한 번 더 고릅니다(확인창을 보는 사이 다른 화면에서 '[예시]' 를 지웠을 수 있음).
    loadMaster().then(function () {
      var targets = exampleTargets(rowsNow());
      var jobs = fill ? examplePlan(targets) : targets.map(function (r) { return { r: r, s: ['clear'] }; });
      return runPool(jobs, 'admin_set_booth_live', function (n) {
        exampleProg = n + '/' + jobs.length;
        paintExampleBtn();
      }).then(function (res) {
        res.done.forEach(function (j) { done.push(j.r.code); });
        res.failed.forEach(function (f) {
          failed.push(f.j.r.code);
          console.warn('[booth-admin] 예시 현황 ' + (fill ? '채우기' : '비우기') + ' 실패', f.j.r.code, f.e && f.e.code);
        });
      });
    }).then(function () {
      exampleBusy = '';
      exampleProg = '';
      // 결과를 기다리지 않고 바로 다시 읽어 요약 · 카드를 새 값으로 그립니다.
      return refreshMaster().then(function () {
        if (!failed.length) {
          toast(fill ? '예시 부스 ' + done.length + '곳에 현황을 채웠습니다.' : '예시 부스 ' + done.length + '곳의 현황을 비웠습니다.');
          return;
        }
        toast('성공 ' + done.length + '곳 · 실패 ' + failed.length + '곳 (' + codeList(failed) + ')', true);
      });
    }, function (e) {
      exampleBusy = '';
      exampleProg = '';
      paintExampleBtn();
      console.warn('[booth-admin] 예시 현황 — 부스 목록을 읽지 못했습니다', e && (e.code || e.message));
      toast(C.dataMessage(e), true);
    });
  }

  /* 몇 곳씩(EXAMPLE_POOL) 나눠 보내되 부스마다 결과를 따로 셉니다. 예시 현황 · 리허설이 함께 씁니다.
       jobs: [{ r: 부스 행, s: [모드, 대기 분] }] · fn: 부를 DB 함수 · tick(끝난 수): 진행 표시
       stop(e): 이 오류가 나면 남은 부스는 보내지 않습니다(돌려줄 때 skipped). 한 곳의 실패로 멈추지는 않습니다. */
  function runPool(jobs, fn, tick, stop) {
    var next = 0, halted = false, done = [], failed = [], skipped = [];
    function worker() {
      if (next >= jobs.length) return Promise.resolve();
      var j = jobs[next++];
      if (halted) { skipped.push(j); return worker(); }
      return C.rpc(fn, { p_booth_id: j.r.id, p_mode: j.s[0], p_wait_minutes: j.s[0] === 'open' ? j.s[1] : null })
        .then(function () { done.push(j); }, function (e) {
          failed.push({ j: j, e: e });
          if (stop && stop(e)) halted = true;
        })
        .then(function () { if (tick) tick(done.length + failed.length); return worker(); });
    }
    if (tick) tick(0);
    var pool = [];
    for (var i = 0; i < Math.min(EXAMPLE_POOL, jobs.length); i++) pool.push(worker());
    return Promise.all(pool).then(function () { return { done: done, failed: failed, skipped: skipped }; });
  }

  /* ── 행사 전 리허설: 실제 부스 84곳의 대기시간 채우기 · 비우기 ─────────────────
     위 '예시 현황' 과 같은 도구를 실제 부스에 씁니다 — 같은 비율(EXAMPLE_MIX · examplePlan), 같은 4곳씩 보내기(runPool),
     같은 확인창 · 진행 표시 · '성공 N · 실패 N' 알림. 다른 것은 대상과 문지기입니다.
       · 대상: DB 가 정한 실제 부스 84곳(admin_rehearsal_status 의 target_ids = 승인된 부스 UUID 목록).
         구역 · 번호 · 기관 이름과 상관없어 최종 배치로 옮겨도 같은 부스이고, 예시 부스는 들어 있지 않습니다.
       · 쓰기: admin_rehearsal_set_live — 관리자 · 84곳 · 행사 첫날(한국 날짜 11-06) 전만 통과시킨 뒤 안에서
         관리자 긴급 수정과 같은 admin_set_booth_live 를 부릅니다(혼잡도는 서버 판정 · 기록 source 'admin').
         비우기는 그 함수의 'clear' — 그 부스의 지금 값만 지우고 대기 기록은 남깁니다.
         모든 부스를 지우는 admin_reset_booth_live 는 쓰지 않습니다.
       · 행사 당일에는 서버가 거절합니다(이 화면을 고쳐 불러도 같음). 화면도 단추를 잠급니다.
       · 확인창을 열기 전 · 보내기 직전에 대상 · 닫힘 · 부스 목록을 다시 읽습니다. 보내는 동안 단추는 잠깁니다.
         일부가 실패하면 그 부스만 '다시 시도' 로 같은 값을 다시 보냅니다. 권한 · 로그인 만료 · 행사 시작으로
         거절되면 남은 부스는 보내지 않습니다.
     매일 23:00(KST) 자동 초기화는 DB 예약 작업(pg_cron → private.rehearsal_live_reset)이 하고, 여기서는 상태만 보입니다.
     관람객 사이트는 행사 전 값을 '리허설 중 · 실제 대기시간이 아닙니다' 띠와 함께 보여 줍니다(booth-live 의 visitor.html). */
  var rh = { open: false, st: null, err: null, busy: '', done: 0, total: 0, last: null };
  // st: 서버에서 읽은 상태 { ids: {uuid: true}, n, closed, cutoff, reset, sched, lastAt, lastSt }
  // busy: '' | 'load'(상태 읽는 중) | 'check'(확인창 전 다시 읽는 중) | 'fill' | 'clear' | 'retry'
  // last: 마지막 실행 결과 { kind, done, failed: [{ j, e }], skipped: [j], at } — '다시 시도' 에 씁니다
  var RH_SENDING = { fill: 1, clear: 1, retry: 1 };

  function loadRehearsal() {
    return C.rpc('admin_rehearsal_status').then(function (rows) {
      var x = Object.prototype.toString.call(rows) === '[object Array]' ? rows[0] : rows;
      if (!x) throw new Error('리허설 상태를 읽지 못했습니다.');
      var ids = {};
      (x.target_ids || []).forEach(function (id) { ids[id] = true; });
      rh.st = { ids: ids, n: (x.target_ids || []).length, closed: !!x.closed, cutoff: x.cutoff || '',
                reset: x.reset_state || 'none', sched: x.reset_schedule || '', lastAt: x.last_run_at || null, lastSt: x.last_status || '' };
      rh.err = null;
    }, function (e) {
      rh.err = e || {};
      throw e;
    });
  }
  // DB 함수가 아직 없음(migration-booth-rehearsal.sql 적용 전)
  function rhMissing() { return !!rh.err && (rh.err.code === 'PGRST202' || rh.err.code === '42883'); }
  function rhMessage(e) {
    if (e && (e.code === 'PGRST202' || e.code === '42883')) return '리허설 관리용 DB 함수가 아직 없습니다(supabase/migration-booth-rehearsal.sql 적용 전).';
    return C.dataMessage(e);
  }
  function rhTargets(rows) {
    return rh.st ? rows.filter(function (r) { return rh.st.ids[r.id]; }) : [];
  }
  // 권한 · 로그인 만료 · 행사 시작 — 다른 부스도 똑같이 거절되므로 남은 부스는 보내지 않습니다.
  function rhStop(e) {
    var m = (e && e.message) || '';
    return !!e && (e.hint === 'rehearsal_closed' || e.code === '42501' || e.code === 'PGRST301' || /행사가 시작되어|JWT|expired/i.test(m));
  }
  function mixSummary(plan) {
    var c = { '여유': 0, '보통': 0, '혼잡': 0, pause: 0, closed: 0 };
    plan.forEach(function (j) { if (j.s[0] === 'open') c[BC.congestionFor(j.s[1])]++; else c[j.s[0]]++; });
    return '여유 ' + c['여유'] + ' · 보통 ' + c['보통'] + ' · 혼잡 ' + c['혼잡'] + ' · 잠시 중단 ' + c.pause + ' · 오늘 마감 ' + c.closed + '곳';
  }
  function rhStamp(t) {
    var p = BC.kstParts(t);
    return p ? BC.pad2(p.m) + '.' + BC.pad2(p.d) + ' ' + BC.pad2(p.hh) + ':' + BC.pad2(p.mi) : '';
  }
  // 마지막으로 쓸 수 있는 날(닫히는 날의 전날): '11월 5일(목)'
  function rhLastDay() {
    if (!rh.st || !/^\d{4}-\d{2}-\d{2}$/.test(rh.st.cutoff)) return '';
    var p = BC.kstParts(Date.parse(rh.st.cutoff + 'T12:00:00+09:00') - 864e5);
    return p ? p.m + '월 ' + p.d + '일(' + p.dow + ')' : '';
  }
  function rhResetText() {
    var s = rh.st;
    if (s.reset === 'on' || s.reset === 'paused') {
      var t = s.reset === 'on' ? '매일 23:00 · 켜짐' : '멈춤';
      if (s.sched && s.sched !== '0 14 * * *') t += ' · 일정 ' + s.sched + ' (UTC)';
      return t + (s.lastAt ? ' · 마지막 ' + rhStamp(s.lastAt) + ' ' +
        (s.lastSt === 'succeeded' ? '성공' : s.lastSt === 'failed' ? '실패' : '진행 중') : ' · 아직 실행 전');
    }
    if (s.reset === 'off') return '예약 없음';
    if (s.reset === 'unknown') return '상태를 읽지 못함';
    return '아직 켜지 않음(예약 등록 전)';
  }
  function rhFact(label, value, bad) {
    return '<div class="rhfact"><dt>' + esc(label) + '</dt><dd' + (bad ? ' class="is-bad"' : '') + '>' + esc(value) + '</dd></div>';
  }
  function rhHtml(all) {
    var head = '<div class="rhpanel__head"><h2 class="rhpanel__title" id="lv-rh-title">리허설 관리' +
        '<span class="rhpanel__n">실제 부스 ' + (rh.st ? rh.st.n : 84) + '곳</span></h2>' +
      '<p class="rhpanel__desc">행사 전 리허설용 시험 대기시간을 한 번에 넣거나 비웁니다. 관람객 사이트에도 ' +
        '‘리허설 중 · 실제 대기시간이 아닙니다’ 안내와 함께 보입니다. 예시 부스 · QR · PIN · 대기 기록은 바뀌지 않습니다.</p></div>';
    if (!rh.st) {
      if (rh.err) {
        return head + '<p class="rhpanel__lock">' + esc(rhMessage(rh.err)) +
          (rhMissing() ? ' 적용되면 이 단추를 쓸 수 있습니다.' : ' <button class="linkreset" type="button" data-rh="reload">다시 확인</button>') + '</p>';
      }
      return head + '<p class="rhpanel__note">상태를 확인하는 중…</p>';
    }
    var s = rh.st, b = rh.busy, sending = !!RH_SENDING[b];
    var targets = rhTargets(all);
    var withVal = targets.filter(function (r) { return !!r.congestion; }).length;
    var html = head + '<dl class="rhpanel__facts">' +
      rhFact('지금 값 있음', withVal + ' / ' + targets.length + '곳', targets.length !== s.n) +
      rhFact('자동 초기화(23:00)', rhResetText(), s.reset !== 'on' || s.lastSt === 'failed') +
      rhFact('쓸 수 있는 때', s.closed ? '닫힘 · 행사 기간' : (rhLastDay() ? rhLastDay() + '까지' : '행사 전까지'), s.closed) +
      '</dl>';
    if (s.closed) {
      var C2 = rh.last && !RH_SENDING[b] ? rh.last : null;
      return html + '<p class="rhpanel__lock">행사가 시작되어 리허설 관리는 닫혔습니다. 행사 운영은 운영자 QR 입력을 씁니다.</p>' +
        (C2 ? '<p class="rhpanel__note">마지막 실행 ' + esc(rhStamp(C2.at)) + ' · 성공 ' + C2.done + '곳 · 넣지 못함 ' +
          (C2.failed.length + C2.skipped.length) + '곳</p>' : '');
    }
    var off = !!b || !targets.length;
    html += '<div class="rhpanel__acts">' +
      '<button class="btn btn--primary btn--sm" type="button" data-rh="fill"' + (off ? ' disabled' : '') + '>' +
        (b === 'fill' ? '채우는 중…' : '대기시간 자동 채우기') + '</button>' +
      '<button class="btn btn--ghost btn--sm" type="button" data-rh="clear"' + (off ? ' disabled' : '') + '>' +
        (b === 'clear' ? '비우는 중…' : '리허설 대기시간 비우기') + '</button>' +
      '</div>';
    if (sending) {
      var pct = rh.total ? Math.round(rh.done / rh.total * 100) : 0;
      html += '<div class="rhprog" role="progressbar" aria-label="보내는 중" aria-valuemin="0" aria-valuemax="' + rh.total +
          '" aria-valuenow="' + rh.done + '"><i style="width:' + pct + '%"></i></div>' +
        '<p class="rhpanel__note">' + (rh.total
          ? (b === 'clear' ? '비우는 중' : b === 'retry' ? '다시 보내는 중' : '채우는 중') + ' ' + rh.done + '/' + rh.total
          : '보내기 전에 대상을 다시 확인하는 중') + ' · 끝날 때까지 이 화면을 닫지 마세요.</p>';
    } else if (rh.last) {
      var L = rh.last;
      var bad = L.failed.map(function (f) { return f.j; }).concat(L.skipped);
      var what = L.kind === 'fill' ? '채웠습니다' : '비웠습니다';
      if (!bad.length) {
        html += '<p class="rhpanel__result">' + esc(rhStamp(L.at)) + ' · 실제 부스 ' + L.done + '곳을 ' + what + '.</p>';
      } else {
        var why = L.failed.length ? rhMessage(L.failed[0].e) : '';
        html += '<div class="rhpanel__result is-bad"><p>' + esc(rhStamp(L.at)) + ' · 성공 ' + L.done + '곳 · 실패 ' + bad.length + '곳 (' +
            esc(codeList(bad.map(function (j) { return j.r.code || j.r.name; }))) + ')' + (why ? '<br />' + esc(why) : '') + '</p>' +
          '<button class="btn btn--ghost btn--sm" type="button" data-rh="retry">실패한 ' + bad.length + '곳 다시 시도</button></div>';
      }
    }
    return html;
  }
  function paintRehearsal(all) {
    var box = $('#lv-rh');
    if (!box || DEMO) return;
    var t = $('#lv-rh-toggle');
    if (t) t.setAttribute('aria-expanded', String(rh.open));
    box.hidden = !rh.open;
    if (!rh.open) return;
    var html = rhHtml(all || rowsNow());
    if (box._rhHtml === html) return;   // 15초마다 다시 그려도 같으면 건드리지 않음(누르던 단추 · 포커스 유지)
    var f = document.activeElement && box.contains(document.activeElement) ? document.activeElement.getAttribute('data-rh') : null;
    box._rhHtml = html;
    box.innerHTML = html;
    if (f) { var again = box.querySelector('[data-rh="' + f + '"]'); if (again && !again.disabled) again.focus(); }
  }
  function refreshRehearsal() {
    if (rh.busy) return;
    rh.busy = 'load';
    paintRehearsal();
    loadRehearsal().then(null, function (e) {
      console.warn('[booth-admin] 리허설 상태를 읽지 못했습니다', e && (e.code || e.message));
    }).then(function () { rh.busy = ''; paintRehearsal(); });
  }
  function toggleRehearsal() {
    rh.open = !rh.open;
    paintRehearsal();
    if (rh.open) refreshRehearsal();
  }
  function runRehearsal(kind) {
    if (DEMO || rh.busy) return;
    var fill = kind === 'fill';
    // 확인창의 숫자 · '지금 값 있음' 이 지금 서버 값이 되도록 먼저 다시 읽습니다.
    rh.busy = 'check';
    paintRehearsal();
    Promise.all([loadRehearsal(), loadMaster().then(loadLive)]).then(function () {
      rh.busy = '';
      paint();
      if (rh.st.closed) { toast('행사가 시작되어 리허설 대기시간을 넣거나 지울 수 없습니다.', true); return; }
      var targets = rhTargets(rowsNow());
      if (!targets.length) { toast('리허설 대상 부스를 찾지 못했습니다.', true); return; }
      var withVal = targets.filter(function (r) { return !!r.congestion; });
      var byOp = withVal.filter(function (r) { return r.by === 'qr' || r.by === 'pin'; }).length;
      var message = fill
        ? '실제 부스 ' + targets.length + '곳에 시험 대기시간을 넣습니다.\n' + mixSummary(examplePlan(targets)) + '\n' +
          '관람객 사이트에도 ‘리허설 중 · 실제 대기시간이 아닙니다’ 안내와 함께 바로 보입니다.' +
          (withVal.length ? '\n\n지금 값이 있는 ' + withVal.length + '곳' + (byOp ? '(운영자 입력 ' + byOp + '곳 포함)' : '') +
            '은 새 시험 값으로 덮어씁니다.' : '') +
          '\n예시 부스 · QR · PIN · 대기 기록은 바뀌지 않습니다.'
        : '실제 부스 ' + targets.length + '곳의 지금 대기 값을 지워 ‘정보 없음’으로 되돌립니다(지금 값 있는 곳 ' + withVal.length + '곳).\n' +
          '대기 기록 · QR · PIN · 부스 정보 · 예시 부스는 그대로입니다.';
      return UI.confirm({
        title: fill ? '리허설 대기시간을 채울까요?' : '리허설 대기시간을 비울까요?',
        message: message,
        confirmLabel: fill ? '채우기' : '비우기',
        danger: !fill
      }).then(function (ok) { if (ok) sendRehearsal(kind, null); });
    }, function (e) {
      rh.busy = '';
      paintRehearsal();
      console.warn('[booth-admin] 리허설 — 상태 · 부스 목록을 읽지 못했습니다', e && (e.code || e.message));
      toast(rhMessage(e), true);
    });
  }
  // retry: 다시 보낼 부스(지난번 계획 그대로의 값). 없으면 지금 대상 전체로 새로 계획합니다.
  function sendRehearsal(kind, retry) {
    if (rh.busy) return;
    var fill = kind === 'fill';
    rh.busy = retry ? 'retry' : kind;
    rh.done = 0;
    rh.total = 0;
    paintRehearsal();
    // 보내기 직전에 한 번 더: 대상 목록 · 닫힘 · 부스 목록을 서버에서 다시 읽습니다.
    Promise.all([loadRehearsal(), loadMaster()]).then(function () {
      if (rh.st.closed) { var c = new Error('행사가 시작되어 리허설 대기시간을 넣거나 지울 수 없습니다.'); c.closed = true; throw c; }
      var jobs;
      if (retry) {
        jobs = retry.filter(function (j) { return rh.st.ids[j.r.id]; });
      } else {
        var targets = rhTargets(rowsNow());
        jobs = fill ? examplePlan(targets) : targets.map(function (r) { return { r: r, s: ['clear'] }; });
      }
      rh.total = jobs.length;
      return runPool(jobs, 'admin_rehearsal_set_live', function (n) { rh.done = n; paintRehearsal(); }, rhStop);
    }).then(function (res) {
      rh.busy = '';
      rh.last = { kind: kind, done: res.done.length, failed: res.failed, skipped: res.skipped, at: new Date() };
      res.failed.forEach(function (f) {
        console.warn('[booth-admin] 리허설 ' + (fill ? '채우기' : '비우기') + ' 실패', f.j.r.code, f.e && f.e.code);
      });
      var nBad = res.failed.length + res.skipped.length;
      // 결과를 기다리지 않고 바로 다시 읽어 요약 · 카드 · 이 칸을 새 값으로 그립니다(닫힘 · 자동 초기화 상태도 새로).
      return Promise.all([loadRehearsal().then(null, function () { /* 지난 상태로 그림 */ }), refreshMaster()]).then(function () {
        if (!nBad) {
          toast(fill ? '실제 부스 ' + res.done.length + '곳에 리허설 대기시간을 채웠습니다.' : '실제 부스 ' + res.done.length + '곳의 리허설 대기시간을 비웠습니다.');
          return;
        }
        // 권한 · 로그인 만료 · 행사 시작으로 멈췄으면 그 까닭과 '넣지 못함' 으로(보내지 않은 부스는 실패가 아님)
        var stop = res.failed.filter(function (f) { return rhStop(f.e); })[0];
        if (stop) {
          toast(rhMessage(stop.e) + ' 멈춤 — 성공 ' + res.done.length + '곳 · 넣지 못함 ' + nBad + '곳', true);
          return;
        }
        var codes = res.failed.map(function (f) { return f.j.r.code; }).concat(res.skipped.map(function (j) { return j.r.code; }));
        toast('성공 ' + res.done.length + '곳 · 실패 ' + nBad + '곳 (' + codeList(codes) + ')', true);
      });
    }, function (e) {
      rh.busy = '';
      paintRehearsal();
      if (!(e && e.closed)) console.warn('[booth-admin] 리허설 — 보내기 전 확인 실패', e && (e.code || e.message));
      toast(e && e.closed ? e.message : rhMessage(e), true);
    });
  }
  function retryRehearsal() {
    var L = rh.last;
    if (!L || rh.busy) return;
    var jobs = L.failed.map(function (f) { return f.j; }).concat(L.skipped);
    if (jobs.length) sendRehearsal(L.kind, jobs);
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
    // 리허설 대상 · 행사 첫날(공통 PIN 요약)도 함께 다시 읽습니다. 못 읽으면 지난 값으로 그립니다.
    if (!DEMO) loadRehearsal().then(null, function () { /* 지난 상태 */ });
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
    // 구역 현황의 '최장 대기 부스' 에서 누른 부스는 부스 운영 현황에서 펼친 채로 엽니다(그 밖에는 접힘).
    ui.more = ui.view === 'live' && ui.pend ? ui.pend : '';
    ui.pend = '';
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
      var ex = t.closest('[data-example]');
      if (ex) { runExamples(ex.getAttribute('data-example')); return; }
      if (t.closest('[data-rh-toggle]')) { toggleRehearsal(); return; }
      var rb = t.closest('[data-rh]');
      if (rb) {
        var rk = rb.getAttribute('data-rh');
        if (rk === 'retry') retryRehearsal();
        else if (rk === 'reload') refreshRehearsal();
        else runRehearsal(rk);
        return;
      }
      if (t.closest('#lv-hidden')) { ui.hidden = !ui.hidden; paintLive(); return; }
      if (t.closest('[data-reset]')) { ui.quick = 'all'; ui.zone = ''; ui.q = ''; var qi = $('#lv-q'); if (qi) qi.value = ''; paint(); return; }
      var qb = t.closest('[data-quick]');
      if (qb) {
        var v = qb.getAttribute('data-quick');
        if (ui.view === 'zones') { ui.quick = v; ui.zone = ''; ui.q = ''; window.location.hash = '#live'; return; }
        ui.quick = ui.quick === v && v !== 'all' ? 'all' : v; paint(); return;
      }
      // 최장 대기 부스 → 부스 운영 현황에서 그 부스 하나(부스번호 검색)를 상세가 펼쳐진 채로
      var bb = t.closest('[data-booth]');
      if (bb) {
        var br = rowsNow().filter(function (r) { return r.id === bb.getAttribute('data-booth'); })[0];
        if (br) { ui.q = br.code || br.name; ui.zone = ''; ui.quick = 'all'; ui.pend = br.id; window.location.hash = '#live'; }
        return;
      }
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
    // 구역 현황의 펼침(용어 · 참고 값)을 기억 — 15초마다 다시 그려도 사용자가 연 그대로(toggle 은 거품이 없어 잡기 단계에서)
    document.addEventListener('toggle', function (e) {
      var k = e.target && e.target.getAttribute && e.target.getAttribute('data-zd');
      if (k === 'zref') ui[k] = e.target.open;
    }, true);
    try {
      var mq = window.matchMedia('(max-width: 680px)');
      var onWidth = function () { var q = $('#lv-q'); if (q) q.placeholder = searchPh(); };
      if (mq.addEventListener) mq.addEventListener('change', onWidth); else mq.addListener(onWidth);
    } catch (e3) { /* 옛 브라우저 */ }
    // 리허설 값을 보내는 중에 창을 닫거나 다른 곳으로 가려 하면 한 번 묻습니다(보낸 곳까지만 바뀌어 있게 됨).
    window.addEventListener('beforeunload', function (e) {
      if (!RH_SENDING[rh.busy]) return;
      e.preventDefault();
      e.returnValue = '';
    });
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
      // 리허설 공통 PIN 요약 · 줄 표시에 쓸 대상 목록. 다 읽으면 다시 그립니다(못 읽으면 예전처럼 '개별 PIN 미발급' 을 띄움).
      if (!DEMO) loadRehearsal().then(paint, function () { /* 리허설 관리 칸이 까닭을 보임 */ });
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
