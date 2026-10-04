import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.ts';
import { authHeaders, getAuth, rehashIfDated } from '#lib/server/auth.ts';
import { clearFailures, recordFailure, waitFor } from '#lib/server/sign-in-limit.ts';
import { safeNext } from '#lib/safe-next.ts';
import type { Actions, PageServerLoad } from './$types';

// eslint-disable-next-line @typescript-eslint/require-await -- a load is async by contract
export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) redirect(303, safeNext(url.searchParams.get('next'), url.origin));
	return {};
};

export const actions: Actions = {
	default: async (event) => {
		const f = await event.request.formData();
		// Only a text part is a credential. A file part named `password` is not
		// one, and String()ing it would have compared "[object File]" instead.
		const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');
		const email = text(f.get('email')).trim().toLowerCase();
		const password = text(f.get('password'));
		if (!email || !password) return fail(400, { email, message: 'Both, please.' });

		const address = event.getClientAddress();
		const wait = waitFor(address);
		if (wait)
			return fail(429, {
				email,
				message: `Too many tries from here. Try again in ${Math.ceil(wait / 60)} minutes.`
			});

		let userId: string;
		try {
			const signedIn = await getAuth().api.signInEmail({
				body: { email, password },
				headers: authHeaders(event)
			});
			userId = signedIn.user.id;
			// Someone made inactive answers exactly as a wrong password does.
			if (signedIn.user.active === false) {
				await db.delete(schema.session).where(eq(schema.session.userId, userId));
				// A Secure cookie's name carries __Secure- in front of its own.
				event.cookies.getAll().forEach(({ name }) => {
					if (name.replace(/^__Secure-/, '').startsWith('reckon.'))
						event.cookies.delete(name, { path: '/' });
				});
				return fail(400, { email, message: 'Wrong email or password.' });
			}
		} catch (e) {
			if (!(e instanceof APIError)) throw e;
			recordFailure(address);
			// One message for every failure. Saying which half was wrong tells
			// anyone who asks which accounts exist.
			return fail(400, { email, message: 'Wrong email or password.' });
		}
		clearFailures(address);
		await rehashIfDated(userId, password);
		redirect(303, safeNext(f.get('next'), event.url.origin));
	}
};
