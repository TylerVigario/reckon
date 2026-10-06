import { UUID } from '#lib/field-rules.ts';
import { changeLine, removeLine, type Added } from '#lib/server/lines.ts';
import { problem } from '#lib/server/problem.ts';
import type { RequestHandler } from './$types';

/** A refusal as a problem document, as /api/lines answers one. */
function answer(r: Added) {
	if (r.ok) return Response.json({ id: r.id }, { status: 200 });
	if (r.status === 404) return problem('notFound', 404, r.detail);
	if (r.status === 409) return problem('conflict', 409, r.detail);
	return problem('invalidField', 400, r.detail, { errors: r.errors });
}

/**
 * Changes a line added by hand (#lib/server/lines changeLine): its fields as
 * Add a line names them, and a new receipt where there is one. Form data, for
 * the receipt.
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No line with that id.');
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return problem('malformed', 400, 'Expected form data.');
	}
	const fields: Record<string, string> = {};
	for (const [k, v] of form.entries()) if (typeof v === 'string') fields[k] = v;
	const file = form.get('receipt');
	return answer(
		await changeLine({
			lineId: params.id,
			fields,
			receipt: file instanceof File ? file : null,
			userId: locals.user!.id
		})
	);
};

/** Takes a line off its draft (#lib/server/lines removeLine). */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No line with that id.');
	return answer(await removeLine({ lineId: params.id, userId: locals.user!.id }));
};
