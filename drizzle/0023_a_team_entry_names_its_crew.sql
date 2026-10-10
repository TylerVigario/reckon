-- A TEAM ENTRY NAMES WHO WAS ON IT. It named nobody, and a team was everybody
-- holding a role, worked out live: right for two partners, wrong the day a
-- third person holds one -- counted and paid on every team job -- and a change
-- of roles moved what past jobs bill and pay. A team entry now names its crew.
-- The index on a time entry's crew and day had the name the new table wants:
-- it keeps its work under another.
ALTER INDEX "time_entry_crew" RENAME TO "time_entry_by_crew";
--> statement-breakpoint
CREATE TABLE "time_entry_crew" (
	"time_entry_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "time_entry_crew_pkey" PRIMARY KEY("time_entry_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "time_entry_crew" ADD CONSTRAINT "time_entry_crew_time_entry_id_fkey" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_crew" ADD CONSTRAINT "time_entry_crew_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_entry_crew_user" ON "time_entry_crew" USING btree ("user_id");--> statement-breakpoint
-- What a team was until now: everybody holding a role. Each team entry already
-- recorded is that crew, so nothing recorded bills or pays differently.
INSERT INTO "time_entry_crew" ("time_entry_id", "user_id")
SELECT e."id", u."id"
  FROM "time_entry" e
 CROSS JOIN "user" u
 WHERE e."crew" = 'team' AND u."active" AND u."role_id" IS NOT NULL;
--> statement-breakpoint
-- A crew is a team entry's: one person's entry names its worker, not a crew.
CREATE FUNCTION crew_is_a_teams() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (SELECT crew FROM time_entry WHERE id = NEW.time_entry_id) IS DISTINCT FROM 'team' THEN
    RAISE EXCEPTION 'time entry % is one person''s, so it names its worker, not a crew',
      NEW.time_entry_id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER crew_is_a_teams BEFORE INSERT OR UPDATE ON time_entry_crew FOR EACH ROW EXECUTE FUNCTION crew_is_a_teams();
--> statement-breakpoint
-- And a team entry with a crew stays a team's: made one person's, it would
-- name a worker and a crew at once.
CREATE FUNCTION team_keeps_its_crew() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM time_entry_crew WHERE time_entry_id = NEW.id) THEN
    RAISE EXCEPTION 'time entry % names a crew, so it stays a team''s', NEW.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER team_keeps_its_crew BEFORE UPDATE OF crew ON time_entry FOR EACH ROW
  WHEN (NEW.crew IS DISTINCT FROM 'team') EXECUTE FUNCTION team_keeps_its_crew();
