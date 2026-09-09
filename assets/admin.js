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
  var zoneKeys = [];
  var staffRows = null;   // Edge Function 이 돌려준 계정 목록(로그인 상태 포함)
  var staffNote = null;   // 함수가 아직 배포되지 않았을 때 안내
  var fnUnavailable = false;  // 미배포 확인 후에는 다시 부르지 않습니다

  var SCHEDULE_CATS = ['무대', '강연', '부스', '운영', '행사 지원'];
  var SCHEDULE_STATES = ['예정', '진행 중', '종료', '취소', '변경'];
  var BOOTH_STATES = ['준비 전', '준비 완료', '운영 중', '일시 중단', '운영 종료'];
  var REQ_KINDS = ['전기', '네트워크', '기자재', '시설', '안전', '물품', '주차', '기타'];
  var REQ_PRIORITY = ['긴급', '높음', '보통'];
  var REQ_STATES = ['접수', '확인 중', '처리 중', '완료'];
  var NOTICE_LEVELS = ['긴급', '중요', '일반'];

  function opts(l) { return l.map(function (v) { return [v, v]; }); }

  var TONE = {
    '운영 중': 'ok', '준비 완료': 'info', '준비 전': 'warn', '일시 중단': 'danger', '운영 종료': 'off',
    '진행 중': 'ok', '예정': 'info', '종료': 'off', '취소': 'danger', '변경': 'warn',
    '긴급': 'danger', '중요': 'warn', '일반': 'info', '높음': 'warn', '보통': 'info',
    '접수': 'warn', '확인 중': 'info', '처리 중': 'info', '완료': 'ok',
    'admin': 'danger', 'staff': 'info', '활성': 'ok', '초대됨': 'warn', '계정 없음': 'off'
  };
  function badge(t) { return '<span class="badge badge--' + (TONE[t] || 'off') + '">' + esc(t) + '</span>'; }
  function tag(t) { return '<span class="badge badge--plain">' + esc(t) + '</span>'; }

  function fmtDay(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
      C.pad2(d.getHours()) + ':' + C.pad2(d.getMinutes());
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
      label: '행사 기본정보', table: 'settings', single: true, order: false,
      desc: '포털 곳곳에 함께 반영됩니다. D-day 와 진행 상태는 개막·종료 일시로 계산합니다.',
      fields: [
        { k: 'event_title',   label: '행사 이름', wide: true, required: true },
        { k: 'event_start',   label: '개막 일시', type: 'datetime' },
        { k: 'event_end',     label: '종료 일시', type: 'datetime' },
        { k: 'date_label',    label: '날짜 표기', hint: '예: 2026. 10. 17.(토)' },
        { k: 'time_label',    label: '운영시간 표기', hint: '예: 10:00 – 17:00' },
        { k: 'venue',         label: '장소' },
        { k: 'venue_detail',  label: '장소 상세' },
        { k: 'venue_address', label: '주소', wide: true },
        { k: 'venue_map_url', label: '배치도 이미지 주소', wide: true, hint: '비우면 “배치도 준비 중”' },
        { k: 'contact_phone', label: '대표 전화' },
        { k: 'contact_email', label: '대표 메일' },
        { k: 'portal_note',   label: '포털 안내 문구', type: 'textarea', wide: true }
      ]
    },

    schedule_items: {
      label: '일정 관리', table: 'schedule_items', addLabel: '+ 일정 추가',
      desc: '시작·종료 시각으로 포털의 “지금 진행 중”이 자동 계산됩니다.',
      blank: { start_time: '10:00', end_time: '10:30', title: '', category: '운영', status: '예정' },
      title: function (r) { return r.title || '(제목 없음)'; },
      meta: function (r) {
        return (r.start_time || '--:--') + '–' + (r.end_time || '--:--') +
          (r.place ? ' · ' + r.place : '') + (r.team ? ' · ' + r.team : '') + (r.owner ? ' · ' + r.owner : '');
      },
      tags: function (r) { return badge(r.status || '예정') + tag(r.category || '운영'); },
      fields: [
        { k: 'start_time', label: '시작시간', type: 'time', required: true },
        { k: 'end_time',   label: '종료시간', type: 'time', required: true },
        { k: 'title',      label: '일정명', wide: true, required: true },
        { k: 'category',   label: '구분', type: 'select', options: opts(SCHEDULE_CATS) },
        { k: 'place',      label: '장소' },
        { k: 'team',       label: '담당팀' },
        { k: 'owner',      label: '담당자' },
        { k: 'status',     label: '상태', type: 'select', options: opts(SCHEDULE_STATES) },
        { k: 'memo',       label: '메모', type: 'textarea', wide: true }
      ],
      /* time_label 은 구 스키마의 NOT NULL 칼럼입니다. 시작·종료로
         항상 채워야 INSERT 가 23502 로 막히지 않습니다. */
      beforeSave: function (v) {
        v.time_label = (v.start_time || '') + ' – ' + (v.end_time || '');
        var m = /^(\d{1,2}):/.exec(v.start_time || '');
        v.half = m && Number(m[1]) >= 12 ? 'pm' : 'am';
        return v;
      },
      validate: function (v) {
        var a = C.toMin(v.start_time), b = C.toMin(v.end_time);
        if (a == null || b == null) return '시간은 HH:MM 형식으로 입력해 주세요.';
        if (b <= a) return '종료시간은 시작시간보다 뒤여야 합니다.';
        return null;
      }
    },

    booths: {
      label: '부스 관리', table: 'booths', addLabel: '+ 부스 추가',
      desc: '부스 번호와 구역으로 표시용 코드(A-01)를 만듭니다.',
      blank: { no: 1, zone_key: 'A', name: '', org: '', status: '준비 전' },
      title: function (r) { return (r.code || (r.zone_key + '-' + r.no)) + ' · ' + (r.name || '(이름 없음)'); },
      meta: function (r) { return (r.org || '운영기관 미정') + (r.manager ? ' · 담당 ' + r.manager : ''); },
      tags: function (r) {
        return badge(r.status || '준비 전') +
          (r.needs_power ? tag('전기') : '') + (r.needs_network ? tag('네트워크') : '');
      },
      fields: [
        { k: 'no',            label: '부스 번호', type: 'number', required: true },
        { k: 'zone_key',      label: '구역', type: 'zone' },
        { k: 'name',          label: '부스명', wide: true, required: true },
        { k: 'org',           label: '운영기관', wide: true },
        { k: 'status',        label: '운영 상태', type: 'select', options: opts(BOOTH_STATES) },
        { k: 'hours',         label: '운영 시간' },
        { k: 'manager',       label: '담당자' },
        { k: 'manager_phone', label: '담당자 연락처', type: 'tel' },
        { k: 'program',       label: '운영 프로그램', wide: true },
        { k: 'needs_power',   label: '전기 사용 필요', type: 'bool' },
        { k: 'needs_network', label: '네트워크 필요', type: 'bool' },
        { k: 'supplies',      label: '필요 물품', wide: true },
        { k: 'memo',          label: '운영 메모', type: 'textarea', wide: true },
        { k: 'notes',         label: '특이사항', type: 'textarea', wide: true }
      ],
      beforeSave: function (v) {
        if (!v.code) v.code = v.zone_key + '-' + String(v.no).padStart(2, '0');
        return v;
      }
    },

    notices: {
      label: '공지 관리', table: 'notices', addLabel: '+ 공지 작성',
      order: [['pinned', false], ['created_at', false]],
      desc: '긴급 공지는 포털 대시보드 최상단에 자동으로 올라갑니다.',
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
      label: '운영 요청 관리', table: 'operation_requests', addLabel: '+ 요청 등록',
      order: [['created_at', false]],
      desc: '현장에서 등록한 문제 보고입니다. 처리 상태를 여기서 바꿉니다.',
      blank: { location: '', kind: '기타', priority: '보통', title: '', status: '접수' },
      title: function (r) { return r.title || '(제목 없음)'; },
      meta: function (r) {
        return (r.location || '위치 미지정') + ' · ' + fmtDay(r.created_at) +
          (r.assignee_team ? ' · ' + r.assignee_team : '');
      },
      tags: function (r) { return badge(r.status) + badge(r.priority) + tag(r.kind); },
      fields: [
        { k: 'status',        label: '처리 상태', type: 'select', options: opts(REQ_STATES) },
        { k: 'priority',      label: '우선순위', type: 'select', options: opts(REQ_PRIORITY) },
        { k: 'kind',          label: '유형', type: 'select', options: opts(REQ_KINDS) },
        { k: 'assignee_team', label: '담당팀' },
        { k: 'location',      label: '부스 또는 위치', wide: true, required: true },
        { k: 'title',         label: '제목', wide: true, required: true },
        { k: 'body',          label: '내용', type: 'textarea', wide: true },
        { k: 'reporter',      label: '등록자' }
      ]
    },

    resources: {
      label: '자료실 관리', table: 'resources', addLabel: '+ 자료 추가',
      desc: '파일은 외부 저장소에 올리고 주소만 등록하는 방식입니다.',
      blank: { title: '', category: '기타', url: '', is_public: true },
      title: function (r) { return r.title || '(제목 없음)'; },
      meta: function (r) { return (r.category || '기타') + (r.description ? ' · ' + r.description : ''); },
      tags: function (r) { return r.is_public ? tag('공개') : badge('비공개'); },
      fields: [
        { k: 'title',       label: '자료명', wide: true, required: true },
        { k: 'category',    label: '분류', hint: '예: 운영계획 · 안전' },
        { k: 'is_public',   label: '관계자에게 공개', type: 'bool' },
        { k: 'url',         label: '자료 주소(URL)', wide: true },
        { k: 'description', label: '설명', type: 'textarea', wide: true }
      ]
    },

    contacts: {
      label: '연락망 관리', table: 'contacts', addLabel: '+ 연락처 추가',
      desc: '전화번호는 로그인한 관계자에게만 보입니다.',
      blank: { name: '', category: '기타', phone: '' },
      title: function (r) { return r.name || '(이름 없음)'; },
      meta: function (r) { return (r.org || '') + (r.phone ? ' · ' + r.phone : ''); },
      tags: function (r) { return tag(r.category || '기타') + (r.duty ? tag(r.duty) : ''); },
      fields: [
        { k: 'name',     label: '이름', required: true },
        { k: 'category', label: '구분', hint: '예: 운영 총괄 · 시설' },
        { k: 'org',      label: '소속' },
        { k: 'duty',     label: '담당업무' },
        { k: 'phone',    label: '전화번호', type: 'tel' },
        { k: 'memo',     label: '메모', type: 'textarea', wide: true }
      ]
    },

    venue_places: {
      label: '행사장 관리', table: 'venue_places', addLabel: '+ 공간 추가',
      desc: '운영본부·보건·주차 등 관계자가 찾는 공간을 등록합니다.',
      blank: { name: '', category: '기타', detail: '' },
      title: function (r) { return r.name || '(이름 없음)'; },
      meta: function (r) { return r.detail || ''; },
      tags: function (r) { return tag(r.category || '기타'); },
      fields: [
        { k: 'name',     label: '공간 이름', required: true },
        { k: 'category', label: '분류', hint: '예: 운영 · 안전 · 편의' },
        { k: 'detail',   label: '위치 설명', type: 'textarea', wide: true }
      ]
    },

    faqs: {
      label: 'FAQ 관리', table: 'faqs', addLabel: '+ 질문 추가',
      desc: '관계자가 자주 묻는 운영 질문입니다.',
      blank: { question: '', answer: '', category: '운영', is_public: true },
      title: function (r) { return r.question || '(질문 없음)'; },
      meta: function (r) { return (r.answer || '').slice(0, 70); },
      tags: function (r) { return tag(r.category || '운영') + (r.is_public ? '' : badge('비공개')); },
      fields: [
        { k: 'question',  label: '질문', wide: true, required: true },
        { k: 'answer',    label: '답변', type: 'textarea', wide: true },
        { k: 'category',  label: '분류' },
        { k: 'is_public', label: '공개', type: 'bool' }
      ]
    },

    staff_profiles: { label: '계정·권한', staff: true }
  };

  var ORDER = ['overview', 'settings', 'schedule_items', 'booths', 'notices',
               'operation_requests', 'resources', 'contacts', 'venue_places', 'faqs', 'staff_profiles'];
  var TABS = ['overview', 'schedule_items', 'booths', 'notices', 'operation_requests'];

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
  function paintNav() {
    function n(k) {
      var e = ENTITIES[k];
      if (!e || e.dashboard || e.single) return '';
      var len = k === 'staff_profiles' ? (staffRows || cache[k] || []).length : (cache[k] || []).length;
      return '<span class="nav__badge" style="background:var(--bg-sink);color:var(--muted)">' + len + '</span>';
    }
    $('#sidenav').innerHTML = ORDER.map(function (k) {
      return '<a href="#' + k + '" class="' + (k === current ? 'is-on' : '') + '"' +
        (k === current ? ' aria-current="page"' : '') + '>' + esc(ENTITIES[k].label) + n(k) + '</a>';
    }).join('');

    var short = { overview: '요약', schedule_items: '일정', booths: '부스', notices: '공지', operation_requests: '요청' };
    $('#tabbar').innerHTML = TABS.map(function (k) {
      return '<a href="#' + k + '" class="' + (k === current ? 'is-on' : '') + '">' +
        '<span class="tab__dot">' + esc(short[k].charAt(0)) + '</span><span>' + esc(short[k]) + '</span></a>';
    }).join('') + '<button type="button" data-open-sheet><span class="tab__dot">⋯</span><span>더보기</span></button>';

    $('#sheetnav').innerHTML = ORDER.filter(function (k) { return TABS.indexOf(k) < 0; }).map(function (k) {
      return '<a href="#' + k + '" class="' + (k === current ? 'is-on' : '') + '">' + esc(ENTITIES[k].label) + '</a>';
    }).join('');

    var me = C.me() || {};
    $('#side-who').innerHTML = esc(me.name || me.email || '') + '<br /><span class="badge badge--plain">관리자</span>';
    $('#topbar-title').textContent = ENTITIES[current].label;
    document.title = ENTITIES[current].label + ' · 관리자';
  }

  /* ── 대시보드 ───────────────────────────────────────────────── */
  function renderOverview() {
    var reqs = cache.operation_requests || [];
    var openN = reqs.filter(function (r) { return r.status !== '완료'; }).length;
    var urgent = (cache.notices || []).filter(function (x) { return x.level === '긴급'; }).length;
    var cards = [
      { n: (cache.schedule_items || []).length, l: '등록된 일정', go: 'schedule_items' },
      { n: (cache.booths || []).length, l: '등록된 부스', go: 'booths' },
      { n: (cache.notices || []).length, l: '공지', go: 'notices' },
      { n: urgent, l: '긴급 공지', go: 'notices' },
      { n: openN, l: '미처리 운영 요청', go: 'operation_requests' },
      { n: (cache.contacts || []).length, l: '연락망', go: 'contacts' },
      { n: (cache.resources || []).length, l: '자료실', go: 'resources' },
      { n: (staffRows || cache.staff_profiles || []).length, l: '관계자 계정', go: 'staff_profiles' }
    ];
    return '<div class="page"><div class="page__head"><div>' +
      '<h1 class="page__title">관리자 대시보드</h1>' +
      '<p class="page__desc">각 항목을 눌러 바로 편집할 수 있습니다.</p></div></div>' +
      '<div class="statgrid">' + cards.map(function (c) {
        return '<button class="adminstat" type="button" data-go="' + c.go + '">' +
          '<span class="adminstat__n">' + c.n + '</span>' +
          '<span class="adminstat__l">' + esc(c.l) + '</span></button>';
      }).join('') + '</div>' +
      '<div class="hint">데이터를 바꾸면 관계자 포털에 바로 반영됩니다. ' +
      '삭제는 되돌릴 수 없으니 확인 창을 잘 읽고 진행해 주세요.</div></div>';
  }

  /* ── 목록 ───────────────────────────────────────────────────── */
  function renderPanel() {
    var key = current, ent = ENTITIES[key], host = $('#view');

    if (ent.dashboard) { host.innerHTML = renderOverview(); paintNav(); return; }
    if (ent.staff) { renderStaff(); return; }

    var head = '<div class="page__head"><div><h1 class="page__title">' + esc(ent.label) + '</h1>' +
      '<p class="page__desc">' + esc(ent.desc) + '</p></div>' +
      (ent.single ? '' : '<div class="page__actions"><button class="btn btn--primary btn--sm" type="button" data-add>' +
        esc(ent.addLabel || '+ 새로 추가') + '</button></div>') + '</div>';

    if (ent.single) {
      var rows1 = cache[key] || [];
      if (!rows1.length) {
        host.innerHTML = '<div class="page">' + head +
          '<div class="state">행사 기본정보 줄을 찾지 못했습니다. settings 표에 id = 1 인 줄이 있는지 확인해 주세요.' +
          '<div class="state__act"><button class="btn btn--ghost btn--sm" type="button" data-retry>다시 시도</button></div>' +
          '</div></div>';
        paintNav(); return;
      }
      var s = rows1[0];
      host.innerHTML = '<div class="page">' + head +
        '<div class="list">' + ent.fields.filter(function (f) { return f.k in s; }).map(function (f) {
          var v = s[f.k];
          if (f.type === 'datetime') v = v ? fmtDay(v) : '';
          return '<div class="listrow"><div class="listrow__body">' +
            '<div class="listrow__meta">' + esc(f.label) + '</div>' +
            '<div class="listrow__title">' +
            (v === '' || v == null ? '<span style="color:var(--muted-2)">비어 있음</span>' : esc(v)) +
            '</div></div></div>';
        }).join('') + '</div>' +
        '<button class="btn btn--primary" type="button" data-edit-settings>행사 기본정보 수정</button></div>';
      paintNav(); return;
    }

    var rows = cache[key] || [];
    if (!rows.length) {
      host.innerHTML = '<div class="page">' + head +
        '<div class="state">아직 등록된 항목이 없습니다. 오른쪽 위 “' +
        esc(ent.addLabel || '새로 추가') + '”로 시작하세요.</div></div>';
      paintNav(); return;
    }

    host.innerHTML = '<div class="page">' + head + '<div class="list">' + rows.map(function (r, i) {
      return '<div class="listrow" data-id="' + esc(r.id) + '" data-i="' + i + '">' +
        '<span class="listrow__num">' + (i + 1) + '</span>' +
        '<div class="listrow__body">' +
          '<div class="listrow__title">' + esc(ent.title(r)) + '</div>' +
          '<div class="listrow__meta">' + esc(ent.meta ? ent.meta(r) : '') + '</div>' +
          (ent.tags ? '<div class="listrow__tags">' + ent.tags(r) + '</div>' : '') +
        '</div>' +
        '<div class="listrow__act">' +
          '<button class="iconbtn" type="button" data-act="up" aria-label="위로 이동" title="위로"' +
            (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button class="iconbtn" type="button" data-act="down" aria-label="아래로 이동" title="아래로"' +
            (i === rows.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button class="btn btn--ghost btn--sm" type="button" data-act="edit">수정</button>' +
          '<button class="btn btn--danger btn--sm" type="button" data-act="del">삭제</button>' +
        '</div></div>';
    }).join('') + '</div></div>';
    paintNav();
  }

  /* ── 편집 모달 ──────────────────────────────────────────────── */
  function fieldsFor(ent) {
    return ent.fields.map(function (f) {
      if (f.type !== 'zone') return f;
      return Object.assign({}, f, {
        type: 'select',
        options: zoneKeys.map(function (z) { return [z.key, z.key + '존 · ' + z.label]; })
      });
    });
  }

  function openEditor(key, row) {
    var ent = ENTITIES[key];
    if (!ent.fields) return;
    var isNew = !row;
    var values = Object.assign({}, ent.blank || {}, row || {});
    ent.fields.forEach(function (f) {
      if (f.type === 'datetime') values[f.k] = toLocalInput(values[f.k]);
    });

    UI.form({
      title: ent.label.replace(' 관리', '') + (isNew ? ' 추가' : ' 수정'),
      fields: fieldsFor(ent),
      values: values,
      submitLabel: isNew ? '추가' : '저장',
      validate: ent.validate
    }).then(function (v) {
      if (!v) return;
      ent.fields.forEach(function (f) {
        if (f.type === 'datetime') v[f.k] = fromLocalInput(v[f.k]);
      });
      if (ent.beforeSave) v = ent.beforeSave(v);

      if (isNew) {
        var rows = cache[key] || [];
        v.sort_order = rows.reduce(function (m, r) { return Math.max(m, r.sort_order || 0); }, 0) + 1;
        C.insert(ent.table, v).then(function (created) {
          cache[key].push(created);
          renderPanel();
          toast('추가했습니다.');
        }).catch(function (e) {
          console.error('[admin] 추가 실패', key, e);
          toast(C.dataMessage(e), true);
        });
      } else {
        C.update(ent.table, row.id, v).then(function (updated) {
          var i = -1;
          (cache[key] || []).forEach(function (x, idx) { if (x.id === row.id) i = idx; });
          if (i >= 0) cache[key][i] = updated;
          renderPanel();
          toast('저장했습니다.');
        }).catch(function (e) {
          console.error('[admin] 저장 실패', key, e);
          toast(C.dataMessage(e), true);
        });
      }
    });
  }

  function confirmDelete(key, row) {
    var ent = ENTITIES[key];
    UI.confirm({
      title: '삭제할까요?',
      message: '“' + ent.title(row) + '”을(를) 삭제합니다. 되돌릴 수 없습니다.',
      confirmLabel: '삭제', danger: true
    }).then(function (ok) {
      if (!ok) return;
      C.remove(ent.table, row.id).then(function () {
        cache[key] = cache[key].filter(function (x) { return x.id !== row.id; });
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
      C.update(table, a.id, { sort_order: bo }),
      C.update(table, b.id, { sort_order: ao })
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

  /* ── 계정·권한 ──────────────────────────────────────────────── */
  /* Edge Function 호출.
     supabase-js 는 2xx 가 아니면 data 를 비우고 'non-2xx status code'
     라는 일반 문구만 줍니다. 서버가 공들여 쓴 안내가 사라지므로,
     응답 본문(error.context)을 직접 읽어 실제 메시지를 꺼냅니다. */
  function fn(action, body) {
    return C.db().functions.invoke('invite-staff', {
      body: Object.assign({ action: action }, body || {})
    }).then(function (r) {
      if (!r.error) {
        if (r.data && r.data.error) throw new Error(r.data.error);
        return r.data;
      }

      var ctx = r.error.context;
      // 함수가 배포되지 않았거나 네트워크가 막힌 경우엔 응답 자체가 없습니다.
      if (!ctx || typeof ctx.json !== 'function') {
        var e0 = new Error(r.error.message || '요청을 보내지 못했습니다.');
        e0.__fn = true;
        throw e0;
      }
      return ctx.clone().json().then(function (payload) {
        var e = new Error((payload && payload.error) || r.error.message);
        e.__status = ctx.status;
        throw e;
      }, function () {
        var e = new Error(r.error.message || '요청을 처리하지 못했습니다.');
        e.__status = ctx.status;
        throw e;
      });
    });
  }

  function loadStaff() {
    // 한 번 미배포로 확인됐으면 매번 호출해 CORS 오류를 반복하지 않습니다.
    if (fnUnavailable) return Promise.resolve();
    return fn('list').then(function (d) {
      staffRows = d.rows || [];
      staffNote = null;
    }).catch(function (e) {
      // 함수를 아직 배포하지 않은 상태는 오류가 아니라 예정된 단계입니다.
      // 배포 전까지 매번 콘솔에 빨간 줄이 남지 않도록 안내로만 남깁니다.
      var notDeployed = /Failed to send a request|Failed to fetch|not found/i.test(e.message || '');
      if (notDeployed) {
        fnUnavailable = true;
        console.info('[admin] 관계자 초대 Edge Function 미배포 — 데이터베이스 목록으로 표시합니다.');
      } else {
        console.error('[admin] 계정 목록을 불러오지 못했습니다', e);
      }
      staffNote = notDeployed
        ? '관계자 초대 기능(Edge Function)이 아직 배포되지 않았습니다. README 의 ' +
          '“관계자 초대 기능 배포”를 참고해 주세요. 아래는 데이터베이스에 저장된 관계자 목록입니다.'
        : '계정 목록을 불러오지 못했습니다: ' + (e.message || '');
      staffRows = null;
    });
  }

  function renderStaff() {
    var rows = staffRows || cache.staff_profiles || [];
    var adminCount = rows.filter(function (r) { return r.role === 'admin'; }).length;

    var head = '<div class="page__head"><div><h1 class="page__title">계정·권한</h1>' +
      '<p class="page__desc">관계자를 초대하면 로그인 계정과 권한이 함께 만들어집니다.</p></div>' +
      '<div class="page__actions"><button class="btn btn--primary btn--sm" type="button" data-invite>+ 관계자 초대</button></div></div>';

    var body = rows.length ? '<div class="list">' + rows.map(function (r, i) {
      var isLastAdmin = r.role === 'admin' && adminCount <= 1;
      return '<div class="listrow" data-sid="' + esc(r.id) + '" data-i="' + i + '">' +
        '<span class="listrow__num">' + (i + 1) + '</span>' +
        '<div class="listrow__body">' +
          '<div class="listrow__title">' + esc(r.name || '(이름 없음)') + '</div>' +
          '<div class="listrow__meta">' + esc(r.email || '') +
          (r.team ? ' · ' + esc(r.team) : '') + (r.phone ? ' · ' + esc(r.phone) : '') + '</div>' +
          '<div class="listrow__tags">' + badge(r.role) +
          (r.status ? badge(r.status) : '') +
          (isLastAdmin ? tag('마지막 관리자 · 삭제·강등 불가') : '') + '</div>' +
        '</div>' +
        '<div class="listrow__act">' +
          '<button class="btn btn--ghost btn--sm" type="button" data-sact="edit">수정</button>' +
          (isLastAdmin
            ? '<button class="btn btn--danger btn--sm" type="button" disabled ' +
              'aria-disabled="true" title="마지막 관리자 계정은 삭제할 수 없습니다">삭제</button>'
            : '<button class="btn btn--danger btn--sm" type="button" data-sact="del">삭제</button>') +
        '</div></div>';
    }).join('') + '</div>' : '<div class="state">등록된 관계자가 없습니다.</div>';

    $('#view').innerHTML = '<div class="page">' + head +
      (staffNote ? '<div class="hint">' + esc(staffNote) + '</div>' : '') + body + '</div>';
    paintNav();
  }

  var STAFF_FIELDS = [
    { k: 'email', label: '이메일', type: 'email', wide: true, required: true },
    { k: 'name',  label: '이름', required: true },
    { k: 'team',  label: '소속/팀' },
    { k: 'phone', label: '연락처', type: 'tel' },
    { k: 'role',  label: '권한', type: 'select',
      options: [
        ['staff', 'staff · 열람 · 운영 요청 등록 · 부스 상태 변경'],
        ['admin', 'admin · 전체 편집 · 계정 관리']
      ] }
  ];

  function openInvite() {
    // 배포 전에 폼을 채우게 하고 마지막에 실패시키면 헛수고가 됩니다.
    // 먼저 상태를 알려 줍니다.
    if (fnUnavailable) {
      UI.confirm({
        title: "초대 기능을 먼저 배포해 주세요",
        message: "관계자 초대는 Supabase Edge Function 이 필요합니다. " +
                 "Supabase 대시보드 → Edge Functions → Deploy a new function 에서 " +
                 "이름을 invite-staff 로 만들고 supabase/functions/invite-staff/index.ts 내용을 " +
                 "붙여넣어 배포한 뒤 이 화면을 새로고침해 주세요. 별도 Secret 등록은 필요 없습니다.",
        confirmLabel: "알겠습니다"
      });
      return;
    }
    UI.form({
      title: '관계자 초대',
      desc: '이메일로 로그인 계정을 만들고 관계자 명단에 등록합니다. UUID 를 직접 넣을 필요가 없습니다.',
      fields: STAFF_FIELDS,
      values: { role: 'staff' },
      submitLabel: '초대'
    }).then(function (v) {
      if (!v) return;
      toast('초대하는 중입니다…');
      fn('invite', {
        email: v.email, name: v.name, team: v.team, phone: v.phone, role: v.role,
        redirectTo: location.origin + '/index.html'
      }).then(function (d) {
        return loadStaff().then(function () {
          renderStaff();
          if (d && d.tempPassword) {
            UI.confirm({
              title: '계정을 만들었습니다',
              message: '초대 메일을 보낼 수 없는 설정이라 임시 비밀번호를 발급했습니다.\n\n' +
                       v.email + '\n비밀번호: ' + d.tempPassword + '\n\n' +
                       '이 창을 닫으면 다시 볼 수 없습니다. 본인에게 직접 전달해 주세요.',
              confirmLabel: '확인했습니다'
            });
          } else {
            toast('초대 메일을 보냈습니다.');
          }
        });
      }).catch(function (e) {
        console.error('[admin] 초대 실패', e);
        toast(e.message || '초대하지 못했습니다.', true);
      });
    });
  }

  function openStaffEdit(row, isLastAdmin) {
    var fields = STAFF_FIELDS.map(function (f) {
      if (f.k !== 'role' || !isLastAdmin) return f;
      // 마지막 관리자는 staff 로 낮출 수 없으니 선택지에서 뺍니다.
      return Object.assign({}, f, {
        options: [['admin', 'admin · 전체 편집 · 계정 관리']],
        hint: '마지막 관리자라 권한을 낮출 수 없습니다'
      });
    });

    UI.form({
      title: '관계자 정보 수정',
      fields: fields,
      values: row,
      submitLabel: '저장'
    }).then(function (v) {
      if (!v) return;
      fn('update', { id: row.id, patch: v }).then(function () {
        return loadStaff().then(function () { renderStaff(); toast('저장했습니다.'); });
      }).catch(function (e) {
        console.error('[admin] 계정 수정 실패', e);
        toast(e.message || '저장하지 못했습니다.', true);
      });
    });
  }

  function confirmStaffDelete(row, isLastAdmin) {
    if (isLastAdmin) {
      UI.confirm({
        title: '삭제할 수 없습니다',
        message: '마지막 남은 관리자 계정입니다. 다른 관계자를 먼저 관리자로 올린 뒤 삭제해 주세요.',
        confirmLabel: '알겠습니다'
      });
      return;
    }
    UI.confirm({
      title: '관계자를 삭제할까요?',
      message: '“' + (row.name || row.email) + '”의 로그인 계정과 관계자 정보를 모두 지웁니다. 되돌릴 수 없습니다.',
      confirmLabel: '삭제', danger: true
    }).then(function (ok) {
      if (!ok) return;
      fn('remove', { id: row.id }).then(function () {
        return loadStaff().then(function () { renderStaff(); toast('삭제했습니다.'); });
      }).catch(function (e) {
        console.error('[admin] 계정 삭제 실패', e);
        toast(e.message || '삭제하지 못했습니다.', true);
      });
    });
  }

  /* ── 데이터 ─────────────────────────────────────────────────── */
  function loadAll() {
    $('#view').innerHTML = '<div class="state">데이터를 불러오는 중입니다.</div>';
    var keys = ORDER.filter(function (k) { return ENTITIES[k].table; });
    return Promise.all(keys.map(function (k) {
      var e = ENTITIES[k];
      return C.select(e.table, { order: e.order === false ? false : (e.order || [['sort_order', true]]) })
        .then(function (d) { cache[k] = d; });
    }).concat([
      C.select('zones').then(function (z) {
        zoneKeys = z.map(function (x) { return { key: x.key, label: x.label }; });
      }),
      C.select('staff_profiles', { order: [['role', true]] })
        .then(function (d) { cache.staff_profiles = d; }).catch(function () {}),
      loadStaff()
    ])).then(renderPanel).catch(function (e) {
      console.error('[admin] 로드 실패', e);
      $('#view').innerHTML = '<div class="state state--error">' + esc(C.dataMessage(e)) +
        '<div class="state__act"><button class="btn btn--ghost btn--sm" type="button" data-retry>다시 시도</button></div></div>';
    });
  }

  /* ── 라우팅·이벤트 ──────────────────────────────────────────── */
  function routeFromHash() {
    var id = (location.hash || '').replace(/^#/, '');
    return ENTITIES[id] ? id : 'overview';
  }
  function go() {
    current = routeFromHash();
    renderPanel();
    window.scrollTo({ top: 0, behavior: 'instant' });
    $('#sheet').hidden = true;
    document.body.style.overflow = '';
    $('#main').focus({ preventScroll: true });
  }

  function bind() {
    window.addEventListener('hashchange', go);
    $('#signout').addEventListener('click', function () {
      C.signOut().then(function () { location.href = 'index.html'; });
    });

    document.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('[data-open-sheet]')) { $('#sheet').hidden = false; document.body.style.overflow = 'hidden'; return; }
      if (t.closest('[data-close-sheet]')) { $('#sheet').hidden = true; document.body.style.overflow = ''; return; }
      if (t.closest('[data-retry]')) { loadAll(); return; }

      var g = t.closest('[data-go]');
      if (g) { location.hash = '#' + g.dataset.go; return; }

      if (t.closest('[data-add]')) { openEditor(current, null); return; }
      if (t.closest('[data-edit-settings]')) { openEditor('settings', (cache.settings || [])[0]); return; }
      if (t.closest('[data-invite]')) { openInvite(); return; }

      var sact = t.closest('[data-sact]');
      if (sact) {
        var srow = (staffRows || cache.staff_profiles || [])[Number(sact.closest('.listrow').dataset.i)];
        if (!srow) return;
        var rowsNow = staffRows || cache.staff_profiles || [];
        var adminN = rowsNow.filter(function (x) { return x.role === 'admin'; }).length;
        var lastAdmin = srow.role === 'admin' && adminN <= 1;
        if (sact.dataset.sact === 'edit') openStaffEdit(srow, lastAdmin);
        else confirmStaffDelete(srow, lastAdmin);
        return;
      }

      var act = t.closest('[data-act]');
      if (act) {
        var rowEl = act.closest('.listrow');
        var i = Number(rowEl.dataset.i);
        var row = (cache[current] || [])[i];
        if (!row) return;
        if (act.dataset.act === 'edit') openEditor(current, row);
        else if (act.dataset.act === 'del') confirmDelete(current, row);
        else if (act.dataset.act === 'up') move(current, i, -1);
        else if (act.dataset.act === 'down') move(current, i, 1);
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('#sheet').hidden) { $('#sheet').hidden = true; document.body.style.overflow = ''; }
    });
  }

  /* ── 시작 ───────────────────────────────────────────────────── */
  function gate(id) {
    ['gate-setup', 'gate-login', 'gate-denied'].forEach(function (g) { $('#' + g).hidden = g !== id; });
    $('#app').hidden = true;
  }

  if (!C.isConfigured()) { gate('gate-setup'); return; }

  bind();
  C.session().then(function (sess) {
    if (!sess) { gate('gate-login'); return; }
    return C.fetchProfile(sess.user.id).then(function (p) {
      if (!p) { gate('gate-login'); toast(C.accessMessage(), true); return; }
      if (p.role !== 'admin') { gate('gate-denied'); return; }
      ['gate-setup', 'gate-login', 'gate-denied'].forEach(function (g) { $('#' + g).hidden = true; });
      $('#app').hidden = false;
      current = routeFromHash();
      return loadAll();
    });
  }).catch(function (e) {
    console.error('[admin] 시작 실패', e);
    gate('gate-login');
  });
})();
