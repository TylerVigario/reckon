-- Does the schema hold what it says it holds?
--
-- Each guard is tested both ways: the thing that must be refused is refused,
-- and the legitimate case beside it still works. A guard that also blocks
-- ordinary use is a bug, not a guard.
--
-- Constraints and triggers only. What an hour bills, what it pays and what a
-- retainer covers is worked out in app/src/lib/server/valuation, and tested
-- there, by Vitest.
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

INSERT INTO "user" (id, name, email) VALUES
  ('a0a0a0a0-0000-4000-8000-0000000000a1','Avery','avery@example.com'),
  ('a0a0a0a0-0000-4000-8000-0000000000a2','Sam','sam@example.com');

-- An invented business. Every site that carries a rate is at a public
-- building, with the rate, split and area code CDTFA gives for it; the few
-- addresses that are plainly made up are on rows the schema refuses.
--
-- Three clients, five sites. Alder Street Clinic is worked at in three places,
-- and its front office is in the building at 101 Maple St where Bluegill
-- Accounting rents Suite 4 -- so neither a client's sites nor an address's
-- clients can be taken to be one. Kingfisher Tutoring has one site, out in
-- Coloma. Contacts are added where a guard needs them.

INSERT INTO entity (id, name, slug) VALUES
  ('44444444-4444-4444-4444-444444444444','Alder Street Clinic','alder-street-clinic'),
  ('44444444-0000-4000-8000-000000000002','Bluegill Accounting','bluegill-accounting'),
  ('44444444-0000-4000-8000-000000000003','Kingfisher Tutoring','kingfisher-tutoring');

INSERT INTO service (id, code, name, unit, bill_to_nearest_seconds)
VALUES
  ('b5000000-0000-4000-8000-000000000055','field','Field service','hour',60),
  ('b5000000-0000-4000-8000-000000000056','helpdesk','Help desk','hour',60),
  ('b5000000-0000-4000-8000-000000000057','travel','Travel','mile',NULL);

INSERT INTO material (id, name, unit_id) VALUES
  ('66666666-6666-6666-6666-666666666666','Coax - RG6 - Quad shield',
   (SELECT id FROM unit WHERE name = 'foot'));

INSERT INTO invoice (id, number, entity_id, created_by) VALUES
  ('77777777-7777-7777-7777-777777777777','INV-0412',
   '44444444-4444-4444-4444-444444444444','a0a0a0a0-0000-4000-8000-0000000000a1');

INSERT INTO site (id, entity_id, label, slug, street, city, region, postcode,
                  tax_jurisdiction, tax_rate_pct, state_rate_pct, district_rate_pct,
                  tax_area_code, area_verified_on,
                  round_trip_miles, drive_minutes) VALUES
  ('c5000000-0000-4000-8000-000000000001','44444444-4444-4444-4444-444444444444',
   'Front office','front-office','101 Maple St','Auburn','CA','95603',
   'AUBURN', 7.2500, 7.2500, 0.0000, '310110000000', current_date, 60, 66),
  ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
   'Yuba','yuba','1201 Civic Center Blvd','Yuba City','CA','95993',
   'YUBA CITY', 7.2500, 7.2500, 0.0000, '510510000000', current_date, 58, 62),
  ('c5000000-0000-4000-8000-00000000000c','44444444-4444-4444-4444-444444444444',
   'Woodland lab','woodland-lab','1000 Main St','Woodland','CA','95695',
   'WOODLAND', 8.0000, 7.2500, 0.7500, '570282360000', current_date, 40, 45),
  ('c5000000-0000-4000-8000-00000000000b','44444444-0000-4000-8000-000000000002',
   'Suite 4','suite-4','101 Maple St','Auburn','CA','95603',
   'AUBURN', 7.2500, 7.2500, 0.0000, '310110000000', current_date, 60, 66),
  ('c5000000-0000-4000-8000-00000000000a','44444444-0000-4000-8000-000000000003',
   'Coloma','coloma','310 Back St','Coloma','CA','95613',
   'UNINCORPORATED AREA-EL DORADO', 7.2500, 7.2500, 0.0000, '099980000000', current_date, 44, 58);

\echo ''
\echo '=== 1. an entry cannot arrive twice from a retry ==='

SELECT must_pass($$
  INSERT INTO time_entry (client_uuid, worked_on, seconds, crew, worked_by, created_by,
                          entity_id, site_id, service_id)
  VALUES ('a1000000-0000-4000-8000-000000000001','2026-08-24',253 * 60,'one',
          'a0a0a0a0-0000-4000-8000-0000000000a1','a0a0a0a0-0000-4000-8000-0000000000a1',
          '44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',
          'b5000000-0000-4000-8000-000000000055')
$$, 'an entry posts');

SELECT must_fail($$
  INSERT INTO time_entry (client_uuid, worked_on, seconds, crew, worked_by, created_by,
                          entity_id, site_id, service_id)
  VALUES ('a1000000-0000-4000-8000-000000000001','2026-08-24',253 * 60,'one',
          'a0a0a0a0-0000-4000-8000-0000000000a1','a0a0a0a0-0000-4000-8000-0000000000a1',
          '44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',
          'b5000000-0000-4000-8000-000000000055')
$$, 'the same entry retried after a timeout');

\echo ''
\echo '=== 2. who worked an hour is not who entered it ==='

SELECT must_pass($$
  INSERT INTO time_entry (client_uuid, worked_on, seconds, crew, worked_by, created_by,
                          entity_id, site_id, service_id)
  VALUES ('a1000000-0000-4000-8000-000000000002','2026-08-28',150 * 60,'one',
          'a0a0a0a0-0000-4000-8000-0000000000a2','a0a0a0a0-0000-4000-8000-0000000000a1',
          '44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',
          'b5000000-0000-4000-8000-000000000055')
$$, 'Sam worked it, Avery typed it');

SELECT must_pass($$
  INSERT INTO time_entry (client_uuid, worked_on, seconds, crew, worked_by, created_by,
                          service_id, billable)
  VALUES ('a1000000-0000-4000-8000-000000000003','2026-08-31',89 * 60,'one',
          'a0a0a0a0-0000-4000-8000-0000000000a1','a0a0a0a0-0000-4000-8000-0000000000a1',
          'b5000000-0000-4000-8000-000000000055', false)
$$, 'non-billable time with no client');

SELECT must_fail($$
  INSERT INTO time_entry (client_uuid, worked_on, seconds, crew, worked_by, created_by,
                          service_id, billable)
  VALUES ('a1000000-0000-4000-8000-000000000004','2026-08-31',89 * 60,'one',
          'a0a0a0a0-0000-4000-8000-0000000000a1','a0a0a0a0-0000-4000-8000-0000000000a1',
          'b5000000-0000-4000-8000-000000000055', true)
$$, 'billable time with nobody to bill');

\echo ''
\echo '=== 3. an exemption without its certificate ==='

SELECT must_fail($$
  UPDATE entity SET tax_exempt = true WHERE id = '44444444-4444-4444-4444-444444444444'
$$, 'exempt with no certificate on file');

SELECT must_pass($$
  UPDATE entity SET tax_exempt = true, exemption_certificate = 'SR-ZZ-000-1234'
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
  VALUES ('77777777-7777-7777-7777-777777777777',1,'material','Coax',180,0.22,
          true, 8.5000, 'override', 39.60)
$$, 'an 8.5% override with no reason');

SELECT must_pass($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price,
                            taxable, tax_rate_pct, tax_source, tax_override_reason, amount)
  VALUES ('77777777-7777-7777-7777-777777777777',1,'material','Coax',180,0.22,
          true, 8.2500, 'override', 'Marysville jobsite, location not yet on file', 39.60)
$$, 'the same override, explained');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price,
                            taxable, tax_rate_pct, tax_source, amount)
  VALUES ('77777777-7777-7777-7777-777777777777',2,'service','Labour',4.2167,45,
          false, 7.2500, 'site', 189.75)
$$, 'tax on a line marked untaxable');

\echo ''
\echo '=== 5. a line points at one source, or none ==='

INSERT INTO trip (id, travelled_on, driven_by, created_by)
VALUES ('88888888-8888-8888-8888-888888888888','2026-08-24',
        'a0a0a0a0-0000-4000-8000-0000000000a1','a0a0a0a0-0000-4000-8000-0000000000a1');
INSERT INTO trip_leg (id, trip_id, seq, miles, entity_id, service_id)
VALUES ('99999999-9999-9999-9999-999999999999','88888888-8888-8888-8888-888888888888',
        1, 31, '44444444-4444-4444-4444-444444444444','b5000000-0000-4000-8000-000000000057');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            time_entry_id, trip_leg_id)
  VALUES ('77777777-7777-7777-7777-777777777777',3,'service','Two sources',1,1,1,
          (SELECT id FROM time_entry WHERE client_uuid='a1000000-0000-4000-8000-000000000001'),
          '99999999-9999-9999-9999-999999999999')
$$, 'a line claiming both a time entry and a trip leg');

SELECT must_pass($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount, trip_leg_id)
  VALUES ('77777777-7777-7777-7777-777777777777',3,'service','Travel',31,0.66,20.46,
          '99999999-9999-9999-9999-999999999999')
$$, 'a line from one trip leg');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount, trip_leg_id)
  VALUES ('77777777-7777-7777-7777-777777777777',4,'service','Same leg again',31,0.66,20.46,
          '99999999-9999-9999-9999-999999999999')
$$, 'the same leg billed twice');

\echo ''
\echo '=== 6. a sent invoice is immutable ==='

SELECT must_pass($$
  UPDATE invoice_line SET amount = 20.47
   WHERE invoice_id = '77777777-7777-7777-7777-777777777777' AND seq = 3
$$, 'editing a line while it is still a draft');

UPDATE invoice SET status='sent', issued_on='2026-09-04', due_on='2026-10-04', sent_at=now()
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

-- Paid now, which is still sent: none of these may reach it (#24).
INSERT INTO invoice (id, number, entity_id, created_by) VALUES
  ('77777777-0000-4000-8000-0000000000d1','INV-0413',
   '44444444-4444-4444-4444-444444444444','a0a0a0a0-0000-4000-8000-0000000000a1'),
  ('77777777-0000-4000-8000-0000000000d2','INV-0414',
   '44444444-4444-4444-4444-444444444444','a0a0a0a0-0000-4000-8000-0000000000a1');
INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount)
VALUES ('77777777-0000-4000-8000-0000000000d1',1,'service','Still a draft',1,10,10);
UPDATE invoice SET status='sent', issued_on='2026-09-04', due_on='2026-10-04', sent_at=now()
 WHERE id = '77777777-0000-4000-8000-0000000000d2';

SELECT must_fail($$
  UPDATE invoice SET status = 'draft' WHERE id = '77777777-7777-7777-7777-777777777777'
$$, 'putting a sent invoice back to draft');

SELECT must_fail($$
  UPDATE invoice_line SET invoice_id = '77777777-0000-4000-8000-0000000000d1'
   WHERE invoice_id = '77777777-7777-7777-7777-777777777777' AND seq = 3
$$, 'moving a line off a sent invoice onto a draft');

SELECT must_fail($$
  UPDATE invoice_line SET invoice_id = '77777777-7777-7777-7777-777777777777'
   WHERE invoice_id = '77777777-0000-4000-8000-0000000000d1'
$$, 'moving a draft''s line onto a sent invoice');

SELECT must_fail($$
  DELETE FROM invoice WHERE id = '77777777-0000-4000-8000-0000000000d2'
$$, 'deleting a sent invoice, even one with no lines');

SELECT must_pass($$
  DELETE FROM invoice WHERE id = '77777777-0000-4000-8000-0000000000d1'
$$, 'deleting a draft, lines and all');

\echo ''
\echo '=== 7. stock cannot be used before it arrives ==='

