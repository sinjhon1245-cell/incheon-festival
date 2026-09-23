/* ===================================================================
   관리자 계정 스크립트 공통 부분
   ───────────────────────────────────────────────────────────────────
   create-admin-users.mjs (계정 만들기) 와
   reset-admin-passwords.mjs (비밀번호만 바꾸기) 가 같이 씁니다.

   두 스크립트는 하는 일이 다르지만 — 하나는 만들고 하나는 절대
   만들지 않습니다 — 계정을 찾는 방법, 비밀번호 규칙, 기존 계정을
   대조하는 방법은 같아야 합니다. 복사해 두면 한쪽만 고쳐지고
   나머지가 조용히 어긋납니다.

   ⚠️ service_role 키는 환경변수로만 받습니다. 이 파일에도,
      저장소 어디에도 키를 적지 마세요.
   =================================================================== */

import { randomInt } from 'node:crypto';

/* ── 설정 ───────────────────────────────────────────────────── */

// 프로젝트 주소는 공개 값이라(assets/config.js 에도 그대로 있습니다)
// 기본값을 둡니다. 다른 프로젝트에 쓰려면 SUPABASE_URL 로 덮어쓰세요.
export const SUPABASE_URL = (process.env.SUPABASE_URL ||
  'https://ynixjjqozkbzxjmishbe.supabase.co').replace(/\/+$/, '');

export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// aisw01 → aisw01@aisw.local
// 바꾸려면 assets/config.js 의 adminIdDomain 도 같이 바꿔야 합니다.
export const ID_DOMAIN = process.env.ADMIN_ID_DOMAIN || 'aisw.local';

// 다룰 수 있는 아이디 번호. aisw01 ~ aisw50 까지만 허용합니다.
// 위를 넓히려면 여기만 고치면 됩니다.
export const ID_MIN = 1;
export const ID_MAX = 50;

// 범위를 주지 않고 부를 때 쓰는 끝 번호.
// reset-admin-passwords.mjs 가 지금까지 다뤄 온 범위(aisw01~20)와
// 같습니다 — 그 스크립트의 동작이 바뀌지 않도록 그대로 둡니다.
export const DEFAULT_END = 20;

// 절대 건드리면 안 되는 기존 계정.
// 대상 목록에 이 주소가 하나라도 섞이면 스크립트를 멈춥니다.
export const PROTECTED = ['aifest@ice.go.kr'];

/* 번호 → 아이디. 언제나 두 자리입니다(1 → aisw01, 50 → aisw50). */
export function idFor(n) { return 'aisw' + String(n).padStart(2, '0'); }

/* 번호 → sort_order.

   ⚠️ 목록 안의 순서가 아니라 계정 번호로 정합니다. 순서로 정하면
   aisw21 하나만 만들 때 그 계정이 100 을 받아 aisw01 과 겹칩니다.
   번호로 정하면 aisw01=100 … aisw20=119 로 지금 값과 똑같고,
   aisw21=120 … aisw50=149 로 겹치지 않게 이어집니다. */
export function sortOrderFor(n) { return 100 + (n - 1); }

/* 범위가 쓸 수 있는 값인지 봅니다. 문제가 있으면 사람이 읽을
   설명을, 없으면 null 을 돌려줍니다. 부르는 쪽이 같은 판단을
   되풀이하지 않도록 여기 한 곳에 둡니다. */
export function rangeProblem(start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return '시작·끝 번호는 정수여야 합니다 (받은 값: ' + start + ', ' + end + ').';
  }
  if (start < ID_MIN || start > ID_MAX) {
    return '시작 번호가 허용 범위를 벗어났습니다: ' + start +
      ' (허용 ' + ID_MIN + '~' + ID_MAX + ')';
  }
  if (end < ID_MIN || end > ID_MAX) {
    return '끝 번호가 허용 범위를 벗어났습니다: ' + end +
      ' (허용 ' + ID_MIN + '~' + ID_MAX + ')';
  }
  if (start > end) {
    return '시작 번호가 끝 번호보다 큽니다: ' + start + ' > ' + end;
  }
  return null;
}

/* 범위 안의 아이디 목록. */
export function idsFor(start, end) {
  const out = [];
  for (let n = start; n <= end; n++) out.push(idFor(n));
  return out;
}

/* 범위 → 다룰 대상 줄들. 두 스크립트가 같은 목록을 보게 합니다.
   범위를 주지 않으면 aisw01~20 입니다(기존 동작). */
export function targets(start, end) {
  start = start === undefined ? ID_MIN : start;
  end = end === undefined ? DEFAULT_END : end;

  const bad = rangeProblem(start, end);
  if (bad) throw new Error(bad);

  const out = [];
  for (let n = start; n <= end; n++) {
    out.push({
      n: n,
      id: idFor(n),
      email: (idFor(n) + '@' + ID_DOMAIN).toLowerCase(),
      sort_order: sortOrderFor(n)
    });
  }
  return out;
}

