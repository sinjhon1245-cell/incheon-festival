/* ===================================================================
   공용 모달 · 확인 대화상자

   브라우저 기본 prompt/confirm/alert 을 쓰지 않습니다. 사이트와
   같은 디자인이어야 하고, 모바일에서 쓸 수 있어야 하며, 여러 칸을
   한 번에 받아야 하기 때문입니다.

   UI.form({ title, fields, values })  → Promise<값 객체 | null>
   UI.confirm({ title, message })      → Promise<true | false>

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

    if (f.type === 'image') {
      return '<div class="field field--wide">' + label +
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

      // 이 모달에서 올린 이미지들. 저장하지 않고 나가면 쓰이지
      // 않으므로, 보관함에 쌓이기 전에 바로 지웁니다.
      var session = { uploaded: [] };

      function dropUnused(keep) {
        session.uploaded.forEach(function (url) {
          if (keep.indexOf(url) < 0) window.Core.deleteImage(url);
        });
        session.uploaded = [];
      }

      function cancel() { dropUnused([]); close(); resolve(null); }

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
          var first = panel.querySelector('input:not([type="hidden"]):not([type="file"]), select, textarea');
          if (first) first.focus();

          wireImageFields(panel, session);

          Array.prototype.forEach.call(h.querySelectorAll('[data-cancel]'), function (b) {
            b.addEventListener('click', cancel);
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

            // 이미지를 골랐다가 다른 걸로 바꾼 경우, 중간에 올렸던
            // 파일은 어디에도 쓰이지 않으므로 지웁니다.
            var kept = Object.keys(values).map(function (k) { return values[k]; });
            dropUnused(kept);

            var ok = panel.querySelector('#modal-ok');
            ok.disabled = true;
            ok.textContent = '저장 중…';
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

  return { form: form, confirm: confirm, close: close };
})();
