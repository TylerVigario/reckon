import { GOOGLE_MAPS_API_KEY } from '$app/env/private';
import type { Verdict } from '#lib/verdict.ts';

/**
 * Address validation, server-side.
 *
 * The second key, and it has to be a second key: a Google API key carries
 * exactly one application restriction, so one restricted to HTTP referrers for
 * the browser cannot also be restricted to this host's address. Sharing one
 * would mean leaving it unrestricted.
 *
 * Called once, when an address is chosen, not per keystroke -- so the extra
 * round trip through this server costs nothing that matters.
 *
 * Choosing a place from autocomplete says the place exists. Validation says the
 * address is deliverable and hands back a corrected, standardised form, which
 * is worth having on something a tax district is resolved from: Reg 1826 puts
 * district tax at the jobsite, so the address is the input to the rate.
 */

const ENDPOINT = 'https://addressvalidation.googleapis.com/v1:validateAddress';

/**
 * The same limit as place verification: the address field waits on this
 * before it lets go, and a verdict is information, so a slow Google gets no
 * verdict rather than a longer wait.
 */
const TIMEOUT_MS = 4000;

/**
 * Thrown when Google gives no verdict. The message is safe to show anyone.
 * What Google actually said -- about this installation's key, its billing or
 * its quota -- is for whoever runs it, and goes to the server's log.
 */
export class NoVerdict extends Error {}

export const validationIsLive = () => GOOGLE_MAPS_API_KEY !== undefined;

export type { Verdict } from '#lib/verdict.ts';

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
 * without the second key still gets addresses. Throws NoVerdict, and only
 * that, when Google gives no verdict.
 */
export async function validate(address: {
	street?: string | null;
	city?: string | null;
	region?: string | null;
	postcode?: string | null;
	country?: string | null;
}): Promise<Verdict | null> {
	const key = GOOGLE_MAPS_API_KEY;
	if (!key) return null;

	const lines = [address.street, address.city, address.region, address.postcode].filter(
		Boolean
	) as string[];
	if (lines.length === 0) return null;

	let answer: ValidationAnswer;
	try {
		const r = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				address: {
					regionCode: address.country ?? 'US',
					addressLines: lines
				}
			}),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		if (!r.ok) {
			console.error('address validation refused', r.status, await r.text());
			throw new NoVerdict(`Google answered ${r.status}.`);
		}
		answer = (await r.json()) as ValidationAnswer;
	} catch (e) {
		if (e instanceof NoVerdict) throw e;
		if (e instanceof Error && e.name === 'TimeoutError')
			throw new NoVerdict(`Google did not answer within ${TIMEOUT_MS / 1000} seconds.`);
		console.error('address validation failed', e instanceof Error ? e.message : String(e));
		throw new NoVerdict('Google could not be reached.');
	}

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
