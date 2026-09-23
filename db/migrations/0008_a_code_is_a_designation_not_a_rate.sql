-- A levy's code is the issuer's designation for it, not its rate.
--
-- 0004 split the published CDTFA totals into the state's share and the rest,
-- and created the state levy with code '6.000'. That is the rate, written into
-- the column that is supposed to say what CDTFA calls the levy -- the same
-- figure the rate column already holds, in a field a return would be filled in
-- from.
--
-- A wrong designation is worse than none: it reads like a schedule code and
-- would be copied onto a form as one. There is no code to correct it to -- the
-- state's share is not a district and has no district code -- so it is cleared
-- rather than guessed, which is the same rule 0005 used for the localities
-- whose levying government was not known.

BEGIN;

-- The inner CASE is not redundant with the WHERE: a planner may evaluate the
-- cast before the filter, and 'KINGS'::numeric stops the migration.
UPDATE tax t
   SET code = NULL
 WHERE t.code ~ '^[0-9]+(\.[0-9]+)?$'
   AND EXISTS (
     SELECT 1 FROM tax_rate r
      WHERE r.tax_id = t.id
        AND r.rate_pct = (CASE WHEN t.code ~ '^[0-9]+(\.[0-9]+)?$'
                               THEN t.code ELSE '0' END)::numeric
   );

COMMENT ON COLUMN tax.code IS
  'What the collecting body calls this levy -- a CDTFA district code, say. '
  'Null where it has none or nobody has looked it up. Never the rate: that is '
  'tax_rate''s, and a rate here would be copied onto a return as a code.';

INSERT INTO migration (filename)
VALUES ('0008_a_code_is_a_designation_not_a_rate.sql');

COMMIT;
