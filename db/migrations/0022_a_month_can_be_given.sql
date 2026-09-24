-- A month can be given.
--
-- "bravo should show usage against unlimited. its from the 1st of a the month
--  til the end of a month. billed for upcoming months usage. this month will be
--  given freely"  -- 23 Sep 2026
--
-- Bravo's periods are calendar months, each billed in advance for the month it
-- covers, and September 2026 -- the month the retainer began -- is not charged
-- at all. The first two are data: an anchor day of 1 and a period written when
-- it begins. The third needs somewhere to live.
--
--   given              A period can be given: written, with nothing charged for
--                      it, on purpose. A $0 period on its own reads the same as a
--                      mistake, and a month nobody has charged yet reads the same
--                      as a month given away -- so the choice is a column, and
--                      the screens say "given freely" rather than "$0.00".
--
--   agreement_charge() What one period of an agreement charges at its price: the
--                      price, times the sites it covers when it is priced per
--                      site. Every screen showed Bravo's $200 -- the price of one
--                      site -- as what Bravo pays a month, which is $400.

BEGIN;

ALTER TABLE agreement_period
  ADD COLUMN given boolean NOT NULL DEFAULT false;
ALTER TABLE agreement_period
  ADD CONSTRAINT agreement_period_given_charges_nothing CHECK (NOT given OR amount = 0);
COMMENT ON COLUMN agreement_period.given IS
  'This period was given: covered, and deliberately not charged -- "this month will '
  'be given freely". Its amount is 0. What it would have charged is agreement_charge().';

CREATE FUNCTION agreement_charge(p_agreement uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT (a.price * CASE WHEN a.basis = 'per_location'
                         THEN (SELECT count(*) FROM agreement_site s
                                WHERE s.agreement_id = a.id)
                         ELSE 1 END)::numeric(12,2)
    FROM agreement a
   WHERE a.id = p_agreement
$$;
COMMENT ON FUNCTION agreement_charge(uuid) IS
  'What one period of an agreement charges at its price: the price, times the sites '
  'it covers when its basis is per_location. What a period actually charged is '
  'agreement_period.amount, which is what it was when it was written.';

INSERT INTO migration (filename) VALUES ('0022_a_month_can_be_given.sql');

COMMIT;