SELECT must_pass($$
  INSERT INTO material_lot (material_id, received_on, qty_received, qty_remaining,
                            ex_tax_cost, tax_paid)
  VALUES ('66666666-6666-6666-6666-666666666666','2026-07-14',600,420,90.00,6.96)
$$, 'a lot with 180 ft drawn from it');

SELECT must_fail($$
  INSERT INTO material_lot (material_id, received_on, qty_received, qty_remaining,
                            ex_tax_cost, tax_paid)
  VALUES ('66666666-6666-6666-6666-666666666666','2026-07-14',600,700,90.00,6.96)
$$, 'a lot with more left than ever arrived');

\echo ''
\echo '=== 8. a rate is CDTFA''s answer, not ours ==='

-- A negative rate is not an answer CDTFA can give -- even one whose parts
-- add up.
SELECT must_fail($$
  UPDATE site SET tax_rate_pct = -1, state_rate_pct = -1, district_rate_pct = 0
   WHERE id = '33333333-3333-3333-3333-333333333333'
$$, 'a rate below zero');

\echo '=== 9. two "any entity" prices cannot both be true ==='

-- One row is the whole price, whatever the crew: the first person, and what
-- each person after adds.
SELECT must_pass($$
  INSERT INTO service_price (service_id, rate, additional_rate, effective_from)
  VALUES ('b5000000-0000-4000-8000-000000000055',95,45,'2026-08-03')
$$, 'field service, $95.00 for one person and $45.00 for each after');

SELECT must_fail($$
  INSERT INTO service_price (service_id, rate, additional_rate, effective_from)
  VALUES ('b5000000-0000-4000-8000-000000000055',110,0,'2026-08-03')
$$, 'a second price for the same service, client and day');

SELECT must_fail($$
  INSERT INTO service_price (service_id, rate, additional_rate, effective_from)
  VALUES ('b5000000-0000-4000-8000-000000000055',95,-10,'2026-09-03')
$$, 'a second person who takes money off the job');

\echo ''
\echo '=== 10. history records who changed what ==='

SELECT set_config('reckon.user_id','a0a0a0a0-0000-4000-8000-0000000000a2',false);
UPDATE entity SET name = 'Alder Street Clinic - renamed'
 WHERE id = '44444444-4444-4444-4444-444444444444';

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM record_history
   WHERE table_name='entity' AND field='name' ORDER BY changed_at DESC LIMIT 1;
  IF r IS NULL THEN RAISE EXCEPTION 'GUARD MISSING: the rename was not recorded'; END IF;
  IF r.changed_by <> 'a0a0a0a0-0000-4000-8000-0000000000a2' THEN
    RAISE EXCEPTION 'GUARD MISSING: recorded against the wrong user';
  END IF;
  RAISE NOTICE '  recorded  "%" -> "%" by Sam', r.old_value, r.new_value;
END $$;

\echo ''
\echo '=== 11. the help desk: unlimited, included, or nothing ==='

INSERT INTO operator (trading_name, tax_rule_set)
VALUES ('Kestrel Field Services','us_ca');

-- Avery and Sam hold the Partner role, and pay is written against the role:
-- one rule covers whoever holds it.
UPDATE "user" SET role_id = (SELECT id FROM role WHERE name = 'Partner')
 WHERE id IN ('a0a0a0a0-0000-4000-8000-0000000000a1','a0a0a0a0-0000-4000-8000-0000000000a2');

-- What is paid to whoever answers is a dated pay rule on the help desk,
-- not a column on the business.
INSERT INTO pay_rule (service_id, role_id, pays_for, method, amount, effective_from)
VALUES ('b5000000-0000-4000-8000-000000000056',(SELECT id FROM role WHERE name = 'Partner'),
        'time','per_hour', 22.00, '2026-08-15');

-- Kingfisher: $210 a month for help desk without limit, on the client rather
-- than its site. What it covers is named service by service.
INSERT INTO agreement (id, entity_id, site_id, price, starts_on, billing_anchor_day) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000001','44444444-0000-4000-8000-000000000003',
   NULL, 210.00, '2026-08-01', 1);
INSERT INTO agreement_service (agreement_id, service_id, allotment) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000056','unlimited');

-- A covered hour is paid from the retainer, not by the hour: for Kingfisher,
-- 15% of what the month charged, shared by the people who covered it.
INSERT INTO pay_rule (service_id, role_id, entity_id, pays_for, method, amount, effective_from)
VALUES ('b5000000-0000-4000-8000-000000000056',(SELECT id FROM role WHERE name = 'Partner'),
        '44444444-0000-4000-8000-000000000003','covered_time','percent',15,'2026-08-01');

-- A client with two sites: an agreement of its own, pooled across them, and one
-- of the sites with an agreement of its own besides.
INSERT INTO entity (id, name, slug) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000003','A client with two sites','a-client-with-two-sites');
INSERT INTO site (id, entity_id, label, slug, street, city, region, postcode,
                  tax_jurisdiction, tax_rate_pct, state_rate_pct, district_rate_pct,
                  tax_area_code, area_verified_on) VALUES
  ('c5000000-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000003','Site one','site-one',
   '11255 Jackson St','Columbia','CA','95310',
   'UNINCORPORATED AREA-TUOLUMNE', 7.2500, 7.2500, 0.0000, '559980000000', current_date),
  ('c5000000-0000-4000-8000-000000000003','bbbbbbbb-0000-4000-8000-000000000003','Site two','site-two',
   '526 C St','Marysville','CA','95901',
   'MARYSVILLE', 8.2500, 7.2500, 1.0000, '580604470000', current_date);
INSERT INTO agreement (id, entity_id, site_id, price, starts_on, billing_anchor_day) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000004','bbbbbbbb-0000-4000-8000-000000000003', NULL,
   260.00, '2026-09-01', 1),
  ('bbbbbbbb-0000-4000-8000-000000000006','bbbbbbbb-0000-4000-8000-000000000003',
   'c5000000-0000-4000-8000-000000000003', 85.00, '2026-09-12', 12);
INSERT INTO agreement_service (agreement_id, service_id, allotment, included_hours, overage) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000004','b5000000-0000-4000-8000-000000000056','capped', 2.50, 'bill'),
  ('bbbbbbbb-0000-4000-8000-000000000006','b5000000-0000-4000-8000-000000000056','capped', 1.00, 'bill');
SELECT must_fail($$
  UPDATE agreement_service SET overage = 'absorb'
   WHERE agreement_id = 'bbbbbbbb-0000-4000-8000-000000000004'
$$, 'an overage rule nobody named');

SELECT must_pass($$
  UPDATE agreement_service SET overage = 'deny'
   WHERE agreement_id = 'bbbbbbbb-0000-4000-8000-000000000004'
$$, 'overage set to deny work');

SELECT must_pass($$
  UPDATE agreement_service SET overage = 'no_charge'
   WHERE agreement_id = 'bbbbbbbb-0000-4000-8000-000000000004'
$$, 'overage set to no charge');

\echo ''
\echo '=== 12. an agreement names what it covers; nothing is inferred ==='

-- Coverage is listed per service on the agreement, so a service row says only
-- how it is charged.
SELECT must_fail($$
  INSERT INTO service (code, name, unit)
  VALUES ('bad','Something','day')
$$, 'a unit nobody named');

SELECT must_pass($$
  INSERT INTO service (code, name, unit)
  VALUES ('weekend','Weekend work','hour')
$$, 'a service that says nothing about where it is done');

SELECT must_pass($$
  INSERT INTO service (code, name, unit)
  VALUES ('setup','Workstation setup','each')
$$, 'a flat charge, counted each');

DO $$
DECLARE r text;
BEGIN
  SELECT string_agg(e.name || ' → ' || s.name, ', ' ORDER BY e.name) INTO r
    FROM agreement_service asv
    JOIN agreement a ON a.id = asv.agreement_id
    JOIN entity e    ON e.id = a.entity_id
    JOIN service s   ON s.id = asv.service_id;
  RAISE NOTICE '  covered   %', r;
END $$;

\echo ''
\echo '=== 13. crew = team is one row for the whole crew ==='

SELECT must_pass($$
  INSERT INTO time_entry (client_uuid, worked_on, seconds, crew, worked_by, created_by,
                          entity_id, site_id, service_id)
  VALUES ('dddddddd-0000-4000-8000-000000000001','2026-09-16',150 * 60,'team',NULL,
          'a0a0a0a0-0000-4000-8000-0000000000a1',
          '44444444-0000-4000-8000-000000000003','c5000000-0000-4000-8000-00000000000a',
          'b5000000-0000-4000-8000-000000000055')
$$, 'a team entry, worked_by left empty');

SELECT must_fail($$
  INSERT INTO time_entry (client_uuid, worked_on, seconds, crew, worked_by, created_by,
                          entity_id, site_id, service_id)
  VALUES ('dddddddd-0000-4000-8000-000000000002','2026-09-16',150 * 60,'team',
          'a0a0a0a0-0000-4000-8000-0000000000a1','a0a0a0a0-0000-4000-8000-0000000000a1',
          '44444444-0000-4000-8000-000000000003','c5000000-0000-4000-8000-00000000000a',
          'b5000000-0000-4000-8000-000000000055')
$$, 'a team entry naming one person');

SELECT must_fail($$
  INSERT INTO time_entry (client_uuid, worked_on, seconds, crew, worked_by, created_by,
                          entity_id, site_id, service_id)
  VALUES ('dddddddd-0000-4000-8000-000000000003','2026-09-16',150 * 60,'one',NULL,
          'a0a0a0a0-0000-4000-8000-0000000000a1',
          '44444444-0000-4000-8000-000000000003','c5000000-0000-4000-8000-00000000000a',
          'b5000000-0000-4000-8000-000000000055')
$$, 'a solo entry naming nobody');

\echo ''
\echo '=== 14. every price has one home ==='

SELECT must_pass($$
  INSERT INTO service (id, code, name, unit)
  VALUES ('b5000000-0000-4000-8000-00000000005a','delivery','Delivery','mile')
$$, 'delivery by the mile is a service');

SELECT must_pass($$
  INSERT INTO service_price (service_id, rate, effective_from)
  VALUES ('b5000000-0000-4000-8000-00000000005a',1.10,'2026-01-01')
$$, 'and $1.10 a mile is a dated price row');

SELECT must_pass($$
  INSERT INTO material (name, unit_id, markup_pct)
  VALUES ('Wall plate off the default', (SELECT id FROM unit WHERE name = 'each'), NULL)
$$, 'a material with no markup takes the operator default');

SELECT must_pass($$
  INSERT INTO material (name, unit_id, markup_pct)
  VALUES ('Wall plate with its own', (SELECT id FROM unit WHERE name = 'each'), 35)
$$, 'and one item may override it');

-- Kingfisher's September, charged.
INSERT INTO agreement_period (agreement_id, period_start, period_end, amount)
VALUES ('bbbbbbbb-0000-4000-8000-000000000001','2026-09-01','2026-09-30',210.00);

\echo ''
\echo '=== 15. whether a service is timed is separate from its unit ==='

DO $$
DECLARE r text;
BEGIN
  SELECT string_agg(name || ' (' || unit || ') ' ||
                    CASE WHEN time_tracked THEN 'timed' ELSE 'not timed' END, ', ' ORDER BY name)
    INTO r FROM service WHERE code IN ('field','helpdesk','delivery');
  RAISE NOTICE '  default   %', r;
END $$;

SELECT must_pass($$
  UPDATE service SET time_tracked = true WHERE code = 'delivery'
$$, 'delivery may be timed while still charged per mile');

DO $$
DECLARE u text; t boolean;
BEGIN
  SELECT unit, time_tracked INTO u, t FROM service WHERE code = 'delivery';
  IF u IS DISTINCT FROM 'mile' OR t IS NOT TRUE THEN
    RAISE EXCEPTION 'GUARD MISSING: timing a service changed how it is charged (% / %)', u, t;
  END IF;
  RAISE NOTICE '  separate  still charged per mile, now on the timer';
