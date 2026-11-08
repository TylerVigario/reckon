import { fail } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { count } from '#lib/format.ts';
import {
	MAX_PASSWORD_LENGTH,
	MIN_PASSWORD_LENGTH,
	authHeaders,
	getAuth
} from '#lib/server/auth.ts';
import { forgive, takeTry } from '#lib/server/sign-in-limit.ts';
import type { Actions, PageServerLoad } from './$types';

/**
 * Changing one's own password, with the current one: whoever is at a screen
 * left signed in is not always whoever signed in (OWASP ASVS 6.2.3). This
 * browser is given a new session and every other is signed out (7.4.3). A
 * forgotten one is reset on Team, by someone else with Full.
 *
 * A try at the current password counts against the address as a sign-in does
 * (#lib/server/sign-in-limit), or that screen could guess at it without end.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- a load is async by contract
export const load: PageServerLoad = async ({ locals }) => ({
	email: locals.user!.email,
	min: MIN_PASSWORD_LENGTH
});

export const actions: Actions = {
	default: async (event) => {
		const f = await event.request.formData();
		// Only a text part is a password, as on the sign-in form.
		const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');
		const current = text(f.get('current'));
		const password = text(f.get('password'));
		const confirm = text(f.get('confirm'));

		if (!current) return fail(400, { field: 'current', message: 'Enter your current password.' });
		if (password.length < MIN_PASSWORD_LENGTH)
			return fail(400, {
				field: 'password',
				message: `Enter a password of at least ${MIN_PASSWORD_LENGTH} characters.`
			});
		if (password.length > MAX_PASSWORD_LENGTH)
			return fail(400, {
				field: 'password',
				message: `Enter a password of at most ${MAX_PASSWORD_LENGTH} characters.`
			});
		if (confirm !== password)
			return fail(400, { field: 'confirm', message: 'The passwords don’t match.' });

		const address = event.getClientAddress();
		const wait = takeTry(address);
		if (wait)
			return fail(429, {
				field: '',
				message: `Too many tries from here. Try again in ${count(Math.ceil(wait / 60), 'minute')}.`
			});

		const wrong = () =>
			fail(400, { field: 'current', message: 'That isn’t your current password.' });
		// Longer than any password can be, so not theirs.
		if (current.length > MAX_PASSWORD_LENGTH) return wrong();
		try {
			await getAuth().api.changePassword({
				body: { currentPassword: current, newPassword: password, revokeOtherSessions: true },
				headers: authHeaders(event)
			});
		} catch (e) {
			if (e instanceof APIError && e.body?.code === 'INVALID_PASSWORD') return wrong();
			throw e;
		}
		forgive(address);
		return { updated: true };
	}
};
