-- A COUNT PUTS THE SHELF RIGHT (13 November 2026): what is on the shelf is
-- counted, on a day, as many materials as are counted, and applied once. Each
-- difference becomes an adjustment that names the count: what is short comes
-- off the oldest lots at what it cost, what is over goes on at what one on the
-- shelf is worth now. A line keeps what the shelf said when it was counted, so
-- stock that moves before the count is applied is told rather than written
-- over, as Odoo tells it. One count is open at a time; an applied one, and
-- what was counted on it, stay as they were.

CREATE TABLE "stock_count" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"counted_on" date NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	"applied_by" uuid,
	CONSTRAINT "stock_count_applied_by_someone" CHECK (("stock_count"."applied_at" IS NULL) = ("stock_count"."applied_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "stock_count_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"count_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"counted" numeric(12, 4) NOT NULL,
	"on_hand" numeric(12, 4) NOT NULL,
	"cost_each" numeric(12, 4),
	"counted_by" uuid NOT NULL,
	"counted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_count_line_once" UNIQUE("count_id","material_id"),
	CONSTRAINT "stock_count_line_counted_check" CHECK ("stock_count_line"."counted" >= 0),
	CONSTRAINT "stock_count_line_on_hand_check" CHECK ("stock_count_line"."on_hand" >= 0),
	CONSTRAINT "stock_count_line_cost_each_check" CHECK ("stock_count_line"."cost_each" >= 0)
);
--> statement-breakpoint
ALTER TABLE "stock_adjustment" DROP CONSTRAINT "stock_adjustment_reason_check";--> statement-breakpoint
ALTER TABLE "stock_adjustment" DROP CONSTRAINT "stock_adjustment_reason_fits_its_way";--> statement-breakpoint
ALTER TABLE "stock_adjustment" ADD COLUMN "count_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_applied_by_fkey" FOREIGN KEY ("applied_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "public"."stock_count"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_counted_by_fkey" FOREIGN KEY ("counted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_one_open" ON "stock_count" USING btree (("applied_at" IS NULL)) WHERE "stock_count"."applied_at" IS NULL;--> statement-breakpoint
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "public"."stock_count"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_adjustment_count" ON "stock_adjustment" USING btree ("count_id");--> statement-breakpoint
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_counted_names_its_count" CHECK (("stock_adjustment"."reason" = 'counted') = ("stock_adjustment"."count_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_reason_check" CHECK ("stock_adjustment"."reason" = ANY (ARRAY['used', 'damaged', 'lost', 'returned', 'found', 'correction', 'counted']));--> statement-breakpoint
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_reason_fits_its_way" CHECK (("stock_adjustment"."way" = 'on' AND "stock_adjustment"."reason" IN ('found', 'correction', 'counted')) OR ("stock_adjustment"."way" = 'off' AND "stock_adjustment"."reason" <> 'found'));
--> statement-breakpoint
CREATE FUNCTION a_count_stays_as_applied() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE c uuid;
BEGIN
  IF TG_TABLE_NAME = 'stock_count' THEN
    IF OLD.applied_at IS NOT NULL THEN
      RAISE EXCEPTION 'count % has been applied, and stays as it was', OLD.id
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  ELSE
    c := CASE WHEN TG_OP = 'DELETE' THEN OLD.count_id ELSE NEW.count_id END;
    IF EXISTS (SELECT 1 FROM stock_count WHERE id = c AND applied_at IS NOT NULL)
       OR (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM stock_count WHERE id = OLD.count_id
                                         AND applied_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'count % has been applied, and what was counted on it stays as it was', c
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;--> statement-breakpoint
CREATE TRIGGER a_count_stays_as_applied BEFORE UPDATE OR DELETE ON stock_count
  FOR EACH ROW EXECUTE FUNCTION a_count_stays_as_applied();--> statement-breakpoint
CREATE TRIGGER a_count_line_stays_as_applied BEFORE INSERT OR UPDATE OR DELETE ON stock_count_line
  FOR EACH ROW EXECUTE FUNCTION a_count_stays_as_applied();--> statement-breakpoint
CREATE TRIGGER a_stock_count AFTER INSERT ON stock_count FOR EACH ROW EXECUTE FUNCTION record_addition();--> statement-breakpoint
CREATE TRIGGER h_stock_count AFTER UPDATE ON stock_count FOR EACH ROW EXECUTE FUNCTION record_change();--> statement-breakpoint
CREATE TRIGGER d_stock_count AFTER DELETE ON stock_count FOR EACH ROW EXECUTE FUNCTION record_deletion();--> statement-breakpoint
CREATE TRIGGER a_stock_count_line AFTER INSERT ON stock_count_line FOR EACH ROW EXECUTE FUNCTION record_addition();--> statement-breakpoint
CREATE TRIGGER h_stock_count_line AFTER UPDATE ON stock_count_line FOR EACH ROW EXECUTE FUNCTION record_change();--> statement-breakpoint
CREATE TRIGGER d_stock_count_line AFTER DELETE ON stock_count_line FOR EACH ROW EXECUTE FUNCTION record_deletion();
