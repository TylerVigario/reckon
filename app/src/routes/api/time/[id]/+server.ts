import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { asUser, db } from '$lib/server/db';
import { invoice, invoiceLine, timeEntry } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';
import { problem } from '$lib/server/problem';
import { UUID } from '$lib/field-rules';

/**
 * Removes a time entry.
 *
 * The database refuses one an invoice was built from -- invoice_line
 * .time_entry_id is ON DELETE RESTRICT -- and records what went, so the answer
 * to "where did that hour go" is in record_history rather than a backup.
 */

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No entry with that id.');

	const [entry] = await db
		.select({ id: timeEntry.id, invoice_id: invoiceLine.invoiceId, number: invoice.number })
		.from(timeEntry)
		.leftJoin(invoiceLine, eq(invoiceLine.timeEntryId, timeEntry.id))
		.leftJoin(invoice, eq(invoice.id, invoiceLine.invoiceId))
		.where(eq(timeEntry.id, params.id));

	if (!entry) return problem('notFound', 404, 'No entry with that id.');
	if (entry.invoice_id)
		return problem(
			'conflict',
			409,
			`That hour is on invoice ${entry.number}. Credit the invoice instead.`
		);

	// asUser so record_history names who removed it, rather than nobody.
	await asUser(locals.user!.id, (tx) => tx.delete(timeEntry).where(eq(timeEntry.id, params.id)));
	return json({ deleted: params.id });
};
