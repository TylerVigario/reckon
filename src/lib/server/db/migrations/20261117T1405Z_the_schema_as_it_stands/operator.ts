// The business running this, and what it remembers.
//
// One operator row, ever. What the business supplies -- its name, its marks,
// how it numbers invoices, which tax rules it files under -- is here, so
// nothing about any one business is in the code.
//
// record_history is written by the tables' own triggers (record.ts): a figure
// on an invoice is answerable a year later -- who changed it, from what, and
// when.
//
// integration records whether an outside thing is wired up and what it points
// at, never how to log in: keys are environment, because a table travels in
// every dump and every backup.
import { sql, type Kysely } from 'kysely';
import { recorded } from './record.ts';

export async function operator(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable('operator')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('singleton', 'boolean', (c) => c.notNull().defaultTo(true))
		.addColumn('trading_name', 'text', (c) => c.notNull())
		.addColumn('short_name', 'text')
		.addColumn('logo', 'bytea')
		.addColumn('logo_media_type', 'text')
		.addColumn('accent_colour', 'text')
		.addColumn('address', 'text')
		/**
		 * Google's identifier for the place operator.address is. The id is the one
		 * piece of Places data that may be stored indefinitely.
		 */
		.addColumn('google_place_id', 'text')
		/** When operator.address was last confirmed against Google. */
		.addColumn('address_verified_on', 'date')
		.addColumn('tax_number', 'text')
		/**
		 * UNUSED, PLANNED. What the tax number is called on an invoice. The
		 * settings page saves it; nothing prints an invoice yet.
		 */
		.addColumn('tax_number_label', 'text', (c) => c.notNull().defaultTo('EIN'))
		.addColumn('email', 'text')
		.addColumn('phone', 'text')
		.addColumn('currency', 'text', (c) => c.notNull().defaultTo('USD'))
		/**
		 * The business's clock, as Postgres names it: whether an invoice is
		 * overdue, how long work has waited, where a report's month begins, which
		 * price is in force -- one answer for everyone (#lib/server/calendar). A
		 * person follows it until they set their own zone.
		 */
		.addColumn('timezone', 'text', (c) => c.notNull().defaultTo('UTC'))
		/**
		 * How dates and figures read for the business: a locale, as BCP 47 writes
		 * one ("en-US"). Each person follows it until they set their own, and the
		 * business's documents are written in it. A locale rather than a date
		 * pattern, because a pattern does not translate: the locale carries the
		 * language, the order of day and month, and the separators.
		 */
		.addColumn('locale', 'text', (c) => c.notNull().defaultTo('en-US'))
		.addColumn('tax_rule_set', sql`tax_rule_set`, (c) => c.notNull().defaultTo('none'))
		.addColumn('invoice_number_format', 'text', (c) => c.notNull().defaultTo('INV-0000'))
		.addColumn('next_invoice_number', 'integer', (c) => c.notNull().defaultTo(1))
		.addColumn('default_terms_days', 'integer', (c) => c.notNull().defaultTo(30))
		.addColumn('ageing_alert_days', 'integer', (c) => c.notNull().defaultTo(30))
		.addColumn('default_markup_pct', sql`numeric(7, 4)`, (c) => c.notNull().defaultTo('25'))
		/**
		 * What goods bought for a job are marked up by when they are passed on.
		 * None by default: passed on as they cost.
		 */
		.addColumn('purchase_markup_pct', sql`numeric(7, 4)`, (c) => c.notNull().defaultTo('0'))
		/**
		 * What a line drawn from stock costs (#lib/stock-draw): the average of
		 * what is on the shelf, or the oldest first. A change applies to what is
		 * drawn after it; a line keeps the cost it was drawn at.
		 */
		.addColumn('stock_costing', sql`stock_costing`, (c) => c.notNull().defaultTo('average'))
		/**
		 * UNUSED, PLANNED. The foot of every printed invoice, under the lines --
		 * where "cheques payable to" and how card payments settle belong. The
		 * settings page saves it; nothing prints an invoice yet.
		 */
		.addColumn('invoice_footer', 'text')
		/**
		 * UNUSED, PLANNED. Whether an invoice's email carries the PDF. The
		 * settings page saves it; nothing emails an invoice yet.
		 */
		.addColumn('email_attaches_pdf', 'boolean', (c) => c.notNull().defaultTo(true))
		/**
		 * UNUSED, PLANNED. Whether an invoice's email carries a link to pay by
		 * card. The settings page saves it; nothing emails an invoice yet.
		 */
		.addColumn('email_includes_payment_link', 'boolean', (c) => c.notNull().defaultTo(true))
		/**
		 * UNUSED, PLANNED. Whether a draft goes out without a person sending it.
		 * False by default and deliberately so: a client should see nothing a
		 * person has not decided is right. The settings page saves it; nothing
		 * builds or sends a draft yet.
		 */
		.addColumn('auto_send', 'boolean', (c) => c.notNull().defaultTo(false))
		/**
		 * What the operator holds, in the issuer's own words -- "Seller's permit".
		 * Distinct from tax_number, which is the number on it.
		 */
		.addColumn('tax_registration', 'text')
		/** Who issued it and who the return goes to -- CDTFA in California. */
		.addColumn('tax_agency', 'text')
		.addColumn('filing_basis', sql`filing_basis`)
		/**
		 * The month the fiscal year ends in; the year ends on its last day.
		 * Reports are built on this -- a Schedule A for a fiscal year cannot be
		 * drawn without it.
		 */
		.addColumn('fiscal_year_end_month', 'smallint')
		/**
		 * The Reg 1701 election: tax already paid on materials that were resold
		 * comes off the measure. An election, not a calculation, so it is recorded
		 * rather than inferred from whether any material qualifies.
		 */
		.addColumn('claims_tax_paid_purchases_resold', 'boolean', (c) => c.notNull().defaultTo(false))
		/**
		 * UNUSED, PLANNED: the settings page saves it, and nothing applies it to a
		 * trip yet. actual: each leg goes to whoever caused it, and never more
		 * miles than were driven. round_trip_per_client: a full round trip each,
		 * which over-bills whenever two sites are near each other -- a trip past
		 * two clients can charge 70 miles for 57 driven.
		 */
		.addColumn('mileage_assignment', sql`mileage_assignment`, (c) =>
			c.notNull().defaultTo('actual')
		)
		.addUniqueConstraint('operator_singleton_key', ['singleton'])
		.addCheckConstraint('operator_singleton_check', sql`singleton`)
		.addCheckConstraint('operator_ageing_alert_days_check', sql`ageing_alert_days > 0`)
		.addCheckConstraint('operator_default_markup_pct_check', sql`default_markup_pct >= 0`)
		.addCheckConstraint('operator_purchase_markup_pct_check', sql`purchase_markup_pct >= 0`)
		.addCheckConstraint('operator_default_terms_days_check', sql`default_terms_days >= 0`)
		.addCheckConstraint(
			'operator_fiscal_year_end_month_check',
			sql`fiscal_year_end_month >= 1 and fiscal_year_end_month <= 12`
		)
		.addCheckConstraint('operator_next_invoice_number_check', sql`next_invoice_number > 0`)
		.execute();
	await recorded(db, 'operator');

	/**
	 * EVERY CHANGE TO WHAT THE BOOKS REST ON, AND TO PEOPLE (12 November 2026):
	 * each field changed, each row added, and each removed where removing is
	 * allowed, with who, when, and the save it was part of -- the tables' own
	 * triggers write it (record.ts). It is the books' own trail, kept as long as
	 * they are: never removed, unlike the security log.
	 *
	 * Only those triggers write it, the database stamps when, and no row is ever
	 * changed: the server's role cannot switch any of that off, owning nothing
	 * (README, "The database").
	 */
	await db.schema
		.createTable('record_history')
		.addColumn('id', 'bigint', (c) => c.primaryKey().generatedByDefaultAsIdentity())
		.addColumn('table_name', 'text', (c) => c.notNull())
		.addColumn('row_id', 'uuid', (c) => c.notNull())
		.addColumn('field', 'text', (c) => c.notNull())
		.addColumn('old_value', 'text')
		.addColumn('new_value', 'text')
		// Someone who changed anything is made inactive, never deleted: history
		// names them for as long as it is kept.
		.addColumn('changed_by', 'uuid', (c) => c.references('user.id').onDelete('restrict'))
		.addColumn('changed_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		/**
		 * When the change was made on a phone, where it was made with no signal:
		 * changed_at is when it reached the server. Null for one made there.
		 */
		.addColumn('made_at', 'timestamptz')
		/**
		 * The transaction it was part of: every change of one save shares it, so
		 * a change is read with what went with it. Null for any from before 13
		 * November 2026.
		 */
		.addColumn('xact', 'bigint')
		.execute();
	await db.schema
		.createIndex('record_history_row')
		.on('record_history')
		.columns(['table_name', 'row_id'])
		.expression(sql`changed_at desc nulls last`)
		.execute();
	await db.schema
		.createIndex('record_history_by_save')
		.on('record_history')
		.column('xact')
		.execute();

	// History is written by the tables' triggers alone -- a row inserted any
	// other way is refused -- stamped with the database's own clock and the
	// transaction it was part of, and never changed or removed. Triggers rather
	// than grants, so reckon names no role (README, "The database"): only the
	// table's owner could switch them off, and the server's role owns nothing.
	await sql`
		create function history_from_triggers() returns trigger
		language plpgsql as $function$
		BEGIN
		  IF pg_trigger_depth() < 2 THEN
		    RAISE EXCEPTION 'record_history is written by the tables'' own triggers, not directly'
		      USING ERRCODE = 'integrity_constraint_violation';
		  END IF;
		  NEW.changed_at := now();
		  NEW.xact := pg_current_xact_id()::text::bigint;
		  RETURN NEW;
		END $function$`.execute(db);
	await sql`
		create function history_stands() returns trigger
		language plpgsql as $function$
		BEGIN
		  RAISE EXCEPTION 'record_history stands: it is never %d', lower(TG_OP)
		    USING ERRCODE = 'integrity_constraint_violation';
		END $function$`.execute(db);
	await sql`create trigger from_triggers before insert on record_history
		for each row execute function history_from_triggers()`.execute(db);
	await sql`create trigger stands before update or delete on record_history
		for each row execute function history_stands()`.execute(db);

	/**
	 * Whether an outside thing is wired up, and what it points at -- the ledger
	 * directory, the sending address. Never a credential.
	 */
	await db.schema
		.createTable('integration')
		.addColumn('name', sql`integration_name`, (c) => c.primaryKey())
		.addColumn('connected', 'boolean', (c) => c.notNull().defaultTo(false))
		/** What it points at, in the operator's terms. Not a secret. */
		.addColumn('detail', 'text')
		/** When the connection was last proven, rather than last configured. */
		.addColumn('checked_at', 'timestamptz')
		.execute();

	/**
	 * UNUSED, PLANNED. Meant to record what has been handed to the operator's
	 * ledger. Nothing is handed over yet: an export waits until that ledger exists
	 * and what it needs from this application is known.
	 */
	await db.schema
		.createTable('ledger_export')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('event', 'text', (c) => c.notNull())
		.addColumn('source_table', 'text', (c) => c.notNull())
		.addColumn('source_id', 'uuid', (c) => c.notNull())
		.addColumn('dated_on', 'date', (c) => c.notNull())
		.addColumn('exported_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addColumn('transaction_text', 'text', (c) => c.notNull())
		.addUniqueConstraint('ledger_export_source_table_source_id_event_key', [
			'source_table',
			'source_id',
			'event'
		])
		.execute();

	/**
	 * UNUSED, PLANNED. Which account in the operator's own ledger each kind of
	 * posting goes to. Nothing supplies a default: a default would be one
	 * business's chart applied to every other.
	 */
	await db.schema
		.createTable('account_map')
		/** What the account is for. */
		.addColumn('role', 'text', (c) => c.primaryKey())
		/** The account name exactly as the operator's ledger has it. */
		.addColumn('account', 'text', (c) => c.notNull())
		.execute();
}
