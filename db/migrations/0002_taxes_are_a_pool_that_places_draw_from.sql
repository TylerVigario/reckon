-- Tax is a pool of levies. A place draws the ones that apply to it.
--
-- "tax should be a global tracking and then locations pull from the pool.
--  obviously we need support for numerous taxes (state, local, etc)"
--  -- 14 Sep 2026
--
-- What was here could hold one number per address. location.tax_district_id
-- pointed at a single tax_district whose rate was the CDTFA's published total
-- -- 7.250% at Kettleman -- and the components inside it were not recorded
-- anywhere. That is enough to put the right figure on an invoice and not enough
-- to do anything else with it:
--
--   * a return is filed per jurisdiction, and the state's share, the county's
--     and the district's go on different lines of it;
--   * a rate changes one component at a time, and a combined figure cannot say
--     which moved or when;
--   * a city tax added next year is not a new district, it is another levy on
--     the same ground, and there was nowhere to put it.
--
-- So: `tax` is every levy the business has ever had to charge, each at its own
-- level and with its own dated rates. `location_tax` says which of them apply
-- at an address -- a site sits in a state AND a county AND possibly a city AND
-- a special district, all at once. The rate at that site is the sum, and
-- site_rate still answers it in one place so nothing has to add up levies by
-- hand.
--
-- WHAT MIGRATES, AND WHAT IS NOT INVENTED. Each existing district becomes one
-- tax at level 'combined', carrying the total that was already recorded. The
-- components are NOT split out here: California's 7.250% is 6.000% state plus
-- 0.250% county plus 1.000% district, but that is knowledge about a rate this
-- system never captured, and a migration that fabricates a breakdown is worse
-- than one that admits it has a total. A combined levy is billable and filable
-- as one line; splitting it is a later edit, made by somebody looking at the
-- CDTFA schedule.

BEGIN;

CREATE TABLE tax (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name      text NOT NULL UNIQUE,
  -- 'combined' is a published total whose parts were never recorded. Every
  -- other level is one levy, by one authority, that files on its own line.
  level     text NOT NULL
            CHECK (level IN ('state','county','city','district','special','combined')),
  authority text,
  code      text,
  active    boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE tax IS
  'Every levy the operator has had to charge, at whatever level it is imposed. '
  'A place draws the ones that apply to it through location_tax; the rate '
  'there is their sum.';
COMMENT ON COLUMN tax.level IS
  'Where the levy comes from. combined means a published total whose components '
  'are not recorded -- billable and filable as one line, and worth splitting '
  'when somebody has the schedule in front of them.';
COMMENT ON COLUMN tax.authority IS
  'Who imposes it and who the return goes to -- CDTFA for California.';
COMMENT ON COLUMN tax.code IS
  'The designation on the rate schedule, so a filename or a phone call can use '
  'the same words the agency does.';

CREATE TABLE tax_rate (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_id         uuid NOT NULL REFERENCES tax(id) ON DELETE CASCADE,
  rate_pct       numeric(7,4) NOT NULL CHECK (rate_pct >= 0),
  effective_from date NOT NULL,
  verified_on    date,
  source         text,
  UNIQUE (tax_id, effective_from)
);

COMMENT ON TABLE tax_rate IS
  'A levy''s rate, dated. Rates change one levy at a time, and a line billed '
  'last year must still price at last year''s figure.';
COMMENT ON COLUMN tax_rate.verified_on IS
  'When this was last checked against the agency''s own schedule. A rate that '
  'was right in March says nothing about today.';

CREATE INDEX tax_rate_asof ON tax_rate (tax_id, effective_from DESC);

-- Which levies reach which ground. A site is in a state and a county and
-- perhaps a city, all at once, so this is a set and not a column.
CREATE TABLE location_tax (
  location_id uuid NOT NULL REFERENCES location(id) ON DELETE CASCADE,
  tax_id      uuid NOT NULL REFERENCES tax(id) ON DELETE RESTRICT,
  PRIMARY KEY (location_id, tax_id)
);

COMMENT ON TABLE location_tax IS
  'The levies in force at an address. ON DELETE RESTRICT on the tax: losing a '
  'levy that priced a past invoice would leave that invoice unexplainable.';

-- ===========================================================================
-- Carry what is already recorded across, without inventing a breakdown.

INSERT INTO tax (id, name, level, authority, code)
SELECT d.id, d.name, 'combined', 'CDTFA', d.county
  FROM tax_district d;

INSERT INTO tax_rate (tax_id, rate_pct, effective_from, verified_on, source)
SELECT r.district_id, r.rate_pct, r.effective_from, r.verified_on, r.source
  FROM tax_district_rate r;

INSERT INTO location_tax (location_id, tax_id)
SELECT l.id, l.tax_district_id
  FROM location l
 WHERE l.tax_district_id IS NOT NULL;

-- ===========================================================================
-- The rate at a place is the sum of what applies there, on the day asked.

DROP VIEW IF EXISTS site_rate;

CREATE VIEW site_rate AS
SELECT l.id AS location_id,
       COALESCE(sum(r.rate_pct), 0)::numeric(7,4) AS rate_pct,
       count(t.id) AS levies,
       max(r.effective_from) AS effective_from,
       min(r.verified_on) AS verified_on,
       -- Enough to file with: every levy and its share, newest rate each.
       -- jsonb, not json: json has no equality operator, so a caller that
       -- GROUP BYs a row of this view fails with "could not identify an
       -- equality operator" -- which is a strange error to hand somebody for
       -- selecting a column.
       jsonb_agg(jsonb_build_object('tax', t.name, 'level', t.level,
                                    'authority', t.authority, 'rate_pct', r.rate_pct)
                 ORDER BY t.level, t.name)
         FILTER (WHERE t.id IS NOT NULL) AS breakdown
  FROM location l
  LEFT JOIN location_tax lt ON lt.location_id = l.id
  LEFT JOIN tax t ON t.id = lt.tax_id AND t.active
  LEFT JOIN LATERAL (
         SELECT tr.rate_pct, tr.effective_from, tr.verified_on
           FROM tax_rate tr
          WHERE tr.tax_id = t.id AND tr.effective_from <= current_date
          ORDER BY tr.effective_from DESC
          LIMIT 1) r ON true
 GROUP BY l.id;

COMMENT ON VIEW site_rate IS
  'What tax is charged at each address: the sum of the levies that reach it, '
  'with breakdown carrying each one''s share for a return. A location with no '
  'levies has no rate rather than a rate of zero -- levies = 0 says which.';

-- ===========================================================================
-- The old shape goes. Keeping it would leave two answers to "what is the rate
-- here", and the one that is easier to reach would win.

ALTER TABLE location DROP COLUMN tax_district_id;
DROP TABLE tax_district_rate;
DROP TABLE tax_district;

INSERT INTO migration (filename) VALUES ('0002_taxes_are_a_pool_that_places_draw_from.sql');

COMMIT;
