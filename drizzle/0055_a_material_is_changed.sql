-- A MATERIAL IS CHANGED (13 November 2026): its name, brand, SKU, whether it
-- is taxed, what it sells at, and whether it is offered, each changed on its
-- Details tab. Each save counts (version), so a change made from an old copy
-- is told of one made since, and history keeps every field it changed, but not
-- the count; and every price it is given, from a day, which a return to its
-- markup is too (a price row with no price).
--
-- What it is counted in stays as it was once any of it has been received, as
-- Odoo and ERPNext refuse it once stock has moved: 1,000 counted in feet would
-- otherwise read as 1,000 of something else.

ALTER TABLE "material_price" ALTER COLUMN "price" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "material" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE TRIGGER v_material BEFORE UPDATE ON material FOR EACH ROW EXECUTE FUNCTION bump_version();--> statement-breakpoint
CREATE TRIGGER a_material AFTER INSERT ON material FOR EACH ROW EXECUTE FUNCTION record_addition();--> statement-breakpoint
CREATE TRIGGER h_material AFTER UPDATE ON material FOR EACH ROW EXECUTE FUNCTION record_change('version');--> statement-breakpoint
CREATE TRIGGER a_material_price AFTER INSERT ON material_price FOR EACH ROW EXECUTE FUNCTION record_addition();--> statement-breakpoint
CREATE TRIGGER h_material_price AFTER UPDATE ON material_price FOR EACH ROW EXECUTE FUNCTION record_change();--> statement-breakpoint
CREATE FUNCTION a_unit_is_kept_once_received() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.unit_id IS DISTINCT FROM OLD.unit_id
     AND EXISTS (SELECT 1 FROM material_lot WHERE material_id = OLD.id) THEN
    RAISE EXCEPTION 'material % has been received in its unit, which stays as it was', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER a_unit_is_kept_once_received BEFORE UPDATE OF unit_id ON material
  FOR EACH ROW EXECUTE FUNCTION a_unit_is_kept_once_received();