END $$;

SELECT must_pass($$
  UPDATE service SET time_tracked = false WHERE code = 'delivery'
$$, 'and off the timer again without touching the charge');

\echo ''
\echo '=== 16. a line says what it counts, and keeps saying it ==='

-- Its own draft invoice. Guard 6 sent the other one, and a sent line refuses
-- every UPDATE -- which would have made the vocabulary look enforced when it
-- was only frozen.
INSERT INTO invoice (id, number, entity_id, created_by) VALUES
  ('7777aaaa-7777-7777-7777-777777777777','KFS-0420',
   '44444444-4444-4444-4444-444444444444','a0a0a0a0-0000-4000-8000-0000000000a1');
INSERT INTO invoice_line (id, invoice_id, seq, kind, description, qty, unit_price, unit, amount)
  VALUES ('7777bbbb-7777-7777-7777-777777777777','7777aaaa-7777-7777-7777-777777777777',
          1,'service','Delivery, Coloma',44.00,1.10,'mile',48.40);

SELECT must_pass($$
  UPDATE invoice_line SET unit = 'box of 25' WHERE id = '7777bbbb-7777-7777-7777-777777777777'
$$, 'whatever the operator counts in, in words');

SELECT must_fail($$
  UPDATE invoice_line SET unit = '  ' WHERE id = '7777bbbb-7777-7777-7777-777777777777'
$$, 'a unit that is only spaces');

SELECT must_pass($$
  UPDATE invoice_line SET unit = NULL WHERE id = '7777bbbb-7777-7777-7777-777777777777'
$$, 'no unit, for a flat charge that counts nothing');

-- Stored, not derived: moving the service must not restate an issued line.
DO $$
DECLARE u text;
BEGIN
  UPDATE invoice_line SET unit = 'mile' WHERE id = '7777bbbb-7777-7777-7777-777777777777';
  UPDATE service SET unit = 'hour' WHERE code = 'delivery';
  SELECT unit INTO u FROM invoice_line WHERE id = '7777bbbb-7777-7777-7777-777777777777';
  IF u <> 'mile' THEN
    RAISE EXCEPTION 'GUARD MISSING: the line followed the service to %', u;
  END IF;
  RAISE NOTICE '  stored    service moved to hour, the billed line still reads mile';
  UPDATE service SET unit = 'mile' WHERE code = 'delivery';
END $$;

-- And once sent, it cannot move at all.
UPDATE invoice SET status='sent', issued_on='2026-09-16', due_on='2026-10-16', sent_at=now()
 WHERE id = '7777aaaa-7777-7777-7777-777777777777';

SELECT must_fail($$
  UPDATE invoice_line SET unit = 'hour' WHERE id = '7777bbbb-7777-7777-7777-777777777777'
$$, 'restating the unit on a sent line');

\echo ''
\echo '=== 17. sites belong to clients, and an address can repeat ==='

-- One address, two clients, two sites. Not one row with two labels: they have
-- different names, different contacts, and neither knows the other exists.
DO $$
DECLARE r text; k text;
BEGIN
  SELECT string_agg(e.name || ' calls it ' || s.label, ', ' ORDER BY e.name) INTO r
    FROM site s JOIN entity e ON e.id = s.entity_id
   WHERE s.street = '101 Maple St';
  SELECT string_agg(s.label, ', ' ORDER BY s.label) INTO k
    FROM site s WHERE s.entity_id = '44444444-4444-4444-4444-444444444444';
  IF r IS NULL OR position(',' in r) = 0 THEN
    RAISE EXCEPTION 'GUARD MISSING: one address should hold two sites, got %', r;
  END IF;
  RAISE NOTICE '  two sites 101 Maple St: %', r;
  RAISE NOTICE '  one client Alder Street Clinic works at: %', k;
END $$;

-- A site is its client's. A time entry cannot point at another client's site.
SELECT must_fail($$
  INSERT INTO time_entry (client_uuid, worked_on, seconds, crew, worked_by, created_by,
                          entity_id, site_id, service_id)
  VALUES (gen_random_uuid(), current_date,30 * 60,'one',
          'a0a0a0a0-0000-4000-8000-0000000000a1','a0a0a0a0-0000-4000-8000-0000000000a1',
          '44444444-4444-4444-4444-444444444444','c5000000-0000-4000-8000-00000000000b',
          'b5000000-0000-4000-8000-000000000055')
$$, 'billing one client for work at another client''s site');

-- Two clients at one address each have a site there, so work for either is an
-- entry against that client's own site.
SELECT must_pass($$
  INSERT INTO time_entry (client_uuid, worked_on, seconds, crew, worked_by, created_by,
                          entity_id, site_id, service_id)
  VALUES (gen_random_uuid(),'2026-09-16',60 * 60,'one',
          'a0a0a0a0-0000-4000-8000-0000000000a1','a0a0a0a0-0000-4000-8000-0000000000a1',
          '44444444-0000-4000-8000-000000000002','c5000000-0000-4000-8000-00000000000b',
          'b5000000-0000-4000-8000-000000000055')
$$, 'an entry against Bluegill Accounting''s own Suite 4');

SELECT must_pass($$
  INSERT INTO trip_leg (trip_id, seq, miles, entity_id, site_id, service_id)
  VALUES ((SELECT id FROM trip LIMIT 1),98,60.0,
          '44444444-0000-4000-8000-000000000002','c5000000-0000-4000-8000-00000000000b',
          'b5000000-0000-4000-8000-000000000057')
$$, 'and the miles that got there');

SELECT must_fail($$
  INSERT INTO trip_leg (trip_id, seq, miles, entity_id, site_id, service_id)
  VALUES ((SELECT id FROM trip LIMIT 1),97,60.0,
          '44444444-0000-4000-8000-000000000002','c5000000-0000-4000-8000-000000000001',
          'b5000000-0000-4000-8000-000000000057')
$$, 'charging one client for miles to another client''s site');

-- A time entry's site must be its client's, and so must a leg's. The
-- constraints are the model, and the guard asserts they are there.
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
  ('99999999-0000-4000-8000-000000000001','Noor'),
  ('99999999-0000-4000-8000-000000000002','Felix'),
  ('99999999-0000-4000-8000-000000000003','Hana');

INSERT INTO entity_contact (entity_id, contact_id, is_primary) VALUES
  ('44444444-4444-4444-4444-444444444444','99999999-0000-4000-8000-000000000001',true),
  ('44444444-0000-4000-8000-000000000002','99999999-0000-4000-8000-000000000003',true);

SELECT must_fail($$
  INSERT INTO entity_contact (entity_id, contact_id, is_primary)
  VALUES ('44444444-4444-4444-4444-444444444444','99999999-0000-4000-8000-000000000002',true)
$$, 'a second primary contact for one client');

SELECT must_pass($$
  INSERT INTO entity_contact (entity_id, contact_id, is_primary)
  VALUES ('44444444-4444-4444-4444-444444444444','99999999-0000-4000-8000-000000000002',false)
$$, 'a second contact that is not the primary');

-- The lab has Felix as its own contact; the front office and Yuba have none.
INSERT INTO site_contact (site_id, entity_id, contact_id, is_primary) VALUES
  ('c5000000-0000-4000-8000-00000000000c','44444444-4444-4444-4444-444444444444',
   '99999999-0000-4000-8000-000000000002', true);

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
  IF r IS DISTINCT FROM 'Front office -> Noor (client) | Woodland lab -> Felix | Yuba -> Noor (client)' THEN
    RAISE EXCEPTION 'GUARD MISSING: the fallback resolved to %', r;
  END IF;
  RAISE NOTICE '  resolved  Alder Street Clinic: %', r;
END $$;

-- A SITE MAY NAME SEVERAL PEOPLE, and one of them first: whoever runs it, and
-- whoever else can let a technician in.
SELECT must_pass($$
  INSERT INTO site_contact (site_id, entity_id, contact_id)
  VALUES ('c5000000-0000-4000-8000-00000000000c','44444444-4444-4444-4444-444444444444',
          '99999999-0000-4000-8000-000000000001')
$$, 'a second person at one site');

SELECT must_fail($$
  UPDATE site_contact SET is_primary = true
   WHERE site_id = 'c5000000-0000-4000-8000-00000000000c'
     AND contact_id = '99999999-0000-4000-8000-000000000001'
$$, 'a second person answering first at one site');

-- AND THE PERSON MUST BE THAT CLIENT'S. Hana is Bluegill's contact; naming
-- Hana at one of the clinic's sites is a typo that sends the clinic's work to
-- the wrong person.
SELECT must_fail($$
  INSERT INTO site_contact (site_id, entity_id, contact_id)
  VALUES ('c5000000-0000-4000-8000-00000000000c','44444444-4444-4444-4444-444444444444',
          '99999999-0000-4000-8000-000000000003')
$$, 'naming another client''s contact at a site');

-- Nor can the client be misstated to get around it: the site half of the key
-- has to agree too.
SELECT must_fail($$
  INSERT INTO site_contact (site_id, entity_id, contact_id)
  VALUES ('c5000000-0000-4000-8000-00000000000c','44444444-0000-4000-8000-000000000002',
          '99999999-0000-4000-8000-000000000003')
$$, 'a site filed under a client that is not its own');

-- Same building, other client: a person named at one client's site there is
-- nothing to the other's.
DO $$
DECLARE n int; r text;
BEGIN
  INSERT INTO site_contact (site_id, entity_id, contact_id, is_primary)
  VALUES ('c5000000-0000-4000-8000-000000000001','44444444-4444-4444-4444-444444444444',
          '99999999-0000-4000-8000-000000000001', true);
  SELECT count(*) INTO n FROM site_contact
   WHERE site_id = 'c5000000-0000-4000-8000-00000000000b';
  SELECT c.name INTO r FROM entity_contact ec JOIN contact c ON c.id = ec.contact_id
   WHERE ec.entity_id = '44444444-0000-4000-8000-000000000002' AND ec.is_primary;
  IF n <> 0 OR r <> 'Hana' THEN
    RAISE EXCEPTION 'GUARD MISSING: Suite 4 gained % site contact(s), and falls back to %', n, r;
  END IF;
  RAISE NOTICE '  separate  101 Maple St: Noor at the clinic''s front office, and Suite 4 still goes to Hana';
END $$;

-- A person is still one person. Felix runs the clinic's lab and is on another
-- client's list too -- the reason a contact belongs to no one client.
DO $$
DECLARE n int;
BEGIN
  INSERT INTO entity_contact (entity_id, contact_id)
  VALUES ('44444444-0000-4000-8000-000000000002','99999999-0000-4000-8000-000000000002');
  SELECT count(*) INTO n FROM entity_contact
   WHERE contact_id = '99999999-0000-4000-8000-000000000002';
  IF n <> 2 THEN
    RAISE EXCEPTION 'GUARD MISSING: one person reached % clients, not 2', n;
  END IF;
  RAISE NOTICE '  one person       Felix is a contact for % clients at once', n;
END $$;

-- Taking somebody off a client takes them off that client's sites with them,
-- and leaves them on every other client's list.
DO $$
DECLARE n int; kept int;
BEGIN
  DELETE FROM entity_contact
   WHERE entity_id = '44444444-4444-4444-4444-444444444444'
     AND contact_id = '99999999-0000-4000-8000-000000000002';
  SELECT count(*) INTO n FROM site_contact
   WHERE contact_id = '99999999-0000-4000-8000-000000000002';
  SELECT count(*) INTO kept FROM entity_contact
   WHERE contact_id = '99999999-0000-4000-8000-000000000002';
  IF n <> 0 THEN
    RAISE EXCEPTION 'GUARD MISSING: % site rows outlived the client attachment', n;
  END IF;
  IF kept <> 1 THEN
    RAISE EXCEPTION 'GUARD MISSING: leaving one client left Felix with % others, not 1', kept;
  END IF;
  RAISE NOTICE '  follows          off the client is off the client''s sites, and still the other''s';
