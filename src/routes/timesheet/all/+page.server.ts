import { monthOf } from '#lib/format.ts';
import { db } from '#lib/server/db/index.ts';
import { businessToday, weekOf } from '#lib/server/calendar.ts';
import { keptEntries } from '#lib/server/kept.ts';
import { isOfflineCopy } from '#lib/offline-copy.ts';
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

	const [entries, operator] = await Promise.all([
		db
			.selectFrom('time_entry')
			.leftJoin('user as u', 'u.id', 'time_entry.worked_by')
			.innerJoin('service', 'service.id', 'time_entry.service_id')
			.leftJoin('entity', 'entity.id', 'time_entry.entity_id')
			.leftJoin('site', 'site.id', 'time_entry.site_id')
			.leftJoin('invoice_line', 'invoice_line.time_entry_id', 'time_entry.id')
			.select((eb) => [
				...entryColumns,
				'time_entry.started_at as startedAt',
				'time_entry.ended_at as endedAt',
				'time_entry.zone',
				'time_entry.note',
				'u.name as workedByName',
				crewNames(eb.ref('time_entry.id')).as('teamNames'),
				'entity.name as entity',
				'site.display as site',
				'service.name as service',
				eb('invoice_line.invoice_id', 'is not', null).$castTo<boolean>().as('invoiced')
			])
			.where((eb) =>
				offline
					? keptEntries(eb, me, day, locals.weekStart)
					: eb.and([
							eb('time_entry.worked_on', '>=', from),
							eb('time_entry.worked_on', '<', to),
							...(yours ? [theirWork(eb, me)] : [])
						])
			)
			.orderBy('time_entry.worked_on', 'desc')
			.orderBy('time_entry.created_at', 'desc')
			.orderBy('time_entry.id', 'desc')
			.execute(),
		db.selectFrom('operator').select('ageing_alert_days as ageingAlertDays').executeTakeFirst()
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
