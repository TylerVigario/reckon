import { eq } from 'drizzle-orm';
import { asUser } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { readTrip } from '#lib/server/trip-input.ts';
import { legsFor, refuseTrip, tripColumns, writeStops } from '#lib/server/trip-write.ts';
import { readBody } from '#lib/json.ts';
import type { RequestHandler } from './$types';

/**
 * Records a trip: its stops, who each was for, and its legs, each given to
 * whoever caused it by #lib/trip-legs -- worked out here from what was sent,
 * not taken from the page. A trip sent twice with one id is one trip.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const read = readTrip(await readBody(request));
	if (!read.ok) return refuse(read.errors);
	const trip = read.trip;
	const worked = await legsFor(trip);
	if ('refused' in worked) return worked.refused;

	try {
		const made = await asUser(locals.user!.id, async (tx) => {
			const [row] = await tx
				.insert(t.trip)
				.values({ ...tripColumns(trip), clientUuid: trip.clientUuid, createdBy: locals.user!.id })
				.onConflictDoNothing({ target: t.trip.clientUuid })
				.returning({ id: t.trip.id });
			// A repeat is the trip already there, answered as if just written.
			if (!row) {
				const [was] = await tx
					.select({ id: t.trip.id })
					.from(t.trip)
					.where(eq(t.trip.clientUuid, trip.clientUuid));
				return { id: was.id, repeat: true };
			}
			await writeStops(tx, row.id, trip, worked.legs, worked.serviceId);
			return { id: row.id, repeat: false };
		});
		return Response.json({ id: made.id }, { status: made.repeat ? 200 : 201 });
	} catch (err) {
		const refused = refuseTrip(err);
		if (refused) return refused;
		throw err;
	}
};
