CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_name_key" UNIQUE("name"),
	CONSTRAINT "role_name_is_something" CHECK (btrim("role"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_key" UNIQUE("token"),
	CONSTRAINT "a_session_must_end" CHECK ("session"."expires_at" > "session"."created_at")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_key" UNIQUE("email"),
	CONSTRAINT "user_email_lowercase" CHECK ("user"."email" = lower("user"."email"))
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "entity" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"terms_days" integer,
	"payment_method" text,
	"tax_exempt" boolean DEFAULT false NOT NULL,
	"exemption_certificate" text,
	"exemption_expires_on" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"slug" text NOT NULL,
	CONSTRAINT "entity_slug_key" UNIQUE("slug"),
	CONSTRAINT "entity_slug_is_a_slug" CHECK ("entity"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "entity_terms_days_check" CHECK ("entity"."terms_days" >= 0),
	CONSTRAINT "exemption_needs_certificate" CHECK ((NOT "entity"."tax_exempt") OR ("entity"."exemption_certificate" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "entity_contact" (
	"entity_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "entity_contact_pkey" PRIMARY KEY("entity_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "site" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"entity_id" uuid NOT NULL,
	"label" text NOT NULL,
	"street" text NOT NULL,
	"city" text NOT NULL,
	"region" text,
	"postcode" text NOT NULL,
	"google_place_id" text,
	"address_verified_on" date,
	"area_verified_on" date NOT NULL,
	"round_trip_miles" numeric(8, 1),
	"drive_minutes" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"display" text GENERATED ALWAYS AS (CASE
    WHEN ((city IS NULL) OR (city = ''::text)) THEN label
    WHEN (POSITION((lower(city)) IN (lower(label))) > 0) THEN label
    WHEN (POSITION((lower(label)) IN (lower(city))) > 0) THEN label
    ELSE ((label || ', '::text) || city)
END) STORED,
	"tax_area_code" text NOT NULL,
	"tax_rate_pct" numeric(7, 4) NOT NULL,
	"tax_jurisdiction" text NOT NULL,
	"state_rate_pct" numeric(7, 4) NOT NULL,
	"district_rate_pct" numeric(7, 4) NOT NULL,
	"slug" text NOT NULL,
	CONSTRAINT "site_belongs_to_one_client" UNIQUE("id","entity_id"),
	CONSTRAINT "site_entity_id_label_key" UNIQUE("entity_id","label"),
	CONSTRAINT "site_slug_is_the_clients" UNIQUE("entity_id","slug"),
	CONSTRAINT "site_address_is_complete" CHECK (("site"."street" <> '') AND ("site"."city" <> '') AND ("site"."postcode" <> '')),
	CONSTRAINT "site_district_rate_pct_check" CHECK ("site"."district_rate_pct" >= 0),
	CONSTRAINT "site_drive_minutes_check" CHECK ("site"."drive_minutes" >= 0),
	CONSTRAINT "site_rate_parts_sum_to_the_rate" CHECK (("site"."state_rate_pct" + "site"."district_rate_pct") = "site"."tax_rate_pct"),
	CONSTRAINT "site_round_trip_miles_check" CHECK ("site"."round_trip_miles" >= 0),
	CONSTRAINT "site_slug_is_a_slug" CHECK ("site"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "site_state_rate_pct_check" CHECK ("site"."state_rate_pct" >= 0),
	CONSTRAINT "site_verified_rate_pct_check" CHECK ("site"."tax_rate_pct" >= 0)
);
--> statement-breakpoint
CREATE TABLE "site_contact" (
	"site_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "site_contact_pkey" PRIMARY KEY("site_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "site_tax_check" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"site_id" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tax_area_code" text,
	"tax_jurisdiction" text,
	"rate_pct" numeric(7, 4),
	"changed" boolean DEFAULT false NOT NULL,
	"note" text,
	"state_rate_pct" numeric(7, 4),
	"district_rate_pct" numeric(7, 4),
	CONSTRAINT "site_tax_check_rate_pct_check" CHECK ("site_tax_check"."rate_pct" >= 0)
);
--> statement-breakpoint
CREATE TABLE "material" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sku" text,
	"name" text NOT NULL,
	"brand" text,
	"unit" text NOT NULL,
	"markup_pct" numeric(7, 4),
	"taxable" boolean DEFAULT true NOT NULL,
	"reorder_level" numeric(12, 4),
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "material_sku_key" UNIQUE("sku"),
	CONSTRAINT "material_markup_pct_check" CHECK ("material"."markup_pct" >= 0),
	CONSTRAINT "material_reorder_level_check" CHECK ("material"."reorder_level" >= 0),
	CONSTRAINT "material_unit_check" CHECK ("material"."unit" = ANY (ARRAY['each', 'foot']))
);
--> statement-breakpoint
CREATE TABLE "material_lot" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"material_id" uuid NOT NULL,
	"received_on" date NOT NULL,
	"supplier" text,
	"document_ref" text,
	"qty_received" numeric(12, 4) NOT NULL,
	"qty_remaining" numeric(12, 4) NOT NULL,
	"ex_tax_cost_per_unit" numeric(12, 4) NOT NULL,
	"tax_paid_per_unit" numeric(12, 4) DEFAULT '0' NOT NULL,
	CONSTRAINT "cannot_use_more_than_received" CHECK ("material_lot"."qty_remaining" <= "material_lot"."qty_received"),
	CONSTRAINT "material_lot_ex_tax_cost_per_unit_check" CHECK ("material_lot"."ex_tax_cost_per_unit" >= 0),
	CONSTRAINT "material_lot_qty_received_check" CHECK ("material_lot"."qty_received" > 0),
	CONSTRAINT "material_lot_qty_remaining_check" CHECK ("material_lot"."qty_remaining" >= 0),
	CONSTRAINT "material_lot_tax_paid_per_unit_check" CHECK ("material_lot"."tax_paid_per_unit" >= 0)
);
--> statement-breakpoint
CREATE TABLE "material_price" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"material_id" uuid NOT NULL,
	"price" numeric(12, 4) NOT NULL,
	"effective_from" date NOT NULL,
	CONSTRAINT "material_price_material_id_effective_from_key" UNIQUE("material_id","effective_from"),
	CONSTRAINT "material_price_price_check" CHECK ("material_price"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pay_rule" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"service_id" uuid NOT NULL,
	"role_id" uuid,
	"user_id" uuid,
	"entity_id" uuid,
	"pays_for" text NOT NULL,
	"method" text NOT NULL,
	"amount" numeric(12, 4),
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_rule_scope" UNIQUE NULLS NOT DISTINCT("service_id","role_id","user_id","entity_id","pays_for","effective_from"),
	CONSTRAINT "pay_rule_amount_fits_method" CHECK ((("pay_rule"."method" = 'nothing') AND ("pay_rule"."amount" IS NULL)) OR (("pay_rule"."method" = 'percent') AND ("pay_rule"."amount" IS NOT NULL) AND ("pay_rule"."amount" >= 0) AND ("pay_rule"."amount" <= 100)) OR (("pay_rule"."method" = ANY (ARRAY['per_hour', 'fixed'])) AND ("pay_rule"."amount" IS NOT NULL) AND ("pay_rule"."amount" >= 0))),
	CONSTRAINT "pay_rule_covered_time_is_a_share" CHECK (("pay_rule"."pays_for" <> 'covered_time') OR ("pay_rule"."method" = ANY (ARRAY['percent', 'nothing']))),
	CONSTRAINT "pay_rule_method_check" CHECK ("pay_rule"."method" = ANY (ARRAY['per_hour', 'percent', 'fixed', 'nothing'])),
	CONSTRAINT "pay_rule_names_one_payee" CHECK (num_nonnulls("pay_rule"."role_id", "pay_rule"."user_id") = 1),
	CONSTRAINT "pay_rule_pays_for_check" CHECK ("pay_rule"."pays_for" = ANY (ARRAY['time', 'covered_time', 'vehicle']))
);
--> statement-breakpoint
CREATE TABLE "service" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"taxable" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"time_tracked" boolean DEFAULT true NOT NULL,
	"bill_to_nearest_seconds" integer,
	"minimum_charge" numeric(12, 2),
	CONSTRAINT "service_code_key" UNIQUE("code"),
	CONSTRAINT "service_bill_to_nearest_seconds_check" CHECK ("service"."bill_to_nearest_seconds" > 0),
	CONSTRAINT "service_increment_is_for_time" CHECK (("service"."unit" = 'hour') OR ("service"."bill_to_nearest_seconds" IS NULL)),
	CONSTRAINT "service_minimum_charge_check" CHECK ("service"."minimum_charge" >= 0),
	CONSTRAINT "service_unit_check" CHECK ("service"."unit" = ANY (ARRAY['hour', 'mile', 'each']))
);
--> statement-breakpoint
CREATE TABLE "service_price" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"service_id" uuid NOT NULL,
	"entity_id" uuid,
	"rate" numeric(12, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"additional_rate" numeric(12, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "service_price_scope" UNIQUE NULLS NOT DISTINCT("service_id","entity_id","effective_from"),
	CONSTRAINT "service_price_additional_rate_check" CHECK ("service_price"."additional_rate" >= 0),
	CONSTRAINT "service_price_rate_check" CHECK ("service_price"."rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "time_entry" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"client_uuid" uuid NOT NULL,
	"worked_on" date NOT NULL,
	"minutes" integer NOT NULL,
	"worked_by" uuid,
	"created_by" uuid NOT NULL,
	"entity_id" uuid,
	"service_id" uuid NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"crew" text NOT NULL,
	"site_id" uuid,
	CONSTRAINT "time_entry_client_uuid_key" UNIQUE("client_uuid"),
	CONSTRAINT "billable_work_has_a_payer" CHECK ((NOT "time_entry"."billable") OR ("time_entry"."entity_id" IS NOT NULL)),
	CONSTRAINT "crew_says_who_worked_it" CHECK ((("time_entry"."crew" = 'one') AND ("time_entry"."worked_by" IS NOT NULL)) OR (("time_entry"."crew" = 'team') AND ("time_entry"."worked_by" IS NULL))),
	CONSTRAINT "time_entry_crew_check" CHECK ("time_entry"."crew" = ANY (ARRAY['one', 'team'])),
	CONSTRAINT "time_entry_minutes_check" CHECK ("time_entry"."minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "trip" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"travelled_on" date NOT NULL,
	"driven_by" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_leg" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"trip_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"miles" numeric(9, 2) NOT NULL,
	"entity_id" uuid,
	"rule" text,
	"site_id" uuid,
	"service_id" uuid,
	CONSTRAINT "trip_leg_trip_id_seq_key" UNIQUE("trip_id","seq"),
	CONSTRAINT "trip_leg_billed_leg_names_its_service" CHECK (("trip_leg"."entity_id" IS NULL) OR ("trip_leg"."service_id" IS NOT NULL)),
	CONSTRAINT "trip_leg_miles_check" CHECK ("trip_leg"."miles" >= 0),
	CONSTRAINT "trip_leg_rule_check" CHECK ("trip_leg"."rule" = ANY (ARRAY['house_to_a', 'a_to_b', 'b_to_house', 'round_trip', 'split', 'unassigned']))
);
--> statement-breakpoint
CREATE TABLE "trip_stop" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"trip_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"address" text,
	"arrived_at" timestamp with time zone,
	"departed_at" timestamp with time zone,
	"site_id" uuid,
	CONSTRAINT "trip_stop_trip_id_seq_key" UNIQUE("trip_id","seq")
);
--> statement-breakpoint
CREATE TABLE "agreement" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"entity_id" uuid NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"contact_id" uuid,
	"billing_interval" text DEFAULT 'monthly' NOT NULL,
	"billing_anchor_day" smallint NOT NULL,
	"final_period_proration" text DEFAULT 'daily' NOT NULL,
	"site_id" uuid,
	CONSTRAINT "agreement_billing_anchor_day_check" CHECK (("agreement"."billing_anchor_day" >= 1) AND ("agreement"."billing_anchor_day" <= 31)),
	CONSTRAINT "agreement_billing_interval_check" CHECK ("agreement"."billing_interval" = ANY (ARRAY['weekly', 'monthly', 'quarterly', 'annually'])),
	CONSTRAINT "agreement_ends_after_it_starts" CHECK (("agreement"."ends_on" IS NULL) OR ("agreement"."ends_on" >= "agreement"."starts_on")),
	CONSTRAINT "agreement_final_period_proration_check" CHECK ("agreement"."final_period_proration" = ANY (ARRAY['none', 'daily'])),
	CONSTRAINT "agreement_price_check" CHECK ("agreement"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "agreement_period" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agreement_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"given" boolean DEFAULT false NOT NULL,
	CONSTRAINT "agreement_period_agreement_id_period_start_key" UNIQUE("agreement_id","period_start"),
	CONSTRAINT "agreement_period_amount_check" CHECK ("agreement_period"."amount" >= 0),
	CONSTRAINT "agreement_period_given_charges_nothing" CHECK ((NOT "agreement_period"."given") OR ("agreement_period"."amount" = 0)),
	CONSTRAINT "period_ends_after_it_starts" CHECK ("agreement_period"."period_end" >= "agreement_period"."period_start")
);
--> statement-breakpoint
CREATE TABLE "agreement_service" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agreement_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"allotment" text NOT NULL,
	"included_hours" numeric(8, 2),
	"overage" text,
	CONSTRAINT "agreement_service_once" UNIQUE("agreement_id","service_id"),
	CONSTRAINT "agreement_service_allotment_check" CHECK ("agreement_service"."allotment" = ANY (ARRAY['capped', 'unlimited'])),
	CONSTRAINT "agreement_service_cap_is_whole" CHECK ((("agreement_service"."allotment" = 'capped') AND ("agreement_service"."included_hours" IS NOT NULL) AND ("agreement_service"."overage" IS NOT NULL)) OR (("agreement_service"."allotment" = 'unlimited') AND ("agreement_service"."included_hours" IS NULL) AND ("agreement_service"."overage" IS NULL))),
	CONSTRAINT "agreement_service_included_hours_check" CHECK ("agreement_service"."included_hours" >= 0),
	CONSTRAINT "agreement_service_overage_check" CHECK ("agreement_service"."overage" = ANY (ARRAY['bill', 'no_charge', 'deny']))
);
--> statement-breakpoint
CREATE TABLE "credit_application" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"credit_note_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"applied_on" date NOT NULL,
	CONSTRAINT "credit_application_credit_note_id_invoice_id_key" UNIQUE("credit_note_id","invoice_id"),
	CONSTRAINT "credit_application_amount_check" CHECK ("credit_application"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "credit_note" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"issued_on" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_note_number_key" UNIQUE("number"),
	CONSTRAINT "credit_note_amount_check" CHECK ("credit_note"."amount" > 0),
	CONSTRAINT "credit_note_kind_check" CHECK ("credit_note"."kind" = ANY (ARRAY['reg1700b', 'correction', 'goodwill']))
);
--> statement-breakpoint
CREATE TABLE "invoice" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"issued_on" date,
	"due_on" date,
	"period_start" date,
	"period_end" date,
	"public_token" text,
	"token_expires_on" date,
	"sent_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_number_key" UNIQUE("number"),
	CONSTRAINT "invoice_public_token_key" UNIQUE("public_token"),
	CONSTRAINT "invoice_status_check" CHECK ("invoice"."status" = ANY (ARRAY['draft', 'sent', 'paid', 'void'])),
	CONSTRAINT "sent_invoices_have_dates" CHECK (("invoice"."status" = 'draft') OR (("invoice"."issued_on" IS NOT NULL) AND ("invoice"."due_on" IS NOT NULL))),
	CONSTRAINT "voiding_needs_a_reason" CHECK (("invoice"."status" <> 'void') OR ("invoice"."void_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "invoice_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"qty" numeric(12, 4) NOT NULL,
	"unit_price" numeric(12, 4) NOT NULL,
	"taxable" boolean DEFAULT false NOT NULL,
	"tax_rate_pct" numeric(7, 4) DEFAULT '0' NOT NULL,
	"tax_source" text DEFAULT 'none' NOT NULL,
	"tax_override_reason" text,
	"ex_tax_cost" numeric(12, 4),
	"tax_paid" numeric(12, 4),
	"amount" numeric(12, 2) NOT NULL,
	"time_entry_id" uuid,
	"trip_leg_id" uuid,
	"agreement_period_id" uuid,
	"material_lot_id" uuid,
	"unit" text,
	"site_id" uuid,
	CONSTRAINT "invoice_line_invoice_id_seq_key" UNIQUE("invoice_id","seq"),
	CONSTRAINT "invoice_line_time_entry_id_key" UNIQUE("time_entry_id"),
	CONSTRAINT "invoice_line_trip_leg_id_key" UNIQUE("trip_leg_id"),
	CONSTRAINT "invoice_line_agreement_period_id_key" UNIQUE("agreement_period_id"),
	CONSTRAINT "invoice_line_kind_check" CHECK ("invoice_line"."kind" = ANY (ARRAY['service', 'material', 'recurring', 'adjustment'])),
	CONSTRAINT "invoice_line_tax_rate_pct_check" CHECK ("invoice_line"."tax_rate_pct" >= 0),
	CONSTRAINT "invoice_line_tax_source_check" CHECK ("invoice_line"."tax_source" = ANY (ARRAY['none', 'site', 'override', 'exempt'])),
	CONSTRAINT "invoice_line_unit_check" CHECK ("invoice_line"."unit" = ANY (ARRAY['hour', 'mile', 'each', 'foot', 'month'])),
	CONSTRAINT "one_source_at_most" CHECK ((("invoice_line"."time_entry_id" IS NOT NULL)::integer + ("invoice_line"."trip_leg_id" IS NOT NULL)::integer + ("invoice_line"."agreement_period_id" IS NOT NULL)::integer + ("invoice_line"."material_lot_id" IS NOT NULL)::integer) <= 1),
	CONSTRAINT "override_needs_a_reason" CHECK (("invoice_line"."tax_source" <> 'override') OR ("invoice_line"."tax_override_reason" IS NOT NULL)),
	CONSTRAINT "untaxed_lines_carry_no_rate" CHECK ("invoice_line"."taxable" OR ("invoice_line"."tax_rate_pct" = 0))
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"entity_id" uuid NOT NULL,
	"received_on" date NOT NULL,
	"gross" numeric(12, 2) NOT NULL,
	"method" text NOT NULL,
	"processor_ref" text,
	"payout_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_gross_check" CHECK ("payment"."gross" > 0),
	CONSTRAINT "payment_method_check" CHECK ("payment"."method" = ANY (ARRAY['card', 'transfer', 'cheque', 'cash', 'other']))
);
--> statement-breakpoint
CREATE TABLE "payment_allocation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	CONSTRAINT "payment_allocation_payment_id_invoice_id_key" UNIQUE("payment_id","invoice_id"),
	CONSTRAINT "payment_allocation_amount_check" CHECK ("payment_allocation"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payout" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"processor" text NOT NULL,
	"arrived_on" date NOT NULL,
	"gross" numeric(12, 2) NOT NULL,
	"fees" numeric(12, 2) DEFAULT '0' NOT NULL,
	"net" numeric(12, 2) NOT NULL,
	"bank_reference" text,
	CONSTRAINT "payout_nets_out" CHECK ("payout"."net" = ("payout"."gross" - "payout"."fees"))
);
--> statement-breakpoint
CREATE TABLE "refund" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"refunded_on" date NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "refund_amount_check" CHECK ("refund"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "tax_remittance" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"filed_on" date,
	"paid_on" date,
	"amount" numeric(12, 2) NOT NULL,
	"reference" text,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "one_filing_per_period" UNIQUE("period_start","period_end"),
	CONSTRAINT "remittance_period_ends_after_it_starts" CHECK ("tax_remittance"."period_end" >= "tax_remittance"."period_start"),
	CONSTRAINT "tax_remittance_amount_check" CHECK ("tax_remittance"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "account_map" (
	"role" text NOT NULL,
	"account" text NOT NULL,
	CONSTRAINT "account_map_pkey" PRIMARY KEY("role")
);
--> statement-breakpoint
CREATE TABLE "integration" (
	"name" text PRIMARY KEY NOT NULL,
	"connected" boolean DEFAULT false NOT NULL,
	"detail" text,
	"checked_at" timestamp with time zone,
	CONSTRAINT "integration_name_check" CHECK ("integration"."name" = ANY (ARRAY['stripe', 'beancount', 'press', 'email']))
);
--> statement-breakpoint
CREATE TABLE "ledger_export" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event" text NOT NULL,
	"source_table" text NOT NULL,
	"source_id" uuid NOT NULL,
	"dated_on" date NOT NULL,
	"exported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"transaction_text" text NOT NULL,
	CONSTRAINT "ledger_export_source_table_source_id_event_key" UNIQUE("source_table","source_id","event")
);
--> statement-breakpoint
CREATE TABLE "operator" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"trading_name" text NOT NULL,
	"short_name" text,
	"logo" "bytea",
	"logo_media_type" text,
	"accent_colour" text,
	"address" text,
	"tax_number" text,
	"tax_number_label" text DEFAULT 'EIN' NOT NULL,
	"email" text,
	"phone" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"rounding_mode" text DEFAULT 'half_up' NOT NULL,
	"tax_rule_set" text DEFAULT 'none' NOT NULL,
	"invoice_number_format" text DEFAULT 'INV-0000' NOT NULL,
	"next_invoice_number" integer DEFAULT 1 NOT NULL,
	"default_terms_days" integer DEFAULT 30 NOT NULL,
	"ageing_alert_days" integer DEFAULT 30 NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"default_markup_pct" numeric(7, 4) DEFAULT '25' NOT NULL,
	"google_place_id" text,
	"address_verified_on" date,
	"invoice_footer" text,
	"email_attaches_pdf" boolean DEFAULT true NOT NULL,
	"email_includes_payment_link" boolean DEFAULT true NOT NULL,
	"auto_send" boolean DEFAULT false NOT NULL,
	"tax_registration" text,
	"tax_agency" text,
	"filing_basis" text,
	"fiscal_year_end_month" smallint,
	"claims_tax_paid_purchases_resold" boolean DEFAULT false NOT NULL,
	"date_format" text DEFAULT 'd MMM yyyy' NOT NULL,
	"mileage_assignment" text DEFAULT 'actual' NOT NULL,
	CONSTRAINT "operator_singleton_key" UNIQUE("singleton"),
	CONSTRAINT "operator_ageing_alert_days_check" CHECK ("operator"."ageing_alert_days" > 0),
	CONSTRAINT "operator_default_markup_pct_check" CHECK ("operator"."default_markup_pct" >= 0),
	CONSTRAINT "operator_default_terms_days_check" CHECK ("operator"."default_terms_days" >= 0),
	CONSTRAINT "operator_filing_basis_check" CHECK ("operator"."filing_basis" = ANY (ARRAY['annual', 'quarterly', 'monthly'])),
	CONSTRAINT "operator_fiscal_year_end_month_check" CHECK (("operator"."fiscal_year_end_month" >= 1) AND ("operator"."fiscal_year_end_month" <= 12)),
	CONSTRAINT "operator_mileage_assignment_check" CHECK ("operator"."mileage_assignment" = ANY (ARRAY['actual', 'round_trip_per_client'])),
	CONSTRAINT "operator_next_invoice_number_check" CHECK ("operator"."next_invoice_number" > 0),
	CONSTRAINT "operator_rounding_mode_check" CHECK ("operator"."rounding_mode" = ANY (ARRAY['half_up', 'half_even'])),
	CONSTRAINT "operator_singleton_check" CHECK ("operator"."singleton"),
	CONSTRAINT "operator_tax_rule_set_check" CHECK ("operator"."tax_rule_set" = ANY (ARRAY['us_ca', 'flat_per_site', 'none']))
);
--> statement-breakpoint
CREATE TABLE "record_history" (
	"id" bigint PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY (sequence name "record_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"table_name" text NOT NULL,
	"row_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_contact" ADD CONSTRAINT "entity_contact_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_contact" ADD CONSTRAINT "entity_contact_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site" ADD CONSTRAINT "site_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_contact" ADD CONSTRAINT "site_contact_site_id_entity_id_fkey" FOREIGN KEY ("site_id","entity_id") REFERENCES "public"."site"("id","entity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_contact" ADD CONSTRAINT "site_contact_entity_id_contact_id_fkey" FOREIGN KEY ("entity_id","contact_id") REFERENCES "public"."entity_contact"("entity_id","contact_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_tax_check" ADD CONSTRAINT "site_tax_check_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lot" ADD CONSTRAINT "material_lot_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_price" ADD CONSTRAINT "material_price_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_rule" ADD CONSTRAINT "pay_rule_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_rule" ADD CONSTRAINT "pay_rule_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_rule" ADD CONSTRAINT "pay_rule_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_rule" ADD CONSTRAINT "pay_rule_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_price" ADD CONSTRAINT "service_price_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_price" ADD CONSTRAINT "service_price_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_worked_by_fkey" FOREIGN KEY ("worked_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_site_is_the_clients" FOREIGN KEY ("entity_id","site_id") REFERENCES "public"."site"("entity_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_driven_by_fkey" FOREIGN KEY ("driven_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_leg" ADD CONSTRAINT "trip_leg_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_leg" ADD CONSTRAINT "trip_leg_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_leg" ADD CONSTRAINT "trip_leg_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_leg" ADD CONSTRAINT "trip_leg_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_leg" ADD CONSTRAINT "trip_leg_site_is_the_clients" FOREIGN KEY ("entity_id","site_id") REFERENCES "public"."site"("entity_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_stop" ADD CONSTRAINT "trip_stop_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_stop" ADD CONSTRAINT "trip_stop_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement" ADD CONSTRAINT "agreement_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement" ADD CONSTRAINT "agreement_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement" ADD CONSTRAINT "agreement_site_is_the_clients" FOREIGN KEY ("site_id","entity_id") REFERENCES "public"."site"("id","entity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_period" ADD CONSTRAINT "agreement_period_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_service" ADD CONSTRAINT "agreement_service_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_service" ADD CONSTRAINT "agreement_service_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_application" ADD CONSTRAINT "credit_application_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_note"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_application" ADD CONSTRAINT "credit_application_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_time_entry_id_fkey" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_trip_leg_id_fkey" FOREIGN KEY ("trip_leg_id") REFERENCES "public"."trip_leg"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_agreement_period_id_fkey" FOREIGN KEY ("agreement_period_id") REFERENCES "public"."agreement_period"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_material_lot_id_fkey" FOREIGN KEY ("material_lot_id") REFERENCES "public"."material_lot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "public"."payout"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance" ADD CONSTRAINT "tax_remittance_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_history" ADD CONSTRAINT "record_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_by_user" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_by_user" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_by_identifier" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_one_primary_contact" ON "entity_contact" USING btree ("entity_id") WHERE "entity_contact"."is_primary";--> statement-breakpoint
CREATE INDEX "site_by_entity" ON "site" USING btree ("entity_id") WHERE "site"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "site_one_primary_contact" ON "site_contact" USING btree ("site_id") WHERE "site_contact"."is_primary";--> statement-breakpoint
CREATE INDEX "site_tax_check_by_site" ON "site_tax_check" USING btree ("site_id","checked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "material_lot_open" ON "material_lot" USING btree ("material_id","received_on") WHERE "material_lot"."qty_remaining" > 0;--> statement-breakpoint
CREATE INDEX "pay_rule_by_service" ON "pay_rule" USING btree ("service_id","pays_for","effective_from" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "service_time_tracked" ON "service" USING btree ("time_tracked") WHERE "service"."time_tracked";--> statement-breakpoint
CREATE INDEX "service_price_asof" ON "service_price" USING btree ("service_id","effective_from" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "time_entry_crew" ON "time_entry" USING btree ("crew","worked_on");--> statement-breakpoint
CREATE INDEX "time_entry_entity" ON "time_entry" USING btree ("entity_id","worked_on");--> statement-breakpoint
CREATE INDEX "time_entry_site" ON "time_entry" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "time_entry_unbilled" ON "time_entry" USING btree ("worked_on") WHERE "time_entry"."billable";--> statement-breakpoint
CREATE INDEX "trip_leg_entity" ON "trip_leg" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "invoice_entity_status" ON "invoice" USING btree ("entity_id","status");--> statement-breakpoint
CREATE INDEX "invoice_line_material" ON "invoice_line" USING btree ("material_lot_id");--> statement-breakpoint
CREATE INDEX "payment_entity" ON "payment" USING btree ("entity_id","received_on");--> statement-breakpoint
CREATE INDEX "payment_payout" ON "payment" USING btree ("payout_id");--> statement-breakpoint
CREATE INDEX "record_history_row" ON "record_history" USING btree ("table_name","row_id","changed_at" DESC NULLS LAST);