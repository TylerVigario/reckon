// What can go on a line.
//
// A service is configured, not categorised. What it is charged per -- the hour,
// the mile, or each -- how finely time is billed, whether there is a minimum,
// and whom it pays are all values an operator sets, not kinds built into the
// schema.
//
// A price is an effective-dated row, never a column: a rate is true for a
// period, and invoice_line stores what was billed rather than looking it up, or
// changing a price silently rewrites history. A price counts heads -- rate is
// the first person and additional_rate each one after. The most specific price
// that has started wins: one client's before every client's.
//
// Pay is a set of dated rules, resolved by #lib/server/valuation. A material is
// sold from lots, and each lot keeps its cost before tax and the tax paid on
// it, which Reg 1701 lets come off the measure when the goods are resold.
import { sql, type Kysely, type SqlBool } from 'kysely';
import { recorded, versioned } from './record.ts';

export async function catalogue(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable('service')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('code', 'text', (c) => c.notNull().unique())
		.addColumn('name', 'text', (c) => c.notNull())
		/** What a quantity of it is: an hour, a mile, or each -- which is how a service charges a flat rate. */
		.addColumn('unit', sql`service_unit`, (c) => c.notNull())
		/**
		 * UNUSED, PLANNED. Whether lines of this service are taxed. The service
		 * page saves it; nothing builds invoice lines from it yet, and each line
		 * carries its own taxable.
		 */
		.addColumn('taxable', 'boolean', (c) => c.notNull().defaultTo(false))
		.addColumn('active', 'boolean', (c) => c.notNull().defaultTo(true))
		/**
		 * Whether this service appears in the timer. Independent of unit: a
		 * service charged per mile may still be worth timing.
		 */
		.addColumn('time_tracked', 'boolean', (c) => c.notNull().defaultTo(true))
		/**
		 * Time billed to the nearest this many seconds: 60 is the nearest minute,
		 * 900 the nearest quarter hour. Null bills the exact time. Only for a
		 * service charged by the hour. Pay is never rounded this way: it is
		 * counted as worked.
		 */
		.addColumn('bill_to_nearest_seconds', 'integer', (c) =>
			c.check(sql`bill_to_nearest_seconds > 0`)
		)
		/** The least one entry of it bills, whatever its quantity. Null for none. */
		.addColumn('minimum_charge', sql`numeric(13, 3)`, (c) => c.check(sql`minimum_charge >= 0`))
		/**
		 * The uuid a phone made for it, where it was added there with no signal:
		 * what a time entry or a trip using it names until it arrives.
		 */
		.addColumn('client_uuid', 'uuid', (c) => c.unique())
		.addCheckConstraint(
			'service_increment_is_for_time',
			sql`unit = 'hour' or bill_to_nearest_seconds is null`
		)
		.execute();
	await db.schema
		.createIndex('service_time_tracked')
		.on('service')
		.column('time_tracked')
		.where(sql<SqlBool>`time_tracked`)
		.execute();

	await db.schema
		.createTable('service_price')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('service_id', 'uuid', (c) =>
			c.notNull().references('service.id').onDelete('cascade')
		)
		.addColumn('entity_id', 'uuid', (c) => c.references('entity.id').onDelete('cascade'))
		/**
		 * The rate for the first person -- per hour, per mile or each, in the
		 * service's unit. A price for one of something, so to four places, finer
		 * than the currency where it needs to be: 0.725 a mile. What it bills is
		 * rounded to the currency's places.
		 */
		.addColumn('rate', sql`numeric(12, 4)`, (c) => c.notNull().check(sql`rate >= 0`))
		.addColumn('effective_from', 'date', (c) => c.notNull())
		/**
		 * What each person after the first adds to the hourly price: at 120.00 and
		 * 70.00, a crew of three is 260.00 an hour. To four places, as the rate.
		 */
		.addColumn('additional_rate', sql`numeric(12, 4)`, (c) =>
			c
				.notNull()
				.defaultTo('0')
				.check(sql`additional_rate >= 0`)
		)
		.addUniqueConstraint(
			'service_price_scope',
			['service_id', 'entity_id', 'effective_from'],
			(u) => u.nullsNotDistinct()
		)
		.execute();
	await db.schema
		.createIndex('service_price_asof')
		.on('service_price')
		.column('service_id')
		.expression(sql`effective_from desc nulls last`)
		.execute();

	/**
	 * Who a service pays, for what, and how. The most specific rule that has
	 * started wins: a rule for one client beats one for every client, then a rule
	 * for one person beats one for their role, then the newest. "nothing" exists so
	 * a narrower rule can switch a wider one off, for one client or one person.
	 */
	await db.schema
		.createTable('pay_rule')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('service_id', 'uuid', (c) =>
			c.notNull().references('service.id').onDelete('cascade')
		)
		.addColumn('role_id', 'uuid', (c) => c.references('role.id').onDelete('restrict'))
		.addColumn('user_id', 'uuid', (c) => c.references('user.id').onDelete('cascade'))
		.addColumn('entity_id', 'uuid', (c) => c.references('entity.id').onDelete('cascade'))
		/**
		 * What was contributed. time pays the person who spent it, on hours that
		 * are billed. covered_time pays for hours a retainer covers, as a share of
		 * the retainer. vehicle pays whoever owns the vehicle a trip was driven
		 * in, on each leg it bills, so the business's own pays nobody and the
		 * business keeps it.
		 */
		.addColumn('pays_for', sql`pays_for`, (c) => c.notNull())
		/**
		 * per_hour: amount an hour worked, counted to the second. percent: amount
		 * percent of the line before tax; for covered_time, amount percent of the
		 * period's retainer charge, divided by each person's part of the covered
		 * time. fixed: amount per entry, however long, or per leg for a vehicle.
		 * nothing: no pay. A vehicle is never paid per_hour: a mile has no hours.
		 */
		.addColumn('method', sql`pay_rule_method`, (c) => c.notNull())
		.addColumn('amount', sql`numeric(12, 4)`)
		.addColumn('effective_from', 'date', (c) => c.notNull())
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addUniqueConstraint(
			'pay_rule_scope',
			['service_id', 'role_id', 'user_id', 'entity_id', 'pays_for', 'effective_from'],
			(u) => u.nullsNotDistinct()
		)
		.addCheckConstraint(
			'pay_rule_amount_fits_method',
			sql`(method = 'nothing' and amount is null)
				or (method = 'percent' and amount is not null and amount >= 0 and amount <= 100)
				or (method in ('per_hour', 'fixed') and amount is not null and amount >= 0)`
		)
		.addCheckConstraint(
			'pay_rule_covered_time_is_a_share',
			sql`pays_for <> 'covered_time' or method in ('percent', 'nothing')`
		)
		// A vehicle is paid for miles, which have no hours to count.
		.addCheckConstraint(
			'pay_rule_vehicle_is_not_by_the_hour',
			sql`pays_for <> 'vehicle' or method <> 'per_hour'`
		)
		.addCheckConstraint('pay_rule_names_one_payee', sql`num_nonnulls(role_id, user_id) = 1`)
		.execute();
	await db.schema
		.createIndex('pay_rule_by_service')
		.on('pay_rule')
		.columns(['service_id', 'pays_for'])
		.expression(sql`effective_from desc nulls last`)
		.execute();

	/**
	 * What things are counted in: the operator's own list, named once and used
	 * wherever stock or a line counts something -- a foot of cable, a box of 25, a
	 * painter's gallon, a caterer's tray. `short` is how it is written beside a
	 * figure ("ft"); `places` is how many decimal places a quantity in it may have,
	 * 0 for whole things and at most 4, as quantities are held.
	 *
	 * Not what a service is charged by: hour, mile and each decide how time and
	 * trips are counted, so they are the service's own (service_unit).
	 *
	 * No conversion between units: a box of 25 is a unit of its own.
	 */
	await db.schema
		.createTable('unit')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('name', 'text', (c) => c.notNull().unique())
		.addColumn('short', 'text')
		.addColumn('places', 'integer', (c) =>
			c
				.notNull()
				.defaultTo(0)
				.check(sql`places between 0 and 4`)
		)
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addCheckConstraint('unit_name_is_something', sql`btrim(name) <> ''`)
		.execute();

	// The two units every material was counted in until the list was the
	// operator's: each, in whole numbers, and the foot, to two places.
	await db
		.insertInto('unit')
		.values([
			{ name: 'each', short: null, places: 0 },
			{ name: 'foot', short: 'ft', places: 2 }
		])
		.execute();

	await db.schema
		.createTable('material')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('sku', 'text', (c) => c.unique())
		.addColumn('name', 'text', (c) => c.notNull())
		.addColumn('brand', 'text')
		/** What it is counted in, one of the operator's units. */
		.addColumn('unit_id', 'uuid', (c) => c.notNull().references('unit.id').onDelete('restrict'))
		/** Null takes operator.default_markup_pct. Set it here to override one item. */
		.addColumn('markup_pct', sql`numeric(7, 4)`, (c) => c.check(sql`markup_pct >= 0`))
		.addColumn('taxable', 'boolean', (c) => c.notNull().defaultTo(true))
		/** UNUSED, PLANNED. The stock level at which to buy more. Nothing reads it yet. */
		.addColumn('reorder_level', sql`numeric(12, 4)`, (c) => c.check(sql`reorder_level >= 0`))
		.addColumn('active', 'boolean', (c) => c.notNull().defaultTo(true))
		/** Each save counts, so a change made from an old copy is told of one since. */
		.addColumn('version', 'integer', (c) => c.notNull().defaultTo(1))
		/**
		 * The uuid a phone made for it, where it was received there with no
		 * signal: what a line drawing from it names until it arrives.
		 */
		.addColumn('client_uuid', 'uuid', (c) => c.unique())
		.execute();

	await db.schema
		.createTable('material_price')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('material_id', 'uuid', (c) =>
			c.notNull().references('material.id').onDelete('cascade')
		)
		/**
		 * What it sells at from that day, a unit; empty is back to its markup over
		 * cost from that day, so every price it has had stays in its history.
		 */
		.addColumn('price', sql`numeric(12, 4)`, (c) => c.check(sql`price >= 0`))
		.addColumn('effective_from', 'date', (c) => c.notNull())
		.addUniqueConstraint('material_price_material_id_effective_from_key', [
			'material_id',
			'effective_from'
		])
		.execute();

	/**
	 * WHAT WAS BOUGHT ON ONE RECEIPT OR INVOICE: from whom, on which day, its
	 * number, who paid, the tax it charged, and the paper itself, kept once.
	 * Its items are the lots it brought in, each of them in its own unit, as
	 * ERPNext's Purchase Receipt is a supplier, a date and an Items table.
	 *
	 * The tax is the receipt's total, as it is printed: each lot carries its
	 * share of it, split by what each cost before tax (#lib/receipt-split).
	 */
	await db.schema
		.createTable('stock_receipt')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('received_on', 'date', (c) => c.notNull())
		.addColumn('supplier', 'text')
		/** The receipt's or the invoice's own number, where it has one. */
		.addColumn('reference', 'text')
		/** Who paid: a person, who is owed it back, or the business when empty. */
		.addColumn('paid_by', 'uuid', (c) => c.references('user.id').onDelete('restrict'))
		/** The tax the receipt charged, all of it. */
		.addColumn('tax_paid', sql`numeric(13, 3)`, (c) =>
			c
				.notNull()
				.defaultTo('0')
				.check(sql`tax_paid >= 0`)
		)
		/** The receipt or invoice, as the phone shrank it, and its type. */
		.addColumn('receipt', 'bytea')
		.addColumn('receipt_type', sql`receipt_type`)
		/** The uuid it was made with, on the page or a phone: sent twice, it is one receipt. */
		.addColumn('client_uuid', 'uuid', (c) => c.unique())
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addCheckConstraint(
			'stock_receipt_receipt_comes_with_its_type',
			sql`(receipt is null) = (receipt_type is null)`
		)
		// What the phone sends is shrunk to well under this; a file this size is
		// not a receipt.
		.addCheckConstraint('stock_receipt_receipt_size_check', sql`octet_length(receipt) <= 2097152`)
		.execute();

	/**
	 * A COUNT OF WHAT IS ON THE SHELF, on a day: as many materials as were
	 * counted, each with what was counted (stock_count_line). Open while it is
	 * counted, and applied once: each difference then becomes an adjustment that
	 * names it. One is open at a time, which anyone counting adds to.
	 */
	await db.schema
		.createTable('stock_count')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('counted_on', 'date', (c) => c.notNull())
		/** The uuid a phone started it with, where it was started there. */
		.addColumn('client_uuid', 'uuid')
		.addColumn('created_by', 'uuid', (c) => c.notNull().references('user.id').onDelete('restrict'))
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		/** When it was applied, and by whom; empty while it is being counted. */
		.addColumn('applied_at', 'timestamptz')
		.addColumn('applied_by', 'uuid', (c) => c.references('user.id').onDelete('restrict'))
		.addCheckConstraint(
			'stock_count_applied_by_someone',
			sql`(applied_at is null) = (applied_by is null)`
		)
		.addUniqueConstraint('stock_count_created_by_client_uuid_key', ['created_by', 'client_uuid'])
		.execute();
	await db.schema
		.createIndex('stock_count_one_open')
		.on('stock_count')
		.unique()
		.expression(sql`(applied_at is null)`)
		.where(sql<SqlBool>`applied_at is null`)
		.execute();

	/**
	 * ONE MATERIAL, COUNTED: what was there, and what the shelf said when it was
	 * counted -- so stock that moves before the count is applied is told, as
	 * Odoo tells it, rather than written over. A cost each only where the shelf
	 * has nothing to cost what turned up by.
	 */
	await db.schema
		.createTable('stock_count_line')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('count_id', 'uuid', (c) =>
			c.notNull().references('stock_count.id').onDelete('cascade')
		)
		.addColumn('material_id', 'uuid', (c) =>
			c.notNull().references('material.id').onDelete('restrict')
		)
		.addColumn('counted', sql`numeric(12, 4)`, (c) => c.notNull().check(sql`counted >= 0`))
		.addColumn('on_hand', sql`numeric(12, 4)`, (c) => c.notNull().check(sql`on_hand >= 0`))
		.addColumn('cost_each', sql`numeric(12, 4)`, (c) => c.check(sql`cost_each >= 0`))
		.addColumn('counted_by', 'uuid', (c) => c.notNull().references('user.id').onDelete('restrict'))
		.addColumn('counted_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		// Counted again, a material's line is changed, not added to.
		.addUniqueConstraint('stock_count_line_once', ['count_id', 'material_id'])
		.execute();

	/**
	 * ONE MATERIAL'S STOCK, PUT RIGHT BY HAND: so much taken off the shelf or put
	 * on it, on a day, and why -- what ERPNext calls a Material Issue or Receipt,
	 * with the reason said. What it moved is held at what it cost, before tax and
	 * in tax: what a take wrote off, or what a find is worth on the shelf.
	 *
	 * A take's quantity comes off the oldest lots first, as a line's draw does
	 * (stock_take); a find is a lot of its own, which names this rather than a
	 * receipt (material_lot.adjustment_id).
	 */
	await db.schema
		.createTable('stock_adjustment')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('material_id', 'uuid', (c) =>
			c.notNull().references('material.id').onDelete('restrict')
		)
		.addColumn('made_on', 'date', (c) => c.notNull())
		/** Which way an adjustment moves stock: taken off the shelf, or put on it. */
		.addColumn('way', sql`stock_adjustment_way`, (c) => c.notNull())
		.addColumn('qty', sql`numeric(12, 4)`, (c) => c.notNull().check(sql`qty > 0`))
		/**
		 * Why: used in the shop, damaged, lost or stolen, returned to the supplier,
		 * found, a correction, or a count -- the first four only take off, found only
		 * puts on, and a correction or a count goes either way.
		 */
		.addColumn('reason', sql`stock_adjustment_reason`, (c) => c.notNull())
		.addColumn('note', 'text')
		// To four places, as a line drawn from stock holds what it cost.
		.addColumn('ex_tax_cost', sql`numeric(12, 4)`, (c) => c.notNull().check(sql`ex_tax_cost >= 0`))
		.addColumn('tax_paid', sql`numeric(12, 4)`, (c) =>
			c
				.notNull()
				.defaultTo('0')
				.check(sql`tax_paid >= 0`)
		)
		/** The count it puts right, where a count made it. */
		.addColumn('count_id', 'uuid', (c) => c.references('stock_count.id').onDelete('restrict'))
		/** The uuid it was made with, on the page or a phone: sent twice, it is one. */
		.addColumn('client_uuid', 'uuid')
		.addColumn('created_by', 'uuid', (c) => c.notNull().references('user.id').onDelete('restrict'))
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addUniqueConstraint('stock_adjustment_created_by_client_uuid_key', [
			'created_by',
			'client_uuid'
		])
		// A find only puts on; using, damage, loss and a return only take off.
		.addCheckConstraint(
			'stock_adjustment_reason_fits_its_way',
			sql`(way = 'on' and reason in ('found', 'correction', 'counted'))
				or (way = 'off' and reason <> 'found')`
		)
		// A count's adjustments, and only those, name it.
		.addCheckConstraint(
			'stock_adjustment_counted_names_its_count',
			sql`(reason = 'counted') = (count_id is not null)`
		)
		.execute();
	await db.schema
		.createIndex('stock_adjustment_material')
		.on('stock_adjustment')
		.columns(['material_id', 'made_on'])
		.execute();
	await db.schema
		.createIndex('stock_adjustment_count')
		.on('stock_adjustment')
		.column('count_id')
		.execute();

	await db.schema
		.createTable('material_lot')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		/** The receipt it came on (stock_receipt), or the adjustment that found it. */
		.addColumn('receipt_id', 'uuid', (c) => c.references('stock_receipt.id').onDelete('restrict'))
		.addColumn('adjustment_id', 'uuid', (c) =>
			c.references('stock_adjustment.id').onDelete('restrict')
		)
		.addColumn('material_id', 'uuid', (c) =>
			c.notNull().references('material.id').onDelete('restrict')
		)
		/** The day it came onto the shelf: its receipt's. Oldest is drawn first. */
		.addColumn('received_on', 'date', (c) => c.notNull())
		.addColumn('qty_received', sql`numeric(12, 4)`, (c) => c.notNull().check(sql`qty_received > 0`))
		.addColumn('qty_remaining', sql`numeric(12, 4)`, (c) =>
			c.notNull().check(sql`qty_remaining >= 0`)
		)
		/**
		 * What all of it cost before tax, as the receipt says it, and its share of
		 * the receipt's tax: 1,000 ft for 310.00 and 24.80. A unit's share is
		 * worked out from these, so nothing is lost to rounding a cost per foot.
		 */
		.addColumn('ex_tax_cost', sql`numeric(13, 3)`, (c) => c.notNull().check(sql`ex_tax_cost >= 0`))
		.addColumn('tax_paid', sql`numeric(13, 3)`, (c) =>
			c
				.notNull()
				.defaultTo('0')
				.check(sql`tax_paid >= 0`)
		)
		// What a draw names, so the lot it comes off is of the line's material.
		.addUniqueConstraint('material_lot_id_material_id_key', ['id', 'material_id'])
		// It came on a receipt, or was found: one, never both or neither.
		.addCheckConstraint(
			'material_lot_has_one_origin',
			sql`(receipt_id is null) <> (adjustment_id is null)`
		)
		.addCheckConstraint('cannot_use_more_than_received', sql`qty_remaining <= qty_received`)
		.execute();
	await db.schema
		.createIndex('material_lot_open')
		.on('material_lot')
		.columns(['material_id', 'received_on'])
		.where(sql<SqlBool>`qty_remaining > 0`)
		.execute();
	await db.schema
		.createIndex('material_lot_receipt')
		.on('material_lot')
		.column('receipt_id')
		.execute();

	/**
	 * What a take took off each lot: 5 ft of a spool, the oldest first. A lot's
	 * qty_remaining follows these as it does a line's draws (stock_follows_draws),
	 * so a take larger than what is left is refused by the lot's own check.
	 */
	await db.schema
		.createTable('stock_take')
		.addColumn('adjustment_id', 'uuid', (c) =>
			c.notNull().references('stock_adjustment.id').onDelete('restrict')
		)
		.addColumn('material_lot_id', 'uuid', (c) => c.notNull())
		.addColumn('material_id', 'uuid', (c) => c.notNull())
		.addColumn('qty', sql`numeric(12, 4)`, (c) => c.notNull().check(sql`qty > 0`))
		.addPrimaryKeyConstraint('stock_take_pkey', ['adjustment_id', 'material_lot_id'])
		.addForeignKeyConstraint(
			'stock_take_lot_fkey',
			['material_lot_id', 'material_id'],
			'material_lot',
			['id', 'material_id'],
			(f) => f.onDelete('restrict')
		)
		.execute();
	await db.schema
		.createIndex('stock_take_lot')
		.on('stock_take')
		.column('material_lot_id')
		.execute();

	// What a material is counted in stays as it was once any of it has been
	// received, as Odoo and ERPNext refuse it once stock has moved: 1,000
	// counted in feet would otherwise read as 1,000 of something else.
	await sql`
		create function a_unit_is_kept_once_received() returns trigger
		language plpgsql as $function$
		BEGIN
		  IF NEW.unit_id IS DISTINCT FROM OLD.unit_id
		     AND EXISTS (SELECT 1 FROM material_lot WHERE material_id = OLD.id) THEN
		    RAISE EXCEPTION 'material % has been received in its unit, which stays as it was', OLD.id
		      USING ERRCODE = 'integrity_constraint_violation';
		  END IF;
		  RETURN NEW;
		END $function$`.execute(db);
	await sql`create trigger a_unit_is_kept_once_received before update of unit_id on material
		for each row execute function a_unit_is_kept_once_received()`.execute(db);

	// One count is open at a time; an applied one, and what was counted on it,
	// stay as they were.
	await sql`
		create function a_count_stays_as_applied() returns trigger
		language plpgsql as $function$
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
		END $function$`.execute(db);
	await sql`create trigger a_count_stays_as_applied before update or delete on stock_count
		for each row execute function a_count_stays_as_applied()`.execute(db);
	await sql`create trigger a_count_line_stays_as_applied
		before insert or update or delete on stock_count_line
		for each row execute function a_count_stays_as_applied()`.execute(db);

	// STOCK FOLLOWS ITS DRAWS. What a draw takes comes off its lot, and goes back
	// when the draw goes -- with its line, or with a deleted draft. A draw larger
	// than what is left is refused by the lot's own check, so two people drawing
	// the last of a spool at once cannot both have it.
	await sql`
		create function stock_follows_draws() returns trigger
		language plpgsql as $function$
		BEGIN
		  IF TG_OP IN ('UPDATE', 'DELETE') THEN
		    UPDATE material_lot SET qty_remaining = qty_remaining + OLD.qty WHERE id = OLD.material_lot_id;
		  END IF;
		  IF TG_OP IN ('INSERT', 'UPDATE') THEN
		    UPDATE material_lot SET qty_remaining = qty_remaining - NEW.qty WHERE id = NEW.material_lot_id;
		  END IF;
		  RETURN NULL;
		END $function$`.execute(db);
	// STOCK FOLLOWS ITS TAKES, as it follows its draws (stock_draw): a take
	// larger than what is left is refused by the lot's own check.
	await sql`create trigger stock_follows_takes after insert or update or delete on stock_take
		for each row execute function stock_follows_draws()`.execute(db);

	// A service keeps its history as a material does: when it was added, every
	// field changed, and its deletion -- its prices and pay rules already keep
	// theirs.
	await recorded(db, 'service', { removals: true });
	await recorded(db, 'service_price');
	await recorded(db, 'pay_rule');
	// Each save counts (version), and history keeps every field it changed, but
	// not the count.
	await versioned(db, 'material');
	await recorded(db, 'material', { ignoring: ['version'] });
	await recorded(db, 'material_price');
	// A receipt's history, as a lot's: when it began, and every field changed.
	await recorded(db, 'stock_receipt');
	await recorded(db, 'stock_count', { removals: true });
	await recorded(db, 'stock_count_line', { removals: true });
	// An adjustment's history begins when it is made; it is not changed after.
	await recorded(db, 'stock_adjustment');
	await recorded(db, 'material_lot');
}
