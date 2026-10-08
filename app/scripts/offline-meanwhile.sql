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
