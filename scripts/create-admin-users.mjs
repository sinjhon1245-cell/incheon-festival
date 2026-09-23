/* ===================================================================
   관리자 계정 일괄 생성 — aisw01 ~ aisw20
   ───────────────────────────────────────────────────────────────────
   Supabase Auth Admin API 로 관리자 계정을 만들고, 각 계정을
   staff_profiles 에 role='admin' 으로 연결합니다.

   이미 있는 계정의 비밀번호만 바꾸려면 이 파일이 아니라
   reset-admin-passwords.mjs 를 쓰세요. 일부러 나눠 두었습니다 —
   비밀번호를 바꾸려다 계정이 새로 생기는 사고를 막기 위해서입니다.

   ⚠️ service_role 키가 필요합니다. 키는 환경변수로만 받습니다.
      이 파일에도, 저장소 어디에도 키를 적지 마세요.
      service_role 키는 RLS 를 전부 무시하는 마스터 키입니다.

   쓰는 법 (PowerShell)
     $env:SUPABASE_SERVICE_ROLE_KEY = '...'
     node scripts/create-admin-users.mjs --check      # 확인만
     node scripts/create-admin-users.mjs --dry-run    # 만들 목록까지
     node scripts/create-admin-users.mjs --apply      # 실제 생성

   안전장치
     · 기존 계정은 건드리지 않습니다. 이 스크립트에는 사용자
       삭제·수정·비밀번호 변경을 하는 코드가 아예 없습니다.
     · 보호 계정(PROTECTED)이 대상 목록에 섞이면 즉시 멈춥니다.
     · 이미 있는 계정은 건너뜁니다. 덮어쓰지 않습니다.
     · --apply 전후로 기존 계정을 스냅샷해 변화가 없는지 대조합니다.
   =================================================================== */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SUPABASE_URL, ID_DOMAIN, IDS, PROTECTED, targets,
  line, head, ok, bad, note, die, requireKey,
  api, listAuthUsers, listStaffProfiles, usersByEmail,
  makePassword, passwordProblem, selfTestPasswords,
  fingerprint, diffFingerprints
} from './lib/admin-api.mjs';

/* 새 계정의 비밀번호 길이.
   재설정(reset-admin-passwords.mjs)은 나눠 주기 쉽도록 더 짧게
   쓰지만, 새로 만드는 계정은 굳이 짧게 할 이유가 없습니다. */
const PW_LENGTH = Number(process.env.ADMIN_PW_LENGTH || 16);

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_CSV = resolve(HERE, '..', 'admin-accounts.csv');

const argv = process.argv.slice(2);
const MODE = argv.includes('--apply') ? 'apply'
  : argv.includes('--dry-run') ? 'dry-run'
  : 'check';

