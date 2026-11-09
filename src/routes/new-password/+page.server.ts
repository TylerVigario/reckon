import { fail, redirect } from '@sveltejs/kit';
import { and, eq, ne } from 'drizzle-orm';
import { verify } from '@node-rs/argon2';
import { db, schema } from '#lib/server/db/index.ts';
import {
	MAX_PASSWORD_LENGTH,
	MIN_PASSWORD_LENGTH,
	authHeaders,
	getAuth,
	hashPassword
} from '#lib/server/auth.ts';
import { tell } from '#lib/server/email.ts';
import { passwordChanged } from '#lib/server/notices.js';
import { passwordSet } from '#lib/server/sign-in-limit.ts';
import type { Actions, PageServerLoad } from './$types';

/**
 * Where someone signed in with a password handed to them chooses their own
 * (#lib/server/handover). Nothing else opens until they have, and once they
 * have, there is nothing here to ask.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- a load is async by contract
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user!.temporaryPassword) redirect(303, '/');
	return { email: locals.user!.email, min: MIN_PASSWORD_LENGTH };
};

export const actions: Actions = {
	default: async (event) => {
		const me = event.locals.user!;
		if (!me.temporaryPassword) redirect(303, '/');
		const f = await event.request.formData();
		// Only a text part is a password, as on the sign-in form.
		const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');
		const password = text(f.get('password'));
		const confirm = text(f.get('confirm'));

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

		const credential = and(
			eq(schema.account.userId, me.id),
			eq(schema.account.providerId, 'credential')
		);
		const [held] = await db
			.select({ hash: schema.account.password })
			.from(schema.account)
			.where(credential);
		if (held?.hash && (await verify(held.hash, password).catch(() => false)))
			return fail(400, {
				field: 'password',
				message: 'That’s the temporary password. Choose one of your own.'
			});

		// This browser stays signed in. Any other that signed in with the
		// temporary password is signed out: whoever else has it is not them.
		const signedIn = await getAuth().api.getSession({ headers: authHeaders(event) });
		const hash = await hashPassword(password);
		await db.transaction(async (tx) => {
			await tx.update(schema.account).set({ password: hash }).where(credential);
			await tx
				.update(schema.user)
				.set({ temporaryPassword: false, ...passwordSet() })
				.where(eq(schema.user.id, me.id));
			await tell(tx, me.id, (them, business) =>
				passwordChanged(them, business, { at: new Date(), on: 'chosen' })
			);
			await tx
				.delete(schema.session)
				.where(
					signedIn
						? and(eq(schema.session.userId, me.id), ne(schema.session.id, signedIn.session.id))
						: eq(schema.session.userId, me.id)
				);
		});
		redirect(303, '/');
	}
};
