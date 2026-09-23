-- The breakdown has to name whose money each share is.
--
-- 0005 split `authority` into imposed_by and collected_by on the tax table, but
-- site_rate's breakdown JSON was written in 0004 and kept its key: a rename
-- follows a view's column reference silently, so `'authority', t.collected_by`
-- is what the view now says. Every element of every breakdown reads
-- "authority": "CDTFA".
--
-- That is the exact failure 0005 was written to end, one layer further out.
-- breakdown is not a display convenience -- it is the per-levy record a return
-- allocates from, and allocation is by who imposed the levy. A JSON document
-- where the state's 6.000 and Kings County's 0.250 both say CDTFA cannot be
-- filed from.
--
-- So the view carries both, under the names the table now uses, and no caller
-- has to know that one of them used to be called something else.

BEGIN;

CREATE OR REPLACE VIEW site_rate AS
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
                                    'imposed_by', t.imposed_by,
                                    'collected_by', t.collected_by,
                                    'rate_pct', r.rate_pct,
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
  'from itself, counted once, summed. breakdown says whose levy each share is, '
  'who the return for it goes to, and whether it came from the client or the '
  'site.';

INSERT INTO migration (filename)
VALUES ('0006_the_breakdown_names_whose_money_it_is.sql');

COMMIT;
