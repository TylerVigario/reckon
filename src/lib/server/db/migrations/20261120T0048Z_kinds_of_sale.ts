// KINDS OF SALE, EACH ANSWERED BY EVERY STATE (19 November 2026). Whether a
// sale is taxed turns on what it is -- goods, the labour of installing or
// repairing, travel, a help desk -- and each state answers that for itself:
// California taxes the goods of a repair and not its labour; Washington
// taxes both (WAC 458-20-173); South Dakota taxes "any service ... unless the
// service is specifically exempt" (SDCL 10-45-4). One yes or no on an item
// is right in one state at most.
//
// So a material or a service says what kind of sale it is, and each state the
// business collects in says whether it taxes that kind: one answer per kind,
// not per item, its TAXABILITY, as the Streamlined Sales and Use Tax
// Agreement calls a state's answers (s. 328).
//
//   THE KINDS ARE THE BUSINESS'S OWN LIST. States do not share one -- the
//   Agreement defines few, and repair labour and travel are not among them --
//   so a business adds the kind a state treats apart. reckon's own four start
//   it, each saying which it is: goods ("tangible personal property",
//   Appendix C, Part I), installation labour (the "installation charges" a
//   member state may leave out of sales price when separately stated), repair
//   labour, and travel. They can be renamed and retired, never removed.
//
//   EVERY STATE ANSWERS EVERY KIND: collecting in a state answers each kind
//   there, and a kind is added with each state's answer. Each answer says who
//   gave it and when.
//
//   A LINE KEEPS THE KIND IT WAS SOLD AS: goods drawn from stock as its
//   material is, goods bought for the job as goods. A cost paid on the
//   client's behalf is no sale, so it is no kind.
//
// What there is carries over as reckon taxed it: every state the business
// collects in taxed goods and nothing else. A material that was taxed is
// goods; one that was not is in a kind of its own, "Untaxed goods", and every
// service in one called "Services" -- what was known of them, nothing more,
// for the business to rename or sort. Those answers say nobody gave them. A
// line already made is the kind its material is, or goods where it was
// bought, and one of the other kinds of line none.
import { sql, type Kysely } from 'kysely';
import { recorded } from './20261117T1405Z_the_schema_as_it_stands/record.ts';

/** A change of form, not an edit: the triggers that freeze, count and keep stand aside. */
async function asIs(
	db: Kysely<any>,
	table: string,
	triggers: string[],
	change: () => Promise<void>
) {
	for (const t of triggers)
		await sql`alter table ${sql.table(table)} disable trigger ${sql.id(t)}`.execute(db);
	await change();
	for (const t of triggers)
		await sql`alter table ${sql.table(table)} enable trigger ${sql.id(t)}`.execute(db);
}

