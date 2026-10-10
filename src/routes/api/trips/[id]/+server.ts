import { eq } from 'drizzle-orm';
import { asUser, db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { refuse, stillReferenced } from '#lib/server/field-errors.ts';
import { readTrip } from '#lib/server/trip-input.ts';
import {
	legsFor,
	refuseTrip,
	settled,
	SETTLED,
	tripColumns,
	writeStops
} from '#lib/server/trip-write.ts';
import { UUID } from '#lib/field-rules.ts';
import { readBody } from '#lib/json.ts';
import { problem } from '#lib/server/problem.ts';
import type { RequestHandler } from './$types';

/**
 * Changes a saved trip: everything about it, sent whole as the form sends a new
 * one, its legs worked out again by #lib/trip-legs and its stops and legs
 * replaced. Not once any of its miles are on an invoice: then it is as billed,
 * and a correction goes through the invoice.
 */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No trip with that id.');
	const read = readTrip(await readBody(request));
	if (!read.ok) return refuse(read.errors);
	const trip = read.trip;
	const worked = await legsFor(trip);
	if ('refused' in worked) return worked.refused;

	try {
		const outcome = await asUser(locals.user!.id, async (tx) => {
			// Held while it changes, so a line drawn from it cannot slip in between.
			const [held] = await tx
				.select({ id: t.trip.id })
				.from(t.trip)
				.where(eq(t.trip.id, params.id))
				.for('update');
			if (!held) return 'gone' as const;
			const done = await settled(tx, params.id);
			if (done) return done;
			await tx.update(t.trip).set(tripColumns(trip)).where(eq(t.trip.id, params.id));
			await tx.delete(t.tripLeg).where(eq(t.tripLeg.tripId, params.id));
			await tx.delete(t.tripStop).where(eq(t.tripStop.tripId, params.id));
			await writeStops(tx, params.id, trip, worked.legs, worked.serviceId);
			return 'changed' as const;
		});
		if (outcome === 'gone') return problem('notFound', 404, 'No trip with that id.');
		if (outcome !== 'changed') return problem('conflict', 409, SETTLED[outcome]);
		return Response.json({ id: params.id });
	} catch (err) {
		const refused = refuseTrip(err);
		if (refused) return refused;
		throw err;
	}
};

/**
 * Removes a trip recorded wrongly, with its stops and legs. One whose miles are
 * on an invoice stays: the schema refuses to take a billed line's leg from it.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No trip with that id.');
	const done = await settled(db, params.id);
	if (done) return problem('conflict', 409, SETTLED[done]);
	try {
		const gone = await asUser(locals.user!.id, (tx) =>
			tx.delete(t.trip).where(eq(t.trip.id, params.id)).returning({ id: t.trip.id })
		);
		if (gone.length === 0) return problem('notFound', 404, 'No trip with that id.');
	} catch (e) {
		// Settled between the question and the delete.
		if (stillReferenced(e)) return problem('conflict', 409, SETTLED.billed);
		throw e;
	}
	return Response.json({ removed: params.id });
};
