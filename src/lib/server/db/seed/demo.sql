-- A demo database: Kestrel Field Services, an invented IT field-service firm,
-- with a few months of clients, retainers, time, trips and invoices.
--
-- tests/smoke.mjs, console-check.mjs and write-check.mjs run against it.
-- The guard suite in tests/db/constraints.sql does not; it makes its own rows.
--
-- The names are invented. Each site is a public building, and the rate, split
-- and tax area code on it are what CDTFA gives for that address. Distances are
-- from an invented home base.
--
--     createdb reckon_demo && npm run db:migrate -- reckon_demo
--     npm run db:seed -- reckon_demo
--

-- ------------------------------------------------------------ the business --

-- Kestrel files with CDTFA once a year, keeps its books to the calendar year,
-- numbers its invoices INV-0000 with 213 next, and flags work left unbilled
-- for four weeks.
INSERT INTO operator (trading_name, short_name, singleton, timezone, tax_rule_set,
                      ageing_alert_days, next_invoice_number, tax_agency,
                      tax_registration, tax_number, filing_basis, fiscal_year_end_month,
                      claims_tax_paid_purchases_resold)
VALUES ('Kestrel Field Services','KFS', true, 'America/Los_Angeles', 'us_ca',
        28, 213, 'CDTFA', 'Seller''s permit', 'SR-ZZ-000-0000', 'annual', 12, true);

-- Avery owns it and works in it. Sam is employed, and Jordan is a contractor
-- who takes some of the field work. One person in each of the three roles the
-- schema starts every operator with. None of them can sign in until given a
-- password: node scripts/user.mjs password avery@kestrel.example
INSERT INTO "user" (id, name, email, active, role_id) VALUES
  ('c41b2fab-5b71-4954-bb86-1bc803daf7ee','Avery Lind','avery@kestrel.example', true,
   (SELECT id FROM role WHERE name = 'Partner')),
  ('c54bf38d-b83d-422f-af31-14a2a01aee5e','Sam Ortega','sam@kestrel.example', true,
   (SELECT id FROM role WHERE name = 'Employee')),
  ('d1496a1c-9d8d-42ac-bf41-d059ed2a634c','Jordan Pike','jordan@kestrel.example', true,
   (SELECT id FROM role WHERE name = 'Contractor'));

-- ------------------------------------------------------------ what it sells --

-- Help desk went from $55 to $60 an hour last November; the older price stays
-- on file for the history screen. Field service is $95, and $45 more for each
-- extra pair of hands. A network assessment is a flat $180 a visit.
-- Internal projects have no price: nobody is ever billed for them.
INSERT INTO service (id, code, name, unit, bill_to_nearest_seconds) VALUES
  ('6d24f906-197c-48c6-9522-b33f242d1c53','travel','Travel','mile',NULL),
  ('f13e8550-7aec-431c-86e5-856cb36910d7','helpdesk','Help desk','hour',60),
  ('08cc4be7-1955-4be8-a90c-0b95e4f31a9c','assessment','Network assessment','each',NULL),
  ('423bddde-4f8e-4e98-aabc-529a817a57a0','internal','Internal projects','hour',60),
  ('2d15bc02-d08e-4242-860c-5d461bf2b1c2','field','Field service','hour',60);

INSERT INTO service_price (service_id, rate, additional_rate, effective_from) VALUES
  ('f13e8550-7aec-431c-86e5-856cb36910d7', 55.00,  0.00,'2025-01-01'),
  ('f13e8550-7aec-431c-86e5-856cb36910d7', 60.00,  0.00,'2025-11-01'),
  ('2d15bc02-d08e-4242-860c-5d461bf2b1c2',    95.00, 45.00,'2026-06-15'),
  ('08cc4be7-1955-4be8-a90c-0b95e4f31a9c',  180.00,  0.00,'2026-05-01'),
  ('6d24f906-197c-48c6-9522-b33f242d1c53',    0.66,  0.00,'2026-02-15');

