import { eq } from 'drizzle-orm';
import { asUser, db } from '#lib/server/db/index.ts';
import {
	invoice,
	invoiceLine,
	personPaymentItem,
	timeEntry,
	user
} from '#lib/server/db/schema/index.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { UUID } from '#lib/field-rules.ts';

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
	// One a payment recorded stays as it was paid (0026).
	const [paidTo] = await db
		.select({ name: user.name })
		.from(personPaymentItem)
		.innerJoin(user, eq(user.id, personPaymentItem.userId))
		.where(eq(personPaymentItem.timeEntryId, params.id))
		.limit(1);
	if (paidTo)
		return problem(
			'conflict',
			409,
			`That hour is in a payment to ${paidTo.name}. A correction goes on their next payment.`
		);

	// asUser so record_history names who removed it, rather than nobody.
	await asUser(locals.user!.id, (tx) => tx.delete(timeEntry).where(eq(timeEntry.id, params.id)));
	return Response.json({ deleted: params.id });
};
