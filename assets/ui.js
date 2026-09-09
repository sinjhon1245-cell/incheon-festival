/* ===================================================================
   공용 모달 · 확인 대화상자

   브라우저 기본 prompt/confirm/alert 을 쓰지 않습니다. 사이트와
   같은 디자인이어야 하고, 모바일에서 쓸 수 있어야 하며, 여러 칸을
   한 번에 받아야 하기 때문입니다.

   UI.form({ title, fields, values })  → Promise<값 객체 | null>
   UI.confirm({ title, message })      → Promise<true | false>
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

  function open(html, onReady) {
    lastFocus = document.activeElement;
    var h = ensureHost();
    h.innerHTML = html;
    h.hidden = false;
    document.body.style.overflow = 'hidden';
    var panel = h.querySelector('.modal__panel');
    h.onkeydown = function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      trap(e, panel);
    };
    if (onReady) onReady(h, panel);
  }

  /* ── 입력칸 ─────────────────────────────────────────────────── */
  function fieldHtml(f, value) {
    var id = 'm_' + f.k;
    var wide = f.wide || f.type === 'textarea';
    var req = f.required ? '<span class="field__req" aria-hidden="true">*</span>' : '';
    var label = '<label class="field__label" for="' + id + '">' + esc(f.label) + req +
      (f.hint ? ' <span style="font-weight:500;opacity:.75">· ' + esc(f.hint) + '</span>' : '') + '</label>';

    if (f.type === 'bool') {
      return '<div class="field field--wide"><label class="check">' +
        '<input type="checkbox" id="' + id + '" data-k="' + f.k + '"' + (value ? ' checked' : '') + ' /> ' +
        esc(f.label) + '</label></div>';
    }

    var body;
    if (f.type === 'textarea') {
      body = '<textarea class="textarea" id="' + id + '" data-k="' + f.k + '" rows="3"' +
        (f.required ? ' required' : '') + '>' + esc(value) + '</textarea>';
    } else if (f.type === 'select') {
      body = '<select class="select" id="' + id + '" data-k="' + f.k + '">' +
        (f.options || []).map(function (o) {
          var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o;
          return '<option value="' + esc(v) + '"' + (String(value) === String(v) ? ' selected' : '') + '>' + esc(t) + '</option>';
        }).join('') + '</select>';
    } else if (f.type === 'number') {
      body = '<input class="input" type="number" id="' + id + '" data-k="' + f.k + '" value="' + esc(value) + '"' +
        (f.required ? ' required' : '') + ' />';
    } else if (f.type === 'datetime') {
      body = '<input class="input" type="datetime-local" id="' + id + '" data-k="' + f.k + '" data-dt="1" value="' +
        esc(value) + '" />';
    } else if (f.type === 'time') {
      body = '<input class="input" type="time" id="' + id + '" data-k="' + f.k + '" value="' + esc(value) + '"' +
        (f.required ? ' required' : '') + ' />';
    } else {
      body = '<input class="input" type="' + (f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text') +
        '" id="' + id + '" data-k="' + f.k + '" value="' + esc(value) + '"' +
        (f.required ? ' required' : '') + ' />';
    }
    return '<div class="field' + (wide ? ' field--wide' : '') + '">' + label + body + '</div>';
  }

  function readFields(panel) {
    var out = {};
    Array.prototype.forEach.call(panel.querySelectorAll('[data-k]'), function (el) {
      var k = el.dataset.k;
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
      var body = opts.fields.map(function (f) {
        return fieldHtml(f, vals[f.k] == null ? '' : vals[f.k]);
      }).join('');

      open(
        '<div class="modal__scrim" data-cancel></div>' +
        '<div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
          '<div class="modal__head">' +
            '<h2 class="modal__title" id="modal-title">' + esc(opts.title) + '</h2>' +
            '<button class="iconbtn" type="button" data-cancel aria-label="닫기">✕</button>' +
          '</div>' +
          '<form class="modal__body" id="modal-form" novalidate>' +
            (opts.desc ? '<p class="modal__desc">' + esc(opts.desc) + '</p>' : '') +
            '<div class="modal__grid">' + body + '</div>' +
            '<p class="alert alert--error" id="modal-err" role="alert" hidden></p>' +
          '</form>' +
          '<div class="modal__foot">' +
            '<button class="btn btn--ghost" type="button" data-cancel>취소</button>' +
            '<button class="btn btn--primary" type="submit" form="modal-form" id="modal-ok">' +
              esc(opts.submitLabel || '저장') + '</button>' +
          '</div>' +
        '</div>',
        function (h, panel) {
          var first = panel.querySelector('input, select, textarea');
          if (first) first.focus();

          Array.prototype.forEach.call(h.querySelectorAll('[data-cancel]'), function (b) {
            b.addEventListener('click', function () { close(); resolve(null); });
          });

          panel.querySelector('#modal-form').addEventListener('submit', function (e) {
            e.preventDefault();
            var err = panel.querySelector('#modal-err');
            err.hidden = true;

            var values = readFields(panel);

            // 필수값 확인 — 첫 번째 빈 칸으로 초점을 옮깁니다.
            var missing = opts.fields.filter(function (f) {
              return f.required && !String(values[f.k] == null ? '' : values[f.k]).trim();
            });
            Array.prototype.forEach.call(panel.querySelectorAll('[data-k]'), function (el) {
              el.setAttribute('aria-invalid', 'false');
            });
            if (missing.length) {
              err.textContent = missing.map(function (f) { return f.label; }).join(', ') + '을(를) 입력해 주세요.';
              err.hidden = false;
              var bad = panel.querySelector('[data-k="' + missing[0].k + '"]');
              if (bad) { bad.setAttribute('aria-invalid', 'true'); bad.focus(); }
              return;
            }

            // 추가 검증(시간 순서 등)은 호출한 쪽에서 넘겨받습니다.
            if (opts.validate) {
              var msg = opts.validate(values);
              if (msg) {
                err.textContent = msg;
                err.hidden = false;
                return;
              }
            }

            var ok = panel.querySelector('#modal-ok');
            ok.disabled = true;
            ok.textContent = '저장 중…';
            close();
            resolve(values);
          });
        }
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
        }
      );
    });
  }

  return { form: form, confirm: confirm, close: close };
})();
