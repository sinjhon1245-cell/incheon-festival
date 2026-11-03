-- ===================================================================
-- 부스 운영 방식 migration — 적용 전 · 적용 후 확인 (읽기만 합니다 · 아무것도 바꾸지 않음)
--
--   SQL Editor 에서 [1] 과 [2] 를 따로 실행합니다(한 칸만 붙여 넣고 Run). 결과 표의 '판정' 열을 봅니다.
--     OK    기대값과 같음
--     STOP  기대값과 다름 → migration 을 실행하지 않습니다(적용 전) / 운영본부에 알리고 롤백을 검토합니다(적용 후)
--     기록  비교용 값 — [1] 의 값을 적어 두었다가 [2] 의 같은 줄과 견줍니다
--   개인 정보 · 열쇠 · PIN 원문은 내보내지 않습니다(개수와 md5 지문만).
-- ===================================================================


-- ── [1] 적용 전 (migration 바로 앞에서) ──────────────────────────────────
with expect(k, v) as (values
  ('private.booth_op_set(uuid,text,integer,uuid)', '47b39587a259ede1172674269286f543'),
  ('private.booth_op_touch(uuid,uuid)',            'f4a7c7206aeb1ffaece995cf36e3888b'),
  ('public.booth_ctrl_set(text,text,integer)',     'c244c2caaaf3cb72efea6af1a90694af'),
  ('public.booth_ctrl_touch(text)',                '133b47076c22d428ce6dcc0591702051'),
  ('public.admin_set_booth_live(uuid,text,integer)', '778f69b8ceaac6eea38aaea71324c8c4'))
select 1 as n, '저장 함수 md5 · ' || e.k as 항목, md5(replace(p.prosrc, chr(13), '')) as 값, e.v as 기대,
       case when md5(replace(p.prosrc, chr(13), '')) = e.v then 'OK' else 'STOP' end as 판정
  from expect e left join pg_catalog.pg_proc p on p.oid = to_regprocedure(e.k)
union all
select 2, 'booth_live 상태 값 CHECK md5', md5(pg_get_constraintdef(c.oid)), '935e9a9548dbdd292622c12a13ff47ed',
       case when md5(pg_get_constraintdef(c.oid)) = '935e9a9548dbdd292622c12a13ff47ed' then 'OK' else 'STOP' end
  from pg_catalog.pg_constraint c where c.conrelid = 'public.booth_live'::regclass and c.conname = 'booth_live_congestion_check'
union all
select 3, '현장예약 표 없음(booth_live_mode · _config · _log)',
       concat_ws(',', to_regclass('public.booth_live_mode'), to_regclass('public.booth_live_mode_config'), to_regclass('public.booth_live_mode_log')),
       '(빈칸)', case when coalesce(to_regclass('public.booth_live_mode'), to_regclass('public.booth_live_mode_config'), to_regclass('public.booth_live_mode_log')) is null then 'OK' else 'STOP' end
union all
select 4, '같은 이름 함수 없음', coalesce(string_agg(n.nspname || '.' || p.proname, ','), ''), '(빈칸)', case when count(*) = 0 then 'OK' else 'STOP' end
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
 where p.proname in ('booth_session_mode', 'booth_ctrl_mode', 'booth_live_mode_enabled', 'booth_mode_op', 'booth_mode_of', 'booth_mode_lock', 'booth_live_kind', 'booth_mode_check')
union all
select 5, '공식 부스(공개 · 번호 있음)', count(*)::text, '84', case when count(*) = 84 then 'OK' else 'STOP' end
  from public.booths b join public.zones z on z.key = b.zone_key where b.is_published and z.is_published and b.no is not null
union all
select 6, '공식 번호 1~84 겹침 없음', min(no) || '-' || max(no) || ' / ' || count(distinct no), '1-84 / 84',
       case when min(no) = 1 and max(no) = 84 and count(distinct no) = 84 then 'OK' else 'STOP' end
  from public.booths where is_published
