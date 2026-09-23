import { json } from '@sveltejs/kit';
import { asUser, sql } from '$lib/server/db';
import type { RequestHandler } from './$types';
import { problem } from '$lib/server/problem';

/**
 * Removes a time entry.
 *
 * The database refuses one an invoice was built from -- invoice_line
 * .time_entry_id is ON DELETE RESTRICT -- and records what went, so the answer
 * to "where did that hour go" is in record_history rather than a backup.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No entry with that id.');

	const [entry] = await sql`
		select t.id, il.invoice_id, i.number
		  from time_entry t
		  left join invoice_line il on il.time_entry_id = t.id
		  left join invoice i on i.id = il.invoice_id
		 where t.id = ${params.id}`;

	if (!entry) return problem('notFound', 404, 'No entry with that id.');
	if (entry.invoice_id)
		return problem(
			'conflict',
			409,
			`That hour is on invoice ${entry.number}. Credit the invoice instead.`
		);

	// asUser so record_history names who removed it, rather than nobody.
	await asUser(locals.user!.id, (tx) => tx`delete from time_entry where id = ${params.id}`);
	return json({ deleted: params.id });
};
