ALTER TABLE "service_price" ALTER COLUMN "rate" SET DATA TYPE numeric(12, 4);--> statement-breakpoint
ALTER TABLE "service_price" ALTER COLUMN "additional_rate" SET DATA TYPE numeric(12, 4);--> statement-breakpoint
ALTER TABLE "service_price" ALTER COLUMN "additional_rate" SET DEFAULT '0';