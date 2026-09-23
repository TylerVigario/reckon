-- Enough of a business to exercise every screen and every write.
--
-- NOT FIXTURES. db/test/constraints.sql builds its own rows and asserts on
-- them; this is a business somebody can look at -- two clients, four sites in
-- three tax areas, invoices in three states, a retainer, work billed and
-- unbilled. It is what the harnesses in app/scripts run against, and what a
-- screenshot is taken of.
--
-- EVERY FIGURE THAT COULD BE LOOKED UP WAS. The tax rates and area codes are
-- real answers from CDTFA for real addresses, because a seed that invents a
-- rate teaches the reader a wrong number -- an earlier version of this file
-- had a Kings countywide district that does not exist, and it survived until
-- somebody checked CDTFA-105.
--
-- It expects an empty database with every migration applied:
--
--     createdb reckon_demo && db/apply.sh reckon_demo
--     psql -d reckon_demo -f db/seed/demo.sql
--

-- Both partners, paid as partners. The roles themselves are the operator's list,
-- which 0020 starts with Partner, Employee and Contractor.
INSERT INTO app_user (id, name, email, credential, active, role_id) VALUES
  ('11111111-0000-0000-0000-000000000001','Tyler Vigario','harness@invalid.test','unset',true,
   (SELECT id FROM role WHERE name = 'Partner')),
  ('11111111-0000-0000-0000-000000000002','Robin Vigario','robin@invalid.test','unset',true,
   (SELECT id FROM role WHERE name = 'Partner'));

INSERT INTO operator (trading_name, short_name, singleton, tax_rule_set, ageing_alert_days,
                      tax_agency, tax_registration, filing_basis, fiscal_year_end_month,
                      claims_tax_paid_purchases_resold)
VALUES ('Vigario Technology Solutions','VTS', true, 'us_ca', 21,
        'CDTFA','000-000000','quarterly', 6, true);

-- No levies are seeded: there is no pool any more. A site's rate is what
-- CDTFA's API returned for its address, recorded below.





INSERT INTO entity (id, name) VALUES
  ('eeeeeeee-0000-0000-0000-000000000001','Bravo Farms'),
  ('eeeeeeee-0000-0000-0000-000000000002','Wild Jacks'),
  ('eeeeeeee-0000-0000-0000-000000000003','Troy Harman');

-- Sites belong to clients. Bravo and Wild Jacks both work at 36005 CA-99 N;
-- each has its own site there, named its own way.
-- A postcode is not optional: CDTFA's rate API wants street, city AND zip, and
-- refuses outright without all three.
-- Every site carries a rate, because there is no other kind. These are real
-- answers from services.maps.cdtfa.ca.gov for these real addresses -- a seed
-- that invented one would be seeding the exact fault this replaced.
INSERT INTO site (id, entity_id, label, street, city, region, postcode,
                  round_trip_miles, tax_jurisdiction, tax_rate_pct,
                  state_rate_pct, district_rate_pct, tax_area_code,
                  area_verified_on) VALUES
  ('cccccccc-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',
   'The Shoppe','36005 CA-99 N','Traver','CA','93673', 52,
   'UNINCORPORATED AREA-TULARE', 7.7500, 7.2500, 0.5000, '549981620000',
   current_date - 3),
  ('cccccccc-0000-0000-0000-000000000002','eeeeeeee-0000-0000-0000-000000000001',
   'Kettleman','33341 Bernard Dr','Kettleman City','CA','93239', 72,
   'UNINCORPORATED AREA-KINGS', 7.2500, 7.2500, 0.0000, '169980000000',
   current_date - 3),
  ('cccccccc-0000-0000-0000-000000000004','eeeeeeee-0000-0000-0000-000000000002',
   'Traver','36005 CA-99 N','Traver','CA','93673', 52,
   'UNINCORPORATED AREA-TULARE', 7.7500, 7.2500, 0.5000, '549981620000',
   current_date - 3),
  -- Priced a long time ago: the one the refresh should pick up next.
  ('cccccccc-0000-0000-0000-000000000003','eeeeeeee-0000-0000-0000-000000000002',
   'Esmeralda','1200 W Olive Ave','Madera','CA','93637', 90,
   'MADERA', 8.2500, 7.2500, 1.0000, '200424760000', current_date - 210);

