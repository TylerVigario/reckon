import { operatorRow } from '#lib/server/operator.ts';
import type { PageServerLoad } from './$types';

// The rules tax is worked out by. A rate is not one of them: every rate comes
// from CDTFA's rate API, and each site's page says when CDTFA was last asked.
export const load: PageServerLoad = async () => ({ operator: await operatorRow() });
