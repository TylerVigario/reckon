import { error, redirect } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { tripChoices } from '#lib/server/trip-choices.ts';
import { onAnInvoice } from '#lib/server/trip-write.ts';
import { UUID } from '#lib/field-rules.ts';
import { sum } from '#lib/decimal.ts';
import { driveKey, type Place } from '#lib/trip-legs.ts';
import type { TripDraft } from '#lib/trip/draft.ts';
import { resolve } from '$app/paths';
import type { PageServerLoad } from './$types';

/**
 * A saved trip, back in the form as it was saved: its stops and who each was
 * for, each drive's miles as recorded and who it was given to by hand. A trip
 * whose miles are on an invoice is not changed here, and its own screen says so.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	if (!UUID.test(params.id)) error(404, 'No trip with that id.');
	const [trip] = await db.select().from(t.trip).where(eq(t.trip.id, params.id));
	if (!trip) error(404, 'No trip with that id.');
	if (await onAnInvoice(db, params.id)) redirect(303, resolve('/trips/[id]', { id: params.id }));

	const [choices, stops, clients, legs] = await Promise.all([
		tripChoices(locals.user!.id),
		db
			.select({ id: t.tripStop.id, siteId: t.tripStop.siteId, address: t.tripStop.address })
			.from(t.tripStop)
			.where(eq(t.tripStop.tripId, params.id))
			.orderBy(asc(t.tripStop.seq)),
		db
			.select({
				stop: t.tripStopClient.tripStopId,
				entityId: t.tripStopClient.entityId,
				siteId: t.tripStopClient.siteId,
				askedThere: t.tripStopClient.askedThere
			})
			.from(t.tripStopClient)
			.innerJoin(t.tripStop, eq(t.tripStop.id, t.tripStopClient.tripStopId))
			.where(eq(t.tripStop.tripId, params.id)),
		db
			.select({
				to: t.tripLeg.toStopId,
				miles: t.tripLeg.miles,
				rule: t.tripLeg.rule,
				entityId: t.tripLeg.entityId,
				serviceId: t.tripLeg.serviceId
			})
			.from(t.tripLeg)
			.where(eq(t.tripLeg.tripId, params.id))
			.orderBy(asc(t.tripLeg.seq))
	]);

	const places: Place[] = [
		trip.startAddress ? { address: trip.startAddress } : 'base',
		...stops.map((s): Place => (s.siteId ? { site: s.siteId } : { address: s.address ?? '' })),
		trip.endAddress ? { address: trip.endAddress } : 'base'
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
		clientUuid: trip.clientUuid,
		day: trip.travelledOn,
		driver: trip.drivenBy,
		vehicleId: trip.vehicleId,
		serviceId: legs.find((l) => l.serviceId)?.serviceId ?? null,
		startAddress: trip.startAddress,
		endAddress: trip.endAddress,
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
		odometerStart: trip.odometerStart?.replace(/\.0$/, '') ?? '',
		odometerEnd: trip.odometerEnd?.replace(/\.0$/, '') ?? '',
		note: trip.note ?? ''
	};

	// A vehicle retired since is still the one this trip was driven in.
	const vehicles =
		trip.vehicleId && !choices.vehicles.some((v) => v.id === trip.vehicleId)
			? [
					...choices.vehicles,
					...(await db
						.select({
							id: t.vehicle.id,
							name: t.vehicle.name,
							owner_id: t.vehicle.ownerId,
							owner: t.user.name
						})
						.from(t.vehicle)
						.leftJoin(t.user, eq(t.user.id, t.vehicle.ownerId))
						.where(eq(t.vehicle.id, trip.vehicleId)))
				]
			: choices.vehicles;
	return { ...choices, vehicles, draft, id: params.id };
};
