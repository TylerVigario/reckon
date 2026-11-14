import { operatorRow } from '#lib/server/operator.ts';
import type { PageServerLoad } from './$types';

/**
 * Who the business is, as an invoice names it, and how it is reached: each
 * changed in place, by the rules the endpoint keeps (#lib/settings-fields).
 */
export const load: PageServerLoad = async () => ({ operator: await operatorRow() });
