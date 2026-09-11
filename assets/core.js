/* ===================================================================
   2026년 인천 AI·SW미래채움 교육페스티벌 — 행사 운영 포털
   공통 계층: Supabase 연결 · 관리자 인증 · 데이터 접근 · 잔손질

   포털은 로그인 없이 열립니다. anon 키로 읽고, 무엇을 읽을 수
   있는지는 데이터베이스의 RLS 열람 정책이 정합니다.
   로그인은 관리자 한 종류뿐이고, 편집 권한은 is_admin() 이 막습니다.

   여기에는 fallback 데이터가 없습니다. 연결이 안 되면 데이터를
   꾸며내지 않고 오류를 알립니다.
   =================================================================== */
window.Core = (function () {
  'use strict';

  var cfg = window.FESTIVAL_CONFIG || {};
  var client = null;
  var profile = null;   // 로그인한 관리자의 staff_profiles 줄 (role 포함)

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
        // 초대·재설정 링크가 없어졌습니다. 화면 이동에 쓰는
        // #dashboard 같은 해시를 토큰으로 오해하지 않도록 꺼 둡니다.
        detectSessionInUrl: false
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

  /* 로그인은 됐는데 관리자로 들어갈 수 없을 때 보여 줄 설명 */
  function accessMessage() {
    var m = (profileError && profileError.message) || '';
    var code = (profileError && profileError.code) || '';
    if (code === '42P01' || code === 'PGRST205' || code === 'PGRST202' ||
        /relation .* does not exist/i.test(m)) {
      return '데이터베이스가 아직 운영 포털 구조가 아닙니다. ' +
             'Supabase SQL Editor 에서 supabase/migration-public-portal.sql 을 실행해 주세요.';
    }
    if (m) return '계정 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    return '관리자로 등록되지 않은 계정입니다.';
  }

  /* 관리자 로그인. 권한(admin) 확인은 부르는 쪽이 fetchProfile 로
     이어서 합니다. 여기서 바로 내보내지 않는 이유는, "권한이 없는
     계정"과 "조회가 잠깐 실패한 상황"을 화면에서 다르게 안내해야
     하기 때문입니다. */
  function signIn(email, password) {
    var c = db();
    if (!c) return Promise.reject(new Error('Supabase 설정이 없습니다.'));
    return c.auth.signInWithPassword({ email: email, password: password })
      .then(function (r) {
        if (r.error) throw r.error;
        return r.data.session;
      });
  }

  function signOut() {
    var c = db();
    profile = null;
    return c ? c.auth.signOut() : Promise.resolve();
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

  /* 아직 만들지 않은 표를 조회할 때 씁니다.

     새 기능의 표는 관리자가 SQL 을 직접 돌려야 생깁니다. 그때까지
     Promise.all 안에서 하나가 거절되면 포털 전체가 오류 화면이 됩니다.
     표가 없다는 것은 "아직 준비 전" 이지 고장이 아니므로, 빈 배열로
     돌려주고 어느 표가 없었는지만 표시해 둡니다.

     권한·네트워크 오류는 그대로 던집니다. 그건 진짜 문제라서
     조용히 넘기면 빈 화면의 이유를 알 수 없게 됩니다. */
  var missingTables = {};
  function tableMissing(e) {
    var code = (e && e.code) || '';
    return code === '42P01' || code === 'PGRST205' || code === 'PGRST202' ||
           /relation .* does not exist/i.test((e && e.message) || '');
  }
  function selectSoft(table, opts) {
    return select(table, opts).catch(function (e) {
      if (!tableMissing(e)) throw e;
      missingTables[table] = true;
      return [];
    });
  }
  function isTableMissing(table) { return !!missingTables[table]; }

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

  /* 데이터베이스 함수(RPC) 호출.
     "이 칼럼 하나만 바꿀 수 있어야 한다" 같은 제한된 쓰기에 씁니다.
     부스 상태 변경이 그렇습니다 — 표 전체에 쓰기 권한을 열지 않고
     set_booth_status 함수 하나만 열어 둡니다. */
  function rpc(name, args) {
    var c = db();
    if (!c) return Promise.reject(new Error('Supabase 설정이 없습니다.'));
    return c.rpc(name, args || {}).then(function (r) {
      if (r.error) throw r.error;
      return r.data;
    });
  }

  /* ── 이미지 보관함 (Supabase Storage) ────────────────────────
     버킷은 공개라 포털에서 로그인 없이 보입니다. 올리고 지우는 것은
     버킷 정책이 관리자로 제한합니다 — 이 파일에는 권한이 없습니다.

     주소만 데이터베이스에 저장하고 경로는 따로 두지 않습니다.
     공개 주소에 경로가 그대로 들어 있어, 지울 때 되짚을 수 있습니다. */
  var BUCKET = 'festival-images';
  var IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  var IMAGE_MAX = 10 * 1024 * 1024;   // 10MB

  /* 올리기 전에 브라우저에서 먼저 걸러 줍니다. 큰 파일을 다 올린
     뒤에 거절당하면 시간만 버리기 때문입니다. 서버(버킷 설정)에도
     같은 제한이 걸려 있어, 이 검사를 우회해도 통과하지 못합니다. */
  function imageProblem(file) {
    if (!file) return '파일을 선택해 주세요.';
    if (IMAGE_TYPES.indexOf(file.type) < 0) {
      return 'JPG · PNG · WebP 이미지만 올릴 수 있습니다.';
    }
    if (file.size > IMAGE_MAX) {
      return '이미지가 너무 큽니다. 10MB 이하로 줄여서 올려 주세요. ' +
             '(현재 ' + (file.size / 1024 / 1024).toFixed(1) + 'MB)';
    }
    return null;
  }

  /* 파일 이름은 새로 짓습니다. 한글·공백·중복을 한 번에 없애고,
     같은 이름을 덮어써서 다른 화면의 이미지가 바뀌는 사고도 막습니다. */
  function imageName(file) {
    var ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[file.type] || 'jpg';
    var rand = Math.random().toString(36).slice(2, 8);
    return Date.now().toString(36) + '-' + rand + '.' + ext;
  }

  function uploadImage(file, folder) {
    var c = db();
    if (!c) return Promise.reject(new Error('Supabase 설정이 없습니다.'));
    var bad = imageProblem(file);
    if (bad) return Promise.reject(new Error(bad));

    var path = (folder || 'etc') + '/' + imageName(file);
    return c.storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600', contentType: file.type, upsert: false
    }).then(function (r) {
      if (r.error) throw r.error;
      var pub = c.storage.from(BUCKET).getPublicUrl(path);
      return { url: (pub.data && pub.data.publicUrl) || '', path: path };
    });
  }

  /* 공개 주소에서 보관함 경로를 되짚습니다.
     .../storage/v1/object/public/festival-images/venue/abc.png → venue/abc.png
     우리 보관함 주소가 아니면 null 을 줍니다. 남의 주소를 지우려
     들지 않기 위해서입니다. */
  function imagePath(url) {
    var m = new RegExp('/storage/v1/object/public/' + BUCKET + '/(.+)$').exec(String(url || ''));
    return m ? decodeURIComponent(m[1].split('?')[0]) : null;
  }

  /* 안 쓰는 이미지 지우기. 실패해도 화면 흐름을 멈추지 않습니다 —
     파일 한 장이 남는 것보다 저장이 막히는 쪽이 더 나쁩니다. */
  function deleteImage(url) {
    var c = db();
    var path = imagePath(url);
    if (!c || !path) return Promise.resolve(false);
    return c.storage.from(BUCKET).remove([path]).then(function (r) {
      if (r.error) { console.warn('[core] 안 쓰는 이미지를 지우지 못했습니다', path, r.error); return false; }
      return true;
    }).catch(function (e) {
      console.warn('[core] 안 쓰는 이미지를 지우지 못했습니다', path, e);
      return false;
    });
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
    profileFailed: profileFailed,
    authMessage: authMessage, dataMessage: dataMessage,
    select: select, selectSoft: selectSoft, isTableMissing: isTableMissing,
    insert: insert, update: update, remove: remove, rpc: rpc,
    uploadImage: uploadImage, deleteImage: deleteImage,
    imageProblem: imageProblem, imagePath: imagePath,
    esc: esc, pad2: pad2, toMin: toMin, minLabel: minLabel,
    telHref: telHref, fmtDateTime: fmtDateTime
  };
})();
