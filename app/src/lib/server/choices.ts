import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { Decimal } from '$lib/decimal';
import { db } from './db';
import * as t from './db/schema';

/**
 * What an entry can be written against: who can work it, who pays and where,
 * and what was done. Shared by every screen that writes one down, so a person
 * or a client offered on one is offered on all.
 */

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
