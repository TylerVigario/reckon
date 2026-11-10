-- FORGOT PASSWORD EMAILS A LINK (#lib/server/recovery): whoever forgot theirs
-- asks on the sign-in page, and a confirmed address is sent a link to choose a
-- new password, good once for an hour, which changes nothing until it is
-- used. Every ask is kept a day, by network and by an HMAC of the email, so a
-- network asking too often waits and an address is sent one every few minutes.
CREATE TABLE "recovery_ask" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"address" "inet" NOT NULL,
	"network" "cidr" NOT NULL,
	"email_key" text NOT NULL,
	CONSTRAINT "recovery_ask_address_in_network" CHECK ("recovery_ask"."address" <<= "recovery_ask"."network")
);
--> statement-breakpoint
ALTER TABLE "email_link" DROP CONSTRAINT "email_link_purpose_check";--> statement-breakpoint
ALTER TABLE "email_message" DROP CONSTRAINT "email_message_kind_check";--> statement-breakpoint
CREATE INDEX "recovery_ask_by_network" ON "recovery_ask" USING btree ("network","created_at");--> statement-breakpoint
CREATE INDEX "recovery_ask_by_email" ON "recovery_ask" USING btree ("email_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_link_one_recovery_waiting" ON "email_link" USING btree ("user_id") WHERE "email_link"."used_at" is null and "email_link"."purpose" = 'recover';--> statement-breakpoint
ALTER TABLE "email_link" ADD CONSTRAINT "email_link_recovery_lasts_an_hour_at_most" CHECK ("email_link"."purpose" <> 'recover' or "email_link"."expires_at" <= "email_link"."created_at" + interval '1 hour');--> statement-breakpoint
ALTER TABLE "email_link" ADD CONSTRAINT "email_link_purpose_check" CHECK ("email_link"."purpose" = ANY (ARRAY['invite', 'reset', 'confirm', 'change', 'recover']));--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_kind_check" CHECK ("email_message"."kind" = ANY (ARRAY['password_changed', 'password_reset', 'invitation', 'password_reset_link', 'email_confirmation', 'email_change', 'email_changing', 'password_recovery', 'password_recovery_unconfirmed']));