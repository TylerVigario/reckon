import { Decimal } from '#lib/decimal.ts';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { loadAgreements, usedOf, usedThisPeriod } from '#lib/server/valuation/load.ts';
import type { PageServerLoad } from './$types';

/**
 * An agreement's Covers tab: each service it covers, its allotment, and what
 * of its period under way fell under it (#lib/agreement-periods) -- at its
 * site, or for a client's agreement, anywhere a site's own does not reach --
 * counted as the service is charged: hours, or how many of one charged each.
 * And the services it could cover besides, with what each is charged by, which
 * is what a cap of it counts. Without a period under way, ended or not
 * started, there is no use to say.
 */
export const load: PageServerLoad = async ({ parent }) => {
	const { agreement } = await parent();
	const [theirs, services] = await Promise.all([
		loadAgreements(db, [agreement.entity_id]),
		db
			.selectFrom('service')
			.select(['id', 'name', 'unit'])
			.where('active', '=', true)
			.orderBy('name')
			.execute()
	]);
	const used = (await usedThisPeriod(db, theirs, businessToday())).get(agreement.id);
	const names = new Map(services.map((s) => [s.id, s.name]));
	const mine = theirs.find((a) => a.id === agreement.id)!;
	const missing = mine.services.filter((s) => !names.has(s.serviceId)).map((s) => s.serviceId);
	if (missing.length)
		for (const s of await db
			.selectFrom('service')
			.select(['id', 'name'])
			.where('id', '=', (eb) => eb.fn.any(eb.val(missing)))
			.execute())
			names.set(s.id, s.name);
	const covers = mine.services
		.map((s) => ({
			service_id: s.serviceId,
			service: names.get(s.serviceId) ?? '',
			unit: s.unit,
			allotment: s.allotment,
			included: s.included,
			overage: s.overage,
			pooled:
				s.allotment === 'capped'
					? Decimal.from(s.included ?? '0').toFixed(s.unit === 'each' ? 0 : 2)
					: null,
			used: used ? usedOf(used.get(s.serviceId), s.unit) : null
		}))
		.sort((x, y) => (x.service < y.service ? -1 : x.service > y.service ? 1 : 0));
	return {
		covers,
		services: services.filter((s) => !covers.some((c) => c.service_id === s.id))
	};
};
