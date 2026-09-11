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

  var SCHEDULE_CATS = ['무대', '강연', '부스', '운영', '행사 지원'];
  var SCHEDULE_STATES = ['예정', '진행 중', '종료', '취소', '변경'];
  var BOOTH_STATES = ['준비 전', '준비 완료', '운영 중', '일시 중단', '운영 종료'];
  var REQ_KINDS = ['전기', '네트워크', '기자재', '시설', '안전', '물품', '주차', '기타'];
  var REQ_PRIORITY = ['긴급', '높음', '보통'];
  var REQ_STATES = ['접수', '확인 중', '처리 중', '완료'];
  var NOTICE_LEVELS = ['긴급', '중요', '일반'];
  var FAQ_CATS = ['부스 운영', '시설·장소', '안전', '물품·지원', '기타'];
  var SUPPLY_KINDS  = ['기관', '팀', '부스'];
  var SUPPLY_STATES = ['미배부', '일부 배부', '배부 완료'];
  // 역할 구분은 DB 에서 값을 제한하지 않습니다. 현장에서 쓰는 말이
  // 해마다 달라서, 여기서는 추천값으로만 보여 줍니다.
  var ROLE_GROUPS = ['총괄', '운영본부', '부스 지원', '안전', '안내', '행사 지원', '기타'];

  function opts(l) { return l.map(function (v) { return [v, v]; }); }

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
    '운영 인력': 'info'
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
      desc: '행사명과 일정, 장소, 안내도 등 포털 전반에 쓰이는 기본 정보를 관리합니다. ' +
            'D-day 와 진행 상태는 개막·종료 일시로 계산합니다.',
      fields: [
        { k: 'event_title',   label: '행사 이름', wide: true, required: true },
        { k: 'event_start',   label: '개막 일시', type: 'datetime' },
        { k: 'event_end',     label: '종료 일시', type: 'datetime' },
        { k: 'date_label',    label: '날짜 표기', hint: '예: 2026. 10. 17.(토)' },
        { k: 'time_label',    label: '운영시간 표기', hint: '예: 10:00 – 17:00' },
        { k: 'venue',         label: '장소' },
        { k: 'venue_detail',  label: '장소 상세' },
        { k: 'venue_address', label: '주소', wide: true },
        { k: 'contact_phone', label: '대표 전화' },
        { k: 'contact_email', label: '대표 메일' },
        { k: 'portal_note',   label: '포털 안내 문구', type: 'textarea', wide: true },
        { k: 'ops_guide',     label: '대시보드 운영 안내', type: 'textarea', wide: true,
          hint: '행사 당일 먼저 확인할 내용. 줄바꿈은 포털에서도 그대로 보입니다' },

        /* 안내도 두 장. 올리면 포털의 행사장·부스 화면 맨 위에
           바로 나타나고, 비우면 준비 중 안내로 돌아갑니다. */
        { k: 'venue_map_url',     label: '행사장 전체 안내도', type: 'image', folder: 'venue',
          hint: '가로형 이미지를 권합니다' },
        { k: 'venue_map_alt',     label: '행사장 안내도 설명', wide: true,
          hint: '화면을 읽어 주는 도구가 대신 읽습니다' },
        { k: 'venue_map_caption', label: '행사장 안내도 캡션', wide: true },
        { k: 'booth_map_url',     label: '전체 부스 배치도', type: 'image', folder: 'booth-map',
          hint: '가로형 이미지를 권합니다' },
        { k: 'booth_map_alt',     label: '부스 배치도 설명', wide: true },
        { k: 'booth_map_caption', label: '부스 배치도 캡션', wide: true }
      ]
    },

    schedule_items: {
      label: '일정 관리', table: 'schedule_items', addLabel: '+ 일정 추가',
      desc: '관계자 포털에 표시되는 행사 일정을 관리합니다. ' +
            '시작·종료 시각으로 포털의 “지금 진행 중”이 자동 계산됩니다.',
      blank: { start_time: '10:00', end_time: '10:30', title: '', category: '운영', status: '예정' },
      title: function (r) { return r.title || '(제목 없음)'; },
      meta: function (r) {
        return (r.start_time || '--:--') + '–' + (r.end_time || '--:--') +
          (r.place ? ' · ' + r.place : '') + (r.team ? ' · ' + r.team : '') + (r.owner ? ' · ' + r.owner : '');
      },
      tags: function (r) { return badge(r.status || '예정') + tag(r.category || '운영') +
        (r.is_highlight ? tag('핵심') : ''); },
      fields: [
        { k: 'start_time', label: '시작시간', type: 'time', required: true },
        { k: 'end_time',   label: '종료시간', type: 'time', required: true },
        { k: 'title',      label: '일정명', wide: true, required: true },
        { k: 'category',   label: '구분', type: 'select', options: opts(SCHEDULE_CATS) },
        { k: 'place',      label: '장소' },
        { k: 'team',       label: '담당팀' },
        { k: 'owner',      label: '담당자' },
        { k: 'status',     label: '상태', type: 'select', options: opts(SCHEDULE_STATES) },
        { k: 'is_highlight', label: '핵심 일정 (대시보드 하이라이트에 표시)', type: 'bool' },
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
      desc: '부스 정보와 운영 상태, 대표 이미지를 관리합니다. ' +
            '전체 배치도는 행사 기본정보에서 등록합니다.',
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
        { k: 'notes',         label: '특이사항', type: 'textarea', wide: true },
        { k: 'image_url',     label: '부스 대표 이미지', type: 'image', folder: 'booth' },
        { k: 'image_alt',     label: '이미지 설명', wide: true },
        { k: 'image_caption', label: '이미지 캡션', wide: true }
      ],
      beforeSave: function (v) {
        if (!v.code) v.code = v.zone_key + '-' + String(v.no).padStart(2, '0');
        return v;
      }
    },

    notices: {
      label: '공지 관리', table: 'notices', addLabel: '+ 공지 작성',
      order: [['pinned', false], ['created_at', false]],
      desc: '행사 관계자에게 전달할 주요 운영 안내를 관리합니다. ' +
            '긴급 공지는 포털 대시보드 최상단에 자동으로 올라갑니다.',
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
      desc: '현장에서 접수된 요청을 확인하고 처리 상태를 관리합니다.',
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
      desc: '운영 매뉴얼과 안내 자료를 등록합니다. ' +
            '파일은 외부 저장소에 올리고 주소만 등록하는 방식입니다.',
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

    contacts: {
      label: '연락망 관리', table: 'contacts', addLabel: '+ 연락처 추가',
      desc: '행사 운영 담당자와 지원 연락처를 관리합니다.',
      blank: { name: '', category: '기타', phone: '' },
      title: function (r) { return r.name || '(이름 없음)'; },
      meta: function (r) { return (r.org || '') + (r.phone ? ' · ' + r.phone : ''); },
      tags: function (r) { return tag(r.category || '기타') + (r.duty ? tag(r.duty) : '') +
        (r.is_staff ? badge('운영 인력') : ''); },
      fields: [
        { k: 'name',     label: '이름', required: true },
        { k: 'category', label: '구분', hint: '예: 운영본부 · 시설지원 · 전산지원 · 안전지원' },
        { k: 'org',      label: '소속' },
        { k: 'duty',     label: '담당업무' },
        { k: 'phone',    label: '전화번호', type: 'tel' },
        // 이 두 칸이 담당 업무 화면의 '운영 인력' 집계를 만듭니다.
        // 연락망과 명부를 따로 두지 않으려고 여기에 함께 둡니다.
        { k: 'is_staff',   label: '운영 인력 (담당 업무 화면에서 집계)', type: 'bool' },
        { k: 'role_group', label: '역할 구분', type: 'select',
          options: [['', '(없음)']].concat(opts(ROLE_GROUPS)) },
        { k: 'memo',     label: '메모', type: 'textarea', wide: true }
      ]
    },

    venue_places: {
      label: '행사장 관리', table: 'venue_places', addLabel: '+ 공간 추가',
      desc: '운영본부와 주요 공간의 위치·설명·이미지를 관리합니다.',
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
       아래 다섯은 migration-operations.sql 을 실행해야 나타납니다.
       표가 없으면 목록이 비어 있을 뿐 관리자 화면은 그대로 열립니다. */

    operation_tasks: {
      label: '담당 업무', table: 'operation_tasks', addLabel: '+ 업무 추가', soft: true,
      desc: '행사 당일 업무를 등록합니다. 담당자는 “담당자 배정”에서 연결하며, ' +
            '한 업무에 여러 명을 배정할 수 있습니다.',
      blank: { area: '운영', title: '', start_time: '', end_time: '' },
      title: function (r) { return r.title || '(업무명 없음)'; },
      meta: function (r) {
        var t = r.start_time ? r.start_time + (r.end_time ? '–' + r.end_time : '–') : '시간 미정';
        return t + (r.place ? ' · ' + r.place : '') +
          ' · 담당 ' + (cache.task_assignments || []).filter(function (a) {
            return a.task_id === r.id; }).length + '명';
      },
      tags: function (r) { return tag(r.area || '기타'); },
      fields: [
        { k: 'area',        label: '업무 영역', required: true,
          hint: '예: 기념식 · 부스 운영 · 안전 · 안내 · 행사 지원' },
        { k: 'title',       label: '업무명', wide: true, required: true },
        { k: 'start_time',  label: '시작시간', type: 'time' },
        { k: 'end_time',    label: '종료시간', type: 'time' },
        { k: 'place',       label: '장소' },
        { k: 'description', label: '업무 설명', type: 'textarea', wide: true,
          hint: '줄바꿈은 포털에서도 그대로 보입니다' }
      ]
    },

    task_assignments: {
      label: '담당자 배정', table: 'task_assignments', addLabel: '+ 담당자 배정', soft: true,
      desc: '업무에 담당자를 연결합니다. 연락망에 있는 사람은 목록에서 고르면 ' +
            '이름·소속·연락처가 자동으로 따라옵니다. 연락망에 없는 사람만 이름을 직접 적습니다.',
      blank: { person_name: '', role: '' },
      title: function (r) {
        var t = (cache.operation_tasks || []).filter(function (x) { return x.id === r.task_id; })[0];
        return (t ? t.title : '(업무 미지정)');
      },
      meta: function (r) {
        var c = (cache.contacts || []).filter(function (x) { return x.id === r.contact_id; })[0];
        var name = c ? c.name : (r.person_name || '(담당자 미지정)');
        var org = c ? c.org : r.person_org;
        return name + (org ? ' · ' + org : '') + (r.role ? ' · ' + r.role : '');
      },
      tags: function (r) { return r.contact_id ? tag('연락망 연결') : tag('이름 직접 입력'); },
      fields: [
        { k: 'task_id',     label: '업무', type: 'ref', ref: 'operation_tasks', required: true,
          refLabel: function (r) {
            return (r.area ? '[' + r.area + '] ' : '') + (r.title || '(업무명 없음)') +
              (r.start_time ? ' · ' + r.start_time : '');
          } },
        { k: 'contact_id',  label: '담당자 (연락망)', type: 'ref', ref: 'contacts', allowEmpty: true,
          hint: '연락망에 있으면 여기서 고르세요',
          refLabel: function (r) { return r.name + (r.org ? ' · ' + r.org : ''); } },
        { k: 'person_name', label: '담당자 이름', hint: '연락망에 없을 때만 적습니다' },
        { k: 'person_org',  label: '담당자 소속', hint: '연락망에 없을 때만 적습니다' },
        { k: 'role',        label: '맡은 몫', wide: true, hint: '예: 좌석 안내 · 전기 점검' }
      ]
    },

    supply_items: {
      label: '물품 종류', table: 'supply_items', addLabel: '+ 물품 추가', soft: true,
      desc: '배부할 물품의 종류를 등록합니다. 여기에 등록한 물품을 ' +
            '“물품 배부”에서 대상별 수량과 함께 연결합니다.',
      blank: { name: '', unit: '개', category: '기타' },
      title: function (r) { return r.name || '(물품명 없음)'; },
      meta: function (r) {
        var used = (cache.supply_allocations || []).filter(function (a) { return a.item_id === r.id; });
        var sum = used.reduce(function (n, a) { return n + (a.qty || 0); }, 0);
        return '단위 ' + (r.unit || '개') + ' · 배부 ' + used.length + '곳 · 합계 ' + sum;
      },
      tags: function (r) { return tag(r.category || '기타'); },
      fields: [
        { k: 'name',     label: '물품명', wide: true, required: true,
          hint: '예: 명찰 · 식권 · 생수 · 운영키트 · 티셔츠' },
        { k: 'unit',     label: '단위', hint: '예: 개 · 장 · 박스' },
        { k: 'category', label: '분류', hint: '예: 운영 · 식음 · 홍보' },
        { k: 'memo',     label: '메모', type: 'textarea', wide: true }
      ]
    },

    supply_targets: {
      label: '배부 대상', table: 'supply_targets', addLabel: '+ 대상 추가', soft: true,
      desc: '물품을 받는 기관·팀·부스를 등록하고 배부 상태를 관리합니다. ' +
            '포털에서는 이 상태를 조회만 하고, 바꾸는 것은 여기에서만 합니다.',
      blank: { name: '', kind: '팀', status: '미배부', headcount: 0 },
      title: function (r) { return r.name || '(대상명 없음)'; },
      meta: function (r) {
        var items = (cache.supply_allocations || []).filter(function (a) { return a.target_id === r.id; });
        return (r.manager ? '담당 ' + r.manager + ' · ' : '') +
          (r.headcount ? r.headcount + '명 · ' : '') + '물품 ' + items.length + '종';
      },
      tags: function (r) { return badge(r.status || '미배부') + tag(r.kind || '팀'); },
      fields: [
        { k: 'name',      label: '대상 이름', wide: true, required: true },
        { k: 'kind',      label: '구분', type: 'select', options: opts(SUPPLY_KINDS) },
        { k: 'status',    label: '배부 상태', type: 'select', options: opts(SUPPLY_STATES) },
        { k: 'manager',   label: '담당자' },
        { k: 'headcount', label: '인원', type: 'number' },
        { k: 'memo',      label: '메모', type: 'textarea', wide: true }
      ]
    },

    supply_allocations: {
      label: '물품 배부', table: 'supply_allocations', addLabel: '+ 배부 등록', soft: true,
      desc: '대상에게 어떤 물품을 몇 개 주는지 등록합니다. ' +
            '같은 대상에 같은 물품은 한 줄만 둘 수 있습니다(수량이 갈라지면 합계가 맞지 않습니다).',
      blank: { qty: 0 },
      title: function (r) {
        var t = (cache.supply_targets || []).filter(function (x) { return x.id === r.target_id; })[0];
        var i = (cache.supply_items || []).filter(function (x) { return x.id === r.item_id; })[0];
        return (t ? t.name : '(대상 미지정)') + ' · ' + (i ? i.name : '(물품 미지정)');
      },
      meta: function (r) {
        var i = (cache.supply_items || []).filter(function (x) { return x.id === r.item_id; })[0];
        return (r.qty || 0) + ' ' + (i ? (i.unit || '개') : '개') + (r.memo ? ' · ' + r.memo : '');
      },
      tags: function (r) { return tag((r.qty || 0) + '개'); },
      fields: [
        { k: 'target_id', label: '배부 대상', type: 'ref', ref: 'supply_targets', required: true,
          refLabel: function (r) { return r.name + (r.kind ? ' · ' + r.kind : ''); } },
        { k: 'item_id',   label: '물품', type: 'ref', ref: 'supply_items', required: true,
          refLabel: function (r) { return r.name + (r.unit ? ' (' + r.unit + ')' : ''); } },
        { k: 'qty',       label: '수량', type: 'number', required: true },
        { k: 'memo',      label: '메모', wide: true }
      ]
    },

    faqs: {
      label: 'FAQ 관리', table: 'faqs', addLabel: '+ 질문 추가',
      desc: '관계자가 자주 확인하는 운영 질문과 답변을 관리합니다. ' +
            '답변을 채우고 “공개”를 켜야 포털에 표시됩니다.',
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

  /* 관리 메뉴가 길어져 화면 위계를 나눕니다. 앞쪽은 매일 손대는 것,
     가운데는 현장 운영, 뒤쪽은 한 번 채우고 두는 자료입니다. */
  var ORDER = ['overview', 'settings', 'schedule_items', 'booths', 'notices',
               'operation_requests',
               'operation_tasks', 'task_assignments',
               'supply_items', 'supply_targets', 'supply_allocations',
               'resources', 'contacts', 'venue_places', 'faqs'];
  var GROUPS = [
    { label: '', keys: ['overview', 'settings', 'schedule_items', 'booths', 'notices'] },
    { label: '현장 운영', keys: ['operation_requests', 'operation_tasks', 'task_assignments'] },
    { label: '운영 물품', keys: ['supply_items', 'supply_targets', 'supply_allocations'] },
    { label: '자료·안내', keys: ['resources', 'contacts', 'venue_places', 'faqs'] }
  ];
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
      var len = (cache[k] || []).length;
      return '<span class="nav__badge" style="background:var(--bg-sink);color:var(--muted)">' + len + '</span>';
    }
    function link(k) {
      return '<a href="#' + k + '" class="' + (k === current ? 'is-on' : '') + '"' +
        (k === current ? ' aria-current="page"' : '') + '>' + esc(ENTITIES[k].label) + n(k) + '</a>';
    }
    /* 관리 항목이 늘어 한 줄로 세우면 무엇이 무엇인지 알기 어렵습니다.
       하는 일끼리 묶고 제목을 답니다. */
    $('#sidenav').innerHTML = GROUPS.map(function (g) {
      return (g.label ? '<p class="side__group">' + esc(g.label) + '</p>' : '') +
        g.keys.map(link).join('');
    }).join('');

    var short = { overview: '요약', schedule_items: '일정', booths: '부스', notices: '공지', operation_requests: '요청' };
    $('#tabbar').innerHTML = TABS.map(function (k) {
      return '<a href="#' + k + '" class="' + (k === current ? 'is-on' : '') + '">' +
        '<span class="tab__dot">' + esc(short[k].charAt(0)) + '</span><span>' + esc(short[k]) + '</span></a>';
    }).join('') + '<button type="button" data-open-sheet><span class="tab__dot">⋯</span><span>더보기</span></button>';

    $('#sheetnav').innerHTML = GROUPS.map(function (g) {
      var keys = g.keys.filter(function (k) { return TABS.indexOf(k) < 0; });
      if (!keys.length) return '';
      return (g.label ? '<p class="sheet__group">' + esc(g.label) + '</p>' : '') +
        keys.map(function (k) {
          return '<a href="#' + k + '" class="' + (k === current ? 'is-on' : '') + '">' +
            esc(ENTITIES[k].label) + '</a>';
        }).join('');
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
      { n: (cache.venue_places || []).length, l: '행사장 공간', go: 'venue_places' },
      { n: (cache.operation_tasks || []).length, l: '담당 업무', go: 'operation_tasks' },
      { n: (cache.supply_targets || []).length, l: '배부 대상', go: 'supply_targets' }
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

          // 이미지 칸은 주소를 길게 늘어놓는 대신 실제 그림을 보여 줍니다.
          if (f.type === 'image') {
            return '<div class="listrow"><div class="listrow__body">' +
              '<div class="listrow__meta">' + esc(f.label) + '</div>' +
              (v ? '<img class="listrow__thumb" src="' + esc(v) + '" alt="" />'
                 : '<div class="listrow__title"><span style="color:var(--muted-2)">등록된 이미지가 없습니다</span></div>') +
              '</div></div>';
          }

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
        '<div class="state state--empty">' +
          '<span class="state__icon">' + ICON_EMPTY + '</span>' +
          '<p class="state__title">아직 등록된 항목이 없습니다.</p>' +
          '<p class="state__hint">오른쪽 위 “' + esc(ent.addLabel || '새로 추가') +
          '”로 시작하세요. 등록하면 관계자 포털에 바로 반영됩니다.</p>' +
        '</div></div>';
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
      if (f.type === 'zone') {
        return Object.assign({}, f, {
          type: 'select',
          options: zoneKeys.map(function (z) { return [z.key, z.key + '존 · ' + z.label]; })
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
      return f;
    });
  }

  /* 이 항목이 들고 있는 이미지 칸들 */
  function imageKeys(ent) {
    return (ent.fields || []).filter(function (f) { return f.type === 'image'; })
      .map(function (f) { return f.k; });
  }

  /* 바뀌거나 지워져서 더는 쓰이지 않는 이미지를 보관함에서 지웁니다.
     이걸 안 하면 교체할 때마다 예전 파일이 계속 쌓입니다. */
  function dropReplacedImages(ent, before, after) {
    imageKeys(ent).forEach(function (k) {
      var old = (before || {})[k];
      if (old && old !== (after || {})[k]) C.deleteImage(old);
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
        // 고르지 않은 참조는 '' 가 아니라 null 이어야 합니다.
        // uuid 칸에 빈 글자를 넣으면 Postgres 가 거절합니다.
        if (f.type === 'ref' && !v[f.k]) v[f.k] = null;
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
          // 저장이 끝난 뒤에 지웁니다. 먼저 지웠다가 저장이 실패하면
          // 화면에는 이미지가 있는데 파일은 없는 상태가 됩니다.
          dropReplacedImages(ent, row, updated);
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
        dropReplacedImages(ent, row, {});   // 딸린 이미지도 함께 정리
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

  /* ── 데이터 ─────────────────────────────────────────────────── */
  function loadAll() {
    $('#view').innerHTML = '<div class="state">데이터를 불러오는 중입니다.</div>';
    var keys = ORDER.filter(function (k) { return ENTITIES[k].table; });
    return Promise.all(keys.map(function (k) {
      var e = ENTITIES[k];
      // soft 항목은 마이그레이션 전이라 표가 없을 수 있습니다. 그 하나
      // 때문에 관리자 화면 전체가 오류가 되면 안 됩니다.
      var get = e.soft ? C.selectSoft : C.select;
      return get(e.table, { order: e.order === false ? false : (e.order || [['sort_order', true]]) })
        .then(function (d) { cache[k] = d; });
    }).concat([
      C.select('zones').then(function (z) {
        zoneKeys = z.map(function (x) { return { key: x.key, label: x.label }; });
      })
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

  /* ── 시작 ─────────────────────────────────────────────────────
     포털은 로그인 없이 열리지만 이 화면은 다릅니다. 로그인한 계정의
     role 이 admin 일 때만 들어옵니다. 화면을 통과하더라도 실제 편집은
     데이터베이스의 is_admin() 이 다시 확인합니다. ───────────────── */
  var GATES = ['gate-setup', 'gate-login', 'gate-denied'];

  function gate(id) {
    GATES.forEach(function (g) { $('#' + g).hidden = g !== id; });
    $('#app').hidden = true;
  }

  function enter() {
    GATES.forEach(function (g) { $('#' + g).hidden = true; });
    $('#app').hidden = false;
    current = routeFromHash();
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
    C.signIn(email.value.trim(), pw.value).then(function (sess) {
      pw.value = '';
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
  $('#denied-signout').addEventListener('click', function () {
    C.signOut().then(function () { location.reload(); });
  });

  C.session().then(admitOrGate).catch(function (e) {
    console.error('[admin] 시작 실패', e);
    gate('gate-login');
  });
})();
