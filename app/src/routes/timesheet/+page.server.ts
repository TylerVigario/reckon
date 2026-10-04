import { desc, eq, gte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '#lib/server/db/index.ts';
import { personalToday } from '#lib/server/calendar.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { clientsAndSites, theTeam, timedServices } from '#lib/server/choices.ts';
import { pricesToday } from '#lib/server/prices.ts';
import type { PageServerLoad } from './$types';

/**
 * Time: what is running, and what has been captured today.
 *
 * The running timer is NOT here. It lives in the browser's own storage, which
 * is what lets it survive a refresh on a jobsite with no reception -- the server
 * is told when the entry is posted, not while it is being timed. What this load
 * provides is the names and rates a timer needs in order to say what it is
 * timing, and everything already recorded today.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const day = personalToday();
	const monthStart = `${day.slice(0, 8)}01`;
	const u = alias(t.user, 'u');

	const [[month], entries, people, entities, services, prices] = await Promise.all([
		db
			.select({ minutes: sql<string>`coalesce(sum(${t.timeEntry.minutes}), 0)::text` })
			.from(t.timeEntry)
			.where(gte(t.timeEntry.workedOn, monthStart)),
		// Today's, newest first. A client's own name for the site, because that
		// is what the person who worked there calls it.
		db
			.select({
				id: t.timeEntry.id,
				minutes: t.timeEntry.minutes,
				billable: t.timeEntry.billable,
				note: t.timeEntry.note,
				crew: t.timeEntry.crew,
				worked_by: u.name,
				entity: t.entity.name,
				site: t.site.display,
				service: t.service.name,
				// A moment: drawn on the page, in the person's own zone.
				at: t.timeEntry.createdAt,
				invoiced: sql<boolean>`${t.invoiceLine.invoiceId} is not null`
			})
			.from(t.timeEntry)
			.leftJoin(u, eq(u.id, t.timeEntry.workedBy))
			.innerJoin(t.service, eq(t.service.id, t.timeEntry.serviceId))
			.leftJoin(t.entity, eq(t.entity.id, t.timeEntry.entityId))
			.leftJoin(t.site, eq(t.site.id, t.timeEntry.siteId))
			.leftJoin(t.invoiceLine, eq(t.invoiceLine.timeEntryId, t.timeEntry.id))
			.where(eq(t.timeEntry.workedOn, day))
			.orderBy(desc(t.timeEntry.createdAt), desc(t.timeEntry.id)),
		// What a timer needs to describe itself, and to price what it is timing.
		theTeam(),
		clientsAndSites(),
		timedServices(),
		pricesToday()
	]);

	return {
		today: day,
		me: locals.user!.id,
		monthMinutes: Number(month.minutes),
		entries,
		people,
		entities,
		services,
		prices
	};
};
