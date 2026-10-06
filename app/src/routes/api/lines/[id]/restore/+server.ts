import { UUID } from '#lib/field-rules.ts';
import { answer, madeAt, restoreLine } from '#lib/server/lines.ts';
import { problem } from '#lib/server/problem.ts';
import type { RequestHandler } from './$types';

/**
 * Puts a line taken off back on its draft, with the change a phone made to it
 * meanwhile (#lib/server/lines restoreLine): its fields as Add a line names
 * them, and a receipt where there is a new one.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No line with that id.');
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return problem('malformed', 400, 'Expected form data.');
	}
	const fields: Record<string, string> = {};
	for (const [k, v] of form.entries())
		if (typeof v === 'string' && !['version', 'base', 'made_at'].includes(k)) fields[k] = v;
	const file = form.get('receipt');
	const when = form.get('made_at');
	return answer(
		await restoreLine({
			lineId: params.id,
			fields,
			receipt: file instanceof File ? file : null,
			userId: locals.user!.id,
			madeAt: madeAt(typeof when === 'string' ? when : '')
		})
	);
};
