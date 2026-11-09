-- RECKON SENDS EMAIL (#lib/server/email), by SMTP to the relay SMTP_URL
-- names. Each message is a row here, written in the same transaction as the
-- change it tells of, so it is sent if and only if that change is kept, and
-- sent afterwards by the server, tried again when the relay says to. What it
-- said is kept until it is sent or given up on; a row is deleted after 90
-- days. The first it sends tell someone their password was changed or reset.
CREATE TABLE "email_message" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid,
	"to_address" text NOT NULL,
	"subject" text NOT NULL,
	"body" text,
	"send_by" timestamp with time zone NOT NULL,
	"next_try_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tries" smallint DEFAULT 0 NOT NULL,
	"claimed_until" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"gave_up_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "email_message_kind_check" CHECK ("email_message"."kind" = ANY (ARRAY['password_changed', 'password_reset'])),
	CONSTRAINT "email_message_to_lowercase" CHECK ("email_message"."to_address" = lower("email_message"."to_address")),
	CONSTRAINT "email_message_subject_is_something" CHECK (btrim("email_message"."subject") <> ''),
	CONSTRAINT "email_message_tries_check" CHECK ("email_message"."tries" >= 0),
	CONSTRAINT "email_message_sent_or_given_up" CHECK ("email_message"."sent_at" is null or "email_message"."gave_up_at" is null),
	CONSTRAINT "email_message_body_while_waiting" CHECK (("email_message"."sent_at" is null and "email_message"."gave_up_at" is null) = ("email_message"."body" is not null))
);
--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_message_due" ON "email_message" USING btree ("next_try_at") WHERE "email_message"."sent_at" is null and "email_message"."gave_up_at" is null;--> statement-breakpoint
CREATE INDEX "email_message_by_time" ON "email_message" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "email_message_by_user" ON "email_message" USING btree ("user_id","created_at");
