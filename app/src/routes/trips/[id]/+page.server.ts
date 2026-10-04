import { error } from '@sveltejs/kit';
import { and, asc, eq, sql } from 'drizzle-orm';
import { Decimal, Ratio, sum } from '#lib/decimal.ts';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { townsOf } from '#lib/server/trips.ts';
import { loadCatalogue, valueLegs } from '#lib/server/valuation/load.ts';
import { billedAmount, jobRate, priceOn } from '#lib/server/valuation/pricing.ts';
import { moneyPlaces } from '#lib/server/business.ts';
import { UUID } from '#lib/field-rules.ts';
import type { PageServerLoad } from './$types';

/**
 * One drive, and how its miles were handed to clients.
 *
 * The second tile is the point of the screen: what these legs bill, against
 * what a full round trip each would have billed. On the seeded trip that is
 * the difference between 57 miles and 70.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!UUID.test(params.id)) error(404, 'no such trip');

	const tr = t.trip;
	const ts = t.tripStop;
	const si = t.site;
	const tl = t.tripLeg;
	const e = t.entity;
	const u = t.user;

	const [found] = await db
		.select({
			id: tr.id,
			travelled_on: tr.travelledOn,
			driver: u.name,
			stops: townsOf(tr.id)
		})
		.from(tr)
		.leftJoin(u, eq(u.id, tr.drivenBy))
		.where(eq(tr.id, params.id));
	if (!found) error(404, 'no such trip');

	const [stops, rows] = await Promise.all([
		db
			.select({
				seq: ts.seq,
				place: sql<string>`coalesce(${si.display}, ${ts.address}, 'Unrecorded')`,
				detail: sql<string | null>`(${db
					.select({ names: sql`string_agg(distinct ${e.name}, ' and ')` })
					.from(tl)
					.innerJoin(e, eq(e.id, tl.entityId))
					.where(and(eq(tl.tripId, ts.tripId), eq(tl.siteId, ts.siteId)))})`
			})
			.from(ts)
			.leftJoin(si, eq(si.id, ts.siteId))
			.where(eq(ts.tripId, params.id))
			.orderBy(asc(ts.seq)),
		db
			.select({
				id: tl.id,
				seq: tl.seq,
				who: e.name,
				rule: tl.rule,
				miles: tl.miles,
				serviceId: tl.serviceId,
				entityId: tl.entityId,
				siteId: tl.siteId,
				roundTripMiles: si.roundTripMiles
			})
			.from(tl)
			.leftJoin(e, eq(e.id, tl.entityId))
			.leftJoin(si, eq(si.id, tl.siteId))
			.where(eq(tl.tripId, params.id))
			.orderBy(asc(tl.seq))
	]);

	const travelledOn = found.travelled_on;
	const [worth, { services, prices }, places] = await Promise.all([
		valueLegs(
			db,
			rows.map((l) => ({ ...l, travelledOn }))
		),
		loadCatalogue(db),
		moneyPlaces()
	]);

	// What each client would have been charged driving out and back alone,
	// which is what most systems would have billed -- at the same service and
	// price its leg bills at.
	const alone = new Map<string, Decimal | null>();
	for (const l of rows) {
		if (l.entityId === null || l.siteId === null || l.serviceId === null) continue;
		const key = `${l.siteId}:${l.entityId}:${l.serviceId}`;
		if (alone.has(key)) continue;
		const service = services.get(l.serviceId);
		const rate = jobRate(priceOn(prices, l.serviceId, l.entityId, travelledOn), 1, places);
		alone.set(
			key,
			service && l.roundTripMiles !== null
				? billedAmount(service, rate, Ratio.of(l.roundTripMiles), places)
				: null
		);
	}
	const roundTrips = [...alone.values()].filter((x): x is Decimal => x !== null);

	const trip = {
		...found,
		miles: sum(rows.map((l) => l.miles)).toFixed(2),
		billed: sum(rows.map((l) => worth.get(l.id)?.billed ?? null)).toFixed(places),
		round_trips: roundTrips.length ? sum(roundTrips).toFixed(places) : null
	};
	const legs = rows.map((l) => ({
		id: l.id,
		seq: l.seq,
		who: l.who,
		rule: l.rule,
		miles: l.miles,
		value: worth.get(l.id)?.billed?.toString() ?? null
	}));

	return { trip, stops, legs };
};
