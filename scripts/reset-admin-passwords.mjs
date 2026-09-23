/* ===================================================================
   관리자 비밀번호 재설정 — 범위로 지정합니다 (aisw01 ~ aisw50)
   ───────────────────────────────────────────────────────────────────
   이미 있는 계정의 비밀번호만 바꿉니다.

   이 스크립트에는 계정을 만들거나 지우는 코드가 없습니다.
   POST /auth/v1/admin/users (생성) 도, DELETE (삭제) 도 부르지
   않습니다. 쓰는 것은 PUT /auth/v1/admin/users/<uid> 하나뿐이고,
   본문에 password 말고는 아무것도 싣지 않습니다. 그래서
   UID · 이메일 · staff_profiles · role 이 움직일 수 없습니다.

   계정을 새로 만드는 일은 create-admin-users.mjs 가 합니다.
   일부러 나눠 두었습니다 — 비밀번호를 바꾸려다 계정이 새로
   생기는 사고를 코드 수준에서 막기 위해서입니다.

   ⚠️ service_role 키가 필요합니다. 키는 환경변수로만 받습니다.

   쓰는 법 (PowerShell)
     $env:SUPABASE_SERVICE_ROLE_KEY = '...'
     node scripts/reset-admin-passwords.mjs --start 21 --end 25
     node scripts/reset-admin-passwords.mjs --start 21 --end 25 --apply

   --apply 가 없으면 아무것도 바꾸지 않고 점검 결과만 보여 줍니다.
   범위를 주지 않으면 지금까지 다뤄 온 aisw01~20 입니다.

   요청한 범위의 계정이 하나라도 없으면 아무것도 바꾸지 않고
   멈춥니다. 일부만 바뀌어 있으면 어디까지 됐는지 알기 어렵습니다.
   =================================================================== */

import { writeFileSync, existsSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SUPABASE_URL, ID_DOMAIN, ID_MIN, ID_MAX, DEFAULT_END, PROTECTED,
  targets, rangeProblem, parseRange,
  line, head, ok, bad, note, die, requireKey,
  finish, closeConnections,
  api, listAuthUsers, listStaffProfiles, usersByEmail, profilesById,
  makePassword, passwordProblem, selfTestPasswords,
  fingerprint, diffFingerprints
} from './lib/admin-api.mjs';

/* 재설정 비밀번호 길이. 나눠 주기 쉽도록 8자로 줄였습니다.
   ⚠️ 8자는 16자보다 훨씬 약합니다(약 49비트 대 98비트).
      행사 기간에만 쓰고, 끝나면 계정을 정리하는 것을 전제로 합니다. */
const PW_LENGTH = Number(process.env.ADMIN_PW_LENGTH || 8);

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_CSV = resolve(HERE, '..', 'admin-accounts.csv');

const argv = process.argv.slice(2);
// --apply 가 있을 때만 실제로 바꿉니다. 없으면 무조건 점검만 합니다.
const MODE = argv.includes('--apply') ? 'apply' : 'plan';

