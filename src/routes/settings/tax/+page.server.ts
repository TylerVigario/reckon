import { sql } from 'kysely';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { operatorRow } from '#lib/server/operator.ts';
import { quarterBegan } from '#lib/server/stale.ts';
import { saleKinds } from '#lib/server/sale-kinds.ts';
import type { PageServerLoad } from './$types';

/**
 * Where the business collects tax, each state's registration as it says it,
 * and, where a person types a state's areas, how many it has and how many
 * nobody has confirmed this quarter; then the business's kinds of sale, and
 * which states tax each (#lib/server/sale-kinds); then the year its returns
 * are cut to. A rate is not one of them: a site's is its area's, and in
 * California CDTFA's (#lib/server/tax-registrations).
 */
export const load: PageServerLoad = async () => {
	const today = businessToday();
	return {
		operator: await operatorRow(),
		kinds: await saleKinds(db),
		registrations: await db
			.selectFrom('tax_registration as r')
			.select((eb) => [
				'r.state',
				'r.held',
				'r.agency',
				'r.filing_basis',
				'r.claims_tax_paid_purchases_resold',
				eb
					.selectFrom('tax_area as a')
					.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
					.whereRef('a.state', '=', 'r.state')
					.where('a.source', '=', 'typed')
					.$asScalar()
					.$notNull()
					.as('areas'),
				eb
					.selectFrom('tax_area as a')
					.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
					.whereRef('a.state', '=', 'r.state')
					.where('a.source', '=', 'typed')
					.where(sql<boolean>`a.confirmed_on < ${quarterBegan(today)}`)
					.$asScalar()
					.$notNull()
					.as('unconfirmed')
			])
			.orderBy('r.state')
			.execute()
	};
};
