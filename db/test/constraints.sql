-- Does the schema hold what docs/decisions.md says it holds?
--
-- Each guard is tested both ways: the thing that must be refused is refused,
-- and the legitimate case beside it still works. A guard that also blocks
-- ordinary use is a bug, not a guard.
--
-- Run:  db/apply.sh --test

\set ON_ERROR_STOP on
SET client_min_messages TO notice;

CREATE FUNCTION must_fail(stmt text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN others THEN
    RAISE NOTICE '  refused   %', label;
    RETURN;
  END;
  RAISE EXCEPTION 'GUARD MISSING: % was allowed', label;
END $$;

CREATE FUNCTION must_pass(stmt text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RAISE NOTICE '  allowed   %', label;
EXCEPTION WHEN others THEN
  RAISE EXCEPTION 'OVER-TIGHT: % was refused (%)', label, SQLERRM;
END $$;

-- ------------------------------------------------------------- fixtures --

INSERT INTO app_user (id, name, email, credential) VALUES
  ('11111111-1111-1111-1111-111111111111','Tyler','t@example.com','x'),
  ('22222222-2222-2222-2222-222222222222','Robin','r@example.com','x');

-- From reference/sites.ods in the vts repo, verified 17 Aug 2026. Business names
-- and addresses only; the contacts on that sheet are people and stay there.
--
-- "Bravo Farms is a client, and the sites are Traver, Kettleman, etc" -- 9 Sep.
-- The FreshBooks names welded the site into the client -- "Bravo Farms
-- (Kettleman)", "The Shoppe at Bravo Farms" -- and that is the thing being
-- undone here. A client is a business; where it is is a location.
--
-- Many-to-many in both directions at once, which is why neither can be assumed:
-- Bravo Farms holds several sites, and 36005 CA-99 N holds both Bravo Farms and
-- Wild Jacks.
-- There is no pool of levies any more. A site carries the rate CDTFA's API
-- returned for its address, and nothing in the schema can author one.


INSERT INTO entity (id, name) VALUES
  ('44444444-4444-4444-4444-444444444444','Bravo Farms'),
  ('44444444-0000-0000-0000-000000000002','Wild Jacks');


INSERT INTO service (id, code, name, unit, delivery, subscription_basis,
                     subscription_hours, subscription_overage, subscription_period)
VALUES
  ('55555555-5555-5555-5555-555555555555','onsite','On-site work','hour','on_site',
   'none',NULL,NULL,NULL),
  ('55555555-5555-5555-5555-555555555556','remote','Remote support','hour','remote',
   'capped',2.00,'bill','month'),
  ('55555555-5555-5555-5555-555555555557','mileage','Mileage','mile',NULL,
   'none',NULL,NULL,NULL);

INSERT INTO material (id, name, unit) VALUES
  ('66666666-6666-6666-6666-666666666666','Cable - Cat6 - Riser','foot');

INSERT INTO invoice (id, number, entity_id, created_by) VALUES
  ('77777777-7777-7777-7777-777777777777','0000053',
   '44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111');

-- Sites, not locations. Bravo and Wild Jacks both work at 36005 CA-99 N and
-- each has its own site there: different names, different contacts, and
-- neither has to know the other exists.
-- Every site carries a CDTFA answer, because the schema has no other kind.
INSERT INTO site (id, entity_id, label, street, city, region, postcode,
                  tax_jurisdiction, tax_rate_pct, state_rate_pct, district_rate_pct,
                  tax_area_code, area_verified_on,
                  round_trip_miles, drive_minutes) VALUES
  ('cccccccc-0000-0000-0000-000000000001','44444444-4444-4444-4444-444444444444',
   'The Shoppe','36005 CA-99 N','Traver','CA','93673',
   'UNINCORPORATED AREA-TULARE', 7.7500, 7.2500, 0.5000, '549981620000', current_date, 52, 62),
  ('cccccccc-0000-0000-0000-00000000000b','44444444-0000-0000-0000-000000000002',
   'Traver','36005 CA-99 N','Traver','CA','93673',
   'UNINCORPORATED AREA-TULARE', 7.7500, 7.2500, 0.5000, '549981620000', current_date, 52, 62),
  ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
   'Kettleman','33341 Bernard Dr','Kettleman City','CA','93239',
   'UNINCORPORATED AREA-KINGS', 7.2500, 7.2500, 0.0000, '169980000000', current_date, 72, 78),
  ('cccccccc-0000-0000-0000-00000000000a','44444444-0000-0000-0000-000000000002',
   'Kettleman','33300 Bernard Dr','Kettleman City','CA','93239',
   'UNINCORPORATED AREA-KINGS', 7.2500, 7.2500, 0.0000, '169980000000', current_date, 72, 78);


\echo ''
\echo '=== 1. an entry cannot arrive twice from a retry ==='

SELECT must_pass($$
  INSERT INTO time_entry (client_uuid, worked_on, minutes, crew, worked_by, created_by,
                          entity_id, site_id, service_id)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001','2026-08-17',271,'one',
          '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111',
          '44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',
          '55555555-5555-5555-5555-555555555555')
$$, 'an entry posts');

SELECT must_fail($$
  INSERT INTO time_entry (client_uuid, worked_on, minutes, crew, worked_by, created_by,
                          entity_id, site_id, service_id)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001','2026-08-17',271,'one',
          '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111',
          '44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',
          '55555555-5555-5555-5555-555555555555')
$$, 'the same entry retried after a timeout');

\echo ''
\echo '=== 2. he creates or i do ==='

SELECT must_pass($$
  INSERT INTO time_entry (client_uuid, worked_on, minutes, crew, worked_by, created_by,
                          entity_id, site_id, service_id)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000002','2026-08-28',165,'one',
          '22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',
          '44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',
          '55555555-5555-5555-5555-555555555555')
$$, 'Robin worked it, Tyler typed it');

SELECT must_pass($$
  INSERT INTO time_entry (client_uuid, worked_on, minutes, crew, worked_by, created_by,
                          service_id, billable)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000003','2026-08-31',89,'one',
          '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111',
          '55555555-5555-5555-5555-555555555555', false)
$$, 'non-billable time with no client');

SELECT must_fail($$
  INSERT INTO time_entry (client_uuid, worked_on, minutes, crew, worked_by, created_by,
                          service_id, billable)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000004','2026-08-31',89,'one',
          '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111',
          '55555555-5555-5555-5555-555555555555', true)
$$, 'billable time with nobody to bill');

\echo ''
\echo '=== 3. an exemption without its certificate ==='

SELECT must_fail($$
  UPDATE entity SET tax_exempt = true WHERE id = '44444444-4444-4444-4444-444444444444'
$$, 'exempt with no certificate on file');

SELECT must_pass($$
  UPDATE entity SET tax_exempt = true, exemption_certificate = 'SR-KH-123-4567'
   WHERE id = '44444444-4444-4444-4444-444444444444'
$$, 'exempt with a certificate');

SELECT must_pass($$
  UPDATE entity SET tax_exempt = false, exemption_certificate = NULL
   WHERE id = '44444444-4444-4444-4444-444444444444'
$$, 'exemption removed again');

\echo ''
\echo '=== 4. a rate override must say why ==='

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price,
                            taxable, tax_rate_pct, tax_source, amount)
  VALUES ('77777777-7777-7777-7777-777777777777',1,'material','Cable',230,0.24,
          true, 8.0450, 'override', 55.20)
$$, 'an 8.045% override with no reason');

SELECT must_pass($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price,
                            taxable, tax_rate_pct, tax_source, tax_override_reason, amount)
  VALUES ('77777777-7777-7777-7777-777777777777',1,'material','Cable',230,0.24,
          true, 8.2500, 'override', 'Madera jobsite, location not yet on file', 55.20)
$$, 'the same override, explained');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price,
                            taxable, tax_rate_pct, tax_source, amount)
  VALUES ('77777777-7777-7777-7777-777777777777',2,'service','Labour',4.5167,50,
          false, 7.2500, 'site', 225.84)
$$, 'tax on a line marked untaxable');

\echo ''
\echo '=== 5. a line points at one source, or none ==='

INSERT INTO trip (id, travelled_on, driven_by, created_by)
VALUES ('88888888-8888-8888-8888-888888888888','2026-08-17',
        '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111');
INSERT INTO trip_leg (id, trip_id, seq, miles, entity_id)
VALUES ('99999999-9999-9999-9999-999999999999','88888888-8888-8888-8888-888888888888',
        1, 36, '44444444-4444-4444-4444-444444444444');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            time_entry_id, trip_leg_id)
  VALUES ('77777777-7777-7777-7777-777777777777',3,'service','Two sources',1,1,1,
          (SELECT id FROM time_entry WHERE client_uuid='aaaaaaaa-0000-0000-0000-000000000001'),
          '99999999-9999-9999-9999-999999999999')
