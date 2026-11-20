import { error, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { UUID } from '#lib/field-rules.ts';
import { prices } from '#lib/server/catalogue.ts';
import { kindChoices } from '#lib/server/sale-kinds.ts';
import type { LayoutServerLoad } from './$types';

/**
 * One service as a record: what it is, what every client pays for it now, and
 * what would keep it from being deleted -- what its head and its menu say,
 * whichever tab is open. Each tab loads its own part.
 *
 * Opened by the uuid it was added with, too -- where New service goes once the
 * queue has sent it -- which answers with its own address.
 */
export const load: LayoutServerLoad = async ({ params }) => {
	if (!UUID.test(params.id)) error(404, 'no such service');

	const service = await db
		.selectFrom('service')
		.select([
			'id',
			'name',
			'unit',
			'time_tracked',
			'sale_kind_id',
			'active',
			'bill_to_nearest_seconds',
			'minimum_charge'
		])
		.where((eb) => eb.or([eb('id', '=', params.id), eb('client_uuid', '=', params.id)]))
		.executeTakeFirst();
	if (!service) error(404, 'no such service');
	if (service.id !== params.id) redirect(303, `/catalogue/services/${service.id}`);

	const uses = (table: 'time_entry' | 'trip_leg' | 'agreement_service') =>
		db
			.selectFrom(table)
			.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
			.where('service_id', '=', service.id)
			.executeTakeFirstOrThrow();
	// What would stop it being deleted: the same three things the schema
	// refuses a delete over. Its own prices and rules do not count -- they go
	// with it.
	const [priced, entries, legs, agreements, kinds] = await Promise.all([
		prices(service.id),
		uses('time_entry'),
		uses('trip_leg'),
		uses('agreement_service'),
		kindChoices(db)
	]);
	return {
		service,
		today: businessToday(),
		// What every client pays now: what a service is known by.
		rate: priced.find((p) => p.client === null && p.state === 'current')?.rate ?? null,
		used: { entries: entries.n, legs: legs.n, agreements: agreements.n },
		// The kinds of sale it could be, by the business's word for each.
		kinds
	};
};
