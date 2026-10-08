-- PAY IS SEPARATED BY WHAT IT IS. A person's pay was one figure and a role only
-- a name, so nothing told a partner's guaranteed payments from an employee's
-- wages or a contractor's fees, each reported in its own place. A role now says
-- what its pay is, and a payment item what it paid -- a trip's always a
-- reimbursement -- kept as it was.
ALTER TABLE "role" ADD COLUMN "pays_as" text;--> statement-breakpoint
ALTER TABLE "role" ADD CONSTRAINT "role_pays_as_check" CHECK ("role"."pays_as" = ANY (ARRAY['guaranteed_payment', 'wages', 'fee']));--> statement-breakpoint
-- The three roles every operator starts with say theirs. Any other is not said
-- until the business says it: reckon does not guess what a name means.
UPDATE "role" SET "pays_as" = CASE lower(btrim("name"))
    WHEN 'partner' THEN 'guaranteed_payment'
    WHEN 'employee' THEN 'wages'
    WHEN 'contractor' THEN 'fee'
  END;
--> statement-breakpoint
ALTER TABLE "person_payment_item" ADD COLUMN "paid_as" text;--> statement-breakpoint
-- Items already recorded are told what they paid, the one time a payment is
-- written to after it stands: a trip a reimbursement, time as the person's role
-- now says, and a correction as the payment it corrects paid for work.
ALTER TABLE "person_payment_item" DISABLE TRIGGER a_payment_stands;--> statement-breakpoint
UPDATE "person_payment_item" i SET "paid_as" = CASE
    WHEN i.trip_id IS NOT NULL THEN 'reimbursement'
    WHEN i.time_entry_id IS NOT NULL THEN
      (SELECT r.pays_as FROM "user" u JOIN "role" r ON r.id = u.role_id WHERE u.id = i.user_id)
  END;
--> statement-breakpoint
UPDATE "person_payment_item" i SET "paid_as" = (
    SELECT c.paid_as FROM "person_payment_item" c
     WHERE c.payment_id = i.corrects_payment_id AND c.paid_as IS NOT NULL
     ORDER BY c.paid_as = 'reimbursement', c.id
     LIMIT 1)
  WHERE i.corrects_payment_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "person_payment_item" ENABLE TRIGGER a_payment_stands;--> statement-breakpoint
ALTER TABLE "person_payment_item" ALTER COLUMN "paid_as" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "person_payment_item" ADD CONSTRAINT "person_payment_item_paid_as_check" CHECK ("person_payment_item"."paid_as" = ANY (ARRAY['guaranteed_payment', 'wages', 'fee', 'reimbursement']));--> statement-breakpoint
ALTER TABLE "person_payment_item" ADD CONSTRAINT "person_payment_item_paid_as_fits" CHECK (("person_payment_item"."trip_id" IS NULL OR "person_payment_item"."paid_as" = 'reimbursement') AND ("person_payment_item"."time_entry_id" IS NULL OR "person_payment_item"."paid_as" <> 'reimbursement'));