-- What each role is paid. The owner draws by the hour for field, help-desk and
-- internal work -- the help-desk rate went up in late August -- and a flat $60
-- an assessment. The employee is paid by the hour; the contractor gets 40% of
-- each field line. When the car is their own, the owner is paid 90% of what
-- its miles bill and the employee 60%.
INSERT INTO pay_rule (service_id, role_id, pays_for, method, amount, effective_from)
SELECT r.service, (SELECT id FROM role WHERE name = r.role), r.pays_for, r.method,
       r.amount, r.day
  FROM (VALUES
    ('2d15bc02-d08e-4242-860c-5d461bf2b1c2'::uuid,    'Partner',    'time',    'per_hour', 45.00, '2026-07-01'::date),
    ('f13e8550-7aec-431c-86e5-856cb36910d7'::uuid, 'Partner',    'time',    'per_hour', 18.00, '2025-03-01'::date),
    ('f13e8550-7aec-431c-86e5-856cb36910d7'::uuid, 'Partner',    'time',    'per_hour', 21.00, '2026-08-20'::date),
    ('423bddde-4f8e-4e98-aabc-529a817a57a0'::uuid, 'Partner',    'time',    'per_hour', 30.00, '2026-04-01'::date),
    ('08cc4be7-1955-4be8-a90c-0b95e4f31a9c'::uuid,   'Partner',    'time',    'fixed',    60.00, '2026-05-10'::date),
    ('6d24f906-197c-48c6-9522-b33f242d1c53'::uuid,   'Partner',    'vehicle', 'percent',  90.00, '2026-02-15'::date),
    ('2d15bc02-d08e-4242-860c-5d461bf2b1c2'::uuid,    'Employee',   'time',    'per_hour', 32.00, '2026-03-01'::date),
    ('f13e8550-7aec-431c-86e5-856cb36910d7'::uuid, 'Employee',   'time',    'per_hour', 24.00, '2026-03-01'::date),
    ('423bddde-4f8e-4e98-aabc-529a817a57a0'::uuid, 'Employee',   'time',    'per_hour', 24.00, '2026-03-01'::date),
    ('6d24f906-197c-48c6-9522-b33f242d1c53'::uuid,   'Employee',   'vehicle', 'percent',  60.00, '2026-03-01'::date),
    ('2d15bc02-d08e-4242-860c-5d461bf2b1c2'::uuid,    'Contractor', 'time',    'percent',  40.00, '2026-05-01'::date)
  ) AS r(service, role, pays_for, method, amount, day);

-- Three stock items from one wholesaler. The raceway has no markup of its own,
-- so it takes the operator's default.
-- Counted in the two units the migrations start the list with, and a box of
-- the business's own.
INSERT INTO unit (name, short, places) VALUES ('box of 25', 'box', 0);
INSERT INTO material (id, sku, name, brand, unit_id, markup_pct, taxable) VALUES
  ('427ec8a1-9038-4fca-9323-ca62625622a3','AP6-CE','Access point · Wi-Fi 6 · Ceiling','Ridgeline',(SELECT id FROM unit WHERE name = 'each'),18.0,true),
  ('b144a78b-750a-4bd2-a84e-7d1551328565','RW-075','Raceway · Surface · 3/4 in','Ridgeline',(SELECT id FROM unit WHERE name = 'foot'),NULL,true),
  ('cf86d35e-06ad-4d9d-b3e9-104390b24ea0','FL-LC-3M','Fibre patch lead · LC-LC · 3 m','Cordwell',(SELECT id FROM unit WHERE name = 'each'),30.0,true);

-- What each lot cost, before tax and in tax, as its receipt says: six access
-- points for 672.00 and 48.72 tax, and so on. Each arrives whole; what the
-- invoices below draw comes off it.
INSERT INTO material_lot (id, material_id, received_on, supplier, qty_received, qty_remaining,
                          ex_tax_cost, tax_paid) VALUES
  ('c0ac1e19-b1d7-4e4c-9805-95e66944db65','427ec8a1-9038-4fca-9323-ca62625622a3', current_date - 90,'Delta Wholesale', 6, 6, 672.00, 48.72),
  ('c751f2ae-b0b1-4c59-af97-96438b6bfa47','b144a78b-750a-4bd2-a84e-7d1551328565', current_date - 90,'Delta Wholesale', 100, 100, 85.00, 6.16),
  ('69340fe1-83e7-4892-8736-45a72715d6ef','cf86d35e-06ad-4d9d-b3e9-104390b24ea0', current_date - 12,'Delta Wholesale', 20, 20, 84.00, 6.09);

-- ------------------------------------------------------------ who it serves --

-- A dental practice with two offices, an insurance agency upstairs from one of
-- them, a veterinary clinic, and a homeowner, who has no site at all.
INSERT INTO entity (id, name, slug) VALUES
  ('b652b696-5037-4fe8-822c-9caed8f21c68','Pinecrest Insurance','pinecrest-insurance'),
  ('adaf8510-48a7-4ce1-a78f-6f7eab7ea29e','Harbor Light Dental','harbor-light-dental'),
  ('426f8d3b-fc9a-4cf9-a82f-6caf96c90a8f','Marisol Vega','marisol-vega'),
  ('46b1aaa1-0ade-4002-bfb5-9a80b547c2ed','Valley Oak Veterinary','valley-oak-veterinary');

