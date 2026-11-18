import { expressionBuilder, sql, type Expression, type Kysely, type NumericString } from 'kysely';
import type { DB } from './db/database.ts';
import { areaRate } from './tax-areas.ts';

/**
 * WHERE THE BUSINESS COLLECTS TAX: each state it is registered in
 * (tax_registration). A site in one of them is taxed at its area's rate once it
 * has been placed in one; a site anywhere else is not taxed, and has no area to
 * find.
 *
 * Imports nothing of SvelteKit's, so #lib/server/tax-sync uses it under plain
 * Node.
 */

/** The states the business collects in, in order. */
export async function collecting(db: Kysely<DB>): Promise<string[]> {
	const rows = await db.selectFrom('tax_registration').select('state').orderBy('state').execute();
	return rows.map((r) => r.state);
}

/** Whether the business collects tax in `state`. */
export function collectsIn(state: Expression<string>) {
	const eb = expressionBuilder<DB>();
	return eb
		.exists(
			eb.selectFrom('tax_registration as reg').select('reg.state').where('reg.state', '=', state)
		)
		.$castTo<boolean>();
}

/** Whether the business collects tax anywhere. */
export function collectsAnywhere() {
	const eb = expressionBuilder<DB>();
	return eb.exists(eb.selectFrom('tax_registration as reg').select('reg.state')).$castTo<boolean>();
}

/**
 * A site's rate on `day`: its area's, where the business collects in the
 * site's state and the site has been placed there, and otherwise null -- never
 * a rate of nothing, which would read as a rate.
 */
export function siteRate(
	site: { region: Expression<string>; area: Expression<string | null> },
	day: string | Expression<string>
) {
	return sql<NumericString | null>`case when ${collectsIn(site.region)} and ${site.area} is not null
		then ${areaRate(site.area as Expression<string>, day)} end`;
}

/**
 * Whether the Reg 1701 election is made for a line taxed in `state`: tax
 * already paid on goods resold comes off California's return where the
 * business has elected so, and only California's registration can.
 */
export function claimsResold(state: Expression<string | null>) {
	const eb = expressionBuilder<DB>();
	return eb
		.exists(
			eb
				.selectFrom('tax_registration as reg')
				.select('reg.state')
				.where('reg.state', '=', state as Expression<string>)
				.where('reg.claims_tax_paid_purchases_resold', '=', true)
		)
		.$castTo<boolean>();
}

/**
 * Whether a site in `state` is placed by asking CDTFA about its address: it is
 * in California, and the business collects tax there.
 */
export async function asksCdtfa(db: Kysely<DB>, state: string): Promise<boolean> {
	return state === 'CA' && (await collecting(db)).includes('CA');
}
