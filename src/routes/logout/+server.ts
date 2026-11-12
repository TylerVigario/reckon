import { redirect } from '@sveltejs/kit';
import { authHeaders, getAuth } from '#lib/server/auth.ts';
import { recordAside } from '#lib/server/events.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const me = event.locals.user;
	await getAuth()
		.api.signOut({ headers: authHeaders(event) })
		.catch(() => {});
	if (me) await recordAside('session_logout', { user: me.id, by: null });
	redirect(303, '/login');
};
