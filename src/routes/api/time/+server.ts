import { sql } from 'drizzle-orm';
import { asUser } from '#lib/server/db/index.ts';
import { timeEntry, timeEntryCrew } from '#lib/server/db/schema/index.ts';
import {
	pgError,
	refuse as refuseFields,
	refuseIfTheDatabaseSaidSo
} from '#lib/server/field-errors.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readBody } from '#lib/json.ts';
import { log } from '#lib/server/log.ts';
import { GONE, readTimeEntry, TIME_FIELDS } from '#lib/server/time-input.ts';

/**
 * Accepts a time entry from the capture queue.
 *
 * The queue retries on reconnect, so this must be safe to call twice with the
 * same body. client_uuid is generated on the phone and carries a unique index;
 * a repeat returns the row that already exists rather than a conflict.
 *
 * AN ENTRY IS ITS START AND ITS END: two moments and the zone it was worked
 * in. The server works out from them how long it took, to the second, and the
 * day it is dated -- the day it started, where it was worked -- so the phone's
 * figures are for showing and never what is billed. The start is kept to the
 * second, and a part of a second's length is counted whole, so work that took
 * any time took a second.
 *
 * An entry queued before entries kept their times carries minutes and the day
 * instead, and is taken as that length, with no times.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await readBody(request);
	if (!body) return problem('malformed', 400, 'Expected a JSON object.');

	if (typeof body.client_uuid !== 'string')
		return problem('invalidField', 400, 'client_uuid: Required.', {
			errors: { client_uuid: 'Required.' }
		});
	const client_uuid = body.client_uuid;
	const read = await readTimeEntry(body, locals);
	if (!read.ok) return read.refused;
	const e = read.entry;

	const created_by = locals.user!.id;

	let row;
	try {
		[row] = await asUser(created_by, async (tx) => {
			const added = await tx
				.insert(timeEntry)
				.values({
					clientUuid: client_uuid,
					workedOn: e.workedOn,
					seconds: e.seconds,
					startedAt: e.startedAt,
					endedAt: e.endedAt,
					zone: e.zone,
					crew: e.crew,
					workedBy: e.workedBy,
					createdBy: created_by,
					entityId: e.entityId,
					siteId: e.siteId,
					serviceId: e.serviceId,
					billable: e.billable,
					note: e.note
				})
				// A repeat is the row already there, returned as if just written.
				.onConflictDoUpdate({
					target: [timeEntry.createdBy, timeEntry.clientUuid],
					set: { clientUuid: sql`excluded.client_uuid` }
				})
				.returning({
					id: timeEntry.id,
					client_uuid: timeEntry.clientUuid,
					worked_on: timeEntry.workedOn,
					seconds: timeEntry.seconds,
					crew: timeEntry.crew,
					billable: timeEntry.billable
				});
			// The crew, once: a repeat finds it there already.
			if (added[0]?.crew === 'team' && e.crewIds.length)
				await tx
					.insert(timeEntryCrew)
					.values(e.crewIds.map((userId) => ({ timeEntryId: added[0].id, userId })))
					.onConflictDoNothing();
			return added;
		});
	} catch (err) {
		// 42703 is an undefined column -- the shape of this statement being
		// wrong, not the body: a column dropped while this insert still names
		// it makes every entry fail and the queue retry for ever. A 500 is
		// right (the body is fine and will work once the code is), but it is
		// worth naming.
		const pg = pgError(err);
		if (pg.code === '42703')
			log.error(
				{ 'db.response.status_code': pg.code, 'db.collection.name': 'time_entry' },
				'time_entry insert names a column that does not exist'
			);

		// A foreign key: the entry names something that has gone since the
		// phone recorded it -- a service deleted, a site moved to another
		// client. The phone keeps a refused entry and shows this sentence to
		// whoever has to fix it, so it says what is gone, in words.
		const gone = pg.code === '23503' ? GONE[pg.constraint ?? ''] : undefined;
		if (gone) return refuseFields({ [gone[0]]: gone[1] });

		// Any other integrity or data complaint is a 400 too: the body will
		// never satisfy it, and a 500 is what the queue retries.
		const refused = refuseIfTheDatabaseSaidSo(err, TIME_FIELDS, 'time_entry');
		if (refused) return refused;
		throw err;
	}

	return Response.json(row, { status: 200 });
};
