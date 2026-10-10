-- A TRIP NAMES ITS VEHICLE, AND ITS MILES PAY THE VEHICLE'S OWNER. A vehicle
-- rule was stored and shown, and paid nobody: a trip did not say what it was
-- driven in, so there was no owner to pay. A vehicle is a person's or the
-- business's, and the business's pays nobody, whoever drove it. A trip already
-- recorded names none, and its miles pay nobody.
CREATE TABLE "vehicle" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"owner_id" uuid,
	"retired_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_name_is_something" CHECK (btrim("vehicle"."name") <> '')
);
--> statement-breakpoint
ALTER TABLE "trip" ADD COLUMN "vehicle_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_rule" ADD CONSTRAINT "pay_rule_vehicle_is_not_by_the_hour" CHECK (("pay_rule"."pays_for" <> 'vehicle') OR ("pay_rule"."method" <> 'per_hour'));
--> statement-breakpoint
-- Whose a vehicle is never changes. One that changes hands is retired and added
-- again under its new owner, so the trips already driven in it pay who they paid.
CREATE FUNCTION vehicle_keeps_its_owner() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'vehicle % is %''s: one that changes hands is retired and added again',
    OLD.id, coalesce(OLD.owner_id::text, 'the business')
    USING ERRCODE = 'integrity_constraint_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER vehicle_keeps_its_owner BEFORE UPDATE OF owner_id ON vehicle FOR EACH ROW
  WHEN (OLD.owner_id IS DISTINCT FROM NEW.owner_id) EXECUTE FUNCTION vehicle_keeps_its_owner();
