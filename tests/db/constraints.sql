-- Does the schema hold what it says it holds?
--
-- Each guard is tested both ways: the thing that must be refused is refused,
-- and the legitimate case beside it still works. A guard that also blocks
-- ordinary use is a bug, not a guard.
--
-- Constraints and triggers only. What an hour bills, what it pays and what a
-- retainer covers is worked out in src/lib/server/valuation, and tested
-- there, by Vitest.
--
-- Run:  npm run db:test

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

-- What kind of sale reckon's own kinds are (#196), for the rows below that are
-- about something else.
CREATE FUNCTION sold_as(c reckon_kind) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM sale_kind WHERE code = c
$$;

-- Collecting in a state answers every kind of sale there: goods taxed, and
-- nothing else, for the rows below that are about something else.
CREATE FUNCTION collect_in(s text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO tax_registration (state) VALUES (s);
  INSERT INTO taxability (state, sale_kind_id, taxed) SELECT s, id, code = 'goods' FROM sale_kind;
$$;

-- A California tax area for the fixtures below, as CDTFA names it, made the
-- first time it is named: the state's share and, where there are any, the
-- district taxes.
CREATE FUNCTION ca_area(tac text, jurisdiction text, state_pct numeric, district_pct numeric)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE a uuid;
BEGIN
  SELECT id INTO a FROM tax_area WHERE state = 'CA' AND code = tac;
  IF a IS NULL THEN
    INSERT INTO tax_area (state, code, name, source, confirmed_on)
    VALUES ('CA', tac, jurisdiction, 'cdtfa', current_date) RETURNING id INTO a;
    INSERT INTO tax_piece (area_id, level, jurisdiction, rate_pct, effective_from)
    VALUES (a, 'state', 'CALIFORNIA', state_pct, current_date);
    IF district_pct > 0 THEN
      INSERT INTO tax_piece (area_id, level, jurisdiction, code, rate_pct, effective_from)
      VALUES (a, 'local', jurisdiction, tac, district_pct, current_date);
    END IF;
  END IF;
  RETURN a;
END $$;

-- ------------------------------------------------------------- fixtures --

INSERT INTO "user" (id, name, email, access) VALUES
  ('a0a0a0a0-0000-4000-8000-0000000000a1','Avery','avery@example.com','full'),
  ('a0a0a0a0-0000-4000-8000-0000000000a2','Sam','sam@example.com','field');

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

INSERT INTO service (id, code, name, unit, bill_to_nearest_seconds, sale_kind_id)
VALUES
  ('b5000000-0000-4000-8000-000000000055','field','Field service','hour',60, sold_as('repair')),
  ('b5000000-0000-4000-8000-000000000056','helpdesk','Help desk','hour',60, sold_as('repair')),
  ('b5000000-0000-4000-8000-000000000057','travel','Travel','mile',NULL, sold_as('travel'));

INSERT INTO material (id, name, unit_id, sale_kind_id) VALUES
  ('66666666-6666-6666-6666-666666666666','Coax - RG6 - Quad shield',
   (SELECT id FROM unit WHERE name = 'foot'), sold_as('goods'));

INSERT INTO invoice (id, number, entity_id, created_by) VALUES
  ('77777777-7777-7777-7777-777777777777','INV-0412',
   '44444444-4444-4444-4444-444444444444','a0a0a0a0-0000-4000-8000-0000000000a1');

INSERT INTO site (id, entity_id, label, slug, street, city, region, postcode,
                  tax_area_id,
                  area_verified_on,
                  google_round_trip_miles, google_drive_minutes) VALUES
  ('c5000000-0000-4000-8000-000000000001','44444444-4444-4444-4444-444444444444',
   'Front office','front-office','101 Maple St','Auburn','CA','95603',
   ca_area('310110000000', 'AUBURN', 7.2500, 0.0000), current_date, 60, 66),
  ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
   'Yuba','yuba','1201 Civic Center Blvd','Yuba City','CA','95993',
   ca_area('510510000000', 'YUBA CITY', 7.2500, 0.0000), current_date, 58, 62),
  ('c5000000-0000-4000-8000-00000000000c','44444444-4444-4444-4444-444444444444',
   'Woodland lab','woodland-lab','1000 Main St','Woodland','CA','95695',
   ca_area('570282360000', 'WOODLAND', 7.2500, 0.7500), current_date, 40, 45),
  ('c5000000-0000-4000-8000-00000000000b','44444444-0000-4000-8000-000000000002',
   'Suite 4','suite-4','101 Maple St','Auburn','CA','95603',
   ca_area('310110000000', 'AUBURN', 7.2500, 0.0000), current_date, 60, 66),
  ('c5000000-0000-4000-8000-00000000000a','44444444-0000-4000-8000-000000000003',
   'Coloma','coloma','310 Back St','Coloma','CA','95613',
   ca_area('099980000000', 'UNINCORPORATED AREA-EL DORADO', 7.2500, 0.0000), current_date, 44, 58);

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

-- The uuid is its maker's own: one from someone else's phone neither finds
-- the first entry nor is refused as if it were it.
SELECT must_pass($$
  INSERT INTO time_entry (client_uuid, worked_on, seconds, crew, worked_by, created_by,
                          entity_id, site_id, service_id)
  VALUES ('a1000000-0000-4000-8000-000000000001','2026-08-24',60 * 60,'one',
          'a0a0a0a0-0000-4000-8000-0000000000a2','a0a0a0a0-0000-4000-8000-0000000000a2',
          '44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',
          'b5000000-0000-4000-8000-000000000055')
$$, 'the same uuid from someone else, as an entry of their own');
DELETE FROM time_entry WHERE client_uuid = 'a1000000-0000-4000-8000-000000000001'
   AND created_by = 'a0a0a0a0-0000-4000-8000-0000000000a2';

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
\echo '=== 3. a client is exempt in a state, for a reason, with what supports it, until it ends ==='

SELECT must_fail($$
  INSERT INTO tax_exemption (entity_id, state, reason, supported_by)
  VALUES ('44444444-4444-4444-4444-444444444444', 'CA', 'resale', '   ')
$$, 'an exemption supported by nothing');

SELECT must_fail($$
  INSERT INTO tax_exemption (entity_id, state, reason, supported_by)
  VALUES ('44444444-4444-4444-4444-444444444444', 'California', 'resale', 'SR-ZZ-000-1234')
$$, 'an exemption in no state');

SELECT must_fail($$
  INSERT INTO tax_exemption (entity_id, state, reason, supported_by)
  VALUES ('44444444-4444-4444-4444-444444444444', 'CA', 'other', 'EX-1')
$$, 'an exemption for another reason, unexplained');

SELECT must_pass($$
  INSERT INTO tax_exemption (entity_id, state, reason, explanation, supported_by)
  VALUES ('44444444-4444-4444-4444-444444444444', 'CA', 'other', 'Exempt under a special act',
          'EX-1')
$$, 'an exemption for another reason, explained');
DELETE FROM tax_exemption;

SELECT must_fail($$
  INSERT INTO tax_exemption (entity_id, state, reason, supported_by, sale_kind_ids)
  VALUES ('44444444-4444-4444-4444-444444444444', 'CA', 'resale', 'SR-ZZ-000-1234', '{}')
$$, 'an exemption covering no kind of sale');

SELECT must_fail($$
  INSERT INTO tax_exemption (entity_id, state, reason, supported_by, sale_kind_ids)
  VALUES ('44444444-4444-4444-4444-444444444444', 'CA', 'resale', 'SR-ZZ-000-1234',
          ARRAY['00000000-0000-4000-8000-000000000000']::uuid[])
$$, 'an exemption covering a kind there is not');

SELECT must_pass($$
  INSERT INTO tax_exemption (id, entity_id, state, reason, supported_by, sale_kind_ids)
  VALUES ('e3000000-0000-4000-8000-000000000001', '44444444-4444-4444-4444-444444444444', 'CA',
          'resale', 'SR-ZZ-000-1234', ARRAY[sold_as('goods')])
$$, 'a resale certificate for goods');

SELECT must_fail($$
  UPDATE tax_exemption SET supported_by = 'SR-ZZ-000-9999'
   WHERE id = 'e3000000-0000-4000-8000-000000000001'
$$, 'an exemption changed after it was recorded');

SELECT must_pass($$
  UPDATE tax_exemption SET ended_on = current_date WHERE id = 'e3000000-0000-4000-8000-000000000001'
$$, 'an exemption ended');

SELECT must_fail($$
  UPDATE tax_exemption SET ended_on = current_date + 1
   WHERE id = 'e3000000-0000-4000-8000-000000000001'
$$, 'an exemption ended again');

SELECT must_pass($$
  DELETE FROM tax_exemption WHERE id = 'e3000000-0000-4000-8000-000000000001'
$$, 'an exemption nothing was untaxed by, taken off');

\echo ''
\echo '=== 4. a rate override must say why ==='

-- At the site it went to, which says where it is owed (#196).
SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price,
                            taxable, tax_rate_pct, tax_source, amount, sale_kind_id,
                            site_id, tax_jurisdiction, tax_state)
  VALUES ('77777777-7777-7777-7777-777777777777',1,'material','Coax',180,0.22,
          true, 8.5000, 'override', 39.60, sold_as('goods'),
          '33333333-3333-3333-3333-333333333333', 'YUBA CITY', 'CA')
$$, 'an 8.5% override with no reason');

SELECT must_pass($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price,
                            taxable, tax_rate_pct, tax_source, tax_override_reason, amount, sale_kind_id,
                            site_id, tax_jurisdiction, tax_state)
  VALUES ('77777777-7777-7777-7777-777777777777',1,'material','Coax',180,0.22,
          true, 8.2500, 'override', 'Marysville jobsite, location not yet on file', 39.60, sold_as('goods'),
          '33333333-3333-3333-3333-333333333333', 'YUBA CITY', 'CA')
$$, 'the same override, explained');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price,
                            taxable, tax_rate_pct, tax_source, amount, sale_kind_id)
  VALUES ('77777777-7777-7777-7777-777777777777',2,'service','Labour',4.2167,45,
          false, 7.2500, 'site', 189.75, NULL)
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
                            time_entry_id, trip_leg_id, sale_kind_id)
  VALUES ('77777777-7777-7777-7777-777777777777',3,'service','Two sources',1,1,1,
          (SELECT id FROM time_entry WHERE client_uuid='a1000000-0000-4000-8000-000000000001'),
          '99999999-9999-9999-9999-999999999999', NULL)
$$, 'a line claiming both a time entry and a trip leg');

SELECT must_pass($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount, trip_leg_id, sale_kind_id)
  VALUES ('77777777-7777-7777-7777-777777777777',3,'service','Travel',31,0.66,20.46,
          '99999999-9999-9999-9999-999999999999', NULL)
$$, 'a line from one trip leg');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount, trip_leg_id, sale_kind_id)
  VALUES ('77777777-7777-7777-7777-777777777777',4,'service','Same leg again',31,0.66,20.46,
          '99999999-9999-9999-9999-999999999999', NULL)
$$, 'the same leg billed twice');

\echo ''
\echo '=== 6. a sent invoice is immutable ==='

SELECT must_pass($$
  UPDATE invoice_line SET amount = 20.47
   WHERE invoice_id = '77777777-7777-7777-7777-777777777777' AND seq = 3
$$, 'editing a line while it is still a draft');

UPDATE invoice SET status='sent', issued_on='2026-09-04', due_on='2026-10-04', sent_at=now(),
       public_token=gen_random_uuid()::text
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
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount, sale_kind_id)
  VALUES ('77777777-7777-7777-7777-777777777777',9,'service','Added later',1,1,1, NULL)
$$, 'adding a line after it has gone out');

SELECT must_fail($$
  UPDATE invoice SET due_on = '2027-01-01'
   WHERE id = '77777777-7777-7777-7777-777777777777'
$$, 'changing the due date of a sent invoice');

SELECT must_fail($$
  UPDATE invoice SET status = 'paid' WHERE id = '77777777-7777-7777-7777-777777777777'
$$, 'marking an invoice paid: paid is what it owes, not a status');

SELECT must_fail($$
  UPDATE invoice SET status = 'void' WHERE id = '77777777-7777-7777-7777-777777777777'
$$, 'voiding without a reason');

-- Sent: none of these may reach it (#24).
INSERT INTO invoice (id, number, entity_id, created_by) VALUES
  ('77777777-0000-4000-8000-0000000000d1','INV-0413',
   '44444444-4444-4444-4444-444444444444','a0a0a0a0-0000-4000-8000-0000000000a1'),
  ('77777777-0000-4000-8000-0000000000d2','INV-0414',
   '44444444-4444-4444-4444-444444444444','a0a0a0a0-0000-4000-8000-0000000000a1');
INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount, sale_kind_id)
VALUES ('77777777-0000-4000-8000-0000000000d1',1,'service','Still a draft',1,10,10, NULL);
UPDATE invoice SET status='sent', issued_on='2026-09-04', due_on='2026-10-04', sent_at=now(),
       public_token=gen_random_uuid()::text
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

-- The receipt the lots below came on.
INSERT INTO stock_receipt (id, received_on, supplier, tax_paid)
VALUES ('07070707-0000-4000-8000-000000000001','2026-07-14','Delta Wholesale',6.96);

SELECT must_pass($$
  INSERT INTO material_lot (receipt_id, material_id, received_on, qty_received, qty_remaining,
                            ex_tax_cost, tax_paid)
  VALUES ('07070707-0000-4000-8000-000000000001','66666666-6666-6666-6666-666666666666',
          '2026-07-14',600,420,90.00,6.96)
$$, 'a lot with 180 ft drawn from it');

SELECT must_fail($$
  INSERT INTO material_lot (receipt_id, material_id, received_on, qty_received, qty_remaining,
                            ex_tax_cost, tax_paid)
  VALUES ('07070707-0000-4000-8000-000000000001','66666666-6666-6666-6666-666666666666',
          '2026-07-14',600,700,90.00,6.96)
$$, 'a lot with more left than ever arrived');

SELECT must_fail($$
  INSERT INTO material_lot (material_id, received_on, qty_received, qty_remaining, ex_tax_cost)
  VALUES ('66666666-6666-6666-6666-666666666666','2026-07-14',10,10,5.00)
$$, 'a lot that came on no receipt');

\echo ''
\echo '=== 8. a rate is CDTFA''s answer, not ours ==='

-- A negative rate is not an answer CDTFA can give, nor a piece of any rate.
SELECT must_fail($$
  UPDATE tax_piece SET rate_pct = -1
   WHERE area_id = (SELECT tax_area_id FROM site WHERE id = '33333333-3333-3333-3333-333333333333')
     AND level = 'state'
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

INSERT INTO operator (trading_name) VALUES ('Kestrel Field Services');
SELECT collect_in('CA');

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
                  tax_area_id,
                  area_verified_on) VALUES
  ('c5000000-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000003','Site one','site-one',
   '11255 Jackson St','Columbia','CA','95310',
   ca_area('559980000000', 'UNINCORPORATED AREA-TUOLUMNE', 7.2500, 0.0000), current_date),
  ('c5000000-0000-4000-8000-000000000003','bbbbbbbb-0000-4000-8000-000000000003','Site two','site-two',
   '526 C St','Marysville','CA','95901',
   ca_area('580604470000', 'MARYSVILLE', 7.2500, 1.0000), current_date);
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
  INSERT INTO service (code, name, unit, sale_kind_id)
  VALUES ('bad','Something','day', sold_as('repair'))
$$, 'a unit nobody named');

SELECT must_pass($$
  INSERT INTO service (code, name, unit, sale_kind_id)
  VALUES ('weekend','Weekend work','hour', sold_as('repair'))
$$, 'a service that says nothing about where it is done');

SELECT must_pass($$
  INSERT INTO service (code, name, unit, sale_kind_id)
  VALUES ('setup','Workstation setup','each', sold_as('repair'))
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
  INSERT INTO service (id, code, name, unit, sale_kind_id)
  VALUES ('b5000000-0000-4000-8000-00000000005a','delivery','Delivery','mile', sold_as('repair'))
$$, 'delivery by the mile is a service');

SELECT must_pass($$
  INSERT INTO service_price (service_id, rate, effective_from)
  VALUES ('b5000000-0000-4000-8000-00000000005a',1.10,'2026-01-01')
$$, 'and $1.10 a mile is a dated price row');

SELECT must_pass($$
  INSERT INTO material (name, unit_id, markup_pct, sale_kind_id)
  VALUES ('Wall plate off the default', (SELECT id FROM unit WHERE name = 'each'), NULL, sold_as('goods'))
$$, 'a material with no markup takes the operator default');