/* --start 21 --end 25 를 읽습니다. --start=21 형태도 받습니다.
   없으면 null 을 돌려줘서, 부르는 쪽이 "안 줬다"와 "잘못 줬다"를
   나눠 안내할 수 있게 합니다. */
export function parseRange(argv) {
  function pick(name) {
    const eq = argv.find(function (a) { return a.indexOf('--' + name + '=') === 0; });
    if (eq) return eq.split('=')[1];
    const i = argv.indexOf('--' + name);
    return i >= 0 ? argv[i + 1] : undefined;
  }
  const s = pick('start'), e = pick('end');
  if (s === undefined && e === undefined) return null;
  return { start: Number(s), end: Number(e) };
}

/* ── 출력 잔손질 ────────────────────────────────────────────── */

export function line(s) { console.log(s === undefined ? '' : s); }
export function head(s) { line(); line('── ' + s + ' ' + '─'.repeat(Math.max(2, 56 - s.length))); }
export function ok(s) { line('  [O] ' + s); }
export function bad(s) { line('  [X] ' + s); }
export function note(s) { line('  ·   ' + s); }

/* die() 가 던지는 신호. 오류가 아니라 "여기서 그만"이라는 뜻이라
   마무리 처리에서 따로 알아봅니다. */
export class Stop extends Error {}

/* 멈춥니다.

   ⚠️ process.exit() 을 부르지 않습니다. fetch 는 keep-alive 소켓을
      남겨 두는데, 그 상태로 process.exit 을 부르면 Windows 의
      Node 가 내부 단언(src\win\async.c)에 걸려 127 로 죽습니다.
      종료코드가 1 이 아니면 부르는 쪽에서 "범위를 잘못 줬다"와
      "진짜 실패했다"를 구분할 수 없습니다. 실제로 그랬습니다.

      대신 exitCode 만 정해 두고 신호를 던집니다. 연결을 닫고 나면
      Node 가 스스로 그 코드로 끝냅니다. */
export function die(msg) {
  line();
  line('[중단] ' + msg);
  line();
  process.exitCode = 1;
  throw new Stop(msg);
}

/* 열려 있는 연결을 닫습니다. 닫지 않으면 keep-alive 가 끝날
   때까지(기본 몇 초) 프로그램이 멈춰 있는 것처럼 보입니다.
   내부 이름이라 없을 수도 있어 조용히 넘어갑니다. */
export async function closeConnections() {
  try {
    const d = globalThis[Symbol.for('undici.globalDispatcher.1')];
    if (d && typeof d.close === 'function') await d.close();
  } catch (e) { /* 없으면 그만 */ }
}

/* main().catch(finish) 로 씁니다.
   die() 로 멈춘 것은 이미 설명을 냈으니 조용히 끝내고,
   그 밖의 오류만 내용을 보여 줍니다. */
export function finish(e) {
  if (e instanceof Stop) return;
  line();
  line('[오류] ' + (e && e.message ? e.message : e));
  if (e && e.body) line('  ' + JSON.stringify(e.body));
  line();
  process.exitCode = 1;
}

/* 키가 없으면 어느 스크립트든 여기서 멈춥니다. */
export function requireKey() {
  if (SERVICE_KEY) return;
  die('환경변수 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.\n' +
    '  PowerShell:  $env:SUPABASE_SERVICE_ROLE_KEY = \'...\'\n' +
    '  키는 Supabase → Project Settings → API → service_role 에 있습니다.\n' +
    '  키를 파일에 적거나 git 에 올리지 마세요.');
}

/* ── HTTP ───────────────────────────────────────────────────── */

