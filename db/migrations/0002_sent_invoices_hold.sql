-- A SENT INVOICE STAYS SENT AND KEEPS ITS LINES (#24). 0001's guards did less
-- than they said. Status was left out of the comparison, so a sent invoice
-- could be set back to draft, rewritten and sent again. The line guard looked
-- only at the invoice a line ended up on, so a sent invoice's lines could be
-- moved onto a draft. Nothing guarded deleting an invoice, so a sent one with
-- no lines could go. And deleting a draft cascaded to its lines after the
-- invoice row was gone, so the line guard found no invoice, read that as not
-- a draft, and refused.

CREATE OR REPLACE FUNCTION freeze_sent_invoice() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'invoice % is % -- it cannot be deleted. Void it instead.',
        OLD.id, OLD.status USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status <> 'draft' THEN
    -- Back to draft is the one status that would open every other field again.
    IF NEW.status = 'draft' THEN
      RAISE EXCEPTION 'invoice % is % -- it cannot go back to draft. Correct it with a credit note.',
        OLD.id, OLD.status USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF (to_jsonb(NEW) - 'status' - 'sent_at' - 'void_reason' - 'token_expires_on')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'status' - 'sent_at' - 'void_reason' - 'token_expires_on') THEN
      RAISE EXCEPTION 'invoice % is % -- only its status may change. Correct it with a credit note.',
        OLD.id, OLD.status USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER freeze_invoice ON invoice;
--> statement-breakpoint
CREATE TRIGGER freeze_invoice BEFORE UPDATE OR DELETE ON invoice FOR EACH ROW EXECUTE FUNCTION freeze_sent_invoice();
--> statement-breakpoint
-- Both invoices a change touches: the one a line leaves and the one it joins.
--
-- FOR SHARE, so a line cannot slip onto an invoice in the moment it is sent.
-- It waits for a send already in flight and then reads the status that send
-- committed, and a send waits for a line already being written.
--
-- No invoice found means it is being deleted in this same statement, and the
-- line is going with it in the cascade. The invoice's own guard has already
-- allowed that, which it does only for a draft.
CREATE OR REPLACE FUNCTION freeze_sent_invoice_lines() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE st text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO st FROM invoice WHERE id = OLD.invoice_id FOR SHARE;
    IF FOUND AND st <> 'draft' THEN
      RAISE EXCEPTION 'invoice % is % -- its lines are immutable. Correct it with a credit note.',
        OLD.invoice_id, st USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO st FROM invoice WHERE id = NEW.invoice_id FOR SHARE;
    IF FOUND AND st <> 'draft' THEN
      RAISE EXCEPTION 'invoice % is % -- its lines are immutable. Correct it with a credit note.',
        NEW.invoice_id, st USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
