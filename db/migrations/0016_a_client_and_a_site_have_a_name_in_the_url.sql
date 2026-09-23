-- A client and a site have a name you can read in a URL.
--
-- "why dont clients and sites have a slug?"                    -- 22 Sep 2026
--
-- No reason. Nothing ever asked, so every link carries the primary key:
--
--   /clients/eeeeeeee-0000-0000-0000-000000000001
--           /sites/cccccccc-0000-0000-0000-000000000002
--
-- which cannot be read, dictated down a phone, recognised in browser history,
-- or eyeballed in a log. The id stays what rows point at; the slug is what
-- people point at.
--
-- A SLUG IS SET, NOT DERIVED. It is generated from the name the first time and
-- then left alone -- renaming a client does NOT move its URL. A slug that
-- follows the name breaks every link anybody kept the moment somebody fixes a
-- typo, and the whole value of a readable URL is that it keeps working. It is
-- an ordinary editable field: change it when the name change is worth the
-- broken links, not automatically.
--
-- UNIQUENESS MIRRORS WHAT IS ALREADY TRUE. A client's slug is unique outright,
-- because /clients/<slug> has to resolve to one client. A site's is unique
-- WITHIN ITS CLIENT, exactly like site.label already is -- two clients may
-- both have a "kettleman", and they are different places under different
-- names.

BEGIN;

-- Lowercase, alphanumeric and single dashes, no leading or trailing dash.
-- Written as a function because three places need it and a copy would drift.
CREATE FUNCTION slugify(source text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT nullif(trim(both '-' from regexp_replace(lower(source), '[^a-z0-9]+', '-', 'g')), '')
$$;

COMMENT ON FUNCTION slugify(text) IS
  'A name as it would read in a URL. Null for a name with nothing usable in '
  'it at all, so the caller has to decide rather than store an empty string.';

-- ===========================================================================

ALTER TABLE entity ADD COLUMN slug text;
ALTER TABLE site   ADD COLUMN slug text;

-- Backfilled from the name, with a number appended where two names slugify to
-- the same thing. row_number over the name, not a loop: a second "Bravo Farms"
-- becomes bravo-farms-2 deterministically rather than by whoever ran first.
UPDATE entity e
   SET slug = CASE WHEN n.seq = 1 THEN n.base ELSE n.base || '-' || n.seq END
  FROM (SELECT id,
               coalesce(slugify(name), 'client') AS base,
               row_number() OVER (PARTITION BY coalesce(slugify(name), 'client')
                                  ORDER BY created_at, id) AS seq
          FROM entity) n
 WHERE n.id = e.id;

UPDATE site s
   SET slug = CASE WHEN n.seq = 1 THEN n.base ELSE n.base || '-' || n.seq END
  FROM (SELECT id, entity_id,
               coalesce(slugify(label), 'site') AS base,
               row_number() OVER (PARTITION BY entity_id,
                                               coalesce(slugify(label), 'site')
                                  ORDER BY created_at, id) AS seq
          FROM site) n
 WHERE n.id = s.id;

ALTER TABLE entity ALTER COLUMN slug SET NOT NULL;
ALTER TABLE site   ALTER COLUMN slug SET NOT NULL;

-- A slug that is not a slug would resolve to nothing and read as a typo.
ALTER TABLE entity ADD CONSTRAINT entity_slug_is_a_slug
  CHECK (slug = slugify(slug));
ALTER TABLE site ADD CONSTRAINT site_slug_is_a_slug
  CHECK (slug = slugify(slug));

-- One client per /clients/<slug>.
ALTER TABLE entity ADD CONSTRAINT entity_slug_key UNIQUE (slug);
-- And one site per /clients/<client>/sites/<slug>, the same scope label has.
ALTER TABLE site ADD CONSTRAINT site_slug_is_the_clients UNIQUE (entity_id, slug);

COMMENT ON COLUMN entity.slug IS
  'What this client is called in a URL. Set from the name once and then left '
  'alone -- renaming does not move it, because a link somebody kept is worth '
  'more than a URL that matches the current spelling.';
COMMENT ON COLUMN site.slug IS
  'What this site is called in a URL, within its client. Two clients may both '
  'have a "kettleman"; they are different places.';

INSERT INTO migration (filename)
VALUES ('0016_a_client_and_a_site_have_a_name_in_the_url.sql');

COMMIT;
