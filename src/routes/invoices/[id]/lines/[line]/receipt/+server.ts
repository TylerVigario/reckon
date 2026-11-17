import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { UUID } from '#lib/field-rules.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import type { RequestHandler } from './$types';

/**
 * A line's receipt, straight out of the row that holds it. A photo shows in the
 * browser; a PDF is handed over as a file, to open in the phone's own viewer
 * rather than run in this site's -- as a lot's receipt is. Someone with Field
 * opens one on a draft (#lib/access).
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id) || !UUID.test(params.line)) error(404, 'no such receipt');
	const row = await db
		.selectFrom('invoice_line as il')
		.innerJoin('invoice as i', 'i.id', 'il.invoice_id')
		.select(['il.receipt', 'il.receipt_type as type', 'i.status'])
		.where('il.id', '=', params.line)
		.where('il.invoice_id', '=', params.id)
		.executeTakeFirst();
	if (!row?.receipt || !row.type || (fieldOnly(locals) && row.status !== 'draft'))
		error(404, 'no receipt');
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
