-- A service is configured, not categorised.
--
-- "weve paid too much attention to my specific requirements for services which
--  makes it less universal. the services should be universal in nature but allow
--  for our specific requirements, not set in stone."  -- 23 Sep 2026
--
-- "a service is configured per user and per user level (partner, employee, etc)
--  and payouts happens at a unit measurement (per hour but granular down to the
--  minute/second) but also could be a percentage payout of the entire charge
--  (personal mileage is 100% but company mileage would be 0% payout regardless
--  who drove ...)"  -- 23 Sep 2026
--
-- "whats the difference between on-site and remote? why are they categorical
--  instead of universal?"  -- 23 Sep 2026
--
-- "yes each can be a service charge, thats what allows flat rates as you pointed
--  out per service item"  -- 23 Sep 2026
--
-- Six things were built around this business's own arrangement rather than
-- around services in general. Each becomes configuration, and this business's
-- arrangement becomes the values in it:
--
--   delivery          on_site | remote answered one question -- which hours come
--                     out of a retainer -- by kind. An agreement now names the
--                     services it covers (agreement_service), each with its own
--                     allotment. The column goes.
--   crew pricing      one | team was two prices for two people. A price is now the
--                     rate for the first person and what each additional person
--                     adds: $80 and +$50 is the $130 for two.
--   on_team           a yes/no for "is paid". People now hold a role, from a list
--                     the operator keeps.
--   person_pay_rate   one kind of pay: an hourly rate. Pay is now rules --
--                     who (a role, or one person), for what (their time, their
--                     vehicle), how (per hour worked, a percentage of the charge,
--                     a fixed amount, or nothing), for which clients, from when.
--   responder_rate    pay written onto an agreement. It becomes a pay rule for
--                     that client, which is where Bravo's "nothing gauranteed for
--                     responder" now lives.
--   unit = 'mile'     the trip and travel screens found "the" mileage service by
--                     assuming there is exactly one. A trip leg now records the
--                     service it bills.
--
-- And two additions the mock carried as proposals and the operator kept: a
-- service may bill to the nearest increment of time, and may carry a minimum
-- charge. Plus 'each', which is how a service charges a flat rate.
--
-- ONE SOURCE OF TRUTH for what things cost and pay. The same "most specific
-- price that has started" lookup was written out again on every screen that
-- showed a value.
-- It is now service_price_on / job_rate / billed_amount, and the pay rule lookup
-- is pay_rule_on / time_pay, and entry_worth / leg_worth apply them. Every screen
-- asks those rather than working it out again.
--
-- WHAT IS NOT DONE HERE, and why:
--
--   * A team entry still names nobody. Until entries name who worked -- the next
--     piece -- "team" means what it has always meant: everybody who is paid, which
--     is to say everybody holding a role. Today that is the two partners, so
--     nothing moves; the day someone else holds a role, it is the thing to fix.
--   * Pay counted "to the second" is counted to the minute, because entries still
--     store minutes. The functions take seconds so nothing changes when they do.
--   * A trip does not know its vehicle, so a rule paying for a vehicle is kept
--     and shown but cannot yet be applied to a trip. leg_worth says so.
--   * An entry's value ignores coverage. entry_worth prices every entry by the
--     hour, covered or not: which hours an allotment absorbs depends on the order
--     they fall in a period, and that is decided when an invoice is drawn.
--   * Nothing here generates an invoice. The app does not yet; these are what it
--     will ask when it does.

BEGIN;

-- ===========================================================================
-- Roles, and who holds one.

CREATE TABLE role (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_name_is_something CHECK (btrim(name) <> ''),
  CONSTRAINT role_name_key UNIQUE (name)
);
COMMENT ON TABLE role IS
  'The operator''s own list of the capacities people are paid in -- Partner, '
  'Employee, Contractor, or whatever a business calls them. Pay rules are written '
  'against these, so a business names its own rather than inheriting ours.';

