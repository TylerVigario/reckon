import { sql } from 'kysely';
import { db } from '#lib/server/db/index.ts';
import { operatorRow } from '#lib/server/operator.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// The highest number already used, read out of whatever format it was
	// issued in, prefix and all.
	const [operator, used] = await Promise.all([
		operatorRow(),
		db
			.selectFrom('invoice')
			.select((eb) =>
				sql<string>`coalesce(max(nullif(regexp_replace(${eb.ref('number')}, '[^0-9]', '', 'g'), '')::bigint), 0)::text`.as(
					'high'
				)
			)
			.executeTakeFirst()
	]);
	return { operator, issued: used?.high ?? '0' };
};