END $$;

-- One address, two clients, each naming it for themselves.
DO $$
DECLARE a text; b text;
BEGIN
  SELECT label INTO a FROM site WHERE id = 'c5000000-0000-4000-8000-000000000001';
  SELECT label INTO b FROM site WHERE id = 'c5000000-0000-4000-8000-00000000000b';
  IF a <> 'Front office' OR b <> 'Suite 4' THEN
    RAISE EXCEPTION 'GUARD MISSING: one address gave % and %', a, b;
  END IF;
  RAISE NOTICE '  named     101 Maple St is "%" to Alder Street Clinic and "%" to Bluegill Accounting', a, b;
END $$;

\echo ''
\echo '=== 19. the rate is CDTFA''s, per address, and every answer is kept ==='

-- THERE IS NO SUCH THING AS AN UNPRICED SITE. A site is a place work is
-- billed from, and a place that cannot be priced cannot be billed from -- so
-- the schema refuses one rather than leaving every screen a branch describing
-- the gap.
SELECT must_fail($$
  INSERT INTO site (id, entity_id, label, slug, street, city, region, postcode)
  VALUES (gen_random_uuid(),'44444444-4444-4444-4444-444444444444','No rate','no-rate',
          '9 Somewhere Rd','Columbia','CA','95310')
$$, 'a site with no CDTFA rate');

SELECT must_fail($$
  INSERT INTO site (id, entity_id, label, slug, city, region, postcode,
                    tax_jurisdiction, tax_rate_pct, state_rate_pct, district_rate_pct,
                  tax_area_code, area_verified_on)
  VALUES (gen_random_uuid(),'44444444-4444-4444-4444-444444444444','No street','no-street',
          'Columbia','CA','95310',
          'UNINCORPORATED AREA-TUOLUMNE', 7.2500, 7.2500, 0.0000, '559980000000', current_date)
$$, 'a site with no street to look up');

SELECT must_fail($$
  INSERT INTO site (id, entity_id, label, slug, street, city, region, postcode,
                    tax_jurisdiction, tax_rate_pct, state_rate_pct, district_rate_pct,
                  tax_area_code, area_verified_on)
  VALUES (gen_random_uuid(),'44444444-4444-4444-4444-444444444444','Blank postcode','blank-postcode',
          '11255 Jackson St','Columbia','CA','',
          'UNINCORPORATED AREA-TUOLUMNE', 7.2500, 7.2500, 0.0000, '559980000000', current_date)
$$, 'a postcode that is present but empty');

-- What the API said, written down against the address it was said about.
INSERT INTO site_tax_check (site_id, tax_area_code, tax_jurisdiction, rate_pct, changed)
VALUES ('33333333-3333-3333-3333-333333333333','510510000000','YUBA CITY',
        7.2500, true);
UPDATE site SET tax_rate_pct = 7.2500, tax_jurisdiction = 'YUBA CITY',
                tax_area_code = '510510000000', area_verified_on = current_date
 WHERE id = '33333333-3333-3333-3333-333333333333';

-- Every answer is kept, so a rate that moved can be explained against the
-- invoices billed at the old one.
DO $$
DECLARE n bigint; moved bigint;
BEGIN
  -- Yuba City's answer in 2016, when the statewide rate was 7.50%.
  INSERT INTO site_tax_check (site_id, checked_at, tax_area_code, tax_jurisdiction,
                              rate_pct, changed)
  VALUES ('33333333-3333-3333-3333-333333333333','2016-06-01','510510000000','YUBA CITY',
          7.5000, true);

  SELECT count(*), count(*) FILTER (WHERE changed) INTO n, moved FROM site_tax_check
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
  INSERT INTO site (id, entity_id, label, slug, street, city, region, postcode,
                  tax_jurisdiction, tax_rate_pct, state_rate_pct, district_rate_pct,
                  tax_area_code, area_verified_on)
VALUES ('c5000000-0000-4000-8000-0000000000fe','44444444-0000-4000-8000-000000000002','Gone','gone',
        '11255 Jackson St','Columbia','CA','95310',
        'UNINCORPORATED AREA-TUOLUMNE', 7.2500, 7.2500, 0.0000, '559980000000', current_date);
  INSERT INTO site_tax_check (site_id, rate_pct) VALUES
    ('c5000000-0000-4000-8000-0000000000fe', 7.2500);
  DELETE FROM site WHERE id = 'c5000000-0000-4000-8000-0000000000fe';
  SELECT count(*) INTO n FROM site_tax_check
   WHERE site_id = 'c5000000-0000-4000-8000-0000000000fe';
  IF n <> 0 THEN
    RAISE EXCEPTION 'GUARD MISSING: % answers outlived the address', n;
  END IF;
  RAISE NOTICE '  follows   answers go with the address they describe';
END $$;

-- The rate comes apart the way CDTFA publishes it, and the parts ARE the
-- total: in its rate layer State + County + City = RATE for every
-- jurisdiction, so this is arithmetic rather than an apportionment, and the
-- schema can insist on it.
SELECT must_fail($$
  UPDATE site SET district_rate_pct = 1.0000
   WHERE id = 'c5000000-0000-4000-8000-00000000000c'
$$, 'parts that do not add up to the rate charged');

SELECT must_pass($$
  UPDATE site SET tax_rate_pct = 8.0000,
                  state_rate_pct = 7.2500, district_rate_pct = 0.7500
   WHERE id = 'c5000000-0000-4000-8000-00000000000c'
$$, 'parts that do add up');

