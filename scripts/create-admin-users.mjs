/* ===================================================================
   관리자 계정 생성 — 범위로 지정합니다 (aisw01 ~ aisw50)
   ───────────────────────────────────────────────────────────────────
   Supabase Auth Admin API 로 관리자 계정을 만들고, 각 계정을
   staff_profiles 에 role='admin' 으로 연결합니다.

   계정을 늘릴 때마다 이 파일을 고치지 않아도 되도록, 만들 번호를
   인자로 받습니다. 이미 있는 계정은 건너뜁니다 — 같은 명령을 두 번
   돌려도 결과가 같습니다.

   이미 있는 계정의 비밀번호만 바꾸려면 이 파일이 아니라
   reset-admin-passwords.mjs 를 쓰세요. 일부러 나눠 두었습니다 —
   비밀번호를 바꾸려다 계정이 새로 생기는 사고를 막기 위해서입니다.
   이 파일에는 비밀번호를 바꾸는 코드가 없습니다.

   ⚠️ service_role 키가 필요합니다. 키는 환경변수로만 받습니다.
      이 파일에도, 저장소 어디에도 키를 적지 마세요.
      service_role 키는 RLS 를 전부 무시하는 마스터 키입니다.

   쓰는 법 (PowerShell)
     $env:SUPABASE_SERVICE_ROLE_KEY = '...'
     node scripts/create-admin-users.mjs --start 21 --end 25
     node scripts/create-admin-users.mjs --start 21 --end 25 --apply

   --apply 가 없으면 아무것도 만들지 않고 점검 결과만 보여 줍니다.

   안전장치
     · 기존 계정은 건드리지 않습니다. 이 스크립트에는 사용자
       삭제·수정·비밀번호 변경을 하는 코드가 아예 없습니다.
     · 보호 계정(PROTECTED)이 대상 목록에 섞이면 즉시 멈춥니다.
     · 이미 있는 계정은 건너뜁니다. 덮어쓰지 않습니다.
     · --apply 전후로 기존 계정을 스냅샷해 변화가 없는지 대조합니다.
   =================================================================== */

import { writeFileSync, existsSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SUPABASE_URL, ID_DOMAIN, ID_MIN, ID_MAX, PROTECTED,
  targets, idsFor, rangeProblem, parseRange,
  line, head, ok, bad, note, die, requireKey,
  finish, closeConnections,
  api, listAuthUsers, listStaffProfiles, usersByEmail,
  makePassword, passwordProblem, selfTestPasswords,
  fingerprint, diffFingerprints
} from './lib/admin-api.mjs';

/* 새 계정의 비밀번호 길이. 운영 규칙에 맞춰 8자입니다.
   ⚠️ 8자는 약 49비트로 짧습니다. 나눠 주기 쉬우라고 줄인 값이니,
      행사 뒤에는 계정을 정리하는 편이 좋습니다.
      규칙 자체는 lib/admin-api.mjs 것을 그대로 씁니다. */
const PW_LENGTH = Number(process.env.ADMIN_PW_LENGTH || 8);

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_CSV = resolve(HERE, '..', 'admin-accounts.csv');

const argv = process.argv.slice(2);
// --apply 가 있을 때만 실제로 만듭니다. 없으면 무조건 점검만 합니다.
const MODE = argv.includes('--apply') ? 'apply' : 'plan';

