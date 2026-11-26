// A CLIENT IS EXEMPT IN A STATE (25 November 2026, #207). An exemption was one
// yes or no on the client and a certificate beside it, and nothing that taxed
// a line read either. But an exemption is claimed in a state, under that
// state's law, for a reason: the Streamlined certificate takes an ID number
// and a reason for each state it is claimed in (SSTGB Form F0003, s. 4 and
// 5), and California's resale certificate the buyer's California seller's
// permit (Reg 1668 (b)(1)(C)). So a client's exemptions are each in one state:
//
//   WHY, as the certificate gives it: F0003's reasons, A to M. California asks
//   the purpose too (Reg 1667 (c)(1)), "for resale" on a resale certificate
//   (Reg 1668 (b)(1)(D)). Other is explained; any may be.
//
//   WHAT SUPPORTS IT: the certificate's number, or for the United States its
//   purchase orders, which Reg 1614 (g) asks the seller to keep in place of a
//   certificate.
//
//   WHAT IT COVERS: every kind of sale, or the kinds it names. A certificate
//   describes the property it covers, by "an itemized list or ... a general
//   description of the kind" (Reg 1668 (b)(1)(D); Reg 1667 (c)(1)): a
//   government's covers whatever it buys, a resale certificate the goods
//   resold and not the installing of them.
//
//   UNTIL IT ENDS: California's "remains in effect until revoked in writing"
//   (Reg 1668 (a)), and a blanket Streamlined certificate until it is
//   cancelled while purchases are no more than 12 months apart (F0003's
//   instructions). Ending it is said on the day; nothing else of it changes,
//   since a line keeps the exemption it was billed under.
//
// One purchase under a certificate is not a client's exemption: it is that
// line's tax set by hand, saying why (20261120T2227Z).
//
// A LINE A CLIENT IS EXEMPT FROM keeps which exemption it was: untaxed, with
// no rate, at a site in the exemption's state, of a kind it covers. And a line
// taxed as its kind where its client is exempt from that kind is refused; one
// taxed by hand, saying why, is the exception the reason explains -- goods
// bought under a resale certificate for the buyer's own use (Reg 1668 (b)(3)).
//
// The yes or no carries over as what it was: each client marked exempt is
// exempt in California -- the only state reckon could collect in until a
// person could type a state's areas (20261118T2030Z) -- from every kind, with
// its certificate, its reason Other, said to have been recorded before an
// exemption named either. The expiry date beside it was never written. What
// the three held is in the client's history.
import { sql, type Kysely } from 'kysely';
import { recorded } from './20261117T1405Z_the_schema_as_it_stands/record.ts';

const A_STATE = sql`'^[A-Z]{2}$'`;

