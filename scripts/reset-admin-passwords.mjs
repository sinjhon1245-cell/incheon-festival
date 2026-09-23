/* ===================================================================
   관리자 비밀번호 재설정 — aisw01 ~ aisw20
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
     node scripts/reset-admin-passwords.mjs --check     # 확인만
     node scripts/reset-admin-passwords.mjs --dry-run   # 새 비밀번호까지 만들어 검사(전송 안 함)
     node scripts/reset-admin-passwords.mjs --apply     # 실제 변경
   =================================================================== */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SUPABASE_URL, ID_DOMAIN, PROTECTED, targets,
  line, head, ok, bad, note, die, requireKey,
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
const MODE = argv.includes('--apply') ? 'apply'
  : argv.includes('--dry-run') ? 'dry-run'
  : 'check';

async function main() {
  line();
  line('관리자 비밀번호 재설정 — aisw01 ~ aisw20');
  line('프로젝트: ' + SUPABASE_URL);
  line('도메인  : @' + ID_DOMAIN);
  line('길이    : ' + PW_LENGTH + '자');
  line('모드    : ' + MODE + (MODE === 'apply'
    ? '   (실제로 비밀번호를 바꿉니다)'
    : '   (읽기만 합니다. 아무것도 바꾸지 않습니다)'));

  requireKey();

  const list = targets();

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

  if (missing.length) {
    bad('없는 계정 ' + missing.length + '개: ' + missing.map(function (m) { return m.id; }).join(', '));
    die('이 스크립트는 계정을 만들지 않습니다.\n' +
      '  없는 계정은 scripts/create-admin-users.mjs --apply 로 먼저 만들어 주세요.');
  }
  ok('aisw01~20 계정 ' + found.length + '/20 개 모두 있음');

  // 프로필과 권한이 지금 멀쩡한지 확인해 둡니다. 나중에 대조하려면
  // 시작 상태가 옳다는 것부터 알아야 합니다.
  const noProfile = found.filter(function (f) { return !byId0.has(f.uid); });
  const notAdmin = found.filter(function (f) {
    const p = byId0.get(f.uid);
    return p && p.role !== 'admin';
  });
  if (noProfile.length) bad('staff_profiles 줄이 없는 계정: ' + noProfile.map(function (f) { return f.id; }).join(', '));
  else ok('staff_profiles 연결 20/20');
  if (notAdmin.length) bad("role 이 admin 이 아닌 계정: " + notAdmin.map(function (f) { return f.id; }).join(', '));
  else ok("role='admin' 20/20");

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

  if (MODE !== 'apply') {
    head('4. ' + (MODE === 'check' ? '확인만 하고 끝냅니다' : '바꿀 목록 (전송하지 않음)'));
    if (MODE === 'dry-run') {
      plan.forEach(function (p) {
        note(p.id.padEnd(8) + ' uid ' + p.uid + '  비밀번호 ' + p.password.length + '자');
      });
      note('비밀번호 값은 화면에 찍지 않습니다. --apply 때 CSV 로 저장됩니다.');
    }
    line();
    line('  실제로 바꾸려면:  node scripts/reset-admin-passwords.mjs --apply');
    line();
    return;
  }

  /* 4. 실제 변경 — password 한 칸만 보냅니다 */
  head('4. 변경');
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

  /* 5. 비밀번호 목록 */
  if (done.length) {
    head('5. 비밀번호 목록');
    const rows = ['아이디,로그인이메일,초기비밀번호,uid'].concat(
      done.map(function (m) { return [m.id, m.email, m.password, m.uid].join(','); })
    );
    // ﻿ — Excel 이 UTF-8 로 열게 하는 표식입니다. 없으면 한글이 깨집니다.
    writeFileSync(OUT_CSV, '﻿' + rows.join('\r\n') + '\r\n', 'utf8');
    ok('저장: ' + OUT_CSV);
    note('이 파일은 .gitignore 로 제외되어 있습니다. 전달이 끝나면 지우세요.');
  }

  /* 6. 변경 후 검증 */
  head('6. 변경 후 검증');
  const users1 = await listAuthUsers();
  const profiles1 = await listStaffProfiles();
  const byEmail1 = usersByEmail(users1);
  const byId1 = profilesById(profiles1);

  line('  (1) Auth 사용자: ' + users0.length + '명 → ' + users1.length + '명 ' +
    (users0.length === users1.length ? '(변화 없음)' : '(!!! ' + (users1.length - users0.length) + ' 변동)'));

  const stillThere = found.filter(function (f) { return byEmail1.has(f.email); });
  line('  (2) aisw01~20 존재: ' + stillThere.length + '/20');

  const uidSame = found.filter(function (f) {
    const u = byEmail1.get(f.email);
    return u && u.id === f.uid;
  });
  line('  (3) UID 동일: ' + uidSame.length + '/20');

  const profSame = found.filter(function (f) {
    return JSON.stringify(byId0.get(f.uid)) === JSON.stringify(byId1.get(f.uid));
  });
  line('  (4) staff_profiles 변화 없음: ' + profSame.length + '/20');

  const adminOk = found.filter(function (f) {
    const p = byId1.get(f.uid);
    return p && p.role === 'admin';
  });
  line("  (5) role='admin' 유지: " + adminOk.length + '/20');

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
    line('  (6) 대상 20개 — 비밀번호 외 변화 없음 (UID·이메일·프로필·권한 그대로)');
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
  line('  로그인 확인: /admin 에서 아이디 "aisw01" 과 CSV 의 새 비밀번호로 들어가 보세요.');
  line();
}

main().catch(function (e) {
  line();
  line('[오류] ' + (e && e.message ? e.message : e));
  if (e && e.body) line('  ' + JSON.stringify(e.body));
  line();
  process.exit(1);
});
