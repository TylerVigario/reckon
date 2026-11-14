import { operatorRow } from '#lib/server/operator.ts';
import type { PageServerLoad } from './$types';

/** How the business's dates, figures and money read, and its clock. */
export const load: PageServerLoad = async () => ({ operator: await operatorRow() });