$$, 'a line claiming both a time entry and a trip leg');

SELECT must_pass($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount, trip_leg_id)
  VALUES ('77777777-7777-7777-7777-777777777777',3,'service','Mileage',36,0.72,25.92,
          '99999999-9999-9999-9999-999999999999')
$$, 'a line from one trip leg');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount, trip_leg_id)
  VALUES ('77777777-7777-7777-7777-777777777777',4,'service','Same leg again',36,0.72,25.92,
          '99999999-9999-9999-9999-999999999999')
$$, 'the same leg billed twice');

\echo ''
\echo '=== 6. a sent invoice is immutable ==='

SELECT must_pass($$
  UPDATE invoice_line SET amount = 25.93
   WHERE invoice_id = '77777777-7777-7777-7777-777777777777' AND seq = 3
$$, 'editing a line while it is still a draft');

UPDATE invoice SET status='sent', issued_on='2026-09-04', due_on='2026-09-18', sent_at=now()
 WHERE id = '77777777-7777-7777-7777-777777777777';

SELECT must_fail($$
  UPDATE invoice_line SET amount = 99.99
   WHERE invoice_id = '77777777-7777-7777-7777-777777777777' AND seq = 3
$$, 'editing a line after it has gone out');

SELECT must_fail($$
  DELETE FROM invoice_line
   WHERE invoice_id = '77777777-7777-7777-7777-777777777777' AND seq = 3
$$, 'deleting a line after it has gone out');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount)
  VALUES ('77777777-7777-7777-7777-777777777777',9,'service','Added later',1,1,1)
$$, 'adding a line after it has gone out');

SELECT must_fail($$
  UPDATE invoice SET due_on = '2027-01-01'
   WHERE id = '77777777-7777-7777-7777-777777777777'
$$, 'changing the due date of a sent invoice');

SELECT must_pass($$
  UPDATE invoice SET status = 'paid' WHERE id = '77777777-7777-7777-7777-777777777777'
$$, 'marking a sent invoice paid');

SELECT must_fail($$
  UPDATE invoice SET status = 'void' WHERE id = '77777777-7777-7777-7777-777777777777'
$$, 'voiding without a reason');

\echo ''
\echo '=== 7. stock cannot be used before it arrives ==='

SELECT must_pass($$
  INSERT INTO material_lot (material_id, received_on, qty_received, qty_remaining,
                            ex_tax_cost_per_unit, tax_paid_per_unit)
  VALUES ('66666666-6666-6666-6666-666666666666','2026-07-01',1000,770,0.2000,0.0159)
$$, 'a lot with 230 ft drawn from it');

SELECT must_fail($$
  INSERT INTO material_lot (material_id, received_on, qty_received, qty_remaining,
                            ex_tax_cost_per_unit, tax_paid_per_unit)
  VALUES ('66666666-6666-6666-6666-666666666666','2026-07-01',1000,1200,0.2000,0.0159)
$$, 'a lot with more left than ever arrived');

\echo ''
\echo '=== 8. a rate is CDTFA''s answer, not ours ==='

-- Nothing in the schema can author a rate any more: the tables that held one
-- are gone, and a site carries only what the API returned.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name IN ('tax','tax_rate','site_tax','entity_tax');
  IF n <> 0 THEN
    RAISE EXCEPTION 'GUARD MISSING: % table(s) of app-managed rates survive', n;
  END IF;
  RAISE NOTICE '  no pool   nothing in the schema can author a tax rate';
END $$;

-- A negative rate is not an answer CDTFA can give.
SELECT must_fail($$
  UPDATE site SET tax_rate_pct = -1
   WHERE id = '33333333-3333-3333-3333-333333333333'
$$, 'a rate below zero');

\echo '=== 9. two "any entity" prices cannot both be true ==='

SELECT must_pass($$
  INSERT INTO service_price (service_id, crew, rate, effective_from)
  VALUES ('55555555-5555-5555-5555-555555555555','one',80,'2026-09-02')
$$, 'on site, one person, $80.00');

SELECT must_pass($$
  INSERT INTO service_price (service_id, crew, rate, effective_from)
  VALUES ('55555555-5555-5555-5555-555555555555','team',130,'2026-09-02')
$$, 'on site, the team, $130.00');

SELECT must_fail($$
  INSERT INTO service_price (service_id, crew, rate, effective_from)
  VALUES ('55555555-5555-5555-5555-555555555555','one',95,'2026-09-02')
$$, 'a second price for the same service, crew and day');

\echo ''
\echo '=== 10. history records who changed what ==='

SELECT set_config('reckon.user_id','22222222-2222-2222-2222-222222222222',false);
UPDATE entity SET name = 'Bravo Farms - renamed'
 WHERE id = '44444444-4444-4444-4444-444444444444';

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM record_history
   WHERE table_name='entity' AND field='name' ORDER BY changed_at DESC LIMIT 1;
  IF r IS NULL THEN RAISE EXCEPTION 'GUARD MISSING: the rename was not recorded'; END IF;
  IF r.changed_by <> '22222222-2222-2222-2222-222222222222' THEN
    RAISE EXCEPTION 'GUARD MISSING: recorded against the wrong user';
  END IF;
  RAISE NOTICE '  recorded  "%" -> "%" by Robin', r.old_value, r.new_value;
END $$;

\echo ''
\echo '=== 11. remote support: unlimited, included, or nothing ==='

INSERT INTO operator (trading_name, tax_rule_set)
VALUES ('Vigario Technology Solutions','us_ca');

-- What is paid to whoever answers is a dated pay row for the remote service,
-- not a column on the business.
INSERT INTO person_pay_rate (service_id, rate, effective_from)
VALUES ('55555555-5555-5555-5555-555555555556', 25.00, '2026-09-01');

-- Bravo: two subscriptions, one per main site, $400 a month, unlimited.
INSERT INTO agreement (id, entity_id, basis, price, remote_allotment,
                       remote_cap_hours, responder_rate, starts_on)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001','44444444-4444-4444-4444-444444444444',
        'per_location', 200.00, 'unlimited', NULL, NULL, '2026-09-01');
INSERT INTO agreement_site (agreement_id, site_id) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333'),
  ('bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001');

-- Wild Jacks: no subscription.
INSERT INTO entity (id, name) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000002','Wild Jacks (no subscription)');

DO $$
DECLARE pool numeric; ovr text; pay numeric; n int;
BEGIN
  SELECT pooled_hours, overage INTO pool, ovr FROM agreement_allotment
   WHERE entity_id = '44444444-4444-4444-4444-444444444444';
  SELECT responder_rate INTO pay FROM agreement
   WHERE entity_id = '44444444-4444-4444-4444-444444444444';
  SELECT count(*) INTO n FROM agreement
   WHERE entity_id = 'bbbbbbbb-0000-0000-0000-000000000002';

  IF pool IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD MISSING: Bravo is unlimited, got %', pool;
  END IF;
  IF pay IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD MISSING: a Bravo call carries no guaranteed payment, got %', pay;
  END IF;
  IF n <> 0 THEN
    RAISE EXCEPTION 'GUARD MISSING: Wild Jacks should hold no subscription';
  END IF;

  RAISE NOTICE '  unlimited Bravo: two subscriptions, $400/mo, overage %, no responder pay', ovr;
  RAISE NOTICE '  none      Wild Jacks: no subscription, so nothing included';
END $$;

-- A subscriber on the two-hour default, to exercise the multiply.
INSERT INTO entity (id, name) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000003','A subscriber on the default');
INSERT INTO site (id, entity_id, label, street, city, region, postcode,
                  tax_jurisdiction, tax_rate_pct, state_rate_pct, district_rate_pct,
                  tax_area_code, area_verified_on) VALUES
  ('cccccccc-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000003','Site one',
   '1 First St','Hanford','CA','93230',
   'UNINCORPORATED AREA-KINGS', 7.2500, 7.2500, 0.0000, '169980000000', current_date),
  ('cccccccc-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000003','Site two',
   '2 Second St','Hanford','CA','93230',
   'UNINCORPORATED AREA-KINGS', 7.2500, 7.2500, 0.0000, '169980000000', current_date);
INSERT INTO agreement (id, entity_id, basis, price, remote_allotment,
                       remote_cap_hours, responder_rate, starts_on)
VALUES ('bbbbbbbb-0000-0000-0000-000000000004','bbbbbbbb-0000-0000-0000-000000000003',
        'per_location', 200.00, 'capped', 2.00, 25.00, '2026-09-01');
INSERT INTO agreement_site (agreement_id, site_id) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000004','cccccccc-0000-0000-0000-000000000002');

DO $$
DECLARE pool numeric;
BEGIN
  SELECT pooled_hours INTO pool FROM agreement_allotment
   WHERE agreement_id = 'bbbbbbbb-0000-0000-0000-000000000004';
  IF pool <> 2.00 THEN
    RAISE EXCEPTION 'GUARD MISSING: one site on the default should be 2.00, got %', pool;
  END IF;
  RAISE NOTICE '  pooled    one site on the default = 2.00 h';
