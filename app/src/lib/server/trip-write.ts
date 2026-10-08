import { sql } from 'drizzle-orm';
import type { Reader } from './db/index.ts';
import * as t from './db/schema/index.ts';
import { pgError, refuse, refuseIfTheDatabaseSaidSo } from './field-errors.ts';
import type { TripInput } from './trip-input.ts';
import { mileServiceFor } from './trip-worth.ts';
import { legsOf, withRoute, type Leg } from '#lib/trip-legs.ts';
import { routeMiles } from './routes.ts';
import { waypointsOf } from './trips.ts';

const routeOf = async (trip: TripInput) => {
	const points = await waypointsOf(trip);
	return points ? routeMiles(points) : null;
};

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

/**
 * The trip's legs, and the service the billed ones bill as -- or why there is
 * none. A drive whose miles were an estimate -- the phone had no signal, or
 * Google no answer -- takes Google's route now, if Google answers.
 */
export async function legsFor(
	trip: TripInput
): Promise<{ legs: Leg[]; serviceId: string | null } | { refused: Response }> {
	const drives = trip.drives.some((d) => d.estimated)
		? withRoute(trip.drives, await routeOf(trip))
		: trip.drives;
	const legs = legsOf(trip.stops, drives);
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

/**
 * Whether a trip is settled, and how: any of its miles on an invoice, which
 * leaves it as billed, or in a payment to its vehicle's owner (0026), which
 * leaves it as paid. Null while it is neither, and may change.
 */
export async function settled(tx: Reader, tripId: string): Promise<'billed' | 'paid' | null> {
	const [row] = await tx
		.select({
			billed: sql<boolean>`exists (select 1 from invoice_line il join trip_leg l on l.id = il.trip_leg_id
			                             where l.trip_id = ${tripId})`,
			paid: sql<boolean>`exists (select 1 from person_payment_item i where i.trip_id = ${tripId})`
		})
		.from(sql`(select 1) as one`);
	return row.billed ? 'billed' : row.paid ? 'paid' : null;
}

/** What a settled trip says when somebody tries to change or remove it. */
export const SETTLED = {
	billed: 'Its miles are on an invoice, so it stays as it was billed.',
	paid: 'Its miles are in a payment for the vehicle, so it stays as it was paid.'
} as const;
