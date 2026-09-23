-- A rate is not ours to hold an opinion about.
--
-- "tax screen shouldnt be a thing. it should just be rates pulled in per site
--  via api, regularly updated as to not fall behind. there is no rate that is
--  app managed anymore"                                       -- 20 Sep 2026
--
-- Every version of this so far kept a pool of levies somebody had to curate:
-- districts to attach, rates to key in, a screen to maintain them on. All of it
-- was a second copy of something CDTFA publishes and keeps current, and a
-- second copy of a rate is a rate that goes stale without telling anyone. The
-- over-collection this system exists to prevent came from exactly that -- a
-- rate held locally, applied everywhere, and wrong.
--
-- So the rate lives on the site, it arrives from CDTFA's rate API, and nothing
-- in the app can author one. The site carries what the API said, their name for
-- the area, their tax area code, and the day it was asked. A refresh writes a
-- new answer; a check that changes nothing still moves the date, because
-- "confirmed today" and "nobody has looked since March" are different facts.
--
-- WHAT THIS COSTS. The API returns one combined rate per address, not its
-- districts. Schedule A can therefore break out by JURISDICTION -- which is
-- what the lookup gives and what a return allocates against -- but not by
-- individual district. Recovering that would mean re-introducing a local table
-- of districts, which is the thing being removed.
--
-- PAST INVOICES ARE UNAFFECTED. invoice_line stores the rate it charged, so a
-- rate changing here never rewrites what was billed.

BEGIN;

-- ===========================================================================
-- What CDTFA says about this address.

ALTER TABLE site RENAME COLUMN verified_rate_pct TO tax_rate_pct;
ALTER TABLE site ADD COLUMN tax_jurisdiction text;

COMMENT ON COLUMN site.tax_rate_pct IS
  'The rate CDTFA returned for this address, as a percentage. The only rate '
  'there is -- nothing in the app can author one. Null means nobody has asked '
  'yet, which is not the same as zero and must not be billed at.';
COMMENT ON COLUMN site.tax_jurisdiction IS
  'CDTFA''s own name for the area, e.g. UNINCORPORATED AREA-KINGS. What a '
  'return allocates against, and what a re-check is compared to.';
COMMENT ON COLUMN site.tax_area_code IS
  'CDTFA''s TAC for the address. Changes when the address moves between areas, '
  'which is the case a rate comparison alone would miss.';
COMMENT ON COLUMN site.area_verified_on IS
  'The day CDTFA was last asked about this address. A check that changed '
  'nothing still moves it: confirmed today and nobody-has-looked are different '
  'facts and the screens say which.';

-- ===========================================================================
-- Every answer CDTFA has given, so a change is visible rather than overwritten.

CREATE TABLE site_tax_check (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES site(id) ON DELETE CASCADE,
  checked_at       timestamptz NOT NULL DEFAULT now(),
  tax_area_code    text,
  tax_jurisdiction text,
  rate_pct         numeric(7,4) CHECK (rate_pct >= 0),
  changed          boolean NOT NULL DEFAULT false,
  note             text
);

CREATE INDEX site_tax_check_by_site ON site_tax_check (site_id, checked_at DESC);

COMMENT ON TABLE site_tax_check IS
  'One row per question put to the CDTFA rate API. Kept because a rate that '
  'moved is a thing to explain later -- an invoice at the old figure is '
  'correct, and this is the evidence of when the change landed.';
COMMENT ON COLUMN site_tax_check.changed IS
  'True where this answer differed from the one before it. What a "rates '
  'moved" report is built from.';

-- Seed the log with what is already on file, so the first refresh has
-- something to compare against rather than reporting every site as changed.
INSERT INTO site_tax_check (site_id, checked_at, tax_area_code, tax_jurisdiction,
                            rate_pct, changed, note)
SELECT s.id,
       COALESCE(s.area_verified_on::timestamptz, now()),
       s.tax_area_code, s.tax_jurisdiction, s.tax_rate_pct, false,
       'carried in from what was already recorded'
  FROM site s
 WHERE s.tax_rate_pct IS NOT NULL;

-- ===========================================================================
-- The pool goes, and everything that curated it.

DROP VIEW IF EXISTS site_rate;
DROP TABLE IF EXISTS site_tax;
DROP TABLE IF EXISTS entity_tax;
DROP TABLE IF EXISTS tax_rate;
DROP TABLE IF EXISTS tax;

-- site_rate stays as the name every query already uses, but there is nothing
-- left to resolve: it reads the site and says how old the answer is.
CREATE VIEW site_rate AS
SELECT s.id AS site_id,
       s.entity_id,
       s.tax_rate_pct AS rate_pct,
       s.tax_jurisdiction,
       s.tax_area_code,
       s.area_verified_on AS verified_on,
       (s.area_verified_on IS NOT NULL
        AND s.area_verified_on < current_date - 90) AS stale,
       (s.tax_rate_pct IS NULL) AS unchecked,
       (SELECT count(*) FROM site_tax_check c
         WHERE c.site_id = s.id AND c.changed) AS changes
  FROM site s;

COMMENT ON VIEW site_rate IS
  'What is charged at each site and how current it is. unchecked means CDTFA '
  'has never been asked, which must not be billed at; stale means the answer '
  'is over 90 days old.';

INSERT INTO migration (filename)
VALUES ('0010_rates_come_from_cdtfa_not_from_us.sql');

COMMIT;