END $$;

INSERT INTO agreement_site (agreement_id, site_id) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000004','cccccccc-0000-0000-0000-000000000003');

DO $$
DECLARE pool numeric;
BEGIN
  SELECT pooled_hours INTO pool FROM agreement_allotment
   WHERE agreement_id = 'bbbbbbbb-0000-0000-0000-000000000004';
  IF pool <> 4.00 THEN
    RAISE EXCEPTION 'GUARD MISSING: a second site should make it 4.00, got %', pool;
  END IF;
  RAISE NOTICE '  follows   a second site takes the pool to 4.00 h on its own';
END $$;

SELECT must_fail($$
  UPDATE agreement SET overage = 'absorb'
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000004'
$$, 'an overage rule nobody named');

SELECT must_pass($$
  UPDATE agreement SET overage = 'deny'
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000004'
$$, 'overage set to deny work');

SELECT must_pass($$
  UPDATE agreement SET overage = 'no_charge'
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000004'
$$, 'overage set to no charge');

-- "bill per minute at the going rate" -- the rate does not change past the
-- allotment, so nothing here stores a different one.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_name = 'agreement_period'
     AND column_name IN ('overage_amount','overage_rate','overage_hours');
  IF n > 0 THEN
    RAISE EXCEPTION 'GUARD MISSING: an overage amount exists -- the rate does not change';
  END IF;
  RAISE NOTICE '  absent    no overage amount; the rate does not change';
END $$;

\echo ''
\echo '=== 12. remoteness is the service, not a checkbox ==='

SELECT must_fail($$
  INSERT INTO service (code, name, unit, delivery)
  VALUES ('bad','Something','hour','wherever')
$$, 'a delivery nobody named');

SELECT must_pass($$
  INSERT INTO service (code, name, unit, delivery)
  VALUES ('emergency','Emergency attendance','hour','on_site')
$$, 'a service that says how it is delivered');

SELECT must_pass($$
  INSERT INTO service (code, name, unit, delivery)
  VALUES ('travel','Travel time','mile',NULL)
$$, 'a service that is not attendance at all');

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE (table_name='time_entry' AND column_name='remote')
      OR (table_name='service'    AND column_name='counts_against_cap');
  IF n > 0 THEN
    RAISE EXCEPTION 'GUARD MISSING: remoteness is recorded in two places again';
  END IF;
  RAISE NOTICE '  absent    no time_entry.remote, no service.counts_against_cap';
END $$;

DO $$
DECLARE r text;
BEGIN
  SELECT string_agg(name || ' → ' || coalesce(delivery,'—'), ', ' ORDER BY name)
    INTO r FROM service WHERE code IN ('onsite','remote','mileage');
  RAISE NOTICE '  derived   %', r;
END $$;

\echo ''
\echo '=== 13. a team entry is one entry, and names nobody ==='

SELECT must_pass($$
  INSERT INTO time_entry (client_uuid, worked_on, minutes, crew, worked_by, created_by,
                          entity_id, site_id, service_id)
  VALUES ('dddddddd-0000-0000-0000-000000000001','2026-09-09',165,'team',NULL,
          '11111111-1111-1111-1111-111111111111',
          '44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',
          '55555555-5555-5555-5555-555555555555')
$$, 'a team entry, worked_by left empty');

SELECT must_fail($$
  INSERT INTO time_entry (client_uuid, worked_on, minutes, crew, worked_by, created_by,
                          entity_id, site_id, service_id)
  VALUES ('dddddddd-0000-0000-0000-000000000002','2026-09-09',165,'team',
          '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111',
          '44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',
          '55555555-5555-5555-5555-555555555555')
$$, 'a team entry naming one person');

SELECT must_fail($$
  INSERT INTO time_entry (client_uuid, worked_on, minutes, crew, worked_by, created_by,
                          entity_id, site_id, service_id)
  VALUES ('dddddddd-0000-0000-0000-000000000003','2026-09-09',165,'one',NULL,
          '11111111-1111-1111-1111-111111111111',
          '44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',
          '55555555-5555-5555-5555-555555555555')
$$, 'a solo entry naming nobody');

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_name='time_entry' AND column_name='crew_group';
  IF n > 0 THEN RAISE EXCEPTION 'GUARD MISSING: crew_group is back'; END IF;
  RAISE NOTICE '  absent    no crew_group; one entry, not two';
END $$;

\echo ''
\echo '=== 14. every price has one home ==='

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE (table_name='operator'        AND column_name='mileage_rate')
      OR (table_name='person_pay_rate' AND column_name='crew')
      OR (table_name='agreement_period' AND column_name='remote_hours_used')
      OR (table_name='operator'        AND column_name IN ('default_subscription_hours',
                                                           'default_responder_rate',
                                                           'default_overage'));
  IF n > 0 THEN
    RAISE EXCEPTION 'GUARD MISSING: a price or a counter has two homes again';
  END IF;
  RAISE NOTICE '  absent    no operator.mileage_rate, no pay-rate crew split, no stored counter';
  RAISE NOTICE '  absent    and no subscription terms on the business';
END $$;

SELECT must_pass($$
  INSERT INTO service (id, code, name, unit, delivery)
  VALUES ('55555555-5555-5555-5555-55555555555a','miles','Mileage','mile',NULL)
$$, 'mileage is a service');

SELECT must_pass($$
  INSERT INTO service_price (service_id, rate, effective_from)
  VALUES ('55555555-5555-5555-5555-55555555555a',0.72,'2026-01-01')
$$, 'and $0.72 a mile is a dated price row');

SELECT must_pass($$
  INSERT INTO material (name, unit, markup_pct) VALUES ('Cable off the default','foot',NULL)
$$, 'a material with no markup takes the operator default');

SELECT must_pass($$
  INSERT INTO material (name, unit, markup_pct) VALUES ('Cable with its own','foot',35)
$$, 'and one item may override it');

-- The allotment need not follow how the money is charged.
DO $$
DECLARE flat numeric; per numeric;
BEGIN
  UPDATE agreement SET allotment_basis = 'flat'
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000004';
  SELECT pooled_hours INTO flat FROM agreement_allotment
   WHERE agreement_id = 'bbbbbbbb-0000-0000-0000-000000000004';

  UPDATE agreement SET allotment_basis = 'per_location'
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000004';
  SELECT pooled_hours INTO per FROM agreement_allotment
   WHERE agreement_id = 'bbbbbbbb-0000-0000-0000-000000000004';

  IF flat <> 2.00 OR per <> 4.00 THEN
    RAISE EXCEPTION 'GUARD MISSING: allotment basis ignored (flat %, per_location %)', flat, per;
  END IF;
  RAISE NOTICE '  granted   two sites: flat 2.00 h, per_location 4.00 h -- charged per site either way';
END $$;

-- Hours used are derived from the entries that drew them, not a counter.
INSERT INTO agreement_period (agreement_id, period_start, period_end, amount)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001','2026-09-01','2026-09-30',400.00);

INSERT INTO time_entry (client_uuid, worked_on, minutes, crew, worked_by, created_by,
                        entity_id, service_id)
VALUES ('dddddddd-0000-0000-0000-000000000004','2026-09-09',90,'one',
        '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111',
        '44444444-4444-4444-4444-444444444444','55555555-5555-5555-5555-555555555556');

DO $$
DECLARE used numeric;
BEGIN
  SELECT hours_used INTO used FROM agreement_period_usage
   WHERE agreement_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  IF used <> 1.5 THEN
    RAISE EXCEPTION 'GUARD MISSING: 90 remote minutes should read 1.5 hours, got %', used;
  END IF;
  RAISE NOTICE '  derived   90 remote minutes read as 1.50 hours used, from the entry itself';
END $$;

\echo ''
\echo '=== 15. a timer is not the same question as a charge ==='

DO $$
DECLARE r text;
BEGIN
  SELECT string_agg(name || ' (' || unit || ') ' ||
                    CASE WHEN time_tracked THEN 'timed' ELSE 'not timed' END, ', ' ORDER BY name)
    INTO r FROM service WHERE code IN ('onsite','remote','miles');
  RAISE NOTICE '  default   %', r;
END $$;

SELECT must_pass($$
  UPDATE service SET time_tracked = true WHERE code = 'miles'
$$, 'mileage may be timed while still charged per mile');

DO $$
DECLARE u text; t boolean;
BEGIN
  SELECT unit, time_tracked INTO u, t FROM service WHERE code = 'miles';
  IF u IS DISTINCT FROM 'mile' OR t IS NOT TRUE THEN
    RAISE EXCEPTION 'GUARD MISSING: timing a service changed how it is charged (% / %)', u, t;
  END IF;
  RAISE NOTICE '  separate  still charged per mile, now on the timer';
