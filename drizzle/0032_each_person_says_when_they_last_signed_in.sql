-- EACH PERSON SAYS WHEN THEY LAST SIGNED IN, set by the sign-in form. Null is
-- none recorded.
--
-- Someone signed in today has a session that began when they did, so that is
-- what they start with. Anyone without one is left empty rather than guessed:
-- a session is gone once its browser signs out or it ages out, and its absence
-- says nothing about when they last came.
ALTER TABLE "user" ADD COLUMN "last_signed_in_at" timestamp with time zone;--> statement-breakpoint
UPDATE "user" SET "last_signed_in_at" = s.began
  FROM (SELECT "user_id", max("created_at") AS began FROM "session" GROUP BY "user_id") s
  WHERE s."user_id" = "user"."id";
