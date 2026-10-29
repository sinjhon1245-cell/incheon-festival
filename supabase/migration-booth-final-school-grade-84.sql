-- 2026 Incheon AI festival: final 84 school booths (초등/중등/고등/특수).
-- Source: confirmed 2026 school-booth list, official numbers 1-84.
-- Guarded, single-statement transaction. Preserves booth UUID, QR/PIN secrets/sessions,
-- notice history, wait log, and 50 unpublished example booths.
-- Real 84 live rehearsal values are backed up before clearing; their historical logs stay untouched.
-- IMPORTANT: Only apply when enabled=false, push_enabled=false, rehearsal_only=true.
-- DO block is atomic; any failed invariant rolls back the entire change.
DO $school_final_20261029$
DECLARE
  v_rows integer;
  v_bad integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(20261029, 84);
  LOCK TABLE public.booths IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.zones IN SHARE ROW EXCLUSIVE MODE;

  IF NOT EXISTS (
    SELECT 1 FROM public.booth_notice_config
    WHERE id=1 AND enabled=false AND push_enabled=false AND rehearsal_only=true
  ) THEN RAISE EXCEPTION 'STOP: alert switches are not all safe'; END IF;

  IF (SELECT count(*) FROM public.booths WHERE is_published) <> 84
     OR (SELECT count(*) FROM public.booths WHERE is_published AND zone_key IN ('R1','R2','R3','R4')) <> 84
     OR (SELECT count(*) FROM public.booths WHERE NOT is_published AND zone_key IN ('A','B','C','D','E')) <> 50
  THEN RAISE EXCEPTION 'STOP: expected 84 live R-booths and 50 hidden A-E examples'; END IF;
  IF (SELECT count(*) FROM public.zones WHERE key IN ('초등','중등','고등','특수')) <> 0
     OR pg_catalog.to_regclass('private.booth_schoolgrade_backup_20261029') IS NOT NULL
     OR pg_catalog.to_regclass('private.booth_schoolgrade_live_backup_20261029') IS NOT NULL
     OR pg_catalog.to_regclass('public.booths_schoolgrade_official_code_uniq') IS NOT NULL
  THEN RAISE EXCEPTION 'STOP: final grade migration was already started'; END IF;
  IF (SELECT count(*) FROM public.zones WHERE key IN ('R1','R2','R3','R4') AND is_published) <> 4
  THEN RAISE EXCEPTION 'STOP: R1-R4 source zones differ'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.booth_notice_target t
    JOIN public.booth_notice n ON n.id=t.notice_id
    WHERE n.expires_at > now() AND t.acked_at IS NULL
  ) THEN RAISE EXCEPTION 'STOP: an unacknowledged active alert exists'; END IF;

  CREATE TEMP TABLE final_school_map (
    booth_id uuid PRIMARY KEY,
    old_code text NOT NULL,
    org text NOT NULL,
    new_zone text NOT NULL,
    official_no integer NOT NULL UNIQUE
  ) ON COMMIT DROP;
  INSERT INTO pg_temp.final_school_map (booth_id,old_code,org,new_zone,official_no)
  VALUES
    ('c25be9e3-c766-5fc0-9eee-fcdeb4cd156c'::uuid, 'R1-01', '인천신석초등학교', '초등', 45),
    ('177d8f80-f684-572f-ba32-beafb28e54bc'::uuid, 'R1-02', '인천운서중학교', '중등', 46),
    ('9662582a-a036-521e-930f-ad000746dc0d'::uuid, 'R1-03', '인천상정고등학교', '고등', 47),
    ('44b3f975-77dc-5e17-8a09-10b5abccc552'::uuid, 'R1-04', '인천연일학교, 인천청선학교', '특수', 48),
    ('a3d4f361-0aa4-5ba6-9cbe-893f9b75e23c'::uuid, 'R1-05', '인천문남초등학교', '초등', 76),
    ('637a42e0-3cd0-5d85-a98a-f329fae86332'::uuid, 'R1-06', '인천석정초등학교', '초등', 66),
    ('4199f4ac-c58b-5e9b-be3e-be46ed061099'::uuid, 'R1-07', '인천부개서초등학교', '초등', 58),
    ('d3704531-7681-514c-a60a-0ea3614d4c05'::uuid, 'R1-08', '인천하정초등학교', '초등', 59),
    ('5fc6401a-4e02-5ea6-9837-43e1bab2c6f4'::uuid, 'R1-09', '인천후정초등학교', '초등', 71),
    ('2de4c863-8836-579b-a1fb-d6a09b301e67'::uuid, 'R1-10', '인천간재울초등학교', '초등', 62),
    ('9cfe948f-95ca-5d08-a177-a749e64f1ab8'::uuid, 'R1-11', '인천경연초등학교', '초등', 63),
    ('3584e7de-2610-58ab-9d21-25bd5d9f5e8e'::uuid, 'R1-12', '인천신검단초등학교', '초등', 78),
    ('e0d380e4-6c4d-5bef-9a3e-b2c595a84141'::uuid, 'R1-13', '인천심곡초등학교', '초등', 64),
    ('099917fb-8949-5b2e-b611-71be91ca6f02'::uuid, 'R1-14', '인천한별초등학교', '초등', 61),
    ('9be440e8-2ef4-559b-9f9f-38b01da8591d'::uuid, 'R1-15', '인천해원초등학교', '초등', 65),
    ('ee6cd707-50d6-5120-a25d-6e503f37feec'::uuid, 'R1-16', '강화여자중학교', '중등', 43),
    ('a4e7e816-f605-5f90-a833-39e4c8ed7d00'::uuid, 'R1-17', '남인천여자중학교', '중등', 21),
    ('224cd04b-593c-51d3-8d12-20e2e41661ff'::uuid, 'R1-18', '선화여자중학교', '중등', 22),
    ('66b3083d-b77a-5501-bf52-1fad00eae545'::uuid, 'R1-19', '용현여자중학교', '중등', 26),
    ('19ac68f7-9f85-581e-9cca-f05d90c6ea3a'::uuid, 'R1-20', '인천남중학교', '중등', 27),
    ('c25a9fff-b90f-57c7-a029-31dcb89dadaa'::uuid, 'R1-21', '재능중학교', '중등', 38),
    ('02e9f946-3423-525e-9b8c-654481e427ea'::uuid, 'R2-01', '인천예송중학교', '중등', 16),
    ('4e8abfd5-2133-54dc-a490-a2caccbe898d'::uuid, 'R2-02', '제물포중학교', '중등', 56),
    ('b241da92-caa7-5568-9dc1-d844f06765ac'::uuid, 'R2-03', '광성고등학교', '고등', 28),
    ('442ab200-4cfd-57b6-972c-49e768a4a40a'::uuid, 'R2-04', '대인고등학교', '고등', 19),
    ('439c0e75-c9eb-5607-8c1d-731e09e50815'::uuid, 'R2-05', '백석고등학교', '고등', 13),
    ('0ed1aef9-b246-515d-9a32-8c85455f129a'::uuid, 'R2-06', '부광고등학교', '고등', 36),
    ('60c34a21-1a50-5b4e-8730-2149bc45f930'::uuid, 'R2-07', '서운고등학교', '고등', 33),
    ('298e06c1-eff8-5020-92f3-5d1f8b5b9352'::uuid, 'R2-08', '인천바이오과학고등학교', '고등', 9),
    ('34c01b1e-93e2-57f5-852c-0d9f716e7865'::uuid, 'R2-09', '인천아라고등학교', '고등', 14),
    ('72d29e9e-c0d5-51a3-bdec-eecc08163425'::uuid, 'R2-10', '인하대학교사범대학부속고등학교', '고등', 30),
    ('6ad98955-589f-536c-932c-2e6c84054bfd'::uuid, 'R2-11', '재능고등학교', '고등', 29),
    ('d8a77979-69cf-529c-ab92-770274534d60'::uuid, 'R2-12', '갑룡초등학교', '초등', 57),
    ('753d237d-a32b-5ad9-96bc-19fa2a5612ff'::uuid, 'R2-13', '인천도화초등학교', '초등', 70),
    ('dcdac6b8-4e7c-5e4d-90b1-48d5c68d78a2'::uuid, 'R2-14', '인천동명초등학교', '초등', 69),
    ('ba376927-c5f7-5a37-b326-8dfe1fa614d3'::uuid, 'R2-15', '인천용학초등학교', '초등', 67),
    ('5d884b33-a632-513c-8d69-c6d398197662'::uuid, 'R2-16', '인천하늘초등학교', '초등', 68),
    ('36b7c9f9-8386-53e2-ab44-a93617b324b6'::uuid, 'R2-17', '인천동부초등학교', '초등', 75),
    ('585c01d4-e2fd-56df-923b-da627cee893a'::uuid, 'R2-18', '인천동춘초등학교', '초등', 82),
    ('87331f66-0318-5a5a-a600-2c6f9705b962'::uuid, 'R2-19', '인천먼우금초등학교', '초등', 84),
    ('988ff332-7d0f-5acb-8f22-afebc22c6e65'::uuid, 'R2-20', '인천석천초등학교', '초등', 74),
    ('80d87f4d-3980-577f-8e00-5929bdd04475'::uuid, 'R2-21', '인천연송초등학교', '초등', 83),
    ('15ffe3ea-3a98-5b18-87ad-9ddcf2216aa8'::uuid, 'R3-01', '인천주원초등학교', '초등', 73),
    ('e24eb01e-6ae3-5064-8b81-15afc13bde68'::uuid, 'R3-02', '인천구산초등학교', '초등', 72),
    ('02635f9f-b943-5ce4-96fa-54fc76379bb6'::uuid, 'R3-03', '인천봉수초등학교', '초등', 81),
    ('b0c288a4-4c05-5e14-9411-3c16f875a46f'::uuid, 'R3-04', '인천당하초등학교', '초등', 60),
    ('45251b1c-4a19-5b57-babd-448e61414d78'::uuid, 'R3-05', '인천원당초등학교', '초등', 77),
    ('f6a16c17-246a-535a-832c-fff98e7aac30'::uuid, 'R3-06', '인천청라초등학교', '초등', 80),
    ('5f9bc8e6-1591-5170-95ca-c030e6aefa82'::uuid, 'R3-07', '인천청람초등학교', '초등', 79),
    ('36d3be4d-5b06-539a-8f76-c4c15c1de7d3'::uuid, 'R3-08', '광성중학교', '중등', 32),
    ('e7cd8f76-4ddf-543a-9feb-ea7a971433c8'::uuid, 'R3-09', '송도중학교', '중등', 37),
    ('ce47823c-cc43-55ac-98c0-2648c97c9e66'::uuid, 'R3-10', '영종중학교', '중등', 44),
    ('f57ecd45-e6d6-53df-8772-860d958e73fe'::uuid, 'R3-11', '인하대학교사범대학부속중학교', '중등', 31),
    ('9721e9f5-f5c4-5e6d-8e64-176be6db7da1'::uuid, 'R3-12', '남동중학교', '중등', 5),
    ('cb0fd173-83e2-550b-9da5-97766810d2db'::uuid, 'R3-13', '논곡중학교', '중등', 6),
    ('642a1213-4b7e-5ec0-ae3c-92a066435e6b'::uuid, 'R3-14', '박문중학교', '중등', 12),
    ('8425096b-e4ff-5322-af69-966f46bb085a'::uuid, 'R3-15', '상인천중학교', '중등', 11),
    ('79a4a9ac-fd9b-5ac1-b469-4ccaf85ab71d'::uuid, 'R3-16', '인천현송중학교', '중등', 17),
    ('70eb322c-058b-5282-919e-5882f1af0035'::uuid, 'R3-17', '계양중학교', '중등', 49),
    ('aec34db6-3bfc-5c45-a508-41b24cff0a74'::uuid, 'R3-18', '명현중학교', '중등', 50),
    ('d8491aa9-22c4-5ce3-8775-5cd778c4ce5a'::uuid, 'R3-19', '부평중학교', '중등', 52),
    ('d322cc3f-6bf5-5c4c-8edb-628066b77d92'::uuid, 'R3-20', '북인천여자중학교', '중등', 51),
    ('7e7ff5e4-8090-525c-971a-f0009d11fe8e'::uuid, 'R3-21', '삼산중학교', '중등', 53),
    ('6026bf1b-b387-5eca-ae95-64b7c175b126'::uuid, 'R4-01', '불로중학교', '중등', 54),
    ('6c160a91-a8c0-5793-b73a-56597b4893a3'::uuid, 'R4-02', '인천경연중학교', '중등', 55),
    ('328cad61-2edd-5e78-8ba7-5b4c90719eb4'::uuid, 'R4-03', '가림고등학교', '고등', 18),
    ('3d487ee5-e726-5704-99b6-443488be7f29'::uuid, 'R4-04', '명신여자고등학교', '고등', 35),
    ('5947fc6c-155a-5111-bb4a-112464ebaebc'::uuid, 'R4-05', '부광여자고등학교', '고등', 39),
    ('dab3cc5e-6cc0-57e6-832e-0fb7c661433f'::uuid, 'R4-06', '부평고등학교', '고등', 40),
    ('f17a9a59-4c96-5a37-910b-f417450faa4a'::uuid, 'R4-07', '삼산고등학교', '고등', 41),
    ('1ff1e13c-cf24-57fb-ba41-ac7874e71ee2'::uuid, 'R4-08', '송도고등학교', '고등', 8),
    ('e5a9435a-4b95-51fd-8505-0afbb300e46e'::uuid, 'R4-09', '인천고잔고등학교', '고등', 1),
    ('9bd97ee0-066c-5863-8e81-85aa55f50d3a'::uuid, 'R4-10', '인천공항고등학교', '고등', 23),
    ('85d12b49-ebf6-55cb-b180-608be1e74acd'::uuid, 'R4-11', '인천남고등학교', '고등', 2),
    ('afc0cecf-8ac8-5742-946a-3982165be9ed'::uuid, 'R4-12', '인천남동고등학교', '고등', 3),
    ('61547dfd-272b-5e26-afd3-879eac13e39c'::uuid, 'R4-13', '인천만수고등학교', '고등', 4),
    ('67befba9-7532-58c7-bb8d-cd0cbc6528a4'::uuid, 'R4-14', '인천송천고등학교', '고등', 7),
    ('ae5351da-c3bb-5bcd-adbe-27f459584b54'::uuid, 'R4-15', '인천신현고등학교', '고등', 20),
    ('5c1a3697-9d5f-5a64-bcea-19e0d68f5a23'::uuid, 'R4-16', '인천연송고등학교', '고등', 10),
    ('a08643e4-1529-5e7e-9a47-1c0c54bebdb7'::uuid, 'R4-17', '인천이음고등학교', '고등', 15),
    ('2f693fe9-ff8c-5f01-b617-d6e0379ff9c2'::uuid, 'R4-18', '인천중산고등학교', '고등', 24),
    ('bb6b8f87-4927-5d73-bbae-25dba34558e8'::uuid, 'R4-19', '인천진산과학고등학교', '고등', 42),
    ('55545ef6-97df-52ca-9a58-e23d8211d3f5'::uuid, 'R4-20', '인천청라고등학교', '고등', 25),
    ('9ddc5151-f35e-5841-9475-ed2a40943a64'::uuid, 'R4-21', '인천효성고등학교', '고등', 34);

  IF (SELECT count(*) FROM pg_temp.final_school_map) <> 84
    OR (SELECT min(official_no) FROM pg_temp.final_school_map) <> 1
    OR (SELECT max(official_no) FROM pg_temp.final_school_map) <> 84
    OR (SELECT count(*) FROM pg_temp.final_school_map WHERE new_zone='초등') <> 29
    OR (SELECT count(*) FROM pg_temp.final_school_map WHERE new_zone='중등') <> 25
    OR (SELECT count(*) FROM pg_temp.final_school_map WHERE new_zone='고등') <> 29
    OR (SELECT count(*) FROM pg_temp.final_school_map WHERE new_zone='특수') <> 1
  THEN RAISE EXCEPTION 'STOP: official number or grade count mismatch'; END IF;
  IF (SELECT count(*) FROM pg_temp.final_school_map m
      JOIN public.booths b ON b.id=m.booth_id AND b.code=m.old_code AND b.org=m.org
      WHERE b.zone_key IN ('R1','R2','R3','R4') AND b.is_published) <> 84
  THEN RAISE EXCEPTION 'STOP: 84 booth identities/names/old numbers differ'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.final_school_map m JOIN public.booths b ON b.id=m.booth_id
    WHERE b.org_type <> CASE WHEN m.new_zone='특수' THEN '기타' ELSE m.new_zone END
  ) THEN RAISE EXCEPTION 'STOP: school type unexpectedly changed'; END IF;

  -- These backup tables are in the unexposed private schema. No QR or PIN secrets saved.
  CREATE TABLE private.booth_schoolgrade_backup_20261029 AS
    SELECT b.id, b.zone_key old_zone_key, b.no old_no, b.code old_code,
           b.org_type old_org_type, b.org old_org, b.is_published old_published,
           m.new_zone, m.official_no, now() saved_at
    FROM public.booths b JOIN pg_temp.final_school_map m ON m.booth_id=b.id;
  CREATE UNIQUE INDEX ON private.booth_schoolgrade_backup_20261029(id);
  REVOKE ALL ON private.booth_schoolgrade_backup_20261029 FROM PUBLIC, anon, authenticated;

  CREATE TABLE private.booth_schoolgrade_live_backup_20261029 AS
    SELECT l.* FROM public.booth_live l
    JOIN pg_temp.final_school_map m ON m.booth_id=l.booth_id;
  REVOKE ALL ON private.booth_schoolgrade_live_backup_20261029 FROM PUBLIC, anon, authenticated;

  -- Actual final booth number is numeric (1-84); existing A-E samples retain old code style.
  -- Preserve the original publishing guards and SECURITY INVOKER behavior.
  EXECUTE $ddl$
    CREATE OR REPLACE FUNCTION public.booths_before_write()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $body$
    DECLARE v_opening boolean;
    BEGIN
      new.code := CASE
        WHEN new.zone_key IN ('초등','중등','고등','특수') AND new.no IS NOT NULL
          THEN new.no::text
        WHEN new.zone_key IS NOT NULL AND new.no IS NOT NULL
          THEN new.zone_key || '-' || lpad(new.no::text, greatest(2,length(new.no::text)), '0')
        ELSE ''
      END;
      IF tg_op='INSERT' THEN
        v_opening := coalesce(new.is_published,false);
      ELSE
        v_opening := coalesce(new.is_published,false) AND NOT coalesce(old.is_published,false);
      END IF;
      IF new.zone_key IS NULL OR new.no IS NULL THEN
        IF v_opening THEN
          RAISE EXCEPTION '구역과 부스 번호를 먼저 지정해 주세요.'
            USING errcode='23514', hint='booth_publish_needs_slot';
        END IF;
        new.is_published := false;
      ELSIF v_opening AND NOT EXISTS (
        SELECT 1 FROM public.zones z WHERE z.key=new.zone_key AND z.is_published
      ) THEN
        RAISE EXCEPTION '현재 구역이 비공개 상태입니다. 구역을 먼저 공개해 주세요.'
          USING errcode='23514', hint='booth_publish_zone_hidden';
      END IF;
      RETURN new;
    END;
    $body$;
  $ddl$;

  -- Four visible school-grade groupings. Keep old R1-R4 zones for reversible audit.
  INSERT INTO public.zones(key,label,sub,range_from,range_to,tint,solid,deep,sort_order,is_published)
  SELECT g.new_zone,g.new_zone,'2026 스쿨존 · 학교급별 보기 · 공식 부스번호 1~84',
         min(m.official_no),max(m.official_no),r.tint,r.solid,r.deep,g.rank,true
  FROM (VALUES ('초등','R1',1),('중등','R2',2),('고등','R3',3),('특수','R4',4)) AS g(new_zone,source_zone,rank)
  JOIN public.zones r ON r.key=g.source_zone
  JOIN pg_temp.final_school_map m ON m.new_zone=g.new_zone
  GROUP BY g.new_zone,g.rank,r.tint,r.solid,r.deep;

  UPDATE public.booths b
  SET zone_key=m.new_zone, no=m.official_no
  FROM pg_temp.final_school_map m WHERE b.id=m.booth_id;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows <> 84 THEN RAISE EXCEPTION 'STOP: updated % booths instead of 84',v_rows; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.final_school_map m
    JOIN public.booths b ON b.id=m.booth_id
    WHERE b.zone_key<>m.new_zone OR b.no<>m.official_no OR b.code<>m.official_no::text OR NOT b.is_published
  ) THEN RAISE EXCEPTION 'STOP: converted booth data failed postcheck'; END IF;

  -- Prevent future duplicate official numbers across any of the four school-grade groups.
  CREATE UNIQUE INDEX booths_schoolgrade_official_code_uniq ON public.booths(code)
    WHERE zone_key IN ('초등','중등','고등','특수');

  UPDATE public.zones SET is_published=false WHERE key IN ('R1','R2','R3','R4');
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows <> 4 THEN RAISE EXCEPTION 'STOP: source-zone visibility changed unexpectedly'; END IF;

  -- End rehearsal: clear only live status rows of the 84 mapped school booths.
  -- The complete booth_live_log and older 50 hidden sample booths remain untouched.
  DELETE FROM public.booth_live l
  USING pg_temp.final_school_map m
  WHERE l.booth_id=m.booth_id;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows <> (SELECT count(*) FROM private.booth_schoolgrade_live_backup_20261029)
  THEN RAISE EXCEPTION 'STOP: rehearsal live rows deleted do not match backup'; END IF;

  IF (SELECT count(*) FROM public.booths WHERE is_published) <> 84
    OR (SELECT count(*) FROM public.zones WHERE is_published) <> 4
    OR (SELECT count(*) FROM public.booths WHERE zone_key IN ('R1','R2','R3','R4')) <> 0
    OR (SELECT count(*) FROM public.booths WHERE NOT is_published AND zone_key IN ('A','B','C','D','E')) <> 50
    OR (SELECT count(DISTINCT code) FROM public.booths WHERE is_published) <> 84
    OR (SELECT count(*) FROM public.booth_live l JOIN pg_temp.final_school_map m ON m.booth_id=l.booth_id) <> 0
    OR (SELECT count(*) FROM private.booth_schoolgrade_backup_20261029) <> 84
    OR NOT EXISTS (SELECT 1 FROM public.booth_notice_config WHERE id=1 AND enabled=false AND push_enabled=false AND rehearsal_only=true)
  THEN RAISE EXCEPTION 'STOP: final checks failed; rolling back entire transaction'; END IF;
END $school_final_20261029$;

-- Safe read-only summary after application.
SELECT
  (SELECT count(*) FROM public.booths WHERE is_published) AS published_booths,
  (SELECT count(DISTINCT code) FROM public.booths WHERE is_published) AS unique_official_codes,
  (SELECT count(*) FROM public.zones WHERE is_published) AS school_zones,
  (SELECT count(*) FROM private.booth_schoolgrade_backup_20261029) AS saved_original_booths,
  (SELECT count(*) FROM private.booth_schoolgrade_live_backup_20261029) AS saved_rehearsal_live,
  (SELECT count(*) FROM public.booths WHERE zone_key IN ('R1','R2','R3','R4')) AS old_r_booths,
  (SELECT count(*) FROM public.booth_live_log) AS wait_history_retained,
  (SELECT enabled=false AND push_enabled=false AND rehearsal_only=true FROM public.booth_notice_config WHERE id=1) AS switches_safe;