SELECT must_pass($$
  INSERT INTO material (name, unit_id, markup_pct, sale_kind_id)
  VALUES ('Wall plate with its own', (SELECT id FROM unit WHERE name = 'each'), 35, sold_as('goods'))
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
INSERT INTO invoice_line (id, invoice_id, seq, kind, description, qty, unit_price, unit, amount, sale_kind_id)
  VALUES ('7777bbbb-7777-7777-7777-777777777777','7777aaaa-7777-7777-7777-777777777777',
          1,'service','Delivery, Coloma',44.00,1.10,'mile',48.40, NULL);

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
UPDATE invoice SET status='sent', issued_on='2026-09-16', due_on='2026-10-16', sent_at=now(),
       public_token=gen_random_uuid()::text
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
\echo '=== 19. a site is in a state, in an area of it, and every placement is kept ==='

-- A SITE IS IN A STATE, and in an area of it only where it has been placed:
-- its area and the day it was placed come together. A site in a state the
-- business does not collect in has no area to find.
SELECT must_fail($$
  INSERT INTO site (id, entity_id, label, slug, street, city, region, postcode,
                    area_verified_on)
  VALUES (gen_random_uuid(),'44444444-4444-4444-4444-444444444444','No rate','no-rate',
          '9 Somewhere Rd','Columbia','CA','95310', current_date)
$$, 'a site placed on a day, in no area');

SELECT must_fail($$
  INSERT INTO site (id, entity_id, label, slug, street, city, region, postcode, tax_area_id)
  VALUES (gen_random_uuid(),'44444444-4444-4444-4444-444444444444','No day','no-day',
          '11255 Jackson St','Columbia','CA','95310',
          ca_area('559980000000', 'UNINCORPORATED AREA-TUOLUMNE', 7.2500, 0.0000))
$$, 'a site in an area, placed on no day');

SELECT must_pass($$
  INSERT INTO site (id, entity_id, label, slug, street, city, region, postcode)
  VALUES ('c5000000-0000-4000-8000-0000000000fd','44444444-4444-4444-4444-444444444444',
          'Portland office','portland-office','1120 SW 5th Ave','Portland','OR','97204')
$$, 'a site in no area, where nothing is collected');
DELETE FROM site WHERE id = 'c5000000-0000-4000-8000-0000000000fd';

SELECT must_fail($$
  INSERT INTO site (id, entity_id, label, slug, street, city, region, postcode)
  VALUES (gen_random_uuid(),'44444444-4444-4444-4444-444444444444','Nowhere','nowhere',
          '1120 SW 5th Ave','Portland','Oregon','97204')
$$, 'a site in a state that is not its two letters');

SELECT must_fail($$
  INSERT INTO site (id, entity_id, label, slug, street, city, region, postcode)
  VALUES (gen_random_uuid(),'44444444-4444-4444-4444-444444444444','No state','no-state',
          '1120 SW 5th Ave','Portland',NULL,'97204')
$$, 'a site in no state');

SELECT must_fail($$
  INSERT INTO site (id, entity_id, label, slug, street, city, region, postcode,
                    tax_area_id, area_verified_on)
  VALUES (gen_random_uuid(),'44444444-4444-4444-4444-444444444444','Reno','reno',
          '1 E 1st St','Reno','NV','89501',
          ca_area('559980000000', 'UNINCORPORATED AREA-TUOLUMNE', 7.2500, 0.0000), current_date)
$$, 'a Nevada site in a California area');

SELECT must_fail($$
  INSERT INTO site (id, entity_id, label, slug, city, region, postcode,
                    tax_area_id,
                  area_verified_on)
  VALUES (gen_random_uuid(),'44444444-4444-4444-4444-444444444444','No street','no-street',
          'Columbia','CA','95310',
          ca_area('559980000000', 'UNINCORPORATED AREA-TUOLUMNE', 7.2500, 0.0000), current_date)
$$, 'a site with no street to look up');

SELECT must_fail($$
  INSERT INTO site (id, entity_id, label, slug, street, city, region, postcode,
                    tax_area_id,
                  area_verified_on)
  VALUES (gen_random_uuid(),'44444444-4444-4444-4444-444444444444','Blank postcode','blank-postcode',
          '11255 Jackson St','Columbia','CA','',
          ca_area('559980000000', 'UNINCORPORATED AREA-TUOLUMNE', 7.2500, 0.0000), current_date)
$$, 'a postcode that is present but empty');

-- Where the API placed the address, written down against the site, and the
-- site in that area.
UPDATE site SET tax_area_id = ca_area('510510000000', 'YUBA CITY', 7.2500, 0.0000),
                area_verified_on = current_date
 WHERE id = '33333333-3333-3333-3333-333333333333';
INSERT INTO site_placement (site_id, area_id, moved, way)
SELECT id, tax_area_id, true, 'asked' FROM site WHERE id = '33333333-3333-3333-3333-333333333333';

-- Every placement is kept, and every rate an area has had, so a rate that
-- moved can be explained against the invoices billed at the old one.
DO $$
DECLARE n bigint; was numeric;
BEGIN
  -- Yuba City's rate in 2016, when the statewide rate was 7.50%, and the site
  -- placed there then.
  INSERT INTO tax_piece (area_id, level, jurisdiction, rate_pct, effective_from)
  SELECT tax_area_id, 'state', 'CALIFORNIA', 7.5000, '2016-06-01'
    FROM site WHERE id = '33333333-3333-3333-3333-333333333333';
  INSERT INTO site_placement (site_id, placed_at, area_id, moved, way)
  SELECT id, '2016-06-01', tax_area_id, true, 'asked'
    FROM site WHERE id = '33333333-3333-3333-3333-333333333333';

  SELECT count(*) INTO n FROM site_placement
   WHERE site_id = '33333333-3333-3333-3333-333333333333';
  SELECT sum(rate_pct) INTO was FROM tax_piece p
   WHERE area_id = (SELECT tax_area_id FROM site WHERE id = '33333333-3333-3333-3333-333333333333')
     AND effective_from = '2016-06-01';
  IF n <> 2 OR was <> 7.5000 THEN
    RAISE EXCEPTION 'GUARD MISSING: % placements kept, the 2016 rate %', n, was;
  END IF;
  RAISE NOTICE '  history   every placement is kept, and the rate the area had in 2016';
END $$;

SELECT must_fail($$
  INSERT INTO site_placement (site_id, moved, way)
  VALUES ('33333333-3333-3333-3333-333333333333', false, 'asked')
$$, 'a placement in no area');

-- Losing a site loses its placements with it; they describe an address that
-- is no longer anybody's. Its area stays: it is a place, whoever is in it.
DO $$
DECLARE n int;
BEGIN
  INSERT INTO site (id, entity_id, label, slug, street, city, region, postcode,
                  tax_area_id,
                  area_verified_on)
VALUES ('c5000000-0000-4000-8000-0000000000fe','44444444-0000-4000-8000-000000000002','Gone','gone',
        '11255 Jackson St','Columbia','CA','95310',
        ca_area('559980000000', 'UNINCORPORATED AREA-TUOLUMNE', 7.2500, 0.0000), current_date);
  INSERT INTO site_placement (site_id, area_id, moved, way)
  SELECT id, tax_area_id, true, 'asked' FROM site WHERE id = 'c5000000-0000-4000-8000-0000000000fe';
  DELETE FROM site WHERE id = 'c5000000-0000-4000-8000-0000000000fe';
  SELECT count(*) INTO n FROM site_placement
   WHERE site_id = 'c5000000-0000-4000-8000-0000000000fe';
  IF n <> 0 THEN
    RAISE EXCEPTION 'GUARD MISSING: % placements outlived the address', n;
  END IF;
  RAISE NOTICE '  follows   placements go with the address they describe';
END $$;

-- A RATE IS A PLACE'S. A tax area is named by its authority's code, once in
-- its state, and its rate is its pieces: who levies what, each once in a set.
SELECT must_fail($$
  INSERT INTO tax_area (state, code, name, source, confirmed_on)
  VALUES ('CA', '570282360000', 'WOODLAND AGAIN', 'cdtfa', current_date)
$$, 'a second area under a code in use');

SELECT must_pass($$
  INSERT INTO tax_area (state, code, name, source, typed_by, confirmed_by, confirmed_on)
  VALUES ('WA', '570282360000', 'ANOTHER STATE', 'typed',
          'a0a0a0a0-0000-4000-8000-0000000000a1', 'a0a0a0a0-0000-4000-8000-0000000000a1', current_date)
$$, 'the same code in another state');

SELECT must_fail($$
  INSERT INTO tax_area (state, name, source, confirmed_on)
  VALUES ('California', 'NOWHERE', 'cdtfa', current_date)
$$, 'a state that is not its two letters');

SELECT must_fail($$
  INSERT INTO tax_area (state, name, source, confirmed_on)
  VALUES ('CA', '  ', 'cdtfa', current_date)
$$, 'an area with no name');

SELECT must_fail($$
  INSERT INTO tax_piece (area_id, level, jurisdiction, rate_pct, effective_from)
  SELECT tax_area_id, 'local', 'WOODLAND', 0.2500, current_date
    FROM site WHERE id = 'c5000000-0000-4000-8000-00000000000c'
$$, 'a jurisdiction twice in one set');

SELECT must_pass($$
  INSERT INTO tax_piece (area_id, level, jurisdiction, rate_pct, effective_from)
  SELECT tax_area_id, 'local', 'WOODLAND', 0.2500, current_date + 90
    FROM site WHERE id = 'c5000000-0000-4000-8000-00000000000c'
$$, 'the same jurisdiction in a later set');
DELETE FROM tax_piece WHERE effective_from = current_date + 90;

SELECT must_fail($$
  DELETE FROM tax_area WHERE id =
    (SELECT tax_area_id FROM site WHERE id = 'c5000000-0000-4000-8000-00000000000c')
$$, 'removing an area a site is in');

SELECT must_fail($$
  UPDATE tax_area SET state = 'NV' WHERE code = '559980000000'
$$, 'an area moved to another state');

SELECT must_fail($$
  UPDATE site SET region = 'NV' WHERE id = 'c5000000-0000-4000-8000-00000000000c'
$$, 'a site moved to another state, keeping its area');

-- WHERE NO AUTHORITY ANSWERS, A PERSON TYPES AN AREA, and it says who typed
-- it and who last confirmed it; an authority's says neither. CDTFA answers
-- for California alone, an area keeps the source it was made from, and two
-- typed areas of one name in a state could not be told apart.
SELECT must_pass($$
  INSERT INTO tax_area (id, state, code, name, source, typed_by, confirmed_by, confirmed_on)
  VALUES ('c6000000-0000-4000-8000-000000000001', 'NV', '1600', 'Reno', 'typed',
          'a0a0a0a0-0000-4000-8000-0000000000a1', 'a0a0a0a0-0000-4000-8000-0000000000a1', current_date)
$$, 'an area of Nevada, typed and confirmed by Avery');

SELECT must_fail($$
  INSERT INTO tax_area (state, name, source, confirmed_by, confirmed_on)
  VALUES ('NV', 'Sparks', 'typed', 'a0a0a0a0-0000-4000-8000-0000000000a1', current_date)
$$, 'a typed area saying nobody typed it');

SELECT must_fail($$
  INSERT INTO tax_area (state, name, source, typed_by, confirmed_on)
  VALUES ('NV', 'Sparks', 'typed', 'a0a0a0a0-0000-4000-8000-0000000000a1', current_date)
$$, 'a typed area saying nobody confirmed it');

SELECT must_fail($$
  INSERT INTO tax_area (state, code, name, source, typed_by, confirmed_on)
  VALUES ('CA', '999999999999', 'TYPED OVER', 'cdtfa', 'a0a0a0a0-0000-4000-8000-0000000000a1', current_date)
$$, 'one of CDTFA''s areas saying a person typed it');

SELECT must_fail($$
  INSERT INTO tax_area (state, code, name, source, confirmed_on)
  VALUES ('NV', '320000000000', 'SPARKS', 'cdtfa', current_date)
$$, 'CDTFA answering for Nevada');

SELECT must_fail($$
  INSERT INTO tax_area (state, name, source, typed_by, confirmed_by, confirmed_on)
  VALUES ('NV', 'RENO', 'typed', 'a0a0a0a0-0000-4000-8000-0000000000a1', 'a0a0a0a0-0000-4000-8000-0000000000a1', current_date)
$$, 'two typed areas of Nevada called Reno');

SELECT must_fail($$
  UPDATE tax_area SET source = 'typed', typed_by = 'a0a0a0a0-0000-4000-8000-0000000000a1', confirmed_by = 'a0a0a0a0-0000-4000-8000-0000000000a1'
   WHERE code = '559980000000'
$$, 'an area of CDTFA''s made over as typed');

-- A typed area's pieces say who typed them, and an authority's nobody.
SELECT must_pass($$
  INSERT INTO tax_piece (area_id, level, jurisdiction, rate_pct, effective_from, typed_by)
  VALUES ('c6000000-0000-4000-8000-000000000001', 'state', 'Nevada', 6.8500, '2026-10-01', 'a0a0a0a0-0000-4000-8000-0000000000a1'),
         ('c6000000-0000-4000-8000-000000000001', 'local', 'Washoe County', 1.4150, '2026-10-01', 'a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'Reno''s rate, typed by Avery');

SELECT must_fail($$
  INSERT INTO tax_piece (area_id, level, jurisdiction, rate_pct, effective_from)
  VALUES ('c6000000-0000-4000-8000-000000000001', 'local', 'Washoe County', 1.5000, '2027-01-01')
$$, 'a typed area''s piece saying nobody typed it');

SELECT must_fail($$
  INSERT INTO tax_piece (area_id, level, jurisdiction, rate_pct, effective_from, typed_by)
  SELECT id, 'local', 'TUOLUMNE', 0.2500, current_date + 1, 'a0a0a0a0-0000-4000-8000-0000000000a1'
    FROM tax_area WHERE state = 'CA' AND code = '559980000000'
$$, 'a piece of CDTFA''s saying a person typed it');

-- A PLACEMENT SAYS HOW ITS AREA WAS FOUND, AND BY WHOM: a site is chosen into
-- a typed area by somebody, and asked into an authority's.
INSERT INTO site (id, entity_id, label, slug, street, city, region, postcode,
                  tax_area_id, area_verified_on)
VALUES ('c5000000-0000-4000-8000-0000000000fc', '44444444-4444-4444-4444-444444444444',
        'Reno office', 'reno-office', '1 E 1st St', 'Reno', 'NV', '89501',
        'c6000000-0000-4000-8000-000000000001', current_date);

SELECT must_pass($$
  INSERT INTO site_placement (site_id, area_id, moved, way, placed_by, note)
  VALUES ('c5000000-0000-4000-8000-0000000000fc', 'c6000000-0000-4000-8000-000000000001',
          true, 'chosen', 'a0a0a0a0-0000-4000-8000-0000000000a1', 'chosen when the site was created')
$$, 'a site in Reno, chosen by Avery');

SELECT must_fail($$
  INSERT INTO site_placement (site_id, area_id, moved, way)
  VALUES ('c5000000-0000-4000-8000-0000000000fc', 'c6000000-0000-4000-8000-000000000001',
          false, 'chosen')
$$, 'a placement chosen by nobody');

SELECT must_fail($$
  INSERT INTO site_placement (site_id, area_id, moved, way, placed_by)
  VALUES ('c5000000-0000-4000-8000-0000000000fc', 'c6000000-0000-4000-8000-000000000001',
          false, 'asked', 'a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'a typed area asked of an authority');

SELECT must_fail($$
  INSERT INTO site_placement (site_id, area_id, moved, way, placed_by)
  SELECT id, tax_area_id, false, 'chosen', 'a0a0a0a0-0000-4000-8000-0000000000a1'
    FROM site WHERE id = '33333333-3333-3333-3333-333333333333'
$$, 'one of CDTFA''s areas chosen by hand');

SELECT must_pass($$
  INSERT INTO site_placement (site_id, area_id, moved, way, placed_by, note)
  SELECT id, tax_area_id, false, 'asked', 'a0a0a0a0-0000-4000-8000-0000000000a1', 'asked again'
    FROM site WHERE id = '33333333-3333-3333-3333-333333333333'
$$, 'CDTFA asked again about a site, by Avery');

-- Every change to a typed area and its rates is kept, against whoever made
-- it, and so is one that goes; when it was last confirmed is not a change.
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('reckon.user_id', 'a0a0a0a0-0000-4000-8000-0000000000a1', true);
  UPDATE tax_area SET name = 'Reno city' WHERE id = 'c6000000-0000-4000-8000-000000000001';
  UPDATE tax_area SET confirmed_on = current_date + 1 WHERE id = 'c6000000-0000-4000-8000-000000000001';
  INSERT INTO tax_piece (area_id, level, jurisdiction, rate_pct, effective_from, typed_by)
  VALUES ('c6000000-0000-4000-8000-000000000001', 'local', 'Washoe County', 1.5000, '2027-01-01',
          'a0a0a0a0-0000-4000-8000-0000000000a1');
  DELETE FROM tax_piece WHERE area_id = 'c6000000-0000-4000-8000-000000000001'
                          AND effective_from = '2027-01-01';
  SELECT count(*) INTO n FROM record_history
   WHERE table_name IN ('tax_area', 'tax_piece')
     AND changed_by = 'a0a0a0a0-0000-4000-8000-0000000000a1'
     AND field IN ('name', '(added)', '(deleted)')
     AND (row_id = 'c6000000-0000-4000-8000-000000000001'
          OR new_value LIKE '%c6000000-0000-4000-8000-000000000001%'
          OR old_value LIKE '%c6000000-0000-4000-8000-000000000001%');
  -- Its rename, and a piece added and taken away.
  IF n <> 3 THEN
    RAISE EXCEPTION 'GUARD MISSING: % of a typed area''s three changes recorded', n;
  END IF;
  IF EXISTS (SELECT 1 FROM record_history WHERE table_name = 'tax_area' AND field = 'confirmed_on') THEN
    RAISE EXCEPTION 'GUARD MISSING: a confirmation was recorded as a change';
  END IF;
  RAISE NOTICE '  recorded  a typed area renamed, and a rate typed and taken away, against whoever did it';
END $$;
DELETE FROM site WHERE id = 'c5000000-0000-4000-8000-0000000000fc';

-- WHAT WAS HANDED OVER IS RECORDED, NOT DERIVED. Nothing in the invoices can
-- say whether a return was actually paid.
SELECT must_fail($$
  INSERT INTO tax_remittance (state, period_start, period_end, amount, created_by)
  VALUES ('CA','2026-09-30','2026-07-01', 100.00, 'a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'a filing period that ends before it starts');

SELECT must_pass($$
  INSERT INTO tax_remittance (state, period_start, period_end, filed_on, paid_on, amount, created_by)
  VALUES ('CA','2026-07-01','2026-09-30','2026-10-20','2026-10-20', 4.42,
          'a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'a return filed and paid');

SELECT must_fail($$
  INSERT INTO tax_remittance (state, period_start, period_end, amount, created_by)
  VALUES ('CA','2026-07-01','2026-09-30', 4.42, 'a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'a second filing for the same period');

SELECT must_pass($$
  INSERT INTO tax_remittance (state, period_start, period_end, amount, created_by)
  VALUES ('NV','2026-07-01','2026-09-30', 1.10, 'a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'the same period filed with another state');

SELECT must_fail($$
  INSERT INTO tax_remittance (period_start, period_end, amount, created_by)
  VALUES ('2026-10-01','2026-12-31', 4.42, 'a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'a filing to no state');

SELECT must_fail($$
  INSERT INTO tax_remittance (state, period_start, period_end, amount, created_by)
  VALUES ('CA','2026-10-01','2026-12-31', -1.00, 'a0a0a0a0-0000-4000-8000-0000000000a1')
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
                    tax_area_id,
                    area_verified_on)
  VALUES ('44444444-0000-4000-8000-000000000002','Yuba','yuba','1201 Civic Center Blvd',
          'Yuba City','CA','95993',
          ca_area('510510000000', 'YUBA CITY', 7.2500, 0.0000), current_date);
  SELECT count(DISTINCT entity_id) INTO n FROM site WHERE slug = 'yuba';
  IF n < 2 THEN
    RAISE EXCEPTION 'GUARD MISSING: only % client(s) have a site called yuba', n;
  END IF;
  RAISE NOTICE '  per client % clients each have their own /sites/yuba', n;
END $$;

SELECT must_fail($$
  INSERT INTO site (entity_id, label, slug, street, city, region, postcode,
                    tax_area_id,
                    area_verified_on)
  VALUES ('44444444-4444-4444-4444-444444444444','Another Yuba','yuba',
          '1201 Civic Center Blvd','Yuba City','CA','95993',
          ca_area('510510000000', 'YUBA CITY', 7.2500, 0.0000), current_date)
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

-- The figures in force are the typed ones where there are any, and Google's
-- where there are not: emptying a typed figure puts Google's back.
DO $$
DECLARE googles numeric; typed numeric; emptied numeric;
BEGIN
  SELECT round_trip_miles INTO googles FROM site WHERE id = 'c5000000-0000-4000-8000-00000000000a';
  UPDATE site SET typed_round_trip_miles = 50 WHERE id = 'c5000000-0000-4000-8000-00000000000a';
  SELECT round_trip_miles INTO typed FROM site WHERE id = 'c5000000-0000-4000-8000-00000000000a';
  UPDATE site SET typed_round_trip_miles = NULL WHERE id = 'c5000000-0000-4000-8000-00000000000a';
  SELECT round_trip_miles INTO emptied FROM site WHERE id = 'c5000000-0000-4000-8000-00000000000a';

  IF googles IS DISTINCT FROM 44 THEN
    RAISE EXCEPTION 'GUARD MISSING: with nothing typed the round trip gave %, not Google''s 44', googles;
  END IF;
  IF typed IS DISTINCT FROM 50 THEN
    RAISE EXCEPTION 'GUARD MISSING: a typed round trip of 50 gave %', typed;
  END IF;
  IF emptied IS DISTINCT FROM 44 THEN
    RAISE EXCEPTION 'GUARD MISSING: emptied, the round trip gave %, not Google''s 44', emptied;
  END IF;
  RAISE NOTICE '  in force  the typed round trip over Google''s, and Google''s once it is emptied';
END $$;

SELECT must_fail($$
  UPDATE site SET google_round_trip_miles = -1 WHERE id = 'c5000000-0000-4000-8000-00000000000a'
$$, 'a round trip from Google below nothing');

SELECT must_fail($$
  UPDATE site SET round_trip_miles = 1 WHERE id = 'c5000000-0000-4000-8000-00000000000a'
$$, 'the round trip in force written over both');

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
                          time_entry_id, sale_kind_id)
VALUES ('7777dddd-7777-7777-7777-777777777777',1,'service','Field service',2.00,95.00,'hour',190.00,
        '7777cccc-7777-7777-7777-777777777777', NULL);

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
  UPDATE tax_registration SET filing_basis = 'fortnightly' WHERE state = 'CA'
$$, 'a filing basis no agency offers');

SELECT must_fail($$
  UPDATE operator SET fiscal_year_end_month = 13
$$, 'a thirteenth month');

SELECT must_pass($$
  UPDATE operator SET fiscal_year_end_month = 12
$$, 'the year ending in December');

SELECT must_pass($$
  UPDATE tax_registration SET filing_basis = 'quarterly', held = 'Seller''s permit', agency = 'CDTFA',
                              claims_tax_paid_purchases_resold = true
   WHERE state = 'CA'
$$, 'filed quarterly with CDTFA, on a seller''s permit, claiming tax paid on goods resold');

-- THE BUSINESS COLLECTS TAX STATE BY STATE: registered once in each, by its
-- two letters, and California's alone makes the Reg 1701 election.
SELECT must_fail($$
  INSERT INTO tax_registration (state) VALUES ('CA')
$$, 'registered twice in one state');

SELECT must_fail($$
  INSERT INTO tax_registration (state) VALUES ('Nevada')
$$, 'a registration in a state that is not its two letters');

SELECT must_fail($$
  INSERT INTO tax_registration (state, claims_tax_paid_purchases_resold) VALUES ('NV', true)
$$, 'the Reg 1701 election made outside California');

SELECT must_fail($$
  UPDATE tax_registration SET held = '  ' WHERE state = 'CA'
$$, 'a registration holding nothing written');

-- Every change to a registration is kept, against whoever made it, and so is
-- one that goes.
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('reckon.user_id', 'a0a0a0a0-0000-4000-8000-0000000000a1', true);
  INSERT INTO tax_registration (state, agency) VALUES ('NV', 'Nevada Department of Taxation');
  UPDATE tax_registration SET filing_basis = 'monthly' WHERE state = 'NV';
  DELETE FROM tax_registration WHERE state = 'NV';
  SELECT count(*) INTO n FROM record_history
   WHERE table_name = 'tax_registration'
     AND changed_by = 'a0a0a0a0-0000-4000-8000-0000000000a1'
     AND field IN ('(added)', 'filing_basis', '(deleted)');
  IF n <> 3 THEN
    RAISE EXCEPTION 'GUARD MISSING: % of a registration''s three changes recorded', n;
  END IF;
  RAISE NOTICE '  recorded  a registration made, changed and ended, against whoever did it';
END $$;

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

INSERT INTO service (id, code, name, unit, bill_to_nearest_seconds, sale_kind_id) VALUES
  ('b5000000-0000-4000-8000-00000000005c','callout','Call-out','hour',60, sold_as('repair')),
  ('b5000000-0000-4000-8000-00000000005d','standby','Standby','hour',60, sold_as('repair'));

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
INSERT INTO service (id, code, name, unit, bill_to_nearest_seconds, sale_kind_id)
VALUES ('b5000000-0000-4000-8000-0000000000a1','retained','Retained work','hour',60, sold_as('repair'));

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
  INSERT INTO material (name, sale_kind_id) VALUES ('Counted in nothing', sold_as('goods'))
$$, 'a material counted in nothing');

SELECT must_fail($$
  DELETE FROM unit WHERE name = 'foot'
$$, 'taking away a unit stock is counted in');

SELECT must_pass($$
  DELETE FROM unit WHERE name = 'gallon'
$$, 'and letting go of one nothing is counted in');

\echo ''
\echo '=== 36. a receipt keeps what it says, and who paid ==='

SELECT must_pass($$
  INSERT INTO stock_receipt (id, received_on, supplier, reference, tax_paid, paid_by, receipt,
                             receipt_type)
  VALUES ('36363636-0000-4000-8000-000000000001','2026-09-30','Delta Wholesale','INV-55120',
          24.80,'a0a0a0a0-0000-4000-8000-0000000000a1','\xffd8ffe0'::bytea,'image/jpeg')
$$, 'a Delta Wholesale invoice with 24.80 tax, paid by Avery, with the paper');

SELECT must_pass($$
  INSERT INTO material_lot (receipt_id, material_id, received_on, qty_received, qty_remaining,
                            ex_tax_cost, tax_paid)
  VALUES ('36363636-0000-4000-8000-000000000001','66666666-6666-6666-6666-666666666666',
          '2026-09-30',1000,1000,310.00,24.80)
$$, 'and 1,000 ft on it for 310.00, with its share of the tax');

SELECT must_fail($$
  INSERT INTO material_lot (receipt_id, material_id, received_on, qty_received, qty_remaining,
                            ex_tax_cost)
  VALUES ('36363636-0000-4000-8000-000000000001','66666666-6666-6666-6666-666666666666',
          '2026-09-30',10,10,-1.00)
$$, 'a cost below nothing');

SELECT must_fail($$
  INSERT INTO stock_receipt (received_on, tax_paid) VALUES ('2026-09-30',-1.00)
$$, 'tax below nothing');

SELECT must_fail($$
  INSERT INTO stock_receipt (received_on, receipt) VALUES ('2026-09-30','\x25504446'::bytea)
$$, 'a receipt with no type');

SELECT must_fail($$
  INSERT INTO stock_receipt (received_on, receipt, receipt_type)
  VALUES ('2026-09-30','\x3c737667'::bytea,'image/svg+xml')
$$, 'a receipt that is a drawing, which can carry a script');

SELECT must_fail($$
  INSERT INTO stock_receipt (received_on, receipt, receipt_type)
  VALUES ('2026-09-30',convert_to(repeat('x', 2097153), 'UTF8'),'application/pdf')
$$, 'a receipt larger than any the phone sends');

SELECT must_fail($$
  INSERT INTO stock_receipt (received_on, paid_by)
  VALUES ('2026-09-30','00000000-0000-4000-8000-000000000000')
$$, 'paid by somebody who does not exist');

SELECT must_fail($$
  DELETE FROM stock_receipt WHERE id = '36363636-0000-4000-8000-000000000001'
$$, 'a receipt something came on, deleted from under it');

\echo ''
\echo '=== 36b. stock put right by hand comes off its lots, or is a lot of its own ==='

INSERT INTO stock_adjustment (id, material_id, made_on, way, qty, reason, ex_tax_cost, created_by)
VALUES ('36b36b36-0000-4000-8000-000000000001','66666666-6666-6666-6666-666666666666',
        '2026-10-01','off',10,'used',3.10,'a0a0a0a0-0000-4000-8000-0000000000a1');

SELECT must_pass($$
  INSERT INTO stock_take (adjustment_id, material_lot_id, material_id, qty)
  SELECT '36b36b36-0000-4000-8000-000000000001', id, material_id, 10
    FROM material_lot WHERE receipt_id = '36363636-0000-4000-8000-000000000001'
$$, '10 ft used in the shop, taken off the lot it came from');

DO $$ BEGIN
  IF (SELECT qty_remaining FROM material_lot WHERE receipt_id = '36363636-0000-4000-8000-000000000001') <> 990 THEN
    RAISE EXCEPTION 'UNDER-TIGHT: the lot did not follow its take';
  END IF;
  RAISE NOTICE '  held      the lot follows its take: 990 left';
END $$;

SELECT must_fail($$
  INSERT INTO stock_take (adjustment_id, material_lot_id, material_id, qty)
  SELECT '36b36b36-0000-4000-8000-000000000001', id, material_id, 5000
    FROM material_lot WHERE receipt_id = '07070707-0000-4000-8000-000000000001'
$$, 'a take larger than what is left');

SELECT must_fail($$
  INSERT INTO stock_adjustment (material_id, made_on, way, qty, reason, ex_tax_cost, created_by)
  VALUES ('66666666-6666-6666-6666-666666666666','2026-10-01','off',2,'found',0,
          'a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'found stock taken off');

SELECT must_fail($$
  INSERT INTO stock_adjustment (material_id, made_on, way, qty, reason, ex_tax_cost, created_by)
  VALUES ('66666666-6666-6666-6666-666666666666','2026-10-01','on',2,'damaged',0,
          'a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'damaged stock put on');

SELECT must_fail($$
  INSERT INTO stock_adjustment (material_id, made_on, way, qty, reason, ex_tax_cost, created_by)
  VALUES ('66666666-6666-6666-6666-666666666666','2026-10-01','off',0,'used',0,
          'a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'nothing moved');

INSERT INTO stock_adjustment (id, material_id, made_on, way, qty, reason, ex_tax_cost, created_by)
VALUES ('36b36b36-0000-4000-8000-000000000002','66666666-6666-6666-6666-666666666666',
        '2026-10-02','on',4,'found',1.24,'a0a0a0a0-0000-4000-8000-0000000000a1');

SELECT must_pass($$
  INSERT INTO material_lot (adjustment_id, material_id, received_on, qty_received, qty_remaining,
                            ex_tax_cost)
  VALUES ('36b36b36-0000-4000-8000-000000000002','66666666-6666-6666-6666-666666666666',
          '2026-10-02',4,4,1.24)
$$, '4 ft found, a lot of its own');

SELECT must_fail($$
  INSERT INTO material_lot (receipt_id, adjustment_id, material_id, received_on, qty_received,
                            qty_remaining, ex_tax_cost)
  VALUES ('36363636-0000-4000-8000-000000000001','36b36b36-0000-4000-8000-000000000002',
          '66666666-6666-6666-6666-666666666666','2026-10-02',4,4,1.24)
$$, 'a lot both received and found');

\echo ''
\echo '=== 36c. a material is changed, but not what it was received counted in ==='

SELECT must_fail($$
  UPDATE material SET unit_id = (SELECT id FROM unit WHERE name = 'each')
   WHERE id = '66666666-6666-6666-6666-666666666666'
$$, 'what a received material is counted in, changed');

INSERT INTO material (id, name, unit_id, sale_kind_id) VALUES
  ('36c36c36-0000-4000-8000-000000000001','Cable ties - 8 in',
   (SELECT id FROM unit WHERE name = 'foot'), sold_as('goods'));

SELECT must_pass($$
  UPDATE material SET unit_id = (SELECT id FROM unit WHERE name = 'each')
   WHERE id = '36c36c36-0000-4000-8000-000000000001'
$$, 'what a material none of which was received is counted in, changed');

SELECT must_pass($$
  UPDATE material SET name = 'Coax - RG6 - Quad shield, black'
   WHERE id = '66666666-6666-6666-6666-666666666666'
$$, 'a received material renamed');

DO $$ BEGIN
  IF (SELECT version FROM material WHERE id = '66666666-6666-6666-6666-666666666666') <> 2 THEN
    RAISE EXCEPTION 'UNDER-TIGHT: a material save was not counted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM record_history WHERE table_name = 'material' AND field = 'name'
                   AND row_id = '66666666-6666-6666-6666-666666666666')
     OR EXISTS (SELECT 1 FROM record_history WHERE table_name = 'material' AND field = 'version') THEN
    RAISE EXCEPTION 'UNDER-TIGHT: history did not keep the name, or kept the count';
  END IF;
  RAISE NOTICE '  held      a save is counted, and history keeps the name but not the count';
END $$;

SELECT must_pass($$
  INSERT INTO material_price (material_id, price, effective_from)
  VALUES ('66666666-6666-6666-6666-666666666666', 0.45, '2026-10-01'),
         ('66666666-6666-6666-6666-666666666666', NULL, '2026-10-05')
$$, 'a set price from a day, and back to its markup from a later one');

\echo ''
\echo '=== 36d. a count is counted, applied once, and names what it put right ==='

INSERT INTO stock_count (id, counted_on, created_by)
VALUES ('36d36d36-0000-4000-8000-000000000001','2026-10-03','a0a0a0a0-0000-4000-8000-0000000000a1');

SELECT must_fail($$
  INSERT INTO stock_count (counted_on, created_by)
  VALUES ('2026-10-03','a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'a second count open while one is');

SELECT must_pass($$
  INSERT INTO stock_count_line (count_id, material_id, counted, on_hand, counted_by)
  VALUES ('36d36d36-0000-4000-8000-000000000001','66666666-6666-6666-6666-666666666666',
          990, 994, 'a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'coax counted: 990 ft where the shelf said 994');

SELECT must_fail($$
  INSERT INTO stock_count_line (count_id, material_id, counted, on_hand, counted_by)
  VALUES ('36d36d36-0000-4000-8000-000000000001','66666666-6666-6666-6666-666666666666',
          980, 994, 'a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'one material counted twice on one count');

SELECT must_fail($$
  UPDATE stock_count_line SET counted = -1
   WHERE count_id = '36d36d36-0000-4000-8000-000000000001'
$$, 'less than none counted');

SELECT must_fail($$
  INSERT INTO stock_adjustment (material_id, made_on, way, qty, reason, ex_tax_cost, created_by)
  VALUES ('66666666-6666-6666-6666-666666666666','2026-10-03','off',4,'counted',1.24,
          'a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'counted, with no count named');

SELECT must_fail($$
  INSERT INTO stock_adjustment (material_id, made_on, way, qty, reason, ex_tax_cost, count_id,
                                created_by)
  VALUES ('66666666-6666-6666-6666-666666666666','2026-10-03','off',4,'used',1.24,
          '36d36d36-0000-4000-8000-000000000001','a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'a count named by an adjustment it did not make');

SELECT must_pass($$
  INSERT INTO stock_adjustment (id, material_id, made_on, way, qty, reason, ex_tax_cost, count_id,
                                created_by)
  VALUES ('36d36d36-0000-4000-8000-0000000000a1','66666666-6666-6666-6666-666666666666',
          '2026-10-03','off',4,'counted',1.24,'36d36d36-0000-4000-8000-000000000001',
          'a0a0a0a0-0000-4000-8000-0000000000a1')
$$, '4 ft short, put right by the count, either way');

SELECT must_pass($$
  UPDATE stock_count SET applied_at = now(), applied_by = 'a0a0a0a0-0000-4000-8000-0000000000a1'
   WHERE id = '36d36d36-0000-4000-8000-000000000001'
$$, 'the count applied');

SELECT must_fail($$
  UPDATE stock_count_line SET counted = 991
   WHERE count_id = '36d36d36-0000-4000-8000-000000000001'
$$, 'what was counted on an applied count, changed');

SELECT must_fail($$
  UPDATE stock_count SET counted_on = '2026-10-04'
   WHERE id = '36d36d36-0000-4000-8000-000000000001'
$$, 'an applied count, changed');

SELECT must_fail($$
  DELETE FROM stock_count WHERE id = '36d36d36-0000-4000-8000-000000000001'
$$, 'an applied count, deleted');

SELECT must_pass($$
  INSERT INTO stock_count (id, counted_on, created_by)
  VALUES ('36d36d36-0000-4000-8000-000000000002','2026-10-04','a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'a new count, once the last is applied');

SELECT must_fail($$
  UPDATE stock_count SET applied_at = now()
   WHERE id = '36d36d36-0000-4000-8000-000000000002'
$$, 'applied by nobody');

SELECT must_pass($$
  DELETE FROM stock_count WHERE id = '36d36d36-0000-4000-8000-000000000002'
$$, 'a count still being counted, thrown away');

\echo ''
\echo '=== 36e. stock and services made on a phone are made once ==='

INSERT INTO stock_receipt (received_on, client_uuid)
VALUES ('2026-10-05','36e36e36-0000-4000-8000-000000000001');

SELECT must_fail($$
  INSERT INTO stock_receipt (received_on, client_uuid)
  VALUES ('2026-10-05','36e36e36-0000-4000-8000-000000000001')
$$, 'one receipt sent twice from a phone, made twice');

INSERT INTO material (name, unit_id, client_uuid, sale_kind_id)
VALUES ('Cable ties - 8 in, black', (SELECT id FROM unit WHERE name = 'each'),
        '36e36e36-0000-4000-8000-000000000002', sold_as('goods'));

SELECT must_fail($$
  INSERT INTO material (name, unit_id, client_uuid, sale_kind_id)
  VALUES ('Cable ties - 8 in, white', (SELECT id FROM unit WHERE name = 'each'),
          '36e36e36-0000-4000-8000-000000000002', sold_as('goods'))
$$, 'two materials named by the one uuid a phone made');

INSERT INTO stock_adjustment (material_id, made_on, way, qty, reason, ex_tax_cost, client_uuid,
                              created_by)
VALUES ('66666666-6666-6666-6666-666666666666','2026-10-05','on',1,'found',0.31,
        '36e36e36-0000-4000-8000-000000000003','a0a0a0a0-0000-4000-8000-0000000000a1');

SELECT must_fail($$
  INSERT INTO stock_adjustment (material_id, made_on, way, qty, reason, ex_tax_cost, client_uuid,
                                created_by)
  VALUES ('66666666-6666-6666-6666-666666666666','2026-10-05','on',1,'found',0.31,
          '36e36e36-0000-4000-8000-000000000003','a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'one adjustment sent twice from a phone, made twice');

SELECT must_pass($$
  INSERT INTO stock_adjustment (material_id, made_on, way, qty, reason, ex_tax_cost, client_uuid,
                                created_by)
  VALUES ('66666666-6666-6666-6666-666666666666','2026-10-05','on',1,'found',0.31,
          '36e36e36-0000-4000-8000-000000000003','a0a0a0a0-0000-4000-8000-0000000000a2')
$$, 'the same uuid from someone else''s phone, theirs');

SELECT must_pass($$
  INSERT INTO service (code, name, unit, client_uuid, sale_kind_id)
  VALUES ('cable-pulling-36e', 'Cable pulling', 'hour', '36e36e36-0000-4000-8000-000000000004', sold_as('repair'))
$$, 'a service added on a phone, with the uuid it made');

SELECT must_fail($$
  INSERT INTO service (code, name, unit, client_uuid, sale_kind_id)
  VALUES ('cable-pulling-36e-2', 'Cable pulling', 'hour', '36e36e36-0000-4000-8000-000000000004', sold_as('repair'))
$$, 'one service sent twice from a phone, made twice');

\echo ''
\echo '=== 37. what was bought or paid for says who paid, and keeps its receipt ==='

-- A draft of its own: section 16's went out, and a sent invoice takes no lines.
INSERT INTO invoice (id, number, entity_id, created_by) VALUES
  ('7777eeee-7777-7777-7777-777777777737','KFS-0437',
   '44444444-4444-4444-4444-444444444444','a0a0a0a0-0000-4000-8000-0000000000a1');

SELECT must_pass($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit, unit_price, amount,
                            taxable, tax_rate_pct, tax_source, ex_tax_cost, tax_paid,
                            bought_from, paid_by, receipt, receipt_type, sale_kind_id)
  VALUES ('7777eeee-7777-7777-7777-777777777737', 37, 'bought', 'Keystone jacks x12', 1, 'each',
          33.33, 33.33, true, 8.0000, 'site', 33.33, 2.67, 'Valley Hardware',
          'a0a0a0a0-0000-4000-8000-0000000000a1', '\xffd8ffe0'::bytea, 'image/jpeg', sold_as('goods'))
$$, 'jacks bought at Valley Hardware, paid by Avery, with the receipt');

SELECT must_pass($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit, unit_price, amount,
                            bought_from, sale_kind_id)
  VALUES ('7777eeee-7777-7777-7777-777777777737', 38, 'paid_for', 'Low-voltage permit', 1, 'each',
          35.00, 35.00, 'City of Woodland', NULL)
$$, 'a permit paid for them, by the business');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount, paid_by, sale_kind_id)
  VALUES ('7777eeee-7777-7777-7777-777777777737', 39, 'service', 'Field service', 1, 95.00, 95.00,
          'a0a0a0a0-0000-4000-8000-0000000000a1', NULL)
$$, 'who paid, said of an hour worked');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount, receipt, sale_kind_id)
  VALUES ('7777eeee-7777-7777-7777-777777777737', 40, 'bought', 'Anchors', 1, 4.00, 4.00,
          '\x25504446'::bytea, sold_as('goods'))
$$, 'a receipt with no type');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount, sale_kind_id)
  VALUES ('7777eeee-7777-7777-7777-777777777737', 41, 'gift', 'Something', 1, 1.00, 1.00, NULL)
$$, 'a kind of line nobody named');

SELECT must_fail($$
  UPDATE operator SET purchase_markup_pct = -5
$$, 'a markup on job purchases below nothing');

\echo ''
\echo '=== 38. a line drawn from stock takes it off the shelf, and gives it back ==='

-- A spool of coax and a box of jacks, each received whole.
INSERT INTO material (id, name, unit_id, sale_kind_id) VALUES
  ('38383838-0000-4000-8000-0000000000aa','Keystone jack',(SELECT id FROM unit WHERE name = 'each'), sold_as('goods'));
INSERT INTO stock_receipt (id, received_on, supplier) VALUES
  ('38383838-0000-4000-8000-0000000000b1','2026-10-01','Delta Wholesale'),
  ('38383838-0000-4000-8000-0000000000b2','2026-10-02','Delta Wholesale');
INSERT INTO material_lot (id, receipt_id, material_id, received_on, qty_received, qty_remaining,
                          ex_tax_cost) VALUES
  ('38383838-0000-4000-8000-000000000001','38383838-0000-4000-8000-0000000000b1',
   '66666666-6666-6666-6666-666666666666','2026-10-01',100,100,31.00),
  ('38383838-0000-4000-8000-000000000002','38383838-0000-4000-8000-0000000000b1',
   '38383838-0000-4000-8000-0000000000aa','2026-10-01',40,40,80.00),
  ('38383838-0000-4000-8000-000000000003','38383838-0000-4000-8000-0000000000b2',
   '66666666-6666-6666-6666-666666666666','2026-10-02',100,100,35.00);
INSERT INTO invoice_line (id, invoice_id, seq, kind, description, qty, unit, unit_price, amount,
                          material_id, ex_tax_cost, tax_paid, sale_kind_id) VALUES
  ('38383838-0000-4000-8000-0000000000b1','7777eeee-7777-7777-7777-777777777737',50,'material',
   'Coax',60,'foot',0.3720,22.32,'66666666-6666-6666-6666-666666666666',18.60,0, sold_as('goods')),
  ('38383838-0000-4000-8000-0000000000b2','7777eeee-7777-7777-7777-777777777737',51,'material',
   'Coax',50,'foot',0.3720,18.60,'66666666-6666-6666-6666-666666666666',15.50,0, sold_as('goods'));

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
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount, material_id, sale_kind_id)
  VALUES ('7777eeee-7777-7777-7777-777777777737', 52, 'service', 'Field service', 1, 95.00, 95.00,
          '66666666-6666-6666-6666-666666666666', NULL)
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
                          material_id, ex_tax_cost, tax_paid, sale_kind_id) VALUES
  ('38383838-0000-4000-8000-0000000000b3','7777eeee-7777-7777-7777-777777777738',1,'material',
   'Coax',10,'foot',0.3720,3.72,'66666666-6666-6666-6666-666666666666',3.10,0, sold_as('goods'));
INSERT INTO stock_draw (invoice_line_id, material_lot_id, material_id, qty) VALUES
  ('38383838-0000-4000-8000-0000000000b3','38383838-0000-4000-8000-000000000001',
   '66666666-6666-6666-6666-666666666666',10);
UPDATE invoice SET status='sent', issued_on = '2026-10-03', due_on = '2026-11-02', sent_at = now(),
       public_token=gen_random_uuid()::text
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
                            material_id, ex_tax_cost, tax_paid, sale_kind_id) VALUES
    ('38383838-0000-4000-8000-0000000000b4','7777eeee-7777-7777-7777-777777777739',1,'material',
     'Coax',25,'foot',0.3720,9.30,'66666666-6666-6666-6666-666666666666',7.75,0, sold_as('goods'));
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
                            amount, bought_from, created_by, sale_kind_id)
  VALUES ('39393939-0000-4000-8000-000000000001', '7777eeee-7777-7777-7777-777777777737', 60,
          'paid_for', 'Low-voltage permit', 1, 'each', 35.00, 35.00, 'City of Woodland',
          'a0a0a0a0-0000-4000-8000-0000000000a2', NULL)
$$, 'a permit added on a phone');

SELECT must_fail($$
  INSERT INTO invoice_line (client_uuid, invoice_id, seq, kind, description, qty, unit, unit_price,
                            amount, bought_from, created_by, sale_kind_id)
  VALUES ('39393939-0000-4000-8000-000000000001', '7777eeee-7777-7777-7777-777777777737', 61,
          'paid_for', 'Low-voltage permit', 1, 'each', 35.00, 35.00, 'City of Woodland',
          'a0a0a0a0-0000-4000-8000-0000000000a2', NULL)
$$, 'the same permit, sent again after a timeout');

-- The uuid is its maker's own, as for time.
SELECT must_pass($$
  INSERT INTO invoice_line (client_uuid, invoice_id, seq, kind, description, qty, unit, unit_price,
                            amount, bought_from, created_by, sale_kind_id)
  VALUES ('39393939-0000-4000-8000-000000000001', '7777eeee-7777-7777-7777-777777777737', 61,
          'paid_for', 'Bucket truck', 1, 'each', 90.00, 90.00, 'Valley Rentals',
          'a0a0a0a0-0000-4000-8000-0000000000a1', NULL)
$$, 'the same uuid from someone else, as a line of their own');
DELETE FROM invoice_line WHERE client_uuid = '39393939-0000-4000-8000-000000000001'
   AND created_by = 'a0a0a0a0-0000-4000-8000-0000000000a1';

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
                            bought_from, moved_from_invoice_id, sale_kind_id)
  VALUES ('7777eeee-7777-7777-7777-777777777740', 1, 'paid_for', 'Low-voltage permit', 1, 'each',
          35.00, 35.00, 'City of Woodland', '7777eeee-7777-7777-7777-777777777738', NULL)
$$, 'a permit meant for an invoice that went out, on a new draft');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit, unit_price, amount,
                            moved_from_invoice_id, sale_kind_id)
  VALUES ('7777eeee-7777-7777-7777-777777777740', 2, 'paid_for', 'Low-voltage permit', 1, 'each',
          35.00, 35.00, '7777eeee-7777-7777-7777-0000000000ff', NULL)
$$, 'one saying it was meant for an invoice that never was');

\echo ''
\echo '=== 41. a line keeps its whole history ==='

SELECT must_pass($$
  SELECT set_config('reckon.user_id', 'a0a0a0a0-0000-4000-8000-0000000000a1', true);
  INSERT INTO invoice_line (id, invoice_id, seq, kind, description, qty, unit, unit_price, amount,
                            bought_from, receipt, receipt_type, sale_kind_id)
  VALUES ('41414141-0000-4000-8000-000000000001', '7777eeee-7777-7777-7777-777777777737', 70,
          'bought', 'Anchors', 1, 'each', 4.00, 4.00, 'Valley Hardware',
          '\xffd8ffe0'::bytea, 'image/jpeg', sold_as('goods'));
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
                            bought_from, sale_kind_id)
  VALUES ('41414141-0000-4000-8000-000000000002', '7777eeee-7777-7777-7777-777777777737', 71,
          'paid_for', 'Low-voltage permit', 1, 'each', 35.00, 35.00, 'City of Woodland', NULL);
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
                            bought_from, receipt, receipt_type, sale_kind_id)
  VALUES ('42424242-0000-4000-8000-000000000001', '7777eeee-7777-7777-7777-777777777737', 80,
          'bought', 'Faceplates', 1, 'each', 6.00, 6.00, 'Valley Hardware',
          '\xffd8ffe0'::bytea, 'image/jpeg', sold_as('goods'));
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

\echo ''
\echo '=== 43b. who is on a crew, and a service, keep their history ==='

DO $$ BEGIN
  IF (SELECT array_agg(new_value ORDER BY new_value) FROM record_history h
        JOIN time_entry e ON e.id = h.row_id
       WHERE h.table_name = 'time_entry' AND h.field = 'crew'
         AND e.client_uuid = 'dddddddd-0000-4000-8000-000000000001')
     IS DISTINCT FROM ARRAY['a0a0a0a0-0000-4000-8000-0000000000a1',
                            'a0a0a0a0-0000-4000-8000-0000000000a2'] THEN
    RAISE EXCEPTION 'UNDER-TIGHT: the crew put on was not in the entry''s history';
  END IF;
  RAISE NOTICE '  held      each person put on a crew is in the entry''s history';
END $$;

SELECT must_pass($$
  DELETE FROM time_entry_crew
   WHERE user_id = 'a0a0a0a0-0000-4000-8000-0000000000a2'
     AND time_entry_id = (SELECT id FROM time_entry
                           WHERE client_uuid = 'dddddddd-0000-4000-8000-000000000001')
$$, 'Sam taken off the crew');

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM record_history h JOIN time_entry e ON e.id = h.row_id
                  WHERE h.table_name = 'time_entry' AND h.field = 'crew'
                    AND e.client_uuid = 'dddddddd-0000-4000-8000-000000000001'
                    AND h.old_value = 'a0a0a0a0-0000-4000-8000-0000000000a2'
                    AND h.new_value IS NULL) THEN
    RAISE EXCEPTION 'UNDER-TIGHT: who was taken off the crew was not in its history';
  END IF;
  RAISE NOTICE '  held      who is taken off a crew is in the entry''s history';
END $$;

-- Sam back on, as the sections after have it.
INSERT INTO time_entry_crew (time_entry_id, user_id)
SELECT id, 'a0a0a0a0-0000-4000-8000-0000000000a2' FROM time_entry
 WHERE client_uuid = 'dddddddd-0000-4000-8000-000000000001';

INSERT INTO time_entry (id, client_uuid, worked_on, seconds, crew, worked_by, created_by,
                        entity_id, site_id, service_id)
SELECT '43b43b43-0000-4000-8000-000000000001', '43b43b43-0000-4000-8000-0000000000aa',
       worked_on, seconds, 'team', NULL, created_by, entity_id, site_id, service_id
  FROM time_entry WHERE client_uuid = 'dddddddd-0000-4000-8000-000000000001';
INSERT INTO time_entry_crew (time_entry_id, user_id) VALUES
  ('43b43b43-0000-4000-8000-000000000001','a0a0a0a0-0000-4000-8000-0000000000a1'),
  ('43b43b43-0000-4000-8000-000000000001','a0a0a0a0-0000-4000-8000-0000000000a2');

SELECT must_pass($$
  DELETE FROM time_entry WHERE id = '43b43b43-0000-4000-8000-000000000001'
$$, 'a team entry removed, its crew with it');

DO $$ BEGIN
  IF (SELECT count(*) FROM record_history
       WHERE row_id = '43b43b43-0000-4000-8000-000000000001' AND field = 'crew') <> 2
     OR NOT EXISTS (SELECT 1 FROM record_history
                     WHERE row_id = '43b43b43-0000-4000-8000-000000000001'
                       AND field = '(deleted)') THEN
    RAISE EXCEPTION 'UNDER-TIGHT: a removed entry''s crew was written as taken off, or its removal not kept';
  END IF;
  RAISE NOTICE '  held      a removed entry says so once, not its crew one by one';
END $$;

SELECT must_pass($$
  UPDATE service SET name = 'Field service, on site'
   WHERE id = 'b5000000-0000-4000-8000-000000000055'
$$, 'a service renamed');

INSERT INTO service (id, code, name, unit, sale_kind_id) VALUES
  ('43b43b43-0000-4000-8000-000000000002','gone-43b','Gone soon','each', sold_as('repair'));
DELETE FROM service WHERE id = '43b43b43-0000-4000-8000-000000000002';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM record_history WHERE table_name = 'service' AND field = 'name'
                    AND row_id = 'b5000000-0000-4000-8000-000000000055'
                    AND new_value = 'Field service, on site')
     OR (SELECT count(*) FROM record_history
          WHERE row_id = '43b43b43-0000-4000-8000-000000000002'
            AND field IN ('(added)', '(deleted)')) <> 2 THEN
    RAISE EXCEPTION 'UNDER-TIGHT: a service''s change, adding or removal was not kept';
  END IF;
  RAISE NOTICE '  held      a service keeps when it was added, each change, and its removal';
END $$;

\echo ''
\echo '=== 44. a trip names its vehicle, and its owner is who its miles pay ==='

SELECT must_pass($$
  INSERT INTO vehicle (id, name, owner_id) VALUES
    ('eeeeeeee-0000-4000-8000-000000000001','Tacoma','a0a0a0a0-0000-4000-8000-0000000000a1'),
    ('eeeeeeee-0000-4000-8000-000000000002','Van',NULL)
$$, 'a person''s vehicle, and the business''s');

SELECT must_fail($$
  INSERT INTO vehicle (name, owner_id) VALUES ('  ', NULL)
$$, 'a vehicle with no name');

SELECT must_fail($$
  INSERT INTO vehicle (name, owner_id) VALUES ('Ghost', 'a0a0a0a0-0000-4000-8000-0000000000ff')
$$, 'a vehicle owned by somebody who does not exist');

SELECT must_pass($$
  UPDATE vehicle SET name = 'Tacoma, white', retired_on = '2026-09-01'
   WHERE id = 'eeeeeeee-0000-4000-8000-000000000001'
$$, 'a vehicle renamed and retired');

SELECT must_fail($$
  UPDATE vehicle SET owner_id = 'a0a0a0a0-0000-4000-8000-0000000000a2'
   WHERE id = 'eeeeeeee-0000-4000-8000-000000000001'
$$, 'a vehicle that changes hands');

SELECT must_fail($$
  UPDATE vehicle SET owner_id = 'a0a0a0a0-0000-4000-8000-0000000000a1'
   WHERE id = 'eeeeeeee-0000-4000-8000-000000000002'
$$, 'the business''s vehicle made a person''s');

SELECT must_pass($$
  UPDATE trip SET vehicle_id = 'eeeeeeee-0000-4000-8000-000000000001'
   WHERE id = '88888888-8888-8888-8888-888888888888'
$$, 'a trip names the vehicle it was driven in');

SELECT must_fail($$
  DELETE FROM vehicle WHERE id = 'eeeeeeee-0000-4000-8000-000000000001'
$$, 'a vehicle removed while a trip names it');

SELECT must_pass($$
  INSERT INTO pay_rule (service_id, role_id, pays_for, method, amount, effective_from)
  VALUES ('b5000000-0000-4000-8000-000000000057',(SELECT id FROM role WHERE name = 'Partner'),
          'vehicle','percent', 100, '2026-08-01')
$$, 'a vehicle paid a share of each leg');

SELECT must_fail($$
  INSERT INTO pay_rule (service_id, role_id, pays_for, method, amount, effective_from)
  VALUES ('b5000000-0000-4000-8000-000000000057',(SELECT id FROM role WHERE name = 'Partner'),
          'vehicle','per_hour', 10, '2026-08-02')
$$, 'a vehicle paid by the hour');

\echo ''
\echo '=== 45. a trip is recorded: why, the odometer, where each stop was for, where each leg went ==='

SELECT must_pass($$
  INSERT INTO trip (id, travelled_on, driven_by, created_by, client_uuid, note,
                    odometer_start, odometer_end, end_address)
  VALUES ('88888888-0000-4000-8000-000000000045','2026-09-02',
          'a0a0a0a0-0000-4000-8000-0000000000a1','a0a0a0a0-0000-4000-8000-0000000000a1',
          'ffffffff-0000-4000-8000-000000000045','Survey, then home by the yard',
          48213, 48270.5, '1 Yard Rd, Auburn')
$$, 'a trip with what it was for, its odometer, and where it ended');

SELECT must_fail($$
  INSERT INTO trip (travelled_on, driven_by, created_by, client_uuid)
  VALUES ('2026-09-02','a0a0a0a0-0000-4000-8000-0000000000a1',
          'a0a0a0a0-0000-4000-8000-0000000000a1','ffffffff-0000-4000-8000-000000000045')
$$, 'the same trip sent twice');

SELECT must_fail($$
  INSERT INTO trip (travelled_on, driven_by, created_by, odometer_start, odometer_end)
  VALUES ('2026-09-02','a0a0a0a0-0000-4000-8000-0000000000a1',
          'a0a0a0a0-0000-4000-8000-0000000000a1', 48270, 48213)
$$, 'an odometer that reads backwards');

SELECT must_fail($$
  INSERT INTO trip (travelled_on, driven_by, created_by, odometer_start)
  VALUES ('2026-09-02','a0a0a0a0-0000-4000-8000-0000000000a1',
          'a0a0a0a0-0000-4000-8000-0000000000a1', 48270)
$$, 'one odometer reading without the other');

SELECT must_fail($$
  INSERT INTO trip (travelled_on, driven_by, created_by, start_address)
  VALUES ('2026-09-02','a0a0a0a0-0000-4000-8000-0000000000a1',
          'a0a0a0a0-0000-4000-8000-0000000000a1', '  ')
$$, 'a trip that started nowhere');

SELECT must_pass($$
  INSERT INTO trip_stop (id, trip_id, seq, site_id) VALUES
    ('9a9a9a9a-0000-4000-8000-000000000045','88888888-0000-4000-8000-000000000045', 1,
     'c5000000-0000-4000-8000-000000000001')
$$, 'a stop at a site');

SELECT must_fail($$
  INSERT INTO trip_stop (trip_id, seq, site_id, address) VALUES
    ('88888888-0000-4000-8000-000000000045', 2, 'c5000000-0000-4000-8000-000000000001',
     '101 Maple St, Auburn')
$$, 'a stop that is a site and an address at once');

SELECT must_pass($$
  INSERT INTO trip_stop_client (trip_stop_id, entity_id, site_id, asked_there) VALUES
    ('9a9a9a9a-0000-4000-8000-000000000045','44444444-4444-4444-4444-444444444444',
     'c5000000-0000-4000-8000-000000000001', false),
    ('9a9a9a9a-0000-4000-8000-000000000045','44444444-0000-4000-8000-000000000002', NULL, true)
$$, 'a stop for its site''s client, and for one who asked once there');

SELECT must_fail($$
  INSERT INTO trip_stop_client (trip_stop_id, entity_id, site_id) VALUES
    ('9a9a9a9a-0000-4000-8000-000000000045','44444444-0000-4000-8000-000000000003',
     'c5000000-0000-4000-8000-000000000001')
$$, 'a stop for a client at a site that is not theirs');

SELECT must_pass($$
  INSERT INTO trip_leg (trip_id, seq, miles, entity_id, site_id, rule, service_id, to_stop_id)
  VALUES ('88888888-0000-4000-8000-000000000045', 1, 30, '44444444-4444-4444-4444-444444444444',
          'c5000000-0000-4000-8000-000000000001', 'chosen', 'b5000000-0000-4000-8000-000000000057',
          '9a9a9a9a-0000-4000-8000-000000000045')
$$, 'a leg to its stop, given by hand');

SELECT must_fail($$
  INSERT INTO trip_leg (trip_id, seq, miles, to_stop_id)
  VALUES ('88888888-8888-8888-8888-888888888888', 9, 30, '9a9a9a9a-0000-4000-8000-000000000045')
$$, 'a leg to a stop on another trip');

\echo ''
\echo '=== 46. pay is recorded when it is paid, once, and stands ==='

SELECT must_pass($$
  INSERT INTO person_payment (id, user_id, paid_on, how, client_uuid, created_by) VALUES
    ('f0f0f0f0-0000-4000-8000-000000000001','a0a0a0a0-0000-4000-8000-0000000000a1','2026-10-01',
     'Bank transfer','f1f1f1f1-0000-4000-8000-000000000001','a0a0a0a0-0000-4000-8000-0000000000a1'),
    ('f0f0f0f0-0000-4000-8000-000000000002','a0a0a0a0-0000-4000-8000-0000000000a2','2026-10-01',
     'Cash','f1f1f1f1-0000-4000-8000-000000000002','a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'a payment to each partner');

SELECT must_pass($$
  INSERT INTO person_payment_item (payment_id, user_id, time_entry_id, amount, said, paid_as)
  SELECT 'f0f0f0f0-0000-4000-8000-000000000001','a0a0a0a0-0000-4000-8000-0000000000a1', id,
         45.00, 'Field service · 1 hr · $45.00 an hour', 'guaranteed_payment'
    FROM time_entry WHERE crew = 'one' ORDER BY id LIMIT 1
$$, 'an entry''s time, paid');

SELECT must_pass($$
  INSERT INTO person_payment_item (payment_id, user_id, trip_id, amount, said, paid_as)
  VALUES ('f0f0f0f0-0000-4000-8000-000000000001','a0a0a0a0-0000-4000-8000-0000000000a1',
          '88888888-0000-4000-8000-000000000045', 30.00, 'Trip in the Tacoma · 30.0 mi', 'reimbursement')
$$, 'a trip''s miles, paid to the vehicle''s owner');

SELECT must_fail($$
  INSERT INTO person_payment_item (payment_id, user_id, time_entry_id, amount, said, paid_as)
  SELECT 'f0f0f0f0-0000-4000-8000-000000000001','a0a0a0a0-0000-4000-8000-0000000000a1', id,
         45.00, 'Field service · 1 hr', 'guaranteed_payment'
    FROM time_entry WHERE crew = 'one' ORDER BY id LIMIT 1
$$, 'the same work paid to a person twice');

SELECT must_fail($$
  INSERT INTO person_payment_item (payment_id, user_id, trip_id, amount, said, paid_as)
  VALUES ('f0f0f0f0-0000-4000-8000-000000000002','a0a0a0a0-0000-4000-8000-0000000000a1',
          '88888888-8888-8888-8888-888888888888', 10.00, 'Trip', 'reimbursement')
$$, 'an item on one person''s payment for another');

SELECT must_pass($$
  INSERT INTO person_payment (id, user_id, paid_on, how, client_uuid, created_by) VALUES
    ('f0f0f0f0-0000-4000-8000-000000000003','a0a0a0a0-0000-4000-8000-0000000000a2','2026-10-15',
     'Cash','f1f1f1f1-0000-4000-8000-000000000004','a0a0a0a0-0000-4000-8000-0000000000a1');
  INSERT INTO person_payment_item (payment_id, user_id, corrects_payment_id, amount, said, paid_as)
  VALUES ('f0f0f0f0-0000-4000-8000-000000000003','a0a0a0a0-0000-4000-8000-0000000000a2',
          'f0f0f0f0-0000-4000-8000-000000000002', -5.00, 'Paid a visit twice', 'guaranteed_payment')
$$, 'a correction to an earlier payment, taking something back');

SELECT must_fail($$
  INSERT INTO person_payment_item (payment_id, user_id, corrects_payment_id, amount, said, paid_as)
  VALUES ('f0f0f0f0-0000-4000-8000-000000000002','a0a0a0a0-0000-4000-8000-0000000000a2',
          'f0f0f0f0-0000-4000-8000-000000000002', -5.00, 'Itself', 'guaranteed_payment')
$$, 'a payment correcting itself');

SELECT must_fail($$
  INSERT INTO person_payment_item (payment_id, user_id, corrects_payment_id, amount, said, paid_as)
  VALUES ('f0f0f0f0-0000-4000-8000-000000000002','a0a0a0a0-0000-4000-8000-0000000000a2',
          'f0f0f0f0-0000-4000-8000-000000000001', -5.00, 'Not theirs', 'guaranteed_payment')
$$, 'a correction to somebody else''s payment');

SELECT must_fail($$
  INSERT INTO person_payment_item (payment_id, user_id, trip_id, amount, said, paid_as)
  VALUES ('f0f0f0f0-0000-4000-8000-000000000002','a0a0a0a0-0000-4000-8000-0000000000a2',
          '88888888-8888-8888-8888-888888888888', -10.00, 'Trip', 'reimbursement')
$$, 'work that takes something back');

SELECT must_fail($$
  INSERT INTO person_payment_item (payment_id, user_id, trip_id, corrects_payment_id, amount, said, paid_as)
  VALUES ('f0f0f0f0-0000-4000-8000-000000000003','a0a0a0a0-0000-4000-8000-0000000000a2',
          '88888888-8888-8888-8888-888888888888','f0f0f0f0-0000-4000-8000-000000000002', 1.00, 'Both', 'reimbursement')
$$, 'an item that is two things');

SELECT must_fail($$
  INSERT INTO person_payment_item (payment_id, user_id, trip_id, amount, said, paid_as)
  VALUES ('f0f0f0f0-0000-4000-8000-000000000002','a0a0a0a0-0000-4000-8000-0000000000a2',
          '88888888-8888-8888-8888-888888888888', 1.00, '  ', 'reimbursement')
$$, 'an item that does not say how');

SELECT must_fail($$
  INSERT INTO person_payment (user_id, paid_on, how, client_uuid, created_by)
  VALUES ('a0a0a0a0-0000-4000-8000-0000000000a1','2026-10-02',' ',
          'f1f1f1f1-0000-4000-8000-000000000003','a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'a payment that does not say how');

SELECT must_fail($$
  UPDATE person_payment SET paid_on = '2026-10-02'
   WHERE id = 'f0f0f0f0-0000-4000-8000-000000000001'
$$, 'a payment changed after it is recorded');

SELECT must_fail($$
  DELETE FROM person_payment_item WHERE payment_id = 'f0f0f0f0-0000-4000-8000-000000000001'
$$, 'what a payment covered taken away');

SELECT must_fail($$
  DELETE FROM trip WHERE id = '88888888-0000-4000-8000-000000000045'
$$, 'a trip removed after its miles are paid');

\echo ''
\echo '=== 47. a role says what its pay is, and an item what it paid ==='

SELECT must_pass($$
  DO $d$ BEGIN
    IF (SELECT string_agg(name || '=' || pays_as, ',' ORDER BY name) FROM role
         WHERE name IN ('Partner', 'Employee', 'Contractor'))
       IS DISTINCT FROM 'Contractor=fee,Employee=wages,Partner=guaranteed_payment'
    THEN RAISE EXCEPTION 'they do not say'; END IF;
  END $d$
$$, 'the roles every operator starts with say what they pay');

SELECT must_pass($$
  INSERT INTO role (name) VALUES ('Trainee')
$$, 'a role that has not said what it pays');

SELECT must_fail($$
  UPDATE role SET pays_as = 'salary' WHERE name = 'Trainee'
$$, 'a role paid as something not on the list');

SELECT must_pass($$
  UPDATE role SET pays_as = 'wages' WHERE name = 'Trainee'
$$, 'a role saying what it pays');

SELECT must_fail($$
  INSERT INTO person_payment_item (payment_id, user_id, time_entry_id, amount, said, paid_as)
  SELECT 'f0f0f0f0-0000-4000-8000-000000000002','a0a0a0a0-0000-4000-8000-0000000000a2', id,
         45.00, 'Field service · 1 hr', 'reimbursement'
    FROM time_entry WHERE crew = 'one' ORDER BY id LIMIT 1
$$, 'time paid as a reimbursement');

SELECT must_fail($$
  INSERT INTO person_payment_item (payment_id, user_id, trip_id, amount, said, paid_as)
  VALUES ('f0f0f0f0-0000-4000-8000-000000000002','a0a0a0a0-0000-4000-8000-0000000000a2',
          '88888888-8888-8888-8888-888888888888', 10.00, 'Trip', 'guaranteed_payment')
$$, 'a trip''s miles paid as pay, not paid back');

SELECT must_fail($$
  INSERT INTO person_payment_item (payment_id, user_id, time_entry_id, amount, said, paid_as)
  SELECT 'f0f0f0f0-0000-4000-8000-000000000002','a0a0a0a0-0000-4000-8000-0000000000a2', id,
         45.00, 'Field service · 1 hr', 'salary'
    FROM time_entry WHERE crew = 'one' ORDER BY id LIMIT 1
$$, 'an item paid as something not on the list');

SELECT must_fail($$
  INSERT INTO person_payment_item (payment_id, user_id, time_entry_id, amount, said)
  SELECT 'f0f0f0f0-0000-4000-8000-000000000002','a0a0a0a0-0000-4000-8000-0000000000a2', id,
         45.00, 'Field service · 1 hr'
    FROM time_entry WHERE crew = 'one' ORDER BY id LIMIT 1
$$, 'an item that does not say what it paid');

SELECT must_pass($$
  INSERT INTO person_payment_item (payment_id, user_id, corrects_payment_id, amount, said, paid_as)
  VALUES ('f0f0f0f0-0000-4000-8000-000000000003','a0a0a0a0-0000-4000-8000-0000000000a2',
          'f0f0f0f0-0000-4000-8000-000000000002', 2.00, 'Miles short', 'reimbursement')
$$, 'a correction to what an earlier payment paid back');

\echo ''
\echo '=== 48. an invoice is sent with its link, and paid is its balance ==='

INSERT INTO invoice (id, number, entity_id, created_by) VALUES
  ('77777777-0000-4000-8000-0000000000e1','INV-0480',
   '44444444-4444-4444-4444-444444444444','a0a0a0a0-0000-4000-8000-0000000000a1');
INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount, sale_kind_id)
VALUES ('77777777-0000-4000-8000-0000000000e1',1,'service','To be sent',1,40,40, NULL);

SELECT must_fail($$
  UPDATE invoice SET public_token = 'a-draft-has-no-link-to-give'
   WHERE id = '77777777-0000-4000-8000-0000000000e1'
$$, 'a draft with a link');

SELECT must_fail($$
  UPDATE invoice SET status = 'sent', issued_on = '2026-10-08', due_on = '2026-11-07', sent_at = now()
   WHERE id = '77777777-0000-4000-8000-0000000000e1'
$$, 'an invoice sent without its link');

SELECT must_fail($$
  UPDATE invoice SET status = 'sent', issued_on = '2026-10-08', due_on = '2026-11-07', sent_at = now(),
         public_token = (SELECT public_token FROM invoice WHERE public_token IS NOT NULL LIMIT 1)
   WHERE id = '77777777-0000-4000-8000-0000000000e1'
$$, 'two invoices sharing one link');

SELECT must_pass($$
  UPDATE invoice SET status = 'sent', issued_on = '2026-10-08', due_on = '2026-11-07', sent_at = now(),
         public_token = 'the-link-to-inv-0480-sent-today'
   WHERE id = '77777777-0000-4000-8000-0000000000e1'
$$, 'an invoice sent, dated, with its link');

SELECT must_fail($$
  UPDATE invoice SET public_token = 'a-new-link-for-inv-0480'
   WHERE id = '77777777-0000-4000-8000-0000000000e1'
$$, 'a sent invoice''s link changed');

SELECT must_fail($$
  UPDATE invoice SET public_token = NULL
   WHERE id = '77777777-0000-4000-8000-0000000000e1'
$$, 'a sent invoice''s link taken away');

\echo ''
\echo '=== 49. a taxed line keeps where it was taxed, in which state, and what its rate was made of ==='

INSERT INTO invoice (id, number, entity_id, created_by) VALUES
  ('77777777-0000-4000-8000-0000000000f1','INV-0490',
   '44444444-4444-4444-4444-444444444444','a0a0a0a0-0000-4000-8000-0000000000a1');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            taxable, tax_rate_pct, tax_source, site_id, sale_kind_id)
  VALUES ('77777777-0000-4000-8000-0000000000f1',1,'material','Patch cable',4,6.25,25.00,
          true, 7.2500, 'site', '33333333-3333-3333-3333-333333333333', sold_as('goods'))
$$, 'a line taxed at a site, not saying where');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            taxable, tax_rate_pct, tax_source, site_id, tax_jurisdiction, tax_state, sale_kind_id)
  VALUES ('77777777-0000-4000-8000-0000000000f1',1,'service','Labour',2,95,190.00,
          false, 0, 'none', '33333333-3333-3333-3333-333333333333', 'YUBA CITY', 'CA', NULL)
$$, 'an untaxed line saying where it was taxed');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            taxable, tax_rate_pct, tax_source, site_id, tax_jurisdiction, tax_state, tax_pieces, sale_kind_id)
  VALUES ('77777777-0000-4000-8000-0000000000f1',1,'material','Patch cable',4,6.25,25.00,
          true, 7.2500, 'site', '33333333-3333-3333-3333-333333333333', 'YUBA CITY', 'CA',
          '[{"level": "state", "jurisdiction": "CALIFORNIA", "rate": "7.2500"},
            {"level": "local", "jurisdiction": "YUBA CITY", "rate": "0.5000"}]', sold_as('goods'))
$$, 'pieces that do not make the rate');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            taxable, tax_rate_pct, tax_source, site_id, tax_jurisdiction, tax_state, tax_pieces, sale_kind_id)
  VALUES ('77777777-0000-4000-8000-0000000000f1',1,'material','Patch cable',4,6.25,25.00,
          true, 7.2500, 'site', '33333333-3333-3333-3333-333333333333', 'YUBA CITY', 'CA',
          '[{"level": "county", "jurisdiction": "SUTTER", "rate": "7.2500"}]', sold_as('goods'))
$$, 'a piece levied by no level there is');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            taxable, tax_rate_pct, tax_source, site_id, tax_jurisdiction, tax_state, tax_pieces, sale_kind_id)
  VALUES ('77777777-0000-4000-8000-0000000000f1',1,'material','Patch cable',4,6.25,25.00,
          true, 7.2500, 'site', '33333333-3333-3333-3333-333333333333', 'YUBA CITY', 'CA',
          '[{"level": "state", "jurisdiction": "CALIFORNIA", "rate": 7.25}]', sold_as('goods'))
$$, 'a rate written as a number, which JSON would read as a float');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            taxable, tax_rate_pct, tax_source, site_id, tax_jurisdiction, tax_state, tax_pieces, sale_kind_id)
  VALUES ('77777777-0000-4000-8000-0000000000f1',1,'material','Patch cable',4,6.25,25.00,
          true, 7.2500, 'site', '33333333-3333-3333-3333-333333333333', 'YUBA CITY', 'CA',
          '[{"level": "state", "jurisdiction": " ", "rate": "7.2500"}]', sold_as('goods'))
$$, 'a piece that names nobody');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            taxable, tax_rate_pct, tax_source, tax_override_reason, site_id,
                            tax_jurisdiction, tax_state, tax_pieces, sale_kind_id)
  VALUES ('77777777-0000-4000-8000-0000000000f1',1,'material','Patch cable',4,6.25,25.00,
          true, 8.2500, 'override', 'Marysville jobsite, location not yet on file', '33333333-3333-3333-3333-333333333333',
          'YUBA CITY', 'CA', '[{"level": "state", "jurisdiction": "CALIFORNIA", "rate": "7.2500"},
                         {"level": "local", "jurisdiction": "MARYSVILLE", "rate": "1.0000"}]', sold_as('goods'))
$$, 'pieces of a rate that was not the site''s');

SELECT must_pass($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            taxable, tax_rate_pct, tax_source, tax_override_reason, site_id,
                            tax_jurisdiction, tax_state, sale_kind_id)
  VALUES ('77777777-0000-4000-8000-0000000000f1',1,'material','Patch cable',4,6.25,25.00,
          true, 8.2500, 'override', 'Marysville jobsite, location not yet on file', '33333333-3333-3333-3333-333333333333',
          'YUBA CITY', 'CA', sold_as('goods'))
$$, 'a rate set by hand at a site, saying where');

