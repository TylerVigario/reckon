import { redirect } from '@sveltejs/kit';
import { close, COOKIE } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	await close(cookies.get(COOKIE));
	cookies.delete(COOKIE, { path: '/' });
	redirect(303, '/login');
};
