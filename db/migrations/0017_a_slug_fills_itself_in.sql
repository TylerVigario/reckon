-- A slug fills itself in.
--
-- 0016 made slug NOT NULL and left every insert to supply one, which means
-- every insert path has to know the rule: derive it from the name, and find a
-- free one if that is taken. Two callers already exist -- the API and the seed
-- -- and a third will not know to look.
--
-- So the database does it. A slug arrives null and comes out derived; a slug
-- arrives set and is left exactly alone, which is what keeps it editable and
-- keeps a rename from moving it.
--
-- THE LOOP IS THE POINT. Two clients called "Bravo Farms" cannot both be
-- bravo-farms, and the second one has to become bravo-farms-2 without the
-- caller knowing there was a first. Doing that in the application is a
-- read-then-write with a race in the middle; doing it here, the unique
-- constraint is the arbiter and the retry is one statement away.

BEGIN;

CREATE FUNCTION fill_entity_slug() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE base text; candidate text; n int := 1;
BEGIN
  IF NEW.slug IS NOT NULL THEN RETURN NEW; END IF;
  base := coalesce(slugify(NEW.name), 'client');
  candidate := base;
  WHILE EXISTS (SELECT 1 FROM entity WHERE slug = candidate AND id IS DISTINCT FROM NEW.id) LOOP
    n := n + 1;
    candidate := base || '-' || n;
  END LOOP;
  NEW.slug := candidate;
  RETURN NEW;
END $$;

CREATE FUNCTION fill_site_slug() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE base text; candidate text; n int := 1;
BEGIN
  IF NEW.slug IS NOT NULL THEN RETURN NEW; END IF;
  base := coalesce(slugify(NEW.label), 'site');
  candidate := base;
  -- Within the client, because that is the scope the slug is unique in.
  WHILE EXISTS (SELECT 1 FROM site
                 WHERE entity_id = NEW.entity_id
                   AND slug = candidate
                   AND id IS DISTINCT FROM NEW.id) LOOP
    n := n + 1;
    candidate := base || '-' || n;
  END LOOP;
  NEW.slug := candidate;
  RETURN NEW;
END $$;

CREATE TRIGGER entity_slug BEFORE INSERT OR UPDATE ON entity
  FOR EACH ROW EXECUTE FUNCTION fill_entity_slug();
CREATE TRIGGER site_slug BEFORE INSERT OR UPDATE ON site
  FOR EACH ROW EXECUTE FUNCTION fill_site_slug();

COMMENT ON FUNCTION fill_entity_slug() IS
  'Derives a slug from the name only when one was not given. Setting it to '
  'null is therefore how you ask for it to be re-derived.';

INSERT INTO migration (filename) VALUES ('0017_a_slug_fills_itself_in.sql');

COMMIT;
