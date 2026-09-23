-- Levies stack, and they can be set on the client as well as on the site.
--
-- "taxes should be seperate: state and locality. granular tax rates that stack
--  and are set per client and/or per site"  -- 14 Sep 2026
--
-- Two changes.
--
-- FIRST, A CLIENT CAN CARRY LEVIES. Most of what applies at a site applies at
-- every site that client has -- the state does not stop at one address. Setting
-- it once on the client and letting each site add what is local to it is how
-- somebody would actually enter this, and it means a state rate change is one
-- row rather than one row per address.
--
-- What a site charges is the union of the two, not the sum of two lists: a levy
-- named on both the client and the site counts once. site_rate does that
-- de-duplication so nothing downstream has to remember to.
--
-- SECOND, 'combined' GOES. 0002 carried the old districts across as published
-- totals with their components unrecorded, and said splitting them was a later
-- edit by somebody with the schedule. This is that edit, and it is arithmetic
-- rather than invention:
--
--   California's statewide base is 7.25%, of which 6.00% is the state's own
--   and 1.25% is local. So for any CDTFA total, the state's share is 6.000 and
--   everything above it is local. 7.250 becomes 6.000 + 1.250; 7.750 becomes
--   6.000 + 1.750. No rate moves by a cent -- the same total is charged at
--   every site, and a return can now say which government gets which part.
--
-- Only CDTFA rows are split, because only for those is the 6.000 known. A
-- combined row from any other authority would be guesswork, and this refuses to
-- guess: the level check below drops 'combined' entirely, so such a row would
-- stop the migration rather than pass through mislabelled.

BEGIN;

-- ===========================================================================
-- A client's levies, which every one of its sites draws.

CREATE TABLE entity_tax (
  entity_id uuid NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  tax_id    uuid NOT NULL REFERENCES tax(id) ON DELETE RESTRICT,
  PRIMARY KEY (entity_id, tax_id)
);

COMMENT ON TABLE entity_tax IS
  'Levies that reach every site this client has -- the state, usually. A site '
  'adds what is local to it in site_tax, and what it charges is the union.';

-- ===========================================================================
-- Split the published totals into the state's share and the rest.

INSERT INTO tax (name, level, authority, code)
SELECT 'California state', 'state', 'CDTFA', '6.000'
 WHERE EXISTS (SELECT 1 FROM tax WHERE level = 'combined' AND authority = 'CDTFA')
   AND NOT EXISTS (SELECT 1 FROM tax WHERE name = 'California state');

INSERT INTO tax_rate (tax_id, rate_pct, effective_from, source)
SELECT t.id, 6.0000, '2017-01-01', 'CDTFA statewide base, state share'
  FROM tax t
 WHERE t.name = 'California state'
   AND NOT EXISTS (SELECT 1 FROM tax_rate r WHERE r.tax_id = t.id);

-- Each combined row keeps its identity and its sites; only its rate and its
-- level change, to what is left after the state's share.
UPDATE tax_rate r
   SET rate_pct = r.rate_pct - 6.0000,
       source = COALESCE(r.source || ' · ', '') || 'less the 6.000 state share'
  FROM tax t
 WHERE t.id = r.tax_id AND t.level = 'combined' AND t.authority = 'CDTFA';

-- Every site that drew a combined levy now also draws the state's.
INSERT INTO site_tax (site_id, tax_id)
SELECT DISTINCT st.site_id, s.id
  FROM site_tax st
  JOIN tax t ON t.id = st.tax_id AND t.level = 'combined' AND t.authority = 'CDTFA'
  CROSS JOIN (SELECT id FROM tax WHERE name = 'California state') s
ON CONFLICT DO NOTHING;

UPDATE tax SET level = 'locality'
 WHERE level = 'combined' AND authority = 'CDTFA';

ALTER TABLE tax DROP CONSTRAINT tax_level_check;
ALTER TABLE tax ADD CONSTRAINT tax_level_check
  CHECK (level IN ('state','locality','city','district','special'));

COMMENT ON COLUMN tax.level IS
  'The kind of area that levies it. Every levy is one government''s share: a '
  'published total is not a levy, it is a sum, and it is split before it is '
  'stored so a return can say who gets what.';

-- ===========================================================================
-- What a site charges: the client's levies and its own, counted once each.

DROP VIEW IF EXISTS site_rate;

CREATE VIEW site_rate AS
WITH applies AS (
  SELECT s.id AS site_id, s.entity_id, t.id AS tax_id
    FROM site s
    JOIN entity_tax et ON et.entity_id = s.entity_id
    JOIN tax t ON t.id = et.tax_id AND t.active
  UNION            -- not UNION ALL: named on both, charged once
  SELECT s.id, s.entity_id, t.id
    FROM site s
    JOIN site_tax st ON st.site_id = s.id
    JOIN tax t ON t.id = st.tax_id AND t.active
)
SELECT s.id AS site_id,
       s.entity_id,
       COALESCE(sum(r.rate_pct), 0)::numeric(7,4) AS rate_pct,
       count(a.tax_id) AS levies,
       max(r.effective_from) AS effective_from,
       min(r.verified_on) AS verified_on,
       jsonb_agg(jsonb_build_object('tax', t.name, 'level', t.level,
                                    'authority', t.authority, 'rate_pct', r.rate_pct,
                                    'from', CASE WHEN et.entity_id IS NOT NULL
                                                 THEN 'client' ELSE 'site' END)
                 ORDER BY t.level, t.name)
         FILTER (WHERE a.tax_id IS NOT NULL) AS breakdown
  FROM site s
  LEFT JOIN applies a ON a.site_id = s.id
  LEFT JOIN tax t ON t.id = a.tax_id
  LEFT JOIN entity_tax et ON et.entity_id = s.entity_id AND et.tax_id = a.tax_id
  LEFT JOIN LATERAL (
         SELECT tr.rate_pct, tr.effective_from, tr.verified_on
           FROM tax_rate tr
          WHERE tr.tax_id = a.tax_id AND tr.effective_from <= current_date
          ORDER BY tr.effective_from DESC
          LIMIT 1) r ON true
 GROUP BY s.id, s.entity_id;

COMMENT ON VIEW site_rate IS
  'What tax is charged at each site: every levy reaching it from its client or '
  'from itself, counted once, summed. breakdown says which government each '
  'share belongs to and whether it came from the client or the site.';

INSERT INTO migration (filename)
VALUES ('0004_levies_stack_from_the_client_and_the_site.sql');

COMMIT;
