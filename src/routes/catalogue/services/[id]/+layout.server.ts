import { error, redirect } from '@sveltejs/kit';
import { count, eq, or } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { UUID } from '#lib/field-rules.ts';
import { prices } from '#lib/server/catalogue.ts';
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

	const [service] = await db
		.select({
			id: t.service.id,
			name: t.service.name,
			unit: t.service.unit,
			time_tracked: t.service.timeTracked,
			taxable: t.service.taxable,
			active: t.service.active,
			bill_to_nearest_seconds: t.service.billToNearestSeconds,
			minimum_charge: t.service.minimumCharge
		})
		.from(t.service)
		.where(or(eq(t.service.id, params.id), eq(t.service.clientUuid, params.id)));
	if (!service) error(404, 'no such service');
	if (service.id !== params.id) redirect(303, `/catalogue/services/${service.id}`);

	const uses = (table: typeof t.timeEntry | typeof t.tripLeg | typeof t.agreementService) =>
		db.select({ n: count() }).from(table).where(eq(table.serviceId, service.id));
	// What would stop it being deleted: the same three things the schema
	// refuses a delete over. Its own prices and rules do not count -- they go
	// with it.
	const [priced, [entries], [legs], [agreements]] = await Promise.all([
		prices(service.id),
		uses(t.timeEntry),
		uses(t.tripLeg),
		uses(t.agreementService)
	]);
	return {
		service,
		today: businessToday(),
		// What every client pays now: what a service is known by.
		rate: priced.find((p) => p.client === null && p.state === 'current')?.rate ?? null,
		used: { entries: entries.n, legs: legs.n, agreements: agreements.n }
	};
};
