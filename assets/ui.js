/* ===================================================================
   공용 모달 · 확인 대화상자

   브라우저 기본 prompt/confirm/alert 을 쓰지 않습니다. 사이트와
   같은 디자인이어야 하고, 모바일에서 쓸 수 있어야 하며, 여러 칸을
   한 번에 받아야 하기 때문입니다.

   UI.form({ title, fields, values })  → Promise<값 객체 | null>
     submit: values → Promise 를 주면 창을 연 채로 기다렸다가 그 결과로 끝납니다
   UI.confirm({ title, message })      → Promise<true | false>
   UI.passwordToggle(input) · UI.hidePasswords(root)  비밀번호 보기 단추

   이미지 칸(type: 'image')은 고르는 즉시 올리고 주소를 감춰진 칸에
   담아 둡니다. 제출할 때 올리면 폼이 비동기가 되어 버려서, 지금의
   간단한 구조를 전부 뜯어고쳐야 하기 때문입니다.
   올려 두고 취소하면 그 파일은 쓰이지 않으므로 바로 지웁니다.
   =================================================================== */
window.UI = (function () {
  'use strict';

  var esc = window.Core.esc;
  var host = null;
  var lastFocus = null;

  function ensureHost() {
    if (host) return host;
    host = document.createElement('div');
    host.className = 'modal';
    host.hidden = true;
    document.body.appendChild(host);
    return host;
  }

  /* 열려 있는 동안 탭이 모달 밖으로 나가지 않게 합니다. */
  function trap(e, panel) {
    if (e.key !== 'Tab') return;
    var f = panel.querySelectorAll('button, input, select, textarea, a[href]');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function close() {
    if (!host) return;
    host.hidden = true;
    host.innerHTML = '';
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* onEscape 를 받는 이유: Esc 로 닫을 때도 "취소" 와 똑같이
     처리해야 합니다. 예전에는 그냥 닫기만 해서, 기다리던 약속이
     영영 끝나지 않고 이미지 뒷정리도 건너뛰었습니다. */
  function open(html, onReady, onEscape) {
    lastFocus = document.activeElement;
    var h = ensureHost();
    h.innerHTML = html;
    h.hidden = false;
    document.body.style.overflow = 'hidden';
    var panel = h.querySelector('.modal__panel');
    h.onkeydown = function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (onEscape) onEscape(); else close();
        return;
      }
      trap(e, panel);
    };
    if (onReady) onReady(h, panel);
  }

  /* ── 이미지 칸 ──────────────────────────────────────────────── */
  /* 비어 있을 때도 같은 크기의 자리를 남겨 둡니다. 고르는 순간
     화면이 덜컥 늘어나지 않게 하려는 것입니다. */
  function imgPreview(url) {
    if (!url) {
      return '<div class="imgpick__empty">' +
        '<span class="imgpick__icon" aria-hidden="true">◨</span>' +
        '<span>등록된 이미지가 없습니다</span></div>';
    }
    return '<img src="' + esc(url) + '" alt="" />';
  }

  /* 이미지 칸을 살아 움직이게 만듭니다.
     window.Core 의 uploadImage / deleteImage 를 그대로 씁니다. */
  function wireImageFields(panel, session) {
    var C = window.Core;
    Array.prototype.forEach.call(panel.querySelectorAll('[data-imgpick]'), function (box) {
      var hidden = box.querySelector('[data-k]');
      var view = box.querySelector('.imgpick__view');
      var msg = box.querySelector('.imgpick__msg');
      var clearBtn = box.querySelector('[data-imgclear]');
      var pickLabel = box.querySelector('[data-imgpicklabel]');
      var file = box.querySelector('[data-imgfile]');

      function say(text, isError) {
        msg.textContent = text || '';
        msg.hidden = !text;
        msg.classList.toggle('is-error', !!isError);
      }
      function paint() {
        view.innerHTML = imgPreview(hidden.value);
        clearBtn.hidden = !hidden.value;
        pickLabel.textContent = hidden.value ? '이미지 교체' : '이미지 선택';
      }

      file.addEventListener('change', function () {
        var f = file.files && file.files[0];
        file.value = '';                    // 같은 파일을 다시 골라도 반응하도록
        if (!f) return;

        var bad = C.imageProblem(f);
        if (bad) { say(bad, true); return; }

        // 올라가기 전에 먼저 보여 줍니다. 기다리는 동안 화면이
        // 아무 반응 없으면 눌렸는지조차 알 수 없습니다.
        var local = URL.createObjectURL(f);
        view.innerHTML = '<img src="' + local + '" alt="" />';
        say('올리는 중입니다…');
        box.classList.add('is-busy');

        C.uploadImage(f, box.dataset.folder).then(function (up) {
          // 이 모달 안에서 올린 파일입니다. 취소되면 지워야 합니다.
          session.uploaded.push(up.url);
          hidden.value = up.url;
          URL.revokeObjectURL(local);
          paint();
          say('이미지를 올렸습니다. 저장을 눌러야 반영됩니다.');
        }).catch(function (e) {
          URL.revokeObjectURL(local);
          paint();
          console.error('[ui] 이미지 업로드 실패', e);
          say(uploadMessage(e), true);
        }).then(function () {
          box.classList.remove('is-busy');
        });
      });

      clearBtn.addEventListener('click', function () {
        hidden.value = '';
        paint();
        say('제거했습니다. 저장을 눌러야 반영됩니다.');
      });
    });
  }

  function uploadMessage(e) {
    var m = (e && e.message) || '';
    if (/exceeded the maximum allowed size|Payload too large/i.test(m)) {
      return '이미지가 너무 큽니다. 10MB 이하로 줄여서 올려 주세요.';
    }
    if (/mime type|not supported/i.test(m)) return 'JPG · PNG · WebP 이미지만 올릴 수 있습니다.';
    if (/row-level security|Unauthorized|403/i.test(m)) return '이미지를 올릴 권한이 없습니다. 다시 로그인해 주세요.';
    if (/Bucket not found/i.test(m)) {
      return '이미지 보관함이 아직 없습니다. supabase/migration-media-support.sql 을 실행해 주세요.';
    }
    if (/Failed to fetch|NetworkError/i.test(m)) return '네트워크에 연결하지 못했습니다.';
    return m || '이미지를 올리지 못했습니다.';
  }

  /* ── 여러 줄 입력칸 ───────────────────────────────────────────
     cols 로 칸 모양을 정하고, value 로 지금 있는 줄을 받습니다.
     돌려줄 때는 줄의 배열이 됩니다. 부모를 저장한 쪽에서 이 배열을
     보고 넣고·고치고·지웁니다. */
  function rowsCell(col, v) {
    var val = v == null ? '' : v;
    if (col.type === 'select') {
      return '<select class="select" data-col="' + esc(col.k) + '"' +
        (col.label ? ' aria-label="' + esc(col.label) + '"' : '') + '>' +
        (col.options || []).map(function (o) {
          var ov = Array.isArray(o) ? o[0] : o, ot = Array.isArray(o) ? o[1] : o;
          return '<option value="' + esc(ov) + '"' +
            (String(val) === String(ov) ? ' selected' : '') + '>' + esc(ot) + '</option>';
        }).join('') + '</select>';
    }
    var type = col.type === 'number' ? 'number' : 'text';
    return '<input class="input" type="' + type + '" data-col="' + esc(col.k) + '"' +
      ' value="' + esc(val) + '"' +
      (col.placeholder ? ' placeholder="' + esc(col.placeholder) + '"' : '') +
      (col.label ? ' aria-label="' + esc(col.label) + '"' : '') +
      (col.min != null ? ' min="' + col.min + '"' : '') + ' />';
  }

  function rowsRowHtml(f, row) {
    return '<div class="rowsrow">' +
      f.cols.map(function (c) {
        return '<div class="rowsrow__c"' + (c.wide ? ' data-wide="1"' : '') + '>' +
          rowsCell(c, (row || {})[c.k]) + '</div>';
      }).join('') +
      '<button class="iconbtn iconbtn--sm" type="button" data-rowdel aria-label="이 줄 삭제">✕</button>' +
      '</div>';
  }

  function rowsFieldHtml(f, value) {
    var rows = Array.isArray(value) ? value : [];
    return '<div class="field field--wide">' +
      '<span class="field__label">' + esc(f.label) + '</span>' +
      (f.hint ? '<p class="field__hint field__hint--top">' + esc(f.hint) + '</p>' : '') +
      '<div class="rowsfield" data-rows="' + esc(f.k) + '">' +
        '<div class="rowsfield__list">' + rows.map(function (r) { return rowsRowHtml(f, r); }).join('') + '</div>' +
        '<p class="rowsfield__none"' + (rows.length ? ' hidden' : '') + '>' +
          esc(f.emptyText || '아직 없습니다.') + '</p>' +
        '<div><button class="btn btn--ghost btn--sm" type="button" data-rowadd>' +
          esc(f.addLabel || '+ 추가') + '</button></div>' +
      '</div></div>';
  }

  /* 줄을 더하고 지우는 동작. 지운 자리 다음 줄로 초점을 옮깁니다 —
     지우고 나서 초점이 사라지면 키보드만 쓰는 사람은 길을 잃습니다. */
  function wireRowsFields(panel, fields) {
    Array.prototype.forEach.call(panel.querySelectorAll('[data-rows]'), function (box) {
      var f = fields.filter(function (x) { return x.k === box.dataset.rows; })[0];
      if (!f) return;
      var list = box.querySelector('.rowsfield__list');
      var none = box.querySelector('.rowsfield__none');
      function paint() { none.hidden = !!list.children.length; }

      box.querySelector('[data-rowadd]').addEventListener('click', function () {
        list.insertAdjacentHTML('beforeend', rowsRowHtml(f, f.blank || {}));
        paint();
        var added = list.lastElementChild.querySelector('select, input');
        if (added) added.focus();
      });

      box.addEventListener('click', function (e) {
        var del = e.target.closest('[data-rowdel]');
        if (!del) return;
        var row = del.closest('.rowsrow');
        var next = row.nextElementSibling || row.previousElementSibling;
        row.remove();
        paint();
        var to = next ? next.querySelector('select, input') : box.querySelector('[data-rowadd]');
        if (to) to.focus();
      });
    });
  }

  function readRows(box) {
    return Array.prototype.map.call(box.querySelectorAll('.rowsrow'), function (row) {
      var o = {};
      Array.prototype.forEach.call(row.querySelectorAll('[data-col]'), function (el) {
        var k = el.dataset.col;
        o[k] = el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
      });
      return o;
    });
  }

  /* ── 시각 입력 ──────────────────────────────────────────────────
     브라우저 기본 시각 칸(type="time")을 쓰지 않습니다. 데스크톱 크롬에서는
     시 · 분 목록이 칸 위에 겹쳐 떠서 어디를 고르는지 알기 어렵고, 오전/오후가
     따로 놀아 '오후 2시' 를 고르는 데 여러 번 눌러야 했습니다.

     대신 고르기 상자 두 개를 둡니다.
       [ 오후 2시 ▾ ] [ 30분 ▾ ]
     시 목록이 오전/오후를 함께 말하고, 분은 10분 단위(00 · 10 · … · 50)입니다.
     휴대폰에서는 기기의 목록 선택기(휠)가 그대로 열려 손가락으로 고르기 쉽습니다.
     저장되는 값은 예전과 같은 'HH:MM' 이라 표 · 포털은 바뀌지 않습니다.
     10분 단위가 아닌 예전 값(예: 14:05)은 목록에 끼워 그대로 살립니다 —
     수정창을 열었다 저장해도 값이 바뀌지 않습니다. */
  function hourLabel(h) {
    return (h < 12 ? '오전 ' : '오후 ') + (h % 12 === 0 && h !== 0 ? 12 : h % 12) + '시';
  }
  function timeParts(value) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
    return m ? { h: Number(m[1]), m: Number(m[2]) } : null;
  }
  function timeSelectsHtml(id, k, value, required, label) {
    var p = timeParts(value);
    var hours = '', mins = '';
    // 비어 있으면 '시' · '분' 자리표시를 둡니다. 고른 뒤에는 되돌릴 수 없게(필수 칸) 막습니다.
    hours += '<option value=""' + (p ? '' : ' selected') + (required ? ' disabled' : '') + '>' +
      (required ? '시' : '미정') + '</option>';
    for (var h = 0; h < 24; h++) {
      hours += '<option value="' + h + '"' + (p && p.h === h ? ' selected' : '') + '>' + hourLabel(h) + '</option>';
    }
    var steps = [];
    for (var m = 0; m < 60; m += 10) steps.push(m);
    if (p && steps.indexOf(p.m) < 0) { steps.push(p.m); steps.sort(function (a, b) { return a - b; }); }
    mins += '<option value=""' + (p ? '' : ' selected') + ' disabled>분</option>';
    steps.forEach(function (mm) {
      mins += '<option value="' + mm + '"' + (p && p.m === mm ? ' selected' : '') + '>' +
        (mm < 10 ? '0' : '') + mm + '분</option>';
    });
    return '<div class="timepick" data-timepick role="group" aria-label="' + esc(label) + '">' +
      '<select class="select timepick__h" id="' + id + '" aria-label="' + esc(label) + ' 시">' + hours + '</select>' +
      '<select class="select timepick__m" aria-label="' + esc(label) + ' 분"' + (p ? '' : ' disabled') + '>' + mins + '</select>' +
      '<input type="hidden" data-k="' + esc(k) + '" value="' + esc(p ? pad(p.h) + ':' + pad(p.m) : '') + '" />' +
      '</div>';
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* 목적격 조사. 마지막 글자에 받침이 있으면 '을', 없으면 '를'.
     '일정명을(를)' 처럼 둘 다 적으면 읽다가 걸립니다. */
  function objectJosa(word) {
    var c = String(word).charCodeAt(String(word).length - 1);
    if (c < 0xAC00 || c > 0xD7A3) return '을(를)';
    return (c - 0xAC00) % 28 ? '을' : '를';
  }

  /* 시 · 분 상자를 고를 때마다 감춰진 칸(data-k)에 'HH:MM' 을 맞춰 둡니다.
     시만 고르면 분은 00 으로 채웁니다 — 분이 비어 저장이 막히는 일을 없앱니다.
     시를 '미정' 으로 되돌리면 값도 비웁니다. */
  function wireTimeFields(panel) {
    Array.prototype.forEach.call(panel.querySelectorAll('[data-timepick]'), function (box) {
      var hs = box.querySelector('.timepick__h'), ms = box.querySelector('.timepick__m');
      var hidden = box.querySelector('[data-k]');
      function sync() {
        if (hs.value === '') { hidden.value = ''; ms.disabled = true; }
        else {
          ms.disabled = false;
          if (ms.value === '') ms.value = '0';
          hidden.value = pad(Number(hs.value)) + ':' + pad(Number(ms.value));
        }
        hs.setAttribute('aria-invalid', 'false');
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
      }
      hs.addEventListener('change', sync);
      ms.addEventListener('change', sync);
    });
  }
  // 바깥(시간 범위 단추 등)에서 값을 넣을 때 쓰는 길.
  function setTimeValue(box, hhmm) {
    var p = timeParts(hhmm);
    if (!p) return;
    var hs = box.querySelector('.timepick__h'), ms = box.querySelector('.timepick__m');
    if (!ms.querySelector('option[value="' + p.m + '"]')) {
      ms.insertAdjacentHTML('beforeend', '<option value="' + p.m + '">' + pad(p.m) + '분</option>');
    }
    hs.value = String(p.h); ms.value = String(p.m);
    hs.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* 시작 · 종료를 한 덩어리로 받는 칸(type: 'timespan').
     k = 시작 칸, k2 = 종료 칸. 두 칸은 지금처럼 따로 저장됩니다.
     아래 '종료 빠르게' 단추는 시작 시각에 길이를 더해 종료를 채우고,
     맨 아래 한 줄이 고른 결과(10:00–10:30 · 30분)를 바로 보여 줍니다.
     종료가 시작보다 이르면 그 줄이 빨갛게 바뀝니다 — 저장을 눌러 보기
     전에 알 수 있게 합니다. */
  /* 50분은 체험 회차(50분 운영 + 10분 정리) 길이입니다. */
  var QUICK_DURATIONS = [[30, '+30분'], [50, '+50분'], [60, '+1시간'], [90, '+1시간 30분'], [120, '+2시간']];
  var DEFAULT_DURATION = 30;
  function timespanHtml(f, vals) {
    var req = f.required ? '<span class="field__req" aria-hidden="true">*</span>' : '';
    return '<div class="field field--wide timespan" data-timespan="' + esc(f.k) + '">' +
      '<div class="timespan__row">' +
        '<div class="timespan__col"><label class="field__label" for="m_' + esc(f.k) + '">' + esc(f.label) + req + '</label>' +
          timeSelectsHtml('m_' + f.k, f.k, vals[f.k], f.required, f.label) + '</div>' +
        '<span class="timespan__sep" aria-hidden="true">–</span>' +
        '<div class="timespan__col"><label class="field__label" for="m_' + esc(f.k2) + '">' + esc(f.label2) + req + '</label>' +
          timeSelectsHtml('m_' + f.k2, f.k2, vals[f.k2], f.required, f.label2) + '</div>' +
      '</div>' +
      '<div class="timespan__quick" role="group" aria-label="종료시간 빠르게 정하기">' +
        '<span class="timespan__ql">길이</span>' +
        QUICK_DURATIONS.map(function (d) {
          return '<button class="chip chip--sm" type="button" data-dur="' + d[0] + '">' + d[1] + '</button>';
        }).join('') +
      '</div>' +
      '<p class="timespan__sum" aria-live="polite"></p>' +
      '</div>';
  }
  function wireTimespans(panel) {
    Array.prototype.forEach.call(panel.querySelectorAll('[data-timespan]'), function (box) {
      var picks = box.querySelectorAll('[data-timepick]');
      var a = picks[0], b = picks[1];
      var sum = box.querySelector('.timespan__sum');
      function mins(pick) {
        var p = timeParts(pick.querySelector('[data-k]').value);
        return p ? p.h * 60 + p.m : null;
      }
      function paint() {
        var x = mins(a), y = mins(b);
        box.classList.remove('is-bad');
        if (x == null || y == null) { sum.textContent = '시작과 종료 시각을 골라 주세요.'; return; }
        if (y <= x) {
          box.classList.add('is-bad');
          sum.textContent = '종료시간이 시작시간보다 빠르거나 같습니다.';
          return;
        }
        var d = y - x;
        sum.textContent = pad(Math.floor(x / 60)) + ':' + pad(x % 60) + '–' +
          pad(Math.floor(y / 60)) + ':' + pad(y % 60) + ' · ' +
          (d >= 60 ? Math.floor(d / 60) + '시간' + (d % 60 ? ' ' + (d % 60) + '분' : '') : d + '분');
      }
      function endAt(x, d) {
        var y = Math.min(x + d, 23 * 60 + 50);
        setTimeValue(b, pad(Math.floor(y / 60)) + ':' + pad(y % 60));
      }
      box.addEventListener('change', paint);
      /* 시작을 고르면 종료를 제안합니다(10:00 → 10:30). 종료가 비었거나
         새 시작보다 이르거나 같을 때만 — 이미 맞게 고른 종료는 건드리지 않습니다. */
      a.addEventListener('change', function (e) {
        if (!e.target.matches('[data-k]')) return;
        var x = mins(a), y = mins(b);
        if (x != null && (y == null || y <= x)) endAt(x, DEFAULT_DURATION);
      });
      box.addEventListener('click', function (e) {
        var q = e.target.closest('[data-dur]');
        if (!q) return;
        var x = mins(a);
        if (x == null) { sum.textContent = '시작시간을 먼저 골라 주세요.'; a.querySelector('select').focus(); return; }
        endAt(x, Number(q.getAttribute('data-dur')));
      });
      paint();
    });
  }

  /* 몇 개 중 하나를 고르는 칸(type: 'choice').
     고를 것이 대여섯 개뿐이면 목록을 펼치는 것보다 한 번 눌러 고르는 편이
     빠릅니다. 실제 라디오 단추라 화살표 키로도 옮겨 다닙니다.
     options: [[값, 보이는 글자], …] */
  function choiceHtml(f, value) {
    var id = 'm_' + f.k;
    var req = f.required ? '<span class="field__req" aria-hidden="true">*</span>' : '';
    var list = (f.options || []).slice();
    var has = list.some(function (o) { return String(o[0]) === String(value); });
    // 목록에 없는 예전 값은 지우지 않고 '(이전 값)' 으로 남겨 둡니다.
    if (!has && value !== '' && value != null) { list.push([value, String(value) + ' (이전 값)']); has = true; }
    return '<div class="field' + (f.wide ? ' field--wide' : '') + '">' +
      '<span class="field__label" id="' + id + '_l">' + esc(f.label) + req + '</span>' +
      '<div class="choice" role="radiogroup" aria-labelledby="' + id + '_l"' +
        (f.hint ? ' aria-describedby="' + id + '_h"' : '') + '>' +
      list.map(function (o, i) {
        var on = has ? String(o[0]) === String(value) : (i === 0 && f.required);
        return '<label class="choice__opt"><input type="radio" name="' + id + '" data-k="' + esc(f.k) + '" value="' + esc(o[0]) + '"' +
          (on ? ' checked' : '') + ' /><span>' + esc(o[1]) + '</span></label>';
      }).join('') + '</div>' +
      (f.hint ? '<p class="field__hint" id="' + id + '_h">' + esc(f.hint) + '</p>' : '') + '</div>';
  }

  /* ── 비밀번호 보기 단추 ─────────────────────────────────────────
     눈 모양(보기) ↔ 빗금 친 눈(숨기기). 그림 글자(이모지)는 기기마다 모양이
     달라 쓰지 않고 선 그림(SVG)을 씁니다. 누르면 칸의 type 을 password ↔ text
     로 바꾸고, 읽어 주는 이름(aria-label)도 함께 바꿉니다. 단추는 칸 안
     오른쪽 끝에 44px 정사각형으로 둡니다(손가락으로 누르는 최소 크기). */
  var EYE = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-2.6 3.6"/>' +
    '<path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/>' +
    '<path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M2 2l20 20"/></svg>';

  function eyeButtonHtml(inputId) {
    return '<button class="pwbox__eye" type="button" data-pwtoggle aria-controls="' + esc(inputId) + '"' +
      ' aria-label="비밀번호 보기" aria-pressed="false">' + EYE + '</button>';
  }

  function paintEye(btn, shown) {
    btn.innerHTML = shown ? EYE_OFF : EYE;
    btn.setAttribute('aria-label', shown ? '비밀번호 숨기기' : '비밀번호 보기');
    btn.setAttribute('aria-pressed', shown ? 'true' : 'false');
  }

  /* 화면에 이미 있는 비밀번호 칸(관리자 로그인)에 같은 단추를 붙입니다. */
  function passwordToggle(input) {
    if (!input || input.closest('.pwbox')) return;
    var box = document.createElement('div');
    box.className = 'pwbox';
    input.parentNode.insertBefore(box, input);
    box.appendChild(input);
    box.insertAdjacentHTML('beforeend', eyeButtonHtml(input.id));
  }

  /* 보이게 해 둔 칸을 다시 가립니다(로그인한 뒤 · 화면을 닫을 때). */
  function hidePasswords(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('[data-pwtoggle]'), function (b) {
      var input = document.getElementById(b.getAttribute('aria-controls'));
      if (input && input.type === 'text') input.type = 'password';
      paintEye(b, false);
    });
  }

  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-pwtoggle]') : null;
    if (!b) return;
    var input = document.getElementById(b.getAttribute('aria-controls'));
    if (!input) return;
    var show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    paintEye(b, show);
  });

  /* ── 입력칸 ─────────────────────────────────────────────────── */
  function fieldHtml(f, value, vals) {
    if (f.type === 'rows') return rowsFieldHtml(f, value);
    if (f.type === 'timespan') return timespanHtml(f, vals || {});
    if (f.type === 'choice') return choiceHtml(f, value);
    var id = 'm_' + f.k;
    var wide = f.wide || f.type === 'textarea';
    var req = f.required ? '<span class="field__req" aria-hidden="true">*</span>' : '';
    /* 도움말은 라벨 옆이 아니라 칸 아래 한 줄로 둡니다. 라벨에 이어 붙이면
       좁은 칸에서 라벨이 두세 줄로 접혀 어디까지가 이름인지 흐려집니다. */
    var label = '<label class="field__label" for="' + id + '">' + esc(f.label) + req + '</label>';
    var hint = f.hint ? '<p class="field__hint" id="' + id + '_h">' + esc(f.hint) + '</p>' : '';
    var desc = f.hint ? ' aria-describedby="' + id + '_h"' : '';
    var ph = f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '';

    /* 읽기만 하는 한 줄. 입력칸이 아니라 저장되지 않습니다(data-k 없음).
       f.live(지금 값들) 가 있으면 칸을 고칠 때마다 글을 다시 씁니다(form 참고). */
    if (f.type === 'note') {
      return '<div class="field field--wide">' +
        (f.label ? '<span class="field__label">' + esc(f.label) + '</span>' : '') +
        '<p class="field__note" data-note="' + esc(f.k) + '" aria-live="polite">' + esc(f.text || '') + '</p>' +
        hint + '</div>';
    }

    if (f.type === 'bool') {
      return '<div class="field field--wide"><label class="check">' +
        '<input type="checkbox" id="' + id + '" data-k="' + f.k + '"' + (value ? ' checked' : '') + desc + ' /> ' +
        esc(f.label) + '</label>' + hint + '</div>';
    }

    if (f.type === 'image') {
      return '<div class="field field--wide">' + label + hint +
        '<div class="imgpick" data-imgpick="' + esc(f.k) + '" data-folder="' + esc(f.folder || 'etc') + '">' +
          '<div class="imgpick__view">' + imgPreview(value) + '</div>' +
          '<div class="imgpick__acts">' +
            '<label class="btn btn--ghost btn--sm imgpick__file">' +
              '<span data-imgpicklabel>' + (value ? '이미지 교체' : '이미지 선택') + '</span>' +
              '<input type="file" accept="image/jpeg,image/png,image/webp" data-imgfile hidden />' +
            '</label>' +
            '<button class="btn btn--ghost btn--sm" type="button" data-imgclear' +
              (value ? '' : ' hidden') + '>제거</button>' +
          '</div>' +
          '<p class="imgpick__msg" role="status" hidden></p>' +
          '<input type="hidden" data-k="' + esc(f.k) + '" value="' + esc(value) + '" />' +
        '</div></div>';
    }

    var body;
    if (f.type === 'textarea') {
      body = '<textarea class="textarea" id="' + id + '" data-k="' + f.k + '" rows="3"' + ph + desc +
        (f.required ? ' required' : '') + '>' + esc(value) + '</textarea>';
    } else if (f.type === 'select') {
      body = '<select class="select" id="' + id + '" data-k="' + f.k + '"' + desc + '>' +
        (f.options || []).map(function (o) {
          var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o;
          return '<option value="' + esc(v) + '"' + (String(value) === String(v) ? ' selected' : '') + '>' + esc(t) + '</option>';
        }).join('') + '</select>';
    } else if (f.type === 'number') {
      body = '<input class="input" type="number" id="' + id + '" data-k="' + f.k + '" value="' + esc(value) + '"' +
        (f.min != null ? ' min="' + esc(f.min) + '"' : '') + (f.max != null ? ' max="' + esc(f.max) + '"' : '') +
        (f.step != null ? ' step="' + esc(f.step) + '"' : '') + ' inputmode="numeric"' + ph + desc +
        (f.required ? ' required' : '') + ' />';
    } else if (f.type === 'date') {
      // 날짜만 받는 칸(예: 일정의 일자). 값은 'YYYY-MM-DD' 그대로 오갑니다 —
      // 시각이 없어 시간대 환산이 필요 없습니다(datetime 과 다른 점).
      body = '<input class="input" type="date" id="' + id + '" data-k="' + f.k + '" value="' + esc(value) + '"' +
        (f.min ? ' min="' + esc(f.min) + '"' : '') + (f.max ? ' max="' + esc(f.max) + '"' : '') + desc +
        (f.required ? ' required' : '') + ' />';
    } else if (f.type === 'datetime') {
      body = '<input class="input" type="datetime-local" id="' + id + '" data-k="' + f.k + '" data-dt="1" value="' +
        esc(value) + '"' + desc + ' />';
    } else if (f.type === 'time') {
      body = timeSelectsHtml(id, f.k, value, f.required, f.label);
    } else if (f.type === 'password') {
      // 값을 미리 채우지 않습니다(value 없음). 눈 단추로 잠깐 보이게 할 수 있습니다.
      body = '<div class="pwbox"><input class="input" type="password" id="' + id + '" data-k="' + f.k + '"' +
        ' autocomplete="' + esc(f.autocomplete || 'current-password') + '"' +
        ' autocapitalize="none" autocorrect="off" spellcheck="false"' + desc +
        (f.required ? ' required' : '') + ' />' + eyeButtonHtml(id) + '</div>';
    } else {
      body = '<input class="input" type="' + (f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : f.type === 'url' ? 'url' : 'text') +
        '" id="' + id + '" data-k="' + f.k + '" value="' + esc(value) + '"' + ph + desc +
        (f.required ? ' required' : '') + ' />';
    }
    return '<div class="field' + (wide ? ' field--wide' : '') + '">' + label + body + hint + '</div>';
  }

  function readFields(panel) {
    var out = {};
    // 여러 줄 칸은 통째로 배열이 됩니다. 안쪽 칸은 data-col 이라
    // 아래의 data-k 훑기에 걸리지 않습니다.
    Array.prototype.forEach.call(panel.querySelectorAll('[data-rows]'), function (box) {
      out[box.dataset.rows] = readRows(box);
    });
    Array.prototype.forEach.call(panel.querySelectorAll('[data-k]'), function (el) {
      var k = el.dataset.k;
      // 고르기 칸(choice)은 같은 이름의 라디오 여럿 — 눌린 것 하나만 값입니다.
      if (el.type === 'radio') { if (el.checked) out[k] = el.value; else if (!(k in out)) out[k] = ''; return; }
      if (el.type === 'checkbox') out[k] = el.checked;
      else if (el.type === 'number') out[k] = el.value === '' ? null : Number(el.value);
      else out[k] = el.value;
    });
    return out;
  }

  /* ── 입력 모달 ──────────────────────────────────────────────── */
  function form(opts) {
    return new Promise(function (resolve) {
      var vals = opts.values || {};

      /* 칸이 스무 개씩 늘어서면 어디까지가 한 덩어리인지 알 수 없습니다.
         { type: 'group' } 을 만나면 거기서 새 묶음이 시작됩니다.
         fold 가 붙은 묶음은 접어 둡니다 — 늘 쓰는 칸이 아니라서
         처음 열었을 때 보이지 않는 편이 낫습니다. 접기는 details 를
         그대로 씁니다. 직접 만들면 키보드 동작까지 다시 만들어야 합니다. */
      function cell(f) { return fieldHtml(f, vals[f.k] == null ? '' : vals[f.k], vals); }

      var groups = [], cur = null;
      opts.fields.forEach(function (f) {
        if (f.type === 'group') { cur = { label: f.label, fold: !!f.fold, hint: f.hint, items: [] }; groups.push(cur); return; }
        if (!cur) { cur = { label: null, items: [] }; groups.push(cur); }
        cur.items.push(f);
      });

      var body = groups.map(function (g) {
        var grid = '<div class="modal__grid">' + g.items.map(cell).join('') + '</div>';
        if (!g.label) return grid;
        if (g.fold) {
          return '<details class="fgroup fgroup--fold">' +
            '<summary class="fgroup__sum">' + esc(g.label) + '</summary>' +
            (g.hint ? '<p class="fgroup__hint">' + esc(g.hint) + '</p>' : '') +
            grid + '</details>';
        }
        return '<section class="fgroup">' +
          '<h3 class="fgroup__t">' + esc(g.label) + '</h3>' +
          (g.hint ? '<p class="fgroup__hint">' + esc(g.hint) + '</p>' : '') +
          grid + '</section>';
      }).join('');

      // 이 모달에서 올린 이미지들. 저장하지 않고 나가면 쓰이지
      // 않으므로, 보관함에 쌓이기 전에 바로 지웁니다.
      var session = { uploaded: [] };

      function dropUnused(keep) {
        session.uploaded.forEach(function (url) {
          if (keep.indexOf(url) < 0) window.Core.deleteImage(url);
        });
        session.uploaded = [];
      }

      // opts.submit 이 일하는 동안에는 닫지 않습니다. 닫아도 서버 쪽 일은 멈추지 않아,
      // '취소했는데 바뀌어 있는' 일이 생깁니다.
      var busy = false;
      function cancel() { if (busy) return; dropUnused([]); close(); resolve(null); }

      open(
        '<div class="modal__scrim" data-cancel></div>' +
        '<div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
          '<div class="modal__head">' +
            '<h2 class="modal__title" id="modal-title">' + esc(opts.title) + '</h2>' +
            '<button class="iconbtn" type="button" data-cancel aria-label="닫기">✕</button>' +
          '</div>' +
          '<form class="modal__body" id="modal-form" novalidate>' +
            (opts.desc ? '<p class="modal__desc">' + esc(opts.desc) + '</p>' : '') +
            body +
          '</form>' +
          /* 오류는 저장 단추 바로 위에 둡니다. 본문 맨 끝에 두면 긴 창에서는
             스크롤 아래에 묻혀, 저장을 눌러도 아무 일도 없는 것처럼 보입니다. */
          '<div class="modal__foot">' +
            '<p class="alert alert--error modal__err" id="modal-err" role="alert" hidden></p>' +
            '<button class="btn btn--ghost" type="button" data-cancel>취소</button>' +
            '<button class="btn btn--primary" type="submit" form="modal-form" id="modal-ok">' +
              esc(opts.submitLabel || '저장') + '</button>' +
          '</div>' +
        '</div>',
        function (h, panel) {
          // 접힌 묶음 안은 보이지 않으므로 초점을 두지 않습니다.
          var first = panel.querySelector(
            '.modal__body > .modal__grid, .modal__body > .fgroup:not(.fgroup--fold)');
          first = (first || panel).querySelector(
            'input:not([type="hidden"]):not([type="file"]), select, textarea');
          if (first) first.focus();

          wireImageFields(panel, session);
          wireRowsFields(panel, opts.fields);
          wireTimeFields(panel);
          wireTimespans(panel);

          Array.prototype.forEach.call(h.querySelectorAll('[data-cancel]'), function (b) {
            b.addEventListener('click', cancel);
          });

          /* 본문이 아래로 더 있으면 하단 단추 줄에 옅은 그림자를 둡니다.
             잘린 것이 아니라 스크롤할 내용이 남았다는 표시입니다. */
          var bodyEl = panel.querySelector('.modal__body'), footEl = panel.querySelector('.modal__foot');
          function edge() {
            footEl.classList.toggle('is-floating',
              bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight > 4);
          }
          bodyEl.addEventListener('scroll', edge, { passive: true });
          panel.addEventListener('toggle', edge, true);   // 접힌 묶음을 펼쳤을 때
          edge();

          var err = panel.querySelector('#modal-err');
          // 무엇이든 고치기 시작하면 앞서 띄운 오류는 걷습니다.
          panel.querySelector('#modal-form').addEventListener('change', function () { err.hidden = true; clearFieldErrors(); });

          /* 읽기 전용 줄(note) 가운데 live 가 있는 것은 칸을 고칠 때마다 다시 씁니다.
             예: 부스의 구역 · 번호를 고르면 'A-12' 로 보일지 바로 보여 줍니다. */
          var liveNotes = opts.fields.filter(function (f) { return f.type === 'note' && typeof f.live === 'function'; });
          if (liveNotes.length) {
            var refreshNotes = function () {
              var now = readFields(panel);
              liveNotes.forEach(function (f) {
                var el = panel.querySelector('[data-note="' + f.k + '"]');
                if (el) el.textContent = f.live(now);
              });
            };
            panel.querySelector('#modal-form').addEventListener('input', refreshNotes);
            panel.querySelector('#modal-form').addEventListener('change', refreshNotes);
            refreshNotes();
          }

          /* 오류 칸으로 초점을 옮깁니다. 시각 칸은 감춰진 값 대신 '시' 상자로,
             고르기 칸은 첫 단추로 갑니다. 보이지 않는 칸에 초점을 두면 아무
             일도 일어나지 않은 것처럼 보입니다. */
          /* 칸 아래에도 같은 문구를 한 줄 붙이고(.field__err), 그 칸이 이
             문구를 설명으로 읽게 합니다(aria-describedby). 아래 단추 줄의
             문구만 있으면 긴 창에서 어느 칸 이야기인지 다시 찾아야 합니다. */
          function clearFieldErrors() {
            Array.prototype.forEach.call(panel.querySelectorAll('.field__err'), function (p) { p.remove(); });
            Array.prototype.forEach.call(panel.querySelectorAll('.field.is-bad'), function (f) { f.classList.remove('is-bad'); });
            Array.prototype.forEach.call(panel.querySelectorAll('[data-errfor]'), function (el) {
              var keep = (el.getAttribute('aria-describedby') || '').split(' ')
                .filter(function (id) { return id && id.indexOf('err_') !== 0; }).join(' ');
              if (keep) el.setAttribute('aria-describedby', keep); else el.removeAttribute('aria-describedby');
              el.removeAttribute('data-errfor');
            });
          }
          function focusField(k, msg) {
            var el = panel.querySelector('[data-k="' + k + '"]');
            if (!el) return;
            var pick = el.closest('[data-timepick]');
            var target = pick ? pick.querySelector('.timepick__h') : el;
            var box = (pick && pick.closest('.timespan__col')) || el.closest('.field');
            if (box && msg) {
              var id = 'err_' + k;
              box.classList.add('is-bad');
              box.insertAdjacentHTML('beforeend', '<p class="field__err" id="' + id + '">' + esc(msg) + '</p>');
              var ids = (target.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
              ids.push(id);
              target.setAttribute('aria-describedby', ids.join(' '));
              target.setAttribute('data-errfor', k);
            }
            target.setAttribute('aria-invalid', 'true');
            target.focus();
            if (target.scrollIntoView) target.scrollIntoView({ block: 'center' });
          }
          function fail(msg, k, fieldMsg) {
            clearFieldErrors();
            err.textContent = msg;
            err.hidden = false;
            if (k) focusField(k, fieldMsg || msg);
          }

          panel.querySelector('#modal-form').addEventListener('submit', function (e) {
            e.preventDefault();
            err.hidden = true;

            var values = readFields(panel);

            // 필수값 확인 — 첫 번째 빈 칸으로 초점을 옮깁니다.
            // 시작 · 종료를 한 칸에 받는 timespan 은 두 값을 따로 봅니다.
            var missing = [];
            opts.fields.forEach(function (f) {
              if (!f.required || f.type === 'group' || f.type === 'rows') return;
              function empty(k) { return !String(values[k] == null ? '' : values[k]).trim(); }
              if (empty(f.k)) missing.push({ k: f.k, label: f.label });
              if (f.type === 'timespan' && empty(f.k2)) missing.push({ k: f.k2, label: f.label2 });
            });
            Array.prototype.forEach.call(panel.querySelectorAll('[data-k], .timepick__h'), function (el) {
              el.setAttribute('aria-invalid', 'false');
            });
            if (missing.length) {
              var names = missing.map(function (m) { return m.label; }).join(', ');
              fail(names + objectJosa(names) + ' 입력해 주세요.', missing[0].k,
                missing[0].label + objectJosa(missing[0].label) + ' 입력해 주세요.');
              return;
            }

            /* 추가 검증(시간 순서 · 행사 기간 등)은 호출한 쪽에서 넘겨받습니다.
               글자 하나를 돌려주거나, { message, field } 로 문제 칸까지 알려 줍니다. */
            if (opts.validate) {
              var res = opts.validate(values);
              if (res) {
                if (typeof res === 'string') fail(res);
                else fail(res.message, res.field);
                return;
              }
            }

            // 이미지를 골랐다가 다른 걸로 바꾼 경우, 중간에 올렸던
            // 파일은 어디에도 쓰이지 않으므로 지웁니다.
            var kept = Object.keys(values).map(function (k) { return values[k]; });
            dropUnused(kept);

            var ok = panel.querySelector('#modal-ok');
            ok.disabled = true;
            ok.textContent = opts.busyLabel || '저장 중…';

            /* opts.submit 이 있으면 창을 연 채로 그 일을 기다립니다(예: 비밀번호 변경).
               실패하면 { message, field } 를 받아 그 칸에 오류를 띄우고, 입력한 값은
               그대로 둡니다. 성공하면 submit 의 결과로 끝냅니다 — 입력값(비밀번호 등)을
               부른 쪽에 돌려주지 않습니다. */
            if (opts.submit) {
              busy = true;
              Promise.resolve().then(function () { return opts.submit(values); }).then(function (result) {
                busy = false;
                close();
                resolve(result === undefined ? true : result);
              }, function (e2) {
                busy = false;
                ok.disabled = false;
                ok.textContent = opts.submitLabel || '저장';
                fail((e2 && e2.message) || '처리하지 못했습니다. 다시 시도해 주세요.', e2 && e2.field);
              });
              return;
            }

            close();
            resolve(values);
          });
        },
        cancel
      );
    });
  }

  /* ── 확인 대화상자 ──────────────────────────────────────────── */
  function confirm(opts) {
    return new Promise(function (resolve) {
      open(
        '<div class="modal__scrim" data-cancel></div>' +
        '<div class="modal__panel modal__panel--sm" role="alertdialog" aria-modal="true" aria-labelledby="modal-title">' +
          '<div class="modal__head">' +
            '<h2 class="modal__title" id="modal-title">' + esc(opts.title) + '</h2>' +
            '<button class="iconbtn" type="button" data-cancel aria-label="닫기">✕</button>' +
          '</div>' +
          '<div class="modal__body"><p class="modal__desc">' + esc(opts.message || '') + '</p></div>' +
          '<div class="modal__foot">' +
            '<button class="btn btn--ghost" type="button" data-cancel>취소</button>' +
            '<button class="btn ' + (opts.danger ? 'btn--danger' : 'btn--primary') + '" type="button" id="modal-ok">' +
              esc(opts.confirmLabel || '확인') + '</button>' +
          '</div>' +
        '</div>',
        function (h, panel) {
          panel.querySelector('#modal-ok').focus();
          Array.prototype.forEach.call(h.querySelectorAll('[data-cancel]'), function (b) {
            b.addEventListener('click', function () { close(); resolve(false); });
          });
          panel.querySelector('#modal-ok').addEventListener('click', function () { close(); resolve(true); });
        },
        function () { close(); resolve(false); }
      );
    });
  }

  /* ── 한 번만 보여 주는 창 (예: 방금 만든 운영자 PIN) ─────────────────
     바깥(어두운 바탕)을 눌러도 닫히지 않습니다 — 받아 적기 전에 실수로 닫으면 다시 볼 수
     없는 값이기 때문입니다. 닫기 단추 · ✕ · Esc 로만 닫고, 닫으면 창 안의 내용을 통째로
     지웁니다(close 가 비웁니다). 닫힌 뒤에 resolve 합니다.
     opts: { title, bodyHtml(이미 esc 한 HTML), closeLabel, onReady(panel) } */
  function reveal(opts) {
    return new Promise(function (resolve) {
      function done() { close(); resolve(true); }
      open(
        '<div class="modal__scrim"></div>' +
        '<div class="modal__panel modal__panel--sm" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
          '<div class="modal__head">' +
            '<h2 class="modal__title" id="modal-title">' + esc(opts.title) + '</h2>' +
            '<button class="iconbtn" type="button" data-close aria-label="닫기">✕</button>' +
          '</div>' +
          '<div class="modal__body">' + (opts.bodyHtml || '') + '</div>' +
          '<div class="modal__foot">' +
            '<button class="btn btn--primary" type="button" id="modal-ok">' + esc(opts.closeLabel || '닫기') + '</button>' +
          '</div>' +
        '</div>',
        function (h, panel) {
          panel.querySelector('[data-close]').addEventListener('click', done);
          panel.querySelector('#modal-ok').addEventListener('click', done);
          if (opts.onReady) opts.onReady(panel);
          panel.querySelector('#modal-ok').focus();
        },
        done
      );
    });
  }

  /* ── 고르기 창 (단추 여러 개 중 하나) ─────────────────────────────
     예: 부스 운영 현황의 '현황 수정'(바로 · 5분 … · 잠시 중단 · 오늘 마감).
     opts: { title, desc, choices: [{ v, label, sub, tone }], note }  → 고른 v · 취소면 null */
  function pick(opts) {
    return new Promise(function (resolve) {
      function done(v) { close(); resolve(v); }
      var list = opts.choices || [];
      open(
        '<div class="modal__scrim" data-cancel></div>' +
        '<div class="modal__panel modal__panel--sm" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
          '<div class="modal__head">' +
            '<h2 class="modal__title" id="modal-title">' + esc(opts.title) + '</h2>' +
            '<button class="iconbtn" type="button" data-cancel aria-label="닫기">✕</button>' +
          '</div>' +
          '<div class="modal__body">' +
            (opts.desc ? '<p class="modal__desc">' + esc(opts.desc) + '</p>' : '') +
            '<div class="pickgrid">' + list.map(function (c, i) {
              return '<button class="pickbtn' + (c.tone ? ' pickbtn--' + esc(c.tone) : '') + '" type="button" data-i="' + i + '">' +
                '<span class="pickbtn__l">' + esc(c.label) + '</span>' +
                (c.sub ? '<span class="pickbtn__s">' + esc(c.sub) + '</span>' : '') + '</button>';
            }).join('') + '</div>' +
            (opts.note ? '<p class="pickgrid__note">' + esc(opts.note) + '</p>' : '') +
          '</div>' +
          '<div class="modal__foot">' +
            '<button class="btn btn--ghost" type="button" data-cancel>취소</button>' +
          '</div>' +
        '</div>',
        function (h, panel) {
          Array.prototype.forEach.call(h.querySelectorAll('[data-cancel]'), function (b) {
            b.addEventListener('click', function () { done(null); });
          });
          Array.prototype.forEach.call(panel.querySelectorAll('.pickbtn'), function (b) {
            b.addEventListener('click', function () { done(list[Number(b.getAttribute('data-i'))].v); });
          });
          var first = panel.querySelector('.pickbtn');
          if (first) first.focus();
        },
        function () { done(null); }
      );
    });
  }

  return { form: form, confirm: confirm, reveal: reveal, pick: pick, close: close,
           passwordToggle: passwordToggle, hidePasswords: hidePasswords };
})();
