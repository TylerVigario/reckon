import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { invoice, invoiceLine, timeEntry, trip } from '#lib/server/db/schema/index.ts';
import { businessToday, lastWeekBegan } from '#lib/server/calendar.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import type { RequestHandler } from './$types';

/**
 * The screens beyond Today and Time that the service worker keeps for no
 * signal (src/service-worker): the invoices list, New draft and the screens for
 * a draft started on the phone, and each draft with its Add a line and the
 * lines added to it by hand, so a line can be added, changed or taken off on
 * any draft on site. Only drafts: an invoice that has gone out
 * takes no lines, and is shown only with a signal.
 *
 * Trips too: the list, New trip, and each trip of the past sixty days whose
 * miles are neither billed nor paid, with its Change, so a trip is recorded or
 * put right on the road.
 *
 * And the time entries the person entered this week and last that are neither
 * billed nor paid, each on its own screen, with All entries' copy of them --
 * a copy of its own, which the worker fetches as listed (?copy=offline) and
 * keeps in the screen's place, never the screen as it is with a signal -- so
 * an entry is changed or removed on site.
 *
 * For someone with Field, only what opens for them (#lib/access): no new draft,
 * the trips they drove, and a Change only for a line or a trip they made.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const field = fieldOnly(locals);
	const me = locals.user!.id;
	const since = Temporal.PlainDate.from(businessToday()).subtract({ days: 60 }).toString();
	const [drafts, lines, trips, entries] = await Promise.all([
		db.select({ id: invoice.id }).from(invoice).where(eq(invoice.status, 'draft')),
		// Lines added by hand on a draft: each opens on a screen of its own, to be
		// changed or taken off on site too.
		db
			.select({
				id: invoiceLine.id,
				invoice_id: invoiceLine.invoiceId,
				mine: sql<boolean>`${invoiceLine.createdBy} is not distinct from ${me}::uuid`
			})
			.from(invoiceLine)
			.innerJoin(invoice, eq(invoice.id, invoiceLine.invoiceId))
			.where(
				and(
					eq(invoice.status, 'draft'),
					inArray(invoiceLine.kind, ['material', 'bought', 'paid_for'])
				)
			),
		db
			.select({ id: trip.id, mine: sql<boolean>`${trip.createdBy} = ${me}::uuid` })
			.from(trip)
			.where(
				and(
					gte(trip.travelledOn, since),
					field ? eq(trip.drivenBy, me) : undefined,
					sql`not exists (select 1 from invoice_line il join trip_leg l on l.id = il.trip_leg_id
					                 where l.trip_id = ${trip.id})`,
					sql`not exists (select 1 from person_payment_item i where i.trip_id = ${trip.id})`
				)
			),
		db
			.select({ id: timeEntry.id })
			.from(timeEntry)
			.where(
				and(
					eq(timeEntry.createdBy, me),
					gte(timeEntry.workedOn, lastWeekBegan(businessToday(), locals.weekStart)),
					sql`not exists (select 1 from invoice_line il where il.time_entry_id = ${timeEntry.id})`,
					sql`not exists (select 1 from person_payment_item i where i.time_entry_id = ${timeEntry.id})`
				)
			)
	]);
	return Response.json(
		{
			screens: [
				'/invoices',
				// A draft started with no signal, and lines added to it before it arrives.
				...(field ? [] : ['/invoices/new', '/invoices/on-phone', '/invoices/on-phone/add']),
				...drafts.flatMap((d) => [`/invoices/${d.id}`, `/invoices/${d.id}/add`]),
				...lines.flatMap((l) => [
					`/invoices/${l.invoice_id}/lines/${l.id}`,
					...(!field || l.mine ? [`/invoices/${l.invoice_id}/lines/${l.id}/change`] : [])
				]),
				'/timesheet/all?copy=offline',
				...entries.map((e) => `/timesheet/${e.id}`),
				'/trips',
				'/trips/new',
				...trips.flatMap((t) => [
					`/trips/${t.id}`,
					...(!field || t.mine ? [`/trips/${t.id}/change`] : [])
				])
			]
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
};
