import { error } from '@sveltejs/kit';
import { paymentOf } from '#lib/server/pay.ts';
import { UUID } from '#lib/field-rules.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import { refusedForAccess } from '#lib/server/refused.ts';
import type { PageServerLoad } from './$types';

/**
 * A payment as it was recorded, never changed after. Someone with Field opens
 * only one made to them (#lib/access).
 */
export const load: PageServerLoad = async ({ params, locals, route, request }) => {
	if (!UUID.test(params.id)) error(404, 'No payment with that id.');
	const payment = await paymentOf(params.id);
	if (!payment) error(404, 'No payment with that id.');
	if (fieldOnly(locals) && payment.user_id !== locals.user!.id) {
		await refusedForAccess({ locals, route, request });
		error(404, 'No payment with that id.');
	}
	return { payment };
};
