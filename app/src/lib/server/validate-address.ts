import { env } from '$env/dynamic/private';
import type { Verdict } from '$lib/verdict';

/**
 * Address validation, server-side.
 *
 * The second key, and it has to be a second key: a Google API key carries
 * exactly one application restriction, so one restricted to HTTP referrers for
 * the browser cannot also be restricted to this host's address. Sharing one
 * would mean leaving it unrestricted.
 *
 * Called once, when an address is chosen -- not per keystroke -- so the round
 * trip that ruled out proxying the autocomplete does not apply here.
 *
 * Choosing a place from autocomplete says the place exists. Validation says the
 * address is deliverable and hands back a corrected, standardised form, which
 * is worth having on something a tax district is resolved from: Reg 1826 puts
 * district tax at the jobsite, so the address is the input to the rate.
 */

const ENDPOINT = 'https://addressvalidation.googleapis.com/v1:validateAddress';

export const validationIsLive = () =>
	typeof env.GOOGLE_MAPS_API_KEY === 'string' && env.GOOGLE_MAPS_API_KEY.trim() !== '';

export type { Verdict } from '$lib/verdict';

/**
 * What Google's Address Validation API returns, narrowed to the parts read
 * below. Written down for the same reason as CDTFA's: a field that stops
 * arriving should be a typecheck failure, not a verdict that quietly reads
 * `undefined === true` and reports every address as incomplete.
 */
type ValidationAnswer = {
	result?: {
		verdict?: {
			addressComplete?: boolean;
			hasReplacedComponents?: boolean;
			hasInferredComponents?: boolean;
		};
		address?: {
			formattedAddress?: string;
			addressComponents?: { componentType?: string; confirmationLevel?: string }[];
		};
	};
};

/**
 * Returns null when no key is set, rather than throwing: validation is an
 * improvement on a chosen address, not a gate in front of one. An operator
 * without the second key still gets addresses.
 */
export async function validate(address: {
	street?: string | null;
	city?: string | null;
	region?: string | null;
	postcode?: string | null;
	country?: string | null;
}): Promise<Verdict | null> {
	const key = env.GOOGLE_MAPS_API_KEY?.trim();
	if (!key) return null;

	const lines = [address.street, address.city, address.region, address.postcode].filter(
		Boolean
	) as string[];
	if (lines.length === 0) return null;

	const r = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			address: {
				regionCode: address.country ?? 'US',
				addressLines: lines
			}
		})
	});

	if (!r.ok) throw new Error(`address validation: ${r.status} ${await r.text()}`);

	const answer = (await r.json()) as ValidationAnswer;
	const v = answer?.result ?? {};
	const verdict = v.verdict ?? {};

	return {
		complete: verdict.addressComplete === true,
		// Google reports what it changed as a granularity flag rather than a
		// diff; either of these means the stored address should be the one it
		// returned rather than the one that was sent.
		corrected: verdict.hasReplacedComponents === true || verdict.hasInferredComponents === true,
		inferred: verdict.hasInferredComponents === true,
		formatted: v.address?.formattedAddress ?? null,
		// The parts it could not confirm. Empty is the good case, and naming
		// them beats a boolean that says only that something is wrong.
		unconfirmed: (v.address?.addressComponents ?? [])
			.filter((c) => c.confirmationLevel && c.confirmationLevel !== 'CONFIRMED')
			.map((c) => c.componentType ?? 'unknown')
	};
}