-- Harbor Light's Main Street office and Pinecrest's Suite 210 are both at 101
-- Maple St. The Woodland office's rate is 230 days old.
INSERT INTO site (id, entity_id, label, slug, street, city, region, postcode,
                  round_trip_miles, drive_minutes, tax_jurisdiction, tax_rate_pct,
                  state_rate_pct, district_rate_pct, tax_area_code,
                  area_verified_on) VALUES
  ('75aea465-ad04-43e1-b6b4-d7132872a870','46b1aaa1-0ade-4002-bfb5-9a80b547c2ed',
   'Clinic','clinic','8556 Gibson Ranch Park Rd','Elverta','CA','95626', 28, 36,
   'UNINCORPORATED AREA-SACRAMENTO', 7.7500, 7.2500, 0.5000, '349980230000',
   current_date - 4),
  ('4c42978a-ace1-4a79-a7f0-0d9e7efed2da','adaf8510-48a7-4ce1-a78f-6f7eab7ea29e',
   'Main Street office','main-street-office','101 Maple St','Auburn','CA','95603', 64, 70,
   'AUBURN', 7.2500, 7.2500, 0.0000, '310110000000', current_date - 40),
  ('0ab3a11c-d59e-4526-a132-402a4bc9d9ca','b652b696-5037-4fe8-822c-9caed8f21c68',
   'Suite 210','suite-210','101 Maple St','Auburn','CA','95603', 64, 70,
   'AUBURN', 7.2500, 7.2500, 0.0000, '310110000000', current_date - 40),
  ('52e62dcd-9dd8-4ddb-a985-a1ad40c24109','adaf8510-48a7-4ce1-a78f-6f7eab7ea29e',
   'Woodland office','woodland-office','1000 Main St','Woodland','CA','95695', 42, 48,
   'WOODLAND', 8.0000, 7.2500, 0.7500, '570282360000', current_date - 230);

-- Every time CDTFA was asked, and what it said. The clinic was asked twice four
-- days ago and gave the same answer both times.
INSERT INTO site_tax_check (site_id, checked_at, tax_area_code, tax_jurisdiction,
                            rate_pct, state_rate_pct, district_rate_pct, changed) VALUES
  ('52e62dcd-9dd8-4ddb-a985-a1ad40c24109', current_date - 230, '570282360000',
   'WOODLAND', 8.0000, 7.2500, 0.7500, true),
  ('4c42978a-ace1-4a79-a7f0-0d9e7efed2da', current_date - 40, '310110000000',
   'AUBURN', 7.2500, 7.2500, 0.0000, true),
  ('0ab3a11c-d59e-4526-a132-402a4bc9d9ca', current_date - 40, '310110000000',
   'AUBURN', 7.2500, 7.2500, 0.0000, true),
  ('75aea465-ad04-43e1-b6b4-d7132872a870', current_date - 90, '349980230000',
   'UNINCORPORATED AREA-SACRAMENTO', 7.7500, 7.2500, 0.5000, true),
  ('75aea465-ad04-43e1-b6b4-d7132872a870', current_date - 4, '349980230000',
   'UNINCORPORATED AREA-SACRAMENTO', 7.7500, 7.2500, 0.5000, false),
  ('75aea465-ad04-43e1-b6b4-d7132872a870', current_date - 4, '349980230000',
   'UNINCORPORATED AREA-SACRAMENTO', 7.7500, 7.2500, 0.5000, false);

INSERT INTO contact (id, name, email, phone) VALUES
  ('1696abcc-fc5f-44e2-ac99-a12e08b25f8f','Ellen Park','ellen@example.com','916-555-0127'),
  ('05b30c52-c5c8-4371-9893-44e3152903ff','Tom Reyes',null,'530 555 0193'),
  ('d1bacc15-9d5f-4e64-9358-deac543219c0','Marcus Bell','marcus@example.com',null),
  ('6795cf91-f3a4-44bf-835b-538a4a12e467','Jada Collins','jada@example.com','+1 916 555 0156'),
  ('67850d8e-2a09-4884-ab34-6f142fb48344','Rosa Mendez',null,'(916) 555-0109'),
  ('3f4a535f-3792-46d0-9ee5-b831d9741c0d','Dana Whitfield','dana@example.com','530.555.0135');

-- Ellen runs Harbor Light, and each of its offices has someone of its own:
-- Marcus at Main Street, Tom at Woodland. Jada is Pinecrest's and Rosa is Valley
-- Oak's. Dana does the books for both Harbor Light and Valley Oak.
INSERT INTO entity_contact (entity_id, contact_id, is_primary) VALUES
  ('adaf8510-48a7-4ce1-a78f-6f7eab7ea29e','1696abcc-fc5f-44e2-ac99-a12e08b25f8f', true),
  ('adaf8510-48a7-4ce1-a78f-6f7eab7ea29e','05b30c52-c5c8-4371-9893-44e3152903ff', false),
  ('adaf8510-48a7-4ce1-a78f-6f7eab7ea29e','d1bacc15-9d5f-4e64-9358-deac543219c0', false),
  ('adaf8510-48a7-4ce1-a78f-6f7eab7ea29e','3f4a535f-3792-46d0-9ee5-b831d9741c0d', false),
  ('b652b696-5037-4fe8-822c-9caed8f21c68','6795cf91-f3a4-44bf-835b-538a4a12e467', true),
  ('46b1aaa1-0ade-4002-bfb5-9a80b547c2ed','67850d8e-2a09-4884-ab34-6f142fb48344', true),
  ('46b1aaa1-0ade-4002-bfb5-9a80b547c2ed','3f4a535f-3792-46d0-9ee5-b831d9741c0d', false);