SELECT must_pass($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            taxable, tax_rate_pct, tax_source, site_id, tax_jurisdiction, tax_state, tax_pieces, sale_kind_id)
  VALUES ('77777777-0000-4000-8000-0000000000f1',2,'material','Patch cable',4,6.25,25.00,
          true, 7.2500, 'site', '33333333-3333-3333-3333-333333333333', 'YUBA CITY', 'CA',
          '[{"level": "state", "jurisdiction": "CALIFORNIA", "rate": "7.2500"}]', sold_as('goods'))
$$, 'a line taxed at its site''s rate, saying where and who levied it');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            taxable, tax_rate_pct, tax_source, site_id, tax_jurisdiction, tax_pieces, sale_kind_id)
  VALUES ('77777777-0000-4000-8000-0000000000f1',3,'material','Patch cable',4,6.25,25.00,
          true, 7.2500, 'site', '33333333-3333-3333-3333-333333333333', 'YUBA CITY',
          '[{"level": "state", "jurisdiction": "CALIFORNIA", "rate": "7.2500"}]', sold_as('goods'))
$$, 'a taxed line not saying which state');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            taxable, tax_rate_pct, tax_source, site_id, tax_jurisdiction, tax_state, tax_pieces, sale_kind_id)
  VALUES ('77777777-0000-4000-8000-0000000000f1',3,'material','Patch cable',4,6.25,25.00,
          true, 7.2500, 'site', '33333333-3333-3333-3333-333333333333', 'YUBA CITY', 'Calif.',
          '[{"level": "state", "jurisdiction": "CALIFORNIA", "rate": "7.2500"}]', sold_as('goods'))
