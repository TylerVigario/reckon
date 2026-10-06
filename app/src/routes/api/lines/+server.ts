import { UUID } from '#lib/field-rules.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { addLine } from '#lib/server/lines.ts';
import { problem } from '#lib/server/problem.ts';
import type { RequestHandler } from './$types';

/**
 * Accepts a line from the phone's queue (#lib/queue): which draft, the uuid the
 * phone made for the line, its fields as the Add a line form names them, and
 * its receipt.
 *
 * The queue retries on reconnect, so this must be safe to call twice with the
 * same line: a repeat answers with the line already added.
 *
 * Form data, not JSON, because a receipt is a file. Each refusal is a problem
 * document the phone keeps with the line and shows: the boxes that are wrong
 * (400), the draft gone (404), or the draft gone out meanwhile (409).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return problem('malformed', 400, 'Expected form data.');
	}
	const text = (k: string) => {
		const v = form.get(k);
		return typeof v === 'string' ? v : '';
	};
	const clientUuid = text('client_uuid');
	if (!UUID.test(clientUuid)) return refuse({ client_uuid: 'The uuid the phone made for it.' });
	const invoiceId = text('invoice_id');
	if (!UUID.test(invoiceId)) return refuse({ invoice_id: 'Which draft it is for.' });

	const fields: Record<string, string> = {};
	for (const [k, v] of form.entries())
		if (typeof v === 'string' && k !== 'client_uuid' && k !== 'invoice_id') fields[k] = v;
	const file = form.get('receipt');

	const added = await addLine({
		invoiceId,
		clientUuid,
		fields,
		receipt: file instanceof File ? file : null,
		// Never from the body: who added it is whoever is signed in.
		userId: locals.user!.id
	});
	if (added.ok) return Response.json({ id: added.id }, { status: 200 });
	if (added.status === 404) return problem('notFound', 404, added.detail);
	if (added.status === 409) return problem('conflict', 409, added.detail);
	return problem('invalidField', 400, added.detail, { errors: added.errors });
};
