import { json } from '@sveltejs/kit';
import { asUser, sql } from '$lib/server/db';
import { refuse, refuseIfTheDatabaseSaidSo } from '$lib/server/field-errors';
import { parseAll } from '$lib/field-rules';
import { NEW_SERVICE_FIELDS } from '$lib/service-fields';
import { toSlug } from '$lib/slug';
import type { RequestHandler } from './$types';
import { problem } from '$lib/server/problem';
import { readFields } from '$lib/json';

/**
 * Creates a service, from a name and what it is charged per.
 *
 * Nothing else is asked for, because nothing else is needed to exist: a price
 * and a pay rule are each added on the service's own screen,
 * dated from the day they start. An hourly service starts billing to the
 * nearest minute, like every hourly service already does.
 *
 * `code` is the service's internal handle and nobody types it. It is made from
 * the name, and numbered when two names read the same.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const fields = await readFields(request);
	if (!fields) return problem('malformed', 400, 'Expected { fields: { name: value } }.');

	const { values, errors } = parseAll(NEW_SERVICE_FIELDS, fields);
	if (Object.keys(errors).length > 0) return refuse(errors);

	const base = toSlug(String(values.name)) || 'service';
	const taken = new Set(
		(
			await sql<{ code: string }[]>`
				select code from service where code = ${base} or code like ${base + '-%'}`
		).map((r) => r.code)
	);
	let code = base;
	for (let n = 2; taken.has(code); n++) code = `${base}-${n}`;

	try {
		const [made] = await asUser(
			locals.user!.id,
			(tx) => tx<{ id: string }[]>`
				insert into service (code, name, unit, bill_to_nearest_seconds)
				values (${code}, ${String(values.name)}, ${String(values.unit)},
				        ${values.unit === 'hour' ? 60 : null})
				returning id`
		);
		return json({ id: made.id }, { status: 201 });
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, ['name', 'unit'], 'service');
		if (refused) return refused;
		throw e;
	}
};
