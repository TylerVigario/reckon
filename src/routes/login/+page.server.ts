import { redirect } from '@sveltejs/kit';
import { whomToContact } from '#lib/server/whom-to-contact.ts';
import { safeNext } from '#lib/safe-next.ts';
import type { PageServerLoad } from './$types';

/**
 * Signing in: with a passkey, in the browser, against Better Auth's own routes
 * (#lib/server/auth-paths), so there is no form action here. Someone already
 * signed in goes where they were headed.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) redirect(303, safeNext(url.searchParams.get('next'), url.origin));
	// Whom to ask for a way back in: someone who has lost theirs gets a new link
	// from the business (#lib/server/contact).
	return { contact: await whomToContact() };
};
