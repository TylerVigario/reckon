import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { invoice } from '#lib/server/db/schema/index.ts';
import type { RequestHandler } from './$types';

/**
 * The screens beyond Today and Time that the service worker keeps for no
 * signal (src/service-worker): the invoices list, New draft and the screens for
 * a draft started on the phone, and each draft with its Add a line, so a line
 * can be added to any draft on site. Only drafts: an invoice that has gone out
 * takes no lines, and is shown only with a signal.
 */
export const GET: RequestHandler = async () => {
	const drafts = await db
		.select({ id: invoice.id })
		.from(invoice)
		.where(eq(invoice.status, 'draft'));
	return Response.json(
		{
			screens: [
				'/invoices',
				// A draft started with no signal, and lines added to it before it arrives.
				'/invoices/new',
				'/invoices/on-phone',
				'/invoices/on-phone/add',
				...drafts.flatMap((d) => [`/invoices/${d.id}`, `/invoices/${d.id}/add`])
			]
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
};
