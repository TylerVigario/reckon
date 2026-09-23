-- The split is required, and an invoice older than the first answer says so.
--
-- 0012 promised this once scripts/refresh-tax-rates.mjs had run. It has, and
-- every site now carries CDTFA's three shares as well as the total.
--
-- IT ALSO FIXES A HOLE IN invoice_tax. The split was taken from the answer in
-- force on the issue date, which is right -- a rate that moved afterwards did
-- not move what was charged. But an invoice issued BEFORE anybody first asked
-- CDTFA has no answer in force, and every such invoice came out unattributed:
-- tax collected, owed to nobody in particular. That is the worst of the three
-- possible behaviours.
--
-- So it falls back to the EARLIEST answer on record and says that it did. The
-- earliest answer is real evidence about the area -- district taxes change
-- every few years, not every month -- and an invoice attributed on that basis,
-- labelled as such, is worth more than one that cannot be posted at all. The
-- count comes back as estimated_lines so a return can see how much of it
-- rests on an answer from after the fact.

BEGIN;

ALTER TABLE site ALTER COLUMN state_rate_pct  SET NOT NULL;
ALTER TABLE site ALTER COLUMN county_rate_pct SET NOT NULL;
ALTER TABLE site ALTER COLUMN city_rate_pct   SET NOT NULL;

ALTER TABLE site DROP CONSTRAINT site_rate_parts_sum_to_the_rate;
ALTER TABLE site ADD CONSTRAINT site_rate_parts_sum_to_the_rate
  CHECK (state_rate_pct + county_rate_pct + city_rate_pct = tax_rate_pct);

DROP VIEW invoice_tax;

CREATE VIEW invoice_tax AS
WITH per_line AS (
  SELECT il.invoice_id,
         i.entity_id,
         i.status,
         i.issued_on,
         il.amount,
         il.amount * il.tax_rate_pct / 100 AS tax,
         COALESCE(inforce.state_rate_pct,  earliest.state_rate_pct)  AS state_rate_pct,
         COALESCE(inforce.county_rate_pct, earliest.county_rate_pct) AS county_rate_pct,
         COALESCE(inforce.city_rate_pct,   earliest.city_rate_pct)   AS city_rate_pct,
         COALESCE(inforce.rate_pct,        earliest.rate_pct)        AS split_of,
         COALESCE(inforce.tax_jurisdiction, earliest.tax_jurisdiction) AS tax_jurisdiction,
         (inforce.rate_pct IS NULL AND earliest.rate_pct IS NOT NULL) AS estimated
    FROM invoice_line il
    JOIN invoice i ON i.id = il.invoice_id
    -- What CDTFA said as at the day it was billed.
    LEFT JOIN LATERAL (
           SELECT c.state_rate_pct, c.county_rate_pct, c.city_rate_pct,
                  c.rate_pct, c.tax_jurisdiction
             FROM site_tax_check c
            WHERE c.site_id = il.site_id
              AND c.rate_pct IS NOT NULL
              AND c.checked_at::date <= COALESCE(i.issued_on, current_date)
            ORDER BY c.checked_at DESC
            LIMIT 1) inforce ON true
    -- And, for anything billed before the first question was ever put, the
    -- first answer there is.
    LEFT JOIN LATERAL (
           SELECT c.state_rate_pct, c.county_rate_pct, c.city_rate_pct,
                  c.rate_pct, c.tax_jurisdiction
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
       sum(CASE WHEN split_of > 0 THEN tax * county_rate_pct / split_of END)
         ::numeric(12,2) AS county_tax,
       sum(CASE WHEN split_of > 0 THEN tax * city_rate_pct / split_of END)
         ::numeric(12,2) AS city_tax,
       count(*) FILTER (WHERE estimated)::int AS estimated_lines,
       count(*) FILTER (WHERE split_of IS NULL)::int AS lines_without_a_split
  FROM per_line
 GROUP BY invoice_id, entity_id, status, issued_on;

COMMENT ON VIEW invoice_tax IS
  'What each invoice collected on somebody else''s behalf, split into the '
  'state''s, the county''s and the city''s shares so a ledger can post it to '
  'the right obligation. estimated_lines were billed before CDTFA was first '
  'asked about their site and are split by the earliest answer on record; '
  'lines_without_a_split had no answer at all.';

INSERT INTO migration (filename)
VALUES ('0013_every_rate_is_split_and_old_invoices_say_so.sql');

COMMIT;
