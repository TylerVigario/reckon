-- A contact is named at the client and at the site.
--
-- "contact should be per client and per site"  -- 14 Sep 2026
--
-- A person was already attachable at both levels, but only one of the two was
-- built as a relation. entity_contact is a proper join table with a primary;
-- site.contact_id was a single nullable column pointing at ANY row in contact.
-- That column has two faults.
--
-- IT ALLOWS ONE PERSON PER SITE. A site has a manager and it has whoever opens
-- up, and the schema could hold one of them. The client level already knew
-- better.
--
-- AND IT WAS NOT CONFINED. Nothing stopped a site naming a contact belonging to
-- a different client -- the same fault the shared `location` row had, and the
-- same one site_belongs_to_one_client fixed for sites. Naming somebody at a
-- site says they are that client's person; the database should not let you say
-- otherwise by accident.
--
-- WHAT IS NOT CHANGED: a contact is still shared. "People cross entities and
-- locations both" -- one person is the contact for three different clients, and
-- giving contact an owner would make three people out of one and lose that. The
-- PERSON is shared; what is per client and per site is who is named where.
--
-- The confinement is the composite-key mechanism already used for sites:
-- site_contact carries the client, and two foreign keys make it agree with both
-- ends -- the site is that client's, and the person is that client's contact.

BEGIN;

CREATE TABLE site_contact (
  site_id    uuid NOT NULL,
  entity_id  uuid NOT NULL,
  contact_id uuid NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  PRIMARY KEY (site_id, contact_id),
  -- The site is this client's.
  FOREIGN KEY (site_id, entity_id) REFERENCES site (id, entity_id) ON DELETE CASCADE,
  -- And the person is this client's contact. Taking somebody off a client takes
  -- them off that client's sites with it: they are not still the person to ask
  -- at an address for a client they no longer work with.
  FOREIGN KEY (entity_id, contact_id)
    REFERENCES entity_contact (entity_id, contact_id) ON DELETE CASCADE
);

COMMENT ON TABLE site_contact IS
  'Who to ask at this site. A site may name several people and one of them '
  'first; a site naming nobody falls back to the client''s primary contact.';
COMMENT ON COLUMN site_contact.entity_id IS
  'The client, carried so the two foreign keys can agree: the site is this '
  'client''s and the contact is this client''s. Redundant to read, load-bearing '
  'to write.';

-- One person answers first, the same rule the client level has.
CREATE UNIQUE INDEX site_one_primary_contact ON site_contact (site_id) WHERE is_primary;

-- ===========================================================================
-- Carry across what the column held.

-- Somebody named at a site is a contact of that site's client. Where that was
-- not already recorded it is now, because it was always true -- this asserts a
-- fact the old shape let go unsaid, it does not invent one.
INSERT INTO entity_contact (entity_id, contact_id)
SELECT s.entity_id, s.contact_id FROM site s WHERE s.contact_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO site_contact (site_id, entity_id, contact_id, is_primary)
SELECT s.id, s.entity_id, s.contact_id, true FROM site s WHERE s.contact_id IS NOT NULL;

ALTER TABLE site DROP COLUMN contact_id;

-- ===========================================================================
-- An agreement names a contact too, and it was unconfined in the same way.

INSERT INTO entity_contact (entity_id, contact_id)
SELECT a.entity_id, a.contact_id FROM agreement a WHERE a.contact_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- SET NULL on the contact column alone: losing a contact should forget who
-- negotiated the agreement, never take the agreement with it.
ALTER TABLE agreement
  ADD CONSTRAINT agreement_contact_is_the_clients
  FOREIGN KEY (entity_id, contact_id)
  REFERENCES entity_contact (entity_id, contact_id)
  ON DELETE SET NULL (contact_id);

INSERT INTO migration (filename)
VALUES ('0007_a_contact_is_named_at_the_client_and_at_the_site.sql');

COMMIT;
