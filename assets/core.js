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
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // 초대·비밀번호 재설정 링크는 주소 뒤 #access_token=... 으로
        // 돌아옵니다. 이걸 켜야 초대받은 사람이 로그인될 수 있습니다.
        detectSessionInUrl: true
      }
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
    var code = (profileError && profileError.code) || '';
    if (code === '42P01' || code === 'PGRST205' || code === 'PGRST202' ||
        /relation .* does not exist/i.test(m)) {
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
            // 조회 자체가 실패한 경우는 세션을 지우지 않습니다.
            // 확실히 "명단에 없음" 일 때만 내보냅니다.
            if (profileError) throw new Error(accessMessage());
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

  /* 초대 메일이나 비밀번호 재설정 링크를 타고 들어왔는지.
     supabase-js 가 주소의 토큰을 이미 먹은 뒤라 값이 남아 있지 않을 수
     있어, 우리 쪽에서 먼저 기록해 둡니다. */
  var entryType = (function () {
    var h = location.hash || '';
    var m = /[#&]type=([a-z_]+)/.exec(h);
    return m ? m[1] : null;
  })();
  function invitedEntry() { return entryType === 'invite' || entryType === 'recovery'; }

  /* 초대받은 사람이 처음 들어와 비밀번호를 정할 때 씁니다. */
  function setPassword(pw) {
    var c = db();
    if (!c) return Promise.reject(new Error('Supabase 설정이 없습니다.'));
    return c.auth.updateUser({ password: pw }).then(function (r) {
      if (r.error) throw r.error;
      entryType = null;
      return r.data;
    });
  }

  function profileFailed() { return !!profileError; }

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
  /* PostgREST/Postgres 오류 코드
       42P01  없는 표          → 마이그레이션이 정말 필요
       42703  없는 칼럼        → 표는 있고 쿼리가 틀림 (코드 문제)
       PGRST202/205  스키마 캐시에 표 없음
       PGRST204      스키마 캐시에 칼럼 없음
     이 둘을 뭉뚱그리면 멀쩡한 DB 를 "구조가 낡았다"고 잘못 안내하게
     됩니다. 실제로 그런 버그가 있었습니다. */
  function dataMessage(e) {
    var m = (e && e.message) || '';
    var code = (e && e.code) || '';
    var where = e && e.__table ? '(' + e.__table + ') ' : '';

    if (/Failed to fetch|NetworkError/i.test(m)) return '네트워크에 연결하지 못했습니다.';
    if (code === 'PGRST301' || /JWT|expired/i.test(m)) return '로그인이 만료되었습니다. 다시 로그인해 주세요.';
    if (code === '42501' || /permission denied|row-level security/i.test(m)) return '이 작업을 할 권한이 없습니다.';

    // 표 자체가 없을 때만 마이그레이션을 안내합니다.
    if (code === '42P01' || code === 'PGRST205' || code === 'PGRST202' ||
        /relation .* does not exist/i.test(m)) {
      return where + '필요한 표가 데이터베이스에 없습니다. supabase/migration-portal.sql 을 실행해 주세요.';
    }

    // 칼럼 불일치는 코드 쪽 문제입니다. 사용자에게는 조용히,
    // 개발자에게는 콘솔로 정확히 알립니다.
    if (code === '42703' || code === 'PGRST204' || /column .* does not exist/i.test(m)) {
      console.error('[core] 요청한 칼럼이 표에 없습니다 — 코드 확인 필요:', e);
      return where + '요청 형식이 맞지 않습니다. 잠시 후 다시 시도해 주세요.';
    }

    return '데이터를 처리하지 못했습니다. 다시 시도해 주세요.';
  }

  /* ── 조회 ───────────────────────────────────────────────────── */
  function select(table, opts) {
    var c = db();
    if (!c) return Promise.reject(new Error('Supabase 설정이 없습니다.'));
    opts = opts || {};
    var q = c.from(table).select(opts.columns || '*');

    // order: false 면 정렬하지 않습니다. sort_order 가 없는 표에
    // 기본 정렬을 걸면 PostgREST 가 42703 으로 거절합니다.
    if (opts.order !== false) {
      (opts.order || [['sort_order', true]]).forEach(function (o) {
        q = q.order(o[0], { ascending: o[1] !== false });
      });
    }
    if (opts.eq) Object.keys(opts.eq).forEach(function (k) { q = q.eq(k, opts.eq[k]); });
    if (opts.limit) q = q.limit(opts.limit);

    return q.then(function (r) {
      if (r.error) { r.error.__table = table; throw r.error; }
      return r.data || [];
    });
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
    invitedEntry: invitedEntry, setPassword: setPassword, profileFailed: profileFailed,
    authMessage: authMessage, dataMessage: dataMessage,
    select: select, insert: insert, update: update, remove: remove,
    esc: esc, pad2: pad2, toMin: toMin, minLabel: minLabel,
    telHref: telHref, fmtDateTime: fmtDateTime
  };
})();