INSERT INTO site_contact (site_id, entity_id, contact_id, is_primary) VALUES
  ('4c42978a-ace1-4a79-a7f0-0d9e7efed2da','adaf8510-48a7-4ce1-a78f-6f7eab7ea29e','d1bacc15-9d5f-4e64-9358-deac543219c0', true),
  ('52e62dcd-9dd8-4ddb-a985-a1ad40c24109','adaf8510-48a7-4ce1-a78f-6f7eab7ea29e','05b30c52-c5c8-4371-9893-44e3152903ff', true);

-- ------------------------------------------------------------- retainers --

-- Harbor Light pays $160 a month for five hours of help desk shared between
-- its offices, and anything past five is billed. It started two months ago;
-- that first month and this one were charged, and last month was given,
-- because the help desk that month was the practice's server move.
--
-- The Woodland office pays $70 a month on its own account for unlimited help
-- desk, from last month, and its calls come under that rather than the
-- practice's five hours.
--
-- Valley Oak pays $120 a month for three hours from this month, and past three
-- the work is free.
INSERT INTO agreement (id, entity_id, site_id, price, starts_on, billing_interval,
                       billing_anchor_day) VALUES
  ('60a12ca8-e899-4f29-b217-973609008a19','adaf8510-48a7-4ce1-a78f-6f7eab7ea29e', NULL,
   160.00, (date_trunc('month', current_date) - interval '2 months')::date, 'monthly', 1),
  ('82459e79-c994-4907-9436-25d39ffb43d4','adaf8510-48a7-4ce1-a78f-6f7eab7ea29e','52e62dcd-9dd8-4ddb-a985-a1ad40c24109', 70.00,
   (date_trunc('month', current_date) - interval '1 month')::date, 'monthly', 1),
  ('b0f6e1ae-0c63-4ced-a9ac-2322e7b78445','46b1aaa1-0ade-4002-bfb5-9a80b547c2ed', NULL,
   120.00, date_trunc('month', current_date)::date, 'monthly', 1);
INSERT INTO agreement_service (agreement_id, service_id, allotment, included_hours, overage) VALUES
  ('60a12ca8-e899-4f29-b217-973609008a19','f13e8550-7aec-431c-86e5-856cb36910d7','capped', 5.00, 'bill'),
  ('82459e79-c994-4907-9436-25d39ffb43d4','f13e8550-7aec-431c-86e5-856cb36910d7','unlimited', NULL, NULL),
  ('b0f6e1ae-0c63-4ced-a9ac-2322e7b78445','f13e8550-7aec-431c-86e5-856cb36910d7','capped', 3.00, 'no_charge');