$$, 'a line taxed in a state that is not its two letters');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            taxable, tax_rate_pct, tax_source, site_id, tax_jurisdiction, tax_state, sale_kind_id)
  VALUES ('77777777-0000-4000-8000-0000000000f1',3,'material','Patch cable',4,6.25,25.00,
          true, 7.2500, 'site', '33333333-3333-3333-3333-333333333333', 'YUBA CITY', 'CA', sold_as('goods'))
$$, 'a line taxed at its site''s rate, keeping no pieces');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            taxable, tax_rate_pct, tax_source, site_id, tax_pieces, sale_kind_id)
  VALUES ('77777777-0000-4000-8000-0000000000f1',3,'service','Labour',2,95,190.00,
          false, 0, 'none', '33333333-3333-3333-3333-333333333333',
          '[{"level": "state", "jurisdiction": "CALIFORNIA", "rate": "0"}]', NULL)
$$, 'an untaxed line keeping pieces');

UPDATE invoice SET status = 'sent', issued_on = '2026-10-08', due_on = '2026-11-07', sent_at = now(),
       public_token = 'the-link-to-inv-0490-sent-today'
 WHERE id = '77777777-0000-4000-8000-0000000000f1';

SELECT must_fail($$
  UPDATE invoice_line SET tax_jurisdiction = 'SUTTER COUNTY',
                          tax_pieces = '[{"level": "state", "jurisdiction": "CALIFORNIA", "rate": "7.0000"},
                                         {"level": "local", "jurisdiction": "SUTTER COUNTY", "rate": "0.2500"}]'
   WHERE invoice_id = '77777777-0000-4000-8000-0000000000f1' AND seq = 2
