-- STOCK IS PUT RIGHT BY HAND (13 November 2026).
--
-- A stock_adjustment takes so much of one material off the shelf, or puts so
-- much on, on a day, for a reason, held at what it moved is worth. A take
-- comes off the oldest lots first, as a line's draw does: stock_take says what
-- it took off each lot, and the lot follows its takes by the same function it
-- follows its draws by. A find is a lot of its own that names the adjustment
-- in place of a receipt; every lot names one or the other.

CREATE TABLE "stock_adjustment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"material_id" uuid NOT NULL,
	"made_on" date NOT NULL,
	"way" text NOT NULL,
	"qty" numeric(12, 4) NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"ex_tax_cost" numeric(12, 4) NOT NULL,
	"tax_paid" numeric(12, 4) DEFAULT '0' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_adjustment_way_check" CHECK ("stock_adjustment"."way" = ANY (ARRAY['off', 'on'])),
	CONSTRAINT "stock_adjustment_reason_check" CHECK ("stock_adjustment"."reason" = ANY (ARRAY['used', 'damaged', 'lost', 'returned', 'found', 'correction'])),
	CONSTRAINT "stock_adjustment_qty_check" CHECK ("stock_adjustment"."qty" > 0),
	CONSTRAINT "stock_adjustment_ex_tax_cost_check" CHECK ("stock_adjustment"."ex_tax_cost" >= 0),
	CONSTRAINT "stock_adjustment_tax_paid_check" CHECK ("stock_adjustment"."tax_paid" >= 0),
	CONSTRAINT "stock_adjustment_reason_fits_its_way" CHECK (("stock_adjustment"."way" = 'on' AND "stock_adjustment"."reason" IN ('found', 'correction')) OR ("stock_adjustment"."way" = 'off' AND "stock_adjustment"."reason" <> 'found'))
);
--> statement-breakpoint
CREATE TABLE "stock_take" (
	"adjustment_id" uuid NOT NULL,
	"material_lot_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"qty" numeric(12, 4) NOT NULL,
	CONSTRAINT "stock_take_pkey" PRIMARY KEY("adjustment_id","material_lot_id"),
	CONSTRAINT "stock_take_qty_check" CHECK ("stock_take"."qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "material_lot" ALTER COLUMN "receipt_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "material_lot" ADD COLUMN "adjustment_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_take" ADD CONSTRAINT "stock_take_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "public"."stock_adjustment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_take" ADD CONSTRAINT "stock_take_lot_fkey" FOREIGN KEY ("material_lot_id","material_id") REFERENCES "public"."material_lot"("id","material_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_adjustment_material" ON "stock_adjustment" USING btree ("material_id","made_on");--> statement-breakpoint
CREATE INDEX "stock_take_lot" ON "stock_take" USING btree ("material_lot_id");--> statement-breakpoint
ALTER TABLE "material_lot" ADD CONSTRAINT "material_lot_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "public"."stock_adjustment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lot" ADD CONSTRAINT "material_lot_has_one_origin" CHECK (("material_lot"."receipt_id" IS NULL) <> ("material_lot"."adjustment_id" IS NULL));--> statement-breakpoint
-- STOCK FOLLOWS ITS TAKES, as it follows its draws (0017): a take larger than
-- what is left is refused by the lot's own check.
CREATE TRIGGER stock_follows_takes AFTER INSERT OR UPDATE OR DELETE ON stock_take FOR EACH ROW EXECUTE FUNCTION stock_follows_draws();--> statement-breakpoint
-- An adjustment's history begins when it is made; it is not changed after.
CREATE TRIGGER a_stock_adjustment AFTER INSERT ON stock_adjustment FOR EACH ROW EXECUTE FUNCTION record_addition();--> statement-breakpoint
CREATE TRIGGER h_stock_adjustment AFTER UPDATE ON stock_adjustment FOR EACH ROW EXECUTE FUNCTION record_change();
