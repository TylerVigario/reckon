import { GOOGLE_MAPS_API_KEY } from '$app/env/private';

/**
 * Asks Google whether a place id is a place.
 *
 * The browser supplies the id, and the server does not take a browser's word
 * for anything. Places Details (New) answers in one request, and a field mask
 * of the id alone keeps it on the cheapest SKU.
 *
 * A network failure, a timeout or a missing key all return 'unknown': Google
 * did not say. What a caller does with that is the caller's; an address does
 * not save on it (confirmPlace).
 */
export type Verdict = 'real' | 'no-such-place' | 'unknown';

const TIMEOUT_MS = 4000;

export async function verifyPlace(placeId: string): Promise<Verdict> {
	const key = GOOGLE_MAPS_API_KEY;
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
		// Logged for whoever runs the installation: a key Google refuses, or one
		// not allowed this API, is theirs to put right, and looks to the person
		// saving an address like Google being away.
		console.error('Google would not confirm a place', r.status, await r.text().catch(() => ''));
		return 'unknown';
	} catch {
		return 'unknown';
	}
}

/**
 * AN ADDRESS IS SAVED ONLY AS A PLACE GOOGLE CONFIRMS (8 October 2026): it is
 * chosen from Google's suggestions and online only, so one Google did not
 * confirm -- because it does not know it, or could not be asked -- is not
 * saved. Null when it may be; otherwise why not, in the reader's words.
 */
export async function confirmPlace(placeId: string | null | undefined): Promise<string | null> {
	if (!placeId) return "Choose the address from Google's suggestions.";
	const verdict = await verifyPlace(placeId);
	if (verdict === 'real') return null;
	if (verdict === 'no-such-place')
		return 'Google does not know that place. Choose the address again.';
	return 'Google could not confirm the address just now, so it is not saved. Try again.';
}