$$, 'where a sent line was taxed, changed');

\echo ''
\echo '=== 50. each person has Full or Field access, and someone active keeps Full ==='

SELECT must_fail($$
  UPDATE "user" SET access = 'admin' WHERE id = 'a0a0a0a0-0000-4000-8000-0000000000a2'
$$, 'an access level that is not Full or Field');

SELECT must_fail($$
  UPDATE "user" SET access = 'field' WHERE id = 'a0a0a0a0-0000-4000-8000-0000000000a1'
$$, 'the only one on Full moved to Field');

SELECT must_fail($$
  UPDATE "user" SET active = false WHERE id = 'a0a0a0a0-0000-4000-8000-0000000000a1'
$$, 'the only one on Full made inactive');

SELECT must_pass($$
  INSERT INTO "user" (id, name, email, access)
  VALUES ('a1000000-0000-4000-8000-000000000050','Second','second@example.com','full')
$$, 'a second person with Full');

SELECT must_pass($$
  UPDATE "user" SET access = 'field' WHERE id = 'a0a0a0a0-0000-4000-8000-0000000000a1'
$$, 'one of two on Full moved to Field');

SELECT must_fail($$
  DELETE FROM "user" WHERE id = 'a1000000-0000-4000-8000-000000000050'
$$, 'the only one left on Full removed');

