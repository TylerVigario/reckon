import { sql, type NumericString } from 'kysely';
import { db } from '#lib/server/db/index.ts';
import type { PageServerLoad } from './$types';

/**
 * Every count, the open one first, then newest: when, who, how many were
 * counted, and how many differences it put right, at what worth.
 */
export const load: PageServerLoad = async () => {
	return {
		counts: await db
			.selectFrom('stock_count as sc')
			.innerJoin('user as u', 'u.id', 'sc.created_by')
			.leftJoin('user as applier', 'applier.id', 'sc.applied_by')
			.select((eb) => [
				'sc.id',
				'sc.counted_on',
				'u.name as by',
				'applier.name as applied_by',
				eb('sc.applied_at', 'is', null).$castTo<boolean>().as('open'),
				eb
					.selectFrom('stock_count_line as l')
					.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
					.whereRef('l.count_id', '=', 'sc.id')
					.$asScalar()
					.$notNull()
					.as('counted'),
				eb
					.selectFrom('stock_adjustment as a')
					.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
					.whereRef('a.count_id', '=', 'sc.id')
					.$asScalar()
					.$notNull()
					.as('differences'),
				// Short is written off, over is found: what the count moved, each way.
				eb
					.selectFrom('stock_adjustment as a')
					.select((eb) => {
						const worth = sql<NumericString>`${eb.ref('a.ex_tax_cost')} + ${eb.ref('a.tax_paid')}`;
						return eb
							.cast<string>(
								eb.fn.coalesce(
									eb.fn.sum<NumericString>(
										eb
											.case()
											.when('a.way', '=', 'off')
											.then(sql<NumericString>`-(${worth})`)
											.else(worth)
											.end()
									),
									eb.lit(0)
								),
								'text'
							)
							.as('net');
					})
					.whereRef('a.count_id', '=', 'sc.id')
					.$asScalar()
					.$notNull()
					.as('net')
			])
			.orderBy((eb) => eb('sc.applied_at', 'is', null), 'desc')
			.orderBy('sc.counted_on', 'desc')
			.orderBy('sc.created_at', 'desc')
			.execute()
	};
};
