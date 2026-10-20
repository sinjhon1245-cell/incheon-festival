/* ===================================================================
   리허설 공통 PIN · 개별 PIN 상태 — 관리 화면 표시용(부스 운영 현황 · QR · PIN 관리 · 관리자 부스 관리)
   ───────────────────────────────────────────────────────────────────
   서버가 실제 부스의 공통 PIN 로그인을 받는 조건(Production 10-19 판)을 화면에서 같은 순서로 따라 합니다.
     로그인 함수(booth_pin_login)  : PIN 보조 로그인 스위치(settings.booth_pin_enabled) 켜짐
     private.rehearsal_common_pin_open : 리허설 대상(admin_rehearsal_status.target_ids) · 지금 < 끝나는 때 ·
                                         개별 PIN 줄 없음 · 개별 PIN 발급 · 재발급 · 끄기 기록 없음
     private.booth_common_pin_target   : 부스 공개 · 구역 공개 · 번호 있음 · '[예시]' 아님
   화면이 볼 수 없는 것은 발급 기록(booth_auth_event)뿐입니다. 개별 PIN 줄(booth_pin)은 발급하면 생기고
   끄기로도 지워지지 않으므로 '줄 없음' 이 곧 '기록 없음' 입니다 — 줄을 SQL 로 직접 지운 경우만 다릅니다.
   끝나는 때 = private.rehearsal_common_pin_until() = least(2026-11-05 23:00 KST, 행사 첫날 00:00 KST).
   아래 END 는 그 함수의 시각과 같아야 합니다(시험이 migration 파일과 견줍니다).
   이 파일은 읽기만 합니다. DB 에 쓰거나 PIN · 인증 함수를 부르지 않습니다.
   =================================================================== */
(function () {
  'use strict';

  var END = '2026-11-05T23:00:00+09:00';
  var END_MS = Date.parse(END);
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];

  // 공통 PIN 이 끝나는 때(ms). cutoff = admin_rehearsal_status 의 행사 첫날('YYYY-MM-DD', 한국 날짜).
  function endOf(cutoff) {
    var c = /^\d{4}-\d{2}-\d{2}$/.test(String(cutoff || '')) ? Date.parse(cutoff + 'T00:00:00+09:00') : NaN;
    return isFinite(c) ? Math.min(END_MS, c) : END_MS;
  }
  // '11월 5일(목) 23:00' (한국 시각)
  function endText(ms) {
    var d = new Date(ms + 9 * 3600e3);
    var hh = d.getUTCHours(), mi = d.getUTCMinutes();
    return (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일(' + DOW[d.getUTCDay()] + ') ' +
      (hh < 10 ? '0' : '') + hh + ':' + (mi < 10 ? '0' : '') + mi;
  }

  // 개별 PIN — admin_booth_credentials 의 pin_state('on' · 'off' · 'none'). 모르면 'unk'.
  var INDIVIDUAL = { on: '개별 PIN 발급됨', off: '개별 PIN 꺼짐', none: '개별 PIN 미발급', unk: '개별 PIN 확인 불가' };
  function individual(pinState) {
    var k = pinState === 'on' || pinState === 'off' ? pinState : (pinState === 'none' ? 'none' : 'unk');
    return { key: k, label: INDIVIDUAL[k] };
  }

  /* 한 부스의 리허설 공통 PIN 상태. o = { target, shown, pinState, switchOn, end, now }
       target   : 리허설 대상인가(admin_rehearsal_status.target_ids) · undefined/null = 대상 목록을 모름
       shown    : 부스 공개 · 구역 공개 · 번호 있음
       pinState : 'on' | 'off' | 'none' | null(모름)
       switchOn : true | false | null(모름 — 서버에서 막힐 수 있으나 여기서는 막지 않음)
     돌려줌 key: 'open'(사용 가능) · 'closed'(개별 PIN 발급으로 닫힘) · 'ended'(끝나는 때가 지남) ·
                'hidden'(비공개라 못 씀) · 'off'(PIN 보조 로그인 꺼짐) · 'na'(리허설 대상 아님) · 'unknown'(판단할 자료 없음) */
  var COMMON = {
    open: '리허설 공통 PIN 사용 가능', closed: '리허설 공통 PIN 닫힘(개별 PIN 발급)', ended: '리허설 공통 PIN 끝남',
    hidden: '리허설 공통 PIN 못 씀(비공개)', off: '리허설 공통 PIN 못 씀(PIN 보조 로그인 꺼짐)', na: '', unknown: ''
  };
  function common(o) {
    var k;
    if (o.target === undefined || o.target === null) k = 'unknown';
    else if (!o.target) k = 'na';
    else if (!(o.now < o.end)) k = 'ended';
    else if (o.pinState === 'on' || o.pinState === 'off') k = 'closed';
    else if (o.pinState !== 'none') k = 'unknown';
    else if (!o.shown) k = 'hidden';
    else if (o.switchOn === false) k = 'off';
    else k = 'open';
    return { key: k, label: COMMON[k] };
  }

  // 여러 부스 셈. items = [{ target, pinState, common: { key } }]
  function summarize(items) {
    var s = { target: 0, open: 0, closed: 0, ended: 0, hidden: 0, off: 0, on: 0, none: 0, offPin: 0, unk: 0 };
    items.forEach(function (x) {
      if (!x.target) return;
      s.target++;
      var k = x.common && x.common.key;
      if (k === 'open' || k === 'closed' || k === 'ended' || k === 'hidden' || k === 'off') s[k]++;
      if (x.pinState === 'on') s.on++;
      else if (x.pinState === 'off') s.offPin++;
      else if (x.pinState === 'none') s.none++;
      else s.unk++;
    });
    return s;
  }

  window.PinStatus = { END: END, endOf: endOf, endText: endText, individual: individual, common: common, summarize: summarize };
})();
