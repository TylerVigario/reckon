import { eq, sql } from 'drizzle-orm';
import type { Reader } from './db/index.ts';
import * as t from './db/schema/index.ts';
import { pgError, refuse, refuseIfTheDatabaseSaidSo } from './field-errors.ts';
import type { TripInput } from './trip-input.ts';
import { mileServiceFor } from './trip-worth.ts';
import { legsOf, type Leg } from '#lib/trip-legs.ts';

/**
 * Writing a trip, new or changed (#routes/api/trips): its legs worked out by
 * #lib/trip-legs from what was sent, the service they bill as, and the stops,
 * who each was for, and the legs written under the trip.
 */

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

/** What the database said, as a refusal a person can act on, or null to rethrow. */
export function refuseTrip(err: unknown): Response | null {
	const pg = pgError(err);
	const gone = pg.code === '23503' ? GONE[pg.constraint ?? ''] : undefined;
	if (gone) return refuse({ [gone[0]]: gone[1] });
	return refuseIfTheDatabaseSaidSo(err, FIELDS, 'trip');
}

/** The trip's legs, and the service the billed ones bill as -- or why there is none. */
export async function legsFor(
	trip: TripInput
): Promise<{ legs: Leg[]; serviceId: string | null } | { refused: Response }> {
	const legs = legsOf(trip.stops, trip.drives);
	if (!legs.some((l) => l.entityId)) return { legs, serviceId: null };
	const s = await mileServiceFor(trip.serviceId);
	if ('why' in s) return { refused: refuse({ service_id: s.why }) };
	return { legs, serviceId: s.id };
}

/** The trip's own columns, from what was sent. */
export const tripColumns = (trip: TripInput) => ({
	travelledOn: trip.travelledOn,
	drivenBy: trip.drivenBy,
	vehicleId: trip.vehicleId,
	note: trip.note,
	odometerStart: trip.odometerStart,
	odometerEnd: trip.odometerEnd,
	startAddress: trip.startAddress,
	endAddress: trip.endAddress
});

/** Writes a trip's stops, who each was for, and its legs, under it. */
export async function writeStops(
	tx: Reader,
	tripId: string,
	trip: TripInput,
	legs: readonly Leg[],
	serviceId: string | null
) {
	const stops = await tx
		.insert(t.tripStop)
		.values(
			trip.stops.map((s, i) => ({ tripId, seq: i + 1, siteId: s.siteId, address: s.address }))
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
			tripId,
			seq: k + 1,
			miles: l.miles,
			entityId: l.entityId,
			siteId: l.siteId,
			rule: l.rule,
			serviceId: l.entityId ? serviceId : null,
			toStopId: l.drive < ids.length ? ids[l.drive] : null
		}))
	);
}

/** Whether any of a trip's miles are on an invoice, which leaves the trip as billed. */
export const onAnInvoice = async (tx: Reader, tripId: string) =>
	(
		await tx
			.select({ n: sql<number>`count(*)::int` })
			.from(t.invoiceLine)
			.innerJoin(t.tripLeg, eq(t.tripLeg.id, t.invoiceLine.tripLegId))
			.where(eq(t.tripLeg.tripId, tripId))
	)[0].n > 0;
