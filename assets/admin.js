/* ===================================================================
   관리자 사이트 동작

   화면은 아래 ENTITIES 정의에서 자동으로 만들어집니다. 항목을 하나
   더 관리하고 싶으면 표를 만들고 여기에 정의만 추가하면 됩니다.

   보안: 이 파일에는 아무 권한도 없습니다. 실제로 쓰기를 막는 것은
   데이터베이스의 RLS 정책이라(supabase/schema.sql), 이 페이지 주소를
   남이 알아내도 로그인 없이는 아무것도 바꾸지 못합니다.
   =================================================================== */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var db = null;
  var current = 'settings';
  var cache = {};      // 표 이름 → 행 배열
  var zoneKeys = [];   // 부스의 구역 선택지
  var openRows = {};   // 표 이름 → 지금 펼쳐 둔 행의 id (한 번에 하나만)

  /* ── 관리 항목 정의 ─────────────────────────────────────────────── */
  var CATEGORIES = ['기조·강연', '체험·전시', '무대 공연', '운영'];

  var ENTITIES = {
    settings: {
      label: '행사 설정', single: true,
      desc: '공개 사이트 곳곳에 함께 반영되는 값입니다. 카운트다운은 개막 일시를 기준으로 계산합니다.',
      fields: [
        { k: 'event_title',   label: '행사 이름', wide: true },
        { k: 'event_start',   label: '개막 일시 (카운트다운 기준)', type: 'datetime' },
        { k: 'date_label',    label: '날짜 표기', hint: '예: 2026. 10. 17. 토' },
        { k: 'time_label',    label: '시간 표기', hint: '예: 10:00 – 17:00' },
        { k: 'venue',         label: '장소', hint: '히어로 칩' },
        { k: 'venue_detail',  label: '장소 상세', hint: '오시는 길 탭' },
        { k: 'venue_address', label: '주소', wide: true },
        { k: 'contact_phone', label: '문의 전화', hint: '푸터 · 운영 신청 카드' },
        { k: 'contact_email', label: '문의 메일', hint: '푸터 · 운영 신청 카드' },
        { k: 'booth_dept',    label: '운영 신청 담당 부서', hint: '예: 미래교육과' },
        { k: 'booth_apply_period', label: '운영 신청 기간', hint: '참여 안내 탭' },
        { k: 'host_line',     label: '주최·주관', wide: true, hint: '푸터' },
        { k: 'footer_note',   label: '푸터 안내 문구', type: 'textarea', wide: true,
          hint: '확정 후 비우면 사라집니다' },
        { k: 'show_countdown',     label: '카운트다운 보이기', type: 'bool' },
        { k: 'show_ops_track',     label: '시간표에 운영 순서 포함', type: 'bool' },
        { k: 'show_parking_table', label: '주차 안내 표 보이기', type: 'bool' }
      ]
    },

    programs: {
      label: '프로그램', table: 'programs',
      desc: '프로그램 탭의 카드입니다. 색 두 개는 번호 배지의 배경과 글자색입니다.',
      title: function (r) { return r.title; },
      blank: { no: '06', title: '새 프로그램', description: '', meta: '', tint: '#D7E6FF', deep: '#17458F' },
      fields: [
        { k: 'no',          label: '번호', hint: '예: 01' },
        { k: 'title',       label: '제목' },
        { k: 'description', label: '설명', type: 'textarea', wide: true },
        { k: 'meta',        label: '장소·시간', wide: true },
        { k: 'tint',        label: '배지 배경색', type: 'color' },
        { k: 'deep',        label: '배지 글자색', type: 'color' }
      ]
    },

    schedule_items: {
      label: '시간표', table: 'schedule_items',
      desc: '오전·오후로 나뉘어 표시됩니다. 갈래에 따라 색과 필터 칩이 정해집니다.',
      title: function (r) { return r.time_label + '  ' + r.title; },
      blank: { half: 'am', time_label: '10:00 – 10:30', duration: '30분', title: '새 순서', place: '', category: '체험·전시' },
      fields: [
        { k: 'half',       label: '오전/오후', type: 'select', options: [['am', '오전'], ['pm', '오후']] },
        { k: 'time_label', label: '시간', hint: '예: 10:00 – 10:20' },
        { k: 'duration',   label: '소요', hint: '예: 20분' },
        { k: 'category',   label: '갈래', type: 'select', options: CATEGORIES.map(function (c) { return [c, c]; }) },
        { k: 'title',      label: '순서 이름', wide: true },
        { k: 'place',      label: '장소', wide: true }
      ]
    },

    zones: {
      label: '부스 구역', table: 'zones',
      desc: '구역 기호(A·B·C·D)는 부스가 참조하므로, 바꾸면 해당 구역의 부스도 함께 따라갑니다.',
      title: function (r) { return r.key + '존 · ' + r.label; },
      blank: { key: 'E', label: '새 구역', sub: '', range_from: 41, range_to: 45, tint: '#DAE8F5', solid: '#1F4468', deep: '#1F4468' },
      fields: [
        { k: 'key',        label: '기호', hint: 'A · B · C …' },
        { k: 'label',      label: '구역 이름' },
        { k: 'sub',        label: '부연', hint: '예: 피지컬 컴퓨팅' },
        { k: 'range_from', label: '시작 번호', type: 'number' },
        { k: 'range_to',   label: '끝 번호', type: 'number' },
        { k: 'tint',       label: '카드 배경색', type: 'color' },
        { k: 'solid',      label: '기호 배경색', type: 'color' },
        { k: 'deep',       label: '글자색', type: 'color' }
      ]
    },

    booths: {
      label: '부스', table: 'booths',
      desc: '부스 배치도 탭의 목록입니다. 구역을 고르면 공개 사이트에서 그 구역 색을 따라갑니다.',
      title: function (r) { return r.no + '. ' + r.name; },
      blank: { no: 1, zone_key: 'A', name: '새 부스', org: '' },
      fields: [
        { k: 'no',       label: '부스 번호', type: 'number' },
        { k: 'zone_key', label: '구역', type: 'zone' },
        { k: 'name',     label: '부스 이름', wide: true },
        { k: 'org',      label: '운영 기관', wide: true }
      ]
    },

    faqs: {
      label: 'FAQ', table: 'faqs',
      desc: '자주 묻는 질문 탭입니다. 위에 있는 것부터 순서대로 나옵니다.',
      title: function (r) { return r.question; },
      blank: { question: '새 질문', answer: '' },
      fields: [
        { k: 'question', label: '질문', wide: true },
        { k: 'answer',   label: '답변', type: 'textarea', wide: true }
      ]
    }
  };

  var ORDER = ['settings', 'programs', 'schedule_items', 'zones', 'booths', 'faqs'];

  /* ── 잔손질 ─────────────────────────────────────────────────────── */
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var toastTimer;
  function toast(msg, isError) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('is-error', !!isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, isError ? 6000 : 2600);
  }

  /* Postgres 의 timestamptz ↔ <input type="datetime-local"> 사이 변환.
     datetime-local 은 시간대를 모르므로 브라우저 현지시각으로 맞춥니다. */
  function toLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var off = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - off).toISOString().slice(0, 16);
  }
  function fromLocalInput(v) {
    if (!v) return null;
    var d = new Date(v);
    return isNaN(d) ? null : d.toISOString();
  }

  /* ── 입력칸 하나 ────────────────────────────────────────────────── */
  function fieldHtml(f, value) {
    var id = 'f_' + f.k + '_' + Math.random().toString(36).slice(2, 8);
    var cls = 'field' + (f.wide || f.type === 'textarea' ? ' field--wide' : '');
    var body;

    if (f.type === 'bool') {
      return '<label class="field ' + (f.wide ? 'field--wide' : '') + '">' +
             '<span class="check"><input type="checkbox" data-k="' + f.k + '"' +
             (value ? ' checked' : '') + ' /> ' + esc(f.label) + '</span></label>';
    }

    if (f.type === 'textarea') {
      body = '<textarea class="textarea" id="' + id + '" data-k="' + f.k + '" rows="3">' + esc(value) + '</textarea>';
    } else if (f.type === 'select' || f.type === 'zone') {
      var opts = f.type === 'zone'
        ? zoneKeys.map(function (z) { return [z.key, z.key + '존 · ' + z.label]; })
        : f.options;
      body = '<select class="select" id="' + id + '" data-k="' + f.k + '">' +
        opts.map(function (o) {
          return '<option value="' + esc(o[0]) + '"' + (String(value) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
        }).join('') + '</select>';
    } else if (f.type === 'color') {
      body = '<input class="input input--color" type="color" id="' + id + '" data-k="' + f.k + '" value="' + esc(value || '#D7E6FF') + '" />';
    } else if (f.type === 'number') {
      body = '<input class="input input--num" type="number" id="' + id + '" data-k="' + f.k + '" value="' + esc(value) + '" />';
    } else if (f.type === 'datetime') {
      body = '<input class="input" type="datetime-local" id="' + id + '" data-k="' + f.k + '" data-dt="1" value="' + esc(toLocalInput(value)) + '" />';
    } else {
      body = '<input class="input" type="text" id="' + id + '" data-k="' + f.k + '" value="' + esc(value) + '" />';
    }

    return '<label class="' + cls + '" for="' + id + '">' +
             '<span class="field__label">' + esc(f.label) +
             (f.hint ? ' <span style="font-weight:500;opacity:.7">· ' + esc(f.hint) + '</span>' : '') +
             '</span>' + body + '</label>';
  }

  /* 화면의 입력칸들을 읽어 저장할 객체로 만듭니다. */
  function readRow(rowEl, ent) {
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

  /* ── 탭 ─────────────────────────────────────────────────────────── */
  function renderTabs() {
    $('#atabs').innerHTML = ORDER.map(function (k) {
      var e = ENTITIES[k];
      var count = e.single ? '' : '<span class="atab__count">' + ((cache[k] || []).length) + '</span>';
      return '<button type="button" class="atab' + (k === current ? ' is-on' : '') + '" data-ent="' + k + '">' +
             esc(e.label) + count + '</button>';
    }).join('');
  }

  /* ── 목록 화면 ──────────────────────────────────────────────────── */
  function renderPanel() {
    var key = current;
    var ent = ENTITIES[key];
    var panel = $('#panel');

    var head =
      '<div class="phead"><div>' +
        '<h1 class="phead__title">' + esc(ent.label) + '</h1>' +
        '<p class="phead__desc">' + esc(ent.desc) + '</p>' +
      '</div>' +
      (ent.single ? '' : '<div class="phead__actions"><button class="btn btn--primary" type="button" id="addbtn">+ 새로 추가</button></div>') +
      '</div>';

    if (ent.single) {
      var s = cache.settings || {};

      // DB 에 아직 없는 칼럼은 입력칸을 만들지 않습니다. 만들어 두면
      // 저장할 때 "column does not exist" 로 실패하기 때문입니다.
      var present = ent.fields.filter(function (f) { return f.k in s; });
      var missing = ent.fields.filter(function (f) { return !(f.k in s); });

      panel.innerHTML = head +
        (missing.length
          ? '<p class="empty" style="text-align:left">아직 데이터베이스에 없는 항목이 ' + missing.length + '개 있습니다 — ' +
            missing.map(function (f) { return esc(f.label); }).join(', ') +
            '.<br /><code>supabase/add-settings-fields.sql</code> 을 SQL Editor 에서 실행하면 여기에 나타납니다.</p>'
          : '') +
        '<div class="rows"><div class="row is-open" data-single="1">' +
          '<div class="row__body">' + present.map(function (f) { return fieldHtml(f, s[f.k]); }).join('') + '</div>' +
          '<div class="row__foot"><button class="btn btn--primary" type="button" data-act="save">저장</button>' +
          '<span class="row__flag" data-flag hidden>저장하지 않은 변경</span></div>' +
        '</div></div>';
      wireRows(key);
      return;
    }

    var rows = cache[key] || [];
    if (!rows.length) {
      panel.innerHTML = head + '<p class="empty">아직 등록된 항목이 없습니다. 오른쪽 위 “새로 추가”를 눌러 시작하세요.</p>';
      $('#addbtn').addEventListener('click', function () { addRow(key); });
      return;
    }

    // 목록이 길어 기본은 접어 둡니다. 제목 줄을 누르면 펴집니다.
    panel.innerHTML = head + '<div class="rows">' + rows.map(function (r, i) {
      var open = openRows[key] === r.id;
      return '<div class="row' + (open ? ' is-open' : '') + '" data-id="' + esc(r.id) + '" data-i="' + i + '">' +
        '<div class="row__head">' +
          '<button class="row__toggle" type="button" data-act="toggle" aria-expanded="' + open + '">' +
            '<span class="row__num">' + (i + 1) + '</span>' +
            '<span class="row__title">' + esc(ent.title(r)) + '</span>' +
            '<span class="row__chev" aria-hidden="true">›</span>' +
          '</button>' +
          '<span class="row__flag" data-flag hidden>저장 안 됨</span>' +
          '<span class="row__tools">' +
            '<button class="btn btn--icon" type="button" data-act="up" title="위로"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
            '<button class="btn btn--icon" type="button" data-act="down" title="아래로"' + (i === rows.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '</span>' +
        '</div>' +
        '<div class="row__body">' + ent.fields.map(function (f) { return fieldHtml(f, r[f.k]); }).join('') + '</div>' +
        '<div class="row__foot">' +
          '<button class="btn btn--primary btn--sm" type="button" data-act="save">저장</button>' +
          '<span class="spacer"></span>' +
          '<button class="btn btn--danger btn--sm" type="button" data-act="del">삭제</button>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';

    $('#addbtn').addEventListener('click', function () { addRow(key); });
    wireRows(key);
  }

  function wireRows(key) {
    $$('.row').forEach(function (rowEl) {
      // 값이 바뀌면 표시해 둡니다 — 저장을 잊고 넘어가는 일을 줄입니다.
      rowEl.addEventListener('input', function () {
        rowEl.classList.add('is-dirty');
        var flag = $('[data-flag]', rowEl);
        if (flag) flag.hidden = false;
      });

      rowEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-act]');
        if (!btn) return;
        var act = btn.dataset.act;
        if (act === 'toggle') {
          // 고치던 줄을 실수로 닫지 않도록, 저장 안 한 줄은 그대로 둡니다.
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

  /* ── 읽기 ───────────────────────────────────────────────────────── */
  function loadAll() {
    $('#panel').innerHTML = '<p class="loading">불러오는 중…</p>';

    var jobs = ORDER.filter(function (k) { return !ENTITIES[k].single; }).map(function (k) {
      return db.from(ENTITIES[k].table).select('*').order('sort_order', { ascending: true })
        .then(function (r) { if (r.error) throw r.error; cache[k] = r.data || []; });
    });
    jobs.push(
      db.from('settings').select('*').eq('id', 1).maybeSingle()
        .then(function (r) { if (r.error) throw r.error; cache.settings = r.data || {}; })
    );

    return Promise.all(jobs).then(function () {
      zoneKeys = (cache.zones || []).map(function (z) { return { key: z.key, label: z.label }; });
      renderTabs();
      renderPanel();
    }).catch(function (e) {
      $('#panel').innerHTML = '<p class="empty">데이터를 불러오지 못했습니다.<br />' + esc(e.message || e) +
        '<br /><br />supabase/schema.sql 을 아직 실행하지 않았다면 먼저 실행해 주세요.</p>';
      toast('불러오기 실패: ' + (e.message || e), true);
    });
  }

  /* ── 쓰기 ───────────────────────────────────────────────────────── */

  /* PostgREST 는 RLS 가 행을 걸러 0건이 처리돼도 error 를 주지 않습니다.
     그래서 .select() 로 "실제로 몇 건이 바뀌었는지" 돌려받아 확인해야
     합니다. 이게 없으면 화면만 바뀌고 DB 는 그대로인 상태가 됩니다. */
  function assertAffected(rows, what) {
    if (rows && rows.length) return rows;
    throw new Error(
      what + ' 대상이 0건이었습니다. 로그인이 풀렸거나, 이 계정에 ' +
      what + ' 권한(RLS)이 없습니다. 로그아웃 후 다시 로그인해 보세요.'
    );
  }
  function saveRow(key, rowEl, btn) {
    var ent = ENTITIES[key];
    var patch = readRow(rowEl, ent);
    btn.disabled = true;

    var op = ent.single
      ? db.from('settings').update(patch).eq('id', 1).select()
      : db.from(ent.table).update(patch).eq('id', rowEl.dataset.id).select();

    op.then(function (r) {
      if (r.error) throw r.error;
      assertAffected(r.data, '저장');
      if (ent.single) cache.settings = r.data[0];
      else {
        var i = Number(rowEl.dataset.i);
        cache[key][i] = r.data[0];
      }
      rowEl.classList.remove('is-dirty');
      var flag = $('[data-flag]', rowEl);
      if (flag) flag.hidden = true;
      var t = $('.row__title', rowEl);
      if (t && !ent.single) t.textContent = ent.title(cache[key][Number(rowEl.dataset.i)]);
      if (key === 'zones') zoneKeys = cache.zones.map(function (z) { return { key: z.key, label: z.label }; });
      toast('저장했습니다.');
    }).catch(function (e) {
      console.error('[admin] 저장 실패', e);
      toast('저장 실패: ' + (e.message || e), true);
    }).then(function () { btn.disabled = false; });
  }

  function addRow(key) {
    var ent = ENTITIES[key];
    var rows = cache[key] || [];
    var next = Object.assign({}, ent.blank, {
      sort_order: rows.reduce(function (m, r) { return Math.max(m, r.sort_order || 0); }, 0) + 1
    });
    if (key === 'booths' && zoneKeys.length) next.zone_key = zoneKeys[0].key;

    db.from(ent.table).insert(next).select().single().then(function (r) {
      if (r.error) throw r.error;
      cache[key].push(r.data);
      openRows[key] = r.data.id;
      if (key === 'zones') zoneKeys = cache.zones.map(function (z) { return { key: z.key, label: z.label }; });
      renderTabs(); renderPanel();
      var el = $('.row.is-open .input, .row.is-open .textarea');
      if (el) el.focus();
      toast('추가했습니다. 내용을 채우고 저장하세요.');
    }).catch(function (e) {
      console.error('[admin] 추가 실패', e);
      toast('추가 실패: ' + (e.message || e), true);
    });
  }

  function deleteRow(key, rowEl) {
    var ent = ENTITIES[key];
    var i = Number(rowEl.dataset.i);
    var label = ent.title(cache[key][i]);
    if (!window.confirm('“' + label + '” 을(를) 삭제할까요?\n되돌릴 수 없습니다.')) return;

    db.from(ent.table).delete().eq('id', rowEl.dataset.id).select().then(function (r) {
      if (r.error) throw r.error;
      assertAffected(r.data, '삭제');
      cache[key].splice(i, 1);
      if (openRows[key] === rowEl.dataset.id) openRows[key] = null;
      if (key === 'zones') zoneKeys = cache.zones.map(function (z) { return { key: z.key, label: z.label }; });
      renderTabs(); renderPanel();
      toast('삭제했습니다.');
    }).catch(function (e) {
      console.error('[admin] 삭제 실패', e);
      toast('삭제 실패: ' + (e.message || e), true);
    });
  }

  /* 위/아래 이동 — 이웃과 sort_order 를 맞바꿉니다. */
  function move(key, i, dir) {
    var rows = cache[key];
    var j = i + dir;
    if (j < 0 || j >= rows.length) return;

    var a = rows[i], b = rows[j];
    var ao = a.sort_order, bo = b.sort_order;
    if (ao === bo) { ao = i; bo = j; }   // 순서값이 같으면 자리번호로 새로 매깁니다

    var table = ENTITIES[key].table;
    Promise.all([
      db.from(table).update({ sort_order: bo }).eq('id', a.id).select(),
      db.from(table).update({ sort_order: ao }).eq('id', b.id).select()
    ]).then(function (res) {
      var bad = res.find(function (r) { return r.error; });
      if (bad) throw bad.error;
      res.forEach(function (r) { assertAffected(r.data, '순서 변경'); });
      a.sort_order = bo; b.sort_order = ao;
      rows[i] = b; rows[j] = a;
      renderPanel();
    }).catch(function (e) {
      console.error('[admin] 순서 변경 실패', e);
      toast('순서 변경 실패: ' + (e.message || e), true);
    });
  }

  /* ── 로그인 ─────────────────────────────────────────────────────── */
  function showApp(session) {
    $('#login').hidden = true;
    $('#setup').hidden = true;
    $('#app').hidden = false;
    $('#who').textContent = session.user.email;
    loadAll();
  }

  function showLogin() {
    $('#app').hidden = true;
    $('#setup').hidden = true;
    $('#login').hidden = false;
  }

  /* config.js 에 adminEmail 이 있으면 이메일 칸을 감춰서, 로그인할 때
     비밀번호만 넣으면 되게 합니다. 계정 자체는 그대로 Supabase 계정이라
     보안은 달라지지 않습니다 — 화면에서 한 칸을 줄인 것뿐입니다.

     화면에는 어떤 계정인지도 띄우지 않습니다. Supabase 로그인이
     이메일 기반이라 config.js 에는 남아 있어야 하지만, 페이지에
     드러낼 이유는 없습니다. */
  function setupLoginForm() {
    var email = (window.FESTIVAL_CONFIG || {}).adminEmail || '';
    if (!email) return;
    $('#emailfield').hidden = true;
    $('#loginform').email.value = email;
  }

  function bindAuth() {
    setupLoginForm();

    $('#loginform').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('#loginbtn');
      var err = $('#loginerror');
      var f = e.target;

      err.hidden = true;
      btn.disabled = true;
      btn.textContent = '확인 중…';

      db.auth.signInWithPassword({
        email: f.email.value.trim(),
        password: f.password.value
      }).then(function (r) {
        if (r.error) throw r.error;
        f.password.value = '';
        showApp(r.data.session);
      }).catch(function (e2) {
        err.textContent = /Invalid login/i.test(e2.message || '')
          ? '이메일 또는 비밀번호가 맞지 않습니다.'
          : (e2.message || '로그인에 실패했습니다.');
        err.hidden = false;
      }).then(function () {
        btn.disabled = false;
        btn.textContent = '로그인';
      });
    });

    $('#logout').addEventListener('click', function () {
      db.auth.signOut().then(showLogin);
    });

    $('#atabs').addEventListener('click', function (e) {
      var b = e.target.closest('.atab');
      if (!b || b.dataset.ent === current) return;

      // 줄을 접을 때와 같은 보호. 다른 탭으로 넘어가면 다시 그리므로
      // 저장하지 않은 값은 사라집니다.
      if ($('.row.is-dirty') && !window.confirm('저장하지 않은 변경이 있습니다.\n이 탭을 떠나면 변경 내용이 사라집니다. 계속할까요?')) return;

      current = b.dataset.ent;
      renderTabs();
      renderPanel();
    });
  }

  /* ── 시작 ───────────────────────────────────────────────────────── */
  if (!window.FestivalData.isConfigured()) {
    $('#setup').hidden = false;
    return;
  }

  db = window.FestivalData.getClient();
  if (!db) {
    $('#setup').hidden = false;
    return;
  }

  bindAuth();

  db.auth.getSession().then(function (r) {
    if (r.data && r.data.session) showApp(r.data.session);
    else showLogin();
  }).catch(showLogin);
})();
