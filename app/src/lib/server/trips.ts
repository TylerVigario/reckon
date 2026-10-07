import { asc, eq, gte, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from './db/index.ts';
import * as t from './db/schema/index.ts';
import { businessToday } from './calendar.ts';
import { sum } from '#lib/decimal.ts';
import { driveKey, type Place } from '#lib/trip-legs.ts';

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
