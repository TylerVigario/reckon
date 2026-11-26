import { lookUpClient } from '#lib/server/find.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { problem } from '#lib/server/problem.ts';
import { recordExemption, Refused } from '#lib/server/exemptions.ts';
import { parseExemption } from '#lib/exemption-fields.ts';
import { readJson } from '#lib/json.ts';
import type { RequestHandler } from './$types';

/**
 * Records a client's exemption from the certificate (#lib/server/exemptions):
 * { fields: { state, reason, explanation, supported_by }, kinds: null for
 * every kind of sale, or the ids of those it covers }. Their drafts in that
 * state are taxed again as it untaxes them.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const found = await lookUpClient(params.id);
	if (!found) return problem('notFound', 404, 'No client by that name or id.');
	const body = (await readJson(request).catch(() => null)) as {
		fields?: Record<string, unknown>;
		kinds?: unknown;
	} | null;
	if (!body?.fields || typeof body.fields !== 'object' || !('kinds' in body))
		return problem(
			'malformed',
			400,
			'Expected { fields: { state, reason, explanation, supported_by }, kinds: null or [...] }.'
		);
	const { value, errors } = parseExemption(body.fields, body.kinds);
	if (!value) return refuse(errors);
	try {
		const id = await recordExemption(locals.user!.id, found.id, value);
		return Response.json({ id }, { status: 201 });
	} catch (e) {
		if (e instanceof Refused) return refuse({ [e.field]: e.message });
		throw e;
	}
};
