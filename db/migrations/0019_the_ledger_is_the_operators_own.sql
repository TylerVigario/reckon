-- The ledger is the operator's own, and the schema should not suggest one.
--
-- "the ledger will be creaed anew once we finish the app as well. the current
--  ledger should not be connected or written to with this application. the old
--  ledger is sole prop, the new ledger and this application will be under the
--  partner ein"  -- 23 Sep 2026
--
-- integration.detail gave "books/" as its example of what a ledger integration
-- points at. That was one operator's directory -- and, as of that note, the one
-- ledger this application must never write to. An example in the schema is a
-- suggestion, so it goes.
--
-- account_map had no comment at all, and it is now the only place an account
-- name comes from. The poster used to carry its own defaults, which were the
-- chart of the ledger above; it now refuses to post until every role it needs
-- is mapped here. The roles themselves are listed once, in the poster, rather
-- than restated in a comment that would drift from it.

BEGIN;

COMMENT ON COLUMN integration.detail IS
  'What it points at, in the operator''s terms: where the operator''s ledger '
  'file lives, the from-address for email. Not a secret.';

COMMENT ON TABLE account_map IS
  'Which account in the operator''s own ledger each kind of posting goes to. '
  'Nothing supplies a default: a default would be one business''s chart applied '
  'to every other. scripts/post-to-ledger.mjs names the roles it needs and '
  'refuses to post until each is mapped.';
COMMENT ON COLUMN account_map.role IS
  'What the account is for, in the poster''s words -- receivable, bank, and so '
  'on. A role the poster does not know is reported as a likely typo rather than '
  'ignored.';
COMMENT ON COLUMN account_map.account IS
  'The account name exactly as the operator''s ledger has it.';

INSERT INTO migration (filename)
VALUES ('0019_the_ledger_is_the_operators_own.sql');

COMMIT;