INSERT INTO role (name) VALUES ('Partner'), ('Employee'), ('Contractor');

ALTER TABLE app_user ADD COLUMN role_id uuid REFERENCES role(id) ON DELETE RESTRICT;
COMMENT ON COLUMN app_user.role_id IS
  'The capacity this person is paid in, now. Null means they sign in and are not '
  'paid. It is a current value, not a history: a role change reprices nothing '
  'already worked out.';

-- on_team was "is paid". Everybody paid today is a partner.
UPDATE app_user SET role_id = (SELECT id FROM role WHERE name = 'Partner') WHERE on_team;

-- ===========================================================================
-- Pay rules.

CREATE TABLE pay_rule (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id     uuid NOT NULL REFERENCES service(id) ON DELETE CASCADE,
  role_id        uuid REFERENCES role(id) ON DELETE RESTRICT,
  user_id        uuid REFERENCES app_user(id) ON DELETE CASCADE,
  entity_id      uuid REFERENCES entity(id) ON DELETE CASCADE,
  pays_for       text NOT NULL,
  method         text NOT NULL,
  amount         numeric(12,4),
  effective_from date NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pay_rule_pays_for_check CHECK (pays_for IN ('time', 'vehicle')),
  CONSTRAINT pay_rule_method_check CHECK (method IN ('per_hour', 'percent', 'fixed', 'nothing')),
  CONSTRAINT pay_rule_names_one_payee CHECK (num_nonnulls(role_id, user_id) = 1),
  -- IS NOT NULL spelled out: amount >= 0 is null for a null amount, and a CHECK
  -- that comes out null passes -- so without it an hourly rule with no rate
  -- would be accepted.
  CONSTRAINT pay_rule_amount_fits_method CHECK (
       (method = 'nothing' AND amount IS NULL)
    OR (method = 'percent' AND amount IS NOT NULL AND amount >= 0 AND amount <= 100)
    OR (method IN ('per_hour', 'fixed') AND amount IS NOT NULL AND amount >= 0)),
  CONSTRAINT pay_rule_scope UNIQUE NULLS NOT DISTINCT
    (service_id, role_id, user_id, entity_id, pays_for, effective_from)
);
COMMENT ON TABLE pay_rule IS
  'Who a service pays, for what, and how. The most specific rule that has started '
  'wins: a rule for one client beats one for every client, then a rule for one '
  'person beats one for their role, then the newest. "nothing" exists so a '
  'narrower rule can switch a wider one off -- Bravo''s remote calls.';
COMMENT ON COLUMN pay_rule.pays_for IS
  'What was contributed. time pays the person who spent it; vehicle pays whoever '
  'owns the vehicle, so a company vehicle pays nobody and the business keeps it.';
COMMENT ON COLUMN pay_rule.method IS
  'per_hour: amount an hour worked, counted to the second. percent: amount percent '
  'of the whole line, before tax. fixed: amount per entry, however long. nothing.';

CREATE INDEX pay_rule_by_service ON pay_rule (service_id, pays_for, effective_from DESC);
CREATE TRIGGER h_pay_rule AFTER UPDATE ON pay_rule
  FOR EACH ROW EXECUTE FUNCTION record_change();

-- A rate for a named service becomes that service's rule. A rate for no service
-- in particular was only ever applied to hourly services -- the pay report
-- filtered to them -- so it becomes a rule on each hourly service.
--
-- EXACTLY, not approximately. The old lookup preferred a service's own rate over
-- the house rate whatever their dates; the new one takes the newest rule. So the
-- house rate is carried onto a service only for dates BEFORE that service's own
-- rates begin. Carried any later it would outrank them; not carried at all, the
-- days before them would lose the fallback they had -- which the comparison run
-- against the seed caught as twelve Wild Jacks minutes turning unpaid.
INSERT INTO pay_rule (service_id, role_id, user_id, pays_for, method, amount, effective_from)
SELECT ppr.service_id,
       CASE WHEN ppr.user_id IS NULL THEN (SELECT id FROM role WHERE name = 'Partner') END,
       ppr.user_id, 'time', 'per_hour', ppr.rate, ppr.effective_from
  FROM person_pay_rate ppr
 WHERE ppr.service_id IS NOT NULL;

