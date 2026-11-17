import { monthOf } from '#lib/format.ts';
import { sum } from '#lib/decimal.ts';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { townsOf } from '#lib/server/trips.ts';
import { loadCatalogue, valueLegs } from '#lib/server/valuation/load.ts';
import { jobRate, priceOn } from '#lib/server/valuation/pricing.ts';
import { moneyPlaces } from '#lib/server/business.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import { keptTrips } from '#lib/server/kept.ts';
import { isOfflineCopy } from '#lib/offline-copy.ts';
import type { PageServerLoad } from './$types';

/**
 * Trips for a month, billed or not.
 *
 * A trip is one drive, and its legs are its miles, each handed to the client
 * that caused it -- which is what stops two nearby sites being charged a full
 * round trip each (on the seeded trip, 70 miles for 57 driven). "Every mile
 * assigned" means no leg is left without a client. Someone with Field sees the
 * trips they drove (#lib/access).
 *
 * KEPT FOR NO SIGNAL (#lib/offline-copy), it is the trips the person drove that
 * can still be put right (#lib/server/kept), Full's own too, and nothing of
 * what they bill: older ones, billed ones and anyone else's need a connection.
 */
export const load: PageServerLoad = async ({ url, locals }) => {
	const offline = isOfflineCopy(url);
	const asked = url.searchParams.get('month') ?? '';
	const day = businessToday();
	const from = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? `${asked}-01` : `${day.slice(0, 8)}01`;
	const to = Temporal.PlainDate.from(from).add({ months: 1 }).toString();

	const me = locals.user!.id;
	const field = fieldOnly(locals);

	const found = await db
		.selectFrom('trip')
		.leftJoin('user', 'user.id', 'trip.driven_by')
		.leftJoin('vehicle', 'vehicle.id', 'trip.vehicle_id')
		.select((eb) => [
			'trip.id',
			'trip.travelled_on',
			'user.name as driver',
			'vehicle.name as vehicle',
			townsOf(eb.ref('trip.id')).as('stops'),
			eb
				.selectFrom('trip_stop')
				.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
				.whereRef('trip_stop.trip_id', '=', 'trip.id')
				.$asScalar()
				.$notNull()
				.as('stop_count'),
			eb
				.selectFrom('trip_leg')
				.innerJoin('entity', 'entity.id', 'trip_leg.entity_id')
				.select((eb) =>
					eb.fn
						.agg<string | null>('string_agg', ['entity.name', eb.val(' then ')])
						.distinct()
						.orderBy('entity.name')
						.as('names')
				)
				.whereRef('trip_leg.trip_id', '=', 'trip.id')
				.$asScalar()
				.as('clients')
		])
		.where((eb) =>
			offline
				? keptTrips(eb, me, day)
				: eb.and([
						eb('trip.travelled_on', '>=', from),
						eb('trip.travelled_on', '<', to),
						...(field ? [eb('trip.driven_by', '=', me)] : [])
					])
		)
		.orderBy('trip.travelled_on', 'desc')
		.orderBy('trip.id', 'desc')
		.execute();

	const legs = found.length
		? await db
				.selectFrom('trip_leg')
				.innerJoin('trip', 'trip.id', 'trip_leg.trip_id')
				.leftJoin('invoice_line', 'invoice_line.trip_leg_id', 'trip_leg.id')
				.select((eb) => [
					'trip_leg.id',
					'trip_leg.trip_id as tripId',
					'trip_leg.service_id as serviceId',
					'trip_leg.entity_id as entityId',
					'trip_leg.miles',
					'trip.travelled_on as travelledOn',
					eb('invoice_line.invoice_id', 'is not', null).$castTo<boolean>().as('invoiced')
				])
				.where('trip_leg.trip_id', '=', (eb) => eb.fn.any(eb.val(found.map((f) => f.id))))
				.execute()
		: [];
	const [worth, catalogue, places] = await Promise.all([
		valueLegs(db, legs),
		loadCatalogue(db),
		moneyPlaces()
	]);

	const trips = found.map((f) => {
		const mine = legs.filter((l) => l.tripId === f.id);
		const theirs = mine.filter((l) => l.entityId !== null);
		const miles = sum(mine.map((l) => l.miles));
		const assigned = sum(theirs.map((l) => l.miles));
		return {
			...f,
			legs: mine.length,
			miles: miles.toFixed(2),
			assigned: assigned.toFixed(2),
			// Each leg at its own service's price on the day; none in the copy kept
			// for no signal.
			value: offline ? null : sum(mine.map((l) => worth.get(l.id)?.billed ?? null)).toFixed(places),
			billed: theirs.length > 0 && theirs.every((l) => l.invoiced),
			// Whether every mile driven is some client's.
			balanced: assigned.eq(miles)
		};
	});

	// "The" mileage rate only while one service is charged per mile. With two,
	// a leg's own service says which, and a headline figure would be one of
	// them passed off as both.
	const perMile = (
		await db
			.selectFrom('service')
			.select('id')
			.where('unit', '=', 'mile')
			.where('active', '=', true)
			.execute()
	).map((s) => s.id);
	const rate =
		perMile.length === 1 ? jobRate(priceOn(catalogue.prices, perMile[0], null, day), 1) : null;

	return {
		unbilled: trips.filter((x) => !x.billed),
		billed: trips.filter((x) => x.billed),
		as_of: new Date().toISOString(),
		offline,
		totals: {
			month: offline ? null : monthOf(from),
			miles: sum(legs.map((l) => l.miles)).toFixed(2),
			trips: String(found.length),
			rate: offline ? null : (rate?.toString() ?? null),
			// The service the rate is the price of, which the rate opens.
			rate_of: rate !== null ? perMile[0] : null
		}
	};
};
