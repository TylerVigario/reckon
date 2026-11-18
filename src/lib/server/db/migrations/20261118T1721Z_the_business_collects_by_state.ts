// THE BUSINESS COLLECTS TAX STATE BY STATE (18 November 2026). A business
// collects sales tax in each state it is registered with: California's CDTFA
// for a seller's permit, Nevada's department for its own. Each registration is
// its own -- what is held, who the return goes to, how often it is filed -- and
// California's has the Regulation 1701 election besides. One business-wide
// rule set ("California's rules", "a flat rate for each site") could only ever
// say one state.
//
// So a business's registrations are rows of their own, one per state, and
// where it collects is where it is registered. Collecting nowhere is having
// none. A business that collected under either rule set collected in
// California, the only state a site could be in, so its registration comes
// over as California's. One that collected nowhere but had written a
// registration down has no state to keep it under, and stops the migration:
// none can be invented.
//
// What follows from it:
//
//   A SITE IN A STATE THE BUSINESS DOES NOT COLLECT IN HAS NO AREA, and the
//   site's state is its own (region), which its area, where it has one, is in.
//   Its area and the day it was placed come together or not at all.
//
//   A TAXED LINE KEEPS ITS STATE beside its area's name, as it was billed, so
//   a return is of one state's lines. Every line taxed so far was taxed in
//   California.
//
//   A REMITTANCE IS TO ONE STATE, and one per period in each. Every one so far
//   was California's.
//
// The fiscal year stays the business's own (operator.fiscal_year_end_month):
// it is the year the business keeps its books by, not a state's.
import { sql, type Kysely } from 'kysely';
import { recorded } from './20261117T1405Z_the_schema_as_it_stands/record.ts';

const A_STATE = sql`'^[A-Z]{2}$'`;

