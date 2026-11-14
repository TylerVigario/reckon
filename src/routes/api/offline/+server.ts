import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	invoice,
	invoiceLine,
	material,
	materialLot,
	stockCount,
	timeEntry,
	trip
} from '#lib/server/db/schema/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { keptEntries, keptTrips } from '#lib/server/kept.ts';
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
 * Trips too: the list, New trip, and each trip the person drove whose miles
 * are neither billed nor paid, with its Change, so a trip is recorded or put
 * right on the road (#lib/server/kept).
 *
 * And All entries, with the time entries the person entered this week and
 * last that are neither billed nor paid, each on its own screen, so an entry
 * is changed or removed on site.
 *
 * And for someone with Full, the catalogue: Materials, each material that is
 * offered or has stock on the shelf, with its Stock and Details tabs, Receive,
 * the count being counted, or the sheet one started on the phone is counted
 * on, and New service -- so stock is received, adjusted and counted, a
 * material changed and a service added, with no signal.
 *
 * The worker keeps each as a copy cut to that (#lib/offline-copy): this says
 * only which screens.
 *
 * For someone with Field, only what opens for them (#lib/access): no new draft,
 * and a Change only for a line or a trip they made.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const field = fieldOnly(locals);
	const me = locals.user!.id;
	const today = businessToday();
	const [drafts, lines, trips, entries, stocked, counting] = await Promise.all([
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
			.where(keptTrips(me, today)),
		db
			.select({ id: timeEntry.id })
			.from(timeEntry)
			.where(keptEntries(me, today, locals.weekStart)),
		// The catalogue is Full's (#lib/access).
		field
			? []
			: db
					.select({ id: material.id })
					.from(material)
					.where(
						or(
							eq(material.active, true),
							sql`exists (select 1 from ${materialLot} l where l.material_id = ${material.id} and l.qty_remaining > 0)`
						)
					),
		field
			? []
			: db.select({ id: stockCount.id }).from(stockCount).where(isNull(stockCount.appliedAt))
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
				'/timesheet/all',
				...entries.map((e) => `/timesheet/${e.id}`),
				...(field
					? []
					: [
							'/catalogue/materials',
							...stocked.flatMap((m) => [
								`/catalogue/materials/${m.id}`,
								`/catalogue/materials/${m.id}/details`
							]),
							'/catalogue/services/new',
							'/catalogue/receipts/new',
							'/catalogue/counts/on-phone',
							...counting.map((c) => `/catalogue/counts/${c.id}`)
						]),
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