INSERT INTO agreement_period (agreement_id, period_start, period_end, amount, given) VALUES
  ('60a12ca8-e899-4f29-b217-973609008a19',
   (date_trunc('month', current_date) - interval '2 months')::date,
   (date_trunc('month', current_date) - interval '1 month 1 day')::date, 160.00, false),
  ('60a12ca8-e899-4f29-b217-973609008a19',
   (date_trunc('month', current_date) - interval '1 month')::date,
   (date_trunc('month', current_date) - interval '1 day')::date, 0.00, true),
  ('60a12ca8-e899-4f29-b217-973609008a19',
   date_trunc('month', current_date)::date,
   (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 160.00, false),
  ('82459e79-c994-4907-9436-25d39ffb43d4',
   (date_trunc('month', current_date) - interval '1 month')::date,
   (date_trunc('month', current_date) - interval '1 day')::date, 70.00, false),
  ('82459e79-c994-4907-9436-25d39ffb43d4',
   date_trunc('month', current_date)::date,
   (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 70.00, false),
  ('b0f6e1ae-0c63-4ced-a9ac-2322e7b78445',
   date_trunc('month', current_date)::date,
   (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 120.00, false);

-- Covered help desk is paid out of the retainer, shared by who covered how
-- much: 12% of what Harbor Light's charged and 8% of Valley Oak's, for the
-- owner and the employee alike.
INSERT INTO pay_rule (service_id, role_id, entity_id, pays_for, method, amount, effective_from)
SELECT 'f13e8550-7aec-431c-86e5-856cb36910d7', (SELECT id FROM role WHERE name = r.role), r.client, 'covered_time',
       'percent', r.pct, r.day
  FROM (VALUES ('Partner',  'adaf8510-48a7-4ce1-a78f-6f7eab7ea29e'::uuid, 12, '2026-03-01'::date),
               ('Employee', 'adaf8510-48a7-4ce1-a78f-6f7eab7ea29e'::uuid, 12, '2026-03-01'::date),
               ('Partner',  '46b1aaa1-0ade-4002-bfb5-9a80b547c2ed'::uuid,  8, '2026-05-15'::date),
               ('Employee', '46b1aaa1-0ade-4002-bfb5-9a80b547c2ed'::uuid,  8, '2026-05-15'::date)
       ) AS r(role, client, pct, day);

-- ------------------------------------------------------------- the work --

-- Dates count back from today. Field work not yet invoiced, four, nineteen and
-- thirty-three days old; the oldest took the whole team. The newest was timed, so
-- it keeps its start and end, 9:00 to 11:20 in the morning where it was worked.
INSERT INTO time_entry (client_uuid, worked_on, seconds, started_at, ended_at, zone, crew,
                        worked_by, created_by, entity_id, site_id, service_id, billable, note)
VALUES (gen_random_uuid(), current_date - 4, 140 * 60,
        (current_date - 4 + time '09:00') AT TIME ZONE 'America/Los_Angeles',
        (current_date - 4 + time '11:20') AT TIME ZONE 'America/Los_Angeles',
        'America/Los_Angeles', 'one', 'c54bf38d-b83d-422f-af31-14a2a01aee5e','c54bf38d-b83d-422f-af31-14a2a01aee5e',
        'adaf8510-48a7-4ce1-a78f-6f7eab7ea29e','4c42978a-ace1-4a79-a7f0-0d9e7efed2da','2d15bc02-d08e-4242-860c-5d461bf2b1c2', true, 'Replaced the front desk switch');

INSERT INTO time_entry (client_uuid, worked_on, seconds, crew, worked_by, created_by,
                        entity_id, site_id, service_id, billable, note) VALUES
  (gen_random_uuid(), current_date - 19, 75 * 60, 'one', 'd1496a1c-9d8d-42ac-bf41-d059ed2a634c','c41b2fab-5b71-4954-bb86-1bc803daf7ee',
   'b652b696-5037-4fe8-822c-9caed8f21c68','0ab3a11c-d59e-4526-a132-402a4bc9d9ca','2d15bc02-d08e-4242-860c-5d461bf2b1c2', true, 'Mounted and patched two access points'),
  (gen_random_uuid(), current_date - 33, 105 * 60, 'team', NULL,'c41b2fab-5b71-4954-bb86-1bc803daf7ee',
   '46b1aaa1-0ade-4002-bfb5-9a80b547c2ed','75aea465-ad04-43e1-b6b4-d7132872a870','2d15bc02-d08e-4242-860c-5d461bf2b1c2', true, 'Moved the server rack to the new closet'),
  -- A visit given free.
  (gen_random_uuid(), current_date - 26, 45 * 60, 'one', 'c54bf38d-b83d-422f-af31-14a2a01aee5e','c54bf38d-b83d-422f-af31-14a2a01aee5e',
   '46b1aaa1-0ade-4002-bfb5-9a80b547c2ed','75aea465-ad04-43e1-b6b4-d7132872a870','2d15bc02-d08e-4242-860c-5d461bf2b1c2', false, 'Waiting-room screen, no charge'),
  -- Help desk under the retainers.
  (gen_random_uuid(), LEAST(date_trunc('month', current_date)::date + 3, current_date), 50 * 60, 'one',
   'c41b2fab-5b71-4954-bb86-1bc803daf7ee','c41b2fab-5b71-4954-bb86-1bc803daf7ee','adaf8510-48a7-4ce1-a78f-6f7eab7ea29e','4c42978a-ace1-4a79-a7f0-0d9e7efed2da','f13e8550-7aec-431c-86e5-856cb36910d7', true,
   'Front desk scanner stopped saving to the share'),
  (gen_random_uuid(), LEAST(date_trunc('month', current_date)::date + 6, current_date), 35 * 60, 'one',
   'c54bf38d-b83d-422f-af31-14a2a01aee5e','c54bf38d-b83d-422f-af31-14a2a01aee5e','adaf8510-48a7-4ce1-a78f-6f7eab7ea29e','52e62dcd-9dd8-4ddb-a985-a1ad40c24109','f13e8550-7aec-431c-86e5-856cb36910d7', true,
   'Imaging workstation would not join the domain'),
  (gen_random_uuid(), (date_trunc('month', current_date) - interval '20 days')::date, 80 * 60, 'one',
   'c41b2fab-5b71-4954-bb86-1bc803daf7ee','c41b2fab-5b71-4954-bb86-1bc803daf7ee','adaf8510-48a7-4ce1-a78f-6f7eab7ea29e','4c42978a-ace1-4a79-a7f0-0d9e7efed2da','f13e8550-7aec-431c-86e5-856cb36910d7', true,
   'Mailboxes moved to the new server'),
  -- Before Valley Oak's retainer began, so billed.
  (gen_random_uuid(), (date_trunc('month', current_date) - interval '25 days')::date, 70 * 60, 'one',
   'c41b2fab-5b71-4954-bb86-1bc803daf7ee','c41b2fab-5b71-4954-bb86-1bc803daf7ee','46b1aaa1-0ade-4002-bfb5-9a80b547c2ed','75aea465-ad04-43e1-b6b4-d7132872a870','f13e8550-7aec-431c-86e5-856cb36910d7', true,
   'Backup job failing on the X-ray share'),
  (gen_random_uuid(), LEAST(date_trunc('month', current_date)::date + 1, current_date), 25 * 60, 'one',
   'c54bf38d-b83d-422f-af31-14a2a01aee5e','c54bf38d-b83d-422f-af31-14a2a01aee5e','46b1aaa1-0ade-4002-bfb5-9a80b547c2ed','75aea465-ad04-43e1-b6b4-d7132872a870','f13e8550-7aec-431c-86e5-856cb36910d7', true,
   'Label printer queue jammed'),
  -- Help desk with no retainer behind it, so it bills.
  (gen_random_uuid(), (date_trunc('month', current_date) - interval '6 days')::date, 20 * 60, 'one',
   'c41b2fab-5b71-4954-bb86-1bc803daf7ee','c41b2fab-5b71-4954-bb86-1bc803daf7ee','426f8d3b-fc9a-4cf9-a82f-6caf96c90a8f', NULL,'f13e8550-7aec-431c-86e5-856cb36910d7', true,
   'Set up email on a new laptop'),
  -- Work on Kestrel itself.
  (gen_random_uuid(), (date_trunc('month', current_date) - interval '2 days')::date, 95 * 60, 'one',
   'c54bf38d-b83d-422f-af31-14a2a01aee5e','c54bf38d-b83d-422f-af31-14a2a01aee5e', NULL, NULL,'423bddde-4f8e-4e98-aabc-529a817a57a0', false,
   'Testing a restore from the offsite backup'),
  (gen_random_uuid(), (date_trunc('month', current_date) - interval '15 days')::date, 40 * 60, 'one',
   'c41b2fab-5b71-4954-bb86-1bc803daf7ee','c41b2fab-5b71-4954-bb86-1bc803daf7ee', NULL, NULL,'423bddde-4f8e-4e98-aabc-529a817a57a0', false,
   'Writing the new-client onboarding checklist');

-- The rack move took the whole team: everyone holding a role.
INSERT INTO time_entry_crew (time_entry_id, user_id)
SELECT e.id, u.id
  FROM time_entry e CROSS JOIN "user" u
 WHERE e.crew = 'team' AND u.active AND u.role_id IS NOT NULL;

-- Sam was paid for his share of it three weeks ago, by bank transfer: the
-- figure and the rule as they were that day. Avery and Jordan are still owed.
INSERT INTO person_payment (id, user_id, paid_on, how, note, client_uuid, created_by)
VALUES ('019a0002-0000-7000-8000-000000000001','c54bf38d-b83d-422f-af31-14a2a01aee5e',
        current_date - 20, 'Bank transfer', 'The rack move', gen_random_uuid(),
        'c41b2fab-5b71-4954-bb86-1bc803daf7ee');
INSERT INTO person_payment_item (payment_id, user_id, time_entry_id, amount, said, paid_as)
SELECT '019a0002-0000-7000-8000-000000000001','c54bf38d-b83d-422f-af31-14a2a01aee5e', id, 56.00,
       'Field service · 1.75 hr in a crew of 3 · $32.00 an hour, as an Employee, from Mar 1',
       'wages'
  FROM time_entry WHERE crew = 'team';

-- An assessment, charged by the visit however long it took, and on INV-0209.
INSERT INTO time_entry (id, client_uuid, worked_on, seconds, crew, worked_by, created_by,
                        entity_id, site_id, service_id, billable, note)
VALUES ('7c9a60be-d9be-4472-b06c-415c6a235f35', gen_random_uuid(), current_date - 9, 90 * 60, 'one', 'c41b2fab-5b71-4954-bb86-1bc803daf7ee','c41b2fab-5b71-4954-bb86-1bc803daf7ee',
        'b652b696-5037-4fe8-822c-9caed8f21c68','0ab3a11c-d59e-4526-a132-402a4bc9d9ca','08cc4be7-1955-4be8-a90c-0b95e4f31a9c', true, 'Wi-Fi coverage survey');

-- What the trips are driven in. Avery sold the Ranger a month ago and drives
-- the Tacoma now; Sam drives their own Corolla; the van is the business's, and
-- its miles pay nobody.
INSERT INTO vehicle (id, name, owner_id, retired_on) VALUES
  ('019a0001-0000-7000-8000-000000000001','Ranger','c41b2fab-5b71-4954-bb86-1bc803daf7ee', current_date - 30),
  ('019a0001-0000-7000-8000-000000000002','Tacoma','c41b2fab-5b71-4954-bb86-1bc803daf7ee', NULL),
  ('019a0001-0000-7000-8000-000000000003','Corolla','c54bf38d-b83d-422f-af31-14a2a01aee5e', NULL),
  ('019a0001-0000-7000-8000-000000000004','Transit van', NULL, NULL);

-- Sam's drive today, in the Corolla -- so every month's trips screen has one:
-- Harbor Light's Woodland office, then the clinic in Elverta, then home -- 57
-- miles, of which the first leg is Harbor Light's and the other two the clinic's.
INSERT INTO trip (id, travelled_on, driven_by, created_by, vehicle_id, note,
                  odometer_start, odometer_end)
VALUES ('d1ecd94f-1c64-409e-89fd-d6f6da437a7c', current_date, 'c54bf38d-b83d-422f-af31-14a2a01aee5e','c54bf38d-b83d-422f-af31-14a2a01aee5e','019a0001-0000-7000-8000-000000000003',
        'Cable run at the office, then the clinic''s switch', 48213, 48270);
INSERT INTO trip_stop (trip_id, seq, site_id) VALUES
  ('d1ecd94f-1c64-409e-89fd-d6f6da437a7c', 1, '52e62dcd-9dd8-4ddb-a985-a1ad40c24109'),
  ('d1ecd94f-1c64-409e-89fd-d6f6da437a7c', 2, '75aea465-ad04-43e1-b6b4-d7132872a870');
INSERT INTO trip_leg (trip_id, seq, miles, entity_id, site_id, rule, service_id) VALUES
  ('d1ecd94f-1c64-409e-89fd-d6f6da437a7c', 1, 21.0,'adaf8510-48a7-4ce1-a78f-6f7eab7ea29e','52e62dcd-9dd8-4ddb-a985-a1ad40c24109','house_to_a','6d24f906-197c-48c6-9522-b33f242d1c53'),
  ('d1ecd94f-1c64-409e-89fd-d6f6da437a7c', 2, 22.0,'46b1aaa1-0ade-4002-bfb5-9a80b547c2ed','75aea465-ad04-43e1-b6b4-d7132872a870','a_to_b','6d24f906-197c-48c6-9522-b33f242d1c53'),
  ('d1ecd94f-1c64-409e-89fd-d6f6da437a7c', 3, 14.0,'46b1aaa1-0ade-4002-bfb5-9a80b547c2ed','75aea465-ad04-43e1-b6b4-d7132872a870','b_to_house','6d24f906-197c-48c6-9522-b33f242d1c53');

-- Each stop was for its site's client, and each leg of today's drive names the
-- stop it drove to; the last is the way home.
INSERT INTO trip_stop_client (trip_stop_id, entity_id, site_id)
SELECT ts.id, s.entity_id, s.id
  FROM trip_stop ts JOIN site s ON s.id = ts.site_id
 WHERE ts.trip_id = 'd1ecd94f-1c64-409e-89fd-d6f6da437a7c';
UPDATE trip_leg l SET to_stop_id = ts.id
  FROM trip_stop ts
 WHERE ts.trip_id = l.trip_id AND ts.seq = l.seq
   AND l.trip_id = 'd1ecd94f-1c64-409e-89fd-d6f6da437a7c';

-- Avery's visit to the clinic forty days ago, out and back in the Ranger. Its
-- miles are on INV-0204.
INSERT INTO trip (id, travelled_on, driven_by, created_by, vehicle_id)
VALUES ('57bd5f26-036a-4487-af85-2e9e2ac26c38', current_date - 40, 'c41b2fab-5b71-4954-bb86-1bc803daf7ee','c41b2fab-5b71-4954-bb86-1bc803daf7ee','019a0001-0000-7000-8000-000000000001');
INSERT INTO trip_stop (trip_id, seq, site_id) VALUES ('57bd5f26-036a-4487-af85-2e9e2ac26c38', 1, '75aea465-ad04-43e1-b6b4-d7132872a870');
INSERT INTO trip_stop_client (trip_stop_id, entity_id, site_id)
SELECT ts.id, s.entity_id, s.id
  FROM trip_stop ts JOIN site s ON s.id = ts.site_id
 WHERE ts.trip_id = '57bd5f26-036a-4487-af85-2e9e2ac26c38';
INSERT INTO trip_leg (id, trip_id, seq, miles, entity_id, site_id, rule, service_id)
VALUES ('5ba955e1-ee5a-438b-9d26-40c097f20716','57bd5f26-036a-4487-af85-2e9e2ac26c38', 1, 28.0,'46b1aaa1-0ade-4002-bfb5-9a80b547c2ed','75aea465-ad04-43e1-b6b4-d7132872a870','round_trip','6d24f906-197c-48c6-9522-b33f242d1c53');

-- -------------------------------------------------------------- invoices --

-- Each is written as a draft first: the schema refuses any change to a sent
-- invoice's lines, so a sent one is lined and then sent.
--
--   INV-0197  Pinecrest, the access points and raceway, sent 75 days ago, unpaid
--   INV-0204  Valley Oak, the visit and its miles, paid in full
--   INV-0209  Pinecrest, the assessment, sent last week, not yet due
--   INV-0212  Marisol Vega, a draft, for a client with no site
INSERT INTO invoice (id, number, entity_id, status, created_by) VALUES
  ('2858d54a-2fa4-4a88-b35e-b9f0a1fbe27a','INV-0197','b652b696-5037-4fe8-822c-9caed8f21c68','draft','c41b2fab-5b71-4954-bb86-1bc803daf7ee'),
  ('ed02bc4d-1612-4a45-865a-2b5891620943','INV-0204','46b1aaa1-0ade-4002-bfb5-9a80b547c2ed','draft','c41b2fab-5b71-4954-bb86-1bc803daf7ee'),
  ('5aee3c6d-15d5-4856-9b44-4357ea9b901a','INV-0209','b652b696-5037-4fe8-822c-9caed8f21c68','draft','c54bf38d-b83d-422f-af31-14a2a01aee5e'),
  ('6f444d02-b482-4506-98fe-ee23f45d26c5','INV-0212','426f8d3b-fc9a-4cf9-a82f-6caf96c90a8f','draft','c41b2fab-5b71-4954-bb86-1bc803daf7ee');

INSERT INTO invoice_line (invoice_id, seq, kind, description, qty, unit, unit_price, amount,
                          taxable, tax_rate_pct, trip_leg_id, time_entry_id) VALUES
  ('ed02bc4d-1612-4a45-865a-2b5891620943',1,'service','Field service',1.25,'hour',95.00,118.75,false,0,NULL,NULL),
  ('ed02bc4d-1612-4a45-865a-2b5891620943',2,'service','Travel',28.0,'mile',0.66,18.48,false,0,'5ba955e1-ee5a-438b-9d26-40c097f20716',NULL),
  ('5aee3c6d-15d5-4856-9b44-4357ea9b901a',1,'service','Network assessment',1,'each',180.00,180.00,false,0,NULL,'7c9a60be-d9be-4472-b06c-415c6a235f35'),
  ('6f444d02-b482-4506-98fe-ee23f45d26c5',1,'service','Field service',1.5,'hour',95.00,142.50,false,0,NULL,NULL),
  ('6f444d02-b482-4506-98fe-ee23f45d26c5',2,'service','Travel',18.0,'mile',0.66,11.88,false,0,NULL,NULL);

-- Goods lines name the site whose rate taxes them and the material each is,
-- with what it cost before tax and the tax already paid on it. What each took
-- off its lot is a draw, which takes it off the shelf.
INSERT INTO invoice_line (id, invoice_id, seq, kind, description, qty, unit, unit_price, amount,
                          taxable, tax_rate_pct, tax_source, site_id, material_id,
                          ex_tax_cost, tax_paid) VALUES
  ('a0ca5d14-192f-43eb-9652-48e6fe145e67','2858d54a-2fa4-4a88-b35e-b9f0a1fbe27a',1,'material','Access point · Wi-Fi 6 · Ceiling',
   2,'each',132.16,264.32,true,7.2500,'site','0ab3a11c-d59e-4526-a132-402a4bc9d9ca','427ec8a1-9038-4fca-9323-ca62625622a3', 224.00, 16.24),
  ('46c02ef2-14c7-4043-9321-34a0ecd99100','2858d54a-2fa4-4a88-b35e-b9f0a1fbe27a',2,'material','Raceway · Surface · 3/4 in',
   40,'foot',1.06,42.40,true,7.2500,'site','0ab3a11c-d59e-4526-a132-402a4bc9d9ca','b144a78b-750a-4bd2-a84e-7d1551328565', 34.00, 2.464);

INSERT INTO stock_draw (invoice_line_id, material_lot_id, material_id, qty) VALUES
  ('a0ca5d14-192f-43eb-9652-48e6fe145e67','c0ac1e19-b1d7-4e4c-9805-95e66944db65','427ec8a1-9038-4fca-9323-ca62625622a3', 2),
  ('46c02ef2-14c7-4043-9321-34a0ecd99100','c751f2ae-b0b1-4c59-af97-96438b6bfa47','b144a78b-750a-4bd2-a84e-7d1551328565', 40);

UPDATE invoice i SET status = 'sent', issued_on = d.issued, due_on = d.issued + 30,
                     sent_at = d.issued::timestamptz,
                     public_token = replace(gen_random_uuid()::text, '-', '')
  FROM (VALUES ('2858d54a-2fa4-4a88-b35e-b9f0a1fbe27a'::uuid, current_date - 75),
               ('ed02bc4d-1612-4a45-865a-2b5891620943'::uuid, current_date - 38),
               ('5aee3c6d-15d5-4856-9b44-4357ea9b901a'::uuid, current_date - 7)
       ) AS d(id, issued)
 WHERE i.id = d.id;

-- Valley Oak paid INV-0204 by bank transfer eleven days ago.
INSERT INTO payment (id, entity_id, received_on, gross, method)
VALUES ('97e46191-166c-49db-b1b1-fbe13b838270','46b1aaa1-0ade-4002-bfb5-9a80b547c2ed', current_date - 11, 137.23, 'transfer');
INSERT INTO payment_allocation (payment_id, invoice_id, amount)
VALUES ('97e46191-166c-49db-b1b1-fbe13b838270','ed02bc4d-1612-4a45-865a-2b5891620943', 137.23);
