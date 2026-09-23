-- There are two kinds of levy in California, and the schema had five.
--
-- "What is the point of those fields if they are mostly unused" / "whats the
-- point of individual rates if we combine them to an area anyways?"
--                                                          -- 20 Sep 2026
--
-- CDTFA-105 is the authority, and it says the whole structure is:
--
--   THE STATEWIDE BASE, 7.25%, everywhere in California, always. It is 6.00%
--   the state's and 1.25% local, but that split is fixed and nobody chooses it,
--   so it is one levy, not two.
--
--   DISTRICT TAXES, zero or more per area, each with a name, a rate and an
--   effective date. This is the only thing that varies by place, and the only
--   thing a return breaks out -- Schedule A reports district tax per district,
--   which is the entire reason districts stay separate rows.
--
-- 'locality', 'city' and 'special' were invented. So was the idea that a county
-- levies something on top of the base: Kings County has NO district tax, and
-- Kettleman's 7.250% is the base and nothing else.
--
-- imposed_by AND collected_by GO. 0005 split `authority` in two when the right
-- fix was to remove it: collected_by said CDTFA on every row of the live data,
-- and imposed_by was filled on one row in seven. A levy's name and its CDTFA
-- code identify it; no return asks which body enacted it.
--
-- NO RATE MOVES. Every site's total is arithmetically unchanged:
--   old total = 6.000 (state) + locality
--   new total = 7.250 (base)  + (locality - 1.250)
-- and a district that comes out at zero was never a district -- it was the
-- base wearing a county's name, so it is removed rather than kept at 0.000.
--
-- AND THE BASE IS NOT ATTACHED TO ANYTHING. It reaches every site in the state
-- by being the law, so making somebody tick it on each client was busywork that
-- could only ever be got wrong. site_rate applies it; site_tax and entity_tax
-- are for districts now.

BEGIN;

-- The old check names the levels being removed, so it comes off before any row
-- can be relabelled and goes back on once every row is one of the two.
ALTER TABLE tax DROP CONSTRAINT tax_level_check;

-- ===========================================================================
-- 1. The base.

UPDATE tax SET name = 'California statewide base', level = 'base'
 WHERE level = 'state';

-- Only where there are levies already: a migration repairs data, it does not
-- decide that an empty database is in California.
INSERT INTO tax (name, level, code)
SELECT 'California statewide base', 'base', NULL
 WHERE EXISTS (SELECT 1 FROM tax)
   AND NOT EXISTS (SELECT 1 FROM tax WHERE level = 'base');

UPDATE tax_rate r
   SET rate_pct = 7.2500,
       source = 'CDTFA statewide base -- 6.000 state, 1.250 local'
  FROM tax t
 WHERE t.id = r.tax_id AND t.level = 'base' AND r.rate_pct = 6.0000;

INSERT INTO tax_rate (tax_id, rate_pct, effective_from, source)
SELECT t.id, 7.2500, '2017-01-01', 'CDTFA statewide base -- 6.000 state, 1.250 local'
  FROM tax t
 WHERE t.level = 'base'
   AND NOT EXISTS (SELECT 1 FROM tax_rate r WHERE r.tax_id = t.id);

-- ===========================================================================
-- 2. Everything else is a district, and holds what is left above the base.

-- Only the rows 0004 made. It rewrote each published CDTFA total as
-- (total - 6.000) and stamped the source saying so, which is the one reliable
-- mark of "this figure is an area total with the state's share taken off".
-- A rate authored as a real district rate is already right and is left alone --
-- subtracting the base's local share from every row would take it off an area
-- twice wherever the area has two districts.
UPDATE tax_rate r
   SET rate_pct = r.rate_pct - 1.2500,
       source = COALESCE(r.source || ' · ', '') || 'less the 1.250 local share of the base'
  FROM tax t
 WHERE t.id = r.tax_id
   AND t.level <> 'base'
   AND r.source LIKE '%less the 6.000 state share%';

UPDATE tax SET level = 'district' WHERE level <> 'base';

ALTER TABLE tax ADD CONSTRAINT tax_level_check CHECK (level IN ('base', 'district'));

COMMENT ON COLUMN tax.level IS
  'base is the 7.25% every Californian address pays and nobody attaches. '
  'district is a transactions and use tax on top of it, per CDTFA-105, and is '
  'the only thing Schedule A breaks out.';

-- A rate below zero means the arithmetic above did not hold for this data, and
-- a negative tax must never reach an invoice. Stop instead.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM tax_rate WHERE rate_pct < 0;
  IF bad > 0 THEN
    RAISE EXCEPTION 'REFUSING: % rate(s) came out negative -- the districts in this '
                    'database are not area totals and must be corrected by hand', bad;
  END IF;
END $$;

-- ===========================================================================
-- 3. A district of nothing was never a district.