INSERT INTO pay_rule (service_id, role_id, user_id, pays_for, method, amount, effective_from)
SELECT s.id,
       CASE WHEN ppr.user_id IS NULL THEN (SELECT id FROM role WHERE name = 'Partner') END,
       ppr.user_id, 'time', 'per_hour', ppr.rate, ppr.effective_from
  FROM person_pay_rate ppr
  CROSS JOIN service s
 WHERE ppr.service_id IS NULL
   AND s.unit = 'hour'
   AND ppr.effective_from < COALESCE(
         (SELECT min(own.effective_from) FROM person_pay_rate own
           WHERE own.service_id = s.id
             AND own.user_id IS NOT DISTINCT FROM ppr.user_id),
         'infinity'::date);

-- ===========================================================================
-- What an agreement covers, service by service.

CREATE TABLE agreement_service (
  -- Its own id although the pair is the key: record_change() files history
  -- against a row's id, and a change to what an agreement covers is exactly
  -- the kind a client will later ask about.
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id    uuid NOT NULL REFERENCES agreement(id) ON DELETE CASCADE,
  service_id      uuid NOT NULL REFERENCES service(id) ON DELETE RESTRICT,
  allotment       text NOT NULL,
  included_hours  numeric(8,2),
  allotment_basis text NOT NULL DEFAULT 'flat',
  overage         text,
  CONSTRAINT agreement_service_once UNIQUE (agreement_id, service_id),
  CONSTRAINT agreement_service_allotment_check CHECK (allotment IN ('capped', 'unlimited')),
  CONSTRAINT agreement_service_included_hours_check CHECK (included_hours >= 0),
  CONSTRAINT agreement_service_allotment_basis_check CHECK (allotment_basis IN ('flat', 'per_location')),
  CONSTRAINT agreement_service_overage_check CHECK (overage IN ('bill', 'no_charge', 'deny')),
  CONSTRAINT agreement_service_cap_is_whole CHECK (
       (allotment = 'capped' AND included_hours IS NOT NULL AND overage IS NOT NULL)
    OR (allotment = 'unlimited' AND included_hours IS NULL AND overage IS NULL))
);
COMMENT ON TABLE agreement_service IS
  'The services an agreement covers, each with its own allotment. Hours come out '
  'of an allotment only when the agreement names their service, so an on-site '
  'retainer is as easy as a remote one, and a service not named here is billed. '
  'The terms are the agreement''s own: they start from the service''s subscription '
  'terms when coverage is added, and a later change to the service does not reach '
  'into an agreement already made.';
COMMENT ON COLUMN agreement_service.allotment_basis IS
  'flat: included_hours for the whole agreement. per_location: included_hours for '
  'each site it covers, pooled.';

CREATE TRIGGER h_agreement_service AFTER UPDATE ON agreement_service
  FOR EACH ROW EXECUTE FUNCTION record_change();

-- Every agreement that had a remote allotment covers every remote service, on
-- the terms it had.
INSERT INTO agreement_service (agreement_id, service_id, allotment, included_hours,
                               allotment_basis, overage)
SELECT a.id, s.id, a.remote_allotment,
       CASE WHEN a.remote_allotment = 'capped' THEN a.remote_cap_hours END,
       COALESCE(a.allotment_basis, a.basis),
       CASE WHEN a.remote_allotment = 'capped' THEN a.overage END
  FROM agreement a
  CROSS JOIN service s
 WHERE a.remote_allotment <> 'none'
   AND s.delivery = 'remote';