export async function up(db: Kysely<any>): Promise<void> {
	/** Why a client is exempt: the reasons of the Streamlined certificate, A to M. */
	await db.schema
		.createType('exemption_reason')
		.asEnum([
			'federal_government',
			'state_or_local_government',
			'tribal_government',
			'foreign_diplomat',
			'charitable',
			'religious',
			'resale',
			'agricultural_production',
			'industrial_production',
			'direct_pay_permit',
			'direct_mail',
			'other',
			'educational'
		])
		.execute();

	/** A CLIENT'S EXEMPTION from a state's tax, in that state. */
	await db.schema
		.createTable('tax_exemption')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('entity_id', 'uuid', (c) => c.notNull().references('entity.id').onDelete('cascade'))
		// The state it is claimed in, whether or not the business collects there
		// now: it stands as the certificate's, and applies wherever it does.
		.addColumn('state', 'text', (c) => c.notNull().check(sql`state ~ ${A_STATE}`))
		.addColumn('reason', sql`exemption_reason`, (c) => c.notNull())
		// As the certificate says it: the department or government, or what Other is.
		.addColumn('explanation', 'text', (c) =>
			c.check(sql`btrim(explanation) <> '' and length(explanation) <= 200`)
		)
		// Its number, or what else supports it.
		.addColumn('supported_by', 'text', (c) =>
			c.notNull().check(sql`btrim(supported_by) <> '' and length(supported_by) <= 60`)
		)
		// The kinds of sale it covers, or null for every kind, those added later
		// among them.
		.addColumn('sale_kind_ids', sql`uuid[]`, (c) =>
			c.check(sql`sale_kind_ids is null or cardinality(sale_kind_ids) > 0`)
		)
		// The business's day it ended: in force until then.
		.addColumn('ended_on', 'date')
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addCheckConstraint('other_is_explained', sql`reason <> 'other' or explanation is not null`)
		.execute();
	await sql`create index tax_exemption_entity_id_state_idx on tax_exemption (entity_id, state)`.execute(
		db
	);

	// It stands as recorded: only its end is said after, once.
	await sql`
		create function an_exemption_stands() returns trigger
		language plpgsql as $function$
		BEGIN
		  IF OLD.ended_on IS NOT NULL
		     OR (to_jsonb(NEW) - 'ended_on') IS DISTINCT FROM (to_jsonb(OLD) - 'ended_on') THEN
		    RAISE EXCEPTION 'an exemption stands as it was recorded: only its end is said, once'
		      USING ERRCODE = 'check_violation', CONSTRAINT = 'an_exemption_stands';
		  END IF;
		  RETURN NEW;
		END $function$`.execute(db);
	await sql`
		create trigger an_exemption_stands before update on tax_exemption
		for each row execute function an_exemption_stands()`.execute(db);

	// The kinds it names are kinds, and a kind it names stays.
	await sql`
		create function an_exemption_names_kinds() returns trigger
		language plpgsql as $function$
		BEGIN
		  IF TG_TABLE_NAME = 'tax_exemption' THEN
		    IF EXISTS (SELECT 1 FROM unnest(NEW.sale_kind_ids) k
		                WHERE NOT EXISTS (SELECT 1 FROM sale_kind s WHERE s.id = k)) THEN
		      RAISE EXCEPTION 'an exemption covers kinds of sale there are'
		        USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'an_exemption_names_kinds';
		    END IF;
		    RETURN NEW;
		  END IF;
		  IF EXISTS (SELECT 1 FROM tax_exemption x WHERE OLD.id = ANY (x.sale_kind_ids)) THEN
		    RAISE EXCEPTION 'a client''s exemption covers %', OLD.name
		      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'an_exemption_names_kinds';
		  END IF;
		  RETURN OLD;
		END $function$`.execute(db);
	await sql`
		create trigger an_exemption_names_kinds before insert on tax_exemption
		for each row execute function an_exemption_names_kinds()`.execute(db);
	await sql`
		create trigger an_exemption_names_kinds before delete on sale_kind
		for each row execute function an_exemption_names_kinds()`.execute(db);

	// Who recorded it, ended it or took it off, and when, is its history's.
	await recorded(db, 'tax_exemption', { removals: true });

	await sql`
		insert into tax_exemption (entity_id, state, reason, explanation, supported_by)
		select id, 'CA', 'other', 'Recorded before an exemption named its state and reason',
		       exemption_certificate
		  from entity where tax_exempt`.execute(db);
	await db.schema.alterTable('entity').dropConstraint('exemption_needs_certificate').execute();
	await db.schema
		.alterTable('entity')
		.dropColumn('tax_exempt')
		.dropColumn('exemption_certificate')
		.dropColumn('exemption_expires_on')
		.execute();

	// A line its client is exempt from says which exemption.
	await db.schema
		.alterTable('invoice_line')
		.addColumn('tax_exemption_id', 'uuid', (c) =>
			c.references('tax_exemption.id').onDelete('restrict')
		)
		.execute();
	const check = (name: string, rule: ReturnType<typeof sql>) =>
		db.schema.alterTable('invoice_line').addCheckConstraint(name, rule).execute();
	await check(
		'exempt_lines_say_which_exemption',
		sql`(tax_source = 'exempt') = (tax_exemption_id is not null)`
	);
	// Untaxed, of a kind of sale, at a site, and not set by hand: a line set by
	// hand says its own reason.
	await check(
		'exempt_lines_are_untaxed_sales_at_a_site',
		sql`tax_source <> 'exempt' or (not taxable and sale_kind_id is not null
		    and site_id is not null and tax_override_reason is null)`
	);

	// Its client's exemption, in force, in its site's state, covering its kind;
	// and none of its client's covers a line taxed as its kind.
	await sql`
		create function a_line_is_exempt_as_its_client_is() returns trigger
		language plpgsql as $function$
		DECLARE ok boolean;
		BEGIN
		  IF NEW.tax_exemption_id IS NOT NULL THEN
		    SELECT x.ended_on IS NULL
		           AND x.entity_id = i.entity_id
		           AND x.state IS NOT DISTINCT FROM s.region
		           AND (x.sale_kind_ids IS NULL OR NEW.sale_kind_id = ANY (x.sale_kind_ids))
		      INTO ok
		      FROM tax_exemption x, invoice i, site s
		     WHERE x.id = NEW.tax_exemption_id AND i.id = NEW.invoice_id AND s.id = NEW.site_id;
		    IF NOT coalesce(ok, false) THEN
		      RAISE EXCEPTION 'a line is exempt by its client''s exemption, in force, in its site''s state, for its kind'
		        USING ERRCODE = 'check_violation', CONSTRAINT = 'exempt_as_its_client_is';
		    END IF;
		  ELSIF NEW.taxable AND NEW.tax_override_reason IS NULL AND EXISTS (
		    SELECT 1 FROM tax_exemption x
		      JOIN invoice i ON i.entity_id = x.entity_id
		      JOIN site s ON s.region = x.state
		     WHERE i.id = NEW.invoice_id AND s.id = NEW.site_id AND x.ended_on IS NULL
		       AND (x.sale_kind_ids IS NULL OR NEW.sale_kind_id = ANY (x.sale_kind_ids))) THEN
		    RAISE EXCEPTION 'a client exempt from a line''s kind is not taxed on it as its kind'
		      USING ERRCODE = 'check_violation', CONSTRAINT = 'an_exempt_client_is_not_taxed';
		  END IF;
		  RETURN NEW;
		END $function$`.execute(db);
	await sql`
		create trigger tax_exemption_holds
		before insert or update of taxable, tax_source, tax_exemption_id, tax_override_reason,
		  site_id, sale_kind_id, invoice_id on invoice_line
		for each row execute function a_line_is_exempt_as_its_client_is()`.execute(db);
}
