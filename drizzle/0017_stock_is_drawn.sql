-- A LINE DRAWS FROM STOCK, AND STOCK FOLLOWS ITS DRAWS. A line drawn from stock
-- named one lot, so 147 ft that ran across two spools had nowhere to say so,
-- and nothing took what it used off the shelf. A line now names its material,
-- and stock_draw says what it took off each lot. The operator chooses how a
-- draw is costed: the average of what is on the shelf, or the oldest first.
CREATE TABLE "stock_draw" (
	"invoice_line_id" uuid NOT NULL,
	"material_lot_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"qty" numeric(12, 4) NOT NULL,
	CONSTRAINT "stock_draw_pkey" PRIMARY KEY("invoice_line_id","material_lot_id"),
	CONSTRAINT "stock_draw_qty_check" CHECK ("stock_draw"."qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "material_id" uuid;--> statement-breakpoint
ALTER TABLE "operator" ADD COLUMN "stock_costing" text DEFAULT 'average' NOT NULL;--> statement-breakpoint
ALTER TABLE "material_lot" ADD CONSTRAINT "material_lot_id_material_id_key" UNIQUE("id","material_id");--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_id_material_id_key" UNIQUE("id","material_id");--> statement-breakpoint
ALTER TABLE "stock_draw" ADD CONSTRAINT "stock_draw_line_fkey" FOREIGN KEY ("invoice_line_id","material_id") REFERENCES "public"."invoice_line"("id","material_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_draw" ADD CONSTRAINT "stock_draw_lot_fkey" FOREIGN KEY ("material_lot_id","material_id") REFERENCES "public"."material_lot"("id","material_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_draw_lot" ON "stock_draw" USING btree ("material_lot_id");--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "material_is_for_what_is_drawn" CHECK (("invoice_line"."material_id" IS NULL) OR ("invoice_line"."kind" = 'material'));--> statement-breakpoint
ALTER TABLE "operator" ADD CONSTRAINT "operator_stock_costing_check" CHECK ("operator"."stock_costing" = ANY (ARRAY['average', 'oldest_first']));
--> statement-breakpoint
-- Each line that named a lot names its material, and draws what it billed off
-- that lot. Its lot's qty_remaining already counts it -- it was set by hand
-- when nothing drew stock -- so these draws go in before the trigger that
-- would take them off again. A sent invoice's lines are frozen, and this is
-- the one change made to them: saying, of each, the material it already was.
ALTER TABLE "invoice_line" DISABLE TRIGGER "freeze_lines";
--> statement-breakpoint
UPDATE "invoice_line" l SET "material_id" = ml."material_id"
  FROM "material_lot" ml WHERE ml."id" = l."material_lot_id";
--> statement-breakpoint
ALTER TABLE "invoice_line" ENABLE TRIGGER "freeze_lines";
--> statement-breakpoint
INSERT INTO "stock_draw" ("invoice_line_id", "material_lot_id", "material_id", "qty")
SELECT "id", "material_lot_id", "material_id", "qty"
  FROM "invoice_line"
 WHERE "material_lot_id" IS NOT NULL AND "qty" > 0;
--> statement-breakpoint
-- STOCK FOLLOWS ITS DRAWS. What a draw takes comes off its lot, and goes back
-- when the draw goes -- with its line, or with a deleted draft. A draw larger
-- than what is left is refused by the lot's own check, so two people drawing
-- the last of a spool at once cannot both have it.
CREATE FUNCTION stock_follows_draws() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE material_lot SET qty_remaining = qty_remaining + OLD.qty WHERE id = OLD.material_lot_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE material_lot SET qty_remaining = qty_remaining - NEW.qty WHERE id = NEW.material_lot_id;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER stock_follows_draws AFTER INSERT OR UPDATE OR DELETE ON stock_draw FOR EACH ROW EXECUTE FUNCTION stock_follows_draws();
--> statement-breakpoint
-- What a sent invoice's lines drew is settled with them, as freeze_lines
-- settles the lines (0002): the invoice a draw's line is on must be a draft,
-- read FOR SHARE so a draw cannot slip in while it is sent. No line found
-- means it is being deleted in this same statement, which its own guard
-- allows only on a draft.
CREATE FUNCTION freeze_sent_draws() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE st text; inv uuid;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT i.status, i.id INTO st, inv
      FROM invoice_line l JOIN invoice i ON i.id = l.invoice_id
     WHERE l.id = OLD.invoice_line_id FOR SHARE OF i;
    IF FOUND AND st <> 'draft' THEN
      RAISE EXCEPTION 'invoice % is % -- what its lines drew from stock is settled. Correct it with a credit note.',
        inv, st USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT i.status, i.id INTO st, inv
      FROM invoice_line l JOIN invoice i ON i.id = l.invoice_id
     WHERE l.id = NEW.invoice_line_id FOR SHARE OF i;
    IF FOUND AND st <> 'draft' THEN
      RAISE EXCEPTION 'invoice % is % -- what its lines drew from stock is settled. Correct it with a credit note.',
        inv, st USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER freeze_draws BEFORE INSERT OR UPDATE OR DELETE ON stock_draw FOR EACH ROW EXECUTE FUNCTION freeze_sent_draws();