-- A responder rate on an agreement was pay for that client's covered hours. Null
-- meant nothing -- "nothing gauranteed for responder" -- and it is kept as a rule
-- that says so, because without it the partner's hourly rule would reach them.
INSERT INTO pay_rule (service_id, role_id, entity_id, pays_for, method, amount, effective_from)
SELECT asv.service_id, (SELECT id FROM role WHERE name = 'Partner'), a.entity_id,
       'time',
       CASE WHEN a.responder_rate IS NULL THEN 'nothing' ELSE 'per_hour' END,
       a.responder_rate, a.starts_on
  FROM agreement a
  JOIN agreement_service asv ON asv.agreement_id = a.id
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- A price counts heads.

ALTER TABLE service_price
  ADD COLUMN additional_rate numeric(12,2) NOT NULL DEFAULT 0
  CONSTRAINT service_price_additional_rate_check CHECK (additional_rate >= 0);
COMMENT ON COLUMN service_price.rate IS
  'The rate for the first person -- per hour, per mile or each, in the service''s unit.';
COMMENT ON COLUMN service_price.additional_rate IS
  'What each additional person adds. Zero prices it per job however many attend; '
  'equal to rate prices it per person; $80 and +$50 is $130 for two.';

-- A one/team pair becomes one row. Anything else a crew-split price could have
-- been -- a team price with no single-person price beside it -- cannot be said in
-- two numbers without guessing, so it stops the migration rather than guessing.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(DISTINCT s.name || ' from ' || sp.effective_from, ', ') INTO bad
    FROM service_price sp JOIN service s ON s.id = sp.service_id
   WHERE sp.crew = 'team'
     AND NOT EXISTS (SELECT 1 FROM service_price one
                      WHERE one.service_id = sp.service_id
                        AND one.entity_id IS NOT DISTINCT FROM sp.entity_id
                        AND one.effective_from = sp.effective_from
                        AND one.crew = 'one');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'a team price has no one-person price beside it: %', bad;
  END IF;

  SELECT string_agg(DISTINCT s.name || ' from ' || sp.effective_from, ', ') INTO bad
    FROM service_price sp JOIN service s ON s.id = sp.service_id
   WHERE sp.crew IS NULL
     AND EXISTS (SELECT 1 FROM service_price other
                  WHERE other.service_id = sp.service_id
                    AND other.entity_id IS NOT DISTINCT FROM sp.entity_id
                    AND other.effective_from = sp.effective_from
                    AND other.crew IS NOT NULL);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'a price for any crew sits beside a crew-specific one on the same day: %', bad;
  END IF;

  SELECT string_agg(DISTINCT s.name || ' from ' || sp.effective_from, ', ') INTO bad
    FROM service_price sp
    JOIN service_price team ON team.service_id = sp.service_id
                           AND team.entity_id IS NOT DISTINCT FROM sp.entity_id
                           AND team.effective_from = sp.effective_from
                           AND team.crew = 'team'
    JOIN service s ON s.id = sp.service_id
   WHERE sp.crew = 'one' AND team.rate < sp.rate;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'a team price is below the one-person price: %', bad;
  END IF;
END $$;

UPDATE service_price one
   SET additional_rate = team.rate - one.rate
  FROM service_price team
 WHERE one.crew = 'one' AND team.crew = 'team'
   AND team.service_id = one.service_id
   AND team.entity_id IS NOT DISTINCT FROM one.entity_id
   AND team.effective_from = one.effective_from;

DELETE FROM service_price WHERE crew = 'team';

ALTER TABLE service_price DROP CONSTRAINT service_price_service_id_entity_id_crew_effective_from_key;
ALTER TABLE service_price DROP COLUMN crew;
ALTER TABLE service_price ADD CONSTRAINT service_price_scope
  UNIQUE NULLS NOT DISTINCT (service_id, entity_id, effective_from);

-- ===========================================================================
-- A service: what it is charged per, how finely, and at least what.

