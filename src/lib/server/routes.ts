import { GOOGLE_MAPS_API_KEY } from '$app/env/private';

/**
 * A TRIP'S MILES BY GOOGLE'S ROUTE: the Routes API, asked by this server only,
 * with the server's key (decided 7 October 2026), for each drive between a
 * trip's places in order.
 *
 * One request a trip. Up to ten places between the first and the last is the
 * Essentials tier, whose free allowance is ten thousand requests a month; a
 * longer trip is asked in pieces of that size rather than at the dearer tier.
 * No traffic: a mileage figure is the road, not the hour it was driven.
 *
 * NEVER A GUESS. No key, a place Google cannot find, no answer in time, or an
 * answer of the wrong shape all give null, and the miles are whatever the trip
 * would have had without Google. What Google said when it refused is logged,
 * for whoever runs the installation.
 */

export type Waypoint = { placeId: string } | { address: string };

const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const TIMEOUT_MS = 5000;
/** The most places between the first and the last that one Essentials request takes. */
const BETWEEN = 10;
const METRES_A_MILE = 1609.344;

// The same places asked again -- a form redrawn, a stop put back -- are not a
// second request. A day is long enough to matter and short enough for a road
// that changes.
const DAY_MS = 86_400_000;
const asked = new Map<string, { miles: string[]; at: number }>();

const waypoint = (w: Waypoint) =>
	'placeId' in w ? { placeId: w.placeId } : { address: w.address };

/** The miles of each drive between consecutive waypoints, to a tenth; null when Google cannot say. */
export async function routeMiles(points: readonly Waypoint[]): Promise<string[] | null> {
	const key = GOOGLE_MAPS_API_KEY;
	if (!key || points.length < 2) return null;

	const cacheKey = JSON.stringify(points);
	const kept = asked.get(cacheKey);
	if (kept && Date.now() - kept.at < DAY_MS) return kept.miles;

	const miles: string[] = [];
	// Pieces that share their ends: 0..11, 11..22, and so on.
	for (let from = 0; from < points.length - 1; from += BETWEEN + 1) {
		const piece = points.slice(from, from + BETWEEN + 2);
		const metres = await legsOf(piece, key);
		if (!metres) return null;
		miles.push(...metres.map((m) => (m / METRES_A_MILE).toFixed(1)));
	}
	if (miles.length !== points.length - 1) return null;

	if (asked.size >= 500) asked.delete(asked.keys().next().value!);
	asked.set(cacheKey, { miles, at: Date.now() });
	return miles;
}

/** Each leg of one request, in metres. */
async function legsOf(piece: readonly Waypoint[], key: string): Promise<number[] | null> {
	try {
		const r = await fetch(ENDPOINT, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'X-Goog-Api-Key': key,
				'X-Goog-FieldMask': 'routes.legs.distanceMeters'
			},
			body: JSON.stringify({
				origin: waypoint(piece[0]),
				destination: waypoint(piece[piece.length - 1]),
				intermediates: piece.slice(1, -1).map(waypoint),
				travelMode: 'DRIVE'
			}),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		if (!r.ok) {
			console.error('Google would not give a route', r.status, await r.text().catch(() => ''));
			return null;
		}
		const body = (await r.json()) as { routes?: { legs?: { distanceMeters?: number }[] }[] };
		const legs = body.routes?.[0]?.legs ?? [];
		// A leg between two places at one spot has no distance at all, and says
		// nothing rather than zero.
		const metres = legs.map((l) => l.distanceMeters ?? 0);
		return metres.length === piece.length - 1 ? metres : null;
	} catch {
		return null;
	}
}
