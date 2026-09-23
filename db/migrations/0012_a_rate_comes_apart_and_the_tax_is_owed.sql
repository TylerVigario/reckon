-- The rate comes apart, and what is collected is owed to somebody.
--
-- "there has to be a way to programmatically figure out the state wide rate.
--  this application connects to beancount thus needs a way to track tax
--  obligations"                                               -- 20 Sep 2026
--
-- BOTH HALVES TURN OUT TO BE PUBLISHED. 0010 said the rate API gives a combined
-- figure and nothing more, so a return could only be allocated by jurisdiction.
-- That was true of that endpoint and wrong about CDTFA: their published rate
-- layer carries StateRate, CountyRate and CityRate beside the total, keyed by
-- the same TAC the rate API returns.
--
--   Checked against all 558 Californian jurisdictions on 20 Sep 2026:
--     · StateRate has exactly ONE distinct value statewide, 0.0725. The
--       statewide rate is therefore read, not assumed -- and if it ever moves,
--       it moves in the data rather than in a constant somebody forgot.
--     · State + County + City = RATE on every single record, no exceptions.
--       So the split is exact arithmetic, not an apportionment, and the CHECK
--       below can insist on it.
--
-- WHY IT MATTERS HERE. Tax collected is not income -- it is somebody else's
-- money held briefly, and a ledger has to say whose. Without the split there is
-- one Liabilities:SalesTaxPayable and no way to say what belongs to the state
-- and what belongs to Kings County. With it, every invoice posts to the right
-- obligation and the return is a query rather than a reconstruction.
--
-- THE OBLIGATION IS TRACKED, NOT INFERRED. What is charged is known from the
-- invoices. What has been handed over is a fact about the world that nothing
-- in this database could work out, so it is recorded: tax_remittance is a
-- filing, and what is still owed is the difference.
--
-- The new rate columns are nullable for exactly as long as it takes to run
-- scripts/refresh-tax-rates.mjs, which fills them from the layer. 0013 makes
-- them required.

BEGIN;

-- ===========================================================================
-- What the total is made of.

ALTER TABLE site
  ADD COLUMN state_rate_pct  numeric(7,4) CHECK (state_rate_pct  >= 0),
  ADD COLUMN county_rate_pct numeric(7,4) CHECK (county_rate_pct >= 0),
  ADD COLUMN city_rate_pct   numeric(7,4) CHECK (city_rate_pct   >= 0);

ALTER TABLE site ADD CONSTRAINT site_rate_parts_sum_to_the_rate
  CHECK (state_rate_pct IS NULL
      OR state_rate_pct + county_rate_pct + city_rate_pct = tax_rate_pct);

COMMENT ON COLUMN site.state_rate_pct IS
  'The state''s share of this address''s rate, from CDTFA''s published layer. '
  'One value statewide -- read rather than assumed, so a change to it arrives '
  'with the next refresh instead of needing a code change.';
COMMENT ON COLUMN site.county_rate_pct IS
  'The county''s share. Zero in a county with no district tax, which is most '
  'of them -- zero is an answer, null is not.';
COMMENT ON COLUMN site.city_rate_pct IS
  'The city''s share, where the address is inside city limits.';

ALTER TABLE site_tax_check
  ADD COLUMN state_rate_pct  numeric(7,4),
  ADD COLUMN county_rate_pct numeric(7,4),
  ADD COLUMN city_rate_pct   numeric(7,4);

COMMENT ON TABLE site_tax_check IS
  'One row per question put to CDTFA. Kept because a rate that moved is a '
  'thing to explain later -- an invoice at the old figure is correct, and this '
  'is both the evidence of when it changed and the split to post it by.';

-- ===========================================================================
-- What has actually been handed over.

CREATE TABLE tax_remittance (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end   date NOT NULL,
  filed_on     date,
  paid_on      date,
  amount       numeric(12,2) NOT NULL CHECK (amount >= 0),
  reference    text,
  note         text,
  created_by   uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT remittance_period_ends_after_it_starts CHECK (period_end >= period_start),
  CONSTRAINT one_filing_per_period UNIQUE (period_start, period_end)
);

COMMENT ON TABLE tax_remittance IS
  'A return that was filed and the money that went with it. Nothing here can '
  'be derived: what was charged is in the invoices, but what was handed over '
  'is a fact about the world, and the difference is what is still owed.';
COMMENT ON COLUMN tax_remittance.filed_on IS
  'When the return went in. Distinct from paid_on: a return can be filed and '
  'paid on different days, and a ledger posts the payment.';

-- ===========================================================================
-- Every invoice's tax, split the way it is owed.

CREATE VIEW invoice_tax AS
WITH per_line AS (
  SELECT il.invoice_id,
         i.entity_id,
         i.status,
         i.issued_on,
         il.amount,
         il.tax_rate_pct,
         il.amount * il.tax_rate_pct / 100 AS tax,
         -- The split in force when the invoice was issued, not today's: a rate
         -- that moved afterwards did not move what was charged.
         r.state_rate_pct,
         r.county_rate_pct,
         r.city_rate_pct,
         r.rate_pct AS split_of,
         r.tax_jurisdiction
    FROM invoice_line il
    JOIN invoice i ON i.id = il.invoice_id
    LEFT JOIN LATERAL (
           SELECT c.state_rate_pct, c.county_rate_pct, c.city_rate_pct,
                  c.rate_pct, c.tax_jurisdiction
             FROM site_tax_check c
            WHERE c.site_id = il.site_id
              AND c.rate_pct IS NOT NULL
              AND c.checked_at::date <= COALESCE(i.issued_on, current_date)
            ORDER BY c.checked_at DESC
            LIMIT 1) r ON true
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
       count(*) FILTER (WHERE split_of IS NULL)::int AS lines_without_a_split
  FROM per_line
 GROUP BY invoice_id, entity_id, status, issued_on;

COMMENT ON VIEW invoice_tax IS
  'What each invoice collected on somebody else''s behalf, split into the '
  'state''s, the county''s and the city''s shares so a ledger can post it to '
  'the right obligation. lines_without_a_split counts lines issued before '
  'CDTFA was ever asked about their site -- none, once every site is priced.';

INSERT INTO migration (filename)
VALUES ('0012_a_rate_comes_apart_and_the_tax_is_owed.sql');

COMMIT;