ALTER TABLE service DROP CONSTRAINT service_unit_check;
ALTER TABLE service ADD CONSTRAINT service_unit_check CHECK (unit IN ('hour', 'mile', 'each'));
COMMENT ON COLUMN service.unit IS
  'What a quantity of it is: an hour, a mile, or each -- which is how a service '
  'charges a flat rate.';

ALTER TABLE service ADD COLUMN bill_to_nearest_seconds integer
  CONSTRAINT service_bill_to_nearest_seconds_check CHECK (bill_to_nearest_seconds > 0);
ALTER TABLE service ADD CONSTRAINT service_increment_is_for_time
  CHECK (unit = 'hour' OR bill_to_nearest_seconds IS NULL);
COMMENT ON COLUMN service.bill_to_nearest_seconds IS
  'Time billed to the nearest this many seconds: 60 is the nearest minute, 900 the '
  'nearest quarter hour. Null bills the exact time. Only for a service charged by '
  'the hour. Pay is never rounded this way: it is counted as worked.';
UPDATE service SET bill_to_nearest_seconds = 60 WHERE unit = 'hour';

ALTER TABLE service ADD COLUMN minimum_charge numeric(12,2)
  CONSTRAINT service_minimum_charge_check CHECK (minimum_charge >= 0);
COMMENT ON COLUMN service.minimum_charge IS
  'The least one entry of it bills, whatever its quantity. Null for none.';

-- ===========================================================================
-- A trip leg records the service it bills.

ALTER TABLE trip_leg ADD COLUMN service_id uuid REFERENCES service(id) ON DELETE RESTRICT;
COMMENT ON COLUMN trip_leg.service_id IS
  'What this leg bills as. Until now every screen found it by assuming exactly one '
  'service is charged per mile.';

DO $$
DECLARE
  per_mile integer;
BEGIN
  SELECT count(*) INTO per_mile FROM service WHERE unit = 'mile' AND active;
  IF per_mile = 1 THEN
    UPDATE trip_leg SET service_id = (SELECT id FROM service WHERE unit = 'mile' AND active)
     WHERE entity_id IS NOT NULL;
  ELSIF EXISTS (SELECT 1 FROM trip_leg WHERE entity_id IS NOT NULL) THEN
    RAISE EXCEPTION 'billed trip legs exist, and % active services are charged per mile '
                    '-- which one each leg bills cannot be inferred', per_mile;
  END IF;
END $$;

ALTER TABLE trip_leg ADD CONSTRAINT trip_leg_billed_leg_names_its_service
  CHECK (entity_id IS NULL OR service_id IS NOT NULL);

-- ===========================================================================
-- The old shape goes.

DROP VIEW agreement_period_usage;
DROP VIEW agreement_allotment;

ALTER TABLE agreement DROP CONSTRAINT remote_allotment_matches_the_cap;
ALTER TABLE agreement
  DROP COLUMN remote_allotment,
  DROP COLUMN remote_cap_hours,
  DROP COLUMN allotment_basis,
  DROP COLUMN overage,
  DROP COLUMN responder_rate;

ALTER TABLE service DROP COLUMN delivery;
DROP TABLE person_pay_rate;
ALTER TABLE app_user DROP COLUMN on_team;

-- ===========================================================================
-- Allotments, per covered service.

CREATE VIEW agreement_allotment AS
SELECT asv.agreement_id,
       a.entity_id,
       asv.service_id,
       asv.allotment,
       asv.overage,
       asv.included_hours,
       CASE
         WHEN asv.allotment <> 'capped' THEN NULL::numeric
         WHEN asv.allotment_basis = 'per_location'
           THEN asv.included_hours * (SELECT count(*) FROM agreement_site s
                                       WHERE s.agreement_id = a.id)::numeric
         ELSE asv.included_hours
       END AS pooled_hours
  FROM agreement_service asv
  JOIN agreement a ON a.id = asv.agreement_id;
