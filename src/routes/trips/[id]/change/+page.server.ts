import { error, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { tripChoices } from '#lib/server/trip-choices.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import { settled } from '#lib/server/trip-write.ts';
import { UUID } from '#lib/field-rules.ts';
import { sum } from '#lib/decimal.ts';
import { driveKey, type Place } from '#lib/trip-legs.ts';
import type { TripDraft } from '#lib/trip/draft.ts';
import { resolve } from '$app/paths';
import { refusedForAccess } from '#lib/server/refused.ts';
import type { PageServerLoad } from './$types';

/**
 * A saved trip, back in the form as it was saved: its stops and who each was
 * for, each drive's miles as recorded and who it was given to by hand. A trip
 * whose miles are billed or paid is not changed here, and its own screen says so.
 * Someone with Field changes only a trip they drove and recorded (#lib/access).
 */
export const load: PageServerLoad = async ({ params, locals, route, request }) => {
	if (!UUID.test(params.id)) error(404, 'No trip with that id.');
	const trip = await db
		.selectFrom('trip')
		.selectAll()
		.where('id', '=', params.id)
		.executeTakeFirst();
	const field = fieldOnly(locals);
	const me = locals.user!.id;
	if (!trip) error(404, 'No trip with that id.');
	if (field && trip.driven_by !== me) {
		await refusedForAccess({ locals, route, request });
		error(404, 'No trip with that id.');
	}
	if (field && trip.created_by !== me) redirect(303, resolve('/trips/[id]', { id: params.id }));
	if (await settled(db, params.id)) redirect(303, resolve('/trips/[id]', { id: params.id }));

	const [choices, stops, clients, legs] = await Promise.all([
		tripChoices(me, field),
		db
			.selectFrom('trip_stop')
			.select(['id', 'site_id as siteId', 'address'])
			.where('trip_id', '=', params.id)
			.orderBy('seq')
			.execute(),
		db
			.selectFrom('trip_stop_client')
			.innerJoin('trip_stop', 'trip_stop.id', 'trip_stop_client.trip_stop_id')
			.select([
				'trip_stop_client.trip_stop_id as stop',
				'trip_stop_client.entity_id as entityId',
				'trip_stop_client.site_id as siteId',
				'trip_stop_client.asked_there as askedThere'
			])
			.where('trip_stop.trip_id', '=', params.id)
			.execute(),
		db
			.selectFrom('trip_leg')
			.select([
				'to_stop_id as to',
				'miles',
				'rule',
				'entity_id as entityId',
				'service_id as serviceId'
			])
			.where('trip_id', '=', params.id)
			.orderBy('seq')
			.execute()
	]);

	const places: Place[] = [
		trip.start_address ? { address: trip.start_address } : 'base',
		...stops.map((s): Place => (s.siteId ? { site: s.siteId } : { address: s.address ?? '' })),
		trip.end_address ? { address: trip.end_address } : 'base'
	];
	// Each drive's legs: those to its stop, and those with none for the way back.
	// A trip recorded before legs named their stop has none to go by, and its
	// drives start as a new trip's would.
	const typed: Record<string, string> = {};
	const given: Record<string, string[]> = {};
	if (legs.some((l) => l.to !== null))
		places.slice(1).forEach((to, i) => {
			const mine = legs.filter((l) => l.to === (i < stops.length ? stops[i].id : null));
			if (!mine.length) return;
			const key = driveKey(places[i], to);
			typed[key] = sum(mine.map((l) => l.miles))
				.toFixed(2)
				.replace(/\.?0+$/, '');
			if (mine.every((l) => l.rule === 'chosen'))
				given[key] = mine.flatMap((l) => (l.entityId ? [l.entityId] : []));
		});

	const draft: TripDraft = {
		clientUuid: trip.client_uuid,
		day: trip.travelled_on,
		driver: trip.driven_by,
		vehicleId: trip.vehicle_id,
		serviceId: legs.find((l) => l.serviceId)?.serviceId ?? null,
		startAddress: trip.start_address,
		endAddress: trip.end_address,
		stops: stops.map((s) => ({
			key: s.id,
			siteId: s.siteId,
			address: s.address,
			visits: clients
				.filter((c) => c.stop === s.id)
				.map((c) => ({ entityId: c.entityId, siteId: c.siteId, askedThere: c.askedThere }))
		})),
		typed,
		given,
		// As it was read: 48213, not the 48213.0 a tenth's column gives back.
		odometerStart: trip.odometer_start?.replace(/\.0$/, '') ?? '',
		odometerEnd: trip.odometer_end?.replace(/\.0$/, '') ?? '',
		note: trip.note ?? ''
	};

	// A vehicle retired since is still the one this trip was driven in.
	const vehicles =
		trip.vehicle_id && !choices.vehicles.some((v) => v.id === trip.vehicle_id)
			? [
					...choices.vehicles,
					...(await db
						.selectFrom('vehicle')
						.leftJoin('user', 'user.id', 'vehicle.owner_id')
						.select(['vehicle.id', 'vehicle.name', 'vehicle.owner_id', 'user.name as owner'])
						.where('vehicle.id', '=', trip.vehicle_id)
						.execute())
				]
			: choices.vehicles;
	return { ...choices, vehicles, draft, id: params.id };
};