-- The answers behind those figures, so an invoice issued before today can be
-- split by what CDTFA said at the time rather than by nothing.
INSERT INTO site_tax_check (site_id, checked_at, tax_area_code, tax_jurisdiction,
                            rate_pct, state_rate_pct, district_rate_pct,
                            changed) VALUES
  ('cccccccc-0000-0000-0000-000000000001', current_date - 60, '549981620000',
   'UNINCORPORATED AREA-TULARE', 7.7500, 7.2500, 0.5000, true),
  ('cccccccc-0000-0000-0000-000000000002', current_date - 60, '169980000000',
   'UNINCORPORATED AREA-KINGS', 7.2500, 7.2500, 0.0000, true),
  ('cccccccc-0000-0000-0000-000000000004', current_date - 60, '549981620000',
   'UNINCORPORATED AREA-TULARE', 7.7500, 7.2500, 0.5000, true),
  ('cccccccc-0000-0000-0000-000000000003', current_date - 210, '200424760000',
   'MADERA', 8.2500, 7.2500, 1.0000, true),
  -- THE SAME ANSWER, TWICE IN A DAY. Running the refresh more than once is the
  -- ordinary case, and it is what a screen keying a list by date-and-rate
  -- cannot survive: two rows with one key kills the whole render, taking the
  -- header and every field with it. Seeded so this file exercises it.
  ('cccccccc-0000-0000-0000-000000000002', current_date - 60, '169980000000',
   'UNINCORPORATED AREA-KINGS', 7.2500, 7.2500, 0.0000, false),
  ('cccccccc-0000-0000-0000-000000000002', current_date - 60, '169980000000',
   'UNINCORPORATED AREA-KINGS', 7.2500, 7.2500, 0.0000, false);



INSERT INTO contact (id, name, email, phone) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','Michelle','michelle@example.com','(559) 555-0148'),
  ('aaaaaaaa-0000-0000-0000-000000000002','Kristyn Azar','kristyn@example.com',null),
  ('aaaaaaaa-0000-0000-0000-000000000003','Uriel Paredes',null,'(559) 555-0172');

-- Per client. Michelle answers for Bravo; Kristyn is also Bravo's; Uriel is
-- Wild Jacks'. One person can be several clients' -- Uriel is Bravo's too.
INSERT INTO entity_contact (entity_id, contact_id, is_primary) VALUES
  ('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001', true),
  ('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002', false),
  ('eeeeeeee-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000003', true);

-- And per site. Kristyn runs The Shoppe; Kettleman names nobody and falls back
-- to Michelle. Uriel is Wild Jacks' and is at none of Bravo's places.
INSERT INTO site_contact (site_id, entity_id, contact_id, is_primary) VALUES
  ('cccccccc-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000002', true),
  ('cccccccc-0000-0000-0000-000000000004','eeeeeeee-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000003', true);

-- "the default remote support is 2 hours, 2 hours" -- 9 Sep 2026. The seed said
-- four, from an earlier quote the register keeps for the pay split, not the cap.
INSERT INTO service (id, code, name, unit, bill_to_nearest_seconds, subscription_basis,
                     subscription_hours, subscription_overage, subscription_period) VALUES
  ('55555555-0000-0000-0000-000000000001','onsite','On-site work','hour',60,'none',NULL,NULL,NULL),
  ('55555555-0000-0000-0000-000000000002','remote','Remote support','hour',60,'capped',2.00,'bill','month'),
  ('55555555-0000-0000-0000-000000000003','mileage','Mileage','mile',NULL,'none',NULL,NULL,NULL),
  ('55555555-0000-0000-0000-000000000004','emerg','Emergency attendance','hour',60,'none',NULL,NULL,NULL);

INSERT INTO service_price (service_id, rate, additional_rate, effective_from) VALUES
  ('55555555-0000-0000-0000-000000000001', 80.00, 50.00,'2026-09-02'),
  ('55555555-0000-0000-0000-000000000001', 50.00,  0.00,'2022-01-01'),
  ('55555555-0000-0000-0000-000000000002', 50.00,  0.00,'2026-01-01'),
  ('55555555-0000-0000-0000-000000000003',  0.72,  0.00,'2026-01-01');


-- An invoice that went out and has not been paid, well past the chase-after day.
-- Built as a draft and then sent, because a sent invoice's lines are frozen --
-- which is the trigger doing its job, not an obstacle to work around.
INSERT INTO invoice (id, number, entity_id, status, created_by)
VALUES ('11110000-0000-0000-0000-000000000037','0000037','eeeeeeee-0000-0000-0000-000000000003',
        'draft','11111111-0000-0000-0000-000000000001');
INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount, taxable, tax_rate_pct)
VALUES ('11110000-0000-0000-0000-000000000037',1,'service','On-site work',2.0,80.00,160.00,false,0);
UPDATE invoice SET status = 'sent', issued_on = '2025-10-01', due_on = '2025-10-15',
                   sent_at = '2025-10-01 09:00-07'
 WHERE id = '11110000-0000-0000-0000-000000000037';

-- Two drafts, which is what "ready to send" counts.
INSERT INTO invoice (id, number, entity_id, status, created_by) VALUES
  ('11110000-0000-0000-0000-000000000053','0000053','eeeeeeee-0000-0000-0000-000000000001',
   'draft','11111111-0000-0000-0000-000000000001'),
  ('11110000-0000-0000-0000-000000000054','0000054','eeeeeeee-0000-0000-0000-000000000002',
   'draft','11111111-0000-0000-0000-000000000001');
INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit_price, amount, taxable, tax_rate_pct) VALUES
  ('11110000-0000-0000-0000-000000000053',1,'service','On-site work',4.52,80.00,361.60,false,0),
  ('11110000-0000-0000-0000-000000000053',2,'service','Mileage',36.0,0.72,25.92,false,0),

  ('11110000-0000-0000-0000-000000000054',1,'service','On-site work',2.75,100.00,275.00,false,0);

-- Work done and not yet billed, in each age bucket.
INSERT INTO time_entry (client_uuid, worked_on, minutes, worked_by, created_by, entity_id,
                        site_id, service_id, billable, crew) VALUES
  (gen_random_uuid(), current_date - 2,  165,'11111111-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000002',
   'cccccccc-0000-0000-0000-000000000004','55555555-0000-0000-0000-000000000001', true,'one'),
  (gen_random_uuid(), current_date - 14, 120,'11111111-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000002','55555555-0000-0000-0000-000000000001', true,'one'),
  (gen_random_uuid(), current_date - 24,  90,'11111111-0000-0000-0000-000000000002',
   '11111111-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001','55555555-0000-0000-0000-000000000002', true,'one');

-- One drive, two clients: the case the leg rules exist for. 72.2 miles driven,
-- and never more than that billed.
INSERT INTO trip (id, travelled_on, driven_by, created_by)
VALUES ('77770000-0000-0000-0000-000000000001', current_date - 5,
        '11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001');
INSERT INTO trip_stop (trip_id, seq, site_id) VALUES
  ('77770000-0000-0000-0000-000000000001', 1, 'cccccccc-0000-0000-0000-000000000002'),
  ('77770000-0000-0000-0000-000000000001', 2, 'cccccccc-0000-0000-0000-000000000001');
INSERT INTO trip_leg (trip_id, seq, miles, entity_id, site_id, rule, service_id) VALUES
  ('77770000-0000-0000-0000-000000000001', 1, 30.0,'eeeeeeee-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000002','house_to_a','55555555-0000-0000-0000-000000000003'),
  ('77770000-0000-0000-0000-000000000001', 2,  2.2,'eeeeeeee-0000-0000-0000-000000000002',
   'cccccccc-0000-0000-0000-000000000004','a_to_b','55555555-0000-0000-0000-000000000003'),
  ('77770000-0000-0000-0000-000000000001', 3, 40.0,'eeeeeeee-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000002','b_to_house','55555555-0000-0000-0000-000000000003');

-- A round trip that has already been billed.
INSERT INTO trip (id, travelled_on, driven_by, created_by)
VALUES ('77770000-0000-0000-0000-000000000002', current_date - 12,
        '11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001');
INSERT INTO trip_stop (trip_id, seq, site_id)
VALUES ('77770000-0000-0000-0000-000000000002', 1, 'cccccccc-0000-0000-0000-000000000001');
INSERT INTO trip_leg (id, trip_id, seq, miles, entity_id, site_id, rule, service_id)
VALUES ('88880000-0000-0000-0000-000000000001','77770000-0000-0000-0000-000000000002', 1, 52.0,
        'eeeeeeee-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','round_trip',
        '55555555-0000-0000-0000-000000000003');

