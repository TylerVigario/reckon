import { json } from '@sveltejs/kit';
import { asUser, sql } from '$lib/server/db';
import { refuse, refuseIfTheDatabaseSaidSo } from '$lib/server/field-errors';
import { UUID } from '$lib/field-rules';
import { parseServiceField } from '$lib/service-fields';
import type { RequestHandler } from './$types';
import { problem } from '$lib/server/problem';
import { readFields } from '$lib/json';

/**
 * Saves what a service is, a field at a time.
 *
 * Same contract as /api/settings: the shared registry decides what a value may
 * be, this side assumes the request never went through a page, and everything
 * it refuses comes back keyed by field.
 *
 * WHAT IT IS CHARGED PER CARRIES ITS INCREMENT WITH IT. Only an hourly service
 * bills to the nearest so many seconds, so moving one to miles or to each
 * clears the increment in the same write, and moving one to hours starts it at
 * the nearest minute -- "bill per minute at the going rate", 9 Sep. Both are
 * reported back, so the page can show what the row now says.
 *
 * Its subscription, prices and pay rules are not here: each is a decision of
 * more than one field, and each has its own endpoint beneath this one.
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

	const [service] = await sql<{ unit: string; bill_to_nearest_seconds: number | null }[]>`
		select unit, bill_to_nearest_seconds from service where id = ${params.id}`;
	if (!service) return problem('notFound', 404, 'No service with that id.');

	const unit = 'unit' in row ? String(row.unit) : service.unit;
	if (row.bill_to_nearest_seconds != null && unit !== 'hour')
		return refuse({
			bill_to_nearest_seconds:
				'Only time is billed to an increment. This is charged per ' + unit + '.'
		});
	if ('unit' in row && !('bill_to_nearest_seconds' in row)) {
		if (unit !== 'hour') row.bill_to_nearest_seconds = null;
		else if (service.unit !== 'hour') row.bill_to_nearest_seconds = 60;
	}

	try {
		// asUser so the history names who changed what a client is charged,
		// rather than recording that somebody did.
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

/**
 * Removes a service nothing has used -- one made by mistake, or by a test.
 *
 * A service with time entered against it, a trip leg billed as it, or an
 * agreement that covers it is refused by the schema itself, and the answer says
 * to retire it instead: what it billed is still billed under its name. Its own
 * prices and pay rules go with it.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No service with that id.');
	try {
		const gone = await asUser(
			locals.user!.id,
			(tx) => tx`delete from service where id = ${params.id} returning id`
		);
		if (gone.length === 0) return problem('notFound', 404, 'No service with that id.');
	} catch (e) {
		if ((e as { code?: string }).code === '23503')
			return problem(
				'conflict',
				409,
				'Work has been recorded under this service, or an agreement covers it. Retire it instead: what it billed stays billed under its name.'
			);
		throw e;
	}
	return json({ removed: params.id });
};
