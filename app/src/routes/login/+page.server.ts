import { fail, redirect } from '@sveltejs/kit';
import { authenticate, open, COOKIE } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

// eslint-disable-next-line @typescript-eslint/require-await -- a load is async by contract
export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) redirect(303, url.searchParams.get('next') || '/');
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const f = await request.formData();
		// Only a text part is a credential. A file part named `password` is not
		// one, and String()ing it would have compared "[object File]" instead.
		const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');
		const email = text(f.get('email')).trim();
		const password = text(f.get('password'));
		if (!email || !password) return fail(400, { email, message: 'Both, please.' });

		const { user, lockedFor } = await authenticate(email, password);

		if (lockedFor)
			return fail(429, { email, message: `Too many attempts. Try again in ${lockedFor} minutes.` });

		// One message for every failure. Saying which half was wrong tells
		// anyone who asks which accounts exist.
		if (!user) return fail(400, { email, message: 'Wrong email or password.' });

		const { token, maxAge } = await open(user.id, request.headers.get('user-agent'));
		cookies.set(COOKIE, token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: url.protocol === 'https:',
			maxAge
		});

		// Only ever within this site: an open redirect turns a login page into
		// a way to make a phishing link look like yours.
		const next = f.get('next');
		const to =
			typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';
		redirect(303, to);
	}
};
