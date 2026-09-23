-- site_rate resolves a rate and then hides what it is made of.
--
-- "entity sites still show combined rate only, every area should show the
--  individual rates"                                          -- 20 Sep 2026
--
-- The split has been on the site since 0012 and on the return since then too,
-- but the view every screen reads through carried only the total -- so every
-- screen showed one figure and no screen could show the two behind it. A view
-- that drops a column its callers need is a view that makes them go round it.

BEGIN;

-- Dropped and recreated rather than replaced: CREATE OR REPLACE can add
-- columns at the end but not insert them, and the split belongs beside the
-- total it makes up rather than tacked on after the housekeeping.
DROP VIEW site_rate;

CREATE VIEW site_rate AS
SELECT s.id AS site_id,
       s.entity_id,
       s.tax_rate_pct AS rate_pct,
       s.state_rate_pct,
       s.district_rate_pct,
       s.tax_jurisdiction,
       s.tax_area_code,
       s.area_verified_on AS verified_on,
       (s.area_verified_on < current_date - 90) AS stale,
       (SELECT count(*) FROM site_tax_check c
         WHERE c.site_id = s.id AND c.changed) AS changes
  FROM site s;

COMMENT ON VIEW site_rate IS
  'What is charged at each site, what it is made of, and how current it is. '
  'Every site has a rate: stale means the answer is over 90 days old, not '
  'that there is not one.';

INSERT INTO migration (filename)
VALUES ('0015_site_rate_carries_the_split.sql');

COMMIT;