union all
select 7, '23:00 초기화 예약', string_agg(jobname || ' ' || schedule || ' active=' || active, ' '), 'booth-rehearsal-reset 0 14 * * * active=true',
       case when string_agg(jobname || ' ' || schedule || ' active=' || active, ' ') = 'booth-rehearsal-reset 0 14 * * * active=true' then 'OK' else 'STOP' end
  from cron.job
union all
select 8, '지금 booth_live 를 잡은 잠금', count(*)::text, '0(있으면 잠시 뒤에)', case when count(*) = 0 then 'OK' else '기록' end
  from pg_catalog.pg_locks l where l.relation = 'public.booth_live'::regclass and l.pid <> pg_backend_pid()
union all select 20, '지문 · 부스(booths 전체)', md5(string_agg(row(b.*)::text, ',' order by b.id)), '[2] 와 같아야 함', '기록' from public.booths b
union all select 21, '지문 · 구역(zones)', md5(string_agg(row(z.*)::text, ',' order by z.key)), '[2] 와 같아야 함', '기록' from public.zones z
union all select 22, '지문 · QR 열쇠(booth_access)', md5(string_agg(row(a.booth_id, a.token, a.created_at, a.rotated_at, a.disabled_at)::text, ',' order by a.booth_id)) || ' / ' || count(*), '[2] 와 같아야 함', '기록' from public.booth_access a
union all select 23, '지문 · PIN(booth_pin)', md5(string_agg(row(p.booth_id, p.pin_hash, p.issued_at, p.reissued_at, p.disabled_at)::text, ',' order by p.booth_id)) || ' / ' || count(*), '[2] 와 같아야 함', '기록' from public.booth_pin p
union all select 24, '지문 · 대기 현황(booth_live)', md5(string_agg(row(l.booth_id, l.congestion, l.wait_minutes, l.updated_at)::text, ',' order by l.booth_id)) || ' / ' || count(*), '[2] 와 같아야 함(그사이 운영자 입력이 없으면)', '기록' from public.booth_live l
union all select 25, 'booth_live_log 마지막 입력(한국 시각)', to_char(max(created_at) at time zone 'Asia/Seoul', 'MM-DD HH24:MI:SS') || ' / ' || count(*), '[2] 와 견줌', '기록' from public.booth_live_log
union all select 26, '확인 시각(한국)', to_char(now() at time zone 'Asia/Seoul', 'MM-DD HH24:MI:SS'), '', '기록'
order by 1, 2;


-- ── [2] 적용 후 (migration 끝난 직후) ───────────────────────────────────
with expect(k, v) as (values
  ('private.booth_op_set(uuid,text,integer,uuid)',   '883af90f620f77b613aa036d48caf442'),
  ('private.booth_op_touch(uuid,uuid)',              'cdd640f739109421c6ee7d4aa4c5a8c1'),
  ('public.booth_ctrl_set(text,text,integer)',       'af49ee7498d09175654fe38249184d2c'),
  ('public.booth_ctrl_touch(text)',                  'd427a3edb5aee21e34ab6e8f5ce7fceb'),
  ('public.admin_set_booth_live(uuid,text,integer)', '6d4a5807663f9cea4082e4c18d3c6cdb'),
  ('public.booth_session_mode(text,text)',           '701e3c6d91cc90a89bc28e6bf087aeae'),
  ('public.booth_ctrl_mode(text,text)',              '7a9256b38e9149b780ff55e705786434'),
  ('public.booth_live_mode_enabled()',               '826707b27e031803151d58f5e9433b7f'),
  ('private.booth_mode_op(uuid,text,uuid)',          '0c7c62a894c911751d63682bd4f8a52d'),
  ('private.booth_mode_of(uuid)',                    'fa9654dd831ec2fd2ea6119fe2554a04'),
  ('private.booth_mode_lock(uuid)',                  'f790aae4ef7b8a1a8bd5bb5d64dd37d0'),
  ('private.booth_live_kind(text)',                  '0fbb33ccfc4ab4e1f8a79d203242145e'),
  ('private.booth_mode_check(uuid,text)',            '166650e85a150b92687f77fa1e62e8ed'))
