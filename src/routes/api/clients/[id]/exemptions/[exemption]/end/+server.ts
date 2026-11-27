import { lookUpClient } from '#lib/server/find.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { problem } from '#lib/server/problem.ts';
import { endExemption, Refused } from '#lib/server/exemptions.ts';
import { UUID } from '#lib/field-rules.ts';
import type { RequestHandler } from './$types';

/**
 * Ends an exemption today, as its revocation is received
 * (#lib/server/exemptions): its client's drafts in its state are taxed again
 * without it. One already ended is what was asked.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	const found = await lookUpClient(params.id);
	if (!found || !UUID.test(params.exemption))
		return problem('notFound', 'No such exemption of that client.');
	try {
		const ended = await endExemption(locals.user!.id, found.id, params.exemption);
		if (!ended) return problem('notFound', 'No such exemption of that client.');
		return new Response(null, { status: 204 });
	} catch (e) {
		if (e instanceof Refused) return refuse({ [e.field]: e.message });
		throw e;
	}
};
