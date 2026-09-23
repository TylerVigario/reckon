import { env } from '$env/dynamic/private';

/**
 * Asks Google whether a place id is a place.
 *
 * The id arrives from the browser, so the browser is the one asserting it --
 * and an assertion from the browser is the one thing a server may not take at
 * face value. Places Details (New) answers in one request, with a field mask
 * narrow enough that it costs the cheapest SKU: the id and nothing else.
 *
 * IT NEVER BLOCKS A SAVE ON GOOGLE BEING REACHABLE. A network failure, a
 * timeout or a missing key all return 'unknown', and the address saves without
 * a verification date. Unverified is not invalid -- the alternative is an
 * address that cannot be corrected because the service that would confirm it
 * is down. Only a definite answer that the place does not exist refuses.
 */
export type Verdict = 'real' | 'no-such-place' | 'unknown';

const TIMEOUT_MS = 4000;

export async function verifyPlace(placeId: string): Promise<Verdict> {
	const key = env.GOOGLE_MAPS_API_KEY;
	if (!key) return 'unknown';

	try {
		const r = await fetch(
			`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
			{
				headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'id' },
				signal: AbortSignal.timeout(TIMEOUT_MS)
			}
		);
		if (r.ok) return 'real';
		// 404 is the only answer that means the id is wrong. A 403 is this
		// installation's key or billing, and a 429 is its quota -- both are our
		// problem rather than the operator's, and neither says anything about
		// the address they just chose.
		if (r.status === 404) return 'no-such-place';
		return 'unknown';
	} catch {
		return 'unknown';
	}
}
