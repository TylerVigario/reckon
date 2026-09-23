-- A rate is the state's share and the districts on top. Two parts, not three.
--
-- "the rate should be listed as state + district"             -- 20 Sep 2026
--
-- 0012 took CDTFA's published layer at the shape of its columns -- StateRate,
-- CountyRate, CityRate -- and carried all three through. That is how the data
-- is stored, not what the thing is. CDTFA-105 is titled DISTRICT SALES AND USE
-- TAX RATES, and everything in it is a district tax: a county measure and a
-- city measure are both districts, levied by different bodies over different
-- areas. Splitting them into two columns implied a distinction the return does
-- not make and the department does not name.
--
-- So county and city fold into one district share. Nothing is lost that was
-- ever used: no screen, no report and no posting treated them differently, and
-- a return asks for the state's share and the district tax.
--
-- NO FIGURE MOVES. district = county + city, and state + district is the same
-- total as before.

BEGIN;

ALTER TABLE site ADD COLUMN district_rate_pct numeric(7,4);
UPDATE site SET district_rate_pct = county_rate_pct + city_rate_pct;
ALTER TABLE site ALTER COLUMN district_rate_pct SET NOT NULL;
ALTER TABLE site ADD CONSTRAINT site_district_rate_pct_check CHECK (district_rate_pct >= 0);

ALTER TABLE site DROP CONSTRAINT site_rate_parts_sum_to_the_rate;

DROP VIEW invoice_tax;

ALTER TABLE site DROP COLUMN county_rate_pct;
ALTER TABLE site DROP COLUMN city_rate_pct;

ALTER TABLE site ADD CONSTRAINT site_rate_parts_sum_to_the_rate
  CHECK (state_rate_pct + district_rate_pct = tax_rate_pct);

COMMENT ON COLUMN site.district_rate_pct IS
  'Everything above the state''s share: the district taxes reaching this '
  'address, added together. A county measure and a city measure are both '
  'districts -- CDTFA-105 is a list of districts and makes no other kind.';

ALTER TABLE site_tax_check ADD COLUMN district_rate_pct numeric(7,4);
UPDATE site_tax_check
   SET district_rate_pct = coalesce(county_rate_pct, 0) + coalesce(city_rate_pct, 0)
 WHERE county_rate_pct IS NOT NULL OR city_rate_pct IS NOT NULL;
ALTER TABLE site_tax_check DROP COLUMN county_rate_pct;
ALTER TABLE site_tax_check DROP COLUMN city_rate_pct;

-- ===========================================================================

CREATE VIEW invoice_tax AS
WITH per_line AS (
  SELECT il.invoice_id,
         i.entity_id,
         i.status,
         i.issued_on,
         il.amount,
         il.amount * il.tax_rate_pct / 100 AS tax,
         COALESCE(inforce.state_rate_pct,    earliest.state_rate_pct)    AS state_rate_pct,
         COALESCE(inforce.district_rate_pct, earliest.district_rate_pct) AS district_rate_pct,
         COALESCE(inforce.rate_pct,          earliest.rate_pct)          AS split_of,
         COALESCE(inforce.tax_jurisdiction,  earliest.tax_jurisdiction)  AS tax_jurisdiction,
         (inforce.rate_pct IS NULL AND earliest.rate_pct IS NOT NULL)    AS estimated
    FROM invoice_line il
    JOIN invoice i ON i.id = il.invoice_id
    -- What CDTFA said as at the day it was billed.
    LEFT JOIN LATERAL (
           SELECT c.state_rate_pct, c.district_rate_pct, c.rate_pct, c.tax_jurisdiction
             FROM site_tax_check c
            WHERE c.site_id = il.site_id
              AND c.rate_pct IS NOT NULL
              AND c.checked_at::date <= COALESCE(i.issued_on, current_date)
            ORDER BY c.checked_at DESC
            LIMIT 1) inforce ON true
    -- And, for anything billed before the first question was ever put, the
    -- first answer there is.
    LEFT JOIN LATERAL (
           SELECT c.state_rate_pct, c.district_rate_pct, c.rate_pct, c.tax_jurisdiction
             FROM site_tax_check c
            WHERE c.site_id = il.site_id
              AND c.rate_pct IS NOT NULL
            ORDER BY c.checked_at ASC
            LIMIT 1) earliest ON true
   WHERE il.taxable
)
SELECT invoice_id,
       entity_id,
       status,
       issued_on,
       max(tax_jurisdiction) AS tax_jurisdiction,
       sum(amount)::numeric(12,2) AS measure,
       sum(tax)::numeric(12,2) AS tax,
       -- Apportioned by CDTFA's own proportions. The figure CHARGED is
       -- authoritative -- it is what the client paid -- so the parts are
       -- scaled to it rather than recomputed from the rate, which keeps an
       -- overridden line's tax attributable instead of unexplained.
       sum(CASE WHEN split_of > 0 THEN tax * state_rate_pct / split_of END)
         ::numeric(12,2) AS state_tax,
       sum(CASE WHEN split_of > 0 THEN tax * district_rate_pct / split_of END)
         ::numeric(12,2) AS district_tax,
       count(*) FILTER (WHERE estimated)::int AS estimated_lines,
       count(*) FILTER (WHERE split_of IS NULL)::int AS lines_without_a_split
  FROM per_line
 GROUP BY invoice_id, entity_id, status, issued_on;

COMMENT ON VIEW invoice_tax IS
  'What each invoice collected on somebody else''s behalf, split into the '
  'state''s share and the district tax so a ledger can post it to the right '
  'obligation. estimated_lines were billed before CDTFA was first asked about '
  'their site and are split by the earliest answer on record.';

INSERT INTO migration (filename)
VALUES ('0014_a_rate_is_the_state_and_the_districts.sql');

COMMIT;
