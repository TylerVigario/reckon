import { db } from '#lib/server/db/index.ts';
import { prices, rules } from '#lib/server/catalogue.ts';
import { UUID } from '#lib/field-rules.ts';
import type { ServiceHistoryRow } from '#lib/service-history.ts';
import type { PageServerLoad } from './$types';

/**
 * Everything a service has been, priced at and paid by, including what no
 * longer is: its History tab. Kept off Prices and Pay so they say what is true
 * now; here because a line billed in June was billed at June's price, and this
 * is where that price is still written down. And every save that changed what
 * the service is, from record_history (#lib/service-history), with who made it.
 */
export const load: PageServerLoad = async ({ params }) => {
	const [priced, paying, rows] = await Promise.all([
		prices(params.id),
		rules(params.id),
		db
			.selectFrom('record_history')
			.select(['field', 'old_value', 'new_value', 'changed_by', 'changed_at', 'xact'])
			.where('table_name', '=', 'service')
			.where('row_id', '=', params.id)
			.execute()
	]);
	const people = [
		...new Set(rows.map((r) => r.changed_by).filter((x): x is string => !!x && UUID.test(x)))
	];
	const named = people.length
		? await db
				.selectFrom('user')
				.select(['id', 'name'])
				.where('id', '=', (eb) => eb.fn.any(eb.val(people)))
				.execute()
		: [];
	return {
		prices: priced,
		rules: paying,
		changes: rows.map((r): ServiceHistoryRow => ({
			...r,
			changed_at: r.changed_at.toISOString(),
			xact: r.xact === null ? null : Number(r.xact)
		})),
		people: Object.fromEntries(named.map((p) => [p.id, p.name]))
	};
};
