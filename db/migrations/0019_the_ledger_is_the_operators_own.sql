-- The ledger is the operator's own, and nothing here writes to one yet.
--
-- "the ledger will be creaed anew once we finish the app as well. the current
--  ledger should not be connected or written to with this application. the old
--  ledger is sole prop, the new ledger and this application will be under the
--  partner ein"  -- 23 Sep 2026
--
-- "we have no idea about beancount export requirements. for example: how will
--  we track service charge for stripe? that must be recorded in the ledger"
--  -- 23 Sep 2026
--
-- The ledger poster is gone. It had been written against the one ledger that
-- existed -- a sole proprietorship's -- and the ledger this application writes
-- to does not exist yet, nor do the requirements of writing to it. An export
-- built before either is guesswork that has to be unpicked, so there is none.
--
-- What that leaves wrong in the schema's own descriptions:
--
--   integration.detail  gave "books/" as its example of where a ledger lives.
--                       That was one operator's directory, and the one ledger
--                       this application must never write to.
--   ledger_export       said the poster answered its question by reading the
--                       ledger file. Nothing answers it now.
--   account_map         had no comment at all.

BEGIN;

COMMENT ON COLUMN integration.detail IS
  'What it points at, in the operator''s terms: where the operator''s ledger '
  'file lives, the from-address for email. Not a secret.';

COMMENT ON TABLE ledger_export IS
  'UNUSED, PLANNED. Meant to record what has been handed to the operator''s '
  'ledger. Nothing is handed over yet: an export waits until that ledger exists '
  'and what it needs from this application is known.';

COMMENT ON TABLE account_map IS
  'UNUSED, PLANNED. Which account in the operator''s own ledger each kind of '
  'posting goes to. Nothing supplies a default: a default would be one '
  'business''s chart applied to every other.';
COMMENT ON COLUMN account_map.role IS 'What the account is for.';
COMMENT ON COLUMN account_map.account IS
  'The account name exactly as the operator''s ledger has it.';

INSERT INTO migration (filename)
VALUES ('0019_the_ledger_is_the_operators_own.sql');

COMMIT;
