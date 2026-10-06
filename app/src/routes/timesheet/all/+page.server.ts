import { monthOf } from '#lib/format.ts';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { entryColumns, valueEntries } from '#lib/server/valuation/load.ts';
import { crewNames } from '#lib/server/choices.ts';
import type { PageServerLoad } from './$types';

/**
 * Every entry in a month, by the week it was worked.
 *
 * Each is priced the way an invoice line will be: the most specific price row
 * that had taken effect on the day the work happened, never today's. A rate
 * that changed last week must not silently restate what a job in June was
 * worth.
 */
export const load: PageServerLoad = async ({ url, locals }) => {
	// ?month=YYYY-MM, defaulting to this one. Parsed rather than interpolated.
	const asked = url.searchParams.get('month') ?? '';
	const day = businessToday();
	const from = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? `${asked}-01` : `${day.slice(0, 8)}01`;
	const to = Temporal.PlainDate.from(from).add({ months: 1 }).toString();

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
			.where(and(gte(t.timeEntry.workedOn, from), lt(t.timeEntry.workedOn, to)))
			.orderBy(desc(t.timeEntry.workedOn), desc(t.timeEntry.createdAt), desc(t.timeEntry.id)),
		db.select({ ageingAlertDays: t.operator.ageingAlertDays }).from(t.operator)
	]);
	const worth = await valueEntries(db, entries);
	const alertDays = operator?.ageingAlertDays ?? 30;

	const rows = entries.map((e) => {
		const w = worth.get(e.id)!;
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
			value: e.billable ? (w.billed?.toString() ?? null) : null,
			// Wholly inside a retainer: it bills nothing by the hour because the
			// retainer has already charged for it.
			covered: w.coveredSeconds === e.seconds,
			heads: w.heads,
			invoiced: e.invoiced,
			stale:
				!e.invoiced && e.billable && Temporal.PlainDate.from(e.workedOn).until(day).days > alertDays
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

	return { weeks, totals };
};

/**
 * The first day of the week a calendar day falls in, for a week that starts on
 * `first` -- 1 for Monday to 7 for Sunday: the person's own, or their locale's.
 */
function weekOf(d: string, first: number) {
	const day = Temporal.PlainDate.from(d);
	return day.subtract({ days: (day.dayOfWeek - first + 7) % 7 }).toString();
}