-- An invoice that went out and was paid, so "Paid, recently" has something.
INSERT INTO invoice (id, number, entity_id, status, created_by)
VALUES ('11110000-0000-0000-0000-000000000050','0000050','eeeeeeee-0000-0000-0000-000000000001',
        'draft','11111111-0000-0000-0000-000000000001');
INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit, unit_price, amount,
                          taxable, tax_rate_pct, trip_leg_id)
VALUES ('11110000-0000-0000-0000-000000000050',1,'service','Mileage',52.0,'mile',0.72,37.44,false,0,
        '88880000-0000-0000-0000-000000000001');
UPDATE invoice SET status='sent', issued_on = current_date - 10, due_on = current_date + 4,
                   sent_at = (current_date - 10)::timestamptz
 WHERE id = '11110000-0000-0000-0000-000000000050';

INSERT INTO payment (id, entity_id, received_on, gross, method)
VALUES ('99990000-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',
        current_date - 3, 37.44, 'cheque');
INSERT INTO payment_allocation (payment_id, invoice_id, amount)
VALUES ('99990000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000050', 37.44);

-- Goods, bought with tax already paid and then resold. Reg 1701 lets that tax
-- come off the measure, which is why ex_tax_cost is stored on the line rather
-- than looked up: the lot it came from may be long gone when the return is
-- filed. 230 ft at $0.2087 plus 4 jacks at $0.70 is the $50.80 deduction.
INSERT INTO material (id, sku, name, brand, unit, markup_pct, taxable) VALUES
  ('66660000-0000-0000-0000-000000000001','C6R-BLU','Cable · Cat6 · Riser','trueCABLE','foot',15.0,true),
  ('66660000-0000-0000-0000-000000000002','JK-C6','Jack · Cat6 · UTP','trueCABLE','each',15.0,true);

INSERT INTO material_lot (id, material_id, received_on, supplier, qty_received, qty_remaining,
                          ex_tax_cost_per_unit, tax_paid_per_unit) VALUES
  ('66661111-0000-0000-0000-000000000001','66660000-0000-0000-0000-000000000001',
   current_date - 60,'trueCABLE', 1000, 770, 0.2087, 0.0151),
  ('66661111-0000-0000-0000-000000000002','66660000-0000-0000-0000-000000000002',
   current_date - 60,'trueCABLE', 50, 46, 0.7000, 0.0508);

INSERT INTO invoice (id, number, entity_id, status, created_by)
VALUES ('11110000-0000-0000-0000-000000000052','0000052','eeeeeeee-0000-0000-0000-000000000001',
        'draft','11111111-0000-0000-0000-000000000001');
INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit, unit_price, amount,
                          taxable, tax_rate_pct, tax_source, site_id, material_lot_id,
                          ex_tax_cost, tax_paid) VALUES
  ('11110000-0000-0000-0000-000000000052',1,'material','Cable · Cat6 · Riser · UTP',
   230,'foot',0.24,55.20,true,7.2500,'site','cccccccc-0000-0000-0000-000000000002',
   '66661111-0000-0000-0000-000000000001', 48.00, 3.47),
  ('11110000-0000-0000-0000-000000000052',2,'material','Jack · Cat6 · UTP',
   4,'each',1.44,5.76,true,7.2500,'site','cccccccc-0000-0000-0000-000000000002',
   '66661111-0000-0000-0000-000000000002', 2.80, 0.20);
UPDATE invoice SET status='sent', issued_on = current_date - 20, due_on = current_date - 6,
                   sent_at = (current_date - 20)::timestamptz
 WHERE id = '11110000-0000-0000-0000-000000000052';

-- A retainer, so the meter has something to meter. Unlimited at $200 a site is
-- the case the screen exists for: nobody is counting, and the hours used are
-- the only way to tell whether $200 is anywhere near the work.
INSERT INTO agreement (id, entity_id, basis, price, starts_on, billing_interval, billing_anchor_day)
VALUES ('aaaa0000-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',
        'per_location', 200.00, date_trunc('year', current_date)::date, 'monthly', 1);
-- It covers Remote support, without limit -- by naming the service, not a kind.
INSERT INTO agreement_service (agreement_id, service_id, allotment, allotment_basis)
VALUES ('aaaa0000-0000-0000-0000-000000000001','55555555-0000-0000-0000-000000000002',
        'unlimited','per_location');
