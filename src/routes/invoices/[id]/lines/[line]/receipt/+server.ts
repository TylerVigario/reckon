import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { UUID } from '#lib/field-rules.ts';
import type { RequestHandler } from './$types';

/**
 * A line's receipt, straight out of the row that holds it. A photo shows in the
 * browser; a PDF is handed over as a file, to open in the phone's own viewer
 * rather than run in this site's -- as a lot's receipt is.
 */
export const GET: RequestHandler = async ({ params }) => {
	if (!UUID.test(params.id) || !UUID.test(params.line)) error(404, 'no such receipt');
	const [row] = await db
		.select({ receipt: t.invoiceLine.receipt, type: t.invoiceLine.receiptType })
		.from(t.invoiceLine)
		.where(and(eq(t.invoiceLine.id, params.line), eq(t.invoiceLine.invoiceId, params.id)));
	if (!row?.receipt || !row.type) error(404, 'no receipt');
	const pdf = row.type === 'application/pdf';
	return new Response(new Uint8Array(row.receipt), {
		headers: {
			'content-type': row.type,
			'content-disposition': `${pdf ? 'attachment' : 'inline'}; filename="receipt.${pdf ? 'pdf' : row.type.split('/')[1]}"`,
			'x-content-type-options': 'nosniff',
			'cache-control': 'private, max-age=3600'
		}
	});
};