async function main() {
  /* 0. 범위 — 무엇보다 먼저 봅니다. 서버에 묻기 전에 걸러야
        잘못된 범위로 키를 들고 접속하는 일이 없습니다. */
  const range = parseRange(argv);
  if (!range) {
    die('만들 범위를 지정해 주세요.\n' +
      '  예:  node scripts/create-admin-users.mjs --start 21 --end 25\n' +
      '  허용 범위: ' + ID_MIN + ' ~ ' + ID_MAX + ' (aisw01 ~ aisw' + ID_MAX + ')');
  }
  const bad0 = rangeProblem(range.start, range.end);
  if (bad0) {
    die(bad0 + '\n' +
      '  허용 범위: ' + ID_MIN + ' ~ ' + ID_MAX + ' 이고, 시작 번호가 끝 번호보다 작거나 같아야 합니다.');
  }

  const list = targets(range.start, range.end);
  const rangeIds = idsFor(range.start, range.end);

  line();
  line('관리자 계정 생성 — ' + list[0].id + ' ~ ' + list[list.length - 1].id);
  line('프로젝트: ' + SUPABASE_URL);
  line('도메인  : @' + ID_DOMAIN);
  line('요청범위: ' + range.start + ' ~ ' + range.end + '  (대상 ' + list.length + '개)');
  line('모드    : ' + MODE + (MODE === 'apply'
    ? '   (실제로 생성합니다)'
    : '   (점검만 합니다. 아무것도 만들지 않습니다)'));

  requireKey();

  /* 0. 보호 계정이 대상에 섞였는지 — 무엇보다 먼저 확인합니다. */
  const clash = list.filter(function (t) { return PROTECTED.indexOf(t.email) >= 0; });
  if (clash.length) {
    die('대상 목록에 보호 계정이 들어 있습니다: ' +
      clash.map(function (c) { return c.email; }).join(', '));
  }

  /* 1. 현재 상태 읽기 */
  head('1. 현재 상태');
  const users0 = await listAuthUsers();
  ok('Auth 사용자 ' + users0.length + '명');

  let profiles0 = [];
  try {
    profiles0 = await listStaffProfiles();
    const admins0 = profiles0.filter(function (p) { return p.role === 'admin'; }).length;
    ok('staff_profiles ' + profiles0.length + '줄 (관리자 ' + admins0 + '명)');
  } catch (e) {
    die('staff_profiles 를 읽지 못했습니다: ' + e.message +
      '\n  supabase/migration-portal.sql 이 실행되었는지 확인해 주세요.');
  }

  const byEmail0 = usersByEmail(users0);

  PROTECTED.forEach(function (p) {
    if (byEmail0.has(p)) ok('보호 계정 있음 — ' + p);
    else bad('보호 계정을 찾지 못했습니다 — ' + p + ' (프로젝트가 맞는지 확인해 주세요)');
  });

  /* 2. 생성 전 검증 */
  head('2. 생성 전 검증');

  // 이미 있는 것은 건너뛸 것, 없는 것만 만들 것으로 나눕니다.
  // 이미 있다고 해서 전체를 실패시키지 않습니다.
  const already = list.filter(function (t) { return byEmail0.has(t.email); });
  const toCreate = list.filter(function (t) { return !byEmail0.has(t.email); });

  // 요청한 범위 안의 이름이 staff_profiles 에 이미 있는지만 봅니다.
  // 범위 밖 계정(다른 번호)은 여기서 따질 일이 아닙니다.
  const nameTaken = profiles0.filter(function (p) {
    return rangeIds.indexOf(String(p.name || '').toLowerCase()) >= 0;
  });

  /* 나중에 대조할 지문. 보호 계정뿐 아니라 이번에 건너뛸 기존
     계정까지 담습니다. "건드리지 않았다"를 말로만 하지 않고
     전후 비교로 보이기 위해서입니다. */
  const watch = PROTECTED.concat(already.map(function (t) { return t.email; }));
  const before = fingerprint(users0, profiles0, watch);

  if (already.length) {
    note('이미 있어서 건너뛸 계정 ' + already.length + '개: ' +
      already.map(function (t) { return t.id; }).join(', '));
    note('비밀번호만 바꾸려면 reset-admin-passwords.mjs 를 쓰세요. 이 스크립트는 바꾸지 않습니다.');
  } else {
    ok('요청 범위에 이미 있는 계정 없음');
  }

  if (nameTaken.length) {
    note('staff_profiles 에 같은 이름의 줄 ' + nameTaken.length + '개: ' +
      nameTaken.map(function (p) { return p.name; }).join(', '));
  } else {
    ok('staff_profiles 에 요청 범위 이름의 줄 없음');
  }

  // 비밀번호 규칙이 실제로 조건을 만족하는지 미리 돌려 봅니다.
  const test = selfTestPasswords(PW_LENGTH, 500);
  if (test.fail) die('비밀번호 생성 규칙이 조건을 만족하지 못합니다 (500회 중 ' + test.fail + '회 실패).');
  ok('비밀번호 규칙 정상 — 정확히 ' + PW_LENGTH + '자, 대/소문자·숫자·특수문자 각 1자 이상, CSPRNG');

  ok('service_role 키는 환경변수에서만 읽습니다 (소스·CSV 어디에도 기록하지 않습니다)');

  /* 3. 계획 */
  head('3. ' + (MODE === 'apply' ? '계획' : '점검 결과'));
  line('  요청 범위: ' + list[0].id + ' ~ ' + list[list.length - 1].id);
  line('  대상 계정: ' + list.length + '개');
  line();
  line('  기존 계정 (건너뜀):');
  if (already.length) already.forEach(function (t) { line('    - ' + t.id + '  SKIP'); });
  else line('    - 없음');
  line();
  line('  생성 예정:');
  if (toCreate.length) toCreate.forEach(function (t) { line('    - ' + t.id + '  → ' + t.email); });
  else line('    - 없음');

  if (MODE !== 'apply') {
    line();
    line('  실제 생성: 없음 (--apply 를 붙여야 만듭니다)');
    line();
    line(toCreate.length
      ? '  실제로 만들려면:  node scripts/create-admin-users.mjs --start ' +
        range.start + ' --end ' + range.end + ' --apply'
      : '  새로 만들 계정이 없습니다. 이 범위는 이미 다 있습니다.');
    line();
    return;
  }

  /* 4. 실제 생성 */
  head('4. 생성');
  if (!toCreate.length) note('새로 만들 계정이 없습니다. 아무것도 하지 않습니다.');

  const made = [];
  const failed = [];

  for (const t of toCreate) {
    const password = makePassword(PW_LENGTH);
    const problem = passwordProblem(password, PW_LENGTH);
    if (problem) {
      failed.push({ id: t.id, step: '비밀번호', error: problem });
      bad(t.id + ' — 비밀번호 ' + problem);
      continue;
    }

    let user;
    try {
      // email_confirm: true → 확인 메일을 보내지 않고 바로 쓰게 합니다.
      // @aisw.local 은 받는 곳이 없는 내부 전용 주소입니다.
      user = await api('/auth/v1/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          email: t.email,
          password: password,
          email_confirm: true,
          user_metadata: { login_id: t.id }
        })
      });
    } catch (e) {
      failed.push({ id: t.id, step: 'Auth', error: e.message });
      bad(t.id + ' — Auth 생성 실패: ' + e.message);
      continue;
    }

    try {
      // insert 만 합니다. upsert 를 쓰지 않는 이유는, 같은 id 의 줄이
      // 이미 있다면 그건 우리가 모르는 줄이고 덮어쓰면 안 되기
      // 때문입니다. 충돌하면 그대로 오류로 남깁니다.
      await api('/rest/v1/staff_profiles', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          id: user.id,
          email: t.email,
          name: t.id,
          team: '',
          phone: '',
          role: 'admin',
          sort_order: t.sort_order
        })
      });
    } catch (e) {
      failed.push({ id: t.id, step: 'profile', error: e.message, uid: user.id });
      bad(t.id + ' — Auth 는 만들어졌지만 staff_profiles 연결 실패: ' + e.message);
      continue;
    }

    made.push({ id: t.id, email: t.email, uid: user.id, password: password });
    ok(t.id.padEnd(8) + ' → ' + t.email + '  (uid ' + user.id + ')');
  }

  /* 5. 비밀번호 목록 파일 — 이번에 만든 것만 적습니다.

     건너뛴 계정의 비밀번호는 우리가 알 수 없습니다(해시로만
     저장됩니다). 그래서 추측해 적지 않고 아예 넣지 않습니다.
     그 계정들의 비밀번호가 필요하면 reset-admin-passwords.mjs 로
     새로 발급해야 합니다. */
  if (made.length) {
    head('5. 비밀번호 목록 (이번에 만든 계정만)');

    // 예전 목록을 말없이 덮어쓰지 않습니다. 아직 나눠 주지 않은
    // 비밀번호가 그 안에 있을 수 있습니다. 옆으로 치워 둡니다.
    if (existsSync(OUT_CSV)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backup = OUT_CSV.replace(/\.csv$/, '') + '.' + stamp + '.csv';
      try {
        renameSync(OUT_CSV, backup);
        note('예전 목록을 옮겨 두었습니다: ' + backup);
        note('(admin-accounts.* 는 모두 .gitignore 로 제외됩니다)');
      } catch (e) {
        // 여기서 멈추면 안 됩니다. 계정은 이미 만들어졌고 새
        // 비밀번호는 아직 메모리에만 있습니다. 멈추면 영영 잃습니다.
        // 파일에 못 쓰더라도 화면으로는 반드시 넘겨 줍니다.
        bad('예전 admin-accounts.csv 를 옮기지 못했습니다: ' + e.message);
        bad('계정은 이미 만들어졌습니다. 아래 비밀번호를 지금 받아 두세요.');
        made.forEach(function (m) { line('    ' + m.id + ',' + m.email + ',' + m.password); });
      }
    }

    const rows = ['아이디,로그인이메일,초기비밀번호,uid'].concat(
      made.map(function (m) { return [m.id, m.email, m.password, m.uid].join(','); })
    );
    try {
      // ﻿ — Excel 이 UTF-8 로 열게 하는 표식입니다. 없으면 한글이 깨집니다.
      writeFileSync(OUT_CSV, '﻿' + rows.join('\r\n') + '\r\n', 'utf8');
      ok('저장: ' + OUT_CSV + '  (' + made.length + '줄)');
      note('이 파일은 .gitignore 로 제외되어 있습니다. 전달이 끝나면 지우세요.');
    } catch (e) {
      bad('목록을 파일로 저장하지 못했습니다: ' + e.message);
      bad('계정은 이미 만들어졌습니다. 아래를 지금 받아 두세요.');
      line('    아이디,로그인이메일,초기비밀번호,uid');
      made.forEach(function (m) {
        line('    ' + [m.id, m.email, m.password, m.uid].join(','));
      });
    }
  } else {
    head('5. 비밀번호 목록');
    note('새로 만든 계정이 없어 admin-accounts.csv 를 건드리지 않았습니다.');
  }

  /* 6. 생성 후 검증 */
  head('6. 생성 후 검증');
  const users1 = await listAuthUsers();
  const profiles1 = await listStaffProfiles();
  const byEmail1 = usersByEmail(users1);
  const profById = new Map(profiles1.map(function (p) { return [p.id, p]; }));
  const uidOf = function (email) { const u = byEmail1.get(email); return u && u.id; };

  const grew = users1.length - users0.length;
  line('  (1) Auth 사용자: ' + users0.length + '명 → ' + users1.length + '명 ' +
    '(증가 ' + grew + ', 신규 생성 ' + made.length + '개' +
    (grew === made.length ? ' — 일치' : ' — !!! 어긋남') + ')');

  // 요청 범위가 전부 갖춰졌는지
  const present = list.filter(function (t) { return byEmail1.has(t.email); });
  line('  (2) 요청 범위 ' + list[0].id + '~' + list[list.length - 1].id +
    ' 존재: ' + present.length + '/' + list.length);

  // 이번에 만든 것만 따로 — 요청서가 요구한 숫자입니다
  const madeWithProf = made.filter(function (m) { return profById.has(uidOf(m.email)); });
  const madeWithAdmin = made.filter(function (m) {
    const p = profById.get(uidOf(m.email));
    return p && p.role === 'admin';
  });
  line('  (3) 신규 staff_profiles: ' + madeWithProf.length + '/' + made.length);
  line("  (4) 신규 role='admin'  : " + madeWithAdmin.length + '/' + made.length);

  // sort_order 가 기존 계정과 겹치지 않는지 — 번호로 정하므로
  // 겹칠 수 없지만, 실제 값으로 확인해 둡니다.
  const orders = profiles1
    .filter(function (p) { return /^aisw\d\d$/.test(String(p.name || '')); })
    .map(function (p) { return p.sort_order; });
  const dupOrders = orders.length - new Set(orders).size;
  line('  (5) sort_order 중복: ' + dupOrders + '건' + (dupOrders ? ' — !!! 확인 필요' : ''));

  // 건드리지 않았어야 할 계정들 — 보호 계정 + 이번에 건너뛴 계정
  const after = fingerprint(users1, profiles1, watch);
  const changed = diffFingerprints(before, after);
  if (changed.length) {
    bad('(6) 건드리지 않았어야 할 계정에 변화가 있습니다: ' + changed.join(', '));
    changed.forEach(function (e) {
      line('      전: ' + JSON.stringify(before[e]));
      line('      후: ' + JSON.stringify(after[e]));
    });
  } else {
    line('  (6) 기존 계정 ' + watch.length + '개 (보호 ' + PROTECTED.length +
      ' + 건너뜀 ' + already.length + ') — UID·이메일·생성시각·프로필·권한 모두 변화 없음');
  }

  if (failed.length) {
    head('실패 항목');
    failed.forEach(function (f) { bad(f.id + ' [' + f.step + '] ' + f.error); });
  }

  head('요약');
  line('  신규 생성          : ' + made.length + '개');
  line('  건너뜀(이미 있음)  : ' + already.length + '개');
  line('  실패               : ' + failed.length + '개');
  line('  Auth 총 사용자     : ' + users0.length + ' → ' + users1.length + '명');
  line('  비밀번호 변경      : 0개 (이 스크립트는 바꾸지 않습니다)');
  if (made.length) {
    line();
    line('  로그인 확인: /admin 에서 아이디 "' + made[0].id + '" 과 CSV 의 비밀번호로 들어가 보세요.');
  }
  line();
}

main().catch(finish).then(closeConnections);