INSERT INTO agreement_site (agreement_id, site_id) VALUES
  ('aaaa0000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001'),
  ('aaaa0000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002');
INSERT INTO agreement_period (agreement_id, period_start, period_end, amount)
VALUES ('aaaa0000-0000-0000-0000-000000000001',
        (date_trunc('month', current_date) - interval '1 month')::date,
        (date_trunc('month', current_date) - interval '1 day')::date, 400.00);

-- Remote hours against that retainer, and one against a client who has none.
INSERT INTO time_entry (client_uuid, worked_on, minutes, crew, worked_by, created_by,
                        entity_id, site_id, service_id, note) VALUES
  (gen_random_uuid(), (date_trunc('month', current_date) - interval '18 days')::date, 212,
   'one','11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001',
   '55555555-0000-0000-0000-000000000002','Till printer, over the phone'),
  (gen_random_uuid(), (date_trunc('month', current_date) - interval '9 days')::date, 12,
   'one','11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000004',
   '55555555-0000-0000-0000-000000000002','Reset the guest network');


-- Hours worked and not charged for. Given away on purpose is still given
-- away, and the report prices it at what it would have been worth.
INSERT INTO service (id, code, name, unit, bill_to_nearest_seconds, active) VALUES
  ('55555555-0000-0000-0000-000000000005','RND','Research and development','hour', 60, true);
INSERT INTO service_price (service_id, rate, effective_from) VALUES
  ('55555555-0000-0000-0000-000000000005', 50.00, '2026-01-01');

-- ===========================================================================
-- Who each service pays. A partner is paid for the hour worked, at the rule in
-- force on the day -- which is why there is a long-standing house rate as well as
-- the recent one. Remote support pays $25 an hour worked. Bravo's calls are
-- covered by their retainer, and covered time pays a share of the retainer --
-- "bravo would effectively be 0% payout to responder" -- 23 Sep 2026.
INSERT INTO pay_rule (service_id, role_id, entity_id, pays_for, method, amount, effective_from)
SELECT s.id, (SELECT id FROM role WHERE name = 'Partner'), NULL, 'time', 'per_hour', r.amount, r.day
  FROM (VALUES
    ('55555555-0000-0000-0000-000000000001'::uuid, 50.00, '2022-01-01'::date),
    ('55555555-0000-0000-0000-000000000001'::uuid, 50.00, '2026-09-02'::date),
    ('55555555-0000-0000-0000-000000000002'::uuid, 50.00, '2022-01-01'::date),
    ('55555555-0000-0000-0000-000000000002'::uuid, 25.00, '2026-09-01'::date),
    ('55555555-0000-0000-0000-000000000002'::uuid, 25.00, '2026-09-11'::date),
    ('55555555-0000-0000-0000-000000000004'::uuid, 50.00, '2022-01-01'::date),
    ('55555555-0000-0000-0000-000000000005'::uuid, 50.00, '2022-01-01'::date)
  ) AS r(service, amount, day)
  JOIN service s ON s.id = r.service;

INSERT INTO pay_rule (service_id, role_id, entity_id, pays_for, method, amount, effective_from)
VALUES ('55555555-0000-0000-0000-000000000002', (SELECT id FROM role WHERE name = 'Partner'),
        'eeeeeeee-0000-0000-0000-000000000001', 'covered_time', 'percent', 0,
        date_trunc('year', current_date)::date);

-- A partner's own vehicle is paid the whole mileage charge. Kept even though no
-- trip can apply it yet -- a trip does not know its vehicle -- because it is the
-- rule, and the rule is what the catalogue shows.
INSERT INTO pay_rule (service_id, role_id, pays_for, method, amount, effective_from)
VALUES ('55555555-0000-0000-0000-000000000003', (SELECT id FROM role WHERE name = 'Partner'),
        'vehicle', 'percent', 100, '2026-09-23');

INSERT INTO time_entry (client_uuid, worked_on, minutes, crew, worked_by, created_by,
                        service_id, billable, note) VALUES
  (gen_random_uuid(), (date_trunc('month', current_date) - interval '1 day')::date, 564,
   'one','11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001',
   '55555555-0000-0000-0000-000000000005', false, 'Reading the CDTFA schedules'),
  (gen_random_uuid(), (date_trunc('month', current_date) - interval '12 days')::date, 128,
   'one','11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001',
   '55555555-0000-0000-0000-000000000005', false, 'Trialling the invoice layout');
