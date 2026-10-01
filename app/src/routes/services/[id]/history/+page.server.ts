import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { service as services } from '$lib/server/db/schema';
import { UUID } from '$lib/field-rules';
import { prices, rules } from '$lib/server/catalogue';
import type { PageServerLoad } from './$types';

/**
 * Everything a service has been priced at and paid by, including what no longer
 * is. Kept off the services screen so that screen says what is true now; here
 * because a line billed in June was billed at June's price, and this is where
 * that price is still written down.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!UUID.test(params.id)) error(404, 'no such service');

	const [service] = await db
		.select({ id: services.id, name: services.name, unit: services.unit })
		.from(services)
		.where(eq(services.id, params.id));
	if (!service) error(404, 'no such service');

	const [priced, paying] = await Promise.all([prices(service.id), rules(service.id)]);
	return { service, prices: priced, rules: paying };
};
