-- What happens on the server while the phone offline-check drives is out of
-- reach, as if from another phone. Run between its offline and back phases.
--
-- INV-0212, which the phone added a permit to, goes out, as if sent from
-- another phone: the permit has to start a new draft.
UPDATE invoice SET status = 'sent', issued_on = current_date, due_on = current_date + 30,
                   sent_at = now(), public_token = replace(gen_random_uuid()::text, '-', '')
 WHERE number = 'INV-0212';

-- On the draft lines-check made -- the one with its jacks -- Sam changes the
-- jacks the phone changed -- the cost both changed, the supplier only he did --
-- and takes off the permit the phone changed.
BEGIN;
DO $$ BEGIN
  PERFORM set_config('reckon.user_id',
                     (SELECT id::text FROM "user" WHERE email = 'sam@kestrel.example'), true);
END $$;
DELETE FROM invoice_line
 WHERE description = 'Low-voltage permit'
   AND invoice_id = (SELECT invoice_id FROM invoice_line WHERE description = 'Keystone jacks ×12');
UPDATE invoice_line SET ex_tax_cost = 29.00, unit_price = 29.00, amount = 29.00,
                        bought_from = 'Valley Hardware, Woodland'
 WHERE description = 'Keystone jacks ×12';
COMMIT;

-- Sam changes the two entries Avery made yesterday and changed or removed on
-- the phone: the note on the one changed there too, and whether it bills, which
-- only he does; and the note on the one removed there.
BEGIN;
DO $$ BEGIN
  PERFORM set_config('reckon.user_id',
                     (SELECT id::text FROM "user" WHERE email = 'sam@kestrel.example'), true);
END $$;
UPDATE time_entry SET note = 'Patched the front desk, by Sam', billable = false
 WHERE note = 'Patched the front desk'
   AND created_by = (SELECT id FROM "user" WHERE email = 'avery@kestrel.example');
UPDATE time_entry SET note = 'Checked the wiring closet, by Sam'
 WHERE note = 'Checked the wiring closet'
   AND created_by = (SELECT id FROM "user" WHERE email = 'avery@kestrel.example');
COMMIT;

-- And removes the third, which the phone changed.
BEGIN;
DO $$ BEGIN
  PERFORM set_config('reckon.user_id',
                     (SELECT id::text FROM "user" WHERE email = 'sam@kestrel.example'), true);
END $$;
DELETE FROM time_entry
 WHERE note = 'Labelled the patch panel'
   AND created_by = (SELECT id FROM "user" WHERE email = 'avery@kestrel.example');
COMMIT;

-- The patch lead the phone renames, Sam renames too: the phone's arrives to
-- find his, and keeps both for its person to choose between.
BEGIN;
DO $$ BEGIN
  PERFORM set_config('reckon.user_id',
                     (SELECT id::text FROM "user" WHERE email = 'sam@kestrel.example'), true);
END $$;
UPDATE material SET name = 'Fibre patch lead · LC-LC · 3 m, yellow'
 WHERE name = 'Fibre patch lead · LC-LC · 3 m';
COMMIT;
