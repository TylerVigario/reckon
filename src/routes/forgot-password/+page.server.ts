import { fail } from '@sveltejs/kit';
import { parsePersonField } from '#lib/people-fields.ts';
import { askedTooOften, recover } from '#lib/server/recovery.ts';
import type { Actions, PageServerLoad } from './$types';

/**
 * FORGOT PASSWORD (#lib/server/recovery): an email in, and one answer whatever
 * it is, given before anything about it is looked up. Open to anyone, since
 * whoever asks cannot sign in, and drawn as sign-in is.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- a load is async by contract
export const load: PageServerLoad = async ({ setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	return {};
};

export const actions: Actions = {
	default: async ({ request, getClientAddress }) => {
		const address = getClientAddress();
		if (await askedTooOften(address)) return fail(429, { why: 'wait' as const });
		const raw = (await request.formData()).get('email');
		const typed = typeof raw === 'string' ? raw : '';
		const parsed = parsePersonField('email', typed);
		if (!parsed.ok || typeof parsed.value !== 'string')
			return fail(400, { why: 'email' as const, email: typed });
		const email = parsed.value;
		// Not waited for: how long it takes would say whether anyone signs in with it.
		void recover(address, email).catch((e: unknown) =>
			console.error(
				'A forgotten password was asked about and not answered:',
				e instanceof Error ? e.message : e
			)
		);
		return { asked: email };
	}
};