COMMENT ON VIEW agreement_allotment IS
  'What each agreement includes of each service it covers. Pooled across sites '
  'when the allotment is per location.';

CREATE VIEW agreement_period_usage AS
SELECT p.id AS agreement_period_id,
       p.agreement_id,
       al.service_id,
       p.period_start,
       p.period_end,
       al.allotment,
       al.pooled_hours,
       COALESCE(sum(t.minutes), 0)::numeric / 60.0 AS hours_used,
       CASE
         WHEN al.pooled_hours IS NULL THEN NULL::numeric
         ELSE GREATEST(al.pooled_hours - COALESCE(sum(t.minutes), 0)::numeric / 60.0, 0)
       END AS hours_left
  FROM agreement_period p
  JOIN agreement_allotment al ON al.agreement_id = p.agreement_id
  LEFT JOIN time_entry t ON t.entity_id = al.entity_id
                        AND t.service_id = al.service_id
                        AND t.worked_on BETWEEN p.period_start AND p.period_end
                        AND t.billable
 GROUP BY p.id, p.agreement_id, al.service_id, p.period_start, p.period_end,
          al.allotment, al.pooled_hours;
COMMENT ON VIEW agreement_period_usage IS
  'Hours used and left of each covered service, per billing period. Only time on '
  'the covered service counts -- the agreement names it, so nothing is inferred.';

-- ===========================================================================
-- One source of truth for what a thing costs and what it pays.

CREATE FUNCTION service_price_on(p_service uuid, p_entity uuid, p_day date)
RETURNS service_price LANGUAGE sql STABLE AS $$
  SELECT sp.* FROM service_price sp
   WHERE sp.service_id = p_service
     AND sp.effective_from <= p_day
     AND (sp.entity_id = p_entity OR sp.entity_id IS NULL)
   ORDER BY (sp.entity_id IS NOT NULL) DESC, sp.effective_from DESC
   LIMIT 1
$$;
COMMENT ON FUNCTION service_price_on(uuid, uuid, date) IS
  'The price in force for a service, for a client, on a day: that client''s own '
  'if it has one, then every client''s, the newest that has started. Null when '
  'the service is not priced.';

CREATE FUNCTION job_rate(p_service uuid, p_entity uuid, p_heads integer, p_day date)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT (p.rate + p.additional_rate * GREATEST(p_heads - 1, 0))::numeric(12,2)
    FROM service_price_on(p_service, p_entity, p_day) p
$$;
COMMENT ON FUNCTION job_rate(uuid, uuid, integer, date) IS
  'The rate for the job, per unit, for a crew of p_heads: the first person''s rate '
  'plus the additional rate for each person after.';

CREATE FUNCTION billed_amount(p_service uuid, p_entity uuid, p_heads integer,
                              p_day date, p_quantity numeric)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN r.rate IS NULL THEN NULL
         ELSE GREATEST(
           (r.rate * CASE
              WHEN s.unit = 'hour' AND s.bill_to_nearest_seconds IS NOT NULL
                THEN round(p_quantity * 3600 / s.bill_to_nearest_seconds)
                     * s.bill_to_nearest_seconds / 3600.0
              ELSE p_quantity
            END)::numeric(12,2),
           COALESCE(s.minimum_charge, 0))
         END
    FROM service s
    CROSS JOIN LATERAL (SELECT job_rate(p_service, p_entity, p_heads, p_day) AS rate) r
   WHERE s.id = p_service
$$;
COMMENT ON FUNCTION billed_amount(uuid, uuid, integer, date, numeric) IS
  'What one entry bills: the job rate times the quantity, time rounded to the '
  'service''s increment, and never below its minimum charge. p_quantity is in the '
  'service''s own unit -- hours, miles, or a count.';

CREATE FUNCTION pay_rule_on(p_service uuid, p_user uuid, p_entity uuid,
                            p_pays_for text, p_day date)
