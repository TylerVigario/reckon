import { asUser } from '#lib/server/db/index.ts';
import { refuse, refuseIfTheDatabaseSaidSo, stillReferenced } from '#lib/server/field-errors.ts';
import { UUID } from '#lib/field-rules.ts';
import { parseUnitField, UNIT_FIELDS } from '#lib/unit-fields.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readFields } from '#lib/json.ts';

/**
 * Changes a unit's name, how it is written, or its places. Everything counted
 * in it follows, except an invoice line, which keeps the words it was billed
 * in. Places say what may be entered from now on; a quantity already held keeps
 * its own.
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 'No unit with that id.');
	const fields = await readFields(request);
	const names = fields ? Object.keys(fields) : [];
	if (!fields || names.length === 0 || names.some((n) => !(n in UNIT_FIELDS)))
		return problem('malformed', 'Expected { fields: { name, short or places: value } }.');

	const row: Record<string, string | number | null> = {};
	const errors: Record<string, string> = {};
	for (const name of names) {
		const raw = fields[name];
		const parsed = parseUnitField(
			name,
			typeof raw === 'string' || typeof raw === 'number' ? String(raw) : ''
		);
		if (parsed.ok) row[name] = parsed.value as string | number | null;
		else errors[name] = parsed.why;
	}
	if (Object.keys(errors).length > 0) return refuse(errors);

	try {
		const changed = await asUser(locals.user!.id, (tx) =>
			tx
				.updateTable('unit')
				.set({
					...('name' in row ? { name: String(row.name) } : {}),
					...('short' in row ? { short: row.short === null ? null : String(row.short) } : {}),
					...('places' in row ? { places: Number(row.places) } : {})
				})
				.where('id', '=', params.id)
				.returning('id')
				.execute()
		);
		if (changed.length === 0) return problem('notFound', 'No unit with that id.');
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, names, 'unit');
		if (refused) return refused;
		throw e;
	}
	return Response.json({ saved: row });
};

/**
 * Removes a unit nothing is counted in. Otherwise the schema refuses it, and
 * the answer says why: what was counted in it would be counted in nothing.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 'No unit with that id.');
	try {
		const gone = await asUser(locals.user!.id, (tx) =>
			tx.deleteFrom('unit').where('id', '=', params.id).returning('id').execute()
		);
		if (gone.length === 0) return problem('notFound', 'No unit with that id.');
	} catch (e) {
		if (stillReferenced(e))
			return problem(
				'notAsThingsStand',
				'Materials are counted in this unit. Count them in another first.'
			);
		throw e;
	}
	return Response.json({ removed: params.id });
};
