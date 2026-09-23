import { json } from '@sveltejs/kit';
import { asUser, sql } from '$lib/server/db';
import { refuse, refuseIfTheDatabaseSaidSo } from '$lib/server/field-errors';
import { lookUpClient } from '$lib/server/find';
import { parseClientField } from '$lib/client-fields';
import type { RequestHandler } from './$types';
import { problem } from '$lib/server/problem';
import { preconditionOf, staleRead, withVersion } from '$lib/server/concurrent';
import { readFields } from '$lib/json';

/**
 * Saves one client's standing terms, a field at a time.
 *
 * EXEMPTION AND ITS CERTIFICATE ARE ONE DECISION, and a PATCH may carry only
 * one of them -- so the pair is judged as it will END UP rather than as it
 * arrived. CDTFA needs the certificate to support an untaxed sale; claiming
 * exemption without one is a claim that cannot be defended at audit, which is
 * a worse outcome than being told no here.
 */
const MOST_AT_ONCE = 8;

export const PATCH: RequestHandler = async (event) => {
	const { params, request, locals } = event;

	const pre = preconditionOf(event);
	if (!pre.ok) return pre.response;

	// A slug or an id, the same as the pages: every link in the app carries a
	// slug now, and an endpoint that only answers to the primary key makes the
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

	const [client] = await sql<
		{ id: string; tax_exempt: boolean; exemption_certificate: string | null }[]
	>`
		select id, tax_exempt, exemption_certificate from entity where id = ${id}`;

	const exempt = 'tax_exempt' in row ? row.tax_exempt : client.tax_exempt;
	const certificate =
		'exemption_certificate' in row ? row.exemption_certificate : client.exemption_certificate;

	if (exempt && !certificate) {
		return refuse({
			[('exemption_certificate' in row ? 'exemption_certificate' : 'tax_exempt') as string]:
				'CDTFA needs the certificate to support an untaxed sale. Record it, or leave them taxed.'
		});
	}

	let after: { version: string } | undefined;
	try {
		// The version is checked IN the update, not before it: checking first
		// and writing second leaves a window between them, which is the race
		// this exists to close.
		[after] = await asUser(
			locals.user!.id,
			(tx) => tx`
			update entity set ${tx(row)}
			 where id = ${id}
			   and (${pre.version}::text is null or xmin::text = ${pre.version})
			 returning xmin::text as version`
		);
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, names, 'entity');
		if (refused) return refused;
		throw e;
	}

	if (!after) return staleRead('This client', event.url.pathname);
	return withVersion(json({ saved: row, version: after.version }), after.version);
};