select 1 as n, '함수 md5 · ' || e.k as 항목, md5(replace(p.prosrc, chr(13), '')) as 값, e.v as 기대,
       case when md5(replace(p.prosrc, chr(13), '')) = e.v then 'OK' else 'STOP' end as 판정
  from expect e left join pg_catalog.pg_proc p on p.oid = to_regprocedure(e.k)
union all
select 2, 'booth_live 상태 값 CHECK(예약중 · 예약마감 추가)', md5(pg_get_constraintdef(c.oid)), 'fafbf89b4000bb34c6deab59ea33bfa2',
       case when md5(pg_get_constraintdef(c.oid)) = 'fafbf89b4000bb34c6deab59ea33bfa2' then 'OK' else 'STOP' end
  from pg_catalog.pg_constraint c where c.conrelid = 'public.booth_live'::regclass and c.conname = 'booth_live_congestion_check'
union all
select 3, '스위치 enabled', coalesce((select enabled::text from public.booth_live_mode_config where id = 1), '(없음)'), 'false',
       case when (select enabled from public.booth_live_mode_config where id = 1) is false then 'OK' else 'STOP' end
union all
select 4, 'mode_rows(방식 줄)', count(*)::text, '0', case when count(*) = 0 then 'OK' else 'STOP' end from public.booth_live_mode
union all
select 5, '공개 스위치 읽기 booth_live_mode_enabled()', public.booth_live_mode_enabled()::text, 'false', case when public.booth_live_mode_enabled() is false then 'OK' else 'STOP' end
union all
select 6, '84곳 모두 현장대기(booth_mode_of)', count(*) filter (where private.booth_mode_of(b.id) <> 'wait')::text || ' / ' || count(*), '0 / 84',
       case when count(*) filter (where private.booth_mode_of(b.id) <> 'wait') = 0 and count(*) = 84 then 'OK' else 'STOP' end
  from public.booths b join public.zones z on z.key = b.zone_key where b.is_published and z.is_published and b.no is not null
union all
select 7, '공개 권한 · 방식 표', concat_ws(' ',
         'tbl_select=' || has_table_privilege('anon', 'public.booth_live_mode', 'SELECT'),
         'booth_id=' || has_column_privilege('anon', 'public.booth_live_mode', 'booth_id', 'SELECT'),
         'mode=' || has_column_privilege('anon', 'public.booth_live_mode', 'mode', 'SELECT'),
         'updated_at=' || has_column_privilege('anon', 'public.booth_live_mode', 'updated_at', 'SELECT'),
         'insert=' || has_table_privilege('anon', 'public.booth_live_mode', 'INSERT')),
       'tbl_select=false booth_id=true mode=true updated_at=false insert=false',
       case when not has_table_privilege('anon', 'public.booth_live_mode', 'SELECT')
             and has_column_privilege('anon', 'public.booth_live_mode', 'booth_id', 'SELECT')
             and has_column_privilege('anon', 'public.booth_live_mode', 'mode', 'SELECT')
             and not has_column_privilege('anon', 'public.booth_live_mode', 'updated_at', 'SELECT')
             and not has_table_privilege('anon', 'public.booth_live_mode', 'INSERT')
             and not has_table_privilege('authenticated', 'public.booth_live_mode', 'INSERT') then 'OK' else 'STOP' end
union all
select 8, '공개 권한 · 스위치 표', 'anon_select=' || has_table_privilege('anon', 'public.booth_live_mode_config', 'SELECT') || ' auth_update=' || has_table_privilege('authenticated', 'public.booth_live_mode_config', 'UPDATE'),
       'anon_select=false auth_update=false',
       case when not has_table_privilege('anon', 'public.booth_live_mode_config', 'SELECT') and not has_table_privilege('authenticated', 'public.booth_live_mode_config', 'UPDATE') then 'OK' else 'STOP' end
