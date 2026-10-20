/* ===================================================================
   관리 화면 시험 도구 — 복제 DB(지금 Production 단계) + jsdom 으로 print-qr · booth-admin · admin 화면 열기
   ───────────────────────────────────────────────────────────────────
   · prepReplica: preview → C-02 → Q-02 → T-02 → T-03 → 리허설 → PIN 함수 → 리허설 공통 PIN (test-printqr-regression 과 같은 단계)
   · installTestClock: 리허설 공통 PIN 판정(private.rehearsal_common_pin_open)의 now() 한 곳만 시험 시계로(test-rehearsal-pin D0 와 같은 방법)
   · openPage: 화면 파일을 고치지 않고 assets 를 끼워 넣어 엽니다. 관리자 세션 · 복제 DB 만 씁니다(네트워크 없음).
   ⚠️ 열쇠 · PIN 은 복제 DB 의 가짜 값이고 출력하지 않습니다.
   =================================================================== */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { openReplica } from './replica.mjs';
import { makeRest, fakeSupabase } from './fake-rest.mjs';

export const wait = ms => new Promise(r => setTimeout(r, ms));
export async function until(fn, ms = 15000, step = 40) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await wait(step); } return false; }
export const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
export const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
// 화면에 보이는 글만(script · style · template · hidden 요소 빼고) — 코드 속 글자를 화면 글로 잘못 세지 않게
export function visibleText(d) {
  const c = d.body.cloneNode(true);
  c.querySelectorAll('script, style, template, noscript, [hidden]').forEach(x => x.remove());
  return c.textContent.replace(/\s+/g, ' ').trim();
}

export async function prepReplica({ lib, snap, manifest, here, repo, mainDir }) {
  const R = await openReplica(lib, { snap, manifest });
  const db = R.db;
  const OUT = resolve(here, 'out');
  await db.exec(readFileSync(resolve(here, 'dryrun/replica-functions-extra.sql'), 'utf8'));
  for (const f of [resolve(repo, 'supabase/migration-booth-preview.sql'), resolve(OUT, 'gate3c/C-02-transition.sql'), resolve(OUT, 'gate3c/Q-02-qr-preissue.sql'),
    resolve(OUT, 'gate4r/T-02-assign.sql'), resolve(OUT, 'gate4r/T-03-publish.sql')]) {
    const r = await R.run(readFileSync(f, 'utf8')); if (!r.ok) throw new Error(f + ' ' + r.error);
  }
  await db.exec(readFileSync(join(mainDir, 'supabase/migration-booth-rehearsal.sql'), 'utf8'));
  const SKIP = new Set(['private.booth_pin_pepper', 'private.booth_client_ip', 'public.admin_booth_credentials', 'public.admin_booth_ip_probe']);
  for (const f of ['migration-booth-pin.sql', 'migration-booth-example-pin.sql', 'migration-booth-pin-checked.sql']) {
    const lines = readFileSync(join(mainDir, 'supabase', f), 'utf8').replace(/\r/g, '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^create (?:or replace )?function (\S+?)\(/); if (!m) continue;
      let j = i; while (lines[j] !== '$$;') j++;
      if (!SKIP.has(m[1])) await db.exec(lines.slice(i, j + 1).join('\n').replace(/^create function/, 'create or replace function'));
      i = j;
    }
  }
  await db.exec(`update public.settings set booth_sample_common_pin_enabled = false where id = 1;
    update public.zones set is_published = false where key !~ '^R';
    update public.booths set is_published = false where org ~ '^\\s*\\[예시\\]';`);
  await db.exec(readFileSync(join(mainDir, 'supabase/migration-booth-rehearsal-pin.sql'), 'utf8'));
  return { R, db, rest: makeRest(R) };
}

// 리허설 공통 PIN 판정 함수의 now() 하나만 시험 시계로. 돌려줌: { setNow(iso|null), restore(), hits }
export async function installTestClock(db, mainDir) {
  const mig = readFileSync(join(mainDir, 'supabase/migration-booth-rehearsal-pin.sql'), 'utf8').replace(/\r/g, '');
  const block = (mig.match(/create or replace function private\.rehearsal_common_pin_open[\s\S]*?\n\$\$;/) || [])[0];
  if (!block) throw new Error('rehearsal_common_pin_open 블록 없음');
  const hits = (block.match(/pg_catalog\.now\(\)/g) || []).length;
  await db.exec(`create or replace function private.test_now() returns timestamptz language sql stable set search_path = '' as $$
    select coalesce(nullif(pg_catalog.current_setting('test.now', true), '')::timestamptz, pg_catalog.now()) $$;`);
  await db.exec(block.replace('pg_catalog.now()', 'private.test_now()'));
  return {
    hits,
    setNow: iso => db.exec(iso ? `set test.now = '${iso}'` : 'reset test.now'),
    restore: async () => { await db.exec('reset test.now'); await db.exec(block); await db.exec('drop function private.test_now()'); }
  };
}

