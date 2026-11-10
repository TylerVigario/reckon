-- A PASSWORD SEEN IN A BREACH STOPS (#lib/server/breach). Every rule is held to
-- when a password is chosen (#lib/server/password-rules); a sign-in, the one
-- other moment it is in hand, asks Pwned Passwords again. One it has seen by
-- then stops there, like one tried wrong a hundred times in a row: the try is
-- recorded as breached, no session opens, every one they had ends, and they
-- are emailed the hour's link to choose another -- or, to an address not
-- confirmed theirs, told so without one.
ALTER TABLE "sign_in_try" DROP CONSTRAINT "sign_in_try_outcome_check";--> statement-breakpoint
ALTER TABLE "email_message" DROP CONSTRAINT "email_message_kind_check";--> statement-breakpoint
ALTER TABLE "sign_in_try" ADD CONSTRAINT "sign_in_try_outcome_check" CHECK ("sign_in_try"."outcome" = ANY (ARRAY['right', 'wrong', 'inactive', 'stopped', 'breached']));--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_kind_check" CHECK ("email_message"."kind" = ANY (ARRAY['password_changed', 'password_reset', 'invitation', 'password_reset_link', 'email_confirmation', 'email_change', 'email_changing', 'password_recovery', 'password_recovery_unconfirmed', 'password_breached', 'password_breached_unconfirmed']));