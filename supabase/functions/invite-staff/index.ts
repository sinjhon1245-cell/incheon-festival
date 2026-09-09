// ===================================================================
// 관계자 초대 · 계정 관리 Edge Function
//
// 왜 서버에서 하는가:
//   Auth 사용자를 만들려면 service_role 권한이 필요합니다. 그 키는
//   RLS 를 전부 무시하는 마스터 키라 브라우저에 두면 안 됩니다.
//   그래서 여기서만 쓰고, 호출자가 정말 admin 인지 다시 확인합니다.
//
// 환경변수 (전부 런타임이 자동 주입 — 직접 등록할 Secret 없음):
//   SUPABASE_URL          프로젝트 API 주소
//   SUPABASE_SECRET_KEYS  secret 키 JSON 딕셔너리. 예:
//                         {"default":"sb_secret_...","internal":"sb_secret_..."}
//                         새 API 키 체계의 표준이며 이 함수가 우선 씁니다.
//   SUPABASE_SERVICE_ROLE_KEY
//                         예전 방식(deprecated). 아직 함께 주입되므로
//                         SECRET_KEYS 가 없는 환경을 위한 폴백으로만 씁니다.
//
//   둘 다 RLS 를 무시하는 권한이라 브라우저에서는 절대 쓰면 안 됩니다.
//
// 배포: Supabase 대시보드 → Edge Functions → Deploy a new function
//       이름 invite-staff, 이 파일 내용을 그대로 붙여넣기.
// ===================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/**
 * 권한 키를 고릅니다.
 * 새 체계(SUPABASE_SECRET_KEYS)를 먼저 보고, 없거나 모양이 다르면
 * 예전 SUPABASE_SERVICE_ROLE_KEY 로 물러납니다. 두 체계가 함께
 * 주입되는 과도기라 한쪽만 믿으면 환경에 따라 죽습니다.
 */
function resolvePrivilegedKey(): { key: string | null; source: string } {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      const k = parsed?.default;
      if (typeof k === 'string' && k) {
        return { key: k, source: 'SUPABASE_SECRET_KEYS.default' };
      }
      console.error('[invite-staff] SUPABASE_SECRET_KEYS 에 default 키가 없습니다. 가진 키:',
        Object.keys(parsed ?? {}));
    } catch (e) {
      console.error('[invite-staff] SUPABASE_SECRET_KEYS 를 JSON 으로 읽지 못했습니다.', e);
    }
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return { key: legacy, source: 'SUPABASE_SERVICE_ROLE_KEY (legacy)' };
  return { key: null, source: 'none' };
}

