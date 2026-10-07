import { and, asc, eq } from 'drizzle-orm';
import { db } from './db/index.ts';
import { service } from './db/schema/index.ts';
import { businessToday } from './calendar.ts';
import { loadCatalogue } from './valuation/load.ts';
import { ruleOn } from './valuation/pay.ts';

/** A vehicle rule as #lib/pay-words says it. */
export type VehicleRule = { pays_for: string; method: string; amount: string | null };

/**
 * What a vehicle each of these people owned would be paid today, on each
 * service charged by the mile, for every client: the rule that reaches them, or
 * none. The page says it with #lib/pay-words.
 */
export async function vehicleTerms(people: readonly { id: string }[]) {
	const day = businessToday();
	const [catalogue, miled] = await Promise.all([
		loadCatalogue(db),
		db
			.select({ id: service.id, name: service.name })
			.from(service)
			.where(and(eq(service.unit, 'mile'), eq(service.active, true)))
			.orderBy(asc(service.name))
	]);
	const terms: Record<string, { service: string; rule: VehicleRule | null }[]> = {};
	for (const p of people) {
		const payee = { id: p.id, roleId: catalogue.people.find((x) => x.id === p.id)?.roleId ?? null };
		terms[p.id] = miled.map((s) => {
			const r = ruleOn(catalogue.rules, s.id, payee, null, 'vehicle', day);
			return {
				service: s.name,
				rule: r && { pays_for: r.paysFor, method: r.method, amount: r.amount }
			};
		});
	}
	return terms;
}