RETURNS pay_rule LANGUAGE sql STABLE AS $$
  SELECT pr.* FROM pay_rule pr
   WHERE pr.service_id = p_service
     AND pr.pays_for = p_pays_for
     AND pr.effective_from <= p_day
     AND (pr.entity_id = p_entity OR pr.entity_id IS NULL)
     AND (pr.user_id = p_user
          OR pr.role_id = (SELECT u.role_id FROM app_user u WHERE u.id = p_user))
   ORDER BY (pr.entity_id IS NOT NULL) DESC,
            (pr.user_id IS NOT NULL) DESC,
            pr.effective_from DESC
   LIMIT 1
$$;
COMMENT ON FUNCTION pay_rule_on(uuid, uuid, uuid, text, date) IS
  'The rule that pays this person for this service, for this client, on this day. '
  'A client''s own rule beats every client''s; then a person''s own rule beats '
  'their role''s; then the newest. Null when no rule reaches them.';

CREATE FUNCTION time_pay(p_service uuid, p_user uuid, p_entity uuid, p_day date,
                         p_seconds numeric, p_line numeric)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT CASE r.method
           WHEN 'per_hour' THEN (r.amount * p_seconds / 3600.0)::numeric(12,2)
           WHEN 'percent'  THEN (r.amount / 100.0 * COALESCE(p_line, 0))::numeric(12,2)
           WHEN 'fixed'    THEN r.amount::numeric(12,2)
           WHEN 'nothing'  THEN 0::numeric(12,2)
         END
    FROM pay_rule_on(p_service, p_user, p_entity, 'time', p_day) r
$$;
COMMENT ON FUNCTION time_pay(uuid, uuid, uuid, date, numeric, numeric) IS
  'What one person is paid for their time on one entry: per hour worked, counted '
  'to the second; a percentage of the line; a fixed amount; or nothing. Null when '
  'no rule reaches them.';

CREATE VIEW entry_worth AS
WITH e AS (
  SELECT t.*,
         CASE WHEN t.crew = 'team'
              THEN (SELECT count(*) FROM app_user u WHERE u.active AND u.role_id IS NOT NULL)::integer
              ELSE 1
         END AS heads
    FROM time_entry t
)
SELECT e.id AS time_entry_id,
       e.heads,
       job_rate(e.service_id, e.entity_id, e.heads, e.worked_on) AS rate,
       b.billed,
       (SELECT sum(time_pay(e.service_id, u.id, e.entity_id, e.worked_on,
                            e.minutes * 60, b.billed))
          FROM app_user u
         WHERE (e.crew = 'team' AND u.active AND u.role_id IS NOT NULL)
            OR (e.crew <> 'team' AND u.id = e.worked_by)) AS paid
  FROM e
  CROSS JOIN LATERAL (
    SELECT billed_amount(e.service_id, e.entity_id, e.heads, e.worked_on,
                         e.minutes / 60.0) AS billed) b;
COMMENT ON VIEW entry_worth IS
  'What each time entry bills and pays, from the functions above. A team entry '
  'counts everybody who holds a role as its crew, until entries name who worked.';

CREATE VIEW leg_worth AS
SELECT l.id AS trip_leg_id,
       l.service_id,
       job_rate(l.service_id, l.entity_id, 1, tr.travelled_on) AS rate,
       billed_amount(l.service_id, l.entity_id, 1, tr.travelled_on, l.miles) AS billed
  FROM trip_leg l
  JOIN trip tr ON tr.id = l.trip_id;
COMMENT ON VIEW leg_worth IS
  'What each trip leg bills, at its own service''s price. What it pays waits on '
  'the trip knowing its vehicle: a vehicle rule pays the vehicle''s owner.';

INSERT INTO migration (filename)
VALUES ('0020_a_service_is_configured_not_categorised.sql');

COMMIT;
