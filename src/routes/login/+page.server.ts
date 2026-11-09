import { randomBytes } from 'node:crypto';
import { count } from '#lib/format.ts';
import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.ts';
import { authHeaders, getAuth, rehashIfDated } from '#lib/server/auth.ts';
import { settleTry, takeTry } from '#lib/server/sign-in-limit.ts';
import { browserSignedInAs, signedInHere } from '#lib/server/signed-in-here.ts';
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

		// Recorded before the password is checked, so tries sent at once are each
		// counted, and alike for every email, whether or not anyone signs in with
		// it (#lib/server/sign-in-limit).
		const tried = await takeTry({
			page: 'sign_in',
			address: event.getClientAddress(),
			email,
			browser: browserSignedInAs(event.cookies, email)
		});
		if ('refused' in tried)
			return fail(429, {
				email,
				message: `Too many tries ${tried.refused.by === 'address' ? 'from here' : 'for this email'}. Try again in ${count(Math.ceil(tried.refused.wait / 60), 'minute')}.`
			});

		// One message for every failure. Saying which half was wrong tells anyone
		// who asks which accounts exist.
		const wrong = async (outcome: 'wrong' | 'inactive' | 'stopped') => {
			await settleTry(tried, outcome);
			return fail(400, { email, message: 'Wrong email or password.' });
		};
		const signIn = (given: string) =>
			getAuth().api.signInEmail({ body: { email, password: given }, headers: authHeaders(event) });

		let userId: string;
		try {
			// A password that has stopped is not checked. One that cannot be right
			// is, so the answer takes as long as a wrong one does.
			if (tried.stopped) {
				await signIn(randomBytes(32).toString('hex')).catch(() => {});
				return await wrong('stopped');
			}
			const signedIn = await signIn(password);
			userId = signedIn.user.id;
			// Someone made inactive answers exactly as a wrong password does, and
			// is counted as one.
			if (signedIn.user.active === false) {
				await db.delete(schema.session).where(eq(schema.session.userId, userId));
				// A Secure cookie's name carries __Secure- in front of its own.
				event.cookies.getAll().forEach(({ name }) => {
					if (name.replace(/^__Secure-/, '').startsWith('reckon.'))
						event.cookies.delete(name, { path: '/' });
				});
				return await wrong('inactive');
			}
		} catch (e) {
			if (!(e instanceof APIError)) throw e;
			return await wrong('wrong');
		}
		await settleTry(tried, 'right');
		signedInHere(event.cookies, email);
		await rehashIfDated(userId, password);
		// What Team says as their last sign-in. Signing in is not a change to the
		// person, so updated_at stays as it was.
		await db
			.update(schema.user)
			.set({ lastSignedInAt: sql`now()`, updatedAt: sql`${schema.user.updatedAt}` })
			.where(eq(schema.user.id, userId));
		redirect(303, safeNext(f.get('next'), event.url.origin));
	}
};
