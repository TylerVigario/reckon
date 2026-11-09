import { fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { account, session, user } from '#lib/server/db/schema/index.ts';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, hashPassword } from '#lib/server/auth.ts';
import { tell } from '#lib/server/email.ts';
import { missed, turnedAway, usable, used } from '#lib/server/links.ts';
import { passwordChanged } from '#lib/server/notices.js';
import { passwordSet } from '#lib/server/sign-in-limit.ts';
import type { Actions, PageServerLoad } from './$types';

/**
 * WHERE A LINK reckon emailed opens (#lib/server/links): /link#<code>. The
 * code never reaches the server in the address, so the page reads it in the
 * browser and posts it here -- first to look it up, then to choose a password
 * with it, or to confirm the address it went to.
 *
 * Open to anyone, since whoever has the link is not signed in yet, and drawn
 * outside the app as sign-in is. Every code that is not one to use is
 * answered alike and counts against the network it came from; a network that
 * has missed too often waits. Choosing a password does not sign anyone in:
 * they sign in with it (OWASP's Forgot Password Cheat Sheet, "Don't
 * automatically log the user in"), and every session they had is ended.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- a load is async by contract
export const load: PageServerLoad = async ({ locals, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	return {
		min: MIN_PASSWORD_LENGTH,
		max: MAX_PASSWORD_LENGTH,
		// Whoever is signed in in this browser, who has to sign out to sign in as
		// someone else.
		signedInAs: locals.user ? { name: locals.user.name, email: locals.user.email } : null
	};
};

/** Only a text part is a code or a password, as on the sign-in form. */
const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

const WAIT = fail(429, { why: 'wait' as const });
const DEAD = { why: 'dead' as const };

export const actions: Actions = {
	/** What a code is for, and whose it is: or that it is not one to use. */
	look: async ({ request, getClientAddress }) => {
		const address = getClientAddress();
		if (await turnedAway(address)) return WAIT;
		const code = text((await request.formData()).get('code'));
		const found = await db.transaction((tx) => usable(tx, code));
		if (!found) {
			await missed(address);
			return fail(404, DEAD);
		}
		return { purpose: found.purpose, name: found.name, email: found.email };
	},

	/** A password chosen with an invitation or a reset's link. */
	choose: async ({ request, getClientAddress }) => {
		const address = getClientAddress();
		if (await turnedAway(address)) return WAIT;
		const f = await request.formData();
		const code = text(f.get('code'));
		const password = text(f.get('password'));
		const confirm = text(f.get('confirm'));

		// Said before the code is used, so a password refused leaves the link working.
		if (password.length < MIN_PASSWORD_LENGTH)
			return fail(400, {
				why: 'password' as const,
				field: 'password' as const,
				message: `Enter a password of at least ${MIN_PASSWORD_LENGTH} characters.`
			});
		if (password.length > MAX_PASSWORD_LENGTH)
			return fail(400, {
				why: 'password' as const,
				field: 'password' as const,
				message: `Enter a password of at most ${MAX_PASSWORD_LENGTH} characters.`
			});
		if (confirm !== password)
			return fail(400, {
				why: 'password' as const,
				field: 'confirm' as const,
				message: 'The passwords don’t match.'
			});

		const hash = await hashPassword(password);
		const chosen = await db.transaction(async (tx) => {
			const link = await usable(tx, code);
			if (!link || link.purpose === 'confirm') return null;
			const credential = and(eq(account.userId, link.userId), eq(account.providerId, 'credential'));
			const updated = await tx
				.update(account)
				.set({ password: hash })
				.where(credential)
				.returning({ id: account.id });
			// A password account names its person by their own id, as Better Auth's do.
			if (updated.length === 0)
				await tx.insert(account).values({
					userId: link.userId,
					accountId: link.userId,
					providerId: 'credential',
					password: hash
				});
			await tx
				.update(user)
				.set({ temporaryPassword: false, ...passwordSet() })
				.where(eq(user.id, link.userId));
			await used(tx, link);
			await tx.delete(session).where(eq(session.userId, link.userId));
			await tell(tx, link.userId, (them, business) =>
				passwordChanged(them, business, { at: new Date(), on: 'link' })
			);
			return link;
		});
		if (!chosen) {
			await missed(address);
			return fail(404, DEAD);
		}
		return { done: 'password' as const, email: chosen.email };
	},

	/** An address confirmed with the link sent to it. */
	confirm: async ({ request, getClientAddress }) => {
		const address = getClientAddress();
		if (await turnedAway(address)) return WAIT;
		const code = text((await request.formData()).get('code'));
		const confirmed = await db.transaction(async (tx) => {
			const link = await usable(tx, code);
			if (!link || link.purpose !== 'confirm') return null;
			await used(tx, link);
			return link;
		});
		if (!confirmed) {
			await missed(address);
			return fail(404, DEAD);
		}
		return { done: 'confirm' as const, email: confirmed.email };
	}
};
