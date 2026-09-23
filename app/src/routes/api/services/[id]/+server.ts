import { json } from '@sveltejs/kit';
import { asUser, sql } from '$lib/server/db';
import { refuse, refuseIfTheDatabaseSaidSo } from '$lib/server/field-errors';
import { UUID } from '$lib/field-rules';
import { parseServiceField } from '$lib/service-fields';
import type { RequestHandler } from './$types';
import { problem } from '$lib/server/problem';
import { readFields } from '$lib/json';

/**
 * Saves one service's terms, a field at a time.
 *
 * Same contract as /api/settings: the shared registry decides what a value may
 * be, this side assumes the request never went through a page, and everything
 * it refuses comes back keyed by field.
 *
 * What is particular to a service is that its two terms are one decision. The
 * database says so -- subscription_terms_are_whole -- and a PATCH may carry
 * only one of them, so the pair has to be judged as it will END UP, not as it
 * arrived. That needs the current row, which is why it is checked here and
 * cannot be checked by the page.
 */
const MOST_AT_ONCE = 4;

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No service with that id.');

	const fields = await readFields(request);
	if (!fields) return problem('malformed', 400, 'Expected { fields: { name: value } }.');

	const names = Object.keys(fields);
	if (names.length === 0) return problem('malformed', 400, 'No fields given.');
	if (names.length > MOST_AT_ONCE)
		return problem('malformed', 400, `At most ${MOST_AT_ONCE} fields at once.`);

	const row: Record<string, string | number | boolean | null> = {};
	const errors: Record<string, string> = {};
	for (const name of names) {
		const raw = fields[name];
		if (raw !== null && raw !== undefined && typeof raw !== 'string' && typeof raw !== 'number') {
			errors[name] = 'Expected a value, not a structure.';
			continue;
		}
		const parsed = parseServiceField(name, raw === null || raw === undefined ? '' : String(raw));
		if (parsed.ok) row[name] = parsed.value;
		else errors[name] = parsed.why;
	}
	if (Object.keys(errors).length > 0) return refuse(errors);

	const [service] = await sql<
		{
			id: string;
			name: string;
			subscription_hours: string | null;
			subscription_overage: string | null;
		}[]
	>`
		select id, name, subscription_hours, subscription_overage
		  from service where id = ${params.id}`;
	if (!service) return problem('notFound', 404, 'No service with that id.');

	// The pair as it will end up, which is the only version worth judging.
	const hours = 'subscription_hours' in row ? row.subscription_hours : service.subscription_hours;
	const overage =
		'subscription_overage' in row ? row.subscription_overage : service.subscription_overage;

	if (hours !== null && overage === null)
		return refuse({
			[('subscription_overage' in row ? 'subscription_overage' : 'subscription_hours') as string]:
				'Included hours need a rule for what happens past them.'
		});
	if (hours === null && overage !== null)
		return refuse({
			[('subscription_hours' in row ? 'subscription_hours' : 'subscription_overage') as string]:
				'There are no included hours for that rule to apply to.'
		});

	try {
		// asUser so the history names who changed what a client is owed, rather
		// than recording that somebody did.
		await asUser(
			locals.user!.id,
			(tx) => tx`update service set ${tx(row)} where id = ${params.id}`
		);
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, names, 'service');
		if (refused) return refused;
		throw e;
	}

	return json({ saved: row });
};