SELECT must_pass($$
  UPDATE "user" SET access = 'full' WHERE id = 'a0a0a0a0-0000-4000-8000-0000000000a1'
$$, 'Full given back');

SELECT must_pass($$
  DELETE FROM "user" WHERE id = 'a1000000-0000-4000-8000-000000000050'
$$, 'one of two on Full removed');

SELECT must_pass($$
  UPDATE "user" SET active = false WHERE id = 'a0a0a0a0-0000-4000-8000-0000000000a2'
$$, 'someone on Field made inactive');
UPDATE "user" SET active = true WHERE id = 'a0a0a0a0-0000-4000-8000-0000000000a2';

\echo '=== 51. a passkey is one credential, of a kind WebAuthn names, and goes with its person ==='

SELECT must_fail($$
  INSERT INTO account (user_id, account_id, provider_id, password)
  VALUES ('a0a0a0a0-0000-4000-8000-0000000000a1', 'a0a0a0a0-0000-4000-8000-0000000000a1', 'credential', 'hash')
$$, 'a password, of which there are none');

SELECT must_pass($$
  INSERT INTO passkey (public_key, user_id, credential_id, counter, device_type, backed_up)
  VALUES ('pk', 'a0a0a0a0-0000-4000-8000-0000000000a1', 'cred-1', 0, 'multiDevice', true)
$$, 'a passkey synced between someone''s devices');

SELECT must_fail($$
  INSERT INTO passkey (public_key, user_id, credential_id, counter, device_type, backed_up)
  VALUES ('pk', 'a0a0a0a0-0000-4000-8000-0000000000a2', 'cred-1', 0, 'singleDevice', false)
$$, 'the same credential as a second passkey, someone else''s');

SELECT must_fail($$
  INSERT INTO passkey (public_key, user_id, credential_id, counter, device_type, backed_up)
  VALUES ('pk', 'a0a0a0a0-0000-4000-8000-0000000000a2', 'cred-2', 0, 'cloud', false)
$$, 'a passkey of a kind WebAuthn does not name');

SELECT must_fail($$
  INSERT INTO passkey (public_key, user_id, credential_id, counter, device_type, backed_up)
  VALUES ('pk', 'a0a0a0a0-0000-4000-8000-0000000000a2', 'cred-2', -1, 'singleDevice', false)
$$, 'a passkey counted below nothing');

DO $$
DECLARE left_over int;
BEGIN
  INSERT INTO "user" (id, name, email) VALUES
    ('a1000000-0000-4000-8000-000000000051', 'Gone', 'gone@example.com');
  INSERT INTO passkey (public_key, user_id, credential_id, counter, device_type, backed_up)
  VALUES ('pk', 'a1000000-0000-4000-8000-000000000051', 'cred-gone', 0, 'singleDevice', false);
  DELETE FROM "user" WHERE id = 'a1000000-0000-4000-8000-000000000051';
  SELECT count(*) INTO left_over FROM passkey WHERE credential_id = 'cred-gone';
  IF left_over <> 0 THEN
    RAISE EXCEPTION 'GUARD MISSING: a passkey outlived the person it signed in';
  END IF;
  RAISE NOTICE '  keeps     a passkey only while its person is kept';
END $$;
DELETE FROM passkey WHERE credential_id = 'cred-1';

\echo '=== 52. an email says what it said only while it is still to send ==='

SELECT must_pass($$
  INSERT INTO email_message (kind, to_address, subject, body, send_by)
  VALUES ('passkey_added', 'avery@example.com', 'Kestrel: a passkey was added', 'Hello', now() + interval '7 days')
$$, 'an email waiting to be sent, with what it says');

SELECT must_fail($$
  INSERT INTO email_message (kind, to_address, subject, body, send_by)
  VALUES ('passkey_added', 'avery@example.com', 'Kestrel: a passkey was added', NULL, now() + interval '7 days')
$$, 'an email waiting to be sent with nothing to say');

SELECT must_pass($$
  INSERT INTO email_message (kind, to_address, subject, body, send_by, sent_at)
  VALUES ('passkey_added', 'avery@example.com', 'Sent', NULL, now(), now())
$$, 'an email sent, keeping nothing of what it said');

SELECT must_pass($$
  INSERT INTO email_message (kind, to_address, subject, body, html, send_by)
  VALUES ('passkey_added', 'avery@example.com', 'Kestrel: a passkey was added', 'Hello', '<p>Hello</p>', now() + interval '7 days')
$$, 'an email waiting to be sent, as text and as HTML');

SELECT must_fail($$
  INSERT INTO email_message (kind, to_address, subject, body, html, send_by, sent_at)
  VALUES ('passkey_added', 'avery@example.com', 'Sent', NULL, '<p>Hello</p>', now(), now())
$$, 'an email keeping its HTML without its text');

SELECT must_fail($$
  INSERT INTO email_message (kind, to_address, subject, body, send_by, sent_at)
  VALUES ('passkey_added', 'avery@example.com', 'Sent', 'Hello', now(), now())
$$, 'an email sent, still keeping what it said');

SELECT must_fail($$
  INSERT INTO email_message (kind, to_address, subject, body, send_by, gave_up_at)
  VALUES ('passkey_added', 'avery@example.com', 'Given up', 'Hello', now(), now())
$$, 'an email given up on, still keeping what it said');

SELECT must_fail($$
  INSERT INTO email_message (kind, to_address, subject, send_by, sent_at, gave_up_at)
  VALUES ('passkey_added', 'avery@example.com', 'Both', now(), now(), now())
$$, 'an email both sent and given up on');

SELECT must_fail($$
  INSERT INTO email_message (kind, to_address, subject, body, send_by)
  VALUES ('a_newsletter', 'avery@example.com', 'News', 'Hello', now())
$$, 'an email about something reckon never sends');

SELECT must_fail($$
  INSERT INTO email_message (kind, to_address, subject, body, send_by)
  VALUES ('passkey_added', 'Avery@Example.com', 'Kestrel', 'Hello', now())
$$, 'an email to an address not lowercased');

SELECT must_fail($$
  INSERT INTO email_message (kind, to_address, subject, body, send_by)
  VALUES ('passkey_added', 'avery@example.com', '  ', 'Hello', now())
$$, 'an email with no subject');

SELECT must_fail($$
  INSERT INTO email_message (kind, to_address, subject, body, send_by, tries)
  VALUES ('passkey_added', 'avery@example.com', 'Kestrel', 'Hello', now(), -1)
$$, 'an email tried fewer than no times');

-- What was sent outlives the person it was about, naming nobody, until it ages out.
DO $$
DECLARE kept int;
BEGIN
  INSERT INTO "user" (id, name, email) VALUES
    ('a1000000-0000-4000-8000-000000000052', 'Told', 'told@example.com');
  INSERT INTO email_message (kind, user_id, to_address, subject, send_by, sent_at)
  VALUES ('passkey_link', 'a1000000-0000-4000-8000-000000000052', 'told@example.com', 'Told', now(), now());
  DELETE FROM "user" WHERE id = 'a1000000-0000-4000-8000-000000000052';
  SELECT count(*) INTO kept FROM email_message WHERE to_address = 'told@example.com' AND user_id IS NULL;
  IF kept <> 1 THEN
    RAISE EXCEPTION 'GUARD MISSING: a person taken away took % of their emails with them', 1 - kept;
  END IF;
  RAISE NOTICE '  keeps     an email sent, naming nobody, once its person is taken away';
END $$;

\echo '=== 53. an emailed link works once, for an hour at most, one of a kind at a time ==='

INSERT INTO "user" (id, name, email) VALUES
  ('a1000000-0000-4000-8000-000000000053', 'Invited', 'invited@example.com');

SELECT must_pass($$
  INSERT INTO email_link (user_id, purpose, code_hash, sent_to, expires_at)
  VALUES ('a1000000-0000-4000-8000-000000000053', 'invite', sha256('code-1'::bytea), 'invited@example.com', now() + interval '1 hour')
$$, 'an invitation that works for an hour');

SELECT must_fail($$
  INSERT INTO email_link (user_id, purpose, code_hash, sent_to, created_at, expires_at)
  VALUES ('a1000000-0000-4000-8000-000000000053', 'confirm', sha256('code-2'::bytea), 'invited@example.com', now(), now() + interval '1 hour 1 second')
$$, 'a link that works for longer than an hour');

SELECT must_fail($$
  INSERT INTO email_link (user_id, purpose, code_hash, sent_to, created_at, expires_at)
  VALUES ('a1000000-0000-4000-8000-000000000053', 'confirm', sha256('code-2'::bytea), 'invited@example.com', now(), now())
$$, 'a link that stops working as it is made');

SELECT must_fail($$
  INSERT INTO email_link (user_id, purpose, code_hash, sent_to, expires_at)
  VALUES ('a1000000-0000-4000-8000-000000000053', 'confirm', 'code-2'::bytea, 'invited@example.com', now() + interval '1 hour')
$$, 'a link keeping something other than a SHA-256 of its code');

SELECT must_fail($$
  INSERT INTO email_link (user_id, purpose, code_hash, sent_to, expires_at)
  VALUES ('a1000000-0000-4000-8000-000000000053', 'sign_in', sha256('code-2'::bytea), 'invited@example.com', now() + interval '1 hour')
$$, 'a link for something reckon never sends one for');

SELECT must_fail($$
  INSERT INTO email_link (user_id, purpose, code_hash, sent_to, expires_at)
  VALUES ('a1000000-0000-4000-8000-000000000053', 'confirm', sha256('code-2'::bytea), 'Invited@Example.com', now() + interval '1 hour')
$$, 'a link sent to an address not lowercased');

SELECT must_fail($$
  INSERT INTO email_link (user_id, purpose, code_hash, sent_to, expires_at)
  VALUES ('a1000000-0000-4000-8000-000000000053', 'reset', sha256('code-2'::bytea), 'invited@example.com', now() + interval '1 hour')
$$, 'a second link to make a passkey while one waits');

SELECT must_pass($$
  INSERT INTO email_link (user_id, purpose, code_hash, sent_to, expires_at)
  VALUES ('a1000000-0000-4000-8000-000000000053', 'confirm', sha256('code-3'::bytea), 'invited@example.com', now() + interval '1 hour')
$$, 'a confirmation waiting beside a link to make a passkey');

SELECT must_fail($$
  INSERT INTO email_link (user_id, purpose, code_hash, sent_to, expires_at)
  VALUES ('a1000000-0000-4000-8000-000000000053', 'confirm', sha256('code-4'::bytea), 'invited@example.com', now() + interval '1 hour')
$$, 'a second confirmation while one waits');

SELECT must_pass($$
  INSERT INTO email_link (user_id, purpose, code_hash, sent_to, expires_at)
  VALUES ('a1000000-0000-4000-8000-000000000053', 'change', sha256('code-6'::bytea), 'invited.new@example.com', now() + interval '1 hour')
$$, 'a change to a new address waiting beside the others, sent to the new one');

SELECT must_fail($$
  INSERT INTO email_link (user_id, purpose, code_hash, sent_to, expires_at)
  VALUES ('a1000000-0000-4000-8000-000000000053', 'change', sha256('code-7'::bytea), 'invited.newer@example.com', now() + interval '1 hour')
$$, 'a second change while one waits');

SELECT must_fail($$
  INSERT INTO email_link (user_id, purpose, code_hash, sent_to, expires_at)
  VALUES ('a1000000-0000-4000-8000-000000000053', 'recover', sha256('code-8'::bytea), 'invited@example.com', now() + interval '1 hour')
$$, 'a link to recover a password, which there no longer is');

SELECT must_fail($$
  UPDATE email_link SET used_at = expires_at + interval '1 second'
   WHERE code_hash = sha256('code-1'::bytea)
$$, 'a link used after it stopped working');

SELECT must_fail($$
  UPDATE email_link SET used_at = created_at - interval '1 second'
   WHERE code_hash = sha256('code-1'::bytea)
$$, 'a link used before it was made');

SELECT must_pass($$
  UPDATE email_link SET used_at = now() WHERE code_hash = sha256('code-1'::bytea)
$$, 'a link used while it works');

SELECT must_pass($$
  INSERT INTO email_link (user_id, purpose, code_hash, sent_to, expires_at)
  VALUES ('a1000000-0000-4000-8000-000000000053', 'reset', sha256('code-5'::bytea), 'invited@example.com', now() + interval '1 hour')
$$, 'a new link to make a passkey once the last was used');

SELECT must_fail($$
  INSERT INTO email_link (user_id, purpose, code_hash, sent_to, expires_at)
  VALUES ('a0a0a0a0-0000-4000-8000-0000000000a2', 'reset', sha256('code-5'::bytea), 'sam@example.com', now() + interval '1 hour')
$$, 'two links with the same code');

SELECT must_pass($$
  INSERT INTO email_message (kind, to_address, subject, body, send_by)
  VALUES ('invitation', 'invited@example.com', 'Kestrel: make your passkey', 'Hello', now() + interval '1 hour')
$$, 'an email carrying an invitation');

SELECT must_pass($$
  INSERT INTO email_message (kind, to_address, subject, body, send_by)
  VALUES ('email_changing', 'invited@example.com', 'Kestrel: your sign-in email is changing', 'Hello', now() + interval '7 days')
$$, 'an email telling an address it is to be changed');

-- A person's links go with them; one they sent outlives them, naming nobody.
DO $$
DECLARE left_over int; sender uuid;
BEGIN
  INSERT INTO "user" (id, name, email) VALUES
    ('a1000000-0000-4000-8000-000000000054', 'Sender', 'sender@example.com');
  UPDATE email_link SET sent_by = 'a1000000-0000-4000-8000-000000000054'
   WHERE code_hash = sha256('code-5'::bytea);
  DELETE FROM "user" WHERE id = 'a1000000-0000-4000-8000-000000000054';
  SELECT sent_by INTO sender FROM email_link WHERE code_hash = sha256('code-5'::bytea);
  IF sender IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD MISSING: a link still names who sent it after they were taken away';
  END IF;
  DELETE FROM "user" WHERE id = 'a1000000-0000-4000-8000-000000000053';
  SELECT count(*) INTO left_over FROM email_link WHERE sent_to = 'invited@example.com';
  IF left_over <> 0 THEN
    RAISE EXCEPTION 'GUARD MISSING: % link(s) outlived the person they were for', left_over;
  END IF;
  RAISE NOTICE '  keeps     a link only while its person is kept, and its sender only while theirs is';
END $$;

SELECT must_pass($$
  INSERT INTO link_try (address, network) VALUES ('192.0.2.7', '192.0.2.7/32')
$$, 'a code tried, counted against the network it came from');

SELECT must_fail($$
  INSERT INTO link_try (address, network) VALUES ('192.0.2.7', '198.51.100.0/24')
$$, 'a code tried, counted against a network it did not come from');


\echo ''
\echo '=== 54. a security event is stamped by the database, never changed, and kept a year ==='

INSERT INTO "user" (id, name, email) VALUES
  ('a1000000-0000-4000-8000-000000000060', 'Logged', 'logged@example.com'),
  ('a1000000-0000-4000-8000-000000000061', 'Logger', 'logger@example.com');

SELECT must_pass($$
  INSERT INTO security_event (name, user_id, by_id, client_address, user_agent, detail)
  VALUES ('authz_change', 'a1000000-0000-4000-8000-000000000060', 'a1000000-0000-4000-8000-000000000061',
          '192.0.2.7', 'Mozilla/5.0', '{"from":"field","to":"full"}')
$$, 'an access change, by someone else, from where it came');

SELECT must_pass($$
  INSERT INTO security_event (name) VALUES ('authn_link_refused')
$$, 'a refusal about nobody reckon knows');

SELECT must_fail($$
  INSERT INTO security_event (name) VALUES ('authn_password_change')
$$, 'an event the vocabulary here does not name');

SELECT must_fail($$
  INSERT INTO security_event (name, user_id, by_id)
  VALUES ('user_updated', 'a1000000-0000-4000-8000-000000000060', 'a1000000-0000-4000-8000-000000000060')
$$, 'someone as the one who did it to themselves: by is someone else');

SELECT must_fail($$
  INSERT INTO security_event (name, user_agent) VALUES ('authn_login_fail', repeat('x', 513))
$$, 'a user agent longer than 512 characters');

