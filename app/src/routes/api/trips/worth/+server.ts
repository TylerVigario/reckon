import { refuse } from '#lib/server/field-errors.ts';
import { readTrip } from '#lib/server/trip-input.ts';
import { mileServiceFor, tripWorth } from '#lib/server/trip-worth.ts';
import { legsOf } from '#lib/trip-legs.ts';
import { readBody } from '#lib/json.ts';
import type { RequestHandler } from './$types';

/**
 * What a trip not yet saved comes to: what each leg bills, what it pays the
 * vehicle it was driven in, and what is kept -- for the New trip form, from
 * the same rule and the same valuation the saved trip will have.
 */
export const POST: RequestHandler = async ({ request }) => {
	const read = readTrip(await readBody(request));
	if (!read.ok) return refuse(read.errors);
	const trip = read.trip;
	const legs = legsOf(trip.stops, trip.drives);
	const service = legs.some((l) => l.entityId) ? await mileServiceFor(trip.serviceId) : null;
	return Response.json(
		await tripWorth({
			travelledOn: trip.travelledOn,
			vehicleId: trip.vehicleId,
			serviceId: service && 'id' in service ? service.id : null,
			legs
		})
	);
};
