import type { Updateable } from 'kysely';
import { asUser } from '#lib/server/db/index.ts';
import type { Entity } from '#lib/server/db/database.ts';
import { refuse, refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';
import { lookUpClient } from '#lib/server/find.ts';
import { parseClientField } from '#lib/client-fields.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import {
	preconditionOf,
	staleRead,
	unchangedSince,
	VERSION,
	withVersion
} from '#lib/server/concurrent.ts';
import { readFields } from '#lib/json.ts';

/**
 * Saves one client's standing terms, a field at a time. Their exemptions are
 * each a state's, recorded and ended on their own (/api/clients/[id]/exemptions).
 */
const MOST_AT_ONCE = 8;

export const PATCH: RequestHandler = async (event) => {
	const { params, request, locals } = event;

	const pre = preconditionOf(event);
	if (!pre.ok) return pre.response;

	// A slug or an id, the same as the pages: every link in the app carries a
	// slug, and an endpoint that only answers to the primary key makes the
	// caller hold two names for one thing.
	const found = await lookUpClient(params.id);
	if (!found) return problem('notFound', 404, 'No client by that name or id.');
	const id = found.id;

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
		const parsed = parseClientField(name, raw === null || raw === undefined ? '' : String(raw));
		if (parsed.ok) row[name] = parsed.value;
		else errors[name] = parsed.why;
	}
	if (Object.keys(errors).length > 0) return refuse(errors);

	let after: { version: string } | undefined;
	try {
		// The version is checked IN the update, not before it: checking first
		// and writing second leaves a window between them, which is the race
		// this exists to close.
		after = await asUser(locals.user!.id, (tx) =>
			tx
				.updateTable('entity')
				.set(row as Updateable<Entity>)
				.where('id', '=', id)
				.where(unchangedSince(pre.version))
				.returning(VERSION.as('version'))
				.executeTakeFirst()
		);
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, names, 'entity');
		if (refused) return refused;
		throw e;
	}

	if (!after) return staleRead('this client', event.url.pathname);
	return withVersion(Response.json({ saved: row, version: after.version }), after.version);
};
