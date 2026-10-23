-- Emergency revert ONLY the dual-PIN policy: restores the pre-PR logic,
-- but KEEPS the safer Nov 4 23:00 cutoff (never extends shared PIN access).
-- This does NOT delete PINs, booth sessions, QR tokens, or event logs.
-- If an incident requires stopping the common PIN immediately, replacing
-- private.rehearsal_common_pin_open with constant FALSE is safer than rollback.
create or replace function private.rehearsal_common_pin_open(p_booth uuid)
returns boolean
language sql stable set search_path = ''
as $$
  select coalesce(
           p_booth = any (private.rehearsal_booth_ids())
           and pg_catalog.now() < private.rehearsal_common_pin_until()
           and not exists (select 1 from public.booth_pin p where p.booth_id=p_booth)
           and not exists (select 1 from public.booth_auth_event e where e.booth_id=p_booth
                             and e.event in ('pin_issued','pin_reissued','pin_disabled')),
           false)
$$;

-- Revert example/real targeting to the previous logic, preserving
-- the explicitly agreed global cutoff (including sample common PIN).
create or replace function private.booth_common_pin_target(p_booth uuid)
returns boolean
language sql stable set search_path = ''
as $$
  select coalesce(
           pg_catalog.now() < private.rehearsal_common_pin_until()
           and (
             (coalesce((select s.booth_sample_common_pin_enabled from public.settings s order by s.id limit 1), false)
              and exists (
                select 1 from public.booths b join public.zones z on z.key = b.zone_key
                 where b.id=p_booth and b.is_published and z.is_published and b.no is not null
                   and b.org ~ '^\s*\[예시\]'))
             or
             (private.rehearsal_common_pin_open(p_booth)
              and exists (
                select 1 from public.booths b join public.zones z on z.key=b.zone_key
                 where b.id=p_booth and b.is_published and z.is_published and b.no is not null
                   and coalesce(b.org,'') !~ '^\s*\[예시\]'))
           ),
           false)
$$;
revoke all on function private.rehearsal_common_pin_open(uuid) from public,anon,authenticated;
revoke all on function private.booth_common_pin_target(uuid) from public,anon,authenticated;