END $$;

SELECT must_pass($$
  UPDATE service SET time_tracked = false WHERE code = 'miles'
$$, 'and off the timer again without touching the charge');

\echo ''
\echo '=== 16. a line says what it counts, and keeps saying it ==='

-- Its own draft invoice. Guard 6 sent the other one, and a sent line refuses
-- every UPDATE -- which would have made the vocabulary look enforced when it
-- was only frozen.
INSERT INTO invoice (id, number, entity_id, created_by) VALUES
  ('7777aaaa-7777-7777-7777-777777777777','VTS-0099',
   '44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111');
INSERT INTO invoice_line (id, invoice_id, seq, kind, description, qty, unit_price, unit, amount)
  VALUES ('7777bbbb-7777-7777-7777-777777777777','7777aaaa-7777-7777-7777-777777777777',
          1,'service','Mileage, Traver',41.20,0.72,'mile',29.66);

SELECT must_fail($$
  UPDATE invoice_line SET unit = 'furlong' WHERE id = '7777bbbb-7777-7777-7777-777777777777'
$$, 'a unit outside the vocabulary');

SELECT must_pass($$
  UPDATE invoice_line SET unit = NULL WHERE id = '7777bbbb-7777-7777-7777-777777777777'
$$, 'no unit, for a flat charge that counts nothing');

-- Stored, not derived: moving the service must not restate an issued line.
DO $$
DECLARE u text;
BEGIN
  UPDATE invoice_line SET unit = 'mile' WHERE id = '7777bbbb-7777-7777-7777-777777777777';
  UPDATE service SET unit = 'hour' WHERE code = 'miles';
  SELECT unit INTO u FROM invoice_line WHERE id = '7777bbbb-7777-7777-7777-777777777777';
  IF u <> 'mile' THEN
    RAISE EXCEPTION 'GUARD MISSING: the line followed the service to %', u;
  END IF;
  RAISE NOTICE '  stored    service moved to hour, the billed line still reads mile';
  UPDATE service SET unit = 'mile' WHERE code = 'miles';
END $$;

-- And once sent, it cannot move at all.
UPDATE invoice SET status='sent', issued_on='2026-09-09', due_on='2026-09-23', sent_at=now()
 WHERE id = '7777aaaa-7777-7777-7777-777777777777';

SELECT must_fail($$
  UPDATE invoice_line SET unit = 'hour' WHERE id = '7777bbbb-7777-7777-7777-777777777777'
$$, 'restating the unit on a sent line');

\echo ''
\echo '=== 17. a client is a business, a site is a place ==='

-- One address, two clients, two sites. Not one row with two labels: they have
-- different names, different contacts, and neither knows the other exists.
DO $$
DECLARE r text; k text;
BEGIN
  SELECT string_agg(e.name || ' calls it ' || s.label, ', ' ORDER BY e.name) INTO r
    FROM site s JOIN entity e ON e.id = s.entity_id
   WHERE s.street = '36005 CA-99 N';
  SELECT string_agg(s.label, ', ' ORDER BY s.label) INTO k
    FROM site s WHERE s.entity_id = '44444444-4444-4444-4444-444444444444';
  IF r IS NULL OR position(',' in r) = 0 THEN
    RAISE EXCEPTION 'GUARD MISSING: one address should hold two sites, got %', r;
  END IF;
  RAISE NOTICE '  two sites 36005 CA-99 N: %', r;
  RAISE NOTICE '  one client Bravo Farms works at: %', k;
END $$;

-- A site is its client's. Pointing a time entry at another client's site is
-- the mistake the shared row made possible.
SELECT must_fail($$
  INSERT INTO time_entry (client_uuid, worked_on, minutes, crew, worked_by, created_by,
                          entity_id, site_id, service_id)
  VALUES (gen_random_uuid(), current_date, 30, 'one',
          '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111',
          '44444444-4444-4444-4444-444444444444','cccccccc-0000-0000-0000-00000000000b',
          '55555555-5555-5555-5555-555555555555')
$$, 'billing one client for work at another client''s site');

-- Invoice 0000035: Traver work billed to Wild Jacks at 7.750%, not 7.250%.
-- Under the shared-address shape this needed a client pointed at somebody
-- else's row. Wild Jacks has its own Traver site now, so it is simply an
-- entry against it -- the awkward case stopped being a case.
SELECT must_pass($$
  INSERT INTO time_entry (client_uuid, worked_on, minutes, crew, worked_by, created_by,
                          entity_id, site_id, service_id)
  VALUES (gen_random_uuid(),'2026-09-09',60,'one',
          '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111',
          '44444444-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-00000000000b',
          '55555555-5555-5555-5555-555555555555')
$$, 'invoice 0000035, an entry against Wild Jacks'' own Traver site');

SELECT must_pass($$
  INSERT INTO trip_leg (trip_id, seq, miles, entity_id, site_id)
  VALUES ((SELECT id FROM trip LIMIT 1),98,52.0,
          '44444444-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-00000000000b')
$$, 'and the miles that got there');

SELECT must_fail($$
  INSERT INTO trip_leg (trip_id, seq, miles, entity_id, site_id)
  VALUES ((SELECT id FROM trip LIMIT 1),97,52.0,
          '44444444-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000001')
$$, 'charging one client for miles to another client''s site');

-- This assertion used to run the other way: it required that NOTHING confine a
-- client to its own sites, because 0007 tried it and 0008 undid it when a real
-- invoice crossed the boundary. That boundary existed only because one address
-- was one row shared between clients. Sites are the client's now, so the
-- constraint is not over-tight -- it is the model -- and the guard asserts its
-- presence rather than its absence.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conname IN ('time_entry_site_is_the_clients',
                     'trip_leg_site_is_the_clients');
  IF n <> 2 THEN
    RAISE EXCEPTION 'GUARD MISSING: only % of 2 constraints confine a site to its client', n;
  END IF;
  RAISE NOTICE '  present   a site is its client''s, and the database refuses otherwise';
END $$;

\echo ''
\echo '=== 18. a client names and staffs its own sites ==='

INSERT INTO contact (id, name) VALUES
  ('99999999-0000-0000-0000-000000000001','Kristyn'),
  ('99999999-0000-0000-0000-000000000002','Michelle'),
  ('99999999-0000-0000-0000-000000000003','Uriel');

INSERT INTO entity_contact (entity_id, contact_id, is_primary) VALUES
  ('44444444-4444-4444-4444-444444444444','99999999-0000-0000-0000-000000000001',true),
  ('44444444-0000-0000-0000-000000000002','99999999-0000-0000-0000-000000000003',true);

SELECT must_fail($$
  INSERT INTO entity_contact (entity_id, contact_id, is_primary)
  VALUES ('44444444-4444-4444-4444-444444444444','99999999-0000-0000-0000-000000000002',true)
$$, 'a second primary contact for one client');

SELECT must_pass($$
  INSERT INTO entity_contact (entity_id, contact_id, is_primary)
  VALUES ('44444444-4444-4444-4444-444444444444','99999999-0000-0000-0000-000000000002',false)
$$, 'a second contact that is not the primary');

-- Michelle runs Kettleman; Traver has nobody of its own and falls back.
INSERT INTO site_contact (site_id, entity_id, contact_id, is_primary) VALUES
  ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
   '99999999-0000-0000-0000-000000000002', true);

DO $$
DECLARE r text;
BEGIN
  -- A site may name its own contact; otherwise the client's primary answers.
  SELECT string_agg(s.label || ' -> ' || c.name ||
                    CASE WHEN own.id IS NOT NULL THEN '' ELSE ' (client)' END,
                    ' | ' ORDER BY s.label)
    INTO r
    FROM site s
    LEFT JOIN LATERAL (
           SELECT c2.* FROM site_contact sc JOIN contact c2 ON c2.id = sc.contact_id
            WHERE sc.site_id = s.id AND sc.is_primary LIMIT 1) own ON true
    LEFT JOIN LATERAL (
           SELECT c2.* FROM entity_contact ec JOIN contact c2 ON c2.id = ec.contact_id
            WHERE ec.entity_id = s.entity_id AND ec.is_primary LIMIT 1) fallback ON true
    JOIN contact c ON c.id = COALESCE(own.id, fallback.id)
   WHERE s.entity_id = '44444444-4444-4444-4444-444444444444';
  IF r IS DISTINCT FROM 'Kettleman -> Michelle | The Shoppe -> Kristyn (client)' THEN
    RAISE EXCEPTION 'GUARD MISSING: the fallback resolved to %', r;
  END IF;
  RAISE NOTICE '  resolved  Bravo Farms: %', r;
END $$;

-- A SITE MAY NAME SEVERAL PEOPLE, and one of them first. The column this
-- replaced could hold the manager or whoever opens up, never both.
SELECT must_pass($$
  INSERT INTO site_contact (site_id, entity_id, contact_id)
  VALUES ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
          '99999999-0000-0000-0000-000000000001')
