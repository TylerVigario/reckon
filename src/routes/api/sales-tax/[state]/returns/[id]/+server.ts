import { refuse } from '#lib/server/field-errors.ts';
import { problem } from '#lib/server/problem.ts';
import { Refused, removeReturn } from '#lib/server/sales-tax.ts';
import { UUID } from '#lib/field-rules.ts';
import { isState } from '#lib/us-states.ts';
import type { RequestHandler } from './$types';

/**
 * Takes off a return recorded by mistake (#lib/server/sales-tax): its history
 * keeps what it was. One an amended return corrects stays until that one goes.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!isState(params.state) || !UUID.test(params.id))
		return problem('notFound', 404, 'No such return.');
	try {
		const gone = await removeReturn(locals.user!.id, params.state, params.id);
		if (!gone) return problem('notFound', 404, 'No such return.');
		return new Response(null, { status: 204 });
	} catch (e) {
		if (e instanceof Refused) return refuse({ [e.field]: e.message });
		throw e;
	}
};
