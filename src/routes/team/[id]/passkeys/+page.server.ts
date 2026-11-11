import { error } from '@sveltejs/kit';
import { UUID } from '#lib/field-rules.ts';
import { listPasskeys } from '#lib/server/passkeys.ts';
import type { PageServerLoad } from './$types';

/**
 * One person's passkeys, as Your profile lists them for themselves (the
 * layout loads who they are), each to end on its own: for the phone or
 * computer holding it being lost or stolen, while the rest keep working.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!UUID.test(params.id)) error(404, 'Nobody with that id.');
	return { list: await listPasskeys(params.id) };
};
