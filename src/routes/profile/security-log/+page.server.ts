import { securityLog } from '#lib/server/security-log.ts';
import type { PageServerLoad } from './$types';

/**
 * Your own security log: what happened to how you sign in and what you can
 * reach, and anything you did to anyone else (#lib/server/security-log).
 */
export const load: PageServerLoad = ({ locals, url }) =>
	securityLog({ person: locals.user!.id }, url.searchParams.get('before'));
