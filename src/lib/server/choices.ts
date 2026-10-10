import { and, asc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import { Decimal } from '#lib/decimal.ts';
import { db } from './db/index.ts';
import * as t from './db/schema/index.ts';

/**
 * What an entry can be written against: who can work it, who pays and where,
 * and what was done. Shared by every screen that writes one down, so a person
 * or a client offered on one is offered on all.
 */

/**
 * Who a team entry names as its crew (0023), by name, A to Z: what a screen
 * says in place of "the team". Empty for one person's entry.
 */
export const crewNames = (entryId: SQL) =>
	sql<string[]>`(select coalesce(array_agg(u.name order by u.name), '{}')::text[]
		from ${t.timeEntryCrew} c join ${t.user} u on u.id = c.user_id
		where c.time_entry_id = ${entryId})`;

/** The team: everyone active who holds a role. */
export const theTeam = () =>
	db
		.select({ id: t.user.id, name: t.user.name })
		.from(t.user)
		.where(and(eq(t.user.active, true), isNotNull(t.user.roleId)))
		.orderBy(asc(t.user.name));

/**
 * Active clients, each with its active sites by the name it uses for them, and
 * the rate charged at each -- none where nothing is.
 */
export async function clientsAndSites() {
	const clients = await db.query.entity.findMany({
		where: eq(t.entity.active, true),
		columns: { id: true, slug: true, name: true },
		orderBy: asc(t.entity.name),
		with: {
			sites: {
				where: eq(t.site.active, true),
				columns: { id: true, display: true, taxRatePct: true },
				orderBy: asc(t.site.display)
			}
		}
	});
	return clients.map((c) => ({
		id: c.id,
		slug: c.slug,
		name: c.name,
		sites: c.sites.map((s) => ({
			id: s.id,
			label: s.display ?? '',
			rate_pct: Decimal.from(s.taxRatePct).isZero() ? null : s.taxRatePct
		}))
	}));
}

/** The services a timer can run. */
export const timedServices = () =>
	db
		.select({
			id: t.service.id,
			name: t.service.name,
			unit: t.service.unit,
			bill_to_nearest_seconds: t.service.billToNearestSeconds
		})
		.from(t.service)
		.where(and(eq(t.service.active, true), eq(t.service.timeTracked, true)))
		.orderBy(asc(t.service.name));
