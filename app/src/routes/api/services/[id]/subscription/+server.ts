import { json } from '@sveltejs/kit';
import { asUser } from '$lib/server/db';
import { refuse, refuseIfTheDatabaseSaidSo } from '$lib/server/field-errors';
import { UUID } from '$lib/field-rules';
import { readSubscription, SUBSCRIPTION_FIELDS } from '$lib/service-fields';
import type { RequestHandler } from './$types';
import { problem } from '$lib/server/problem';
import { readFields } from '$lib/json';

/**
 * How a service is sold on subscription, replaced whole.
 *
 * PUT, because the four columns are one decision and are always written
 * together: a cap with its hours, its period and what happens past it, or no
 * cap and none of them. subscription_terms_match_basis refuses anything in
 * between, so there is no half of it to PATCH.
 */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No service with that id.');

	const fields = await readFields(request);
	if (!fields) return problem('malformed', 400, 'Expected { fields: { name: value } }.');

	const { values, errors } = readSubscription(fields);
	if (Object.keys(errors).length > 0) return refuse(errors);

	try {
		const changed = await asUser(
			locals.user!.id,
			(tx) => tx`update service set ${tx(values)} where id = ${params.id} returning id`
		);
		if (changed.length === 0) return problem('notFound', 404, 'No service with that id.');
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, Object.keys(SUBSCRIPTION_FIELDS), 'service');
		if (refused) return refused;
		throw e;
	}
	return json({ saved: values });
};
