-- 2026-10-23: Rehearsal dual-PIN transition (real booths).
-- Policy, Asia/Seoul: 2026-11-04 23:00 sharp.
-- Before deadline, 84 allowlisted real booths accept common PIN 123456 AND
-- their own randomly issued individual PIN; from deadline, only individual
-- PIN or existing QR works. Sample common PIN is ALSO time-limited here.
-- No PIN is created or altered by this migration; no table or session is changed.
-- Shared PIN is for rehearsal only; cannot be disabled by switching it off for
-- a single booth without also affecting the PIN status. A disabled individual
-- PIN row blocks rehearsal common PIN on that booth (emergency off stays off).
-- Newly issuing/reissuing a PIN still revokes existing PIN sessions through the
-- ORIGINAL admin_issue_booth_pin function; the operator may log in again with
-- either valid PIN while the common PIN window is open.
--
-- Dependencies: migration-booth-rehearsal-pin.sql, migration-booth-example-pin.sql.
-- Commit/rollback: apply as one transaction; see rollback-booth-common-pin-dual-nov4.sql.
-- Deploy server migration BEFORE making a real-booth PIN issuance.
-- The caller/admin screen does not determine the time: the DB does.
--
-- No authorization grants are introduced. The 3 functions are in a schema
-- hidden from REST; callers are already guarded by existing PIN RPC functions.
do $preflight$
declare
  a text;
  b text;
  c text;
  d text;
  e text;
begin
  if to_regprocedure('private.rehearsal_common_pin_until()') is null
     or to_regprocedure('private.rehearsal_common_pin_open(uuid)') is null
     or to_regprocedure('private.booth_common_pin_target(uuid)') is null
     or to_regprocedure('private.booth_common_pin_ok(uuid,text)') is null
     or to_regprocedure('private.booth_session_resolve(text,boolean)') is null
     or to_regprocedure('private.rehearsal_booth_ids()') is null
     or to_regclass('public.booth_pin') is null
     or to_regclass('public.booth_session') is null then
    raise exception 'Missing booth PIN rehearsal prerequisites; aborting';
  end if;
  select md5(replace(pg_catalog.pg_get_functiondef('private.rehearsal_common_pin_until()'::regprocedure), E'\r','')),
         md5(replace(pg_catalog.pg_get_functiondef('private.rehearsal_common_pin_open(uuid)'::regprocedure), E'\r','')),
         md5(replace(pg_catalog.pg_get_functiondef('private.booth_common_pin_target(uuid)'::regprocedure), E'\r','')),
         md5(replace(pg_catalog.pg_get_functiondef('private.booth_common_pin_ok(uuid,text)'::regprocedure), E'\r','')),
         md5(replace(pg_catalog.pg_get_functiondef('private.booth_session_resolve(text,boolean)'::regprocedure), E'\r',''))
    into a,b,c,d,e;
  if a <> '11cc0ed62d6dcf38c8aeffe01571a3f9'
     or b <> '6b9d4ecaa58d90ffa8a09201d89c18d3'
     or c <> 'ecc7f328f814ff4ac029db5ce40904a4'
     or d <> '57684373f0d48d6aa0f3e0b4eb81aa6f'
     or e <> '587f4d798e6fedab0ee50793dd8b1318' then
    raise exception 'Unexpected PIN authentication function version; aborting (%, %, %, %, %)',
      left(a,8), left(b,8), left(c,8), left(d,8), left(e,8);
  end if;
  if (select cardinality(private.rehearsal_booth_ids())) <> 84 then
    raise exception 'Rehearsal allowlist is not 84 booths; aborting';
  end if;
  if not exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='booth_session' and column_name='via_common_pin') then
    raise exception 'No common PIN session flag; aborting';
  end if;
end
$preflight$;