CREATE TEMP TABLE empty_districts ON COMMIT DROP AS
SELECT t.id FROM tax t
 WHERE t.level = 'district'
   AND NOT EXISTS (SELECT 1 FROM tax_rate r
                    WHERE r.tax_id = t.id AND r.rate_pct > 0);

DELETE FROM site_tax   WHERE tax_id IN (SELECT id FROM empty_districts);
DELETE FROM entity_tax WHERE tax_id IN (SELECT id FROM empty_districts);
DELETE FROM tax_rate   WHERE tax_id IN (SELECT id FROM empty_districts);
DELETE FROM tax        WHERE id     IN (SELECT id FROM empty_districts);

-- The base is the law, not an attachment.
DELETE FROM site_tax   WHERE tax_id IN (SELECT id FROM tax WHERE level = 'base');
DELETE FROM entity_tax WHERE tax_id IN (SELECT id FROM tax WHERE level = 'base');

-- site_rate reads both columns, so it goes first and is rebuilt below.
DROP VIEW IF EXISTS site_rate;

ALTER TABLE tax DROP COLUMN imposed_by;
ALTER TABLE tax DROP COLUMN collected_by;

-- ===========================================================================
-- 4. What CDTFA said about this address, and when.

ALTER TABLE site ADD COLUMN tax_area_code text;
ALTER TABLE site ADD COLUMN verified_rate_pct numeric(7,4)
  CHECK (verified_rate_pct >= 0);

COMMENT ON COLUMN site.tax_area_code IS
  'The TAC the CDTFA rate API returned for this address. Their identifier for '
  'the area, so a re-check can be matched against what was recorded.';
COMMENT ON COLUMN site.verified_rate_pct IS
  'The total rate CDTFA gave for this address on area_verified_on. Kept beside '
  'what the districts add up to so the two can disagree out loud: a district '
  'added, ended or missed shows as drift instead of quietly mispricing.';

-- ===========================================================================
-- 5. The rate at a site: the base, plus whatever districts reach it.

CREATE VIEW site_rate AS
SELECT x.*,
       (x.verified_rate_pct IS NOT NULL AND x.verified_rate_pct <> x.rate_pct) AS drifted
  FROM (
    SELECT s.id AS site_id,
           s.entity_id,
           s.tax_area_code,
           s.verified_rate_pct,
           s.area_verified_on,
           COALESCE(sum(r.rate_pct), 0)::numeric(7,4) AS rate_pct,
           count(a.tax_id) FILTER (WHERE t.level = 'district') AS districts,
           max(r.effective_from) AS effective_from,
           min(r.verified_on) AS verified_on,
           jsonb_agg(jsonb_build_object('tax', t.name, 'level', t.level,
                                        'rate_pct', r.rate_pct, 'from', a.from_where)
                     ORDER BY t.level, t.name)
             FILTER (WHERE a.tax_id IS NOT NULL) AS breakdown
      FROM site s
      LEFT JOIN (
             SELECT site_id, tax_id, min(from_where) AS from_where
               FROM (
                 -- The base reaches every site by being the law.
                 SELECT s2.id AS site_id, t2.id AS tax_id, 'base' AS from_where
                   FROM site s2 CROSS JOIN tax t2
                  WHERE t2.active AND t2.level = 'base'
                 UNION ALL
                 SELECT s2.id, t2.id, 'client'
                   FROM site s2
                   JOIN entity_tax et ON et.entity_id = s2.entity_id
                   JOIN tax t2 ON t2.id = et.tax_id AND t2.active
                 UNION ALL
                 SELECT s2.id, t2.id, 'site'
                   FROM site s2
                   JOIN site_tax st ON st.site_id = s2.id
                   JOIN tax t2 ON t2.id = st.tax_id AND t2.active
               ) reaches
              -- Named on the client AND on the site is one levy, charged once.
              GROUP BY site_id, tax_id
           ) a ON a.site_id = s.id
      LEFT JOIN tax t ON t.id = a.tax_id
      LEFT JOIN LATERAL (
             SELECT tr.rate_pct, tr.effective_from, tr.verified_on
               FROM tax_rate tr
              WHERE tr.tax_id = a.tax_id AND tr.effective_from <= current_date
              ORDER BY tr.effective_from DESC
              LIMIT 1) r ON true
     GROUP BY s.id, s.entity_id, s.tax_area_code, s.verified_rate_pct, s.area_verified_on
  ) x;

COMMENT ON VIEW site_rate IS
  'What tax is charged at each site: the statewide base, which reaches '
  'everywhere without being attached, plus the districts reaching it from its '
  'client or from itself, counted once each. drifted says the total disagrees '
  'with what CDTFA last gave for the address.';

INSERT INTO migration (filename) VALUES ('0009_the_base_and_the_districts.sql');

COMMIT;
