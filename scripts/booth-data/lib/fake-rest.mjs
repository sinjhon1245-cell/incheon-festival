// 시험용 가짜 Supabase — 로컬 복제 DB(lib/replica.mjs) 위에서.
//   rest(path)        : 공개 읽기(PostgREST GET). 익명(anon) 권한이라 RLS 가 그대로 걸립니다.
//   fakeSupabase(...) : supabase-js 의 createClient 흉내(관리자 로그인 상태). from().select() · rpc() · auth.
// 네트워크를 쓰지 않습니다. 부른 표 · 함수는 log 에 남겨, 화면이 몰래 발급 · 교체를 부르지 않는지 봅니다.
import { ADMIN } from './replica.mjs';

export function makeRest(R) {
  const db = R.db;
  return async function rest(path) {
    const [res, qs] = path.split('?');
    const sp = new URLSearchParams(qs || '');
    if (res.startsWith('rpc/')) {
      const name = res.slice(4);
      if (!/^[a-z_]+$/.test(name)) return { status: 404, body: { code: 'PGRST202' } };
      const has = (await db.query("select 1 from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace", [name])).rows.length;
      if (!has) return { status: 404, body: { code: 'PGRST202', message: 'Could not find the function public.' + name } };
      // 권한이 없으면 PostgREST 처럼 401 · 42501(실행 권한을 뺀 경우를 시험할 때)
      try { return { status: 200, body: await R.asAnon(`select * from public.${name}()`) }; }
      catch (e) { return { status: e.code === '42501' ? 401 : 400, body: { code: e.code || '', message: e.message } }; }
    }
    if (!/^[a-z_]+$/.test(res)) return { status: 404, body: { code: 'PGRST205' } };
    const cols = (sp.get('select') || '*').split(',').map(c => c.trim()).filter(c => /^[a-z_]+$/.test(c)).join(', ') || '*';
    let sql = `select ${cols} from public.${res}`;
    const order = sp.get('order');
    if (order) sql += ' order by ' + order.split(',').map(o => { const [c, d] = o.split('.'); return `${c} ${d === 'desc' ? 'desc' : 'asc'}`; }).join(', ');
    if (sp.get('limit')) sql += ' limit ' + Number(sp.get('limit'));
    try { return { status: 200, body: await R.asAnon(sql) }; }
    catch (e) { return { status: 400, body: { code: e.code || '42703', message: e.message } }; }
  };
}

// opts.anon: 로그인하지 않은 방문자(익명 역할 · RLS 그대로). 없으면 관리자 로그인 상태입니다.
export function fakeSupabase(R, log, opts = {}) {
  const db = R.db;
  // 관리자 로그인 표시(test.uid)도 한 트랜잭션 안에서만 — 동시에 도는 익명 읽기에 섞이지 않게.
  const asAdmin = opts.anon ? (sql, params) => R.asAnon(sql, params)
    : (sql, params) => db.transaction(async tx => { await tx.query("select set_config('test.uid', $1, true)", [ADMIN]); return (await tx.query(sql, params)).rows; });
  const who = opts.anon ? null : { user: { id: ADMIN, email: 'admin@dryrun.test' }, access_token: 'dryrun' };
  const colsOf = async t => (await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1", [t])).rows.map(r => r.column_name);
  function from(table) {
    const st = { cols: '*', order: [], eq: [], limit: null, single: false };
    const b = {
      select(c) { st.cols = c || '*'; return b; },
      order(c, o) { st.order.push([c, !o || o.ascending !== false]); return b; },
      eq(c, v) { st.eq.push([c, v]); return b; },
      limit(n) { st.limit = n; return b; },
      maybeSingle() { st.single = true; return b; },
      single() { st.single = true; return b; },
      then(ok, bad) { return run().then(ok, bad); }
    };
    async function run() {
      log.push('select:' + table);
      const have = await colsOf(table);
      if (!have.length) return { data: null, error: { code: 'PGRST205', message: 'table not found: ' + table } };
      const want = st.cols.trim() === '*' ? ['*'] : st.cols.split(',').map(s => s.trim()).filter(Boolean);
      if (want[0] !== '*' && want.some(c => !have.includes(c))) return { data: null, error: { code: '42703', message: 'column does not exist' } };
      const params = [];
      let sql = `select ${want.join(', ')} from public.${table}`;
      if (st.eq.length) sql += ' where ' + st.eq.map(([c, v]) => { params.push(v); return `${c} = $${params.length}`; }).join(' and ');
      if (st.order.length) sql += ' order by ' + st.order.map(([c, a]) => `${c} ${a ? 'asc' : 'desc'}`).join(', ');
      if (st.limit) sql += ' limit ' + Number(st.limit);
      try { const rows = await asAdmin(sql, params); return { data: st.single ? (rows[0] || null) : rows, error: null }; }
      catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
    }
    return b;
  }
  async function rpc(name, args) {
    log.push('rpc:' + name);
    const has = (await db.query("select 1 from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace", [name])).rows.length;
    if (!has) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + name } };
    const keys = Object.keys(args || {});
    try {
      // 객체 · 객체 배열은 PostgREST 처럼 JSON 으로(jsonb 인자). 글자 · uuid 배열 같은 값 배열은 그대로.
      const val = v => (v && typeof v === 'object' && !(v instanceof Date) && (!Array.isArray(v) || v.some(x => x && typeof x === 'object')) ? JSON.stringify(v) : v);
      const rows = await asAdmin(`select * from public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`, keys.map(k => val(args[k])));
      return { data: rows, error: null };
    } catch (e) { return { data: null, error: { code: e.code, message: e.message, hint: e.hint || null } }; }   // PostgREST 처럼 hint 도 넘김
  }
  const client = {
    from, rpc,
    auth: {
      getSession: async () => ({ data: { session: who }, error: null }),
      getUser: async () => ({ data: { user: who && who.user }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null })
    },
    storage: { from: () => ({ list: async () => ({ data: [], error: null }) }) }
  };
  return { createClient: () => client };
}
