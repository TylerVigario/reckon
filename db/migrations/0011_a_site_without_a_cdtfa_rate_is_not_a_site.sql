-- Every site has a rate from CDTFA. There is no other kind.
--
-- "All sites should have API retrieved rates, there should never be a
--  situation in which they have not"                          -- 20 Sep 2026
--
-- 0010 made the rate CDTFA's rather than ours, but left it nullable -- so a
-- site could exist unpriced, and every screen grew a branch for that state:
-- "never checked", "no rate", "cannot be billed". Those branches were the
-- schema admitting it allowed something the business does not.
--
-- A site is a place work is billed from. A place that cannot be priced cannot
-- be billed from, so it is not a site -- it is an address somebody has not
-- finished entering. The database says so now, and the screens lose every
-- branch that existed to describe the gap.
--
-- WHAT THIS REQUIRES OF WHOEVER CREATES A SITE: the full address, because
-- CDTFA's rate API wants street, city AND zip and refuses without all three;
-- then the answer it gives, stored with the day it was asked. Creating a site
-- is therefore a lookup, not a form that can be half-filled.
--
-- THIS MIGRATION REFUSES rather than inventing a rate for a row that has none.
-- Run scripts/refresh-tax-rates.mjs first; anything it cannot answer for is an
-- address to fix, and guessing one here would be the over-collection this
-- system exists to prevent, written into the schema.

BEGIN;

DO $$
DECLARE unpriced int; unaddressed int;
BEGIN
  SELECT count(*) INTO unaddressed FROM site
   WHERE coalesce(street, '') = '' OR coalesce(city, '') = ''
      OR coalesce(postcode, '') = '';
  SELECT count(*) INTO unpriced FROM site
   WHERE tax_rate_pct IS NULL OR tax_jurisdiction IS NULL
      OR tax_area_code IS NULL OR area_verified_on IS NULL;

  IF unaddressed > 0 OR unpriced > 0 THEN
    RAISE EXCEPTION 'REFUSING: % site(s) short of an address and % without a CDTFA '
                    'rate. Complete the addresses, run scripts/refresh-tax-rates.mjs, '
                    'and apply this again.', unaddressed, unpriced;
  END IF;
END $$;

ALTER TABLE site ALTER COLUMN street SET NOT NULL;
ALTER TABLE site ALTER COLUMN city SET NOT NULL;
ALTER TABLE site ALTER COLUMN postcode SET NOT NULL;

ALTER TABLE site ALTER COLUMN tax_rate_pct SET NOT NULL;
ALTER TABLE site ALTER COLUMN tax_jurisdiction SET NOT NULL;
ALTER TABLE site ALTER COLUMN tax_area_code SET NOT NULL;
ALTER TABLE site ALTER COLUMN area_verified_on SET NOT NULL;

ALTER TABLE site ADD CONSTRAINT site_address_is_complete
  CHECK (street <> '' AND city <> '' AND postcode <> '');

COMMENT ON COLUMN site.postcode IS
  'Required. CDTFA''s rate API wants street, city and zip together and refuses '
  'without all three, so an address short of one cannot be priced -- and an '
  'unpriceable address is not a site.';
COMMENT ON COLUMN site.tax_rate_pct IS
  'The rate CDTFA returned for this address. Required: there is no such thing '
  'as a site without one, and nothing in the app can author one.';

-- site_rate loses the branch for an absence that can no longer happen. What is
-- left worth saying is how old the answer is. Dropped and recreated rather
-- than replaced: CREATE OR REPLACE cannot remove a column from a view.
DROP VIEW site_rate;

CREATE VIEW site_rate AS
SELECT s.id AS site_id,
       s.entity_id,
       s.tax_rate_pct AS rate_pct,
       s.tax_jurisdiction,
       s.tax_area_code,
       s.area_verified_on AS verified_on,
       (s.area_verified_on < current_date - 90) AS stale,
       (SELECT count(*) FROM site_tax_check c
         WHERE c.site_id = s.id AND c.changed) AS changes
  FROM site s;

COMMENT ON VIEW site_rate IS
  'What is charged at each site and how current it is. Every site has a rate: '
  'stale means the answer is over 90 days old, not that there is not one.';

INSERT INTO migration (filename)
VALUES ('0011_a_site_without_a_cdtfa_rate_is_not_a_site.sql');

COMMIT;
