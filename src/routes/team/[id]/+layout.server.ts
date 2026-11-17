import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { cannotSend, changing, signingIn } from '#lib/server/links.ts';
import { UUID } from '#lib/field-rules.ts';
import type { LayoutServerLoad } from './$types';

/**
 * One person, as each of their tabs heads them: who they are, whether they
 * sign in and when they last did, the link to make a passkey they have
 * waiting, a change of their address waiting, how many passkeys they have,
 * and what the menu needs -- whether they are the last on Full, and what
 * reckon is missing to send email, if anything.
 */
export const load: LayoutServerLoad = async ({ params, locals }) => {
	if (!UUID.test(params.id)) error(404, 'Nobody with that id.');
	const [person, { onFull }, { passkeys }] = await Promise.all([
		db
			.selectFrom('user')
			.select((eb) => [
				'id',
				'name',
				'email',
				'active',
				'access',
				'role_id',
				'last_signed_in_at',
				'email_verified',
				...signingIn(eb.ref('user.id'), eb.ref('user.email')),
				changing(eb.ref('user.id')).as('changing')
			])
			.where('id', '=', params.id)
			.executeTakeFirst(),
		// Someone active keeps Full; the database refuses otherwise, and the page says so first.
		db
			.selectFrom('user')
			.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('onFull'))
			.where('active', '=', true)
			.where('access', '=', 'full')
			.executeTakeFirstOrThrow(),
		db
			.selectFrom('passkey')
			.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('passkeys'))
			.where('user_id', '=', params.id)
			.executeTakeFirstOrThrow()
	]);
	if (!person) error(404, 'Nobody with that id.');
	return { person, onFull, passkeys, me: locals.user!.id, cannotSend: cannotSend() };
};
