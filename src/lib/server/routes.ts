import { GOOGLE_MAPS_API_KEY } from '$app/env/private';

/**
 * A TRIP'S MILES BY GOOGLE'S ROUTE: the Routes API, asked by this server only,
 * with the server's key (decided 7 October 2026), for each drive between a
 * trip's places in order -- and a site's drive, from the business there and
 * back, with how long the way there takes (8 October 2026).
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
const driven = new Map<string, { drive: Drive; at: number }>();

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
		const legs = await legsOf(piece, key, false);
		if (!legs) return null;
		miles.push(...legs.map((l) => (l.metres / METRES_A_MILE).toFixed(1)));
	}
	if (miles.length !== points.length - 1) return null;

	if (asked.size >= 500) asked.delete(asked.keys().next().value!);
	asked.set(cacheKey, { miles, at: Date.now() });
	return miles;
}

/** A site's drive: there and back, in miles to a tenth, and the way there in whole minutes. */
export type Drive = { miles: string; minutes: number };

/**
 * From the business to a place and back again, as one request of two legs.
 * The way back is driven too, and need not be the way there, so the round trip
 * is both legs' miles; the time is the way there, which is what a visit waits
 * on. Null when Google cannot say, as for a trip.
 */
export async function roundTrip(base: Waypoint, place: Waypoint): Promise<Drive | null> {
	const key = GOOGLE_MAPS_API_KEY;
	if (!key) return null;

	const cacheKey = JSON.stringify([base, place]);
	const kept = driven.get(cacheKey);
	if (kept && Date.now() - kept.at < DAY_MS) return kept.drive;

	const legs = await legsOf([base, place, base], key, true);
	if (!legs) return null;
	const [there, back] = legs;
	if (there.seconds === null) return null;
	const drive = {
		miles: ((there.metres + back.metres) / METRES_A_MILE).toFixed(1),
		minutes: Math.round(there.seconds / 60)
	};

	if (driven.size >= 500) driven.delete(driven.keys().next().value!);
	driven.set(cacheKey, { drive, at: Date.now() });
	return drive;
}

/** Each leg of one request: its metres, and its seconds where they were asked for. */
async function legsOf(
	piece: readonly Waypoint[],
	key: string,
	timed: boolean
): Promise<{ metres: number; seconds: number | null }[] | null> {
	try {
		const r = await fetch(ENDPOINT, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'X-Goog-Api-Key': key,
				// The duration without traffic is the same Essentials tier as the
				// distance.
				'X-Goog-FieldMask': timed
					? 'routes.legs.distanceMeters,routes.legs.duration'
					: 'routes.legs.distanceMeters'
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
		const body = (await r.json()) as {
			routes?: { legs?: { distanceMeters?: number; duration?: string }[] }[];
		};
		const legs = body.routes?.[0]?.legs ?? [];
		// A leg between two places at one spot has no distance at all, and says
		// nothing rather than zero; its duration is "0s".
		const out = legs.map((l) => ({
			metres: l.distanceMeters ?? 0,
			seconds: timed && /^\d+(\.\d+)?s$/.test(l.duration ?? '') ? parseFloat(l.duration!) : null
		}));
		return out.length === piece.length - 1 ? out : null;
	} catch {
		return null;
	}
}