-- WHAT WAS HANDED OVER IS RECORDED, NOT DERIVED. Nothing in the invoices can
-- say whether a return was actually paid.
SELECT must_fail($$
  INSERT INTO tax_remittance (period_start, period_end, amount, created_by)
  VALUES ('2026-09-30','2026-07-01', 100.00, 'a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'a filing period that ends before it starts');

SELECT must_pass($$
  INSERT INTO tax_remittance (period_start, period_end, filed_on, paid_on, amount, created_by)
  VALUES ('2026-07-01','2026-09-30','2026-10-20','2026-10-20', 4.42,
          'a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'a return filed and paid');

SELECT must_fail($$
  INSERT INTO tax_remittance (period_start, period_end, amount, created_by)
  VALUES ('2026-07-01','2026-09-30', 4.42, 'a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'a second filing for the same period');

SELECT must_fail($$
  INSERT INTO tax_remittance (period_start, period_end, amount, created_by)
  VALUES ('2026-10-01','2026-12-31', -1.00, 'a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'handing over a negative amount');

-- A CLIENT AND A SITE ARE NAMEABLE IN A URL, and the name is set once rather
-- than following the record. Renaming must not move a link somebody kept.
DO $$
DECLARE before_slug text; after_slug text;
BEGIN
  SELECT slug INTO before_slug FROM entity
   WHERE id = '44444444-4444-4444-4444-444444444444';
  UPDATE entity SET name = 'Alder Street Clinic Inc'
   WHERE id = '44444444-4444-4444-4444-444444444444';
  SELECT slug INTO after_slug FROM entity
   WHERE id = '44444444-4444-4444-4444-444444444444';
  IF before_slug IS DISTINCT FROM after_slug THEN
    RAISE EXCEPTION 'GUARD MISSING: renaming moved the URL from % to %', before_slug, after_slug;
  END IF;
  RAISE NOTICE '  stays put renaming a client left /clients/% alone', after_slug;
END $$;

-- Two of a name cannot be one URL. The app numbers the second -2 (its
-- slugs.test.ts); the database is what makes sure nothing else can.
SELECT must_pass($$
  INSERT INTO entity (name, slug) VALUES ('Duplicate Name', 'duplicate-name')
$$, 'a client and its URL');

SELECT must_fail($$
  INSERT INTO entity (name, slug) VALUES ('Duplicate Name', 'duplicate-name')
$$, 'a second client at the same URL');

-- A site's URL is unique within its client and nowhere else: two clients may
-- both have a yuba, and they are different places.
DO $$
DECLARE n int;
BEGIN
  INSERT INTO site (entity_id, label, slug, street, city, region, postcode,
                    tax_jurisdiction, tax_rate_pct, state_rate_pct, district_rate_pct,
                    tax_area_code, area_verified_on)
  VALUES ('44444444-0000-4000-8000-000000000002','Yuba','yuba','1201 Civic Center Blvd',
          'Yuba City','CA','95993',
          'YUBA CITY', 7.2500, 7.2500, 0.0000, '510510000000', current_date);
  SELECT count(DISTINCT entity_id) INTO n FROM site WHERE slug = 'yuba';
  IF n < 2 THEN
    RAISE EXCEPTION 'GUARD MISSING: only % client(s) have a site called yuba', n;
  END IF;
  RAISE NOTICE '  per client % clients each have their own /sites/yuba', n;
END $$;

SELECT must_fail($$
  INSERT INTO site (entity_id, label, slug, street, city, region, postcode,
                    tax_jurisdiction, tax_rate_pct, state_rate_pct, district_rate_pct,
                    tax_area_code, area_verified_on)
  VALUES ('44444444-4444-4444-4444-444444444444','Another Yuba','yuba',
          '1201 Civic Center Blvd','Yuba City','CA','95993',
          'YUBA CITY', 7.2500, 7.2500, 0.0000, '510510000000', current_date)
$$, 'two sites of one client sharing a URL');

SELECT must_fail($$
  UPDATE entity SET slug = 'Not A Slug' WHERE id = '44444444-4444-4444-4444-444444444444'
$$, 'a slug that is not a slug');

\echo '=== 20. a site says where it is, and a deletion leaves a record ==='

DO $$
DECLARE office text; coloma text; yuba text;
BEGIN
  SELECT display INTO office FROM site WHERE id = 'c5000000-0000-4000-8000-000000000001';
  SELECT display INTO coloma FROM site WHERE id = 'c5000000-0000-4000-8000-00000000000a';
  SELECT display INTO yuba FROM site WHERE id = '33333333-3333-3333-3333-333333333333';

  IF office <> 'Front office, Auburn' THEN
    RAISE EXCEPTION 'GUARD MISSING: a name that hides the city gave %', office;
  END IF;
  IF coloma <> 'Coloma' THEN
    RAISE EXCEPTION 'GUARD MISSING: a name equal to the city gave %', coloma;
  END IF;
  IF yuba <> 'Yuba' THEN
    RAISE EXCEPTION 'GUARD MISSING: a name inside the city gave %', yuba;
  END IF;
  RAISE NOTICE '  says where %, and % / % are left alone', office, coloma, yuba;
END $$;

-- An entry that has been billed cannot go; the invoice is built from it.
DO $$
DECLARE t uuid; n int;
BEGIN
  INSERT INTO time_entry (client_uuid, worked_on, seconds, crew, worked_by, created_by,
                          entity_id, site_id, service_id)
  VALUES (gen_random_uuid(),'2026-09-16',30 * 60,'one',
          'a0a0a0a0-0000-4000-8000-0000000000a1','a0a0a0a0-0000-4000-8000-0000000000a1',
          '44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',
          'b5000000-0000-4000-8000-000000000055')
  RETURNING id INTO t;

  PERFORM set_config('reckon.user_id', 'a0a0a0a0-0000-4000-8000-0000000000a1', true);
  DELETE FROM time_entry WHERE id = t;

  SELECT count(*) INTO n FROM record_history
   WHERE table_name = 'time_entry' AND row_id = t AND field = '(deleted)'
     AND changed_by = 'a0a0a0a0-0000-4000-8000-0000000000a1';
  IF n <> 1 THEN
    RAISE EXCEPTION 'GUARD MISSING: deleting an entry left % record(s)', n;
  END IF;
  RAISE NOTICE '  recorded  a deleted entry is kept in full in record_history';
END $$;

-- Built explicitly: a WHERE that matches nothing deletes nothing and raises
-- nothing, which reads as a guard holding when it was never exercised.
INSERT INTO time_entry (id, client_uuid, worked_on, seconds, crew, worked_by, created_by,
                        entity_id, site_id, service_id)
VALUES ('7777cccc-7777-7777-7777-777777777777', gen_random_uuid(),'2026-09-16',120 * 60,'one',
        'a0a0a0a0-0000-4000-8000-0000000000a1','a0a0a0a0-0000-4000-8000-0000000000a1',
        '44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',
        'b5000000-0000-4000-8000-000000000055');

INSERT INTO invoice (id, number, entity_id, created_by) VALUES
  ('7777dddd-7777-7777-7777-777777777777','KFS-0421',
   '44444444-4444-4444-4444-444444444444','a0a0a0a0-0000-4000-8000-0000000000a1');
INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, unit, amount,
                          time_entry_id)
VALUES ('7777dddd-7777-7777-7777-777777777777',1,'service','Field service',2.00,95.00,'hour',190.00,
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
  INSERT INTO session (token, user_id, expires_at)
  VALUES ('deadbeef','a0a0a0a0-0000-4000-8000-0000000000a1', now() - interval '1 day')
$$, 'a session that expired before it began');

SELECT must_pass($$
  INSERT INTO session (token, user_id, expires_at)
  VALUES ('aaaa','a0a0a0a0-0000-4000-8000-0000000000a1', now() + interval '30 days')
$$, 'a session for a real person');

SELECT must_fail($$
  INSERT INTO session (token, user_id, expires_at)
  VALUES ('bbbb','99999999-9999-9999-9999-999999999999', now() + interval '30 days')
$$, 'a session for somebody who does not exist');

SELECT must_fail($$
  INSERT INTO session (token, user_id, expires_at)
  VALUES ('aaaa','a0a0a0a0-0000-4000-8000-0000000000a2', now() + interval '30 days')
$$, 'two sessions sharing one token');

-- Deleting a person must not leave their sessions behind able to sign in.
DO $$
DECLARE n int;
BEGIN
  INSERT INTO "user" (id, name, email)
  VALUES ('a1000000-0000-4000-8000-000000000001','Temp','temp@example.com');
  INSERT INTO session (token, user_id, expires_at)
  VALUES ('cccc','a1000000-0000-4000-8000-000000000001', now() + interval '1 day');
  DELETE FROM "user" WHERE id = 'a1000000-0000-4000-8000-000000000001';
  SELECT count(*) INTO n FROM session WHERE token = 'cccc';
  IF n <> 0 THEN
    RAISE EXCEPTION 'GUARD MISSING: a deleted person kept % session(s)', n;
  END IF;
  RAISE NOTICE '  cascades  removing a person removes their sessions';
END $$;

\echo ''
\echo '=== 22. an address is a place, wherever it is kept ==='

-- A site has a place id, and so does the operator.
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

\echo ''
\echo '=== 23. an allotment says what it is, and pay says who it pays ==='

-- An allotment is only ever an agreement's, and it is whole there or not at
-- all.

SELECT must_fail($$
  UPDATE agreement_service SET allotment = 'unlimited'
   WHERE agreement_id = 'bbbbbbbb-0000-4000-8000-000000000004'
$$, 'unlimited while a cap is still recorded');

SELECT must_fail($$
  UPDATE agreement_service SET allotment = 'capped'
   WHERE agreement_id = 'bbbbbbbb-0000-4000-8000-000000000001'
$$, 'capped with no hours to cap it at');

SELECT must_fail($$
  INSERT INTO agreement_service (agreement_id, service_id, allotment, included_hours)
  VALUES ('bbbbbbbb-0000-4000-8000-000000000004','b5000000-0000-4000-8000-000000000055',
          'capped', 2.00)
$$, 'capped hours with no rule for exceeding them');

-- A rule can name a role or one person: Sam has a rule of his own beside the
-- partners'.
SELECT must_pass($$
  INSERT INTO pay_rule (service_id, user_id, pays_for, method, amount, effective_from)
  VALUES ('b5000000-0000-4000-8000-000000000056','a0a0a0a0-0000-4000-8000-0000000000a2',
          'time','per_hour', 40.00, '2026-09-01')
$$, 'a rule for one person');

SELECT must_fail($$
  INSERT INTO pay_rule (service_id, user_id, pays_for, method, amount, effective_from)
  VALUES ('b5000000-0000-4000-8000-000000000056','a0a0a0a0-0000-4000-8000-0000000000a2',
          'time','per_hour', 45.00, '2026-09-01')
$$, 'two rules for one person, one service, one day');

-- The partners' rule names no person and no client. Two of those on one day
-- are the same two answers -- blanks are not a way round the key.
SELECT must_fail($$
  INSERT INTO pay_rule (service_id, role_id, pays_for, method, amount, effective_from)
  VALUES ('b5000000-0000-4000-8000-000000000056',(SELECT id FROM role WHERE name = 'Partner'),
          'time','per_hour', 30.00, '2026-08-15')
$$, 'a second rule for the partners, same service and day');

DO $$
DECLARE n int;
BEGIN
  INSERT INTO "user" (id, name, email)
  VALUES ('a1000000-0000-4000-8000-00000000000b','Leaver','leaver@example.com');
  INSERT INTO pay_rule (service_id, user_id, pays_for, method, amount, effective_from)
  VALUES ('b5000000-0000-4000-8000-000000000056','a1000000-0000-4000-8000-00000000000b',
          'time','per_hour', 60.00, '2026-09-01');

  DELETE FROM "user" WHERE id = 'a1000000-0000-4000-8000-00000000000b';
  SELECT count(*) INTO n FROM pay_rule
   WHERE user_id = 'a1000000-0000-4000-8000-00000000000b';
  IF n <> 0 THEN
    RAISE EXCEPTION 'GUARD MISSING: a departed person left % pay row(s)', n;
  END IF;
  RAISE NOTICE '  cascades           removing a person removes what they were paid at';
END $$;

\echo ''
\echo '=== 24. the rest of what the operator supplies ==='

SELECT must_fail($$
  UPDATE operator SET filing_basis = 'fortnightly'
$$, 'a filing basis no agency offers');

SELECT must_fail($$
  UPDATE operator SET fiscal_year_end_month = 13
$$, 'a thirteenth month');

SELECT must_pass($$
  UPDATE operator SET filing_basis = 'quarterly', fiscal_year_end_month = 12,
                      tax_registration = 'Seller''s permit', tax_agency = 'CDTFA'
$$, 'quarterly, the year ending in December, on a CDTFA seller''s permit');

-- A logo is described in the history, never copied into it (#28): its length
-- and SHA-256, against whoever changed it.
SELECT set_config('reckon.user_id','a0a0a0a0-0000-4000-8000-0000000000a1',false);
UPDATE operator SET logo = convert_to('<svg xmlns="http://www.w3.org/2000/svg"/>', 'UTF8'),
                    logo_media_type = 'image/svg+xml';
DO $$
DECLARE
  r record;
  file bytea := convert_to('<svg xmlns="http://www.w3.org/2000/svg"/>', 'UTF8');
BEGIN
  SELECT * INTO r FROM record_history
   WHERE table_name = 'operator' AND field = 'logo' ORDER BY id DESC LIMIT 1;
  IF r IS NULL THEN RAISE EXCEPTION 'GUARD MISSING: the logo change was not recorded'; END IF;
  IF r.new_value IS DISTINCT FROM
     octet_length(file)::text || ' bytes, sha256 ' || encode(sha256(file), 'hex') THEN
    RAISE EXCEPTION 'GUARD MISSING: the logo went into the history as "%"', left(r.new_value, 40);
  END IF;
  IF r.changed_by IS DISTINCT FROM 'a0a0a0a0-0000-4000-8000-0000000000a1' THEN
    RAISE EXCEPTION 'GUARD MISSING: the logo change was recorded against the wrong user';
  END IF;
  RAISE NOTICE '  recorded  the logo as "%"', r.new_value;
END $$;
SELECT set_config('reckon.user_id','a0a0a0a0-0000-4000-8000-0000000000a2',false);

-- How legs are HANDED OUT is not what a leg IS. The two vocabularies are
-- separate on purpose, and neither accepts the other's words.
SELECT must_fail($$
  UPDATE operator SET mileage_assignment = 'a_to_b'
$$, 'a leg kind used as an assignment policy');

SELECT must_fail($$
  INSERT INTO trip (id, travelled_on, driven_by, created_by)
  VALUES ('dddddddd-0000-4000-8000-000000000001','2026-08-24',
          'a0a0a0a0-0000-4000-8000-0000000000a1','a0a0a0a0-0000-4000-8000-0000000000a1');
  INSERT INTO trip_leg (trip_id, seq, miles, rule)
  VALUES ('dddddddd-0000-4000-8000-000000000001', 1, 12.0, 'actual')
$$, 'an assignment policy used as a leg kind');

SELECT must_fail($$
  INSERT INTO integration (name) VALUES ('quickbooks')
$$, 'an integration nobody wired up');

SELECT must_pass($$
  INSERT INTO integration (name, connected, detail) VALUES ('beancount', true, 'accounts/kestrel.beancount')
$$, 'the ledger, and where it lives');

-- An agreement may only name its own client's contact, as a site may.
INSERT INTO contact (id, name) VALUES
  ('ce000000-0000-4000-8000-00000000000f','Somebody else entirely');

SELECT must_fail($$
  UPDATE agreement SET contact_id = 'ce000000-0000-4000-8000-00000000000f'
   WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'
$$, 'an agreement naming somebody who is not the client''s contact');

-- An agreement is agreed with somebody. Losing the person must not lose it.
DO $$
DECLARE who uuid; still int;
BEGIN
  INSERT INTO contact (id, name) VALUES ('ce000000-0000-4000-8000-000000000001','Ivo Brandt');
  -- Ivo negotiated it, so Ivo is the client's contact. The agreement cannot
  -- name Ivo before that is recorded -- same confinement as a site's.
  INSERT INTO entity_contact (entity_id, contact_id)
  VALUES ('44444444-0000-4000-8000-000000000003','ce000000-0000-4000-8000-000000000001');
  UPDATE agreement SET contact_id = 'ce000000-0000-4000-8000-000000000001'
   WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001';

  DELETE FROM contact WHERE id = 'ce000000-0000-4000-8000-000000000001';

  SELECT contact_id INTO who FROM agreement
   WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001';
  SELECT count(*) INTO still FROM agreement
   WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001';

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

-- The charge falls on the agreement's own day, which is said when it is made
-- -- the app takes it from the start day -- rather than guessed later.
SELECT must_fail($$
  INSERT INTO agreement (entity_id, price, starts_on)
  VALUES ('44444444-0000-4000-8000-000000000003', 50.00, '2026-09-12')
$$, 'an agreement with no day to bill on');

SELECT must_fail($$
  UPDATE agreement SET billing_anchor_day = 32
   WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'
$$, 'a day no month has');

SELECT must_fail($$
  UPDATE agreement SET billing_interval = 'fortnightly'
   WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'
$$, 'an interval nobody bills on');

-- Proration is a question about ending. A period that starts when the
-- agreement starts cannot be partial at the front.
DO $$
DECLARE n int; d text;
BEGIN
  SELECT final_period_proration INTO d FROM agreement
   WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001';
  IF d <> 'daily' THEN
    RAISE EXCEPTION 'GUARD MISSING: an unfinished period should bill the days had, got %', d;
  END IF;
  RAISE NOTICE '  on the contract  proration is the agreement''s term, and defaults to daily';
END $$;

SELECT must_fail($$
  UPDATE agreement SET final_period_proration = 'weekly'
   WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'
$$, 'a proration rule that is neither whole nor by the day');

\echo ''
\echo '=== 26. a pay rule pays somebody, in a way that adds up ==='

INSERT INTO service (id, code, name, unit, bill_to_nearest_seconds) VALUES
  ('b5000000-0000-4000-8000-00000000005c','callout','Call-out','hour',60),
  ('b5000000-0000-4000-8000-00000000005d','standby','Standby','hour',60);

SELECT must_fail($$
  INSERT INTO pay_rule (service_id, role_id, user_id, pays_for, method, amount, effective_from)
  VALUES ('b5000000-0000-4000-8000-00000000005c',(SELECT id FROM role WHERE name = 'Partner'),
          'a0a0a0a0-0000-4000-8000-0000000000a2','time','per_hour',50,'2026-10-01')
$$, 'a rule naming both a role and a person');

SELECT must_fail($$
  INSERT INTO pay_rule (service_id, pays_for, method, amount, effective_from)
  VALUES ('b5000000-0000-4000-8000-00000000005c','time','per_hour',50,'2026-10-01')
$$, 'a rule naming nobody');

SELECT must_fail($$
  INSERT INTO pay_rule (service_id, role_id, pays_for, method, amount, effective_from)
  VALUES ('b5000000-0000-4000-8000-00000000005c',(SELECT id FROM role WHERE name = 'Partner'),
          'time','percent',101,'2026-10-01')
$$, 'more than the whole line');

SELECT must_fail($$
  INSERT INTO pay_rule (service_id, role_id, pays_for, method, amount, effective_from)
  VALUES ('b5000000-0000-4000-8000-00000000005c',(SELECT id FROM role WHERE name = 'Partner'),
          'time','nothing',5,'2026-10-01')
$$, 'nothing, with an amount');

SELECT must_fail($$
  INSERT INTO pay_rule (service_id, role_id, pays_for, method, amount, effective_from)
  VALUES ('b5000000-0000-4000-8000-00000000005c',(SELECT id FROM role WHERE name = 'Partner'),
          'time','per_hour',NULL,'2026-10-01')
$$, 'an hourly rate with no amount');

-- Each method, properly formed.
SELECT must_pass($$
  INSERT INTO pay_rule (service_id, user_id, pays_for, method, amount, effective_from)
  VALUES ('b5000000-0000-4000-8000-00000000005c','a0a0a0a0-0000-4000-8000-0000000000a1',
          'time','per_hour',45,'2026-10-01')
$$, 'per hour: $45.00 an hour to Avery');

SELECT must_pass($$
  INSERT INTO pay_rule (service_id, user_id, pays_for, method, amount, effective_from)
  VALUES ('b5000000-0000-4000-8000-00000000005c','a0a0a0a0-0000-4000-8000-0000000000a2',
          'time','percent',100,'2026-10-01')
$$, 'percent: the whole line to Sam');

SELECT must_pass($$
  INSERT INTO pay_rule (service_id, role_id, entity_id, pays_for, method, amount, effective_from)
  VALUES ('b5000000-0000-4000-8000-00000000005c',(SELECT id FROM role WHERE name = 'Partner'),
          '44444444-0000-4000-8000-000000000002','time','fixed',15,'2026-10-01')
$$, 'fixed: $15.00 an entry to a partner, at Bluegill Accounting');

SELECT must_pass($$
  INSERT INTO pay_rule (service_id, user_id, entity_id, pays_for, method, effective_from)
  VALUES ('b5000000-0000-4000-8000-00000000005c','a0a0a0a0-0000-4000-8000-0000000000a2',
          '44444444-0000-4000-8000-000000000002','time','nothing','2026-10-01')
$$, 'nothing: to Sam, at Bluegill Accounting');

\echo ''
\echo '=== 27. only time is billed to an increment ==='

SELECT must_fail($$
  UPDATE service SET bill_to_nearest_seconds = 60 WHERE code = 'travel'
$$, 'a mile billed to the nearest minute');

SELECT must_pass($$
  UPDATE service SET bill_to_nearest_seconds = 900 WHERE code = 'weekend'
$$, 'an hour billed to the nearest quarter');

\echo ''
\echo '=== 28. a role is the operator''s own word, said once ==='

SELECT must_fail($$
  INSERT INTO role (name) VALUES ('   ')
$$, 'a role with no name');

SELECT must_fail($$
  INSERT INTO role (name) VALUES ('Partner')
$$, 'a second Partner');

SELECT must_pass($$
  INSERT INTO role (name) VALUES ('Apprentice')
$$, 'a role the business names for itself');

\echo ''
\echo '=== 29. a billed leg says what it bills as ==='

SELECT must_fail($$
  INSERT INTO trip_leg (trip_id, seq, miles, entity_id)
  VALUES ('88888888-8888-8888-8888-888888888888', 50, 10.0,
          '44444444-4444-4444-4444-444444444444')
$$, 'a leg billed to Alder Street with no service to price it');

SELECT must_pass($$
  INSERT INTO trip_leg (trip_id, seq, miles)
  VALUES ('88888888-8888-8888-8888-888888888888', 51, 10.0)
$$, 'a leg billed to nobody, and so no service');

\echo ''
\echo '=== 30. covered time is paid as a share of the retainer ==='

-- Covered hours are paid as a percentage of the retainer, split between however
-- many answered -- so a covered-time rule is a percentage, or nothing.
INSERT INTO service (id, code, name, unit, bill_to_nearest_seconds)
VALUES ('b5000000-0000-4000-8000-0000000000a1','retained','Retained work','hour',60);

SELECT must_fail($$
  INSERT INTO pay_rule (service_id, role_id, pays_for, method, amount, effective_from)
  VALUES ('b5000000-0000-4000-8000-0000000000a1',(SELECT id FROM role WHERE name = 'Partner'),
          'covered_time','per_hour',22.00,'2026-01-01')
$$, 'covered time paid by the hour -- it is paid as a share of the retainer');

SELECT must_fail($$
  INSERT INTO pay_rule (service_id, role_id, pays_for, method, amount, effective_from)
  VALUES ('b5000000-0000-4000-8000-0000000000a1',(SELECT id FROM role WHERE name = 'Partner'),
          'covered_time','fixed',22.00,'2026-01-01')
$$, 'covered time paid a fixed amount');

SELECT must_pass($$
  INSERT INTO pay_rule (service_id, role_id, pays_for, method, amount, effective_from)
  VALUES ('b5000000-0000-4000-8000-0000000000a1',(SELECT id FROM role WHERE name = 'Partner'),
          'covered_time','percent',16,'2026-01-01')
$$, 'covered time paid 16% of the retainer');

-- An unlimited retainer, charged for October, for the guards below.
INSERT INTO entity (id, name, slug) VALUES
  ('44444444-0000-4000-8000-0000000000a1','Retained Co','retained-co');
INSERT INTO agreement (id, entity_id, price, starts_on, billing_anchor_day) VALUES
  ('bbbbbbbb-0000-4000-8000-0000000000a1','44444444-0000-4000-8000-0000000000a1',250.00,'2026-10-01',1);
INSERT INTO agreement_service (agreement_id, service_id, allotment) VALUES
  ('bbbbbbbb-0000-4000-8000-0000000000a1','b5000000-0000-4000-8000-0000000000a1','unlimited');
INSERT INTO agreement_period (agreement_id, period_start, period_end, amount) VALUES
  ('bbbbbbbb-0000-4000-8000-0000000000a1','2026-10-01','2026-10-31',250.00);

\echo ''
\echo '=== 31. a given period charges nothing ==='

-- A period can be given: covered, and charged nothing, on purpose.
SELECT must_fail($$
  INSERT INTO agreement_period (agreement_id, period_start, period_end, amount, given)
  VALUES ('bbbbbbbb-0000-4000-8000-0000000000a1','2026-12-01','2026-12-31',250.00,true)
$$, 'a given month that charges something');

SELECT must_pass($$
  INSERT INTO agreement_period (agreement_id, period_start, period_end, amount, given)
  VALUES ('bbbbbbbb-0000-4000-8000-0000000000a1','2026-11-01','2026-11-30',0.00,true)
$$, 'November given');

\echo ''
\echo '=== 32. an agreement is for its own client''s site, and a held role stays ==='

-- An agreement for Alder Street, at a site that belongs to Bluegill Accounting.
SELECT must_fail($$
  INSERT INTO agreement (entity_id, site_id, price, starts_on, billing_anchor_day)
  VALUES ('44444444-4444-4444-4444-444444444444','c5000000-0000-4000-8000-00000000000b',
          100.00, '2026-11-01', 1)
$$, 'an agreement for another client''s site');

SELECT must_pass($$
  INSERT INTO agreement (entity_id, site_id, price, starts_on, billing_anchor_day)
  VALUES ('44444444-0000-4000-8000-000000000002','c5000000-0000-4000-8000-00000000000b',
          100.00, '2026-11-01', 1)
$$, 'an agreement for one of its own client''s sites');

-- Taking a role away from under the people who hold it would leave them paid
-- by nothing; the editor says so, because the schema refuses.
SELECT must_fail($$
  DELETE FROM role WHERE name = 'Partner'
$$, 'deleting a role somebody holds');

\echo ''
\echo '=== 33. a person keeps a clock and a week that exist ==='

SELECT must_fail($$
  UPDATE "user" SET hour_cycle = 'h24' WHERE id = 'a0a0a0a0-0000-4000-8000-0000000000a1'
$$, 'a clock nobody keeps');

SELECT must_pass($$
  UPDATE "user" SET hour_cycle = 'h23' WHERE id = 'a0a0a0a0-0000-4000-8000-0000000000a1'
$$, 'a 24-hour clock');

SELECT must_fail($$
  UPDATE "user" SET week_start = 8 WHERE id = 'a0a0a0a0-0000-4000-8000-0000000000a1'
$$, 'an eighth day to start the week on');

SELECT must_pass($$
  UPDATE "user" SET week_start = 7, locale = 'en-GB' WHERE id = 'a0a0a0a0-0000-4000-8000-0000000000a1'
$$, 'a week from Sunday, in British English');

\echo ''
\echo '=== 34. an entry keeps its start and end, and its length is theirs ==='

SELECT must_pass($$
  INSERT INTO time_entry (client_uuid, worked_on, seconds, started_at, ended_at, zone, crew,
                          worked_by, created_by, entity_id, site_id, service_id)
  VALUES ('a1000000-0000-4000-8000-000000000034','2026-09-16', 9600,
          '2026-09-16 09:00-07', '2026-09-16 11:40-07', 'America/Los_Angeles','one',
          'a0a0a0a0-0000-4000-8000-0000000000a1','a0a0a0a0-0000-4000-8000-0000000000a1',
          '44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',
          'b5000000-0000-4000-8000-000000000055')
$$, '9:00 to 11:40 in Los Angeles, 9,600 seconds');

SELECT must_fail($$
  INSERT INTO time_entry (client_uuid, worked_on, seconds, started_at, ended_at, zone, crew,
                          worked_by, created_by, entity_id, site_id, service_id)
  VALUES (gen_random_uuid(),'2026-09-16', 9000,
          '2026-09-16 09:00-07', '2026-09-16 11:40-07', 'America/Los_Angeles','one',
          'a0a0a0a0-0000-4000-8000-0000000000a1','a0a0a0a0-0000-4000-8000-0000000000a1',
          '44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',
          'b5000000-0000-4000-8000-000000000055')
$$, 'a length that is not its times');

SELECT must_fail($$
  INSERT INTO time_entry (client_uuid, worked_on, seconds, started_at, ended_at, zone, crew,
                          worked_by, created_by, entity_id, site_id, service_id)
  VALUES (gen_random_uuid(),'2026-09-16', 9600,
          '2026-09-16 11:40-07', '2026-09-16 09:00-07', 'America/Los_Angeles','one',
          'a0a0a0a0-0000-4000-8000-0000000000a1','a0a0a0a0-0000-4000-8000-0000000000a1',
          '44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',
          'b5000000-0000-4000-8000-000000000055')
$$, 'an end before its start');

SELECT must_fail($$
  INSERT INTO time_entry (client_uuid, worked_on, seconds, started_at, ended_at, crew,
                          worked_by, created_by, entity_id, site_id, service_id)
  VALUES (gen_random_uuid(),'2026-09-16', 9600,
          '2026-09-16 09:00-07', '2026-09-16 11:40-07','one',
          'a0a0a0a0-0000-4000-8000-0000000000a1','a0a0a0a0-0000-4000-8000-0000000000a1',
          '44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',
          'b5000000-0000-4000-8000-000000000055')
$$, 'times with no zone to show them in');

SELECT must_fail($$
  INSERT INTO time_entry (client_uuid, worked_on, seconds, started_at, zone, crew,
                          worked_by, created_by, entity_id, site_id, service_id)
  VALUES (gen_random_uuid(),'2026-09-16', 9600,
          '2026-09-16 09:00-07', 'America/Los_Angeles','one',
          'a0a0a0a0-0000-4000-8000-0000000000a1','a0a0a0a0-0000-4000-8000-0000000000a1',
          '44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',
          'b5000000-0000-4000-8000-000000000055')
$$, 'a start with no end');

SELECT must_fail($$
  INSERT INTO time_entry (client_uuid, worked_on, seconds, crew,
                          worked_by, created_by, entity_id, site_id, service_id)
  VALUES (gen_random_uuid(),'2026-09-16', 0,'one',
          'a0a0a0a0-0000-4000-8000-0000000000a1','a0a0a0a0-0000-4000-8000-0000000000a1',
          '44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',
          'b5000000-0000-4000-8000-000000000055')
$$, 'work that took no time');

\echo ''
\echo '=== 35. the operator names its own units, and a material is counted in one ==='

SELECT must_pass($$
  INSERT INTO unit (name, short, places) VALUES ('gallon', 'gal', 2)
$$, 'a gallon, to two places');

SELECT must_fail($$
  INSERT INTO unit (name, places) VALUES ('gallon', 0)
$$, 'a second gallon');

SELECT must_fail($$
  INSERT INTO unit (name, places) VALUES ('grain', 5)
$$, 'more places than a quantity holds');

SELECT must_fail($$
  INSERT INTO unit (name, places) VALUES ('   ', 0)
$$, 'a unit with no name');

SELECT must_fail($$
  INSERT INTO material (name) VALUES ('Counted in nothing')
$$, 'a material counted in nothing');

SELECT must_fail($$
  DELETE FROM unit WHERE name = 'foot'
$$, 'taking away a unit stock is counted in');

SELECT must_pass($$
  DELETE FROM unit WHERE name = 'gallon'
$$, 'and letting go of one nothing is counted in');

\echo ''
\echo '=== 36. a lot keeps what its receipt says, and who paid ==='

SELECT must_pass($$
  INSERT INTO material_lot (material_id, received_on, supplier, qty_received, qty_remaining,
                            ex_tax_cost, tax_paid, paid_by, receipt, receipt_type)
  VALUES ('66666666-6666-6666-6666-666666666666','2026-09-30','Delta Wholesale',1000,1000,
          310.00,24.80,'a0a0a0a0-0000-4000-8000-0000000000a1','\xffd8ffe0'::bytea,'image/jpeg')
$$, '1,000 ft for 310.00 and 24.80, paid by Avery, with its receipt');

SELECT must_fail($$
  INSERT INTO material_lot (material_id, received_on, qty_received, qty_remaining, ex_tax_cost)
  VALUES ('66666666-6666-6666-6666-666666666666','2026-09-30',10,10,-1.00)
$$, 'a cost below nothing');

SELECT must_fail($$
  INSERT INTO material_lot (material_id, received_on, qty_received, qty_remaining, ex_tax_cost,
                            receipt)
  VALUES ('66666666-6666-6666-6666-666666666666','2026-09-30',10,10,5.00,'\x25504446'::bytea)
$$, 'a receipt with no type');

SELECT must_fail($$
  INSERT INTO material_lot (material_id, received_on, qty_received, qty_remaining, ex_tax_cost,
                            receipt, receipt_type)
  VALUES ('66666666-6666-6666-6666-666666666666','2026-09-30',10,10,5.00,'\x3c737667'::bytea,
          'image/svg+xml')
$$, 'a receipt that is a drawing, which can carry a script');

SELECT must_fail($$
  INSERT INTO material_lot (material_id, received_on, qty_received, qty_remaining, ex_tax_cost,
                            receipt, receipt_type)
  VALUES ('66666666-6666-6666-6666-666666666666','2026-09-30',10,10,5.00,
          convert_to(repeat('x', 2097153), 'UTF8'),'application/pdf')
$$, 'a receipt larger than any the phone sends');

SELECT must_fail($$
  INSERT INTO material_lot (material_id, received_on, qty_received, qty_remaining, ex_tax_cost,
                            paid_by)
  VALUES ('66666666-6666-6666-6666-666666666666','2026-09-30',10,10,5.00,
          '00000000-0000-4000-8000-000000000000')
$$, 'paid by somebody who does not exist');

\echo ''
\echo '=== 37. what was bought or paid for says who paid, and keeps its receipt ==='

-- A draft of its own: section 16's went out, and a sent invoice takes no lines.
INSERT INTO invoice (id, number, entity_id, created_by) VALUES
  ('7777eeee-7777-7777-7777-777777777737','KFS-0437',
   '44444444-4444-4444-4444-444444444444','a0a0a0a0-0000-4000-8000-0000000000a1');

SELECT must_pass($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit, unit_price, amount,
                            taxable, tax_rate_pct, tax_source, ex_tax_cost, tax_paid,
                            bought_from, paid_by, receipt, receipt_type)
  VALUES ('7777eeee-7777-7777-7777-777777777737', 37, 'bought', 'Keystone jacks x12', 1, 'each',
          33.33, 33.33, true, 8.0000, 'site', 33.33, 2.67, 'Valley Hardware',
          'a0a0a0a0-0000-4000-8000-0000000000a1', '\xffd8ffe0'::bytea, 'image/jpeg')
$$, 'jacks bought at Valley Hardware, paid by Avery, with the receipt');

SELECT must_pass($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit, unit_price, amount,
                            bought_from)
  VALUES ('7777eeee-7777-7777-7777-777777777737', 38, 'paid_for', 'Low-voltage permit', 1, 'each',
          35.00, 35.00, 'City of Woodland')
$$, 'a permit paid for them, by the business');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount, paid_by)
  VALUES ('7777eeee-7777-7777-7777-777777777737', 39, 'service', 'Field service', 1, 95.00, 95.00,
          'a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'who paid, said of an hour worked');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount, receipt)
  VALUES ('7777eeee-7777-7777-7777-777777777737', 40, 'bought', 'Anchors', 1, 4.00, 4.00,
          '\x25504446'::bytea)
$$, 'a receipt with no type');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount)
  VALUES ('7777eeee-7777-7777-7777-777777777737', 41, 'gift', 'Something', 1, 1.00, 1.00)
$$, 'a kind of line nobody named');

SELECT must_fail($$
  UPDATE operator SET purchase_markup_pct = -5
$$, 'a markup on job purchases below nothing');

\echo ''
\echo '=== 38. a line drawn from stock takes it off the shelf, and gives it back ==='

-- A spool of coax and a box of jacks, each received whole.
INSERT INTO material (id, name, unit_id) VALUES
  ('38383838-0000-4000-8000-0000000000aa','Keystone jack',(SELECT id FROM unit WHERE name = 'each'));
INSERT INTO material_lot (id, material_id, received_on, supplier, qty_received, qty_remaining,
                          ex_tax_cost) VALUES
  ('38383838-0000-4000-8000-000000000001','66666666-6666-6666-6666-666666666666','2026-10-01',
   'Delta Wholesale',100,100,31.00),
  ('38383838-0000-4000-8000-000000000002','38383838-0000-4000-8000-0000000000aa','2026-10-01',
   'Delta Wholesale',40,40,80.00),
  ('38383838-0000-4000-8000-000000000003','66666666-6666-6666-6666-666666666666','2026-10-02',
   'Delta Wholesale',100,100,35.00);
INSERT INTO invoice_line (id, invoice_id, seq, kind, description, qty, unit, unit_price, amount,
                          material_id, ex_tax_cost, tax_paid) VALUES
  ('38383838-0000-4000-8000-0000000000b1','7777eeee-7777-7777-7777-777777777737',50,'material',
   'Coax',60,'foot',0.3720,22.32,'66666666-6666-6666-6666-666666666666',18.60,0),
  ('38383838-0000-4000-8000-0000000000b2','7777eeee-7777-7777-7777-777777777737',51,'material',
   'Coax',50,'foot',0.3720,18.60,'66666666-6666-6666-6666-666666666666',15.50,0);

SELECT must_pass($$
  INSERT INTO stock_draw (invoice_line_id, material_lot_id, material_id, qty)
  VALUES ('38383838-0000-4000-8000-0000000000b1','38383838-0000-4000-8000-000000000001',
          '66666666-6666-6666-6666-666666666666',60);
  DO $x$ BEGIN
    IF (SELECT qty_remaining FROM material_lot WHERE id = '38383838-0000-4000-8000-000000000001') <> 40
    THEN RAISE EXCEPTION 'the spool was not drawn down'; END IF;
  END $x$
$$, '60 ft drawn off a spool of 100, which leaves 40');

SELECT must_fail($$
  INSERT INTO stock_draw (invoice_line_id, material_lot_id, material_id, qty)
  VALUES ('38383838-0000-4000-8000-0000000000b2','38383838-0000-4000-8000-000000000001',
          '66666666-6666-6666-6666-666666666666',50)
$$, '50 ft drawn off the 40 left');

SELECT must_fail($$
  INSERT INTO stock_draw (invoice_line_id, material_lot_id, material_id, qty)
  VALUES ('38383838-0000-4000-8000-0000000000b2','38383838-0000-4000-8000-000000000002',
          '66666666-6666-6666-6666-666666666666',5)
$$, 'a line of coax drawing jacks');

SELECT must_fail($$
  INSERT INTO stock_draw (invoice_line_id, material_lot_id, material_id, qty)
  VALUES ('38383838-0000-4000-8000-0000000000b2','38383838-0000-4000-8000-000000000003',
          '66666666-6666-6666-6666-666666666666',0)
$$, 'a draw of nothing');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount, material_id)
  VALUES ('7777eeee-7777-7777-7777-777777777737', 52, 'service', 'Field service', 1, 95.00, 95.00,
          '66666666-6666-6666-6666-666666666666')
$$, 'a material named on an hour worked');

SELECT must_pass($$
  DELETE FROM invoice_line WHERE id = '38383838-0000-4000-8000-0000000000b1';
  DO $x$ BEGIN
    IF (SELECT qty_remaining FROM material_lot WHERE id = '38383838-0000-4000-8000-000000000001') <> 100
    THEN RAISE EXCEPTION 'the spool did not get its 60 ft back'; END IF;
  END $x$
$$, 'taking the line off the draft puts its 60 ft back');

-- A draft of its own, sent with a draw on it.
INSERT INTO invoice (id, number, entity_id, created_by) VALUES
  ('7777eeee-7777-7777-7777-777777777738','KFS-0438',
   '44444444-4444-4444-4444-444444444444','a0a0a0a0-0000-4000-8000-0000000000a1');
INSERT INTO invoice_line (id, invoice_id, seq, kind, description, qty, unit, unit_price, amount,
                          material_id, ex_tax_cost, tax_paid) VALUES
  ('38383838-0000-4000-8000-0000000000b3','7777eeee-7777-7777-7777-777777777738',1,'material',
   'Coax',10,'foot',0.3720,3.72,'66666666-6666-6666-6666-666666666666',3.10,0);
INSERT INTO stock_draw (invoice_line_id, material_lot_id, material_id, qty) VALUES
  ('38383838-0000-4000-8000-0000000000b3','38383838-0000-4000-8000-000000000001',
   '66666666-6666-6666-6666-666666666666',10);
UPDATE invoice SET status = 'sent', issued_on = '2026-10-03', due_on = '2026-11-02', sent_at = now()
 WHERE id = '7777eeee-7777-7777-7777-777777777738';

SELECT must_fail($$
  INSERT INTO stock_draw (invoice_line_id, material_lot_id, material_id, qty)
  VALUES ('38383838-0000-4000-8000-0000000000b3','38383838-0000-4000-8000-000000000003',
          '66666666-6666-6666-6666-666666666666',5)
$$, 'more drawn for a line on a sent invoice');

SELECT must_fail($$
  DELETE FROM stock_draw WHERE invoice_line_id = '38383838-0000-4000-8000-0000000000b3'
$$, 'what a sent invoice drew, put back on the shelf');

SELECT must_pass($$
  INSERT INTO invoice (id, number, entity_id, created_by) VALUES
    ('7777eeee-7777-7777-7777-777777777739','KFS-0439',
     '44444444-4444-4444-4444-444444444444','a0a0a0a0-0000-4000-8000-0000000000a1');
  INSERT INTO invoice_line (id, invoice_id, seq, kind, description, qty, unit, unit_price, amount,
                            material_id, ex_tax_cost, tax_paid) VALUES
    ('38383838-0000-4000-8000-0000000000b4','7777eeee-7777-7777-7777-777777777739',1,'material',
     'Coax',25,'foot',0.3720,9.30,'66666666-6666-6666-6666-666666666666',7.75,0);
  INSERT INTO stock_draw (invoice_line_id, material_lot_id, material_id, qty) VALUES
    ('38383838-0000-4000-8000-0000000000b4','38383838-0000-4000-8000-000000000001',
     '66666666-6666-6666-6666-666666666666',25);
  DELETE FROM invoice WHERE id = '7777eeee-7777-7777-7777-777777777739';
  DO $x$ BEGIN
    IF (SELECT qty_remaining FROM material_lot WHERE id = '38383838-0000-4000-8000-000000000001') <> 90
    THEN RAISE EXCEPTION 'the deleted draft kept its 25 ft'; END IF;
  END $x$
$$, 'a deleted draft gives back what it drew');

SELECT must_pass($$
  UPDATE operator SET stock_costing = 'oldest_first'
$$, 'stock costed oldest first');

SELECT must_fail($$
  UPDATE operator SET stock_costing = 'newest_first'
$$, 'a way of costing stock nobody named');

\echo ''
\echo '=== 39. a line sent twice from a phone is one line ==='

SELECT must_pass($$
  INSERT INTO invoice_line (client_uuid, invoice_id, seq, kind, description, qty, unit, unit_price,
                            amount, bought_from)
  VALUES ('39393939-0000-4000-8000-000000000001', '7777eeee-7777-7777-7777-777777777737', 60,
          'paid_for', 'Low-voltage permit', 1, 'each', 35.00, 35.00, 'City of Woodland')
$$, 'a permit added on a phone');

SELECT must_fail($$
  INSERT INTO invoice_line (client_uuid, invoice_id, seq, kind, description, qty, unit, unit_price,
                            amount, bought_from)
  VALUES ('39393939-0000-4000-8000-000000000001', '7777eeee-7777-7777-7777-777777777737', 61,
          'paid_for', 'Low-voltage permit', 1, 'each', 35.00, 35.00, 'City of Woodland')
$$, 'the same permit, sent again after a timeout');

\echo ''
\echo '=== 40. a draft started on a phone, and a line moved off one that went out ==='

SELECT must_pass($$
  INSERT INTO invoice (id, client_uuid, number, entity_id, created_by)
  VALUES ('7777eeee-7777-7777-7777-777777777740', '40404040-0000-4000-8000-000000000001', 'KFS-0440',
          '44444444-4444-4444-4444-444444444444', 'a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'a draft started on a phone');

SELECT must_fail($$
  INSERT INTO invoice (client_uuid, number, entity_id, created_by)
  VALUES ('40404040-0000-4000-8000-000000000001', 'KFS-0441',
          '44444444-4444-4444-4444-444444444444', 'a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'the same draft, sent again after a timeout');

SELECT must_pass($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit, unit_price, amount,
                            bought_from, moved_from_invoice_id)
  VALUES ('7777eeee-7777-7777-7777-777777777740', 1, 'paid_for', 'Low-voltage permit', 1, 'each',
          35.00, 35.00, 'City of Woodland', '7777eeee-7777-7777-7777-777777777738')
$$, 'a permit meant for an invoice that went out, on a new draft');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit, unit_price, amount,
                            moved_from_invoice_id)
  VALUES ('7777eeee-7777-7777-7777-777777777740', 2, 'paid_for', 'Low-voltage permit', 1, 'each',
          35.00, 35.00, '7777eeee-7777-7777-7777-0000000000ff')
$$, 'one saying it was meant for an invoice that never was');

\echo ''
\echo '=== 41. a line keeps its whole history ==='

SELECT must_pass($$
  SELECT set_config('reckon.user_id', 'a0a0a0a0-0000-4000-8000-0000000000a1', true);
  INSERT INTO invoice_line (id, invoice_id, seq, kind, description, qty, unit, unit_price, amount,
                            bought_from, receipt, receipt_type)
  VALUES ('41414141-0000-4000-8000-000000000001', '7777eeee-7777-7777-7777-777777777737', 70,
          'bought', 'Anchors', 1, 'each', 4.00, 4.00, 'Valley Hardware',
          '\xffd8ffe0'::bytea, 'image/jpeg');
  DO $x$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM record_history
                    WHERE row_id = '41414141-0000-4000-8000-000000000001' AND field = '(added)'
                      AND changed_by = 'a0a0a0a0-0000-4000-8000-0000000000a1'
                      AND new_value::jsonb ->> 'description' = 'Anchors'
                      AND new_value::jsonb ->> 'receipt' = '4 bytes, sha256 '
                          || encode(sha256('\xffd8ffe0'::bytea), 'hex'))
    THEN RAISE EXCEPTION 'its adding was not kept, with the receipt described'; END IF;
  END $x$
$$, 'adding a line keeps who added it and what it was, its receipt described');

SELECT must_pass($$
  INSERT INTO invoice_line (id, invoice_id, seq, kind, description, qty, unit, unit_price, amount,
                            bought_from)
  VALUES ('41414141-0000-4000-8000-000000000002', '7777eeee-7777-7777-7777-777777777737', 71,
          'paid_for', 'Low-voltage permit', 1, 'each', 35.00, 35.00, 'City of Woodland');
  DO $x$ BEGIN
    IF (SELECT new_value::jsonb ->> 'description' FROM record_history
         WHERE row_id = '41414141-0000-4000-8000-000000000002' AND field = '(added)')
       IS DISTINCT FROM 'Low-voltage permit'
    THEN RAISE EXCEPTION 'a line with no receipt was not kept'; END IF;
  END $x$
$$, 'and one with no receipt, all the same');

SELECT must_pass($$
  UPDATE invoice_line SET description = 'Anchors, wall', qty = 2, amount = 8.00
   WHERE id = '41414141-0000-4000-8000-000000000001';
  DO $x$ BEGIN
    IF (SELECT string_agg(field || ':' || old_value || '>' || new_value, ' ' ORDER BY field)
          FROM record_history
         WHERE row_id = '41414141-0000-4000-8000-000000000001' AND field NOT LIKE '(%'
           AND field <> 'version')
       <> 'amount:4.000>8.000 description:Anchors>Anchors, wall qty:1.0000>2.0000'
    THEN RAISE EXCEPTION 'its change was not kept field by field'; END IF;
  END $x$
$$, 'changing it keeps each field, from what to what');

SELECT must_pass($$
  DELETE FROM invoice_line WHERE id = '41414141-0000-4000-8000-000000000001';
  DO $x$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM record_history
                    WHERE row_id = '41414141-0000-4000-8000-000000000001' AND field = '(deleted)'
                      AND old_value::jsonb ->> 'description' = 'Anchors, wall'
                      AND old_value::jsonb ->> 'receipt' = '\xffd8ffe0')
    THEN RAISE EXCEPTION 'its removal was not kept, receipt and all'; END IF;
  END $x$
$$, 'taking it off keeps what it was, its receipt whole: nothing else holds it now');

