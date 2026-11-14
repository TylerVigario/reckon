import { and, eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
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
	const h = t.recordHistory;
	const [priced, paying, rows] = await Promise.all([
		prices(params.id),
		rules(params.id),
		db
			.select({
				field: h.field,
				old_value: h.oldValue,
				new_value: h.newValue,
				changed_by: h.changedBy,
				changed_at: h.changedAt,
				xact: h.xact
			})
			.from(h)
			.where(and(eq(h.tableName, 'service'), eq(h.rowId, params.id)))
	]);
	const people = [
		...new Set(rows.map((r) => r.changed_by).filter((x): x is string => !!x && UUID.test(x)))
	];
	const named = people.length
		? await db
				.select({ id: t.user.id, name: t.user.name })
				.from(t.user)
				.where(inArray(t.user.id, people))
		: [];
	return {
		prices: priced,
		rules: paying,
		changes: rows.map((r): ServiceHistoryRow => ({ ...r, changed_at: r.changed_at.toISOString() })),
		people: Object.fromEntries(named.map((p) => [p.id, p.name]))
	};
};