$$, 'a second person at one site');

SELECT must_fail($$
  INSERT INTO site_contact (site_id, entity_id, contact_id, is_primary)
  VALUES ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
          '99999999-0000-0000-0000-000000000001', true)
$$, 'a second person answering first at one site');

-- AND THE PERSON MUST BE THAT CLIENT'S. Uriel is Wild Jacks' contact; naming
-- him at a Bravo site is a typo that sends Bravo's work to the wrong person.
SELECT must_fail($$
  INSERT INTO site_contact (site_id, entity_id, contact_id)
  VALUES ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
          '99999999-0000-0000-0000-000000000003')
$$, 'naming another client''s contact at a site');

-- Nor can the client be misstated to get around it: the site half of the key
-- has to agree too.
SELECT must_fail($$
  INSERT INTO site_contact (site_id, entity_id, contact_id)
  VALUES ('33333333-3333-3333-3333-333333333333','44444444-0000-0000-0000-000000000002',
          '99999999-0000-0000-0000-000000000003')
$$, 'a site filed under a client that is not its own');

-- Same building, other client: the contact is not the address's.
DO $$
DECLARE r text;
BEGIN
  INSERT INTO site_contact (site_id, entity_id, contact_id, is_primary)
  VALUES ('cccccccc-0000-0000-0000-00000000000b','44444444-0000-0000-0000-000000000002',
          '99999999-0000-0000-0000-000000000003', true);
  SELECT c.name INTO r
    FROM site_contact sc JOIN contact c ON c.id = sc.contact_id
   WHERE sc.site_id = 'cccccccc-0000-0000-0000-00000000000b';
  IF r <> 'Uriel' THEN
    RAISE EXCEPTION 'GUARD MISSING: Wild Jacks'' Traver gave %', r;
  END IF;
  RAISE NOTICE '  separate  one address: Kristyn for Bravo Farms, Uriel for Wild Jacks';
END $$;

-- A person is still one person. Uriel is named at Wild Jacks' Traver and is
-- the contact for other clients too -- that is the whole reason contact has no
-- owner.
DO $$
DECLARE n int;
BEGIN
  INSERT INTO entity_contact (entity_id, contact_id)
  VALUES ('44444444-4444-4444-4444-444444444444','99999999-0000-0000-0000-000000000003');
  SELECT count(*) INTO n FROM entity_contact
   WHERE contact_id = '99999999-0000-0000-0000-000000000003';
  IF n <> 2 THEN
    RAISE EXCEPTION 'GUARD MISSING: one person reached % clients, not 2', n;
  END IF;
  RAISE NOTICE '  one person       Uriel is the contact for % clients at once', n;
END $$;

-- Taking somebody off a client takes them off that client's sites with them.
DO $$
DECLARE n int;
BEGIN
  DELETE FROM entity_contact
   WHERE entity_id = '44444444-0000-0000-0000-000000000002'
     AND contact_id = '99999999-0000-0000-0000-000000000003';
  SELECT count(*) INTO n FROM site_contact
   WHERE site_id = 'cccccccc-0000-0000-0000-00000000000b';
  IF n <> 0 THEN
    RAISE EXCEPTION 'GUARD MISSING: % site rows outlived the client attachment', n;
  END IF;
  RAISE NOTICE '  follows          off the client is off the client''s sites';
END $$;

-- One address, two clients, each naming it for themselves.
DO $$
DECLARE b text; w text; n int;
BEGIN
  SELECT label INTO b FROM site WHERE id = 'cccccccc-0000-0000-0000-000000000001';
  SELECT label INTO w FROM site WHERE id = 'cccccccc-0000-0000-0000-00000000000b';
  IF b <> 'The Shoppe' OR w <> 'Traver' THEN
    RAISE EXCEPTION 'GUARD MISSING: one address gave % and %', b, w;
  END IF;
  SELECT count(*) INTO n FROM site_rate
   WHERE site_id = 'cccccccc-0000-0000-0000-000000000001';
  IF n > 1 THEN
    RAISE EXCEPTION 'GUARD MISSING: one site resolved to % rates', n;
  END IF;
  RAISE NOTICE '  named     36005 CA-99 N is "%" to Bravo Farms and "%" to Wild Jacks', b, w;
  RAISE NOTICE '  one rate  and each draws the same levies, so both charge alike';
END $$;

\echo ''
\echo '=== 19. the rate is CDTFA''s, per address, and it goes stale ==='

-- THERE IS NO SUCH THING AS AN UNPRICED SITE. A site is a place work is
-- billed from, and a place that cannot be priced cannot be billed from -- so
-- the schema refuses one rather than leaving every screen a branch describing
-- the gap.
SELECT must_fail($$
  INSERT INTO site (id, entity_id, label, street, city, region, postcode)
  VALUES (gen_random_uuid(),'44444444-4444-4444-4444-444444444444','No rate',
          '9 Somewhere Rd','Hanford','CA','93230')
$$, 'a site with no CDTFA rate');

SELECT must_fail($$
  INSERT INTO site (id, entity_id, label, city, region, postcode,
                    tax_jurisdiction, tax_rate_pct, state_rate_pct, district_rate_pct,
                  tax_area_code, area_verified_on)
  VALUES (gen_random_uuid(),'44444444-4444-4444-4444-444444444444','No street',
          'Hanford','CA','93230',
          'UNINCORPORATED AREA-KINGS', 7.2500, 7.2500, 0.0000, '169980000000', current_date)
$$, 'a site with no street to look up');

SELECT must_fail($$
  INSERT INTO site (id, entity_id, label, street, city, region, postcode,
                    tax_jurisdiction, tax_rate_pct, state_rate_pct, district_rate_pct,
                  tax_area_code, area_verified_on)
  VALUES (gen_random_uuid(),'44444444-4444-4444-4444-444444444444','Blank postcode',
          '9 Somewhere Rd','Hanford','CA','',
          'UNINCORPORATED AREA-KINGS', 7.2500, 7.2500, 0.0000, '169980000000', current_date)
$$, 'a postcode that is present but empty');

-- What the API said, written down against the address it was said about.
INSERT INTO site_tax_check (site_id, tax_area_code, tax_jurisdiction, rate_pct, changed)
VALUES ('33333333-3333-3333-3333-333333333333','169980000000','UNINCORPORATED AREA-KINGS',
        7.2500, true);
UPDATE site SET tax_rate_pct = 7.2500, tax_jurisdiction = 'UNINCORPORATED AREA-KINGS',
                tax_area_code = '169980000000', area_verified_on = current_date
 WHERE id = '33333333-3333-3333-3333-333333333333';

DO $$
DECLARE r numeric; j text; st boolean;
BEGIN
  SELECT rate_pct, tax_jurisdiction, stale INTO r, j, st FROM site_rate
   WHERE site_id = '33333333-3333-3333-3333-333333333333';
  IF r <> 7.2500 OR j <> 'UNINCORPORATED AREA-KINGS' OR st THEN
    RAISE EXCEPTION 'GUARD MISSING: priced today read as % in %, stale=%', r, j, st;
  END IF;
  RAISE NOTICE '  priced    33341 Bernard Dr is 7.2500%% in %', j;
END $$;

-- AN ANSWER GOES OFF. A rate nobody has re-asked about in three months is not
-- wrong, but it is not known to be right either, and the difference is the
-- whole reason the date is kept.
DO $$
DECLARE st boolean;
BEGIN
  UPDATE site SET area_verified_on = current_date - 200
   WHERE id = '33333333-3333-3333-3333-333333333333';
  SELECT stale INTO st FROM site_rate
   WHERE site_id = '33333333-3333-3333-3333-333333333333';
  IF NOT st THEN
    RAISE EXCEPTION 'GUARD MISSING: an answer 200 days old passed as current';
  END IF;
  RAISE NOTICE '  stale     an answer 200 days old says so';
END $$;

-- Every answer is kept, so a rate that moved can be explained against the
-- invoices billed at the old one.
DO $$
DECLARE n bigint; moved bigint;
BEGIN
  INSERT INTO site_tax_check (site_id, tax_area_code, tax_jurisdiction, rate_pct, changed)
  VALUES ('33333333-3333-3333-3333-333333333333','169980000000','UNINCORPORATED AREA-KINGS',
          7.5000, true);

  SELECT count(*) INTO n FROM site_tax_check
   WHERE site_id = '33333333-3333-3333-3333-333333333333';
  SELECT changes INTO moved FROM site_rate
   WHERE site_id = '33333333-3333-3333-3333-333333333333';

  IF n <> 2 OR moved <> 2 THEN
    RAISE EXCEPTION 'GUARD MISSING: % answers kept, % counted as moves', n, moved;
  END IF;
  RAISE NOTICE '  history   every answer is kept, and % of them moved the rate', moved;
END $$;

