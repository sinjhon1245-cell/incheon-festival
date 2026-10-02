/* ===================================================================
   부스 대기 현황 — 공통 엔진 (window.BoothCore)

   관람객 화면 · 부스 운영자 화면 · QR 인쇄 화면이 함께 씁니다.
   supabase-js 를 싣지 않고 fetch 로 PostgREST 를 바로 부릅니다.
   관람객 화면은 휴대폰 수천 대가 여는 페이지라 100KB 넘는 라이브러리를
   받을 이유가 없고, 로그인도 하지 않기 때문입니다.

   실시간 연결(Realtime)은 쓰지 않습니다. 동시 연결 수와 초당 메시지 수
   한도가 있어서, 부스 하나가 바뀔 때마다 구독자 전원에게 퍼지는 구조로는
   행사 당일 몰리는 접속을 감당하지 못합니다. 모든 화면이 poll() 로
   흩어진 간격을 두고 다시 읽습니다.

   이 파일은 관람객 배포본에도 그대로 들어갑니다. 운영 사이트의 주소나
   운영 페이지 파일 이름을 여기 적지 마세요(주석도). 배포 스크립트가
   그런 흔적을 찾으면 배포를 멈춥니다.

   두 가지 방식으로 돕니다.
     실제 모드  assets/config.js 의 Supabase 로 읽고 씁니다.
     시연 모드  주소에 ?demo 가 있을 때만. assets/mock-data.js 의 예시 부스를
                이 브라우저의 localStorage 에 펼쳐 두고 씁니다. DB 에는 아무것도
                쓰지 않습니다.
   실제 모드에서 읽기에 실패해도 시연 데이터로 대신하지 않습니다.
   관람객에게 꾸며낸 대기 시간을 보여 주면 안 되기 때문입니다.

   ───────────────────────────────────────────────────────────────────
   바깥에 내놓는 것 (window.BoothCore)
   ───────────────────────────────────────────────────────────────────
   상태값
     isMock        boolean   주소에 ?demo 가 있는가 (그것만 봅니다)
     hasConfig     boolean   config.js 에 supabaseUrl 과 키가 모두 있는가
     cfg           object    window.FESTIVAL_CONFIG (없으면 {})
     liveReady     null|boolean  booth_live 표가 있는가. 한 번도 안 읽었으면 null,
                             표가 없으면(PGRST205) false. 시연 모드는 true
     lastOkAt      Date|null 마지막으로 load()·refreshLive() 가 성공한 시각
     STATES        ['여유','보통','혼잡','중단','마감']
     TOKEN_RE      /^[A-Za-z0-9_-]{24}$/       실제 부스 열쇠
     DEMO_TOKEN_RE /^demo-[A-Za-z0-9_-]+$/     시연 열쇠 (isMock 일 때만 인정)

   통신
     request(method, path, body) → Promise<JSON>
         cfg.supabaseUrl + '/rest/v1/' + path 로 보냅니다. 8초 넘으면 끊습니다.
         실패하면 Error 를 던집니다.
           err.offline = true (err.code 'OFFLINE')  끊김 · 시간 초과 · 5xx ·
               JSON 이 아닌 응답(와이파이 로그인 화면 등) · navigator.onLine false
           그 밖: err.code = 서버 code ('PGRST205','PGRST202','42501','22023','P0002' …),
                  err.status, err.message = 서버 message
           설정이 없으면 모든 호출이 err.code 'NO_CONFIG' 로 실패합니다.

   공개 데이터 (로그인 없이 읽는 것)
     getSettings()  → Promise<{event_title, venue, date_label, time_label,
                        event_start, event_end, booth_map_url, booth_map_alt}> (없으면 {})
     getZones()     → Promise<[{key, label, sort_order}]>
     getBoothRows() → Promise<[{id, no, code, zone_key, name, org, program}]>
     getLiveRows()  → Promise<[{booth_id, congestion, wait_minutes, updated_at}] | null>
                      표가 아직 없으면 null 이고 liveReady = false
     load()         → Promise<{settings, zones, booths, liveReady}>
                      booths 는 아래 '정리된 부스' 목록(구역 순 → 코드 순).
                      성공하면 마지막 결과를 localStorage 에 남깁니다(시연 모드 제외).
     snapshot()     → {savedAt(ISO), settings, zones, boothRows, liveRows, liveReady, booths} | null
                      마지막으로 저장해 둔 결과. 새로 읽기 전에 바로 그릴 때 씁니다.
                      booths 는 지금 시각 기준으로 다시 정리한 목록입니다.
     refreshLive()  → Promise<booths>  booth_live 만 다시 읽어 기억해 둔 부스에 합칩니다.
                      아직 load() 가 한 번도 성공하지 않았으면 load() 를 대신 부릅니다.
     normalize(boothRows, liveRows, zones, now?) → booths   (위 정리를 직접 할 때)

     정리된 부스 하나:
       { id, no, code, zone_key, zone_name, name, org, program,
         congestion, wait_minutes, congestion_updated_at }
       code      = b.code 가 비면 zone_key + '-' + pad2(no)   예: 'A-03'
       zone_name = zones 의 label, 없으면 zone_key + '구역'
       congestion · wait_minutes · congestion_updated_at 은 입력이 없거나
       '오늘(한국 날짜)' 입력이 아니면 셋 다 null 입니다.

   되풀이
     poll(fn, baseMs) → stop()
         baseMs ±20% 간격으로 fn 을 부릅니다. 화면이 가려져 있으면 건너뛰고,
         다시 보이면 0~3초 뒤, 인터넷이 돌아오면 곧바로 한 번 부릅니다.
         fn 이 Promise 를 돌려주면 끝나기 전에는 겹쳐 부르지 않습니다.

   상태 · 시간 도우미 (now 는 생략하면 지금. Date · ISO 문자열 · ms 숫자 모두 받습니다)
     meta(congestion)    → {key:'free'|'normal'|'busy'|'pause'|'closed'|'unknown',
                            label:'여유'|'보통'|'혼잡'|'잠시 중단'|'마감'|'정보 없음'}
     staleMinutes()      → number  (cfg.freshnessThresholdMinutes, 기본 30)
     isStale(b, now?)    → boolean 입력이 있고, 마감이 아니고, staleMinutes 보다 오래됨
     bucket(b, now?)     → '여유'|'보통'|'혼잡'|'off'(중단·마감)|'unknown'(없음·오래됨)
                           숫자 · 막대 · 거르기는 모두 이것으로 셉니다.
     ageMinutes(t, now?) → number|null  몇 분 지났는가 (0 이상, 읽을 수 없으면 null)
     formatAgo(t, now?)  → '방금' | 'N분 전' | 'N시간 전'(오늘) | 'M. D. HH:MM' | ''
     formatClock(t)      → 'HH:MM' (한국 시각) | ''
     kstParts(t)         → {y, m, d, hh, mi, min, dow:'일'~'토', day:'YYYY-MM-DD', dayNum} | null
     kstDay(t)           → 'YYYY-MM-DD' (한국 날짜) | ''
     eventPhase(settings, now?) → 'before'|'preopen'|'open'|'dayclosed'|'after'
     eventInfo(settings, now?)  → { phase, dday, nextOpenLabel, nextOpenAt, openTime,
                                    closeTime, todayOpenAt, todayCloseAt }
         dday          첫날까지 남은 날 수 (0 이상)
         nextOpenLabel 다음에 문을 여는 때 '11월 7일(토) 10:00' (없으면 '')
         nextOpenAt    그 시각 Date | null
         openTime · closeTime  '10:00' · '17:00'
         todayOpenAt · todayCloseAt  오늘(한국 날짜) 여는 · 닫는 시각 Date | null
         시연 모드이거나 event_start · event_end 가 비면 phase 는 늘 'open' 이고
         todayOpenAt 은 null 입니다.
     applyOpenRule(booths|booth, info) → 같은 모양
         phase 가 'open' 이면 오늘 문 열기 전에 넣은 값(리허설)을 '없음' 으로 바꾼
         사본을 돌려줍니다. 다른 phase 이거나 todayOpenAt 이 없으면 그대로.
     compareCode(a, b)   → number  'A-2' 와 'A-10' 을 숫자 순서로 견줍니다
     esc(s)              → HTML 에 넣을 수 있게 & < > " ' 를 바꾼 문자열
     pad2(n)             → '03' (두 자리보다 길면 자르지 않습니다)

   부스 운영자용 (부스 QR 열쇠로만 동작)
     validToken(token)   → boolean  TOKEN_RE, 시연 모드에서는 DEMO_TOKEN_RE 도
     demoToken(id)       → 'demo-' + id
     congestionFor(wait) → '여유'(10분 이하)|'보통'(25분 이하)|'혼잡' — 서버와 같은 규칙
     deriveLive(mode, wait) → {congestion, wait_minutes} | null(허용되지 않는 값)
                           mode: 'open'(대기 시간) | 'pause'(잠시 중단) | 'closed'(오늘 마감)
     ctrlGet(token)      → Promise<ctrl부스 | null>  모르는 열쇠면 null
     ctrlSet(token, mode, waitMinutes) → Promise<ctrl부스>
     ctrlTouch(token)    → Promise<ctrl부스>   값은 그대로 두고 '지금 확인' 시각만 새로
         ctrl부스: { id, code, zone_key, zone_name, name, org,
                     congestion, wait_minutes, congestion_updated_at,
                     issued_at, token_tail }   (오늘 입력이 아니면 상태 셋은 null)
         실패: err.offline · err.code '42501'(열쇠 무효)
               · 'NOT_INSTALLED'(DB 설정 전, 또는 anon 실행 권한이 빠짐 — err.dbCode 에 원래 코드)
               · '22023'(허용되지 않는 값, err.message 는 서버 문구) · 'NO_CONFIG'
     ctrlErrorText(err)  → 운영자에게 보여 줄 한국어 문구

   시연 모드 전용
     onDemoChange(fn)    → 끊기 함수. 다른 탭에서 시연 값을 바꾸면 fn({type,id,at}|null)
     resetDemo()         → 시연 값을 처음 상태로 되돌립니다
   =================================================================== */
