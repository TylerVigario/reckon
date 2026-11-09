import { fail } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { count } from '#lib/format.ts';
import { db, schema } from '#lib/server/db/index.ts';
import {
	MAX_PASSWORD_LENGTH,
	MIN_PASSWORD_LENGTH,
	authHeaders,
	getAuth
} from '#lib/server/auth.ts';
import { tell } from '#lib/server/email.ts';
import { endPasswordLinks } from '#lib/server/links.ts';
import { passwordChanged } from '#lib/server/notices.js';
import { passwordSet, settleTry, takeTry } from '#lib/server/sign-in-limit.ts';
import type { Actions, PageServerLoad } from './$types';

/**
 * Changing one's own password, with the current one: whoever is at a screen
 * left signed in is not always whoever signed in (OWASP ASVS 6.2.3). This
 * browser is given a new session and every other is signed out (7.4.3). A
 * forgotten one is reset on Team, by someone else with Full.
 *
 * A try at the current password is recorded and counted as a sign-in is
 * (#lib/server/sign-in-limit) -- against the address, against this browser's
 * own count, and toward the hundred in a row that stop it -- or that screen
 * could guess at it without end.
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

		const me = event.locals.user!;
		// This browser is signed in as them, so its tries are a count of its own.
		const tried = await takeTry({
			page: 'password_change',
			address: event.getClientAddress(),
			email: me.email,
			browser: event.locals.sessionId
		});
		if ('refused' in tried)
			return fail(429, {
				field: '',
				message: `Too many tries ${tried.refused.by === 'address' ? 'from here' : 'at your password'}. Try again in ${count(Math.ceil(tried.refused.wait / 60), 'minute')}.`
			});
		if (tried.stopped) {
			await settleTry(tried, 'stopped');
			return fail(400, {
				field: '',
				message:
					'Your password has stopped working, after a hundred wrong tries in a row. Someone else with Full can reset it on Team.'
			});
		}

		const wrong = async () => {
			await settleTry(tried, 'wrong');
			return fail(400, { field: 'current', message: 'That isn’t your current password.' });
		};
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
		await settleTry(tried, 'right');
		await db.transaction(async (tx) => {
			await tx.update(schema.user).set(passwordSet()).where(eq(schema.user.id, me.id));
			await endPasswordLinks(tx, me.id);
			await tell(tx, me.id, (them, business) =>
				passwordChanged(them, business, { at: new Date(), on: 'profile' })
			);
		});
		return { updated: true };
	}
};
