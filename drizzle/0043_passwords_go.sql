-- PASSWORDS GO (#lib/server/passkeys). Everyone signs in with a passkey, made
-- with a link: an invitation, or a new one for someone who has lost their way
-- in. So the password itself goes, and all that kept it: every password, and
-- account.password held empty from now on; the record of every try at one and
-- the limits drawn from it (sign_in_try); the asks for a forgotten one
-- (recovery_ask) and their 'recover' links; when one was set or stopped, and
-- whether it was handed over. Every link reckon emails now lasts an hour.
ALTER TABLE "recovery_ask" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sign_in_try" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "recovery_ask" CASCADE;--> statement-breakpoint
DROP TABLE "sign_in_try" CASCADE;--> statement-breakpoint
ALTER TABLE "email_link" DROP CONSTRAINT "email_link_lasts_a_day_at_most";--> statement-breakpoint
ALTER TABLE "email_link" DROP CONSTRAINT "email_link_recovery_lasts_an_hour_at_most";--> statement-breakpoint
ALTER TABLE "email_link" DROP CONSTRAINT "email_link_purpose_check";--> statement-breakpoint
ALTER TABLE "email_message" DROP CONSTRAINT "email_message_kind_check";--> statement-breakpoint
-- What only a password needed goes with it: every password, the links that
-- set or recovered one, and the emails about one. A link from before lasted a
-- day, which the hour now refuses.
DELETE FROM "account" WHERE "provider_id" = 'credential' OR "password" IS NOT NULL;--> statement-breakpoint
DELETE FROM "email_link" WHERE "purpose" = 'recover' OR "expires_at" > "created_at" + interval '1 hour';--> statement-breakpoint
DELETE FROM "email_message" WHERE "kind" IN ('password_changed', 'password_reset', 'password_recovery', 'password_recovery_unconfirmed', 'password_breached', 'password_breached_unconfirmed');--> statement-breakpoint
UPDATE "email_message" SET "kind" = 'passkey_link' WHERE "kind" = 'password_reset_link';--> statement-breakpoint
DROP INDEX "email_link_one_password_link_waiting";--> statement-breakpoint
DROP INDEX "email_link_one_recovery_waiting";--> statement-breakpoint
CREATE UNIQUE INDEX "email_link_one_passkey_link_waiting" ON "email_link" USING btree ("user_id") WHERE "email_link"."used_at" is null and "email_link"."purpose" in ('invite', 'reset');--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "temporary_password";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "password_set_at";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "password_stopped_at";--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_holds_no_password" CHECK ("account"."password" is null);--> statement-breakpoint
ALTER TABLE "email_link" ADD CONSTRAINT "email_link_lasts_an_hour_at_most" CHECK ("email_link"."expires_at" > "email_link"."created_at" and "email_link"."expires_at" <= "email_link"."created_at" + interval '1 hour');--> statement-breakpoint
ALTER TABLE "email_link" ADD CONSTRAINT "email_link_purpose_check" CHECK ("email_link"."purpose" = ANY (ARRAY['invite', 'reset', 'confirm', 'change']));--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_kind_check" CHECK ("email_message"."kind" = ANY (ARRAY['invitation', 'passkey_link', 'email_confirmation', 'email_change', 'email_changing', 'passkey_added', 'passkey_removed', 'passkeys_ended']));