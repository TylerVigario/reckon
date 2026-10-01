import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { asUser, db } from '$lib/server/db';
import { agreement, entity, INTERVALS } from '$lib/server/db/schema';
import { pgError, refuse, refuseIfTheDatabaseSaidSo } from '$lib/server/field-errors';
import { NEW_AGREEMENT_FIELDS, readNewAgreement } from '$lib/agreement-fields';
import type { RequestHandler } from './$types';
import { problem } from '$lib/server/problem';
import { readFields } from '$lib/json';

/**
 * Makes an agreement: whose -- a client as a whole, or one of its sites -- what
 * it charges, how often, and from which day. What it covers is added on its own
 * screen, which is where the page goes next: there is no default allotment.
 *
 * The billing day is taken from the start day here, and left alone after: an
 * agreement from the 1st bills on the 1st, whatever its start is moved to.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const fields = await readFields(request);
	if (!fields) return problem('malformed', 400, 'Expected { fields: { name: value } }.');

	const { values, errors } = readNewAgreement(fields);
	if (Object.keys(errors).length > 0) return refuse(errors);

	const [client] = await db
		.select({ id: entity.id })
		.from(entity)
		.where(and(eq(entity.id, String(values.entity_id)), eq(entity.active, true)));
	if (!client) return refuse({ entity_id: 'No such client.' });

	try {
		const startsOn = String(values.starts_on);
		const [made] = await asUser(locals.user!.id, (tx) =>
			tx
				.insert(agreement)
				.values({
					entityId: client.id,
					siteId: values.site_id === null ? null : String(values.site_id),
					price: String(values.price),
					billingInterval: String(values.billing_interval) as (typeof INTERVALS)[number],
					startsOn,
					billingAnchorDay: Number(startsOn.slice(8, 10))
				})
				.returning({ id: agreement.id })
		);
		return json({ id: made.id }, { status: 201 });
	} catch (e) {
		// A site of another client is refused by agreement_site_is_the_clients.
		if (pgError(e).constraint === 'agreement_site_is_the_clients')
			return refuse({ site_id: 'A site that is not this client’s.' });
		const refused = refuseIfTheDatabaseSaidSo(e, Object.keys(NEW_AGREEMENT_FIELDS), 'agreement');
		if (refused) return refused;
		throw e;
	}
};