DO $$
DECLARE stamped timestamptz;
BEGIN
  INSERT INTO security_event (at, name, user_id)
  VALUES ('2000-01-01', 'authn_login_success', 'a1000000-0000-4000-8000-000000000060')
  RETURNING at INTO stamped;
  IF stamped < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'GUARD MISSING: a security event kept the time it claimed, %', stamped;
  END IF;
  RAISE NOTICE '  stamps    a security event with the database''s clock, whatever it claims';
END $$;

SELECT must_fail($$
  UPDATE security_event SET name = 'authn_login_success' WHERE name = 'authz_change'
$$, 'a security event changed');

SELECT must_fail($$
  DELETE FROM security_event WHERE name = 'authz_change'
$$, 'a security event removed while it is under a year old');

-- One a year and a day old -- put there with the stamp switched off, as only
-- the owner can -- is removed, as the server removes them every day.
DO $$
DECLARE gone int;
BEGIN
  ALTER TABLE security_event DISABLE TRIGGER stamped;
  INSERT INTO security_event (at, name) VALUES (now() - interval '1 year 1 day', 'authn_login_fail');
  ALTER TABLE security_event ENABLE TRIGGER stamped;
  DELETE FROM security_event WHERE at < now() - interval '1 year';
  GET DIAGNOSTICS gone = ROW_COUNT;
  IF gone <> 1 THEN
    RAISE EXCEPTION 'GUARD WRONG: % security event(s) a year old removed, not 1', gone;
  END IF;
  RAISE NOTICE '  removes   a security event once it is a year old, and only then';
END $$;

SELECT must_fail($$
  DELETE FROM "user" WHERE id = 'a1000000-0000-4000-8000-000000000060'
$$, 'someone in the security log deleted: they are made inactive instead');


\echo ''
\echo '=== 55. history covers people and every row added, is written by triggers alone, and stands ==='

INSERT INTO "user" (id, name, email) VALUES
  ('a1000000-0000-4000-8000-000000000070', 'Kept', 'kept@example.com'),
  ('a1000000-0000-4000-8000-000000000071', 'Keeper', 'keeper@example.com');

DO $$
DECLARE added int; first_save bigint; second_save bigint; fields text[]; skipped int;
BEGIN
  SELECT count(*) INTO added FROM record_history
   WHERE table_name = 'user' AND row_id = 'a1000000-0000-4000-8000-000000000070' AND field = '(added)';
  IF added <> 1 THEN
    RAISE EXCEPTION 'GUARD MISSING: a person added is in history % time(s), not once', added;
  END IF;

  PERFORM set_config('reckon.user_id', 'a1000000-0000-4000-8000-000000000071', true);
  UPDATE "user" SET name = 'Kept Still', access = 'full'
   WHERE id = 'a1000000-0000-4000-8000-000000000070';
  SELECT array_agg(field ORDER BY field), min(xact) INTO fields, first_save FROM record_history
   WHERE table_name = 'user' AND row_id = 'a1000000-0000-4000-8000-000000000070' AND field <> '(added)';
  IF fields IS DISTINCT FROM ARRAY['access', 'name'] THEN
    RAISE EXCEPTION 'GUARD MISSING: a person''s change kept as %, not access and name', fields;
  END IF;
  IF (SELECT count(DISTINCT xact) FROM record_history
       WHERE table_name = 'user' AND row_id = 'a1000000-0000-4000-8000-000000000070' AND field <> '(added)') <> 1
     OR first_save IS NULL THEN
    RAISE EXCEPTION 'GUARD MISSING: the fields of one save do not share its transaction';
  END IF;
  IF EXISTS (SELECT 1 FROM record_history
              WHERE table_name = 'user' AND row_id = 'a1000000-0000-4000-8000-000000000070'
                AND field = 'name' AND changed_by IS DISTINCT FROM 'a1000000-0000-4000-8000-000000000071') THEN
    RAISE EXCEPTION 'GUARD MISSING: a person''s change does not say who made it';
  END IF;

  UPDATE "user" SET last_signed_in_at = now(), updated_at = now() + interval '1 second'
   WHERE id = 'a1000000-0000-4000-8000-000000000070';
  SELECT count(*) INTO skipped FROM record_history
   WHERE table_name = 'user' AND row_id = 'a1000000-0000-4000-8000-000000000070'
     AND field IN ('last_signed_in_at', 'updated_at');
  IF skipped <> 0 THEN
    RAISE EXCEPTION 'GUARD WRONG: signing in, or Better Auth''s updated_at, kept in history (% rows)', skipped;
  END IF;
  RAISE NOTICE '  keeps     a person added, and each field changed, with who and the save it was part of';
  RAISE NOTICE '  leaves    out when someone signed in, which is no change to them';
END $$;

DO $$
DECLARE other bigint; earlier bigint;
BEGIN
  UPDATE "user" SET name = 'Kept Again' WHERE id = 'a1000000-0000-4000-8000-000000000070';
  SELECT xact INTO other FROM record_history
   WHERE table_name = 'user' AND row_id = 'a1000000-0000-4000-8000-000000000070' AND new_value = 'Kept Again';
  SELECT xact INTO earlier FROM record_history
   WHERE table_name = 'user' AND row_id = 'a1000000-0000-4000-8000-000000000070' AND new_value = 'Kept Still';
  IF other IS NOT DISTINCT FROM earlier THEN
    RAISE EXCEPTION 'GUARD MISSING: two saves share a transaction in history';
  END IF;
  RAISE NOTICE '  tells     one save from the next';
END $$;

DO $$
DECLARE added int;
BEGIN
  INSERT INTO entity (id, name, slug) VALUES ('a1000000-0000-4000-8000-000000000072', 'Added Client', 'added-client');
  SELECT count(*) INTO added FROM record_history
   WHERE table_name = 'entity' AND row_id = 'a1000000-0000-4000-8000-000000000072' AND field = '(added)';
  IF added <> 1 THEN
    RAISE EXCEPTION 'GUARD MISSING: a client added is in history % time(s), not once', added;
  END IF;
  RAISE NOTICE '  keeps     each row added to a table whose changes are kept';
END $$;

SELECT must_fail($$
  INSERT INTO record_history (table_name, row_id, field, old_value, new_value)
  VALUES ('invoice', 'a1000000-0000-4000-8000-000000000072', 'total', '100', '1')
$$, 'history written other than by a table''s own trigger');

SELECT must_fail($$
  UPDATE record_history SET new_value = 'Someone Else'
   WHERE row_id = 'a1000000-0000-4000-8000-000000000070' AND field = 'name'
$$, 'history changed');

SELECT must_fail($$
  DELETE FROM record_history WHERE row_id = 'a1000000-0000-4000-8000-000000000070'
$$, 'history removed');

SELECT must_fail($$
  DELETE FROM "user" WHERE id = 'a1000000-0000-4000-8000-000000000071'
$$, 'someone history says made a change deleted: they are made inactive instead');


\echo ''
\echo '=== 56. a time entry changes after the fact, counting its saves, until it is billed or paid ==='

DO $$
DECLARE e uuid; v int; kept int;
BEGIN
  SELECT t.id INTO e FROM time_entry t
   WHERE NOT EXISTS (SELECT 1 FROM invoice_line il WHERE il.time_entry_id = t.id)
     AND NOT EXISTS (SELECT 1 FROM person_payment_item p WHERE p.time_entry_id = t.id)
   ORDER BY t.id LIMIT 1;
  SELECT version INTO v FROM time_entry WHERE id = e;
  UPDATE time_entry SET note = 'Changed after the fact' WHERE id = e;
  IF (SELECT version FROM time_entry WHERE id = e) <> v + 1 THEN
    RAISE EXCEPTION 'GUARD MISSING: a changed entry did not count the save';
  END IF;
  UPDATE time_entry SET note = 'Changed after the fact' WHERE id = e;
  IF (SELECT version FROM time_entry WHERE id = e) <> v + 1 THEN
    RAISE EXCEPTION 'GUARD WRONG: a save that changed nothing was counted';
  END IF;
  SELECT count(*) INTO kept FROM record_history
   WHERE table_name = 'time_entry' AND row_id = e AND field = 'version';
  IF kept <> 0 THEN
    RAISE EXCEPTION 'GUARD WRONG: history keeps the count of saves (% rows)', kept;
  END IF;
  RAISE NOTICE '  counts    each save that changes an entry, and only those, outside its history';
END $$;

SELECT must_fail($$
  UPDATE time_entry SET note = 'Billed, then changed'
   WHERE id = (SELECT time_entry_id FROM invoice_line WHERE time_entry_id IS NOT NULL LIMIT 1)
$$, 'changing an entry an invoice was built from');

SELECT must_fail($$
  UPDATE time_entry SET note = 'Paid, then changed'
   WHERE id = (SELECT time_entry_id FROM person_payment_item WHERE time_entry_id IS NOT NULL LIMIT 1)
$$, 'changing an entry a payment was recorded for');

\echo ''
\echo '=== 57. a row''s updated_at is when it changed, and signing in is no change ==='

DO $$
DECLARE p uuid := 'a1000000-0000-4000-8000-000000000070';
BEGIN
  -- Set outright, a stamp is kept as it is said: so the checks below can tell
  -- a stamp from none, though the suite runs within one now().
  UPDATE "user" SET updated_at = '2000-01-01Z' WHERE id = p;
  IF (SELECT updated_at FROM "user" WHERE id = p) <> '2000-01-01Z' THEN
    RAISE EXCEPTION 'GUARD WRONG: an updated_at said outright was not kept';
  END IF;
  UPDATE "user" SET last_signed_in_at = coalesce(last_signed_in_at, now()) + interval '1 minute'
   WHERE id = p;
  IF (SELECT updated_at FROM "user" WHERE id = p) <> '2000-01-01Z' THEN
    RAISE EXCEPTION 'GUARD WRONG: signing in was stamped as a change to the person';
  END IF;
  UPDATE "user" SET name = name WHERE id = p;
  IF (SELECT updated_at FROM "user" WHERE id = p) <> '2000-01-01Z' THEN
    RAISE EXCEPTION 'GUARD WRONG: a save that changed nothing was stamped';
  END IF;
  UPDATE "user" SET name = 'Stamped' WHERE id = p;
  IF (SELECT updated_at FROM "user" WHERE id = p) = '2000-01-01Z' THEN
    RAISE EXCEPTION 'GUARD MISSING: a person who changed was not stamped';
  END IF;
  RAISE NOTICE '  stamps    a person who changes, not one who signs in or a save that changes nothing';
END $$;

DO $$
DECLARE s uuid;
BEGIN
  INSERT INTO session (token, user_id, expires_at, updated_at)
  VALUES ('stamped-session', 'a1000000-0000-4000-8000-000000000070', now() + interval '1 day', '2000-01-01Z')
  RETURNING id INTO s;
  UPDATE session SET expires_at = expires_at + interval '1 day' WHERE id = s;
  IF (SELECT updated_at FROM session WHERE id = s) = '2000-01-01Z' THEN
    RAISE EXCEPTION 'GUARD MISSING: a session carried forward was not stamped';
  END IF;
  DELETE FROM session WHERE id = s;
  RAISE NOTICE '  stamps    a session carried forward';
END $$;

\echo '=== 58. two agreements never tie for an hour ==='
-- An hour goes to the client's agreement for its site before the one for the
-- whole client, and the later start of those. Two of a client's agreements for
-- the same place, starting the same day, covering the same service, would leave
-- nothing to choose; the second is refused. A different day, place or service
-- is a different agreement, and stands.
CREATE FUNCTION must_tie(stmt text, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
    IF c = 'agreements_never_tie' THEN
      RAISE NOTICE '  refused   %', label;
      RETURN;
    END IF;
    RAISE EXCEPTION 'GUARD WRONG: % was refused by %, not agreements_never_tie', label, c;
  END;
  RAISE EXCEPTION 'GUARD MISSING: % was allowed', label;
END $$;

-- Beside the client's own agreement, from 1 September, covering help desk.
INSERT INTO agreement (id, entity_id, site_id, price, starts_on, billing_anchor_day) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000a01','bbbbbbbb-0000-4000-8000-000000000003', NULL,
   100.00, '2026-09-01', 1),
  ('bbbbbbbb-0000-4000-8000-000000000a02','bbbbbbbb-0000-4000-8000-000000000003',
   'c5000000-0000-4000-8000-000000000002', 100.00, '2026-09-01', 1),
  ('bbbbbbbb-0000-4000-8000-000000000a03','bbbbbbbb-0000-4000-8000-000000000003', NULL,
   100.00, '2026-09-02', 2),
  ('bbbbbbbb-0000-4000-8000-000000000a04','44444444-0000-4000-8000-000000000003', NULL,
   100.00, '2026-08-01', 1);
SELECT must_tie(
  $q$INSERT INTO agreement_service (agreement_id, service_id, allotment)
     VALUES ('bbbbbbbb-0000-4000-8000-000000000a01','b5000000-0000-4000-8000-000000000056','unlimited')$q$,
  'a second agreement for the whole client, from the same day, covering the same service');
SELECT must_pass(
  $q$INSERT INTO agreement_service (agreement_id, service_id, allotment)
     VALUES ('bbbbbbbb-0000-4000-8000-000000000a01','b5000000-0000-4000-8000-000000000055','unlimited')$q$,
  'the same day and place, covering another service');
SELECT must_tie(
  $q$UPDATE agreement_service SET service_id = 'b5000000-0000-4000-8000-000000000056'
      WHERE agreement_id = 'bbbbbbbb-0000-4000-8000-000000000a01'$q$,
  'the service it covers changed to one the other covers');
SELECT must_pass(
  $q$INSERT INTO agreement_service (agreement_id, service_id, allotment)
     VALUES ('bbbbbbbb-0000-4000-8000-000000000a02','b5000000-0000-4000-8000-000000000056','unlimited')$q$,
  'one of its sites, from the same day, covering the same service');
SELECT must_pass(
  $q$INSERT INTO agreement_service (agreement_id, service_id, allotment)
     VALUES ('bbbbbbbb-0000-4000-8000-000000000a03','b5000000-0000-4000-8000-000000000056','unlimited')$q$,
  'the whole client again from the next day, covering the same service');
SELECT must_tie(
  $q$UPDATE agreement SET starts_on = '2026-09-01', billing_anchor_day = 1
      WHERE id = 'bbbbbbbb-0000-4000-8000-000000000a03'$q$,
  'its start moved onto the day the other starts');
SELECT must_pass(
  $q$INSERT INTO agreement_service (agreement_id, service_id, allotment)
     VALUES ('bbbbbbbb-0000-4000-8000-000000000a04','b5000000-0000-4000-8000-000000000055','unlimited')$q$,
  'another client, from the same day as its own, covering another service');
SELECT must_tie(
  $q$INSERT INTO agreement_service (agreement_id, service_id, allotment)
     VALUES ('bbbbbbbb-0000-4000-8000-000000000a04','b5000000-0000-4000-8000-000000000056','unlimited')$q$,
  'and that client''s own tie, too');
DELETE FROM agreement
 WHERE id IN ('bbbbbbbb-0000-4000-8000-000000000a01','bbbbbbbb-0000-4000-8000-000000000a02',
              'bbbbbbbb-0000-4000-8000-000000000a03','bbbbbbbb-0000-4000-8000-000000000a04');

\echo ''
\echo '=== 59. a sale is one kind, and every state collected in answers every kind ==='

-- THE KINDS ARE THE BUSINESS'S OWN LIST, begun with reckon's four, each once
-- and each staying which it is.
SELECT must_fail($$
  INSERT INTO sale_kind (code, name) VALUES ('goods', 'Goods again')
$$, 'a second of reckon''s goods');

SELECT must_fail($$
  INSERT INTO sale_kind (name) VALUES ('  ')
$$, 'a kind with no name');

SELECT must_fail($$
  INSERT INTO sale_kind (name) VALUES ('repair LABOUR')
$$, 'two kinds of one name, however written');

SELECT must_fail($$
  DELETE FROM sale_kind WHERE code = 'travel'
$$, 'one of reckon''s kinds removed');

SELECT must_fail($$
  UPDATE sale_kind SET code = 'repair' WHERE code = 'installation'
$$, 'one of reckon''s kinds made another');

SELECT must_fail($$
  UPDATE sale_kind SET code = NULL WHERE code = 'installation'
$$, 'one of reckon''s kinds made the business''s');

SELECT must_pass($$
  UPDATE sale_kind SET name = 'Installation', active = false WHERE code = 'installation'
$$, 'one of reckon''s kinds renamed and retired');
UPDATE sale_kind SET name = 'Installation labour', active = true WHERE code = 'installation';

-- EVERY STATE ANSWERS EVERY KIND, by the end of whatever made the state or the
-- kind. Checked at the end of the save, so the answers come with it.
SELECT must_pass($$
  DO $x$ BEGIN
    INSERT INTO sale_kind (id, name) VALUES ('59595959-0000-4000-8000-0000000000a1', 'Help desk');
    INSERT INTO taxability (state, sale_kind_id, taxed)
      SELECT state, '59595959-0000-4000-8000-0000000000a1', false FROM tax_registration;
    SET CONSTRAINTS ALL IMMEDIATE;
  END $x$
$$, 'a kind added with every state''s answer');

SELECT must_fail($$
  DO $x$ BEGIN
    INSERT INTO sale_kind (name) VALUES ('Consulting');
    SET CONSTRAINTS ALL IMMEDIATE;
  END $x$
$$, 'a kind added without California''s answer');

SELECT must_fail($$
  DO $x$ BEGIN
    INSERT INTO tax_registration (state) VALUES ('NV');
    INSERT INTO taxability (state, sale_kind_id, taxed)
      SELECT 'NV', id, true FROM sale_kind WHERE code IS NOT NULL;
    SET CONSTRAINTS ALL IMMEDIATE;
  END $x$
$$, 'a state collected in without an answer for one kind');

SELECT must_pass($$
  DO $x$ BEGIN
    INSERT INTO tax_registration (state) VALUES ('NV');
    INSERT INTO taxability (state, sale_kind_id, taxed, said_by, said_on)
      SELECT 'NV', id, true, 'a0a0a0a0-0000-4000-8000-0000000000a1', '2026-11-19' FROM sale_kind;
    SET CONSTRAINTS ALL IMMEDIATE;
  END $x$
$$, 'a state collected in answering every kind, saying who answered');

SELECT must_fail($$
  DO $x$ BEGIN
    DELETE FROM taxability
     WHERE state = 'NV' AND sale_kind_id = '59595959-0000-4000-8000-0000000000a1';
    SET CONSTRAINTS ALL IMMEDIATE;
  END $x$
$$, 'an answer taken away from its state and kind');

SELECT must_fail($$
  UPDATE taxability SET state = 'CA'
   WHERE state = 'NV' AND sale_kind_id = '59595959-0000-4000-8000-0000000000a1'
$$, 'an answer moved to another state');

SELECT must_fail($$
  UPDATE taxability SET said_on = NULL WHERE state = 'NV'
$$, 'an answer saying who gave it, and not when');

SELECT must_pass($$
  UPDATE taxability SET taxed = false, said_by = 'a0a0a0a0-0000-4000-8000-0000000000a2',
                        said_on = '2026-11-20'
   WHERE state = 'NV' AND sale_kind_id = '59595959-0000-4000-8000-0000000000a1'
$$, 'an answer changed, by whoever changed it');

