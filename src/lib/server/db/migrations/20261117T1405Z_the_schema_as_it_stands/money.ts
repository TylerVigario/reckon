// Money out and money in.
//
// An invoice is built as a draft and sent once; after that it is immutable,
// which its triggers (below) enforce, and a credit note is the only way to
// change what a client owes. Each line stores what was billed -- quantity,
// price, tax rate, the cost of resold goods -- rather than looking it up, so a
// price changed later rewrites nothing already sent. A line points at what
// produced it: one time entry, trip leg, agreement period or material, or
// none. What a line drawn from stock took off each lot is stock_draw.
//
// A payment is what arrived; payment_allocation says which invoices it paid,
// so a partial payment and one deposit covering several invoices are both
// ordinary.
import { sql, type Kysely } from 'kysely';
import { recorded, versioned } from './record.ts';

/**
 * An amount of money, at as many places as any currency has: a dollar amount
 * is held as 95.500, a yen amount as 95.000. What is in it is rounded to the
 * business's currency's own places before it gets here (#lib/currency).
 */
const MONEY = sql`numeric(13, 3)`;

export async function money(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable('invoice')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		/**
		 * Made on the phone a draft was started on with no signal, so a retry
		 * cannot start it twice. It takes its number when it reaches the server.
		 * Null on one started there.
		 */
		.addColumn('client_uuid', 'uuid')
		.addColumn('number', 'text', (c) => c.notNull().unique())
		.addColumn('entity_id', 'uuid', (c) => c.notNull().references('entity.id').onDelete('restrict'))
		/**
		 * Where an invoice is in its life: being written, sent, or voided. Paid is
		 * not one of them: it is the balance (#lib/server/balances), worked out
		 * from what is put against it, so a refund after it is paid makes it owed
		 * again rather than leaving a status that says otherwise.
		 */
		.addColumn('status', sql`invoice_status`, (c) => c.notNull().defaultTo('draft'))
		.addColumn('issued_on', 'date')
		.addColumn('due_on', 'date')
		.addColumn('period_start', 'date')
		.addColumn('period_end', 'date')
		/**
		 * What the client's link is made of: /invoice/<token>, which opens this
		 * invoice without signing in. Given when it is sent, and random enough
		 * that it cannot be guessed; null on a draft, which has no link.
		 */
		.addColumn('public_token', 'text', (c) => c.unique())
		/**
		 * When the client's link stops working. How long a link should last is
		 * not decided, so nothing sets it; one that is set and has passed is
		 * refused.
		 */
		.addColumn('token_expires_on', 'date')
		/** When it was sent: dated, given its due date and its link. */
		.addColumn('sent_at', 'timestamptz')
		.addColumn('created_by', 'uuid', (c) => c.notNull().references('user.id').onDelete('restrict'))
		/**
		 * UNUSED, PLANNED. Why an invoice was voided. The CHECK that a void needs
		 * a reason is enforced and currently unreachable: nothing can void one.
		 */
		.addColumn('void_reason', 'text')
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		// The phone's uuid, unique to whoever started the draft (#lib/queue).
		.addUniqueConstraint('invoice_created_by_client_uuid_key', ['created_by', 'client_uuid'])
		.addCheckConstraint(
			'sent_invoices_have_dates',
			sql`status = 'draft' or (issued_on is not null and due_on is not null)`
		)
		// A sent invoice has its link; a draft has none to give away.
		.addCheckConstraint(
			'sent_invoices_have_a_link',
			sql`(status <> 'sent' or public_token is not null) and (status <> 'draft' or public_token is null)`
		)
		.addCheckConstraint('voiding_needs_a_reason', sql`status <> 'void' or void_reason is not null`)
		.execute();
	await db.schema
		.createIndex('invoice_entity_status')
		.on('invoice')
		.columns(['entity_id', 'status'])
		.execute();

	// A SENT INVOICE IS IMMUTABLE, AND STAYS SENT (#24). Only its status, sent
	// time, void reason and link expiry may move once it has left draft; it
	// cannot be set back to draft, rewritten and sent again, and a sent one
	// cannot be deleted, with lines or without.
	await sql`
		create function freeze_sent_invoice() returns trigger
		language plpgsql as $function$
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
		END $function$`.execute(db);
	await sql`create trigger freeze_invoice before update or delete on invoice
		for each row execute function freeze_sent_invoice()`.execute(db);
	await recorded(db, 'invoice');

	await db.schema
		.createTable('invoice_line')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		/**
		 * Made on the phone that added the line by hand, so a retry after a
		 * timeout cannot add it twice. Null on a line the server built.
		 */
		.addColumn('client_uuid', 'uuid')
		/**
		 * Which save of the line this is: 1 when added, one more each time a save
		 * changes it. A change made on a phone says which it started from, so the
		 * server can tell whether anyone changed it meanwhile.
		 */
		.addColumn('version', 'integer', (c) => c.notNull().defaultTo(1))
		.addColumn('invoice_id', 'uuid', (c) =>
			c.notNull().references('invoice.id').onDelete('cascade')
		)
		.addColumn('seq', 'integer', (c) => c.notNull())
		/**
		 * How a line behaves. service, recurring and adjustment are the work and
		 * the charges; the goods and costs passed on are three: material, drawn
		 * from stock; bought, goods bought for this job and passed on; paid_for, a
		 * fee, a hire or a bill paid on the client's behalf, which is not goods.
		 */
		.addColumn('kind', sql`invoice_line_kind`, (c) => c.notNull())
		.addColumn('description', 'text', (c) => c.notNull())
		.addColumn('qty', sql`numeric(12, 4)`, (c) => c.notNull())
		.addColumn('unit_price', sql`numeric(12, 4)`, (c) => c.notNull())
		.addColumn('taxable', 'boolean', (c) => c.notNull().defaultTo(false))
		.addColumn('tax_rate_pct', sql`numeric(7, 4)`, (c) =>
			c
				.notNull()
				.defaultTo('0')
				.check(sql`tax_rate_pct >= 0`)
		)
		.addColumn('tax_source', sql`tax_source`, (c) => c.notNull().defaultTo('none'))
		/**
		 * Where a taxed line was taxed: CDTFA's area for its site, read from the
		 * site with the rate. A sent line keeps it, so a return reads a period as
		 * it was billed after the site's rate is refreshed or its address chosen
		 * again. Null on a line taxed nowhere, or at no site.
		 */
		.addColumn('tax_jurisdiction', 'text')
		/**
		 * What the rate was made of -- the state's share and the districts' --
		 * where it was the site's rate, read with it. Null on any other line,
		 * and on one sent before they were kept whose rate no answer of CDTFA's
		 * matched.
		 */
		.addColumn('state_rate_pct', sql`numeric(7, 4)`, (c) => c.check(sql`state_rate_pct >= 0`))
		.addColumn('district_rate_pct', sql`numeric(7, 4)`, (c) => c.check(sql`district_rate_pct >= 0`))
		.addColumn('tax_override_reason', 'text')
		.addColumn('ex_tax_cost', sql`numeric(12, 4)`)
		.addColumn('tax_paid', sql`numeric(12, 4)`)
		.addColumn('amount', MONEY, (c) => c.notNull())
		.addColumn('time_entry_id', 'uuid', (c) =>
			c.unique().references('time_entry.id').onDelete('restrict')
		)
		.addColumn('trip_leg_id', 'uuid', (c) =>
			c.unique().references('trip_leg.id').onDelete('restrict')
		)
		.addColumn('agreement_period_id', 'uuid', (c) =>
			c.unique().references('agreement_period.id').onDelete('restrict')
		)
		/**
		 * What a line drawn from stock is of. What it took from each lot is in
		 * stock_draw.
		 */
		.addColumn('material_id', 'uuid', (c) => c.references('material.id').onDelete('restrict'))
		/**
		 * What qty counts, frozen at issue. Null when the quantity counts nothing,
		 * as on a flat charge or an adjustment.
		 */
		.addColumn('unit', 'text')
		.addColumn('site_id', 'uuid', (c) => c.references('site.id').onDelete('restrict'))
		/**
		 * The draft a line was added to on a phone, when that draft had gone out
		 * by the time the line reached the server: the line started a new draft
		 * for the client instead, and says where it was meant to go.
		 */
		.addColumn('moved_from_invoice_id', 'uuid', (c) =>
			c.references('invoice.id').onDelete('restrict')
		)
		/** Who it was bought from or paid to: "Valley Hardware", "City of Woodland". */
		.addColumn('bought_from', 'text')
		/** Who paid for it: a person, who is owed it back, or the business when empty. */
		.addColumn('paid_by', 'uuid', (c) => c.references('user.id').onDelete('restrict'))
		/** The receipt, as the phone shrank it, and its type. */
		.addColumn('receipt', 'bytea')
		.addColumn('receipt_type', sql`receipt_type`)
		/**
		 * Who added it: someone with Field changes only the lines they added.
		 * Null on one added before lines kept their history, which only someone
		 * with Full changes.
		 */
		.addColumn('created_by', 'uuid', (c) => c.references('user.id').onDelete('restrict'))
		.addUniqueConstraint('invoice_line_invoice_id_seq_key', ['invoice_id', 'seq'])
		// The phone's uuid, unique to whoever added the line (#lib/queue). Every
		// line a phone sends names who added it; a line made here, from time or a
		// trip, has neither.
		.addUniqueConstraint('invoice_line_created_by_client_uuid_key', ['created_by', 'client_uuid'])
		// What a draw names, so the lots it comes off are of the line's material.
		.addUniqueConstraint('invoice_line_id_material_id_key', ['id', 'material_id'])
		.addCheckConstraint(
			'invoice_line_receipt_comes_with_its_type',
			sql`(receipt is null) = (receipt_type is null)`
		)
		.addCheckConstraint('invoice_line_receipt_size_check', sql`octet_length(receipt) <= 2097152`)
		.addCheckConstraint(
			'material_is_for_what_is_drawn',
			sql`material_id is null or kind = 'material'`
		)
		// Who paid is said of what was bought or paid for, and of nothing else.
		.addCheckConstraint(
			'paid_by_is_for_what_was_bought',
			sql`paid_by is null or kind in ('bought', 'paid_for')`
		)
		// The unit as it was billed, in words: a line keeps saying what it counted
		// after a unit is renamed or a service changes how it is charged.
		.addCheckConstraint('invoice_line_unit_is_something', sql`unit is null or btrim(unit) <> ''`)
		.addCheckConstraint(
			'one_source_at_most',
			sql`(time_entry_id is not null)::integer + (trip_leg_id is not null)::integer
				+ (agreement_period_id is not null)::integer + (material_id is not null)::integer <= 1`
		)
		.addCheckConstraint(
			'override_needs_a_reason',
			sql`tax_source <> 'override' or tax_override_reason is not null`
		)
		.addCheckConstraint('untaxed_lines_carry_no_rate', sql`taxable or tax_rate_pct = 0`)
		// Where a line was taxed is said of a taxed line at a site, and of nothing else.
		.addCheckConstraint(
			'taxed_lines_say_where',
			sql`(taxable and site_id is not null) = (tax_jurisdiction is not null)`
		)
		// The shares come together, from the site whose rate the line was taxed
		// at, and make that rate. A line sent before they were kept can lack
		// both.
		.addCheckConstraint(
			'rate_shares_make_the_rate',
			sql`(state_rate_pct is null and district_rate_pct is null)
				or (tax_source = 'site' and state_rate_pct is not null and district_rate_pct is not null
					and state_rate_pct + district_rate_pct = tax_rate_pct)`
		)
		.execute();

	// Both invoices a change touches: the one a line leaves and the one it joins.
	//
	// FOR SHARE, so a line cannot slip onto an invoice in the moment it is sent.
	// It waits for a send already in flight and then reads the status that send
	// committed, and a send waits for a line already being written.
	//
	// No invoice found means it is being deleted in this same statement, and the
	// line is going with it in the cascade. The invoice's own guard has already
	// allowed that, which it does only for a draft.
	await sql`
		create function freeze_sent_invoice_lines() returns trigger
		language plpgsql as $function$
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
		END $function$`.execute(db);
	await sql`create trigger freeze_lines before insert or update or delete on invoice_line
		for each row execute function freeze_sent_invoice_lines()`.execute(db);
	await recorded(db, 'invoice_line', { removals: true });
	await versioned(db, 'invoice_line');

	/**
	 * What a line drawn from stock took off each lot: 147 ft, 100 off the oldest
	 * spool and 47 off the next. A lot's qty_remaining follows these -- a trigger
	 * takes a draw off its lot and puts it back when the draw goes, as it does with
	 * its line or a deleted draft -- so stock is never counted twice, and a draw
	 * larger than what is left is refused by the lot's own check.
	 *
	 * The material is named twice over so the database holds a line's draws to its
	 * own material: (line, material) and (lot, material) must each exist.
	 */
	await db.schema
		.createTable('stock_draw')
		.addColumn('invoice_line_id', 'uuid', (c) => c.notNull())
		.addColumn('material_lot_id', 'uuid', (c) => c.notNull())
		.addColumn('material_id', 'uuid', (c) => c.notNull())
		.addColumn('qty', sql`numeric(12, 4)`, (c) => c.notNull().check(sql`qty > 0`))
		.addPrimaryKeyConstraint('stock_draw_pkey', ['invoice_line_id', 'material_lot_id'])
		.addForeignKeyConstraint(
			'stock_draw_line_fkey',
			['invoice_line_id', 'material_id'],
			'invoice_line',
			['id', 'material_id'],
			(f) => f.onDelete('cascade')
		)
		.addForeignKeyConstraint(
			'stock_draw_lot_fkey',
			['material_lot_id', 'material_id'],
			'material_lot',
			['id', 'material_id'],
			(f) => f.onDelete('restrict')
		)
		.execute();
	await db.schema
		.createIndex('stock_draw_lot')
		.on('stock_draw')
		.column('material_lot_id')
		.execute();

	// Stock follows its draws: stock_follows_draws (catalogue.ts) takes a draw
	// off its lot, and puts it back when the draw goes.
	await sql`create trigger stock_follows_draws after insert or update or delete on stock_draw
		for each row execute function stock_follows_draws()`.execute(db);

	// What a sent invoice's lines drew is settled with them, as freeze_lines
	// settles the lines: the invoice a draw's line is on must be a draft, read
	// FOR SHARE so a draw cannot slip in while it is sent. No line found means
	// it is being deleted in this same statement, which its own guard allows
	// only on a draft.
	await sql`
		create function freeze_sent_draws() returns trigger
		language plpgsql as $function$
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
		END $function$`.execute(db);
	await sql`create trigger freeze_draws before insert or update or delete on stock_draw
		for each row execute function freeze_sent_draws()`.execute(db);

	await db.schema
		.createTable('credit_note')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('number', 'text', (c) => c.notNull().unique())
		.addColumn('entity_id', 'uuid', (c) => c.notNull().references('entity.id').onDelete('restrict'))
		.addColumn('issued_on', 'date', (c) => c.notNull())
		.addColumn('amount', MONEY, (c) => c.notNull().check(sql`amount > 0`))
		.addColumn('kind', sql`credit_note_kind`, (c) => c.notNull())
		.addColumn('reason', 'text', (c) => c.notNull())
		.addColumn('created_by', 'uuid', (c) => c.notNull().references('user.id').onDelete('restrict'))
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.execute();

	await db.schema
		.createTable('credit_application')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('credit_note_id', 'uuid', (c) =>
			c.notNull().references('credit_note.id').onDelete('restrict')
		)
		.addColumn('invoice_id', 'uuid', (c) =>
			c.notNull().references('invoice.id').onDelete('restrict')
		)
		.addColumn('amount', MONEY, (c) => c.notNull().check(sql`amount > 0`))
		.addColumn('applied_on', 'date', (c) => c.notNull())
		.addUniqueConstraint('credit_application_credit_note_id_invoice_id_key', [
			'credit_note_id',
			'invoice_id'
		])
		.execute();

	/**
	 * UNUSED, PLANNED. A settlement batch from a card processor: several invoices
	 * paid, one deposit, minus a fee. payment.payout_id already points here.
	 */
	await db.schema
		.createTable('payout')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('processor', 'text', (c) => c.notNull())
		.addColumn('arrived_on', 'date', (c) => c.notNull())
		.addColumn('gross', MONEY, (c) => c.notNull())
		.addColumn('fees', MONEY, (c) => c.notNull().defaultTo('0'))
		.addColumn('net', MONEY, (c) => c.notNull())
		.addColumn('bank_reference', 'text')
		.addCheckConstraint('payout_nets_out', sql`net = gross - fees`)
		.execute();

	await db.schema
		.createTable('payment')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('entity_id', 'uuid', (c) => c.notNull().references('entity.id').onDelete('restrict'))
		.addColumn('received_on', 'date', (c) => c.notNull())
		.addColumn('gross', MONEY, (c) => c.notNull().check(sql`gross > 0`))
		.addColumn('method', sql`payment_method`, (c) => c.notNull())
		/** UNUSED, PLANNED. The card processor's id for the payment. Nothing records it yet. */
		.addColumn('processor_ref', 'text')
		.addColumn('payout_id', 'uuid', (c) => c.references('payout.id').onDelete('set null'))
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.execute();
	await db.schema
		.createIndex('payment_entity')
		.on('payment')
		.columns(['entity_id', 'received_on'])
		.execute();
	await db.schema.createIndex('payment_payout').on('payment').column('payout_id').execute();

	await db.schema
		.createTable('payment_allocation')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('payment_id', 'uuid', (c) =>
			c.notNull().references('payment.id').onDelete('cascade')
		)
		.addColumn('invoice_id', 'uuid', (c) =>
			c.notNull().references('invoice.id').onDelete('restrict')
		)
		.addColumn('amount', MONEY, (c) => c.notNull().check(sql`amount > 0`))
		.addUniqueConstraint('payment_allocation_payment_id_invoice_id_key', [
			'payment_id',
			'invoice_id'
		])
		.execute();

	/**
	 * UNUSED, PLANNED. Money sent back. Distinct from a credit note, which is a
	 * reduction in what is owed rather than a movement of cash.
	 */
	await db.schema
		.createTable('refund')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('payment_id', 'uuid', (c) =>
			c.notNull().references('payment.id').onDelete('restrict')
		)
		.addColumn('amount', MONEY, (c) => c.notNull().check(sql`amount > 0`))
		.addColumn('refunded_on', 'date', (c) => c.notNull())
		.addColumn('reason', 'text', (c) => c.notNull())
		.execute();

	/**
	 * A return that was filed and the money that went with it. Nothing here can be
	 * derived: what was charged is in the invoices, but what was handed over is a
	 * fact about the world, and the difference is what is still owed.
	 */
	await db.schema
		.createTable('tax_remittance')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('period_start', 'date', (c) => c.notNull())
		.addColumn('period_end', 'date', (c) => c.notNull())
		/**
		 * When the return went in. Distinct from paid_on: a return can be filed and
		 * paid on different days, and a ledger posts the payment.
		 */
		.addColumn('filed_on', 'date')
		.addColumn('paid_on', 'date')
		.addColumn('amount', MONEY, (c) => c.notNull().check(sql`amount >= 0`))
		.addColumn('reference', 'text')
		.addColumn('note', 'text')
		.addColumn('created_by', 'uuid', (c) => c.notNull().references('user.id').onDelete('restrict'))
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addUniqueConstraint('one_filing_per_period', ['period_start', 'period_end'])
		.addCheckConstraint('remittance_period_ends_after_it_starts', sql`period_end >= period_start`)
		.execute();
}