async function main() {
  line();
  line('관리자 계정 생성 — aisw01 ~ aisw20');
  line('프로젝트: ' + SUPABASE_URL);
  line('도메인  : @' + ID_DOMAIN);
  line('모드    : ' + MODE + (MODE === 'apply'
    ? '   (실제로 생성합니다)'
    : '   (읽기만 합니다. 아무것도 만들지 않습니다)'));

  requireKey();

  const list = targets();

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

  const before = fingerprint(users0, profiles0, PROTECTED);

  /* 2. 생성 전 검증 */
  head('2. 생성 전 검증');

  const already = list.filter(function (t) { return byEmail0.has(t.email); });
  const toCreate = list.filter(function (t) { return !byEmail0.has(t.email); });
  const nameTaken = profiles0.filter(function (p) {
    return IDS.indexOf(String(p.name || '').toLowerCase()) >= 0;
  });

  if (already.length) {
    note('이미 Auth 에 있는 대상 ' + already.length + '개 — 건너뜁니다: ' +
      already.map(function (t) { return t.id; }).join(', '));
    note('비밀번호만 바꾸려면 reset-admin-passwords.mjs 를 쓰세요.');
  } else {
    ok('aisw01~20 중 Auth 에 이미 있는 계정 없음');
  }

  if (nameTaken.length) {
    note('staff_profiles 에 같은 이름의 줄 ' + nameTaken.length + '개: ' +
      nameTaken.map(function (p) { return p.name; }).join(', '));
  } else {
    ok('staff_profiles 에 aisw01~20 이름의 줄 없음');
  }

  // 비밀번호 규칙이 실제로 조건을 만족하는지 미리 돌려 봅니다.
  const test = selfTestPasswords(PW_LENGTH, 200);
  if (test.fail) die('비밀번호 생성 규칙이 조건을 만족하지 못합니다 (200회 중 ' + test.fail + '회 실패).');
  ok('비밀번호 규칙 정상 — ' + PW_LENGTH + '자, 대/소문자·숫자·특수문자 각 1자 이상, CSPRNG');

  ok('service_role 키는 환경변수에서만 읽습니다 (소스·CSV 어디에도 기록하지 않습니다)');
  note('새로 만들 계정: ' + toCreate.length + '개');

  if (MODE !== 'apply') {
    head('3. ' + (MODE === 'check' ? '확인만 하고 끝냅니다' : '만들 목록 (실제로는 만들지 않음)'));
    if (MODE === 'dry-run') {
      toCreate.forEach(function (t) { note(t.id.padEnd(8) + ' → ' + t.email); });
    }
    line();
    line(toCreate.length
      ? '  실제로 만들려면:  node scripts/create-admin-users.mjs --apply'
      : '  새로 만들 계정이 없습니다.');
    line();
    return;
  }

  /* 3. 실제 생성 */
  head('3. 생성');
  if (!toCreate.length) note('새로 만들 계정이 없습니다.');

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

  /* 4. 비밀번호 목록 파일 */
  if (made.length) {
    head('4. 비밀번호 목록');
    const rows = ['아이디,로그인이메일,초기비밀번호,uid'].concat(
      made.map(function (m) { return [m.id, m.email, m.password, m.uid].join(','); })
    );
    // ﻿ — Excel 이 UTF-8 로 열게 하는 표식입니다. 없으면 한글이 깨집니다.
    writeFileSync(OUT_CSV, '﻿' + rows.join('\r\n') + '\r\n', 'utf8');
    ok('저장: ' + OUT_CSV);
    note('이 파일은 .gitignore 로 제외되어 있습니다. 전달이 끝나면 지우세요.');
  }

  /* 5. 생성 후 검증 */
  head('5. 생성 후 검증');
  const users1 = await listAuthUsers();
  const profiles1 = await listStaffProfiles();
  const byEmail1 = usersByEmail(users1);

  const present = list.filter(function (t) { return byEmail1.has(t.email); });
  line('  (1) Auth 사용자: ' + users0.length + '명 → ' + users1.length + '명 ' +
    '(증가 ' + (users1.length - users0.length) + ')');
  line('      aisw01~20 중 존재: ' + present.length + '/20');

  const profById = new Map(profiles1.map(function (p) { return [p.id, p]; }));
  const uidOf = function (t) { const u = byEmail1.get(t.email); return u && u.id; };

  const withProf = list.filter(function (t) { return profById.has(uidOf(t)); });
  const withAdmin = list.filter(function (t) {
    const p = profById.get(uidOf(t));
    return p && p.role === 'admin';
  });
  line('  (2) staff_profiles 연결: ' + withProf.length + '/20');
  line("  (3) role='admin': " + withAdmin.length + '/20');

  const after = fingerprint(users1, profiles1, PROTECTED);
  const changed = diffFingerprints(before, after);

  if (changed.length) {
    bad('(4) 기존 계정에 변화가 있습니다: ' + changed.join(', '));
    changed.forEach(function (e) {
      line('      전: ' + JSON.stringify(before[e]));
      line('      후: ' + JSON.stringify(after[e]));
    });
  } else {
    line('  (4) 기존 계정 ' + PROTECTED.length + '개 — UID·이메일·프로필·권한 모두 변화 없음');
  }

  if (failed.length) {
    head('실패 항목');
    failed.forEach(function (f) { bad(f.id + ' [' + f.step + '] ' + f.error); });
  }

  head('요약');
  line('  신규 생성          : ' + made.length + '개');
  line('  건너뜀(이미 있음)  : ' + already.length + '개');
  line('  실패               : ' + failed.length + '개');
  line('  Auth 총 사용자     : ' + users1.length + '명');
  line();
  line('  로그인 확인: /admin 에서 아이디 "aisw01" 과 CSV 의 비밀번호로 들어가 보세요.');
  line();
}

main().catch(function (e) {
  line();
  line('[오류] ' + (e && e.message ? e.message : e));
  if (e && e.body) line('  ' + JSON.stringify(e.body));
  line();
  process.exit(1);
});
