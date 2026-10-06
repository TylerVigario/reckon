import { and, eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { invoice, invoiceLine } from '#lib/server/db/schema/index.ts';
import type { RequestHandler } from './$types';

/**
 * The screens beyond Today and Time that the service worker keeps for no
 * signal (src/service-worker): the invoices list, New draft and the screens for
 * a draft started on the phone, and each draft with its Add a line and the
 * lines added to it by hand, so a line can be added, changed or taken off on
 * any draft on site. Only drafts: an invoice that has gone out
 * takes no lines, and is shown only with a signal.
 */
export const GET: RequestHandler = async () => {
	const [drafts, lines] = await Promise.all([
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
				])
			]
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
};
