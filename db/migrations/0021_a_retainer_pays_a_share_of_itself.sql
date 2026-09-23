-- A retainer pays a share of itself.
--
-- "retainer covered hours should be percentage based payouts (can be more than
--  one responder each month and that too should be percentage) and bravo would
--  effectively be 0% payout to responder"  -- 23 Sep 2026
--
-- An hour a retainer covers bills nothing by the hour: the client has already
-- paid for the period. So it cannot be paid for by the hour either, and 0020 did
-- exactly that -- it valued every entry at the hourly price, covered or not, and
-- paid the hourly rule on it.
--
-- Three things follow:
--
--   covered_time    a pay rule can now pay for covered time, and only as a
--                   percentage (or nothing). The percentage is of what the
--                   retainer charged for the period, split among everybody who
--                   worked its covered hours by their share of them -- so two
--                   responders at 3 h and 1 h under a 20% rule on $400 are paid
--                   $60 and $20, and the retainer pays out 20% however many
--                   answered. Bravo's rule is 0%.
--
--   entry_coverage  which minutes of an entry a retainer covers. All of them
--                   under an unlimited allotment. Under a capped one, the first
--                   minutes of the period up to the pool, in the order they were
--                   worked; past it, the allotment's overage decides.
--
--   entry_worth     bills only what is not covered, and pays the two parts by
--                   their own rules. It also says what the entry earned: what
--                   it bills, plus its share of the retainer.
--
-- WHAT IS NOT DONE HERE, and why:
--
--   * A capped allotment is drawn down within a CHARGED period -- an
--     agreement_period row. Periods are written when a retainer is charged, and
--     the app does not charge them yet, so an hour in an uncharged period of a
--     capped retainer has no value until it is: null, not a guess.
--   * The same goes for what covered time pays: a share of a charge that has not
--     been made is unknown. A 0% rule pays 0 regardless, so Bravo's is always
--     known.
--   * Past a 'deny' allotment the work should not have happened, and capture
--     does not refuse it yet. Until it does, such an hour is valued as billed.

BEGIN;

-- ===========================================================================
-- Pay for covered time.

ALTER TABLE pay_rule DROP CONSTRAINT pay_rule_pays_for_check;
ALTER TABLE pay_rule ADD CONSTRAINT pay_rule_pays_for_check
  CHECK (pays_for IN ('time', 'covered_time', 'vehicle'));
ALTER TABLE pay_rule ADD CONSTRAINT pay_rule_covered_time_is_a_share
  CHECK (pays_for <> 'covered_time' OR method IN ('percent', 'nothing'));

COMMENT ON COLUMN pay_rule.pays_for IS
  'What was contributed. time pays the person who spent it, on hours that are '
  'billed. covered_time pays for hours a retainer covers, as a share of the '
  'retainer. vehicle pays whoever owns the vehicle, so a company vehicle pays '
  'nobody and the business keeps it.';
COMMENT ON COLUMN pay_rule.method IS
  'per_hour: amount an hour worked, counted to the second. percent: amount percent '
  'of the whole line, before tax -- or for covered_time, of what the retainer '
  'charged for the period, split by each person''s share of its covered hours. '
  'fixed: amount per entry, however long. nothing.';

-- 0020 carried Bravo's "nothing gauranteed for responder" as a time rule that
-- pays nothing for that client's covered service. It was always about covered
-- hours, and a covered hour is now paid by covered_time: the same rule, said as
-- the 0% it is. A rule that paid an hourly rate on covered hours has no
-- percentage it can become without somebody deciding one, so it is refused.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pay_rule pr
     WHERE pr.pays_for = 'time' AND pr.method = 'per_hour' AND pr.entity_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM agreement a
                     JOIN agreement_service asv ON asv.agreement_id = a.id
                    WHERE a.entity_id = pr.entity_id AND asv.service_id = pr.service_id))
  THEN
    RAISE EXCEPTION 'an hourly rule pays for a service a client''s retainer covers -- '
                    'covered time is paid as a share of the retainer, and which share '
                    'is a decision';
  END IF;
END $$;

