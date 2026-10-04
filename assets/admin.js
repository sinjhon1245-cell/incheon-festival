/* ===================================================================
   운영 콘텐츠 관리자 (CMS)

   목록에서 바로 수정·삭제·순서변경을 하고, 추가와 수정은 같은
   모달 폼을 씁니다. 브라우저 기본 prompt/confirm/alert 은 쓰지
   않습니다(assets/ui.js).

   보안: 이 파일에는 아무 권한도 없습니다. 쓰기를 막는 것은
   데이터베이스의 RLS(is_admin) 입니다.
   =================================================================== */
(function () {
  'use strict';

  var C = window.Core;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = C.esc;

  var cache = {};
  var current = 'overview';

  /* ── 협의용 예시 모드 (admin.html?demo=1#booths) ─────────────────
     관리자 로그인은 그대로 거친 뒤, 부스 · 구역 화면만 예시 데이터로 보여 줍니다.
     예시 모드에서는 Supabase 대신 assets/admin-demo.js 의 store 만 부릅니다 —
     저장 · 공개 · 삭제가 데이터베이스로 가지 않고, 새로 고치면 처음 예시로 돌아갑니다.
     파일이 없으면(옛 캐시 등) 예시 모드를 켜지 않고 실제 화면으로 둡니다. */
  var DEMO = (function () {
    try { return new URLSearchParams(window.location.search).has('demo'); } catch (e) { return false; }
  })() && !!window.AdminDemo;
  var DEMO_KEYS = ['booths', 'zones'];
  var DEMO_TABLES = ['zones', 'booths', 'booth_private'];
  var DEMO_TEXT = '협의용 예시 · 실제 행사 정보가 아닙니다.';
  var DEMO_SAVE_NOTE = '협의용 예시 · 저장 내용은 실제 DB에 반영되지 않습니다.';
  var AD = window.AdminDemo;
  // 읽고 쓰는 곳. 실제 모드는 Core(Supabase), 예시 모드는 메모리 store 입니다.
  var D = DEMO ? AD.store : {
    select: C.select, selectSoft: C.selectSoft, insert: C.insert,
    update: C.update, remove: C.remove, upsert: C.upsert
  };

  var SCHEDULE_CATS = ['무대', '강연', '부스', '운영', '행사 지원'];
  var SCHEDULE_STATES = ['예정', '진행 중', '종료', '취소', '변경'];
  /* 새로 고를 수 있는 분류입니다. '주차' 는 뺐지만 이미 그렇게
     등록된 요청은 그대로 두고 그대로 보여 줍니다(keepValue). */
  var REQ_KINDS = ['전기', '네트워크', '기자재', '시설', '안전', '물품', '기타'];
  var REQ_PRIORITY = ['긴급', '높음', '보통'];
  var REQ_STATES = ['접수', '확인 중', '처리 중', '완료'];
  var NOTICE_LEVELS = ['긴급', '중요', '일반'];
  var FAQ_CATS = ['부스 운영', '시설·장소', '안전', '물품·지원', '기타'];
  var SUPPLY_KINDS  = ['기관', '팀', '부스'];
  var ORG_TYPES     = ['초등', '중등', '고등', '기관', '기업', '기타'];
  var TASK_STATES   = ['예정', '진행 중', '완료'];
  var SUPPLY_STATES = ['미배부', '일부 배부', '배부 완료'];
  // booths_status_check 와 같은 목록 · 같은 순서입니다.
  var BOOTH_STATES  = ['준비 전', '준비 완료', '운영 중', '일시 중단', '운영 종료'];
  /* 역할 구분은 DB 에서 값을 제한하지 않습니다. 현장에서 쓰는 말이
     해마다 달라서, 여기서는 추천값으로만 보여 줍니다.

     포털의 연락망 역할 필터와 예시도 같은 이름을 씁니다. 관리자는
     '부스 지원', 포털 예시는 '부스지원팀' 처럼 갈라져 있으면 현장에서
     두 화면을 견주다 같은 역할인지부터 헷갈립니다.

     추천 목록 밖의 예전 값은 지우거나 바꾸지 않습니다 — keepValue 로
     그대로 보이고 그대로 저장됩니다. */
  var ROLE_GROUPS = ['총괄', '운영본부', '부스지원', '전산지원', '운영지원', '안전지원', '안내', '기타'];

  function opts(l) { return l.map(function (v) { return [v, v]; }); }

  /* 부모 한 줄에 딸린 관리자 전용 줄(예: 담당자 → contact_private).
     없으면 null 입니다 — 아직 개인 연락처를 한 번도 적지 않은 담당자. */
  function privateOf(key, parentId) {
    var pv = (ENTITIES[key] || {}).private;
    if (!pv || !parentId) return null;
    return (cache[pv.key] || []).filter(function (x) { return x[pv.parent] === parentId; })[0] || null;
  }

  /* 배정 한 줄이 가리키는 사람 이름. 연락망에 연결돼 있으면 그쪽을
     씁니다 — 연락처가 바뀌어도 배정을 다시 고칠 필요가 없습니다. */
  function assignName(a) {
    var c = a.contact_id
      ? (cache.contacts || []).filter(function (x) { return x.id === a.contact_id; })[0]
      : null;
    return (c ? c.name : a.person_name) || '';
  }

  /* 대상에 붙은 물품을 '명찰 6 · 생수 12' 로 적습니다. */
  function allocsOf(targetId) {
    return (cache.supply_allocations || [])
      .filter(function (a) { return a.target_id === targetId; })
      .map(function (a) {
        var it = (cache.supply_items || []).filter(function (x) { return x.id === a.item_id; })[0];
        return { name: it ? it.name : '', unit: it ? (it.unit || '개') : '개', qty: a.qty || 0 };
      })
      .filter(function (a) { return a.name; });
  }
  function allocNames(targetId) {
    return allocsOf(targetId).map(function (a) { return a.name; });
  }
  function allocLine(targetId) {
    var list = allocsOf(targetId);
    if (!list.length) return '<span class="muted">배부 물품 미등록</span>';
    return list.map(function (a) {
      return esc(a.name) + ' <b>' + a.qty + '</b>';
    }).join(' · ');
  }

  /* 포털의 빈 화면과 같은 모양을 씁니다(assets/portal.css 의 .state--empty). */
  var ICON_EMPTY =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.6" /><path d="M3.4 9.6h17.2" />' +
    '<path d="M8 14h8" /></svg>';

  var TONE = {
    '운영 중': 'ok', '준비 완료': 'info', '준비 전': 'warn', '일시 중단': 'danger', '운영 종료': 'off',
    '진행 중': 'ok', '예정': 'info', '종료': 'off', '취소': 'danger', '변경': 'warn',
    '긴급': 'danger', '중요': 'warn', '일반': 'info', '높음': 'warn', '보통': 'info',
    '접수': 'warn', '확인 중': 'info', '처리 중': 'info', '완료': 'ok',
    '미배부': 'warn', '일부 배부': 'info', '배부 완료': 'ok',
    // 연락망에서 '운영 인력' 으로 표시한 사람을 눈에 띄게 합니다.
    '운영 인력': 'info',
    // 공개 칸에 전화번호가 남은 담당자 — 옮기고 비워야 합니다.
    '공개 칸 번호 정리 필요': 'warn',
    // 부스 · 구역의 공개 상태(publishState)
    '공개': 'ok', '비공개': 'off', '미배정': 'warn', '구역 비공개': 'warn',
    // 운영자 QR · PIN · 대기 현황 표시(PIN 미발급은 평소 상태라 회색 — 요청한 부스에만 발급합니다)
    'QR 발급됨': 'info', 'QR 미발급': 'warn', 'QR 꺼짐': 'off', '확인 필요': 'danger',
    'PIN 발급됨': 'info', 'PIN 미발급': 'off', 'PIN 꺼짐': 'off', 'PIN 실패 많음': 'danger'
  };
  function badge(t) { return '<span class="badge badge--' + (TONE[t] || 'off') + '">' + esc(t) + '</span>'; }
  function tag(t) { return '<span class="badge badge--plain">' + esc(t) + '</span>'; }

  function fmtDay(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
      C.pad2(d.getHours()) + ':' + C.pad2(d.getMinutes());
  }
  /* ── 행사 날짜 ───────────────────────────────────────────────
     일정의 '일자' 칸이 쓰는 값입니다. 행사 기간은 기본정보(settings)의
     개막·종료 일시가 정합니다 — 일정 화면에서 날짜를 따로 적어 두지
     않습니다. 이틀 행사면 날짜 칸이 비어 있으면 안 됩니다. */
  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  function ymd(d) {
    return d.getFullYear() + '-' + C.pad2(d.getMonth() + 1) + '-' + C.pad2(d.getDate());
  }
  function eventDays() {
    var s = (cache.settings || [])[0];
    if (!s || !s.event_start) return [];
    var start = new Date(s.event_start);
    if (isNaN(start)) return [];
    var end = s.event_end ? new Date(s.event_end) : start;
    if (isNaN(end) || end < start) end = start;
    var days = [];
    var d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    var last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    while (d <= last && days.length < 14) {
      days.push(ymd(d));
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    }
    return days;
  }
  /* '2026-11-06' → '11.6. 금'. 목록 meta 에 작게 붙입니다. */
  function dayShort(day) {
    var p = String(day || '').split('-');
    if (p.length !== 3) return '';
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return isNaN(d) ? '' : (d.getMonth() + 1) + '.' + d.getDate() + '. ' + WEEKDAYS[d.getDay()];
  }

  /* '2026-11-06' → '11. 6.(금)'. 공문 표기와 같은 모양으로, 날짜 단추 ·
     목록의 날짜 묶음 제목에 씁니다. */
  function dayLabel(day) {
    var p = String(day || '').split('-');
    if (p.length !== 3) return '';
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return isNaN(d) ? '' : (d.getMonth() + 1) + '. ' + d.getDate() + '.(' + WEEKDAYS[d.getDay()] + ')';
  }

  /* ── 부스 구역 ───────────────────────────────────────────────
     구역은 zones 표에서 옵니다(관리자 → 부스 구역). booths.zone_key 가
     이 표의 key 를 가리키므로, 구역이 하나도 없으면 부스를 저장할 수
     없습니다. 구역 코드(A · B …)와 이름(스쿨존 …)의 짝은 관리자가
     정합니다 — 'A = 스쿨존' 을 화면이 정해 두지 않습니다. */
  function zoneList() { return cache.zones || []; }
  function zoneOf(key) {
    return key ? zoneList().filter(function (x) { return x.key === key; })[0] || null : null;
  }
  function zoneLabel(key) {
    var z = zoneOf(key);
    return z ? (z.label ? z.label + ' (' + z.key + ')' : z.key + '구역') : (key ? key + '구역' : '미배정');
  }
  function zoneOrder(key) {
    var i = zoneList().map(function (z) { return z.key; }).indexOf(key);
    return i < 0 ? 999 : i;
  }

  /* ── 부스의 자리 · 공개 ──────────────────────────────────────
     자리 = 구역(zone_key) + 번호(no). 'A-12' 같은 표시(code)는 데이터베이스가
     둘을 합쳐 만듭니다(supabase/migration-booth-master-data.sql). 화면은 비어 있는
     쪽을 'A-00' · '-00' 처럼 꾸며 내지 않고 무엇이 비었는지 그대로 적습니다. */
  function hasSlot(b) { return !!(b && b.zone_key && b.no != null && b.no !== ''); }
  function boothSlot(b) {
    if (hasSlot(b)) return b.code || (b.zone_key + '-' + C.pad2(b.no));
    if (b && b.zone_key) return b.zone_key + ' · 번호 미정';
    if (b && b.no != null && b.no !== '') return '구역 미정 · ' + b.no;
    return '미배정';
  }
  /* 관람객 · 부스 운영자에게 실제로 보이는가. 넷 다여야 합니다:
     구역 배정 · 번호 배정 · 구역 공개 · 부스 공개(데이터베이스의 공개 읽기 정책과 같은 규칙). */
  function boothShown(b) {
    var z = zoneOf(b.zone_key);
    return !!(b.is_published && hasSlot(b) && z && z.is_published);
  }
  // 운영 준비용 예시 부스 — 운영기관 이름이 '[예시]' 로 시작합니다. 표에 칸을 따로 두지 않고
  // 이 글자로만 알아봅니다(관람객 화면의 예시 안내 · BoothCore.isSample · 서버의 공통 PIN 조건과 같은 규칙).
  function isSampleBooth(b) { return /^\s*\[예시\]/.test(String((b && b.org) || '')); }
  // 목록에 보일 기관 이름: 앞의 '[예시]' 만 떼어 냅니다(BoothCore.displayOrganization 과 같은 규칙).
  // 고치기 칸에는 원래 값을 그대로 넣습니다 — 여기서 뗀 값이 저장되면 공통 PIN · 예시 현황 초기화 대상에서 빠집니다.
  function displayOrganization(org) { return String(org == null ? '' : org).replace(/^\s*\[예시\]\s*/, ''); }
  // 화면 설명은 글이거나(대부분) 지금 상태에 따라 바뀌는 함수입니다(부스 — 예시 부스 규칙 안내).
  function descOf(d) { return typeof d === 'function' ? d() : (d || ''); }
  // 목록 · 걸러 보기에 쓰는 공개 상태 한 낱말.
  function publishState(b) {
    if (!hasSlot(b)) return '미배정';
    if (!b.is_published) return '비공개';
    var z = zoneOf(b.zone_key);
    return z && z.is_published ? '공개' : '구역 비공개';
  }
  /* 공개를 켤 수 있는가. 안 되면 까닭을 돌려줍니다(데이터베이스 트리거와 같은 문구).
     v: 지금 고르려는 값(zone_key · no) — 저장 전 편집 창에서도 씁니다. */
  function publishBlock(v) {
    if (!v.zone_key || v.no == null || v.no === '') return '구역과 부스 번호를 먼저 지정해 주세요.';
    var z = zoneOf(v.zone_key);
    if (!z || !z.is_published) return '현재 구역이 비공개 상태입니다. 구역을 먼저 공개해 주세요.';
    return '';
  }
  /* ── 협의용 예시: QR · 대기 현황 표시와 흉내 단추 ──────────────────
     실제 관리자 화면에서는 QR 은 'QR 인쇄', 대기 입력은 부스 운영자 화면이 맡습니다.
     예시에서는 한 화면에서 흐름을 보여 주려고 목록 줄에 같은 규칙으로 흉내 냅니다. */
  function demoLiveTone(l) {
    if (!l) return 'off';
    return { '여유': 'ok', '보통': 'warn', '혼잡': 'danger' }[l.congestion] || 'off';
  }
  // 예시에서만: 대기 현황 흉내(⋯ 의 입력 단추)의 결과를 줄에서 바로 보게 합니다.
  function demoLiveTag(r) {
    var l = AD.liveOf(r.id);
    return '<span class="badge badge--' + demoLiveTone(l) + '">' + esc(AD.liveLabel(l)) + '</span>';
  }

  /* ── 부스 요약 · '확인 필요' (실제 · 예시 같은 화면) ───────────────
     요약 카드: 전체 · 공개 · 비공개 · 미배정 · QR 미발급 · 확인 필요. 카드가 걸러 보기를 겸합니다.
     QR 상태를 모르면(PIN 기능 전) QR 카드를, 대기 값을 못 읽었으면 '확인 필요' 카드를 빼고 그립니다.
     '확인 필요' = 관람객에게 보이는 부스인데 오늘 넣은 대기 값이 기준(분)보다 오래됨(마감 제외) —
     관람객 화면 · 부스 운영 현황과 같은 규칙입니다. */
  var liveMap = null;   // 실제 모드: { 부스 id: booth_live 한 줄 } · null = 모름
  var STALE_MIN = Number((window.FESTIVAL_CONFIG || {}).freshnessThresholdMinutes) || 30;
  function kstDayNum(ms) { return Math.floor((ms + 9 * 3600000) / 86400000); }
  function isStaleRow(r) {
    if (!boothShown(r)) return false;
    if (DEMO) return AD.isStale(AD.liveOf(r.id));
    var l = liveMap ? liveMap[r.id] : null;
    if (!l || !l.congestion || l.congestion === '마감') return false;
    var t = Date.parse(String(l.updated_at || '').replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1'));
    if (isNaN(t) || kstDayNum(t) !== kstDayNum(Date.now())) return false;   // 어제 값은 '정보 없음'
    return (Date.now() - t) / 60000 > STALE_MIN;
  }
  // 운영자 QR 상태 'on' · 'off' · 'none' · null(모름)
  function qrStateOf(r) {
    if (DEMO) return AD.accessOf(r.id);
    var c = credOf(r);
    return c ? c.qr_state : null;
  }
  function boothSummary(all) {
    function n(f) { return all.filter(f).length; }
    var out = [
      { n: all.length, l: '전체', all: true },
      { n: n(function (r) { return !!r.is_published; }), l: '공개', tone: 'ok', f: ['quick', 'on'] },
      { n: n(function (r) { return hasSlot(r) && !r.is_published; }), l: '비공개', f: ['quick', 'off'] },
      { n: n(function (r) { return !hasSlot(r); }), l: '미배정', tone: 'warn', f: ['quick', 'none'] }
    ];
    if (DEMO || creds) {
      out.push({ n: n(function (r) { return hasSlot(r) && qrStateOf(r) === 'none'; }), l: 'QR 미발급', tone: 'warn', f: ['quick', 'qrnone'] });
    }
    if (DEMO || liveMap) out.push({ n: n(isStaleRow), l: '확인 필요', tone: 'danger', f: ['quick', 'stale'] });
    return out;
  }
  function demoMore(r) {
    var a = AD.accessOf(r.id);
    function b(act, attrs, text) {
      return '<button class="btn btn--ghost btn--sm" type="button" data-act="' + act + '" ' + attrs + '>' + esc(text) + '</button>';
    }
    var qr = !hasSlot(r) ? '<span class="demomore__na">구역 · 번호를 정해야 발급할 수 있어요</span>'
      : a === 'none' ? b('demo-qr', 'data-op="issue"', '운영자 QR 발급')
      : a === 'on' ? b('demo-qr', 'data-op="off"', 'QR 끄기')
      : b('demo-qr', 'data-op="rekey"', '새 QR로 다시 켜기');
    var live = [0, 5, 15, 30].map(function (w) {
      return b('demo-live', 'data-mode="open" data-wait="' + w + '"', w ? w + '분' : '바로');
    }).join('') + b('demo-live', 'data-mode="pause"', '잠시 중단') + b('demo-live', 'data-mode="closed"', '오늘 마감');
    var ps = AD.pinOf(r.id).state;
    var pinActs = !hasSlot(r) ? '<span class="demomore__na">구역 · 번호를 정해야 발급할 수 있어요</span>'
      : ps === 'on' ? b('demo-pin', 'data-op="issue"', 'PIN 재발급') + b('demo-pin', 'data-op="off"', 'PIN 끄기')
      : ps === 'off' ? b('demo-pin', 'data-op="issue"', '새 PIN으로 다시 켜기')
      : b('demo-pin', 'data-op="issue"', 'PIN 발급');
    return '<div class="demomore">' +
      '<p class="demomore__t">운영자 QR · 협의용 예시 화면에서는 실제 QR이 발급되지 않습니다</p>' +
      '<div class="demomore__acts">' + qr + '</div>' +
      '<p class="demomore__t">운영자 PIN · 협의용 예시 PIN(4자리)만 보여 드립니다. 실제 PIN은 6자리이고 발급할 때 한 번만 보입니다</p>' +
      '<div class="demomore__acts">' + pinActs + '</div>' +
      '<p class="demomore__t">대기 현황 · 운영자 화면에서 누르는 것과 같은 규칙(공개 + QR 켜짐일 때만)</p>' +
      '<div class="demomore__acts">' + live + '</div></div>';
  }

  /* ── 운영자 QR · PIN 상태 (실제 모드) ─────────────────────────────
     admin_booth_credentials() 가 부스마다 '상태' 만 돌려줍니다(QR 열쇠 · PIN · 해시 없음).
     PIN 기능(supabase/migration-booth-pin.sql) 전이면 함수가 없어 상태 칸만 비웁니다 —
     목록 · 수정 · 공개는 그대로 동작합니다.
     PIN 은 요청한 부스에만 발급합니다(행사 전 일괄 발급 금지). 원문은 발급 창에서 한 번만 보이고
     창을 닫으면 화면 · 변수에서 사라집니다 — 저장 · 기록 · 알림 · 주소 어디에도 넣지 않습니다. */
  var creds = null;          // { 부스 id: {qr_state, pin_state, pin_sessions, pin_failures_1h, …} } · null = 모름
  var PIN_FAIL_WARN = 10;    // 최근 1시간 PIN 실패가 이만큼이면 'PIN 실패 많음'
  function loadCreds() {
    if (DEMO) return Promise.resolve();
    var a = C.rpc('admin_booth_credentials').then(function (rows) {
      var m = {};
      (rows || []).forEach(function (r) { m[r.booth_id] = r; });
      creds = m;
    }, function (e) {
      creds = null;
      if (window.console) console.warn('[admin] 운영자 QR · PIN 상태를 읽지 못했습니다', e && (e.code || e.message));
    });
    // '확인 필요' 를 세려고 대기 값도 함께 읽습니다(관리자는 모든 부스의 값을 읽을 수 있음). 못 읽으면 그 카드만 뺍니다.
    var b = C.select('booth_live', { columns: 'booth_id,congestion,updated_at', order: false }).then(function (rows) {
      var m = {};
      (rows || []).forEach(function (l) { m[l.booth_id] = l; });
      liveMap = m;
    }, function () { liveMap = null; });
    return Promise.all([a, b]);
  }
  function credOf(r) {
    if (!creds) return null;
    return creds[r.id] || { qr_state: 'none', pin_state: 'none', pin_sessions: 0, pin_failures_1h: 0 };
  }
  // 예시는 admin-demo.js 의 흉내 상태를 같은 모양으로 씁니다(PIN 은 상태만).
  function credShape(r) {
    if (!DEMO) return credOf(r);
    var p = AD.pinOf(r.id);
    return { qr_state: AD.accessOf(r.id), pin_state: p.state, pin_sessions: p.sessions, pin_failures_1h: p.failures };
  }
  function credTags(r) {
    var c = credShape(r);
    if (!c) return '';
    // 미배정 부스는 아직 발급할 수 없어 '미발급' 을 늘어놓지 않습니다.
    if (!hasSlot(r) && c.qr_state === 'none' && c.pin_state === 'none') return '';
    // 협의용 예시에서만 예시 PIN(4자리)을 줄에 보입니다. 실제 PIN 원문은 발급 창에서 한 번만 보이고 다시 조회할 수 없습니다.
    var demoPinTag = DEMO && c.pin_state === 'on' && AD.demoPin(r.id) ? tag('예시 PIN ' + AD.demoPin(r.id)) : '';
    return badge({ on: 'QR 발급됨', off: 'QR 꺼짐' }[c.qr_state] || 'QR 미발급') +
      badge({ on: 'PIN 발급됨', off: 'PIN 꺼짐' }[c.pin_state] || 'PIN 미발급') + demoPinTag +
      (c.pin_sessions > 0 ? tag('PIN 로그인 ' + c.pin_sessions + '대') : '') +
      (c.pin_failures_1h >= PIN_FAIL_WARN ? badge('PIN 실패 많음') : '');
  }
  function credMore(r) {
    var c = credOf(r);
    if (!c) return '';
    function b(act, text, danger) {
      return '<button class="btn ' + (danger ? 'btn--danger' : 'btn--ghost') + ' btn--sm" type="button" data-act="' + act + '">' +
        esc(text) + '</button>';
    }
    var acts = !hasSlot(r) ? '<span class="demomore__na">구역과 부스 번호를 먼저 지정해 주세요.</span>'
      : c.pin_state === 'on' ? b('pin-issue', 'PIN 재발급') + b('pin-off', 'PIN 끄기', true)
      : c.pin_state === 'off' ? b('pin-issue', '새 PIN으로 다시 켜기')
      : b('pin-issue', 'PIN 발급');
    return '<div class="demomore credmore">' +
      '<p class="demomore__t">운영자 PIN · QR 카드를 쓸 수 없는 부스에만 요청을 받아 발급합니다' +
        (c.pin_sessions > 0 ? ' · 지금 PIN 로그인 ' + c.pin_sessions + '대' : '') + '</p>' +
      '<div class="demomore__acts">' + acts + '</div>' +
      '<p class="demomore__t">운영자 QR 발급 · 끄기 · 바꾸기는 ' +
        '<a href="print-qr.html" target="_blank" rel="noopener">부스 QR 인쇄</a> 화면에서 합니다</p></div>';
  }
  // 운영자에게 불러 줄 운영자 화면 주소(QR 카드와 같은 사이트).
  function opSite() {
    var base = (window.FESTIVAL_CONFIG || {}).staffSiteUrl;
    try {
      if (base) { var u = new URL('booth-ctrl', base); return u.host + u.pathname; }
    } catch (e) { /* 아래 */ }
    return 'booth-ctrl.html';
  }
  function pinMessage(e) {
    if (e && e.hint === 'booth_pin_needs_slot') return '구역과 부스 번호를 먼저 지정해 주세요.';
    if (e && (e.code === 'PGRST202' || e.code === '42883')) return 'PIN 기능이 아직 켜지지 않았습니다(DB 설정 전).';
    if (e && e.code === 'P0002') return e.message || '해당 부스를 찾을 수 없습니다.';
    return C.dataMessage(e);
  }
  // 방금 만든 PIN 을 한 번만 보여 줍니다. 창을 닫으면 원문을 담은 변수도 비웁니다.
  function showPinOnce(row, pin, revoked, before) {
    UI.reveal({
      title: before === 'none' ? '운영자 PIN 발급' : '운영자 PIN 새로 발급',
      closeLabel: '확인했어요 · 닫기',
      bodyHtml:
        '<div class="pinshow">' +
          '<p class="pinshow__who"><b>' + esc(boothSlot(row)) + '</b> ' + esc(row.name || '') + '</p>' +
          '<p class="pinshow__label">운영자 PIN</p>' +
          '<p class="pinshow__pin" id="pin-once">' + esc(pin.slice(0, 3) + ' ' + pin.slice(3)) + '</p>' +
          '<button class="btn btn--ghost btn--sm" type="button" id="pin-copy">복사</button>' +
          '<p class="pinshow__warn">이 PIN은 다시 확인할 수 없습니다. 분실하면 새 PIN을 발급해 주세요.</p>' +
          (revoked ? '<p class="pinshow__note">예전 PIN으로 연 휴대폰 ' + revoked + '대는 로그아웃됐습니다.</p>' : '') +
          '<p class="pinshow__note">운영자에게 알려 줄 것: ' + esc(opSite()) + ' → “부스 번호와 PIN으로 시작” → 구역 → 부스 → PIN 6자리. ' +
            'QR 카드는 그대로 쓸 수 있습니다.</p>' +
        '</div>',
      onReady: function (panel) {
        panel.querySelector('#pin-copy').addEventListener('click', function (ev) {
          var btn = ev.currentTarget;
          if (!pin) return;
          var ok = function () { btn.textContent = '복사했어요'; };
          var no = function () { btn.textContent = '복사하지 못했어요 — 직접 적어 주세요'; };
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(pin).then(ok, no);
            else no();
          } catch (x) { no(); }
        });
      }
    }).then(function () { pin = null; });
  }
  function pinIssue(row) {
    var c = credOf(row) || { pin_state: 'none', pin_sessions: 0 };
    var label = boothSlot(row) + ' ' + (row.name || '');
    var p = privateOf('booths', row.id);
    var contact = p && (p.manager || p.manager_phone) ? [p.manager, p.manager_phone].filter(Boolean).join(' · ') : '';
    var ask = ' 전화로 요청을 받았다면 ' + (contact ? '등록된 담당자(' + contact + ')' : '등록된 담당자 연락처') +
      '로 되걸어 확인한 뒤 알려 주세요.';
    var o = c.pin_state === 'on'
      ? { title: 'PIN을 재발급할까요?', label: 'PIN 재발급', danger: true,
          message: '“' + label + '”의 지금 PIN이 바로 실패하고, 그 PIN으로 연 휴대폰 ' + (c.pin_sessions || 0) +
            '대가 로그아웃됩니다. QR은 그대로입니다.' }
      : c.pin_state === 'off'
      ? { title: '새 PIN으로 다시 켤까요?', label: '새 PIN 만들기', danger: false,
          message: '“' + label + '”에 새 PIN을 만들어 PIN 로그인을 다시 켭니다. 예전 PIN은 다시 쓸 수 없습니다. QR은 그대로입니다.' }
      : { title: '운영자 PIN을 발급할까요?', label: 'PIN 발급', danger: false,
          message: '“' + label + '” 부스의 운영자 PIN을 만듭니다. PIN은 다음 창에서 한 번만 보여 드려요.' };
    return UI.confirm({ title: o.title, message: o.message + ask, confirmLabel: o.label, danger: o.danger }).then(function (yes) {
      if (!yes) return;
      return C.rpc('admin_issue_booth_pin', { p_booth_id: row.id }).then(function (rows) {
        var r = Object.prototype.toString.call(rows) === '[object Array]' ? rows[0] : rows;
        var pin = r && /^\d{6}$/.test(String(r.pin || '')) ? String(r.pin) : null;
        var revoked = (r && r.revoked_sessions) || 0;
        r = null; rows = null;
        if (!pin) throw new Error('PIN 응답을 받지 못했습니다. 목록을 새로 고친 뒤 다시 발급해 주세요.');
        showPinOnce(row, pin, revoked, c.pin_state);
        pin = null;
        return loadCreds().then(function () { renderPanel(); });
      }).catch(function (e) {
        console.error('[admin] PIN 발급 실패', e && (e.code || e.message));
        toast(pinMessage(e), true);
      });
    });
  }
  function pinOff(row) {
    var c = credOf(row) || { pin_sessions: 0 };
    return UI.confirm({
      title: 'PIN 로그인을 끌까요?',
      message: '“' + boothSlot(row) + ' ' + (row.name || '') + '”의 PIN 로그인이 바로 막히고, PIN으로 연 휴대폰 ' +
        (c.pin_sessions || 0) + '대가 로그아웃됩니다. QR은 그대로입니다. 다시 켜려면 새 PIN을 발급합니다.',
      confirmLabel: 'PIN 끄기', danger: true
    }).then(function (yes) {
      if (!yes) return;
      return C.rpc('admin_disable_booth_pin', { p_booth_id: row.id }).then(function (rows) {
        var r = Object.prototype.toString.call(rows) === '[object Array]' ? rows[0] : rows;
        var n = (r && r.revoked_sessions) || 0;
        return loadCreds().then(function () {
          renderPanel();
          reopenMore(row.id);
          toast('PIN 로그인을 껐습니다.' + (n ? ' 휴대폰 ' + n + '대가 로그아웃됐습니다.' : '') + ' QR은 그대로입니다.');
        });
      }).catch(function (e) {
        console.error('[admin] PIN 끄기 실패', e && (e.code || e.message));
        toast(pinMessage(e), true);
      });
    });
  }

  // 'A-2' 와 'A-10' 을 사람 순서대로(숫자는 숫자로) 견줍니다.
  function natCmp(a, b) {
    return String(a || '').localeCompare(String(b || ''), 'ko', { numeric: true, sensitivity: 'base' });
  }

  function toLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  function fromLocalInput(v) {
    if (!v) return null;
    var d = new Date(v);
    return isNaN(d) ? null : d.toISOString();
  }

  /* ── 관리 항목 정의 ─────────────────────────────────────────── */
  var ENTITIES = {
    overview: { label: '대시보드', dashboard: true },

    settings: {
      label: '기본정보', table: 'settings', single: true, order: false,
      desc: '행사 이름과 일정, 장소, 안내도를 관리합니다.',
      fields: [
        { type: 'group', label: '기본 정보' },
        { k: 'event_title',   label: '행사 이름', wide: true, required: true },
        { k: 'event_start',   label: '개막 일시', type: 'datetime',
          hint: '일정의 일자 단추와 D-day 가 이 기간을 따릅니다' },
        { k: 'event_end',     label: '종료 일시', type: 'datetime' },
        { k: 'date_label',    label: '날짜 표기', placeholder: '2026. 11. 6.(금) ~ 11. 7.(토)' },
        { k: 'time_label',    label: '운영시간 표기', placeholder: '10:00 ~ 17:00' },
        { k: 'venue',         label: '장소' },
        { k: 'venue_detail',  label: '장소 상세', placeholder: '건물 · 층',
          hint: '확정 전에는 비워 두세요. 비면 포털에서 이 줄이 빠집니다' },
        { k: 'venue_address', label: '주소', wide: true },
        /* 예전에는 행사장 안내도 이미지 칸이었습니다. 안내도는 부스 배치도
           한 장으로 합쳐 비어 있던 칸이라, 이름 그대로 지도 링크로 씁니다. */
        { k: 'venue_map_url', label: '지도 링크', type: 'url', wide: true,
          placeholder: 'https://map.naver.com/…',
          hint: '네이버 · 카카오 지도의 장소 페이지 주소. 비우면 “지도에서 보기” 단추가 숨겨집니다' },

        /* 운영 문의 — 포털 행사장 화면의 장소 카드에 한 줄로 보입니다(비면 숨김).
           관리자 로그인 계정과는 상관없는 칸입니다. 예전 기본값
           '032-000-0000' · 'aifest@ice.go.kr' 은 자리표시 · 로그인 계정이라
           migration-lock-portal-actions.sql 에서 비웠습니다.
           portal_note(포털 안내 문구)는 포털 어디에도 쓰이지 않아 창에서
           뺐습니다. 표의 칸과 값은 그대로 있습니다. */
        { type: 'group', label: '운영 문의 · 안내' },
        { k: 'contact_phone', label: '운영 문의 전화', type: 'tel', placeholder: '기관 · 운영본부 대표번호',
          hint: '공용 번호만 적습니다(개인 휴대전화 금지). 비우면 포털에 나오지 않습니다' },
        { k: 'contact_email', label: '운영 문의 메일', type: 'email', placeholder: '문의를 받는 메일 주소',
          hint: '관리자 로그인 아이디와 별개입니다. 실제 문의 창구가 있을 때만 적습니다' },
        { k: 'ops_guide',     label: '홈 운영 안내', type: 'textarea', wide: true,
          hint: '행사 당일 먼저 확인할 내용. 포털 홈 아래에 보이고 줄바꿈도 그대로 보입니다' },
        { k: 'footer_note',   label: '하단 안내 문구', type: 'textarea', wide: true,
          hint: '포털 홈 맨 아래 작은 글씨 한 줄. 예: 운영 내용 및 규모는 변경될 수 있습니다' },

        /* 부스 운영자 PIN 보조 로그인의 전체 스위치(supabase/migration-booth-pin.sql).
           끄면 새 PIN 로그인과 열려 있는 PIN 화면이 바로 멈춥니다. QR 은 상관없습니다.
           칸이 아직 없으면(DB 설정 전) 창에서 빠집니다(needsColumn). */
        { type: 'group', label: '부스 운영자 PIN' },
        { k: 'booth_pin_enabled', label: 'PIN 보조 로그인 사용', type: 'bool', needsColumn: true,
          hint: '켜면 QR 카드를 쓸 수 없는 운영자가 부스 번호와 PIN으로 운영자 화면을 엽니다. 끄면 새 PIN 로그인과 ' +
                '열려 있는 PIN 화면이 바로 멈춥니다(QR은 그대로). PIN은 부스 목록의 ⋯ 에서 요청한 부스에만 발급합니다.' },
        /* 운영 준비용 예시 부스 공통 PIN(supabase/migration-booth-example-pin.sql). 맞는지는 늘 서버가 정합니다. */
        { k: 'booth_sample_common_pin_enabled', label: '운영 준비용 예시 부스 공통 PIN', type: 'bool', needsColumn: true,
          // 어느 부스가 대상인지는 부스 화면 설명 한 곳에만 둡니다(같은 설명을 되풀이하지 않음).
          hint: '켜면 공통 PIN 대상 부스는 부스마다 PIN을 발급하지 않아도 123456 으로 운영자 화면을 엽니다. ' +
                '실제 PIN · QR 은 그대로입니다. 실제 행사로 넘어갈 때 끕니다. 위의 PIN 보조 로그인도 켜져 있어야 합니다.' },

        /* 지도는 부스 배치도 한 장만 관리합니다. 행사장 안내도까지
           두면 그림을 두 번 올려야 하는데, 현장에서 실제로 찾는 것은
           부스 자리입니다. 이 한 장을 부스·행사장 두 화면이 함께
           씁니다. 안내도용이던 venue_map_alt · venue_map_caption 칸은
           표에 그대로 남겨 둡니다(venue_map_url 은 위의 지도 링크). */
        { type: 'group', label: '부스 배치도' },
        { k: 'booth_map_url',     label: '부스 배치도', type: 'image', folder: 'booth-map',
          hint: '가로형 이미지를 권합니다. 부스 현황과 행사장 화면에 함께 쓰입니다' },
        { type: 'group', label: '상세 설정', fold: true,
          hint: '화면을 읽어 주는 도구가 대신 읽는 설명과, 그림 아래 붙는 캡션입니다.' },
        { k: 'booth_map_alt',     label: '부스 배치도 설명', wide: true },
        { k: 'booth_map_caption', label: '부스 배치도 캡션', wide: true }
      ]
    },

    schedule_items: {
      label: '일정', table: 'schedule_items', addLabel: '+ 일정 추가',
      desc: '행사 일정을 관리합니다. 시작·종료 시각으로 진행 상태가 자동 계산됩니다.',
      // 새 일정의 일자는 행사 첫날로 채워 둡니다. 대부분 그날이고,
      // 아니면 고르면 됩니다 — 빈칸으로 두고 잊는 것보다 낫습니다.
      blank: function () {
        return { event_date: eventDays()[0] || '', start_time: '10:00', end_time: '10:30',
                 title: '', category: '운영', status: '예정' };
      },
      /* 목록 한 줄의 무게
           1순위  시각(왼쪽 기둥) · 일정명
           2순위  장소 · 담당팀 (meta)
           3순위  구분 · 상태 · 담당자 · 핵심 (작은 표시)
         날짜는 줄마다 적지 않고 날짜 묶음 제목(11. 6.(금))으로 나눕니다.
         상태 '예정' 은 기본값이라 표시하지 않습니다 — 취소 · 변경처럼
         눈여겨볼 상태만 남깁니다. */
      lead: function (r) { return (r.start_time || '--:--') + '–' + (r.end_time || '--:--'); },
      title: function (r) { return r.title || '(제목 없음)'; },
      metaHtml: true,
      meta: function (r) {
        var main = [r.place, r.team].filter(Boolean).map(esc).join(' · ');
        return (main || '<span class="muted">장소 미정</span>') +
          (r.owner ? '<span class="listrow__sub"> · ' + esc(r.owner) + '</span>' : '');
      },
      tags: function (r) {
        return tag(r.category || '운영') +
          (r.status && r.status !== '예정' ? badge(r.status) : '') +
          (r.is_highlight ? '<span class="badge badge--info">핵심</span>' : '');
      },
      // 시각 순으로 보여 주므로 위로 · 아래로 순서 바꾸기는 두지 않습니다.
      noReorder: true,
      sort: function (a, b) {
        var da = a.event_date || '9999', db = b.event_date || '9999';
        if (da !== db) return da < db ? -1 : 1;
        var x = C.toMin(a.start_time), y = C.toMin(b.start_time);
        if (x == null) x = 9999;
        if (y == null) y = 9999;
        if (x !== y) return x - y;
        var ex = C.toMin(a.end_time) || 0, ey = C.toMin(b.end_time) || 0;
        return ex !== ey ? ex - ey : (a.sort_order || 0) - (b.sort_order || 0);
      },
      groupBy: function (r) { return r.event_date ? dayLabel(r.event_date) : '일자 미정'; },
      searchText: function (r) {
        return [r.title, r.place, r.team, r.owner, r.memo].join(' ');
      },
      searchPlaceholder: '일정명 · 장소 · 담당팀 · 담당자 검색',
      searchPlaceholderShort: '일정 검색',
      filters: [
        { key: 'day', label: '날짜', kind: 'chips', inline: true,
          options: function (all) {
            var days = eventDays().slice();
            all.forEach(function (r) { if (r.event_date && days.indexOf(r.event_date) < 0) days.push(r.event_date); });
            days.sort();
            return days.map(function (d) { return [d, dayLabel(d)]; })
              .concat(all.some(function (r) { return !r.event_date; }) ? [['__none', '일자 미정']] : []);
          },
          test: function (r, v) { return v === '__none' ? !r.event_date : r.event_date === v; } },
        { key: 'cat', label: '구분', kind: 'select', options: function () { return opts(SCHEDULE_CATS); },
          test: function (r, v) { return (r.category || '운영') === v; } },
        { key: 'st', label: '상태', kind: 'select', options: function () { return opts(SCHEDULE_STATES); },
          test: function (r, v) { return (r.status || '예정') === v; } }
      ],
      empty: {
        title: '등록된 실제 일정이 없습니다.',
        hint: '공개 포털에는 협의용 예시가 표시됩니다. 실제 일정을 1건 이상 등록하면 예시는 자동으로 숨겨집니다.'
      },
      /* 입력 순서는 일정을 떠올리는 순서대로 둡니다.
           무엇을(일정명 · 구분) → 언제(일자 · 시각) → 어디서 · 누가 → 운영 상태
         구분 · 일자 · 상태처럼 고를 것이 몇 개뿐인 칸은 목록을 펼치지 않고
         한 번 눌러 고르는 단추(choice)로 둡니다. */
      fields: [
        { type: 'group', label: '무엇을' },
        { k: 'title',      label: '일정명', wide: true, required: true,
          placeholder: '예: 개막 행사, 부스 순회 점검' },
        { k: 'category',   label: '구분', type: 'choice', wide: true, required: true,
          options: opts(SCHEDULE_CATS) },

        { type: 'group', label: '언제' },
        // 일자와 시각은 따로 받습니다. 시작·종료는 'HH:MM' 이라 날짜를
        // 함께 담을 수 없고, 이틀 행사에서는 날짜가 반드시 필요합니다.
        // 행사 기간을 알면 fieldsFor 가 그 날짜들만 고르는 단추로 바꿉니다.
        // migration-schedule-event-date.sql 을 돌리기 전에는 칸이 없습니다.
        { k: 'event_date', label: '일자', type: 'date', wide: true, needsColumn: true },
        { k: 'start_time', k2: 'end_time', label: '시작시간', label2: '종료시간',
          type: 'timespan', required: true },

        { type: 'group', label: '어디서 · 누가' },
        { k: 'place',      label: '장소', wide: true, placeholder: '예: 읽걷쓰AI 열린마당' },
        { k: 'team',       label: '담당팀', placeholder: '예: 운영본부' },
        { k: 'owner',      label: '담당자', placeholder: '이름 또는 역할' },

        { type: 'group', label: '운영 상태' },
        { k: 'status',     label: '상태', type: 'choice', wide: true, required: true,
          options: opts(SCHEDULE_STATES),
          hint: '예정 · 진행 중 · 종료는 행사 당일 시각으로 자동 표시됩니다. 취소 · 변경만 직접 고르세요' },
        { k: 'is_highlight', label: '핵심 일정 (포털 홈 · 일정 화면에 강조)', type: 'bool' },
        { k: 'memo',       label: '메모', type: 'textarea', wide: true,
          placeholder: '현장 운영에 필요한 메모 (포털 일정 카드에 보입니다)' }
      ],
      /* time_label 은 구 스키마의 NOT NULL 칼럼입니다. 시작·종료로
         항상 채워야 INSERT 가 23502 로 막히지 않습니다. */
      beforeSave: function (v) {
        v.time_label = (v.start_time || '') + ' – ' + (v.end_time || '');
        var m = /^(\d{1,2}):/.exec(v.start_time || '');
        v.half = m && Number(m[1]) >= 12 ? 'pm' : 'am';
        // 빈 글자는 date 칸에 넣을 수 없습니다(Postgres 가 거절합니다).
        if ('event_date' in v && !v.event_date) v.event_date = null;
        return v;
      },
      /* 오류는 { message, field } 로 돌려줍니다 — 창이 그 칸으로 초점을 옮깁니다. */
      validate: function (v) {
        if (!String(v.title || '').trim()) return { message: '일정명을 입력해 주세요.', field: 'title' };
        var a = C.toMin(v.start_time), b = C.toMin(v.end_time);
        if (a == null) return { message: '시작시간을 골라 주세요.', field: 'start_time' };
        if (b == null) return { message: '종료시간을 골라 주세요.', field: 'end_time' };
        if (b <= a) return { message: '종료시간이 시작시간보다 빠르거나 같습니다. 종료시간을 다시 골라 주세요.', field: 'end_time' };
        /* 일자는 행사 기간 안에서만. 고르는 단추가 기간 안의 날짜만 보여 주지만,
           예전에 기간 밖 날짜로 저장된 일정은 그 값이 그대로 남아 있습니다.
           이틀 이상 행사에서 일자가 없으면 포털이 그 일정을 첫날 것으로
           봅니다. 짐작으로 남기지 않고 여기서 고르게 합니다. 하루 행사면
           나눌 날이 없으므로 비워 두어도 됩니다. */
        var days = eventDays();
        var range = days.map(dayShort).join(' · ');
        if ('event_date' in v && v.event_date && days.length && days.indexOf(v.event_date) < 0) {
          return { message: '일자는 행사 기간(' + range + ') 안에서 골라 주세요.', field: 'event_date' };
        }
        if ('event_date' in v && !v.event_date && days.length > 1) {
          return { message: '이틀 이상 행사입니다. 일자를 골라 주세요 (' + range + ').', field: 'event_date' };
        }
        return null;
      }
    },

    /* 부스 — 스쿨존만 84부스라 80~100개가 등록된다고 보고 만듭니다.
       목록은 줄 하나에 번호(왼쪽 기둥) → 부스명 → 운영기관 · 구역 순으로,
       구역별 묶음 제목으로 나누고(미배정은 맨 뒤), 번호 · 이름 · 기관 · 담당자 ·
       프로그램 검색과 공개 · 구역 · 기관 유형 · 상태 · 운영 필요사항 걸러 보기를 둡니다.

       위치는 구역과 번호 두 칸으로 받습니다. 'A-12' 같은 표시 번호(code)는 데이터베이스가
       둘을 합쳐 만듭니다 — 손으로 적지 않습니다. 구역 · 번호가 정해지기 전에도 '미배정' 으로
       먼저 등록하고, 공개는 구역 · 번호를 정하고 그 구역을 공개한 뒤에만 켤 수 있습니다
       (데이터베이스도 같은 규칙으로 막고, 미배정이 되면 저절로 비공개로 돌립니다).
       공개 여부와 운영 상태(준비 전 … 운영 종료)는 서로 다른 칸입니다.

       담당자 · 담당자 연락처 · 운영 메모 · 특이사항은 관리자 전용 표(booth_private)에 따로
       둡니다. booths 는 로그인 없이 읽히는 표라서, 이 넷은 booths 로 보내지 않습니다(private). */
    booths: {
      label: '부스', table: 'booths', addLabel: '+ 부스 추가',
      // 부스 QR(운영자 카드 · 부스 앞 안내 · 입구 포스터)은 부스를 등록한 뒤
      // 여기서 바로 뽑습니다. 새 탭으로 열어 관리 화면의 입력을 잃지 않게 합니다.
      headLink: ['print-qr.html', '부스 QR 인쇄'],
      // 행사 당일 전체 현황(대기 시간 · 확인 필요 · 긴급 수정)은 따로 된 화면입니다.
      liveLink: ['booth-admin.html', '부스 운영 현황'],
      desc: function () {
        return '부스 정보와 운영기관을 관리합니다. 구역 · 번호가 정해지기 전에도 미배정으로 먼저 등록할 수 있고, ' +
          '공개한 부스(공개한 구역 안)만 관람객 · 부스 운영자에게 보입니다.' +
          // 예시 부스 규칙 설명은 이 한 곳에만 둡니다(기본정보 스위치 설명 · 다른 화면에 되풀이하지 않음).
          ((cache.booths || []).some(isSampleBooth)
            ? ' [예시] 표시가 있는 운영기관은 준비 기간 공통 PIN 및 예시 현황 초기화 대상입니다.' : '');
      },
      blank: function () {
        return { zone_key: '', no: null, name: '', org: '', status: '준비 전', is_published: false };
      },
      lead: function (r) { return boothSlot(r); },
      title: function (r) { return r.name || '(이름 없음)'; },
      metaHtml: true,
      meta: function (r) {
        var p = privateOf('booths', r.id);
        var org = displayOrganization(r.org);
        return (org ? esc(org) : '<span class="muted">운영기관 미정</span>') +
          ' · ' + esc(zoneLabel(r.zone_key)) +
          (p && p.manager ? '<span class="listrow__sub"> · 담당 ' + esc(p.manager) + '</span>' : '');
      },
      tags: function (r) {
        // 예시 부스는 짧은 '예시' 표 하나로만 알립니다(기관명에는 '[예시]' 를 붙이지 않음 — displayOrganization).
        return (isSampleBooth(r) ? '<span class="badge badge--plain badge--sample">예시</span>' : '') +
          badge(publishState(r)) + (r.org_type ? tag(r.org_type) : '') + badge(r.status || '준비 전') +
          (r.needs_power ? '<span class="badge badge--plain badge--need">전기</span>' : '') +
          (r.needs_network ? '<span class="badge badge--plain badge--need">네트워크</span>' : '') +
          credTags(r) + (DEMO ? demoLiveTag(r) : '') + (isStaleRow(r) ? badge('확인 필요') : '');
      },
      // 맨 위 요약 카드(실제 · 예시 같음) — 누르면 그 부스만 거릅니다(아래 filters 의 quick).
      // 줄의 ⋯: 예시는 QR · 대기 입력 흉내, 실제는 운영자 PIN 발급 · 재발급 · 끄기(QR 은 부스 QR 인쇄 화면).
      summary: boothSummary,
      moreHtml: DEMO ? demoMore : credMore,
      // 목록에서 바로 켜고 끄는 공개 단추(quickHtml · onQuick).
      quick: function (r) { return { on: !!r.is_published, label: '공개', what: '부스' }; },
      onQuick: function (r) { return togglePublish('booths', r); },
      noReorder: true,
      // 구역 순서 → 번호. 미배정(구역 없음)은 맨 뒤, 같은 구역에서 번호가 없으면 그 구역의 끝.
      sort: function (a, b) {
        var za = a.zone_key ? zoneOrder(a.zone_key) : 1000, zb = b.zone_key ? zoneOrder(b.zone_key) : 1000;
        if (za !== zb) return za - zb;
        var na = a.no == null ? 1e6 : a.no, nb = b.no == null ? 1e6 : b.no;
        if (na !== nb) return na - nb;
        return natCmp(a.name || '', b.name || '');
      },
      groupBy: function (r) {
        if (!r.zone_key) return '미배정';
        var z = zoneOf(r.zone_key);
        return zoneLabel(r.zone_key) + (z && !z.is_published ? ' · 구역 비공개' : '');
      },
      searchText: function (r) {
        var p = privateOf('booths', r.id);
        return [boothSlot(r), r.code, r.name, r.org, p ? p.manager : '', r.program, zoneLabel(r.zone_key)].join(' ');
      },
      searchPlaceholder: '부스번호 · 부스명 · 기관 · 담당자 · 프로그램 검색',
      searchPlaceholderShort: '부스 검색',
      filters: [
        /* 요약 카드가 거는 조건(공개 · 비공개 · 미배정 · QR 미발급 · 확인 필요). 칩으로는 그리지 않습니다 —
           예전의 '공개' 칩 줄은 요약 카드와 같은 숫자를 한 번 더 보여 줘서 뺐습니다. */
        { key: 'quick', label: '요약', kind: 'summary',
          test: function (r, v) {
            if (v === 'none') return !hasSlot(r);
            if (v === 'on') return !!r.is_published;
            if (v === 'off') return hasSlot(r) && !r.is_published;
            if (v === 'qrnone') return hasSlot(r) && qrStateOf(r) === 'none';
            if (v === 'stale') return isStaleRow(r);
            return true;
          } },
        /* 구역이 여섯 이하면 짧은 칩('A 4'), 더 많아지면 고르기 상자(긴 이름)로 바뀝니다. */
        { key: 'zone', label: '구역', kind: 'chips', maxChips: 6,
          options: function (all) {
            return zoneList().filter(function (z) { return all.some(function (r) { return r.zone_key === z.key; }); })
              .map(function (z) { return [z.key, (z.label || z.key + '구역') + ' (' + z.key + ')', z.key]; });
          },
          test: function (r, v) { return r.zone_key === v; } },
        { key: 'org', label: '기관 유형', kind: 'select',
          options: function () { return opts(ORG_TYPES).concat([['__none', '유형 미정']]); },
          test: function (r, v) { return v === '__none' ? !r.org_type : r.org_type === v; } },
        { key: 'st', label: '상태', kind: 'select', options: function () { return opts(BOOTH_STATES); },
          test: function (r, v) { return (r.status || '준비 전') === v; } },
        { key: 'need', label: '운영 필요', kind: 'select',
          options: function () { return [['power', '전기 필요'], ['network', '네트워크 필요']]; },
          test: function (r, v) { return v === 'power' ? !!r.needs_power : !!r.needs_network; } }
      ],
      empty: function () {
        return { title: '아직 등록된 부스가 없습니다.', addText: '+ 첫 부스 등록',
          hint: '구역 · 번호가 정해지기 전에도 미배정으로 먼저 등록할 수 있습니다. 공개 포털에는 협의용 예시가 ' +
                '표시되고, 실제 부스를 1곳 이상 공개하면 예시는 자동으로 숨겨집니다.',
          // 실제 부스가 한 곳이라도 생기면 이 빈 화면 자체가 나오지 않으므로 함께 사라집니다.
          alt: DEMO ? null : { lead: '화면 구성을 먼저 확인해 보시겠어요?', href: 'admin.html?demo=1#booths',
                               label: '협의용 예시 화면 보기' } };
      },
      /* 입력 순서: 기본 정보(프로그램 포함) → 위치 → 운영 → 공개 → 관리자 전용 → 사진. */
      fields: [
        { type: 'group', label: '기본 정보' },
        { k: 'name',          label: '부스명', wide: true, required: true },
        { k: 'org',           label: '운영기관', wide: true, placeholder: '예: ○○초등학교' },
        { k: 'org_type',      label: '기관 유형', type: 'select',
          options: [['', '(선택 안 함)']].concat(opts(ORG_TYPES)),
          hint: '포털 카드에 초등 · 중등 · 고등 표시로 보입니다',
          // migration-portal-actions.sql 을 돌리기 전에는 칸이 없습니다.
          needsColumn: true },

        { k: 'program',       label: '프로그램', type: 'textarea', wide: true,
          hint: '체험 · 전시 내용. 관람객 화면 · 포털에 그대로 보이는 공개 설명입니다' },

        { type: 'group', label: '위치',
          hint: '구역 · 번호가 정해지지 않았으면 미배정으로 두세요. 부스 번호(A-12)는 구역과 번호로 저절로 만들어집니다.' },
        { k: 'zone_key',      label: '구역', type: 'zone', allowEmpty: true },
        { k: 'no',            label: '번호', type: 'number', min: 1, max: 999, step: 1, placeholder: '예: 12',
          hint: '구역 안의 부스 번호(1~999). 비우면 번호 미정' },
        { k: '__slot',        label: '부스 번호', type: 'note',
          live: function (v) {
            var b = { zone_key: v.zone_key || null, no: v.no == null || v.no === '' ? null : v.no };
            if (hasSlot(b)) return b.zone_key + '-' + C.pad2(b.no);
            return boothSlot(b) + ' — 구역과 번호를 모두 정하면 A-12 처럼 만들어집니다';
          } },

        { type: 'group', label: '운영' },
        { k: 'hours',         label: '운영 시간', placeholder: '예: 10:00 ~ 17:00' },
        { k: 'supplies',      label: '준비물 · 필요 물품', placeholder: '예: 테이블 2, 멀티탭 1' },
        { k: 'needs_power',   label: '전기 사용 필요', type: 'bool' },
        { k: 'needs_network', label: '네트워크 필요', type: 'bool' },
        { k: 'status',        label: '운영 상태', type: 'choice', wide: true, required: true,
          options: opts(BOOTH_STATES) },

        { type: 'group', label: '공개' },
        { k: 'is_published',  label: '관람객 · 부스 운영자에게 공개', type: 'bool',
          hint: '구역과 번호가 있고 그 구역이 공개일 때만 켤 수 있습니다. 운영자 QR은 공개 전에도 발급 · 인쇄할 수 있지만, ' +
                '공개해야 그 QR로 운영할 수 있습니다.' },

        { type: 'group', label: '관리자 전용 정보',
          hint: '관리자만 볼 수 있습니다(booth_private). 포털 · 관람객 화면과 비로그인 사용자에게는 전달되지 않습니다.' },
        { k: '__private_manager', label: '부스 담당자', placeholder: '이름 또는 역할' },
        { k: '__private_phone',   label: '담당자 연락처', type: 'tel' },
        { k: '__private_memo',    label: '내부 메모', type: 'textarea', wide: true },
        { k: '__private_notes',   label: '특이사항', type: 'textarea', wide: true },

        { type: 'group', label: '부스 사진 (선택)', fold: true },
        { k: 'image_url',     label: '부스 대표 이미지', type: 'image', folder: 'booth' },
        { k: 'image_alt',     label: '이미지 설명', wide: true },
        { k: 'image_caption', label: '이미지 캡션', wide: true }
      ],
      /* 관리자 전용 칸을 booth_private 한 줄과 잇습니다(contacts → contact_private 와 같은 방식). */
      private: {
        key: 'booth_private', parent: 'booth_id', onConflict: 'booth_id',
        what: '부스 정보', privWhat: '관리자 전용 정보(담당자 · 연락처 · 내부 메모 · 특이사항)', noun: '부스',
        map: { __private_manager: 'manager', __private_phone: 'manager_phone',
               __private_memo: 'memo', __private_notes: 'notes' }
      },
      validate: function (v, row) {
        var no = v.no;
        if (no != null && no !== '' && (!/^\d+$/.test(String(no)) || Number(no) < 1 || Number(no) > 999)) {
          return { message: '번호는 1~999 사이의 숫자로 적어 주세요.', field: 'no' };
        }
        if (v.zone_key && no != null && no !== '') {
          var dup = (cache.booths || []).filter(function (b) {
            return (!row || b.id !== row.id) && b.zone_key === v.zone_key && Number(b.no) === Number(no);
          })[0];
          if (dup) {
            return { message: v.zone_key + '-' + C.pad2(no) + ' 은(는) 이미 “' + (dup.name || '이름 없음') + '” 부스가 쓰고 있습니다.', field: 'no' };
          }
        }
        // 공개를 '켜는' 저장만 막습니다. 이미 공개된 부스는 구역이 나중에 비공개가 돼도 고칠 수 있어야 합니다.
        if (v.is_published && !(row && row.is_published)) {
          var why = publishBlock(v);
          if (why) return { message: why, field: 'is_published' };
        }
        return null;
      },
      beforeSave: function (v) {
        v.zone_key = v.zone_key || null;
        v.no = (v.no == null || v.no === '') ? null : Number(v.no);
        // 미배정이면 공개할 수 없습니다(데이터베이스도 저절로 끕니다).
        if (!v.zone_key || v.no == null) v.is_published = false;
        delete v.code;   // 표시 번호는 데이터베이스가 만듭니다
        // '선택 안 함' 은 빈 글자가 아니라 null 로 보냅니다(표의 허용값 검사).
        if ('org_type' in v && !v.org_type) v.org_type = null;
        return v;
      },
      // 공개였던 부스가 미배정이 되어 저절로 비공개가 됐으면 그렇게 알립니다.
      afterSave: function (updated, row) {
        if (row && row.is_published && !updated.is_published && !hasSlot(updated)) {
          return '저장했습니다. 구역 · 번호가 비어 비공개로 바뀌었습니다.';
        }
        return null;
      },
      deleteMessage: function (r) {
        return '“' + (r.name || '이름 없음') + '” 부스를 삭제합니다. 이 부스의 운영자 QR · PIN · PIN 로그인 · 대기 현황 · 입력 기록 · ' +
          '관리자 전용 정보도 함께 지워지고 되돌릴 수 없습니다. 잠시 숨기려면 삭제 대신 공개를 끄세요.';
      }
    },

    /* 부스 구역 — booths.zone_key 가 가리키는 표.
       구역을 지워도 부스는 지워지지 않습니다. 데이터베이스가 그 구역의 부스를 미배정 ·
       비공개로 돌립니다(on delete set null + 저장 트리거). 그래서 지울 때는 몇 곳이
       미배정이 되는지 알리고 확인만 받습니다(deleteMessage · afterDelete).
       구역을 비공개로 바꾸면 그 구역의 부스는 관람객 · 운영자에게서 모두 숨겨지지만,
       부스마다의 공개 값은 그대로 남습니다 — 구역을 다시 공개하면 그대로 돌아옵니다. */
    zones: {
      label: '부스 구역', formLabel: '구역', table: 'zones', addLabel: '+ 구역 추가',
      desc: '부스를 묶는 구역입니다. 구역 코드 · 이름은 확정 전까지 임시로 정해도 됩니다. ' +
        '공개한 구역의 공개 부스만 관람객 · 부스 운영자에게 보입니다.',
      blank: { key: '', label: '', sub: '', is_published: false },
      lead: function (r) { return r.key; },
      title: function (r) { return r.label || r.key + '구역'; },
      meta: function (r) {
        var inZone = (cache.booths || []).filter(function (b) { return b.zone_key === r.key; });
        var shown = inZone.filter(boothShown).length;
        return (r.sub ? r.sub + ' · ' : '') + '부스 ' + inZone.length + '곳' +
          (inZone.length ? ' (관람객에게 보이는 부스 ' + shown + '곳)' : '');
      },
      tags: function (r) { return badge(r.is_published ? '공개' : '비공개'); },
      quick: function (r) { return { on: !!r.is_published, label: '공개', what: '구역' }; },
      onQuick: function (r) { return togglePublish('zones', r); },
      // 표시 순서 칸을 직접 고쳐도 목록 · ↑ · ↓ 가 같은 순서를 보도록 저장 뒤 다시 줄 세웁니다.
      resort: function (a, b) {
        return ((a.sort_order || 0) - (b.sort_order || 0)) || natCmp(a.key || '', b.key || '');
      },
      empty: {
        title: '등록된 구역이 없습니다.',
        hint: '예: 코드 A · 이름 읽걷쓰AI 스쿨존. 구역 코드와 이름의 짝은 배치가 확정되면 바꿀 수 있습니다. ' +
              '부스는 구역이 없어도 미배정으로 먼저 등록할 수 있습니다.'
      },
      fields: [
        { k: 'key',   label: '구역 코드', required: true, placeholder: '예: A',
          hint: '짧은 영문 · 숫자. 부스 번호 앞부분(A-12 의 A)이 됩니다. 바꾸면 그 구역 부스의 번호도 따라 바뀝니다' },
        { k: 'label', label: '구역 이름', required: true, placeholder: '예: 읽걷쓰AI 스쿨존' },
        { k: 'sub',   label: '설명', wide: true, placeholder: '예: 초·중·고 AI체험 · 교육활동 결과 전시' },
        { k: 'sort_order', label: '표시 순서', type: 'number', min: 0, step: 1,
          hint: '작을수록 앞에 보입니다. 목록의 ⋯ → 위로 · 아래로로도 바꿀 수 있습니다' },
        { k: 'is_published', label: '관람객 · 부스 운영자에게 공개', type: 'bool',
          hint: '끄면 이 구역의 부스는 관람객 · 운영자 화면에서 모두 숨겨집니다. 부스마다의 공개 설정은 그대로 남습니다.' }
      ],
      validate: function (v, row) {
        var key = String(v.key || '').trim();
        if (!/^[A-Za-z0-9]{1,8}$/.test(key)) {
          return { message: '구역 코드는 영문 · 숫자 1~8자로 적어 주세요(예: A).', field: 'key' };
        }
        var dup = zoneList().some(function (z) { return (!row || z.id !== row.id) && z.key === key; });
        return dup ? { message: '구역 코드 ' + key + ' 은(는) 이미 있습니다.', field: 'key' } : null;
      },
      beforeSave: function (v) {
        v.key = String(v.key || '').trim();
        v.label = String(v.label || '').trim();
        if (v.sort_order == null || v.sort_order === '') delete v.sort_order;   // 새 구역은 맨 뒤(엔진이 채움)
        return v;
      },
      // 코드를 바꾸면 데이터베이스가 부스의 zone_key 와 표시 번호(code)를 따라 바꿉니다
      // (on update cascade + 저장 트리거). 화면이 가진 부스 목록은 새로 읽어 맞춥니다.
      afterSave: function (updated, row) {
        if (row && row.key !== updated.key) return reloadBooths();
        return null;
      },
      deleteMessage: function (r) {
        var n = (cache.booths || []).filter(function (b) { return b.zone_key === r.key; }).length;
        return '“' + (r.label || r.key) + '” 구역을 삭제합니다.' +
          (n ? ' 이 구역의 부스 ' + n + '곳은 지워지지 않고 미배정 · 비공개가 됩니다(운영자 QR · 기록은 남음).' : '') +
          ' 되돌릴 수 없습니다.';
      },
      afterDelete: function () { return reloadBooths(); }
    },

    /* 메뉴에는 없지만 부스 편집 창이 씁니다(관리자 전용 칸). 관리자 로그인일 때만
       줄이 내려옵니다(RLS). 표가 없는 환경(마이그레이션 전)에서는 빈 목록이 됩니다. */
    booth_private: {
      label: '부스 관리자 전용 정보', table: 'booth_private', soft: true, hidden: true,
      order: [['created_at', true]],   // 이 표에는 sort_order 가 없습니다
      title: function () { return '(부스 관리자 전용 정보)'; },
      fields: []
    },

    notices: {
      label: '공지', table: 'notices', addLabel: '+ 공지 작성',
      empty: { title: '등록된 공지가 없습니다.', hint: '행사 관계자가 먼저 확인해야 할 내용을 공지로 등록해 주세요.' },
      order: [['pinned', false], ['created_at', false]],
      desc: '관계자에게 전달할 운영 안내를 관리합니다.',
      blank: { level: '일반', title: '', body: '', pinned: false },
      title: function (r) { return r.title || '(제목 없음)'; },
      meta: function (r) { return (r.author ? r.author + ' · ' : '') + fmtDay(r.created_at); },
      tags: function (r) { return badge(r.level) + (r.pinned ? tag('고정') : ''); },
      fields: [
        { k: 'level',  label: '등급', type: 'select', options: opts(NOTICE_LEVELS) },
        { k: 'pinned', label: '상단 고정', type: 'bool' },
        { k: 'title',  label: '제목', wide: true, required: true },
        { k: 'body',   label: '내용', type: 'textarea', wide: true },
        { k: 'author', label: '작성자 또는 담당부서' }
      ]
    },

    operation_requests: {
      label: '운영 요청', table: 'operation_requests', addLabel: '+ 요청 등록',
      empty: { title: '접수된 운영 요청이 없습니다.', hint: '현장 관계자가 포털에서 문제를 보고하면 여기에 쌓입니다. 관리자가 직접 등록할 수도 있습니다.' },
      order: [['created_at', false]],
      desc: '현장 요청의 처리 상태를 관리합니다.',
      blank: { location: '', kind: '기타', priority: '보통', title: '', status: '접수' },
      title: function (r) { return r.title || '(제목 없음)'; },
      meta: function (r) {
        return (r.location || '위치 미지정') + ' · ' + fmtDay(r.created_at) +
          (r.assignee_team ? ' · 담당팀 ' + r.assignee_team : '');
      },
      tags: function (r) { return badge(r.status) + badge(r.priority) + tag(r.kind); },
      fields: [
        { k: 'status',        label: '처리 상태', type: 'select', options: opts(REQ_STATES) },
        { k: 'priority',      label: '우선순위', type: 'select', options: opts(REQ_PRIORITY) },
        { k: 'kind',          label: '유형', type: 'select', options: opts(REQ_KINDS), keepValue: true },
        { k: 'assignee_team', label: '처리 담당팀',
          hint: '이 요청을 처리할 팀. 예: 전산지원 · 부스지원 · 운영지원' },
        { k: 'location',      label: '부스 또는 위치', wide: true, required: true },
        { k: 'title',         label: '제목', wide: true, required: true },
        { k: 'body',          label: '내용', type: 'textarea', wide: true },
        { k: 'reporter',      label: '등록자' }
      ]
    },

    resources: {
      label: '자료실', formLabel: '자료', table: 'resources', addLabel: '+ 자료 추가',
      empty: { title: '등록된 자료가 없습니다.', hint: '운영 매뉴얼 · 안전 지침처럼 관계자가 찾아볼 문서의 주소를 등록해 주세요.' },
      desc: '운영 매뉴얼과 안내 자료의 주소를 등록합니다.',
      blank: { title: '', category: '기타', url: '', is_public: true },
      title: function (r) { return r.title || '(제목 없음)'; },
      meta: function (r) { return (r.category || '기타') + (r.description ? ' · ' + r.description : ''); },
      tags: function (r) { return r.is_public ? tag('공개') : badge('비공개'); },
      fields: [
        { k: 'title',       label: '자료명', wide: true, required: true,
          hint: '예: 운영 매뉴얼 · 부스 운영 안내 · 안전관리 자료 · 행사장 안내도' },
        { k: 'category',    label: '분류', hint: '예: 운영계획 · 안전' },
        { k: 'is_public',   label: '관계자에게 공개', type: 'bool' },
        { k: 'url',         label: '자료 주소(URL)', wide: true },
        { k: 'description', label: '설명', type: 'textarea', wide: true }
      ]
    },

    /* 담당자는 두 표에 나눠 담습니다.

         contacts         공개 — 로그인 없이 포털에서 읽힙니다
         contact_private  관리자 전용 — 개인 연락처 · 관리자 메모

       contact_private 는 비로그인 사용자에게 권한 자체가 없고(401),
       로그인한 사용자도 is_admin() 인 사람만 줄을 봅니다. 화면에서
       감추는 것이 아니라 데이터베이스가 막습니다. 편집 창에서도
       두 묶음을 나눠, 어느 칸이 공개되는지 입력하는 순간 보이게 합니다.

       contacts.phone 칸은 아직 표에 남아 있지만(지우기 전 호환 확인
       단계) 새로 쓰지 않습니다. 예전에 값이 들어간 담당자에게만
       그 칸이 보이고, 비워서 저장하면 다음부터는 보이지 않습니다. */
    contacts: {
      label: '운영 인력', formLabel: '담당자', table: 'contacts', addLabel: '+ 담당자 추가',
      empty: { title: '등록된 운영 인력이 없습니다.', hint: '역할별 담당자를 등록하면 포털의 운영 인력 화면과 업무 배정에 쓰입니다. 개인 번호는 관리자 전용 칸에만 적습니다.' },
      desc: '운영 담당자를 관리합니다. 개인 연락처는 관리자만 볼 수 있습니다.',
      blank: { name: '', category: '기타' },
      title: function (r) { return r.name || '(이름 없음)'; },
      // 관리자 화면이라 개인 연락처를 보여 줍니다. 관리자 로그인이 아니면
      // 이 목록에 들어올 수 없고, 값 자체가 내려오지 않습니다.
      meta: function (r) {
        var p = privateOf('contacts', r.id);
        return (r.org || '') + (p && p.phone ? (r.org ? ' · ' : '') + p.phone : '');
      },
      tags: function (r) { return tag(r.category || '기타') + (r.duty ? tag(r.duty) : '') +
        (r.is_staff ? badge('운영 인력') : '') +
        // 공개 칸에 번호가 남아 있으면 옮겨야 한다는 표시를 답니다.
        (String(r.phone || '').trim() ? badge('공개 칸 번호 정리 필요') : ''); },
      fields: [
        { type: 'group', label: '공개 정보',
          hint: '로그인 없이 포털에서 누구나 볼 수 있습니다. 개인 연락처는 여기에 적지 마세요.' },
        { k: 'name',     label: '이름', required: true },
        { k: 'org',      label: '소속' },
        // 이 두 칸이 포털 '업무 배정' 화면의 인력 집계를 만듭니다.
        // 연락망과 명부를 따로 두지 않으려고 여기에 함께 둡니다.
        { k: 'role_group', label: '역할 구분', type: 'select', keepValue: true,
          options: [['', '(없음)']].concat(opts(ROLE_GROUPS)),
          hint: '부스지원 · 전산지원처럼 이 사람이 행사에서 맡은 기본 역할' },
        { k: 'duty',     label: '담당업무', hint: '실제 담당 내용을 간단히 설명. 예: 전원·네트워크 점검' },
        { k: 'is_staff', label: '운영 인력 (업무 배정 화면에서 집계)', type: 'bool' },
        { k: 'category', label: '연락처 분류', hint: '담당자를 묶어 보는 이름. 예: 운영본부 · 협력기관 · 시설' },
        { k: 'memo',     label: '공개 메모', type: 'textarea', wide: true,
          hint: '포털에 그대로 보입니다. 관리자끼리만 볼 내용은 아래 관리자 메모에 적어 주세요' },
        /* 예전 공개 칸. 값이 남아 있는 담당자에게만 보입니다
           (legacyOnly — openEditor 참고). 새 담당자에게는 나오지 않습니다. */
        { k: 'phone',    label: '공개 칸 전화번호 (이전 값)', type: 'tel', legacyOnly: true, wide: true,
          hint: '⚠️ 이 칸은 로그인 없이 읽힙니다. 개인 번호라면 아래 “개인 연락처” 로 옮기고 이 칸은 비워 주세요' },

        { type: 'group', label: '관리자 전용 정보',
          hint: '관리자만 볼 수 있습니다. 포털과 비로그인 사용자에게는 전달되지 않습니다.' },
        { k: '__private_phone', label: '개인 연락처', type: 'tel' },
        { k: '__private_memo',  label: '관리자 메모', type: 'textarea', wide: true,
          hint: '예: 비상 연락 방법, 당일 도착 시간' }
      ],
      /* 편집 창의 관리자 전용 칸을 contact_private 한 줄과 잇습니다.
         여기 적힌 칸은 contacts 로 보내지 않고 떼어 내 따로 저장합니다
         (openEditor · syncPrivate). */
      private: {
        key: 'contact_private', parent: 'contact_id', onConflict: 'contact_id',
        map: { __private_phone: 'phone', __private_memo: 'private_memo' }
      }
    },

    /* 메뉴에는 없지만 담당자 편집 창이 씁니다. 관리자 로그인일 때만
       줄이 내려옵니다(RLS). 표가 없는 환경에서는 빈 목록이 됩니다. */
    contact_private: {
      label: '개인 연락처', table: 'contact_private', soft: true, hidden: true,
      order: [['created_at', true]],   // 이 표에는 sort_order 가 없습니다
      title: function () { return '(개인 연락처)'; },
      fields: []
    },

    venue_places: {
      label: '행사장 공간', formLabel: '공간', table: 'venue_places', addLabel: '+ 공간 추가',
      empty: { title: '등록된 주요 공간이 없습니다.', hint: '운영본부 · 안내데스크처럼 현장에서 찾는 공간을 위치가 확정되는 대로 등록해 주세요.' },
      desc: '행사장 주요 공간을 관리합니다.',
      blank: { name: '', category: '기타', detail: '' },
      title: function (r) { return r.name || '(이름 없음)'; },
      meta: function (r) { return r.detail || ''; },
      tags: function (r) { return tag(r.category || '기타'); },
      fields: [
        { k: 'name',          label: '공간 이름', required: true,
          hint: '예: 운영본부 · 안내 데스크 · 메인 무대 · 체험 부스 구역 · 휴게 공간 · 화장실 · 안전지원 공간' },
        { k: 'category',      label: '분류', hint: '예: 운영 · 안전 · 편의' },
        { k: 'detail',        label: '위치 설명', type: 'textarea', wide: true },
        { k: 'image_url',     label: '공간 사진', type: 'image', folder: 'place' },
        { k: 'image_alt',     label: '사진 설명', wide: true },
        { k: 'image_caption', label: '사진 캡션', wide: true }
      ]
    },

    /* ── 현장 운영 ─────────────────────────────────────────────
       담당자 배정과 물품 배부는 따로 메뉴를 두지 않습니다. 표가 셋으로
       나뉘어 있는 것은 데이터베이스의 사정이지, 쓰는 사람이 알아야 할
       일이 아닙니다. 업무를 만들면서 담당자를 함께 붙이고, 대상을
       만들면서 물품을 함께 적습니다. 표 구조는 그대로 씁니다. */

    operation_tasks: {
      label: '업무 배정', formLabel: '업무', table: 'operation_tasks', addLabel: '+ 업무 추가', soft: true,
      empty: { title: '등록된 운영 업무가 없습니다.', hint: '업무를 만들고 담당자를 배정하면 포털의 업무 배정 화면에 보입니다.' },
      desc: '행사 당일 업무와 담당자를 관리합니다.',
      blank: { area: '운영', title: '', start_time: '', end_time: '', status: '예정' },
      title: function (r) { return r.title || '(업무명 없음)'; },
      lead: function (r) {
        return r.start_time ? r.start_time + (r.end_time ? '–' + r.end_time : '–') : '시간 미정';
      },
      meta: function (r) {
        var who = (cache.task_assignments || []).filter(function (a) { return a.task_id === r.id; })
          .map(assignName).filter(Boolean);
        return (r.place || '장소 미정') + ' · ' +
          (who.length ? who.join(', ') : '담당자 미배정');
      },
      tags: function (r) { return badge(r.status || '예정') + tag(r.area || '기타'); },
      groupBy: function (r) { return r.area || '기타'; },
      fields: [
        { type: 'group', label: '업무' },
        { k: 'area',        label: '업무 분야', required: true,
          hint: '업무를 묶는 분야. 예: 기념식 · 부스 운영 · 안전' },
        { k: 'title',       label: '업무명', wide: true, required: true },
        { k: 'start_time',  label: '시작시간', type: 'time' },
        { k: 'end_time',    label: '종료시간', type: 'time' },
        { k: 'place',       label: '장소', wide: true },
        // 포털에서는 예정 → 진행 중 → 완료 한 방향으로만 갑니다.
        // 되돌리는 것은 여기서만 할 수 있습니다.
        { k: 'status',      label: '진행 상태', type: 'select', options: opts(TASK_STATES) },

        { type: 'group', label: '담당자' },
        { k: '__assigns', type: 'rows', label: '배정된 담당자',
          addLabel: '+ 담당자 추가', emptyText: '아직 배정된 담당자가 없습니다.',
          hint: '운영 인력에서 고르거나, 없으면 이름을 직접 적습니다. 역할은 이 업무에서 맡은 몫으로, 운영 인력의 역할 구분과 다릅니다',
          cols: [],   // 연락망 목록이 있어야 만들 수 있어 fieldsFor 에서 채웁니다
          blank: { contact_id: '', person_name: '', role: '' } },

        { type: 'group', label: '상세 설정', fold: true },
        { k: 'description', label: '업무 설명', type: 'textarea', wide: true,
          hint: '줄바꿈은 포털에서도 그대로 보입니다' }
      ],
      /* 딸린 줄(담당자)을 부모와 같은 창에서 다룹니다. */
      children: {
        key: 'task_assignments', parent: 'task_id', field: '__assigns',
        toRow: function (a) {
          return { contact_id: a.contact_id || '', person_name: a.person_name || '',
                   person_org: a.person_org || '', role: a.role || '' };
        },
        fromRow: function (r) {
          return { contact_id: r.contact_id || null, person_name: r.person_name || '',
                   person_org: r.person_org || '', role: r.role || '' };
        },
        // 사람을 가리키지 않는 빈 줄은 저장하지 않습니다.
        keep: function (r) { return !!(r.contact_id || (r.person_name || '').trim()); }
      }
    },

    /* 메뉴에는 없지만 표와 데이터는 그대로입니다. 담당 업무 창이
       이 항목의 정의를 빌려 씁니다. */
    task_assignments: {
      label: '담당자 배정', table: 'task_assignments', soft: true, hidden: true,
      title: function (r) { return assignName(r) || '(담당자)'; },
      fields: []
    },

    supplies: {
      label: '운영 물품', virtual: true,
      desc: '기관·팀·부스별 물품 배부를 관리합니다.',
      tabs: [
        { key: 'supply_targets', label: '배부 현황' },
        { key: 'supply_items',   label: '물품 설정' }
      ]
    },

    supply_targets: {
      label: '배부 현황', formLabel: '배부 대상', table: 'supply_targets', addLabel: '+ 대상 추가', soft: true,
      empty: { title: '등록된 배부 대상이 없습니다.', hint: '기관 · 팀 · 부스별로 받을 물품과 수량을 등록해 주세요. 물품 종류는 “물품 설정” 탭에서 먼저 만듭니다.' },
      hidden: true, parentMenu: 'supplies',
      desc: '기관·팀·부스별 물품 배부를 관리합니다.',
      blank: { name: '', kind: '팀', status: '미배부', headcount: 0 },
      title: function (r) { return r.name || '(대상명 없음)'; },
      meta: function (r) {
        return (r.kind || '팀') +
          (r.manager ? ' · 배부 담당 ' + r.manager : '') +
          (r.headcount ? ' · ' + r.headcount + '명' : '') + '<br />' +
          allocLine(r.id);
      },
      metaHtml: true,
      tags: function (r) { return badge(r.status || '미배부'); },
      /* 목록 위 요약과 걸러 보기. 배부는 "누가 아직 못 받았나" 를
         찾는 일이라 상태로 거르는 것이 가장 자주 쓰입니다. */
      summary: function (rows) {
        var by = {};
        SUPPLY_STATES.forEach(function (st) {
          by[st] = rows.filter(function (r) { return r.status === st; }).length;
        });
        // 카드를 누르면 그 상태만 봅니다(예전 상태 칩 줄은 같은 숫자를 반복해 뺐습니다).
        return [
          { n: rows.length, l: '전체 대상', all: true },
          { n: by['미배부'], l: '미배부', tone: 'warn', status: '미배부' },
          { n: by['일부 배부'], l: '일부 배부', tone: 'info', status: '일부 배부' },
          { n: by['배부 완료'], l: '배부 완료', tone: 'ok', status: '배부 완료' }
        ];
      },
      statuses: SUPPLY_STATES,
      statusKey: 'status',
      searchPlaceholder: '대상 · 담당자 · 물품 검색',
      searchPlaceholderShort: '대상 검색',
      searchText: function (r) {
        return r.name + ' ' + (r.manager || '') + ' ' + (r.kind || '') + ' ' +
          allocNames(r.id).join(' ');
      },
      fields: [
        { type: 'group', label: '대상' },
        { k: 'name',      label: '대상 이름', wide: true, required: true },
        { k: 'kind',      label: '구분', type: 'select', options: opts(SUPPLY_KINDS) },
        { k: 'status',    label: '배부 상태', type: 'select', options: opts(SUPPLY_STATES) },
        { k: 'manager',   label: '배부 담당', hint: '이 대상에 물품을 전달할 사람 또는 팀' },
        { k: 'headcount', label: '인원', type: 'number' },

        { type: 'group', label: '배부 물품' },
        { k: '__allocs', type: 'rows', label: '물품과 수량',
          addLabel: '+ 물품 추가', emptyText: '아직 등록된 물품이 없습니다.',
          hint: '물품 종류는 “물품 설정” 탭에서 추가합니다',
          cols: [], blank: { item_id: '', qty: 0 } },

        { type: 'group', label: '상세 설정', fold: true },
        { k: 'memo',      label: '메모', type: 'textarea', wide: true }
      ],
      children: {
        key: 'supply_allocations', parent: 'target_id', field: '__allocs',
        toRow: function (a) { return { item_id: a.item_id || '', qty: a.qty || 0 }; },
        fromRow: function (r) { return { item_id: r.item_id, qty: r.qty || 0 }; },
        keep: function (r) { return !!r.item_id; }
      }
    },

    supply_items: {
      label: '물품 설정', formLabel: '물품', table: 'supply_items', addLabel: '+ 물품 추가', soft: true,
      empty: { title: '등록된 물품이 없습니다.', hint: '명찰 · 식권 · 생수처럼 배부할 물품 종류를 먼저 만들어 주세요.' },
      hidden: true, parentMenu: 'supplies',
      desc: '배부할 물품의 종류를 관리합니다.',
      blank: { name: '', unit: '개', category: '기타' },
      title: function (r) { return r.name || '(물품명 없음)'; },
      meta: function (r) {
        var used = (cache.supply_allocations || []).filter(function (a) { return a.item_id === r.id; });
        var sum = used.reduce(function (n, a) { return n + (a.qty || 0); }, 0);
        return '단위 ' + (r.unit || '개') + ' · ' + used.length + '곳 배부 · 합계 ' + sum;
      },
      tags: function (r) { return tag(r.category || '기타'); },
      fields: [
        { k: 'name',     label: '물품명', wide: true, required: true,
          hint: '예: 명찰 · 식권 · 생수 · 운영키트' },
        { k: 'unit',     label: '단위', hint: '예: 개 · 장 · 박스' },
        { k: 'category', label: '분류', hint: '예: 운영 · 식음 · 홍보' },
        { k: 'memo',     label: '메모', type: 'textarea', wide: true }
      ]
    },

    supply_allocations: {
      label: '물품 배부', table: 'supply_allocations', soft: true, hidden: true,
      title: function (r) { return '(물품 배부)'; },
      fields: []
    },

    faqs: {
      label: 'FAQ', formLabel: '질문', table: 'faqs', addLabel: '+ 질문 추가',
      empty: { title: '등록된 질문이 없습니다.', hint: '현장에서 자주 받는 질문과 답을 등록하고 공개를 켜 주세요.' },
      desc: '자주 확인하는 질문과 답변을 관리합니다.',
      blank: { question: '', answer: '', category: '기타', is_public: false },
      title: function (r) { return r.question || '(질문 없음)'; },
      meta: function (r) { return (r.answer || '').slice(0, 70); },
      tags: function (r) {
        return tag(r.category || '기타') +
          (r.answer && r.answer.trim() ? '' : badge('답변 없음')) +
          (r.is_public ? '' : badge('비공개'));
      },
      fields: [
        { k: 'question',  label: '질문', wide: true, required: true },
        { k: 'answer',    label: '답변', type: 'textarea', wide: true,
          hint: '줄바꿈은 포털에서도 그대로 보입니다' },
        { k: 'category',  label: '분류', type: 'select', options: opts(FAQ_CATS) },
        { k: 'is_public', label: '공개 (답변을 채운 뒤 켜 주세요)', type: 'bool' }
      ]
    }
  };

  /* 메뉴는 표 단위가 아니라 일 단위로 묶습니다. 담당자 배정·물품
     종류·배부 같은 이름은 데이터베이스의 사정이라, 쓰는 사람이
     고를 메뉴로 세우지 않습니다(표와 데이터는 그대로입니다).
     hidden 인 항목은 메뉴에 없지만 불러오기·편집 정의는 살아 있어
     통합 화면이 그대로 빌려 씁니다. */
  var ORDER = ['overview', 'settings', 'schedule_items', 'booths', 'zones', 'venue_places', 'notices',
               'operation_requests', 'operation_tasks', 'supplies',
               'contacts', 'resources', 'faqs',
               // 아래는 메뉴에 없지만 데이터는 함께 불러옵니다.
               'task_assignments', 'supply_targets', 'supply_items', 'supply_allocations',
               'contact_private', 'booth_private'];
  var GROUPS = [
    { label: '', keys: ['overview'] },
    { label: '행사 관리', keys: ['settings', 'schedule_items', 'booths', 'zones', 'venue_places'] },
    { label: '현장 운영', keys: ['notices', 'operation_requests', 'operation_tasks', 'supplies'] },
    { label: '정보 관리', keys: ['contacts', 'resources', 'faqs'] }
  ];
  var TABS = ['overview', 'schedule_items', 'booths', 'notices', 'operation_requests'];

  /* 지금 보고 있는 통합 화면의 내부 탭. */
  var subTab = { supplies: 'supply_targets' };
  /* 목록·추가·수정이 실제로 다룰 항목. 통합 화면이면 내부 탭입니다. */
  function listKey() {
    var e = ENTITIES[current];
    return (e && e.virtual) ? subTab[current] : current;
  }
  /* 목록 검색 · 걸러 보기 상태. 다른 화면으로 옮기면 지웁니다. */
  var listQ = '', listStatus = '전체', listF = {};
  // 휴대폰의 걸러 보기 패널이 열려 있나. 다른 화면으로 옮기면 닫습니다.
  var listSheet = false;

  /* ── 알림 ───────────────────────────────────────────────────── */
  var toastTimer;
  function toast(msg, isError) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('is-error', !!isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, isError ? 6000 : 2400);
  }

  /* ── 내비 ───────────────────────────────────────────────────── */
  // 행사 당일 콘솔(booth-admin.html). 정보 설정을 하는 이 화면과 따로 된 페이지라 메뉴 끝에 링크로만 둡니다.
  function liveNavHtml(cls) {
    return '<p class="' + cls + '__group">행사 당일</p>' +
      '<a href="booth-admin.html' + (DEMO ? '?demo=1' : '') + '">부스 운영 현황</a>';
  }
  function paintNav() {
    function n(k) {
      var e = ENTITIES[k];
      if (!e || e.dashboard || e.single) return '';
      // 통합 화면은 대표가 되는 표의 건수를 보여 줍니다.
      var src = e.virtual ? e.tabs[0].key : k;
      return '<span class="nav__badge" style="background:var(--bg-sink);color:var(--muted)">' +
        (cache[src] || []).length + '</span>';
    }
    function link(k) {
      return '<a href="#' + k + '" class="' + (k === current ? 'is-on' : '') + '"' +
        (k === current ? ' aria-current="page"' : '') + '>' + esc(ENTITIES[k].label) + n(k) + '</a>';
    }
    /* 관리 항목이 늘어 한 줄로 세우면 무엇이 무엇인지 알기 어렵습니다.
       하는 일끼리 묶고 제목을 답니다. 예시 모드는 부스 · 구역만 둡니다. */
    var groups = DEMO ? [{ label: '협의용 예시', keys: DEMO_KEYS }] : GROUPS;
    var tabs = DEMO ? DEMO_KEYS : TABS;
    $('#sidenav').innerHTML = groups.map(function (g) {
      var keys = g.keys.filter(function (k) { return ENTITIES[k] && !ENTITIES[k].hidden; });
      if (!keys.length) return '';
      return (g.label ? '<p class="side__group">' + esc(g.label) + '</p>' : '') +
        keys.map(link).join('');
    }).join('') + liveNavHtml('side');

    var short = { overview: '요약', schedule_items: '일정', booths: '부스', zones: '구역', notices: '공지', operation_requests: '요청' };
    $('#tabbar').innerHTML = tabs.map(function (k) {
      return '<a href="#' + k + '" class="' + (k === current ? 'is-on' : '') + '">' +
        '<span class="tab__dot">' + esc(short[k].charAt(0)) + '</span><span>' + esc(short[k]) + '</span></a>';
    }).join('') + '<button type="button" data-open-sheet><span class="tab__dot">⋯</span><span>더보기</span></button>';

    $('#sheetnav').innerHTML = groups.map(function (g) {
      var keys = g.keys.filter(function (k) {
        return tabs.indexOf(k) < 0 && ENTITIES[k] && !ENTITIES[k].hidden;
      });
      if (!keys.length) return '';
      return (g.label ? '<p class="sheet__group">' + esc(g.label) + '</p>' : '') +
        keys.map(function (k) {
          return '<a href="#' + k + '" class="' + (k === current ? 'is-on' : '') + '">' +
            esc(ENTITIES[k].label) + '</a>';
        }).join('');
    }).join('') + liveNavHtml('sheet');

    var me = C.me() || {};
    $('#side-who').innerHTML = esc(me.name || me.email || '') + '<br /><span class="badge badge--plain">관리자</span>';
    $('#sheet-who').textContent = (me.name || me.email || '') + ' · 관리자';
    $('#topbar-title').textContent = ENTITIES[current].label;
    document.title = (DEMO ? '협의용 예시 · ' : '') + ENTITIES[current].label + ' · 관리자';
  }

  /* ── 대시보드 ───────────────────────────────────────────────── */
  function renderOverview() {
    var reqs = cache.operation_requests || [];
    var openReq = reqs.filter(function (r) { return r.status !== '완료'; });
    var urgentReq = openReq.filter(function (r) { return r.priority === '긴급'; }).length;
    var leftTasks = (cache.operation_tasks || []).filter(function (t) { return (t.status || '예정') !== '완료'; }).length;
    var leftSupply = (cache.supply_targets || []).filter(function (t) { return t.status !== '배부 완료'; }).length;
    var urgentNotice = (cache.notices || []).filter(function (x) { return x.level === '긴급'; }).length;
    var nSched = (cache.schedule_items || []).length, nBooth = (cache.booths || []).length;
    // 포털 · 관람객 화면은 '공개' 부스만 봅니다. 등록만 하고 공개하지 않았으면 예시가 그대로 보입니다.
    var nShown = (cache.booths || []).filter(boothShown).length;
    var nUnassigned = (cache.booths || []).filter(function (b) { return !hasSlot(b); }).length;

    /* 관리자 대시보드는 전시장이 아니라 출발점입니다.
         1. 지금 손봐야 할 것(요청 · 업무 · 배부 · 긴급 공지) — 숫자가 있으면 색이 붙습니다
         2. 등록 현황(일정 · 부스 · 공지 · 운영 인력) — 한 줄 요약
         3. 자주 하는 일 단추
       일정 · 부스가 0건이면 공개 포털이 협의용 예시를 보여 주는 중이라는
       것을 함께 적어 둡니다 — 실제 등록을 시작하면 예시가 사라진다는 뜻입니다. */
    var act = [
      { n: openReq.length, l: '미처리 운영 요청', go: 'operation_requests',
        sub: urgentReq ? '긴급 ' + urgentReq + '건 포함' : (openReq.length ? '확인이 필요합니다' : '모두 처리됨'),
        tone: urgentReq ? 'danger' : openReq.length ? 'warn' : null },
      { n: leftTasks, l: '미완료 업무', go: 'operation_tasks',
        sub: (cache.operation_tasks || []).length ? '예정 · 진행 중' : '등록된 업무 없음', tone: leftTasks ? 'warn' : null },
      { n: leftSupply, l: '배부 확인 필요', go: 'supplies',
        sub: (cache.supply_targets || []).length ? '배부 완료 전' : '등록된 대상 없음', tone: leftSupply ? 'warn' : null },
      { n: urgentNotice, l: '긴급 공지', go: 'notices',
        sub: urgentNotice ? '포털 맨 위에 보이는 중' : '없음', tone: urgentNotice ? 'danger' : null }
    ];
    var reg = [
      { n: nSched, l: '일정', go: 'schedule_items', sub: nSched ? '' : '포털에 협의용 예시 표시 중' },
      { n: nBooth, l: '부스', go: 'booths',
        sub: !nBooth ? '포털에 협의용 예시 표시 중'
          : '공개 ' + nShown + '곳' + (nUnassigned ? ' · 미배정 ' + nUnassigned + '곳' : '') +
            (nShown ? '' : ' · 포털에 협의용 예시 표시 중') },
      { n: (cache.notices || []).length, l: '공지', go: 'notices' },
      { n: (cache.contacts || []).length, l: '운영 인력', go: 'contacts' }
    ];
    var quick = [
      { l: '+ 일정 추가', go: 'schedule_items', add: true },
      // 구역이 아직 없어도 부스는 미배정으로 먼저 등록할 수 있습니다.
      { l: '+ 부스 추가', go: 'booths', add: true },
      { l: '+ 공지 작성', go: 'notices', add: true },
      { l: '운영 요청 확인', go: 'operation_requests' }
    ];
    return '<div class="page"><div class="page__head"><div>' +
      '<h1 class="page__title">관리자</h1>' +
      '<p class="page__desc">바꾼 내용은 관계자 포털에 바로 반영됩니다.</p></div></div>' +
      '<section class="ovsec" aria-labelledby="ov-act"><h2 class="fgroup__t" id="ov-act">지금 확인할 일</h2>' +
      '<div class="statgrid statgrid--4">' + act.map(function (c) {
        return '<button class="adminstat' + (c.tone ? ' adminstat--' + c.tone : '') +
          '" type="button" data-go="' + c.go + '">' +
          '<span class="adminstat__n">' + c.n + '</span>' +
          '<span class="adminstat__l">' + esc(c.l) + '</span>' +
          '<span class="adminstat__sub">' + esc(c.sub) + '</span></button>';
      }).join('') + '</div></section>' +
      '<section class="ovsec" aria-labelledby="ov-reg"><h2 class="fgroup__t" id="ov-reg">등록 현황</h2>' +
      '<div class="regline">' + reg.map(function (c) {
        return '<button class="regitem" type="button" data-go="' + c.go + '">' +
          '<span class="regitem__l">' + esc(c.l) + '</span><b class="regitem__n">' + c.n + '</b>' +
          (c.sub ? '<span class="regitem__sub">' + esc(c.sub) + '</span>' : '') + '</button>';
      }).join('') + '</div></section>' +
      '<section class="qbox"><h2 class="fgroup__t">빠른 관리</h2>' +
      '<div class="qrow">' + quick.map(function (q) {
        return '<button class="btn ' + (q.add ? 'btn--primary' : 'btn--ghost') + '" type="button" ' +
          'data-go="' + q.go + '"' + (q.add ? ' data-goadd="1"' : '') + '>' + esc(q.l) + '</button>';
      }).join('') + '</div></section></div>';
  }

  /* ── 목록 ─────────────────────────────────────────────────────
     관리자 목록은 오래 읽는 화면이 아니라 찾아서 고치는 화면입니다.
     카드처럼 띄우지 않고 줄로 세웁니다 — 줄이면 눈이 왼쪽 한 줄만
     따라 내려가면 되고, 카드면 매번 사각형 안을 훑어야 합니다.
     자주 쓰는 '수정'은 바로 두고, 삭제와 순서는 '⋯' 안에 둡니다.

     항목 정의에 둘 수 있는 것(모두 선택):
       searchText(r) · searchPlaceholder   검색
       filters [{ key, label, kind: 'chips'|'select', options(all), test(r, v) }]
       statuses · statusKey                예전 방식의 상태 칩(배부 현황)
       sort(a, b) · groupBy(r)             정렬 · 묶음 제목
       noReorder                           ↑ · ↓ 를 두지 않음(시각 · 번호 순 목록)
       empty | empty()                     { title, hint, go: [화면, 단추 글자] } */
  /* 지금 걸려 있는 조건이 있나(검색 · 상태 칩 · 걸러 보기 · 요약 카드). '필터 초기화' 를 보일지 정합니다. */
  function listActive() {
    return !!listQ.trim() || listStatus !== '전체' || Object.keys(listF).some(function (k) { return !!listF[k]; });
  }
  /* 패널(구역 · 고르기 상자)에서 고른 수. 휴대폰의 '필터 n' 단추에 씁니다. */
  function panelCount(listEnt) {
    return (listEnt.filters || []).filter(function (f) { return f.kind !== 'summary' && !f.inline && !!listF[f.key]; }).length;
  }
  function narrowScreen() {
    try { return window.matchMedia('(max-width: 680px)').matches; } catch (e) { return false; }
  }
  function placeholderOf(listEnt) {
    return (narrowScreen() && listEnt.searchPlaceholderShort) || listEnt.searchPlaceholder || '검색';
  }
  /* 검색칸 안내 글을 칸의 실제 폭에 맞춥니다. 긴 글이 잘려 '… 프로' 로 끝나느니 짧게('부스 검색').
     찾는 대상은 같습니다. 그린 뒤 · 창 폭이 바뀔 때 부릅니다. */
  var phObserver = null;
  function fitOne(q) {
    var long = q.dataset.ph || q.placeholder;
    q.placeholder = q.clientWidth && q.clientWidth < long.length * 12 + 48 ? q.dataset.phShort : long;
  }
  function fitPlaceholder() {
    var q = $('#list-q');
    if (!q || !q.dataset.phShort) return;
    fitOne(q);
    // 칸 폭이 바뀔 때마다(창 크기 · 화면 회전 · 사이드바) 다시 맞춥니다.
    if (window.ResizeObserver) {
      if (!phObserver) phObserver = new ResizeObserver(function (es) { es.forEach(function (e) { fitOne(e.target); }); });
      phObserver.disconnect();
      phObserver.observe(q);
    }
  }
  /* 요약 카드가 상태 칩(statuses)을 대신하면 칩 줄을 두지 않습니다(같은 숫자를 두 번 보이지 않게). */
  function summaryCoversStatus(listEnt, all) {
    return !!(listEnt.summary && all.length && listEnt.summary(all).some(function (c) { return c.status; }));
  }

  /* 검색 · 걸러 보기 줄.
       데스크톱  (구역 칩 한 줄) → [검색][구역 ▾][기관 유형 ▾][상태 ▾]…[필터 초기화]
       휴대폰    [검색][필터 n] — 누르면 아래에서 올라오는 패널에 같은 칸이 들어 있습니다
                 (고를 칸이 셋 이상인 목록만. 적으면 지금처럼 한 줄에 둡니다)
     칩의 '전체' 에는 숫자를 붙이지 않습니다 — 전체 수는 요약 카드와 결과 줄이 이미 말합니다.
     칩이 maxChips 보다 많아지면(구역이 늘어나는 등) 고르기 상자로 바꿉니다.
     kind 'summary' 인 걸러 보기는 여기 그리지 않고 위의 요약 카드가 맡습니다.
     inline 인 걸러 보기(일정의 날짜)는 휴대폰에서도 패널에 넣지 않고 늘 보입니다. */
  function filterHtml(listEnt, all) {
    var inlineRows = '', panelRows = '', selects = '', nPanel = 0;
    function chipRow(f, options, cur) {
      return '<div class="filterrow"><span class="filterrow__l">' + esc(f.label) + '</span>' +
        '<div class="chiprow" role="group" aria-label="' + esc(f.label) + '">' +
        [['', '전체']].concat(options).map(function (o) {
          var on = cur === o[0];
          var n = o[0] === '' ? null : all.filter(function (r) { return f.test(r, o[0]); }).length;
          // o[2] 는 칩에 쓰는 짧은 글자(구역 'A'). 긴 이름은 고르기 상자와 마우스를 올렸을 때 보입니다.
          return '<button class="chip' + (on ? ' is-on' : '') + '" type="button" data-listf="' + esc(f.key) + '" ' +
            'data-v="' + esc(o[0]) + '" aria-pressed="' + on + '"' +
            (o[2] ? ' title="' + esc(o[1]) + '" aria-label="' + esc(o[1] + (n === null ? '' : ' ' + n)) + '"' : '') + '>' +
            esc(o[2] || o[1]) + (n === null ? '' : '<span class="chip__n">' + n + '</span>') + '</button>';
        }).join('') + '</div></div>';
    }
    function selectHtml(f, options, cur) {
      return '<label class="listsel"><span class="listsel__l">' + esc(f.label) + '</span>' +
        '<select class="select select--sm' + (cur ? ' is-set' : '') + '" data-listf="' + esc(f.key) + '">' +
        '<option value="">' + esc(f.label) + ' 전체</option>' +
        options.map(function (o) {
          return '<option value="' + esc(o[0]) + '"' + (cur === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
        }).join('') + '</select></label>';
    }
    (listEnt.filters || []).forEach(function (f) {
      if (f.kind === 'summary') return;
      var options = f.options(all);
      if (!options.length) return;
      var cur = listF[f.key] || '';
      var asChips = f.kind === 'chips' && !(f.maxChips && options.length > f.maxChips);
      if (asChips) {
        // 고를 것이 하나뿐이면(예: 구역 하나) 칩 줄을 두지 않습니다.
        if (options.length < 2 && !cur) return;
        if (f.inline) inlineRows += chipRow(f, options, cur);
        else { panelRows += chipRow(f, options, cur); nPanel++; }
      } else {
        selects += selectHtml(f, options, cur);
        nPanel++;
      }
    });
    var search = listEnt.searchText
      ? '<div class="search ftools__search"><label class="sr-only" for="list-q">검색</label>' +
        '<input class="input" id="list-q" type="search" placeholder="' + esc(placeholderOf(listEnt)) + '" ' +
        'data-ph="' + esc(listEnt.searchPlaceholder || '검색') + '" data-ph-short="' + esc(listEnt.searchPlaceholderShort || '') + '" ' +
        'value="' + esc(listQ) + '" /></div>'
      : '';
    var statusChips = listEnt.statuses && !summaryCoversStatus(listEnt, all)
      ? '<div class="chiprow" role="group">' + ['전체'].concat(listEnt.statuses).map(function (st) {
          var n = st === '전체' ? null : all.filter(function (r) { return r[listEnt.statusKey] === st; }).length;
          return '<button class="chip' + (listStatus === st ? ' is-on' : '') + '" type="button" ' +
            'data-liststatus="' + esc(st) + '" aria-pressed="' + (listStatus === st) + '">' +
            esc(st) + (n === null ? '' : '<span class="chip__n">' + n + '</span>') + '</button>';
        }).join('') + '</div>'
      : '';
    if (!inlineRows && !panelRows && !selects && !search && !statusChips) return '';

    // 고를 칸이 셋 이상이면 휴대폰에서 패널로 접습니다(CSS 가 좁은 화면에서만 접음).
    var sheet = nPanel >= 3;
    var open = sheet && listSheet;
    var n = panelCount(listEnt);
    var active = listActive();
    var panel = (panelRows || selects)
      ? '<div class="ftools__panel" id="list-fpanel">' +
          '<div class="ftools__scrim" data-fclose></div>' +
          '<div class="ftools__sheet"' + (open ? ' role="dialog" aria-modal="true" aria-labelledby="list-fpanel-t"' : '') + '>' +
            '<div class="ftools__head"><h2 class="ftools__title" id="list-fpanel-t">필터</h2>' +
              '<button class="iconbtn" type="button" data-fclose aria-label="필터 닫기">✕</button></div>' +
            panelRows +
            (selects ? '<div class="ftools__sels">' + selects + '</div>' : '') +
            '<div class="ftools__foot">' +
              '<button class="btn btn--ghost" type="button" data-listreset' + (active ? '' : ' disabled') + '>초기화</button>' +
              '<button class="btn btn--primary" type="button" data-fclose>결과 보기</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      : '';
    return '<div class="tools listtools ftools' + (sheet ? ' ftools--sheet' : '') + '" data-open="' + (open ? '1' : '0') + '">' +
      inlineRows + statusChips + search +
      (sheet ? '<button class="btn btn--ghost ftools__open' + (n ? ' is-set' : '') + '" type="button" data-fopen ' +
        'aria-expanded="' + open + '" aria-controls="list-fpanel">필터' + (n ? '<span class="ftools__n">' + n + '</span>' : '') + '</button>' : '') +
      panel +
      (active ? '<button class="btn btn--ghost btn--sm ftools__reset" type="button" data-listreset>필터 초기화</button>' : '') +
      '</div>';
  }

  function emptyState(ent) {
    var e = typeof ent.empty === 'function' ? ent.empty() : (ent.empty || {});
    var title = e.title || '아직 등록된 항목이 없습니다.';
    var hint = e.hint || '등록하면 관계자 포털에 바로 반영됩니다.';
    var btn = e.go
      ? '<button class="btn btn--primary btn--sm" type="button" data-go="' + esc(e.go[0]) + '" data-goadd="1">' + esc(e.go[1]) + '</button>'
      : (ent.addLabel ? '<button class="btn btn--primary btn--sm" type="button" data-add>' + esc(e.addText || ent.addLabel) + '</button>' : '');
    // 두 번째 길(예: 협의용 예시 화면). 등록 단추 아래에 한 단계 낮춰 둡니다.
    var alt = e.alt
      ? '<div class="state__alt"><p class="state__altlead">' + esc(e.alt.lead) + '</p>' +
        '<a class="btn btn--ghost btn--sm" href="' + esc(e.alt.href) + '">' + esc(e.alt.label) + '</a></div>'
      : '';
    return '<div class="state state--empty">' +
      '<span class="state__icon">' + ICON_EMPTY + '</span>' +
      '<p class="state__title">' + esc(title) + '</p>' +
      '<p class="state__hint">' + esc(hint) + '</p>' +
      (btn ? '<div class="state__act">' + btn + '</div>' : '') + alt + '</div>';
  }

  function renderPanel() {
    var ent = ENTITIES[current], host = $('#view');

    if (ent.dashboard) { host.innerHTML = renderOverview(); paintNav(); return; }

    /* 통합 화면이면 안쪽 탭을 먼저 그리고, 목록은 그 탭의 항목으로 */
    var key = listKey(), listEnt = ENTITIES[key];

    var tabsHtml = ent.virtual
      ? '<div class="subtabs" role="tablist">' + ent.tabs.map(function (t) {
          var on = subTab[current] === t.key;
          return '<button class="subtab' + (on ? ' is-on' : '') + '" type="button" role="tab" ' +
            'aria-selected="' + on + '" data-subtab="' + esc(t.key) + '">' + esc(t.label) +
            '<span class="subtab__n">' + (cache[t.key] || []).length + '</span></button>';
        }).join('') + '</div>'
      : '';

    var head = '<div class="page__head"><div><h1 class="page__title">' + esc(ent.label) + '</h1>' +
      '<p class="page__desc">' + esc(descOf(ent.desc || listEnt.desc)) + '</p></div>' +
      (ent.single ? '' : '<div class="page__actions">' +
        (listEnt.liveLink ? '<a class="btn btn--ghost btn--sm" href="' + esc(listEnt.liveLink[0] + (DEMO ? '?demo=1' : '')) +
          '">' + esc(listEnt.liveLink[1]) + '</a>' : '') +
        // 예시 모드에서는 실제 인쇄 화면(실제 열쇠)으로 가는 단추를 두지 않습니다.
        (listEnt.headLink && !DEMO ? '<a class="btn btn--ghost btn--sm" href="' + esc(listEnt.headLink[0]) +
          '" target="_blank" rel="noopener">' + esc(listEnt.headLink[1]) + '</a>' : '') +
        '<button class="btn btn--primary btn--sm" type="button" data-add>' +
        esc(listEnt.addLabel || '+ 새로 추가') + '</button></div>') + '</div>' +
      (DEMO ? '<p class="demohint">' + esc(DEMO_SAVE_NOTE) + ' QR 발급 · 대기 입력도 이 화면 안에서만 바뀌고, ' +
        '새로 고치면 처음 예시로 돌아갑니다.</p>' : '');

    if (ent.single) { renderSingle(ent, head, host); return; }

    var all = cache[key] || [];

    /* 요약 숫자 — 정의한 항목에서만. 카드가 걸러 보기를 겸합니다.
         { all: true }        누르면 요약이 거는 조건을 모두 풉니다('전체')
         { f: [키, 값] }      그 걸러 보기(kind 'summary' 등)를 켜고, 다시 누르면 끕니다
         { status: '미배부' } 예전 방식의 상태 칩(statuses)을 대신합니다
       고른 카드는 보라색(관리 UI 색)으로 둡니다. 숫자 색(상태색)과 섞지 않습니다. */
    var sumHtml = '';
    if (listEnt.summary && all.length) {
      var sums = listEnt.summary(all);
      var sumKeys = sums.filter(function (c) { return c.f; }).map(function (c) { return c.f[0]; });
      var sumOn = function (c) {
        if (c.all) return listStatus === '전체' && sumKeys.every(function (k) { return !listF[k]; });
        if (c.status) return listStatus === c.status;
        if (c.f) return listF[c.f[0]] === c.f[1];
        return false;
      };
      sumHtml = '<div class="minigrid sumgrid sumgrid--' + sums.length + '" role="group" aria-label="요약 · 걸러 보기">' + sums.map(function (c) {
        var cls = 'mini' + (c.tone ? ' mini--' + c.tone : '') + (c.n ? '' : ' is-zero');
        if (!c.all && !c.status && !c.f) {
          return '<div class="' + cls + '"><span class="mini__n">' + c.n + '</span><span class="mini__l">' + esc(c.l) + '</span></div>';
        }
        var on = sumOn(c);
        var data = c.all ? 'data-sumall' : (c.status ? 'data-sumstatus="' + esc(c.status) + '"'
          : 'data-sumf="' + esc(c.f[0]) + '" data-v="' + esc(c.f[1]) + '"');
        return '<button class="' + cls + ' mini--btn' + (on ? ' is-on' : '') + '" type="button" ' + data +
          ' aria-pressed="' + on + '"><span class="mini__n">' + c.n + '</span><span class="mini__l">' + esc(c.l) + '</span></button>';
      }).join('') + '</div>';
    }

    if (!all.length) {
      host.innerHTML = '<div class="page">' + head + tabsHtml + emptyState(listEnt) + '</div>';
      paintNav(); return;
    }

    /* 걸러 보기 · 검색 · 정렬. 화면에서만 거르고 순서를 바꿉니다 —
       cache 의 순서(sort_order)는 그대로라 ↑ · ↓ 가 엉키지 않습니다. */
    var q = listQ.trim().toLowerCase();
    var rows = all.filter(function (r) {
      if (listEnt.statuses && listStatus !== '전체' && r[listEnt.statusKey] !== listStatus) return false;
      var ok = (listEnt.filters || []).every(function (f) {
        var v = listF[f.key];
        return !v || f.test(r, v);
      });
      if (!ok) return false;
      if (!q || !listEnt.searchText) return true;
      return listEnt.searchText(r).toLowerCase().indexOf(q) >= 0;
    });
    if (listEnt.sort) rows = rows.slice().sort(listEnt.sort);
    var toolsHtml = filterHtml(listEnt, all);
    var filtered = listActive();
    // 휴대폰에서는 '필터 초기화' 단추 대신 결과 줄 끝의 '초기화' 로 풉니다(CSS 가 하나만 보이게).
    var countHtml = '<p class="resultline">' + (filtered ? '전체 ' + all.length + '건 중 <b>' + rows.length + '건</b>'
      : '전체 ' + all.length + '건') +
      (filtered ? ' <button class="linkreset" type="button" data-listreset>초기화</button>' : '') + '</p>';

    if (!rows.length) {
      host.innerHTML = '<div class="page">' + head + tabsHtml + sumHtml + toolsHtml +
        '<div class="state state--empty"><span class="state__icon">' + ICON_EMPTY + '</span>' +
        '<p class="state__title">조건에 맞는 항목이 없습니다.</p>' +
        '<p class="state__hint">검색어나 걸러 보기를 바꿔 보세요.</p>' +
        '<div class="state__act"><button class="btn btn--ghost btn--sm" type="button" data-listreset>조건 지우기</button></div></div></div>';
      fitPlaceholder();
      paintNav(); return;
    }

    /* 날짜 · 구역처럼 묶어 보여 주는 항목은 제목을 사이에 끼웁니다.
       카드 안에 카드를 넣지 않고 줄 사이에 제목만 둡니다. */
    var body = '';
    if (listEnt.groupBy) {
      var groups = [], seen = {};
      rows.forEach(function (r) {
        var g = listEnt.groupBy(r);
        if (!seen[g]) { seen[g] = { label: g, items: [] }; groups.push(seen[g]); }
        seen[g].items.push(r);
      });
      body = groups.map(function (g) {
        return '<h2 class="listgroup">' + esc(g.label) +
          '<span class="listgroup__n">' + g.items.length + '</span></h2>' +
          '<div class="list">' + g.items.map(function (r) {
            return listRow(listEnt, r, all.indexOf(r), all.length);
          }).join('') + '</div>';
      }).join('');
    } else {
      body = '<div class="list">' + rows.map(function (r) {
        return listRow(listEnt, r, all.indexOf(r), all.length);
      }).join('') + '</div>';
    }

    host.innerHTML = '<div class="page">' + head + tabsHtml + sumHtml + toolsHtml + countHtml + body + '</div>';
    fitPlaceholder();
    paintNav();
  }

  /* 줄 하나. 왼쪽에 제목과 한 줄 메타, 오른쪽에 상태와 단추. */
  function listRow(ent, r, i, total) {
    var lead = ent.lead ? ent.lead(r) : '';
    var meta = ent.meta ? ent.meta(r) : '';
    return '<div class="listrow" data-id="' + esc(r.id) + '" data-i="' + i + '">' +
      (lead ? '<div class="listrow__lead">' + esc(lead) + '</div>' : '') +
      '<div class="listrow__body">' +
        '<div class="listrow__title">' + esc(ent.title(r)) + '</div>' +
        (meta ? '<div class="listrow__meta">' + (ent.metaHtml ? meta : esc(meta)) + '</div>' : '') +
      '</div>' +
      (ent.tags ? '<div class="listrow__tags">' + ent.tags(r) + '</div>' : '') +
      '<div class="listrow__act">' +
        quickHtml(ent, r) +
        '<button class="btn btn--ghost btn--sm" type="button" data-act="edit">수정</button>' +
        '<button class="iconbtn iconbtn--sm" type="button" data-act="more" ' +
          'aria-expanded="false" aria-label="' + esc(ent.title(r)) + ' 추가 작업">⋯</button>' +
      '</div>' +
      '<div class="listrow__more" hidden>' +
        (ent.noReorder ? '' :
          '<button class="btn btn--ghost btn--sm" type="button" data-act="up"' +
          (i === 0 ? ' disabled' : '') + '>↑ 위로</button>' +
          '<button class="btn btn--ghost btn--sm" type="button" data-act="down"' +
          (i === total - 1 ? ' disabled' : '') + '>↓ 아래로</button>') +
        (ent.moreHtml ? ent.moreHtml(r) : '') +
        '<button class="btn btn--danger btn--sm" type="button" data-act="del">삭제</button>' +
      '</div></div>';
  }

  /* 목록에서 바로 켜고 끄는 단추(지금은 부스 · 구역의 공개). 항목 정의의 quick(r) 이
     { on, label, what } 을 돌려주면 그리고, 누르면 onQuick(r) 이 처리합니다. */
  function quickHtml(ent, r) {
    if (!ent.quick) return '';
    var q = ent.quick(r);
    return '<button class="pubswitch' + (q.on ? ' is-on' : '') + '" type="button" data-act="quick" role="switch" ' +
      'aria-checked="' + q.on + '" aria-label="' + esc(ent.title(r) + ' ' + q.label) + '">' +
      '<span class="pubswitch__dot" aria-hidden="true"></span>' + esc(q.label) + ' ' + (q.on ? 'ON' : 'OFF') + '</button>';
  }

  /* 부스 · 구역의 공개를 켜고 끕니다(목록의 공개 단추).
     부스를 켤 때는 편집 창과 같은 규칙으로 먼저 확인합니다(데이터베이스도 같은 규칙으로 막습니다).
     구역은 바뀌는 부스가 있으면 몇 곳이 보이고 숨겨지는지 알리고 확인을 받습니다. */
  function togglePublish(key, row) {
    var ent = ENTITIES[key];
    var turnOn = !row.is_published;
    var ask = Promise.resolve(true);
    if (key === 'booths' && turnOn) {
      var why = publishBlock(row);
      if (why) { toast(why, true); return Promise.resolve(); }
    }
    if (key === 'zones') {
      var inZone = (cache.booths || []).filter(function (b) { return b.zone_key === row.key; });
      var affected = inZone.filter(function (b) { return b.is_published && hasSlot(b); }).length;
      if (affected) {
        ask = UI.confirm({
          title: turnOn ? '구역을 공개할까요?' : '구역을 비공개로 바꿀까요?',
          message: turnOn
            ? '“' + (row.label || row.key) + '” 구역의 공개 부스 ' + affected + '곳이 관람객 · 운영자 화면에 바로 보입니다.'
            : '“' + (row.label || row.key) + '” 구역의 공개 부스 ' + affected + '곳이 관람객 · 운영자 화면에서 숨겨집니다. ' +
              '부스마다의 공개 설정은 그대로 남아, 구역을 다시 공개하면 돌아옵니다.',
          confirmLabel: turnOn ? '공개' : '비공개로 바꾸기', danger: !turnOn
        });
      }
    }
    return ask.then(function (ok) {
      if (!ok) return;
      return D.update(ent.table, row.id, { is_published: turnOn }).then(function (updated) {
        var list = cache[key] || [];
        for (var i = 0; i < list.length; i++) if (list[i].id === row.id) list[i] = updated;
        renderPanel();
        toast(updated.is_published ? '공개했습니다.' : '비공개로 바꿨습니다.');
      }).catch(function (e) {
        console.error('[admin] 공개 바꾸기 실패', key, e);
        toast(C.dataMessage(e), true);
      });
    });
  }

  /* 협의용 예시: QR · 대기 현황 흉내. 메모리 상태만 바꾸고 그 줄의 ⋯ 를 다시 펼쳐 둡니다
     (이어서 눌러 보기 쉽게). 실제 열쇠 · 대기 함수(RPC)는 부르지 않습니다. */
  function reopenMore(id) {
    var rowEl = null;
    Array.prototype.forEach.call(document.querySelectorAll('.listrow'), function (el) {
      if (el.dataset.id === String(id)) rowEl = el;
    });
    if (!rowEl) return;
    var box = rowEl.querySelector('.listrow__more'), btn = rowEl.querySelector('[data-act="more"]');
    if (box) box.hidden = false;
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }
  function demoQr(row, op) {
    var why = op === 'issue' ? AD.issue(row.id) : (op === 'off' ? AD.disable(row.id) : AD.rekey(row.id));
    if (why) { toast(why, true); return; }
    renderPanel();
    reopenMore(row.id);
    toast(op === 'issue' ? '운영자 QR 발급됨으로 바꿨습니다. 협의용 예시 화면에서는 실제 QR이 발급되지 않습니다.'
      : op === 'off' ? 'QR 꺼짐으로 바꿨습니다(협의용 예시). 실제로는 그 카드와 열린 운영자 화면이 바로 멈춥니다.'
      : '새 QR로 다시 켰습니다(협의용 예시). 실제로는 새 카드를 인쇄해 전달합니다.');
  }
  /* 협의용 예시: 운영자 PIN 흉내. 실제 함수(admin_issue_booth_pin · admin_disable_booth_pin)는 부르지 않습니다.
     예시 PIN 은 운영자 예시와 같은 4자리 규칙이라, 보여 준 PIN 으로 운영자 예시 화면을 바로 열어 볼 수 있습니다. */
  function demoPinAct(row, op) {
    var label = boothSlot(row) + ' ' + (row.name || '');
    var c = AD.pinOf(row.id);
    var o = op === 'off'
      ? { title: 'PIN 로그인을 끌까요?', label: 'PIN 끄기', danger: true,
          message: '“' + label + '”의 PIN 로그인이 막히고 PIN으로 연 휴대폰 ' + c.sessions + '대가 로그아웃됩니다(협의용 예시). QR은 그대로입니다.' }
      : c.state === 'on'
      ? { title: 'PIN을 재발급할까요?', label: 'PIN 재발급', danger: true,
          message: '실제로는 지금 PIN이 바로 실패하고 그 PIN으로 연 휴대폰 ' + c.sessions + '대가 로그아웃됩니다. ' +
            '협의용 예시에서는 상태만 바뀌고 예시 PIN 값은 그대로입니다. QR은 그대로입니다.' }
      : { title: '운영자 PIN을 발급할까요?', label: c.state === 'off' ? '새 PIN 만들기' : 'PIN 발급', danger: false,
          message: '“' + label + '”의 운영자 PIN을 만듭니다(협의용 예시). 다음 창에서 예시 PIN을 보여 드려요.' };
    return UI.confirm({ title: o.title, message: o.message, confirmLabel: o.label, danger: o.danger }).then(function (yes) {
      if (!yes) return;
      var res = op === 'off' ? AD.pinOff(row.id) : AD.pinIssue(row.id);
      if (res.error) { toast(res.error, true); return; }
      renderPanel();
      reopenMore(row.id);
      if (op === 'off') { toast('PIN 꺼짐으로 바꿨습니다(협의용 예시). QR은 그대로입니다.'); return; }
      UI.reveal({
        title: '운영자 PIN 발급 · 협의용 예시',
        closeLabel: '닫기',
        bodyHtml:
          '<div class="pinshow">' +
            '<p class="pinshow__who"><b>' + esc(boothSlot(row)) + '</b> ' + esc(row.name || '') + '</p>' +
            '<p class="pinshow__label">협의용 예시 PIN</p>' +
            '<p class="pinshow__pin">' + esc(res.pin) + '</p>' +
            '<p class="pinshow__warn">협의용 예시 PIN입니다. 실제 운영자 PIN은 6자리이고, 발급할 때 이 창에서 한 번만 보입니다.</p>' +
            '<p class="pinshow__note">운영자 예시 화면(booth-ctrl.html?demo=1)에서 구역 → 부스 → 이 PIN을 넣으면 운영 화면이 열립니다.</p>' +
          '</div>'
      });
    });
  }
  function demoLive(row, mode, wait) {
    var why = AD.setLive(row.id, mode, wait);
    if (why) { toast(why, true); return; }
    renderPanel();
    reopenMore(row.id);
    toast('대기 현황을 바꿨습니다 — ' + AD.liveLabel(AD.liveOf(row.id)) + ' (협의용 예시)');
  }

  /* 부스 목록을 데이터베이스에서 다시 읽습니다. 구역 코드를 바꾸거나 구역을 지우면
     데이터베이스가 부스의 구역 · 표시 번호 · 공개를 함께 바꾸므로, 화면이 추측해 고치지 않고
     새로 읽어 맞춥니다. */
  function reloadBooths() {
    var e = ENTITIES.booths;
    return D.select(e.table, { order: e.order === false ? false : (e.order || [['sort_order', true]]) })
      .then(function (d) { cache.booths = d; });
  }

  /* 행사 기본정보 — 한 줄짜리 표라 목록 대신 읽기 화면을 둡니다. */
  function renderSingle(ent, head, host) {
    var rows1 = cache.settings || [];
    if (!rows1.length) {
      host.innerHTML = '<div class="page">' + head +
        '<div class="state">행사 기본정보 줄을 찾지 못했습니다. settings 표에 id = 1 인 줄이 있는지 확인해 주세요.' +
        '<div class="state__act"><button class="btn btn--ghost btn--sm" type="button" data-retry>다시 시도</button></div>' +
        '</div></div>';
      paintNav(); return;
    }
    var s = rows1[0];

    /* 편집창과 같은 묶음으로 보여 줍니다. 보는 순서와 고치는 순서가
       다르면 어디를 고쳐야 할지 매번 다시 찾아야 합니다. */
    var out = '', cur = null;
    ent.fields.forEach(function (f) {
      if (f.type === 'group') {
        if (cur) out += '</div></section>';
        out += '<section class="fgroup"><h2 class="fgroup__t">' + esc(f.label) + '</h2><div class="list">';
        cur = f;
        return;
      }
      if (!cur) { out += '<section class="fgroup"><div class="list">'; cur = true; }
      if (!(f.k in s)) return;
      var v = s[f.k];
      /* 개막·종료 일시는 연도까지 보여 줍니다. 목록에 쓰는 '11/6 10:00'
         짧은 표기는 최근 글 순서를 볼 때나 쓸모 있고, 행사 기본정보에서는
         연도가 틀린 것을 한눈에 알아차려야 합니다. */
      if (f.type === 'datetime') {
        var dv = v ? new Date(v) : null;
        v = dv && !isNaN(dv) ? C.fmtDateTime(dv) : '';
      }
      if (f.type === 'bool') v = v ? '켜짐' : '꺼짐';
      if (f.type === 'image') {
        out += '<div class="listrow"><div class="listrow__body">' +
          '<div class="listrow__meta">' + esc(f.label) + '</div>' +
          (v ? '<img class="listrow__thumb" src="' + esc(v) + '" alt="" />'
             : '<div class="listrow__title"><span class="muted">등록된 이미지가 없습니다</span></div>') +
          '</div></div>';
        return;
      }
      out += '<div class="listrow"><div class="listrow__body">' +
        '<div class="listrow__meta">' + esc(f.label) + '</div>' +
        '<div class="listrow__title">' +
        (v === '' || v == null ? '<span class="muted">비어 있음</span>' : esc(v)) +
        '</div></div></div>';
    });
    if (cur) out += '</div></section>';

    host.innerHTML = '<div class="page">' + head + out +
      '<div><button class="btn btn--primary" type="button" data-edit-settings>행사 기본정보 수정</button></div></div>';
    paintNav();
  }

  /* ── 편집 모달 ──────────────────────────────────────────────── */
  function fieldsFor(ent) {
    return ent.fields.map(function (f) {
      if (f.type === 'zone') {
        // 비공개 구역은 이름 옆에 적어 둡니다 — 그 구역에서는 부스를 공개할 수 없습니다.
        var zoneOpts = zoneList().map(function (z) {
          return [z.key, (z.label || z.key + '구역') + ' (' + z.key + ')' + (z.is_published ? '' : ' · 비공개')];
        });
        return Object.assign({}, f, {
          type: 'select',
          options: f.allowEmpty
            ? [['', '미배정 (구역 미정)']].concat(zoneOpts)
            : (zoneOpts.length ? zoneOpts : [['', '(등록된 구역 없음 — 먼저 “부스 구역”을 만들어 주세요)']])
        });
      }
      /* 다른 표의 줄을 고르는 칸. id 를 손으로 적게 하면 반드시
         틀립니다. 목록에서 고르게 합니다. */
      if (f.type === 'ref') {
        var rows = cache[f.ref] || [];
        var list = rows.map(function (r) { return [r.id, f.refLabel(r)]; });
        return Object.assign({}, f, {
          type: 'select',
          options: (f.allowEmpty ? [['', '(선택 안 함)']] : []).concat(list),
          hint: rows.length ? f.hint
            : '먼저 “' + (ENTITIES[f.ref] || {}).label + '”에서 등록해 주세요'
        });
      }
      /* 일정의 일자는 행사 기간 안에서만 고르게 합니다. 달력을 펼치면
         엉뚱한 해·달을 고르기 쉽고, 이틀 행사에서 고를 날은 둘뿐입니다.
         그래서 행사 날짜를 단추로 늘어놓습니다(11.6. 금 · 11.7. 토).
         기간을 모르면(기본정보 미설정) 달력 칸 그대로 둡니다. */
      if (f.type === 'date' && f.k === 'event_date') {
        var days = eventDays();
        if (!days.length) return f;
        return Object.assign({}, f, {
          type: 'choice', required: days.length > 1,
          // 단추 글자는 공문 표기('11. 6.(금)')와 같게 씁니다.
          options: days.map(function (d) {
            var p = d.split('-'), dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
            return [d, (dt.getMonth() + 1) + '. ' + dt.getDate() + '.(' + WEEKDAYS[dt.getDay()] + ')'];
          })
        });
      }
      /* 여러 줄 칸의 고를 목록은 다른 표에서 옵니다. 정의할 때는
         아직 불러오기 전이라 여기서 채웁니다. */
      if (f.type === 'rows') {
        return Object.assign({}, f, { cols: rowCols(f.k) });
      }
      return f;
    });
  }

  /* 담당자 줄과 물품 줄의 칸 모양. */
  function rowCols(k) {
    if (k === '__assigns') {
      return [
        { k: 'contact_id', label: '운영 인력에서 고르기', type: 'select',
          options: [['', '운영 인력에 없음 (이름 직접 입력)']].concat(
            (cache.contacts || []).map(function (c) {
              return [c.id, c.name + (c.org ? ' · ' + c.org : '')];
            })) },
        { k: 'person_name', label: '이름', placeholder: '이름 직접 입력' },
        { k: 'role', label: '업무 배정 역할',
          placeholder: '이 업무에서 맡은 역할 (예: 총괄 · 현장 확인 · 기록 · 안내)' }
      ];
    }
    if (k === '__allocs') {
      return [
        { k: 'item_id', label: '물품', type: 'select',
          options: [['', '물품을 고르세요']].concat(
            (cache.supply_items || []).map(function (it) {
              return [it.id, it.name + (it.unit ? ' (' + it.unit + ')' : '')];
            })) },
        { k: 'qty', label: '수량', type: 'number', min: 0, placeholder: '수량' }
      ];
    }
    return [];
  }

  /* 이 항목이 들고 있는 이미지 칸들 */
  function imageKeys(ent) {
    return (ent.fields || []).filter(function (f) { return f.type === 'image'; })
      .map(function (f) { return f.k; });
  }

  /* 바뀌거나 지워져서 더는 쓰이지 않는 이미지를 보관함에서 지웁니다.
     이걸 안 하면 교체할 때마다 예전 파일이 계속 쌓입니다. */
  function dropReplacedImages(ent, before, after) {
    if (DEMO) return;   // 예시 모드는 보관함(Storage)을 건드리지 않습니다
    imageKeys(ent).forEach(function (k) {
      var old = (before || {})[k];
      if (old && old !== (after || {})[k]) C.deleteImage(old);
    });
  }

  function openEditor(key, row) {
    var ent = ENTITIES[key];
    if (!ent.fields || !ent.fields.length) return;
    var isNew = !row;
    // blank 는 함수일 수 있습니다 — 기본값이 다른 표(행사 기간)에
    // 따라 달라지는 경우, 정의할 때는 아직 알 수 없습니다.
    var blank = typeof ent.blank === 'function' ? ent.blank() : ent.blank;
    var values = Object.assign({}, blank || {}, row || {});
    ent.fields.forEach(function (f) {
      if (f.type === 'datetime') values[f.k] = toLocalInput(values[f.k]);
    });
    var kept = keepOldValue(ent, values).filter(function (f) {
      /* 더는 새로 쓰지 않는 칸(공개 전화번호 등). 예전 값이 남은 줄에만
         보여서, 관리자가 비울 수 있게 합니다. 새 줄이나 빈 칸이면
         창에 나오지 않고, 나오지 않은 칸은 저장할 때 보내지도 않습니다. */
      if (f.legacyOnly) return !!(row && String(row[f.k] == null ? '' : row[f.k]).trim());
      /* 예시 모드에서는 사진 칸을 두지 않습니다. 고르는 즉시 실제 보관함(Storage)에
         올라가기 때문입니다(assets/ui.js 의 image 칸). */
      if (DEMO && (f.type === 'image' || f.k === 'image_alt' || f.k === 'image_caption' ||
                   (f.type === 'group' && /사진/.test(f.label || '')))) return false;
      /* 아직 표에 없는 칸은 편집창에서 뺍니다. 없는 칸을 보내면 저장이
         통째로 거절됩니다. 줄이 하나도 없으면 알 수 없으니 그대로 둡니다. */
      if (!f.needsColumn) return true;
      var rows = cache[key] || [];
      return !rows.length || rows.some(function (r) { return f.k in r; });
    });

    // 관리자 전용 칸을 딸린 한 줄(contact_private)에서 읽어 채웁니다.
    var pv = ent.private;
    if (pv) {
      var priv = row ? privateOf(key, row.id) : null;
      Object.keys(pv.map).forEach(function (fk) {
        values[fk] = priv ? (priv[pv.map[fk]] || '') : '';
      });
    }

    // 딸린 줄(담당자·물품)을 지금 값에서 읽어 함께 싣습니다.
    var ch = ent.children;
    if (ch) {
      values[ch.field] = row
        ? (cache[ch.key] || []).filter(function (a) { return a[ch.parent] === row.id; })
            .map(ch.toRow)
        : [];
    }

    UI.form({
      // 창 제목은 메뉴 이름이 아니라 다루는 것 하나(예: '업무 배정' → '업무 추가').
      title: (ent.formLabel || ent.label.replace(' 관리', '')) + (isNew ? ' 추가' : ' 수정'),
      desc: DEMO ? DEMO_SAVE_NOTE : '',
      fields: kept,
      values: values,
      submitLabel: isNew ? '추가' : '저장',
      // 수정 중인 줄을 함께 넘깁니다 — 같은 번호 검사에서 자기 자신은 빼야 합니다.
      validate: ent.validate ? function (vals) { return ent.validate(vals, row); } : null
    }).then(function (v) {
      if (!v) return;
      ent.fields.forEach(function (f) {
        if (f.type === 'datetime') v[f.k] = fromLocalInput(v[f.k]);
        // 고르지 않은 참조는 '' 가 아니라 null 이어야 합니다.
        // uuid 칸에 빈 글자를 넣으면 Postgres 가 거절합니다.
        if (f.type === 'ref' && !v[f.k]) v[f.k] = null;
      });
      // 딸린 줄은 부모 표의 칸이 아니라 따로 떼어 둡니다.
      var childRows = null;
      if (ch) { childRows = v[ch.field] || []; delete v[ch.field]; }
      /* 관리자 전용 칸도 떼어 냅니다. 이 값은 공개 표(contacts)로
         절대 보내지 않습니다 — 보내면 공개 표에 칸이 없어 저장이
         거절되기도 하지만, 그보다 공개 표에 섞일 일이 없어야 합니다. */
      var privVals = null;
      if (pv) {
        privVals = {};
        Object.keys(pv.map).forEach(function (fk) {
          privVals[pv.map[fk]] = String(v[fk] == null ? '' : v[fk]).trim();
          delete v[fk];
        });
      }
      if (ent.beforeSave) v = ent.beforeSave(v, row);

      /* 저장 뒤 손질(afterSave)은 알림 글(문자열)을 돌려주거나, 다시 읽기처럼 기다릴 일
         (Promise)을 돌려줄 수 있습니다. 글은 '저장했습니다' 대신 보여 줍니다. */
      var note = null;
      function after(updated, before) {
        if (ent.resort && cache[key]) cache[key].sort(ent.resort);
        var r = ent.afterSave ? ent.afterSave(updated, before) : null;
        if (r && typeof r.then === 'function') return r;
        note = r || null;
        return null;
      }

      if (isNew) {
        var rows = cache[key] || [];
        // 표시 순서를 직접 적지 않았으면 맨 뒤로 둡니다.
        if (v.sort_order == null) {
          v.sort_order = rows.reduce(function (m, r) { return Math.max(m, r.sort_order || 0); }, 0) + 1;
        }
        var createdId = null;
        D.insert(ent.table, v).then(function (created) {
          cache[key].push(created);
          createdId = created.id;
          return Promise.resolve(after(created, null)).then(function () {
            return syncChildren(ent, created.id, childRows);
          });
        }).then(function () {
          // 새 담당자는 방금 만든 줄의 id 로 개인 연락처를 잇습니다.
          return syncPrivate(ent, key, createdId, privVals).catch(privateFailed(ent));
        }).then(function () {
          renderPanel();
          toast(note || '추가했습니다.');
        }).catch(function (e) {
          console.error('[admin] 추가 실패', key, e);
          if (e && e.privateStep) { renderPanel(); toast(e.privateStep, true); return; }
          toast(C.dataMessage(e), true);
        });
      } else {
        D.update(ent.table, row.id, v).then(function (updated) {
          var i = -1;
          (cache[key] || []).forEach(function (x, idx) { if (x.id === row.id) i = idx; });
          if (i >= 0) cache[key][i] = updated;
          // 저장이 끝난 뒤에 지웁니다. 먼저 지웠다가 저장이 실패하면
          // 화면에는 이미지가 있는데 파일은 없는 상태가 됩니다.
          dropReplacedImages(ent, row, updated);
          return Promise.resolve(after(updated, row)).then(function () {
            return syncChildren(ent, row.id, childRows);
          });
        }).then(function () {
          return syncPrivate(ent, key, row.id, privVals).catch(privateFailed(ent));
        }).then(function () {
          renderPanel();
          toast(note || '저장했습니다.');
        }).catch(function (e) {
          console.error('[admin] 저장 실패', key, e);
          if (e && e.privateStep) { renderPanel(); toast(e.privateStep, true); return; }
          toast(C.dataMessage(e), true);
        });
      }
    });
  }

  /* 고를 수 없게 된 예전 값을 살려 둡니다. '주차' 처럼 새로 고를 수는
     없지만 이미 저장된 값은 그대로 보이고 그대로 저장돼야 합니다. */
  function keepOldValue(ent, values) {
    return fieldsFor(ent).map(function (f) {
      if (f.type !== 'select' || !f.keepValue) return f;
      var v = values[f.k];
      if (!v) return f;
      var has = (f.options || []).some(function (o) {
        return String(Array.isArray(o) ? o[0] : o) === String(v);
      });
      if (has) return f;
      return Object.assign({}, f, { options: (f.options || []).concat([[v, v + ' (이전 값)']]) });
    });
  }

  /* 창에서 다룬 딸린 줄을 표에 맞춥니다. 있던 줄은 고치고, 새 줄은
     넣고, 지운 줄은 지웁니다. 업무·대상마다 따로 짤 이유가 없어
     한 곳에서 처리합니다. */
  function syncChildren(ent, parentId, rows) {
    var ch = ent.children;
    if (!ch || !rows) return Promise.resolve();

    var table = ENTITIES[ch.key].table;
    var before = (cache[ch.key] || []).filter(function (a) { return a[ch.parent] === parentId; });
    var keep = rows.filter(ch.keep || function () { return true; });
    var jobs = [];

    keep.forEach(function (r, i) {
      var payload = ch.fromRow(r);
      payload.sort_order = i + 1;
      var old = before[i];
      if (old) jobs.push(D.update(table, old.id, payload));
      else { payload[ch.parent] = parentId; jobs.push(D.insert(table, payload)); }
    });
    before.slice(keep.length).forEach(function (old) {
      jobs.push(D.remove(table, old.id));
    });

    if (!jobs.length) return Promise.resolve();
    // 끝나면 그 부모의 줄만 다시 읽어 화면과 표를 맞춥니다.
    return Promise.all(jobs).then(function () {
      return D.selectSoft(table, { order: [['sort_order', true]] });
    }).then(function (all) {
      cache[ch.key] = all;
    });
  }

  /* 관리자 전용 한 줄(contact_private)을 저장합니다.

     줄이 아직 없는 담당자: 칸이 모두 비어 있으면 만들지 않습니다(빈
       줄만 쌓입니다). 하나라도 적혀 있으면 새로 만듭니다.
     줄이 있는 담당자: 적힌 대로 고칩니다. 비웠다면 빈 값으로 고칩니다.

     upsert(contact_id 기준)라, 화면이 가진 목록이 낡아서 "없다" 고
     판단했는데 실제로는 줄이 있더라도 중복을 만들지 않고 고칩니다. */
  /* 공개 정보는 저장됐는데 관리자 전용 정보만 실패한 경우.
     그냥 "저장 실패" 라고 하면 담당자가 안 만들어진 줄 알고 한 번 더
     추가해 같은 사람이 둘이 됩니다. 무엇이 됐고 무엇이 안 됐는지
     나눠 알리고, 목록을 다시 그려 만들어진 담당자가 보이게 합니다. */
  // ent.private 의 what · privWhat · noun 으로 항목마다 다른 말을 씁니다(없으면 담당자 기준).
  function privateFailed(ent) {
    var pv = (ent && ent.private) || {};
    return function (e) {
      var err = new Error(C.dataMessage(e));
      err.privateStep = (pv.noun || '담당자') + ' 공개 정보는 저장했지만 ' +
        (pv.privWhat || '관리자 전용 정보(개인 연락처 · 관리자 메모)') + '는 저장하지 못했습니다. ' +
        '목록에서 이 ' + (pv.noun || '담당자') + '를 다시 수정해 저장해 주세요. — ' + C.dataMessage(e);
      throw err;
    };
  }

  function syncPrivate(ent, key, parentId, vals) {
    var pv = ent.private;
    if (!pv || !vals || !parentId) return Promise.resolve();
    var had = privateOf(key, parentId);
    var empty = Object.keys(vals).every(function (k) { return !vals[k]; });
    if (!had && empty) return Promise.resolve();

    var payload = Object.assign({}, vals);
    payload[pv.parent] = parentId;
    return D.upsert(ENTITIES[pv.key].table, payload, pv.onConflict).then(function (saved) {
      var list = cache[pv.key] || (cache[pv.key] = []);
      var i = -1;
      list.forEach(function (x, idx) { if (x[pv.parent] === parentId) i = idx; });
      if (i >= 0) list[i] = saved; else list.push(saved);
    });
  }

  function confirmDelete(key, row) {
    var ent = ENTITIES[key];
    /* 지울 때 무엇이 함께 바뀌는지는 항목마다 다릅니다(deleteMessage).
       구역: 부스는 남고 미배정 · 비공개가 됩니다. 부스: 운영자 QR · 기록까지 함께 지워집니다. */
    UI.confirm({
      title: '삭제할까요?',
      message: ent.deleteMessage ? ent.deleteMessage(row)
        : '“' + ent.title(row) + '”을(를) 삭제합니다. 되돌릴 수 없습니다.',
      confirmLabel: '삭제', danger: true
    }).then(function (ok) {
      if (!ok) return;
      D.remove(ent.table, row.id).then(function () {
        cache[key] = cache[key].filter(function (x) { return x.id !== row.id; });
        dropReplacedImages(ent, row, {});   // 딸린 이미지도 함께 정리
        /* 관리자 전용 한 줄은 데이터베이스가 함께 지웁니다
           (contact_private.contact_id · booth_private.booth_id … on delete cascade).
           화면이 가진 목록에서도 맞춰 뺍니다. */
        var pv = ent.private;
        if (pv && cache[pv.key]) {
          cache[pv.key] = cache[pv.key].filter(function (x) { return x[pv.parent] !== row.id; });
        }
        return ent.afterDelete ? ent.afterDelete(row) : null;
      }).then(function () {
        renderPanel();
        toast('삭제했습니다.');
      }).catch(function (e) {
        console.error('[admin] 삭제 실패', key, e);
        toast(C.dataMessage(e), true);
      });
    });
  }

  function move(key, i, dir) {
    var rows = cache[key], j = i + dir;
    if (j < 0 || j >= rows.length) return;
    var a = rows[i], b = rows[j];
    var ao = a.sort_order, bo = b.sort_order;
    if (ao === bo) { ao = i; bo = j; }
    var table = ENTITIES[key].table;
    Promise.all([
      D.update(table, a.id, { sort_order: bo }),
      D.update(table, b.id, { sort_order: ao })
    ]).then(function () {
      a.sort_order = bo; b.sort_order = ao;
      rows[i] = b; rows[j] = a;
      renderPanel();
      toast('순서를 바꿨습니다.');
    }).catch(function (e) {
      console.error('[admin] 순서 변경 실패', key, e);
      toast(C.dataMessage(e), true);
    });
  }

  /* ── 데이터 ─────────────────────────────────────────────────── */
  function loadAll() {
    $('#view').innerHTML = '<div class="state">데이터를 불러오는 중입니다.</div>';
    var keys = ORDER.filter(function (k) { return ENTITIES[k].table; });
    // 예시 모드는 부스 · 구역 · 관리자 전용 정보만 메모리 store 에서 읽습니다(Supabase 요청 없음).
    if (DEMO) {
      keys.forEach(function (k) { cache[k] = []; });
      keys = keys.filter(function (k) { return DEMO_TABLES.indexOf(ENTITIES[k].table) >= 0; });
    }
    return Promise.all(keys.map(function (k) {
      var e = ENTITIES[k];
      // soft 항목은 마이그레이션 전이라 표가 없을 수 있습니다. 그 하나
      // 때문에 관리자 화면 전체가 오류가 되면 안 됩니다.
      var get = e.soft ? D.selectSoft : D.select;
      return get(e.table, { order: e.order === false ? false : (e.order || [['sort_order', true]]) })
        .then(function (d) { cache[k] = d; });
    // 운영자 QR · PIN 상태는 함께 읽되, 못 읽어도 목록은 그립니다(loadCreds 는 실패하지 않습니다).
    }).concat([loadCreds()])).then(renderPanel).catch(function (e) {
      console.error('[admin] 로드 실패', e);
      $('#view').innerHTML = '<div class="state state--error">' + esc(C.dataMessage(e)) +
        '<div class="state__act"><button class="btn btn--ghost btn--sm" type="button" data-retry>다시 시도</button></div></div>';
    });
  }

  /* ── 라우팅·이벤트 ──────────────────────────────────────────── */
  var pendingAdd = null;

  function closeRowMenus() {
    Array.prototype.forEach.call(document.querySelectorAll('.listrow__more'), function (b) {
      b.hidden = true;
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-act="more"]'), function (b) {
      b.setAttribute('aria-expanded', 'false');
    });
  }

  function routeFromHash() {
    var id = (location.hash || '').replace(/^#/, '');
    // 예시 모드는 부스 · 구역 화면만 엽니다. 다른 화면은 실제 데이터라 예시와 섞지 않습니다.
    if (DEMO) return DEMO_KEYS.indexOf(id) >= 0 ? id : 'booths';
    // 숨긴 항목은 주소로도 들어오지 않게 합니다. 표 이름이 그대로
    // 주소가 되면 메뉴에서 감춘 뜻이 없어집니다.
    return (ENTITIES[id] && !ENTITIES[id].hidden) ? id : 'overview';
  }
  // 부스 운영 현황(booth-admin.html)의 '부스 정보 관리' 가 admin.html?find=A-01#booths 로 엽니다.
  // 처음 한 번만 부스 검색칸에 넣습니다.
  var findOnce = (function () {
    try { return String(new URLSearchParams(window.location.search).get('find') || '').slice(0, 40); } catch (e) { return ''; }
  })();
  function go() {
    current = routeFromHash();
    listQ = ''; listStatus = '전체'; listF = {};
    if (listSheet) { listSheet = false; document.body.style.overflow = ''; }
    if (findOnce && current === 'booths') { listQ = findOnce; findOnce = ''; }
    renderPanel();
    if (pendingAdd) { var k = pendingAdd; pendingAdd = null; openEditor(k, null); }
    window.scrollTo({ top: 0, behavior: 'instant' });
    $('#sheet').hidden = true;
    document.body.style.overflow = '';
    $('#main').focus({ preventScroll: true });
  }

  /* 로그아웃 — 옆 메뉴(데스크톱)와 더보기 시트(휴대폰) 두 곳의 단추가 같은 일을 합니다. */
  function signOutNow(btn) {
    if (btn) btn.disabled = true;
    $('#sheet').hidden = true;
    document.body.style.overflow = '';
    // 화면을 먼저 닫습니다. 서버 응답을 기다리는 동안 관리 화면이
    // 그대로 보이면, 느린 회선에서 로그아웃이 안 된 것처럼 보입니다.
    gate('gate-login');
    // replace 로 옮깁니다. href 로 옮기면 관리자 페이지가 방문
    // 기록에 남아, 뒤로가기로 되돌아올 수 있습니다.
    C.signOut().then(function () { location.replace('index.html'); });
  }

  /* 내 비밀번호 변경 — 현재 비밀번호를 확인한 뒤 바꿉니다(core.changePassword).
     입력한 비밀번호는 이 창 안에서만 쓰고, 창이 닫히면 칸째 사라집니다.
     잊어버린 비밀번호는 여기서 찾지 않습니다 — 총괄 관리자가 Supabase 에서 다시 정합니다. */
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

  function bind() {
    window.addEventListener('hashchange', go);

    document.addEventListener('click', function (e) {
      var t = e.target;
      var so = t.closest('[data-signout]');
      if (so) { signOutNow(so); return; }
      if (t.closest('[data-pwchange]')) { openPasswordChange(); return; }
      if (t.closest('[data-open-sheet]')) { $('#sheet').hidden = false; document.body.style.overflow = 'hidden'; return; }
      if (t.closest('[data-close-sheet]')) { $('#sheet').hidden = true; document.body.style.overflow = ''; return; }
      if (t.closest('[data-retry]')) { loadAll(); return; }

      var g = t.closest('[data-go]');
      if (g) {
        // 빠른 관리에서 온 것이면 그 화면을 열면서 바로 추가창까지 엽니다.
        var addAfter = g.hasAttribute('data-goadd') ? g.dataset.go : null;
        if (location.hash === '#' + g.dataset.go) { if (addAfter) openEditor(addAfter, null); }
        else {
          pendingAdd = addAfter;
          location.hash = '#' + g.dataset.go;
        }
        return;
      }

      var st = t.closest('[data-subtab]');
      if (st) {
        subTab[current] = st.dataset.subtab; listQ = ''; listStatus = '전체'; listF = {};
        if (listSheet) { listSheet = false; document.body.style.overflow = ''; }
        renderPanel(); return;
      }

      var ls = t.closest('[data-liststatus]');
      if (ls) { listStatus = ls.dataset.liststatus; renderPanel(); return; }

      // 걸러 보기 칩(날짜 · 구역). 고른 칩을 다시 누르면 '전체' 로 돌아갑니다.
      var lf = t.closest('button[data-listf]');
      if (lf) {
        var fk = lf.dataset.listf, fv = lf.dataset.v || '';
        listF[fk] = listF[fk] === fv ? '' : fv;
        renderPanel();
        var again = $('#view button[data-listf="' + fk + '"][data-v="' + (listF[fk] || '') + '"]');
        if (again) again.focus();
        return;
      }
      if (t.closest('[data-listreset]')) { listQ = ''; listStatus = '전체'; listF = {}; renderPanel(); return; }

      // 요약 카드 = 걸러 보기. 고른 카드를 다시 누르거나 '전체' 를 누르면 풉니다.
      if (t.closest('[data-sumall]')) {
        var sumEnt = ENTITIES[listKey()];
        (sumEnt.filters || []).forEach(function (f) { if (f.kind === 'summary') listF[f.key] = ''; });
        listStatus = '전체';
        renderPanel();
        return;
      }
      var sf = t.closest('[data-sumf]');
      if (sf) {
        listF[sf.dataset.sumf] = listF[sf.dataset.sumf] === sf.dataset.v ? '' : sf.dataset.v;
        renderPanel();
        var sfAgain = $('#view [data-sumf="' + sf.dataset.sumf + '"][data-v="' + sf.dataset.v + '"]');
        if (sfAgain) sfAgain.focus();
        return;
      }
      var ss = t.closest('[data-sumstatus]');
      if (ss) {
        listStatus = listStatus === ss.dataset.sumstatus ? '전체' : ss.dataset.sumstatus;
        renderPanel();
        return;
      }
      // 휴대폰의 걸러 보기 패널
      if (t.closest('[data-fopen]')) { setListSheet(true); return; }
      if (t.closest('[data-fclose]')) { setListSheet(false); return; }

      if (t.closest('[data-add]')) { openEditor(listKey(), null); return; }
      if (t.closest('[data-edit-settings]')) { openEditor('settings', (cache.settings || [])[0]); return; }

      var act = t.closest('[data-act]');
      if (act) {
        var rowEl = act.closest('.listrow');
        var key = listKey();
        var i = Number(rowEl.dataset.i);
        var row = (cache[key] || [])[i];
        if (!row) return;

        /* ⋯ 는 그 줄의 나머지 작업을 펼칩니다. 삭제와 순서 바꾸기를
           늘 꺼내 두면 자주 쓰는 '수정' 이 묻히고, 실수로 누르기도
           쉽습니다. 다른 줄에서 열려 있던 것은 닫습니다. */
        if (act.dataset.act === 'more') {
          var box = rowEl.querySelector('.listrow__more');
          var open = box.hidden;
          closeRowMenus();
          box.hidden = !open;
          act.setAttribute('aria-expanded', String(open));
          if (open) { var f = box.querySelector('button:not([disabled])'); if (f) f.focus(); }
          return;
        }
        if (act.dataset.act === 'edit') openEditor(key, row);
        else if (act.dataset.act === 'quick' && ENTITIES[key].onQuick) {
          act.disabled = true;   // 답이 오기 전에 두 번 눌러 켜고 끄기가 엇갈리지 않게
          Promise.resolve(ENTITIES[key].onQuick(row)).then(function () { act.disabled = false; });
        }
        else if (act.dataset.act === 'pin-issue' && !DEMO) pinIssue(row);
        else if (act.dataset.act === 'pin-off' && !DEMO) pinOff(row);
        else if (act.dataset.act === 'demo-qr' && DEMO) demoQr(row, act.dataset.op);
        else if (act.dataset.act === 'demo-pin' && DEMO) demoPinAct(row, act.dataset.op);
        else if (act.dataset.act === 'demo-live' && DEMO) demoLive(row, act.dataset.mode, act.dataset.wait);
        else if (act.dataset.act === 'del') confirmDelete(key, row);
        else if (act.dataset.act === 'up') move(key, i, -1);
        else if (act.dataset.act === 'down') move(key, i, 1);
        return;
      }

      // 줄 바깥을 누르면 열려 있던 ⋯ 를 닫습니다.
      if (!t.closest('.listrow__more')) closeRowMenus();
    });

    // 걸러 보기 고르기 상자(구분 · 상태 · 기관 유형 …)
    document.addEventListener('change', function (e) {
      var sel = e.target.closest && e.target.closest('select[data-listf]');
      if (!sel) return;
      listF[sel.dataset.listf] = sel.value;
      renderPanel();
      var again = $('#view select[data-listf="' + sel.dataset.listf + '"]');
      if (again) again.focus();
    });

    document.addEventListener('input', function (e) {
      if (e.target.id !== 'list-q') return;
      listQ = e.target.value;
      var pos = e.target.selectionStart;
      renderPanel();
      var again = $('#list-q');
      if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (x) {} }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('#sheet').hidden) { $('#sheet').hidden = true; document.body.style.overflow = ''; return; }
      if (listSheet) { setListSheet(false); return; }
      closeRowMenus();
    });

    // 화면 폭이 바뀌면 검색칸 안내 글을 맞추고(넓으면 길게 · 좁으면 '부스 검색'),
    // 넓어지면 휴대폰용 패널은 닫습니다(데스크톱은 같은 칸을 한 줄로 보여 줌).
    try {
      var mq = window.matchMedia('(max-width: 680px)');
      var onWidth = function () {
        if (!mq.matches && listSheet) { listSheet = false; document.body.style.overflow = ''; renderPanel(); }
      };
      if (mq.addEventListener) mq.addEventListener('change', onWidth); else mq.addListener(onWidth);
    } catch (e2) { /* 옛 브라우저 — 패널은 그대로 */ }
    // ResizeObserver 를 못 쓰거나 늦게 오는 브라우저를 위해 창 크기 변화에도 맞춥니다.
    var fitTimer = null;
    window.addEventListener('resize', function () { clearTimeout(fitTimer); fitTimer = setTimeout(fitPlaceholder, 150); });
  }

  /* 휴대폰의 걸러 보기 패널 열고 닫기. 열면 첫 칸으로, 닫으면 '필터' 단추로 초점을 돌려줍니다. */
  function setListSheet(open) {
    listSheet = !!open;
    document.body.style.overflow = listSheet ? 'hidden' : '';
    renderPanel();
    var target = listSheet ? $('#list-fpanel .ftools__sheet button:not([disabled]), #list-fpanel .ftools__sheet select')
      : $('[data-fopen]');
    if (target) { try { target.focus(); } catch (e) { /* 무시 */ } }
  }

  /* ── 시작 ─────────────────────────────────────────────────────
     포털은 로그인 없이 열리지만 이 화면은 다릅니다. 로그인한 계정의
     role 이 admin 일 때만 들어옵니다. 화면을 통과하더라도 실제 편집은
     데이터베이스의 is_admin() 이 다시 확인합니다. ───────────────── */
  var GATES = ['gate-setup', 'gate-login', 'gate-denied'];

  function gate(id) {
    GATES.forEach(function (g) { $('#' + g).hidden = g !== id; });
    $('#app').hidden = true;

    // 막을 때는 이미 그려 둔 관리 화면을 남겨 두지 않습니다.
    // hidden 만으로도 보이지 않지만, 뒤로가기로 되살아난 화면이나
    // 개발자도구에서 내용이 읽히는 것까지 막습니다.
    $('#view').innerHTML = '';
    $('#side-who').innerHTML = '';
    $('#sheet-who').textContent = '';
    UI.close();                       // 열려 있던 입력창(비밀번호 변경 등)도 닫습니다
    UI.hidePasswords($('#loginform'));
  }

  /* 협의용 예시 띠. 관리자 화면 안(로그인한 뒤)에만 있고, 스크롤해도 맨 위에 붙어
     있습니다. 관람객 예시 화면과 같은 말 · 같은 보라 계열을 씁니다(초록 · 주황 · 빨강은
     상태 색이라 쓰지 않음). '실제 관리자 화면으로 돌아가기' 는 ?demo 없는 주소를 새로 엽니다. */
  function paintDemoBar() {
    if (!DEMO || $('#demobar')) return;
    document.documentElement.classList.add('is-demo');
    var bar = document.createElement('div');
    bar.className = 'demobar';
    bar.id = 'demobar';
    bar.setAttribute('role', 'note');
    bar.innerHTML = '<p class="demobar__t"><span class="demotag">협의용 예시</span>' +
      '<span class="sr-only"> · </span><span class="demobar__w">실제 행사 정보가 아닙니다.</span></p>' +
      '<a class="demobar__exit" href="admin.html#booths">실제 관리자 화면으로 돌아가기</a>';
    var wrap = $('.main-wrap');
    wrap.insertBefore(bar, wrap.firstChild);
    // 좁은 화면에서는 띠가 두 줄이 됩니다. 위쪽 제목 줄(topbar)이 띠 밑에 붙도록 실제 높이를 씁니다.
    function fit() { document.documentElement.style.setProperty('--demo-h', bar.offsetHeight + 'px'); }
    fit();
    // 띠 자체의 높이가 바뀔 때마다(회전 · 창 크기 · 글꼴 늦게 붙음) 다시 맞춥니다.
    if (window.ResizeObserver) new ResizeObserver(fit).observe(bar);
    window.addEventListener('resize', fit);
  }

  function enter() {
    GATES.forEach(function (g) { $('#' + g).hidden = true; });
    $('#app').hidden = false;
    paintDemoBar();
    current = routeFromHash();
    if (findOnce && current === 'booths') { listQ = findOnce; findOnce = ''; }
    return loadAll();
  }

  /* 로그인한 세션이 관리자인지 확인하고 들여보냅니다. */
  function admitOrGate(sess) {
    if (!sess) { gate('gate-login'); return; }
    return C.fetchProfile(sess.user.id).then(function (p) {
      if (!p) {
        // 조회 자체가 실패한 것과 권한이 없는 것을 구분해 안내합니다.
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

  /* 로그인 폼 */
  $('#loginform').addEventListener('submit', function (e) {
    e.preventDefault();
    // 아이디(aisw01) 또는 이메일 둘 다 받습니다.
    // 이메일로 바꾸는 일은 core.signIn 이 합니다.
    var who = $('#login-email'), pw = $('#login-pw');
    var err = $('#login-error'), btn = $('#login-btn');
    err.hidden = true;
    who.setAttribute('aria-invalid', 'false');
    pw.setAttribute('aria-invalid', 'false');

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

  /* 관리자가 아닌 계정으로 들어왔을 때 빠져나갈 길 */
  $('#denied-signout').addEventListener('click', function (e) {
    e.currentTarget.disabled = true;
    C.signOut().then(function () { location.reload(); });
  });

  /* 뒤로가기로 되살아난 화면.

     브라우저는 뒤로가기 때 페이지를 통째로 캐시(bfcache)에서 꺼내
     보여 줍니다. 스크립트가 다시 돌지 않기 때문에, 로그아웃한 뒤에도
     관리 화면이 그대로 보일 수 있습니다. 되살아났으면 세션을 다시
     확인해서 없으면 로그인 화면으로 돌립니다. */
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    C.session().then(admitOrGate).catch(function () { gate('gate-login'); });
  });

  /* 다른 탭에서 로그아웃했거나 토큰이 만료되면 이 탭도 따라갑니다.
     같은 브라우저의 탭들은 저장소를 함께 쓰기 때문에, 한쪽만
     열어 두면 이미 끝난 세션으로 화면이 남습니다. */
  var client = C.db();
  if (client) {
    client.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') gate('gate-login');
    });
  }

  C.session().then(admitOrGate).catch(function (e) {
    console.error('[admin] 시작 실패', e);
    gate('gate-login');
  });
})();
