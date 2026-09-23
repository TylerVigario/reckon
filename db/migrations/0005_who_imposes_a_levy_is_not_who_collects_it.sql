-- Who imposes a levy is not who collects it.
--
-- "they all state CDTFA but localities are not CDTFA"  -- 14 Sep 2026
--
-- `authority` was one column doing two jobs, and every row had the wrong one in
-- it. CDTFA is the California Department of Tax and Fee Administration: it
-- administers the return and receives the money, for the state's share and for
-- every county and district share alike. It does not levy Kings County's
-- quarter of a percent. Kings County does.
--
-- Both facts are needed and they are not the same fact:
--
--   imposed_by   whose levy it is. It decides who the money belongs to, which
--                is what a return allocates and what a rate change traces to.
--   collected_by who the return goes to. In California that is CDTFA for all
--                of them, which is exactly why it cannot double as the first --
--                a column where every row says CDTFA cannot tell Kings from
--                Tulare from the state.
--
-- WHAT IS BACKFILLED AND WHAT IS NOT. collected_by takes the old value, which
-- was always right for that question. imposed_by is set only for the state
-- levy, where it is not in doubt. A row named UNINCORPORATED AREA-KINGS is
-- almost certainly Kings County's, but "almost certainly" is how wrong data
-- gets written confidently, and this is a column about whose money it is.
-- The screens show it empty and ask.

BEGIN;

ALTER TABLE tax RENAME COLUMN authority TO collected_by;
ALTER TABLE tax ADD COLUMN imposed_by text;

COMMENT ON COLUMN tax.imposed_by IS
  'The government whose levy this is, and whose money it becomes. Kings County '
  'for the Kings share, the State of California for the state''s. Null means '
  'nobody has said yet -- which is worth seeing, because a return allocates by '
  'this.';
COMMENT ON COLUMN tax.collected_by IS
  'Who administers it and receives the return. In California that is CDTFA for '
  'every levy, state and local alike, which is why it cannot also answer whose '
  'levy it is.';

UPDATE tax SET imposed_by = 'State of California'
 WHERE level = 'state' AND collected_by = 'CDTFA';

INSERT INTO migration (filename)
VALUES ('0005_who_imposes_a_levy_is_not_who_collects_it.sql');

COMMIT;