-- Losing a site loses its answers with it; they describe an address that is
-- no longer anybody's.
DO $$
DECLARE n int;
BEGIN
  INSERT INTO site (id, entity_id, label, street, city, region, postcode,
                  tax_jurisdiction, tax_rate_pct, state_rate_pct, district_rate_pct,
                  tax_area_code, area_verified_on)
VALUES ('cccccccc-0000-0000-0000-0000000000fe','44444444-0000-0000-0000-000000000002','Gone',
        '1 Nowhere St','Hanford','CA','93230',
        'UNINCORPORATED AREA-KINGS', 7.2500, 7.2500, 0.0000, '169980000000', current_date);
  INSERT INTO site_tax_check (site_id, rate_pct) VALUES
    ('cccccccc-0000-0000-0000-0000000000fe', 7.2500);
  DELETE FROM site WHERE id = 'cccccccc-0000-0000-0000-0000000000fe';
  SELECT count(*) INTO n FROM site_tax_check
   WHERE site_id = 'cccccccc-0000-0000-0000-0000000000fe';
  IF n <> 0 THEN
    RAISE EXCEPTION 'GUARD MISSING: % answers outlived the address', n;
  END IF;
  RAISE NOTICE '  follows   answers go with the address they describe';
END $$;

-- The rate comes apart the way CDTFA publishes it, and the parts ARE the
-- total. Checked against all 558 Californian jurisdictions on 20 Sep 2026:
-- State + County + City = RATE on every record, so this is arithmetic rather
-- than an apportionment, and the schema can insist on it.
SELECT must_fail($$
  UPDATE site SET state_rate_pct = 7.2500, district_rate_pct = 1.0000
   WHERE id = '33333333-3333-3333-3333-333333333333'
$$, 'parts that do not add up to the rate charged');

SELECT must_pass($$
  UPDATE site SET tax_rate_pct = 8.2500,
                  state_rate_pct = 7.2500, district_rate_pct = 1.0000
   WHERE id = '33333333-3333-3333-3333-333333333333'
$$, 'parts that do add up');

-- TAX COLLECTED IS OWED TO SOMEBODY, and the split says who. One lumped
-- SalesTaxPayable cannot answer what a return allocates.
DO $$
DECLARE tax numeric; st numeric; di numeric;
BEGIN
  -- Drafted, lined, then sent: a sent invoice's lines are immutable, which is
  -- the guard two groups above.
  INSERT INTO invoice (id, number, entity_id, status, created_by)
  VALUES ('11110000-0000-0000-0000-0000000000aa','TAXSPLIT',
          '44444444-4444-4444-4444-444444444444','draft',
          '11111111-1111-1111-1111-111111111111');
  INSERT INTO site_tax_check (site_id, tax_area_code, tax_jurisdiction, rate_pct,
                              state_rate_pct, district_rate_pct)
  VALUES ('33333333-3333-3333-3333-333333333333','200424760000','MADERA',
          8.2500, 7.2500, 1.0000);
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            taxable, tax_rate_pct, tax_source, site_id)
  VALUES ('11110000-0000-0000-0000-0000000000aa',1,'material','Cable',1,100.00,100.00,
          true, 8.2500, 'site','33333333-3333-3333-3333-333333333333');
  UPDATE invoice SET status = 'sent', issued_on = current_date, due_on = current_date + 14
   WHERE id = '11110000-0000-0000-0000-0000000000aa';

  SELECT t.tax, t.state_tax, t.district_tax INTO tax, st, di
    FROM invoice_tax t WHERE t.invoice_id = '11110000-0000-0000-0000-0000000000aa';

  IF tax <> 8.25 THEN
    RAISE EXCEPTION 'GUARD MISSING: 100.00 at 8.2500 gave %', tax;
  END IF;
  IF st + di <> tax THEN
    RAISE EXCEPTION 'GUARD MISSING: % + % does not come to %', st, di, tax;
  END IF;
  IF st <> 7.25 OR di <> 1.00 THEN
    RAISE EXCEPTION 'GUARD MISSING: split came out % state, % district', st, di;
  END IF;
  RAISE NOTICE '  owed to   state %, district % -- and they sum to %', st, di, tax;
END $$;

-- WHAT WAS HANDED OVER IS RECORDED, NOT DERIVED. Nothing in the invoices can
-- say whether a return was actually paid.
SELECT must_fail($$
  INSERT INTO tax_remittance (period_start, period_end, amount, created_by)
  VALUES ('2026-09-30','2026-07-01', 100.00, '11111111-1111-1111-1111-111111111111')
$$, 'a filing period that ends before it starts');

SELECT must_pass($$
  INSERT INTO tax_remittance (period_start, period_end, filed_on, paid_on, amount, created_by)
  VALUES ('2026-07-01','2026-09-30','2026-10-20','2026-10-20', 4.42,
          '11111111-1111-1111-1111-111111111111')
$$, 'a return filed and paid');

SELECT must_fail($$
  INSERT INTO tax_remittance (period_start, period_end, amount, created_by)
  VALUES ('2026-07-01','2026-09-30', 4.42, '11111111-1111-1111-1111-111111111111')
$$, 'a second filing for the same period');

SELECT must_fail($$
  INSERT INTO tax_remittance (period_start, period_end, amount, created_by)
  VALUES ('2026-10-01','2026-12-31', -1.00, '11111111-1111-1111-1111-111111111111')
$$, 'handing over a negative amount');

-- A CLIENT AND A SITE ARE NAMEABLE IN A URL, and the name is set once rather
-- than following the record. Renaming must not move a link somebody kept.
DO $$
DECLARE before_slug text; after_slug text;
BEGIN
  SELECT slug INTO before_slug FROM entity
   WHERE id = '44444444-4444-4444-4444-444444444444';
  UPDATE entity SET name = 'Bravo Farms Incorporated'
   WHERE id = '44444444-4444-4444-4444-444444444444';
  SELECT slug INTO after_slug FROM entity
   WHERE id = '44444444-4444-4444-4444-444444444444';
  IF before_slug IS DISTINCT FROM after_slug THEN
    RAISE EXCEPTION 'GUARD MISSING: renaming moved the URL from % to %', before_slug, after_slug;
  END IF;
  RAISE NOTICE '  stays put renaming a client left /clients/% alone', after_slug;
END $$;

-- Two of a name cannot be one URL, and the second does not have to know.
DO $$
DECLARE a text; b text;
BEGIN
  INSERT INTO entity (name) VALUES ('Duplicate Name') RETURNING slug INTO a;
  INSERT INTO entity (name) VALUES ('Duplicate Name') RETURNING slug INTO b;
  IF a = b OR b <> a || '-2' THEN
    RAISE EXCEPTION 'GUARD MISSING: two clients of one name gave % and %', a, b;
  END IF;
  RAISE NOTICE '  distinct  a second "Duplicate Name" became %', b;
END $$;

-- A site's URL is unique within its client and nowhere else: two clients may
-- both have a kettleman, and they are different places.
DO $$
DECLARE n int;
BEGIN
  SELECT count(DISTINCT entity_id) INTO n FROM site WHERE slug = 'kettleman';
  IF n < 2 THEN
    RAISE EXCEPTION 'GUARD MISSING: only % client(s) have a site called kettleman', n;
  END IF;
  RAISE NOTICE '  per client % clients each have their own /sites/kettleman', n;
END $$;

SELECT must_fail($$
  INSERT INTO site (entity_id, label, slug, street, city, region, postcode,
                    tax_jurisdiction, tax_rate_pct, state_rate_pct, district_rate_pct,
                    tax_area_code, area_verified_on)
  VALUES ('44444444-4444-4444-4444-444444444444','Another Kettleman','kettleman',
          '9 Somewhere Rd','Hanford','CA','93230',
          'UNINCORPORATED AREA-KINGS', 7.2500, 7.2500, 0.0000, '169980000000', current_date)
$$, 'two sites of one client sharing a URL');

SELECT must_fail($$
  UPDATE entity SET slug = 'Not A Slug' WHERE id = '44444444-4444-4444-4444-444444444444'
$$, 'a slug that is not a slug');

\echo '=== 20. a site says where it is, and a deletion leaves a record ==='

DO $$
DECLARE shoppe text; traver text; kett text;
BEGIN
  SELECT display INTO shoppe FROM site WHERE id = 'cccccccc-0000-0000-0000-000000000001';
  SELECT display INTO traver FROM site WHERE id = 'cccccccc-0000-0000-0000-00000000000b';
  SELECT display INTO kett    FROM site WHERE id = '33333333-3333-3333-3333-333333333333';

  IF shoppe <> 'The Shoppe, Traver' THEN
    RAISE EXCEPTION 'GUARD MISSING: a name that hides the city gave %', shoppe;
  END IF;
  IF traver <> 'Traver' THEN
    RAISE EXCEPTION 'GUARD MISSING: a name equal to the city gave %', traver;
  END IF;
  IF kett <> 'Kettleman' THEN
    RAISE EXCEPTION 'GUARD MISSING: a name inside the city gave %', kett;
  END IF;
  RAISE NOTICE '  says where %, and % / % are left alone', shoppe, traver, kett;
