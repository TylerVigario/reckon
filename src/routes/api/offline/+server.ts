import { db } from '#lib/server/db/index.ts';
import type { InvoiceLineKind } from '#lib/server/db/database.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { keptEntries, keptTrips } from '#lib/server/kept.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import type { RequestHandler } from './$types';

/**
 * The screens beyond Today and Time that the service worker keeps for no
 * signal (src/service-worker): the invoices list, New draft and the screens for
 * a draft started on the phone, and each draft with its Add a line and the
 * lines added to it by hand, so a line can be added, changed or taken off on
 * any draft on site. Only drafts: an invoice that has gone out takes no lines,
 * and is shown only with a signal. A line refused for one is fixed from
 * Invoices on the phone's own screen for it, which is kept too.
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
		db.selectFrom('invoice').select('id').where('status', '=', 'draft').execute(),
		// Lines added by hand on a draft: each opens on a screen of its own, to be
		// changed or taken off on site too.
		db
			.selectFrom('invoice_line')
			.innerJoin('invoice', 'invoice.id', 'invoice_line.invoice_id')
			.select((eb) => [
				'invoice_line.id',
				'invoice_line.invoice_id',
				eb('invoice_line.created_by', 'is not distinct from', me).$castTo<boolean>().as('mine')
			])
			.where('invoice.status', '=', 'draft')
			.where('invoice_line.kind', '=', (eb) =>
				eb.fn.any(eb.val<InvoiceLineKind[]>(['material', 'bought', 'paid_for']))
			)
			.execute(),
		db
			.selectFrom('trip')
			.select((eb) => ['id', eb('created_by', '=', me).$castTo<boolean>().as('mine')])
			.where((eb) => keptTrips(eb, me, today))
			.execute(),
		db
			.selectFrom('time_entry')
			.select('id')
			.where((eb) => keptEntries(eb, me, today, locals.weekStart))
			.execute(),
		// The catalogue is Full's (#lib/access).
		field
			? []
			: db
					.selectFrom('material')
					.select('id')
					.where((eb) =>
						eb.or([
							eb('material.active', '=', true),
							eb.exists(
								eb
									.selectFrom('material_lot as l')
									.select(eb.lit(1).as('one'))
									.whereRef('l.material_id', '=', 'material.id')
									.where('l.qty_remaining', '>', '0')
							)
						])
					)
					.execute(),
		field ? [] : db.selectFrom('stock_count').select('id').where('applied_at', 'is', null).execute()
	]);
	return Response.json(
		{
			screens: [
				'/invoices',
				// A draft started with no signal, and lines added to it before it
				// arrives; and a line fixed for a draft that has since gone out.
				...(field ? [] : ['/invoices/new', '/invoices/on-phone']),
				'/invoices/on-phone/add',
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