-- A MATERIAL AND A SERVICE ARE EACH ONE KIND.
SELECT must_fail($$
  INSERT INTO material (name, unit_id) VALUES ('Unsorted', (SELECT id FROM unit WHERE name = 'each'))
$$, 'a material that is no kind of sale');

SELECT must_fail($$
  INSERT INTO service (code, name, unit) VALUES ('unsorted-59', 'Unsorted', 'hour')
$$, 'a service that is no kind of sale');

SELECT must_pass($$
  INSERT INTO service (id, code, name, unit, sale_kind_id)
  VALUES ('59595959-0000-4000-8000-0000000000b1', 'helpdesk-59', 'Remote help', 'hour',
          '59595959-0000-4000-8000-0000000000a1')
$$, 'a service of the business''s own kind');

SELECT must_fail($$
  DELETE FROM sale_kind WHERE id = '59595959-0000-4000-8000-0000000000a1'
$$, 'a kind something is sold as removed');

-- A LINE KEEPS THE KIND IT WAS SOLD AS: goods drawn or bought as goods, and a
-- cost passed on as none.
INSERT INTO invoice (id, number, entity_id, created_by) VALUES
  ('59595959-0000-4000-8000-0000000000c1', 'KS-0059', '44444444-4444-4444-4444-444444444444',
   'a0a0a0a0-0000-4000-8000-0000000000a1');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 1, 'bought', 'Anchors', 1, 4.00, 4.00)
$$, 'goods bought for the job, sold as no kind');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount, sale_kind_id)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 1, 'bought', 'Anchors', 1, 4.00, 4.00,
          sold_as('repair'))
$$, 'goods bought for the job, sold as repair labour');

SELECT must_pass($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount, sale_kind_id)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 1, 'bought', 'Anchors', 1, 4.00, 4.00,
          sold_as('goods'))
$$, 'goods bought for the job, sold as goods');

SELECT must_fail($$
  UPDATE invoice_line SET sale_kind_id = sold_as('travel')
   WHERE invoice_id = '59595959-0000-4000-8000-0000000000c1' AND seq = 1
$$, 'goods bought for the job, sold again as travel');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount, sale_kind_id)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 2, 'paid_for', 'Permit', 1, 40.00, 40.00,
          sold_as('goods'))
$$, 'a cost passed on, sold as goods');

SELECT must_pass($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 2, 'paid_for', 'Permit', 1, 40.00, 40.00)
$$, 'a cost passed on, sold as no kind');

-- A kind nothing is sold as goes, and its answers with it; and so does a
-- state's every answer when the business stops collecting there.
SELECT must_pass($$
  DO $x$ BEGIN
    INSERT INTO sale_kind (id, name) VALUES ('59595959-0000-4000-8000-0000000000a2', 'Consulting');
    INSERT INTO taxability (state, sale_kind_id, taxed)
      SELECT state, '59595959-0000-4000-8000-0000000000a2', false FROM tax_registration;
    DELETE FROM sale_kind WHERE id = '59595959-0000-4000-8000-0000000000a2';
    SET CONSTRAINTS ALL IMMEDIATE;
  END $x$
$$, 'a kind nothing was sold as removed, with its answers');

-- Every change to a kind and to an answer is kept, against whoever made it,
-- and so is one that goes.
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('reckon.user_id', 'a0a0a0a0-0000-4000-8000-0000000000a1', true);
  UPDATE sale_kind SET name = 'Remote support' WHERE id = '59595959-0000-4000-8000-0000000000a1';
  UPDATE taxability SET taxed = true WHERE state = 'CA' AND sale_kind_id = sold_as('travel');
  DELETE FROM tax_registration WHERE state = 'NV';
  SELECT count(*) INTO n FROM record_history
   WHERE changed_by = 'a0a0a0a0-0000-4000-8000-0000000000a1'
     AND ((table_name = 'sale_kind' AND field = 'name')
       OR (table_name = 'taxability' AND field IN ('taxed', '(deleted)')));
  IF n < 3 THEN
    RAISE EXCEPTION 'GUARD MISSING: % of a kind''s and its answers'' changes recorded', n;
  END IF;
  IF EXISTS (SELECT 1 FROM taxability WHERE state = 'NV') THEN
    RAISE EXCEPTION 'GUARD MISSING: a state no longer collected in kept its answers';
  END IF;
  RAISE NOTICE '  recorded  a kind renamed, an answer changed, and a state''s answers gone with it';
END $$;
UPDATE taxability SET taxed = false WHERE state = 'CA' AND sale_kind_id = sold_as('travel');

-- 60. A LINE'S TAX SET BY HAND (#196). Its reason says it was, and says
-- something; it is set only on a sale; a cost passed on is taxed nowhere; at
-- another rate it is taxed where it went; and taxed is at some rate.
SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            sale_kind_id, tax_override_reason)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 60, 'bought', 'Anchors', 1, 4.00, 4.00,
          sold_as('goods'), '   ')
$$, 'a tax set by hand for a reason that says nothing');

SELECT must_pass($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            sale_kind_id, tax_override_reason)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 60, 'bought', 'Anchors', 1, 4.00, 4.00,
          sold_as('goods'), 'Bought for resale: the client holds a resale certificate')
$$, 'goods bought for the job, not taxed by hand, with why');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            tax_override_reason)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 61, 'paid_for', 'Permit', 1, 40.00, 40.00,
          'Not taxed')
$$, 'a cost passed on, its tax set by hand');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            taxable, tax_rate_pct)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 61, 'paid_for', 'Permit', 1, 40.00, 40.00,
          true, 7.25)
$$, 'a cost passed on, taxed');

SELECT must_pass($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 61, 'paid_for', 'Permit', 1, 40.00, 40.00)
$$, 'a cost passed on, taxed nowhere');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            sale_kind_id, taxable, tax_rate_pct, tax_source, tax_override_reason)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 62, 'bought', 'Anchors', 1, 4.00, 4.00,
          sold_as('goods'), true, 4.0625, 'override', 'Partly exempt')
$$, 'another rate, at no site');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            sale_kind_id, tax_source, tax_override_reason, site_id)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 62, 'bought', 'Anchors', 1, 4.00, 4.00,
          sold_as('goods'), 'override', 'Partly exempt', 'c5000000-0000-4000-8000-000000000001')
$$, 'another rate, not taxed');

SELECT must_pass($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            sale_kind_id, taxable, tax_rate_pct, tax_source, tax_override_reason,
                            site_id, tax_jurisdiction, tax_state)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 62, 'bought', 'Anchors', 1, 4.00, 4.00,
          sold_as('goods'), true, 4.0625, 'override', 'Partly exempt',
          'c5000000-0000-4000-8000-000000000001', 'AUBURN', 'CA')
$$, 'another rate, at the site, saying where');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            sale_kind_id, taxable, tax_rate_pct)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 63, 'bought', 'Anchors', 1, 4.00, 4.00,
          sold_as('goods'), true, 0)
$$, 'taxed at no rate');

-- Why its tax was set by hand is kept, against whoever said it.
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('reckon.user_id', 'a0a0a0a0-0000-4000-8000-0000000000a1', true);
  UPDATE invoice_line SET tax_override_reason = 'Resold: certificate SR-ZZ-000-1234 on file'
   WHERE invoice_id = '59595959-0000-4000-8000-0000000000c1' AND seq = 60;
  SELECT count(*) INTO n FROM record_history
   WHERE table_name = 'invoice_line' AND field = 'tax_override_reason'
     AND changed_by = 'a0a0a0a0-0000-4000-8000-0000000000a1';
  IF n < 1 THEN
    RAISE EXCEPTION 'GUARD MISSING: why a line''s tax was set by hand was not kept';
  END IF;
  RAISE NOTICE '  recorded  why a line''s tax was set by hand, and who said it';
END $$;
DELETE FROM invoice_line WHERE invoice_id = '59595959-0000-4000-8000-0000000000c1' AND seq >= 60;

-- 61. A PIECE FOR ONE KIND OF SALE (#196). A typed area's piece can fall on
-- one kind alone, and an authority's cannot; a jurisdiction levies once on
-- every kind in a set and once on each kind alone; and a line keeps a piece
-- for one kind only for the kind it was sold as.
SELECT must_pass($$
  INSERT INTO tax_piece (area_id, level, jurisdiction, rate_pct, effective_from, typed_by,
                         sale_kind_id)
  VALUES ('c6000000-0000-4000-8000-000000000001', 'local', 'Washoe County', 0.5000, '2026-10-01',
          'a0a0a0a0-0000-4000-8000-0000000000a1', sold_as('travel'))
$$, 'Washoe County''s piece on travel alone, beside its piece on everything');

SELECT must_fail($$
  INSERT INTO tax_piece (area_id, level, jurisdiction, rate_pct, effective_from, typed_by,
                         sale_kind_id)
  VALUES ('c6000000-0000-4000-8000-000000000001', 'local', 'Washoe County', 0.2500, '2026-10-01',
          'a0a0a0a0-0000-4000-8000-0000000000a1', sold_as('travel'))
$$, 'a jurisdiction levying twice on one kind alone in a set');

SELECT must_fail($$
  INSERT INTO tax_piece (area_id, level, jurisdiction, rate_pct, effective_from, typed_by)
  VALUES ('c6000000-0000-4000-8000-000000000001', 'local', 'Washoe County', 0.2500, '2026-10-01',
          'a0a0a0a0-0000-4000-8000-0000000000a1')
$$, 'a jurisdiction levying twice on every kind in a set');

SELECT must_pass($$
  INSERT INTO tax_piece (area_id, level, jurisdiction, rate_pct, effective_from)
  SELECT id, 'local', 'A DISTRICT', 0.2500, '2099-01-01'
    FROM tax_area WHERE state = 'CA' AND code = '559980000000'
$$, 'a piece of CDTFA''s on every kind');

SELECT must_fail($$
  INSERT INTO tax_piece (area_id, level, jurisdiction, rate_pct, effective_from, sale_kind_id)
  SELECT id, 'local', 'A DISTRICT', 0.2500, '2099-01-01', sold_as('travel')
    FROM tax_area WHERE state = 'CA' AND code = '559980000000'
$$, 'a piece of CDTFA''s for one kind alone');
DELETE FROM tax_piece WHERE jurisdiction = 'A DISTRICT';

SELECT must_pass($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            sale_kind_id, taxable, tax_rate_pct, tax_source, site_id,
                            tax_jurisdiction, tax_state, tax_pieces)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 64, 'bought', 'Anchors', 1, 4.00, 4.00,
          sold_as('goods'), true, 7.7500, 'site', 'c5000000-0000-4000-8000-000000000001',
          'AUBURN', 'CA',
          jsonb_build_array(
            jsonb_build_object('level', 'state', 'jurisdiction', 'CALIFORNIA', 'rate', '7.2500'),
            jsonb_build_object('level', 'local', 'jurisdiction', 'AUBURN', 'rate', '0.5000',
                               'kind', sold_as('goods')::text)))
$$, 'a line keeping a piece for the kind it was sold as');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            sale_kind_id, taxable, tax_rate_pct, tax_source, site_id,
                            tax_jurisdiction, tax_state, tax_pieces)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 65, 'bought', 'Anchors', 1, 4.00, 4.00,
          sold_as('goods'), true, 7.7500, 'site', 'c5000000-0000-4000-8000-000000000001',
          'AUBURN', 'CA',
          jsonb_build_array(
            jsonb_build_object('level', 'state', 'jurisdiction', 'CALIFORNIA', 'rate', '7.2500'),
            jsonb_build_object('level', 'local', 'jurisdiction', 'AUBURN', 'rate', '0.5000',
                               'kind', sold_as('travel')::text)))
$$, 'a line keeping a piece for another kind than it was sold as');
DELETE FROM invoice_line WHERE invoice_id = '59595959-0000-4000-8000-0000000000c1' AND seq >= 64;

-- 62. A CLIENT EXEMPT IN A STATE (#207). A line its client is exempt from is
-- untaxed and names the exemption: the client's, in force, in its site's
-- state, covering its kind. A line taxed as its kind where its client is
-- exempt from it is refused, and one taxed by hand, saying why, is not.
INSERT INTO tax_exemption (id, entity_id, state, reason, supported_by, sale_kind_ids) VALUES
  ('e6200000-0000-4000-8000-000000000001', '44444444-4444-4444-4444-444444444444', 'CA',
   'resale', 'SR-ZZ-000-1234', ARRAY[sold_as('goods')]),
  ('e6200000-0000-4000-8000-000000000002', '44444444-4444-4444-4444-444444444444', 'NV',
   'charitable', 'NV-EX-1', NULL),
  ('e6200000-0000-4000-8000-000000000003', '44444444-0000-4000-8000-000000000002', 'CA',
   'charitable', 'CH-1', NULL);

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            sale_kind_id, taxable, tax_rate_pct, tax_source, site_id,
                            tax_jurisdiction, tax_state, tax_pieces)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 70, 'bought', 'Anchors', 1, 4.00, 4.00,
          sold_as('goods'), true, 7.2500, 'site', 'c5000000-0000-4000-8000-000000000001',
          'AUBURN', 'CA',
          jsonb_build_array(jsonb_build_object('level', 'state', 'jurisdiction', 'CALIFORNIA',
                                               'rate', '7.2500')))
$$, 'goods taxed as their kind for a client exempt from goods there');

SELECT must_pass($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            sale_kind_id, tax_source, tax_exemption_id, site_id)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 70, 'bought', 'Anchors', 1, 4.00, 4.00,
          sold_as('goods'), 'exempt', 'e6200000-0000-4000-8000-000000000001',
          'c5000000-0000-4000-8000-000000000001')
$$, 'goods untaxed for a client exempt from them, naming the exemption');

SELECT must_pass($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            sale_kind_id, taxable, tax_rate_pct, tax_source, site_id,
                            tax_jurisdiction, tax_state, tax_pieces, tax_override_reason)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 71, 'bought', 'Anchors', 1, 4.00, 4.00,
          sold_as('goods'), true, 7.2500, 'site', 'c5000000-0000-4000-8000-000000000001',
          'AUBURN', 'CA',
          jsonb_build_array(jsonb_build_object('level', 'state', 'jurisdiction', 'CALIFORNIA',
                                               'rate', '7.2500')),
          'For their own use, not resale: their purchase order says taxable')
$$, 'goods taxed by hand, saying why, for a client exempt from them');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            sale_kind_id, tax_source, site_id)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 72, 'bought', 'Anchors', 1, 4.00, 4.00,
          sold_as('goods'), 'exempt', 'c5000000-0000-4000-8000-000000000001')
$$, 'a line exempt by no exemption');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            sale_kind_id, tax_exemption_id, site_id)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 72, 'bought', 'Anchors', 1, 4.00, 4.00,
          sold_as('goods'), 'e6200000-0000-4000-8000-000000000001',
          'c5000000-0000-4000-8000-000000000001')
$$, 'a line naming an exemption, and not exempt');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            sale_kind_id, tax_source, tax_exemption_id)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 72, 'bought', 'Anchors', 1, 4.00, 4.00,
          sold_as('goods'), 'exempt', 'e6200000-0000-4000-8000-000000000001')
$$, 'a line exempt at no site');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            tax_source, tax_exemption_id, site_id)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 72, 'paid_for', 'Permit', 1, 40.00, 40.00,
          'exempt', 'e6200000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001')
$$, 'a cost passed on, exempt: it is no sale');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            sale_kind_id, tax_source, tax_exemption_id, site_id, tax_override_reason)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 72, 'bought', 'Anchors', 1, 4.00, 4.00,
          sold_as('goods'), 'exempt', 'e6200000-0000-4000-8000-000000000001',
          'c5000000-0000-4000-8000-000000000001', 'Exempt anyway')
$$, 'a line exempt, and set by hand');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            material_id, sale_kind_id, tax_source, tax_exemption_id, site_id)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 72, 'material', 'Travel', 1, 4.00, 4.00,
          NULL, sold_as('travel'), 'exempt', 'e6200000-0000-4000-8000-000000000001',
          'c5000000-0000-4000-8000-000000000001')
$$, 'a line exempt by an exemption that does not cover its kind');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            sale_kind_id, tax_source, tax_exemption_id, site_id)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 72, 'bought', 'Anchors', 1, 4.00, 4.00,
          sold_as('goods'), 'exempt', 'e6200000-0000-4000-8000-000000000002',
          'c5000000-0000-4000-8000-000000000001')
$$, 'a line in California exempt by its client''s exemption in Nevada');

SELECT must_fail($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            sale_kind_id, tax_source, tax_exemption_id, site_id)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 72, 'bought', 'Anchors', 1, 4.00, 4.00,
          sold_as('goods'), 'exempt', 'e6200000-0000-4000-8000-000000000003',
          'c5000000-0000-4000-8000-000000000001')
$$, 'a line exempt by another client''s exemption');

SELECT must_fail($$
  DELETE FROM tax_exemption WHERE id = 'e6200000-0000-4000-8000-000000000001'
$$, 'an exemption a line is untaxed by, taken off');

SELECT must_pass($$
  UPDATE tax_exemption SET ended_on = current_date WHERE id = 'e6200000-0000-4000-8000-000000000001'
$$, 'an exemption a line is untaxed by, ended');

SELECT must_fail($$
  UPDATE invoice_line SET description = 'Anchors, galvanised', tax_source = 'exempt'
   WHERE invoice_id = '59595959-0000-4000-8000-0000000000c1' AND seq = 70
$$, 'a line exempt by an exemption that has ended, written again');

SELECT must_pass($$
  INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount,
                            sale_kind_id, taxable, tax_rate_pct, tax_source, site_id,
                            tax_jurisdiction, tax_state, tax_pieces)
  VALUES ('59595959-0000-4000-8000-0000000000c1', 72, 'bought', 'Anchors', 1, 4.00, 4.00,
          sold_as('goods'), true, 7.2500, 'site', 'c5000000-0000-4000-8000-000000000001',
          'AUBURN', 'CA',
          jsonb_build_array(jsonb_build_object('level', 'state', 'jurisdiction', 'CALIFORNIA',
                                               'rate', '7.2500')))
$$, 'goods taxed as their kind once the exemption has ended');

-- A kind an exemption covers stays.
WITH k AS (INSERT INTO sale_kind (id, name) VALUES ('e6200000-0000-4000-8000-0000000000f1', 'Fixtures')
           RETURNING id)
INSERT INTO taxability (state, sale_kind_id, taxed) SELECT r.state, k.id, true FROM tax_registration r, k;
INSERT INTO tax_exemption (id, entity_id, state, reason, supported_by, sale_kind_ids)
VALUES ('e6200000-0000-4000-8000-000000000004', '44444444-0000-4000-8000-000000000002', 'CA',
        'resale', 'SR-ZZ-000-5678', ARRAY['e6200000-0000-4000-8000-0000000000f1'::uuid]);

SELECT must_fail($$
  DELETE FROM sale_kind WHERE id = 'e6200000-0000-4000-8000-0000000000f1'
$$, 'a kind a client''s exemption covers, removed');

DELETE FROM invoice_line WHERE invoice_id = '59595959-0000-4000-8000-0000000000c1' AND seq >= 70;
DELETE FROM tax_exemption;
DELETE FROM sale_kind WHERE id = 'e6200000-0000-4000-8000-0000000000f1';

\echo 'All guards hold.'
