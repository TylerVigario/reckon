import type { Updateable } from 'kysely';
import { asUser, db } from '#lib/server/db/index.ts';
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
 * Saves one client's standing terms, a field at a time.
 *
 * EXEMPTION AND ITS CERTIFICATE ARE ONE DECISION, and a PATCH may carry only
 * one of them -- so the pair is judged as it will END UP rather than as it
 * arrived. The certificate is what supports an untaxed sale; claiming
 * exemption without one is a claim that cannot be defended at audit, which is
 * a worse outcome than being told no here.
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

	const client = await db
		.selectFrom('entity')
		.select(['id', 'tax_exempt', 'exemption_certificate'])
		.where('id', '=', id)
		.executeTakeFirstOrThrow();

	const exempt = 'tax_exempt' in row ? row.tax_exempt : client.tax_exempt;
	const certificate =
		'exemption_certificate' in row ? row.exemption_certificate : client.exemption_certificate;

	if (exempt && !certificate) {
		return refuse({
			[('exemption_certificate' in row ? 'exemption_certificate' : 'tax_exempt') as string]:
				'The certificate is what supports an untaxed sale. Record it, or leave them taxed.'
		});
	}

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
