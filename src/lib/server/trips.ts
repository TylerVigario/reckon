import { asc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from './db/index.ts';
import * as t from './db/schema/index.ts';
import { businessToday } from './calendar.ts';
import { sum } from '#lib/decimal.ts';
import { driveKey, type Place } from '#lib/trip-legs.ts';
import { operatorRow } from './operator.ts';
import { baseOf } from './site-drive.ts';
import type { Waypoint } from './routes.ts';

/**
 * Where a trip went, by town: a trip is titled "Woodland and Elverta", not by
 * street. A trip belongs to the drive, not to any one client, so the place's
 * own name is used rather than a client's name for it.
 */
export const townsOf = (tripId: AnyPgColumn) =>
	sql<string | null>`(${db
		.select({
			towns: sql`string_agg(distinct coalesce(${t.site.city}, ${t.site.label}, ${t.tripStop.address}), ' and '
			                      order by coalesce(${t.site.city}, ${t.site.label}, ${t.tripStop.address}))`
		})
		.from(t.tripStop)
		.leftJoin(t.site, eq(t.site.id, t.tripStop.siteId))
		.where(eq(t.tripStop.tripId, tripId))})`;

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
			.select({
				id: t.trip.id,
				on: t.trip.travelledOn,
				start: t.trip.startAddress,
				end: t.trip.endAddress
			})
			.from(t.trip)
			.where(gte(t.trip.travelledOn, since))
			.orderBy(asc(t.trip.travelledOn), asc(t.trip.createdAt)),
		db
			.select({
				id: t.tripStop.id,
				tripId: t.tripStop.tripId,
				seq: t.tripStop.seq,
				siteId: t.tripStop.siteId,
				address: t.tripStop.address
			})
			.from(t.tripStop)
			.innerJoin(t.trip, eq(t.trip.id, t.tripStop.tripId))
			.where(gte(t.trip.travelledOn, since))
			.orderBy(asc(t.tripStop.seq)),
		db
			.select({ tripId: t.tripLeg.tripId, to: t.tripLeg.toStopId, miles: t.tripLeg.miles })
			.from(t.tripLeg)
			.innerJoin(t.trip, eq(t.trip.id, t.tripLeg.tripId))
			.where(gte(t.trip.travelledOn, since))
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
					.select({
						id: t.site.id,
						placeId: t.site.googlePlaceId,
						street: t.site.street,
						city: t.site.city,
						region: t.site.region,
						postcode: t.site.postcode
					})
					.from(t.site)
					.where(inArray(t.site.id, ids))
			: Promise.resolve([])
	]);
	const base = baseOf(operator);
	const at = (address: string | null): Waypoint | null => (address ? { address } : base);
	const stops = trip.stops.map((s): Waypoint | null => {
		if (s.address) return { address: s.address };
		const site = sites.find((x) => x.id === s.siteId);
		if (!site) return null;
		return site.placeId
			? { placeId: site.placeId }
			: { address: `${site.street}, ${site.city}, ${site.region} ${site.postcode}` };
	});
	const all = [at(trip.startAddress), ...stops, at(trip.endAddress)];
	return all.every((w) => w !== null) ? all : null;
}
