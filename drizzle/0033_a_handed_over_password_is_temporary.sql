-- A HANDED-OVER PASSWORD IS TEMPORARY. Someone with Full adds a person, or
-- resets their password, on Team, and is shown a password once to give them.
-- Until the person chooses their own, signing in with it reaches nothing but the
-- page where they do.
--
-- Everyone here already chose theirs, at the command line, so none starts
-- temporary.
ALTER TABLE "user" ADD COLUMN "temporary_password" boolean DEFAULT false NOT NULL;
