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

  function svgIcon(d) {
    return '<svg class="tab__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + d + '</svg>';
  }
  var TAB_ICONS = {
    dashboard: svgIcon('<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>'),
    schedule:  svgIcon('<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>'),
    booths:    svgIcon('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/>' +
                       '<rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
    notices:   svgIcon('<path d="M5 10v4h3l6 4V6l-6 4H5z"/><path d="M17.5 9.5a3.5 3.5 0 0 1 0 5"/>'),
    more:      svgIcon('<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>')
  };

  var SCHEDULE_CATS = ['무대', '강연', '부스', '운영', '행사 지원'];
  /* 새 요청에서 고를 수 있는 유형입니다. 이미 등록된 요청의 유형은
     이 목록과 상관없이 그대로 표시됩니다(r.kind 를 그대로 씁니다). */
  var REQ_KINDS     = ['전기', '네트워크', '기자재', '시설', '안전', '물품', '기타'];
  var REQ_PRIORITY  = ['긴급', '높음', '보통'];

  /* 상태 → 배지 색. 색만으로 뜻을 전하지 않도록 글자는 항상 함께 씁니다. */
  var TONE = {
    '운영 중': 'ok', '준비 완료': 'info', '준비 전': 'warn',
    '일시 중단': 'danger', '운영 종료': 'off',
    '진행 중': 'ok', '예정': 'info', '종료': 'off', '취소': 'danger', '변경': 'warn',
    '긴급': 'danger', '중요': 'warn', '일반': 'info',
    '높음': 'warn', '보통': 'info',
    '접수': 'warn', '확인 중': 'info', '처리 중': 'info', '완료': 'ok',
    '미배부': 'warn', '일부 배부': 'info', '배부 완료': 'ok',
    '배부 예정': 'warn', '배부 중': 'info'
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
             schedCat: '전체', schedQ: '', schedHalf: '전체', schedKey: false, schedDay: '',
             taskMode: '업무별', taskArea: '전체', taskQ: '', taskPerson: '',
             supplyQ: '', supplyState: '전체', resourceQ: '',
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

    /* 행사일 목록. 여러 날 행사(예: 이틀)면 시작일부터 종료일까지 하루씩.
       sameDay 는 '오늘이 행사일 중 하루인가' 입니다 — 첫날만 보면 둘째 날에
       진행 중 판단이 꺼집니다. */
    var days = [];
    var endDay = dayStart(end < start ? start : end);
    for (var d = dayStart(start); d <= endDay && days.length < 14; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      days.push(d);
    }
    var today = dayStart(now);
    var sameDay = days.some(function (x) { return x.getTime() === today.getTime(); });
    var phase = 'before';
    if (now > end) phase = 'after';
    else if (now >= start || sameDay) phase = 'during';

    var dday = Math.ceil((dayStart(start) - today) / 86400000);
    return { phase: phase, start: start, end: end, now: now, sameDay: sameDay, dday: dday, days: days };
  }
  function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function ymd(d) { return d.getFullYear() + '-' + C.pad2(d.getMonth() + 1) + '-' + C.pad2(d.getDate()); }

  /* 일정 하나의 실시간 상태. 행사 당일에만 시각으로 계산합니다. */
  function liveStatus(item, ev) {
    if (item.status === '취소' || item.status === '변경') return item.status;
    if (!ev.sameDay) return item.status || '예정';
    // 날짜가 붙은 일정(여러 날 행사)은 오늘 것만 시각으로 판단합니다.
    var day = itemDay(item), today = ymd(ev.now);
    if (day && day !== today) return day < today ? '종료' : '예정';
    var nowMin = ev.now.getHours() * 60 + ev.now.getMinutes();
    var a = C.toMin(item.start_time), b = C.toMin(item.end_time);
    if (a == null) return item.status || '예정';
    if (b == null) b = a + 30;
    if (nowMin < a) return '예정';
    if (nowMin >= b) return '종료';
    return '진행 중';
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
  // 카드 줄 오른쪽 끝에 작게. 실제 상태 배지보다 약하게 보입니다.
  var SAMPLE_END = '<span class="sampletag">예시</span>';
  var SAMPLE_NOTE = '예시 화면입니다. 실제 데이터가 등록되면 자동으로 바뀝니다.';

  /* cols: 1(한 줄씩) · 2(기존 두 칸 규칙) · 3(짧은 예시 석 장 — 폭이 넉넉할 때만 세 칸).
     head: 안내문과 목록 사이에 끼울 것(예: 예시 현황 숫자). */
  function sampleWrap(note, cards, cols, head) {
    var cls = cols === 3 ? ' tl--3s' : cols ? ' tl--2' : '';
    return '<div class="sample">' +
      '<p class="samplenote">' + esc(note) + '</p>' + (head || '') +
      '<div class="tl' + cls + '" aria-label="예시 목록">' +
      cards + '</div></div>';
  }

  function emptyBox(title, hint) {
    return '<div class="state state--empty">' +
      '<span class="state__icon">' + ICON_EMPTY + '</span>' +
      '<p class="state__title">' + esc(title) + '</p>' +
      (hint ? '<p class="state__hint">' + esc(hint) + '</p>' : '') + '</div>';
  }

  /* 화면별 예시. 행사 운영에서 실제로 생길 법한 사례로 두되,
     사람 이름·전화번호·확정되지 않은 시각은 만들지 않습니다.
     역할명·부스 번호처럼 "무엇이 이 자리에 오는지" 만 보여 줍니다. */
  /* 예시 공지는 목록과 상세가 같은 원본을 씁니다. 눌러서 상세까지
     볼 수 있어야 실제 화면 흐름을 이해할 수 있습니다. */
  var SAMPLE_NOTICES = [
    { level: '중요', sample: true,
      title: '부스 운영자 사전 안내',
      summary: '부스 세팅 시간과 준비사항을 확인해 주세요.',
      body: '행사 전 부스 운영자가 확인해야 할 세팅 시간, 준비물, 반입 방법, ' +
            '운영 유의사항 등이 등록되면 이곳에서 자세히 확인할 수 있습니다.' },
    { level: '일반', sample: true,
      title: '물품 반입 및 설치 안내',
      summary: '운영 물품 반입 시간과 설치 기준을 안내합니다.',
      body: '물품 반입 동선, 반입 가능 시간, 부스 설치 기준과 관련된 안내가 ' +
            '확정되면 이곳에서 확인할 수 있습니다.' },
    { level: '긴급', sample: true,
      title: '행사 당일 운영 변경 안내',
      summary: '일정 또는 장소 변경 시 최우선으로 표시됩니다.',
      body: '행사 당일 일정 변경, 장소 변경, 안전 관련 안내 등 ' +
            '즉시 확인해야 하는 내용이 긴급 공지로 표시됩니다.' }
  ];

  function sampleNotices() {
    return sampleWrap(SAMPLE_NOTE + ' 눌러서 상세도 볼 수 있습니다.',
      SAMPLE_NOTICES.map(function (n, i) {
        // button 이라 마우스·Enter·Space 가 모두 됩니다.
        return '<button class="notice is-sample' + (n.level === '긴급' ? ' notice--urgent' : '') +
          '" type="button" data-samplenotice="' + i + '">' +
          '<span class="notice__top">' + badge(n.level) + SAMPLE_END + '</span>' +
          '<span class="notice__title">' + esc(n.title) + '</span>' +
          '<span class="notice__body">' + esc(n.summary) + '</span></button>';
      }).join(''), 2);
  }

  /* 요청은 실제 카드처럼 우선순위·상태·유형 · 제목 · 위치 한 줄.
     현장 요청은 대부분 특정 부스에서 생기므로 부스번호가 드러나게 합니다.
     부스 번호는 부스 예시(SAMPLE_BOOTHS)와 맞춥니다. */
  var SAMPLE_REQUESTS = [
    { pri: '높음', st: '접수',  kind: '전기',     title: 'A-18 부스 멀티탭 추가 요청', booth: 'A-18',
      body: '체험용 기기 전원이 부족해 멀티탭 1개가 더 필요합니다.', where: 'A-18 부스 · AI스쿨존' },
    { pri: '보통', st: '처리 중', kind: '네트워크', title: 'A-12 부스 와이파이 연결 확인', booth: 'A-12',
      body: '체험용 노트북 2대가 행사장 와이파이에 연결되지 않습니다.', where: 'A-12 부스 · 전산지원팀 확인 중' },
    { pri: '보통', st: '완료',  kind: '시설',     title: '미래채움-03 부스 테이블 추가 요청', booth: '미래채움-03',
      body: '체험 도구 배치를 위해 테이블 1개가 더 필요합니다.', where: '미래채움-03 부스 · 미래채움존' }
  ];

  function sampleRequests() {
    return sampleWrap(SAMPLE_NOTE,
      SAMPLE_REQUESTS.map(function (r) {
        var done = r.st === '완료';
        return '<div class="req is-sample">' +
          '<span class="req__top">' + (done ? doneMark('해결 완료') : badge(r.pri) + badge(r.st)) +
          '<span class="tag tag--soft">' + esc(r.kind) + '</span>' + SAMPLE_END + '</span>' +
          '<span class="req__title">' + esc(r.title) + '</span>' +
          '<span class="req__body">' + esc(r.body) + '</span>' +
          '<span class="req__meta">' + esc(r.where) + '</span></div>';
      }).join(''));
  }

  function sampleResources() {
    return sampleWrap(SAMPLE_NOTE,
      [
        ['운영 매뉴얼', '행사 운영 매뉴얼', '운영 절차와 시간대별 역할을 정리한 자료입니다.'],
        ['부스 운영', '부스 운영자 안내', '부스 준비 · 운영 · 철수 기준을 확인합니다.'],
        ['안전관리', '안전·비상대응 안내', '안전사고와 비상상황 대응 절차를 확인합니다.']
      ].map(function (r) {
        // 예시에는 열 수 있는 파일이 없어 '자료 열기' 단추를 만들지 않습니다.
        return '<div class="rescard is-sample">' +
          '<div class="rescard__top"><span class="rescard__kind">' + esc(r[0]) + '</span>' + SAMPLE_END + '</div>' +
          '<div class="rescard__title">' + esc(r[1]) + '</div>' +
          '<p class="rescard__desc">' + esc(r[2]) + '</p></div>';
      }).join(''), 3);
  }

  function sampleContacts() {
    return sampleWrap(SAMPLE_NOTE,
      // 사람이 아니라 역할로 찾게 합니다. 부스에서 문제가 생겼을 때 어느 팀에
      // 연락할지가 먼저 보이도록 부스 운영 책임 순서대로 둡니다.
      [
        ['운영본부', '행사 운영 총괄', '행사 진행과 전체 운영 문의'],
        ['부스지원팀', '부스 운영 지원', '운영자 입장 · 세팅 · 교대 · 마감 · 철수'],
        ['전산지원팀', '전원·네트워크 지원', '전원 · 인터넷 · 노트북 · 장비 문제'],
        ['운영지원팀', '운영 물품 지원', '물품 배부 · 추가 요청 · 회수'],
        ['안전지원팀', '안전·응급 대응', '안전사고 · 응급 상황 · 관람객 동선']
      ].map(function (c) {
        // 이름·번호는 만들지 않습니다. 번호가 등록되면 전화·복사 단추가 생깁니다.
        return '<div class="contact is-sample">' +
          '<div class="contact__top"><span class="tag tag--soft">' + esc(c[0]) + '</span>' + SAMPLE_END + '</div>' +
          '<div class="contact__name">' + esc(c[1]) + '</div>' +
          '<div class="contact__meta">' + esc(c[2]) + '</div>' +
          '<div class="contact__memo">번호 등록 후 전화 · 복사 가능</div></div>';
      }).join(''), 3);
  }

  function samplePlaces() {
    return sampleWrap(SAMPLE_NOTE,
      [
        ['운영본부', '운영 총괄 · 현장 지원 · 물품 수령'],
        ['메인 무대', '개막식 · 공연 · 시상 진행'],
        ['안내 데스크', '참가자 안내 · 분실물 · 문의 접수'],
        ['안전 지원', '응급 처치 · 안전 요원 대기']
      ].map(function (p) {
        // 층수나 위치는 확정되지 않아 적지 않습니다.
        return '<div class="rowcard is-sample"><div class="rowcard__body">' +
          '<div class="rowcard__name">' + esc(p[0]) + SAMPLE_END + '</div>' +
          '<div class="rowcard__meta">' + esc(p[1]) + '</div></div></div>';
      }).join(''), 2);
  }

  function sampleFaqs() {
    return sampleWrap(SAMPLE_NOTE,
      [
        // 확정되지 않은 답은 확정된 것처럼 쓰지 않습니다. 포털 기능 안내만 단정합니다.
        ['부스 운영자는 몇 시까지 도착해야 하나요?', '도착 시간이 확정되면 이곳과 공지에 안내됩니다.'],
        ['운영 중 전기나 네트워크 문제가 생기면 어떻게 하나요?', '운영 요청 메뉴에서 위치와 내용을 등록할 수 있습니다.'],
        ['운영 물품은 어디에서 확인하나요?', '운영 물품 메뉴에서 기관·팀·부스별 배부 현황을 확인할 수 있습니다.'],
        ['안전사고 발생 시 누구에게 연락하나요?', '안전 담당 연락처가 확정되면 연락망에 안내됩니다.']
      ].map(function (f) {
        // 접었다 펴는 동작 없이 질문과 답을 함께 보여 줍니다.
        return '<div class="faq is-sample">' +
          '<div class="faq__q faq__q--static"><span>' + esc(f[0]) + '</span>' + SAMPLE_END + '</div>' +
          '<div class="faq__a">' + esc(f[1]) + '</div></div>';
      }).join(''));
  }

  /* 운영 일정 예시 — 이틀(11.13 · 11.14) 행사 기준.
     2025 행사의 실제 흐름(개막식 순서, AI체험존 50분 회차, 둘째 날 강연·
     시상식)을 시간 밀도의 참고로만 쓰고, 운영본부 개소·브리핑·세팅·교대·
     마감 점검·철수처럼 관계자가 실제로 하는 일을 함께 넣습니다. 참가자용
     프로그램 안내가 아니라 '지금 무엇을 운영해야 하나' 를 보여 주는 예시입니다.
     2분짜리 영상부터 2시간 강연까지 길이가 섞이고, 메인무대와 AI체험존이
     동시에 돌아가는 모습이 드러나게 합니다.
     부스는 참가 프로그램 목록이 아니라 현장 운영 단위라, 운영자 입장 확인 →
     세팅·전원·네트워크 점검 → 물품 배부 → 운영 시작 → 순회 점검 → 교대 →
     마감 → 철수·물품 회수 흐름을 함께 넣습니다. 비슷한 점검은 한 일정으로
     묶고, 시작·교대·마감·철수처럼 시각이 중요한 것은 따로 둡니다.
     날짜는 예시 안에서만 씁니다. 실제 행사일은 settings 의 event_start ·
     event_end 가 정합니다. 데이터베이스에는 넣지 않습니다. */
  var SAMPLE_DAYS = ['2026-11-13', '2026-11-14'];
  var SAMPLE_SCHEDULE = [].concat(
    sampleDay('2026-11-13', [
      ['08:30', '09:00', '운영본부 개소 및 장비 점검', '운영본부', '운영'],
      ['09:00', '09:20', '운영요원 집결 및 당일 브리핑', '운영본부', '운영'],
      ['09:20', '09:40', '부스 운영자 입장 확인', 'AI스쿨존 · 미래채움존', '운영'],
      ['09:40', '10:00', '부스 세팅 및 전원·네트워크 점검', '각 부스', '운영'],
      ['09:40', '10:00', '부스 운영 물품 배부', '운영본부', '운영'],
      ['10:00', '10:20', '행사장 개장 및 부스 운영 시작', '전시장 · 각 부스', '운영'],
      ['10:00', '10:50', 'AI체험존 1회차 운영', 'AI체험존', '부스'],
      ['10:20', '10:40', '1차 부스 운영 순회 점검', 'AI스쿨존 · 미래채움존', '운영'],
      ['11:00', '11:50', 'AI체험존 2회차 운영', 'AI체험존', '부스'],
      ['12:00', '12:50', 'AI체험존 3회차 운영', 'AI체험존', '부스'],
      ['12:00', '13:00', '운영요원 점심 및 부스 교대', '각 부스', '운영'],
      ['13:00', '13:15', '오후 부스 운영 재개 확인', '각 부스', '운영'],
      ['13:00', '13:50', 'AI체험존 4회차 운영', 'AI체험존', '부스'],
      ['13:10', '13:30', '개막식 운영 점검 및 주요 인사 동선 확인', '메인무대 · 운영본부', '행사 지원'],
      ['13:30', '13:55', '개막 사전 공연', '메인무대', '무대'],
      ['13:55', '14:00', '장내 정리 및 주요 인사 입장', '메인무대', '행사 지원'],
      ['14:00', '14:05', '내·외빈 소개', '메인무대', '무대'],
      ['14:05', '14:07', '오프닝 영상', '메인무대', '무대'],
      ['14:07', '14:15', '주제 공연', '메인무대', '무대'],
      ['14:15', '14:25', '환영사 및 축사', '메인무대', '무대'],
      ['14:25', '14:30', '개막 세레모니', '메인무대', '무대'],
      ['14:30', '15:00', '주요 인사 전시장 투어', '전시장', '행사 지원'],
      ['15:00', '16:00', '특별 강연', '메인무대', '강연'],
      ['15:00', '15:50', 'AI체험존 5회차 운영', 'AI체험존', '부스'],
      ['15:30', '15:50', '2차 부스 운영 순회 점검', '전시장', '운영'],
      ['16:00', '16:50', 'AI체험존 6회차 운영', 'AI체험존', '부스'],
      ['16:30', '16:50', '부스 마감 전 운영 확인', '각 부스', '운영'],
      ['16:50', '17:00', '1일차 부스 운영 마감', '각 부스', '운영'],
      ['17:00', '17:20', '부스 기자재·운영 물품 확인', '각 부스 · 운영본부', '운영'],
      ['17:20', '17:30', '1일차 운영 결과 공유', '운영본부', '운영']
    ]),
    sampleDay('2026-11-14', [
      ['08:40', '09:00', '운영본부 개소 및 전일 부스 운영 특이사항 확인', '운영본부', '운영'],
      ['09:00', '09:20', '부스 운영자 입장 확인', 'AI스쿨존 · 미래채움존', '운영'],
      ['09:20', '09:40', '부스 재세팅 및 기자재 확인', '각 부스', '운영'],
      ['09:40', '10:00', '전원·네트워크·안전 최종 점검', '전시장', '행사 지원'],
      ['10:00', '10:15', '2일차 부스 운영 시작', '각 부스', '운영'],
      ['10:00', '11:00', '특별 강연', '메인무대', '강연'],
      ['10:00', '10:50', 'AI체험존 1회차 운영', 'AI체험존', '부스'],
      ['10:30', '10:50', '1차 현장 순회 점검', '각 부스', '운영'],
      ['11:00', '11:50', 'AI체험존 2회차 운영', 'AI체험존', '부스'],
      ['12:00', '12:50', 'AI체험존 3회차 운영', 'AI체험존', '부스'],
      ['12:00', '13:00', '점심 및 부스 운영 교대', '각 부스', '운영'],
      ['13:00', '13:15', '오후 운영 재개 확인', '각 부스', '운영'],
      ['13:00', '13:50', 'AI체험존 4회차 운영', 'AI체험존', '부스'],
      ['13:30', '14:00', '시상식 및 오후 프로그램 사전 점검', '메인무대 · 운영본부', '행사 지원'],
      ['14:00', '14:30', '시상식', '메인무대', '무대'],
      ['14:00', '14:50', 'AI체험존 오후 회차 운영', 'AI체험존', '부스'],
      ['14:30', '16:30', '특별 강연', '메인무대', '강연'],
      ['15:00', '15:50', 'AI체험존 오후 회차 운영', 'AI체험존', '부스'],
      ['15:30', '15:50', '마감 전 운영 및 물품 확인', '각 부스', '운영'],
      ['16:00', '16:20', '부스 철수 사전 안내', '각 부스', '운영'],
      ['16:00', '16:30', '체험존 운영 마감 · 16:30 체험 접수 마감', 'AI체험존', '부스'],
      ['16:30', '17:00', '질의응답 및 행사 마무리 프로그램', '메인무대', '무대'],
      ['16:40', '17:00', '관람객 퇴장 및 부스 운영 종료 확인', '전시장', '운영'],
      ['17:00', '17:40', '부스 철수 및 대여물품·운영물품 회수', '각 부스 · 운영본부', '운영'],
      ['17:40', '18:00', '전원 차단·분실물·최종 현장 확인', '전시장 · 운영본부', '운영']
    ])
  );
  // 실제 일정 행(schedule_items)과 같은 모양으로 만들어 같은 판단·그리기를 씁니다.
  // day 는 예시에만 있는 값입니다.
  function sampleDay(day, rows) {
    return rows.map(function (r, n) {
      return { id: 'sample-' + day + '-' + n, day: day, start_time: r[0], end_time: r[1],
               title: r[2], place: r[3], category: r[4], status: '예정', sample: true };
    });
  }
  // 행사 전 홈 '행사 당일에는 이렇게 표시됩니다' 에 쓰는 짝(첫날 14:30 · 15:00).
  function samplePreviewPair() {
    var d1 = SAMPLE_SCHEDULE.filter(function (i) { return i.day === SAMPLE_DAYS[0]; });
    var at = function (t, place) {
      return d1.filter(function (i) { return i.start_time === t && i.place === place; })[0];
    };
    return [at('14:30', '전시장'), at('15:00', '메인무대')];
  }

  /* 부스 예시. 학교 부스만 있다고 가정하지 않도록 초·중·고와 기관형 부스를
     함께 보여 줍니다 — 실제 행사에도 학교 부스와 협동조합·기관 부스가
     함께 있을 수 있습니다. 실제 기관명 대신 ○○·△△·□□ 로 일반화합니다. */
  var SAMPLE_BOOTHS = [
    { code: 'A-18', type: '초등', name: '레고와 코딩으로 만드는 AI 놀이터', org: '○○초등학교', zone: 'AI스쿨존' },
    { code: 'A-23', type: '초등', name: '증강현실 AR 체험', org: '△△초등학교', zone: 'AI스쿨존' },
    { code: 'A-12', type: '중등', name: 'AI 모션 센서를 활용한 인터랙티브 체험', org: '○○중학교', zone: 'AI스쿨존' },
    { code: 'A-63', type: '고등', name: '아두이노 기반 스마트 시스템 체험', org: '□□고등학교', zone: 'AI스쿨존' },
    { code: '미래채움-03', type: '기관', name: 'AI 기반 환경문제 해결 체험', org: 'SW교육협동조합', zone: '미래채움존' }
  ];

  // 실제 카드(.booth)와 같은 마크업을 쓰되 .boothgrid 에 담아 실제 부스
  // 목록과 같은 열 배치로 보이게 합니다. orgBadge()는 아래에서 정의됩니다.
  function sampleBooths() {
    return '<div class="sample"><p class="samplenote">' + esc(SAMPLE_NOTE) + '</p>' +
      '<div class="boothgrid" aria-label="예시 부스 목록">' +
      SAMPLE_BOOTHS.map(function (b, n) {
        // 눌러서 상세를 볼 수 있습니다 — 부스 → 관련 요청·물품 흐름을 미리 보여 줍니다.
        return '<button class="booth is-sample" type="button" data-samplebooth="' + n + '">' +
          '<span class="booth__top"><span class="booth__code">' + esc(b.code) + '</span>' +
          orgBadge(b.type) + SAMPLE_END + '</span>' +
          '<span class="booth__name">' + esc(b.name) + '</span>' +
          '<span class="booth__org">' + esc(b.org) + '</span>' +
          '<span class="booth__foot">' + esc(b.zone) + '</span></button>';
      }).join('') + '</div></div>';
  }

  /* ── 부스와 이어진 운영 ─────────────────────────────────────────
     부스 카드에 '준비 전 / 운영 중' 같은 상태를 다시 두지 않습니다.
     부스가 괜찮은지는 그 부스 번호로 들어온 운영 요청과 물품 배부에서
     드러납니다. 표를 잇는 칸이 없으므로 글에 적힌 부스 번호로 찾습니다.
     'A-1' 이 'A-18' 에 걸리지 않도록 번호 뒤에 숫자가 이어지면 뺍니다. */
  function mentionsBooth(text, code) {
    if (!code || !text) return false;
    var safe = String(code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^0-9A-Za-z가-힣-])' + safe + '(?![0-9])').test(String(text));
  }

  /* 부스 상세 아래 '이 부스 운영' 묶음.
     reqs  [{ title, status, priority, kind, id? }]  — id 가 있으면 눌러서 요청 상세로
     sups  [{ name, status }]
     canReport  실제 부스일 때만 '이 부스 문제 보고' 단추(위치를 미리 채움) */
  function boothOpsHtml(code, reqs, sups, canReport) {
    var open = reqs.filter(function (r) { return r.status !== '완료'; });
    var reqRows = reqs.map(function (r) {
      var inner = (r.status === '완료' ? badge('완료') : badge(r.priority) + badge(r.status)) +
        '<span class="boothops__title">' + esc(r.title) + '</span>';
      return r.id
        ? '<button class="boothops__row" type="button" data-req="' + esc(r.id) + '">' + inner + '</button>'
        : '<div class="boothops__row">' + inner + '</div>';
    }).join('');
    var supRows = sups.map(function (t) {
      return '<div class="boothops__row">' + badge(supplyLabel(t.status)) +
        '<span class="boothops__title">' + esc(t.name) + '</span></div>';
    }).join('');
    return '<section class="boothops" aria-label="이 부스 운영">' +
      '<h3 class="boothops__t">이 부스 운영</h3>' +
      '<p class="boothops__l">운영 요청 <b>' + (open.length ? '미처리 ' + open.length + '건' : reqs.length ? '모두 처리됨' : '없음') + '</b></p>' +
      reqRows +
      '<p class="boothops__l">운영 물품 <b>' + (sups.length ? sups.length + '곳' : '연결된 배부 없음') + '</b></p>' +
      supRows +
      (canReport
        ? '<button class="btn btn--ghost btn--full" type="button" data-newreq data-reqloc="' + esc(code) + '">이 부스 문제 보고</button>'
        : '<p class="boothops__hint">실제 부스에서는 여기서 위치가 채워진 운영 요청을 바로 등록합니다.</p>') +
      '</section>';
  }

  function sampleBoothDetail(n) {
    var b = SAMPLE_BOOTHS[n];
    if (!b) return;
    var rows = [['부스 번호', b.code], ['부스명', b.name], ['운영기관', b.org],
                ['운영기관 유형', b.type], ['구역', b.zone]];
    var html = '<p class="samplenote">' + esc(SAMPLE_NOTE) + '</p>' +
      '<dl class="dl">' + rows.map(function (r) {
        return '<div class="dl__row"><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
      }).join('') + '</dl>' +
      boothOpsHtml(b.code,
        SAMPLE_REQUESTS.filter(function (r) { return r.booth === b.code; })
          .map(function (r) { return { title: r.title, status: r.st, priority: r.pri }; }),
        SAMPLE_SUPPLIES.filter(function (t) { return t.booth === b.code; }),
        false);
    openDrawer(b.code + ' · 예시', html, { footer: true });
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
  function summaryGrid(items, extra) {
    return '<div class="sumgrid' + (extra ? ' ' + extra : '') + '" style="--n:' + items.length + '">' + items.map(function (c) {
      var none = c.n == null;
      return '<div class="sumcard' + (c.tone ? ' sumcard--' + c.tone : '') + (none ? ' is-none' : '') + '">' +
        '<span class="sumcard__n">' + (none ? '<span aria-hidden="true">—</span><span class="sr-only">없음</span>' : c.n) + '</span>' +
        '<span class="sumcard__l">' + (c.dot ? '<span class="sumcard__dot" aria-hidden="true"></span>' : '') + esc(c.l) + '</span>' +
        (c.sub ? '<span class="sumcard__sub">' + esc(c.sub) + '</span>' : '') + '</div>';
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

  /* ── 화면: 홈(운영 브리핑) ─────────────────────────────────────
     포털을 열고 몇 초 안에 답해야 하는 질문 순서대로 쌓습니다.
       1. 어떤 행사이고 지금 어느 시점인가      → 머리
       2. 문제·업무·물품·부스는 어떤 상태인가   → 숫자 넉 장
       3. 다음에 무엇이 있고 무엇을 할 수 있나  → 브리핑 + 빠른 실행
       4. 지금 읽어야 할 공지가 있나            → 있을 때만
     비어 있는 묶음은 자리를 두지 않습니다. 빈 카드가 쌓이면 무엇이
     중요한지 가려집니다. */
  var DASH_ICONS = {
    req:    '<path d="M12 4 3.5 19h17z"/><path d="M12 10v4M12 16.8v.2"/>',
    task:   '<rect x="4.5" y="4.5" width="15" height="15" rx="2.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    supply: '<path d="M4 8 12 4l8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
    booth:  '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/>' +
            '<rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'
  };
  function dashIcon(key) {
    return '<svg class="dash__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + DASH_ICONS[key] + '</svg>';
  }

  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  function fmtEventDay(d) {
    return d ? (d.getMonth() + 1) + '.' + d.getDate() + '. ' + WEEKDAYS[d.getDay()] : '';
  }

  function viewDashboard() {
    var ev = eventInfo();
    var s = S.settings || {};
    // 행사 당일이라도 끝난 시각이 지나면 '종료' 로 봅니다.
    var mode = ev.phase === 'after' ? 'after' : ev.phase === 'during' ? 'during' : 'before';

    /* 1. 머리 — 행사명이 주인공, 상태는 작은 표시 하나 */
    var phaseHtml = mode === 'during'
      ? '<span class="phase phase--live">진행 중</span>'
      : mode === 'after'
        ? '<span class="phase phase--done">행사 종료</span>'
        : ev.phase === 'before'
          ? '<span class="phase">행사 전 · D-' + Math.max(0, ev.dday) + '</span>'
          : '';
    var meta = [s.date_label, s.time_label, s.venue].filter(Boolean).map(esc).join(' · ');
    var head = '<header class="dash__head">' +
      '<div class="dash__title"><h1 class="dash__name">' +
      esc(s.event_title || '2026년 인천 AI·SW미래채움 교육페스티벌') + '</h1>' +
      (meta ? '<p class="dash__meta">' + meta + '</p>' : '') + '</div>' +
      (phaseHtml ? '<div class="dash__phase">' + phaseHtml + '</div>' : '') + '</header>';

    /* 2. 숫자 넉 장 — 카드 전체가 해당 화면으로 가는 링크입니다.
       '—' 는 등록된 것이 없다는 뜻이고, 0 은 모두 끝났다는 뜻입니다.
       둘을 아래 한 줄 설명으로 반드시 구분합니다. */
    var openReqs = S.requests.filter(function (r) { return r.status !== '완료'; });
    var urgentReq = openReqs.filter(function (r) { return r.priority === '긴급'; }).length;
    var leftTasks = S.tasks.filter(function (t) { return taskStatus(t) !== '완료'; });
    var runningTasks = leftTasks.filter(function (t) { return taskStatus(t) === '진행 중'; }).length;
    var leftSupply = S.supplyTargets.filter(function (t) { return t.status !== '배부 완료'; });

    var stats = [
      { key: 'req', go: 'requests', l: '미처리 요청',
        n: openReqs.length,
        sub: openReqs.length
          ? (urgentReq ? '긴급 ' + urgentReq + '건 포함' : '확인이 필요합니다')
          : (S.requests.length ? '모두 처리됨' : '접수된 요청 없음'),
        tone: urgentReq ? 'alert' : '' },
      { key: 'task', go: 'tasks', l: '남은 업무',
        n: S.tasks.length ? leftTasks.length : null,
        sub: !S.tasks.length ? '아직 미등록'
          : !leftTasks.length ? '모두 완료'
          : runningTasks ? '진행 중 ' + runningTasks + '건' : '전체 ' + S.tasks.length + '건 중' },
      { key: 'supply', go: 'supplies', l: '배부 확인 필요',
        n: S.supplyTargets.length ? leftSupply.length : null,
        sub: !S.supplyTargets.length ? '아직 미등록'
          : !leftSupply.length ? '모두 배부 완료'
          : '배부 예정 ' + leftSupply.filter(function (t) { return (t.status || '미배부') === '미배부'; }).length +
            ' · 배부 중 ' + leftSupply.filter(function (t) { return t.status === '일부 배부'; }).length },
      { key: 'booth', go: 'booths', l: '전체 부스',
        n: S.booths.length || null,
        sub: S.booths.length ? '부스 현황 보기' : '아직 미등록' }
    ];
    var statsHtml = '<nav class="dash__stats" aria-label="운영 현황">' + stats.map(function (st) {
      var none = st.n == null;
      return '<a class="stat stat--' + st.key + (none ? ' is-none' : '') + '" href="#' + st.go + '">' +
        '<span class="stat__row"><span class="stat__n">' +
        (none ? '<span aria-hidden="true">—</span><span class="sr-only">없음</span>' : st.n) + '</span>' +
        dashIcon(st.key) + '</span>' +
        '<span class="stat__l">' + esc(st.l) + '</span>' +
        '<span class="stat__sub' + (st.tone ? ' stat__sub--' + st.tone : '') + '">' + esc(st.sub) +
        '<span class="stat__go" aria-hidden="true">→</span></span>' +
        '</a>';
    }).join('') + '</nav>';

    /* 3. 운영 브리핑 — 시점에 따라 담는 내용만 바뀝니다.
       현재·다음 판단은 일정 화면 상단과 같은 scheduleBrief() 하나로 합니다.
       '주요 일정'은 관리자가 따로 표시(is_highlight)한 일정만 가리키는 말이라
       여기서는 쓰지 않습니다 — 지금 진행 중인 일정은 '현재 일정', 바로 다음
       시작하는 일정은 '다음 일정'.
         행사 전             → 다음 일정(크게)
         당일 · 진행 중 있음 → 현재 일정(크게) + 다음 일정(작게)
         당일 · 진행 중 없음 → 다음 일정만. 빈 '현재' 칸은 두지 않습니다.
         당일 · 모두 끝남    → 오늘 일정 종료 한 줄
         행사 종료           → 남은 운영 확인 */
    function slot(label, item, opts) {
      opts = opts || {};
      var cls = 'brief__slot' + (opts.size ? ' brief__slot--' + opts.size : '');
      if (!item) {
        return '<div class="' + cls + '"><p class="brief__label">' + esc(label) + '</p>' +
          '<p class="brief__empty">' + esc(opts.empty || '등록된 일정이 없습니다.') + '</p></div>';
      }
      var time = opts.range && item.end_time
        ? esc(item.start_time) + '–' + esc(item.end_time)
        : esc(item.start_time || item.time_label || '');
      return '<div class="' + cls + '"' + (opts.live ? ' aria-current="time"' : '') + '>' +
        '<p class="brief__label">' + (opts.live ? '<span class="brief__live">진행 중</span>' : '') +
        esc(label) + (opts.after ? '<span class="brief__after">' + esc(opts.after) + '</span>' : '') + '</p>' +
        (opts.day ? '<p class="brief__day">' + esc(opts.day) + '</p>' : '') +
        (time ? '<p class="brief__time">' + time + '</p>' : '') +
        '<p class="brief__what">' + esc(item.title) + '</p>' +
        (item.place ? '<p class="brief__where">' + esc(item.place) + '</p>' : '') + '</div>';
    }

    var br = scheduleBrief(ev);
    var modeLabel = br.phaseLabel;
    var briefBody, briefLink = '<button class="linkbtn" type="button" data-go="schedule">전체 일정 보기 →</button>';

    if (mode === 'after') {
      // 끝난 일정을 다시 크게 보여 줄 필요는 없습니다. 남은 운영만 봅니다.
      var leftRows = [];
      if (openReqs.length) leftRows.push({ go: 'requests', l: '미처리 요청', n: openReqs.length });
      if (leftTasks.length) leftRows.push({ go: 'tasks', l: '미완료 업무', n: leftTasks.length });
      if (leftSupply.length) leftRows.push({ go: 'supplies', l: '배부 확인 필요', n: leftSupply.length });
      briefBody = '<p class="brief__lead">행사가 종료되었습니다.</p>' +
        (br.last ? '<p class="brief__lastline">마지막 일정 · ' + esc(br.last.title) + ' ' + timeRange(br.last) + '</p>' : '') +
        (leftRows.length
          ? '<div class="brief__slot"><p class="brief__label">남은 운영 확인</p>' +
            '<ul class="brief__left">' + leftRows.map(function (r) {
              return '<li><a class="brief__leftrow" href="#' + r.go + '">' +
                '<span>' + esc(r.l) + '</span><b>' + r.n + '건</b>' +
                '<span class="brief__arrow" aria-hidden="true">→</span></a></li>';
            }).join('') + '</ul></div>'
          : '<p class="brief__empty">모든 운영 항목이 완료되었습니다.</p>');
      briefLink = '';
    } else if (br.state === 'live') {
      // 현재가 주인공, 다음은 한 단계 작게. 좁으면 위아래, 넓으면 약 63 : 37.
      // 동시에 여러 건이면 홈에서는 두 건까지 한 줄씩만, 나머지는 '+ N건'.
      var nowSlot = br.liveCount > 1
        ? '<div class="brief__slot brief__slot--now" aria-current="time">' +
          '<p class="brief__label"><span class="brief__live">진행 중</span>현재 일정 · ' + br.liveCount + '건</p>' +
          '<ul class="brief__multi">' + br.liveItems.slice(0, 2).map(function (i) {
            return '<li><p class="brief__mtime">' + timeRange(i) +
              '<span class="brief__after">' + esc(leftLabel(i, br.nowMin)) + '</span></p>' +
              '<p class="brief__mwhat">' + esc(i.title) +
              (i.place ? '<span class="brief__mwhere"> · ' + esc(i.place) + '</span>' : '') + '</p></li>';
          }).join('') + '</ul>' +
          (br.liveCount > 2 ? '<p class="brief__more">+ ' + (br.liveCount - 2) + '건 더 진행 중</p>' : '') +
          '</div>'
        : slot('현재 일정', br.live, { range: true, live: true, size: 'now',
          after: br.liveLeft > 0 ? C.minLabel(br.liveLeft) + ' 남음' : '곧 종료' });
      briefBody = '<div class="brief__pair">' + nowSlot +
        slot('다음 일정', br.next, { range: true, size: 'next',
          after: br.nextIn != null ? C.minLabel(br.nextIn) + ' 후' + (br.nextMore ? ' · ' + br.nextMore : '') : '',
          empty: '오늘 남은 일정이 없습니다.' }) + '</div>';
    } else if (br.state === 'waiting') {
      briefBody = slot('다음 일정', br.next, { range: true,
        after: (br.isFirst ? '첫 일정 · ' : '') + C.minLabel(br.nextIn) + ' 후 시작' });
    } else if (br.state === 'ended') {
      briefBody = '<p class="brief__lead">오늘 일정이 모두 종료되었습니다.</p>' +
        (br.last ? '<p class="brief__lastline">마지막 일정 · ' + esc(br.last.title) + ' ' +
          timeRange(br.last) + '</p>' : '');
    } else {
      // 행사 전: 관리자가 표시한 주요 일정(없으면 첫 일정) 하나를 '다음 일정'으로 보여 줍니다.
      briefBody = slot('다음 일정', br.key, { range: true,
        day: br.key && itemDay(br.key) ? dayShort(itemDay(br.key)) : fmtEventDay(ev.start) });
      if (!br.key) briefLink = '';
      /* 행사 당일 화면 예시 — 행사 전에만. 예시 첫날의 이어지는 두 일정(전시장
         투어 → 특별 강연)으로 당일에 '현재 + 다음' 이 어떻게 보이는지만 보여 줍니다.
         진행 중 표시·남은 시간은 붙이지 않습니다 — 지금 진행 중인 일정으로
         읽히면 안 됩니다. 실제 목록과 섞이지 않고 '예시' 묶음 안에만 있습니다. */
      var demo = ev.phase === 'before' && samplePreviewPair();
      if (demo) {
        briefBody += '<div class="brief__demo" role="group" aria-label="행사 당일 화면 예시">' +
          '<p class="brief__demohead">' + SAMPLE_END + '행사 당일에는 이렇게 표시됩니다</p>' +
          '<div class="brief__pair brief__pair--demo">' +
          slot('현재 일정', demo[0], { range: true, size: 'now' }) +
          slot('다음 일정', demo[1], { range: true, size: 'next' }) + '</div></div>';
      }
    }

    var brief = '<section class="brief" aria-labelledby="brief-t">' +
      '<div class="brief__head"><h2 class="brief__t" id="brief-t">운영 브리핑</h2>' +
      '<span class="brief__mode">' + modeLabel + '</span>' +
      // 실제 일정이 없어 예시 날짜로 판단한 브리핑이면 '예시' 를 붙입니다.
      (br.sample && mode !== 'after' ? SAMPLE_END : '') + briefLink + '</div>' +
      briefBody + '</section>';

    // 버튼은 셋까지. 보고만 채운 버튼이고 나머지는 기존 화면 바로가기입니다.
    var quick = '<section class="quick" aria-labelledby="quick-t">' +
      '<h2 class="quick__t" id="quick-t">빠른 실행</h2>' +
      '<div class="quick__list">' +
      '<button class="btn btn--primary quick__main" type="button" data-newreq>+ 현장 문제 보고</button>' +
      '<a class="btn btn--ghost" href="#contacts">연락망</a>' +
      '<a class="btn btn--ghost" href="#booths">부스 찾기</a>' +
      '</div></section>';

    /* 4. 중요 공지 — 긴급·중요가 있을 때만. 없으면 묶음 자체를 두지 않습니다. */
    var keyNotices = S.notices.filter(function (n) {
      return n.level === '긴급' || n.level === '중요';
    }).slice(0, 3);
    var noticeHtml = keyNotices.length
      ? '<section class="dash__block" aria-labelledby="dn-t">' +
        '<div class="dash__blockhead"><h2 class="dash__blockt" id="dn-t">중요 공지</h2>' +
        '<button class="linkbtn" type="button" data-go="notices">공지 전체 →</button></div>' +
        '<div class="dlist">' + keyNotices.map(function (n) {
          return '<button class="dlist__row" type="button" data-notice="' + esc(n.id) + '">' +
            badge(n.level) +
            '<span class="dlist__title">' + esc(n.title) + '</span>' +
            '<span class="dlist__when">' + esc(fmtDay(n.created_at)) + '</span></button>';
        }).join('') + '</div></section>'
      : '';

    /* 오늘의 주요 일정 — 행사 당일에만. 몇 주 전에는 쓸모가 없습니다. */
    var keyItems = mode === 'during' && ev.sameDay ? S.schedule.filter(function (i) {
      // 이미 끝난 일정은 빼고 지금·앞으로 볼 것만 둡니다.
      return i.is_highlight && i.status !== '취소' && liveStatus(i, ev) !== '종료';
    }).slice(0, 3) : [];
    var keyHtml = keyItems.length
      ? '<section class="dash__block" aria-labelledby="dk-t">' +
        '<div class="dash__blockhead"><h2 class="dash__blockt" id="dk-t">오늘의 주요 일정</h2>' +
        '<button class="linkbtn" type="button" data-go="schedule" data-schedkey="1">전체 →</button></div>' +
        '<div class="dlist">' + keyItems.map(function (i) {
          var st = liveStatus(i, ev);
          return '<button class="dlist__row" type="button" data-go="schedule" data-schedkey="1">' +
            '<span class="dlist__time">' + esc(i.start_time || '') + '</span>' +
            '<span class="dlist__title">' + esc(i.title) + '</span>' +
            (st === '진행 중' ? badge('진행 중') : '<span class="dlist__when">' + esc(i.place || '') + '</span>') +
            '</button>';
        }).join('') + '</div></section>'
      : '';

    var lists = noticeHtml && keyHtml
      ? '<div class="dash__pair">' + noticeHtml + keyHtml + '</div>'
      : (noticeHtml || keyHtml);

    /* 5. 운영 안내 — 가장 아래, 카드 없이 제목과 구분선만 */
    var guide = (s.ops_guide || '').trim();
    var guideLong = guide.split(String.fromCharCode(10)).length > 3 || guide.length > 110;
    var guideHtml = guide
      ? '<section class="dash__guide" aria-labelledby="dg-t">' +
        '<div class="dash__blockhead"><h2 class="dash__blockt" id="dg-t">운영 안내</h2>' +
        (guideLong ? '<button class="linkbtn" type="button" data-guide>전체 보기</button>' : '') + '</div>' +
        '<div class="noticebody' + (guideLong ? ' is-clamped' : '') + '">' + esc(guide) + '</div>' +
        '</section>'
      : '';

    return '<div class="page dash">' +
      '<div class="dash__top">' + head + statsHtml + '</div>' +
      '<div class="dash__main">' + brief + quick + '</div>' +
      lists + guideHtml + '</div>';
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
     알리지 않고 '지금 13:27:05' 처럼 글자로도 적습니다 — 색을 구분하기
     어려운 사람도 같은 정보를 얻어야 합니다. */
  function hms(d) {
    return C.pad2(d.getHours()) + ':' + C.pad2(d.getMinutes()) + ':' + C.pad2(d.getSeconds());
  }
  function timeRange(i) {
    return esc(i.start_time || '') + (i.end_time ? '–' + esc(i.end_time) : '');
  }

  /* 일정 하나의 시작·끝(분). 끝이 없으면 30분짜리로 봅니다. */
  function spanOf(i) {
    var a = C.toMin(i.start_time);
    if (a == null) return null;
    var b = C.toMin(i.end_time);
    return { a: a, b: b == null ? a + 30 : b };
  }

  /* 일정의 날짜(YYYY-MM-DD). schedule_items 에는 아직 날짜 칸이 없어 실제
     일정은 '' 이고, 이때는 행사일 모두에 해당하는 일정으로 봅니다.
     예시 일정은 day 를 갖습니다. 나중에 event_date 칸이 생기면 그대로 읽습니다. */
  function itemDay(i) { return (i && (i.event_date || i.day)) || ''; }
  function onDay(i, day) { var d = itemDay(i); return !d || !day || d === day; }

  /* 판단에 쓰는 오늘 일정.
       실제 일정이 한 건이라도 있으면 실제 일정만 씁니다(예시와 섞지 않음).
       실제 일정이 0건이고 오늘이 행사일이면서 예시 날짜와 같으면, 그날 예시로
       같은 판단을 보여 줍니다. 이때 화면의 모든 칸에 '예시' 가 붙습니다. */
  function scheduleSource(ev) {
    var today = ymd(ev.now);
    if (S.schedule.length) {
      return { all: S.schedule, items: S.schedule.filter(function (i) { return onDay(i, today); }), sample: false };
    }
    if (ev.sameDay && SAMPLE_DAYS.indexOf(today) >= 0) {
      return { all: SAMPLE_SCHEDULE, items: SAMPLE_SCHEDULE.filter(function (i) { return i.day === today; }), sample: true };
    }
    return { all: [], items: [], sample: false };
  }

  /* 동시에 진행 중인 일정의 순서: 가장 최근에 시작한 것 → 분류(무대·강연이
     먼저) → 먼저 끝나는 것. 첫 항목이 대표(br.live)입니다. */
  function liveOrder(x, y) {
    var a = spanOf(x), b = spanOf(y);
    if (a.a !== b.a) return b.a - a.a;
    var cx = SCHEDULE_CATS.indexOf(x.category), cy = SCHEDULE_CATS.indexOf(y.category);
    if (cx !== cy) return (cx < 0 ? 99 : cx) - (cy < 0 ? 99 : cy);
    return a.b - b.b;
  }

  /* 실시간 판정. 필터와 상관없이 '오늘 전체 일정' 으로 합니다 — 검색어 때문에
     지금 진행 중인 일정이 요약에서 사라지면 안 됩니다.
     판정은 분 단위입니다. 초는 시계 표시에만 씁니다.
     현재 일정은 하나라고 가정하지 않습니다. 메인무대 강연과 AI체험존 회차가
     같은 시각에 돌아가므로 진행 중인 일정을 모두 모읍니다(liveItems).
     다음 일정은 진행 중 일정이 끝나기를 기다리지 않고, 지금 이후 가장 먼저
     시작하는 일정입니다. */
  function scheduleNow(items, ev) {
    var nowMin = ev.now.getHours() * 60 + ev.now.getMinutes();
    var liveItems = [], next = null, first = null, lastEnd = null;
    items.forEach(function (i) {
      if (i.status === '취소') return;
      var sp = spanOf(i);
      if (!sp) return;
      if (!first || sp.a < spanOf(first).a) first = i;
      if (lastEnd == null || sp.b > lastEnd) lastEnd = sp.b;
      if (nowMin >= sp.a && nowMin < sp.b) liveItems.push(i);
      if (sp.a > nowMin && (!next || sp.a < spanOf(next).a ||
          (sp.a === spanOf(next).a && liveOrder(i, next) < 0))) next = i;
    });
    liveItems.sort(liveOrder);
    // 다음 일정과 같은 시각에 함께 시작하는 일정 수(예: 부스 세팅 · 물품 배부).
    var nextCount = next ? items.filter(function (i) {
      return i.status !== '취소' && spanOf(i) && spanOf(i).a === spanOf(next).a;
    }).length : 0;
    return { nowMin: nowMin, liveItems: liveItems, live: liveItems[0] || null,
             liveCount: liveItems.length, next: next, nextCount: nextCount, first: first, lastEnd: lastEnd };
  }

  /* 일정 브리핑 판단 — 일정 화면 상단과 홈의 운영 브리핑이 함께 씁니다.
     두 화면이 서로 다른 말을 하지 않도록 판단은 여기 한 곳에서만 합니다.
       empty    등록된 일정 없음
       before   행사일 전          → 다음 일정
       live     당일 · 진행 중 있음 → 현재 일정(여러 건일 수 있음) + 다음 일정
       waiting  당일 · 진행 중 없음 → 다음 일정(첫 일정 전이면 첫 일정)
       ended    당일 · 모두 끝남    → 오늘 일정 종료 + 마지막 일정
       after    행사일 뒤          → 행사 종료 + 마지막 일정
     br.live 는 기존 화면이 쓰던 대표 한 건이고, 전체는 br.liveItems 입니다. */
  function scheduleBrief(ev) {
    var src = scheduleSource(ev);
    var sn = scheduleNow(src.items, ev);
    function lastOf(list) {
      var last = null;
      list.forEach(function (i) {
        if (i.status === '취소' || !spanOf(i)) return;
        if (!last || itemDay(i) > itemDay(last) ||
            (itemDay(i) === itemDay(last) && spanOf(i).b > spanOf(last).b)) last = i;
      });
      return last;
    }
    var b = { live: sn.live, liveItems: sn.liveItems, liveCount: sn.liveCount,
              next: sn.next, first: sn.first, key: null, sample: src.sample };
    b.last = ev.phase === 'after' ? lastOf(S.schedule) : lastOf(src.items);
    if (!S.schedule.length && !src.sample) b.state = 'empty';
    else if (ev.sameDay) b.state = !src.items.length ? 'empty' : sn.live ? 'live' : sn.next ? 'waiting' : 'ended';
    else if (ev.phase === 'after') b.state = 'after';
    else {
      b.state = 'before';
      // 관리자가 '핵심' 으로 표시한 일정이 있으면 그중 가장 이른 것, 없으면 첫 일정
      var timed = S.schedule.filter(function (i) { return i.status !== '취소' && spanOf(i); })
        .sort(function (x, y) {
          return itemDay(x) === itemDay(y) ? spanOf(x).a - spanOf(y).a : (itemDay(x) < itemDay(y) ? -1 : 1);
        });
      b.key = timed.filter(function (i) { return i.is_highlight; })[0] || timed[0] || null;
    }
    b.liveLeft = b.live ? spanOf(b.live).b - sn.nowMin : null;
    b.nextIn = b.next && ev.sameDay ? spanOf(b.next).a - sn.nowMin : null;
    b.nextMore = sn.nextCount > 1 ? '같은 시각 ' + (sn.nextCount - 1) + '건 더' : '';
    b.isFirst = !!b.next && b.next === sn.first;
    b.nowMin = sn.nowMin;
    b.phaseLabel = ev.phase === 'after' ? '행사 종료' : ev.phase === 'during' ? '행사 진행 중' : '행사 준비';
    return b;
  }
  function hhmm(min) { return C.pad2(Math.floor(min / 60)) + ':' + C.pad2(min % 60); }
  function leftLabel(i, nowMin) {
    var left = spanOf(i).b - nowMin;
    return left > 0 ? C.minLabel(left) + ' 남음' : '곧 종료';
  }

  /* 날짜 표기. 넓으면 '11월 13일 금요일', 좁으면 '11.13. 금'. */
  function parseDay(day) {
    var p = String(day).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  function dayLong(day) {
    var d = parseDay(day);
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + WEEKDAYS[d.getDay()] + '요일';
  }
  function dayShort(day) {
    var d = parseDay(day);
    return (d.getMonth() + 1) + '.' + d.getDate() + '. ' + WEEKDAYS[d.getDay()];
  }

  /* 일정 화면의 날짜 선택.
       예시(실제 일정 0건)   → 예시의 이틀
       실제 일정에 날짜가 있음 → 그 날짜들
       날짜가 없음(현재 표 구조) → 날짜를 나눌 수 없으므로 두지 않습니다
     하루뿐이면 고를 것이 없으니 두지 않습니다. */
  function scheduleDays() {
    if (!S.schedule.length) return SAMPLE_DAYS.slice();
    var seen = {};
    S.schedule.forEach(function (i) { var d = itemDay(i); if (d) seen[d] = true; });
    return Object.keys(seen).sort();
  }
  function selectedDay(ev, days) {
    if (days.length < 2) return '';
    if (ui.schedDay && days.indexOf(ui.schedDay) >= 0) return ui.schedDay;
    var today = ymd(ev.now);
    return days.indexOf(today) >= 0 ? today : days[0];
  }
  function dayTabs(ev, days, sel) {
    if (days.length < 2) return '';
    var today = ev.sameDay ? ymd(ev.now) : '';
    return '<div class="daytabs" role="group" aria-label="날짜">' + days.map(function (d) {
      var on = d === sel;
      return '<button class="daytab' + (on ? ' is-on' : '') + '" type="button" data-schedday="' + esc(d) + '" ' +
        'aria-pressed="' + on + '">' +
        '<span class="daytab__long">' + esc(dayLong(d)) + '</span>' +
        '<span class="daytab__short">' + esc(dayShort(d)) + '</span>' +
        (d === today ? '<span class="daytab__today">오늘</span>' : '') + '</button>';
    }).join('') + '</div>';
  }

  /* 상단 실시간 요약: 현재 시각 · 현재 일정 · 다음 일정.
     상황에 따라 두 칸의 내용만 바뀌고 틀(시각 | 왼쪽 | 오른쪽)은 같습니다.
     1초마다 시계 글자만 바뀌고, 분이 바뀔 때 이 칸만 다시 그립니다. */
  function scheduleLiveHtml(ev) {
    var br = scheduleBrief(ev);
    var st = S.settings || {};
    var dayIdx = ev.days ? ev.days.map(ymd).indexOf(ymd(ev.now)) : -1;
    var clockSub = ev.sameDay
      ? (ev.phase === 'after' ? '행사 종료' : ev.days.length > 1 ? '행사 ' + (dayIdx + 1) + '일차' : '행사 진행일')
      : ev.phase === 'before' ? '행사 전 · D-' + Math.max(0, ev.dday)
        : ev.phase === 'after' ? '행사 종료' : '';
    var tag = br.sample ? SAMPLE_END : '';
    var clock = '<div class="schedlive__clock">' +
      '<span class="schedlive__label">현재 시각</span>' +
      '<span class="schedlive__time" data-clock>' + hms(ev.now) + '</span>' +
      (clockSub ? '<span class="schedlive__sub">' + esc(clockSub) + '</span>' : '') + '</div>';

    function item(i, o) {
      o = o || {};
      var meta = [(o.day ? esc(o.day) + ' · ' : '') + '<span class="schedlive__range">' + timeRange(i) + '</span>'];
      if (i.place) meta.push(esc(i.place));
      if (o.cat && i.category) meta.push(esc(i.category));
      return '<p class="schedlive__title">' + esc(i.title) + '</p>' +
        '<p class="schedlive__meta">' + meta.join(' · ') + '</p>' +
        (o.extra ? '<p class="schedlive__left">' + o.extra + '</p>' : '');
    }
    function cell(cls, label, inner) {
      return '<div class="schedlive__cell ' + cls + '"><p class="schedlive__label">' + label + tag + '</p>' + inner + '</div>';
    }
    function note(text, sub) {
      return '<p class="schedlive__empty">' + esc(text) + '</p>' +
        (sub ? '<p class="schedlive__left">' + sub + '</p>' : '');
    }
    /* 진행 중 여러 건: 셋까지 한 줄 제목 + 한 줄(시각 · 장소 · 남은 시간).
       넷 이상이면 '+ N건 더 진행 중'. */
    function liveList() {
      var shown = br.liveItems.slice(0, 3);
      return '<ul class="schedlive__multi">' + shown.map(function (i) {
        return '<li><p class="schedlive__title">' + esc(i.title) + '</p>' +
          '<p class="schedlive__meta"><span class="schedlive__range">' + timeRange(i) + '</span>' +
          (i.place ? ' · ' + esc(i.place) : '') +
          ' · <span class="schedlive__leftin">' + esc(leftLabel(i, br.nowMin)) + '</span></p></li>';
      }).join('') + '</ul>' +
        (br.liveCount > shown.length ? '<p class="schedlive__more">+ ' + (br.liveCount - shown.length) + '건 더 진행 중</p>' : '');
    }

    var cells;
    switch (br.state) {
      case 'empty':
        cells = cell('schedlive__cell--wide', '일정', note('등록된 일정이 없습니다.'));
        break;
      case 'before':
        // 행사일 전에는 실시간 칸을 과장하지 않고 준비 상태와 다음 일정 하나만.
        cells = cell('schedlive__cell--prep', '행사 준비',
            '<p class="schedlive__dday">D-' + Math.max(0, ev.dday || 0) + '</p>' +
            '<p class="schedlive__meta">' + [st.date_label, st.time_label].filter(Boolean).map(esc).join(' · ') + '</p>') +
          cell('schedlive__cell--next schedlive__cell--focus', '다음 일정',
            br.key ? item(br.key, { day: itemDay(br.key) ? dayShort(itemDay(br.key)) : ev.start ? fmtEventDay(ev.start) : '', cat: true })
              : note('시작 시각이 정해진 일정이 없습니다.'));
        break;
      case 'live':
        cells = cell('schedlive__cell--live' + (br.liveCount > 1 ? ' schedlive__cell--multi' : ''),
            '<span class="livepill">진행 중</span>현재 일정' + (br.liveCount > 1 ? ' · ' + br.liveCount + '건' : ''),
            (br.liveCount > 1 ? liveList()
              : item(br.live, { cat: true, extra: br.liveLeft > 0 ? '남은 시간 <b>' + C.minLabel(br.liveLeft) + '</b>' : '곧 종료' })) +
            '<button class="linkbtn schedlive__jump" type="button" data-nowjump>타임라인에서 보기 ↓</button>') +
          cell('schedlive__cell--next', '다음 일정',
            br.next ? item(br.next, { extra: C.minLabel(br.nextIn) + ' 후 시작' + (br.nextMore ? ' · ' + br.nextMore : '') })
              : note('오늘 남은 일정이 없습니다.'));
        break;
      case 'waiting':
        cells = cell('schedlive__cell--idle', '현재 일정',
            note('진행 중인 일정 없음', (br.isFirst ? '첫 일정까지 ' : '다음 일정까지 ') + C.minLabel(br.nextIn))) +
          cell('schedlive__cell--next schedlive__cell--focus', br.isFirst ? '첫 일정' : '다음 일정',
            item(br.next, { cat: true, extra: '<b>' + C.minLabel(br.nextIn) + '</b> 후 시작' + (br.nextMore ? ' · ' + br.nextMore : '') }));
        break;
      case 'ended':
        cells = cell('schedlive__cell--idle', '오늘 일정', note('오늘 일정이 모두 끝났습니다.')) +
          cell('schedlive__cell--next', '마지막 일정',
            br.last ? item(br.last, { extra: hhmm(spanOf(br.last).b) + ' 종료' }) : note('종료'));
        break;
      default: // after
        cells = cell('schedlive__cell--idle', '전체 일정', note('행사 일정이 모두 끝났습니다.')) +
          cell('schedlive__cell--next', '마지막 일정',
            br.last ? item(br.last, { day: itemDay(br.last) ? dayShort(itemDay(br.last)) : ev.start ? fmtEventDay(ev.start) : '' }) : note('종료'));
    }
    return clock + cells;
  }

  function scheduleHalf(i) {
    var m = C.toMin(i.start_time);
    return m == null ? null : (m < 12 * 60 ? '오전' : '오후');
  }

  function viewSchedule() {
    var ev = eventInfo();
    var hasKey = S.schedule.some(function (i) { return i.is_highlight; });
    var days = scheduleDays();
    var sel = selectedDay(ev, days);
    // 칩 숫자는 실제 일정 기준이고, 예시만 보일 때는 숫자를 두지 않습니다('0' 옆에
    // 예시 24건이 보이면 헷갈립니다). 날짜를 고르면 그날 것만 셉니다.
    var base = S.schedule.filter(function (i) { return onDay(i, sel); });
    var noCount = !S.schedule.length;

    var cats = ['전체'].concat(SCHEDULE_CATS).map(function (c) {
      return { label: c, n: noCount ? null : c === '전체' ? base.length
        : base.filter(function (i) { return i.category === c; }).length };
    });
    var halves = ['전체', '오전', '오후'].map(function (h) {
      return { label: h, n: noCount ? null : h === '전체' ? base.length
        : base.filter(function (i) { return scheduleHalf(i) === h; }).length };
    });

    var keyToggle = hasKey
      ? '<button class="chip chip--toggle' + (ui.schedKey ? ' is-on' : '') + '" type="button" ' +
        'data-schedkeytoggle aria-pressed="' + (ui.schedKey ? 'true' : 'false') + '">핵심 일정만 보기</button>'
      : '';

    return '<div class="page sched">' +
      pageHead('운영 일정', ev.sameDay
        ? '요약은 오늘 전체 일정 기준, 목록은 선택한 조건 기준입니다.'
        : '행사 전체 일정을 시간순으로 확인합니다.') +
      // 예시 안내는 화면 위에 한 번만. 카드마다에는 작은 '예시' 표시만 둡니다.
      (S.schedule.length ? '' : '<p class="samplenote">예시 화면입니다. 실제 운영 일정이 등록되면 자동으로 바뀝니다.</p>') +
      '<section class="schedlive' + (ev.sameDay ? ' is-today' : '') + '" id="sched-live" aria-label="실시간 일정 요약">' +
      scheduleLiveHtml(ev) + '</section>' +
      // 순서: 날짜 → 오전·오후(+핵심) → 분류 → 검색. 여러 날 행사에서는 날짜가 가장 큰 갈래입니다.
      '<div class="tools">' + dayTabs(ev, days, sel) +
      '<div class="filterline">' + chips(halves, ui.schedHalf, 'data-schedhalf') +
      (keyToggle ? '<div class="chiprow chiprow--end">' + keyToggle + '</div>' : '') + '</div>' +
      // 분류는 한 단계 아래. 같은 크기로 두면 무엇이 먼저인지 알 수 없습니다.
      chips(cats, ui.schedCat, 'data-schedcat', 'chiprow--sub') +
      '<div class="search"><label class="sr-only" for="sched-q">일정 검색</label>' +
      '<input class="input" id="sched-q" type="search" placeholder="일정·장소·담당 검색" value="' + esc(ui.schedQ) + '" /></div>' +
      '</div>' +
      '<div id="sched-list" class="sched__list">' + scheduleListHtml(ev) + '</div></div>';
  }

  /* 타임라인 목록. 분이 바뀌면 이 부분만 다시 그립니다(검색창은 그대로). */
  function scheduleListHtml(ev) {
    var q = ui.schedQ.trim().toLowerCase();
    var filtered = ui.schedCat !== '전체' || ui.schedHalf !== '전체' || ui.schedKey || !!q;
    var sample = !S.schedule.length;

    // 등록된 일정이 없을 때만 예시를 보여 줍니다. 검색·필터를 걸어서
    // 0건이 된 경우(등록 일정이 없어도)에는 예시가 다시 나오지 않아야 합니다.
    // 날짜 선택은 필터가 아니라 '어느 날을 볼지' 라서 예시에도 그대로 씁니다.
    if (sample && filtered) return noMatchBox('조건에 맞는 일정이 없습니다.');

    var days = scheduleDays();
    var sel = selectedDay(ev, days);
    var list = (sample ? SAMPLE_SCHEDULE : S.schedule).filter(function (i) {
      if (!onDay(i, sel)) return false;
      if (ui.schedCat !== '전체' && i.category !== ui.schedCat) return false;
      if (ui.schedHalf !== '전체' && scheduleHalf(i) !== ui.schedHalf) return false;
      if (ui.schedKey && !i.is_highlight) return false;
      if (!q) return true;
      return (i.title + ' ' + (i.place || '') + ' ' + (i.team || '') + ' ' + (i.owner || ''))
        .toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) {
      var x = C.toMin(a.start_time), y = C.toMin(b.start_time);
      if (x == null) x = 9999;
      if (y == null) y = 9999;
      if (x !== y) return x - y;
      // 같은 시각에 시작하면 먼저 끝나는 것부터(짧은 체험 회차가 위로).
      var ex = C.toMin(a.end_time), ey = C.toMin(b.end_time);
      if (ex != null && ey != null && ex !== ey) return ex - ey;
      return (a.sort_order || 0) - (b.sort_order || 0);
    });

    if (!list.length) return noMatchBox('조건에 맞는 일정이 없습니다.');

    var nowMin = ev.now.getHours() * 60 + ev.now.getMinutes();
    // 현재 시각 선은 오늘 목록을 보고 있을 때만 긋습니다. 예시는 오늘이 예시 날짜일 때만.
    var today = ymd(ev.now);
    var showNow = ev.sameDay && (!sel || sel === today) && (!sample || SAMPLE_DAYS.indexOf(today) >= 0);

    /* 시간대별로 묶습니다. 시작 시각이 없는 일정은 맨 뒤에 따로 모읍니다. */
    var groups = [], seen = {};
    list.forEach(function (i) {
      var m = C.toMin(i.start_time);
      var key = m == null ? '미정' : C.pad2(Math.floor(m / 60)) + ':00';
      if (!seen[key]) { seen[key] = { key: key, at: m == null ? null : Math.floor(m / 60) * 60, items: [] }; groups.push(seen[key]); }
      seen[key].items.push(i);
    });

    /* 현재 시각 선은 '이미 시작한 일정' 과 '아직 시작 전인 일정' 사이에
       긋습니다. 그래서 진행 중인 카드 바로 아래에 붙습니다. */
    var marked = false;
    function shouldMark(i) {
      if (!showNow || marked) return false;
      var a = C.toMin(i.start_time);
      if (a == null || a > nowMin) { marked = true; return true; }
      return false;
    }

    var body = groups.map(function (g) {
      var lineBefore = '';
      var rows = g.items.map(function (i, idx) {
        var line = '';
        if (shouldMark(i)) {
          if (idx === 0) lineBefore = nowLine(ev.now); else line = nowLine(ev.now);
        }
        return line + scheduleRow(i, ev, nowMin, showNow);
      }).join('');
      return lineBefore + '<section class="tmlgroup">' +
        '<h2 class="tmlgroup__hour">' + esc(g.key) + '</h2>' +
        '<div class="tmlgroup__rows">' + rows + '</div></section>';
    }).join('');

    // 모든 일정이 이미 시작했으면 맨 끝에 긋습니다.
    if (showNow && !marked) body += nowLine(ev.now);

    var head = sel ? dayLong(sel) + ' · ' : '';
    return '<p class="resultline">' + esc(head) + list.length + '건' +
      (sample ? ' · 예시' : filtered ? ' · 선택한 조건' : '') + '</p>' +
      '<div class="tml tml--sched"' + (sample ? ' aria-label="예시 일정"' : '') + '>' + body + '</div>';
  }

  function scheduleRow(i, ev, nowMin, showNow) {
    // 예시는 오늘이 그 예시 날짜일 때만 진행 상태를 붙이고, '예정' 배지는 두지 않습니다.
    var st = i.sample ? (showNow ? liveStatus(i, ev) : '') : liveStatus(i, ev);
    var cls = st === '진행 중' ? ' tmlrow--now' : st === '종료' ? ' tmlrow--done' : '';
    if (st === '취소' || st === '변경') cls = ' tmlrow--off';
    if (i.sample) cls += ' is-sample';
    var sp = spanOf(i);
    var liveLabel = st === '진행 중' && sp
      ? '<p class="tmlrow__livehead"><span class="livepill">진행 중</span>' +
        (sp.b - nowMin > 0 ? C.minLabel(sp.b - nowMin) + ' 남음' : '곧 종료') + '</p>'
      : '';
    // '진행 중' 은 위 라벨이 이미 말하므로 아래 배지에서 뺍니다.
    var stBadge = st === '진행 중' || !st || (i.sample && st === '예정') ? '' : badge(st);
    return '<article class="tmlrow' + cls + '"' + (st === '진행 중' ? ' aria-current="time"' : '') + '>' +
      '<div class="tmlrow__time">' + esc(i.start_time || '미정') +
      (i.end_time ? '<span class="tmlrow__to">' + esc(i.end_time) + '</span>' : '') + '</div>' +
      '<div class="tmlrow__body">' + liveLabel +
      '<h3 class="tmlrow__title">' + esc(i.title) +
      (i.is_highlight ? '<span class="keymark" title="핵심 일정">핵심</span>' : '') + '</h3>' +
      '<p class="tmlrow__meta">' + esc(i.place || '장소 미정') +
      (i.team ? ' · ' + esc(i.team) : '') + (i.owner ? ' · ' + esc(i.owner) : '') + '</p>' +
      (i.memo ? '<p class="tmlrow__memo">' + esc(i.memo) + '</p>' : '') +
      '<div class="tmlrow__tags">' + stBadge +
      (i.category ? '<span class="tag tag--soft">' + esc(i.category) + '</span>' : '') +
      (i.sample ? SAMPLE_END : '') +
      '</div></div></article>';
  }

  function nowLine(d) {
    return '<div class="nowline" id="sched-nowline" role="separator" aria-label="현재 시각">' +
      '<span class="nowline__dot" aria-hidden="true"></span>' +
      '<span class="nowline__t">지금 <span data-clock>' + hms(d) + '</span></span></div>';
  }

  /* 1초마다: 시계 글자만. 분이 바뀔 때: 요약과 목록만 다시 그립니다.
     페이지 전체(검색창·필터)는 건드리지 않아 입력과 초점이 유지됩니다. */
  var schedLastMin = null;
  function tickSchedule(d) {
    var nodes = document.querySelectorAll('#view [data-clock]');
    var text = hms(d);
    for (var k = 0; k < nodes.length; k++) nodes[k].textContent = text;
    var m = d.getHours() * 60 + d.getMinutes();
    if (schedLastMin === null) { schedLastMin = m; return; }
    if (m === schedLastMin) return;
    schedLastMin = m;
    var ev = eventInfo();
    var live = $('#sched-live'), listEl = $('#sched-list');
    if (live) live.innerHTML = scheduleLiveHtml(ev);
    if (listEl) listEl.innerHTML = scheduleListHtml(ev);
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
    var zoneHtml = S.zones.length > 1
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
    // 고를 것이 한 가지뿐이면(예: 전부 초등) 필터는 뜻이 없습니다.
    var typeHtml = groupsPresent.length > 1
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
      // 부스번호 · 부스명 · 운영기관 · 유형 · 구역(키와 이름) · 프로그램
      return ((b.code || '') + ' ' + b.name + ' ' + (b.org || '') + ' ' + (b.program || '') + ' ' + orgType(b) +
        ' ' + orgGroup(orgType(b)) + ' ' + (b.zone_key || '') + ' ' + zoneName(b.zone_key))
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
        // 구역은 상자 없이 작은 글자로. 위치 정보라 유형 배지와 겹쳐 보이면 안 됩니다.
        ((b.zone_key || b.program)
          ? '<span class="booth__foot">' + esc([zoneName(b.zone_key), b.program].filter(Boolean).join(' · ')) + '</span>'
          : '') +
        '</button>';
    }).join('') + '</div>'
      // 등록된 부스가 없을 때만 예시를 보여 줍니다. 검색·필터를 걸어서 0건이 된
      // 경우에는(등록 부스가 없어도) 예시가 다시 나타나면 안 되므로 조건에 맞는
      // 결과 없음으로 안내합니다.
      : S.booths.length || ui.boothZone !== '전체' || ui.boothType !== '전체' || q
        ? noMatchBox('조건에 맞는 부스가 없습니다.')
        : sampleBooths();

    var s = S.settings || {};
    var map = mediaBox({
      url: s.booth_map_url, alt: s.booth_map_alt, caption: s.booth_map_caption,
      title: '부스 배치도',
      hint: '부스 배치도를 준비 중입니다.'
    });

    return '<div class="page">' +
      pageHead('부스 현황', '부스 위치와 운영기관을 확인합니다.') +
      map +
      // 등록된 부스가 없을 때 "전체 부스 0개"를 예시 카드 위에 그대로 두면
      // 숫자와 목록이 서로 다른 말을 하게 됩니다 — 실제 부스가 있을 때만 적습니다.
      (S.booths.length ? '<p class="countline">전체 부스 <b>' + S.booths.length + '</b>개</p>' : '') +
      (zoneHtml ? '<div class="filterrow"><span class="filterrow__l">구역</span>' + zoneHtml + '</div>' : '') +
      typeHtml +
      '<div class="tools"><div class="search"><label class="sr-only" for="booth-q">부스 검색</label>' +
      '<input class="input" id="booth-q" type="search" placeholder="부스번호 · 부스명 · 운영기관 · 구역 검색" value="' + esc(ui.boothQ) + '" /></div></div>' +
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

    // 부스 번호가 있어야 요청·물품과 이을 수 있습니다. 번호가 없으면 이름으로 찾습니다.
    var code = b.code || (b.zone_key && b.no ? b.zone_key + '-' + b.no : '');
    var key = code || b.name;
    html += boothOpsHtml(key,
      S.requests.filter(function (r) { return mentionsBooth((r.location || '') + ' ' + (r.title || ''), key); }),
      S.supplyTargets.filter(function (t) { return mentionsBooth((t.name || '') + ' ' + (t.memo || ''), key); }),
      true);

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
      pageHead('운영 공지', '운영 중 확인해야 할 변경 사항과 주요 안내입니다.') +
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
      (r.body ? '<span class="req__body">' + esc(r.body) + '</span>' : '') +
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
        '현장 지원이 필요할 때 등록하고, 해결되면 완료로 표시합니다.',
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

  // loc: 부스 상세에서 열면 부스 번호를 미리 채웁니다.
  function openRequestForm(loc) {
    var boothOpts = S.booths.map(function (b) {
      return '<option value="' + esc(b.code || b.name) + '">' + esc((b.code ? b.code + ' · ' : '') + b.name) + '</option>';
    }).join('');
    openDrawer('현장 문제 보고',
      '<form id="reqform" novalidate style="display:flex;flex-direction:column;gap:14px">' +
      '<div class="field"><label class="field__label" for="rq-loc">부스 또는 위치<span class="field__req">*</span></label>' +
      '<input class="input" id="rq-loc" list="boothlist" required placeholder="예: A-17 또는 야외무대 옆"' +
      (loc ? ' value="' + esc(loc) + '"' : '') + ' />' +
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
        (r.description ? '<p class="rescard__desc">' + esc(r.description) + '</p>' : '') +
        '<div class="rescard__kind">' + esc(r.category || '기타') + '</div>' +
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
      pageHead('관계자 자료실', '행사 운영에 필요한 자료를 확인합니다.') +
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
      pageHead('운영 연락망', '운영 담당자와 지원팀 연락처를 확인합니다.') +
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
      pageHead('운영 FAQ', '자주 확인하는 운영 질문을 모았습니다.') +
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
  /* 예정 · 진행 중 · 완료가 한 번씩 보이게 합니다. 담당은 사람 이름 대신 팀 이름.
     행사 당일 아침 운영 흐름을 본뜬 예시 시각이며, 실제 일정이 아닙니다. */
  /* 부스 운영과 바로 이어지는 업무로 채웁니다. 부스 카드에 상태를 두지 않는
     대신, 부스가 준비됐는지는 이런 업무의 예정 · 진행 중 · 완료로 드러납니다. */
  var SAMPLE_TASKS = [
    { st: '예정',   time: '09:20까지', area: '부스', title: '부스 운영자 입장 확인', place: 'AI스쿨존', team: '부스지원팀' },
    { st: '예정',   time: '09:40까지', area: '전산', title: 'A구역 전원·네트워크 점검', place: 'A구역', team: '전산지원팀' },
    { st: '진행 중', time: '',         area: '부스', title: '부스 세팅 상태 순회 확인', place: 'AI스쿨존 · 미래채움존', team: '부스지원팀' },
    { st: '완료',   time: '',         area: '물품', title: '운영 물품 1차 배부', place: '운영본부', team: '운영지원팀' }
  ];

  function sampleTasks() {
    return sampleWrap(SAMPLE_NOTE,
      SAMPLE_TASKS.map(function (t) {
        var done = t.st === '완료';
        return '<div class="task is-sample' + (done ? ' is-done' : '') + '">' +
          '<div class="task__top">' + (t.time ? '<span class="task__time">' + esc(t.time) + '</span>' : '') +
          (done ? doneMark('업무 완료') : badge(t.st)) +
          '<span class="tag tag--soft">' + esc(t.area) + '</span>' + SAMPLE_END + '</div>' +
          '<div class="task__title">' + esc(t.title) + '</div>' +
          '<div class="task__meta">' + esc(t.place) + '</div>' +
          '<div class="task__people"><span class="person">담당 ' + esc(t.team) + '</span></div></div>';
      }).join(''), 2);
  }

  function samplePeople() {
    return sampleWrap(SAMPLE_NOTE,
      [['부스지원팀', '부스 운영자 입장 확인 · 부스 세팅 상태 순회 확인', 2],
       ['전산지원팀', 'A구역 전원·네트워크 점검', 1],
       ['운영지원팀', '운영 물품 1차 배부', 1]].map(function (p) {
        return '<div class="rowcard is-sample"><div class="rowcard__body">' +
          '<div class="rowcard__name">' + esc(p[0]) + SAMPLE_END + '</div>' +
          '<div class="rowcard__meta">담당 업무 ' + p[2] + '건 · ' + esc(p[1]) + '</div>' +
          '</div></div>';
      }).join(''), 2);
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
        '업무별 담당자와 개인별 역할을 확인합니다.') +
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

  /* 담당은 사람 이름 대신 역할명. 수량은 화면 모양을 보여 주는 예시 값입니다. */
  var SAMPLE_SUPPLIES = [
    { name: 'A-18 체험 부스', kind: '부스', status: '미배부', manager: '부스지원팀', booth: 'A-18',
      items: [['운영키트', 1], ['명찰', 2], ['식권', 2], ['생수', 4]] },
    { name: 'AI스쿨존 운영기관', kind: '기관', status: '일부 배부', manager: '운영지원팀',
      items: [['명찰', 4], ['식권', 4], ['운영안내문', 1]], note: '일부 품목 전달됨' },
    { name: '운영본부', kind: '팀', status: '배부 완료', manager: '운영총괄',
      items: [['명찰', 6], ['무전기', 4], ['운영키트', 2], ['생수', 12]] }
  ];

  /* 예시 현황 숫자는 위 예시 카드에서 셉니다. 실제 표가 한 건이라도 생기면
     viewSupplies 가 이 함수를 부르지 않으므로 숫자도 함께 사라집니다. */
  function sampleSupplies() {
    var summary = '<div class="sumwrap"><p class="sumwrap__label">' + SAMPLE_END + ' 예시 현황</p>' +
      supplySummary(function (st) {
        return SAMPLE_SUPPLIES.filter(function (t) { return t.status === st; }).length;
      }, 'sumgrid--sample') + '</div>';
    return sampleWrap(SAMPLE_NOTE,
      SAMPLE_SUPPLIES.map(function (t) {
        var done = t.status === '배부 완료';
        // 예시 표시는 오른쪽 끝에 작게 한 번만. 상태 배지와 같은 무게로 늘어서지 않게 합니다.
        return '<div class="supply supply--' + SUPPLY_TONE[t.status] + ' is-sample' + (done ? ' is-done' : '') + '">' +
          '<div class="supply__top">' + (done ? doneMark('배부 완료') : badge(supplyLabel(t.status))) +
          '<span class="supply__kind">' + esc(t.kind) + '</span>' + SAMPLE_END + '</div>' +
          '<div class="supply__name">' + esc(t.name) + '</div>' +
          '<div class="supply__meta">담당 ' + esc(t.manager) + '</div>' +
          '<div class="supply__line">' + t.items.map(function (a) {
            return esc(a[0]) + ' <b>' + a[1] + '</b>';
          }).join('<span aria-hidden="true"> · </span>') + '</div>' +
          (t.note ? '<div class="supply__note">' + esc(t.note) + '</div>' : '') + '</div>';
      }).join(''), 3, summary);
  }

  /* ── 화면: 운영 물품 ────────────────────────────────────────── */
  /* 화면에서 쓰는 이름. 표의 값(미배부·일부 배부·배부 완료)은 그대로 두고
     포털의 요약·필터·카드·상세에서는 '배부 예정 · 배부 중 · 배부 완료' 로 읽히게 합니다.
     관리자 화면은 표의 값을 그대로 씁니다. */
  var SUPPLY_VIEW = [
    { label: '배부 예정', status: '미배부',   tone: 'plan', sub: '아직 전달 전' },
    { label: '배부 중',   status: '일부 배부', tone: 'part', sub: '일부 전달됨' },
    { label: '배부 완료', status: '배부 완료', tone: 'done', sub: '전달 완료' }
  ];
  // 배부 단계 숫자 석 장. countFor(표의 상태값) → 건수.
  function supplySummary(countFor, extra) {
    return summaryGrid(SUPPLY_VIEW.map(function (v) {
      return { n: countFor(v.status), l: v.label, sub: v.sub, tone: 'st-' + v.tone, dot: true };
    }), 'sumgrid--supply' + (extra ? ' ' + extra : ''));
  }
  var SUPPLY_TONE = { '미배부': 'plan', '일부 배부': 'part', '배부 완료': 'done' };
  function supplyLabel(status) {
    var v = SUPPLY_VIEW.filter(function (x) { return x.status === (status || '미배부'); })[0];
    return v ? v.label : status;
  }

  function viewSupplies() {
    var head = pageHead('운영 물품', '기관·팀·부스별 배부 현황입니다. 배부 상태는 운영본부가 관리합니다.');

    if (C.isTableMissing('supply_targets')) {
      return '<div class="page">' + head + notReadyBox('운영 물품 기능이 아직 준비되지 않았습니다.') + '</div>';
    }

    var all = S.supplyTargets;
    function countOf(st) { return all.filter(function (t) { return (t.status || '미배부') === st; }).length; }
    var plan = countOf('미배부'), part = countOf('일부 배부'), done = countOf('배부 완료');

    // 등록 전에는 예시 화면(예시 현황 숫자 포함)만. 실제 숫자와 섞지 않습니다.
    if (!all.length) return '<div class="page">' + head + sampleSupplies() + '</div>';

    var counts = { '미배부': plan, '일부 배부': part, '배부 완료': done };
    var summary = supplySummary(function (st) { return counts[st]; });

    var stateOn = SUPPLY_VIEW.filter(function (v) { return v.label === ui.supplyState; })[0];
    var q = ui.supplyQ.trim().toLowerCase();
    var list = all.filter(function (t) {
      if (stateOn && (t.status || '미배부') !== stateOn.status) return false;
      if (!q) return true;
      var items = allocsOf(t.id).map(function (a) { return a.name; }).join(' ');
      return (t.name + ' ' + (t.manager || '') + ' ' + (t.kind || '') + ' ' + items)
        .toLowerCase().indexOf(q) >= 0;
    });
    // 배부 예정을 배부 중보다 먼저 둡니다. 아무것도 못 받은 곳이 더 급합니다.
    var rankS = { '미배부': 0, '일부 배부': 1 };
    var need = list.filter(function (t) { return t.status !== '배부 완료'; })
      .sort(function (a, b) { return (rankS[a.status || '미배부'] || 0) - (rankS[b.status || '미배부'] || 0); });
    var doneList = list.filter(function (t) { return t.status === '배부 완료'; });

    var tools = '<div class="tools"><div class="search">' +
      '<label class="sr-only" for="supply-q">물품 검색</label>' +
      '<input class="input" id="supply-q" type="search" placeholder="대상 · 담당자 · 물품 검색" value="' +
      esc(ui.supplyQ) + '" /></div>' +
      chips([{ label: '전체', n: all.length }, { label: '배부 예정', n: plan },
        { label: '배부 중', n: part }, { label: '배부 완료', n: done }], ui.supplyState, 'data-supplystate') +
      '</div>';

    var grid = function (arr) { return '<div class="tl tl--2">' + arr.map(supplyCard).join('') + '</div>'; };
    var body;
    if (!list.length) {
      body = noMatchBox('조건에 맞는 배부 대상이 없습니다.');
    } else if (stateOn && stateOn.status === '배부 완료') {
      // 완료만 골랐으면 접지 않고 바로 펼쳐 보여 줍니다.
      body = '<section class="listsec"><h2 class="section-title">배부 완료' +
        '<span class="section-title__n">' + doneList.length + '</span></h2>' + grid(doneList) + '</section>';
    } else {
      body = '<section class="listsec"><h2 class="section-title">배부 확인 필요' +
        '<span class="section-title__n">' + need.length + '</span></h2>' +
        (need.length ? grid(need) : '<p class="allclear">' + doneMark('확인할 대상이 없습니다.') + '</p>') +
        '</section>' +
        (stateOn ? '' : doneSection('배부 완료', doneList.length, grid(doneList)));
    }

    return '<div class="page">' + head + summary + tools + body + '</div>';
  }

  /* 물품은 '명찰 6 · 생수 12' 한 줄로 적습니다. 목록에서 알고 싶은 것은
     무엇을 몇 개 받기로 했는가이고, 넷째부터는 +N 으로 줄입니다. */
  function supplyCard(t) {
    var items = allocsOf(t.id);
    var st = t.status || '미배부';
    var card = '<button class="supply supply--' + (SUPPLY_TONE[st] || 'plan') + (st === '배부 완료' ? ' is-done' : '') + '" type="button" data-supply="' + esc(t.id) + '">' +
      '<span class="supply__top">' + (st === '배부 완료' ? doneMark('배부 완료') : badge(supplyLabel(st))) +
      '<span class="supply__kind">' + esc([t.kind || '팀', t.headcount ? t.headcount + '명' : ''].filter(Boolean).join(' · ')) + '</span></span>' +
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

    var html = '<div class="notice__top">' + badge(supplyLabel(t.status)) +
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
        (TAB_ICONS[n.id] || '') +
        (b ? '<span class="tab__badge">' + (n.id === 'requests' ? openReq : urgent) + '</span>' : '') +
        '<span>' + esc(n.short) + '</span></a>';
    }).join('') +
      '<button type="button" data-open-sheet>' + TAB_ICONS.more + '<span>더보기</span></button>';

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
        '[data-contactcat],[data-faqcat],[data-taskarea],[data-boothtype],[data-supplystate]');
      if (chip) {
        if (chip.hasAttribute('data-boothzone'))   ui.boothZone   = chip.getAttribute('data-boothzone');
        if (chip.hasAttribute('data-boothtype'))   ui.boothType   = chip.getAttribute('data-boothtype');
        if (chip.hasAttribute('data-schedcat'))    ui.schedCat    = chip.getAttribute('data-schedcat');
        if (chip.hasAttribute('data-contactcat'))  ui.contactCat  = chip.getAttribute('data-contactcat');
        if (chip.hasAttribute('data-faqcat'))      ui.faqCat      = chip.getAttribute('data-faqcat');
        if (chip.hasAttribute('data-schedhalf'))   ui.schedHalf   = chip.getAttribute('data-schedhalf');
        if (chip.hasAttribute('data-taskarea'))    ui.taskArea    = chip.getAttribute('data-taskarea');
        if (chip.hasAttribute('data-supplystate')) ui.supplyState = chip.getAttribute('data-supplystate');
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
      // 요약에서 타임라인의 지금 위치로. 사용자가 누를 때만 움직입니다.
      if (t.closest('[data-nowjump]')) {
        var target = document.querySelector('#view .tmlrow--now') || $('#sched-nowline');
        if (target) {
          var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
        }
        return;
      }
      if (t.closest('[data-schedkeytoggle]')) { ui.schedKey = !ui.schedKey; render(); return; }
      var sd = t.closest('[data-schedday]');
      if (sd) { ui.schedDay = sd.getAttribute('data-schedday'); render(); return; }

      if (t.closest('[data-guide]')) {
        openDrawer('운영 안내',
          '<div class="noticebody">' + esc(((S.settings || {}).ops_guide || '').trim()) + '</div>',
          { footer: true });
        return;
      }

      var tm = t.closest('[data-taskmode]');
      if (tm) { ui.taskMode = tm.getAttribute('data-taskmode'); ui.taskQ = ''; render(); return; }
      var nr = t.closest('[data-newreq]');
      if (nr) { openRequestForm(nr.getAttribute('data-reqloc') || ''); return; }
      var sb = t.closest('[data-samplebooth]');
      if (sb) { sampleBoothDetail(Number(sb.getAttribute('data-samplebooth'))); return; }


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
      // 일정 화면은 시계·요약·목록만 부분 갱신합니다(1초마다 전체를 다시 그리지 않음).
      if (view === 'schedule') { tickSchedule(d); return; }
      if (d.getSeconds() % 30 !== 0 || typing) return;
      if (view === 'dashboard') render();
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
