// A RETURN AND A PAYMENT, APART (27 November 2026, #203). What was handed to a
// state was one row, a remittance -- a period, the day it was filed, the day it
// was paid and an amount -- and nothing wrote one. But the agencies keep the
// return and the money apart:
//
//   A RETURN is for one period of one state's, filed on a day, and says what tax
//   the period owes: California's net tax (CDTFA-401-A, line 21), before its
//   prepayments, penalty and interest. Where the state lets the seller keep a
//   share for filing on time, it says what was kept: Nevada's 0.25% (NRS
//   372.370), Texas's 0.5% and 1.25% of a prepayment (Tax Code s. 151.423,
//   151.424); California keeps none. A return filed again for its period is an
//   amended return, and names the one it corrects: CDTFA "will apply payments
//   you made with the original return filing to your amended return".
//
//   A PAYMENT is for one period, paid on a day: with its return, after it -- "If
//   you did not pay at the time you filed your return or you need to make an
//   additional payment, you can pay online" (CDTFA) -- or before it, as a
//   prepayment is "a credit against the amount of the taxes due ... for the
//   quarterly period" (R&TC s. 6473). Penalty and interest are said apart from
//   the tax (R&TC s. 6591; the return's lines 24 and 25): they are the seller's
//   own cost, not tax it collected.
//
// Each stands as recorded; one recorded by mistake is taken off, and its history
// keeps what it was. A state's periods are each one period: two of its returns'
// or payments' that overlap are the same.
//
// Whatever remittance a person wrote by hand carries over as what it said: a
// return where it was filed, for what was handed over, and a payment of that,
// on the day it was paid -- or filed, or recorded -- against whoever recorded it.
import { sql, type Kysely } from 'kysely';
import { recorded } from './20261117T1405Z_the_schema_as_it_stands/record.ts';

const A_STATE = sql`'^[A-Z]{2}$'`;
const MONEY = sql`numeric(13, 3)`;
const A_REFERENCE = sql`btrim(reference) <> '' and length(reference) <= 60`;