\echo ''
\echo '=== 42. a line counts its saves, and a change made on a phone says when ==='

SELECT must_pass($$
  INSERT INTO invoice_line (id, invoice_id, seq, kind, description, qty, unit, unit_price, amount,
                            bought_from, receipt, receipt_type)
  VALUES ('42424242-0000-4000-8000-000000000001', '7777eeee-7777-7777-7777-777777777737', 80,
          'bought', 'Faceplates', 1, 'each', 6.00, 6.00, 'Valley Hardware',
          '\xffd8ffe0'::bytea, 'image/jpeg');
  UPDATE invoice_line SET description = 'Faceplates x3' WHERE id = '42424242-0000-4000-8000-000000000001';
  UPDATE invoice_line SET description = 'Faceplates x3' WHERE id = '42424242-0000-4000-8000-000000000001';
  DO $x$ BEGIN
    IF (SELECT version FROM invoice_line WHERE id = '42424242-0000-4000-8000-000000000001') <> 2
    THEN RAISE EXCEPTION 'a save that changed nothing was counted'; END IF;
  END $x$
$$, 'a save that changes it counts, and one that changes nothing does not');

SELECT must_pass($$
  SELECT set_config('reckon.made_at', '2026-10-06T14:30:00Z', true);
  UPDATE invoice_line SET receipt = '\x89504e47'::bytea, receipt_type = 'image/png'
   WHERE id = '42424242-0000-4000-8000-000000000001';
  DO $x$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM record_history
                    WHERE row_id = '42424242-0000-4000-8000-000000000001' AND field = 'receipt'
                      AND made_at = '2026-10-06T14:30:00Z'
                      AND old_value = '\xffd8ffe0'
                      AND new_value LIKE '4 bytes, sha256 %')
    THEN RAISE EXCEPTION 'the replaced receipt was not kept, or not when it was made'; END IF;
  END $x$
