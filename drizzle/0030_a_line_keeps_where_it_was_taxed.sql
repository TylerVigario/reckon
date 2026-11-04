-- A LINE KEEPS WHERE IT WAS TAXED. A line kept the rate it was taxed at, and
-- nothing about where: Schedule A grouped each period's lines by their site's
-- area as it is now, at the site's rate as it is now, and left out a site no
-- longer in use. A refreshed rate or an address chosen again changed a period
-- already filed. A taxed line now keeps its site's area, and where the rate is
-- the site's, the state's and districts' shares of it, read with the rate.
ALTER TABLE "invoice_line" ADD COLUMN "tax_jurisdiction" text;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "state_rate_pct" numeric(7, 4);--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "district_rate_pct" numeric(7, 4);--> statement-breakpoint
-- Each taxed line at a site takes the answer CDTFA gave about the site that it
-- was priced from: one at the line's rate, the newest asked by the day its
-- invoice went out -- today, for a draft -- or failing that the earliest asked
-- since, or failing every answer the site's own figures. Where nothing CDTFA
-- said is at the line's rate, or the rate was not the site's, it takes the area
-- in force on that day and no shares, since what its rate was made of is not
-- known.
--
-- A sent invoice's lines are frozen, and this is the one change made to them:
-- saying, of each, where it was already taxed. It is not a save, so it neither
-- counts as one nor appears in a line's history.
ALTER TABLE "invoice_line" DISABLE TRIGGER "freeze_lines";--> statement-breakpoint
ALTER TABLE "invoice_line" DISABLE TRIGGER "v_invoice_line";--> statement-breakpoint
ALTER TABLE "invoice_line" DISABLE TRIGGER "h_invoice_line";--> statement-breakpoint
WITH "answer" AS (
  SELECT l."id" AS "line_id",
         l."tax_source" = 'site' AND a."rate_pct" = l."tax_rate_pct" AS "own", a.*
    FROM "invoice_line" l
    JOIN "invoice" i ON i."id" = l."invoice_id"
   CROSS JOIN LATERAL (
     SELECT c."tax_jurisdiction", c."rate_pct", c."state_rate_pct", c."district_rate_pct"
       FROM (SELECT "tax_jurisdiction", "rate_pct", "state_rate_pct", "district_rate_pct",
                    "checked_at",
                    ("checked_at" AT TIME ZONE coalesce((SELECT "timezone" FROM "operator" LIMIT 1), 'UTC'))::date AS "checked_on"
               FROM "site_tax_check"
              WHERE "site_id" = l."site_id"
                AND "tax_jurisdiction" IS NOT NULL AND "rate_pct" IS NOT NULL
             UNION ALL
             SELECT "tax_jurisdiction", "tax_rate_pct", "state_rate_pct", "district_rate_pct", NULL, NULL
               FROM "site" WHERE "id" = l."site_id") c
      ORDER BY c."rate_pct" = l."tax_rate_pct" DESC,
               CASE WHEN c."checked_on" IS NULL THEN 2
                    WHEN c."checked_on" <= coalesce(i."issued_on", current_date) THEN 0
                    ELSE 1 END,
               CASE WHEN c."checked_on" <= coalesce(i."issued_on", current_date)
                    THEN c."checked_at" END DESC NULLS LAST,
               c."checked_at"
      LIMIT 1) a
   WHERE l."taxable"
)
UPDATE "invoice_line" l
   SET "tax_jurisdiction" = a."tax_jurisdiction",
       "state_rate_pct" = CASE WHEN a."own" THEN a."state_rate_pct" END,
       "district_rate_pct" = CASE WHEN a."own" THEN a."district_rate_pct" END
  FROM "answer" a
 WHERE a."line_id" = l."id";--> statement-breakpoint
ALTER TABLE "invoice_line" ENABLE TRIGGER "h_invoice_line";--> statement-breakpoint
ALTER TABLE "invoice_line" ENABLE TRIGGER "v_invoice_line";--> statement-breakpoint
ALTER TABLE "invoice_line" ENABLE TRIGGER "freeze_lines";--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "taxed_lines_say_where" CHECK (("invoice_line"."taxable" AND ("invoice_line"."site_id" IS NOT NULL)) = ("invoice_line"."tax_jurisdiction" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "rate_shares_make_the_rate" CHECK ((("invoice_line"."state_rate_pct" IS NULL) AND ("invoice_line"."district_rate_pct" IS NULL)) OR (("invoice_line"."tax_source" = 'site') AND ("invoice_line"."state_rate_pct" IS NOT NULL) AND ("invoice_line"."district_rate_pct" IS NOT NULL) AND (("invoice_line"."state_rate_pct" + "invoice_line"."district_rate_pct") = "invoice_line"."tax_rate_pct")));--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_state_rate_pct_check" CHECK ("invoice_line"."state_rate_pct" >= 0);--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_district_rate_pct_check" CHECK ("invoice_line"."district_rate_pct" >= 0);