END $$;

-- An entry that has been billed cannot go; the invoice is built from it.
DO $$
DECLARE t uuid; n int;
BEGIN
  INSERT INTO time_entry (client_uuid, worked_on, minutes, crew, worked_by, created_by,
                          entity_id, site_id, service_id)
  VALUES (gen_random_uuid(),'2026-09-09',30,'one',
          '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111',
          '44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',
          '55555555-5555-5555-5555-555555555555')
  RETURNING id INTO t;

  PERFORM set_config('reckon.user_id', '11111111-1111-1111-1111-111111111111', true);
  DELETE FROM time_entry WHERE id = t;

  SELECT count(*) INTO n FROM record_history
   WHERE table_name = 'time_entry' AND row_id = t AND field = '(deleted)'
     AND changed_by = '11111111-1111-1111-1111-111111111111';
  IF n <> 1 THEN
    RAISE EXCEPTION 'GUARD MISSING: deleting an entry left % record(s)', n;
  END IF;
  RAISE NOTICE '  recorded  a deleted entry is kept in full in record_history';
END $$;

-- Built explicitly: a WHERE that matches nothing deletes nothing and raises
-- nothing, which reads as a guard holding when it was never exercised.
INSERT INTO time_entry (id, client_uuid, worked_on, minutes, crew, worked_by, created_by,
                        entity_id, site_id, service_id)
VALUES ('7777cccc-7777-7777-7777-777777777777', gen_random_uuid(),'2026-09-09',120,'one',
        '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111',
        '44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',
        '55555555-5555-5555-5555-555555555555');

INSERT INTO invoice (id, number, entity_id, created_by) VALUES
  ('7777dddd-7777-7777-7777-777777777777','VTS-0100',
   '44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111');
INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, unit, amount,
                          time_entry_id)
VALUES ('7777dddd-7777-7777-7777-777777777777',1,'service','On-site work',2.00,80.00,'hour',160.00,
        '7777cccc-7777-7777-7777-777777777777');

SELECT must_fail($$
  DELETE FROM time_entry WHERE id = '7777cccc-7777-7777-7777-777777777777'
$$, 'deleting an entry an invoice was built from');

SELECT must_pass($$
  DELETE FROM time_entry WHERE id = (
    SELECT t.id FROM time_entry t
     WHERE NOT EXISTS (SELECT 1 FROM invoice_line il WHERE il.time_entry_id = t.id)
     LIMIT 1)
$$, 'deleting one no invoice has touched');

\echo ''
\echo '=== 21. a session belongs to someone, and ends ==='

SELECT must_fail($$
  INSERT INTO session (token_hash, user_id, expires_at)
  VALUES ('deadbeef','11111111-1111-1111-1111-111111111111', now() - interval '1 day')
$$, 'a session that expired before it began');

SELECT must_pass($$
  INSERT INTO session (token_hash, user_id, expires_at)
  VALUES ('aaaa','11111111-1111-1111-1111-111111111111', now() + interval '30 days')
$$, 'a session for a real person');

SELECT must_fail($$
  INSERT INTO session (token_hash, user_id, expires_at)
  VALUES ('bbbb','99999999-9999-9999-9999-999999999999', now() + interval '30 days')
$$, 'a session for somebody who does not exist');

SELECT must_fail($$
  INSERT INTO session (token_hash, user_id, expires_at)
  VALUES ('aaaa','22222222-2222-2222-2222-222222222222', now() + interval '30 days')
$$, 'two sessions sharing one token');

-- Deleting a person must not leave their sessions behind able to sign in.
DO $$
DECLARE n int;
BEGIN
  INSERT INTO app_user (id, name, email, credential)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001','Temp','temp@example.com','x');
  INSERT INTO session (token_hash, user_id, expires_at)
  VALUES ('cccc','aaaaaaaa-0000-0000-0000-000000000001', now() + interval '1 day');
  DELETE FROM app_user WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
  SELECT count(*) INTO n FROM session WHERE token_hash = 'cccc';
  IF n <> 0 THEN
    RAISE EXCEPTION 'GUARD MISSING: a deleted person kept % session(s)', n;
  END IF;
  RAISE NOTICE '  cascades  removing a person removes their sessions';
END $$;

\echo ''
\echo '=== 22. an address is a place, wherever it is kept ==='

-- 0015 gave a location a place id; 0016 gave the operator one. The settings
-- page spent a week reading operator.address_place_id, a column that never
-- existed, so the chosen place was thrown away on every save and nobody saw it
-- -- an undefined field reads exactly like an empty one.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE (table_name='site'     AND column_name IN ('google_place_id','address_verified_on'))
      OR (table_name='operator' AND column_name IN ('google_place_id','address_verified_on'));
  IF n <> 4 THEN
    RAISE EXCEPTION 'GUARD MISSING: an address that cannot say which place it is (% of 4)', n;
  END IF;
  RAISE NOTICE '  a place    site and operator both keep the id and the date';
END $$;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE column_name = 'address_place_id';
  IF n > 0 THEN
    RAISE EXCEPTION 'GUARD MISSING: address_place_id is back; the column is google_place_id';
  END IF;
  RAISE NOTICE '  one name   address_place_id was the page''s invention, not a column';
END $$;

\echo ''
\echo '=== 23. an allotment says what it is, and pay says who it pays ==='

DO $$
DECLARE b text; h numeric; ovr text;
BEGIN
  SELECT subscription_basis, subscription_hours, subscription_overage INTO b, h, ovr
    FROM service WHERE code = 'remote';
  IF b <> 'capped' OR h <> 2.00 OR ovr <> 'bill' THEN
    RAISE EXCEPTION 'GUARD MISSING: remote support should be capped at 2.00 h, got % % %', b, h, ovr;
  END IF;
  RAISE NOTICE '  on the sold thing  Remote support: capped, 2.00 h, overage bill';
END $$;

-- Unlimited is a value now, not an absent one. It was the absence, and the
-- absence meant "not sold as a subscription" one table over.
SELECT must_pass($$
  INSERT INTO service (code, name, unit, subscription_basis)
  VALUES ('allin','All-in support','hour','unlimited')
$$, 'a service sold with an unlimited allotment');

SELECT must_fail($$
  INSERT INTO service (code, name, unit, subscription_basis, subscription_hours)
  VALUES ('badinf','Unlimited with a number','hour','unlimited', 4.00)
$$, 'unlimited with a cap, which is two answers');

SELECT must_fail($$
  INSERT INTO service (code, name, unit, subscription_basis)
  VALUES ('badcap','Capped with no number','hour','capped')
$$, 'capped with nothing to cap it at');

SELECT must_fail($$
  INSERT INTO service (code, name, unit, subscription_basis, subscription_hours)
  VALUES ('badrule','Hours with no rule','hour','capped', 2.00)
$$, 'capped hours with no rule for exceeding them');

SELECT must_fail($$
  INSERT INTO service (code, name, unit, subscription_hours, subscription_overage)
  VALUES ('badnone','Terms with no basis','hour', 2.00, 'bill')
$$, 'terms on a service that is not sold as a subscription');

DO $$
DECLARE b text; pool numeric;
BEGIN
  SELECT remote_allotment, pooled_hours INTO b, pool FROM agreement_allotment
   WHERE agreement_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  IF b <> 'unlimited' OR pool IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD MISSING: Bravo is unlimited, got % / %', b, pool;
  END IF;
  RAISE NOTICE '  the agreement says  Bravo: unlimited, in words rather than in a null';
END $$;

SELECT must_fail($$
  UPDATE agreement SET remote_allotment = 'unlimited'
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000004'
$$, 'unlimited while a cap is still recorded');

-- Pay has a person. Both partners are on one rate today, which is a row with
-- no person on it -- and the day that stops being true is one row, not a
-- rebuild.
DO $$
DECLARE everyone numeric; mine numeric;
BEGIN
  INSERT INTO person_pay_rate (user_id, service_id, rate, effective_from)
  VALUES ('22222222-2222-2222-2222-222222222222',
          '55555555-5555-5555-5555-555555555556', 40.00, '2026-09-01');

  SELECT rate INTO everyone FROM person_pay_rate
   WHERE user_id IS NULL AND service_id = '55555555-5555-5555-5555-555555555556';
  SELECT rate INTO mine FROM person_pay_rate
   WHERE user_id = '22222222-2222-2222-2222-222222222222';

  IF everyone <> 25.00 OR mine <> 40.00 THEN
    RAISE EXCEPTION 'GUARD MISSING: one rate for everyone and one for a person, got % / %',
                    everyone, mine;
  END IF;
  RAISE NOTICE '  and pay says who   $25.00 to anyone who answers, $40.00 to Robin';
