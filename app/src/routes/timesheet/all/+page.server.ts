import { monthOf } from '#lib/format.ts';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { entryColumns, valueEntries } from '#lib/server/valuation/load.ts';
import type { PageServerLoad } from './$types';

/**
 * Every entry in a month, by the week it was worked.
 *
 * Each is priced the way an invoice line will be: the most specific price row
 * that had taken effect on the day the work happened, never today's. A rate
 * that changed last week must not silently restate what a job in June was
 * worth.
 */
export const load: PageServerLoad = async ({ url }) => {
	// ?month=YYYY-MM, defaulting to this one. Parsed rather than interpolated.
	const asked = url.searchParams.get('month') ?? '';
	const day = businessToday();
	const from = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? `${asked}-01` : `${day.slice(0, 8)}01`;
	const [y, m] = from.split('-').map(Number);
	const to = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);

	const u = alias(t.user, 'u');
	const [entries, [operator]] = await Promise.all([
		db
			.select({
				...entryColumns,
				note: t.timeEntry.note,
				workedByName: u.name,
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
			week: weekOf(e.workedOn),
			minutes: e.minutes,
			billable: e.billable,
			crew: e.crew,
			note: e.note,
			worked_by: e.workedByName,
			entity: e.entity,
			site: e.site,
			service: e.service,
			value: e.billable ? (w.billed?.toFixed(2) ?? null) : null,
			// Wholly inside a retainer: it bills nothing by the hour because the
			// retainer has already charged for it.
			covered: w.coveredMinutes === e.minutes,
			heads: w.heads,
			invoiced: e.invoiced,
			stale: !e.invoiced && e.billable && daysBetween(e.workedOn, day) > alertDays
		};
	});

	const totals = {
		minutes: String(entries.reduce((n, e) => n + e.minutes, 0)),
		idle: String(entries.filter((e) => !e.billable).reduce((n, e) => n + e.minutes, 0)),
		month: monthOf(`${y}-${String(m).padStart(2, '0')}-01`)
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

const DAY = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const daysBetween = (a: string, b: string) => Math.round((utc(b) - utc(a)) / DAY);

/** The Monday of the week a calendar day falls in. */
function weekOf(d: string) {
	const at = utc(d);
	const back = (new Date(at).getUTCDay() + 6) % 7;
	return new Date(at - back * DAY).toISOString().slice(0, 10);
}
