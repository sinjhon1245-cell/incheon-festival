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
  /* 역할 구분은 DB 에서 값을 제한하지 않습니다. 현장에서 쓰는 말이
     해마다 달라서, 여기서는 추천값으로만 보여 줍니다.

     포털의 연락망 역할 필터와 예시도 같은 이름을 씁니다. 관리자는
     '부스 지원', 포털 예시는 '부스지원팀' 처럼 갈라져 있으면 현장에서
     두 화면을 견주다 같은 역할인지부터 헷갈립니다.

     추천 목록 밖의 예전 값은 지우거나 바꾸지 않습니다 — keepValue 로
     그대로 보이고 그대로 저장됩니다. */
  var ROLE_GROUPS = ['총괄', '운영본부', '부스지원', '전산지원', '운영지원', '안전지원', '안내', '기타'];

  function opts(l) { return l.map(function (v) { return [v, v]; }); }

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
  /* '2026-11-13' → '11.13. 금'. 목록 meta 에 작게 붙입니다. */
  function dayShort(day) {
    var p = String(day || '').split('-');
    if (p.length !== 3) return '';
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return isNaN(d) ? '' : (d.getMonth() + 1) + '.' + d.getDate() + '. ' + WEEKDAYS[d.getDay()];
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
        { k: 'event_start',   label: '개막 일시', type: 'datetime' },
        { k: 'event_end',     label: '종료 일시', type: 'datetime' },
        { k: 'date_label',    label: '날짜 표기', hint: '예: 2026. 11. 13.(금) ~ 11. 14.(토)' },
        { k: 'time_label',    label: '운영시간 표기', hint: '예: 10:00 – 17:00' },
        { k: 'venue',         label: '장소' },
        { k: 'venue_detail',  label: '장소 상세',
          hint: '2026 전시홀 번호는 추후 확정입니다. 확정 전에는 비워 두세요 — 비면 화면에서 그 줄이 사라집니다' },
        { k: 'venue_address', label: '주소', wide: true },

        { type: 'group', label: '운영 안내' },
        { k: 'contact_phone', label: '대표 전화' },
        { k: 'contact_email', label: '대표 메일' },
        { k: 'portal_note',   label: '포털 안내 문구', type: 'textarea', wide: true },
        { k: 'ops_guide',     label: '대시보드 운영 안내', type: 'textarea', wide: true,
          hint: '행사 당일 먼저 확인할 내용. 줄바꿈은 포털에서도 그대로 보입니다' },

        /* 지도는 부스 배치도 한 장만 관리합니다. 행사장 안내도까지
           두면 그림을 두 번 올려야 하는데, 현장에서 실제로 찾는 것은
           부스 자리입니다. 이 한 장을 부스·행사장 두 화면이 함께
           씁니다. venue_map_* 칸은 표에 그대로 남겨 둡니다 — 지우면
           예전에 올린 그림을 되살릴 길이 없어집니다. */
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
      title: function (r) { return r.title || '(제목 없음)'; },
      /* 이틀 행사에서는 어느 날 일정인지가 시각보다 먼저 보여야 합니다.
         배지로 키우지 않고 meta 한 줄 앞에 작게 둡니다. */
      meta: function (r) {
        var day = dayShort(r.event_date);
        var head = day ? day + ' · ' : (eventDays().length > 1 ? '일자 미정 · ' : '');
        return head + (r.start_time || '--:--') + '–' + (r.end_time || '--:--') +
          (r.place ? ' · ' + r.place : '') + (r.team ? ' · ' + r.team : '') + (r.owner ? ' · ' + r.owner : '');
      },
      tags: function (r) { return badge(r.status || '예정') + tag(r.category || '운영') +
        (r.is_highlight ? tag('핵심') : ''); },
      fields: [
        // 일자와 시각은 따로 받습니다. 시작·종료는 'HH:MM' 이라 날짜를
        // 함께 담을 수 없고, 이틀 행사에서는 날짜가 반드시 필요합니다.
        // migration-schedule-event-date.sql 을 돌리기 전에는 칸이 없습니다.
        { k: 'event_date', label: '일자', type: 'date', needsColumn: true,
          hint: '예: 2026-11-13 · 이틀 행사에서는 반드시 고릅니다' },
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
        // 빈 글자는 date 칸에 넣을 수 없습니다(Postgres 가 거절합니다).
        if ('event_date' in v && !v.event_date) v.event_date = null;
        return v;
      },
      validate: function (v) {
        var a = C.toMin(v.start_time), b = C.toMin(v.end_time);
        if (a == null || b == null) return '시간은 HH:MM 형식으로 입력해 주세요.';
        if (b <= a) return '종료시간은 시작시간보다 뒤여야 합니다.';
        /* 이틀 이상 행사에서 일자가 없으면 포털이 그 일정을 첫날 것으로
           봅니다. 짐작으로 남기지 않고 여기서 고르게 합니다. 하루 행사면
           나눌 날이 없으므로 비워 두어도 됩니다. */
        var days = eventDays();
        if ('event_date' in v && !v.event_date && days.length > 1) {
          return '이틀 이상 행사입니다. 일자를 골라 주세요 (' +
            days.map(dayShort).join(' · ') + ').';
        }
        return null;
      }
    },

    booths: {
      label: '부스', table: 'booths', addLabel: '+ 부스 추가',
      desc: '부스 정보와 운영기관을 관리합니다.',
      blank: { no: 1, zone_key: 'A', name: '', org: '' },
      title: function (r) { return (r.code || (r.zone_key + '-' + r.no)) + ' · ' + (r.name || '(이름 없음)'); },
      meta: function (r) { return (r.org || '운영기관 미정') + (r.manager ? ' · 부스 담당 ' + r.manager : ''); },
      tags: function (r) {
        return (r.org_type ? tag(r.org_type) : '') +
          (r.needs_power ? tag('전기') : '') + (r.needs_network ? tag('네트워크') : '');
      },
      fields: [
        { type: 'group', label: '기본 정보' },
        { k: 'no',            label: '부스 번호', type: 'number', required: true },
        { k: 'zone_key',      label: '구역', type: 'zone' },
        { k: 'name',          label: '부스명', wide: true, required: true },
        { k: 'org',           label: '운영기관', wide: true },
        { k: 'org_type',      label: '운영기관 유형', type: 'select',
          options: [['', '(선택 안 함)']].concat(opts(ORG_TYPES)),
          hint: '포털 카드에 초등·중등·고등 표시로 보입니다',
          // migration-portal-actions.sql 을 돌리기 전에는 칸이 없습니다.
          needsColumn: true },
        { k: 'manager',       label: '부스 담당자' },

        { type: 'group', label: '운영 정보' },
        { k: 'hours',         label: '운영 시간' },
        { k: 'manager_phone', label: '부스 담당자 연락처', type: 'tel',
          hint: '⚠️ 개인 휴대전화 입력 금지 — 부스 표도 로그인 없이 열람됩니다. ' +
                '보안 분리 전까지 공용번호만 적어 주세요' },
        { k: 'program',       label: '운영 프로그램', wide: true },
        { k: 'needs_power',   label: '전기 사용 필요', type: 'bool' },
        { k: 'needs_network', label: '네트워크 필요', type: 'bool' },

        { type: 'group', label: '상세 설정', fold: true },
        { k: 'supplies',      label: '필요 물품', wide: true },
        { k: 'memo',          label: '운영 메모', type: 'textarea', wide: true },
        { k: 'notes',         label: '특이사항', type: 'textarea', wide: true },
        { k: 'image_url',     label: '부스 대표 이미지', type: 'image', folder: 'booth' },
        { k: 'image_alt',     label: '이미지 설명', wide: true },
        { k: 'image_caption', label: '이미지 캡션', wide: true }
      ],
      beforeSave: function (v) {
        if (!v.code) v.code = v.zone_key + '-' + String(v.no).padStart(2, '0');
        // '선택 안 함' 은 빈 글자가 아니라 null 로 보냅니다(표의 허용값 검사).
        if ('org_type' in v && !v.org_type) v.org_type = null;
        return v;
      }
    },

    notices: {
      label: '공지', table: 'notices', addLabel: '+ 공지 작성',
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
      label: '자료실', table: 'resources', addLabel: '+ 자료 추가',
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

    contacts: {
      label: '연락망', table: 'contacts', addLabel: '+ 연락처 추가',
      desc: '운영 담당자와 지원 연락처를 관리합니다.',
      blank: { name: '', category: '기타', phone: '' },
      title: function (r) { return r.name || '(이름 없음)'; },
      meta: function (r) { return (r.org || '') + (r.phone ? ' · ' + r.phone : ''); },
      tags: function (r) { return tag(r.category || '기타') + (r.duty ? tag(r.duty) : '') +
        (r.is_staff ? badge('운영 인력') : ''); },
      fields: [
        { k: 'name',     label: '이름', required: true },
        { k: 'category', label: '연락처 분류', hint: '연락망을 묶어 보는 이름. 예: 운영본부 · 협력기관 · 시설' },
        { k: 'org',      label: '소속' },
        { k: 'duty',     label: '담당업무', hint: '실제 담당 내용을 간단히 설명. 예: 전원·네트워크 점검' },
        /* ⚠️ contacts 는 지금 로그인 없이 열람할 수 있는 표입니다.
           포털 화면에서는 번호를 빼 두었지만, 표 자체는 아직 공개
           범위 안에 있습니다. 개인 휴대전화는 넣지 마세요. */
        { k: 'phone',    label: '전화번호', type: 'tel',
          hint: '⚠️ 개인 휴대전화 입력 금지 — 지금 구조에서는 이 표가 공개 범위입니다. ' +
                '보안 분리 전까지 운영본부·기관 대표번호 같은 공용번호만 적어 주세요' },
        // 이 두 칸이 담당 업무 화면의 '운영 인력' 집계를 만듭니다.
        // 연락망과 명부를 따로 두지 않으려고 여기에 함께 둡니다.
        { k: 'is_staff',   label: '운영 인력 (담당 업무 화면에서 집계)', type: 'bool' },
        { k: 'role_group', label: '역할 구분', type: 'select', keepValue: true,
          options: [['', '(없음)']].concat(opts(ROLE_GROUPS)),
          hint: '부스지원 · 전산지원처럼 이 사람이 행사에서 맡은 기본 역할' },
        { k: 'memo',     label: '메모', type: 'textarea', wide: true }
      ]
    },

    venue_places: {
      label: '행사장', table: 'venue_places', addLabel: '+ 공간 추가',
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
      label: '담당 업무', table: 'operation_tasks', addLabel: '+ 업무 추가', soft: true,
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
          hint: '연락망에서 고르거나, 없으면 이름을 직접 적습니다. 역할은 이 업무에서 맡은 몫으로, 연락망의 역할 구분과 다릅니다',
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
      label: '배부 현황', table: 'supply_targets', addLabel: '+ 대상 추가', soft: true,
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
        return [
          { n: rows.length, l: '전체 대상' },
          { n: by['미배부'], l: '미배부', tone: 'warn' },
          { n: by['일부 배부'], l: '일부 배부', tone: 'info' },
          { n: by['배부 완료'], l: '배부 완료', tone: 'ok' }
        ];
      },
      statuses: SUPPLY_STATES,
      statusKey: 'status',
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
      label: '물품 설정', table: 'supply_items', addLabel: '+ 물품 추가', soft: true,
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
      label: 'FAQ', table: 'faqs', addLabel: '+ 질문 추가',
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
  var ORDER = ['overview', 'settings', 'schedule_items', 'booths', 'notices',
               'operation_requests', 'operation_tasks', 'supplies',
               'contacts', 'resources', 'venue_places', 'faqs',
               // 아래는 메뉴에 없지만 데이터는 함께 불러옵니다.
               'task_assignments', 'supply_targets', 'supply_items', 'supply_allocations'];
  var GROUPS = [
    { label: '', keys: ['overview'] },
    { label: '행사 관리', keys: ['settings', 'schedule_items', 'booths'] },
    { label: '현장 운영', keys: ['notices', 'operation_requests', 'operation_tasks', 'supplies'] },
    { label: '정보 관리', keys: ['contacts', 'resources', 'venue_places', 'faqs'] }
  ];
  var TABS = ['overview', 'schedule_items', 'booths', 'notices', 'operation_requests'];

  /* 지금 보고 있는 통합 화면의 내부 탭. */
  var subTab = { supplies: 'supply_targets' };
  /* 목록·추가·수정이 실제로 다룰 항목. 통합 화면이면 내부 탭입니다. */
  function listKey() {
    var e = ENTITIES[current];
    return (e && e.virtual) ? subTab[current] : current;
  }
  /* 목록 걸러 보기(운영 물품에서만 씁니다). */
  var listQ = '', listStatus = '전체';

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
       하는 일끼리 묶고 제목을 답니다. */
    $('#sidenav').innerHTML = GROUPS.map(function (g) {
      var keys = g.keys.filter(function (k) { return ENTITIES[k] && !ENTITIES[k].hidden; });
      if (!keys.length) return '';
      return (g.label ? '<p class="side__group">' + esc(g.label) + '</p>' : '') +
        keys.map(link).join('');
    }).join('');

    var short = { overview: '요약', schedule_items: '일정', booths: '부스', notices: '공지', operation_requests: '요청' };
    $('#tabbar').innerHTML = TABS.map(function (k) {
      return '<a href="#' + k + '" class="' + (k === current ? 'is-on' : '') + '">' +
        '<span class="tab__dot">' + esc(short[k].charAt(0)) + '</span><span>' + esc(short[k]) + '</span></a>';
    }).join('') + '<button type="button" data-open-sheet><span class="tab__dot">⋯</span><span>더보기</span></button>';

    $('#sheetnav').innerHTML = GROUPS.map(function (g) {
      var keys = g.keys.filter(function (k) {
        return TABS.indexOf(k) < 0 && ENTITIES[k] && !ENTITIES[k].hidden;
      });
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
    /* 관리자 대시보드는 전시장이 아니라 출발점입니다. 지금 손봐야
       할 것이 있는지만 알려 주고, 나머지는 바로 일할 수 있는 단추로
       둡니다. 자료실·연락망 건수 같은 값은 그 메뉴에 들어가면
       사이드바 숫자로 이미 보입니다. */
    var cards = [
      { n: openN, l: '미처리 운영 요청', go: 'operation_requests', tone: openN ? 'warn' : null },
      { n: urgent, l: '긴급 공지', go: 'notices', tone: urgent ? 'danger' : null },
      { n: (cache.schedule_items || []).length, l: '등록된 일정', go: 'schedule_items' },
      { n: (cache.booths || []).length, l: '등록된 부스', go: 'booths' }
    ];
    var quick = [
      { l: '+ 일정 추가', go: 'schedule_items', add: true, primary: true },
      { l: '+ 공지 작성', go: 'notices', add: true, primary: true },
      { l: '운영 요청 확인', go: 'operation_requests' },
      { l: '부스 관리', go: 'booths' }
    ];
    return '<div class="page"><div class="page__head"><div>' +
      '<h1 class="page__title">관리자</h1>' +
      '<p class="page__desc">바꾼 내용은 관계자 포털에 바로 반영됩니다.</p></div></div>' +
      '<div class="statgrid">' + cards.map(function (c) {
        return '<button class="adminstat' + (c.tone ? ' adminstat--' + c.tone : '') +
          '" type="button" data-go="' + c.go + '">' +
          '<span class="adminstat__n">' + c.n + '</span>' +
          '<span class="adminstat__l">' + esc(c.l) + '</span></button>';
      }).join('') + '</div>' +
      '<section class="qbox"><h2 class="fgroup__t">빠른 관리</h2>' +
      '<div class="qrow">' + quick.map(function (q) {
        return '<button class="btn ' + (q.primary ? 'btn--primary' : 'btn--ghost') + '" type="button" ' +
          'data-go="' + q.go + '"' + (q.add ? ' data-goadd="1"' : '') + '>' + esc(q.l) + '</button>';
      }).join('') + '</div></section></div>';
  }

  /* ── 목록 ─────────────────────────────────────────────────────
     관리자 목록은 오래 읽는 화면이 아니라 찾아서 고치는 화면입니다.
     카드처럼 띄우지 않고 줄로 세웁니다 — 줄이면 눈이 왼쪽 한 줄만
     따라 내려가면 되고, 카드면 매번 사각형 안을 훑어야 합니다.
     자주 쓰는 '수정'은 바로 두고, 삭제와 순서는 '⋯' 안에 둡니다. */
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
      '<p class="page__desc">' + esc(ent.desc || listEnt.desc || '') + '</p></div>' +
      (ent.single ? '' : '<div class="page__actions"><button class="btn btn--primary btn--sm" type="button" data-add>' +
        esc(listEnt.addLabel || '+ 새로 추가') + '</button></div>') + '</div>';

    if (ent.single) { renderSingle(ent, head, host); return; }

    var all = cache[key] || [];

    /* 걸러 보기 — 정의한 항목에서만 나옵니다(지금은 배부 현황). */
    var toolsHtml = '';
    var rows = all;
    if (listEnt.statuses || listEnt.searchText) {
      var q = listQ.trim().toLowerCase();
      rows = all.filter(function (r) {
        if (listEnt.statuses && listStatus !== '전체' && r[listEnt.statusKey] !== listStatus) return false;
        if (!q || !listEnt.searchText) return true;
        return listEnt.searchText(r).toLowerCase().indexOf(q) >= 0;
      });
      toolsHtml = '<div class="tools">' +
        (listEnt.searchText
          ? '<div class="search"><label class="sr-only" for="list-q">검색</label>' +
            '<input class="input" id="list-q" type="search" placeholder="대상 · 담당자 · 물품 검색" value="' +
            esc(listQ) + '" /></div>'
          : '') +
        (listEnt.statuses
          ? '<div class="chiprow" role="group">' + ['전체'].concat(listEnt.statuses).map(function (st) {
              var n = st === '전체' ? all.length
                : all.filter(function (r) { return r[listEnt.statusKey] === st; }).length;
              return '<button class="chip' + (listStatus === st ? ' is-on' : '') + '" type="button" ' +
                'data-liststatus="' + esc(st) + '" aria-pressed="' + (listStatus === st) + '">' +
                esc(st) + '<span class="chip__n">' + n + '</span></button>';
            }).join('') + '</div>'
          : '') + '</div>';
    }

    /* 요약 숫자 — 정의한 항목에서만. */
    var sumHtml = '';
    if (listEnt.summary && all.length) {
      sumHtml = '<div class="minigrid">' + listEnt.summary(all).map(function (c) {
        return '<div class="mini' + (c.tone ? ' mini--' + c.tone : '') + '">' +
          '<span class="mini__n">' + c.n + '</span>' +
          '<span class="mini__l">' + esc(c.l) + '</span></div>';
      }).join('') + '</div>';
    }

    if (!all.length) {
      host.innerHTML = '<div class="page">' + head + tabsHtml +
        '<div class="state state--empty">' +
          '<span class="state__icon">' + ICON_EMPTY + '</span>' +
          '<p class="state__title">아직 등록된 항목이 없습니다.</p>' +
          '<p class="state__hint">오른쪽 위 “' + esc(listEnt.addLabel || '새로 추가') +
          '”로 시작하세요. 등록하면 관계자 포털에 바로 반영됩니다.</p>' +
        '</div></div>';
      paintNav(); return;
    }

    if (!rows.length) {
      host.innerHTML = '<div class="page">' + head + tabsHtml + sumHtml + toolsHtml +
        '<div class="state state--empty"><span class="state__icon">' + ICON_EMPTY + '</span>' +
        '<p class="state__title">조건에 맞는 항목이 없습니다.</p>' +
        '<p class="state__hint">검색어나 상태를 바꿔 보세요.</p></div></div>';
      paintNav(); return;
    }

    /* 업무 영역처럼 묶어 보여 주는 항목은 제목을 사이에 끼웁니다.
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

    host.innerHTML = '<div class="page">' + head + tabsHtml + sumHtml + toolsHtml + body + '</div>';
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
        '<button class="btn btn--ghost btn--sm" type="button" data-act="edit">수정</button>' +
        '<button class="iconbtn iconbtn--sm" type="button" data-act="more" ' +
          'aria-expanded="false" aria-label="' + esc(ent.title(r)) + ' 추가 작업">⋯</button>' +
      '</div>' +
      '<div class="listrow__more" hidden>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-act="up"' +
          (i === 0 ? ' disabled' : '') + '>↑ 위로</button>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-act="down"' +
          (i === total - 1 ? ' disabled' : '') + '>↓ 아래로</button>' +
        '<button class="btn btn--danger btn--sm" type="button" data-act="del">삭제</button>' +
      '</div></div>';
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
      /* 개막·종료 일시는 연도까지 보여 줍니다. 목록에 쓰는 '11/13 10:00'
         짧은 표기는 최근 글 순서를 볼 때나 쓸모 있고, 행사 기본정보에서는
         연도가 틀린 것을 한눈에 알아차려야 합니다. */
      if (f.type === 'datetime') {
        var dv = v ? new Date(v) : null;
        v = dv && !isNaN(dv) ? C.fmtDateTime(dv) : '';
      }
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
      /* 일정의 일자는 행사 기간 안에서만 고르게 합니다. 달력에서
         엉뚱한 해·달을 고르는 실수를 입력 단계에서 막습니다.
         기간을 모르면(기본정보 미설정) 제한 없이 그대로 둡니다. */
      if (f.type === 'date' && f.k === 'event_date') {
        var days = eventDays();
        if (!days.length) return f;
        return Object.assign({}, f, {
          min: days[0], max: days[days.length - 1],
          hint: '행사 기간 ' + days.map(dayShort).join(' · ') +
            (days.length > 1 ? ' 중에서 고릅니다' : '')
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
        { k: 'contact_id', label: '연락망에서 고르기', type: 'select',
          options: [['', '연락망에 없음 (이름 직접 입력)']].concat(
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
      /* 아직 표에 없는 칸은 편집창에서 뺍니다. 없는 칸을 보내면 저장이
         통째로 거절됩니다. 줄이 하나도 없으면 알 수 없으니 그대로 둡니다. */
      if (!f.needsColumn) return true;
      var rows = cache[key] || [];
      return !rows.length || rows.some(function (r) { return f.k in r; });
    });

    // 딸린 줄(담당자·물품)을 지금 값에서 읽어 함께 싣습니다.
    var ch = ent.children;
    if (ch) {
      values[ch.field] = row
        ? (cache[ch.key] || []).filter(function (a) { return a[ch.parent] === row.id; })
            .map(ch.toRow)
        : [];
    }

    UI.form({
      title: ent.label.replace(' 관리', '') + (isNew ? ' 추가' : ' 수정'),
      fields: kept,
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
      // 딸린 줄은 부모 표의 칸이 아니라 따로 떼어 둡니다.
      var childRows = null;
      if (ch) { childRows = v[ch.field] || []; delete v[ch.field]; }
      if (ent.beforeSave) v = ent.beforeSave(v);

      if (isNew) {
        var rows = cache[key] || [];
        v.sort_order = rows.reduce(function (m, r) { return Math.max(m, r.sort_order || 0); }, 0) + 1;
        C.insert(ent.table, v).then(function (created) {
          cache[key].push(created);
          return syncChildren(ent, created.id, childRows);
        }).then(function () {
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
          return syncChildren(ent, row.id, childRows);
        }).then(function () {
          renderPanel();
          toast('저장했습니다.');
        }).catch(function (e) {
          console.error('[admin] 저장 실패', key, e);
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
      if (old) jobs.push(C.update(table, old.id, payload));
      else { payload[ch.parent] = parentId; jobs.push(C.insert(table, payload)); }
    });
    before.slice(keep.length).forEach(function (old) {
      jobs.push(C.remove(table, old.id));
    });

    if (!jobs.length) return Promise.resolve();
    // 끝나면 그 부모의 줄만 다시 읽어 화면과 표를 맞춥니다.
    return Promise.all(jobs).then(function () {
      return C.selectSoft(table, { order: [['sort_order', true]] });
    }).then(function (all) {
      cache[ch.key] = all;
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
    // 숨긴 항목은 주소로도 들어오지 않게 합니다. 표 이름이 그대로
    // 주소가 되면 메뉴에서 감춘 뜻이 없어집니다.
    return (ENTITIES[id] && !ENTITIES[id].hidden) ? id : 'overview';
  }
  function go() {
    current = routeFromHash();
    listQ = ''; listStatus = '전체';
    renderPanel();
    if (pendingAdd) { var k = pendingAdd; pendingAdd = null; openEditor(k, null); }
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
      if (st) { subTab[current] = st.dataset.subtab; listQ = ''; listStatus = '전체'; renderPanel(); return; }

      var ls = t.closest('[data-liststatus]');
      if (ls) { listStatus = ls.dataset.liststatus; renderPanel(); return; }

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
        else if (act.dataset.act === 'del') confirmDelete(key, row);
        else if (act.dataset.act === 'up') move(key, i, -1);
        else if (act.dataset.act === 'down') move(key, i, 1);
        return;
      }

      // 줄 바깥을 누르면 열려 있던 ⋯ 를 닫습니다.
      if (!t.closest('.listrow__more')) closeRowMenus();
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
      closeRowMenus();
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
