import { json } from '@sveltejs/kit';
import { validate, validationIsLive } from '$lib/server/validate-address';
import type { RequestHandler } from './$types';
import { problem } from '$lib/server/problem';
import { readBody, textField } from '$lib/json';

/**
 * Validates one chosen address.
 *
 * Behind the same guard as everything else: hooks.server.ts answers 401 for an
 * unauthenticated /api/ request, so this does not spend the operator's quota
 * for anyone who finds it.
 *
 * Once per address, not per keystroke -- the autocomplete never comes here.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!validationIsLive()) return json({ verdict: null, reason: 'no server key' });

	const body = await readBody(request);
	if (!body) return problem('malformed', 400, 'Expected an address.');

	const address = {
		street: textField(body, 'street') || null,
		city: textField(body, 'city') || null,
		region: textField(body, 'region') || null,
		postcode: textField(body, 'postcode') || null,
		country: textField(body, 'country') || null
	};

	try {
		return json({ verdict: await validate(address) });
	} catch (e) {
		// A quota, a wrong key, Google being down: none of them make the chosen
		// address wrong, and none are fixed by the caller. Say so rather than
		// reporting the address as invalid, which is what an empty verdict would
		// look like.
		return problem('upstream', 502, `Could not validate: ${(e as Error).message}`);
	}
};