-- Event date can move earlier: deadline is the earlier of the agreed cutoff
-- and the opening day's 00:00 KST. Never extend beyond Nov 4, 23:00.
create or replace function private.rehearsal_common_pin_until()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select least(timestamptz '2026-11-04 23:00:00+09',
               (private.rehearsal_cutoff())::timestamp at time zone 'Asia/Seoul')
$$;

-- The allowlist, deadline, and existing PIN status jointly determine access.
-- A successfully issued or reissued individual PIN DOES NOT end common PIN
-- during rehearsal. Off/disabled stays blocked; a future explicit new PIN
-- issuance re-enables both routes until the deadline.
create or replace function private.rehearsal_common_pin_open(p_booth uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
           p_booth = any (private.rehearsal_booth_ids())
           and pg_catalog.now() < private.rehearsal_common_pin_until()
           and not exists (
             select 1 from public.booth_pin p
              where p.booth_id = p_booth and p.disabled_at is not null
           ),
           false)
$$;

-- Apply THE SAME cutoff to sample shared PINs; after Nov 4 at 23:00
-- shared 123456 must never work anywhere, even if the sample switch is on.
-- Existing login and common-PIN session-resolve paths already call this,
-- ensuring fresh logins AND continued use of existing common sessions fail.
create or replace function private.booth_common_pin_target(p_booth uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
           pg_catalog.now() < private.rehearsal_common_pin_until()
           and (
             (coalesce((select s.booth_sample_common_pin_enabled from public.settings s order by s.id limit 1), false)
              and exists (
                select 1 from public.booths b join public.zones z on z.key = b.zone_key
                 where b.id = p_booth and b.is_published and z.is_published and b.no is not null
                   and b.org ~ '^\s*\[예시\]'
              ))
             or
             (private.rehearsal_common_pin_open(p_booth)
              and exists (
                select 1 from public.booths b join public.zones z on z.key = b.zone_key
                 where b.id = p_booth and b.is_published and z.is_published and b.no is not null
                   and coalesce(b.org, '') !~ '^\s*\[예시\]'
              ))
           ),
           false)
$$;

revoke all on function private.rehearsal_common_pin_until() from public, anon, authenticated;
revoke all on function private.rehearsal_common_pin_open(uuid) from public, anon, authenticated;
revoke all on function private.booth_common_pin_target(uuid) from public, anon, authenticated;

-- Post-migration verification. Run all separately if a client only shows
-- the last SELECT. Any unexpected value: DO NOT ISSUE REAL PINs.
select 'cutoff_kst' as test, '2026-11-04 23:00' as expected,
       to_char(private.rehearsal_common_pin_until() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as actual
union all
select 'allowlisted_real_booths', '84',
       (select count(*)::text from public.booths b
        join public.zones z on z.key=b.zone_key
        where b.id=any(private.rehearsal_booth_ids())
          and b.is_published and z.is_published and b.no is not null
          and b.org !~ '^\s*\[예시\]'
          and private.booth_common_pin_target(b.id))
union all
select 'non_allowlist_real_active', '0',
       (select count(*)::text from public.booths b
         where b.id<>all(private.rehearsal_booth_ids())
           and b.org !~ '^\s*\[예시\]'
           and private.booth_common_pin_target(b.id))
union all
select 'anon_private_schema_access', 'false',
       (has_schema_privilege('anon','private','USAGE'))::text
union all
select 'authenticated_private_schema_access', 'false',
       (has_schema_privilege('authenticated','private','USAGE'))::text;

-- Boundary/behavior acceptance requirements for integration tests:
-- 2026-11-04 22:59:59+09: issued real PIN => both login paths succeed.
-- 2026-11-04 23:00:00+09: all common PIN logins and existing common
-- sessions fail; individual PIN and QR keep working.
-- Disabled PIN => neither individual nor rehearsal common PIN works.
-- Unlisted, non-public, unassigned, wrong PIN => always denied.
-- Ordinary PIN issuance may revoke open sessions; it does NOT close
-- the common PIN *login route* until deadline.
