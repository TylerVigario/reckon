import { refuse } from '#lib/server/field-errors.ts';
import { madeAt } from '#lib/server/made-at.ts';
import { problem } from '#lib/server/problem.ts';
import { receive } from '#lib/server/receive.ts';
import type { RequestHandler } from './$types';

/**
 * Takes a receipt from the phone's queue (#lib/queue): its fields, its items,
 * the uuid it was made with and the paper (#lib/server/receive). Form data,
 * not JSON, because a receipt is a file. Safe to send twice: a repeat answers
 * with the receipt already made. What is wrong is a refusal the phone keeps
 * with the receipt and shows, to be fixed or let go.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return problem('malformed', 400, 'Expected form data.');
	}
	const when = form.get('made_at');
	const done = await receive(form, locals.user!.id, madeAt(typeof when === 'string' ? when : ''));
	if (!done.ok) return refuse(done.errors);
	return Response.json({ id: done.id }, { status: 201 });
};