union all
select 9, '실행 권한', concat_ws(' ',
         'session_mode=' || has_function_privilege('anon', 'public.booth_session_mode(text,text)', 'EXECUTE'),
         'ctrl_mode=' || has_function_privilege('anon', 'public.booth_ctrl_mode(text,text)', 'EXECUTE'),
         'mode_op=' || has_function_privilege('anon', 'private.booth_mode_op(uuid,text,uuid)', 'EXECUTE'),
         'admin_set(anon)=' || has_function_privilege('anon', 'public.admin_set_booth_live(uuid,text,integer)', 'EXECUTE'),
         'ctrl_set(anon)=' || has_function_privilege('anon', 'public.booth_ctrl_set(text,text,integer)', 'EXECUTE')),
       'session_mode=true ctrl_mode=true mode_op=false admin_set(anon)=false ctrl_set(anon)=true',
       case when has_function_privilege('anon', 'public.booth_session_mode(text,text)', 'EXECUTE')
             and has_function_privilege('anon', 'public.booth_ctrl_mode(text,text)', 'EXECUTE')
             and not has_function_privilege('anon', 'private.booth_mode_op(uuid,text,uuid)', 'EXECUTE')
             and not has_function_privilege('anon', 'public.admin_set_booth_live(uuid,text,integer)', 'EXECUTE')
             and has_function_privilege('anon', 'public.booth_ctrl_set(text,text,integer)', 'EXECUTE') then 'OK' else 'STOP' end
union all
select 10, 'RLS · 정책', (select relrowsecurity::text from pg_class where oid = 'public.booth_live_mode'::regclass) || ' / ' || count(*), 'true / 1',
       case when (select relrowsecurity from pg_class where oid = 'public.booth_live_mode'::regclass) and count(*) = 1 then 'OK' else 'STOP' end
  from pg_policies where schemaname = 'public' and tablename = 'booth_live_mode'
union all
select 11, '공식 부스(공개 · 번호 있음)', count(*)::text, '84', case when count(*) = 84 then 'OK' else 'STOP' end
  from public.booths b join public.zones z on z.key = b.zone_key where b.is_published and z.is_published and b.no is not null
union all
select 12, '23:00 초기화 예약', string_agg(jobname || ' ' || schedule || ' active=' || active, ' '), 'booth-rehearsal-reset 0 14 * * * active=true',
       case when string_agg(jobname || ' ' || schedule || ' active=' || active, ' ') = 'booth-rehearsal-reset 0 14 * * * active=true' then 'OK' else 'STOP' end
  from cron.job
union all select 20, '지문 · 부스(booths 전체)', md5(string_agg(row(b.*)::text, ',' order by b.id)), '[1] 과 같아야 함', '기록' from public.booths b
union all select 21, '지문 · 구역(zones)', md5(string_agg(row(z.*)::text, ',' order by z.key)), '[1] 과 같아야 함', '기록' from public.zones z
union all select 22, '지문 · QR 열쇠(booth_access)', md5(string_agg(row(a.booth_id, a.token, a.created_at, a.rotated_at, a.disabled_at)::text, ',' order by a.booth_id)) || ' / ' || count(*), '[1] 과 같아야 함', '기록' from public.booth_access a
union all select 23, '지문 · PIN(booth_pin)', md5(string_agg(row(p.booth_id, p.pin_hash, p.issued_at, p.reissued_at, p.disabled_at)::text, ',' order by p.booth_id)) || ' / ' || count(*), '[1] 과 같아야 함', '기록' from public.booth_pin p
union all select 24, '지문 · 대기 현황(booth_live)', md5(string_agg(row(l.booth_id, l.congestion, l.wait_minutes, l.updated_at)::text, ',' order by l.booth_id)) || ' / ' || count(*), '[1] 과 같아야 함(그사이 운영자 입력이 없으면)', '기록' from public.booth_live l
union all select 25, 'booth_live_log 마지막 입력(한국 시각)', to_char(max(created_at) at time zone 'Asia/Seoul', 'MM-DD HH24:MI:SS') || ' / ' || count(*), '[1] 과 같으면 그사이 입력 없음', '기록' from public.booth_live_log
union all select 26, '확인 시각(한국)', to_char(now() at time zone 'Asia/Seoul', 'MM-DD HH24:MI:SS'), '', '기록'
order by 1, 2;
