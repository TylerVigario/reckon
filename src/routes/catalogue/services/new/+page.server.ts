import type { PageServerLoad } from './$types';

/**
 * New service: nothing to load but when it was, since it is kept for no signal
 * (#lib/offline-copy) and says how old its copy is.
 */
export const load: PageServerLoad = () => ({ as_of: new Date().toISOString() });
