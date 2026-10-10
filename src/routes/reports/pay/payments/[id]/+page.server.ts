import { error } from '@sveltejs/kit';
import { paymentOf } from '#lib/server/pay.ts';
import { UUID } from '#lib/field-rules.ts';
import type { PageServerLoad } from './$types';

/** A payment as it was recorded, never changed after. */
export const load: PageServerLoad = async ({ params }) => {
	if (!UUID.test(params.id)) error(404, 'No payment with that id.');
	const payment = await paymentOf(params.id);
	if (!payment) error(404, 'No payment with that id.');
	return { payment };
};
