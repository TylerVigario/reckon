-- EMAILS ARE HTML BESIDE THEIR TEXT (#lib/server/email-layout): each message
-- keeps its HTML with its plain text until it is sent or given up on, and
-- never without the text.
ALTER TABLE "email_message" ADD COLUMN "html" text;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_html_beside_its_text" CHECK ("email_message"."html" is null or "email_message"."body" is not null);