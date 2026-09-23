-- Four tables and four columns nothing reads, kept deliberately.
--
-- An audit on 22 Sep 2026 turned these up: schema with no code behind it. The
-- honest question about each was "planned, or left over?", and the answer for
-- all of them was planned. Writing that down is the whole point of this
-- migration -- unexplained unused schema gets deleted by whoever next goes
-- looking for dead weight, and then gets rebuilt from scratch later.
--
-- Nothing here changes a row or a constraint. It is a comment on each, so the
-- next reader finds the answer on the object rather than in a conversation.

BEGIN;

COMMENT ON TABLE ledger_export IS
  'UNUSED, PLANNED. Meant to record what has been handed to beancount. '
  'scripts/post-to-ledger.mjs currently answers that by reading the ledger '
  'file itself and matching the reckon ids it finds, which works and needs no '
  'state here -- but puts the record in the books rather than in reckon. This '
  'is where it goes if that turns out to be the wrong side.';

COMMENT ON TABLE payout IS
  'UNUSED, PLANNED. A settlement batch from a card processor: several invoices '
  'paid, one deposit, minus a fee. payment.payout_id already points here.';

COMMENT ON TABLE refund IS
  'UNUSED, PLANNED. Money sent back. Distinct from a credit note, which is a '
  'reduction in what is owed rather than a movement of cash.';

COMMENT ON COLUMN invoice.public_token IS
  'UNUSED, PLANNED. A link that lets a client read one invoice without an '
  'account. Nothing issues or checks a token yet, so the column is always '
  'null and /invoice/<token> does not exist.';

COMMENT ON COLUMN invoice.token_expires_on IS
  'UNUSED, PLANNED. When the public link stops working. A link that never '
  'expires is a link that is still live in an inbox in three years.';

COMMENT ON COLUMN invoice.void_reason IS
  'UNUSED, PLANNED. Why an invoice was voided. The CHECK that a void needs a '
  'reason is enforced and currently unreachable: nothing can void one.';

COMMENT ON COLUMN entity.opening_balance IS
  'UNUSED, PLANNED. What a client already owed when they were carried over '
  'from FreshBooks. Not derivable from the invoices here, because the invoices '
  'that made it are not here.';

INSERT INTO migration (filename)
VALUES ('0018_what_is_unused_is_unused_on_purpose.sql');

COMMIT;
