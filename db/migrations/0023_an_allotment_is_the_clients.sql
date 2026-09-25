-- An allotment is the client's.
--
-- "allotment for a service shouldnt even a part of its service configuration.
--  that should be per client and/or per site"  -- 24 Sep 2026
--
-- A service carried subscription terms -- a basis, included hours, a period
-- and what happens past them -- from 0017, when they moved off `operator`
-- ("Remote support settings should be a function of a service item", 11 Sep).
-- They were never what any client got. What a client gets is what their
-- agreement says, service by service, and agreement_service already holds it:
-- unlimited, or so many hours a period with a rule for past them, granted to
-- the whole client (flat) or per site covered (per_location).
--
-- The service's terms did two things, and neither survives:
--
--   * They were the figure a new agreement's coverage started from. An
--     agreement now says its own from the start.
--   * They were a fallback for a client with no agreement, metered against
--     the service's cap. "A client with no subscription has nothing included"
--     -- 9 Sep -- and is billed from the first minute; there is nothing to
--     meter them against.
--
-- The 2-hour figure the terms held is Tyler's -- "the default remote support is
-- 2 hours", 9 Sep -- and stays in docs/decisions.md. It is not a default any
-- more: "no default, it should be set per agreement", 24 Sep.

BEGIN;

ALTER TABLE service DROP CONSTRAINT subscription_terms_match_basis;
ALTER TABLE service
  DROP COLUMN subscription_basis,
  DROP COLUMN subscription_hours,
  DROP COLUMN subscription_period,
  DROP COLUMN subscription_overage;

COMMENT ON TABLE agreement_service IS
  'The services an agreement covers, each with its own allotment: unlimited, or '
  'included_hours a period with a rule for past them, granted to the whole client '
  '(flat) or per site covered (per_location). Hours come out of an allotment only '
  'when the agreement names their service, so an on-site retainer is as easy as a '
  'remote one, and a service not named here is billed.';

INSERT INTO migration (filename) VALUES ('0023_an_allotment_is_the_clients.sql');

COMMIT;
