import type { Updateable } from 'kysely';
import { asUser, db } from '#lib/server/db/index.ts';
import type { Agreement } from '#lib/server/db/database.ts';
import { isTie, placeOf, tiedWith } from '#lib/server/agreement-tie.ts';
import { refuse, refuseIfTheDatabaseSaidSo, stillReferenced } from '#lib/server/field-errors.ts';
import { UUID } from '#lib/field-rules.ts';
import { parseAgreementField } from '#lib/agreement-fields.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readFields } from '#lib/json.ts';

/**
 * Saves what an agreement charges and when it runs, a field at a time.
 *
 * A change here is a change from now on: what a period already charged is
 * written on that period, as it was, and stays so.
 */
const MOST_AT_ONCE = 4;

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 'No agreement with that id.');

	const fields = await readFields(request);
	if (!fields) return problem('malformed', 'Expected { fields: { name: value } }.');
	const names = Object.keys(fields);
	if (names.length === 0) return problem('malformed', 'No fields given.');
	if (names.length > MOST_AT_ONCE)
		return problem('malformed', `At most ${MOST_AT_ONCE} fields at once.`);

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

	const agreement = await db
		.selectFrom('agreement')
		.select(['entity_id', 'starts_on', 'ends_on'])
		.where('id', '=', params.id)
		.executeTakeFirst();
	if (!agreement) return problem('notFound', 'No agreement with that id.');

	// Said in words before the schema says it in a constraint name.
	const starts = 'starts_on' in row ? String(row.starts_on) : agreement.starts_on;
	const ends = 'ends_on' in row ? (row.ends_on as string | null) : agreement.ends_on;
	if (ends !== null && ends < starts)
		return refuse({
			['ends_on' in row ? 'ends_on' : 'starts_on']: 'It cannot end before it starts.'
		});
	if (row.contact_id) {
		const theirs = await db
			.selectFrom('entity_contact')
			.select('contact_id as id')
			.where('entity_id', '=', agreement.entity_id)
			.where('contact_id', '=', String(row.contact_id))
			.executeTakeFirst();
		if (!theirs) return refuse({ contact_id: 'Not one of this client’s contacts.' });
	}

	try {
		await asUser(locals.user!.id, (tx) =>
			tx
				.updateTable('agreement')
				.set(row as Updateable<Agreement>)
				.where('id', '=', params.id)
				.execute()
		);
	} catch (e) {
		// Moved onto the day another of the client's agreements, for the same
		// place, starts, while both cover a service: named, as covering one is.
		if (isTie(e)) {
			const tie = await tiedWith(params.id, starts);
			return refuse({
				starts_on: tie
					? `This client’s other agreement for ${placeOf(tie)} starts that day and covers ${tie.service} too. Start this one on another day, or stop covering ${tie.service} on one of them.`
					: 'Another of this client’s agreements, for the same place, starts that day and covers a service this one does.'
			});
		}
		const refused = refuseIfTheDatabaseSaidSo(e, names, 'agreement');
		if (refused) return refused;
		throw e;
	}
	return Response.json({ saved: row });
};

/**
 * Removes an agreement nothing has been charged under -- one made by mistake.
 * One with a charged period is refused by the schema, and the answer says to
 * end it instead: what it charged stays charged under it.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 'No agreement with that id.');
	try {
		const gone = await asUser(locals.user!.id, (tx) =>
			tx.deleteFrom('agreement').where('id', '=', params.id).returning('id').execute()
		);
		if (gone.length === 0) return problem('notFound', 'No agreement with that id.');
	} catch (e) {
		if (stillReferenced(e))
			return problem(
				'notAsThingsStand',
				'A period has been charged under this agreement. End it instead: what it charged stays charged under it.'
			);
		throw e;
	}
	return Response.json({ removed: params.id });
};
