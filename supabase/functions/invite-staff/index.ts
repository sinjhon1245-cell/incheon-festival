// ===================================================================
// 관계자 초대 · 계정 관리 Edge Function
//
// 왜 Edge Function 인가:
//   Auth 사용자를 만들려면 service_role 키가 필요합니다. 그 키는
//   RLS 를 전부 무시하는 마스터 키라 브라우저에 두면 안 됩니다.
//   그래서 서버(Edge Function)에만 두고, 관리자 여부를 확인한 뒤
//   대신 처리합니다.
//
// 배포:
//   supabase functions deploy invite-staff
//   supabase secrets set SERVICE_ROLE_KEY=<service_role 키>
//
//   SUPABASE_URL 은 런타임이 자동 주입합니다.
//   SERVICE_ROLE_KEY 는 반드시 Function Secret 으로만 두세요.
//   저장소에 커밋하지 않습니다.
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    return reply({ error: '함수 설정이 완료되지 않았습니다. SERVICE_ROLE_KEY 시크릿을 등록해 주세요.' }, 500);
  }

  // 관리자 권한 확인 — 호출자의 토큰으로 본인 프로필을 읽습니다.
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return reply({ error: '로그인이 필요합니다.' }, 401);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: userData, error: userErr } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
  if (userErr || !userData?.user) {
    return reply({ error: '로그인이 만료되었습니다. 다시 로그인해 주세요.' }, 401);
  }

  const { data: profile } = await admin
    .from('staff_profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (!profile || profile.role !== 'admin') {
    return reply({ error: '관리자만 사용할 수 있습니다.' }, 403);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return reply({ error: '요청 형식이 올바르지 않습니다.' }, 400);
  }

  const action = String(payload.action ?? '');

  // ── 목록: 프로필 + 로그인 상태를 합쳐 돌려줍니다 ────────────────
  if (action === 'list') {
    const { data: profiles, error } = await admin
      .from('staff_profiles')
      .select('*')
      .order('role', { ascending: true })
      .order('name', { ascending: true });
    if (error) return reply({ error: error.message }, 400);

    const { data: authList } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const byId = new Map((authList?.users ?? []).map((u) => [u.id, u]));

    const rows = (profiles ?? []).map((p) => {
      const u = byId.get(p.id);
      return {
        ...p,
        email: p.email || u?.email || '',
        last_sign_in_at: u?.last_sign_in_at ?? null,
        confirmed: !!(u?.email_confirmed_at || u?.confirmed_at),
        status: !u ? '계정 없음' : u.last_sign_in_at ? '활성' : '초대됨',
      };
    });
    return reply({ rows });
  }

  // ── 초대: Auth 사용자 생성 후 staff_profiles 자동 생성 ──────────
  if (action === 'invite') {
    const email = String(payload.email ?? '').trim().toLowerCase();
    const name = String(payload.name ?? '').trim();
    const team = String(payload.team ?? '').trim();
    const phone = String(payload.phone ?? '').trim();
    const role = payload.role === 'admin' ? 'admin' : 'staff';

    if (!email || !email.includes('@')) return reply({ error: '올바른 이메일을 입력해 주세요.' }, 400);
    if (!name) return reply({ error: '이름을 입력해 주세요.' }, 400);

    // 이미 있는 계정이면 새로 만들지 않고 프로필만 연결합니다.
    const { data: existingList } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    let user = (existingList?.users ?? []).find((u) => (u.email ?? '').toLowerCase() === email);

    if (!user) {
      const redirectTo = String(payload.redirectTo ?? '') || undefined;
      const { data: invited, error: inviteErr } =
        await admin.auth.admin.inviteUserByEmail(email, { redirectTo });

      if (inviteErr || !invited?.user) {
        // 메일 발송이 막혀 있는 프로젝트에서는 초대가 실패할 수 있습니다.
        // 그때는 임시 비밀번호로 계정만 만들고 관리자가 따로 전달합니다.
        const tempPassword = crypto.randomUUID() + 'Aa1!';
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
        });
        if (createErr || !created?.user) {
          return reply({ error: '계정을 만들지 못했습니다: ' + (createErr?.message ?? inviteErr?.message ?? '') }, 400);
        }
        user = created.user;
        var tempIssued: string | null = tempPassword;
      } else {
        user = invited.user;
      }
    }

    const { data: row, error: profErr } = await admin
      .from('staff_profiles')
      .upsert({ id: user.id, email, name, team, phone, role }, { onConflict: 'id' })
      .select()
      .single();

    if (profErr) return reply({ error: '관계자 정보를 저장하지 못했습니다: ' + profErr.message }, 400);

    return reply({
      row,
      // 임시 비밀번호가 발급된 경우에만 내려갑니다. 화면에 한 번만 보여 주고
      // 저장하지 않습니다.
      tempPassword: typeof tempIssued === 'string' ? tempIssued : null,
    });
  }

  // ── 삭제: 마지막 관리자는 보호합니다 ────────────────────────────
  if (action === 'remove') {
    const id = String(payload.id ?? '');
    if (!id) return reply({ error: '대상이 지정되지 않았습니다.' }, 400);
    if (id === userData.user.id) return reply({ error: '본인 계정은 삭제할 수 없습니다.' }, 400);

    const { data: target } = await admin.from('staff_profiles').select('role').eq('id', id).maybeSingle();
    if (target?.role === 'admin') {
      const { count } = await admin
        .from('staff_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin');
      if ((count ?? 0) <= 1) {
        return reply({ error: '마지막 관리자 계정은 삭제할 수 없습니다.' }, 400);
      }
    }

    await admin.from('staff_profiles').delete().eq('id', id);
    const { error: delErr } = await admin.auth.admin.deleteUser(id);
    if (delErr) return reply({ error: '로그인 계정을 지우지 못했습니다: ' + delErr.message }, 400);

    return reply({ ok: true });
  }

  // ── 프로필 수정 (권한 변경 포함) ────────────────────────────────
  if (action === 'update') {
    const id = String(payload.id ?? '');
    const patch = (payload.patch ?? {}) as Record<string, unknown>;
    if (!id) return reply({ error: '대상이 지정되지 않았습니다.' }, 400);

    // 마지막 관리자를 staff 로 낮추지 못하게 막습니다.
    if (patch.role === 'staff') {
      const { data: target } = await admin.from('staff_profiles').select('role').eq('id', id).maybeSingle();
      if (target?.role === 'admin') {
        const { count } = await admin
          .from('staff_profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'admin');
        if ((count ?? 0) <= 1) {
          return reply({ error: '마지막 관리자 계정의 권한은 낮출 수 없습니다.' }, 400);
        }
      }
    }

    const allowed = ['name', 'team', 'phone', 'role', 'email'];
    const clean: Record<string, unknown> = {};
    allowed.forEach((k) => { if (k in patch) clean[k] = patch[k]; });

    const { data: row, error } = await admin
      .from('staff_profiles').update(clean).eq('id', id).select().single();
    if (error) return reply({ error: error.message }, 400);
    return reply({ row });
  }

  return reply({ error: '알 수 없는 요청입니다.' }, 400);
});
