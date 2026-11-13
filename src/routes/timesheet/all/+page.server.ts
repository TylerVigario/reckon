import { monthOf } from '#lib/format.ts';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '#lib/server/db/index.ts';
import { businessToday, weekOf } from '#lib/server/calendar.ts';
import { keptEntries } from '#lib/server/kept.ts';
import { isOfflineCopy } from '#lib/offline-copy.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { entryColumns, valueEntries } from '#lib/server/valuation/load.ts';
import { crewNames } from '#lib/server/choices.ts';
import { fieldOnly, theirWork } from '#lib/server/mine.ts';
import type { PageServerLoad } from './$types';

/**
 * Every entry in a month, by the week it was worked: for someone with Field,
 * every one they worked (#lib/access); for someone with Full, everyone's, or
 * their own.
 *
 * Each is priced the way an invoice line will be: the most specific price row
 * that had taken effect on the day the work happened, never today's. A rate
 * that changed last week must not silently restate what a job in June was
 * worth.
 *
 * KEPT FOR NO SIGNAL (#lib/offline-copy), it is only the entries the person
 * entered this week and last that are neither billed nor paid -- the ones they
 * can change on site (#lib/server/kept) -- and nothing of what anything is
 * worth. The rest needs a connection, and says so.
 */
export const load: PageServerLoad = async ({ url, locals }) => {
	const offline = isOfflineCopy(url);
	// ?month=YYYY-MM, defaulting to this one. Parsed rather than interpolated.
	const asked = url.searchParams.get('month') ?? '';
	const day = businessToday();
	const from = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? `${asked}-01` : `${day.slice(0, 8)}01`;
	const to = Temporal.PlainDate.from(from).add({ months: 1 }).toString();
	// Someone with Field has only their own. Someone with Full has everyone's,
	// or with ?who=yours their own: what they worked, and team work they were on.
	const field = fieldOnly(locals);
	const yours = field || url.searchParams.get('who') === 'yours';
	const me = locals.user!.id;

	const u = alias(t.user, 'u');
	const [entries, [operator]] = await Promise.all([
		db
			.select({
				...entryColumns,
				startedAt: t.timeEntry.startedAt,
				endedAt: t.timeEntry.endedAt,
				zone: t.timeEntry.zone,
				note: t.timeEntry.note,
				workedByName: u.name,
				teamNames: crewNames(sql`${t.timeEntry.id}`),
				entity: t.entity.name,
				site: t.site.display,
				service: t.service.name,
				invoiced: sql<boolean>`${t.invoiceLine.invoiceId} is not null`
			})
			.from(t.timeEntry)
			.leftJoin(u, eq(u.id, t.timeEntry.workedBy))
			.innerJoin(t.service, eq(t.service.id, t.timeEntry.serviceId))
			.leftJoin(t.entity, eq(t.entity.id, t.timeEntry.entityId))
			.leftJoin(t.site, eq(t.site.id, t.timeEntry.siteId))
			.leftJoin(t.invoiceLine, eq(t.invoiceLine.timeEntryId, t.timeEntry.id))
			.where(
				offline
					? keptEntries(me, day, locals.weekStart)
					: and(
							gte(t.timeEntry.workedOn, from),
							lt(t.timeEntry.workedOn, to),
							yours ? theirWork(me) : undefined
						)
			)
			.orderBy(desc(t.timeEntry.workedOn), desc(t.timeEntry.createdAt), desc(t.timeEntry.id)),
		db.select({ ageingAlertDays: t.operator.ageingAlertDays }).from(t.operator)
	]);
	// What each is worth, but for the copy kept for no signal.
	const worth = offline ? null : await valueEntries(db, entries);
	const alertDays = operator?.ageingAlertDays ?? 30;

	const rows = entries.map((e) => {
		const w = worth?.get(e.id);
		return {
			id: e.id,
			worked_on: e.workedOn,
			week: weekOf(e.workedOn, locals.weekStart),
			seconds: e.seconds,
			// When it was worked, where it was worked; none for an entry recorded
			// as a length alone.
			started_at: e.startedAt,
			ended_at: e.endedAt,
			zone: e.zone,
			billable: e.billable,
			crew: e.crew,
			note: e.note,
			worked_by: e.workedByName,
			crew_names: e.teamNames,
			entity: e.entity,
			site: e.site,
			service: e.service,
			value: e.billable ? (w?.billed?.toString() ?? null) : null,
			// Wholly inside a retainer: it bills nothing by the hour because the
			// retainer has already charged for it.
			covered: w?.coveredSeconds === e.seconds,
			heads: w?.heads ?? 1,
			invoiced: e.invoiced,
			stale:
				!offline &&
				!e.invoiced &&
				e.billable &&
				Temporal.PlainDate.from(e.workedOn).until(day).days > alertDays
		};
	});

	const totals = {
		seconds: String(entries.reduce((n, e) => n + e.seconds, 0)),
		idle: String(entries.filter((e) => !e.billable).reduce((n, e) => n + e.seconds, 0)),
		month: monthOf(from)
	};

	// One entry per week, newest first, so the page draws rather than regroups.
	const weeks: { week: string; rows: typeof rows }[] = [];
	for (const r of rows) {
		let w = weeks.find((x) => x.week === r.week);
		if (!w) weeks.push((w = { week: r.week, rows: [] }));
		w.rows.push(r);
	}

	return {
		weeks,
		totals,
		who: field || offline ? null : yours ? ('yours' as const) : ('everyone' as const),
		offline,
		as_of: new Date().toISOString()
	};
};
