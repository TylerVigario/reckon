-- A CHANGED ADDRESS WAITS UNTIL IT IS PROVEN (#lib/server/links): a new address
-- asked for on Team, for someone who has signed in, is emailed a link, and
-- becomes the one they sign in with only when it is used -- one change waiting
-- at a time. The old address is told when the change is asked for.
ALTER TABLE "email_link" DROP CONSTRAINT "email_link_purpose_check";--> statement-breakpoint
ALTER TABLE "email_message" DROP CONSTRAINT "email_message_kind_check";--> statement-breakpoint
CREATE UNIQUE INDEX "email_link_one_change_waiting" ON "email_link" USING btree ("user_id") WHERE "email_link"."used_at" is null and "email_link"."purpose" = 'change';--> statement-breakpoint
ALTER TABLE "email_link" ADD CONSTRAINT "email_link_purpose_check" CHECK ("email_link"."purpose" = ANY (ARRAY['invite', 'reset', 'confirm', 'change']));--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_kind_check" CHECK ("email_message"."kind" = ANY (ARRAY['password_changed', 'password_reset', 'invitation', 'password_reset_link', 'email_confirmation', 'email_change', 'email_changing']));