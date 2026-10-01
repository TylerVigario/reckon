import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { asUser, db } from '$lib/server/db';
import { camel } from '$lib/server/db/rows';
import { agreement as agreements, entityContact } from '$lib/server/db/schema';
import { refuse, refuseIfTheDatabaseSaidSo, stillReferenced } from '$lib/server/field-errors';
import { UUID } from '$lib/field-rules';
import { parseAgreementField } from '$lib/agreement-fields';
import type { RequestHandler } from './$types';
import { problem } from '$lib/server/problem';
import { readFields } from '$lib/json';

/**
 * Saves what an agreement charges and when it runs, a field at a time.
 *
 * A change here is a change from now on: what a period already charged is
 * written on that period, as it was, and stays so.
 */
const MOST_AT_ONCE = 4;

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No agreement with that id.');

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
		const parsed = parseAgreementField(name, raw === null || raw === undefined ? '' : String(raw));
		if (parsed.ok) row[name] = parsed.value;
		else errors[name] = parsed.why;
	}
	if (Object.keys(errors).length > 0) return refuse(errors);

	const [agreement] = await db
		.select({
			entity_id: agreements.entityId,
			starts_on: agreements.startsOn,
			ends_on: agreements.endsOn
		})
		.from(agreements)
		.where(eq(agreements.id, params.id));
	if (!agreement) return problem('notFound', 404, 'No agreement with that id.');

	// Said in words before the schema says it in a constraint name.
	const starts = 'starts_on' in row ? String(row.starts_on) : agreement.starts_on;
	const ends = 'ends_on' in row ? (row.ends_on as string | null) : agreement.ends_on;
	if (ends !== null && ends < starts)
		return refuse({
			['ends_on' in row ? 'ends_on' : 'starts_on']: 'It cannot end before it starts.'
		});
	if (row.contact_id) {
		const [theirs] = await db
			.select({ id: entityContact.contactId })
			.from(entityContact)
			.where(
				and(
					eq(entityContact.entityId, agreement.entity_id),
					eq(entityContact.contactId, String(row.contact_id))
				)
			);
		if (!theirs) return refuse({ contact_id: 'Not one of this client’s contacts.' });
	}

	try {
		await asUser(locals.user!.id, (tx) =>
			tx
				.update(agreements)
				.set(camel(row) as Partial<typeof agreements.$inferInsert>)
				.where(eq(agreements.id, params.id))
		);
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, names, 'agreement');
		if (refused) return refused;
		throw e;
	}
	return json({ saved: row });
};

/**
 * Removes an agreement nothing has been charged under -- one made by mistake.
 * One with a charged period is refused by the schema, and the answer says to
 * end it instead: what it charged stays charged under it.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No agreement with that id.');
	try {
		const gone = await asUser(locals.user!.id, (tx) =>
			tx.delete(agreements).where(eq(agreements.id, params.id)).returning({ id: agreements.id })
		);
		if (gone.length === 0) return problem('notFound', 404, 'No agreement with that id.');
	} catch (e) {
		if (stillReferenced(e))
			return problem(
				'conflict',
				409,
				'A period has been charged under this agreement. End it instead: what it charged stays charged under it.'
			);
		throw e;
	}
	return json({ removed: params.id });
};