export async function up(db: Kysely<any>): Promise<void> {
	/** Which of reckon's own kinds a kind is. */
	await db.schema
		.createType('reckon_kind')
		.asEnum(['goods', 'installation', 'repair', 'travel'])
		.execute();
	/** WHAT A SALE IS, as the business sorts them, for each state to answer. */
	await db.schema
		.createTable('sale_kind')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		/** Which of reckon's own it is; null for one the business added. */
		.addColumn('code', sql`reckon_kind`, (c) => c.unique())
		/** What the business calls it: Repair labour, Help desk. */
		.addColumn('name', 'text', (c) =>
			c.notNull().check(sql`btrim(name) <> '' and length(name) <= 80`)
		)
		/** Whether it is offered for an item; a retired one stays on what it is already. */
		.addColumn('active', 'boolean', (c) => c.notNull().defaultTo(true))
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.execute();
	// Two of one name could not be told apart where an item's is chosen.
	await sql`create unique index sale_kind_name_once on sale_kind (lower(name))`.execute(db);
	await sql`
		insert into sale_kind (code, name) values
		  ('goods', 'Goods'), ('installation', 'Installation labour'),
		  ('repair', 'Repair labour'), ('travel', 'Travel')`.execute(db);
	// reckon's own kinds are what goods bought for a job are, and what the
	// Agreement's definitions will be read against: each stays, and stays
	// which it is.
	await sql`
		create function reckons_kinds_stay() returns trigger
		language plpgsql as $function$
		BEGIN
		  IF TG_OP = 'DELETE' THEN
		    RAISE EXCEPTION 'reckon''s own kind % stays: retire it instead', OLD.name
		      USING ERRCODE = 'check_violation', CONSTRAINT = 'reckons_kinds_stay';
		  END IF;
		  RAISE EXCEPTION 'a kind stays which of reckon''s it is'
		    USING ERRCODE = 'check_violation', CONSTRAINT = 'reckons_kinds_stay';
		END $function$`.execute(db);
	await sql`
		create trigger reckons_kinds_stay
		before delete on sale_kind
		for each row when (OLD.code IS NOT NULL)
		execute function reckons_kinds_stay()`.execute(db);
	await sql`
		create trigger a_kind_stays_which_it_is
		before update of code on sale_kind
		for each row when (OLD.code IS DISTINCT FROM NEW.code)
		execute function reckons_kinds_stay()`.execute(db);

	/**
	 * WHETHER A STATE TAXES A KIND, as the business has it: one answer for each
	 * kind in each state it collects in. Who gave it and when, where somebody
	 * did; an answer carried over from before kinds of sale says nobody.
	 */
	await db.schema
		.createTable('taxability')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('state', 'text', (c) =>
			c.notNull().references('tax_registration.state').onDelete('cascade')
		)
		.addColumn('sale_kind_id', 'uuid', (c) =>
			c.notNull().references('sale_kind.id').onDelete('cascade')
		)
		.addColumn('taxed', 'boolean', (c) => c.notNull())
		.addColumn('said_by', 'uuid', (c) => c.references('user.id').onDelete('restrict'))
		.addColumn('said_on', 'date')
		.addUniqueConstraint('taxability_state_sale_kind_id_key', ['state', 'sale_kind_id'])
		.addCheckConstraint('an_answer_says_who_gave_it', sql`(said_by is null) = (said_on is null)`)
		.execute();
	await sql`
		insert into taxability (state, sale_kind_id, taxed)
		select r.state, k.id, k.code = 'goods' from tax_registration r cross join sale_kind k`.execute(db);

	// A material says what kind of sale it is, in place of whether it is taxed.
	await db.schema
		.alterTable('material')
		.addColumn('sale_kind_id', 'uuid', (c) => c.references('sale_kind.id').onDelete('restrict'))
		.execute();
	await asIs(db, 'material', ['v_material', 'h_material'], async () => {
		await sql`
			with untaxed as (
			  insert into sale_kind (name)
			  select 'Untaxed goods' where exists (select 1 from material where not taxable)
			  returning id
			), answered as (
			  insert into taxability (state, sale_kind_id, taxed)
			  select r.state, u.id, false from tax_registration r cross join untaxed u
			)
			update material m
			   set sale_kind_id = case when m.taxable
			                           then (select id from sale_kind where code = 'goods')
			                           else (select id from untaxed) end`.execute(db);
	});
	await db.schema
		.alterTable('material')
		.alterColumn('sale_kind_id', (c) => c.setNotNull())
		.dropColumn('taxable')
		.execute();

	// And so does a service. Whether one was taxed was saved and never read.
	await db.schema
		.alterTable('service')
		.addColumn('sale_kind_id', 'uuid', (c) => c.references('sale_kind.id').onDelete('restrict'))
		.execute();
	await asIs(db, 'service', ['h_service'], async () => {
		await sql`
			with services as (
			  insert into sale_kind (name)
			  select 'Services' where exists (select 1 from service)
			  returning id
			), answered as (
			  insert into taxability (state, sale_kind_id, taxed)
			  select r.state, s.id, false from tax_registration r cross join services s
			)
			update service set sale_kind_id = (select id from services)`.execute(db);
	});
	await db.schema
		.alterTable('service')
		.alterColumn('sale_kind_id', (c) => c.setNotNull())
		.dropColumn('taxable')
		.execute();

	// A line keeps the kind it was sold as.
	await db.schema
		.alterTable('invoice_line')
		.addColumn('sale_kind_id', 'uuid', (c) => c.references('sale_kind.id').onDelete('restrict'))
		.execute();
	await asIs(db, 'invoice_line', ['freeze_lines', 'v_invoice_line', 'h_invoice_line'], async () => {
		await sql`
			update invoice_line l
			   set sale_kind_id = case l.kind
			         when 'material' then (select m.sale_kind_id from material m where m.id = l.material_id)
			         else (select id from sale_kind where code = 'goods') end
			 where l.kind in ('material', 'bought')`.execute(db);
	});
	await db.schema
		.alterTable('invoice_line')
		.addCheckConstraint(
			'goods_lines_say_what_they_were_sold_as',
			sql`kind not in ('material', 'bought') or sale_kind_id is not null`
		)
		.execute();
	await db.schema
		.alterTable('invoice_line')
		.addCheckConstraint(
			'a_cost_passed_on_is_no_sale',
			sql`kind <> 'paid_for' or sale_kind_id is null`
		)
		.execute();
	// Goods bought for the job are goods.
	await sql`
		create function bought_for_the_job_is_goods() returns trigger
		language plpgsql as $function$
		BEGIN
		  IF NOT EXISTS (SELECT 1 FROM sale_kind k WHERE k.id = NEW.sale_kind_id AND k.code = 'goods') THEN
		    RAISE EXCEPTION 'goods bought for the job are sold as goods'
		      USING ERRCODE = 'check_violation', CONSTRAINT = 'bought_for_the_job_is_goods';
		  END IF;
		  RETURN NEW;
		END $function$`.execute(db);
	await sql`
		create trigger bought_for_the_job_is_goods
		before insert or update of kind, sale_kind_id on invoice_line
		for each row when (NEW.kind = 'bought')
		execute function bought_for_the_job_is_goods()`.execute(db);

	// EVERY STATE ANSWERS EVERY KIND, by the end of whatever made the state or
	// the kind: a state collected in answers each kind as it is added, and a
	// kind is added with each state's answer. An answer goes only with its
	// state or its kind, and stays the answer of both.
	await sql`
		create function every_state_answers_every_kind() returns trigger
		language plpgsql as $function$
		DECLARE missing text;
		BEGIN
		  -- Each table's own fields, each read only where it fired.
		  IF TG_TABLE_NAME = 'tax_registration' THEN
		    SELECT r.state || ' on ' || k.name INTO missing
		      FROM tax_registration r CROSS JOIN sale_kind k
		     WHERE r.state = NEW.state
		       AND NOT EXISTS (SELECT 1 FROM taxability t
		                        WHERE t.state = r.state AND t.sale_kind_id = k.id)
		     LIMIT 1;
		  ELSIF TG_TABLE_NAME = 'sale_kind' THEN
		    SELECT r.state || ' on ' || k.name INTO missing
		      FROM tax_registration r CROSS JOIN sale_kind k
		     WHERE k.id = NEW.id
		       AND NOT EXISTS (SELECT 1 FROM taxability t
		                        WHERE t.state = r.state AND t.sale_kind_id = k.id)
		     LIMIT 1;
		  ELSE
		    SELECT r.state || ' on ' || k.name INTO missing
		      FROM tax_registration r CROSS JOIN sale_kind k
		     WHERE r.state = OLD.state AND k.id = OLD.sale_kind_id
		       AND NOT EXISTS (SELECT 1 FROM taxability t
		                        WHERE t.state = r.state AND t.sale_kind_id = k.id)
		     LIMIT 1;
		  END IF;
		  IF missing IS NOT NULL THEN
		    RAISE EXCEPTION 'every state collected in answers every kind of sale: % has no answer', missing
		      USING ERRCODE = 'check_violation', CONSTRAINT = 'every_state_answers_every_kind';
		  END IF;
		  RETURN NULL;
		END $function$`.execute(db);
	await sql`
		create constraint trigger every_state_answers_every_kind
		after insert on tax_registration deferrable initially deferred
		for each row execute function every_state_answers_every_kind()`.execute(db);
	await sql`
		create constraint trigger every_kind_is_answered_by_every_state
		after insert on sale_kind deferrable initially deferred
		for each row execute function every_state_answers_every_kind()`.execute(db);
	await sql`
		create constraint trigger an_answer_goes_with_its_state_or_kind
		after delete on taxability deferrable initially deferred
		for each row execute function every_state_answers_every_kind()`.execute(db);
	await sql`
		create function an_answer_stays_its_own() returns trigger
		language plpgsql as $function$
		BEGIN
		  RAISE EXCEPTION 'an answer stays the answer of its state and its kind'
		    USING ERRCODE = 'check_violation', CONSTRAINT = 'an_answer_stays_its_own';
		END $function$`.execute(db);
	await sql`
		create trigger an_answer_stays_its_own
		before update of state, sale_kind_id on taxability
		for each row when (OLD.state IS DISTINCT FROM NEW.state
		                   OR OLD.sale_kind_id IS DISTINCT FROM NEW.sale_kind_id)
		execute function an_answer_stays_its_own()`.execute(db);

	// Kinds and their answers are the business's settings, so every change to
	// them is kept, and so is one that goes. Who gave an answer, and when, is
	// what the history of its change says already.
	await recorded(db, 'sale_kind', { removals: true });
	await recorded(db, 'taxability', { ignoring: ['said_by', 'said_on'], removals: true });
}
