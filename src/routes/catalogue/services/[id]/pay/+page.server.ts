import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { rules } from '#lib/server/catalogue.ts';
import { anHourNow } from '#lib/server/reports.ts';
import type { PageServerLoad } from './$types';

/**
 * Whom a service pays, and how -- the rules in force and scheduled -- and what
 * the business keeps of an hour of it, worked by each person and by a team.
 */
export const load: PageServerLoad = async ({ params }) => {
	const holders = sql`(${db
		.select({ n: count() })
		.from(t.user)
		.where(and(eq(t.user.roleId, t.role.id), eq(t.user.active, true)))})`;
	const [paying, hour, roles, people, clients] = await Promise.all([
		rules(params.id),
		anHourNow(),
		// The role people hold first, so a new rule starts on the one in use.
		db
			.select({ id: t.role.id, name: t.role.name })
			.from(t.role)
			.orderBy(desc(holders), asc(t.role.name)),
		db
			.select({ id: t.user.id, name: t.user.name })
			.from(t.user)
			.where(eq(t.user.active, true))
			.orderBy(asc(t.user.name)),
		db
			.select({ id: t.entity.id, name: t.entity.name })
			.from(t.entity)
			.where(eq(t.entity.active, true))
			.orderBy(asc(t.entity.name))
	]);
	return {
		rules: paying.filter((r) => r.state !== 'superseded'),
		hour: hour.filter((h) => h.service_id === params.id),
		roles,
		people,
		clients
	};
};
