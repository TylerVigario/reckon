import { UUID } from '#lib/field-rules.ts';
import { readBody } from '#lib/json.ts';
import { problem } from '#lib/server/problem.ts';
import { routeMiles } from '#lib/server/routes.ts';
import { waypointsOf } from '#lib/server/trips.ts';
import type { RequestHandler } from './$types';

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null);

/**
 * The miles of each drive of a trip being recorded, by Google's route: one more
 * than there are stops, or null when Google cannot say -- no key, no address
 * for the base, a place it cannot find -- and the form keeps what it had.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readBody(request);
	const raw = Array.isArray(body?.stops) ? (body.stops as unknown[]) : null;
	if (!raw || raw.length === 0 || raw.length > 25)
		return problem('malformed', 400, 'Expected { stops: [{ site_id or address }] }.');
	const stops = raw.map((s) => {
		const x = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
		const siteId = typeof x.site_id === 'string' && UUID.test(x.site_id) ? x.site_id : null;
		return { siteId, address: siteId ? null : text(x.address) };
	});
	if (stops.some((s) => !s.siteId && !s.address))
		return problem('malformed', 400, 'Each stop is a site or an address.');
	const points = await waypointsOf({
		startAddress: text(body?.start_address),
		endAddress: text(body?.end_address),
		stops
	});
	return Response.json({ miles: points ? await routeMiles(points) : null });
};