export async function up(db: Kysely<any>): Promise<void> {
	await sql`
		DO $$
		BEGIN
		  IF EXISTS (SELECT 1 FROM operator
		              WHERE tax_rule_set = 'none'
		                AND (tax_registration IS NOT NULL OR tax_agency IS NOT NULL
		                     OR filing_basis IS NOT NULL OR claims_tax_paid_purchases_resold)) THEN
		    RAISE EXCEPTION 'a business that collects nowhere has a registration written down, and no state to keep it under'
		      USING ERRCODE = 'check_violation';
		  END IF;
		END $$`.execute(db);

	/**
	 * A STATE THE BUSINESS COLLECTS IN, because it is registered there: what it
	 * holds and from whom, and how often the return is filed. California's
	 * alone has the Reg 1701 election: tax already paid on materials resold
	 * comes off the measure -- an election, so recorded rather than inferred.
	 * Every change to one is kept, and so is one that goes, as the business's
	 * other settings are.
	 */
	await db.schema
		.createTable('tax_registration')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		/** The state, as the post writes it: CA. Registered there once. */
		.addColumn('state', 'text', (c) =>
			c
				.notNull()
				.unique()
				.check(sql`state ~ ${A_STATE}`)
		)
		/** What is held, in the issuer's words: Seller's permit. */
		.addColumn('held', 'text', (c) => c.check(sql`btrim(held) <> ''`))
		/** Who issued it, and who the return goes to: CDTFA. */
		.addColumn('agency', 'text', (c) => c.check(sql`btrim(agency) <> ''`))
		.addColumn('filing_basis', sql`filing_basis`)
		.addColumn('claims_tax_paid_purchases_resold', 'boolean', (c) => c.notNull().defaultTo(false))
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addCheckConstraint(
			'only_california_claims_tax_paid_purchases_resold',
			sql`not claims_tax_paid_purchases_resold or state = 'CA'`
		)
		.execute();
	await recorded(db, 'tax_registration', { removals: true });
	await sql`
		insert into tax_registration (state, held, agency, filing_basis, claims_tax_paid_purchases_resold)
		select 'CA', nullif(btrim(tax_registration), ''), nullif(btrim(tax_agency), ''),
		       filing_basis, claims_tax_paid_purchases_resold
		  from operator
		 where tax_rule_set <> 'none'`.execute(db);
	await db.schema
		.alterTable('operator')
		.dropColumn('tax_rule_set')
		.dropColumn('tax_registration')
		.dropColumn('tax_agency')
		.dropColumn('filing_basis')
		.dropColumn('claims_tax_paid_purchases_resold')
		.execute();
	await db.schema.dropType('tax_rule_set').execute();

	// A site is in a state, and in an area only where the business collects
	// there; its area and the day it was placed come together. A site with no
	// state stops the migration: every address has been Google's, which names
	// one, and none can be made up.
	await db.schema
		.alterTable('site')
		.alterColumn('region', (c) => c.setNotNull())
		.alterColumn('tax_area_id', (c) => c.dropNotNull())
		.alterColumn('area_verified_on', (c) => c.dropNotNull())
		.execute();
	await db.schema
		.alterTable('site')
		.addCheckConstraint('site_is_in_a_state', sql`region ~ ${A_STATE}`)
		.execute();
	await db.schema
		.alterTable('site')
		.addCheckConstraint(
			'site_is_placed_on_a_day',
			sql`(tax_area_id is null) = (area_verified_on is null)`
		)
		.execute();
	// Its area is in its state: a site in Reno is in no California area.
	await sql`
		create function site_is_in_its_areas_state() returns trigger
		language plpgsql as $function$
		BEGIN
		  IF NEW.tax_area_id IS NOT NULL
		     AND NOT EXISTS (SELECT 1 FROM tax_area a
		                      WHERE a.id = NEW.tax_area_id AND a.state = NEW.region) THEN
		    RAISE EXCEPTION 'a site in % is not in an area of another state', NEW.region
		      USING ERRCODE = 'check_violation', CONSTRAINT = 'site_is_in_its_areas_state';
		  END IF;
		  RETURN NEW;
		END
		$function$`.execute(db);
	await sql`
		create trigger site_is_in_its_areas_state
		before insert or update of tax_area_id, region on site
		for each row execute function site_is_in_its_areas_state()`.execute(db);
	// And an area stays in the state it is in.
	await sql`
		create function an_area_stays_in_its_state() returns trigger
		language plpgsql as $function$
		BEGIN
		  RAISE EXCEPTION 'an area in % stays in %', OLD.state, OLD.state
		    USING ERRCODE = 'check_violation', CONSTRAINT = 'an_area_stays_in_its_state';
		END
		$function$`.execute(db);
	await sql`
		create trigger an_area_stays_in_its_state
		before update of state on tax_area
		for each row when (OLD.state IS DISTINCT FROM NEW.state)
		execute function an_area_stays_in_its_state()`.execute(db);

	// A taxed line keeps its state as it was billed: every one so far,
	// California. A change of form, not an edit, so the triggers that freeze a
	// sent line, count its saves and keep its history stand aside.
	await db.schema
		.alterTable('invoice_line')
		.addColumn('tax_state', 'text', (c) => c.check(sql`tax_state ~ ${A_STATE}`))
		.execute();
	await sql`alter table invoice_line disable trigger freeze_lines`.execute(db);
	await sql`alter table invoice_line disable trigger v_invoice_line`.execute(db);
	await sql`alter table invoice_line disable trigger h_invoice_line`.execute(db);
	await sql`update invoice_line set tax_state = 'CA' where tax_jurisdiction is not null`.execute(
		db
	);
	await sql`alter table invoice_line enable trigger freeze_lines`.execute(db);
	await sql`alter table invoice_line enable trigger v_invoice_line`.execute(db);
	await sql`alter table invoice_line enable trigger h_invoice_line`.execute(db);
	await db.schema
		.alterTable('invoice_line')
		.addCheckConstraint(
			'taxed_lines_say_which_state',
			sql`(tax_jurisdiction is null) = (tax_state is null)`
		)
		.execute();

	// A remittance is to one state: every one so far, California's.
	await db.schema
		.alterTable('tax_remittance')
		.addColumn('state', 'text', (c) => c.check(sql`state ~ ${A_STATE}`))
		.execute();
	await sql`update tax_remittance set state = 'CA'`.execute(db);
	await db.schema
		.alterTable('tax_remittance')
		.alterColumn('state', (c) => c.setNotNull())
		.execute();
	await db.schema.alterTable('tax_remittance').dropConstraint('one_filing_per_period').execute();
	await db.schema
		.alterTable('tax_remittance')
		.addUniqueConstraint('one_filing_per_period', ['state', 'period_start', 'period_end'])
		.execute();
}
