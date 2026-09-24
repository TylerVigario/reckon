import { json } from '@sveltejs/kit';
import { asUser } from '$lib/server/db';
import { UUID } from '$lib/field-rules';
import type { RequestHandler } from './$types';
import { problem } from '$lib/server/problem';

/**
 * Takes back a price that has not yet been in force for a whole day: one
 * scheduled for later, or one entered today by mistake. A price whose day has
 * passed is history, and is changed by a price from another day instead.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id) || !UUID.test(params.price))
		return problem('notFound', 404, 'No such price.');

	const gone = await asUser(
		locals.user!.id,
		(tx) => tx<{ id: string }[]>`
			delete from service_price
			 where id = ${params.price} and service_id = ${params.id}
			   and effective_from >= current_date
			returning id`
	);
	if (gone.length === 0)
		return problem(
			'conflict',
			409,
			'That price is not here, or its day has passed. A price that has been in force stays on the history; change it with a price from another day.'
		);
	return json({ removed: params.price });
};
