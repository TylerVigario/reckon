ALTER TABLE "service" ALTER COLUMN "minimum_charge" SET DATA TYPE numeric(13, 3);--> statement-breakpoint
ALTER TABLE "service_price" ALTER COLUMN "rate" SET DATA TYPE numeric(13, 3);--> statement-breakpoint
ALTER TABLE "service_price" ALTER COLUMN "additional_rate" SET DATA TYPE numeric(13, 3);--> statement-breakpoint
ALTER TABLE "service_price" ALTER COLUMN "additional_rate" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "agreement" ALTER COLUMN "price" SET DATA TYPE numeric(13, 3);--> statement-breakpoint
ALTER TABLE "agreement_period" ALTER COLUMN "amount" SET DATA TYPE numeric(13, 3);--> statement-breakpoint
ALTER TABLE "credit_application" ALTER COLUMN "amount" SET DATA TYPE numeric(13, 3);--> statement-breakpoint
ALTER TABLE "credit_note" ALTER COLUMN "amount" SET DATA TYPE numeric(13, 3);--> statement-breakpoint
ALTER TABLE "invoice_line" ALTER COLUMN "amount" SET DATA TYPE numeric(13, 3);--> statement-breakpoint
ALTER TABLE "payment" ALTER COLUMN "gross" SET DATA TYPE numeric(13, 3);--> statement-breakpoint
ALTER TABLE "payment_allocation" ALTER COLUMN "amount" SET DATA TYPE numeric(13, 3);--> statement-breakpoint
ALTER TABLE "payout" ALTER COLUMN "gross" SET DATA TYPE numeric(13, 3);--> statement-breakpoint
ALTER TABLE "payout" ALTER COLUMN "fees" SET DATA TYPE numeric(13, 3);--> statement-breakpoint
ALTER TABLE "payout" ALTER COLUMN "fees" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "payout" ALTER COLUMN "net" SET DATA TYPE numeric(13, 3);--> statement-breakpoint
ALTER TABLE "refund" ALTER COLUMN "amount" SET DATA TYPE numeric(13, 3);--> statement-breakpoint
ALTER TABLE "tax_remittance" ALTER COLUMN "amount" SET DATA TYPE numeric(13, 3);