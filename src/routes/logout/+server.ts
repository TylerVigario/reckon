import { redirect } from '@sveltejs/kit';
import { authHeaders, getAuth } from '#lib/server/auth.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	await getAuth()
		.api.signOut({ headers: authHeaders(event) })
		.catch(() => {});
	redirect(303, '/login');
};
