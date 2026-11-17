// Standing arrangements.
//
// With site_id empty, an agreement covers the client wherever the work is
// done; with it set, only that site. A client may hold one of its own, one per
// site, or both.
//
// Its price is what one period charges. What it includes is named service by
// service in agreement_service, and there is no default: capped or unlimited,
// said outright rather than by leaving a column empty. A capped allotment is a
// number of hours belonging to the agreement, whichever sites it reaches, and a
// rule for the hours beyond. An hour falls under its site's agreement when that
// lists its service, and otherwise under the client's.
//
// An agreement bills on its own anniversary, not the calendar's:
// billing_anchor_day comes off starts_on and is then left alone. A period can
// be given -- written, with nothing charged, on purpose -- because a $0 period
// on its own reads the same as a mistake.
import { sql, type Kysely } from 'kysely';
import { recorded } from './record.ts';

export async function agreements(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable('agreement')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('entity_id', 'uuid', (c) => c.notNull().references('entity.id').onDelete('restrict'))
		/** What one period of the agreement charges. */
		.addColumn('price', sql`numeric(13, 3)`, (c) => c.notNull().check(sql`price >= 0`))
		.addColumn('starts_on', 'date', (c) => c.notNull())
		.addColumn('ends_on', 'date')
		/**
		 * The person this was agreed with. A retainer is agreed with somebody by
		 * name, and when it is questioned a year later that name is the answer.
		 * Losing the contact must not lose the agreement.
		 */
		.addColumn('contact_id', 'uuid', (c) => c.references('contact.id').onDelete('set null'))
		/** How often it bills. The period it covers is agreement_period; this is the rule that generates one. */
		.addColumn('billing_interval', sql`billing_interval`, (c) => c.notNull().defaultTo('monthly'))
		/**
		 * The day of the month this bills on, taken from starts_on and then left
		 * alone. Kept as a number rather than read back off the last invoice: a
		 * 31st anchor bills 28 February and must still bill 31 March.
		 */
		.addColumn('billing_anchor_day', 'smallint', (c) =>
			c.notNull().check(sql`billing_anchor_day >= 1 and billing_anchor_day <= 31`)
		)
		/**
		 * What happens to a period this agreement did not finish. daily: the
		 * client is billed the days they had. none: the last period bills whole,
		 * whenever it ended. Only ever applies to the period containing ends_on --
		 * every other period is whole, because billing is anchored to starts_on.
		 */
		.addColumn('final_period_proration', sql`final_period_proration`, (c) =>
			c.notNull().defaultTo('daily')
		)
		/**
		 * The one site this agreement is for, or empty for the client as a whole.
		 * A site's agreement covers work there; the client's covers work anywhere
		 * else. It must be one of the client's own sites.
		 */
		.addColumn('site_id', 'uuid')
		.addForeignKeyConstraint(
			'agreement_site_is_the_clients',
			['site_id', 'entity_id'],
			'site',
			['id', 'entity_id'],
			(f) => f.onDelete('restrict')
		)
		.addCheckConstraint(
			'agreement_ends_after_it_starts',
			sql`ends_on is null or ends_on >= starts_on`
		)
		.execute();
	// agreement_contact_is_the_clients -- the contact must be the client's --
	// nulls only contact_id when the person leaves, which Kysely's builder
	// cannot express, so it is written in SQL.
	await sql`alter table agreement
		add constraint agreement_contact_is_the_clients foreign key (entity_id, contact_id)
		references entity_contact (entity_id, contact_id) on delete set null (contact_id)`.execute(db);

	/**
	 * One row per service an agreement covers, with its allotment: unlimited, or
	 * included_hours each period and an overage rule. The hours belong to the
	 * agreement and are shared by every site it reaches. Only hours of a listed
	 * service draw on it; anything else bills as usual.
	 */
	await db.schema
		.createTable('agreement_service')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('agreement_id', 'uuid', (c) =>
			c.notNull().references('agreement.id').onDelete('cascade')
		)
		.addColumn('service_id', 'uuid', (c) =>
			c.notNull().references('service.id').onDelete('restrict')
		)
		.addColumn('allotment', sql`allotment`, (c) => c.notNull())
		.addColumn('included_hours', sql`numeric(8, 2)`, (c) => c.check(sql`included_hours >= 0`))
		.addColumn('overage', sql`overage`)
		.addUniqueConstraint('agreement_service_once', ['agreement_id', 'service_id'])
		.addCheckConstraint(
			'agreement_service_cap_is_whole',
			sql`(allotment = 'capped' and included_hours is not null and overage is not null) or (allotment = 'unlimited' and included_hours is null and overage is null)`
		)
		.execute();

	await db.schema
		.createTable('agreement_period')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('agreement_id', 'uuid', (c) =>
			c.notNull().references('agreement.id').onDelete('restrict')
		)
		.addColumn('period_start', 'date', (c) => c.notNull())
		.addColumn('period_end', 'date', (c) => c.notNull())
		.addColumn('amount', sql`numeric(13, 3)`, (c) => c.notNull().check(sql`amount >= 0`))
		/**
		 * This period was given: covered, and deliberately not charged. Its amount
		 * is 0, and given says the 0 is on purpose.
		 */
		.addColumn('given', 'boolean', (c) => c.notNull().defaultTo(false))
		.addUniqueConstraint('agreement_period_agreement_id_period_start_key', [
			'agreement_id',
			'period_start'
		])
		.addCheckConstraint('agreement_period_given_charges_nothing', sql`not given or amount = 0`)
		.addCheckConstraint('period_ends_after_it_starts', sql`period_end >= period_start`)
		.execute();

	await recorded(db, 'agreement');
	await recorded(db, 'agreement_service');
}
