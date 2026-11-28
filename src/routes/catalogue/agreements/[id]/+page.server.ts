import { Decimal } from '#lib/decimal.ts';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { loadAgreements, usedThisPeriod } from '#lib/server/valuation/load.ts';
import { hoursOf } from '#lib/server/valuation/misc.ts';
import type { PageServerLoad } from './$types';

/**
 * An agreement's Covers tab: each service it covers, its allotment, and the
 * hours of its period under way that fell under it (#lib/agreement-periods)
 * -- at its site, or for a client's agreement, anywhere a site's own does not
 * reach -- and the services it could cover besides. Without a period under
 * way, ended or not started, there are no hours to say.
 */
export const load: PageServerLoad = async ({ parent }) => {
	const { agreement } = await parent();
	const [theirs, services] = await Promise.all([
		loadAgreements(db, [agreement.entity_id]),
		db
			.selectFrom('service')
			.select(['id', 'name'])
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
			allotment: s.allotment,
			included_hours: s.includedHours,
			overage: s.overage,
			pooled: s.allotment === 'capped' ? Decimal.from(s.includedHours ?? '0').toFixed(2) : null,
			used: used ? hoursOf(used.get(s.serviceId) ?? 0) : null
		}))
		.sort((x, y) => (x.service < y.service ? -1 : x.service > y.service ? 1 : 0));
	return {
		covers,
		services: services.filter((s) => !covers.some((c) => c.service_id === s.id))
	};
};
