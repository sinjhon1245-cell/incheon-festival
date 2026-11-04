/* ===================================================================
   행사장 배치도 보기 — 관람객 화면 위에 여는 지도 창
   ───────────────────────────────────────────────────────────────────
   읽기 전용입니다. DB · 스냅샷 · 부스 목록을 건드리지 않고, 그림 한 장을 확대 · 이동해 보여 줍니다.
   그림은 창을 처음 열 때 받습니다(그 전에는 내려받지 않음).
   그림은 주최 측 공식 배치도(map_popview.jpg)를 고치지 않고 그대로 씁니다. /assets 는 1년 캐시라
   그림이 바뀌면 파일 이름의 판 번호를 올리고, 아래 ZONES 좌표도 새 그림에서 다시 잽니다.

   움직임: 전체 보기는 그림이 화면 안에 들고 가운데에 놓입니다. 확대해 화면보다 커지면 가장자리가
   화면 밖으로 넘어가지 않게 묶습니다. 확대의 기준은 커서 · 두 손가락의 가운데입니다.
   (경량 라이브러리 @panzoom/panzoom 의 contain 은 'inside' · 'outside' 뿐이라 이 동작을 만들 수 없어
    포인터 이벤트로 직접 씁니다. 의존성은 없습니다.)

   window.VenueMap: open(옵션) · close(옵션) · isOpen() · onChange(열림 여부) — 옵션 silent 는 onChange 를 부르지 않습니다.
   =================================================================== */
