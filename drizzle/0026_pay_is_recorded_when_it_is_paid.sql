-- PAY IS RECORDED WHEN IT IS PAID. Pay was worked out live, so a role change or
-- a new rule moved what past work was said to pay. A payment to a person now
-- keeps the work it covered, each with the figure it came to that day and how,
-- in words; a piece of work is paid to a person once. reckon records it; the
-- money moves at the bank.
CREATE TABLE "person_payment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"how" text NOT NULL,
	"note" text,
	"client_uuid" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_payment_client_uuid_key" UNIQUE("client_uuid"),
	CONSTRAINT "person_payment_id_user_id_key" UNIQUE("id","user_id"),
	CONSTRAINT "person_payment_how_is_something" CHECK (btrim("person_payment"."how") <> '')
);
--> statement-breakpoint
CREATE TABLE "person_payment_item" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"payment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"time_entry_id" uuid,
	"trip_id" uuid,
	"corrects_payment_id" uuid,
	"amount" numeric(13, 3) NOT NULL,
	"said" text NOT NULL,
	CONSTRAINT "person_payment_item_is_one_thing" CHECK (num_nonnulls("person_payment_item"."time_entry_id", "person_payment_item"."trip_id", "person_payment_item"."corrects_payment_id") = 1),
	CONSTRAINT "person_payment_item_pays" CHECK (("person_payment_item"."amount" >= 0) OR ("person_payment_item"."corrects_payment_id" IS NOT NULL)),
	CONSTRAINT "person_payment_item_says_how" CHECK (btrim("person_payment_item"."said") <> ''),
	CONSTRAINT "person_payment_item_corrects_another" CHECK ("person_payment_item"."corrects_payment_id" IS DISTINCT FROM "person_payment_item"."payment_id")
);
--> statement-breakpoint
ALTER TABLE "person_payment" ADD CONSTRAINT "person_payment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_payment" ADD CONSTRAINT "person_payment_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_payment_item" ADD CONSTRAINT "person_payment_item_payment_is_the_persons" FOREIGN KEY ("payment_id","user_id") REFERENCES "public"."person_payment"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_payment_item" ADD CONSTRAINT "person_payment_item_time_entry_id_fkey" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_payment_item" ADD CONSTRAINT "person_payment_item_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_payment_item" ADD CONSTRAINT "person_payment_item_corrects_is_the_persons" FOREIGN KEY ("corrects_payment_id","user_id") REFERENCES "public"."person_payment"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_payment_by_person" ON "person_payment" USING btree ("user_id","paid_on");--> statement-breakpoint
CREATE UNIQUE INDEX "person_payment_item_entry_once" ON "person_payment_item" USING btree ("user_id","time_entry_id") WHERE "person_payment_item"."time_entry_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "person_payment_item_trip_once" ON "person_payment_item" USING btree ("user_id","trip_id") WHERE "person_payment_item"."trip_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "person_payment_item_payment" ON "person_payment_item" USING btree ("payment_id");
--> statement-breakpoint
-- A payment is never changed once recorded: a correction is an item on the next
-- one, saying which it corrects.
CREATE FUNCTION a_payment_stands() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'a payment is not changed once recorded: correct it on the next payment'
    USING ERRCODE = 'integrity_constraint_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER a_payment_stands BEFORE UPDATE OR DELETE ON person_payment
  FOR EACH ROW EXECUTE FUNCTION a_payment_stands();
--> statement-breakpoint
CREATE TRIGGER a_payment_stands BEFORE UPDATE OR DELETE ON person_payment_item
  FOR EACH ROW EXECUTE FUNCTION a_payment_stands();
