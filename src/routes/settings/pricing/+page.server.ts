import { operatorRow } from '#lib/server/operator.ts';
import type { PageServerLoad } from './$types';

/** What a line sells at over what it cost, and what stock drawn on a line cost. */
export const load: PageServerLoad = async () => ({ operator: await operatorRow() });