export async function up(db: Kysely<any>): Promise<void> {
	/** A RETURN FILED with a state, for one of its periods. */
	await db.schema
		.createTable('tax_return')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('state', 'text', (c) => c.notNull().check(sql`state ~ ${A_STATE}`))
		.addColumn('period_start', 'date', (c) => c.notNull())
		.addColumn('period_end', 'date', (c) => c.notNull())
		.addColumn('filed_on', 'date', (c) => c.notNull())
		// What it says the period owes, before prepayments, penalty and interest.
		.addColumn('tax', MONEY, (c) => c.notNull().check(sql`tax >= 0`))
		// What the state let the seller keep of it, for filing on time.
		.addColumn('kept', MONEY, (c) =>
			c
				.notNull()
				.defaultTo(0)
				.check(sql`kept >= 0`)
		)
		// The agency's confirmation number.
		.addColumn('reference', 'text', (c) => c.check(A_REFERENCE))
		// The return it amends, for the same period: it stands in that one's place.
		.addColumn('amends', 'uuid', (c) => c.unique().references('tax_return.id').onDelete('restrict'))
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addCheckConstraint('a_return_period_ends_after_it_starts', sql`period_end >= period_start`)
		.addCheckConstraint('a_return_is_filed_once_its_period_ends', sql`filed_on >= period_end`)
		.addCheckConstraint('what_is_kept_is_of_the_tax', sql`kept <= tax`)
		.addCheckConstraint('a_return_amends_another', sql`amends <> id`)
		.execute();
	// Filed once a period; again only as an amended return.
	await sql`create unique index a_state_files_a_period_once on tax_return (state, period_start, period_end)
		where amends is null`.execute(db);

	/** A PAYMENT to a state, for one of its periods. */
	await db.schema
		.createTable('tax_payment')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('state', 'text', (c) => c.notNull().check(sql`state ~ ${A_STATE}`))
		.addColumn('period_start', 'date', (c) => c.notNull())
		.addColumn('period_end', 'date', (c) => c.notNull())
		.addColumn('paid_on', 'date', (c) => c.notNull())
		// The tax handed over, and apart from it the penalty and interest.
		.addColumn('tax', MONEY, (c) => c.notNull().check(sql`tax >= 0`))
		.addColumn('penalty_and_interest', MONEY, (c) =>
			c
				.notNull()
				.defaultTo(0)
				.check(sql`penalty_and_interest >= 0`)
		)
		.addColumn('reference', 'text', (c) => c.check(A_REFERENCE))
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addCheckConstraint('a_payment_period_ends_after_it_starts', sql`period_end >= period_start`)
		.addCheckConstraint('a_payment_hands_something_over', sql`tax + penalty_and_interest > 0`)
		.execute();
	await sql`create index tax_payment_state_period_idx on tax_payment (state, period_start)`.execute(
		db
	);

	// Each stands as it was recorded.
	await sql`
		create function stands_as_recorded() returns trigger
		language plpgsql as $function$
		BEGIN
		  RAISE EXCEPTION '% stands as it was recorded: one recorded by mistake is taken off', TG_TABLE_NAME
		    USING ERRCODE = 'check_violation', CONSTRAINT = TG_ARGV[0];
		END $function$`.execute(db);
	await sql`
		create trigger a_return_stands before update on tax_return
		for each row execute function stands_as_recorded('a_return_stands')`.execute(db);
	await sql`
		create trigger a_payment_stands before update on tax_payment
		for each row execute function stands_as_recorded('a_payment_stands')`.execute(db);

	// A state's periods are each one period, and an amended return is for its
	// return's. Taken one state at a time, so two recorded at once are each
	// read against the other.
	await sql`
		create function a_state_s_periods_hold() returns trigger
		language plpgsql as $function$
		DECLARE was tax_return;
		BEGIN
		  PERFORM pg_advisory_xact_lock(hashtext('a state''s periods ' || NEW.state));
		  -- A payment has no return it amends, and plpgsql reads both sides of an AND.
		  IF TG_TABLE_NAME = 'tax_return' THEN
		    IF NEW.amends IS NOT NULL THEN
		      SELECT * INTO was FROM tax_return WHERE id = NEW.amends;
		      IF (was.state, was.period_start, was.period_end)
		         IS DISTINCT FROM (NEW.state, NEW.period_start, NEW.period_end) THEN
		        RAISE EXCEPTION 'an amended return is for the period of the return it amends'
		          USING ERRCODE = 'check_violation', CONSTRAINT = 'an_amendment_is_for_its_period';
		      END IF;
		    END IF;
		  END IF;
		  IF EXISTS (
		    SELECT 1 FROM (
		      SELECT period_start, period_end FROM tax_return WHERE state = NEW.state
		      UNION ALL
		      SELECT period_start, period_end FROM tax_payment WHERE state = NEW.state
		    ) p
		     WHERE (p.period_start, p.period_end) <> (NEW.period_start, NEW.period_end)
		       AND p.period_start <= NEW.period_end AND p.period_end >= NEW.period_start) THEN
		    RAISE EXCEPTION 'a period of %''s overlaps another of its periods', NEW.state
		      USING ERRCODE = 'check_violation', CONSTRAINT = 'a_state_s_periods_do_not_overlap';
		  END IF;
		  RETURN NEW;
		END $function$`.execute(db);
	await sql`
		create trigger a_state_s_periods_hold before insert on tax_return
		for each row execute function a_state_s_periods_hold()`.execute(db);
	await sql`
		create trigger a_state_s_periods_hold before insert on tax_payment
		for each row execute function a_state_s_periods_hold()`.execute(db);

	// Who recorded each, or took it off, and when, is its history's.
	await recorded(db, 'tax_return', { removals: true });
	await recorded(db, 'tax_payment', { removals: true });

	await sql`
		DO $$
		DECLARE r record;
		BEGIN
		  FOR r IN SELECT * FROM tax_remittance ORDER BY created_at, id LOOP
		    PERFORM set_config('reckon.user_id', r.created_by::text, true);
		    IF r.filed_on IS NOT NULL THEN
		      INSERT INTO tax_return (state, period_start, period_end, filed_on, tax, reference)
		      VALUES (r.state, r.period_start, r.period_end, r.filed_on, r.amount,
		              nullif(btrim(r.reference), ''));
		    END IF;
		    IF r.amount > 0 THEN
		      INSERT INTO tax_payment (state, period_start, period_end, paid_on, tax, reference)
		      VALUES (r.state, r.period_start, r.period_end,
		              coalesce(r.paid_on, r.filed_on, r.created_at::date), r.amount,
		              nullif(btrim(r.reference), ''));
		    END IF;
		  END LOOP;
		  PERFORM set_config('reckon.user_id', '', true);
		END $$`.execute(db);
	await db.schema.dropTable('tax_remittance').execute();
}
