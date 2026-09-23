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

// 다루는 아이디: aisw01 ~ aisw20
export const IDS = Array.from({ length: 20 }, function (_, i) {
  return 'aisw' + String(i + 1).padStart(2, '0');
});

// 절대 건드리면 안 되는 기존 계정.
// 대상 목록에 이 주소가 하나라도 섞이면 스크립트를 멈춥니다.
export const PROTECTED = ['aifest@ice.go.kr'];

/* 아이디 → 다룰 대상 한 줄. 두 스크립트가 같은 목록을 보게 합니다. */
export function targets() {
  return IDS.map(function (id, i) {
    return { id: id, email: (id + '@' + ID_DOMAIN).toLowerCase(), sort_order: 100 + i };
  });
}

/* ── 출력 잔손질 ────────────────────────────────────────────── */

export function line(s) { console.log(s === undefined ? '' : s); }
export function head(s) { line(); line('── ' + s + ' ' + '─'.repeat(Math.max(2, 56 - s.length))); }
export function ok(s) { line('  [O] ' + s); }
export function bad(s) { line('  [X] ' + s); }
export function note(s) { line('  ·   ' + s); }

export function die(msg) {
  line();
  line('[중단] ' + msg);
  line();
  process.exit(1);
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