(function () {
  'use strict';

  var MAP = {
    src: 'assets/map/venue-map-v1.jpg',
    alt: '2026 인천 AI미래채움 교육페스티벌 행사장 배치도와 부스 이름 목록'
  };
  // 구역 이동: 공식 배치도(1600×1076)에서 잰 자리입니다. [왼쪽, 위, 폭, 높이]
  var ZONES = {
    'school-a': [1214, 150, 250, 313],   // 스쿨 01~44
    'school-b': [355, 117, 600, 226],    // 스쿨 45~84
    future: [305, 229, 224, 157],        // 미래 01~09
    experience: [130, 318, 630, 172],    // 체험 01 · 02 와 체험 03 · 04 가 열리는 3층 안내
    bigtech: [110, 115, 225, 90],        // Apple · Google
    promo: [1098, 340, 98, 80],          // 홍보존 01~03
    list: [20, 636, 1548, 430]           // 부스 번호 · 이름 목록
  };
  var ZONE_MAX = 2;       // 구역으로 옮길 때 원본의 몇 배까지(작은 구역이 흐려지지 않게)
  var ZONE_READ = 0.8;    // 구역으로 옮길 때 글자를 읽을 수 있는 가장 작은 배율
  var TOOLS_W = 72;       // 오른쪽 조작 단추 자리. 구역이 단추에 가리지 않게 비워 둡니다
  var MAX_ZOOM = 6;       // 전체 보기의 몇 배까지
  var STEP = 1.6;         // + · − 한 번
  var KEY_PAN = 80;       // 방향키 한 번(px)
  var HINT_MS = 5000;

  var dlg = document.getElementById('vmap');
  var opener = document.getElementById('map-open');
  if (!dlg || !opener) return;
  var stage = document.getElementById('vmap-stage');
  var img = document.getElementById('vmap-img');
  var note = document.getElementById('vmap-note');
  var noteText = document.getElementById('vmap-note-t');
  var retry = document.getElementById('vmap-retry');
  var hint = document.getElementById('vmap-hint');
  var btnIn = document.getElementById('vmap-in');
  var btnOut = document.getElementById('vmap-out');
  var btnFit = document.getElementById('vmap-fit');
  var zoneBtns = [].slice.call(dlg.querySelectorAll('[data-vzone]'));

  var v = { W: 0, H: 0, vw: 0, vh: 0, fit: 1, s: 1, x: 0, y: 0 };
  var loaded = false, loading = false, open_ = false, raf = 0, hintTimer = 0, hintDone = false;
  var pts = {}, last = null;

  /* ── 보기 계산 ─────────────────────────────────────────────── */
  function paint() {
    raf = 0;
    img.style.transform = 'translate3d(' + v.x + 'px,' + v.y + 'px,0) scale(' + v.s + ')';
    var top = v.fit * MAX_ZOOM;
    btnIn.disabled = !loaded || v.s >= top - 1e-6;
    btnOut.disabled = !loaded || v.s <= v.fit + 1e-6;
    btnFit.disabled = !loaded;
    zoneBtns.forEach(function (b) { b.disabled = !loaded; });
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(paint); }
  function measure() {
    var r = stage.getBoundingClientRect();
    v.vw = r.width;
    v.vh = r.height;
    if (v.W && v.H) v.fit = Math.min(v.vw / v.W, v.vh / v.H);
  }
  function limit(s) { return Math.min(v.fit * MAX_ZOOM, Math.max(v.fit, s)); }
  // 그림이 화면보다 작은 쪽은 가운데에, 큰 쪽은 가장자리가 안으로 들어오지 않게 둡니다.
  function bound(pos, size, room) { return size <= room ? (room - size) / 2 : Math.min(0, Math.max(room - size, pos)); }
  function setView(s, x, y) {
    v.s = limit(s);
    v.x = bound(x, v.W * v.s, v.vw);
    v.y = bound(y, v.H * v.s, v.vh);
    schedule();
  }
  function zoomAt(factor, cx, cy) {
    var s = limit(v.s * factor), k = s / v.s;
    setView(s, cx - (cx - v.x) * k, cy - (cy - v.y) * k);
  }
  function fitView() { measure(); setView(v.fit, 0, 0); }
  function markZone(id) {
    zoneBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.vzone === id)); });
  }
  // 구역이 화면에 다 들면 가운데에 놓고, 읽을 배율에서 넘치면 구역의 왼쪽 위부터 보여 줍니다.
  function goZone(id) {
    var z = ZONES[id];
    if (!z || !loaded) return;
    touched();
    measure();
    var room = v.vw - TOOLS_W;
    var s = limit(Math.max(ZONE_READ, Math.min(room / z[2], v.vh / z[3], ZONE_MAX)));
    var w = z[2] * s, h = z[3] * s;
    img.classList.add('is-glide');
    setView(s, (w <= room ? (room - w) / 2 : 0) - z[0] * s, (h <= v.vh ? (v.vh - h) / 2 : 0) - z[1] * s);
    markZone(id);
  }

  /* ── 그림 받기 ─────────────────────────────────────────────── */
  function showNote(text, canRetry) {
    note.hidden = !text;
    noteText.textContent = text || '';
    retry.hidden = !canRetry;
  }
  function loadImage() {
    if (loaded || loading) return;
    loading = true;
    showNote('배치도를 불러오는 중이에요', false);
    img.src = MAP.src;
  }
  img.addEventListener('load', function () {
    loading = false;
    loaded = true;
    v.W = img.naturalWidth;
    v.H = img.naturalHeight;
    img.style.width = v.W + 'px';
    img.style.height = v.H + 'px';
    img.hidden = false;
    showNote('', false);
    if (open_) { fitView(); showHint(); }
  });
  img.addEventListener('error', function () {
    if (!img.getAttribute('src')) return;
    loading = false;
    img.hidden = true;
    showNote('배치도를 불러오지 못했어요', true);
    schedule();
  });
  retry.addEventListener('click', function () {
    img.removeAttribute('src');
    loadImage();
  });

  /* ── 조작 안내 ─────────────────────────────────────────────── */
  function hideHint() {
    clearTimeout(hintTimer);
    hint.hidden = true;
    hintDone = true;
  }
  // 사용자가 직접 움직이면 안내 · 구역 표시를 거두고, 구역 이동의 부드러운 움직임도 끕니다.
  function touched() {
    hideHint();
    markZone('');
    img.classList.remove('is-glide');
  }
  function showHint() {
    if (hintDone) return;
    var touch = window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches;
    hint.textContent = touch ? '두 손가락으로 확대하고 드래그하여 이동하세요.' : '마우스 휠로 확대하고 드래그하여 이동하세요.';
    hint.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(hideHint, HINT_MS);
  }

  /* ── 마우스 · 손가락 ───────────────────────────────────────── */
  function at(e) {
    var r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function pair() {
    var ids = Object.keys(pts);
    var a = pts[ids[0]], b = pts[ids[1]];
    return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  function count() { return Object.keys(pts).length; }
  function anchor() {
    var n = count();
    if (n >= 2) last = pair();
    else if (n === 1) { var p = pts[Object.keys(pts)[0]]; last = { x: p.x, y: p.y }; }
    else last = null;
  }
  stage.addEventListener('pointerdown', function (e) {
    if (!loaded || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target.closest && e.target.closest('button')) return;
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 이미 끝난 포인터 */ }
    pts[e.pointerId] = at(e);
    anchor();
    stage.classList.add('is-grab');
    touched();
  });
  stage.addEventListener('pointermove', function (e) {
    if (!pts[e.pointerId]) return;
    pts[e.pointerId] = at(e);
    if (count() >= 2) {
      var p = pair(), s = limit(v.s * (p.d / last.d)), k = s / v.s;
      // 두 손가락 가운데가 가리키던 자리를 새 가운데로 옮깁니다(확대와 이동을 함께).
      setView(s, p.x - (last.x - v.x) * k, p.y - (last.y - v.y) * k);
      last = p;
    } else if (last) {
      var q = pts[e.pointerId];
      setView(v.s, v.x + q.x - last.x, v.y + q.y - last.y);
      last = { x: q.x, y: q.y };
    }
  });
  function release(e) {
    if (!pts[e.pointerId]) return;
    delete pts[e.pointerId];
    anchor();
    if (!count()) stage.classList.remove('is-grab');
  }
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('wheel', function (e) {
    e.preventDefault();
    if (!loaded) return;
    var d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? v.vh : 1);
    if (e.ctrlKey) d *= 4;   // 트랙패드 오므리기는 값이 작습니다
    var p = at(e);
    touched();
    zoomAt(Math.exp(-Math.max(-160, Math.min(160, d)) * 0.0022), p.x, p.y);
  }, { passive: false });
  // iOS Safari 는 touch-action 과 함께 이 동작도 막아야 화면 전체가 확대되지 않습니다.
  ['gesturestart', 'gesturechange'].forEach(function (name) {
    dlg.addEventListener(name, function (e) { e.preventDefault(); });
  });

  /* ── 단추 · 자판 ───────────────────────────────────────────── */
  function zoomCentre(factor) { touched(); zoomAt(factor, v.vw / 2, v.vh / 2); }
  btnIn.addEventListener('click', function () { zoomCentre(STEP); });
  btnOut.addEventListener('click', function () { zoomCentre(1 / STEP); });
  btnFit.addEventListener('click', function () { touched(); fitView(); });
  zoneBtns.forEach(function (b) { b.addEventListener('click', function () { goZone(b.dataset.vzone); }); });
  document.getElementById('vmap-close').addEventListener('click', function () { close(); });
  opener.addEventListener('click', function () { open(); });
  dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
  dlg.addEventListener('keydown', function (e) {
    // 화면의 Esc(상태 고름 풀기 등)까지 가지 않게 여기서 끝냅니다.
    e.stopPropagation();
    if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); close(); return; }
    if (!loaded) return;
    var pan = { ArrowLeft: [KEY_PAN, 0], ArrowRight: [-KEY_PAN, 0], ArrowUp: [0, KEY_PAN], ArrowDown: [0, -KEY_PAN] }[e.key];
    if (pan) { e.preventDefault(); touched(); setView(v.s, v.x + pan[0], v.y + pan[1]); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomCentre(STEP); return; }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomCentre(1 / STEP); return; }
    if (e.key === '0') { e.preventDefault(); touched(); fitView(); }
  });
  // 화면 크기가 바뀌면 보던 자리를 가운데에 둔 채 다시 잽니다(전체 보기였으면 다시 전체 보기).
  function onResize() {
    if (!open_ || !loaded) return;
    var wasFit = Math.abs(v.s - v.fit) < 1e-6;
    var cx = (v.vw / 2 - v.x) / v.s, cy = (v.vh / 2 - v.y) / v.s;
    measure();
    if (wasFit) { setView(v.fit, 0, 0); return; }
    var s = limit(v.s);
    setView(s, v.vw / 2 - cx * s, v.vh / 2 - cy * s);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  /* ── 열기 · 닫기 ───────────────────────────────────────────── */
  function open(opt) {
    if (open_) return;
    open_ = true;
    pts = {};
    last = null;
    document.documentElement.classList.add('vmap-on');
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    stage.focus({ preventScroll: true });
    if (loaded) { fitView(); paint(); } else { schedule(); loadImage(); }
    if (!(opt && opt.silent) && api.onChange) api.onChange(true);
  }
  function close(opt) {
    if (!open_) return;
    open_ = false;
    pts = {};
    last = null;
    stage.classList.remove('is-grab');
    touched();
    if (dlg.close) dlg.close(); else dlg.removeAttribute('open');
    document.documentElement.classList.remove('vmap-on');
    opener.focus({ preventScroll: true });
    if (!(opt && opt.silent) && api.onChange) api.onChange(false);
  }

  img.alt = MAP.alt;
  var api = { open: open, close: close, isOpen: function () { return open_; }, onChange: null };
  window.VenueMap = api;
})();
