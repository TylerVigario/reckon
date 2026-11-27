import { lookUpClient } from '#lib/server/find.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { problem } from '#lib/server/problem.ts';
import { Refused, removeExemption } from '#lib/server/exemptions.ts';
import { UUID } from '#lib/field-rules.ts';
import type { RequestHandler } from './$types';

/**
 * Takes off an exemption recorded by mistake (#lib/server/exemptions): one an
 * invoice that went out was untaxed by is ended instead.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const found = await lookUpClient(params.id);
	if (!found || !UUID.test(params.exemption))
		return problem('notFound', 'No such exemption of that client.');
	try {
		const gone = await removeExemption(locals.user!.id, found.id, params.exemption);
		if (!gone) return problem('notFound', 'No such exemption of that client.');
		return new Response(null, { status: 204 });
	} catch (e) {
		if (e instanceof Refused) return refuse({ [e.field]: e.message });
		throw e;
	}
};
