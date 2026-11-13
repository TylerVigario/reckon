import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import * as t from '#lib/server/db/schema/index.ts';
import type { PageServerLoad } from './$types';

/**
 * An agreement's Pay tab: the rules written for this client alone, in force
 * today -- what covered time pays here is one of them. Each is changed on its
 * service.
 */
export const load: PageServerLoad = async ({ parent }) => {
	const { agreement } = await parent();
	const r = alias(t.role, 'r');
	const u = alias(t.user, 'u');
	const rules = await db
		.selectDistinctOn(
			[t.payRule.serviceId, t.payRule.roleId, t.payRule.userId, t.payRule.paysFor],
			{
				id: t.payRule.id,
				service_id: t.payRule.serviceId,
				service: t.service.name,
				payee: sql<string>`coalesce(${r.name}, ${u.name})`,
				pays_for: t.payRule.paysFor,
				method: t.payRule.method,
				amount: t.payRule.amount
			}
		)
		.from(t.payRule)
		.innerJoin(t.service, eq(t.service.id, t.payRule.serviceId))
		.leftJoin(r, eq(r.id, t.payRule.roleId))
		.leftJoin(u, eq(u.id, t.payRule.userId))
		.where(
			and(
				eq(t.payRule.entityId, agreement.entity_id),
				lte(t.payRule.effectiveFrom, sql`${businessToday()}::date`)
			)
		)
		.orderBy(
			t.payRule.serviceId,
			t.payRule.roleId,
			t.payRule.userId,
			t.payRule.paysFor,
			desc(t.payRule.effectiveFrom)
		);
	return { rules };
};
