/* ===================================================================
   2026년 인천 AI·SW미래채움 교육페스티벌 — 행사 운영 포털

   화면 구성은 해시 라우팅입니다(#dashboard, #booths …).
   모든 데이터는 Supabase 에서 옵니다.

   이 화면에는 로그인이 없습니다. 주소를 아는 관계자는 바로 들어와
   열람하고, 운영 요청 등록 · 해결 완료와 담당 업무 시작/완료를 할 수 있습니다.
   그 밖의 편집은 전부 /admin 에서 관리자만 합니다 — 화면에서
   감추는 게 아니라 데이터베이스 정책이 막습니다.
   =================================================================== */
(function () {
  'use strict';

  var C = window.Core;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = C.esc;

  /* ── 메뉴 ─────────────────────────────────────────────────────
     메뉴가 늘어나 한 줄로 나열하면 무엇부터 봐야 할지 알 수 없게
     됩니다. 세 갈래로 묶습니다.

       (그룹 없음) 행사 당일 계속 들여다보는 화면 — 하단 탭에도 둡니다
       운영        현장에서 처리하는 일
       정보        필요할 때 찾아보는 자료

     하단 탭은 그대로 네 개만 둡니다. 손가락이 닿는 자리는 한정돼
     있어서, 늘어난 메뉴를 전부 밀어 넣으면 오히려 못 누릅니다.
     나머지는 '더보기' 시트에서 그룹 제목과 함께 보여 줍니다. */
  var NAV = [
    // 주소(#dashboard)는 그대로 둡니다. 이미 나눠 쓰는 링크가 있고,
    // 바꿔서 얻는 것이 없습니다. 보이는 이름만 '홈' 입니다.
    { id: 'dashboard', label: '홈', short: '홈', mark: '홈', tab: true },
    { id: 'schedule',  label: '일정',     short: '일정', mark: '일', tab: true },
    { id: 'booths',    label: '부스 현황', short: '부스', mark: '부', tab: true },
    { id: 'notices',   label: '공지',     short: '공지', mark: '공', tab: true },
    { id: 'requests',  label: '운영 요청', short: '요청', mark: '요', group: '운영' },
    { id: 'tasks',     label: '담당 업무', short: '업무', mark: '업', group: '운영' },
    { id: 'supplies',  label: '운영 물품', short: '물품', mark: '물', group: '운영' },
    { id: 'resources', label: '자료실',   short: '자료', mark: '자', group: '정보' },
    { id: 'contacts',  label: '연락망',   short: '연락', mark: '연', group: '정보' },
    { id: 'venue',     label: '행사장',   short: '행사장', mark: '장', group: '정보' },
    { id: 'faq',       label: '운영 FAQ', short: 'FAQ',  mark: 'F', group: '정보' }
  ];
  var NAV_GROUPS = ['운영', '정보'];

  var SCHEDULE_CATS = ['무대', '강연', '부스', '운영', '행사 지원'];
  /* 새 요청에서 고를 수 있는 유형입니다. 이미 등록된 요청의 유형은
     이 목록과 상관없이 그대로 표시됩니다(r.kind 를 그대로 씁니다). */
  var REQ_KINDS     = ['전기', '네트워크', '기자재', '시설', '안전', '물품', '기타'];
  var REQ_PRIORITY  = ['긴급', '높음', '보통'];
  var SUPPLY_STATES = ['미배부', '일부 배부', '배부 완료'];

  /* 상태 → 배지 색. 색만으로 뜻을 전하지 않도록 글자는 항상 함께 씁니다. */
  var TONE = {
    '운영 중': 'ok', '준비 완료': 'info', '준비 전': 'warn',
    '일시 중단': 'danger', '운영 종료': 'off',
    '진행 중': 'ok', '예정': 'info', '종료': 'off', '취소': 'danger', '변경': 'warn',
    '긴급': 'danger', '중요': 'warn', '일반': 'info',
    '높음': 'warn', '보통': 'info',
    '접수': 'warn', '확인 중': 'info', '처리 중': 'info', '완료': 'ok',
    '미배부': 'warn', '일부 배부': 'info', '배부 완료': 'ok'
  };
  function badge(text, extra) {
    var t = TONE[text] || 'off';
    return '<span class="badge badge--' + t + (extra ? ' ' + extra : '') + '">' + esc(text) + '</span>';
  }

  /* ── 상태 ───────────────────────────────────────────────────── */
  var S = {
    settings: null, schedule: [], booths: [], zones: [], notices: [],
    requests: [], resources: [], contacts: [], places: [], faqs: [],
    tasks: [], assigns: [], supplyItems: [], supplyTargets: [], supplyAllocs: [],
    error: null, loading: false
  };
  var view = 'dashboard';
  var ui = { boothQ: '', boothZone: '전체', boothType: '전체',
             schedCat: '전체', schedQ: '', schedHalf: '전체', schedKey: false,
             taskMode: '업무별', taskArea: '전체', taskQ: '', taskPerson: '',
             supplyQ: '', resourceQ: '',
             contactQ: '', contactCat: '전체', faqCat: '전체' };
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
  /* 상세 드로어. 모바일에서는 아래에서 올라오는 시트, PC 에서는
     오른쪽 패널입니다(모양은 portal.css 가 정합니다).
     공지·부스·요청이 모두 이 하나를 돌려 씁니다. 자료실·행사장
     상세가 나중에 붙더라도 여기에 얹으면 됩니다.

     opts.accent  'urgent' 면 긴급 공지의 붉은 강조를 상세에도 이어 줍니다.
     opts.footer  아래쪽에 닫기 버튼을 답니다. 긴 글을 다 읽고 나서
                  위로 되돌아가 X 를 찾지 않아도 되게 합니다. */
  var lastFocus = null;
  function openDrawer(title, html, opts) {
    opts = opts || {};
    lastFocus = document.activeElement;
    $('#drawer-title').textContent = title;

    var panel = $('#drawer .drawer__panel');
    panel.classList.toggle('drawer__panel--urgent', opts.accent === 'urgent');

    $('#drawer-body').innerHTML = html +
      (opts.footer ? '<div class="drawer__foot">' +
        '<button class="btn btn--ghost btn--full" type="button" data-close-drawer>닫기</button></div>' : '');
    fitMedia($('#drawer-body'));
    $('#drawer').hidden = false;
    document.body.style.overflow = 'hidden';

    // 처음 초점은 닫기 버튼에 둡니다. 본문 안의 버튼에 두면 화면을
    // 읽어 주는 도구가 제목을 건너뛰고 중간부터 읽습니다.
    var close = $('#drawer .drawer__head .iconbtn');
    if (close) close.focus();
  }

  /* 열려 있는 동안 초점이 드로어 밖으로 빠져나가지 않게 합니다.
     뒤에 가려진 목록으로 초점이 넘어가면 키보드만 쓰는 사람은
     지금 무엇이 열려 있는지 알 수 없게 됩니다. */
  function trapInDrawer(e) {
    if (e.key !== 'Tab' || $('#drawer').hidden) return;
    var f = $('#drawer .drawer__panel').querySelectorAll(
      'button:not([disabled]), a[href], input, select, textarea');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function closeDrawer() {
    $('#drawer').hidden = true;
    $('#drawer .drawer__panel').classList.remove('drawer__panel--urgent');
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
      C.select('faqs'),
      // 아래 다섯은 migration-operations.sql 을 돌리기 전에는 없습니다.
      // 없다고 포털 전체가 오류 화면이 되면 안 되므로 selectSoft 로
      // 부릅니다(표가 없으면 빈 배열).
      C.selectSoft('operation_tasks'),
      C.selectSoft('task_assignments'),
      C.selectSoft('supply_items'),
      C.selectSoft('supply_targets'),
      C.selectSoft('supply_allocations')
    ]).then(function (r) {
      S.settings = r[0][0] || {};
      S.schedule = r[1]; S.zones = r[2]; S.booths = r[3]; S.notices = r[4];
      S.requests = r[5]; S.resources = r[6]; S.contacts = r[7];
      S.places = r[8]; S.faqs = r[9];
      S.tasks = r[10]; S.assigns = r[11];
      S.supplyItems = r[12]; S.supplyTargets = r[13]; S.supplyAllocs = r[14];
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

  /* ── 비어 있는 화면 ─────────────────────────────────────────────
     행사 정보가 아직 다 채워지지 않은 단계라, 빈 화면을 자주 보게
     됩니다. 한 줄만 덩그러니 두면 고장 난 것처럼 보이므로 "무엇이
     들어올 자리인지"까지 함께 알려 줍니다.

     두 경우를 구분합니다.
       아직 등록 전  → 기다리면 채워집니다
       조건에 안 맞음 → 검색어나 필터를 바꾸면 됩니다
     둘을 뭉뚱그리면 사용자가 무엇을 해야 할지 알 수 없습니다. */
  var ICON_EMPTY =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.6" /><path d="M3.4 9.6h17.2" />' +
    '<path d="M8 14h8" /></svg>';
  var ICON_SEARCH =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="10.8" cy="10.8" r="6.2" /><path d="m19.6 19.6-4.4-4.4" /></svg>';

  /* ── 예시 카드 ──────────────────────────────────────────────────
     행사 정보가 아직 채워지기 전이라, 안내문 한 줄만 두면 그 메뉴에
     무엇이 들어오는지 알 수 없습니다. 실제와 같은 모양의 카드를
     몇 장 보여 주어 화면 구성을 미리 이해하게 합니다.

     지켜야 할 두 가지
       · 데이터베이스에 넣지 않습니다. 화면에서만 만듭니다.
       · 진짜 데이터가 한 건이라도 생기면 곧바로 사라집니다.
     그래서 각 화면에서 "전체 건수 0" 일 때만 부릅니다.
     검색·필터 결과가 0인 경우는 해당하지 않습니다 — 그때는
     예시가 아니라 "검색 결과 없음" 을 보여 줘야 합니다.

     실제 카드와 헷갈리지 않도록 "예시" 배지를 반드시 붙이고,
     테두리를 점선으로 둡니다. 흐리게 만들지는 않습니다 —
     구성을 읽을 수 있어야 하기 때문입니다. */
  var SAMPLE = '<span class="badge badge--plain badge--sample">예시</span>';

  function sampleWrap(note, cards, two) {
    return '<div class="sample">' +
      '<p class="samplenote">' + esc(note) + '</p>' +
      '<div class="tl' + (two ? ' tl--2' : '') + '" aria-label="예시 목록">' +
      cards + '</div></div>';
  }

  function emptyBox(title, hint) {
    return '<div class="state state--empty">' +
      '<span class="state__icon">' + ICON_EMPTY + '</span>' +
      '<p class="state__title">' + esc(title) + '</p>' +
      (hint ? '<p class="state__hint">' + esc(hint) + '</p>' : '') + '</div>';
  }

  /* 화면별 예시. 확정되지 않은 사실(시간·장소·전화번호 등)은 쓰지
     않고, "무엇이 이 자리에 오는지" 만 보여 줍니다. */
  /* 예시 공지는 목록과 상세가 같은 원본을 씁니다. 눌러서 상세까지
     볼 수 있어야 실제 화면 흐름을 이해할 수 있습니다.
     확정되지 않은 시각·장소·연락처는 쓰지 않습니다. */
  var SAMPLE_NOTICES = [
    { level: '중요', sample: true,
      title: '부스 운영자 사전 안내',
      summary: '행사 전 부스 세팅 시간과 준비사항을 안내합니다.',
      body: '행사 전 부스 운영자가 확인해야 할 세팅 시간, 준비물, 반입 방법, ' +
            '운영 유의사항 등이 등록되면 이곳에서 자세히 확인할 수 있습니다.' },
    { level: '일반', sample: true,
      title: '행사장 출입 및 물품 반입 안내',
      summary: '행사장 출입과 물품 반입 안내가 등록되면 이곳에서 확인할 수 있습니다.',
      body: '행사장 출입 방법, 물품 반입 동선, 반입 가능 시간과 관련된 안내가 ' +
            '확정되면 이곳에서 확인할 수 있습니다.' },
    { level: '긴급', sample: true,
      title: '긴급 운영 공지',
      summary: '행사 당일 긴급 변경사항은 이 영역에 우선 표시됩니다.',
      body: '행사 당일 일정 변경, 장소 변경, 안전 관련 안내 등 ' +
            '즉시 확인해야 하는 내용이 긴급 공지로 표시됩니다.' }
  ];

  function sampleNotices() {
    return sampleWrap(
      '등록된 공지가 없습니다. 아래는 어떤 공지가 올라오는지 보여 주는 예시이며, 실제 공지가 등록되면 사라집니다. 눌러서 상세 화면도 볼 수 있습니다.',
      SAMPLE_NOTICES.map(function (n, i) {
        // button 이라 마우스·Enter·Space 가 모두 됩니다.
        return '<button class="notice is-sample' + (n.level === '긴급' ? ' notice--urgent' : '') +
          '" type="button" data-samplenotice="' + i + '">' +
          '<span class="notice__top">' + badge(n.level) + SAMPLE + '</span>' +
          '<span class="notice__title">' + esc(n.title) + '</span>' +
          '<span class="notice__body">' + esc(n.summary) + '</span></button>';
      }).join(''), true);
  }

  function sampleRequests() {
    return sampleWrap(
      '등록된 운영 요청이 없습니다. 아래는 어떤 요청을 등록할 수 있는지 보여 주는 예시입니다.',
      [
        ['전기', 'A구역 멀티탭 추가 요청', '부스 운영 중 전원 사용을 위해 멀티탭이 필요합니다.'],
        ['네트워크', '와이파이 연결 확인 요청', '체험 부스에서 네트워크 연결이 불안정합니다.'],
        ['시설', '테이블 추가 요청', '운영 물품 배치를 위해 테이블 1개가 더 필요합니다.']
      ].map(function (r) {
        return '<div class="req is-sample">' +
          '<span class="req__top">' + badge('보통') + badge('접수') +
          '<span class="badge badge--plain">' + esc(r[0]) + '</span>' + SAMPLE + '</span>' +
          '<span class="req__title">' + esc(r[1]) + '</span>' +
          '<span class="req__meta">' + esc(r[2]) + '</span></div>';
      }).join(''));
  }

  function sampleResources() {
    return sampleWrap(
      '등록된 자료가 없습니다. 아래는 어떤 자료가 올라오는지 보여 주는 예시입니다.',
      [
        ['운영 매뉴얼', '행사 운영 매뉴얼', '행사 운영 절차와 기본 안내를 확인하는 자료입니다.'],
        ['부스 운영 안내', '부스 운영자 안내 자료', '부스 준비·운영·철수 관련 내용을 확인할 수 있습니다.'],
        ['안전관리 자료', '행사 안전관리 안내', '비상상황과 안전사고 대응 절차를 확인하는 자료입니다.']
      ].map(function (r) {
        // 예시에는 열 수 있는 파일이 없어 단추를 만들지 않습니다.
        return '<div class="rescard is-sample">' +
          '<div class="rescard__title">' + esc(r[1]) + ' ' + SAMPLE + '</div>' +
          '<div class="rescard__kind">' + esc(r[0]) + '</div>' +
          '<p class="rescard__desc">' + esc(r[2]) + '</p></div>';
      }).join(''), true);
  }

  function sampleContacts() {
    return sampleWrap(
      '등록된 연락처가 없습니다. 아래는 어떤 담당이 등록되는지 보여 주는 예시입니다.',
      [
        ['운영본부', '행사 운영 총괄', '행사 진행과 전체 운영 관련 문의'],
        ['전산 지원', '네트워크·기기 지원', '인터넷, 노트북, 장비 관련 지원'],
        ['안전 지원', '안전 및 응급 대응', '안전사고 및 응급 상황 지원']
      ].map(function (c) {
        // 확정된 번호가 없어 번호와 전화 단추를 만들지 않습니다.
        return '<div class="contact is-sample">' +
          '<div class="contact__top"><span class="tag tag--soft">' + esc(c[0]) + '</span>' + SAMPLE + '</div>' +
          '<div class="contact__name">' + esc(c[1]) + '</div>' +
          '<div class="contact__meta">' + esc(c[2]) + '</div></div>';
      }).join(''), true);
  }

  function samplePlaces() {
    return sampleWrap(
      '등록된 공간 안내가 없습니다. 아래는 어떤 공간이 등록되는지 보여 주는 예시입니다.',
      [
        ['운영본부', '행사 운영 총괄 및 현장 지원'],
        ['메인 무대', '개막식, 공연, 주요 프로그램 진행 공간'],
        ['체험 부스 구역', 'AI·SW 체험 부스 운영 공간'],
        ['안내 데스크', '참가자 안내 및 문의 접수'],
        ['휴게 공간', '관계자 및 참가자 휴식 공간'],
        ['화장실', '행사장 내 편의시설 위치 안내']
      ].map(function (p) {
        // 층수나 위치는 확정되지 않아 적지 않습니다.
        return '<div class="rowcard is-sample"><div class="rowcard__body">' +
          '<div class="rowcard__name">' + esc(p[0]) + ' ' + SAMPLE + '</div>' +
          '<div class="rowcard__meta">' + esc(p[1]) + '</div></div></div>';
      }).join(''), true);
  }

  function sampleFaqs() {
    return sampleWrap(
      '공개된 운영 FAQ가 없습니다. 아래는 어떤 질문이 오르는지 보여 주는 예시이며, 답변이 확정되면 실제 FAQ 로 바뀝니다.',
      [
        ['부스 운영자는 몇 시까지 도착해야 하나요?', '실제 운영 시간이 확정되면 이곳에 안내됩니다.'],
        ['부스에서 전기를 사용할 수 있나요?', '전기 사용 기준과 제공 사항이 확정되면 안내됩니다.'],
        ['운영 중 문제가 생기면 어떻게 하나요?', '운영 요청 메뉴로 등록하거나 운영본부에 지원을 요청할 수 있습니다.'],
        ['행사 운영 중 지원이 필요하면 어떻게 하나요?', '지원 요청 방법이 확정되면 이곳에 안내됩니다.'],
        ['안전사고가 발생하면 어떻게 해야 하나요?', '행사 안전 운영 기준이 확정되면 안내됩니다.']
      ].map(function (f) {
        // 접었다 펴는 동작 없이 질문과 답을 함께 보여 줍니다.
        // 예시는 눌러도 할 일이 없습니다.
        return '<div class="faq is-sample">' +
          '<div class="faq__q faq__q--static"><span>' + esc(f[0]) + '</span>' + SAMPLE + '</div>' +
          '<div class="faq__a">' + esc(f[1]) + '</div></div>';
      }).join(''));
  }

  function noMatchBox(title) {
    return '<div class="state state--empty">' +
      '<span class="state__icon">' + ICON_SEARCH + '</span>' +
      '<p class="state__title">' + esc(title) + '</p>' +
      '<p class="state__hint">검색어나 필터를 바꿔 보세요.</p></div>';
  }
  /* 상태를 판단해야 하는 화면(홈·요청·업무·물품)에만 붙이는 작은 요약.
     정보 화면(자료실·연락망)에는 쓰지 않습니다. 거기서는 개수 한 줄이면
     충분하고, 숫자 칸을 늘어놓으면 운영 화면과 구분이 흐려집니다. */
  function summaryGrid(items) {
    return '<div class="minigrid minigrid--sum">' + items.map(function (c) {
      return '<div class="mini' + (c.tone ? ' mini--' + c.tone : '') + '">' +
        '<span class="mini__n">' + c.n + '</span>' +
        '<span class="mini__l">' + esc(c.l) + '</span></div>';
    }).join('') + '</div>';
  }

  /* 끝난 것은 아래로 내리고 접어 둡니다. 현장에서 먼저 봐야 하는 것은
     아직 남은 일입니다. 접기는 details 를 그대로 씁니다 — 키보드로
     열고 닫는 동작이 이미 붙어 있습니다. 흐리게 만들지는 않습니다. */
  function doneSection(title, items, html) {
    if (!items) return '';
    return '<details class="donebox">' +
      '<summary class="donebox__sum"><span class="donebox__t">' + esc(title) + '</span>' +
      '<span class="donebox__n">' + items + '건</span>' +
      '<span class="donebox__open" aria-hidden="true"></span></summary>' +
      '<div class="donebox__body">' + html + '</div></details>';
  }

  function doneMark(text) {
    return '<span class="donemark"><span aria-hidden="true">✓</span> ' + esc(text) + '</span>';
  }

  function pageHead(title, desc, actions) {
    return '<div class="page__head"><div><h1 class="page__title">' + esc(title) + '</h1>' +
      (desc ? '<p class="page__desc">' + esc(desc) + '</p>' : '') + '</div>' +
      (actions ? '<div class="page__actions">' + actions + '</div>' : '') + '</div>';
  }
  /* 안내도·배치도 자리.
     이미지가 없어도 같은 크기의 자리를 남겨 둡니다. 나중에 그림만
     올리면 화면 구조가 그대로인 채로 채워집니다. 빈 흰 상자나
     깨진 이미지 아이콘은 보이지 않게 합니다. */
  function mediaBox(o) {
    var cap = o.caption ? '<figcaption class="media__cap">' + esc(o.caption) + '</figcaption>' : '';
    // bleed: 본문 여백을 넘어 화면 가로를 꽉 채웁니다.
    var cls = 'media' + (o.bleed === false ? '' : ' media--bleed');
    if (!o.url) {
      return '<figure class="' + cls + ' media--empty">' +
        '<div class="media__ph">' +
          '<span class="media__icon" aria-hidden="true">◱</span>' +
          '<span class="media__phtitle">' + esc(o.title) + '</span>' +
          '<span class="media__phtext">' + esc(o.hint) + '</span>' +
        '</div></figure>';
    }
    return '<figure class="' + cls + '">' +
      '<button class="media__btn" type="button" data-zoom="' + esc(o.url) + '" ' +
        'data-zoomcap="' + esc(o.caption || o.title) + '" aria-label="' + esc(o.title) + ' 크게 보기">' +
        // 화면 맨 위에 오는 그림이라 lazy 를 걸지 않습니다.
        // 보이는 자리의 이미지를 미루면 더 늦게 뜨기만 합니다.
        '<img src="' + esc(o.url) + '" alt="' + esc(o.alt || o.title) + '" />' +
        '<span class="media__zoom" aria-hidden="true">확대</span>' +
      '</button>' + cap + '</figure>';
  }

  /* 그림이 실제로 뜨면 미리 잡아 둔 16:9 를 원본 비율로 바꿉니다.
     그래야 가로를 정확히 채우면서 위아래에 빈 띠가 남지 않습니다.
     뜨기 전까지는 16:9 로 자리를 지켜 화면이 튀지 않습니다. */
  function fitMedia(root) {
    var imgs = (root || document).querySelectorAll('.media__btn img');
    Array.prototype.forEach.call(imgs, function (img) {
      function fit() {
        if (!img.naturalWidth || !img.naturalHeight) return;
        img.parentNode.style.aspectRatio = img.naturalWidth + ' / ' + img.naturalHeight;
      }
      if (img.complete) fit();
      else img.addEventListener('load', fit, { once: true });
    });
  }

  /* 크게 보기. 배치도는 작은 화면에서 확대가 사실상 필수입니다. */
  function openZoom(url, caption) {
    var el = $('#zoom');
    $('#zoom-img').src = url;
    $('#zoom-img').alt = caption || '';
    $('#zoom-cap').textContent = caption || '';
    $('#zoom-cap').hidden = !caption;
    el.hidden = false;
    document.body.style.overflow = 'hidden';
    $('#zoom-close').focus();
  }
  function closeZoom() {
    var el = $('#zoom');
    if (!el || el.hidden) return;
    el.hidden = true;
    $('#zoom-img').src = '';
    // 상세 드로어 위에서 열렸다면 스크롤 잠금을 유지해야 합니다.
    document.body.style.overflow = $('#drawer').hidden ? '' : 'hidden';
  }

  function chips(items, active, attr, extra) {
    return '<div class="chiprow' + (extra ? ' ' + extra : '') + '" role="group">' + items.map(function (it) {
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

    var hero = '<section class="hero"><div><p class="hero__kicker">행사 운영 홈</p>' +
      '<h1 class="hero__name">' +
      esc(s.event_title || '2026년 인천 AI·SW미래채움 교육페스티벌') + '</h1>' +
      '<div class="hero__meta">' + esc(s.date_label || '') +
      (s.time_label ? ' · ' + esc(s.time_label) : '') +
      (s.venue ? ' · ' + esc(s.venue) : '') + '</div></div>' +
      '<div class="hero__state">' + phaseHtml + '</div></section>' +
      '<p class="pageintro">행사 준비 상황과 당일 운영 정보를 한곳에서 확인합니다. ' +
      '일정·공지·업무·물품 현황은 관리자에서 등록한 내용이 바로 반영됩니다.</p>';

    /* 긴급 공지 — 있으면 최상단 */
    var urgent = S.notices.filter(function (n) { return n.level === '긴급'; });
    /* 긴급과 중요를 함께 봅니다. 홈에서 알아야 하는 것은 '지금 읽어야
       할 공지가 있는가' 이고, 등급을 가려 읽는 일은 공지 화면의 몫입니다. */
    var keyNotices = S.notices.filter(function (n) {
      return n.level === '긴급' || n.level === '중요';
    }).slice(0, 3);

    var urgentHtml = keyNotices.length
      ? '<section class="homebox">' +
        '<h2 class="section-title">중요 공지' +
        '<button class="linkbtn" type="button" data-go="notices">공지 전체 보기</button></h2>' +
        '<div class="minilist">' + keyNotices.map(function (n) {
          return '<button class="minirow" type="button" data-notice="' + esc(n.id) + '">' +
            '<span class="minirow__top">' + badge(n.level) +
            '<span class="minirow__when">' + esc(fmtDay(n.created_at)) + '</span></span>' +
            '<span class="minirow__title">' + esc(n.title) + '</span></button>';
        }).join('') + '</div></section>'
      : '';

    /* 운영 숫자 — 전부 DB 집계 */
    var openReq = S.requests.filter(function (r) { return r.status !== '완료'; }).length;
    // 등록된 업무·대상이 하나도 없으면 0 이 아니라 '-' 입니다.
    // 0 이라고 적으면 '다 끝났다' 로 읽힙니다.
    var leftTasks = !S.tasks.length ? '-'
      : S.tasks.filter(function (t) { return taskStatus(t) !== '완료'; }).length;
    var leftSupply = !S.supplyTargets.length ? '-'
      : S.supplyTargets.filter(function (t) { return t.status !== '배부 완료'; }).length;

    /* 홈이 답해야 하는 질문 네 가지입니다.
       문제가 남았나 · 할 일이 남았나 · 못 받은 곳이 있나 · 부스는 몇 곳인가.
       부스 운영 상태는 현장에서 갱신하지 않아 판단에 쓸 수 없어 뺐습니다. */
    var stats = [
      // 카드마다 윗줄 색 하나로만 구분합니다(숫자·배경은 칠하지 않음).
      { n: openReq, l: '미처리 요청', go: 'requests', key: 'req' },
      { n: leftTasks, l: '남은 업무', go: 'tasks', key: 'task' },
      { n: leftSupply, l: '배부 확인 필요', go: 'supplies', key: 'supply' },
      { n: S.booths.length, l: '전체 부스', go: 'booths', key: 'booth' }
    ];
    var statsHtml = '<div class="statgrid">' + stats.map(function (st) {
      return '<button class="stat stat--' + st.key + '" type="button" data-go="' + st.go + '"' +
        (st.f ? ' data-filter="' + esc(st.f) + '"' : '') + '>' +
        '<span class="stat__n">' + st.n + '</span>' +
        '<span class="stat__l">' + esc(st.l) + '</span></button>';
    }).join('') + '</div>';

    /* 오늘의 하이라이트 — 관리자가 '핵심 일정' 으로 표시한 것만.
       표시된 일정이 없으면 이 자리를 아예 두지 않습니다. 빈 제목만
       남으면 무언가 빠진 화면처럼 보입니다. */
    var keyItems = S.schedule.filter(function (i) {
      return i.is_highlight && i.status !== '취소';
    }).slice(0, 3);
    var keyHtml = keyItems.length
      ? '<section class="homebox"><h2 class="section-title">오늘의 주요 일정' +
        '<button class="linkbtn" type="button" data-go="schedule" data-schedkey="1">전체 일정 보기</button>' +
        '</h2><div class="minilist">' + keyItems.map(function (i) {
          var st = liveStatus(i, ev);
          return '<button class="minirow' + (st === '진행 중' ? ' minirow--now' : '') + '" type="button" ' +
            'data-go="schedule" data-schedkey="1">' +
            '<span class="minirow__top"><span class="minirow__when">' + esc(i.start_time || '') +
            (i.end_time ? '–' + esc(i.end_time) : '') + '</span>' +
            (st === '진행 중' ? badge('진행 중') : '') + '</span>' +
            '<span class="minirow__title">' + esc(i.title) + '</span>' +
            '<span class="minirow__meta">' + esc(i.place || '장소 미정') + '</span></button>';
        }).join('') + '</div></section>'
      : '';

    /* 운영 안내 — 관리자가 행사 기본정보에 적어 둔 짧은 안내입니다.
       줄바꿈을 그대로 살립니다. 비어 있으면 자리를 두지 않습니다. */
    var guide = (s.ops_guide || '').trim();
    // 대시보드는 훑는 화면입니다. 안내가 길면 앞 세 줄만 두고
    // 나머지는 드로어에서 읽게 합니다.
    var guideLong = guide.split(String.fromCharCode(10)).length > 3 || guide.length > 110;
    var guideHtml = guide
      ? '<section class="guidebox">' +
        '<h2 class="section-title">운영 안내</h2>' +
        '<div class="noticebody' + (guideLong ? ' is-clamped' : '') + '">' + esc(guide) + '</div>' +
        (guideLong ? '<div><button class="linkbtn" type="button" data-guide>전체 보기</button></div>' : '') +
        '</section>'
      : '';

    /* 지금 / 다음 */
    var nowHtml, nowCount = 1;
    if (nn.preview) {
      // 행사 전입니다. 아래에 첫 일정을 함께 보여 주는데, 아무 설명
      // 없이 시각과 제목만 두면 지금 진행 중인 일정으로 오해합니다.
      // 그래서 "첫 일정" 이라고 분명히 적습니다.
      nowHtml = '<section class="card card__pad nowcard nowcard--idle">' +
        '<div class="nowcard__kicker">행사 당일 안내</div>' +
        '<p class="nowcard__meta" style="margin-top:6px">행사 당일에는 현재 시각을 기준으로 ' +
        '진행 중인 일정과 다음 일정이 이 자리에 표시됩니다.</p>' +
        (nn.next ? '<div class="nowcard__kicker" style="margin-top:14px">첫 일정</div>' +
          '<div class="nowcard__time" style="margin-top:4px">' + esc(nn.next.start_time || nn.next.time_label) + '</div>' +
          '<div class="nowcard__title">' + esc(nn.next.title) + '</div>' +
          '<div class="nowcard__meta">' + esc(nn.next.place || '') + '</div>' : '') +
        '</section>';
    } else if (nn.live) {
      nowHtml = '<section class="card card__pad nowcard">' +
        '<div class="nowcard__kicker">지금 진행 중</div>' +
        '<div class="nowcard__time">' + esc(nn.live.start_time) + '–' + esc(nn.live.end_time) + '</div>' +
        '<div class="nowcard__title">' + esc(nn.live.title) + '</div>' +
        '<div class="nowcard__meta">' + esc(nn.live.place || '장소 미정') + '</div></section>';
    } else {
      nowHtml = '<section class="card card__pad nowcard nowcard--idle">' +
        '<div class="nowcard__kicker">현재 진행 중인 일정 없음</div>' +
        '<p class="nowcard__meta" style="margin-top:6px">' +
        (nn.gap != null ? '다음 일정까지 ' + C.minLabel(nn.gap) + ' 남았습니다.' : '남은 일정이 없습니다.') +
        '</p></section>';
    }
    if (nn.next && !nn.preview) {
      nowCount = 2;
      nowHtml += '<section class="card card__pad nowcard nowcard--idle">' +
        '<div class="nowcard__kicker">다음 일정</div>' +
        '<div class="nowcard__time">' + esc(nn.next.start_time) + '</div>' +
        '<div class="nowcard__title">' + esc(nn.next.title) + '</div>' +
        '<div class="nowcard__meta">' + esc(nn.next.place || '') + '</div>' +
        (nn.gap != null ? '<div class="nowcard__left">' + C.minLabel(nn.gap) + ' 후</div>' : '') +
        '</section>';
    }

    /* 짧은 것끼리 한 줄에 놓습니다. 넓은 화면에서 전부 전체 폭으로
       쌓으면 카드 하나에 한 줄씩만 담긴 채 화면이 길어집니다.
       좁은 화면에서는 CSS 가 알아서 한 칸으로 내려 줍니다. */
    // 한 칸짜리를 두 칸 격자에 넣으면 옆이 비어 보입니다.
    // 둘 다 있을 때만 나눕니다.
    var pairA = nowCount === 2 ? '<div class="grid-2">' + nowHtml + '</div>' : nowHtml;
    var pairB = (urgentHtml && keyHtml)
      ? '<div class="grid-2">' + urgentHtml + keyHtml + '</div>'
      : (urgentHtml || keyHtml);

    return '<div class="page">' + hero + statsHtml + pairA + pairB + guideHtml +
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

  /* ── 화면: 일정 ───────────────────────────────────────────────
     시간 흐름이 눈에 보이게 시각을 왼쪽 기둥에 세우고, 같은 시간대의
     일정을 그 아래에 묶습니다. 목록만 늘어놓으면 "지금이 어디쯤인지"
     를 매번 머리로 계산해야 합니다.

     행사 당일에는 현재 시각 선을 실제 위치에 그어 줍니다. 색으로만
     알리지 않고 '지금 13:27' 처럼 글자로도 적습니다 — 색을 구분하기
     어려운 사람도 같은 정보를 얻어야 합니다. */
  function viewSchedule() {
    var ev = eventInfo();

    var hasKey = S.schedule.some(function (i) { return i.is_highlight; });
    var q = ui.schedQ.trim().toLowerCase();

    function half(i) {
      var m = C.toMin(i.start_time);
      return m == null ? null : (m < 12 * 60 ? '오전' : '오후');
    }

    var cats = ['전체'].concat(SCHEDULE_CATS).map(function (c) {
      return { label: c, n: c === '전체' ? S.schedule.length
        : S.schedule.filter(function (i) { return i.category === c; }).length };
    });
    var halves = ['전체', '오전', '오후'].map(function (h) {
      return { label: h, n: h === '전체' ? S.schedule.length
        : S.schedule.filter(function (i) { return half(i) === h; }).length };
    });

    var list = S.schedule.filter(function (i) {
      if (ui.schedCat !== '전체' && i.category !== ui.schedCat) return false;
      if (ui.schedHalf !== '전체' && half(i) !== ui.schedHalf) return false;
      if (ui.schedKey && !i.is_highlight) return false;
      if (!q) return true;
      return (i.title + ' ' + (i.place || '') + ' ' + (i.team || '') + ' ' + (i.owner || ''))
        .toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) {
      var x = C.toMin(a.start_time), y = C.toMin(b.start_time);
      if (x == null) x = 9999;
      if (y == null) y = 9999;
      if (x !== y) return x - y;
      return (a.sort_order || 0) - (b.sort_order || 0);
    });

    /* 현재 시각 머리말. 당일에는 크게, 그 밖의 날에는 작게 둡니다. */
    var nowMin = ev.now.getHours() * 60 + ev.now.getMinutes();
    var nowLabel = C.pad2(ev.now.getHours()) + ':' + C.pad2(ev.now.getMinutes());
    var clock = '<div class="nowbar' + (ev.sameDay ? ' nowbar--live' : '') + '">' +
      '<span class="nowbar__l">현재 시각</span>' +
      '<span class="nowbar__t">' + esc(nowLabel) + '</span>' +
      (ev.sameDay ? '<span class="nowbar__tag">행사 진행일</span>' : '') + '</div>';

    /* 시간대별로 묶습니다. 시작 시각이 없는 일정은 맨 뒤에 따로 모읍니다. */
    var groups = [], seen = {};
    list.forEach(function (i) {
      var m = C.toMin(i.start_time);
      var key = m == null ? '미정' : C.pad2(Math.floor(m / 60)) + ':00';
      if (!seen[key]) { seen[key] = { key: key, at: m == null ? null : Math.floor(m / 60) * 60, items: [] }; groups.push(seen[key]); }
      seen[key].items.push(i);
    });

    var marked = false;
    var body = groups.map(function (g) {
      var rows = g.items.map(function (i) {
        var st = liveStatus(i, ev);
        var cls = st === '진행 중' ? ' tmlrow--now' : st === '종료' ? ' tmlrow--done' : '';
        if (st === '취소' || st === '변경') cls = ' tmlrow--off';
        return '<article class="tmlrow' + cls + '">' +
          '<div class="tmlrow__time">' + esc(i.start_time || '') +
          (i.end_time ? '<span class="tmlrow__to">' + esc(i.end_time) + '</span>' : '') + '</div>' +
          '<div class="tmlrow__body">' +
          '<h3 class="tmlrow__title">' + esc(i.title) +
          (i.is_highlight ? '<span class="keymark" title="핵심 일정">핵심</span>' : '') + '</h3>' +
          '<p class="tmlrow__meta">' + esc(i.place || '장소 미정') +
          (i.team ? ' · ' + esc(i.team) : '') + (i.owner ? ' · ' + esc(i.owner) : '') + '</p>' +
          (i.memo ? '<p class="tmlrow__memo">' + esc(i.memo) + '</p>' : '') +
          '<div class="tmlrow__tags">' + badge(st) +
          '<span class="tag tag--soft">' + esc(i.category) + '</span>' +
          '</div></div></article>';
      }).join('');

      /* 현재 시각 선. 아직 긋지 않았고 이 시간대가 지금보다 뒤라면
         이 묶음 앞에 긋습니다. */
      var line = '';
      if (ev.sameDay && !marked && g.at != null && g.at + 60 > nowMin) {
        if (g.at > nowMin) { line = nowLine(nowLabel); marked = true; }
      }

      return line + '<section class="tmlgroup">' +
        '<h2 class="tmlgroup__hour">' + esc(g.key) + '</h2>' +
        '<div class="tmlgroup__rows">' + rows + '</div></section>';
    }).join('');

    // 모든 일정이 이미 지났으면 맨 끝에 긋습니다.
    if (ev.sameDay && !marked && groups.length) body += nowLine(nowLabel);

    var listHtml = list.length
      ? '<div class="tml">' + body + '</div>'
      : S.schedule.length
        ? noMatchBox('조건에 맞는 일정이 없습니다.')
        : emptyBox('등록된 일정이 없습니다.', '일정이 등록되면 시간순으로 표시됩니다.');

    var keyToggle = hasKey
      ? '<button class="chip chip--toggle' + (ui.schedKey ? ' is-on' : '') + '" type="button" ' +
        'data-schedkeytoggle aria-pressed="' + (ui.schedKey ? 'true' : 'false') + '">핵심 일정만 보기</button>'
      : '';

    return '<div class="page">' +
      pageHead('운영 일정', ev.sameDay
        ? '현재 시각을 기준으로 진행 중인 일정이 강조됩니다.'
        : '행사 전체 일정을 시간순으로 정리했습니다. 변경 사항은 공지에서 함께 확인해 주세요.') +
      clock +
      '<div class="tools"><div class="search"><label class="sr-only" for="sched-q">일정 검색</label>' +
      '<input class="input" id="sched-q" type="search" placeholder="일정·장소·담당 검색" value="' + esc(ui.schedQ) + '" /></div>' +
      // 오전·오후와 핵심 일정이 한 줄. 당일에 가장 자주 누르는 것입니다.
      '<div class="filterline">' + chips(halves, ui.schedHalf, 'data-schedhalf') +
      (keyToggle ? '<div class="chiprow chiprow--end">' + keyToggle + '</div>' : '') + '</div>' +
      // 분류는 한 단계 아래. 같은 크기로 두면 무엇이 먼저인지 알 수 없습니다.
      chips(cats, ui.schedCat, 'data-schedcat', 'chiprow--sub') + '</div>' +
      (list.length ? '<p class="resultline">' + list.length + '건</p>' : '') +
      listHtml + '</div>';
  }

  function nowLine(label) {
    return '<div class="nowline" role="separator" aria-label="현재 시각 ' + esc(label) + '">' +
      '<span class="nowline__t">지금 ' + esc(label) + '</span></div>';
  }

  /* ── 화면: 부스 현황 ────────────────────────────────────────── */
  /* 부스 화면은 상태를 관리하는 곳이 아니라 부스를 찾는 곳입니다.
     다섯 갈래 운영 상태는 현장에서 아무도 갱신하지 않아 늘 '준비 전'
     한 줄로만 남았고, 그 숫자가 화면 윗부분을 차지했습니다.
     배치도 → 구역 → 검색 → 목록 순으로 좁혀 가게만 둡니다.
     booths.status 칸은 표에 그대로 남아 있습니다. */
  /* 운영기관 유형(초등·중등·고등·기관·기업·기타).
     구역은 '어디에 있나', 유형은 '누가 운영하나' 로 뜻이 다릅니다.
     관리자가 고른 값(org_type)을 먼저 씁니다. 비어 있으면 기관 이름이
     '…초등학교/…중학교/…고등학교' 로 끝날 때만 화면에서 짐작하고,
     그 값은 저장하지 않습니다. 확실하지 않으면 표시하지 않습니다 —
     '기관' 이라고 단정하면 틀린 정보를 보여 주게 됩니다. */
  var ORG_TYPES = ['초등', '중등', '고등', '기관', '기업', '기타'];
  var ORG_TONE  = { '초등': 'el', '중등': 'mid', '고등': 'high', '기관': 'org', '기업': 'biz', '기타': 'etc' };

  function orgType(b) {
    if (b.org_type && ORG_TYPES.indexOf(b.org_type) >= 0) return b.org_type;
    var o = String(b.org || '').replace(/\s+/g, '');
    if (/초등학교$/.test(o)) return '초등';
    if (/중학교$/.test(o)) return '중등';
    if (/고등학교$|공업고등학교$|예술고등학교$/.test(o)) return '고등';
    return '';
  }
  function orgBadge(type) {
    return type ? '<span class="orgtag orgtag--' + ORG_TONE[type] + '">' + esc(type) + '</span>' : '';
  }
  // 필터에서는 기관·기업·기타를 하나로 묶습니다. 수가 적어 칩을 셋으로
  // 나누면 줄만 길어집니다. 카드에는 실제 값을 그대로 적습니다.
  function orgGroup(type) {
    return (type === '초등' || type === '중등' || type === '고등') ? type : (type ? '기관·기타' : '');
  }

  function zoneName(key) {
    var z = S.zones.filter(function (x) { return x.key === key; })[0];
    return z ? z.key + '구역' + (z.label ? ' · ' + z.label : '') : (key ? key + '구역' : '');
  }

  function viewBooths() {
    var q = ui.boothQ.trim().toLowerCase();

    // 구역은 개수보다 '그 구역만 보기' 로 쓰입니다.
    var zoneHtml = S.zones.length
      ? '<div class="chiprow" role="group" aria-label="구역">' +
        ['전체'].concat(S.zones.map(function (z) { return z.key + '존'; })).map(function (lab) {
          var n = lab === '전체' ? S.booths.length
            : S.booths.filter(function (b) { return b.zone_key + '존' === lab; }).length;
          var text = lab === '전체' ? '전체' : lab.replace('존', '');
          return '<button class="chip' + (ui.boothZone === lab ? ' is-on' : '') + '" type="button" ' +
            'data-boothzone="' + esc(lab) + '" aria-pressed="' + (ui.boothZone === lab) + '">' +
            esc(text) + '<span class="chip__n">' + n + '</span></button>';
        }).join('') + '</div>'
      : '';

    /* 구분은 한 단계 작은 보조 필터입니다. 유형을 알 수 있는 부스가
       하나도 없으면 줄 자체를 두지 않습니다. */
    var groupsPresent = ['초등', '중등', '고등', '기관·기타'].filter(function (g) {
      return S.booths.some(function (b) { return orgGroup(orgType(b)) === g; });
    });
    var typeHtml = groupsPresent.length
      ? '<div class="filterrow"><span class="filterrow__l">구분</span>' +
        chips(['전체'].concat(groupsPresent).map(function (g) {
          return { label: g, n: g === '전체' ? S.booths.length
            : S.booths.filter(function (b) { return orgGroup(orgType(b)) === g; }).length };
        }), ui.boothType, 'data-boothtype', 'chiprow--sub') + '</div>'
      : '';

    var list = S.booths.filter(function (b) {
      if (ui.boothZone !== '전체' && (b.zone_key + '존') !== ui.boothZone) return false;
      if (ui.boothType !== '전체' && orgGroup(orgType(b)) !== ui.boothType) return false;
      if (!q) return true;
      return ((b.code || '') + ' ' + b.name + ' ' + (b.org || '') + ' ' + (b.program || '') + ' ' + orgType(b))
        .toLowerCase().indexOf(q) >= 0;
    });

    var body = list.length ? '<div class="boothgrid">' + list.map(function (b) {
      // 읽는 순서: 번호 · 유형 → 부스명 · 기관 → 위치.
      // 유형은 옅게 채운 표시, 구역은 테두리만 있는 위치 표시로 문법을 나눕니다.
      return '<button class="booth" type="button" data-booth="' + esc(b.id) + '">' +
        '<span class="booth__top"><span class="booth__code">' + esc(b.code || (b.zone_key + '-' + b.no)) + '</span>' +
        orgBadge(orgType(b)) + '</span>' +
        '<span class="booth__name">' + esc(b.name) + '</span>' +
        '<span class="booth__org">' + esc(b.org || '운영기관 미정') + '</span>' +
        (b.program ? '<span class="booth__prog">' + esc(b.program) + '</span>' : '') +
        (b.zone_key ? '<span class="booth__zone"><span class="zonetag">' + esc(zoneName(b.zone_key)) + '</span></span>' : '') +
        '</button>';
    }).join('') + '</div>'
      : S.booths.length
        ? noMatchBox('조건에 맞는 부스가 없습니다.')
        : emptyBox('등록된 부스 정보가 없습니다.', '부스가 등록되면 위치와 운영기관을 확인할 수 있습니다.');

    var s = S.settings || {};
    var map = mediaBox({
      url: s.booth_map_url, alt: s.booth_map_alt, caption: s.booth_map_caption,
      title: '부스 배치도',
      hint: '부스 배치도를 준비 중입니다.'
    });

    return '<div class="page">' +
      pageHead('부스 현황', '부스 위치와 운영기관을 확인합니다. 카드를 누르면 상세 정보가 열립니다.') +
      map +
      '<p class="countline">전체 부스 <b>' + S.booths.length + '</b>개</p>' +
      (zoneHtml ? '<div class="filterrow"><span class="filterrow__l">구역</span>' + zoneHtml + '</div>' : '') +
      typeHtml +
      '<div class="tools"><div class="search"><label class="sr-only" for="booth-q">부스 검색</label>' +
      '<input class="input" id="booth-q" type="search" placeholder="부스명 · 운영기관 검색" value="' + esc(ui.boothQ) + '" /></div></div>' +
      (list.length && list.length !== S.booths.length ? '<p class="resultline">' + list.length + '건</p>' : '') +
      body + '</div>';
  }

  function boothDetail(id) {
    var b = S.booths.filter(function (x) { return x.id === id; })[0];
    if (!b) return;
    var rows = [
      ['부스 번호', b.code || (b.zone_key + '-' + b.no)],
      ['부스명', b.name],
      ['운영기관', b.org],
      ['운영기관 유형', orgType(b)],
      ['구역', zoneName(b.zone_key)],
      ['담당자', b.manager],
      ['운영 프로그램', b.program],
      ['운영 시간', b.hours],
      // 필요할 때만 적습니다. '불필요' 두 줄은 읽을 거리만 늘립니다.
      ['전기 사용', b.needs_power ? '필요' : ''],
      ['네트워크', b.needs_network ? '필요' : ''],
      ['필요 물품', b.supplies],
      ['운영 메모', b.memo],
      ['특이사항', b.notes]
    ].filter(function (r) { return r[1]; });

    var html = '';

    // 부스 사진은 있을 때만 보여 줍니다. 상세는 목록과 달리 자리를
    // 미리 잡아 둘 이유가 없어, 없으면 그냥 넘어갑니다.
    if (b.image_url) {
      html += '<figure class="media media--sm">' +
        '<button class="media__btn" type="button" data-zoom="' + esc(b.image_url) + '" ' +
          'data-zoomcap="' + esc(b.image_caption || b.name) + '" aria-label="부스 사진 크게 보기">' +
          '<img src="' + esc(b.image_url) + '" alt="' + esc(b.image_alt || b.name) + '" loading="lazy" />' +
          '<span class="media__zoom" aria-hidden="true">확대</span></button>' +
        (b.image_caption ? '<figcaption class="media__cap">' + esc(b.image_caption) + '</figcaption>' : '') +
        '</figure>';
    }

    if (b.manager_phone) {
      html += '<a class="btn btn--primary btn--full" href="' + esc(C.telHref(b.manager_phone)) + '">' +
        '담당자에게 전화 · ' + esc(b.manager_phone) + '</a>';
    }

    html += '<dl class="dl">' + rows.map(function (r) {
      return '<div class="dl__row"><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
    }).join('') + '</dl>';

    openDrawer(b.code || b.name, html, { footer: true });
  }

  /* ── 화면: 공지 ─────────────────────────────────────────────── */
  function viewNotices() {
    var list = S.notices.slice().sort(function (a, b) {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      var rank = { '긴급': 0, '중요': 1, '일반': 2 };
      if (rank[a.level] !== rank[b.level]) return rank[a.level] - rank[b.level];
      return new Date(b.created_at) - new Date(a.created_at);
    });
    var body = list.length ? '<div class="tl tl--2">' + list.map(function (n) {
      return '<button class="notice' + (n.level === '긴급' ? ' notice--urgent' : '') + '" type="button" data-notice="' + esc(n.id) + '">' +
        '<span class="notice__top">' + badge(n.level) +
        (n.pinned ? '<span class="badge badge--plain">고정</span>' : '') +
        '<span class="notice__meta">' + esc(fmtDay(n.created_at)) + '</span></span>' +
        '<span class="notice__title">' + esc(n.title) + '</span>' +
        '<span class="notice__body">' + esc(n.body) + '</span></button>';
    }).join('') + '</div>' : sampleNotices();
    return '<div class="page">' +
      pageHead('운영 공지', '운영 중 확인해야 할 변경 사항과 주요 안내입니다. 긴급 공지는 대시보드 상단에도 표시됩니다.') +
      body + '</div>';
  }

  /* 공지 상세. 실제 공지와 예시 공지가 같은 화면을 씁니다 —
     예시를 눌러 본 사람이 실제 공지에서 다른 화면을 만나면
     예시를 본 의미가 없기 때문입니다.

     위에서부터 배지 · 작성 정보 · 본문 순서입니다. 본문이 길어도
     드로어 안에서 스크롤되고, 줄바꿈과 문단은 그대로 살립니다. */
  function noticeDetailView(n) {
    var meta = [];
    if (n.sample) {
      meta.push(['작성 정보', '실제 공지가 등록되면 작성자와 등록 시각이 표시됩니다.']);
    } else {
      if (n.author) meta.push(['작성', n.author]);
      meta.push(['등록', fmtDay(n.created_at)]);
      if (n.updated_at && n.updated_at !== n.created_at) meta.push(['수정', fmtDay(n.updated_at)]);
    }

    var html =
      '<div class="notice__top">' + badge(n.level) +
      (n.pinned ? '<span class="badge badge--plain">고정</span>' : '') +
      (n.sample ? SAMPLE : '') + '</div>' +
      '<dl class="dl">' + meta.map(function (m) {
        return '<div class="dl__row"><dt>' + esc(m[0]) + '</dt><dd>' + esc(m[1]) + '</dd></div>';
      }).join('') + '</dl>' +
      '<div class="noticebody">' + esc(n.body || '') + '</div>';

    openDrawer(n.title, html, { accent: n.level === '긴급' ? 'urgent' : null, footer: true });
  }

  function noticeDetail(id) {
    var n = S.notices.filter(function (x) { return x.id === id; })[0];
    if (n) noticeDetailView(n);
  }

  /* ── 화면: 운영 요청 ────────────────────────────────────────── */
  function requestCard(r) {
    var done = r.status === '완료';
    var card = '<button class="req' + (done ? ' is-done' : '') + '" type="button" data-req="' + esc(r.id) + '">' +
      '<span class="req__top">' + (done ? doneMark('해결 완료') : badge(r.priority) + badge(r.status)) +
      '<span class="tag tag--soft">' + esc(r.kind) + '</span></span>' +
      '<span class="req__title">' + esc(r.title) + '</span>' +
      '<span class="req__meta">' + esc(r.location || '위치 미지정') + ' · ' + esc(fmtDay(r.created_at)) +
      (r.assignee_team ? ' · ' + esc(r.assignee_team) : '') + '</span></button>';
    // 끝난 요청에는 단추를 두지 않습니다.
    return done ? card : actionCard(card, actBtn('data-reqdone="' + esc(r.id) + '"', '해결 완료'));
  }

  function viewRequests() {
    var rank = { '긴급': 0, '높음': 1, '보통': 2 };
    var open = S.requests.filter(function (r) { return r.status !== '완료'; })
      .sort(function (a, b) {
        var ra = a.priority in rank ? rank[a.priority] : 9, rb = b.priority in rank ? rank[b.priority] : 9;
        if (ra !== rb) return ra - rb;
        return new Date(b.created_at) - new Date(a.created_at);
      });
    var done = S.requests.filter(function (r) { return r.status === '완료'; });
    var urgent = open.filter(function (r) { return r.priority === '긴급'; }).length;

    var body;
    if (!S.requests.length) {
      body = sampleRequests();
    } else {
      body = summaryGrid([
          { n: open.length, l: '미처리', tone: open.length ? 'warn' : null },
          { n: urgent, l: '긴급', tone: urgent ? 'danger' : null },
          { n: done.length, l: '완료', tone: done.length ? 'ok' : null }
        ]) +
        '<section class="listsec"><h2 class="section-title">처리가 필요한 요청' +
        '<span class="section-title__n">' + open.length + '</span></h2>' +
        (open.length
          ? '<div class="tl">' + open.map(requestCard).join('') + '</div>'
          : '<p class="allclear">' + doneMark('남은 요청이 없습니다.') + '</p>') +
        '</section>' +
        doneSection('해결 완료', done.length, '<div class="tl">' + done.map(requestCard).join('') + '</div>');
    }

    return '<div class="page">' +
      pageHead('운영 요청',
        '전기·네트워크·기자재·시설·안전·물품 등 현장 지원이 필요할 때 등록해 주세요.',
        '<button class="btn btn--primary btn--sm" type="button" data-newreq>+ 현장 문제 보고</button>') +
      // 비상 연락처가 아직 확정되지 않아 번호는 넣지 않습니다.
      '<p class="pagenote">안전과 관련된 긴급 상황은 요청 등록과 함께 운영본부에 직접 알려 주세요.</p>' +
      body + '</div>';
  }

  function requestDetail(id) {
    var r = S.requests.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    var html = '<div class="notice__top">' + badge(r.priority) + badge(r.status) +
      '<span class="badge badge--plain">' + esc(r.kind) + '</span></div>' +
      '<dl class="dl">' +
      '<div class="dl__row"><dt>위치</dt><dd>' + esc(r.location || '미지정') + '</dd></div>' +
      (r.body ? '<div class="dl__row"><dt>내용</dt><dd style="white-space:pre-wrap">' + esc(r.body) + '</dd></div>' : '') +
      (r.reporter ? '<div class="dl__row"><dt>등록자</dt><dd>' + esc(r.reporter) + '</dd></div>' : '') +
      '<div class="dl__row"><dt>등록</dt><dd>' + esc(fmtDay(r.created_at)) + '</dd></div>' +
      (r.assignee_team ? '<div class="dl__row"><dt>담당팀</dt><dd>' + esc(r.assignee_team) + '</dd></div>' : '') +
      '</dl>' +
      // 처리 상태를 바꾸는 건 관리자 몫입니다. 여기서는 진행 상황만
      // 확인합니다(데이터베이스도 같은 규칙으로 막고 있습니다).
      '<p class="gate__hint">처리 상태는 운영 총괄이 관리자 화면에서 변경합니다.</p>';
    openDrawer(r.title, html);
  }

  function openRequestForm() {
    var boothOpts = S.booths.map(function (b) {
      return '<option value="' + esc(b.code || b.name) + '">' + esc((b.code ? b.code + ' · ' : '') + b.name) + '</option>';
    }).join('');
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
      '<input class="input" id="rq-by" maxlength="40" placeholder="예: 운영지원팀 김OO" /></div>' +
      '<p class="alert alert--error" id="rq-err" role="alert" hidden></p>' +
      '<button class="btn btn--primary btn--full" type="submit" id="rq-submit">등록</button>' +
      '</form>');
  }

  /* ── 화면: 자료실 · 연락망 · 행사장 · FAQ ───────────────────── */
  function viewResources() {
    var all = S.resources.filter(function (r) { return r.is_public !== false; });
    var q = ui.resourceQ.trim().toLowerCase();
    var list = all.filter(function (r) {
      if (!q) return true;
      return (r.title + ' ' + (r.category || '') + ' ' + (r.description || '')).toLowerCase().indexOf(q) >= 0;
    });

    /* 주소가 있을 때만 '자료 열기'. 새 탭으로 엽니다 — 포털을 떠나면
       보던 화면으로 돌아오기 번거롭습니다. 주소가 없으면 누를 수 없는
       단추를 두지 않습니다. */
    var body = list.length ? '<div class="tl tl--2">' + list.map(function (r) {
      return '<div class="rescard">' +
        '<div class="rescard__title">' + esc(r.title) + '</div>' +
        '<div class="rescard__kind">' + esc(r.category || '기타') + '</div>' +
        (r.description ? '<p class="rescard__desc">' + esc(r.description) + '</p>' : '') +
        (r.url
          ? '<div class="rescard__act"><a class="btn btn--ghost btn--sm" href="' + esc(r.url) + '" ' +
            'target="_blank" rel="noopener noreferrer" aria-label="' + esc(r.title) + ' 자료 열기 (새 탭)">' +
            '자료 열기 <span aria-hidden="true">↗</span></a></div>'
          : '<p class="rescard__none">연결된 파일이 아직 없습니다.</p>') +
        '</div>';
    }).join('') + '</div>'
      : all.length
        ? noMatchBox('조건에 맞는 자료가 없습니다.')
        : S.resources.length ? noMatchBox('공개된 자료가 없습니다.') : sampleResources();

    return '<div class="page">' +
      pageHead('관계자 자료실', '행사 운영에 필요한 안내문과 매뉴얼, 서식을 모아 둡니다.') +
      (all.length ? '<p class="countline">등록 자료 <b>' + all.length + '</b>개</p>' +
        '<div class="tools"><div class="search"><label class="sr-only" for="resource-q">자료 검색</label>' +
        '<input class="input" id="resource-q" type="search" placeholder="자료명 · 종류 검색" value="' +
        esc(ui.resourceQ) + '" /></div></div>' : '') +
      body + '</div>';
  }

  function viewContacts() {
    var cats = ['전체'].concat(S.contacts.reduce(function (a, c) {
      if (c.category && a.indexOf(c.category) < 0) a.push(c.category); return a; }, []));
    var q = ui.contactQ.trim().toLowerCase();
    var list = S.contacts.filter(function (c) {
      if (ui.contactCat !== '전체' && c.category !== ui.contactCat) return false;
      if (!q) return true;
      return (c.name + ' ' + (c.org || '') + ' ' + (c.duty || '') + ' ' + (c.category || '') + ' ' + (c.phone || ''))
        .toLowerCase().indexOf(q) >= 0;
    });

    /* 연락망은 번호를 찾아 바로 거는 곳입니다. 번호를 감추고 단추만
       두면 PC 에서는 번호를 알 방법이 없습니다. 번호를 적고, 휴대폰은
       전화, PC 는 복사로 씁니다. 번호가 없으면 단추도 없습니다. */
    var body = list.length ? '<div class="tl tl--2">' + list.map(function (c) {
      var tel = C.telHref(c.phone);
      return '<div class="contact">' +
        '<div class="contact__top">' + (c.category ? '<span class="tag tag--soft">' + esc(c.category) + '</span>' : '') + '</div>' +
        '<div class="contact__name">' + esc(c.name) + '</div>' +
        ((c.org || c.duty) ? '<div class="contact__meta">' + esc([c.org, c.duty].filter(Boolean).join(' · ')) + '</div>' : '') +
        (c.memo ? '<div class="contact__memo">' + esc(c.memo) + '</div>' : '') +
        (tel
          ? '<div class="contact__phone"><span class="contact__num">' + esc(c.phone) + '</span>' +
            '<span class="contact__act">' +
            '<a class="btn btn--ghost btn--sm" href="' + esc(tel) + '" aria-label="' + esc(c.name) + '에게 전화">전화</a>' +
            '<button class="btn btn--ghost btn--sm" type="button" data-copyphone="' + esc(c.phone) + '" ' +
            'aria-label="' + esc(c.name) + ' 번호 복사">번호 복사</button></span></div>'
          : '') +
        '</div>';
    }).join('') + '</div>'
      : S.contacts.length
        ? noMatchBox('조건에 맞는 연락처가 없습니다.')
        : sampleContacts();

    return '<div class="page">' +
      pageHead('운영 연락망', '운영 담당자와 지원팀 연락처입니다.') +
      (S.contacts.length ? '<p class="countline">등록 연락처 <b>' + S.contacts.length + '</b>명</p>' +
        '<div class="tools"><div class="search"><label class="sr-only" for="contact-q">연락처 검색</label>' +
        '<input class="input" id="contact-q" type="search" placeholder="이름 · 소속 · 담당업무 검색" value="' + esc(ui.contactQ) + '" /></div>' +
        (cats.length > 2 ? chips(cats, ui.contactCat, 'data-contactcat', 'chiprow--sub') : '') + '</div>' : '') +
      body + '</div>';
  }

  /* 번호 복사. 복사 기능을 쓸 수 없는 환경(주소가 https 가 아니거나
     권한이 막힌 경우)에서는 번호를 선택된 상태로 띄워 직접 복사하게 합니다. */
  function copyPhone(num) {
    function fallback() {
      var box = document.createElement('textarea');
      box.value = num; box.setAttribute('readonly', '');
      box.style.position = 'fixed'; box.style.top = '-1000px';
      document.body.appendChild(box); box.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (x) { ok = false; }
      document.body.removeChild(box);
      if (ok) toast('전화번호를 복사했습니다.');
      else window.prompt('아래 번호를 복사해 주세요.', num);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(num).then(function () {
        toast('전화번호를 복사했습니다.');
      }).catch(fallback);
    } else {
      fallback();
    }
  }

  function viewVenue() {
    var s = S.settings || {};

    // 장소 이름은 확정된 정보라 제목 바로 아래에 그대로 둡니다.
    var venueLine = (s.venue || '') + (s.venue_detail ? ' · ' + s.venue_detail : '');

    /* 공간 카드. 사진이 있으면 왼쪽에 붙고, 없으면 지금처럼 글만
       있는 카드로 보입니다. 어느 쪽이든 카드 모양은 같습니다. */
    var body = S.places.length ? '<div class="tl tl--2">' + S.places.map(function (p) {
      return '<div class="rowcard rowcard--place">' +
        (p.image_url
          ? '<button class="placethumb" type="button" data-zoom="' + esc(p.image_url) + '" ' +
              'data-zoomcap="' + esc(p.image_caption || p.name) + '" aria-label="' + esc(p.name) + ' 사진 크게 보기">' +
              '<img src="' + esc(p.image_url) + '" alt="' + esc(p.image_alt || p.name) + '" loading="lazy" /></button>'
          : '') +
        '<div class="rowcard__body">' +
        '<div class="rowcard__name">' + esc(p.name) +
        (p.category ? ' <span class="tag tag--soft">' + esc(p.category) + '</span>' : '') + '</div>' +
        // 위치 한 줄까지만. 사진 설명은 사진을 크게 볼 때 함께 보입니다.
        (p.detail ? '<div class="rowcard__meta">' + esc(p.detail) + '</div>' : '') +
        '</div></div>';
    }).join('') + '</div>'
      : samplePlaces();

    /* 지도는 부스 배치도 하나만 씁니다. 행사장 안내도와 배치도를
       따로 두면 관리자는 그림을 두 번 올려야 하고, 보는 사람은 두 장을
       견줘 봐야 합니다. 현장에서 실제로 찾는 것은 부스 자리입니다.
       부스 화면과 같은 이미지를 그대로 씁니다. */
    var boothMap = mediaBox({
      url: s.booth_map_url, alt: s.booth_map_alt, caption: s.booth_map_caption,
      title: '부스 배치도',
      hint: '부스 배치도를 준비 중입니다.'
    });

    return '<div class="page">' +
      pageHead('행사장 안내', venueLine) +
      '<p class="pageintro">운영본부와 주요 행사 공간, 편의시설 위치를 안내합니다.</p>' +
      '<h2 class="section-title">부스 배치도</h2>' + boothMap +
      '<h2 class="section-title">주요 공간</h2>' + body + '</div>';
  }

  function viewFaq() {
    // 답변이 없는 질문은 아직 준비 중입니다. 관리자에서 답변을 채우고
    // '공개'를 켜야 여기에 나옵니다.
    var all = S.faqs.filter(function (f) {
      return f.is_public !== false && (f.answer || '').trim();
    });

    var cats = ['전체'].concat(all.reduce(function (a, f) {
      if (f.category && a.indexOf(f.category) < 0) a.push(f.category); return a; }, []));
    var list = all.filter(function (f) {
      return ui.faqCat === '전체' || f.category === ui.faqCat;
    });

    var body = list.length ? '<div class="tl">' + list.map(function (f, i) {
      return '<div class="faq" data-faq="' + i + '">' +
        '<button class="faq__q" type="button" aria-expanded="false"><span>' + esc(f.question) + '</span>' +
        '<span class="faq__sign" aria-hidden="true">+</span></button>' +
        '<div class="faq__a" hidden>' + esc(f.answer) + '</div></div>';
    }).join('') + '</div>'
      : all.length
        ? noMatchBox('조건에 맞는 질문이 없습니다.')
        : sampleFaqs();

    return '<div class="page">' +
      pageHead('운영 FAQ', '행사 준비와 당일 운영 중 자주 확인하는 내용을 모았습니다.') +
      (cats.length > 2 ? '<div class="tools">' + chips(cats, ui.faqCat, 'data-faqcat') + '</div>' : '') +
      body + '</div>';
  }

  /* ══ 담당 업무 · 운영 인력 ══════════════════════════════════════
     두 가지를 같은 데이터로 보여 줍니다.

       업무별 담당자 — 이 업무는 누가 맡는가
       개인별 역할   — 이 사람은 오늘 무엇을 하는가

     행사 당일에는 두 번째 질문이 훨씬 자주 나옵니다. 그래서 사람을
     고르면 그 사람의 하루가 시간순으로 한 번에 보이게 합니다.

     사람은 연락망(contacts)을 그대로 씁니다. 명부를 따로 두면 이름과
     소속이 두 군데로 갈라져 어느 쪽이 맞는지 알 수 없게 됩니다.
     연락망에 없는 사람은 배정에 이름만 적어 둡니다. */

  /* 운영 인력 명부. is_staff 칸이 아직 없으면 null 을 돌려줍니다 —
     "0 명" 과 "아직 모름" 은 화면에서 다르게 보여야 합니다. */
  function staffList() {
    if (!S.contacts.length) return null;
    var has = S.contacts.some(function (c) { return typeof c.is_staff !== 'undefined'; });
    if (!has) return null;
    return S.contacts.filter(function (c) { return c.is_staff; });
  }

  /* 배정 한 줄이 가리키는 사람. 연락망에 연결돼 있으면 그쪽 이름을
     씁니다 — 연락처가 바뀌어도 배정을 다시 고칠 필요가 없습니다. */
  function assignPerson(a) {
    var c = a.contact_id
      ? S.contacts.filter(function (x) { return x.id === a.contact_id; })[0]
      : null;
    return {
      key: a.contact_id || ('name:' + (a.person_name || '')),
      name: (c ? c.name : a.person_name) || '',
      org: (c ? c.org : a.person_org) || '',
      roleGroup: c ? (c.role_group || '') : '',
      phone: c ? (c.phone || '') : '',
      role: a.role || ''
    };
  }
  function assignsOf(taskId) {
    return S.assigns.filter(function (a) { return a.task_id === taskId; });
  }
  function taskTime(t) {
    if (!t.start_time) return '';
    return t.start_time + (t.end_time ? '–' + t.end_time : '–');
  }
  function tasksSorted() {
    return S.tasks.slice().sort(function (a, b) {
      var x = C.toMin(a.start_time), y = C.toMin(b.start_time);
      if (x == null) x = 9999;
      if (y == null) y = 9999;
      if (x !== y) return x - y;
      return (a.sort_order || 0) - (b.sort_order || 0);
    });
  }

  /* 사람별로 업무를 묶습니다. 개인별 역할 화면이 쓰는 원본입니다. */
  function peopleWithTasks() {
    var map = {}, order = [];
    tasksSorted().forEach(function (t) {
      assignsOf(t.id).forEach(function (a) {
        var p = assignPerson(a);
        if (!p.name) return;
        if (!map[p.key]) { map[p.key] = { person: p, tasks: [] }; order.push(p.key); }
        map[p.key].tasks.push({ task: t, role: a.role || '' });
      });
    });
    return order.map(function (k) { return map[k]; });
  }

  /* 아직 표가 없을 때. 고장이 아니라 준비 전이라는 것을 분명히 적고,
     무엇을 하면 되는지까지 알려 줍니다. */
  function notReadyBox(title) {
    return '<div class="state state--empty">' +
      '<span class="state__icon">' + ICON_EMPTY + '</span>' +
      '<p class="state__title">' + esc(title) + '</p>' +
      '<p class="state__hint">데이터베이스에 이 기능의 표가 아직 없습니다. ' +
      'supabase/migration-operations.sql 을 실행하면 관리자에서 등록할 수 있습니다.</p></div>';
  }

  /* 예시 — 실제 사람 이름을 쓰지 않습니다. 확정되지 않은 시각·장소를
     지어내지도 않습니다. 무엇이 이 자리에 들어오는지만 보여 줍니다. */
  var SAMPLE_TASKS = [
    { area: '기념식', title: '좌석 및 안내 준비', when: '행사 시작 전', place: '운영본부',
      people: ['담당자 1', '담당자 2'] },
    { area: '부스 운영', title: '부스 세팅 지원', when: '부스 운영 전', place: '부스 구역',
      people: ['담당자 1'] },
    { area: '안전', title: '안전 점검 및 현장 순회', when: '운영 시간 중', place: '행사장 전체',
      people: ['담당자 1', '담당자 2'] }
  ];

  function sampleTasks() {
    return sampleWrap(
      '등록된 담당 업무가 없습니다. 아래는 업무와 담당자가 어떻게 표시되는지 보여 주는 예시이며, ' +
      '실제 업무가 등록되면 사라집니다. 시간과 장소는 관리자에서 등록한 값이 표시됩니다.',
      SAMPLE_TASKS.map(function (t) {
        return '<div class="task is-sample">' +
          '<div class="task__top"><span class="task__time">' + esc(t.when) + '</span>' +
          '<span class="badge badge--plain">' + esc(t.area) + '</span>' + SAMPLE + '</div>' +
          '<div class="task__title">' + esc(t.title) + '</div>' +
          '<div class="task__meta">' + esc(t.place) + '</div>' +
          '<div class="task__people">' + t.people.map(function (n) {
            return '<span class="person">' + esc(n) + '</span>';
          }).join('') + '</div></div>';
      }).join(''), true);
  }

  function samplePeople() {
    return sampleWrap(
      '등록된 담당 업무가 없습니다. 담당자가 배정되면 아래처럼 사람별로 맡은 업무를 시간순으로 확인할 수 있습니다.',
      ['담당자 1', '담당자 2', '담당자 3'].map(function (n, i) {
        return '<div class="rowcard is-sample"><div class="rowcard__body">' +
          '<div class="rowcard__name">' + esc(n) + ' ' + SAMPLE + '</div>' +
          '<div class="rowcard__meta">소속이 등록되면 표시됩니다 · 담당 업무 ' + (i + 1) + '건</div>' +
          '</div></div>';
      }).join(''), true);
  }

  /* ── 화면: 담당 업무 ────────────────────────────────────────── */
  function viewTasks() {
    var modes = ['업무별', '개인별'];
    var switcher = '<div class="segrow" role="group" aria-label="보기 방식">' +
      modes.map(function (m) {
        return '<button class="seg' + (ui.taskMode === m ? ' is-on' : '') + '" type="button" ' +
          'data-taskmode="' + esc(m) + '" aria-pressed="' + (ui.taskMode === m) + '">' +
          esc(m === '업무별' ? '업무별 담당자' : '개인별 역할') + '</button>';
      }).join('') + '</div>';

    return '<div class="page">' +
      pageHead('담당 업무',
        '업무별 담당자와 개인별 역할을 확인합니다. 행사 당일 누가 무엇을 맡는지 빠르게 찾을 수 있습니다.') +
      switcher + (ui.taskMode === '개인별' ? tasksByPerson() : tasksByTask()) + '</div>';
  }

  /* 업무별 담당자 — 업무 영역으로 묶어서 보여 줍니다. */
  function tasksByTask() {
    if (!S.tasks.length) {
      return C.isTableMissing('operation_tasks')
        ? notReadyBox('담당 업무 기능이 아직 준비되지 않았습니다.')
        : sampleTasks();
    }

    var areas = ['전체'].concat(S.tasks.reduce(function (a, t) {
      if (t.area && a.indexOf(t.area) < 0) a.push(t.area); return a; }, []));
    var q = ui.taskQ.trim().toLowerCase();

    var list = tasksSorted().filter(function (t) {
      if (ui.taskArea !== '전체' && t.area !== ui.taskArea) return false;
      if (!q) return true;
      var names = assignsOf(t.id).map(function (a) { return assignPerson(a).name; }).join(' ');
      return (t.title + ' ' + (t.place || '') + ' ' + (t.description || '') + ' ' +
              (t.area || '') + ' ' + names).toLowerCase().indexOf(q) >= 0;
    });

    var tools = '<div class="tools"><div class="search">' +
      '<label class="sr-only" for="task-q">업무 검색</label>' +
      '<input class="input" id="task-q" type="search" placeholder="업무 · 장소 · 담당자 검색" value="' +
      esc(ui.taskQ) + '" /></div>' +
      (areas.length > 1 ? chips(areas.map(function (a) {
        return { label: a, n: a === '전체' ? S.tasks.length
          : S.tasks.filter(function (t) { return t.area === a; }).length };
      }), ui.taskArea, 'data-taskarea') : '') + '</div>';

    if (!list.length) return tools + noMatchBox('조건에 맞는 업무가 없습니다.');

    /* 영역별로 묶습니다. 한 줄로 죽 늘어놓으면 "기념식 담당" 을
       찾으려고 목록 전체를 훑어야 합니다. */
    var groups = [], seen = {};
    list.forEach(function (t) {
      var k = t.area || '기타';
      if (!seen[k]) { seen[k] = { area: k, items: [] }; groups.push(seen[k]); }
      seen[k].items.push(t);
    });

    var activeGroups = groups.map(function (g) {
      return { area: g.area, items: g.items.filter(function (t) { return taskStatus(t) !== '완료'; }) };
    }).filter(function (g) { return g.items.length; });
    var doneItems = list.filter(function (t) { return taskStatus(t) === '완료'; });

    var count = function (st) { return S.tasks.filter(function (t) { return taskStatus(t) === st; }).length; };
    var summary = summaryGrid([
      { n: S.tasks.length, l: '전체 업무' },
      { n: count('예정'), l: '예정', tone: count('예정') ? 'task' : null },
      { n: count('진행 중'), l: '진행 중', tone: count('진행 중') ? 'info' : null },
      { n: count('완료'), l: '완료', tone: count('완료') ? 'ok' : null }
    ]);

    return summary + tools +
      (activeGroups.length
        ? activeGroups.map(function (g) {
            return '<section class="taskgroup">' +
              '<h2 class="section-title">' + esc(g.area) +
              '<span class="section-title__n">' + g.items.length + '</span></h2>' +
              '<div class="tl tl--2">' + g.items.map(taskCard).join('') + '</div></section>';
          }).join('')
        : '<p class="allclear">' + doneMark('남은 업무가 없습니다.') + '</p>') +
      doneSection('완료된 업무', doneItems.length,
        '<div class="tl tl--2">' + doneItems.map(taskCard).join('') + '</div>');
  }

  function taskCard(t) {
    var people = assignsOf(t.id).map(assignPerson).filter(function (p) { return p.name; });
    var time = taskTime(t);
    var card = '<button class="task' + (taskStatus(t) === '완료' ? ' is-done' : '') + '" type="button" data-task="' + esc(t.id) + '">' +
      '<span class="task__top">' +
      (time ? '<span class="task__time">' + esc(time) + '</span>' : '') +
      (taskStatus(t) === '완료' ? doneMark('업무 완료') : badge(taskStatus(t))) +
      '<span class="tag tag--soft">' + esc(t.area || '기타') + '</span></span>' +
      '<span class="task__title">' + esc(t.title) + '</span>' +
      (t.place ? '<span class="task__meta">' + esc(t.place) + '</span>' : '') +
      // 맡은 몫까지 목록에 적으면 카드마다 높이가 달라져 훑기 어렵습니다.
      // 이름만 두고 자세한 것은 상세에서 봅니다.
      (people.length
        ? '<span class="task__people">' + people.map(function (p) {
            return '<span class="person">' + esc(p.name) + '</span>';
          }).join('') + '</span>'
        : '<span class="task__meta task__meta--none">담당자 미배정</span>') +
      '</button>';
    return actionCard(card, taskActions(t));
  }

  function taskDetail(id) {
    var t = S.tasks.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    var rows = [
      ['업무 영역', t.area],
      ['시간', taskTime(t)],
      ['장소', t.place]
    ].filter(function (r) { return r[1]; });

    var html = '<div class="notice__top">' + badge(taskStatus(t)) +
      '<span class="tag tag--soft">' + esc(t.area || '기타') + '</span></div>';

    if (rows.length) {
      html += '<dl class="dl">' + rows.map(function (r) {
        return '<div class="dl__row"><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
      }).join('') + '</dl>';
    }
    if (t.description) html += '<div class="noticebody">' + esc(t.description) + '</div>';

    var people = assignsOf(t.id).map(assignPerson).filter(function (p) { return p.name; });
    html += '<div><p class="field__label" style="margin-bottom:8px">담당자 ' + people.length + '명</p>' +
      (people.length
        ? '<div class="tl">' + people.map(function (p) {
            return '<div class="rowcard"><div class="rowcard__body">' +
              '<div class="rowcard__name">' + esc(p.name) +
              (p.role ? ' <span class="badge badge--plain">' + esc(p.role) + '</span>' : '') + '</div>' +
              (p.org ? '<div class="rowcard__meta">' + esc(p.org) + '</div>' : '') + '</div>' +
              (p.phone ? '<div class="rowcard__act"><a class="btn btn--primary btn--sm" href="' +
                esc(C.telHref(p.phone)) + '">전화</a></div>' : '') + '</div>';
          }).join('') + '</div>'
        : '<p class="nowcard__meta">아직 배정된 담당자가 없습니다.</p>') + '</div>';

    openDrawer(t.title, html, { footer: true });
  }

  /* 개인별 역할 — 사람을 고르면 그 사람의 하루가 시간순으로 열립니다. */
  function tasksByPerson() {
    if (!S.tasks.length) {
      return C.isTableMissing('operation_tasks')
        ? notReadyBox('담당 업무 기능이 아직 준비되지 않았습니다.')
        : samplePeople();
    }

    var people = peopleWithTasks();
    var q = ui.taskQ.trim().toLowerCase();
    var list = people.filter(function (p) {
      if (!q) return true;
      return (p.person.name + ' ' + p.person.org + ' ' + p.person.roleGroup)
        .toLowerCase().indexOf(q) >= 0;
    });

    /* 운영 인력 요약. 연락망에서 "운영 인력" 으로 표시한 사람을 셉니다.
       아직 그 칸이 없으면(마이그레이션 전) 숫자를 지어내지 않습니다. */
    var staff = staffList();
    var summary = '';
    if (staff && staff.length) {
      var byRole = {}, roles = [];
      staff.forEach(function (c) {
        var r = c.role_group || '기타';
        if (!byRole[r]) { byRole[r] = 0; roles.push(r); }
        byRole[r]++;
      });
      summary = '<div class="minigrid">' +
        '<div class="mini"><span class="mini__n">' + staff.length + '</span>' +
        '<span class="mini__l">전체 운영 인력</span></div>' +
        roles.map(function (r) {
          return '<div class="mini"><span class="mini__n">' + byRole[r] + '</span>' +
            '<span class="mini__l">' + esc(r) + '</span></div>';
        }).join('') + '</div>';
    }

    var tools = '<div class="tools"><div class="search">' +
      '<label class="sr-only" for="task-q">담당자 검색</label>' +
      '<input class="input" id="task-q" type="search" placeholder="이름 · 소속 · 역할 검색" value="' +
      esc(ui.taskQ) + '" /></div></div>';

    var body = list.length
      ? '<div class="tl tl--2">' + list.map(function (p) {
          return '<button class="rowcard rowcard--btn" type="button" data-person="' + esc(p.person.key) + '">' +
            '<span class="rowcard__body">' +
            '<span class="rowcard__name">' + esc(p.person.name) +
            (p.person.roleGroup ? ' <span class="badge badge--plain">' + esc(p.person.roleGroup) + '</span>' : '') +
            '</span>' +
            '<span class="rowcard__meta">' + esc(p.person.org || '소속 미정') +
            ' · 담당 업무 ' + p.tasks.length + '건</span></span>' +
            '<span class="rowcard__act"><span class="rowcard__go" aria-hidden="true">›</span></span></button>';
        }).join('') + '</div>'
      : noMatchBox('조건에 맞는 담당자가 없습니다.');

    return summary + tools +
      (list.length ? '<p class="resultline">' + list.length + '명</p>' : '') + body;
  }

  function personDetail(key) {
    var p = peopleWithTasks().filter(function (x) { return x.person.key === key; })[0];
    if (!p) return;

    var rows = [
      ['소속', p.person.org],
      ['역할', p.person.roleGroup]
    ].filter(function (r) { return r[1]; });

    var html = '';
    if (rows.length) {
      html += '<dl class="dl">' + rows.map(function (r) {
        return '<div class="dl__row"><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
      }).join('') + '</dl>';
    }
    if (p.person.phone) {
      html += '<a class="btn btn--primary btn--full" href="' + esc(C.telHref(p.person.phone)) + '">' +
        '전화 · ' + esc(p.person.phone) + '</a>';
    }

    html += '<div><p class="field__label" style="margin-bottom:8px">담당 업무 ' + p.tasks.length + '건</p>' +
      '<div class="tml tml--plain">' + p.tasks.map(function (it) {
        return '<div class="tmlrow">' +
          '<div class="tmlrow__time">' + esc(taskTime(it.task) || '시간 미정') + '</div>' +
          '<div class="tmlrow__body"><div class="tmlrow__title">' + esc(it.task.title) + '</div>' +
          '<div class="tmlrow__meta">' + esc(it.task.place || '장소 미정') +
          (it.role ? ' · ' + esc(it.role) : '') + '</div>' +
          '<div class="tmlrow__tags">' + badge(taskStatus(it.task)) + '</div></div></div>';
      }).join('') + '</div></div>';

    openDrawer(p.person.name, html, { footer: true });
  }

  /* ══ 운영 물품 ══════════════════════════════════════════════════
     "누구에게 무엇을 몇 개 주었는가" 를 확인하는 화면입니다.
     사람 명단을 통째로 펼치지 않고 기관·팀·부스 단위로만 봅니다 —
     포털은 링크만 알면 열리므로 개인 명단을 올릴 자리가 아닙니다.

     포털에서는 보기만 합니다. 배부 상태·수량·물품은 운영본부가 관리자에서 정합니다. */
  function allocsOf(targetId) {
    return S.supplyAllocs.filter(function (a) { return a.target_id === targetId; })
      .map(function (a) {
        var item = S.supplyItems.filter(function (x) { return x.id === a.item_id; })[0];
        return { name: item ? item.name : '', unit: item ? (item.unit || '개') : '개', qty: a.qty || 0 };
      })
      .filter(function (a) { return a.name; });
  }

  var SAMPLE_SUPPLIES = [
    { name: '운영본부', kind: '팀', status: '배부 완료', items: ['명찰', '운영키트', '생수'] },
    { name: '부스 운영 기관', kind: '기관', status: '일부 배부', items: ['명찰', '식권'] },
    { name: '체험 부스', kind: '부스', status: '미배부', items: ['운영키트'] }
  ];

  function sampleSupplies() {
    return sampleWrap(
      '등록된 운영 물품이 없습니다. 아래는 배부 현황이 어떻게 표시되는지 보여 주는 예시이며, ' +
      '실제 물품이 등록되면 사라집니다. 물품 종류와 수량은 관리자에서 등록한 값이 표시됩니다.',
      SAMPLE_SUPPLIES.map(function (t) {
        return '<div class="supply is-sample">' +
          '<div class="supply__top">' + badge(t.status) +
          '<span class="badge badge--plain">' + esc(t.kind) + '</span>' + SAMPLE + '</div>' +
          '<div class="supply__name">' + esc(t.name) + '</div>' +
          '<div class="supply__items">' + t.items.map(function (n) {
            return '<span class="chipitem">' + esc(n) + '<b>–</b></span>';
          }).join('') + '</div></div>';
      }).join(''), true);
  }

  /* ── 화면: 운영 물품 ────────────────────────────────────────── */
  function viewSupplies() {
    var head = pageHead('운영 물품',
      '기관·팀·부스별 물품 배부 현황을 확인합니다. 배부 상태는 운영본부에서 관리합니다.');

    if (!S.supplyTargets.length) {
      return '<div class="page">' + head +
        (C.isTableMissing('supply_targets')
          ? notReadyBox('운영 물품 기능이 아직 준비되지 않았습니다.')
          : sampleSupplies()) + '</div>';
    }

    var byStatus = {};
    SUPPLY_STATES.forEach(function (st) {
      byStatus[st] = S.supplyTargets.filter(function (t) { return t.status === st; }).length;
    });

    var summary = summaryGrid([
      { n: S.supplyTargets.length, l: '전체 대상' },
      { n: byStatus['미배부'], l: '미배부', tone: byStatus['미배부'] ? 'warn' : null },
      { n: byStatus['일부 배부'], l: '일부 배부', tone: byStatus['일부 배부'] ? 'info' : null },
      { n: byStatus['배부 완료'], l: '배부 완료', tone: byStatus['배부 완료'] ? 'ok' : null }
    ]);

    var q = ui.supplyQ.trim().toLowerCase();
    var list = S.supplyTargets.filter(function (t) {
      if (!q) return true;
      var items = allocsOf(t.id).map(function (a) { return a.name; }).join(' ');
      return (t.name + ' ' + (t.manager || '') + ' ' + (t.kind || '') + ' ' + items)
        .toLowerCase().indexOf(q) >= 0;
    });
    // 미배부를 일부 배부보다 먼저 둡니다. 아무것도 못 받은 곳이 더 급합니다.
    var rankS = { '미배부': 0, '일부 배부': 1 };
    var need = list.filter(function (t) { return t.status !== '배부 완료'; })
      .sort(function (a, b) { return (rankS[a.status || '미배부'] || 0) - (rankS[b.status || '미배부'] || 0); });
    var done = list.filter(function (t) { return t.status === '배부 완료'; });

    var tools = '<div class="tools"><div class="search">' +
      '<label class="sr-only" for="supply-q">물품 검색</label>' +
      '<input class="input" id="supply-q" type="search" placeholder="대상 · 담당자 · 물품 검색" value="' +
      esc(ui.supplyQ) + '" /></div></div>';

    var body = !list.length ? noMatchBox('조건에 맞는 배부 대상이 없습니다.') :
      '<section class="listsec"><h2 class="section-title">배부 확인 필요' +
      '<span class="section-title__n">' + need.length + '</span></h2>' +
      (need.length
        ? '<div class="tl tl--2">' + need.map(supplyCard).join('') + '</div>'
        : '<p class="allclear">' + doneMark('확인할 대상이 없습니다.') + '</p>') +
      '</section>' +
      doneSection('배부 완료', done.length, '<div class="tl tl--2">' + done.map(supplyCard).join('') + '</div>');

    return '<div class="page">' + head + summary + tools + body + '</div>';
  }

  /* 물품은 '명찰 6 · 생수 12' 한 줄로 적습니다. 목록에서 알고 싶은 것은
     무엇을 몇 개 받기로 했는가이고, 넷째부터는 +N 으로 줄입니다. */
  function supplyCard(t) {
    var items = allocsOf(t.id);
    var st = t.status || '미배부';
    var card = '<button class="supply' + (st === '배부 완료' ? ' is-done' : '') + '" type="button" data-supply="' + esc(t.id) + '">' +
      '<span class="supply__top">' + (st === '배부 완료' ? doneMark('배부 완료') : badge(st)) +
      '<span class="tag tag--soft">' + esc(t.kind || '팀') + '</span>' +
      (t.headcount ? '<span class="notice__meta">' + t.headcount + '명</span>' : '') + '</span>' +
      '<span class="supply__name">' + esc(t.name) + '</span>' +
      (t.manager ? '<span class="supply__meta">담당 ' + esc(t.manager) + '</span>' : '') +
      (items.length
        ? '<span class="supply__line">' + items.slice(0, 3).map(function (a) {
            return esc(a.name) + ' <b>' + a.qty + '</b>';
          }).join('<span aria-hidden="true"> · </span>') +
          (items.length > 3 ? ' <span class="muted">+' + (items.length - 3) + '</span>' : '') + '</span>'
        : '<span class="supply__meta supply__meta--none">배부 물품 미등록</span>') +
      '</button>';
    // 관계자는 보기만 합니다. 배부 상태는 운영본부가 관리자에서 정합니다.
    return card;
  }

  function supplyDetail(id) {
    var t = S.supplyTargets.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    var items = allocsOf(t.id);
    var rows = [
      ['구분', t.kind],
      ['담당자', t.manager],
      ['인원', t.headcount ? t.headcount + '명' : ''],
      ['메모', t.memo]
    ].filter(function (r) { return r[1]; });

    var html = '<div class="notice__top">' + badge(t.status || '미배부') +
      '<span class="notice__meta">최근 변경 ' + esc(fmtDay(t.updated_at)) + '</span></div>';

    if (rows.length) {
      html += '<dl class="dl">' + rows.map(function (r) {
        return '<div class="dl__row"><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
      }).join('') + '</dl>';
    }

    html += '<div><p class="field__label" style="margin-bottom:8px">배부 물품 ' + items.length + '종</p>' +
      (items.length
        ? '<table class="qtytable"><thead><tr><th scope="col">물품</th>' +
          '<th scope="col" class="qtytable__n">수량</th></tr></thead><tbody>' +
          items.map(function (a) {
            return '<tr><td>' + esc(a.name) + '</td><td class="qtytable__n">' +
              a.qty + ' ' + esc(a.unit) + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<p class="nowcard__meta">등록된 배부 물품이 없습니다.</p>') + '</div>';

    openDrawer(t.name, html, { footer: true });
  }

  /* ── 라우터 ─────────────────────────────────────────────────── */
  var VIEWS = {
    dashboard: viewDashboard, schedule: viewSchedule, booths: viewBooths,
    notices: viewNotices, requests: viewRequests, tasks: viewTasks,
    supplies: viewSupplies, resources: viewResources,
    contacts: viewContacts, venue: viewVenue, faq: viewFaq
  };

  function render() {
    var host = $('#view');
    if (S.loading) { host.innerHTML = stateBox('데이터를 불러오는 중입니다.'); return; }
    if (S.error)   { host.innerHTML = stateBox(S.error, 'error', true); return; }
    // 화면마다 아주 옅은 색 하나를 씁니다(portal.css 의 [data-view]).
    // 상태 색(긴급·주의·완료)과는 따로 둡니다.
    host.setAttribute('data-view', view);
    host.innerHTML = (VIEWS[view] || viewDashboard)();
    fitMedia(host);
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
    function link(n) {
      return '<a href="#' + n.id + '" class="' + (n.id === view ? 'is-on' : '') + '"' +
        (n.id === view ? ' aria-current="page"' : '') + '>' + esc(n.label) + badgeFor(n.id) + '</a>';
    }
    /* 그룹 제목을 사이에 끼워 메뉴가 세 덩어리로 읽히게 합니다.
       제목은 누를 수 없는 글자라 탭 순서에 끼어들지 않습니다. */
    function group(name) {
      var items = NAV.filter(function (n) { return n.group === name; });
      if (!items.length) return '';
      return '<p class="side__group">' + esc(name) + '</p>' + items.map(link).join('');
    }
    // 관리자 링크는 늘 보입니다. 눌러도 admin.html 이 스스로 로그인을
    // 요구하므로, 링크가 보인다고 해서 열리는 것은 아닙니다.
    $('#sidenav').innerHTML =
      NAV.filter(function (n) { return !n.group; }).map(link).join('') +
      NAV_GROUPS.map(group).join('') +
      '<p class="side__group">관리</p><a href="admin.html">관리자</a>';

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

    /* 더보기 시트도 같은 묶음으로 보여 줍니다. 사이드바와 순서가
       다르면 PC 로 익힌 위치가 휴대폰에서 통하지 않습니다. */
    function sheetLink(n) {
      return '<a href="#' + n.id + '" class="' + (n.id === view ? 'is-on' : '') + '">' +
        esc(n.label) + badgeFor(n.id) + '</a>';
    }
    $('#sheetnav').innerHTML = NAV_GROUPS.map(function (name) {
      var items = NAV.filter(function (n) { return n.group === name && !n.tab; });
      if (!items.length) return '';
      return '<p class="sheet__group">' + esc(name) + '</p>' + items.map(sheetLink).join('');
    }).join('') + '<p class="sheet__group">관리</p><a href="admin.html">관리자</a>';
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

    document.addEventListener('click', function (e) {
      var t = e.target;

      if (t.closest('[data-open-sheet]')) { openSheet(); return; }
      if (t.closest('[data-close-sheet]')) { closeSheet(); return; }
      if (t.closest('[data-close-drawer]')) { closeDrawer(); return; }
      if (t.closest('[data-retry]')) { boot(true); return; }

      var go2 = t.closest('[data-go]');
      if (go2) {
        var f = go2.getAttribute('data-filter');
        // 하이라이트에서 건너왔다면 일정 화면을 핵심 일정만 켠 채로
        // 엽니다. 전체 목록에서 방금 본 일정을 다시 찾게 하지 않습니다.
        if (go2.hasAttribute('data-schedkey')) {
          ui.schedKey = true; ui.schedCat = '전체'; ui.schedHalf = '전체'; ui.schedQ = '';
        }
        location.hash = '#' + go2.dataset.go;
        return;
      }

      // 확대 보기는 드로어 안에서도 열리므로 다른 처리보다 먼저 봅니다.
      var zoom = t.closest('[data-zoom]');
      if (zoom) {
        openZoom(zoom.getAttribute('data-zoom'), zoom.getAttribute('data-zoomcap'));
        return;
      }
      if (t.closest('[data-close-zoom]')) { closeZoom(); return; }

      var chip = t.closest('[data-boothzone],[data-schedcat],[data-schedhalf],' +
        '[data-contactcat],[data-faqcat],[data-taskarea],[data-boothtype]');
      if (chip) {
        if (chip.hasAttribute('data-boothzone'))   ui.boothZone   = chip.getAttribute('data-boothzone');
        if (chip.hasAttribute('data-boothtype'))   ui.boothType   = chip.getAttribute('data-boothtype');
        if (chip.hasAttribute('data-schedcat'))    ui.schedCat    = chip.getAttribute('data-schedcat');
        if (chip.hasAttribute('data-contactcat'))  ui.contactCat  = chip.getAttribute('data-contactcat');
        if (chip.hasAttribute('data-faqcat'))      ui.faqCat      = chip.getAttribute('data-faqcat');
        if (chip.hasAttribute('data-schedhalf'))   ui.schedHalf   = chip.getAttribute('data-schedhalf');
        if (chip.hasAttribute('data-taskarea'))    ui.taskArea    = chip.getAttribute('data-taskarea');
        render();
        return;
      }

      var bo = t.closest('[data-booth]');   if (bo) { boothDetail(bo.getAttribute('data-booth')); return; }
      var no = t.closest('[data-notice]');  if (no) { noticeDetail(no.getAttribute('data-notice')); return; }
      var sn = t.closest('[data-samplenotice]');
      if (sn) { noticeDetailView(SAMPLE_NOTICES[Number(sn.getAttribute('data-samplenotice'))]); return; }
      var rq = t.closest('[data-req]');     if (rq) { requestDetail(rq.getAttribute('data-req')); return; }
      var tk = t.closest('[data-task]');    if (tk) { taskDetail(tk.getAttribute('data-task')); return; }
      var pe = t.closest('[data-person]');  if (pe) { personDetail(pe.getAttribute('data-person')); return; }
      var sp = t.closest('[data-supply]');  if (sp) { supplyDetail(sp.getAttribute('data-supply')); return; }

      // 보기 방식 전환(업무별 ↔ 개인별). 검색어는 두 화면이 찾는
      // 대상이 달라서 함께 비웁니다.
      if (t.closest('[data-schedkeytoggle]')) { ui.schedKey = !ui.schedKey; render(); return; }

      if (t.closest('[data-guide]')) {
        openDrawer('운영 안내',
          '<div class="noticebody">' + esc(((S.settings || {}).ops_guide || '').trim()) + '</div>',
          { footer: true });
        return;
      }

      var tm = t.closest('[data-taskmode]');
      if (tm) { ui.taskMode = tm.getAttribute('data-taskmode'); ui.taskQ = ''; render(); return; }
      if (t.closest('[data-newreq]')) { openRequestForm(); return; }


      var rd = t.closest('[data-reqdone]');
      if (rd) { resolveRequest(rd.getAttribute('data-reqdone'), rd); return; }

      var tn = t.closest('[data-tasknext]');
      if (tn) { setTaskStatus(tn.getAttribute('data-tasknext'), tn.getAttribute('data-to'), tn); return; }


      var cp = t.closest('[data-copyphone]');
      if (cp) { copyPhone(cp.getAttribute('data-copyphone')); return; }

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
      if (e.target.id === 'resource-q') { ui.resourceQ = e.target.value; softRender('#resource-q'); }
      if (e.target.id === 'task-q')    { ui.taskQ = e.target.value; softRender('#task-q'); }
      if (e.target.id === 'supply-q')  { ui.supplyQ = e.target.value; softRender('#supply-q'); }
    });

    document.addEventListener('submit', function (e) {
      if (e.target.id === 'reqform') { e.preventDefault(); submitRequest(); }
    });

    document.addEventListener('keydown', trapInDrawer);

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      // 확대 보기가 맨 위에 있으므로 먼저 닫습니다.
      if (!$('#zoom').hidden) closeZoom();
      else if (!$('#drawer').hidden) closeDrawer();
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

  /* ══ 현장 상태 처리 ════════════════════════════════════════════
     관계자가 현장에서 직접 바꿀 수 있는 것은 "상태" 뿐입니다.
     이름·수량·담당자 같은 값은 관리자 몫이고, 서버에서도 그렇게
     막혀 있습니다 — 표에 쓰기 권한을 여는 대신 상태 한 칸만 바꾸는
     함수만 열어 두었습니다.

     요청·업무 두 화면이 같은 길을 씁니다.
       누름 → (필요하면) 확인 → 버튼 잠금 → 서버 → 화면 갱신 → 알림
     실패하면 아무것도 바꾸지 않고 이유만 알립니다. 미리 바꿔 두었다가
     되돌리면, 잠깐 보였던 값이 맞는지 사람이 알 수 없게 됩니다. */
  function runAction(opts) {
    var btn = opts.btn;
    if (btn.disabled) return;            // 두 번 눌러도 한 번만 갑니다

    function go() {
      btn.disabled = true;
      var was = btn.textContent;
      btn.textContent = '처리 중…';
      C.rpc(opts.rpc, opts.args).then(function (row) {
        opts.apply(row);
        toast(opts.okText);
        render();
        if (opts.after) opts.after(row);
      }).catch(function (e) {
        console.error('[portal] 상태 변경 실패', opts.rpc, e);
        toast(actionMessage(e), true);
        btn.disabled = false;
        btn.textContent = was;
      });
    }

    if (!opts.confirm) { go(); return; }
    UI.confirm(opts.confirm).then(function (ok) { if (ok) go(); });
  }

  /* 서버가 막은 경우를 사람 말로 옮깁니다. 기능이 아직 없는 것과
     규칙에 어긋난 것을 구분해야 무엇을 해야 할지 알 수 있습니다. */
  function actionMessage(e) {
    var m = (e && e.message) || '';
    var code = (e && e.code) || '';
    if (code === '42883' || /function .* does not exist/i.test(m)) {
      return '이 기능이 아직 준비되지 않았습니다. supabase/migration-portal-actions.sql 을 실행해 주세요.';
    }
    if (code === '22023') return m;      // 함수가 남긴 안내를 그대로 보여 줍니다
    if (code === 'P0002') return '이미 지워졌거나 찾을 수 없습니다. 새로고침해 주세요.';
    return C.dataMessage(e);
  }

  /* 카드 아래에 붙는 액션 줄. 카드 자체가 button 이라 그 안에 또
     button 을 넣을 수 없습니다. 바깥에서 한 번 감싸고 아래에 답니다. */
  function actionCard(card, actions) {
    if (!actions) return card;
    return '<div class="actcard">' + card +
      '<div class="actcard__act">' + actions + '</div></div>';
  }
  function actBtn(attrs, label, kind) {
    return '<button class="btn btn--' + (kind || 'primary') + ' btn--sm" type="button" ' +
      attrs + '>' + esc(label) + '</button>';
  }

  /* ── 운영 요청: 해결 완료 ───────────────────────────────────── */
  function resolveRequest(id, btn) {
    var r = S.requests.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    runAction({
      btn: btn,
      rpc: 'resolve_operation_request',
      args: { p_id: id },
      confirm: {
        title: '이 요청이 해결되었나요?',
        message: '“' + r.title + '” 을 해결 완료로 표시합니다. ' +
                 '완료된 요청은 미처리 요청 수에서 빠지고 아래 “해결 완료” 로 옮겨집니다.',
        confirmLabel: '해결 완료'
      },
      okText: '해결 완료로 처리했습니다.',
      apply: function (row) {
        S.requests = S.requests.map(function (x) { return x.id === id ? row : x; });
      }
    });
  }

  /* ── 담당 업무: 시작 / 완료 ─────────────────────────────────── */
  function taskStatus(t) { return t.status || '예정'; }

  function setTaskStatus(id, next, btn) {
    var t = S.tasks.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    runAction({
      btn: btn,
      rpc: 'set_operation_task_status',
      args: { p_id: id, p_status: next },
      // 시작은 바로, 완료는 한 번 묻습니다. 되돌리려면 관리자를 거쳐야
      // 해서, 끝냈다는 표시는 신중해야 합니다.
      confirm: next === '완료' ? {
        title: '이 업무를 완료 처리할까요?',
        message: '“' + t.title + '” 업무를 완료로 바꿉니다. ' +
                 '되돌리려면 관리자에게 요청해야 합니다.',
        confirmLabel: '완료'
      } : null,
      okText: next === '완료' ? '업무를 완료했습니다.' : '업무를 시작했습니다.',
      apply: function (row) {
        S.tasks = S.tasks.map(function (x) { return x.id === id ? row : x; });
      }
    });
  }

  function taskActions(t) {
    var st = taskStatus(t);
    if (st === '예정') {
      return actBtn('data-tasknext="' + esc(t.id) + '" data-to="진행 중"', '업무 시작');
    }
    if (st === '진행 중') {
      return actBtn('data-tasknext="' + esc(t.id) + '" data-to="완료"', '업무 완료');
    }
    return '';   // 완료된 업무에는 단추를 두지 않습니다
  }

  /* ── 쓰기 동작 ──────────────────────────────────────────────── */
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
    // 로그인 개념이 없으므로 등록자는 적어 주는 대로 저장합니다.
    // status 는 반드시 '접수' 여야 합니다 — 데이터베이스 정책이
    // 비로그인 등록을 '접수' 로만 받습니다.
    C.insert('operation_requests', {
      location: loc.value.trim(),
      kind: $('#rq-kind').value,
      priority: $('#rq-pri').value,
      title: title.value.trim(),
      body: $('#rq-body').value.trim(),
      reporter: $('#rq-by').value.trim(),
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
      // 검색어를 입력하는 중에 다시 그리면 글자가 끊깁니다.
      var typing = document.activeElement && document.activeElement.tagName === 'INPUT';
      if (d.getSeconds() % 30 !== 0 || typing) return;
      if (view === 'dashboard' || view === 'schedule') render();
    }
    tick();
    clockTimer = setInterval(tick, 1000);
  }

  /* ── 시작 ───────────────────────────────────────────────────────
     로그인 단계가 없습니다. 설정만 확인하고 바로 데이터를 부릅니다.
     "무엇을 볼 수 있는가"는 여기서 정하지 않고 데이터베이스의 열람
     정책이 정합니다. ─────────────────────────────────────────── */
  function boot() {
    if (!C.isConfigured()) {
      $('#gate-setup').hidden = false;
      $('#app').hidden = true;
      return;
    }
    $('#gate-setup').hidden = true;
    $('#app').hidden = false;

    S.loading = true;
    view = routeFromHash();
    render();
    return loadAll().then(function () {
      go();
      startClock();
    });
  }

  bind();
  boot();
})();
