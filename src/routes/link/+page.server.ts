import { fail } from '@sveltejs/kit';
import { and, eq, ne } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/schema/index.ts';
import { authHeaders, getAuth } from '#lib/server/auth.ts';
import { MAKES_PASSKEY, missed, turnedAway, usable, used } from '#lib/server/links.ts';
import { whomToContact } from '#lib/server/whom-to-contact.ts';
import { pgError } from '#lib/server/field-errors.ts';
import type { Actions, PageServerLoad } from './$types';

/**
 * WHERE A LINK reckon emailed opens (#lib/server/links): /link#<code>. The
 * code never reaches the server in the address, so the page reads it in the
 * browser and posts it here -- first to look it up, then to make a passkey with
 * it, to confirm the address it went to, or to make that address the one its
 * person signs in with.
 *
 * Open to anyone, since whoever has the link is not signed in yet, and drawn
 * outside the app as sign-in is. Every code that is not one to use is
 * answered alike and counts against the network it came from; a network that
 * has missed too often waits. Making a passkey signs them in with it -- the
 * ceremony is the new passkey proving itself -- and every session they had
 * before is ended (#lib/server/passkeys).
 */
export const load: PageServerLoad = async ({ locals, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	return {
		// Whom to contact for a link that no longer works (#lib/server/contact).
		contact: await whomToContact(),
		// Whoever is signed in in this browser, who has to sign out to sign in as
		// someone else.
		signedInAs: locals.user ? { name: locals.user.name, email: locals.user.email } : null
	};
};

/** Only a text part is a code. */
const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

const WAIT = fail(429, { why: 'wait' as const });
const DEAD = { why: 'dead' as const };

export const actions: Actions = {
	/**
	 * The ceremony to make a passkey with an invitation or a new link from Team:
	 * the plugin's own options, asked for here, server to server, naming the
	 * link by its id (#lib/server/passkeys), so the code goes no further than
	 * this. The browser makes the passkey and hands it to the plugin, which
	 * keeps it, uses the link, and signs them in.
	 *
	 * Asked without the browser's cookies, so the passkey is for the link's
	 * person whoever is signed in here; someone else who is, is signed out
	 * first, as the page says they will be.
	 */
	begin: async (event) => {
		const address = event.getClientAddress();
		if (await turnedAway(address)) return WAIT;
		const code = text((await event.request.formData()).get('code'));
		const link = await db.transaction((tx) => usable(tx, code));
		if (!link || !(MAKES_PASSKEY as readonly string[]).includes(link.purpose)) {
			await missed(address);
			return fail(404, DEAD);
		}
		const auth = getAuth();
		if (event.locals.user && event.locals.user.id !== link.userId)
			await auth.api.signOut({ headers: authHeaders(event) });
		const headers = authHeaders(event);
		headers.delete('cookie');
		const options = await auth.api.generatePasskeyRegistrationOptions({
			query: { context: link.id, name: link.email },
			headers
		});
		return { options: JSON.parse(JSON.stringify(options)) as Record<string, unknown> };
	},

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
	},

	/**
	 * A new address made the one they sign in with, by the link sent to it, and
	 * confirmed by using it. Asked first on the page, so a mail scanner opening
	 * the link changes nothing. Taken by someone else since it was asked for,
	 * it isn't changed, and they keep the one they have.
	 */
	change: async ({ request, getClientAddress }) => {
		const address = getClientAddress();
		if (await turnedAway(address)) return WAIT;
		const code = text((await request.formData()).get('code'));
		let changed: Awaited<ReturnType<typeof usable>> | 'taken';
		try {
			changed = await db.transaction(async (tx) => {
				const link = await usable(tx, code);
				if (!link || link.purpose !== 'change') return null;
				const [taken] = await tx
					.select({ id: user.id })
					.from(user)
					.where(and(eq(user.email, link.email), ne(user.id, link.userId)));
				if (taken) return 'taken' as const;
				await tx.update(user).set({ email: link.email }).where(eq(user.id, link.userId));
				await used(tx, link);
				return link;
			});
		} catch (e) {
			if (pgError(e).constraint !== 'user_email_key') throw e;
			changed = 'taken';
		}
		if (changed === 'taken') return fail(409, { why: 'taken' as const });
		if (!changed) {
			await missed(address);
			return fail(404, DEAD);
		}
		return { done: 'change' as const, email: changed.email };
	}
};
