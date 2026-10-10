import { Decimal, sum } from '#lib/decimal.ts';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { loadAgreements, usedThisMonth } from '#lib/server/valuation/load.ts';
import { hoursOf } from '#lib/server/valuation/misc.ts';
import type { PageServerLoad } from './$types';

/**
 * Recurring agreements, one row each, which open onto the agreement itself: a
 * client's, or one of its sites'; what it charges; what it covers, with this
 * month's use; and this month's charge.
 *
 * Hours used are derived from the entries themselves, never from a stored
 * counter -- a counter and the entries it counts eventually disagree, and the
 * entries are the record. An hour counts against the agreement it fell under:
 * its site's, or the client's where the site has none of its own.
 */
export const load: PageServerLoad = async () => {
	const day = businessToday();
	const [rows, agreements] = await Promise.all([
		db.query.agreement.findMany({
			columns: { id: true, entityId: true, price: true, billingInterval: true, endsOn: true },
			with: {
				entity: { columns: { name: true } },
				site: { columns: { display: true } },
				services: {
					columns: { serviceId: true, allotment: true, includedHours: true },
					with: { service: { columns: { name: true } } }
				},
				periods: { columns: { periodStart: true, periodEnd: true, amount: true, given: true } }
			}
		}),
		db.query.agreement
			.findMany({ columns: { entityId: true } })
			.then((all) => loadAgreements(db, [...new Set(all.map((a) => a.entityId))]))
	]);
	const used = await usedThisMonth(db, agreements, day);

	const all = rows
		.map((a) => {
			const period = a.periods.find((p) => p.periodStart <= day && day <= p.periodEnd);
			return {
				id: a.id,
				who: a.entity.name,
				site: a.site?.display ?? null,
				price: a.price,
				// This period's charge, made in advance -- or given, or not made yet.
				now: period
					? {
							state: period.given ? ('given' as const) : ('charged' as const),
							amount: period.amount
						}
					: { state: 'uncharged' as const, amount: null },
				interval: a.billingInterval,
				ended: a.endsOn !== null && a.endsOn < day,
				covers: a.services
					.map((s) => ({
						service: s.service.name,
						allotment: s.allotment,
						hours:
							s.allotment === 'capped' ? Decimal.from(s.includedHours ?? '0').toFixed(2) : null,
						used: hoursOf(used.get(`${a.id}:${s.serviceId}`) ?? 0)
					}))
					.sort((x, y) => byText(x.service, y.service))
			};
		})
		// Running before ended, then by client, the client's own before its sites'.
		.sort(
			(x, y) =>
				Number(x.ended) - Number(y.ended) ||
				byText(x.who, y.who) ||
				(x.site === null ? -1 : 0) - (y.site === null ? -1 : 0) ||
				byText(x.site ?? '', y.site ?? '')
		);

	const recurring = sum(
		all.filter((a) => a.interval === 'monthly' && !a.ended).map((a) => a.price)
	).toString();

	return {
		live: all.filter((a) => !a.ended),
		ended: all.filter((a) => a.ended),
		recurring
	};
};

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
