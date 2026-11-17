import { error } from '@sveltejs/kit';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { Decimal, Ratio, sum } from '#lib/decimal.ts';
import { db } from '#lib/server/db/index.ts';
import { townsOf } from '#lib/server/trips.ts';
import { loadCatalogue, valueLegs } from '#lib/server/valuation/load.ts';
import { billedAmount, jobRate, priceOn } from '#lib/server/valuation/pricing.ts';
import { ruleOn } from '#lib/server/valuation/pay.ts';
import { moneyPlaces } from '#lib/server/business.ts';
import { UUID } from '#lib/field-rules.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import { refusedForAccess } from '#lib/server/refused.ts';
import { isOfflineCopy } from '#lib/offline-copy.ts';
import type { PageServerLoad } from './$types';

/**
 * One drive, and how its miles were handed to clients.
 *
 * The second tile is the point of the screen: what these legs bill, against
 * what a full round trip each would have billed. On the seeded trip that is
 * the difference between 57 miles and 70.
 *
 * Someone with Field sees a trip they drove (#lib/access), and what its vehicle
 * paid only where the vehicle is theirs: another's pay is theirs to see. What
 * the business kept is not shown them.
 *
 * KEPT FOR NO SIGNAL (#lib/offline-copy), it is the drive -- its stops, its
 * legs and their miles -- to be put right on the road: what it bills, what it
 * pays for the vehicle, and what was kept need a connection.
 */
export const load: PageServerLoad = async ({ params, locals, route, request, url }) => {
	if (!UUID.test(params.id)) error(404, 'no such trip');

	const found = await db
		.selectFrom('trip')
		.leftJoin('user', 'user.id', 'trip.driven_by')
		.leftJoin('vehicle', 'vehicle.id', 'trip.vehicle_id')
		.leftJoin('user as owner', 'owner.id', 'vehicle.owner_id')
		.select((eb) => [
			'trip.id',
			'trip.travelled_on',
			'user.name as driver',
			townsOf(eb.ref('trip.id')).as('stops'),
			'trip.start_address',
			'trip.end_address',
			'trip.note',
			'trip.odometer_start',
			'trip.odometer_end',
			eb
				.exists(
					eb
						.selectFrom('invoice_line as il')
						.innerJoin('trip_leg as l', 'l.id', 'il.trip_leg_id')
						.select(eb.lit(1).as('one'))
						.whereRef('l.trip_id', '=', 'trip.id')
				)
				.$castTo<boolean>()
				.as('invoiced'),
			eb
				.exists(
					eb
						.selectFrom('person_payment_item as i')
						.select(eb.lit(1).as('one'))
						.whereRef('i.trip_id', '=', 'trip.id')
				)
				.$castTo<boolean>()
				.as('paid_for'),
			'trip.vehicle_id',
			'vehicle.name as vehicle',
			'vehicle.retired_on as vehicle_retired_on',
			'vehicle.owner_id',
			'owner.name as owner',
			'trip.driven_by',
			'trip.created_by'
		])
		.where('trip.id', '=', params.id)
		.executeTakeFirst();
	const field = fieldOnly(locals);
	const me = locals.user!.id;
	if (!found) error(404, 'no such trip');
	if (field && found.driven_by !== me) {
		await refusedForAccess({ locals, route, request });
		error(404, 'no such trip');
	}

	const [stops, rows] = await Promise.all([
		// Each stop, and who it was for there (0025): two clients at one address
		// are one stop, named by the address.
		db
			.selectFrom('trip_stop as ts')
			.leftJoin('site as si', 'si.id', 'ts.site_id')
			.select((eb) => [
				'ts.seq',
				'si.display as site',
				eb(eb('si.street', '||', ', '), '||', eb.ref('si.city'))
					.$castTo<string | null>()
					.as('street'),
				'ts.address',
				jsonArrayFrom(
					eb
						.selectFrom('trip_stop_client as c')
						.innerJoin('entity as ce', 'ce.id', 'c.entity_id')
						.leftJoin('site as cs', 'cs.id', 'c.site_id')
						.select(['ce.name', 'cs.label as site', 'c.asked_there'])
						.whereRef('c.trip_stop_id', '=', 'ts.id')
						.orderBy('c.asked_there')
						.orderBy('ce.name')
				).as('clients')
			])
			.where('ts.trip_id', '=', params.id)
			.orderBy('ts.seq')
			.execute(),
		db
			.selectFrom('trip_leg as tl')
			.leftJoin('entity as e', 'e.id', 'tl.entity_id')
			.leftJoin('site as si', 'si.id', 'tl.site_id')
			.select([
				'tl.id',
				'tl.seq',
				'e.name as who',
				'tl.rule',
				'tl.miles',
				'tl.service_id as serviceId',
				'tl.entity_id as entityId',
				'tl.site_id as siteId',
				'si.round_trip_miles as roundTripMiles'
			])
			.where('tl.trip_id', '=', params.id)
			.orderBy('tl.seq')
			.execute()
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

	// Another person's vehicle pay is theirs, not Field's to see.
	const withheld = field && found.owner_id !== null && found.owner_id !== me;
	const { driven_by: _driver, created_by, ...shown } = found;
	const trip = {
		...shown,
		miles: sum(rows.map((l) => l.miles)).toFixed(2),
		billed: billed.toFixed(places),
		round_trips: roundTrips.length ? sum(roundTrips).toFixed(places) : null,
		paid: withheld ? null : (paid?.toFixed(places) ?? null),
		kept: field ? null : paid ? billed.sub(paid).toFixed(places) : null,
		rule: withheld ? null : rule,
		withheld,
		// Whether this person can change it: Field, only one they recorded.
		changeable: !field || created_by === me
	};
	const legs = rows.map((l) => ({
		id: l.id,
		seq: l.seq,
		who: l.who,
		rule: l.rule,
		miles: l.miles,
		value: worth.get(l.id)?.billed?.toString() ?? null
	}));

	if (isOfflineCopy(url))
		return {
			trip: { ...trip, billed: null, round_trips: null, paid: null, kept: null, rule: null },
			stops,
			legs: legs.map((l) => ({ ...l, value: null })),
			offline: true,
			as_of: new Date().toISOString()
		};
	return { trip, stops, legs, offline: false, as_of: new Date().toISOString() };
};
