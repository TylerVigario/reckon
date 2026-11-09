-- EVERY TRY AT A PASSWORD IS RECORDED (#lib/server/sign-in-limit), and the
-- limits are worked out from the record: five tries per address in fifteen
-- minutes, ten wrong in a row per email before each waits longer, a browser
-- that has signed in as someone keeping a count of its own, and a hundred
-- wrong in a row stopping the password until a new one is set. A row is
-- written for every email tried, whether or not anyone signs in with it, and
-- kept 90 days; the email itself is kept only as an HMAC.
--
-- Nobody's password was known to be set before now, and none has stopped, so
-- both start empty.
CREATE TABLE "sign_in_try" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"page" text NOT NULL,
	"address" "inet" NOT NULL,
	"network" "cidr" NOT NULL,
	"email_key" text NOT NULL,
	"user_id" uuid,
	"browser" text,
	"outcome" text,
	CONSTRAINT "sign_in_try_page_check" CHECK ("sign_in_try"."page" = ANY (ARRAY['sign_in', 'password_change'])),
	CONSTRAINT "sign_in_try_outcome_check" CHECK ("sign_in_try"."outcome" = ANY (ARRAY['right', 'wrong', 'inactive', 'stopped'])),
	CONSTRAINT "sign_in_try_address_in_network" CHECK ("sign_in_try"."address" <<= "sign_in_try"."network")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "password_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "password_stopped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sign_in_try" ADD CONSTRAINT "sign_in_try_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sign_in_try_by_network" ON "sign_in_try" USING btree ("network","created_at");--> statement-breakpoint
CREATE INDEX "sign_in_try_by_email" ON "sign_in_try" USING btree ("email_key","created_at");--> statement-breakpoint
CREATE INDEX "sign_in_try_by_user" ON "sign_in_try" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "sign_in_try_by_time" ON "sign_in_try" USING btree ("created_at");
