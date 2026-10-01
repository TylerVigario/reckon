import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { invoice } from '$lib/server/db/schema';
import { operatorRow } from '$lib/server/operator';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// The highest number already used, read out of whatever format it was
	// issued in, prefix and all.
	const [operator, [used]] = await Promise.all([
		operatorRow(),
		db
			.select({
				high: sql<string>`coalesce(max(nullif(regexp_replace(${invoice.number}, '[^0-9]', '', 'g'), '')::bigint), 0)::text`
			})
			.from(invoice)
	]);
	return { operator, issued: used?.high ?? '0' };
};
