import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { invoice, invoiceLine, trip } from '#lib/server/db/schema/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
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
 * miles are not on an invoice, with its Change, so a trip is recorded or put
 * right on the road.
 */
export const GET: RequestHandler = async () => {
	const since = Temporal.PlainDate.from(businessToday()).subtract({ days: 60 }).toString();
	const [drafts, lines, trips] = await Promise.all([
		db.select({ id: invoice.id }).from(invoice).where(eq(invoice.status, 'draft')),
		// Lines added by hand on a draft: each opens on a screen of its own, to be
		// changed or taken off on site too.
		db
			.select({ id: invoiceLine.id, invoice_id: invoiceLine.invoiceId })
			.from(invoiceLine)
			.innerJoin(invoice, eq(invoice.id, invoiceLine.invoiceId))
			.where(
				and(
					eq(invoice.status, 'draft'),
					inArray(invoiceLine.kind, ['material', 'bought', 'paid_for'])
				)
			),
		db
			.select({ id: trip.id })
			.from(trip)
			.where(
				and(
					gte(trip.travelledOn, since),
					sql`not exists (select 1 from invoice_line il join trip_leg l on l.id = il.trip_leg_id
					                 where l.trip_id = ${trip.id})`
				)
			)
	]);
	return Response.json(
		{
			screens: [
				'/invoices',
				// A draft started with no signal, and lines added to it before it arrives.
				'/invoices/new',
				'/invoices/on-phone',
				'/invoices/on-phone/add',
				...drafts.flatMap((d) => [`/invoices/${d.id}`, `/invoices/${d.id}/add`]),
				...lines.flatMap((l) => [
					`/invoices/${l.invoice_id}/lines/${l.id}`,
					`/invoices/${l.invoice_id}/lines/${l.id}/change`
				]),
				'/trips',
				'/trips/new',
				...trips.flatMap((t) => [`/trips/${t.id}`, `/trips/${t.id}/change`])
			]
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
};
