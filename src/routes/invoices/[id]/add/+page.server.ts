import { error, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { siteExemptions, siteKindRates, siteRate } from '#lib/server/tax-registrations.ts';
import { formTerms } from '#lib/server/lines.ts';
import { UUID } from '#lib/field-rules.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import { refusedForAccess } from '#lib/server/refused.ts';
import type { PageServerLoad } from './$types';

/**
 * Add a line: goods drawn from stock, goods bought for the job, or a cost paid
 * on the client's behalf (#lib/server/lines).
 *
 * Everything the page needs to say what a line will bill as it is typed, with
 * no signal: the client's sites and their rates, and the rest (formTerms). The
 * line itself is written on the phone and sent by the queue (#lib/queue), so
 * there is no form action.
 *
 * Only a draft takes a line. An invoice that has gone out opens as itself for
 * Full, and is not found for someone with Field, as its own page is not
 * (#lib/access), so its number and client stay with Full. A line refused for
 * one that has since gone out is fixed on the phone's own screen for it
 * (/invoices/on-phone/add), from Invoices, to go on the client's next draft.
 */
export const load: PageServerLoad = async ({ params, locals, route, request }) => {
	if (!UUID.test(params.id)) error(404, 'no such invoice');
	const draft = await db
		.selectFrom('invoice as i')
		.innerJoin('entity as e', 'e.id', 'i.entity_id')
		.select(['i.id', 'i.client_uuid', 'i.number', 'i.status', 'i.entity_id', 'e.name as who'])
		.where('i.id', '=', params.id)
		.executeTakeFirst();
	if (!draft) error(404, 'no such invoice');
	if (draft.status !== 'draft') {
		if (!fieldOnly(locals)) redirect(303, `/invoices/${draft.id}`);
		await refusedForAccess({ locals, route, request });
		error(404, 'no such invoice');
	}
	const [sites, terms] = await Promise.all([
		db
			.selectFrom('site')
			.select((eb) => [
				'id',
				'display as label',
				// Its state, and where the business collects there and the site has
				// been placed, its area's rate today on every kind the state taxes and
				// what its pieces for one kind alone add; and its client's exemptions in
				// force there, each with the kinds it covers and nothing of why
				// (#lib/server/tax-registrations).
				'region as state',
				siteRate(
					{ region: eb.ref('site.region'), area: eb.ref('site.tax_area_id') },
					businessToday()
				).as('rate_pct'),
				siteKindRates(
					{ region: eb.ref('site.region'), area: eb.ref('site.tax_area_id') },
					businessToday()
				).as('kind_rates'),
				siteExemptions({ entity: eb.ref('site.entity_id'), region: eb.ref('site.region') }).as(
					'exempt'
				)
			])
			.where('entity_id', '=', draft.entity_id)
			.where('active', '=', true)
			.orderBy('display')
			.execute(),
		formTerms()
	]);
	return { draft, sites, ...terms };
};
