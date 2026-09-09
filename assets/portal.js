/* ===================================================================
   2026년 인천 AI·SW미래채움 교육페스티벌 — 관계자 운영 포털

   화면 구성은 해시 라우팅입니다(#dashboard, #booths …).
   모든 데이터는 Supabase 에서 옵니다. 로그인하지 않으면 아무것도
   불러오지 않습니다 — 인증 없이 운영정보가 보이면 안 됩니다.
   =================================================================== */
(function () {
  'use strict';

  var C = window.Core;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = C.esc;

  /* ── 메뉴 ───────────────────────────────────────────────────── */
  var NAV = [
    { id: 'dashboard', label: '대시보드', short: '홈',   mark: '홈', tab: true },
    { id: 'schedule',  label: '일정',     short: '일정', mark: '일', tab: true },
    { id: 'booths',    label: '부스 현황', short: '부스', mark: '부', tab: true },
    { id: 'notices',   label: '공지',     short: '공지', mark: '공', tab: true },
    { id: 'requests',  label: '운영 요청', short: '요청', mark: '요' },
    { id: 'resources', label: '자료실',   short: '자료', mark: '자' },
    { id: 'contacts',  label: '연락망',   short: '연락', mark: '연' },
    { id: 'venue',     label: '행사장',   short: '행사장', mark: '장' },
    { id: 'faq',       label: '운영 FAQ', short: 'FAQ',  mark: 'F' }
  ];

  var SCHEDULE_CATS = ['무대', '강연', '부스', '운영', '행사 지원'];
  var BOOTH_STATES  = ['준비 전', '준비 완료', '운영 중', '일시 중단', '운영 종료'];
  var REQ_KINDS     = ['전기', '네트워크', '기자재', '시설', '안전', '물품', '주차', '기타'];
  var REQ_PRIORITY  = ['긴급', '높음', '보통'];
  var REQ_STATES    = ['접수', '확인 중', '처리 중', '완료'];

  /* 상태 → 배지 색. 색만으로 뜻을 전하지 않도록 글자는 항상 함께 씁니다. */
  var TONE = {
    '운영 중': 'ok', '준비 완료': 'info', '준비 전': 'warn',
    '일시 중단': 'danger', '운영 종료': 'off',
    '진행 중': 'ok', '예정': 'info', '종료': 'off', '취소': 'danger', '변경': 'warn',
    '긴급': 'danger', '중요': 'warn', '일반': 'info',
    '높음': 'warn', '보통': 'info',
    '접수': 'warn', '확인 중': 'info', '처리 중': 'info', '완료': 'ok'
  };
  function badge(text, extra) {
    var t = TONE[text] || 'off';
    return '<span class="badge badge--' + t + (extra ? ' ' + extra : '') + '">' + esc(text) + '</span>';
  }

  /* ── 상태 ───────────────────────────────────────────────────── */
  var S = {
    settings: null, schedule: [], booths: [], zones: [], notices: [],
    requests: [], resources: [], contacts: [], places: [], faqs: [],
    error: null, loading: false
  };
  var view = 'dashboard';
  var ui = { boothQ: '', boothStatus: '전체', boothZone: '전체',
             schedCat: '전체', schedQ: '', reqStatus: '전체',
             contactQ: '', contactCat: '전체' };
  var clockTimer = null;

  /* ── 알림 ───────────────────────────────────────────────────── */
  var toastTimer;
  function toast(msg, isError) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('is-error', !!isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, isError ? 5200 : 2400);
  }

  /* ── 드로어 ─────────────────────────────────────────────────── */
  var lastFocus = null;
  function openDrawer(title, html) {
    lastFocus = document.activeElement;
    $('#drawer-title').textContent = title;
    $('#drawer-body').innerHTML = html;
    $('#drawer').hidden = false;
    document.body.style.overflow = 'hidden';
    var f = $('#drawer-body button, #drawer-body a, #drawer-body input') || $('#drawer .iconbtn');
    if (f) f.focus();
  }
  function closeDrawer() {
    $('#drawer').hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function openSheet() {
    lastFocus = document.activeElement;
    $('#sheet').hidden = false;
    document.body.style.overflow = 'hidden';
    var f = $('#sheetnav a');
    if (f) f.focus();
  }
  function closeSheet() {
    $('#sheet').hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* ── 행사 시각 계산 ─────────────────────────────────────────── */
  function eventInfo() {
    var s = S.settings || {};
    var start = s.event_start ? new Date(s.event_start) : null;
    var end = s.event_end ? new Date(s.event_end) : (start ? new Date(start.getTime() + 7 * 3600000) : null);
    var now = new Date();
    if (!start) return { phase: 'unknown', now: now };

    var sameDay = start.toDateString() === now.toDateString();
    var phase = 'before';
    if (now > end) phase = 'after';
    else if (now >= start || sameDay) phase = 'during';

    var days = Math.ceil((new Date(start.getFullYear(), start.getMonth(), start.getDate()) -
                          new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    return { phase: phase, start: start, end: end, now: now, sameDay: sameDay, dday: days };
  }

  /* 일정 하나의 실시간 상태. 행사 당일에만 시각으로 계산합니다. */
  function liveStatus(item, ev) {
    if (item.status === '취소' || item.status === '변경') return item.status;
    if (!ev.sameDay) return item.status || '예정';
    var nowMin = ev.now.getHours() * 60 + ev.now.getMinutes();
    var a = C.toMin(item.start_time), b = C.toMin(item.end_time);
    if (a == null) return item.status || '예정';
    if (b == null) b = a + 30;
    if (nowMin < a) return '예정';
    if (nowMin >= b) return '종료';
    return '진행 중';
  }

  function nowNext(ev) {
    var list = S.schedule.filter(function (i) { return i.status !== '취소'; });
    if (!ev.sameDay) {
      return { live: null, next: list[0] || null, gap: null, preview: true };
    }
    var nowMin = ev.now.getHours() * 60 + ev.now.getMinutes();
    var live = null, next = null;
    list.forEach(function (i) {
      var a = C.toMin(i.start_time), b = C.toMin(i.end_time);
      if (a == null) return;
      if (b == null) b = a + 30;
      if (nowMin >= a && nowMin < b && !live) live = i;
      if (a > nowMin && (!next || a < C.toMin(next.start_time))) next = i;
    });
    var gap = next ? C.toMin(next.start_time) - nowMin : null;
    return { live: live, next: next, gap: gap, preview: false };
  }

  /* ── 데이터 ─────────────────────────────────────────────────── */
  function loadAll() {
    S.loading = true; S.error = null;
    return Promise.all([
      C.select('settings', { order: [['id', true]] }),
      C.select('schedule_items'),
      C.select('zones'),
      C.select('booths'),
      C.select('notices', { order: [['pinned', false], ['created_at', false]] }),
      C.select('operation_requests', { order: [['created_at', false]] }),
      C.select('resources'),
      C.select('contacts'),
      C.select('venue_places'),
      C.select('faqs')
    ]).then(function (r) {
      S.settings = r[0][0] || {};
      S.schedule = r[1]; S.zones = r[2]; S.booths = r[3]; S.notices = r[4];
      S.requests = r[5]; S.resources = r[6]; S.contacts = r[7];
      S.places = r[8]; S.faqs = r[9];
      S.loading = false;
    }).catch(function (e) {
      S.loading = false;
      S.error = C.dataMessage(e);
      console.error('[portal] 데이터 로드 실패', e);
    });
  }

  /* ── 공통 조각 ──────────────────────────────────────────────── */
  function stateBox(msg, kind, retry) {
    return '<div class="state' + (kind === 'error' ? ' state--error' : '') + '">' + esc(msg) +
      (retry ? '<div class="state__act"><button class="btn btn--ghost btn--sm" type="button" data-retry>다시 시도</button></div>' : '') +
      '</div>';
  }
  function pageHead(title, desc, actions) {
    return '<div class="page__head"><div><h1 class="page__title">' + esc(title) + '</h1>' +
      (desc ? '<p class="page__desc">' + esc(desc) + '</p>' : '') + '</div>' +
      (actions ? '<div class="page__actions">' + actions + '</div>' : '') + '</div>';
  }
  function chips(items, active, attr) {
    return '<div class="chiprow" role="group">' + items.map(function (it) {
      var label = typeof it === 'string' ? it : it.label;
      var n = typeof it === 'string' ? null : it.n;
      return '<button class="chip' + (label === active ? ' is-on' : '') + '" type="button" ' +
        attr + '="' + esc(label) + '" aria-pressed="' + (label === active) + '">' + esc(label) +
        (n != null ? '<span class="chip__n">' + n + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }

  /* ── 화면: 대시보드 ─────────────────────────────────────────── */
  function viewDashboard() {
    var ev = eventInfo();
    var s = S.settings || {};
    var nn = nowNext(ev);

    var phaseHtml = ev.phase === 'during'
      ? '<div class="hero__dday">행사 진행 중</div><div class="hero__now">현재 ' +
        C.pad2(ev.now.getHours()) + ':' + C.pad2(ev.now.getMinutes()) + '</div>'
      : ev.phase === 'after'
        ? '<div class="hero__dday">행사 종료</div>'
        : '<div class="hero__dday">D-' + Math.max(0, ev.dday) + '</div><div class="hero__now">' +
          C.fmtDateTime(ev.now) + '</div>';

    var hero = '<section class="hero"><div><div class="hero__name">' +
      esc(s.event_title || '2026년 인천 AI·SW미래채움 교육페스티벌') + '</div>' +
      '<div class="hero__meta">' + esc(s.date_label || '') +
      (s.time_label ? ' · ' + esc(s.time_label) : '') +
      (s.venue ? ' · ' + esc(s.venue) : '') + '</div></div>' +
      '<div class="hero__state">' + phaseHtml + '</div></section>';

    /* 긴급 공지 — 있으면 최상단 */
    var urgent = S.notices.filter(function (n) { return n.level === '긴급'; });
    var urgentHtml = urgent.length
      ? '<section class="card notice--urgent card__pad" style="border-radius:var(--r)">' +
        '<div class="notice__top">' + badge('긴급') +
        '<span class="notice__meta">' + esc(fmtWhen(urgent[0].updated_at || urgent[0].created_at)) + ' 업데이트</span></div>' +
        '<h2 class="notice__title" style="margin-top:6px">' + esc(urgent[0].title) + '</h2>' +
        '<p class="notice__body" style="-webkit-line-clamp:3">' + esc(urgent[0].body) + '</p>' +
        '<div style="margin-top:10px"><button class="btn btn--ghost btn--sm" type="button" data-go="notices">공지 전체 보기' +
        (urgent.length > 1 ? ' (긴급 ' + urgent.length + '건)' : '') + '</button></div></section>'
      : '';

    /* 운영 숫자 — 전부 DB 집계 */
    var byStatus = {};
    BOOTH_STATES.forEach(function (st) { byStatus[st] = S.booths.filter(function (b) { return b.status === st; }).length; });
    var openReq = S.requests.filter(function (r) { return r.status !== '완료'; }).length;
    var todayCount = S.schedule.filter(function (i) { return i.status !== '취소'; }).length;
    var runningCount = ev.sameDay
      ? S.schedule.filter(function (i) { return liveStatus(i, ev) === '진행 중'; }).length : 0;

    var stats = [
      { n: S.booths.length, l: '전체 부스', go: 'booths', f: null },
      { n: byStatus['운영 중'], l: '운영 중', go: 'booths', f: '운영 중', tone: 'ok' },
      { n: byStatus['준비 전'] + byStatus['준비 완료'], l: '준비 중', go: 'booths', f: '준비 전', tone: 'warn' },
      { n: byStatus['일시 중단'], l: '일시 중단', go: 'booths', f: '일시 중단', tone: 'danger' },
      { n: todayCount, l: '행사 일정', go: 'schedule', f: null },
      { n: runningCount, l: '진행 중 일정', go: 'schedule', f: null, tone: 'ok' },
      { n: urgent.length, l: '긴급 공지', go: 'notices', f: null, tone: urgent.length ? 'danger' : null },
      { n: openReq, l: '미처리 요청', go: 'requests', f: '미완료', tone: openReq ? 'warn' : null }
    ];
    var statsHtml = '<div class="statgrid">' + stats.map(function (st) {
      return '<button class="stat' + (st.tone ? ' stat--' + st.tone : '') + '" type="button" data-go="' + st.go + '"' +
        (st.f ? ' data-filter="' + esc(st.f) + '"' : '') + '>' +
        '<span class="stat__n">' + st.n + '</span><span class="stat__l">' + esc(st.l) + '</span></button>';
    }).join('') + '</div>';

    /* 지금 / 다음 */
    var nowHtml;
    if (nn.preview) {
      nowHtml = '<section class="card card__pad nowcard nowcard--idle">' +
        '<div class="nowcard__kicker">행사 당일 안내</div>' +
        '<p class="nowcard__meta" style="margin-top:6px">행사 당일이 되면 현재 시각 기준으로 진행 중인 일정이 여기에 표시됩니다.</p>' +
        (nn.next ? '<div class="nowcard__time" style="margin-top:10px">' + esc(nn.next.start_time || nn.next.time_label) + '</div>' +
          '<div class="nowcard__title">' + esc(nn.next.title) + '</div>' +
          '<div class="nowcard__meta">' + esc(nn.next.place || '') + '</div>' : '') +
        '</section>';
    } else if (nn.live) {
      nowHtml = '<section class="card card__pad nowcard">' +
        '<div class="nowcard__kicker">지금 진행 중</div>' +
        '<div class="nowcard__time">' + esc(nn.live.start_time) + '–' + esc(nn.live.end_time) + '</div>' +
        '<div class="nowcard__title">' + esc(nn.live.title) + '</div>' +
        '<div class="nowcard__meta">' + esc(nn.live.place || '') +
        (nn.live.team ? ' · 담당 ' + esc(nn.live.team) : '') + '</div></section>';
    } else {
      nowHtml = '<section class="card card__pad nowcard nowcard--idle">' +
        '<div class="nowcard__kicker">현재 진행 중인 일정 없음</div>' +
        '<p class="nowcard__meta" style="margin-top:6px">' +
        (nn.gap != null ? '다음 일정까지 ' + C.minLabel(nn.gap) + ' 남았습니다.' : '남은 일정이 없습니다.') +
        '</p></section>';
    }
    if (nn.next && !nn.preview) {
      nowHtml += '<section class="card card__pad nowcard nowcard--idle">' +
        '<div class="nowcard__kicker">다음 일정</div>' +
        '<div class="nowcard__time">' + esc(nn.next.start_time) + '</div>' +
        '<div class="nowcard__title">' + esc(nn.next.title) + '</div>' +
        '<div class="nowcard__meta">' + esc(nn.next.place || '') + '</div>' +
        (nn.gap != null ? '<div class="nowcard__left">' + C.minLabel(nn.gap) + ' 후</div>' : '') +
        '</section>';
    }

    return '<div class="page">' + hero + urgentHtml + statsHtml + nowHtml +
      '<div class="page__actions" style="margin-left:0"><button class="btn btn--primary" type="button" data-newreq>+ 현장 문제 보고</button>' +
      '<button class="btn btn--ghost" type="button" data-go="contacts">연락망</button></div>' +
      '</div>';
  }

  function fmtWhen(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return C.pad2(d.getHours()) + ':' + C.pad2(d.getMinutes());
  }
  function fmtDay(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + C.pad2(d.getHours()) + ':' + C.pad2(d.getMinutes());
  }

  /* ── 화면: 일정 ─────────────────────────────────────────────── */
  function viewSchedule() {
    var ev = eventInfo();
    var cats = ['전체'].concat(SCHEDULE_CATS).map(function (c) {
      return { label: c, n: c === '전체' ? S.schedule.length : S.schedule.filter(function (i) { return i.category === c; }).length };
    });
    var q = ui.schedQ.trim().toLowerCase();
    var list = S.schedule.filter(function (i) {
      if (ui.schedCat !== '전체' && i.category !== ui.schedCat) return false;
      if (!q) return true;
      return (i.title + ' ' + (i.place || '') + ' ' + (i.team || '') + ' ' + (i.owner || '')).toLowerCase().indexOf(q) >= 0;
    });

    var body = list.length ? '<div class="tl">' + list.map(function (i) {
      var st = liveStatus(i, ev);
      var cls = st === '진행 중' ? ' tlitem--now' : st === '종료' ? ' tlitem--done' : '';
      if (st === '취소' || st === '변경') cls = ' tlitem--off';
      return '<article class="tlitem' + cls + '">' +
        '<div class="tlitem__time">' + esc(i.start_time || '') +
        (i.end_time ? '–' + esc(i.end_time) : '') + '</div>' +
        '<div class="tlitem__body"><h3 class="tlitem__title">' + esc(i.title) + '</h3>' +
        '<p class="tlitem__meta">' + esc(i.place || '장소 미정') +
        (i.team ? ' · ' + esc(i.team) : '') + (i.owner ? ' · ' + esc(i.owner) : '') + '</p>' +
        (i.memo ? '<p class="tlitem__memo">' + esc(i.memo) + '</p>' : '') +
        '<div class="tlitem__tags">' + badge(st) +
        '<span class="badge badge--plain">' + esc(i.category) + '</span></div></div></article>';
    }).join('') + '</div>' : stateBox('조건에 맞는 일정이 없습니다.');

    return '<div class="page">' +
      pageHead('운영 일정', ev.sameDay ? '현재 시각 기준으로 진행 중인 일정이 강조됩니다.' : '행사 당일에는 현재 진행 중인 일정이 자동으로 강조됩니다.') +
      '<div class="tools"><div class="search"><label class="sr-only" for="sched-q">일정 검색</label>' +
      '<input class="input" id="sched-q" type="search" placeholder="일정·장소·담당 검색" value="' + esc(ui.schedQ) + '" /></div>' +
      chips(cats, ui.schedCat, 'data-schedcat') + '</div>' + body + '</div>';
  }

  /* ── 화면: 부스 현황 ────────────────────────────────────────── */
  function viewBooths() {
    var counts = { 전체: S.booths.length };
    BOOTH_STATES.forEach(function (st) { counts[st] = S.booths.filter(function (b) { return b.status === st; }).length; });
    var statusChips = ['전체'].concat(BOOTH_STATES).map(function (c) { return { label: c, n: counts[c] }; });

    var zoneLabels = ['전체'].concat(S.zones.map(function (z) { return z.key + '존'; }));
    var q = ui.boothQ.trim().toLowerCase();

    var list = S.booths.filter(function (b) {
      if (ui.boothStatus !== '전체' && b.status !== ui.boothStatus) return false;
      if (ui.boothZone !== '전체' && (b.zone_key + '존') !== ui.boothZone) return false;
      if (!q) return true;
      return ((b.code || '') + ' ' + b.name + ' ' + (b.org || '') + ' ' + (b.program || '') + ' ' + (b.manager || ''))
        .toLowerCase().indexOf(q) >= 0;
    });

    var body = list.length ? '<div class="boothgrid">' + list.map(function (b) {
      return '<button class="booth" type="button" data-booth="' + esc(b.id) + '">' +
        '<span class="booth__top"><span class="booth__code">' + esc(b.code || (b.zone_key + '-' + b.no)) + '</span>' +
        badge(b.status || '준비 전') + '</span>' +
        '<span class="booth__name">' + esc(b.name) + '</span>' +
        '<span class="booth__org">' + esc(b.org || '운영기관 미정') + '</span>' +
        '<span class="booth__tags">' +
        (b.manager ? '<span class="tag">담당 ' + esc(b.manager) + '</span>' : '') +
        (b.needs_power ? '<span class="tag">전기</span>' : '') +
        (b.needs_network ? '<span class="tag">네트워크</span>' : '') +
        '</span></button>';
    }).join('') + '</div>' : stateBox('조건에 맞는 부스가 없습니다.');

    return '<div class="page">' +
      pageHead('부스 운영 현황', '카드를 누르면 상세와 상태 변경을 할 수 있습니다.') +
      '<div class="tools"><div class="search"><label class="sr-only" for="booth-q">부스 검색</label>' +
      '<input class="input" id="booth-q" type="search" placeholder="부스번호 · 학교 · 기관 · 프로그램 검색" value="' + esc(ui.boothQ) + '" /></div>' +
      chips(statusChips, ui.boothStatus, 'data-boothstatus') +
      chips(zoneLabels, ui.boothZone, 'data-boothzone') + '</div>' + body + '</div>';
  }

  function boothDetail(id) {
    var b = S.booths.filter(function (x) { return x.id === id; })[0];
    if (!b) return;
    var z = S.zones.filter(function (x) { return x.key === b.zone_key; })[0];
    var rows = [
      ['부스 번호', b.code || (b.zone_key + '-' + b.no)],
      ['부스명', b.name],
      ['운영기관', b.org],
      ['구역', z ? z.key + '존 · ' + z.label : b.zone_key],
      ['담당자', b.manager],
      ['운영 프로그램', b.program],
      ['운영 시간', b.hours],
      ['전기 사용', b.needs_power ? '필요' : '불필요'],
      ['네트워크', b.needs_network ? '필요' : '불필요'],
      ['필요 물품', b.supplies],
      ['운영 메모', b.memo],
      ['특이사항', b.notes]
    ].filter(function (r) { return r[1]; });

    var html = '<div><div class="notice__top">' + badge(b.status || '준비 전') +
      '<span class="notice__meta">최근 변경 ' + esc(fmtDay(b.updated_at)) + '</span></div></div>';

    if (b.manager_phone) {
      html += '<a class="btn btn--primary btn--full" href="' + esc(C.telHref(b.manager_phone)) + '">' +
        '담당자에게 전화 · ' + esc(b.manager_phone) + '</a>';
    }

    html += '<dl class="dl">' + rows.map(function (r) {
      return '<div class="dl__row"><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
    }).join('') + '</dl>';

    html += '<div><p class="field__label" style="margin-bottom:8px">운영 상태 변경</p><div class="statusgrid">' +
      BOOTH_STATES.map(function (st) {
        return '<button class="btn ' + (st === b.status ? 'btn--primary' : 'btn--ghost') + ' btn--sm" type="button" ' +
          'data-setbooth="' + esc(b.id) + '" data-status="' + esc(st) + '">' + esc(st) + '</button>';
      }).join('') + '</div></div>';

    openDrawer(b.code || b.name, html);
  }

  /* ── 화면: 공지 ─────────────────────────────────────────────── */
  function viewNotices() {
    var list = S.notices.slice().sort(function (a, b) {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      var rank = { '긴급': 0, '중요': 1, '일반': 2 };
      if (rank[a.level] !== rank[b.level]) return rank[a.level] - rank[b.level];
      return new Date(b.created_at) - new Date(a.created_at);
    });
    var body = list.length ? '<div class="tl">' + list.map(function (n) {
      return '<button class="notice' + (n.level === '긴급' ? ' notice--urgent' : '') + '" type="button" data-notice="' + esc(n.id) + '">' +
        '<span class="notice__top">' + badge(n.level) +
        (n.pinned ? '<span class="badge badge--plain">고정</span>' : '') +
        '<span class="notice__meta">' + esc(fmtDay(n.created_at)) + '</span></span>' +
        '<span class="notice__title">' + esc(n.title) + '</span>' +
        '<span class="notice__body">' + esc(n.body) + '</span></button>';
    }).join('') + '</div>' : stateBox('등록된 공지가 없습니다.');
    return '<div class="page">' + pageHead('운영 공지', '긴급 공지는 대시보드 상단에도 표시됩니다.') + body + '</div>';
  }

  function noticeDetail(id) {
    var n = S.notices.filter(function (x) { return x.id === id; })[0];
    if (!n) return;
    openDrawer(n.title,
      '<div class="notice__top">' + badge(n.level) +
      (n.pinned ? '<span class="badge badge--plain">고정</span>' : '') + '</div>' +
      '<p style="font-size:15px;line-height:1.85;white-space:pre-wrap">' + esc(n.body) + '</p>' +
      '<dl class="dl">' +
      (n.author ? '<div class="dl__row"><dt>작성</dt><dd>' + esc(n.author) + '</dd></div>' : '') +
      '<div class="dl__row"><dt>등록</dt><dd>' + esc(fmtDay(n.created_at)) + '</dd></div>' +
      (n.updated_at && n.updated_at !== n.created_at ?
        '<div class="dl__row"><dt>수정</dt><dd>' + esc(fmtDay(n.updated_at)) + '</dd></div>' : '') +
      '</dl>');
  }

  /* ── 화면: 운영 요청 ────────────────────────────────────────── */
  function viewRequests() {
    var counts = { 전체: S.requests.length, 미완료: S.requests.filter(function (r) { return r.status !== '완료'; }).length };
    REQ_STATES.forEach(function (st) { counts[st] = S.requests.filter(function (r) { return r.status === st; }).length; });
    var cs = ['전체', '미완료'].concat(REQ_STATES).map(function (c) { return { label: c, n: counts[c] }; });

    var list = S.requests.filter(function (r) {
      if (ui.reqStatus === '전체') return true;
      if (ui.reqStatus === '미완료') return r.status !== '완료';
      return r.status === ui.reqStatus;
    });

    var body = list.length ? '<div class="tl">' + list.map(function (r) {
      return '<button class="req" type="button" data-req="' + esc(r.id) + '">' +
        '<span class="req__top">' + badge(r.priority) + badge(r.status) +
        '<span class="badge badge--plain">' + esc(r.kind) + '</span></span>' +
        '<span class="req__title">' + esc(r.title) + '</span>' +
        '<span class="req__meta">' + esc(r.location || '위치 미지정') + ' · ' + esc(fmtDay(r.created_at)) +
        (r.assignee_team ? ' · ' + esc(r.assignee_team) : '') + '</span></button>';
    }).join('') + '</div>' : stateBox('등록된 운영 요청이 없습니다.');

    return '<div class="page">' +
      pageHead('운영 요청', '현장에서 발생한 문제를 등록하고 처리 상태를 확인합니다.',
        '<button class="btn btn--primary btn--sm" type="button" data-newreq>+ 현장 문제 보고</button>') +
      '<div class="tools">' + chips(cs, ui.reqStatus, 'data-reqstatus') + '</div>' + body + '</div>';
  }

  function requestDetail(id) {
    var r = S.requests.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    var canManage = C.isAdmin();
    var html = '<div class="notice__top">' + badge(r.priority) + badge(r.status) +
      '<span class="badge badge--plain">' + esc(r.kind) + '</span></div>' +
      '<dl class="dl">' +
      '<div class="dl__row"><dt>위치</dt><dd>' + esc(r.location || '미지정') + '</dd></div>' +
      (r.body ? '<div class="dl__row"><dt>내용</dt><dd style="white-space:pre-wrap">' + esc(r.body) + '</dd></div>' : '') +
      (r.reporter ? '<div class="dl__row"><dt>등록자</dt><dd>' + esc(r.reporter) + '</dd></div>' : '') +
      '<div class="dl__row"><dt>등록</dt><dd>' + esc(fmtDay(r.created_at)) + '</dd></div>' +
      (r.assignee_team ? '<div class="dl__row"><dt>담당팀</dt><dd>' + esc(r.assignee_team) + '</dd></div>' : '') +
      '</dl>';
    if (canManage) {
      html += '<div><p class="field__label" style="margin-bottom:8px">처리 상태 변경</p><div class="statusgrid">' +
        REQ_STATES.map(function (st) {
          return '<button class="btn ' + (st === r.status ? 'btn--primary' : 'btn--ghost') + ' btn--sm" type="button" ' +
            'data-setreq="' + esc(r.id) + '" data-status="' + esc(st) + '">' + esc(st) + '</button>';
        }).join('') + '</div></div>';
    }
    openDrawer(r.title, html);
  }

  function openRequestForm() {
    var boothOpts = S.booths.map(function (b) {
      return '<option value="' + esc(b.code || b.name) + '">' + esc((b.code ? b.code + ' · ' : '') + b.name) + '</option>';
    }).join('');
    var me = C.me() || {};
    openDrawer('현장 문제 보고',
      '<form id="reqform" novalidate style="display:flex;flex-direction:column;gap:14px">' +
      '<div class="field"><label class="field__label" for="rq-loc">부스 또는 위치<span class="field__req">*</span></label>' +
      '<input class="input" id="rq-loc" list="boothlist" required placeholder="예: A-17 또는 야외무대 옆" />' +
      '<datalist id="boothlist">' + boothOpts + '</datalist></div>' +
      '<div class="field"><label class="field__label" for="rq-kind">유형</label>' +
      '<select class="select" id="rq-kind">' + REQ_KINDS.map(function (k) {
        return '<option value="' + esc(k) + '">' + esc(k) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label class="field__label" for="rq-pri">우선순위</label>' +
      '<select class="select" id="rq-pri">' + REQ_PRIORITY.map(function (p) {
        return '<option value="' + esc(p) + '"' + (p === '보통' ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label class="field__label" for="rq-title">제목<span class="field__req">*</span></label>' +
      '<input class="input" id="rq-title" required maxlength="80" placeholder="예: 멀티탭 전원이 들어오지 않음" /></div>' +
      '<div class="field"><label class="field__label" for="rq-body">내용</label>' +
      '<textarea class="textarea" id="rq-body" placeholder="상황을 간단히 적어 주세요."></textarea></div>' +
      '<div class="field"><label class="field__label" for="rq-by">등록자</label>' +
      '<input class="input" id="rq-by" value="' + esc(me.name || '') + '" /></div>' +
      '<p class="alert alert--error" id="rq-err" role="alert" hidden></p>' +
      '<button class="btn btn--primary btn--full" type="submit" id="rq-submit">등록</button>' +
      '</form>');
  }

  /* ── 화면: 자료실 · 연락망 · 행사장 · FAQ ───────────────────── */
  function viewResources() {
    var list = S.resources.filter(function (r) { return r.is_public !== false; });
    var body = list.length ? '<div class="tl">' + list.map(function (r) {
      return '<div class="rowcard"><div class="rowcard__body">' +
        '<div class="rowcard__name">' + esc(r.title) + '</div>' +
        '<div class="rowcard__meta">' + esc(r.category || '기타') +
        (r.description ? ' · ' + esc(r.description) : '') + '</div></div>' +
        '<div class="rowcard__act">' + (r.url
          ? '<a class="btn btn--ghost btn--sm" href="' + esc(r.url) + '" target="_blank" rel="noopener">열기</a>'
          : '<span class="badge badge--plain">준비 중</span>') + '</div></div>';
    }).join('') + '</div>' : stateBox('등록된 자료가 없습니다.');
    return '<div class="page">' + pageHead('관계자 자료실', '운영에 필요한 문서를 모아 둡니다.') + body + '</div>';
  }

  function viewContacts() {
    var cats = ['전체'].concat(S.contacts.reduce(function (a, c) {
      if (c.category && a.indexOf(c.category) < 0) a.push(c.category); return a; }, []));
    var q = ui.contactQ.trim().toLowerCase();
    var list = S.contacts.filter(function (c) {
      if (ui.contactCat !== '전체' && c.category !== ui.contactCat) return false;
      if (!q) return true;
      return (c.name + ' ' + (c.org || '') + ' ' + (c.duty || '') + ' ' + (c.category || '')).toLowerCase().indexOf(q) >= 0;
    });
    var body = list.length ? '<div class="tl">' + list.map(function (c) {
      return '<div class="rowcard"><div class="rowcard__body">' +
        '<div class="rowcard__name">' + esc(c.name) +
        (c.duty ? ' <span class="badge badge--plain">' + esc(c.duty) + '</span>' : '') + '</div>' +
        '<div class="rowcard__meta">' + esc(c.org || '') + (c.memo ? ' · ' + esc(c.memo) : '') + '</div></div>' +
        '<div class="rowcard__act">' + (c.phone
          ? '<a class="btn btn--primary btn--sm" href="' + esc(C.telHref(c.phone)) + '">전화</a>'
          : '<span class="badge badge--plain">번호 없음</span>') + '</div></div>';
    }).join('') + '</div>' : stateBox('조건에 맞는 연락처가 없습니다.');
    return '<div class="page">' + pageHead('운영 연락망', '전화 버튼을 누르면 바로 연결됩니다.') +
      '<div class="tools"><div class="search"><label class="sr-only" for="contact-q">연락처 검색</label>' +
      '<input class="input" id="contact-q" type="search" placeholder="이름 · 소속 · 담당업무 검색" value="' + esc(ui.contactQ) + '" /></div>' +
      (cats.length > 1 ? chips(cats, ui.contactCat, 'data-contactcat') : '') + '</div>' + body + '</div>';
  }

  function viewVenue() {
    var s = S.settings || {};
    var map = s.venue_map_url
      ? '<img src="' + esc(s.venue_map_url) + '" alt="행사장 배치도" style="border-radius:var(--r);border:1px solid var(--line)" />'
      : stateBox('배치도 준비 중입니다. 관리자 → 행사 기본정보에서 배치도 이미지 주소를 등록하면 여기에 표시됩니다.');
    var body = S.places.length ? '<div class="tl">' + S.places.map(function (p) {
      return '<div class="rowcard"><div class="rowcard__body">' +
        '<div class="rowcard__name">' + esc(p.name) + '</div>' +
        '<div class="rowcard__meta">' + esc(p.category || '') + (p.detail ? ' · ' + esc(p.detail) : '') + '</div>' +
        '</div></div>';
    }).join('') + '</div>' : stateBox('등록된 공간 정보가 없습니다.');
    return '<div class="page">' + pageHead('행사장 안내', esc(s.venue || '') + (s.venue_detail ? ' · ' + esc(s.venue_detail) : '')) +
      map + '<h2 class="section-title">주요 공간</h2>' + body + '</div>';
  }

  function viewFaq() {
    var list = S.faqs.filter(function (f) { return f.is_public !== false; });
    var body = list.length ? '<div class="tl">' + list.map(function (f, i) {
      return '<div class="faq" data-faq="' + i + '">' +
        '<button class="faq__q" type="button" aria-expanded="false"><span>' + esc(f.question) + '</span>' +
        '<span class="faq__sign" aria-hidden="true">+</span></button>' +
        '<div class="faq__a" hidden>' + esc(f.answer) + '</div></div>';
    }).join('') + '</div>' : stateBox('등록된 항목이 없습니다.');
    return '<div class="page">' + pageHead('운영 FAQ', '행사 준비와 당일 운영에서 자주 나오는 질문입니다.') + body + '</div>';
  }

  /* ── 라우터 ─────────────────────────────────────────────────── */
  var VIEWS = {
    dashboard: viewDashboard, schedule: viewSchedule, booths: viewBooths,
    notices: viewNotices, requests: viewRequests, resources: viewResources,
    contacts: viewContacts, venue: viewVenue, faq: viewFaq
  };

  function render() {
    var host = $('#view');
    if (S.loading) { host.innerHTML = stateBox('데이터를 불러오는 중입니다.'); return; }
    if (S.error)   { host.innerHTML = stateBox(S.error, 'error', true); return; }
    host.innerHTML = (VIEWS[view] || viewDashboard)();
    var nav = NAV.filter(function (n) { return n.id === view; })[0];
    $('#topbar-title').textContent = nav ? nav.label : '대시보드';
    document.title = (nav ? nav.label + ' · ' : '') + '행사 운영 포털';
    paintNav();
  }

  function paintNav() {
    var openReq = S.requests.filter(function (r) { return r.status !== '완료'; }).length;
    var urgent = S.notices.filter(function (n) { return n.level === '긴급'; }).length;
    function badgeFor(id) {
      if (id === 'requests' && openReq) return '<span class="nav__badge">' + openReq + '</span>';
      if (id === 'notices' && urgent) return '<span class="nav__badge">' + urgent + '</span>';
      return '';
    }
    $('#sidenav').innerHTML = NAV.map(function (n) {
      return '<a href="#' + n.id + '" class="' + (n.id === view ? 'is-on' : '') + '"' +
        (n.id === view ? ' aria-current="page"' : '') + '>' + esc(n.label) + badgeFor(n.id) + '</a>';
    }).join('') + (C.isAdmin() ? '<a href="admin.html">관리자</a>' : '');

    var tabs = NAV.filter(function (n) { return n.tab; });
    $('#tabbar').innerHTML = tabs.map(function (n) {
      var b = badgeFor(n.id);
      return '<a href="#' + n.id + '" class="' + (n.id === view ? 'is-on' : '') + '"' +
        (n.id === view ? ' aria-current="page"' : '') + '>' +
        '<span class="tab__dot">' + esc(n.mark) + '</span>' +
        (b ? '<span class="tab__badge">' + (n.id === 'requests' ? openReq : urgent) + '</span>' : '') +
        '<span>' + esc(n.short) + '</span></a>';
    }).join('') +
      '<button type="button" data-open-sheet><span class="tab__dot">⋯</span><span>더보기</span></button>';

    $('#sheetnav').innerHTML = NAV.filter(function (n) { return !n.tab; }).map(function (n) {
      return '<a href="#' + n.id + '" class="' + (n.id === view ? 'is-on' : '') + '">' + esc(n.label) + '</a>';
    }).join('') + (C.isAdmin() ? '<a href="admin.html">관리자</a>' : '');

    var me = C.me() || {};
    $('#side-who').innerHTML = esc(me.name || me.email || '') +
      '<br /><span class="badge badge--plain">' + (C.isAdmin() ? '관리자' : '관계자') + '</span>';
  }

  function routeFromHash() {
    var id = (location.hash || '').replace(/^#/, '');
    return VIEWS[id] ? id : 'dashboard';
  }

  function go() {
    view = routeFromHash();
    render();
    window.scrollTo({ top: 0, behavior: 'instant' });
    closeSheet();
    $('#main').focus({ preventScroll: true });
  }

  /* ── 이벤트 ─────────────────────────────────────────────────── */
  function bind() {
    window.addEventListener('hashchange', go);

    $$('[data-signout]').forEach(function (b) {
      b.addEventListener('click', function () {
        C.signOut().then(function () { location.reload(); });
      });
    });

    document.addEventListener('click', function (e) {
      var t = e.target;

      if (t.closest('[data-open-sheet]')) { openSheet(); return; }
      if (t.closest('[data-close-sheet]')) { closeSheet(); return; }
      if (t.closest('[data-close-drawer]')) { closeDrawer(); return; }
      if (t.closest('[data-retry]')) { boot(true); return; }

      var go2 = t.closest('[data-go]');
      if (go2) {
        var f = go2.getAttribute('data-filter');
        if (f && go2.dataset.go === 'booths') ui.boothStatus = f === '준비 전' ? '준비 전' : f;
        if (f && go2.dataset.go === 'requests') ui.reqStatus = f;
        location.hash = '#' + go2.dataset.go;
        return;
      }

      var chip = t.closest('[data-boothstatus],[data-boothzone],[data-schedcat],[data-reqstatus],[data-contactcat]');
      if (chip) {
        if (chip.hasAttribute('data-boothstatus')) ui.boothStatus = chip.getAttribute('data-boothstatus');
        if (chip.hasAttribute('data-boothzone'))   ui.boothZone   = chip.getAttribute('data-boothzone');
        if (chip.hasAttribute('data-schedcat'))    ui.schedCat    = chip.getAttribute('data-schedcat');
        if (chip.hasAttribute('data-reqstatus'))   ui.reqStatus   = chip.getAttribute('data-reqstatus');
        if (chip.hasAttribute('data-contactcat'))  ui.contactCat  = chip.getAttribute('data-contactcat');
        render();
        return;
      }

      var bo = t.closest('[data-booth]');   if (bo) { boothDetail(bo.getAttribute('data-booth')); return; }
      var no = t.closest('[data-notice]');  if (no) { noticeDetail(no.getAttribute('data-notice')); return; }
      var rq = t.closest('[data-req]');     if (rq) { requestDetail(rq.getAttribute('data-req')); return; }
      if (t.closest('[data-newreq]')) { openRequestForm(); return; }

      var sb = t.closest('[data-setbooth]');
      if (sb) { setBoothStatus(sb.getAttribute('data-setbooth'), sb.getAttribute('data-status'), sb); return; }

      var sr = t.closest('[data-setreq]');
      if (sr) { setReqStatus(sr.getAttribute('data-setreq'), sr.getAttribute('data-status'), sr); return; }

      var fq = t.closest('.faq__q');
      if (fq) {
        var box = fq.closest('.faq');
        var open = box.classList.toggle('is-open');
        fq.setAttribute('aria-expanded', String(open));
        $('.faq__a', box).hidden = !open;
        $('.faq__sign', box).textContent = open ? '+' : '+';
        return;
      }
    });

    document.addEventListener('input', function (e) {
      if (e.target.id === 'booth-q')   { ui.boothQ = e.target.value; softRender('#booth-q'); }
      if (e.target.id === 'sched-q')   { ui.schedQ = e.target.value; softRender('#sched-q'); }
      if (e.target.id === 'contact-q') { ui.contactQ = e.target.value; softRender('#contact-q'); }
    });

    document.addEventListener('submit', function (e) {
      if (e.target.id === 'reqform') { e.preventDefault(); submitRequest(); }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('#drawer').hidden) closeDrawer();
      else if (!$('#sheet').hidden) closeSheet();
    });
  }

  /* 검색어 입력 중에는 포커스와 커서를 유지해야 합니다. */
  function softRender(sel) {
    var el = $(sel);
    var pos = el ? el.selectionStart : null;
    render();
    var again = $(sel);
    if (again) { again.focus(); if (pos != null) try { again.setSelectionRange(pos, pos); } catch (x) {} }
  }

  /* ── 쓰기 동작 ──────────────────────────────────────────────── */
  function setBoothStatus(id, status, btn) {
    btn.disabled = true;
    C.update('booths', id, { status: status }).then(function (row) {
      S.booths = S.booths.map(function (b) { return b.id === id ? row : b; });
      toast('부스 상태를 “' + status + '”(으)로 바꿨습니다.');
      boothDetail(id);
      render();
    }).catch(function (e) {
      toast(C.dataMessage(e), true);
      console.error('[portal] 부스 상태 변경 실패', e);
    }).then(function () { btn.disabled = false; });
  }

  function setReqStatus(id, status, btn) {
    btn.disabled = true;
    C.update('operation_requests', id, { status: status }).then(function (row) {
      S.requests = S.requests.map(function (r) { return r.id === id ? row : r; });
      toast('처리 상태를 “' + status + '”(으)로 바꿨습니다.');
      requestDetail(id);
      render();
    }).catch(function (e) {
      toast(C.dataMessage(e), true);
      console.error('[portal] 요청 상태 변경 실패', e);
    }).then(function () { btn.disabled = false; });
  }

  function submitRequest() {
    var loc = $('#rq-loc'), title = $('#rq-title'), err = $('#rq-err'), btn = $('#rq-submit');
    err.hidden = true;
    loc.setAttribute('aria-invalid', 'false');
    title.setAttribute('aria-invalid', 'false');

    if (!loc.value.trim() || !title.value.trim()) {
      err.textContent = '부스 또는 위치와 제목은 반드시 입력해 주세요.';
      err.hidden = false;
      if (!loc.value.trim()) { loc.setAttribute('aria-invalid', 'true'); loc.focus(); }
      else { title.setAttribute('aria-invalid', 'true'); title.focus(); }
      return;
    }

    btn.disabled = true; btn.textContent = '등록 중…';
    var me = C.me() || {};
    C.insert('operation_requests', {
      location: loc.value.trim(),
      kind: $('#rq-kind').value,
      priority: $('#rq-pri').value,
      title: title.value.trim(),
      body: $('#rq-body').value.trim(),
      reporter: $('#rq-by').value.trim() || me.name || '',
      reporter_id: me.id || null,
      status: '접수'
    }).then(function (row) {
      S.requests.unshift(row);
      closeDrawer();
      toast('운영 요청을 등록했습니다.');
      if (view !== 'requests') location.hash = '#requests'; else render();
    }).catch(function (e) {
      err.textContent = C.dataMessage(e);
      err.hidden = false;
      console.error('[portal] 요청 등록 실패', e);
    }).then(function () {
      btn.disabled = false; btn.textContent = '등록';
    });
  }

  /* ── 시계 ───────────────────────────────────────────────────── */
  function startClock() {
    if (clockTimer) clearInterval(clockTimer);
    function tick() {
      var d = new Date();
      $('#topbar-clock').textContent = C.pad2(d.getHours()) + ':' + C.pad2(d.getMinutes());
      if (view === 'dashboard' && d.getSeconds() % 30 === 0) render();
    }
    tick();
    clockTimer = setInterval(tick, 1000);
  }

  /* ── 시작 ───────────────────────────────────────────────────── */
  var GATES = ['gate-setup', 'gate-login', 'gate-setpw'];

  function showGate(id) {
    GATES.forEach(function (g) { $('#' + g).hidden = g !== id; });
    $('#app').hidden = true;
  }

  function showApp() {
    GATES.forEach(function (g) { $('#' + g).hidden = true; });
    $('#app').hidden = false;
  }

  function boot(reload) {
    if (!C.isConfigured()) { showGate('gate-setup'); return; }

    C.session().then(function (sess) {
      if (!sess) { showGate('gate-login'); return; }

      // 초대 메일이나 재설정 링크를 타고 들어왔다면, 먼저 비밀번호를
      // 정해야 합니다. 이 단계를 건너뛰면 다음 로그인이 불가능합니다.
      if (C.invitedEntry()) {
        history.replaceState(null, '', location.pathname);
        showGate('gate-setpw');
        var f = $('#setpw-1');
        if (f) f.focus();
        return;
      }
      return C.fetchProfile(sess.user.id).then(function (p) {
        if (!p) {
          // 조회가 실패한 것뿐이라면 로그아웃시키지 않습니다.
          // 네트워크가 잠깐 끊겼다고 사용자를 내보내면 안 됩니다.
          if (C.profileFailed()) {
            showApp();
            S.error = C.accessMessage();
            render();
            return;
          }
          return C.signOut().then(function () {
            showGate('gate-login');
            var e = $('#login-error');
            e.textContent = C.accessMessage();
            e.hidden = false;
          });
        }
        showApp();
        S.loading = true;
        view = routeFromHash();
        render();
        return loadAll().then(function () {
          go();
          startClock();
        });
      });
    });
  }

  /* 초대 수락 — 비밀번호 설정 */
  $('#setpwform').addEventListener('submit', function (e) {
    e.preventDefault();
    var a = $('#setpw-1'), b = $('#setpw-2');
    var err = $('#setpw-error'), btn = $('#setpw-btn');
    err.hidden = true;
    a.setAttribute('aria-invalid', 'false');
    b.setAttribute('aria-invalid', 'false');

    if (a.value.length < 6) {
      err.textContent = '비밀번호는 6자 이상이어야 합니다.';
      err.hidden = false;
      a.setAttribute('aria-invalid', 'true');
      a.focus();
      return;
    }
    if (a.value !== b.value) {
      err.textContent = '두 비밀번호가 서로 다릅니다.';
      err.hidden = false;
      b.setAttribute('aria-invalid', 'true');
      b.focus();
      return;
    }

    btn.disabled = true;
    btn.textContent = '저장 중…';
    C.setPassword(a.value).then(function () {
      a.value = ''; b.value = '';
      boot();
    }).catch(function (e2) {
      console.error('[portal] 비밀번호 설정 실패', e2);
      err.textContent = C.authMessage(e2);
      err.hidden = false;
    }).then(function () {
      btn.disabled = false;
      btn.textContent = '시작하기';
    });
  });

  /* 로그인 폼 */
  $('#loginform').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('#login-email'), pw = $('#login-pw');
    var err = $('#login-error'), btn = $('#login-btn');
    err.hidden = true;
    email.setAttribute('aria-invalid', 'false');
    pw.setAttribute('aria-invalid', 'false');

    if (!email.value.trim() || !pw.value) {
      err.textContent = '이메일과 비밀번호를 모두 입력해 주세요.';
      err.hidden = false;
      (!email.value.trim() ? email : pw).focus();
      return;
    }

    btn.disabled = true; btn.textContent = '확인 중…';
    C.signIn(email.value.trim(), pw.value).then(function () {
      pw.value = '';
      boot();
    }).catch(function (e2) {
      err.textContent = C.authMessage(e2);
      err.hidden = false;
      pw.focus();
    }).then(function () {
      btn.disabled = false; btn.textContent = '관계자 로그인';
    });
  });

  bind();
  boot();
})();