/** 사용자에게는 쉬운 말로, 개발자용 원문은 함수 로그에 남깁니다. */
function fail(userMessage: string, status: number, detail?: unknown) {
  if (detail) console.error('[invite-staff]', userMessage, detail);
  return reply({ error: userMessage }, status);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // ── 표준 환경변수 ────────────────────────────────────────────────
  const url = Deno.env.get('SUPABASE_URL');
  const { key: privilegedKey, source: keySource } = resolvePrivilegedKey();

  if (!url || !privilegedKey) {
    return fail('함수 환경이 준비되지 않았습니다. 배포 상태를 확인해 주세요.', 500,
      { hasUrl: !!url, keySource });
  }
  // 어느 체계를 썼는지 로그로 남깁니다. 키 값 자체는 절대 찍지 않습니다.
  console.log('[invite-staff] 권한 키 출처:', keySource);

  const admin = createClient(url, privilegedKey, { auth: { persistSession: false } });

  // ── 1. 로그인 확인 ───────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return fail('로그인이 필요합니다.', 401);
  }
  const token = authHeader.slice('Bearer '.length);

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return fail('로그인이 만료되었습니다. 다시 로그인해 주세요.', 401, userErr);
  }
  const callerId = userData.user.id;

  // ── 2·3. 서버에서 admin 권한 재확인 ──────────────────────────────
  // 프론트가 admin 이라고 주장하는 것은 신뢰하지 않습니다.
  const { data: caller, error: callerErr } = await admin
    .from('staff_profiles').select('role').eq('id', callerId).maybeSingle();

  if (callerErr) return fail('권한을 확인하지 못했습니다.', 500, callerErr);
  if (!caller || caller.role !== 'admin') {
    return fail('관리자만 사용할 수 있습니다.', 403);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch (e) {
    return fail('요청 형식이 올바르지 않습니다.', 400, e);
  }

  const action = String(payload.action ?? '');

  /* ── 목록: 프로필 + 로그인 상태 ─────────────────────────────── */
  if (action === 'list') {
    const { data: profiles, error } = await admin
      .from('staff_profiles').select('*')
      .order('role', { ascending: true }).order('name', { ascending: true });
    if (error) return fail('계정 목록을 불러오지 못했습니다.', 400, error);

    const { data: authList, error: listErr } =
      await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listErr) console.error('[invite-staff] listUsers 실패', listErr);

    const byId = new Map((authList?.users ?? []).map((u) => [u.id, u]));
    const rows = (profiles ?? []).map((p) => {
      const u = byId.get(p.id);
      return {
        ...p,
        email: p.email || u?.email || '',
        last_sign_in_at: u?.last_sign_in_at ?? null,
        status: !u ? '계정 없음' : u.last_sign_in_at ? '활성' : '초대됨',
      };
    });
    return reply({ rows });
  }

  /* ── 초대 ────────────────────────────────────────────────────
     4. 이메일 중복 확인 → 5. 초대 또는 생성 → 6. UUID 획득
     → 7. staff_profiles 저장 → 8. 결과 반환                      */
  if (action === 'invite') {
    const email = String(payload.email ?? '').trim().toLowerCase();
    const name = String(payload.name ?? '').trim();
    const team = String(payload.team ?? '').trim();
    const phone = String(payload.phone ?? '').trim();
    const role = payload.role === 'admin' ? 'admin' : 'staff';

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return fail('올바른 이메일 주소를 입력해 주세요.', 400);
    }
    if (!name) return fail('이름을 입력해 주세요.', 400);

    // 4. 이메일 중복 확인
    const { data: existingList, error: exErr } =
      await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (exErr) return fail('기존 계정을 확인하지 못했습니다.', 500, exErr);

    let user = (existingList?.users ?? [])
      .find((u) => (u.email ?? '').toLowerCase() === email);

    if (user) {
      // 계정은 있는데 관계자 명단에만 없는 경우가 있습니다.
      const { data: dupe } = await admin
        .from('staff_profiles').select('id').eq('id', user.id).maybeSingle();
      if (dupe) {
        return fail('이미 등록된 관계자입니다. 목록에서 수정해 주세요.', 400);
      }
    }

    let tempPassword: string | null = null;
    let createdHere = false;   // 이 요청에서 새로 만든 계정인지
    let inviteFailReason: string | null = null;  // 메일 발송이 실패한 이유

    // 5·6. 초대 또는 생성 후 UUID 확보
    if (!user) {
      const redirectTo = String(payload.redirectTo ?? '') || undefined;
      const { data: invited, error: inviteErr } =
        await admin.auth.admin.inviteUserByEmail(email, { redirectTo });

      if (!inviteErr && invited?.user) {
        user = invited.user;
        createdHere = true;
      } else {
        // 메일 발송이 막힌 프로젝트에서는 초대가 실패합니다.
        // 그때는 임시 비밀번호로 계정만 만들고 관리자가 직접 전달합니다.
        // 왜 실패했는지는 관리자 화면에도 그대로 올려 보냅니다.
        // 조용히 폴백하면 "메일 보냈겠지" 하고 넘어가게 됩니다.
        console.error('[invite-staff] 초대 메일 실패, 직접 생성으로 전환', inviteErr);
        inviteFailReason = (inviteErr && inviteErr.message) || '알 수 없는 이유';
        tempPassword = crypto.randomUUID().slice(0, 12) + 'Aa1!';
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email, password: tempPassword, email_confirm: true,
        });
        if (createErr || !created?.user) {
          return fail('계정을 만들지 못했습니다. 이메일 주소를 확인해 주세요.', 400,
            { inviteErr, createErr });
        }
        user = created.user;
        createdHere = true;
      }
    }

    // 7. staff_profiles 저장
    const { data: row, error: profErr } = await admin
      .from('staff_profiles')
      .upsert({ id: user.id, email, name, team, phone, role }, { onConflict: 'id' })
      .select().single();

    if (profErr) {
      // 프로필 저장이 실패하면 Auth 사용자만 남아 반쪽 상태가 됩니다.
      // 이 요청에서 만든 계정이면 되돌립니다.
      if (createdHere) {
        const { error: rollbackErr } = await admin.auth.admin.deleteUser(user.id);
        if (rollbackErr) console.error('[invite-staff] 롤백 실패', rollbackErr);
      }
      return fail('관계자 정보를 저장하지 못했습니다. 다시 시도해 주세요.', 400, profErr);
    }

    // 8. 결과 반환 (임시 비밀번호와 실패 사유는 폴백된 경우에만)
    return reply({ row, tempPassword, inviteFailReason });
  }

  /* ── 프로필·권한 수정 ────────────────────────────────────────── */
  if (action === 'update') {
    const id = String(payload.id ?? '');
    const patch = (payload.patch ?? {}) as Record<string, unknown>;
    if (!id) return fail('대상이 지정되지 않았습니다.', 400);

    // 마지막 admin 을 staff 로 낮추지 못하게 막습니다.
    if (patch.role === 'staff') {
      const { data: target } = await admin
        .from('staff_profiles').select('role').eq('id', id).maybeSingle();
      if (target?.role === 'admin') {
        const { count } = await admin.from('staff_profiles')
          .select('id', { count: 'exact', head: true }).eq('role', 'admin');
        if ((count ?? 0) <= 1) {
          return fail('마지막 관리자입니다. 다른 관리자를 먼저 지정해 주세요.', 400);
        }
      }
    }

    const allowed = ['name', 'team', 'phone', 'role', 'email'];
    const clean: Record<string, unknown> = {};
    allowed.forEach((k) => { if (k in patch) clean[k] = patch[k]; });

    const { data: row, error } = await admin
      .from('staff_profiles').update(clean).eq('id', id).select().single();
    if (error) return fail('저장하지 못했습니다.', 400, error);

    // 로그인 이메일도 함께 맞춰 줍니다.
    if (typeof clean.email === 'string' && clean.email) {
      const { error: mailErr } =
        await admin.auth.admin.updateUserById(id, { email: clean.email as string });
      if (mailErr) console.error('[invite-staff] 로그인 이메일 변경 실패', mailErr);
    }
    return reply({ row });
  }

  /* ── 삭제 ────────────────────────────────────────────────────── */
  if (action === 'remove') {
    const id = String(payload.id ?? '');
    if (!id) return fail('대상이 지정되지 않았습니다.', 400);
    if (id === callerId) return fail('본인 계정은 삭제할 수 없습니다.', 400);

    const { data: target } = await admin
      .from('staff_profiles').select('role').eq('id', id).maybeSingle();
    if (target?.role === 'admin') {
      const { count } = await admin.from('staff_profiles')
        .select('id', { count: 'exact', head: true }).eq('role', 'admin');
      if ((count ?? 0) <= 1) {
        return fail('마지막 관리자 계정은 삭제할 수 없습니다.', 400);
      }
    }

    const { error: profErr } = await admin.from('staff_profiles').delete().eq('id', id);
    if (profErr) return fail('관계자 정보를 지우지 못했습니다.', 400, profErr);

    const { error: delErr } = await admin.auth.admin.deleteUser(id);
    if (delErr) {
      // 프로필은 지워졌으니 이미 접근은 막힌 상태입니다.
      console.error('[invite-staff] Auth 사용자 삭제 실패', delErr);
      return reply({ ok: true, warning: '로그인 계정 삭제는 실패했지만 접근 권한은 회수했습니다.' });
    }
    return reply({ ok: true });
  }

  return fail('알 수 없는 요청입니다.', 400, { action });
});
