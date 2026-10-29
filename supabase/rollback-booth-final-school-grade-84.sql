-- ROLLBACK GUIDE for migration-booth-final-school-grade-84.sql.
-- Emergency use ONLY before 2026-11-06 and only after verifying no new real booth activity.
-- Restores old zones/numbers/code for the exact saved UUIDs. QR/PIN and logs are untouched.
-- Deliberately DOES NOT restore rehearsal wait values; they remain in the private backup.
-- Old grade-zone rows stay hidden for audit, rather than being deleted.
DO $rollback_school_20261029$
DECLARE v_rows integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(20261029,84);
  IF (now() AT TIME ZONE 'Asia/Seoul')::date >= DATE '2026-11-06'
  THEN RAISE EXCEPTION 'STOP: rollback forbidden from the event start date'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.booth_notice_config
                 WHERE id=1 AND enabled=false AND push_enabled=false AND rehearsal_only=true)
  THEN RAISE EXCEPTION 'STOP: notification switches must be OFF'; END IF;
  IF pg_catalog.to_regclass('private.booth_schoolgrade_backup_20261029') IS NULL
  THEN RAISE EXCEPTION 'STOP: original mapping backup missing'; END IF;
  IF (SELECT count(*) FROM private.booth_schoolgrade_backup_20261029) <> 84
    OR (SELECT count(*) FROM public.booths WHERE is_published AND zone_key IN ('초등','중등','고등','특수')) <>84
  THEN RAISE EXCEPTION 'STOP: final grade data no longer matches rollback baseline'; END IF;
  IF EXISTS(
    SELECT 1 FROM private.booth_schoolgrade_backup_20261029 bak
    LEFT JOIN public.booths b ON b.id=bak.id
    WHERE b.id IS NULL OR b.zone_key<>bak.new_zone OR b.no<>bak.official_no
      OR b.code<>bak.official_no::text OR NOT b.is_published
  ) THEN RAISE EXCEPTION 'STOP: live mapping was edited after migration'; END IF;

  LOCK TABLE public.booths IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.zones IN SHARE ROW EXCLUSIVE MODE;
  DROP INDEX IF EXISTS public.booths_schoolgrade_official_code_uniq;

  EXECUTE $ddl$
    CREATE OR REPLACE FUNCTION public.booths_before_write()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $body$
    DECLARE v_opening boolean;
    BEGIN
      new.code := CASE
        WHEN new.zone_key IS NOT NULL AND new.no IS NOT NULL
          THEN new.zone_key || '-' || lpad(new.no::text,greatest(2,length(new.no::text)),'0')
        ELSE ''
      END;
      IF tg_op='INSERT' THEN
        v_opening:=coalesce(new.is_published,false);
      ELSE
        v_opening:=coalesce(new.is_published,false) AND NOT coalesce(old.is_published,false);
      END IF;
      IF new.zone_key IS NULL OR new.no IS NULL THEN
        IF v_opening THEN
          RAISE EXCEPTION '구역과 부스 번호를 먼저 지정해 주세요.'
            USING errcode='23514',hint='booth_publish_needs_slot';
        END IF;
        new.is_published:=false;
      ELSIF v_opening AND NOT EXISTS(
        SELECT 1 FROM public.zones z WHERE z.key=new.zone_key AND z.is_published
      ) THEN
        RAISE EXCEPTION '현재 구역이 비공개 상태입니다. 구역을 먼저 공개해 주세요.'
          USING errcode='23514',hint='booth_publish_zone_hidden';
      END IF;
      RETURN new;
    END;
    $body$;
  $ddl$;

  UPDATE public.booths b
  SET zone_key=bak.old_zone_key,no=bak.old_no
  FROM private.booth_schoolgrade_backup_20261029 bak
  WHERE b.id=bak.id;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>84 THEN RAISE EXCEPTION 'STOP: reverted % not 84',v_rows; END IF;
  IF EXISTS (
    SELECT 1 FROM private.booth_schoolgrade_backup_20261029 bak
    JOIN public.booths b ON b.id=bak.id
    WHERE b.zone_key<>bak.old_zone_key OR b.no<>bak.old_no
       OR b.code<>bak.old_code OR b.is_published<>bak.old_published
  ) THEN RAISE EXCEPTION 'STOP: reverted booth values differ from backup'; END IF;

  UPDATE public.zones SET is_published=true WHERE key IN ('R1','R2','R3','R4');
  UPDATE public.zones SET is_published=false WHERE key IN ('초등','중등','고등','특수');

  IF (SELECT count(*) FROM public.booths WHERE zone_key IN ('R1','R2','R3','R4') AND is_published)<>84
    OR (SELECT count(*) FROM public.booths WHERE NOT is_published AND zone_key IN ('A','B','C','D','E'))<>50
  THEN RAISE EXCEPTION 'STOP: rollback final verification failed'; END IF;
END $rollback_school_20261029$;
