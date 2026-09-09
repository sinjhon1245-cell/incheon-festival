/* ===================================================================
   운영 콘텐츠 관리자 (CMS)

   화면은 아래 ENTITIES 정의에서 자동으로 만들어집니다.
   관리 항목을 늘리려면 표를 만들고 정의만 추가하면 됩니다.

   보안: 이 파일에는 아무 권한도 없습니다. 실제로 쓰기를 막는 것은
   데이터베이스의 RLS(is_admin) 이라, 주소를 알아내도 관리자 권한이
   없으면 아무것도 바꾸지 못합니다.
   =================================================================== */
(function () {
  'use strict';

  var C = window.Core;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = C.esc;

  var cache = {};
  var openRows = {};
  var current = 'overview';
  var zoneKeys = [];

  var SCHEDULE_CATS = ['무대', '강연', '부스', '운영', '행사 지원'];
  var SCHEDULE_STATES = ['예정', '진행 중', '종료', '취소', '변경'];
  var BOOTH_STATES = ['준비 전', '준비 완료', '운영 중', '일시 중단', '운영 종료'];
  var REQ_KINDS = ['전기', '네트워크', '기자재', '시설', '안전', '물품', '주차', '기타'];
  var REQ_PRIORITY = ['긴급', '높음', '보통'];
  var REQ_STATES = ['접수', '확인 중', '처리 중', '완료'];
  var NOTICE_LEVELS = ['긴급', '중요', '일반'];

  function opts(list) { return list.map(function (v) { return [v, v]; }); }

  /* ── 관리 항목 정의 ─────────────────────────────────────────── */
  var ENTITIES = {
    overview: { label: '대시보드', dashboard: true },

    settings: {
      label: '행사 기본정보', table: 'settings', single: true,
      desc: '포털 곳곳에 함께 반영됩니다. D-day 와 진행 상태는 개막·종료 일시로 계산합니다.',
      fields: [
        { k: 'event_title',   label: '행사 이름', wide: true },
        { k: 'event_start',   label: '개막 일시', type: 'datetime' },
        { k: 'event_end',     label: '종료 일시', type: 'datetime' },
        { k: 'date_label',    label: '날짜 표기', hint: '예: 2026. 10. 17.(토)' },
        { k: 'time_label',    label: '운영시간 표기', hint: '예: 10:00 – 17:00' },
        { k: 'venue',         label: '장소' },
        { k: 'venue_detail',  label: '장소 상세' },
        { k: 'venue_address', label: '주소', wide: true },
        { k: 'venue_map_url', label: '배치도 이미지 주소', wide: true, hint: '비우면 “배치도 준비 중”으로 표시됩니다' },
        { k: 'contact_phone', label: '대표 전화' },
        { k: 'contact_email', label: '대표 메일' },
        { k: 'portal_note',   label: '포털 안내 문구', type: 'textarea', wide: true }
      ]
    },

    schedule_items: {
      label: '일정 관리', table: 'schedule_items',
      desc: '시작·종료 시각은 24시간 형식(예: 10:30)으로 적어야 현재 일정 자동 강조가 동작합니다.',
      title: function (r) { return (r.start_time || '--:--') + '  ' + r.title; },
      blank: { title: '새 일정', start_time: '10:00', end_time: '10:30', category: '운영', status: '예정', place: '' },
      fields: [
        { k: 'start_time', label: '시작 시각', hint: 'HH:MM' },
        { k: 'end_time',   label: '종료 시각', hint: 'HH:MM' },
        { k: 'title',      label: '일정 제목', wide: true },
        { k: 'place',      label: '장소' },
        { k: 'category',   label: '분류', type: 'select', options: opts(SCHEDULE_CATS) },
        { k: 'team',       label: '담당팀' },
        { k: 'owner',      label: '담당자' },
        { k: 'status',     label: '상태', type: 'select', options: opts(SCHEDULE_STATES) },
        { k: 'memo',       label: '운영 메모', type: 'textarea', wide: true }
      ]
    },

    booths: {
      label: '부스 관리', table: 'booths',
      desc: '부스 번호와 구역으로 표시용 코드(A-01)를 만듭니다.',
      title: function (r) { return (r.code || (r.zone_key + '-' + r.no)) + '  ' + r.name; },
      blank: { no: 1, zone_key: 'A', name: '새 부스', org: '', status: '준비 전', code: '' },
      fields: [
        { k: 'code',          label: '표시 코드', hint: '예: A-01' },
        { k: 'no',            label: '부스 번호', type: 'number' },
        { k: 'zone_key',      label: '구역', type: 'zone' },
        { k: 'status',        label: '운영 상태', type: 'select', options: opts(BOOTH_STATES) },
        { k: 'name',          label: '부스명', wide: true },
        { k: 'org',           label: '운영기관', wide: true },
        { k: 'program',       label: '운영 프로그램', wide: true },
        { k: 'hours',         label: '운영 시간' },
        { k: 'manager',       label: '담당자' },
        { k: 'manager_phone', label: '담당자 연락처' },
        { k: 'needs_power',   label: '전기 사용 필요', type: 'bool' },
        { k: 'needs_network', label: '네트워크 필요', type: 'bool' },
        { k: 'supplies',      label: '필요 물품', wide: true },
        { k: 'memo',          label: '운영 메모', type: 'textarea', wide: true },
        { k: 'notes',         label: '특이사항', type: 'textarea', wide: true }
      ]
    },

    notices: {
      label: '공지 관리', table: 'notices',
      desc: '긴급 공지는 포털 대시보드 최상단에 자동으로 올라갑니다.',
      order: [['pinned', false], ['created_at', false]],
      title: function (r) { return '[' + r.level + '] ' + r.title; },
      blank: { level: '일반', title: '새 공지', body: '', pinned: false, author: '' },
      fields: [
        { k: 'level',  label: '등급', type: 'select', options: opts(NOTICE_LEVELS) },
        { k: 'pinned', label: '상단 고정', type: 'bool' },
        { k: 'title',  label: '제목', wide: true },
        { k: 'body',   label: '내용', type: 'textarea', wide: true },
        { k: 'author', label: '작성자 또는 담당부서' }
      ]
    },

    operation_requests: {
      label: '운영 요청 관리', table: 'operation_requests',
      desc: '현장에서 등록한 문제 보고입니다. 처리 상태를 여기서 바꿉니다.',
      order: [['created_at', false]],
      title: function (r) { return '[' + r.status + '] ' + r.location + ' · ' + r.title; },
      blank: { location: '', kind: '기타', priority: '보통', title: '새 요청', status: '접수' },
      fields: [
        { k: 'status',        label: '처리 상태', type: 'select', options: opts(REQ_STATES) },
        { k: 'priority',      label: '우선순위', type: 'select', options: opts(REQ_PRIORITY) },
        { k: 'kind',          label: '유형', type: 'select', options: opts(REQ_KINDS) },
        { k: 'assignee_team', label: '담당팀' },
        { k: 'location',      label: '부스 또는 위치', wide: true },
        { k: 'title',         label: '제목', wide: true },
        { k: 'body',          label: '내용', type: 'textarea', wide: true },
        { k: 'reporter',      label: '등록자' }
      ]
    },

    resources: {
      label: '자료실 관리', table: 'resources',
      desc: '파일은 외부 저장소에 올리고 주소만 등록하는 방식입니다.',
      title: function (r) { return r.title; },
      blank: { title: '새 자료', category: '기타', url: '', is_public: true },
      fields: [
        { k: 'title',       label: '자료명', wide: true },
        { k: 'category',    label: '분류', hint: '예: 운영계획 · 안전 · 배치도' },
        { k: 'is_public',   label: '관계자에게 공개', type: 'bool' },
        { k: 'url',         label: '자료 주소(URL)', wide: true },
        { k: 'description', label: '설명', type: 'textarea', wide: true }
      ]
    },

    contacts: {
      label: '연락망 관리', table: 'contacts',
      desc: '전화번호는 로그인한 관계자에게만 보입니다.',
      title: function (r) { return r.name + (r.duty ? ' · ' + r.duty : ''); },
      blank: { name: '새 담당자', category: '기타', phone: '' },
      fields: [
        { k: 'name',     label: '이름' },
        { k: 'category', label: '구분', hint: '예: 운영 총괄 · 시설 · 안전' },
        { k: 'org',      label: '소속' },
        { k: 'duty',     label: '담당업무' },
        { k: 'phone',    label: '전화번호' },
        { k: 'memo',     label: '메모', type: 'textarea', wide: true }
      ]
    },

    venue_places: {
      label: '행사장 관리', table: 'venue_places',
      desc: '운영본부·보건·주차 등 관계자가 찾는 공간을 등록합니다.',
      title: function (r) { return r.name; },
      blank: { name: '새 공간', category: '기타', detail: '' },
      fields: [
        { k: 'name',     label: '공간 이름' },
        { k: 'category', label: '분류', hint: '예: 운영 · 안전 · 편의' },
        { k: 'detail',   label: '위치 설명', type: 'textarea', wide: true }
      ]
    },

    faqs: {
      label: 'FAQ 관리', table: 'faqs',
      desc: '관계자가 자주 묻는 운영 질문입니다.',
      title: function (r) { return r.question; },
      blank: { question: '새 질문', answer: '', category: '운영', is_public: true },
      fields: [
        { k: 'question',  label: '질문', wide: true },
        { k: 'answer',    label: '답변', type: 'textarea', wide: true },
        { k: 'category',  label: '분류' },
        { k: 'is_public', label: '공개', type: 'bool' }
      ]
    },

    staff_profiles: {
      label: '계정·권한', table: 'staff_profiles',
      desc: '계정 자체는 Supabase 대시보드에서 만들고, 여기에서 권한과 소속을 정합니다.',
      note: '새 관계자를 추가하려면 Supabase → Authentication → Users 에서 계정을 만든 뒤, ' +
            '그 사용자의 UUID 를 아래 “사용자 UUID” 칸에 넣어 추가하세요. ' +
            '이 표에 줄이 없는 계정은 로그인해도 아무 데이터를 볼 수 없습니다.',
      title: function (r) { return (r.name || r.email || '(이름 없음)') + ' · ' + r.role; },
      blank: { id: '', email: '', name: '새 관계자', team: '', role: 'staff' },
      fields: [
        { k: 'id',    label: '사용자 UUID', wide: true, hint: 'Supabase Authentication → Users 에서 복사' },
        { k: 'name',  label: '이름' },
        { k: 'email', label: '이메일' },
        { k: 'team',  label: '소속팀' },
        { k: 'phone', label: '연락처' },
        { k: 'role',  label: '권한', type: 'select', options: [['staff', 'staff · 열람과 요청 등록'], ['admin', 'admin · 전체 편집']] }
      ]
    }
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
    toastTimer = setTimeout(function () { el.hidden = true; }, isError ? 5200 : 2400);
  }

  /* ── 날짜 입력 변환 ─────────────────────────────────────────── */
  function toLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  function fromLocalInput(v) {
    if (!v) return null;
    var d = new Date(v);
    return isNaN(d) ? null : d.toISOString();
  }

  /* ── 입력칸 ─────────────────────────────────────────────────── */
  function fieldHtml(f, value) {
    var id = 'f_' + f.k + '_' + Math.random().toString(36).slice(2, 7);
    var wide = f.wide || f.type === 'textarea';
    var label = '<span class="field__label">' + esc(f.label) +
      (f.hint ? ' <span style="font-weight:500;opacity:.75">· ' + esc(f.hint) + '</span>' : '') + '</span>';

    if (f.type === 'bool') {
      return '<div class="field' + (wide ? ' field--wide' : '') + '">' +
        '<label class="check"><input type="checkbox" data-k="' + f.k + '"' + (value ? ' checked' : '') + ' /> ' +
        esc(f.label) + '</label></div>';
    }

    var body;
    if (f.type === 'textarea') {
      body = '<textarea class="textarea" id="' + id + '" data-k="' + f.k + '" rows="3">' + esc(value) + '</textarea>';
    } else if (f.type === 'select' || f.type === 'zone') {
      var list = f.type === 'zone'
        ? zoneKeys.map(function (z) { return [z.key, z.key + '존 · ' + z.label]; })
        : f.options;
      body = '<select class="select" id="' + id + '" data-k="' + f.k + '">' + list.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (String(value) === String(o[0]) ? ' selected' : '') + '>' +
          esc(o[1]) + '</option>';
      }).join('') + '</select>';
    } else if (f.type === 'number') {
      body = '<input class="input" type="number" id="' + id + '" data-k="' + f.k + '" value="' + esc(value) + '" />';
    } else if (f.type === 'datetime') {
      body = '<input class="input" type="datetime-local" id="' + id + '" data-k="' + f.k + '" data-dt="1" value="' +
        esc(toLocalInput(value)) + '" />';
    } else {
      body = '<input class="input" type="text" id="' + id + '" data-k="' + f.k + '" value="' + esc(value) + '" />';
    }
    return '<div class="field' + (wide ? ' field--wide' : '') + '"><label for="' + id + '">' + label + '</label>' + body + '</div>';
  }

  function readRow(rowEl) {
    var out = {};
    $$('[data-k]', rowEl).forEach(function (el) {
      var k = el.dataset.k;
      if (el.type === 'checkbox') out[k] = el.checked;
      else if (el.dataset.dt) out[k] = fromLocalInput(el.value);
      else if (el.type === 'number') out[k] = el.value === '' ? null : Number(el.value);
      else out[k] = el.value;
    });
    return out;
  }

  /* ── 내비 ───────────────────────────────────────────────────── */
  function paintNav() {
    function count(k) {
      var e = ENTITIES[k];
      if (!e || e.dashboard || e.single) return '';
      var n = (cache[k] || []).length;
      return '<span class="nav__badge" style="background:var(--bg-sink);color:var(--muted)">' + n + '</span>';
    }
    $('#sidenav').innerHTML = ORDER.map(function (k) {
      return '<a href="#' + k + '" class="' + (k === current ? 'is-on' : '') + '"' +
        (k === current ? ' aria-current="page"' : '') + '>' + esc(ENTITIES[k].label) + count(k) + '</a>';
    }).join('');

    $('#tabbar').innerHTML = TABS.map(function (k) {
      var short = { overview: '요약', schedule_items: '일정', booths: '부스',
                    notices: '공지', operation_requests: '요청' }[k];
      return '<a href="#' + k + '" class="' + (k === current ? 'is-on' : '') + '">' +
        '<span class="tab__dot">' + esc(short.charAt(0)) + '</span><span>' + esc(short) + '</span></a>';
    }).join('') + '<button type="button" data-open-sheet><span class="tab__dot">⋯</span><span>더보기</span></button>';

    $('#sheetnav').innerHTML = ORDER.filter(function (k) { return TABS.indexOf(k) < 0; }).map(function (k) {
      return '<a href="#' + k + '" class="' + (k === current ? 'is-on' : '') + '">' + esc(ENTITIES[k].label) + '</a>';
    }).join('');

    var me = C.me() || {};
    $('#side-who').innerHTML = esc(me.name || me.email || '') +
      '<br /><span class="badge badge--plain">관리자</span>';
    $('#topbar-title').textContent = ENTITIES[current].label;
    document.title = ENTITIES[current].label + ' · 관리자';
  }

  /* ── 대시보드 ───────────────────────────────────────────────── */
  function renderOverview() {
    var reqs = cache.operation_requests || [];
    var open = reqs.filter(function (r) { return r.status !== '완료'; }).length;
    var urgent = (cache.notices || []).filter(function (n) { return n.level === '긴급'; }).length;
    var cards = [
      { n: (cache.schedule_items || []).length, l: '등록된 일정', go: 'schedule_items' },
      { n: (cache.booths || []).length, l: '등록된 부스', go: 'booths' },
      { n: (cache.notices || []).length, l: '공지', go: 'notices' },
      { n: urgent, l: '긴급 공지', go: 'notices' },
      { n: open, l: '미처리 운영 요청', go: 'operation_requests' },
      { n: (cache.contacts || []).length, l: '연락망', go: 'contacts' },
      { n: (cache.resources || []).length, l: '자료실', go: 'resources' },
      { n: (cache.staff_profiles || []).length, l: '관계자 계정', go: 'staff_profiles' }
    ];
    return '<div class="page">' +
      '<div class="page__head"><div><h1 class="page__title">관리자 대시보드</h1>' +
      '<p class="page__desc">각 항목을 눌러 바로 편집할 수 있습니다.</p></div></div>' +
      '<div class="statgrid">' + cards.map(function (c) {
        return '<button class="adminstat" type="button" data-go="' + c.go + '">' +
          '<span class="adminstat__n">' + c.n + '</span>' +
          '<span class="adminstat__l">' + esc(c.l) + '</span></button>';
      }).join('') + '</div>' +
      '<div class="hint">데이터를 바꾸면 관계자 포털에 바로 반영됩니다. ' +
      '삭제는 되돌릴 수 없으니 확인 창을 잘 읽고 진행해 주세요.</div></div>';
  }

  /* ── 목록·편집 ──────────────────────────────────────────────── */
  function renderPanel() {
    var key = current;
    var ent = ENTITIES[key];
    var host = $('#view');

    if (ent.dashboard) { host.innerHTML = renderOverview(); paintNav(); return; }

    var head = '<div class="page__head"><div><h1 class="page__title">' + esc(ent.label) + '</h1>' +
      '<p class="page__desc">' + esc(ent.desc) + '</p></div>' +
      (ent.single ? '' : '<div class="page__actions"><button class="btn btn--primary btn--sm" type="button" id="addbtn">+ 새로 추가</button></div>') +
      '</div>';

    var note = ent.note ? '<div class="hint">' + esc(ent.note) + '</div>' : '';

    if (ent.single) {
      var s = (cache[key] || [])[0] || {};
      var present = ent.fields.filter(function (f) { return f.k in s; });
      var missing = ent.fields.filter(function (f) { return !(f.k in s); });
      host.innerHTML = '<div class="page">' + head + note +
        (missing.length ? '<div class="hint">아직 데이터베이스에 없는 항목 ' + missing.length + '개 — ' +
          missing.map(function (f) { return esc(f.label); }).join(', ') +
          '. <code>supabase/migration-portal.sql</code> 을 실행하면 나타납니다.</div>' : '') +
        '<div class="rows"><div class="row is-open" data-single="1" data-id="' + esc(s.id) + '">' +
        '<div class="row__body">' + present.map(function (f) { return fieldHtml(f, s[f.k]); }).join('') + '</div>' +
        '<div class="row__foot"><button class="btn btn--primary btn--sm" type="button" data-act="save">저장</button>' +
        '<span class="row__flag" data-flag hidden>저장 안 됨</span></div></div></div></div>';
      wireRows(key);
      paintNav();
      return;
    }

    var rows = cache[key] || [];
    if (!rows.length) {
      host.innerHTML = '<div class="page">' + head + note +
        '<div class="state">아직 등록된 항목이 없습니다. 오른쪽 위 “새로 추가”로 시작하세요.</div></div>';
      $('#addbtn').addEventListener('click', function () { addRow(key); });
      paintNav();
      return;
    }

    host.innerHTML = '<div class="page">' + head + note + '<div class="rows">' + rows.map(function (r, i) {
      var open = openRows[key] === r.id;
      return '<div class="row' + (open ? ' is-open' : '') + '" data-id="' + esc(r.id) + '" data-i="' + i + '">' +
        '<div class="row__head">' +
        '<button class="row__toggle" type="button" data-act="toggle" aria-expanded="' + open + '">' +
        '<span class="row__num">' + (i + 1) + '</span>' +
        '<span class="row__title">' + esc(ent.title(r)) + '</span>' +
        '<span class="row__chev" aria-hidden="true">›</span></button>' +
        '<span class="row__flag" data-flag hidden>저장 안 됨</span>' +
        '<span class="row__tools">' +
        '<button class="iconbtn" type="button" data-act="up" title="위로" aria-label="위로 이동"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button class="iconbtn" type="button" data-act="down" title="아래로" aria-label="아래로 이동"' + (i === rows.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '</span></div>' +
        '<div class="row__body">' + ent.fields.map(function (f) { return fieldHtml(f, r[f.k]); }).join('') + '</div>' +
        '<div class="row__foot"><button class="btn btn--primary btn--sm" type="button" data-act="save">저장</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn btn--danger btn--sm" type="button" data-act="del">삭제</button></div>' +
        '</div>';
    }).join('') + '</div></div>';

    $('#addbtn').addEventListener('click', function () { addRow(key); });
    wireRows(key);
    paintNav();
  }

  function wireRows(key) {
    $$('.row').forEach(function (rowEl) {
      rowEl.addEventListener('input', function () {
        rowEl.classList.add('is-dirty');
        var f = $('[data-flag]', rowEl);
        if (f) f.hidden = false;
      });
      rowEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-act]');
        if (!btn) return;
        var act = btn.dataset.act;
        if (act === 'toggle') {
          if (rowEl.classList.contains('is-open') && rowEl.classList.contains('is-dirty')) {
            toast('저장하지 않은 변경이 있습니다. 저장하거나 새로고침하세요.', true);
            return;
          }
          openRows[key] = rowEl.classList.contains('is-open') ? null : rowEl.dataset.id;
          renderPanel();
          return;
        }
        if (act === 'save') saveRow(key, rowEl, btn);
        else if (act === 'del') deleteRow(key, rowEl);
        else if (act === 'up') move(key, Number(rowEl.dataset.i), -1);
        else if (act === 'down') move(key, Number(rowEl.dataset.i), 1);
      });
    });
  }

  /* ── 데이터 ─────────────────────────────────────────────────── */
  function loadAll() {
    $('#view').innerHTML = '<div class="state">데이터를 불러오는 중입니다.</div>';
    var keys = ORDER.filter(function (k) { return !ENTITIES[k].dashboard; });
    return Promise.all(keys.map(function (k) {
      var e = ENTITIES[k];
      return C.select(e.table, { order: e.order || [['sort_order', true]] })
        .then(function (d) { cache[k] = d; });
    }).concat([
      C.select('zones').then(function (z) {
        zoneKeys = z.map(function (x) { return { key: x.key, label: x.label }; });
      })
    ])).then(function () {
      renderPanel();
    }).catch(function (e) {
      $('#view').innerHTML = '<div class="state state--error">' + esc(C.dataMessage(e)) +
        '<div class="state__act"><button class="btn btn--ghost btn--sm" type="button" data-retry>다시 시도</button></div></div>';
      console.error('[admin] 로드 실패', e);
    });
  }

  function saveRow(key, rowEl, btn) {
    var ent = ENTITIES[key];
    var patch = readRow(rowEl);
    btn.disabled = true;

    C.update(ent.table, rowEl.dataset.id, patch).then(function (row) {
      if (ent.single) cache[key] = [row];
      else cache[key][Number(rowEl.dataset.i)] = row;
      rowEl.classList.remove('is-dirty');
      var f = $('[data-flag]', rowEl);
      if (f) f.hidden = true;
      var t = $('.row__title', rowEl);
      if (t && !ent.single) t.textContent = ent.title(row);
      if (key === 'zones') zoneKeys = cache.zones.map(function (z) { return { key: z.key, label: z.label }; });
      toast('저장했습니다.');
    }).catch(function (e) {
      toast(C.dataMessage(e), true);
      console.error('[admin] 저장 실패', e);
    }).then(function () { btn.disabled = false; });
  }

  function addRow(key) {
    var ent = ENTITIES[key];
    var rows = cache[key] || [];
    var next = Object.assign({}, ent.blank, {
      sort_order: rows.reduce(function (m, r) { return Math.max(m, r.sort_order || 0); }, 0) + 1
    });
    if (key === 'booths' && zoneKeys.length) next.zone_key = zoneKeys[0].key;
    if (key === 'staff_profiles') {
      var uuid = window.prompt('추가할 계정의 사용자 UUID 를 붙여넣으세요.\n(Supabase → Authentication → Users 에서 복사)');
      if (!uuid || !uuid.trim()) return;
      next.id = uuid.trim();
      delete next.sort_order;
    }

    C.insert(ent.table, next).then(function (row) {
      cache[key].push(row);
      openRows[key] = row.id;
      renderPanel();
      var el = $('.row.is-open .input, .row.is-open .textarea');
      if (el) el.focus();
      toast('추가했습니다. 내용을 채우고 저장하세요.');
    }).catch(function (e) {
      toast(C.dataMessage(e), true);
      console.error('[admin] 추가 실패', e);
    });
  }

  function deleteRow(key, rowEl) {
    var ent = ENTITIES[key];
    var i = Number(rowEl.dataset.i);
    var label = ent.title(cache[key][i]);
    if (!window.confirm('“' + label + '”을(를) 삭제할까요?\n되돌릴 수 없습니다.')) return;

    C.remove(ent.table, rowEl.dataset.id).then(function () {
      cache[key].splice(i, 1);
      if (openRows[key] === rowEl.dataset.id) openRows[key] = null;
      renderPanel();
      toast('삭제했습니다.');
    }).catch(function (e) {
      toast(C.dataMessage(e), true);
      console.error('[admin] 삭제 실패', e);
    });
  }

  function move(key, i, dir) {
    var rows = cache[key];
    var j = i + dir;
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
    }).catch(function (e) {
      toast(C.dataMessage(e), true);
      console.error('[admin] 순서 변경 실패', e);
    });
  }

  /* ── 라우팅·이벤트 ──────────────────────────────────────────── */
  function routeFromHash() {
    var id = (location.hash || '').replace(/^#/, '');
    return ENTITIES[id] ? id : 'overview';
  }

  function go() {
    if ($('.row.is-dirty') &&
        !window.confirm('저장하지 않은 변경이 있습니다.\n이동하면 사라집니다. 계속할까요?')) return;
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
      if (e.target.closest('[data-open-sheet]')) {
        $('#sheet').hidden = false; document.body.style.overflow = 'hidden'; return;
      }
      if (e.target.closest('[data-close-sheet]')) {
        $('#sheet').hidden = true; document.body.style.overflow = ''; return;
      }
      if (e.target.closest('[data-retry]')) { loadAll(); return; }
      var g = e.target.closest('[data-go]');
      if (g) { location.hash = '#' + g.dataset.go; return; }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('#sheet').hidden) {
        $('#sheet').hidden = true; document.body.style.overflow = '';
      }
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
