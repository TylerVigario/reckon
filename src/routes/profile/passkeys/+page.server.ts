import { fail } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { and, eq } from 'drizzle-orm';
import { SITE_URL } from '$app/env/private';
import { browserName } from '#lib/browser-name.ts';
import { safeNext } from '#lib/safe-next.ts';
import { authHeaders, getAuth } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import { passkey } from '#lib/server/db/schema/index.ts';
import { tell } from '#lib/server/email.ts';
import { passkeyRemoved } from '#lib/server/notices.js';
import { listPasskeys, passkeyLabel, passkeyName } from '#lib/server/passkeys.ts';
import type { Actions, PageServerLoad } from './$types';

/**
 * Your own passkeys: each one's name, where it is kept, when it was made, and
 * when and from which browser and system it was last used (OWASP's Passkey
 * Security Cheat Sheet: "Show a user-chosen name, creation date, and last-used
 * date"; web.dev: last sign-in details help "identify suspicious sign-ins"),
 * to rename, to remove, and another to add.
 * As many as someone likes, one for each phone or computer they use (NIST SP
 * 800-63B-4 §4.1.2.1: the CSP "SHALL permit the binding of multiple
 * authenticators").
 *
 * Adding one is a ceremony in the browser, against Better Auth's own routes
 * (#lib/server/auth-paths); naming and removing are the actions here, which
 * call its plugin directly. Someone with Full keeps at least one: Full signs
 * in with a passkey.
 *
 * ?offer=this-device brings them here just signed in with a passkey from
 * another device, to make one on this, and ?next is where to go after.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const passkeys = await listPasskeys(locals.user!.id);
	const offer = url.searchParams.get('offer');
	return {
		passkeys,
		full: locals.user!.access === 'full',
		// Passkeys need SITE_URL: it is the site each is made for (#lib/server/auth).
		available: !!SITE_URL,
		offer: offer === 'this-device' ? offer : null,
		next: safeNext(url.searchParams.get('next'), url.origin)
	};
};

const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v.trim() : '');

/** One of their own passkeys, by its id, or null. */
async function theirs(userId: string, id: string) {
	if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
	const [p] = await db
		.select({ id: passkey.id, name: passkey.name, aaguid: passkey.aaguid })
		.from(passkey)
		.where(and(eq(passkey.id, id), eq(passkey.userId, userId)));
	return p ?? null;
}

export const actions: Actions = {
	/** A passkey named as they like: something, since a name is how they tell them apart. */
	rename: async (event) => {
		const f = await event.request.formData();
		const p = await theirs(event.locals.user!.id, text(f.get('id')));
		if (!p) return fail(404, { id: text(f.get('id')), message: 'That passkey isn’t yours.' });
		const name = text(f.get('name')).slice(0, 100);
		if (!name) return fail(400, { id: p.id, message: 'Give it a name.' });
		await getAuth().api.updatePasskey({
			body: { id: p.id, name },
			headers: authHeaders(event)
		});
		return { renamed: p.id };
	},

	/**
	 * A passkey removed: it signs nobody in from now on, and they are told (NIST
	 * SP 800-63B-4 §4.5). Someone with Full cannot remove their last.
	 */
	remove: async (event) => {
		const me = event.locals.user!;
		const f = await event.request.formData();
		const p = await theirs(me.id, text(f.get('id')));
		if (!p) return fail(404, { id: text(f.get('id')), message: 'That passkey isn’t yours.' });
		if (me.access === 'full') {
			const others = await db
				.select({ id: passkey.id })
				.from(passkey)
				.where(eq(passkey.userId, me.id));
			if (others.length <= 1)
				return fail(409, {
					id: p.id,
					message:
						'Someone with Full keeps at least one passkey. Add another before removing this one.'
				});
		}
		try {
			await getAuth().api.deletePasskey({ body: { id: p.id }, headers: authHeaders(event) });
		} catch (e) {
			if (e instanceof APIError)
				return fail(404, { id: p.id, message: 'That passkey isn’t yours.' });
			throw e;
		}
		await tell(db, me.id, (them, business) =>
			passkeyRemoved(them, business, {
				name: passkeyName(p),
				at: new Date(),
				from: browserName(event.request.headers.get('user-agent'))
			})
		);
		return { removed: passkeyLabel(p) };
	}
};
