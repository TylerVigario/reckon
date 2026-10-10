CREATE TABLE "unit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"short" text,
	"places" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_name_key" UNIQUE("name"),
	CONSTRAINT "unit_name_is_something" CHECK (btrim("unit"."name") <> ''),
	CONSTRAINT "unit_places_check" CHECK ("unit"."places" BETWEEN 0 AND 4)
);
--> statement-breakpoint
ALTER TABLE "material" ADD COLUMN "unit_id" uuid;--> statement-breakpoint
ALTER TABLE "material" ADD CONSTRAINT "material_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- The two units every material was counted in until the list was the
-- operator's: each, in whole numbers, and the foot, to two places.
INSERT INTO "unit" ("name", "short", "places") VALUES ('each', NULL, 0), ('foot', 'ft', 2);--> statement-breakpoint
UPDATE "material" SET "unit_id" = (SELECT "id" FROM "unit" WHERE "unit"."name" = "material"."unit");
