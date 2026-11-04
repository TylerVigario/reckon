-- EACH PERSON HAS FULL OR FIELD ACCESS, apart from the role they are paid in.
-- Full is everything, and the only level that bills or pays; Field is the work
-- they do and what they are paid for it. Which routes each reaches is the
-- app's (#lib/access).
--
-- Someone new starts with Field. Everyone who signs in already keeps reaching
-- everything until someone with Full says otherwise, so nobody loses a screen
-- the day this arrives.
ALTER TABLE "user" ADD COLUMN "access" text DEFAULT 'field' NOT NULL;--> statement-breakpoint
UPDATE "user" SET "access" = 'full';--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_access_check" CHECK ("user"."access" = ANY (ARRAY['full', 'field']));--> statement-breakpoint
-- Someone active keeps Full, or nobody could change anyone's access again:
-- refused for whatever leaves active people and none of them on Full -- the
-- last one moved to Field, made inactive, or removed, or a first person added
-- with Field.
CREATE FUNCTION someone_keeps_full() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "user" WHERE active)
     AND NOT EXISTS (SELECT 1 FROM "user" WHERE active AND access = 'full') THEN
    RAISE EXCEPTION 'nobody active would have Full access, and someone has to'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'someone_keeps_full';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER someone_keeps_full AFTER INSERT OR UPDATE OF access, active OR DELETE ON "user"
  FOR EACH STATEMENT EXECUTE FUNCTION someone_keeps_full();
--> statement-breakpoint
-- Who added a line: someone with Field changes only the lines they added.
ALTER TABLE "invoice_line" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- A line added since lines kept their history (0021) says there who added it:
-- the last time it was added, for one taken off and put back. One added before
-- says nobody, and only someone with Full changes it.
--
-- A sent invoice's lines are frozen, and this is the one change made to them,
-- saying who already added each. It is not a save, so it neither counts as one
-- nor appears in a line's history.
ALTER TABLE "invoice_line" DISABLE TRIGGER "freeze_lines";--> statement-breakpoint
ALTER TABLE "invoice_line" DISABLE TRIGGER "v_invoice_line";--> statement-breakpoint
ALTER TABLE "invoice_line" DISABLE TRIGGER "h_invoice_line";--> statement-breakpoint
UPDATE "invoice_line" l SET "created_by" = a."changed_by"
  FROM (SELECT DISTINCT ON ("row_id") "row_id", "changed_by"
          FROM "record_history"
         WHERE "table_name" = 'invoice_line' AND "field" = '(added)'
         ORDER BY "row_id", "changed_at" DESC, "id" DESC) a
 WHERE a."row_id" = l."id" AND a."changed_by" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_line" ENABLE TRIGGER "freeze_lines";--> statement-breakpoint
ALTER TABLE "invoice_line" ENABLE TRIGGER "v_invoice_line";--> statement-breakpoint
ALTER TABLE "invoice_line" ENABLE TRIGGER "h_invoice_line";
