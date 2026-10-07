import { eq } from 'drizzle-orm';
import { asUser } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { pgError, refuse, refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';
import { readTrip } from '#lib/server/trip-input.ts';
import { mileServiceFor } from '#lib/server/trip-worth.ts';
import { legsOf } from '#lib/trip-legs.ts';
import { readBody } from '#lib/json.ts';
import type { RequestHandler } from './$types';

/** Each foreign key a trip can break, and what it means to the person recording it. */
const GONE: Record<string, [field: string, why: string]> = {
	trip_driven_by_fkey: ['driven_by', 'That person no longer exists.'],
	trip_vehicle_id_fkey: ['vehicle_id', 'That vehicle no longer exists.'],
	trip_stop_site_id_fkey: ['stops', 'A site on it no longer exists.'],
	trip_stop_client_entity_id_fkey: ['stops', 'A client on it no longer exists.'],
	trip_stop_client_site_is_the_clients: ['stops', "A site on it is no longer that client's."],
	trip_leg_service_id_fkey: ['service_id', 'That service no longer exists.']
};

const FIELDS = [
	'travelled_on',
	'driven_by',
	'vehicle_id',
	'service_id',
	'start_address',
	'end_address',
	'odometer_start',
	'odometer_end',
	'note',
	'stops',
	'drives'
];

/**
 * Records a trip: its stops, who each was for, and its legs, each given to
 * whoever caused it by #lib/trip-legs -- worked out here from what was sent,
 * not taken from the page. A trip sent twice with one id is one trip.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const read = readTrip(await readBody(request));
	if (!read.ok) return refuse(read.errors);
	const trip = read.trip;
	const legs = legsOf(trip.stops, trip.drives);

	// A leg billed to someone bills as a service charged by the mile.
	let serviceId: string | null = null;
	if (legs.some((l) => l.entityId)) {
		const s = await mileServiceFor(trip.serviceId);
		if ('why' in s) return refuse({ service_id: s.why });
		serviceId = s.id;
	}

	try {
		const made = await asUser(locals.user!.id, async (tx) => {
			const [row] = await tx
				.insert(t.trip)
				.values({
					clientUuid: trip.clientUuid,
					travelledOn: trip.travelledOn,
					drivenBy: trip.drivenBy,
					createdBy: locals.user!.id,
					vehicleId: trip.vehicleId,
					note: trip.note,
					odometerStart: trip.odometerStart,
					odometerEnd: trip.odometerEnd,
					startAddress: trip.startAddress,
					endAddress: trip.endAddress
				})
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
			const stops = await tx
				.insert(t.tripStop)
				.values(
					trip.stops.map((s, i) => ({
						tripId: row.id,
						seq: i + 1,
						siteId: s.siteId,
						address: s.address
					}))
				)
				.returning({ id: t.tripStop.id, seq: t.tripStop.seq });
			const ids = stops.sort((a, b) => a.seq - b.seq).map((s) => s.id);
			const clients = trip.stops.flatMap((s, i) =>
				s.visits.map((v) => ({
					tripStopId: ids[i],
					entityId: v.entityId,
					siteId: v.siteId,
					askedThere: v.askedThere
				}))
			);
			if (clients.length) await tx.insert(t.tripStopClient).values(clients);
			await tx.insert(t.tripLeg).values(
				legs.map((l, k) => ({
					tripId: row.id,
					seq: k + 1,
					miles: l.miles,
					entityId: l.entityId,
					siteId: l.siteId,
					rule: l.rule,
					serviceId: l.entityId ? serviceId : null,
					toStopId: l.drive < ids.length ? ids[l.drive] : null
				}))
			);
			return { id: row.id, repeat: false };
		});
		return Response.json({ id: made.id }, { status: made.repeat ? 200 : 201 });
	} catch (err) {
		const pg = pgError(err);
		const gone = pg.code === '23503' ? GONE[pg.constraint ?? ''] : undefined;
		if (gone) return refuse({ [gone[0]]: gone[1] });
		const refused = refuseIfTheDatabaseSaidSo(err, FIELDS, 'trip');
		if (refused) return refused;
		throw err;
	}
};
