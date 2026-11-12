CREATE TABLE "security_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"user_id" uuid,
	"by_id" uuid,
	"client_address" "inet",
	"user_agent" text,
	"detail" jsonb,
	CONSTRAINT "security_event_name_check" CHECK ("security_event"."name" = ANY (ARRAY['authn_login_success', 'authn_login_fail', 'excess_rate_limit_exceeded', 'session_logout', 'session_expired', 'authn_passkey_added', 'authn_passkey_removed', 'authn_link_issued', 'authn_link_used', 'authn_link_refused', 'user_created', 'user_updated', 'authz_change', 'user_archived', 'user_restored', 'authz_fail'])),
	CONSTRAINT "security_event_user_agent_bounded" CHECK (length("security_event"."user_agent") <= 512),
	CONSTRAINT "security_event_by_someone_else" CHECK ("security_event"."by_id" is null or "security_event"."by_id" <> "security_event"."user_id")
);
--> statement-breakpoint
ALTER TABLE "security_event" ADD CONSTRAINT "security_event_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_event" ADD CONSTRAINT "security_event_by_id_fkey" FOREIGN KEY ("by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "security_event_by_user" ON "security_event" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "security_event_by_whom" ON "security_event" USING btree ("by_id","at");--> statement-breakpoint
CREATE INDEX "security_event_by_when" ON "security_event" USING btree ("at");