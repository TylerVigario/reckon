import { UUID } from '#lib/field-rules.ts';
import { answer, changeLine, madeAt, removeLine } from '#lib/server/lines.ts';
import { problem } from '#lib/server/problem.ts';
import type { RequestHandler } from './$types';

/** What a phone said it began from: a save of the line, and its fields then. */
function began(form: FormData) {
	const v = form.get('version');
	const version = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined;
	let base: Record<string, string> | undefined;
	const b = form.get('base');
	if (typeof b === 'string')
		try {
			const parsed: unknown = JSON.parse(b);
			if (parsed && typeof parsed === 'object')
				base = Object.fromEntries(
					Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string')
				);
		} catch {
			/* no base: changed as it stands */
		}
	return { version, base };
}

/**
 * Changes a line added by hand (#lib/server/lines changeLine): its fields as
 * Add a line names them, a new receipt where there is one, and -- from a
 * phone -- the save it began from and its fields then, so a line changed
 * meanwhile is merged rather than overwritten. Form data, for the receipt.
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
	for (const [k, v] of form.entries())
		if (typeof v === 'string' && !['version', 'base', 'made_at'].includes(k)) fields[k] = v;
	const file = form.get('receipt');
	const when = form.get('made_at');
	return answer(
		await changeLine({
			lineId: params.id,
			fields,
			receipt: file instanceof File ? file : null,
			userId: locals.user!.id,
			...began(form),
			madeAt: madeAt(typeof when === 'string' ? when : '')
		})
	);
};

/**
 * Takes a line off its draft (#lib/server/lines removeLine). From a phone, the
 * save it was taken off at: one changed since is asked about, unless force.
 */
export const DELETE: RequestHandler = async ({ params, url, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No line with that id.');
	const v = url.searchParams.get('version');
	return answer(
		await removeLine({
			lineId: params.id,
			userId: locals.user!.id,
			version: v && /^\d+$/.test(v) ? Number(v) : undefined,
			force: url.searchParams.get('force') === '1',
			madeAt: madeAt(url.searchParams.get('made_at') ?? '')
		})
	);
};