async function main() {
  /* 0. 범위 — 무엇보다 먼저 봅니다. 서버에 묻기 전에 걸러야
        잘못된 범위로 키를 들고 접속하는 일이 없습니다.
        주지 않으면 지금까지 다뤄 온 aisw01~20 입니다. */
  const given = parseRange(argv);
  const range = given || { start: ID_MIN, end: DEFAULT_END };

  const bad0 = rangeProblem(range.start, range.end);
  if (bad0) {
    die(bad0 + '\n' +
      '  허용 범위: ' + ID_MIN + ' ~ ' + ID_MAX + ' 이고, 시작 번호가 끝 번호보다 작거나 같아야 합니다.\n' +
      '  예:  node scripts/reset-admin-passwords.mjs --start 21 --end 25');
  }

  const list = targets(range.start, range.end);

  line();
  line('관리자 비밀번호 재설정 — ' + list[0].id + ' ~ ' + list[list.length - 1].id);
  line('프로젝트: ' + SUPABASE_URL);
  line('도메인  : @' + ID_DOMAIN);
  line('요청범위: ' + range.start + ' ~ ' + range.end + '  (대상 ' + list.length + '개)' +
    (given ? '' : '   ← 범위를 주지 않아 기본값'));
  line('길이    : ' + PW_LENGTH + '자');
  line('모드    : ' + MODE + (MODE === 'apply'
    ? '   (실제로 비밀번호를 바꿉니다)'
    : '   (점검만 합니다. 아무것도 바꾸지 않습니다)'));

  requireKey();

  /* 0. 보호 계정이 대상에 섞였는지 — 무엇보다 먼저 봅니다. */
  const clash = list.filter(function (t) { return PROTECTED.indexOf(t.email) >= 0; });
  if (clash.length) {
    die('대상 목록에 보호 계정이 들어 있습니다: ' +
      clash.map(function (c) { return c.email; }).join(', '));
  }

  /* 1. 현재 상태 */
  head('1. 현재 상태');
  const users0 = await listAuthUsers();
  ok('Auth 사용자 ' + users0.length + '명');

  let profiles0 = [];
  try {
    profiles0 = await listStaffProfiles();
    const admins0 = profiles0.filter(function (p) { return p.role === 'admin'; }).length;
    ok('staff_profiles ' + profiles0.length + '줄 (관리자 ' + admins0 + '명)');
  } catch (e) {
    die('staff_profiles 를 읽지 못했습니다: ' + e.message);
  }

  const byEmail0 = usersByEmail(users0);
  const byId0 = profilesById(profiles0);

  PROTECTED.forEach(function (p) {
    if (byEmail0.has(p)) ok('보호 계정 있음 — ' + p + ' (건드리지 않습니다)');
    else bad('보호 계정을 찾지 못했습니다 — ' + p);
  });

  /* 2. 대상 확인 — 없으면 만들지 않고 멈춥니다 */
  head('2. 대상 확인');

  const found = [];
  const missing = [];
  list.forEach(function (t) {
    const u = byEmail0.get(t.email);
    if (u) found.push({ id: t.id, email: t.email, uid: u.id });
    else missing.push(t);
  });

  // 하나라도 없으면 아무것도 바꾸지 않고 멈춥니다.
  // 일부만 바꿔 두면 어디까지 됐는지 알기 어려워집니다.
  if (missing.length) {
    bad('없는 계정 ' + missing.length + '개: ' + missing.map(function (m) { return m.id; }).join(', '));
    die('요청한 범위에 없는 계정이 있어 멈춥니다. 아무것도 바꾸지 않았습니다.\n' +
      '  이 스크립트는 계정을 만들지 않습니다.\n' +
      '  없는 계정을 먼저 만들려면:\n' +
      '    node scripts/create-admin-users.mjs --start ' + range.start +
      ' --end ' + range.end + ' --apply');
  }
  ok('요청 범위 ' + list[0].id + '~' + list[list.length - 1].id +
    ' 계정 ' + found.length + '/' + list.length + '개 모두 있음');

  // 프로필과 권한이 지금 멀쩡한지 확인해 둡니다. 나중에 대조하려면
  // 시작 상태가 옳다는 것부터 알아야 합니다.
  const noProfile = found.filter(function (f) { return !byId0.has(f.uid); });
  const notAdmin = found.filter(function (f) {
    const p = byId0.get(f.uid);
    return p && p.role !== 'admin';
  });
  if (noProfile.length) bad('staff_profiles 줄이 없는 계정: ' + noProfile.map(function (f) { return f.id; }).join(', '));
  else ok('staff_profiles 연결 ' + found.length + '/' + list.length);
  if (notAdmin.length) bad("role 이 admin 이 아닌 계정: " + notAdmin.map(function (f) { return f.id; }).join(', '));
  else ok("role='admin' " + found.length + '/' + list.length);

  /* 지문: 보호 계정은 엄격히, 대상 계정은 updated_at 만 빼고 */
  const watch = PROTECTED.concat(found.map(function (f) { return f.email; }));
  const before = fingerprint(users0, profiles0, watch);

  /* 3. 새 비밀번호 만들기 */
  head('3. 새 비밀번호');

  const test = selfTestPasswords(PW_LENGTH, 2000);
  if (test.fail) die('비밀번호 규칙이 조건을 만족하지 못합니다 (2000회 중 ' + test.fail + '회 실패).');
  ok('규칙 정상 — 정확히 ' + PW_LENGTH + '자, 대/소문자·숫자·특수문자 각 1자 이상, CSPRNG');
  note('2000회 시행 중 중복 ' + test.duplicates + '건 · 추정 엔트로피 ' + test.bits.toFixed(1) + ' bit');
  if (PW_LENGTH < 12) {
    note('⚠️ ' + PW_LENGTH + '자는 짧습니다. 행사 뒤에는 계정을 정리하는 것을 권합니다.');
  }

  // 계정마다 다른 비밀번호를 만듭니다. 짧을수록 우연한 충돌이
  // 늘어나므로, 겹치면 다시 뽑습니다.
  const used = new Set();
  const plan = [];
  for (const f of found) {
    let pw = null;
    for (let i = 0; i < 100; i++) {
      const cand = makePassword(PW_LENGTH);
      if (passwordProblem(cand, PW_LENGTH) || used.has(cand)) continue;
      pw = cand; break;
    }
    if (!pw) die(f.id + ' 의 비밀번호를 만들지 못했습니다.');
    used.add(pw);
    plan.push({ id: f.id, email: f.email, uid: f.uid, password: pw });
  }

  const lenBad = plan.filter(function (p) { return passwordProblem(p.password, PW_LENGTH); });
  if (lenBad.length) die('조건을 어긴 비밀번호 ' + lenBad.length + '개가 있습니다.');
  ok('새 비밀번호 ' + plan.length + '개 생성 — 전부 ' + PW_LENGTH + '자, 조건 충족');
  ok('서로 다른 비밀번호 ' + used.size + '/' + plan.length + '개 (중복 없음)');

  /* 4. 계획 */
  head('4. ' + (MODE === 'apply' ? '계획' : '점검 결과'));
  line('  요청 범위: ' + list[0].id + ' ~ ' + list[list.length - 1].id);
  line('  대상 계정: ' + list.length + '개 (모두 존재 확인됨)');
  line();
  line('  재설정 예정:');
  plan.forEach(function (p) {
    line('    - ' + p.id + '  uid ' + p.uid + '  새 비밀번호 ' + p.password.length + '자');
  });
  note('비밀번호 값은 화면에 찍지 않습니다. --apply 때 CSV 로만 저장됩니다.');

  if (MODE !== 'apply') {
    line();
    line('  실제 변경: 없음 (--apply 를 붙여야 바꿉니다)');
    line();
    line('  실제로 바꾸려면:  node scripts/reset-admin-passwords.mjs --start ' +
      range.start + ' --end ' + range.end + ' --apply');
    line();
    return;
  }

  /* 5. 실제 변경 — password 한 칸만 보냅니다 */
  head('5. 변경');
  const done = [];
  const failed = [];

  for (const p of plan) {
    try {
      // 본문에 password 말고는 아무것도 싣지 않습니다. 이메일이나
      // 역할을 같이 보내면 실수로 덮어쓸 수 있습니다.
      await api('/auth/v1/admin/users/' + p.uid, {
        method: 'PUT',
        body: JSON.stringify({ password: p.password })
      });
      done.push(p);
      ok(p.id.padEnd(8) + ' 변경됨  (uid ' + p.uid + ')');
    } catch (e) {
      failed.push({ id: p.id, error: e.message });
      bad(p.id + ' — 변경 실패: ' + e.message);
    }
  }

  /* 6. 비밀번호 목록 — 이번에 바꾼 계정만 적습니다. */
  if (done.length) {
    head('6. 비밀번호 목록 (이번에 바꾼 계정만)');

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
        bad('예전 admin-accounts.csv 를 옮기지 못했습니다: ' + e.message);
        bad('비밀번호는 이미 바뀌었습니다. 아래 목록을 지금 받아 두세요.');
        done.forEach(function (m) { line('    ' + m.id + ',' + m.email + ',' + m.password); });
      }
    }

    const rows = ['아이디,로그인이메일,초기비밀번호,uid'].concat(
      done.map(function (m) { return [m.id, m.email, m.password, m.uid].join(','); })
    );
    try {
      // ﻿ — Excel 이 UTF-8 로 열게 하는 표식입니다. 없으면 한글이 깨집니다.
      writeFileSync(OUT_CSV, '﻿' + rows.join('\r\n') + '\r\n', 'utf8');
      ok('저장: ' + OUT_CSV + '  (' + done.length + '줄)');
      note('이 파일은 .gitignore 로 제외되어 있습니다. 전달이 끝나면 지우세요.');
    } catch (e) {
      // 비밀번호는 이미 바뀌었습니다. 파일에 못 쓰더라도 화면으로는
      // 반드시 넘겨 줘야 합니다 — 여기서 잃으면 되돌릴 수 없습니다.
      bad('목록을 파일로 저장하지 못했습니다: ' + e.message);
      bad('비밀번호는 이미 바뀌었습니다. 아래를 지금 받아 두세요.');
      line('    아이디,로그인이메일,초기비밀번호,uid');
      done.forEach(function (m) {
        line('    ' + [m.id, m.email, m.password, m.uid].join(','));
      });
    }
  }

  /* 7. 변경 후 검증 */
  head('7. 변경 후 검증');
  const users1 = await listAuthUsers();
  const profiles1 = await listStaffProfiles();
  const byEmail1 = usersByEmail(users1);
  const byId1 = profilesById(profiles1);

  line('  (1) Auth 사용자: ' + users0.length + '명 → ' + users1.length + '명 ' +
    (users0.length === users1.length ? '(변화 없음)' : '(!!! ' + (users1.length - users0.length) + ' 변동)'));

  const stillThere = found.filter(function (f) { return byEmail1.has(f.email); });
  line('  (2) 요청 범위 ' + list[0].id + '~' + list[list.length - 1].id + ' 존재: ' + stillThere.length + '/' + list.length);

  const uidSame = found.filter(function (f) {
    const u = byEmail1.get(f.email);
    return u && u.id === f.uid;
  });
  line('  (3) UID 동일: ' + uidSame.length + '/' + list.length);

  const profSame = found.filter(function (f) {
    return JSON.stringify(byId0.get(f.uid)) === JSON.stringify(byId1.get(f.uid));
  });
  line('  (4) staff_profiles 변화 없음: ' + profSame.length + '/' + list.length);

  const adminOk = found.filter(function (f) {
    const p = byId1.get(f.uid);
    return p && p.role === 'admin';
  });
  line("  (5) role='admin' 유지: " + adminOk.length + '/' + list.length);

  const after = fingerprint(users1, profiles1, watch);

  // 대상 계정: updated_at 은 비밀번호를 바꿨으니 움직이는 게 맞습니다.
  const targetEmails = found.map(function (f) { return f.email; });
  const targetBefore = {}, targetAfter = {};
  targetEmails.forEach(function (e) { targetBefore[e] = before[e]; targetAfter[e] = after[e]; });
  const targetChanged = diffFingerprints(targetBefore, targetAfter, ['updated_at']);
  if (targetChanged.length) {
    bad('(6) 비밀번호 말고 다른 것이 바뀐 계정: ' + targetChanged.join(', '));
    targetChanged.forEach(function (e) {
      line('      전: ' + JSON.stringify(targetBefore[e]));
      line('      후: ' + JSON.stringify(targetAfter[e]));
    });
  } else {
    line('  (6) 대상 ' + list.length + '개 — 비밀번호 외 변화 없음 (UID·이메일·프로필·권한 그대로)');
  }

  // 보호 계정: updated_at 까지 그대로여야 합니다.
  const protBefore = {}, protAfter = {};
  PROTECTED.forEach(function (e) { protBefore[e] = before[e]; protAfter[e] = after[e]; });
  const protChanged = diffFingerprints(protBefore, protAfter);
  if (protChanged.length) {
    bad('(7) 보호 계정에 변화가 있습니다: ' + protChanged.join(', '));
    protChanged.forEach(function (e) {
      line('      전: ' + JSON.stringify(protBefore[e]));
      line('      후: ' + JSON.stringify(protAfter[e]));
    });
  } else {
    line('  (7) 보호 계정 ' + PROTECTED.length + '개 — 변화 없음(updated_at 포함)');
  }

  if (failed.length) {
    head('실패 항목');
    failed.forEach(function (f) { bad(f.id + ' — ' + f.error); });
  }

  head('요약');
  line('  비밀번호 변경   : ' + done.length + '개');
  line('  실패            : ' + failed.length + '개');
  line('  Auth 총 사용자  : ' + users1.length + '명 (변화 없어야 정상)');
  line();
  if (done.length) line('  로그인 확인: /admin 에서 아이디 "' + done[0].id + '" 과 CSV 의 새 비밀번호로 들어가 보세요.');
  line();
}

main().catch(finish).then(closeConnections);
