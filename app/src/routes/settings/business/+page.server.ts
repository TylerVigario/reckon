import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { operator } from '$lib/server/db/schema';
import { operatorRow } from '$lib/server/operator';
import type { Actions, PageServerLoad } from './$types';

const MAX_LOGO = 512 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

/**
 * What appears on an invoice.
 *
 * Every field here saves itself as focus leaves it -- the rules are shared with
 * the endpoint in $lib/settings-fields. The logo is the exception: a file is not
 * a field, so it stays a form action.
 */
export const load: PageServerLoad = async () => ({ operator: await operatorRow() });

/**
 * The logo stays a form action. A file is not a field: there is nothing to
 * autosave until one is picked, and picking it is the whole action.
 */
export const actions: Actions = {
	logo: async ({ request }) => {
		const f = await request.formData();
		const file = f.get('logo');
		if (!(file instanceof File) || file.size === 0)
			return fail(400, { message: 'Choose an image first.' });
		if (!LOGO_TYPES.includes(file.type))
			return fail(400, {
				message: `A logo must be PNG, JPEG, SVG or WebP — that is ${file.type}.`
			});
		if (file.size > MAX_LOGO)
			return fail(400, {
				message: `A logo must be under 512 KB — that is ${Math.round(file.size / 1024)} KB.`
			});

		const bytes = Buffer.from(await file.arrayBuffer());
		const [exists] = await db.select({ id: operator.id }).from(operator).limit(1);
		if (!exists)
			return fail(400, { message: 'Set the trading name first — there is no operator yet.' });

		await db.update(operator).set({ logo: bytes, logoMediaType: file.type });
		return { saved: true };
	},

	clearLogo: async () => {
		await db.update(operator).set({ logo: null, logoMediaType: null });
		return { saved: true };
	}
};
