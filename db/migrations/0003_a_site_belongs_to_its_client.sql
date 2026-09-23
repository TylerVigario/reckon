-- There is no such thing as a location. There are sites, and a site is a
-- client's.
--
-- "locations doesnt make sense. site(s) is what a per client location is.
--  location doesnt exist. there are tax rates that can be attached to an area
--  (state, locality, city, etc)"  -- 14 Sep 2026
--
-- The old shape had one `location` row per physical address, shared, with
-- entity_location carrying each client's own name for it. That was built to
-- answer "two clients work at 36005 CA-99 N" -- and it answered it by making
-- the address the thing and the client a label on it.
--
-- It is the wrong way round. Nobody works at an address in the abstract: Bravo
-- has a site at Traver and Wild Jacks has a site at Traver, and those are two
-- sites that happen to share a postcode. They have different contacts,
-- different access, different histories, and they are billed to different
-- people. Making them one row with two labels meant every query about a site
-- had to say which client was asking, and every screen had to remember.
--
-- 0007 once tried to confine a client to its own sites with a composite key and
-- was undone by 0008, because an invoice already existed that crossed the
-- boundary. That was the same idea approached from the wrong end -- constrain
-- the sharing rather than remove the sharing. This removes it.
--
-- AND TAX ATTACHES TO AN AREA, not to a site. A site sits in a state, a
-- locality, perhaps a city; those areas levy, and the site draws whatever
-- reaches it. Two sites at one address draw the same areas and charge the same
-- rate, which is the thing the shared row was protecting and is now simply
-- true.

BEGIN;

-- 'county' was a US word for one rung of this ladder. 'locality' is the rung.
ALTER TABLE tax DROP CONSTRAINT tax_level_check;
UPDATE tax SET level = 'locality' WHERE level = 'county';
ALTER TABLE tax ADD CONSTRAINT tax_level_check
  CHECK (level IN ('state','locality','city','district','special','combined'));

COMMENT ON COLUMN tax.level IS
  'The kind of area that levies it. combined means a published total whose '
  'components are not recorded -- billable and filable as one line, and worth '
  'splitting when somebody has the schedule in front of them.';

-- ===========================================================================

CREATE TABLE site (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id            uuid NOT NULL REFERENCES entity(id) ON DELETE RESTRICT,
  label                text NOT NULL,
  contact_id           uuid REFERENCES contact(id) ON DELETE SET NULL,
  street               text,
  city                 text,
  region               text,
  postcode             text,
  google_place_id      text,
  address_verified_on  date,
  area_verified_on     date,
  round_trip_miles     numeric(8,1) CHECK (round_trip_miles >= 0),
  drive_minutes        integer CHECK (drive_minutes >= 0),
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- "the site should always include location city name" -- 10 Sep 2026. Held
  -- here rather than assembled by each caller, because a name that reads one
  -- way on the timesheet and another on an invoice is two names. The city is
  -- skipped when either already contains the other: "Traver" needs no ", 
  -- Traver", and "Kettleman City yard" is not improved by ", Kettleman City".
  display              text GENERATED ALWAYS AS (
                         CASE
                           WHEN city IS NULL OR city = '' THEN label
                           WHEN position(lower(city) IN lower(label)) > 0 THEN label
                           WHEN position(lower(label) IN lower(city)) > 0 THEN label
                           ELSE label || ', ' || city
                         END) STORED,
  -- One client cannot have two sites by the same name. Two clients can.
  UNIQUE (entity_id, label),
  -- Carried only for the length of this migration, to repoint what pointed at
  -- the old shared row. Dropped at the bottom.
  from_location_id     uuid
);

COMMENT ON TABLE site IS
  'A place a client has work done. Belongs to exactly one client: two clients '
  'at one address are two sites, because they have different contacts, '
  'different access and different bills.';
COMMENT ON COLUMN site.label IS
  'What this client calls it. 36005 CA-99 N is "The Shoppe" to Bravo Farms and '
  '"Traver" to Wild Jacks, and neither has to know the other exists.';
COMMENT ON COLUMN site.contact_id IS
  'Who to ask at this site. Null falls back to the client''s primary contact.';
COMMENT ON COLUMN site.area_verified_on IS
  'When the areas levying here were last confirmed. Distinct from '
  'address_verified_on: one says the place is real, the other says which '
  'jurisdictions reach it.';

CREATE TABLE site_tax (
  site_id uuid NOT NULL REFERENCES site(id) ON DELETE CASCADE,
  tax_id  uuid NOT NULL REFERENCES tax(id) ON DELETE RESTRICT,
  PRIMARY KEY (site_id, tax_id)
);

COMMENT ON TABLE site_tax IS
  'Which areas levy at this site. RESTRICT on the tax: losing a levy that '
  'priced a past invoice would leave that invoice unexplainable.';

-- ===========================================================================
-- One site per (client, address) pair that existed.

INSERT INTO site (entity_id, label, contact_id, street, city, region, postcode,
                  google_place_id, address_verified_on, area_verified_on,
                  round_trip_miles, drive_minutes, active, from_location_id)
SELECT el.entity_id,
       COALESCE(el.label, l.label),
       el.contact_id,
       COALESCE(l.street, l.label), l.city, l.region, l.postcode,
       l.google_place_id, l.address_verified_on, l.district_verified_on,
       l.round_trip_miles, l.drive_minutes, l.active,
       l.id
  FROM entity_location el
  JOIN location l ON l.id = el.location_id;

-- The areas that reached the address now reach each site at it.
INSERT INTO site_tax (site_id, tax_id)
SELECT s.id, lt.tax_id
  FROM site s JOIN location_tax lt ON lt.location_id = s.from_location_id
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- Repoint everything that named a location. Each of these knows whose work it
-- was, which is exactly what the old shape could not use.

