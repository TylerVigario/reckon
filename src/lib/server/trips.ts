import { expressionBuilder, sql, type Expression } from 'kysely';
import type { DB } from './db/database.ts';
import { db } from './db/index.ts';
import { businessToday } from './calendar.ts';
import { sum } from '#lib/decimal.ts';
import { driveKey, type Place } from '#lib/trip-legs.ts';
import { operatorRow } from './operator.ts';
import { baseOf, siteAt } from './site-drive.ts';
import type { Waypoint } from './routes.ts';

/**
 * Where a trip went, by town: a trip is titled "Woodland and Elverta", not by
 * street. A trip belongs to the drive, not to any one client, so the place's
 * own name is used rather than a client's name for it. No trip, no towns: a
 * null id finds no stops.
 */
export const townsOf = (tripId: Expression<string | null>) =>
	expressionBuilder<DB>()
		.selectFrom('trip_stop')
		.leftJoin('site', 'site.id', 'trip_stop.site_id')
		.where('trip_stop.trip_id', '=', tripId)
		.select((eb) => {
			const place = eb.fn.coalesce('site.city', 'site.label', 'trip_stop.address');
			return sql<string | null>`string_agg(distinct ${place}, ' and ' order by ${place})`.as(
				'towns'
			);
		})
		.$asScalar();

/**
 * Each drive between two places as it was last driven (#lib/trip-legs), from
 * the trips of the past year: what a drive between the same two places starts
 * at before anyone types it. Legs recorded before they named the stop they
 * drove to are not counted -- nobody knows where they went from.
 */
export async function knownDrives(): Promise<Record<string, { miles: string; on: string }>> {
	const since = Temporal.PlainDate.from(businessToday()).subtract({ years: 1 }).toString();
	const [trips, stops, legs] = await Promise.all([
		db
			.selectFrom('trip')
			.select(['id', 'travelled_on as on', 'start_address as start', 'end_address as end'])
			.where('travelled_on', '>=', since)
			.orderBy('travelled_on')
			.orderBy('created_at')
			.execute(),
		db
			.selectFrom('trip_stop')
			.innerJoin('trip', 'trip.id', 'trip_stop.trip_id')
			.select([
				'trip_stop.id',
				'trip_stop.trip_id as tripId',
				'trip_stop.seq',
				'trip_stop.site_id as siteId',
				'trip_stop.address'
			])
			.where('trip.travelled_on', '>=', since)
			.orderBy('trip_stop.seq')
			.execute(),
		db
			.selectFrom('trip_leg')
			.innerJoin('trip', 'trip.id', 'trip_leg.trip_id')
			.select(['trip_leg.trip_id as tripId', 'trip_leg.to_stop_id as to', 'trip_leg.miles'])
			.where('trip.travelled_on', '>=', since)
			.execute()
	]);
	const placeOf = (s: { siteId: string | null; address: string | null }): Place | null =>
		s.siteId ? { site: s.siteId } : s.address ? { address: s.address } : null;
	const known: Record<string, { miles: string; on: string }> = {};
	// Oldest first, so the latest drive between two places is the one kept.
	for (const trip of trips) {
		const mine = stops.filter((s) => s.tripId === trip.id);
		const theirLegs = legs.filter((l) => l.tripId === trip.id);
		if (!mine.length || !theirLegs.some((l) => l.to !== null)) continue;
		const places: (Place | null)[] = [
			trip.start ? { address: trip.start } : 'base',
			...mine.map(placeOf),
			trip.end ? { address: trip.end } : 'base'
		];
		for (let i = 0; i <= mine.length; i++) {
			const [from, to] = [places[i], places[i + 1]];
			if (!from || !to) continue;
			const drive = theirLegs.filter((l) => l.to === (i < mine.length ? mine[i].id : null));
			if (!drive.length) continue;
			known[driveKey(from, to)] = { miles: sum(drive.map((l) => l.miles)).toFixed(2), on: trip.on };
		}
	}
	return known;
}

/**
 * A trip's places as Google is asked for them (#lib/server/routes): the base,
 * by the operator's address; each site by its place id where Google gave one,
 * or its address; anywhere else as it was typed. Null when the trip starts or
 * ends at a base nobody has given an address.
 */
export async function waypointsOf(trip: {
	startAddress: string | null;
	endAddress: string | null;
	stops: readonly { siteId: string | null; address: string | null }[];
}): Promise<Waypoint[] | null> {
	const ids = trip.stops.flatMap((s) => (s.siteId ? [s.siteId] : []));
	const [operator, sites] = await Promise.all([
		operatorRow(),
		ids.length
			? db
					.selectFrom('site')
					.select(['id', 'google_place_id as placeId', 'street', 'city', 'region', 'postcode'])
					.where('id', '=', (eb) => eb.fn.any(eb.val(ids)))
					.execute()
			: Promise.resolve([])
	]);
	const base = baseOf(operator);
	const at = (address: string | null): Waypoint | null => (address ? { address } : base);
	const stops = trip.stops.map((s): Waypoint | null => {
		if (s.address) return { address: s.address };
		const site = sites.find((x) => x.id === s.siteId);
		if (!site) return null;
		return siteAt(site);
	});
	const all = [at(trip.startAddress), ...stops, at(trip.endAddress)];
	return all.every((w) => w !== null) ? all : null;
}
