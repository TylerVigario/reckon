import { jsonArrayFrom } from 'kysely/helpers/postgres';
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
		db
			.selectFrom('agreement as a')
			.select((eb) => [
				'a.id',
				'a.price',
				'a.billing_interval',
				'a.ends_on',
				eb
					.selectFrom('entity as e')
					.select('e.name')
					.whereRef('e.id', '=', 'a.entity_id')
					.$asScalar()
					.$notNull()
					.as('who'),
				eb
					.selectFrom('site as s')
					.select('s.display')
					.whereRef('s.id', '=', 'a.site_id')
					.as('site'),
				// As text: a NUMERIC inside JSON would arrive as a JS number.
				jsonArrayFrom(
					eb
						.selectFrom('agreement_service as c')
						.innerJoin('service as sv', 'sv.id', 'c.service_id')
						.select((eb) => [
							'c.service_id',
							'c.allotment',
							eb.cast<string | null>('c.included_hours', 'text').as('included_hours'),
							'sv.name as service'
						])
						.whereRef('c.agreement_id', '=', 'a.id')
				).as('services'),
				jsonArrayFrom(
					eb
						.selectFrom('agreement_period as p')
						.select((eb) => [
							'p.period_start',
							'p.period_end',
							eb.cast<string>('p.amount', 'text').as('amount'),
							'p.given'
						])
						.whereRef('p.agreement_id', '=', 'a.id')
				).as('periods')
			])
			// A client's renewals at one place, newest first, as the list keeps them.
			.orderBy('a.starts_on', 'desc')
			.orderBy('a.id')
			.execute(),
		db
			.selectFrom('agreement')
			.select('entity_id')
			.execute()
			.then((all) => loadAgreements(db, [...new Set(all.map((a) => a.entity_id))]))
	]);
	const used = await usedThisMonth(db, agreements, day);

	const all = rows
		.map((a) => {
			const period = a.periods.find((p) => p.period_start <= day && day <= p.period_end);
			return {
				id: a.id,
				who: a.who,
				site: a.site,
				price: a.price,
				// This period's charge, made in advance -- or given, or not made yet.
				now: period
					? {
							state: period.given ? ('given' as const) : ('charged' as const),
							amount: period.amount
						}
					: { state: 'uncharged' as const, amount: null },
				interval: a.billing_interval,
				ended: a.ends_on !== null && a.ends_on < day,
				covers: a.services
					.map((s) => ({
						service: s.service,
						allotment: s.allotment,
						hours:
							s.allotment === 'capped' ? Decimal.from(s.included_hours ?? '0').toFixed(2) : null,
						used: hoursOf(used.get(`${a.id}:${s.service_id}`) ?? 0)
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
