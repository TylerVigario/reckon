import { hours } from '#lib/format.ts';
import { error, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { sql, type NumericString } from 'kysely';
import { db } from '#lib/server/db/index.ts';
import { businessToday, personalDay } from '#lib/server/calendar.ts';
import { balances } from '#lib/server/balances.ts';
import { moneyPlaces } from '#lib/server/business.ts';
import { TAX_ROUNDING } from '#lib/server/tax-rules.ts';
import { findClient } from '#lib/server/find.ts';
import { loadAgreements, usedThisPeriod } from '#lib/server/valuation/load.ts';
import { periodOn } from '#lib/agreement-periods.ts';
import { hoursOf } from '#lib/server/valuation/misc.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import type { PageServerLoad } from './$types';

/**
 * A client's Overview: what they have agreed to and what they have been
 * invoiced, and the credit they have to spend. What they owe heads every tab
 * (+layout); where they are is Sites, who to ask for, Contacts, and how they
 * pay and are taxed, Details.
 *
 * Someone with Field reads where a client is, to work there, and nothing of
 * what they owe, have agreed to or been invoiced (#lib/access), so for them a
 * client opens on Sites.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	if (fieldOnly(locals)) redirect(307, resolve('/clients/[id]/sites', { id: params.id }));
	const places = await moneyPlaces();
	const owing = balances(TAX_ROUNDING, places);
	const { id } = await findClient(params.id);

	const client = await db
		.selectFrom('entity as e')
		.select((eb) => {
			// Notes and what has been applied from them, each added up on its
			// own: joined first, a note applied twice would count twice.
			const notes = eb
				.selectFrom('credit_note as cn')
				.select((eb) => eb.fn.coalesce(eb.fn.sum<NumericString>('cn.amount'), eb.lit(0)).as('n'))
				.whereRef('cn.entity_id', '=', 'e.id')
				.$asScalar();
			const applied = eb
				.selectFrom('credit_application as ca')
				.innerJoin('credit_note as cn', 'cn.id', 'ca.credit_note_id')
				.select((eb) => eb.fn.coalesce(eb.fn.sum<NumericString>('ca.amount'), eb.lit(0)).as('n'))
				.whereRef('cn.entity_id', '=', 'e.id')
				.$asScalar();
			return ['e.id', 'e.slug', sql<string>`(${notes} - ${applied})::text`.as('credit')];
		})
		.where('e.id', '=', id)
		.executeTakeFirst();

	if (!client) error(404, 'no such client');

	const today = businessToday();
	const [running, recent] = await Promise.all([
		db
			.selectFrom('agreement as a')
			.leftJoin('site as s', 's.id', 'a.site_id')
			.select([
				'a.id',
				's.display as site',
				'a.price',
				'a.billing_interval as interval',
				'a.starts_on'
			])
			.where('a.entity_id', '=', id)
			.where((eb) =>
				eb.or([
					eb('a.ends_on', 'is', null),
					eb('a.ends_on', '>=', eb.cast<string>(eb.val(businessToday()), 'date'))
				])
			)
			.orderBy('s.display', (ob) => ob.asc().nullsFirst())
			.execute(),
		db
			.selectFrom('invoice as i')
			.innerJoin(owing.as('b'), 'b.invoice_id', 'i.id')
			.select((eb) => [
				'i.id',
				'i.number',
				'i.status',
				eb.cast<string>('b.gross', 'text').as('gross'),
				eb
					.cast<string>(
						eb.fn.coalesce(personalDay(eb.ref('i.sent_at')), personalDay(eb.ref('i.created_at'))),
						'text'
					)
					.as('on')
			])
			.where('i.entity_id', '=', id)
			.orderBy((eb) => eb.fn.coalesce('i.sent_at', 'i.created_at'), 'desc')
			.limit(5)
			.execute()
	]);

	// Each running agreement -- the client's, and each site's -- with its period
	// under way's use against what it covers (#lib/agreement-periods): "Help
	// desk 1.25 h of unlimited". Every hour counts against the agreement it
	// falls under, billable or not.
	const [agreements, services] = await Promise.all([
		loadAgreements(db, [id]),
		db.selectFrom('service').select(['id', 'name']).execute()
	]);
	const used = await usedThisPeriod(db, agreements, today);
	const nameOf = new Map(services.map((s) => [s.id, s.name]));
	const coverOf = (agreementId: string) => {
		const a = agreements.find((x) => x.id === agreementId)!;
		const mine = used.get(a.id);
		const parts = a.services
			.map((s) => {
				const of =
					s.allotment === 'unlimited' ? 'unlimited' : hours(s.includedHours ?? '0', 'allotted');
				const text = mine
					? `${hours(hoursOf(mine.get(s.serviceId) ?? 0), 'allotted')} of ${of}`
					: of;
				return { name: nameOf.get(s.serviceId) ?? '', text };
			})
			.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
		return parts.length ? parts.map((p) => `${p.name} ${p.text}`).join(', ') : null;
	};

	return {
		client,
		agreements: running.map((r) => {
			const a = agreements.find((x) => x.id === r.id)!;
			const now = periodOn(a, a.periods, today);
			return {
				...r,
				covers: coverOf(r.id),
				// Not started yet: nothing under way to say the use of.
				started: now !== null,
				// Charged in advance, so the period under way has its charge or was given.
				given: now?.charged?.given ?? false
			};
		}),
		recent
	};
};
