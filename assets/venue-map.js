/* ===================================================================
   행사장 배치도 보기 — 관람객 화면 위에 여는 지도 창
   ───────────────────────────────────────────────────────────────────
   읽기 전용입니다. DB · 스냅샷 · 부스 목록을 건드리지 않고, 그림 한 장을 확대 · 이동해 보여 줍니다.
   그림은 창을 처음 열 때 받습니다(그 전에는 내려받지 않음).
   그림은 주최 측 공식 배치도(map_popview.jpg)를 고치지 않고 그대로 씁니다. /assets 는 1년 캐시라
   그림이 바뀌면 파일 이름의 판 번호를 올리고, 아래 ZONES · ZONE_PARTS · MINI 좌표도 새 그림에서 다시 잽니다.

   움직임: 전체 보기는 그림이 화면 안에 들고 가운데에 놓입니다. 확대해 화면보다 커지면 가장자리가
   화면 밖으로 넘어가지 않게 묶습니다. 확대의 기준은 커서 · 두 손가락의 가운데입니다.
   (경량 라이브러리 @panzoom/panzoom 의 contain 은 'inside' · 'outside' 뿐이라 이 동작을 만들 수 없어
    포인터 이벤트로 직접 씁니다. 의존성은 없습니다.)

   구역 이동: 전체 지도로 물러나(out) → 고른 구역을 주황으로 보여 주고(hold) → 그 구역으로 천천히 확대합니다(in).
   그림 · 강조 · 미니맵을 같은 프레임에 그리려고 CSS 전환 대신 requestAnimationFrame 으로 움직입니다.
   사용자가 직접 조작하면 자동 이동만 끊습니다. 고른 구역과 외곽선은 다른 구역 · 전체 보기 · 닫기까지 남습니다.
   미니맵 사각형은 고른 구역과 상관없이 언제나 실제로 보이는 자리입니다.

   검색 연결: 관람객 화면의 검색 결과가 showBooth() 를 부르면 창을 열고 그 부스가 속한 구역으로 위와 같이 옮깁니다.
   개별 부스 좌표는 없으므로 구역 단위로만 안내합니다. 그림이 아직 없으면 받은 뒤에 옮깁니다.

   window.VenueMap: open(옵션) · close(옵션) · isOpen() · onChange(열림 여부) — 옵션 silent 는 onChange 를 부르지 않습니다.
                    zoneOf(부스) — 지도 구역 이름, 모르면 '' · showBooth(부스, 기관 이름, 닫은 뒤 초점을 돌려줄 요소)
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
  // 주황 테두리 자리. ZONES 는 화면을 맞추는 틀이라 이웃 구역이 섞이는 곳이 있습니다(스쿨 45~84 안의 미래 04~08 등).
  // 그런 구역만 공식 그림의 색 경계로 잰 부스 덩어리(둘레 5px)를 따로 둡니다. 없는 구역은 ZONES 의 틀을 그립니다.
  // 체험존은 공식 자료로 자리가 확인된 체험 01 · 02 만 그립니다(체험 03 · 04 는 '3층' 까지만 확인됨).
  var ZONE_PARTS = {
    'school-b': [[389, 119, 561, 39], [360, 193, 148, 39], [597, 193, 320, 77], [656, 301, 113, 39]],
    future: [[307, 231, 218, 39], [358, 345, 114, 39]],
    experience: [[210, 324, 133, 59]]
  };
  // 이름표는 구역 위에 둡니다. 그러면 부스를 덮는 구역만 가까운 빈 통로에 둡니다. [왼쪽, 세로 가운데]
  var ZONE_TAG = { future: [365, 307.5], experience: [130, 288], promo: [1035, 302] };
  // 앱의 체험5~12 는 공식 범례로 '3층' 까지만 확인됩니다(체험 03 · 04). 1층의 체험 01 · 02 를 가리키지 않도록
  // 배치도에 인쇄된 3층 안내 자리를 대신 표시합니다. 층 안내일 뿐, 개별 장소가 아닙니다.
  var EXP_3F = { parts: [[138, 402, 616, 84]], tag: [138, 530], name: '체험존 3층' };
  var SCHOOL_KEYS = ['초등', '중등', '고등', '특수'];
  var ZONE_MIN = { list: 0.8 };  // 목록은 자리가 아니라 읽을거리라 글자를 읽을 배율부터 보여 줍니다
  var ZONE_PAD = 60;      // 구역 둘레로 함께 보여 줄 통로 · 이웃 부스(원본 px)
  var ZONE_MAX = 1.25;    // 구역으로 옮길 때 원본의 몇 배까지
  var ZONE_MAX_FIT = 1.8; // 아주 큰 화면에서는 전체 보기의 몇 배까지
  var HL_MIN = 22;        // 전체 보기에서도 보이도록 한 칸짜리 구역 테두리의 가장 작은 크기(px)
  // 미니맵은 그림 위쪽의 배치도만 잘라 씁니다(아래 범례 제외). 좌표는 그림과 같습니다.
  var MINI = { x: 0, y: 64, w: 1600, h: 508 };
  var MINI_SEEN = 24;     // 배치도가 이만큼(원본 px)도 안 보이면 자리 대신 '부스 목록 보는 중' 으로 둡니다
  var OUT_MS = 300;       // 전체 지도로 물러나기
  var HOLD_MS = 1000;     // 전체 지도에서 구역을 보여 주는 시간
  var IN_MS = 650;        // 구역으로 확대
  var PAN_MS = 300;       // 미니맵으로 옮기기
  var LIST_MS = 260;      // 부스 명단으로 옮기기(물러나기 · 강조 없이 한 번에)
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
  var tip = document.getElementById('vmap-tip');
  var tipBooth = document.getElementById('vmap-tip-b');
  var tipNote = document.getElementById('vmap-tip-n');
  var btnIn = document.getElementById('vmap-in');
  var btnOut = document.getElementById('vmap-out');
  var btnFit = document.getElementById('vmap-fit');
  var zoneBtns = [].slice.call(dlg.querySelectorAll('[data-vzone]'));
  var hl = document.getElementById('vmap-hl');
  var hlName = document.getElementById('vmap-hl-t');
  var mini = document.getElementById('vmap-mini');
  var miniMap = document.getElementById('vmap-mini-map');
  var miniView = document.getElementById('vmap-mini-view');

  var v = { W: 0, H: 0, vw: 0, vh: 0, fit: 1, s: 1, x: 0, y: 0 };
  var loaded = false, loading = false, open_ = false, raf = 0, hintTimer = 0, hintDone = false;
  var pts = {}, last = null;
  var zone = '', moved = false, phase = '', tween = 0, holdTimer = 0, hlBoxes = [], hlParts = [], hlTag = null, nameW = 0, nameH = 0;
  var want = null, back = null;   // 그림을 받은 뒤 옮길 구역 · 닫은 뒤 초점을 돌려줄 요소

  /* ── 보기 계산 ─────────────────────────────────────────────── */
  function atFit() { return Math.abs(v.s - v.fit) < v.fit * 1e-3; }
  // 움직이는 동안 프레임마다 그리는 것은 이것뿐입니다(단추 상태는 끝날 때 한 번).
  function paintView() {
    img.style.transform = 'translate3d(' + v.x + 'px,' + v.y + 'px,0) scale(' + v.s + ')';
    paintHl();
    paintMini();
  }
  function paintControls() {
    var top = v.fit * MAX_ZOOM;
    btnIn.disabled = !loaded || v.s >= top - 1e-6;
    btnOut.disabled = !loaded || v.s <= v.fit + 1e-6;
    btnFit.disabled = !loaded;
    btnFit.setAttribute('aria-pressed', String(loaded && atFit() && !zone));
    zoneBtns.forEach(function (b) { b.disabled = !loaded; });
  }
  function paint() {
    raf = 0;
    paintView();
    paintControls();
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
  function clampView(s, x, y) {
    s = limit(s);
    return { s: s, x: bound(x, v.W * s, v.vw), y: bound(y, v.H * s + listRoom(s), v.vh) };
  }
  function zoneScale(id) {
    var z = ZONES[id], pad = 2 * ZONE_PAD;
    var s = Math.min(v.vw / (z[2] + pad), v.vh / (z[3] + pad), Math.max(ZONE_MAX, v.fit * ZONE_MAX_FIT));
    return limit(Math.max(s, ZONE_MIN[id] || 0));
  }
  // 명단은 그림 맨 아래에 있어 가장자리 규칙대로면 화면 아래에 붙습니다. 명단을 볼 때만 그림 아래에 빈 자리를 두어
  // 세로 가운데에 놓습니다. 배율에 따라 이어서 늘어 전체 보기에서는 0 이라 드래그 · 확대 · 축소 때 화면이 튀지 않습니다.
  function listRoom(s) {
    if (zone !== 'list') return 0;
    var z = ZONES.list, end = zoneScale('list'), room = v.vh / 2 - (v.H - z[1] - z[3] / 2) * end;
    if (room <= 0 || end <= v.fit) return 0;
    return room * Math.max(0, Math.min(1, (s - v.fit) / (end - v.fit)));
  }
  function place(s, x, y) {
    var c = clampView(s, x, y);
    v.s = c.s;
    v.x = c.x;
    v.y = c.y;
  }
  function setView(s, x, y) { place(s, x, y); schedule(); }
  function zoomAt(factor, cx, cy) {
    var s = limit(v.s * factor), k = s / v.s;
    setView(s, cx - (cx - v.x) * k, cy - (cy - v.y) * k);
  }
  function fitView() { measure(); setView(v.fit, 0, 0); }

  /* ── 자동 이동 ─────────────────────────────────────────────── */
  function calm() { return !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function setPhase(p) { phase = p; stage.dataset.phase = p; }
  function stopAuto() {
    cancelAnimationFrame(tween);
    tween = 0;
    clearTimeout(holdTimer);
    holdTimer = 0;
    setPhase('');
  }
  // 한 점을 고정한 채 배율을 바꾸면 화면에서 곧게 다가갑니다. 배율이 같으면 그대로 옮깁니다.
  // quick: 짧은 전환입니다. 부드러운 곡선을 쓰고, 프레임마다 가장자리로 보정하지 않아 고정점이 흔들리지 않습니다.
  // 명단의 빈 자리를 벗어나 출발할 때도 보정 없이 움직입니다(끝에서 정확한 자리로 맞춥니다).
  function glide(s, x, y, ms, done, quick) {
    cancelAnimationFrame(tween);
    tween = 0;
    var to = clampView(s, x, y), s0 = v.s, x0 = v.x, y0 = v.y, r = to.s / s0, t0 = 0, here = clampView(s0, x0, y0);
    var free = !!quick || Math.abs(here.x - x0) > 0.5 || Math.abs(here.y - y0) > 0.5;
    if (!ms || calm()) {
      place(to.s, to.x, to.y);
      paint();
      if (done) done();
      return;
    }
    var scaled = Math.abs(r - 1) > 1e-3;
    var fx = scaled ? (to.x - x0 * r) / (1 - r) : 0, fy = scaled ? (to.y - y0 * r) / (1 - r) : 0;
    function tick(now) {
      t0 = t0 || now;
      var t = Math.min(1, (now - t0) / ms);
      if (t >= 1) {
        tween = 0;
        place(to.s, to.x, to.y);
        paint();
        if (done) done();
        return;
      }
      // 천천히 시작해 천천히 멈춥니다(보통은 ease-in-out cubic, 짧은 전환은 더 완만한 sine).
      var e = quick ? 0.5 - 0.5 * Math.cos(Math.PI * t) : t < 0.5 ? 4 * t * t * t : 1 - 4 * (1 - t) * (1 - t) * (1 - t);
      var k = scaled ? Math.pow(r, e) : 1;
      var ns = s0 * k, nx = scaled ? fx + (x0 - fx) * k : x0 + (to.x - x0) * e, ny = scaled ? fy + (y0 - fy) * k : y0 + (to.y - y0) * e;
      if (free) { v.s = ns; v.x = nx; v.y = ny; } else place(ns, nx, ny);
      paintView();
      tween = requestAnimationFrame(tick);
    }
    tween = requestAnimationFrame(tick);
  }

  /* ── 구역 이동 ─────────────────────────────────────────────── */
  // 구역과 둘레 ZONE_PAD 가 화면에 들어오는 배율입니다. 읽을 배율을 정한 구역이 넘치면 왼쪽 위부터 보여 줍니다.
  function zoneView(id) {
    var z = ZONES[id], s = zoneScale(id), w = z[2] * s, h = z[3] * s;
    return clampView(s, (w <= v.vw ? (v.vw - w) / 2 : 0) - z[0] * s, (h <= v.vh ? (v.vh - h) / 2 : 0) - z[1] * s);
  }
  function markZone(id) {
    zoneBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.vzone === id)); });
  }
  function zoneName(id) { return dlg.querySelector('[data-vzone="' + id + '"]').textContent; }
  function showHl(id, alt) {
    hlParts = (alt && alt.parts) || ZONE_PARTS[id] || [ZONES[id]];
    hlTag = (alt && alt.tag) || ZONE_TAG[id];
    while (hlBoxes.length > hlParts.length) hl.removeChild(hlBoxes.pop());
    while (hlBoxes.length < hlParts.length) {
      var box = document.createElement('i');
      box.className = 'vmap__hl-box';
      hl.insertBefore(box, hlName);
      hlBoxes.push(box);
    }
    hlName.textContent = (alt && alt.name) || zoneName(id);
    hl.classList.remove('is-soft');
    hl.hidden = false;
    nameW = hlName.offsetWidth;   // 프레임마다 재면 그때마다 레이아웃을 강제하므로 여기서 한 번만 잽니다
    nameH = hlName.offsetHeight;
  }
  // 테두리는 구역 바깥에 그려 부스 번호를 가리지 않습니다(CSS: 테두리 두께만큼 왼쪽 위로 뺌).
  function paintHl() {
    if (!zone) return;
    var parts = hlParts, L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
    parts.forEach(function (p, i) {
      var w = p[2] * v.s, h = p[3] * v.s, l = v.x + p[0] * v.s, t = v.y + p[1] * v.s;
      if (parts.length === 1) {
        var gw = Math.max(0, HL_MIN - w), gh = Math.max(0, HL_MIN - h);
        l -= gw / 2; t -= gh / 2; w += gw; h += gh;
      }
      var st = hlBoxes[i].style;
      st.transform = 'translate(' + l + 'px,' + t + 'px)';
      st.width = w + 'px';
      st.height = h + 'px';
      L = Math.min(L, l); T = Math.min(T, t); R = Math.max(R, l + w); B = Math.max(B, t + h);
    });
    var nx = hlTag ? v.x + hlTag[0] * v.s : L, ny = hlTag ? v.y + hlTag[1] * v.s - nameH / 2 : T - nameH - 10;
    if (ny < 4) ny = B + 10;
    hlName.style.transform = 'translate(' + Math.max(6, Math.min(v.vw - nameW - 6, nx)) + 'px,' + ny + 'px)';
  }
  function clearZone() {
    zone = '';
    moved = false;
    markZone('');
    hl.hidden = true;
    hl.classList.remove('is-soft');
  }
  function settle() {
    setPhase('');
    if (zone) hl.classList.add('is-soft');
  }
  function zoomIn() {
    holdTimer = 0;
    setPhase('in');
    var to = zoneView(zone);
    glide(to.s, to.x, to.y, IN_MS, settle);
  }
  function holdThenZoom() {
    cancelAnimationFrame(tween);
    tween = 0;
    clearTimeout(holdTimer);
    setPhase('hold');
    holdTimer = setTimeout(zoomIn, HOLD_MS);
  }
  // 부스 명단은 자리를 찾는 구역이 아니라 읽을거리입니다. 물러나기 · 강조 시간 없이 지금 보기에서 한 번에 짧게 옮깁니다.
  function goList() {
    stopAuto();
    setPhase('in');
    var to = zoneView('list');
    glide(to.s, to.x, to.y, LIST_MS, settle, true);
  }
  // 흐름 중에 다른 구역을 고르면 앞선 움직임을 끊고 목표를 바꿉니다. 직접 옮긴 뒤 같은 구역을 다시 누르면 다시 찾아갑니다.
  function goZone(id, alt) {
    if (!ZONES[id] || !loaded || (id === zone && !moved)) return;
    hideHint();
    measure();
    zone = id;
    moved = false;
    markZone(id);
    showHl(id, alt);
    setTip(id, alt && alt.text);
    paint();
    if (id === 'list') { goList(); return; }
    if (phase === 'out') return;
    if (phase === 'hold' || atFit()) { holdThenZoom(); return; }
    setPhase('out');
    glide(v.fit, 0, 0, OUT_MS, holdThenZoom);
  }
  function setTip(id, booth) {
    tipNote.hidden = id !== 'experience';
    tipBooth.hidden = !booth;
    tipBooth.textContent = booth || '';
    tip.hidden = tipNote.hidden && tipBooth.hidden;
  }
  function goFit() {
    touched();
    clearZone();
    setTip('');
    measure();
    setPhase('pan');
    glide(v.fit, 0, 0, OUT_MS, settle);
  }

  /* ── 검색 결과에서 부스 찾기 ───────────────────────────────── */
  // 부스 자료의 zone_key · code 만 봅니다. 이름이나 프로그램명에 든 숫자는 번호가 아닙니다.
  function boothNo(b, prefix) {
    var m = new RegExp('^' + prefix + '(\\d+)$').exec(String(b.code || ''));
    return m ? +m[1] : 0;
  }
  function boothZone(b) {
    if (!b) return '';
    var n;
    if (b.zone_key === '미래') { n = boothNo(b, '미래'); return n >= 1 && n <= 9 ? 'future' : ''; }
    if (b.zone_key === '체험') { n = boothNo(b, '체험'); return n >= 1 && n <= 12 ? 'experience' : ''; }
    if (SCHOOL_KEYS.indexOf(b.zone_key) < 0) return '';
    n = boothNo(b, '');
    return n >= 1 && n <= 44 ? 'school-a' : n >= 45 && n <= 84 ? 'school-b' : '';
  }
  function showBooth(b, org, from) {
    var id = boothZone(b);
    if (!id) return;
    var school = SCHOOL_KEYS.indexOf(b.zone_key) >= 0;
    var alt = id === 'experience' && boothNo(b, '체험') >= 5 ? { parts: EXP_3F.parts, tag: EXP_3F.tag, name: EXP_3F.name } : {};
    alt.text = (school ? b.code + '번' : b.code) + ' · ' + (school ? org || b.name : b.name) + ' / ' + (alt.name || zoneName(id));
    open({ from: from });
    if (loaded) goZone(id, alt); else want = { id: id, alt: alt };
  }

  /* ── 미니맵 ────────────────────────────────────────────────── */
  // 화면에 보이는 그림 자리를 배치도 자리로 잘라 % 로 둡니다. 미니맵 크기가 바뀌어도 어긋나지 않습니다.
  function paintMini() {
    var on = loaded && !atFit();
    mini.hidden = !on;
    if (!on) return;
    var l = Math.max(MINI.x, -v.x / v.s), t = Math.max(MINI.y, -v.y / v.s);
    var r = Math.min(MINI.x + MINI.w, (v.vw - v.x) / v.s), b = Math.min(MINI.y + MINI.h, (v.vh - v.y) / v.s);
    var seen = r - l >= MINI_SEEN && b - t >= MINI_SEEN;
    mini.classList.toggle('is-off', !seen);
    if (!seen) return;
    var st = miniView.style;
    st.left = (l - MINI.x) / MINI.w * 100 + '%';
    st.top = (t - MINI.y) / MINI.h * 100 + '%';
    st.width = (r - l) / MINI.w * 100 + '%';
    st.height = (b - t) / MINI.h * 100 + '%';
  }
  mini.addEventListener('click', function (e) {
    var r = miniMap.getBoundingClientRect();
    var px = MINI.x + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * MINI.w;
    var py = MINI.y + Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) * MINI.h;
    touched();
    setPhase('pan');
    glide(v.s, v.vw / 2 - px * v.s, v.vh / 2 - py * v.s, PAN_MS, settle);
  });

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
    // 같은 파일이라 더 받지 않습니다. 세로 위치 % 는 (잘라 낼 위쪽) ÷ (그림 높이 − 보이는 높이) 입니다.
    miniMap.style.backgroundImage = 'url("' + MAP.src + '")';
    miniMap.style.backgroundPosition = '0 ' + MINI.y / (v.H - MINI.h) * 100 + '%';
    showNote('', false);
    // 다음 프레임을 기다리지 않고 바로 그립니다. 프레임이 늦어도 단추가 꺼진 채로 첫 탭을 놓치지 않습니다.
    if (open_) {
      fitView();
      paint();
      if (want) { goZone(want.id, want.alt); want = null; } else showHint();
    }
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
  // 사용자가 직접 움직이면 자동 이동만 끊습니다. 고른 구역은 남기고, 외곽선만 옅게 둡니다.
  function touched() {
    stopAuto();
    hideHint();
    moved = true;
    if (zone) hl.classList.add('is-soft');
    schedule();
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
  btnFit.addEventListener('click', goFit);
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
    if (e.key === '0') { e.preventDefault(); goFit(); }
  });
  // 화면 크기가 바뀌면 고른 구역을 다시 맞춥니다. 직접 옮긴 뒤라면 보던 자리를 가운데에 둔 채 다시 잽니다(전체 보기였으면 다시 전체 보기).
  function onResize() {
    if (!open_ || !loaded) return;
    var wasFit = atFit(), id = moved ? '' : zone;
    var cx = (v.vw / 2 - v.x) / v.s, cy = (v.vh / 2 - v.y) / v.s;
    stopAuto();
    measure();
    if (id) {
      var to = zoneView(id);
      setView(to.s, to.x, to.y);
      settle();
      return;
    }
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
    back = (opt && opt.from) || opener;
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
    want = null;
    touched();
    clearZone();
    setTip('');
    if (dlg.close) dlg.close(); else dlg.removeAttribute('open');
    document.documentElement.classList.remove('vmap-on');
    (back && back.isConnected ? back : opener).focus({ preventScroll: true });
    if (!(opt && opt.silent) && api.onChange) api.onChange(false);
  }

  img.alt = MAP.alt;
  var api = { open: open, close: close, isOpen: function () { return open_; }, onChange: null, zoneOf: boothZone, showBooth: showBooth };
  window.VenueMap = api;
})();