(function (window) {
  'use strict';

  var cfg = window.FESTIVAL_CONFIG || {};
  var isMock = false;
  try { isMock = new URLSearchParams(window.location.search).has('demo'); } catch (e) { isMock = false; }
  var hasConfig = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);

  var SNAPSHOT_KEY = 'aisw-visitor-snapshot-v1';
  // v3: 아직 누르지 않은 시연 부스의 시각을 '지금 - age_min' 으로 그때그때 셈합니다.
  // v2 로 저장된 값에는 age_min · touched 칸이 없어 모든 부스가 '방금' 이 되므로
  // 이름을 바꿔 새로 펼치게 합니다. 남은 v2 값은 새로 펼칠 때 지웁니다.
  var DEMO_KEY = 'aisw-booth-demo-v3';
  var DEMO_KEY_OLD = 'aisw-booth-demo-v2';
  var DEMO_CHANNEL = 'aisw-booth-demo';
  var TIMEOUT_MS = 8000;
  var DEMO_LATENCY_MS = 150;
  var DEMO_RESEED_MS = 6 * 60 * 60 * 1000;
  // 한국은 1988년 이후 서머타임이 없어 UTC+9 로 고정입니다. 기기 시간대 설정이
  // 무엇이든 같은 답이 나오도록 Intl 대신 이 값으로 계산합니다.
  var KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  var FAR = 1e9; // 정렬에서 '맨 뒤'

  var TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;
  var DEMO_TOKEN_RE = /^demo-[A-Za-z0-9_-]+$/;

  var MSG = {
    NO_CONFIG: '연결 설정을 불러오지 못했습니다. 새로 고침해 주세요.',
    OFFLINE: '네트워크가 불안정합니다.',
    // 서버(booth_ctrl_*)가 내는 문구와 같게 둡니다. 화면에는 ctrlErrorText 가 바꿔 보여 줍니다.
    BAD_TOKEN: '이 QR은 쓸 수 없습니다.',
    BAD_MODE: '허용되지 않는 상태입니다.',
    BAD_WAIT: '대기 시간은 0~180분이어야 합니다.',
    NO_VALUE: '아직 입력한 값이 없습니다. 먼저 대기 시간을 눌러 주세요.',
    CTRL_42501: '이 QR은 이제 쓸 수 없어요. 운영본부에서 새 QR을 받아 다시 찍어 주세요.',
    CTRL_NOT_INSTALLED: '부스 대기 현황 기능이 아직 켜지지 않았어요. 운영본부에 알려 주세요.',
    CTRL_OFFLINE: '연결이 불안정해 저장하지 못했어요.',
    CTRL_OTHER: '저장하지 못했어요. 잠시 뒤 다시 눌러 주세요.'
  };

  var STATES = ['여유', '보통', '혼잡', '중단', '마감'];
  var META = {
    '여유': { key: 'free', label: '여유' },
    '보통': { key: 'normal', label: '보통' },
    '혼잡': { key: 'busy', label: '혼잡' },
    '중단': { key: 'pause', label: '잠시 중단' },
    '마감': { key: 'closed', label: '마감' }
  };
  var UNKNOWN = { key: 'unknown', label: '정보 없음' };

  var BoothCore = {};

  /* ── 작은 도우미 ─────────────────────────────────────────────── */
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 관리 화면(core.js)의 pad2 와 같게, 세 자리 번호는 자르지 않습니다.
  // ('0' + 100).slice(-2) 는 '00' 이 되어 엉뚱한 부스 코드가 됩니다.
  function pad2(n) {
    if (n === null || n === undefined || n === '') return '';
    var s = String(n);
    return s.length < 2 ? '0' + s : s;
  }

  // 'A-2' 와 'A-10' 을 사람 순서대로(숫자는 숫자로) 견줍니다. 관리 화면과 같은 규칙입니다.
  function compareCode(a, b) {
    return String(a == null ? '' : a).localeCompare(String(b == null ? '' : b), 'ko',
      { numeric: true, sensitivity: 'base' });
  }

  function makeError(message, props) {
    var err = new Error(message);
    for (var k in props) if (has(props, k)) err[k] = props[k];
    return err;
  }
  function noConfigError() { return makeError(MSG.NO_CONFIG, { code: 'NO_CONFIG' }); }
  function offlineError(cause) {
    return makeError(MSG.OFFLINE, { code: 'OFFLINE', offline: true, cause: cause || null });
  }

  /* ── 시간 (모두 한국 시각) ───────────────────────────────────── */
  function toMs(v) {
    if (v === null || v === undefined || v === '') return NaN;
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    // PostgREST 는 '…T05:12:33.123456+00:00' 처럼 소수점 여섯 자리를 줍니다.
    // 세 자리를 넘으면 읽지 못하는 옛 사파리가 있어 잘라 냅니다.
    return Date.parse(String(v).replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1'));
  }
  function nowOf(now) {
    var t = (now === undefined || now === null) ? Date.now() : toMs(now);
    return isNaN(t) ? Date.now() : t;
  }

  function kstParts(v) {
    var ms = toMs(v);
    if (isNaN(ms)) return null;
    var k = new Date(ms + KST_OFFSET_MS);
    var y = k.getUTCFullYear(), m = k.getUTCMonth() + 1, d = k.getUTCDate();
    var hh = k.getUTCHours(), mi = k.getUTCMinutes();
    return {
      y: y, m: m, d: d, hh: hh, mi: mi, min: hh * 60 + mi,
      dow: DOW[k.getUTCDay()],
      day: y + '-' + pad2(m) + '-' + pad2(d),
      dayNum: Math.floor((ms + KST_OFFSET_MS) / DAY_MS) // 날짜끼리 빼서 며칠 차이인지 셀 때
    };
  }
  function kstDay(v) { var p = kstParts(v); return p ? p.day : ''; }
  function hhmm(min) { return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60); }
  // 한국 날짜(dayNum)의 어느 시각(분)을 Date 로
  function kstAt(dayNum, min) { return new Date(dayNum * DAY_MS - KST_OFFSET_MS + min * 60000); }

  function formatClock(v) {
    var p = kstParts(v);
    return p ? pad2(p.hh) + ':' + pad2(p.mi) : '';
  }

  function ageMinutes(v, now) {
    var t = toMs(v);
    if (isNaN(t)) return null;
    // 기기 시계가 서버보다 조금 늦으면 음수가 나옵니다. '방금' 으로 봅니다.
    return Math.max(0, Math.floor((nowOf(now) - t) / 60000));
  }

  function formatAgo(v, now) {
    var t = toMs(v);
    if (isNaN(t)) return '';
    var n = nowOf(now);
    var mins = Math.floor((n - t) / 60000);
    if (mins < 1) return '방금';
    if (mins < 60) return mins + '분 전';
    if (kstDay(t) === kstDay(n)) return Math.floor(mins / 60) + '시간 전';
    var p = kstParts(t);
    return p.m + '. ' + p.d + '. ' + pad2(p.hh) + ':' + pad2(p.mi);
  }

  /* ── 행사 시간표 ─────────────────────────────────────────────────
     행사일은 event_start 의 날짜부터 event_end 의 날짜까지(한국 날짜),
     매일 여는 시각은 event_start 의 시각, 닫는 시각은 event_end 의 시각입니다.
     settings 에 '날마다 몇 시부터 몇 시까지' 칸이 따로 없어 이렇게 읽습니다.
     값은 늘 settings 에서 옵니다 — 날짜를 여기 적어 두지 않습니다. */
  function parseTimeLabel(s) {
    var m = /(\d{1,2}):(\d{2})\s*[~\-]\s*(\d{1,2}):(\d{2})/.exec(String(s || ''));
    return m ? [pad2(Number(m[1])) + ':' + m[2], pad2(Number(m[3])) + ':' + m[4]] : null;
  }

  function eventInfo(settings, now) {
    settings = settings || {};
    var label = parseTimeLabel(settings.time_label);
    var info = {
      phase: 'open', dday: 0, nextOpenLabel: '', nextOpenAt: null,
      openTime: label ? label[0] : '', closeTime: label ? label[1] : '',
      todayOpenAt: null, todayCloseAt: null
    };
    var s = kstParts(settings.event_start), e = kstParts(settings.event_end);
    // 시연은 언제 열어 봐도 '운영 중' 화면이어야 하고, 시간표가 비어 있으면
    // 숨길 근거가 없습니다. 둘 다 그대로 보여 줍니다.
    if (isMock || !s || !e) return info;

    var openMin = s.min, closeMin = e.min;
    if (closeMin <= openMin) closeMin = 24 * 60; // 닫는 시각이 여는 시각보다 이르면 자료가 이상한 것 — 그날 끝까지로 봅니다
    info.openTime = hhmm(openMin);
    info.closeTime = hhmm(closeMin);

    var t = kstParts(nowOf(now));
    var today = t.dayNum, first = s.dayNum, last = e.dayNum;
    info.todayOpenAt = kstAt(today, openMin);
    info.todayCloseAt = kstAt(today, closeMin);
    info.dday = Math.max(0, first - today);

    var nextDay = null;
    if (today < first) {
      info.phase = 'before'; nextDay = first;
    } else if (today > last) {
      info.phase = 'after';
    } else if (t.min < openMin) {
      info.phase = 'preopen'; nextDay = today;
    } else if (t.min >= closeMin) {
      if (today >= last) info.phase = 'after';
      else { info.phase = 'dayclosed'; nextDay = today + 1; }
    } else {
      info.phase = 'open';
      if (today + 1 <= last) nextDay = today + 1;
    }
    if (nextDay !== null) {
      info.nextOpenAt = kstAt(nextDay, openMin);
      var p = kstParts(info.nextOpenAt);
      info.nextOpenLabel = p.m + '월 ' + p.d + '일(' + p.dow + ') ' + hhmm(openMin);
    }
    return info;
  }
  function eventPhase(settings, now) { return eventInfo(settings, now).phase; }

  /* 문 열기 전(리허설 · 아침 준비)에 넣은 값은 관람객에게 '지금 대기' 가 아닙니다.
     운영 중일 때만, 오늘 여는 시각보다 이른 입력을 '없음' 으로 돌립니다. */
  function clearLive(b) {
    var c = {};
    for (var k in b) if (has(b, k)) c[k] = b[k];
    c.congestion = null; c.wait_minutes = null; c.congestion_updated_at = null;
    return c;
  }
  function applyOpenRule(booths, info) {
    if (!booths || !info || info.phase !== 'open' || !info.todayOpenAt) return booths;
    var openMs = toMs(info.todayOpenAt);
    function one(b) {
      if (!b || !b.congestion_updated_at) return b;
      return toMs(b.congestion_updated_at) < openMs ? clearLive(b) : b;
    }
    return Object.prototype.toString.call(booths) === '[object Array]' ? booths.map(one) : one(booths);
  }

  /* ── 상태 ────────────────────────────────────────────────────── */
  function meta(congestion) {
    var m = has(META, congestion) ? META[congestion] : UNKNOWN;
    return { key: m.key, label: m.label };
  }
  function staleMinutes() { return Number(cfg.freshnessThresholdMinutes) || 30; }

  // '마감' 은 그날 다시 열지 않으니 오래돼도 흐리게 하지 않습니다.
  function isStale(b, now) {
    if (!b || !b.congestion || b.congestion === '마감') return false;
    var age = ageMinutes(b.congestion_updated_at, now);
    if (age === null) return true;
    return age > staleMinutes();
  }

  // 화면의 숫자 · 막대 · 거르기가 목록과 어긋나지 않도록 모두 이 칸으로 셉니다.
  function bucket(b, now) {
    if (!b || !b.congestion || isStale(b, now)) return 'unknown';
    if (b.congestion === '중단' || b.congestion === '마감') return 'off';
    if (b.congestion === '여유' || b.congestion === '보통' || b.congestion === '혼잡') return b.congestion;
    return 'unknown';
  }

  // 서버(booth_ctrl_set)와 같은 규칙. 운영자 화면의 단추 아래 힌트도 이것으로 만듭니다.
  function congestionFor(wait) {
    var w = Number(wait);
    return w <= 10 ? '여유' : (w <= 25 ? '보통' : '혼잡');
  }
  function deriveLive(mode, wait) {
    if (mode === 'pause') return { congestion: '중단', wait_minutes: 0 };
    if (mode === 'closed') return { congestion: '마감', wait_minutes: 0 };
    if (mode !== 'open') return null;
    if (wait === null || wait === undefined || wait === '') return null;
    var w = Math.round(Number(wait));
    if (isNaN(w) || w < 0 || w > 180) return null;
    return { congestion: congestionFor(w), wait_minutes: w };
  }

  /* ── 통신 ─────────────────────────────────────────────────────────
     현장 와이파이는 응답 없이 매달리거나, 로그인 화면(HTML)을 200 으로
     돌려주기도 합니다. 그런 경우를 모두 '연결 불안정(offline)' 으로 묶어
     화면이 '잘못된 QR' 같은 엉뚱한 안내를 하지 않게 합니다. */
  function request(method, path, body) {
    if (!hasConfig) return Promise.reject(noConfigError());
    return new Promise(function (resolve, reject) {
      var settled = false;
      var ctrl = null;
      try { ctrl = new AbortController(); } catch (e) { ctrl = null; }
      var timer = setTimeout(function () {
        if (ctrl) { try { ctrl.abort(); } catch (e) { /* 이미 끝남 */ } }
        finish(reject, offlineError('timeout'));
      }, TIMEOUT_MS);
      function finish(fn, v) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(v);
      }

      var init = {
        method: method,
        headers: {
          apikey: cfg.supabaseAnonKey,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        cache: 'no-store'
      };
      if (body !== undefined) init.body = JSON.stringify(body);
      if (ctrl) init.signal = ctrl.signal;

      var url = String(cfg.supabaseUrl).replace(/\/+$/, '') + '/rest/v1/' + path;
      var p;
      try { p = window.fetch(url, init); } catch (e) { finish(reject, offlineError(e)); return; }

      p.then(function (res) {
        return res.text().then(function (text) {
          var data = null, parsed = true;
          if (text !== '') {
            try { data = JSON.parse(text); } catch (e) { parsed = false; }
          }
          if (res.status === 0 || res.status >= 500 || !parsed) {
            finish(reject, offlineError('status ' + res.status));
            return;
          }
          if (res.ok) { finish(resolve, data); return; }
          if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            finish(reject, offlineError('navigator offline'));
            return;
          }
          var b = (data && typeof data === 'object') ? data : {};
          finish(reject, makeError(b.message || ('요청이 거절되었습니다 (' + res.status + ')'), {
            code: b.code ? String(b.code) : 'HTTP_' + res.status,
            status: res.status,
            details: b.details || null,
            hint: b.hint || null
          }));
        });
      }).catch(function (e) {
        finish(reject, offlineError(e));
      });
    });
  }

  function rpc(name, args) {
    return request('POST', 'rpc/' + name, args).catch(function (err) {
      // 함수가 없음 = DB 설정(migration-booth-live.sql) 전
      if (err && err.code === 'PGRST202') { err.dbCode = 'PGRST202'; err.code = 'NOT_INSTALLED'; }
      // anon 의 EXECUTE 권한이 빠졌을 때(보안 경고를 '고친다' 며 revoke 한 경우)도
      // PostgREST 는 42501 을 줍니다. 그대로 두면 '이 QR은 이제 쓸 수 없어요' 로 읽혀
      // 운영자 기기가 열쇠를 지우고, 멀쩡한 QR 을 바꾸게 됩니다. 실제 해결책은
      // SQL 을 다시 돌려 권한을 되살리는 것이라 'DB 설정 전' 으로 돌립니다.
      // 함수가 직접 내는 42501 은 고정된 한국어 문구라 이 문구와 겹치지 않습니다.
      // (HTTP 상태로는 가를 수 없습니다 — 둘 다 anon 으로 불러 401 이 옵니다.)
      else if (err && err.code === '42501' && /permission denied/i.test(err.message || '')) {
        err.dbCode = '42501'; err.code = 'NOT_INSTALLED';
      }
      throw err;
    });
  }

  /* ── 시연 모드 저장소 ──────────────────────────────────────────────
     예시 부스를 이 브라우저에 펼쳐 둡니다. 펼친 지 6시간이 지났거나 날짜가
     바뀌면 다시 펼칩니다 — 어제 눌러 둔 값이 남아 '정보 없음' 투성이가
     되거나, 시연할 때마다 손으로 지워야 하는 일을 막습니다.
     아직 아무도 누르지 않은 부스(touched false)는 펼친 시각이 아니라 '지금'
     으로부터 age_min 분 전 값으로 봅니다. 펼친 시각에 묶어 두면 30분 뒤 거의
     모든 부스가 '확인 필요' 로 흐려져, 연수처럼 긴 시연이 30분 만에 무너집니다.
     시연에서 한 번이라도 누른 부스는 실제처럼 그 시각부터 시간이 흐릅니다. */
  var demoMem = null;      // localStorage 를 못 쓰는 브라우저용
  var demoChannel = null;  // null: 아직 안 만듦, false: 지원 안 함

  function codeNo(code) {
    var m = /(\d+)\s*$/.exec(String(code || ''));
    return m ? parseInt(m[1], 10) : null;
  }
  function demoSignature() {
    return (window.MOCK_BOOTHS || []).map(function (m) { return m.id; }).join('|');
  }
  function demoSeed(nowMs) {
    var rows = (window.MOCK_BOOTHS || []).map(function (m) {
      var hasLive = !!m.congestion;
      return {
        id: m.id,
        no: (m.no === null || m.no === undefined) ? codeNo(m.code) : m.no,
        code: m.code || '',
        zone_key: m.zone_key || '',
        zone_label: m.zone_label || '',
        name: m.name || '',
        org: m.org || '',
        program: m.program || '',
        congestion: hasLive ? m.congestion : null,
        wait_minutes: hasLive ? (Number(m.wait_minutes) || 0) : null,
        age_min: hasLive ? (Number(m.age_min) || 0) : null,
        touched: false,
        updated_at: null // 누르기 전에는 demoUpdatedAt 이 그때그때 셈합니다
      };
    });
    return { seededAt: nowMs, sig: demoSignature(), rows: rows };
  }
  // 시연 부스 하나의 '마지막 입력 시각'. 누른 부스는 저장한 시각, 아직 안 누른 부스는
  // 지금 - age_min 입니다(위 설명). 자정 직후에는 45분 · 50분 전이 어제가 되어 날짜
  // 규칙에 지워지므로(오래된 부스 · 마감 예시가 사라짐) 오늘 0시보다 앞으로는 가지 않습니다.
  function demoUpdatedAt(r, nowMs) {
    if (!r || !r.congestion) return null;
    if (r.touched) return r.updated_at || null;
    var now = (typeof nowMs === 'number') ? nowMs : Date.now();
    var t = now - (Number(r.age_min) || 0) * 60000;
    var dayStart = kstAt(kstParts(now).dayNum, 0).getTime();
    return new Date(t < dayStart ? dayStart : t).toISOString();
  }
  function demoSave(st) {
    demoMem = st;
    try { window.localStorage.setItem(DEMO_KEY, JSON.stringify(st)); } catch (e) { /* 메모리로만 */ }
  }
  function demoState() {
    var now = Date.now(), st = null;
    try {
      var raw = window.localStorage.getItem(DEMO_KEY);
      st = raw ? JSON.parse(raw) : null;
    } catch (e) { st = null; }
    if (!st) st = demoMem;
    var fresh = st && st.rows && typeof st.seededAt === 'number' &&
      now - st.seededAt < DEMO_RESEED_MS && now >= st.seededAt &&
      kstDay(st.seededAt) === kstDay(now) && st.sig === demoSignature();
    if (!fresh) {
      st = demoSeed(now);
      demoSave(st);
      // 예전 형식(v2)으로 남은 시연 값은 더 읽지 않으니 치웁니다.
      try { window.localStorage.removeItem(DEMO_KEY_OLD); } catch (e) { /* 무시 */ }
    }
    return st;
  }
  function demoFind(st, token) {
    for (var i = 0; i < st.rows.length; i++) {
      if ('demo-' + st.rows[i].id === token) return st.rows[i];
    }
    return null;
  }
  // 서버를 부른 것처럼 조금 늦게 답합니다. 값은 늦춘 뒤에 읽어 그사이 바뀐 것도 반영합니다.
  function demoAfter(fn) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try { resolve(fn()); } catch (e) { reject(e); }
      }, DEMO_LATENCY_MS);
    });
  }
  function getDemoChannel() {
    if (demoChannel === null) {
      try { demoChannel = new window.BroadcastChannel(DEMO_CHANNEL); } catch (e) { demoChannel = false; }
    }
    return demoChannel || null;
  }
  function demoNotify(id) {
    var ch = getDemoChannel();
    if (!ch) return; // 지원하지 않는 브라우저는 storage 이벤트가 대신 알립니다
    try { ch.postMessage({ type: 'changed', id: id || null, at: Date.now() }); } catch (e) { /* 무시 */ }
  }
  function onDemoChange(fn) {
    if (!isMock || typeof fn !== 'function') return function () {};
    var ch = getDemoChannel();
    var handler;
    if (ch) {
      handler = function (ev) { fn(ev ? ev.data : null); };
      ch.addEventListener('message', handler);
      return function () { ch.removeEventListener('message', handler); };
    }
    handler = function (ev) { if (ev.key === DEMO_KEY) fn(null); };
    window.addEventListener('storage', handler);
    return function () { window.removeEventListener('storage', handler); };
  }
  function resetDemo() {
    if (!isMock) return;
    demoSave(demoSeed(Date.now()));
    demoNotify(null);
  }

  function demoSettings() {
    return {
      event_title: '2026 인천 AI미래채움 교육페스티벌 (시연)',
      venue: '인천 상상플랫폼',
      date_label: '2026. 11. 6.(금) ~ 11. 7.(토)',
      time_label: '10:00 ~ 17:00',
      event_start: null,
      event_end: null,
      booth_map_url: '',
      booth_map_alt: ''
    };
  }
  function demoZones(st) {
    var seen = {}, out = [];
    st.rows.forEach(function (r) {
      if (!r.zone_key || seen[r.zone_key]) return;
      seen[r.zone_key] = true;
      out.push({ key: r.zone_key, label: r.zone_label || '', sort_order: out.length + 1 });
    });
    return out;
  }

  /* ── 정리 ─────────────────────────────────────────────────────── */
  function sortZones(zones) {
    return (zones || []).slice().sort(function (a, b) {
      var sa = (a.sort_order === null || a.sort_order === undefined) ? FAR : Number(a.sort_order);
      var sb = (b.sort_order === null || b.sort_order === undefined) ? FAR : Number(b.sort_order);
      return (sa - sb) || compareCode(a.key, b.key);
    });
  }

  // 오늘(한국 날짜) 넣은 값만 씁니다. 어제 값이나 행사 전 시험 값이 아침에
  // '지금 대기' 처럼 보이면 안 되기 때문입니다.
  function liveFields(l, todayNum) {
    var none = { congestion: null, wait_minutes: null, congestion_updated_at: null };
    if (!l || !l.congestion) return none;
    var p = kstParts(l.updated_at);
    if (!p || p.dayNum !== todayNum) return none;
    return {
      congestion: String(l.congestion),
      wait_minutes: (l.wait_minutes === null || l.wait_minutes === undefined) ? 0 : Number(l.wait_minutes),
      congestion_updated_at: l.updated_at
    };
  }

  function zoneNameOf(labels, key) {
    if (key && labels[key]) return labels[key];
    return key ? key + '구역' : '';
  }

  function normalize(boothRows, liveRows, zones, now) {
    var zs = sortZones(zones);
    var labels = {}, rank = {}, live = {};
    zs.forEach(function (z, i) { labels[z.key] = z.label; rank[z.key] = i; });
    (liveRows || []).forEach(function (l) { if (l && l.booth_id) live[l.booth_id] = l; });
    var todayNum = kstParts(nowOf(now)).dayNum;

    var list = (boothRows || []).map(function (b) {
      var f = liveFields(has(live, b.id) ? live[b.id] : null, todayNum);
      return {
        id: b.id,
        no: (b.no === null || b.no === undefined) ? null : b.no,
        code: b.code ? String(b.code) : (b.zone_key || '') + '-' + pad2(b.no),
        zone_key: b.zone_key || '',
        zone_name: zoneNameOf(labels, b.zone_key),
        name: b.name || '',
        org: b.org || '',
        program: b.program || '',
        congestion: f.congestion,
        wait_minutes: f.wait_minutes,
        congestion_updated_at: f.congestion_updated_at
      };
    });

    // 구역 순서(zones.sort_order → key, 모르는 구역은 맨 뒤) → 부스 코드 순
    list.sort(function (a, b) {
      var ra = has(rank, a.zone_key) ? rank[a.zone_key] : FAR;
      var rb = has(rank, b.zone_key) ? rank[b.zone_key] : FAR;
      return (ra - rb) ||
        (ra === FAR ? compareCode(a.zone_key, b.zone_key) : 0) ||
        compareCode(a.code, b.code);
    });
    return list;
  }

  function normalizeCtrl(r, now) {
    if (!r) return null;
    var f = liveFields({ congestion: r.congestion, wait_minutes: r.wait_minutes, updated_at: r.updated_at },
      kstParts(nowOf(now)).dayNum);
    return {
      id: r.booth_id,
      code: r.code || '',
      zone_key: r.zone_key || '',
      zone_name: r.zone_label || (r.zone_key ? r.zone_key + '구역' : ''),
      name: r.name || '',
      org: r.org || '',
      congestion: f.congestion,
      wait_minutes: f.wait_minutes,
      congestion_updated_at: f.congestion_updated_at,
      issued_at: r.issued_at || null,
      token_tail: r.token_tail || ''
    };
  }

  /* ── 공개 데이터 ───────────────────────────────────────────────────
     화면이 실제로 그리는 칸만 받습니다. booths 의 다른 칸(담당자 연락처 등)은
     관람객 브라우저로 내려보내지 않습니다. */
  var mem = null; // 마지막으로 성공한 load() 결과 {settings, zones, boothRows, liveRows}

  function getSettings() {
    if (isMock) return demoAfter(demoSettings);
    return request('GET', 'settings?select=event_title,venue,date_label,time_label,event_start,event_end,' +
      'booth_map_url,booth_map_alt&order=id.asc&limit=1').then(function (rows) {
      return (rows && rows[0]) || {};
    });
  }

  function getZones() {
    if (isMock) return demoAfter(function () { return demoZones(demoState()); });
    return request('GET', 'zones?select=key,label,sort_order&order=sort_order.asc,key.asc')
      .then(function (rows) { return rows || []; });
  }

  function getBoothRows() {
    if (isMock) {
      return demoAfter(function () {
        return demoState().rows.map(function (r) {
          return { id: r.id, no: r.no, code: r.code, zone_key: r.zone_key, name: r.name, org: r.org, program: r.program };
        });
      });
    }
    return request('GET', 'booths?select=id,no,code,zone_key,name,org,program')
      .then(function (rows) { return rows || []; });
  }

  function getLiveRows() {
    if (isMock) {
      return demoAfter(function () {
        BoothCore.liveReady = true;
        var now = Date.now();
        return demoState().rows.filter(function (r) { return !!r.congestion; }).map(function (r) {
          return { booth_id: r.id, congestion: r.congestion, wait_minutes: r.wait_minutes, updated_at: demoUpdatedAt(r, now) };
        });
      });
    }
    return request('GET', 'booth_live?select=booth_id,congestion,wait_minutes,updated_at').then(function (rows) {
      BoothCore.liveReady = true;
      return rows || [];
    }, function (err) {
      // 표가 없음 = 아직 DB 설정 전. 오류가 아니라 '기능이 꺼져 있음' 으로 다룹니다.
      if (err && err.code === 'PGRST205') {
        BoothCore.liveReady = false;
        return null;
      }
      throw err;
    });
  }

  // 마지막으로 받은 결과를 남겨 두면, 다음에 열 때 서버를 기다리지 않고 바로 그릴 수
  // 있습니다. 꾸며낸 값이 아니라 실제로 받았던 값입니다. 시연 값은 남기지 않습니다.
  function saveSnapshot() {
    if (isMock || !mem) return;
    try {
      window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        settings: mem.settings,
        zones: mem.zones,
        boothRows: mem.boothRows,
        liveRows: mem.liveRows
      }));
    } catch (e) { /* 저장소가 꽉 찼거나 막힘 — 없어도 화면은 돕니다 */ }
  }

  function snapshot() {
    if (isMock) return null;
    var s = null;
    try {
      var raw = window.localStorage.getItem(SNAPSHOT_KEY);
      s = raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
    if (!s || typeof s !== 'object' || !s.boothRows) return null;
    var zones = sortZones(s.zones || []);
    var liveRows = s.liveRows === undefined ? null : s.liveRows;
    return {
      savedAt: s.savedAt || null,
      settings: s.settings || {},
      zones: zones,
      boothRows: s.boothRows,
      liveRows: liveRows,
      liveReady: liveRows !== null,
      booths: normalize(s.boothRows, liveRows, zones)
    };
  }

  function load() {
    return Promise.all([getSettings(), getZones(), getBoothRows(), getLiveRows()]).then(function (r) {
      var zones = sortZones(r[1] || []);
      mem = { settings: r[0] || {}, zones: zones, boothRows: r[2] || [], liveRows: r[3] };
      BoothCore.lastOkAt = new Date();
      saveSnapshot();
      return {
        settings: mem.settings,
        zones: zones,
        booths: normalize(mem.boothRows, mem.liveRows, zones),
        liveReady: mem.liveRows !== null
      };
    });
  }

  function refreshLive() {
    if (!mem) return load().then(function (p) { return p.booths; });
    return getLiveRows().then(function (liveRows) {
      mem.liveRows = liveRows;
      BoothCore.lastOkAt = new Date();
      saveSnapshot();
      return normalize(mem.boothRows, liveRows, mem.zones);
    });
  }

  /* ── 되풀이 ───────────────────────────────────────────────────────
     휴대폰 수천 대가 같은 순간에 읽지 않도록 간격을 ±20% 흩뜨립니다.
     화면이 꺼져 있으면 읽지 않고, 다시 켜졌을 때도 0~3초 흩뜨린 뒤 읽습니다. */
  function poll(fn, baseMs) {
    var base = Number(baseMs) || 20000;
    var stopped = false, busy = false, timer = null, wake = null;

    function run() {
      if (stopped || busy) return;
      var r;
      try { r = fn(); } catch (e) {
        if (window.console) console.error('[BoothCore] 되풀이 작업 오류', e);
        return;
      }
      if (r && typeof r.then === 'function') {
        busy = true;
        r.then(function () { busy = false; }, function () { busy = false; });
      }
    }
    function schedule() {
      clearTimeout(timer);
      if (stopped) return;
      timer = setTimeout(function () {
        if (!document.hidden) run();
        schedule();
      }, base * (0.8 + Math.random() * 0.4));
    }
    function onVisible() {
      if (document.hidden || stopped) return;
      clearTimeout(wake);
      wake = setTimeout(function () { run(); schedule(); }, Math.random() * 3000);
    }
    function onOnline() {
      if (stopped) return;
      run();
      schedule();
    }

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    schedule();

    return function stop() {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(wake);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }

  /* ── 부스 운영자 ───────────────────────────────────────────────────
     열쇠(토큰)는 POST 본문으로만 보냅니다(rpc() 가 늘 POST). 이것은 이
     화면이 지키는 약속이지 서버가 막아 주는 것이 아닙니다. PostgREST 는
     GET /rpc 를 읽기 전용으로 돌릴 뿐, volatile 이어도 쓰지 않는 함수는
     GET 으로 답합니다. 그래서 booth_ctrl_get 은 GET · HEAD 면 일부러
     0줄을 돌려주고, set · touch 는 쓰는 순간 실패합니다. 그래도 그 요청
     주소(?p_token=…)는 이미 Supabase 접속 기록과 중간 장비 기록에
     남으므로 GET 호출은 절대 만들지 마세요(migration-booth-live.sql 맨 위
     설명과 4-1 참고). 모양이 틀린 열쇠는 서버에 묻지 않고 바로 답합니다. */
  function validToken(token) {
    if (typeof token !== 'string') return false;
    return TOKEN_RE.test(token) || (isMock && DEMO_TOKEN_RE.test(token));
  }
  function demoToken(id) { return 'demo-' + id; }

  function badToken() { return makeError(MSG.BAD_TOKEN, { code: '42501' }); }
  function firstRow(rows) {
    var r = (Object.prototype.toString.call(rows) === '[object Array]') ? rows[0] : rows;
    return r ? normalizeCtrl(r) : null;
  }
  function roundWait(w) {
    if (w === null || w === undefined || w === '') return null;
    var n = Math.round(Number(w));
    return isNaN(n) ? null : n;
  }

  function demoCtrlRow(st, row) {
    return {
      booth_id: row.id,
      code: row.code || ((row.zone_key || '') + '-' + pad2(row.no)),
      zone_key: row.zone_key,
      zone_label: row.zone_label,
      name: row.name,
      org: row.org,
      congestion: row.congestion,
      wait_minutes: row.wait_minutes,
      updated_at: demoUpdatedAt(row),
      issued_at: new Date(st.seededAt).toISOString(),
      token_tail: ('demo-' + row.id).slice(-4)
    };
  }

  function ctrlGet(token) {
    if (isMock) {
      return demoAfter(function () {
        if (!validToken(token)) return null;
        var st = demoState();
        var row = demoFind(st, token);
        return row ? normalizeCtrl(demoCtrlRow(st, row)) : null;
      });
    }
    if (!hasConfig) return Promise.reject(noConfigError());
    // 서버도 모양이 틀린 열쇠에는 빈 결과를 줍니다. 같은 답을 묻지 않고 냅니다.
    if (!TOKEN_RE.test(String(token || ''))) return Promise.resolve(null);
    return rpc('booth_ctrl_get', { p_token: token }).then(firstRow);
  }

  function ctrlSet(token, mode, waitMinutes) {
    var wait = roundWait(waitMinutes);
    if (isMock) {
      return demoAfter(function () {
        // 서버와 같은 순서로 따집니다: 열쇠 → 상태 → 대기 시간
        var st = demoState();
        var row = validToken(token) ? demoFind(st, token) : null;
        if (!row) throw badToken();
        if (mode !== 'open' && mode !== 'pause' && mode !== 'closed') {
          throw makeError(MSG.BAD_MODE, { code: '22023' });
        }
        var v = deriveLive(mode, wait);
        if (!v) throw makeError(MSG.BAD_WAIT, { code: '22023' });
        row.congestion = v.congestion;
        row.wait_minutes = v.wait_minutes;
        row.updated_at = new Date().toISOString();
        row.touched = true; // 이제부터는 이 시각부터 실제처럼 시간이 흐릅니다
        demoSave(st);
        demoNotify(row.id);
        return normalizeCtrl(demoCtrlRow(st, row));
      });
    }
    if (!hasConfig) return Promise.reject(noConfigError());
    if (!TOKEN_RE.test(String(token || ''))) return Promise.reject(badToken());
    return rpc('booth_ctrl_set', { p_token: token, p_mode: mode, p_wait_minutes: wait }).then(firstRow);
  }

  function ctrlTouch(token) {
    if (isMock) {
      return demoAfter(function () {
        var st = demoState();
        var row = validToken(token) ? demoFind(st, token) : null;
        if (!row) throw badToken();
        if (!row.congestion) throw makeError(MSG.NO_VALUE, { code: '22023' });
        row.updated_at = new Date().toISOString();
        row.touched = true;
        demoSave(st);
        demoNotify(row.id);
        return normalizeCtrl(demoCtrlRow(st, row));
      });
    }
    if (!hasConfig) return Promise.reject(noConfigError());
    if (!TOKEN_RE.test(String(token || ''))) return Promise.reject(badToken());
    return rpc('booth_ctrl_touch', { p_token: token }).then(firstRow);
  }

  function ctrlErrorText(err) {
    if (!err) return MSG.CTRL_OTHER;
    if (err.offline) return MSG.CTRL_OFFLINE;
    if (err.code === '42501') return MSG.CTRL_42501;
    if (err.code === 'PGRST202' || err.code === 'NOT_INSTALLED') return MSG.CTRL_NOT_INSTALLED;
    if (err.code === '22023') return err.message || MSG.CTRL_OTHER;
    if (err.code === 'NO_CONFIG') return MSG.NO_CONFIG;
    return MSG.CTRL_OTHER;
  }

  /* ── 내보내기 ───────────────────────────────────────────────── */
  BoothCore.isMock = isMock;
  BoothCore.hasConfig = hasConfig;
  BoothCore.cfg = cfg;
  BoothCore.liveReady = isMock ? true : null;
  BoothCore.lastOkAt = null;
  BoothCore.STATES = STATES.slice();
  BoothCore.TOKEN_RE = TOKEN_RE;
  BoothCore.DEMO_TOKEN_RE = DEMO_TOKEN_RE;

  BoothCore.request = request;

  BoothCore.getSettings = getSettings;
  BoothCore.getZones = getZones;
  BoothCore.getBoothRows = getBoothRows;
  BoothCore.getLiveRows = getLiveRows;
  BoothCore.load = load;
  BoothCore.snapshot = snapshot;
  BoothCore.refreshLive = refreshLive;
  BoothCore.normalize = normalize;

  BoothCore.poll = poll;

  BoothCore.meta = meta;
  BoothCore.staleMinutes = staleMinutes;
  BoothCore.isStale = isStale;
  BoothCore.bucket = bucket;
  BoothCore.ageMinutes = ageMinutes;
  BoothCore.formatAgo = formatAgo;
  BoothCore.formatClock = formatClock;
  BoothCore.kstParts = kstParts;
  BoothCore.kstDay = kstDay;
  BoothCore.eventPhase = eventPhase;
  BoothCore.eventInfo = eventInfo;
  BoothCore.applyOpenRule = applyOpenRule;
  BoothCore.compareCode = compareCode;
  BoothCore.esc = esc;
  BoothCore.pad2 = pad2;

  BoothCore.validToken = validToken;
  BoothCore.demoToken = demoToken;
  BoothCore.congestionFor = congestionFor;
  BoothCore.deriveLive = deriveLive;
  BoothCore.ctrlGet = ctrlGet;
  BoothCore.ctrlSet = ctrlSet;
  BoothCore.ctrlTouch = ctrlTouch;
  BoothCore.ctrlErrorText = ctrlErrorText;

  BoothCore.onDemoChange = onDemoChange;
  BoothCore.resetDemo = resetDemo;

  window.BoothCore = BoothCore;
})(window);
