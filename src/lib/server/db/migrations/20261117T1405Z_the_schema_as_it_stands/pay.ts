// What a person was paid, as it was paid. Pay is worked out live from the work
// and the rules (#lib/server/valuation); a payment records what it came to on
// the day, so a later role or rule moves only what is still unpaid. reckon
// records a payment; the money moves at the bank.
import { sql, type Kysely, type SqlBool } from 'kysely';

export async function pay(db: Kysely<any>): Promise<void> {
	/**
	 * A payment to one person: the day it was made, how, and a note. Never changed
	 * once recorded; a correction is an item on the next one.
	 */
	await db.schema
		.createTable('person_payment')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('user_id', 'uuid', (c) => c.notNull().references('user.id').onDelete('restrict'))
		.addColumn('paid_on', 'date', (c) => c.notNull())
		/** How it was paid: a bank transfer, cash, a check. */
		.addColumn('how', 'text', (c) => c.notNull())
		.addColumn('note', 'text')
		/** Made where it was recorded, so a save sent twice is one payment. */
		.addColumn('client_uuid', 'uuid', (c) => c.notNull())
		.addColumn('created_by', 'uuid', (c) => c.notNull().references('user.id').onDelete('restrict'))
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		// The phone's uuid, unique to whoever recorded the payment (#lib/queue).
		.addUniqueConstraint('person_payment_created_by_client_uuid_key', ['created_by', 'client_uuid'])
		// What an item names as its payment must be its own person's.
		.addUniqueConstraint('person_payment_id_user_id_key', ['id', 'user_id'])
		.addCheckConstraint('person_payment_how_is_something', sql`btrim(how) <> ''`)
		.execute();
	await db.schema
		.createIndex('person_payment_by_person')
		.on('person_payment')
		.columns(['user_id', 'paid_on'])
		.execute();

	/**
	 * What a payment covered, each as it was worked out that day: an entry's time,
	 * a trip's miles for the vehicle the person owns, or a correction to an earlier
	 * payment, plus or minus. `said` is how the figure was reached -- the hours and
	 * the rule, in words -- and `paid_as` what it paid, both kept as they were,
	 * whatever the rules or the person's role say later. A piece of work is paid to
	 * a person once.
	 */
	await db.schema
		.createTable('person_payment_item')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('payment_id', 'uuid', (c) => c.notNull())
		.addColumn('user_id', 'uuid', (c) => c.notNull())
		.addColumn('time_entry_id', 'uuid', (c) => c.references('time_entry.id').onDelete('restrict'))
		.addColumn('trip_id', 'uuid', (c) => c.references('trip.id').onDelete('restrict'))
		.addColumn('corrects_payment_id', 'uuid')
		.addColumn('amount', sql`numeric(13, 3)`, (c) => c.notNull())
		.addColumn('said', 'text', (c) => c.notNull())
		/**
		 * What it paid: the person's pay, as their role says it is, or a
		 * reimbursement -- what a trip pays the owner of the vehicle, whatever
		 * their role. A correction says which part of the earlier payment it
		 * corrects.
		 */
		.addColumn('paid_as', sql`paid_as`, (c) => c.notNull())
		.addCheckConstraint(
			'person_payment_item_is_one_thing',
			sql`num_nonnulls(time_entry_id, trip_id, corrects_payment_id) = 1`
		)
		// Only a correction can take something back.
		.addCheckConstraint(
			'person_payment_item_pays',
			sql`amount >= 0 or corrects_payment_id is not null`
		)
		.addCheckConstraint('person_payment_item_says_how', sql`btrim(said) <> ''`)
		// A trip pays back the vehicle; time is pay.
		.addCheckConstraint(
			'person_payment_item_paid_as_fits',
			sql`(trip_id is null or paid_as = 'reimbursement')
				and (time_entry_id is null or paid_as <> 'reimbursement')`
		)
		// A correction is to another payment, made before.
		.addCheckConstraint(
			'person_payment_item_corrects_another',
			sql`corrects_payment_id is distinct from payment_id`
		)
		.addForeignKeyConstraint(
			'person_payment_item_payment_is_the_persons',
			['payment_id', 'user_id'],
			'person_payment',
			['id', 'user_id'],
			(f) => f.onDelete('restrict')
		)
		.addForeignKeyConstraint(
			'person_payment_item_corrects_is_the_persons',
			['corrects_payment_id', 'user_id'],
			'person_payment',
			['id', 'user_id'],
			(f) => f.onDelete('restrict')
		)
		.execute();
	await db.schema
		.createIndex('person_payment_item_entry_once')
		.on('person_payment_item')
		.columns(['user_id', 'time_entry_id'])
		.unique()
		.where(sql<SqlBool>`time_entry_id is not null`)
		.execute();
	await db.schema
		.createIndex('person_payment_item_trip_once')
		.on('person_payment_item')
		.columns(['user_id', 'trip_id'])
		.unique()
		.where(sql<SqlBool>`trip_id is not null`)
		.execute();
	await db.schema
		.createIndex('person_payment_item_payment')
		.on('person_payment_item')
		.column('payment_id')
		.execute();

	// A payment is never changed once recorded: a correction is an item on the next
	// one, saying which it corrects.
	await sql`
		create function a_payment_stands() returns trigger
		language plpgsql as $function$
		BEGIN
		  RAISE EXCEPTION 'a payment is not changed once recorded: correct it on the next payment'
		    USING ERRCODE = 'integrity_constraint_violation';
		END $function$`.execute(db);
	await sql`create trigger a_payment_stands before update or delete on person_payment
		for each row execute function a_payment_stands()`.execute(db);
	await sql`create trigger a_payment_stands before update or delete on person_payment_item
		for each row execute function a_payment_stands()`.execute(db);
}