ALTER TABLE time_entry ADD COLUMN site_id uuid REFERENCES site(id) ON DELETE RESTRICT;
UPDATE time_entry t SET site_id = s.id
  FROM site s
 WHERE s.entity_id = t.entity_id AND s.from_location_id = t.location_id;
ALTER TABLE time_entry DROP COLUMN location_id;

ALTER TABLE trip_leg ADD COLUMN site_id uuid REFERENCES site(id) ON DELETE RESTRICT;
UPDATE trip_leg tl SET site_id = s.id
  FROM site s
 WHERE s.entity_id = tl.entity_id AND s.from_location_id = tl.location_id;
ALTER TABLE trip_leg DROP COLUMN location_id;

ALTER TABLE invoice_line ADD COLUMN site_id uuid REFERENCES site(id) ON DELETE RESTRICT;
UPDATE invoice_line il SET site_id = s.id
  FROM site s, invoice i
 WHERE i.id = il.invoice_id
   AND s.entity_id = i.entity_id
   AND s.from_location_id = il.location_id;
ALTER TABLE invoice_line DROP COLUMN location_id;

ALTER TABLE agreement_location ADD COLUMN site_id uuid REFERENCES site(id) ON DELETE CASCADE;
UPDATE agreement_location al SET site_id = s.id
  FROM site s, agreement a
 WHERE a.id = al.agreement_id
   AND s.entity_id = a.entity_id
   AND s.from_location_id = al.location_id;
DELETE FROM agreement_location WHERE site_id IS NULL;
ALTER TABLE agreement_location DROP COLUMN location_id;
ALTER TABLE agreement_location ALTER COLUMN site_id SET NOT NULL;
ALTER TABLE agreement_location ADD PRIMARY KEY (agreement_id, site_id);
ALTER TABLE agreement_location RENAME TO agreement_site;

-- A stop is somewhere the van stopped. Often a client's site; sometimes the
-- yard, a supplier, or a lay-by. It keeps its free-text address for the ones
-- that are nobody's site.
ALTER TABLE trip_stop ADD COLUMN site_id uuid REFERENCES site(id) ON DELETE SET NULL;
UPDATE trip_stop ts SET address = COALESCE(ts.address, l.label)
  FROM location l WHERE l.id = ts.location_id AND ts.address IS NULL;
ALTER TABLE trip_stop DROP COLUMN location_id;

-- The operator's base is the operator's own address, which it already has.
-- A row in a table of clients' sites was never the right place for it.
ALTER TABLE operator DROP COLUMN base_location_id;

-- ===========================================================================

DROP VIEW IF EXISTS client_site;
DROP VIEW IF EXISTS site_rate;

CREATE VIEW site_rate AS
SELECT s.id AS site_id,
       s.entity_id,
       COALESCE(sum(r.rate_pct), 0)::numeric(7,4) AS rate_pct,
       count(t.id) AS levies,
       max(r.effective_from) AS effective_from,
       min(r.verified_on) AS verified_on,
       jsonb_agg(jsonb_build_object('tax', t.name, 'level', t.level,
                                    'authority', t.authority, 'rate_pct', r.rate_pct)
                 ORDER BY t.level, t.name)
         FILTER (WHERE t.id IS NOT NULL) AS breakdown
  FROM site s
  LEFT JOIN site_tax st ON st.site_id = s.id
  LEFT JOIN tax t ON t.id = st.tax_id AND t.active
  LEFT JOIN LATERAL (
         SELECT tr.rate_pct, tr.effective_from, tr.verified_on
           FROM tax_rate tr
          WHERE tr.tax_id = t.id AND tr.effective_from <= current_date
          ORDER BY tr.effective_from DESC
          LIMIT 1) r ON true
 GROUP BY s.id, s.entity_id;

COMMENT ON VIEW site_rate IS
  'What tax is charged at each site: the sum of the levies reaching it, with '
  'breakdown carrying each one''s share for a return. A site drawing nothing '
  'has no rate rather than a rate of zero -- levies = 0 says which.';

DROP TABLE location_tax;
DROP TABLE entity_location;
DROP TABLE location;

ALTER TABLE site DROP COLUMN from_location_id;

-- ===========================================================================
-- A SITE IS ITS CLIENT'S, AND THE DATABASE SAYS SO.
--
-- 0007 tried this and 0008 undid it, because an invoice already existed that
-- billed Traver work through the Kettleman client -- one shared address, two
-- clients, and a composite key that refused the ordinary case. That invoice was
-- evidence the constraint was wrong for the shape it was in.
--
-- The shape is different now. Wild Jacks has its own Traver site, so the entry
-- that could not be represented then is representable now, and naming one
-- client with another client's site is no longer a real case -- it is a typo
-- that bills the wrong person.
--
-- MATCH SIMPLE, which is the default: non-billable work has no client and no
-- site, and a null on either side satisfies the constraint rather than tripping
-- it.
ALTER TABLE site ADD CONSTRAINT site_belongs_to_one_client UNIQUE (id, entity_id);

ALTER TABLE time_entry
  ADD CONSTRAINT time_entry_site_is_the_clients
  FOREIGN KEY (entity_id, site_id) REFERENCES site (entity_id, id);

ALTER TABLE trip_leg
  ADD CONSTRAINT trip_leg_site_is_the_clients
  FOREIGN KEY (entity_id, site_id) REFERENCES site (entity_id, id);

CREATE INDEX site_by_entity ON site (entity_id) WHERE active;
CREATE INDEX time_entry_site ON time_entry (site_id);

INSERT INTO migration (filename) VALUES ('0003_a_site_belongs_to_its_client.sql');

COMMIT;
