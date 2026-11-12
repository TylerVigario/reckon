import { securityLog } from '#lib/server/security-log.ts';
import type { PageServerLoad } from './$types';

/**
 * One person's security log, for someone with Full: what happened to them, and
 * what they did to anyone else (#lib/server/security-log).
 */
export const load: PageServerLoad = ({ params, url }) =>
	securityLog({ person: params.id }, url.searchParams.get('before'));
