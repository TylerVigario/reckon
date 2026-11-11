-- PASSKEYS SIGN PEOPLE IN (#lib/server/passkeys). A passkey is a key pair kept
-- on someone's phone, computer or security key; only its public half is here,
-- in Better Auth's passkey plugin's own columns, with reckon's last_used_at.
-- One credential is one passkey, which the plugin does not ask for itself.
CREATE TABLE "passkey" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"aaguid" text,
	"last_used_at" timestamp with time zone,
	"last_used_from" text,
	CONSTRAINT "passkey_credential_id_key" UNIQUE("credential_id"),
	CONSTRAINT "passkey_device_type_check" CHECK ("passkey"."device_type" = ANY (ARRAY['singleDevice', 'multiDevice'])),
	CONSTRAINT "passkey_counter_not_negative" CHECK ("passkey"."counter" >= 0)
);
--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passkey_by_user" ON "passkey" USING btree ("user_id");