$$, 'a receipt replaced on a phone is kept whole, with when the change was made');

\echo ''
\echo '=== 43. a team entry names its crew ==='

SELECT must_pass($$
  INSERT INTO time_entry_crew (time_entry_id, user_id)
  SELECT id, u FROM time_entry,
         unnest(ARRAY['a0a0a0a0-0000-4000-8000-0000000000a1',
                      'a0a0a0a0-0000-4000-8000-0000000000a2']::uuid[]) u
   WHERE client_uuid = 'dddddddd-0000-4000-8000-000000000001'
$$, 'a team entry names Avery and Sam');

SELECT must_fail($$
  INSERT INTO time_entry_crew (time_entry_id, user_id)
  SELECT id, 'a0a0a0a0-0000-4000-8000-0000000000a1' FROM time_entry
   WHERE client_uuid = 'dddddddd-0000-4000-8000-000000000001'
$$, 'the same person twice');

SELECT must_fail($$
  INSERT INTO time_entry_crew (time_entry_id, user_id)
  SELECT id, 'a0a0a0a0-0000-4000-8000-0000000000ff' FROM time_entry
   WHERE client_uuid = 'dddddddd-0000-4000-8000-000000000001'
$$, 'somebody who does not exist');

SELECT must_fail($$
  INSERT INTO time_entry_crew (time_entry_id, user_id)
  SELECT id, 'a0a0a0a0-0000-4000-8000-0000000000a1' FROM time_entry WHERE crew = 'one' LIMIT 1
$$, 'a crew on one person''s entry');

SELECT must_fail($$
  UPDATE time_entry SET crew = 'one', worked_by = 'a0a0a0a0-0000-4000-8000-0000000000a1'
   WHERE client_uuid = 'dddddddd-0000-4000-8000-000000000001'
$$, 'a team entry with a crew made one person''s');

\echo 'All guards hold.'
