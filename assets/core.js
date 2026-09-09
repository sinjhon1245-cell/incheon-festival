/* ===================================================================
   2026년 인천 AI·SW미래채움 교육페스티벌 — 관계자 운영 포털
   공통 계층: Supabase 연결 · 인증 · 데이터 접근 · 잔손질

   여기에는 fallback 데이터가 없습니다. 관계자 전용 사이트라
   인증 없이 운영정보가 보이면 안 되기 때문입니다(TASK 20).
   연결이 안 되면 데이터를 꾸며내지 않고 오류를 알립니다.
   =================================================================== */
window.Core = (function () {
  'use strict';

  var cfg = window.FESTIVAL_CONFIG || {};
  var client = null;
  var profile = null;   // staff_profiles 의 내 줄 (role 포함)

  /* ── 연결 ───────────────────────────────────────────────────── */
  function isConfigured() {
    return !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  }

  function db() {
    if (client) return client;
    if (!isConfigured() || !window.supabase) return null;
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    return client;
  }

  /* ── 인증 ───────────────────────────────────────────────────── */
  function session() {
    var c = db();
    if (!c) return Promise.resolve(null);
    return c.auth.getSession().then(function (r) {
      return (r.data && r.data.session) || null;
    }).catch(function () { return null; });
  }

  /* 로그인한 사람이 관계자 명단에 있는지 확인합니다.
     auth 계정만 있고 staff_profiles 에 줄이 없으면 아무것도 못 봅니다. */
  function loadProfile() {
    var c = db();
    if (!c) return Promise.resolve(null);
    return c.from('staff_profiles').select('*').eq('id', '__self__').then(function () { return null; });
  }

  /* 프로필을 못 가져온 이유를 구분해 둡니다. "명단에 없음"과
     "표 자체가 없음(마이그레이션 미실행)"은 조치가 완전히 다릅니다. */
  var profileError = null;

  function fetchProfile(userId) {
    var c = db();
    if (!c) return Promise.resolve(null);
    profileError = null;
    return c.from('staff_profiles').select('*').eq('id', userId).maybeSingle()
      .then(function (r) {
        if (r.error) { profileError = r.error; profile = null; }
        else profile = r.data;
        return profile;
      })
      .catch(function (e) { profileError = e; profile = null; return null; });
  }

  /* 로그인은 됐는데 들어갈 수 없을 때 보여 줄 설명 */
  function accessMessage() {
    var m = (profileError && profileError.message) || '';
    if (/does not exist|schema cache/i.test(m)) {
      return '데이터베이스가 아직 운영 포털 구조가 아닙니다. ' +
             'Supabase SQL Editor 에서 supabase/migration-portal.sql 을 실행해 주세요.';
    }
    if (m) return '관계자 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    return '관계자로 등록되지 않은 계정입니다. 운영 총괄에게 문의해 주세요.';
  }

  function signIn(email, password) {
    var c = db();
    if (!c) return Promise.reject(new Error('Supabase 설정이 없습니다.'));
    return c.auth.signInWithPassword({ email: email, password: password })
      .then(function (r) {
        if (r.error) throw r.error;
        return fetchProfile(r.data.user.id).then(function (p) {
          if (!p) {
            // 계정은 있지만 관계자 명단에 없는 경우 — 바로 로그아웃시킵니다.
            return c.auth.signOut().then(function () {
              throw new Error(accessMessage());
            });
          }
          return r.data.session;
        });
      });
  }

  function signOut() {
    var c = db();
    profile = null;
    return c ? c.auth.signOut() : Promise.resolve();
  }

  function me() { return profile; }
  function isAdmin() { return !!(profile && profile.role === 'admin'); }

  /* 로그인 오류를 사람이 읽을 수 있는 말로 바꿉니다(TASK 22). */
  function authMessage(e) {
    var m = (e && e.message) || '';
    if (/Invalid login/i.test(m)) return '이메일 또는 비밀번호가 맞지 않습니다.';
    if (/Email not confirmed/i.test(m)) return '이메일 인증이 완료되지 않은 계정입니다. 운영 총괄에게 문의해 주세요.';
    if (/rate limit|Too many/i.test(m)) return '시도가 너무 잦습니다. 잠시 후 다시 시도해 주세요.';
    if (/Failed to fetch|NetworkError/i.test(m)) return '네트워크에 연결하지 못했습니다. 인터넷 상태를 확인해 주세요.';
    return m || '로그인하지 못했습니다. 다시 시도해 주세요.';
  }

  /* 데이터 오류도 마찬가지로 다듬습니다. 기술적인 오류 객체를
     그대로 보여주지 않습니다. */
  function dataMessage(e) {
    var m = (e && e.message) || '';
    if (/Failed to fetch|NetworkError/i.test(m)) return '네트워크에 연결하지 못했습니다.';
    if (/JWT|expired/i.test(m)) return '로그인이 만료되었습니다. 다시 로그인해 주세요.';
    if (/permission|policy|row-level/i.test(m)) return '이 작업을 할 권한이 없습니다.';
    if (/does not exist/i.test(m)) return '데이터베이스가 최신 구조가 아닙니다. migration-portal.sql 을 실행해 주세요.';
    return '데이터를 처리하지 못했습니다. 다시 시도해 주세요.';
  }

  /* ── 조회 ───────────────────────────────────────────────────── */
  function select(table, opts) {
    var c = db();
    if (!c) return Promise.reject(new Error('Supabase 설정이 없습니다.'));
    opts = opts || {};
    var q = c.from(table).select(opts.columns || '*');
    (opts.order || [['sort_order', true]]).forEach(function (o) {
      q = q.order(o[0], { ascending: o[1] !== false });
    });
    if (opts.eq) Object.keys(opts.eq).forEach(function (k) { q = q.eq(k, opts.eq[k]); });
    if (opts.limit) q = q.limit(opts.limit);
    return q.then(function (r) { if (r.error) throw r.error; return r.data || []; });
  }

  /* ── 쓰기 — 실제 반영 건수를 반드시 확인합니다 ─────────────────
     PostgREST 는 RLS 가 걸러 0건이 처리돼도 error 를 주지 않아서,
     .select() 로 돌려받아 확인하지 않으면 화면만 바뀝니다. */
  function affected(rows, what) {
    if (rows && rows.length) return rows;
    throw new Error(what + ' 대상이 0건입니다. 로그인이 풀렸거나 권한이 없습니다.');
  }

  function insert(table, row) {
    return db().from(table).insert(row).select()
      .then(function (r) { if (r.error) throw r.error; return affected(r.data, '추가')[0]; });
  }

  function update(table, id, patch) {
    return db().from(table).update(patch).eq('id', id).select()
      .then(function (r) { if (r.error) throw r.error; return affected(r.data, '수정')[0]; });
  }

  function remove(table, id) {
    return db().from(table).delete().eq('id', id).select()
      .then(function (r) { if (r.error) throw r.error; return affected(r.data, '삭제')[0]; });
  }

  /* ── 잔손질 ─────────────────────────────────────────────────── */
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  /* 'HH:MM' → 분. 비었거나 형식이 다르면 null. */
  function toMin(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  function minLabel(mins) {
    if (mins < 60) return mins + '분';
    var h = Math.floor(mins / 60), m = mins % 60;
    return m ? h + '시간 ' + m + '분' : h + '시간';
  }

  /* 전화번호를 tel: 로 (숫자와 +만 남깁니다) */
  function telHref(phone) {
    var d = String(phone || '').replace(/[^0-9+]/g, '');
    return d ? 'tel:' + d : '';
  }

  function fmtDateTime(d) {
    return d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + '. ' +
           pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  return {
    isConfigured: isConfigured, db: db,
    session: session, signIn: signIn, signOut: signOut,
    fetchProfile: fetchProfile, me: me, isAdmin: isAdmin, accessMessage: accessMessage,
    authMessage: authMessage, dataMessage: dataMessage,
    select: select, insert: insert, update: update, remove: remove,
    esc: esc, pad2: pad2, toMin: toMin, minLabel: minLabel,
    telHref: telHref, fmtDateTime: fmtDateTime
  };
})();