const DATE_KEYS = new Set(['cutoff', 'kst_today']);
export const asJson = rows => JSON.parse(JSON.stringify(rows), (k, v) => (DATE_KEYS.has(k) && typeof v === 'string' ? v.slice(0, 10) : v));
// 관리자 클라이언트(가짜 Supabase). hooks.rpc(name, args) 가 값을 돌려주면 그 답을 씁니다(대상 목록 바꿔 보기 등).
export function adminClient(R, hooks = {}) {
  const log = [], calls = [];
  const base = fakeSupabase(R, log).createClient();
  const client = Object.assign({}, base, {
    from: table => { const b = base.from(table); const th = b.then; b.then = (ok, bad) => th.call(b, res => { if (res && res.data) res.data = asJson(res.data); return res; }).then(ok, bad); return b; },
    rpc: async (name, args) => {
      calls.push({ name, args: args || {} });
      const res = await base.rpc(name, args);
      if (res.data) res.data = asJson(res.data);
      if (hooks.rpc) { const h = await hooks.rpc(name, args, res); if (h) return h; }
      return res;
    }
  });
  return { client, log, calls };
}

// 화면 시계: Date 를 정한 시각에서 흐르게 합니다(서버 시계와 따로 맞춤).
export function fakeClock(w, at) {
  const RD = w.Date, off = at - RD.now();
  function FD(...a) { if (!new.target) return new RD(RD.now() + off).toString(); return a.length ? new RD(...a) : new RD(RD.now() + off); }
  FD.prototype = RD.prototype; FD.now = () => RD.now() + off; FD.UTC = RD.UTC; FD.parse = RD.parse;
  w.Date = FD;
}

const PAGE_ASSETS = {
  'print-qr.html': ['assets/config.js', 'assets/core.js', 'assets/booth-core.js', 'assets/mock-data.js', 'assets/pin-status.js'],
  'booth-admin.html': ['assets/config.js', 'assets/core.js', 'assets/ui.js', 'assets/booth-core.js', 'assets/mock-data.js', 'assets/admin-demo.js', 'assets/pin-status.js', 'assets/booth-admin.js'],
  'admin.html': ['assets/config.js', 'assets/core.js', 'assets/ui.js', 'assets/mock-data.js', 'assets/admin-demo.js', 'assets/pin-status.js', 'assets/admin.js']
};
export function pageHtml(dir, file) {
  let html = readFileSync(join(dir, file), 'utf8').replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>/g, '');
  for (const p of PAGE_ASSETS[file]) {
    if (!existsSync(join(dir, p))) continue;
    const src = readFileSync(join(dir, p), 'utf8').replace(/<\/script/gi, '<\\/script');
    html = html.replace(new RegExp(`<script src="${p.replace(/[.]/g, '\\.')}"></script>`), () => `<script>${src}</script>`);
  }
  return html.replace(/<link[^>]+stylesheet[^>]*>/g, '');
}
// 열기: { JSDOM, VirtualConsole, dir, file, R, rest, at(화면 시계 ms · 없으면 실제), hooks, query, hash }
export async function openPage({ JSDOM, VirtualConsole, dir, file, R, rest, at, hooks, query = '', hash = '' }) {
  const { client, calls, log } = adminClient(R, hooks);
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {});
  const dom = new JSDOM(pageHtml(dir, file), {
    url: 'https://sinjhon1245-cell.github.io/incheon-festival/' + file + query + hash, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.supabase = { createClient: () => client };
      function QRCode() { /* 그림 없음 */ } QRCode.CorrectLevel = { L: 1, M: 0, Q: 3, H: 2 }; w.QRCode = QRCode;
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.scrollTo = () => {}; w.print = () => {}; w.console.warn = () => {};
      w.Element.prototype.scrollIntoView = function () {};
      w.fetch = async (u) => {
        const s = String(u), i = s.indexOf('/rest/v1/');
        if (i < 0) throw new Error('예상 밖 요청');
        const r = await rest(s.slice(i + 9)); const b = JSON.stringify(r.body);
        return { ok: r.status < 400, status: r.status, text: async () => b, json: async () => JSON.parse(b) };
      };
      if (at) fakeClock(w, at);
    }
  });
  const errors = []; dom.window.addEventListener('error', e => errors.push(e.message));
  return { dom, d: dom.window.document, w: dom.window, calls, log, errors };
}
