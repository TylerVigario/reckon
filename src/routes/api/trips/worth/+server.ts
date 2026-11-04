import { refuse } from '#lib/server/field-errors.ts';
import { readTrip } from '#lib/server/trip-input.ts';
import { mileServiceFor, tripWorth } from '#lib/server/trip-worth.ts';
import { legsOf } from '#lib/trip-legs.ts';
import { readBody } from '#lib/json.ts';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import type { RequestHandler } from './$types';

/**
 * What a trip not yet saved comes to: what each leg bills, what it pays the
 * vehicle it was driven in, and what is kept -- for the New trip form, from
 * the same rule and the same valuation the saved trip will have.
 *
 * Someone with Field is not told what another person's vehicle is paid, which
 * is that person's to see, nor what the business keeps (#lib/access).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const read = readTrip(await readBody(request));
	if (!read.ok) return refuse(read.errors);
	const trip = read.trip;
	const legs = legsOf(trip.stops, trip.drives);
	const service = legs.some((l) => l.entityId) ? await mileServiceFor(trip.serviceId) : null;
	const worth = await tripWorth({
		travelledOn: trip.travelledOn,
		vehicleId: trip.vehicleId,
		serviceId: service && 'id' in service ? service.id : null,
		legs
	});
	if (!fieldOnly(locals)) return Response.json({ ...worth, withheld: false });
	const [vehicle] = trip.vehicleId
		? await db
				.select({ ownerId: t.vehicle.ownerId })
				.from(t.vehicle)
				.where(eq(t.vehicle.id, trip.vehicleId))
		: [];
	const withheld = !!vehicle?.ownerId && vehicle.ownerId !== locals.user!.id;
	return Response.json({
		...worth,
		legs: worth.legs.map((l) => ({ billed: l.billed, paid: withheld ? null : l.paid })),
		rule: withheld ? null : worth.rule,
		paid: withheld ? null : worth.paid,
		kept: null,
		withheld
	});
};
