-- A PERSON IS INVITED BY EMAIL (#lib/server/links): adding someone on Team
-- emails them a link to choose their own password, and a reset there emails a
-- link to choose a new one, in place of a password handed over. A link is good
-- once, for 24 hours at most, and only its code's SHA-256 is kept. Using one
-- proves the person reads mail at the address it went to (user.email_verified),
-- which anyone can also confirm from Your profile. Every code tried that was
-- not one to use is counted against the network it came from, a day.
CREATE TABLE "email_link" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"sent_to" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"sent_by" uuid,
	CONSTRAINT "email_link_code_hash_key" UNIQUE("code_hash"),
	CONSTRAINT "email_link_code_hash_is_a_sha256" CHECK (octet_length("email_link"."code_hash") = 32),
	CONSTRAINT "email_link_purpose_check" CHECK ("email_link"."purpose" = ANY (ARRAY['invite', 'reset', 'confirm'])),
	CONSTRAINT "email_link_sent_to_lowercase" CHECK ("email_link"."sent_to" = lower("email_link"."sent_to")),
	CONSTRAINT "email_link_lasts_a_day_at_most" CHECK ("email_link"."expires_at" > "email_link"."created_at" and "email_link"."expires_at" <= "email_link"."created_at" + interval '24 hours'),
	CONSTRAINT "email_link_used_while_it_worked" CHECK ("email_link"."used_at" is null or "email_link"."used_at" between "email_link"."created_at" and "email_link"."expires_at")
);
--> statement-breakpoint
CREATE TABLE "link_try" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"address" "inet" NOT NULL,
	"network" "cidr" NOT NULL,
	CONSTRAINT "link_try_address_in_network" CHECK ("link_try"."address" <<= "link_try"."network")
);
--> statement-breakpoint
ALTER TABLE "email_message" DROP CONSTRAINT "email_message_kind_check";--> statement-breakpoint
ALTER TABLE "email_link" ADD CONSTRAINT "email_link_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_link" ADD CONSTRAINT "email_link_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_link_one_password_link_waiting" ON "email_link" USING btree ("user_id") WHERE "email_link"."used_at" is null and "email_link"."purpose" in ('invite', 'reset');--> statement-breakpoint
CREATE UNIQUE INDEX "email_link_one_confirmation_waiting" ON "email_link" USING btree ("user_id") WHERE "email_link"."used_at" is null and "email_link"."purpose" = 'confirm';--> statement-breakpoint
CREATE INDEX "email_link_by_user" ON "email_link" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "link_try_by_network" ON "link_try" USING btree ("network","created_at");--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_kind_check" CHECK ("email_message"."kind" = ANY (ARRAY['password_changed', 'password_reset', 'invitation', 'password_reset_link', 'email_confirmation']));