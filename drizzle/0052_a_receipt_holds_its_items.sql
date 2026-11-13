-- A RECEIPT HOLDS ITS ITEMS (13 November 2026).
--
-- What was bought on one receipt or invoice is one stock_receipt -- from whom,
-- the day, its number, who paid, the tax it charged, and the paper itself,
-- kept once -- and each lot it brought in names it. A lot keeps what it is,
-- how much, what it cost before tax, and its share of the receipt's tax.
--
-- Every lot received before this is a receipt of its own, with the lot's own
-- id: its supplier, day, payer, file and tax move onto it (0053 drops them
-- from the lot). The lot's change is not history: nothing about it changed.

CREATE TABLE "stock_receipt" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"received_on" date NOT NULL,
	"supplier" text,
	"reference" text,
	"paid_by" uuid,
	"tax_paid" numeric(13, 3) DEFAULT '0' NOT NULL,
	"receipt" "bytea",
	"receipt_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_receipt_tax_paid_check" CHECK ("stock_receipt"."tax_paid" >= 0),
	CONSTRAINT "stock_receipt_receipt_comes_with_its_type" CHECK (("stock_receipt"."receipt" IS NULL) = ("stock_receipt"."receipt_type" IS NULL)),
	CONSTRAINT "stock_receipt_receipt_type_check" CHECK ("stock_receipt"."receipt_type" = ANY (ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])),
	CONSTRAINT "stock_receipt_receipt_size_check" CHECK (octet_length("stock_receipt"."receipt") <= 2097152)
);
--> statement-breakpoint
ALTER TABLE "material_lot" ADD COLUMN "receipt_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_receipt" ADD CONSTRAINT "stock_receipt_paid_by_fkey" FOREIGN KEY ("paid_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lot" ADD CONSTRAINT "material_lot_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "public"."stock_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "material_lot_receipt" ON "material_lot" USING btree ("receipt_id");--> statement-breakpoint
INSERT INTO "stock_receipt" ("id", "received_on", "supplier", "paid_by", "tax_paid", "receipt", "receipt_type")
SELECT "id", "received_on", "supplier", "paid_by", "tax_paid", "receipt", "receipt_type" FROM "material_lot";--> statement-breakpoint
ALTER TABLE "material_lot" DISABLE TRIGGER "h_material_lot";--> statement-breakpoint
UPDATE "material_lot" SET "receipt_id" = "id";--> statement-breakpoint
ALTER TABLE "material_lot" ENABLE TRIGGER "h_material_lot";--> statement-breakpoint
-- A receipt's history, as a lot's: when it began, and every field changed.
CREATE TRIGGER a_stock_receipt AFTER INSERT ON stock_receipt FOR EACH ROW EXECUTE FUNCTION record_addition();--> statement-breakpoint
CREATE TRIGGER h_stock_receipt AFTER UPDATE ON stock_receipt FOR EACH ROW EXECUTE FUNCTION record_change();
