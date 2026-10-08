import { error } from '@sveltejs/kit';
import { asc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { Decimal, Ratio, sum } from '#lib/decimal.ts';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { townsOf } from '#lib/server/trips.ts';
import { loadCatalogue, valueLegs } from '#lib/server/valuation/load.ts';
import { billedAmount, jobRate, priceOn } from '#lib/server/valuation/pricing.ts';
import { ruleOn } from '#lib/server/valuation/pay.ts';
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
	const v = t.vehicle;
	const owner = alias(t.user, 'owner');

	const [found] = await db
		.select({
			id: tr.id,
			travelled_on: tr.travelledOn,
			driver: u.name,
			stops: townsOf(tr.id),
			start_address: tr.startAddress,
			end_address: tr.endAddress,
			note: tr.note,
			odometer_start: tr.odometerStart,
			odometer_end: tr.odometerEnd,
			invoiced: sql<boolean>`exists (select 1 from invoice_line il join trip_leg l on l.id = il.trip_leg_id where l.trip_id = ${tr.id})`,
			paid_for: sql<boolean>`exists (select 1 from person_payment_item i where i.trip_id = ${tr.id})`,
			vehicle_id: tr.vehicleId,
			vehicle: v.name,
			vehicle_retired_on: v.retiredOn,
			owner_id: v.ownerId,
			owner: owner.name
		})
		.from(tr)
		.leftJoin(u, eq(u.id, tr.drivenBy))
		.leftJoin(v, eq(v.id, tr.vehicleId))
		.leftJoin(owner, eq(owner.id, v.ownerId))
		.where(eq(tr.id, params.id));
	if (!found) error(404, 'no such trip');

	const [stops, rows] = await Promise.all([
		// Each stop, and who it was for there (0025): two clients at one address
		// are one stop, named by the address.
		db
			.select({
				seq: ts.seq,
				site: si.display,
				street: sql<string | null>`${si.street} || ', ' || ${si.city}`,
				address: ts.address,
				clients: sql<{ name: string; site: string | null; asked_there: boolean }[]>`(
					select coalesce(json_agg(json_build_object('name', ce.name, 'site', cs.label,
					                                           'asked_there', c.asked_there)
					                         order by c.asked_there, ce.name), '[]')
					  from trip_stop_client c
					  join entity ce on ce.id = c.entity_id
					  left join site cs on cs.id = c.site_id
					 where c.trip_stop_id = ${ts.id})`
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
	const [worth, { services, prices, rules, people }, places] = await Promise.all([
		valueLegs(
			db,
			rows.map((l) => ({
				...l,
				travelledOn,
				vehicleId: found.vehicle_id,
				vehicleOwnerId: found.owner_id
			}))
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
		const rate = jobRate(priceOn(prices, l.serviceId, l.entityId, travelledOn), 1);
		alone.set(
			key,
			service && l.roundTripMiles !== null
				? billedAmount(service, rate, Ratio.of(l.roundTripMiles), places)
				: null
		);
	}
	const roundTrips = [...alone.values()].filter((x): x is Decimal => x !== null);

	// What the vehicle was paid: known only when every leg's pay is. The rule is
	// said when one rule paid every leg the owner was paid for.
	const billed = sum(rows.map((l) => worth.get(l.id)?.billed ?? null));
	const pays = rows.map((l) => worth.get(l.id)?.paid ?? null);
	const paid = found.vehicle_id && pays.every((x) => x !== null) ? sum(pays) : null;
	const payee = found.owner_id && {
		id: found.owner_id,
		roleId: people.find((p) => p.id === found.owner_id)?.roleId ?? null
	};
	const used = payee
		? [
				...new Set(
					rows
						.filter((l) => l.serviceId && l.entityId)
						.map((l) => ruleOn(rules, l.serviceId!, payee, l.entityId, 'vehicle', travelledOn))
				)
			]
		: [];
	const rule =
		used.length === 1 && used[0]
			? { pays_for: used[0].paysFor, method: used[0].method, amount: used[0].amount }
			: null;

	const trip = {
		...found,
		miles: sum(rows.map((l) => l.miles)).toFixed(2),
		billed: billed.toFixed(places),
		round_trips: roundTrips.length ? sum(roundTrips).toFixed(places) : null,
		paid: paid?.toFixed(places) ?? null,
		kept: paid ? billed.sub(paid).toFixed(places) : null,
		rule
	};
	const legs = rows.map((l) => ({
		id: l.id,
		seq: l.seq,
		who: l.who,
		rule: l.rule,
		miles: l.miles,
		value: worth.get(l.id)?.billed?.toString() ?? null
	}));

	return { trip, stops, legs, as_of: new Date().toISOString() };
};
