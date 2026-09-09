/* ===================================================================
   제1회 인천 AI디지털 교육 페스티벌 — 동작
   디자인 원본: 랜딩 - 클레이 3D.dc.html (Claude Design)

   행사 내용(프로그램·시간표·부스·FAQ·설정)은 Supabase 에서 옵니다.
   assets/data.js 가 읽어 오고, 연결이 없으면 fallback-data.js 로 대신합니다.
   그래서 이 파일에는 내용이 없고 그리는 방법만 있습니다.

   CONFIG 는 색·모서리 같은 디자인 값이라 관리자에서 다루지 않습니다.
   =================================================================== */
(function () {
  'use strict';

  /* ── 설정 ───────────────────────────────────────────────────────── */
  var CONFIG = {
    // 색·톤
    colorway: '하늘 블루',        // 하늘 블루 | 딥 네이비 | 시안 아쿠아 | 코발트 인디고
    shadowDepth: '기본',          // 얕게 | 기본 | 깊게

    // 형태
    cornerRadius: 18,             // 8 – 40 (px)
    headlineScale: 1.25,          // 0.85 – 1.25
    density: '기본',              // 여유 | 기본 | 조밀
    bodyFont: '고딕 단일',        // 고운돋움 혼용 | 고딕 단일

    // 구성
    showKpiStrip: true,
    defaultScheduleView: '타임라인', // 타임라인 | 표
    boothNumbers: '번호 전체',    // 번호 전체 | 범위만
    showMapSlot: true,
    faqOpenFirst: false,

    // 부스 운영 신청 안내 문서 주소. 준비되면 여기만 바꾸면 반영됩니다.
    // (참여자는 신청 절차가 없어 따로 링크가 없습니다.)
    boothUrl: '#apply'
  };

  /* 관리자에서 켜고 끄는 값들. FestivalData 가 실어 옵니다. */
  var SETTINGS = {};

  /* ── 테마 ───────────────────────────────────────────────────────── */
  var COLORWAYS = {
    '하늘 블루':    { slug: 'sky',    ground: '#E8F1FD', tint: '#EFF5FE', primary: '#2563C9', ink: '#14294A' },
    '딥 네이비':    { slug: 'navy',   ground: '#E6EBF5', tint: '#EDF1F9', primary: '#1B3A78', ink: '#0E1D3D' },
    '시안 아쿠아':  { slug: 'aqua',   ground: '#E4F4F8', tint: '#EDF8FB', primary: '#0E7490', ink: '#0B3944' },
    '코발트 인디고':{ slug: 'indigo', ground: '#EAECFB', tint: '#F1F2FD', primary: '#3A3FC4', ink: '#1B1D5C' }
  };

  /* 그림자는 두 겹입니다. 가까운 한 겹이 윤곽을 잡고 먼 한 겹이 띄웁니다.
     inset 값은 클레이 특유의 아랫단 턱인데, 너무 두꺼우면 투박해 보여서
     원본보다 얇게 잡았습니다. */
  var SHADOWS = {
    '얕게': ['0 1px 2px rgba(20,55,110,0.05), 0 4px 10px -4px rgba(20,55,110,0.10)',  'inset 0 -1.5px 0 rgba(20,55,110,0.05)'],
    '기본': ['0 1px 2px rgba(20,55,110,0.05), 0 10px 24px -8px rgba(20,55,110,0.16)', 'inset 0 -2.5px 0 rgba(20,55,110,0.06)'],
    '깊게': ['0 2px 4px rgba(20,55,110,0.07), 0 20px 40px -12px rgba(20,55,110,0.24)', 'inset 0 -4px 0 rgba(20,55,110,0.09)']
  };

  var PADS = { '여유': '84px', '기본': '56px', '조밀': '38px' };

  function theme() { return COLORWAYS[CONFIG.colorway] || COLORWAYS['하늘 블루']; }

  /* 갈래별 색. '기조·강연' 은 현재 colorway 를 따라갑니다. */
  function cats() {
    var t = theme();
    return {
      '기조·강연':  { color: t.primary, tint: t.tint },
      '체험·전시':  { color: '#0F6E86', tint: '#E1F2F7' },
      '무대 공연':  { color: '#5B3FBF', tint: '#EDE9FB' },
      '운영':       { color: '#4A5A72', tint: '#EBEFF5' }
    };
  }

  /* ── 데이터 ─────────────────────────────────────────────────────
     Supabase(또는 기본 내용)에서 받아 채웁니다. boot() 를 보세요. */
  var PROGRAMS = [];
  var SCHEDULE = [];
  var ZONES = [];
  var BOOTHS = [];
  var FAQS = [];

  var TOTAL_BOOTHS = 40;   // 안내 문구용 전체 부스 수

  /* 탭 하나가 페이지 하나입니다. id 는 주소창 해시(#program 등)와 같습니다. */
  var PAGES = [
    { id: 'home',     title: '제1회 인천 AI디지털 교육 페스티벌' },
    { id: 'program',  title: '프로그램' },
    { id: 'schedule', title: '시간표' },
    { id: 'booth',    title: '부스 배치도' },
    { id: 'apply',    title: '참여 안내' },
    { id: 'visit',    title: '오시는 길' },
    { id: 'faq',      title: '자주 묻는 질문' }
  ];

  var SITE_NAME = '인천 AI디지털 교육 페스티벌';

  /* ── 상태 ───────────────────────────────────────────────────────── */
  var state = {
    page: 'home',
    view: CONFIG.defaultScheduleView === '표' ? 'table' : 'timeline',
    filter: '전체',
    zone: null
  };

  /* ── 도우미 ─────────────────────────────────────────────────────── */
  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  function esc(v) {
    return String(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  /* ── 토큰 적용 (원본 applyVars) ─────────────────────────────────── */
  function applyVars() {
    var t = theme();
    var sh = SHADOWS[CONFIG.shadowDepth] || SHADOWS['기본'];
    var r = CONFIG.cornerRadius;

    var vars = {
      '--cl-ground': t.ground,
      '--cl-tint': t.tint,
      '--cl-primary': t.primary,
      '--cl-ink': t.ink,
      '--r': r + 'px',
      '--r-lg': (r + 8) + 'px',
      '--sh': sh[0],
      '--sh-in': sh[1],
      '--hs': String(CONFIG.headlineScale),
      '--pad': PADS[CONFIG.density] || '56px',
      '--bodyfont': CONFIG.bodyFont === '고딕 단일' ? "'Gothic A1'" : "'Gowun Dodum'"
    };

    var root = document.documentElement;
    Object.keys(vars).forEach(function (k) { root.style.setProperty(k, vars[k]); });
    root.setAttribute('data-colorway', t.slug);

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t.ground);
  }

  /* ── 구성 토글 · 링크 · 문구 ────────────────────────────────────── */
  function applyOptions() {
    $$('[data-link="booth"]').forEach(function (el) { el.href = CONFIG.boothUrl; });

    $('#countdown').hidden = SETTINGS.show_countdown === false;
    $('#kpi').hidden = !CONFIG.showKpiStrip;
    $('#mapcard').hidden = !CONFIG.showMapSlot;
    $('#parkingcard').hidden = SETTINGS.show_parking_table !== true;

    // 설정 표의 값들을 화면 곳곳에 꽂습니다.
    $$('[data-bind]').forEach(function (el) {
      var v = SETTINGS[el.dataset.bind];
      if (v !== undefined && v !== null && v !== '') el.textContent = v;
    });
    $$('[data-bind-mail]').forEach(function (el) {
      var v = SETTINGS[el.dataset.bindMail];
      if (v) { el.textContent = v; el.href = 'mailto:' + v; }
    });

    // 여러 항목을 띄어쓰기로 이어 붙입니다. 예: 날짜 표기 + 시간 표기
    $$('[data-bind-join]').forEach(function (el) {
      var parts = el.dataset.bindJoin.split(' ')
        .map(function (k) { return SETTINGS[k]; })
        .filter(function (v) { return v !== undefined && v !== null && v !== ''; });
      if (parts.length) el.textContent = parts.join(' ');
    });

  }

  /* ── 카운트다운 ─────────────────────────────────────────────────── */
  function startCountdown() {
    if (SETTINGS.show_countdown === false) return;

    var target = new Date(SETTINGS.event_start).getTime();
    if (isNaN(target)) return;

    var elD = $('#cd-d'), elH = $('#cd-h'), elM = $('#cd-m'), elS = $('#cd-s');

    function tick() {
      var diff = Math.max(0, target - Date.now());
      elD.textContent = Math.floor(diff / 86400000);
      elH.textContent = pad2(Math.floor(diff / 3600000) % 24);
      elM.textContent = pad2(Math.floor(diff / 60000) % 60);
      elS.textContent = pad2(Math.floor(diff / 1000) % 60);
    }

    tick();
    setInterval(tick, 1000);
  }

  /* ── 프로그램 카드 ──────────────────────────────────────────────── */
  function renderPrograms() {
    $('#proggrid').innerHTML = PROGRAMS.map(function (p) {
      return '<li class="prog" style="--tint:' + esc(p.tint) + '; --deep:' + esc(p.deep) + ';">' +
               '<span class="prog__no">' + esc(p.no) + '</span>' +
               '<h2 class="prog__title">' + esc(p.title) + '</h2>' +
               '<p class="prog__desc">' + esc(p.desc) + '</p>' +
               '<p class="prog__meta">' + esc(p.meta) + '</p>' +
             '</li>';
    }).join('');
  }

  /* ── FAQ ────────────────────────────────────────────────────────── */
  function renderFaqs() {
    $('#faqlist').innerHTML = FAQS.map(function (f) {
      return '<details class="faq" name="faq">' +
               '<summary class="faq__q"><span>' + esc(f.q) + '</span>' +
               '<span class="faq__sign" aria-hidden="true"></span></summary>' +
               '<p class="faq__a">' + esc(f.a) + '</p>' +
             '</details>';
    }).join('');
    if (CONFIG.faqOpenFirst) {
      var first = $('.faq');
      if (first) first.open = true;
    }
  }

  /* ── 시간표 ─────────────────────────────────────────────────────── */
  function visibleSchedule() {
    return SCHEDULE.filter(function (it) {
      return SETTINGS.show_ops_track === true || it.cat !== '운영';
    });
  }

  function buildChips() {
    var names = ['전체', '기조·강연', '체험·전시', '무대 공연'];
    if (SETTINGS.show_ops_track === true) names.push('운영');

    $('#chiprow').innerHTML = names.map(function (n) {
      var on = n === state.filter;
      return '<button type="button" class="chip' + (on ? ' is-on' : '') + '"' +
             ' data-filter="' + esc(n) + '" aria-pressed="' + on + '">' + esc(n) + '</button>';
    }).join('');
  }

  function tlItem(it, c) {
    return '<div class="tlitem" style="--cat:' + c.color + '; --cat-tint:' + c.tint + ';">' +
             '<div class="tlitem__when">' +
               '<div class="tlitem__time">' + esc(it.time) + '</div>' +
               '<div class="tlitem__dur">' + esc(it.dur) + '</div>' +
             '</div>' +
             '<div class="tlitem__what">' +
               '<div class="tlitem__title">' + esc(it.title) + '</div>' +
               '<div class="tlitem__place">' + esc(it.place) + '</div>' +
             '</div>' +
             '<span class="cat">' + esc(it.cat) + '</span>' +
           '</div>';
  }

  function tableRow(it, c) {
    return '<tr style="--cat:' + c.color + '; --cat-tint:' + c.tint + ';">' +
             '<td class="t-time">' + esc(it.time) + '</td>' +
             '<td class="t-title">' + esc(it.title) + '</td>' +
             '<td>' + esc(it.place) + '</td>' +
             '<td><span class="cat cat--sm">' + esc(it.cat) + '</span></td>' +
           '</tr>';
  }

  function renderSchedule() {
    var C = cats();
    var rows = visibleSchedule().filter(function (it) {
      return state.filter === '전체' || it.cat === state.filter;
    });

    var am = rows.filter(function (r) { return r.half === 'am'; });
    var pm = rows.filter(function (r) { return r.half === 'pm'; });

    $('#am-list').innerHTML = am.map(function (it) { return tlItem(it, C[it.cat]); }).join('');
    $('#pm-list').innerHTML = pm.map(function (it) { return tlItem(it, C[it.cat]); }).join('');
    $('#am-label').textContent = am.length + '개 순서';
    $('#pm-label').textContent = pm.length + '개 순서';

    $('#tl-am').hidden = am.length === 0;
    $('#tl-pm').hidden = pm.length === 0;
    $('#tl-empty').hidden = rows.length > 0;

    $('#table-body').innerHTML = rows.map(function (it) { return tableRow(it, C[it.cat]); }).join('');

    $('#view-timeline').hidden = state.view !== 'timeline';
    $('#view-table').hidden = state.view !== 'table';

    $$('.segmented__btn').forEach(function (b) {
      var on = b.dataset.view === state.view;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  /* ── 부스 ───────────────────────────────────────────────────────── */
  function renderZones() {
    var showNums = CONFIG.boothNumbers !== '범위만';

    $('#zonegrid').innerHTML = ZONES.map(function (z) {
      var on = state.zone === z.key;
      var count = z.to - z.from + 1;

      var nums = '';
      if (showNums) {
        var cells = '';
        for (var i = z.from; i <= z.to; i++) cells += '<span>' + i + '</span>';
        nums = '<span class="zone__nums">' + cells + '</span>';
      }

      return '<button type="button" class="zone' + (on ? ' is-on' : '') + '"' +
               ' data-zone="' + z.key + '" aria-pressed="' + on + '"' +
               ' style="--tint:' + z.tint + '; --solid:' + z.solid + '; --deep:' + z.deep + ';">' +
               '<span class="zone__head">' +
                 '<span class="zone__key">' + z.key + '</span>' +
                 '<span class="zone__label">' + esc(z.label) + '</span>' +
               '</span>' +
               '<span class="zone__meta">' + z.from + '–' + z.to + '번 · ' + count + '개 부스 · ' + esc(z.sub) + '</span>' +
               nums +
             '</button>';
    }).join('');
  }

  function renderBooths() {
    var zoneMap = {};
    ZONES.forEach(function (z) { zoneMap[z.key] = z; });

    var list = BOOTHS.filter(function (b) { return !state.zone || b.zone === state.zone; });

    $('#boothgrid').innerHTML = list.map(function (b) {
      var z = zoneMap[b.zone];
      return '<li class="booth">' +
               '<span class="booth__no" style="--tint:' + z.tint + '; --deep:' + z.deep + ';">' + b.no + '</span>' +
               '<div class="booth__body">' +
                 '<p class="booth__name">' + esc(b.name) + '</p>' +
                 '<p class="booth__meta">' + b.zone + '존 · ' + esc(b.org) + '</p>' +
               '</div>' +
             '</li>';
    }).join('');

    $('#booth-title').textContent = state.zone
      ? state.zone + '존 · ' + zoneMap[state.zone].label
      : '부스 목록';

    $('#booth-note').textContent = state.zone
      ? '다시 누르면 전체 보기 · 예시 ' + list.length + '개'
      : '전체 ' + TOTAL_BOOTHS + '개 부스 중 예시 ' + list.length + '개';
  }

  /* ── 탭 라우터 ──────────────────────────────────────────────────── */

  /* 주소창의 해시를 페이지 id 로 바꿉니다. 모르는 값이면 홈으로 보냅니다. */
  function pageFromHash() {
    var id = (location.hash || '').replace(/^#/, '');
    var hit = PAGES.filter(function (p) { return p.id === id; })[0];
    return hit ? hit.id : 'home';
  }

  /* 좁은 화면에서 탭 줄은 옆으로 스크롤됩니다. 켜진 탭을 보이는 곳으로
     끌어옵니다. block:'nearest' 라 세로 위치는 건드리지 않고, 가장자리
     탭에서 넘치지 않도록 브라우저가 알아서 잘라 줍니다. */
  function centerActiveTab() {
    var nav = $('#nav');
    var on = $('#nav a.is-on');
    if (!on || nav.scrollWidth <= nav.clientWidth) return;
    // 페이지가 즉시 바뀌므로 탭 줄도 즉시 옮깁니다. smooth 로 두면 바로 뒤에
    // 오는 페이지 맨 위로 이동이 이 애니메이션을 취소해 버립니다.
    on.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'instant' });
  }

  /* first 가 true 면 첫 화면이라 스크롤·포커스를 건드리지 않습니다. */
  function showPage(id, first) {
    state.page = id;

    $$('[data-page]').forEach(function (el) {
      el.classList.toggle('is-active', el.dataset.page === id);
    });

    // 현재 탭 표시. aria-current 는 화면 낭독기가 "현재 페이지"로 읽어 줍니다.
    $$('#nav a').forEach(function (a) {
      var on = a.getAttribute('href') === '#' + id;
      a.classList.toggle('is-on', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    var page = PAGES.filter(function (p) { return p.id === id; })[0];
    document.title = id === 'home' ? page.title : page.title + ' · ' + SITE_NAME;

    centerActiveTab();

    if (first) return;

    // 탭을 누르면 새 페이지를 처음부터 보여 줍니다.
    window.scrollTo({ top: 0, behavior: 'instant' });

    // 키보드·낭독기 사용자가 새 페이지 제목에서 이어서 읽도록 초점을 옮깁니다.
    var heading = document.querySelector('[data-page="' + id + '"] [tabindex="-1"]');
    if (heading) heading.focus({ preventScroll: true });
  }

  function startRouter() {
    // 라우터가 켜졌다고 알립니다. 자바스크립트가 없으면 이 클래스가 붙지
    // 않아서 모든 페이지가 예전처럼 한 장으로 이어집니다.
    document.documentElement.classList.add('has-router');

    window.addEventListener('hashchange', function () { showPage(pageFromHash(), false); });
    showPage(pageFromHash(), true);

    // 웹폰트가 늦게 오면 탭 너비가 달라집니다. 폰트가 자리잡은 뒤 한 번 더 맞춥니다.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { centerActiveTab(); });
    }
  }

  /* ── 이벤트 ─────────────────────────────────────────────────────── */
  function bind() {
    $('.segmented').addEventListener('click', function (e) {
      var btn = e.target.closest('.segmented__btn');
      if (!btn) return;
      state.view = btn.dataset.view;
      renderSchedule();
    });

    $('#chiprow').addEventListener('click', function (e) {
      var btn = e.target.closest('.chip');
      if (!btn) return;
      state.filter = btn.dataset.filter;
      buildChips();
      renderSchedule();
    });

    $('#zonegrid').addEventListener('click', function (e) {
      var btn = e.target.closest('.zone');
      if (!btn) return;
      // 같은 구역을 다시 누르면 전체 보기로 돌아갑니다.
      state.zone = state.zone === btn.dataset.zone ? null : btn.dataset.zone;
      renderZones();
      renderBooths();
    });

    // 이미 보고 있는 탭을 다시 누르면 해시가 그대로라 hashchange 가 없습니다.
    // 그때는 맨 위로만 올려 줍니다.
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href^="#"]');
      if (!a) return;
      if (a.getAttribute('href') === '#' + state.page) {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  /* ── 시작 ───────────────────────────────────────────────────────── */

  function boot(data) {
    SETTINGS = data.settings || {};
    PROGRAMS = data.programs || [];
    SCHEDULE = data.schedule || [];
    ZONES    = data.zones || [];
    BOOTHS   = data.booths || [];
    FAQS     = data.faqs || [];

    applyVars();
    applyOptions();
    renderPrograms();
    buildChips();
    renderSchedule();
    renderZones();
    renderBooths();
    renderFaqs();
    bind();
    startRouter();
    startCountdown();

    document.documentElement.setAttribute('data-source', data.source);
  }

  // 색·여백은 데이터를 기다릴 필요가 없으니 먼저 칠해 둡니다.
  // 그래야 불러오는 동안 흰 화면이 번쩍이지 않습니다.
  applyVars();

  window.FestivalData.load().then(boot).catch(function (e) {
    console.error('[festival] 내용을 불러오지 못했습니다:', e);
  });
})();