END $$;

SELECT must_fail($$
  INSERT INTO person_pay_rate (user_id, service_id, rate, effective_from)
  VALUES ('22222222-2222-2222-2222-222222222222',
          '55555555-5555-5555-5555-555555555556', 45.00, '2026-09-01')
$$, 'two rates for one person, one service, one day');

DO $$
DECLARE n int;
BEGIN
  INSERT INTO app_user (id, name, email, credential)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000b','Leaver','leaver@example.com','x');
  INSERT INTO person_pay_rate (user_id, rate, effective_from)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000b', 60.00, '2026-09-01');

  DELETE FROM app_user WHERE id = 'aaaaaaaa-0000-0000-0000-00000000000b';
  SELECT count(*) INTO n FROM person_pay_rate
   WHERE user_id = 'aaaaaaaa-0000-0000-0000-00000000000b';
  IF n <> 0 THEN
    RAISE EXCEPTION 'GUARD MISSING: a departed person left % pay row(s)', n;
  END IF;
  RAISE NOTICE '  cascades           removing a person removes what they were paid at';
END $$;

\echo ''
\echo '=== 24. the rest of what the operator supplies ==='

-- Recurring runs on the first, so there is no run day to get wrong.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_name = 'operator' AND column_name = 'recurring_run_day';
  IF n > 0 THEN
    RAISE EXCEPTION 'GUARD MISSING: a run day is back; recurring bills on the first';
  END IF;
  RAISE NOTICE '  absent    no run day -- recurring bills on the first of the month';
END $$;

SELECT must_fail($$
  UPDATE operator SET filing_basis = 'fortnightly'
$$, 'a filing basis no agency offers');

SELECT must_fail($$
  UPDATE operator SET fiscal_year_end_month = 13
$$, 'a thirteenth month');

SELECT must_pass($$
  UPDATE operator SET filing_basis = 'annual', fiscal_year_end_month = 6,
                      tax_registration = 'Seller''s permit', tax_agency = 'CDTFA'
$$, 'annual, ending June, on a CDTFA seller''s permit');

-- How legs are HANDED OUT is not what a leg IS. The two vocabularies are
-- separate on purpose, and neither accepts the other's words.
SELECT must_fail($$
  UPDATE operator SET mileage_assignment = 'a_to_b'
$$, 'a leg kind used as an assignment policy');

SELECT must_fail($$
  INSERT INTO trip (id, travelled_on, created_by)
  VALUES ('dddddddd-0000-0000-0000-000000000001','2026-08-17',
          '11111111-1111-1111-1111-111111111111');
  INSERT INTO trip_leg (trip_id, seq, miles, rule)
  VALUES ('dddddddd-0000-0000-0000-000000000001', 1, 12.0, 'actual')
$$, 'an assignment policy used as a leg kind');

SELECT must_fail($$
  INSERT INTO integration (name) VALUES ('quickbooks')
$$, 'an integration nobody wired up');

SELECT must_pass($$
  INSERT INTO integration (name, connected, detail) VALUES ('beancount', true, 'books/')
$$, 'the ledger, and where it lives');

-- An agreement may only name its own client's contact -- the same fault a
-- site's contact column had, in the same table it points at.
INSERT INTO contact (id, name) VALUES
  ('eeeeeeee-0000-0000-0000-00000000000f','Somebody else entirely');

SELECT must_fail($$
  UPDATE agreement SET contact_id = 'eeeeeeee-0000-0000-0000-00000000000f'
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001'
$$, 'an agreement naming somebody who is not the client''s contact');

-- An agreement is agreed with somebody. Losing the person must not lose it.
DO $$
DECLARE who uuid; still int;
BEGIN
  INSERT INTO contact (id, name) VALUES ('eeeeeeee-0000-0000-0000-000000000001','Nick');
  -- Nick negotiated it, so Nick is the client's contact. The agreement cannot
  -- name him before that is recorded -- same confinement as a site's.
  INSERT INTO entity_contact (entity_id, contact_id)
  VALUES ('44444444-4444-4444-4444-444444444444','eeeeeeee-0000-0000-0000-000000000001');
  UPDATE agreement SET contact_id = 'eeeeeeee-0000-0000-0000-000000000001'
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';

  DELETE FROM contact WHERE id = 'eeeeeeee-0000-0000-0000-000000000001';

  SELECT contact_id INTO who FROM agreement
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
  SELECT count(*) INTO still FROM agreement
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';

  IF still <> 1 THEN
    RAISE EXCEPTION 'GUARD MISSING: losing a contact took the agreement with it';
  END IF;
  IF who IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD MISSING: the agreement still points at a deleted contact';
  END IF;
  RAISE NOTICE '  survives  the agreement outlives the person it was agreed with';
END $$;

\echo ''
\echo '=== 25. a recurring charge has a period and an anchor ==='

-- Four hours a month and four hours a week are different products.
SELECT must_fail($$
  INSERT INTO service (code, name, unit, subscription_basis,
                       subscription_hours, subscription_overage)
  VALUES ('noper','Capped, but over what','hour','capped', 4.00, 'bill')
$$, 'an allotment with no period to refresh over');

SELECT must_pass($$
  INSERT INTO service (code, name, unit, subscription_basis, subscription_hours,
                       subscription_overage, subscription_period)
  VALUES ('weekly','Four hours a week','hour','capped', 4.00, 'bill', 'week')
$$, 'four hours a week, said in the row rather than assumed');

SELECT must_fail($$
  INSERT INTO service (code, name, unit, subscription_basis, subscription_period)
  VALUES ('perinf','Unlimited, per month','hour','unlimited','month')
$$, 'a period on an allotment that never runs out');

-- The charge falls on the agreement's day, not the calendar's.
DO $$
DECLARE d smallint;
BEGIN
  SELECT billing_anchor_day INTO d FROM agreement
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
  IF d <> 1 THEN
    RAISE EXCEPTION 'GUARD MISSING: an agreement starting 1 Sep should anchor on 1, got %', d;
  END IF;
  RAISE NOTICE '  anchored  on the day the agreement started, not the first of the month';
END $$;

SELECT must_fail($$
  UPDATE agreement SET billing_anchor_day = 32
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001'
$$, 'a day no month has');

SELECT must_fail($$
  UPDATE agreement SET billing_interval = 'fortnightly'
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001'
$$, 'an interval nobody bills on');

-- THE MONTH-END RULE, AND THAT IT DOES NOT DRIFT. A 31st anchor bills the last
-- day of a short month and the 31st again the month after -- clamping and then
-- keeping 28 walks a January agreement onto the 28th forever.
DO $$
DECLARE jan date; feb date; mar date; apr date; leap date;
BEGIN
  jan  := billing_date('2026-01-01', 31);
  feb  := billing_date('2026-02-01', 31);
  mar  := billing_date('2026-03-01', 31);
  apr  := billing_date('2026-04-01', 31);
  leap := billing_date('2028-02-01', 31);

  IF jan <> '2026-01-31' OR feb <> '2026-02-28' OR mar <> '2026-03-31'
     OR apr <> '2026-04-30' THEN
    RAISE EXCEPTION 'GUARD MISSING: the 31st should clamp and come back, got % % % %',
                    jan, feb, mar, apr;
  END IF;
  IF leap <> '2028-02-29' THEN
    RAISE EXCEPTION 'GUARD MISSING: February 2028 has a 29th, got %', leap;
  END IF;
  RAISE NOTICE '  clamps    the 31st bills 31 Jan, 28 Feb, 31 Mar, 30 Apr -- no drift';
  RAISE NOTICE '  and leaps 29 February 2028, because that year has one';
END $$;

DO $$
BEGIN
  IF billing_date('2026-02-01', 17) <> '2026-02-17' THEN
    RAISE EXCEPTION 'GUARD MISSING: a day every month has should never be clamped';
  END IF;
  RAISE NOTICE '  untouched a 17th anchor is a 17th in every month';
END $$;

-- Proration is a question about ending. A period that starts when the
-- agreement starts cannot be partial at the front.
DO $$
DECLARE n int; d text;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_name = 'operator' AND column_name = 'recurring_proration';
  IF n > 0 THEN
    RAISE EXCEPTION 'GUARD MISSING: the business is answering for a contract term again';
  END IF;

  SELECT final_period_proration INTO d FROM agreement
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
  IF d <> 'daily' THEN
    RAISE EXCEPTION 'GUARD MISSING: an unfinished period should bill the days had, got %', d;
  END IF;
  RAISE NOTICE '  on the contract  proration is the agreement''s term, and defaults to daily';
END $$;

SELECT must_fail($$
  UPDATE agreement SET final_period_proration = 'weekly'
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001'
$$, 'a proration rule that is neither whole nor by the day');

\echo ''
\echo 'All guards hold.'
