// A LINE'S TAX SET BY HAND (20 November 2026). A line is taxed as its kind of
// sale is in its site's state, and for most lines that is right. Some are the
// exception, on one job and not the next: California makes a contractor the
// consumer of the materials it installs -- "Electric wiring and connections"
// and "Conduit" are among them -- and the retailer of the fixtures, an alarm
// or a telephone switch (Reg 1521 (b)(2)(A)1, (b)(2)(B)1, Appendices A and B).
// So someone with Full can say, of a line on a draft, that it is not taxed, or
// taxed at the site's rate, or at another, and why.
//
// The reason is what says a line's tax was set by hand: a line with one was
// set by hand, and a line without was taxed as its kind is. Where its rate
// came from is said as it always was:
//
//   not taxed            no source, and no rate
//   at the site's rate   the site, with its area's pieces, as any line taxed there
//   at another rate      an override, levied by nobody the line can name, which
//                        Schedule A shows on its own with its reason
//
// Whoever set it, and when, is what the line's history says. The reason
// supports the return, and is not on the invoice: California asks for the
// records that settle the tax, kept four years (Reg 1698 (b)(1), (i)), and not
// for the invoice to say why.
//
// Nothing has been set by hand before: nothing wrote an override.
import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
	const check = (name: string, rule: ReturnType<typeof sql>) =>
		db.schema.alterTable('invoice_line').addCheckConstraint(name, rule).execute();

	// A reason says something.
	await check(
		'a_reason_says_something',
		sql`tax_override_reason is null or btrim(tax_override_reason) <> ''`
	);
	// A line's tax is set by hand only on a sale: a cost passed on is no kind
	// of sale, and is taxed nowhere.
	await check(
		'only_a_sale_is_taxed_by_hand',
		sql`tax_override_reason is null or sale_kind_id is not null`
	);
	await check('a_cost_passed_on_is_taxed_nowhere', sql`kind <> 'paid_for' or not taxable`);
	// Taxed at another rate is taxed, where the line went, so it is owed to
	// that site's state and its area: the line says where, as any taxed at a
	// site does (taxed_lines_say_where).
	await check(
		'another_rate_is_at_a_site',
		sql`tax_source <> 'override' or (taxable and site_id is not null)`
	);
	// Taxed at no rate is not taxed.
	await check('taxed_lines_carry_a_rate', sql`not taxable or tax_rate_pct > 0`);
}