export async function api(path, init) {
  init = init || {};
  const res = await fetch(SUPABASE_URL + path, Object.assign({}, init, {
    headers: Object.assign({
      apikey: SERVICE_KEY,
      Authorization: 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json'
    }, init.headers || {})
  }));

  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }

  if (!res.ok) {
    const m = (body && (body.msg || body.message || body.error_description || body.error)) ||
      text || res.statusText;
    const err = new Error(res.status + ' ' + m);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/* auth.users 를 페이지 단위로 전부 받아 옵니다. */
export async function listAuthUsers() {
  const all = [];
  for (let page = 1; page <= 50; page++) {
    const r = await api('/auth/v1/admin/users?page=' + page + '&per_page=200');
    const users = (r && r.users) || [];
    all.push.apply(all, users);
    if (users.length < 200) break;
  }
  return all;
}

export async function listStaffProfiles() {
  return await api('/rest/v1/staff_profiles?select=id,email,name,role,sort_order');
}

/* 이메일 → 사용자. 이메일은 대소문자를 가리지 않습니다. */
export function usersByEmail(users) {
  return new Map(users.map(function (u) {
    return [String(u.email || '').toLowerCase(), u];
  }));
}

export function profilesById(profiles) {
  return new Map(profiles.map(function (p) { return [p.id, p]; }));
}

/* ── 비밀번호 ───────────────────────────────────────────────── */

// 헷갈리는 글자(I, l, O, 0, 1)는 뺐습니다. 받아 적어 전달하는
// 초기 비밀번호라 오타 하나가 곧 문의로 이어집니다.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGIT = '23456789';
const SPECIAL = '!@#$%^&*?-_+=';
const ALL = UPPER + LOWER + DIGIT + SPECIAL;

function pick(set) { return set[randomInt(set.length)]; }

/* 길이를 받습니다. 계정 생성은 16자, 재설정은 8자로 다릅니다.
   4보다 짧으면 네 종류를 다 넣을 수 없어 거절합니다. */
export function makePassword(length) {
  if (!(length >= 4)) throw new Error('비밀번호 길이는 4자 이상이어야 합니다: ' + length);

  // 종류별로 한 글자씩 먼저 확보한 뒤 나머지를 채우고 섞습니다.
  // 그래야 "대문자 포함" 조건이 운에 맡겨지지 않습니다.
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SPECIAL)];
  while (chars.length < length) chars.push(pick(ALL));

  // Fisher–Yates. Math.random 이 아니라 CSPRNG(randomInt) 로 섞습니다.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const t = chars[i]; chars[i] = chars[j]; chars[j] = t;
  }
  return chars.join('');
}

/* 길이는 "이상"이 아니라 "정확히" 봅니다. 8자를 요청했는데
   9자가 나오면 그것도 규칙 위반입니다. */
export function passwordProblem(pw, length) {
  if (pw.length !== length) return '길이가 ' + length + '자가 아님(' + pw.length + '자)';
  if (!/[A-Z]/.test(pw)) return '대문자 없음';
  if (!/[a-z]/.test(pw)) return '소문자 없음';
  if (!/[0-9]/.test(pw)) return '숫자 없음';
  if (!/[!@#$%^&*?\-_+=]/.test(pw)) return '특수문자 없음';
  return null;
}

/* 규칙이 정말 조건을 만족하는지 미리 돌려 봅니다.
   중복도 같이 봅니다 — 8자처럼 짧으면 우연한 충돌이 늘어납니다. */
export function selfTestPasswords(length, rounds) {
  rounds = rounds || 200;
  const seen = new Set();
  let fail = 0;
  for (let i = 0; i < rounds; i++) {
    const pw = makePassword(length);
    if (passwordProblem(pw, length)) fail++;
    seen.add(pw);
  }
  return { fail: fail, duplicates: rounds - seen.size, bits: Math.log2(ALL.length) * length };
}

/* ── 기존 계정 스냅샷 ───────────────────────────────────────── */

// 작업 전후를 대조할 지문입니다. 하나라도 달라지면 보고합니다.
export function fingerprint(users, profiles, emails) {
  const byEmail = usersByEmail(users);
  const byId = profilesById(profiles);

  const out = {};
  emails.forEach(function (email) {
    const u = byEmail.get(String(email).toLowerCase());
    if (!u) { out[email] = null; return; }
    const p = byId.get(u.id) || null;
    out[email] = {
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      updated_at: u.updated_at,
      last_sign_in_at: u.last_sign_in_at || null,
      banned_until: u.banned_until || null,
      profile: p ? { name: p.name, role: p.role, email: p.email, sort_order: p.sort_order } : null
    };
  });
  return out;
}

/* 두 지문을 견줘 달라진 계정만 돌려줍니다.

   ignore 로 뺄 칸을 고를 수 있습니다. 비밀번호를 바꾸면 그 계정의
   updated_at 은 당연히 움직이므로, 바꾼 계정만 ['updated_at'] 으로
   견줍니다. 건드리지 않은 계정은 updated_at 까지 그대로여야 하므로
   아무것도 빼지 않고 봅니다 — 여기서 빼 두면 "안 건드렸다"는 확인이
   헐거워집니다. */
export function diffFingerprints(before, after, ignore) {
  const drop = function (v) {
    if (!v || !ignore || !ignore.length) return v;
    const c = Object.assign({}, v);
    ignore.forEach(function (k) { delete c[k]; });
    return c;
  };
  return Object.keys(before).filter(function (k) {
    return JSON.stringify(drop(before[k])) !== JSON.stringify(drop(after[k]));
  });
}
