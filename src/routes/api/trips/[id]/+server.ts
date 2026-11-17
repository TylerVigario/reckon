import { asUser, db } from '#lib/server/db/index.ts';
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
import { fieldOnly } from '#lib/server/mine.ts';
import type { RequestHandler } from './$types';

/**
 * Changes a saved trip: everything about it, sent whole as the form sends a new
 * one, its legs worked out again by #lib/trip-legs and its stops and legs
 * replaced. Not once any of its miles are on an invoice: then it is as billed,
 * and a correction goes through the invoice. Someone with Field changes only a
 * trip they drove and recorded, and it stays theirs (#lib/access).
 */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No trip with that id.');
	const read = readTrip(await readBody(request));
	if (!read.ok) return refuse(read.errors);
	const trip = read.trip;
	const field = fieldOnly(locals);
	const me = locals.user!.id;
	if (field && trip.drivenBy !== me)
		return refuse({ driven_by: "A trip you drove. Someone with Full records anyone else's." });
	const worked = await legsFor(trip);
	if ('refused' in worked) return worked.refused;

	try {
		const outcome = await asUser(locals.user!.id, async (tx) => {
			// Held while it changes, so a line drawn from it cannot slip in between.
			const held = await tx
				.selectFrom('trip')
				.select(['id', 'driven_by as drivenBy', 'created_by as createdBy'])
				.where('id', '=', params.id)
				.forUpdate()
				.executeTakeFirst();
			if (!held || (field && held.drivenBy !== me)) return 'gone' as const;
			if (field && held.createdBy !== me) return 'notYours' as const;
			const done = await settled(tx, params.id);
			if (done) return done;
			await tx.updateTable('trip').set(tripColumns(trip)).where('id', '=', params.id).execute();
			await tx.deleteFrom('trip_leg').where('trip_id', '=', params.id).execute();
			await tx.deleteFrom('trip_stop').where('trip_id', '=', params.id).execute();
			await writeStops(tx, params.id, trip, worked.legs, worked.serviceId);
			return 'changed' as const;
		});
		if (outcome === 'gone') return problem('notFound', 404, 'No trip with that id.');
		if (outcome === 'notYours')
			return problem('notYours', 403, 'Whoever recorded it, or someone with Full, changes it.');
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
 * Someone with Field removes only a trip they recorded.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No trip with that id.');
	if (fieldOnly(locals)) {
		const had = await db
			.selectFrom('trip')
			.select(['driven_by as drivenBy', 'created_by as createdBy'])
			.where('id', '=', params.id)
			.executeTakeFirst();
		if (!had || had.drivenBy !== locals.user!.id)
			return problem('notFound', 404, 'No trip with that id.');
		if (had.createdBy !== locals.user!.id)
			return problem('notYours', 403, 'Whoever recorded it, or someone with Full, removes it.');
	}
	const done = await settled(db, params.id);
	if (done) return problem('conflict', 409, SETTLED[done]);
	try {
		const gone = await asUser(locals.user!.id, (tx) =>
			tx.deleteFrom('trip').where('id', '=', params.id).returning('id').execute()
		);
		if (gone.length === 0) return problem('notFound', 404, 'No trip with that id.');
	} catch (e) {
		// Settled between the question and the delete.
		if (stillReferenced(e)) return problem('conflict', 409, SETTLED.billed);
		throw e;
	}
	return Response.json({ removed: params.id });
};