UPDATE pay_rule pr
   SET pays_for = 'covered_time', method = 'percent', amount = 0
 WHERE pr.pays_for = 'time' AND pr.method = 'nothing' AND pr.entity_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM agreement a
                 JOIN agreement_service asv ON asv.agreement_id = a.id
                WHERE a.entity_id = pr.entity_id AND asv.service_id = pr.service_id);

CREATE FUNCTION covered_pay(p_service uuid, p_user uuid, p_entity uuid, p_day date,
                            p_share numeric)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT CASE r.method
           WHEN 'nothing' THEN 0::numeric(12,2)
           WHEN 'percent' THEN CASE WHEN r.amount = 0 THEN 0::numeric(12,2)
                                    ELSE (r.amount / 100.0 * p_share)::numeric(12,2) END
         END
    FROM pay_rule_on(p_service, p_user, p_entity, 'covered_time', p_day) r
$$;
COMMENT ON FUNCTION covered_pay(uuid, uuid, uuid, date, numeric) IS
  'What one person is paid for covered time on one entry: their rule''s percentage '
  'of p_share, their part of the retainer''s charge. A 0% rule pays 0 even when the '
  'charge is not known yet. Null when no rule reaches them.';

-- ===========================================================================
-- Which minutes a retainer covers.

CREATE VIEW entry_coverage AS
WITH candidate AS (
  -- The agreement covering this entry: live on the day, for this client, naming
  -- this service. If two ever overlap, the one that started later governs.
  SELECT DISTINCT ON (t.id)
         t.id AS time_entry_id, t.minutes, t.worked_on, t.created_at, t.service_id,
         a.id AS agreement_id, asv.allotment, asv.overage, al.pooled_hours,
         ap.id AS agreement_period_id, ap.amount AS period_charge
    FROM time_entry t
    JOIN agreement a ON a.entity_id = t.entity_id
                    AND a.starts_on <= t.worked_on
                    AND (a.ends_on IS NULL OR a.ends_on >= t.worked_on)
    JOIN agreement_service asv ON asv.agreement_id = a.id AND asv.service_id = t.service_id
    JOIN agreement_allotment al ON al.agreement_id = a.id AND al.service_id = t.service_id
    LEFT JOIN agreement_period ap ON ap.agreement_id = a.id
                                 AND t.worked_on BETWEEN ap.period_start AND ap.period_end
   WHERE t.billable
   ORDER BY t.id, a.starts_on DESC
),
drawn AS (
  -- Minutes already drawn from the same pool, in the order they were worked.
  SELECT c.*,
         COALESCE(sum(c.minutes) OVER (
           PARTITION BY c.agreement_period_id, c.service_id
           ORDER BY c.worked_on, c.created_at, c.time_entry_id
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before
    FROM candidate c
)
SELECT t.id AS time_entry_id,
       d.agreement_id,
       d.agreement_period_id,
       d.period_charge,
       d.overage,
       (CASE
          WHEN d.time_entry_id IS NULL THEN 0
          WHEN d.allotment = 'unlimited' THEN t.minutes
          WHEN d.agreement_period_id IS NULL THEN NULL
          ELSE GREATEST(LEAST(t.minutes, round(d.pooled_hours * 60) - d.before), 0)
        END)::integer AS covered_minutes
  FROM time_entry t
  LEFT JOIN drawn d ON d.time_entry_id = t.id;
COMMENT ON VIEW entry_coverage IS
  'How many of an entry''s minutes a retainer covers. 0 when no agreement covers it; '
  'all of them under an unlimited allotment; under a capped one, what is left of the '
  'period''s pool when the entry is reached in the order worked. Null for a capped '
  'allotment in a period that has not been charged, whose pool is not known.';

-- ===========================================================================
-- What an entry is worth, in two parts.

DROP VIEW entry_worth;

CREATE VIEW entry_basis AS
WITH e AS (
  SELECT t.*, c.covered_minutes, c.agreement_id, c.agreement_period_id,
         c.period_charge, c.overage,
         CASE WHEN t.crew = 'team'
              THEN (SELECT count(*) FROM app_user u WHERE u.active AND u.role_id IS NOT NULL)::integer
              ELSE 1
         END AS heads
    FROM time_entry t
    JOIN entry_coverage c ON c.time_entry_id = t.id
),
-- Every person-minute a charged period covered: a team minute is one for each
-- person on it. Each person's share of the retainer is their part of this.
pool AS (
  SELECT agreement_period_id, sum(covered_minutes * heads) AS person_minutes
    FROM e
   WHERE agreement_period_id IS NOT NULL AND covered_minutes > 0
   GROUP BY agreement_period_id
)
SELECT e.id AS time_entry_id,
       e.service_id, e.entity_id, e.worked_on, e.crew, e.worked_by,
       e.heads,
       e.covered_minutes,
       e.minutes - e.covered_minutes AS billed_minutes,
       CASE
         WHEN e.covered_minutes IS NULL THEN NULL
         WHEN e.minutes - e.covered_minutes = 0 THEN 0::numeric(12,2)
         -- Past the pool, on a retainer that gives the rest away.
         WHEN e.agreement_id IS NOT NULL AND e.overage = 'no_charge' THEN 0::numeric(12,2)
         ELSE billed_amount(e.service_id, e.entity_id, e.heads, e.worked_on,
                            (e.minutes - e.covered_minutes) / 60.0)
       END AS billed,
       -- One person's part of the retainer's charge for this entry.
       CASE WHEN e.covered_minutes > 0
            THEN e.period_charge * e.covered_minutes / p.person_minutes
       END AS share_each
  FROM e
  LEFT JOIN pool p ON p.agreement_period_id = e.agreement_period_id;
COMMENT ON VIEW entry_basis IS
  'The parts an entry is valued in: minutes billed and what they bill, minutes a '
  'retainer covered, and each person''s part of the retainer''s charge for them. '
  'entry_pay and entry_worth are built on it.';

CREATE VIEW entry_pay AS
WITH parts AS (
  SELECT b.time_entry_id,
         u.id AS user_id,
         b.covered_minutes,
         CASE WHEN b.billed_minutes > 0
              THEN time_pay(b.service_id, u.id, b.entity_id, b.worked_on,
                            b.billed_minutes * 60, b.billed)
              ELSE 0 END AS time_paid,
         CASE WHEN b.covered_minutes > 0
              THEN covered_pay(b.service_id, u.id, b.entity_id, b.worked_on, b.share_each)
              ELSE 0 END AS covered_paid
    FROM entry_basis b
    JOIN app_user u
      ON (b.crew = 'team' AND u.active AND u.role_id IS NOT NULL)
      OR (b.crew <> 'team' AND u.id = b.worked_by)
)
SELECT time_entry_id, user_id, covered_minutes,
       time_paid::numeric(12,2) AS time_paid,
       covered_paid::numeric(12,2) AS covered_paid,
       (time_paid + covered_paid)::numeric(12,2) AS paid
  FROM parts;
COMMENT ON VIEW entry_pay IS
  'What each person on an entry is paid for it: billed minutes by their time rule '
  '(time_paid), covered minutes by their covered_time rule (covered_paid). A part is '
  'null when it is not known -- no rule reaches them, or the retainer''s charge for '
  'the period is not made -- and so is paid.';

CREATE VIEW entry_worth AS
SELECT b.time_entry_id,
       b.heads,
       job_rate(b.service_id, b.entity_id, b.heads, b.worked_on) AS rate,
       b.billed,
       b.covered_minutes,
       (b.share_each * b.heads)::numeric(12,2) AS covered_share,
       (b.billed + CASE WHEN COALESCE(b.covered_minutes, 0) > 0
                        THEN b.share_each * b.heads ELSE 0 END)::numeric(12,2) AS earned,
       (SELECT sum(p.paid) FROM entry_pay p WHERE p.time_entry_id = b.time_entry_id) AS paid
  FROM entry_basis b;
COMMENT ON VIEW entry_worth IS
  'What each time entry bills, earns and pays. billed is what goes on an invoice '
  'for it; earned adds its share of the retainer that covered it; paid is everybody '
  'on it, from entry_pay. A team entry counts everybody who holds a role as its '
  'crew, until entries name who worked.';

INSERT INTO migration (filename)
VALUES ('0021_a_retainer_pays_a_share_of_itself.sql');

COMMIT;
