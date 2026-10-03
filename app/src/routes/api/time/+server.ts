import { sql } from 'drizzle-orm';
import { asUser } from '#lib/server/db/index.ts';
import { timeEntry } from '#lib/server/db/schema/index.ts';
import {
	pgError,
	refuse as refuseFields,
	refuseIfTheDatabaseSaidSo
} from '#lib/server/field-errors.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readBody } from '#lib/json.ts';

/** What the body carries, for a database complaint to be laid against. */
const FIELDS = [
	'client_uuid',
	'worked_on',
	'minutes',
	'crew',
	'worked_by',
	'entity_id',
	'site_id',
	'service_id',
	'billable',
	'note'
];

/** Each foreign key an entry can break, and what it means to the person fixing it. */
const GONE: Record<string, [field: string, why: string]> = {
	time_entry_service_id_fkey: ['service_id', 'That service no longer exists.'],
	time_entry_entity_id_fkey: ['entity_id', 'That client no longer exists.'],
	time_entry_site_id_fkey: ['site_id', 'That site no longer exists.'],
	time_entry_site_is_the_clients: ['site_id', "That site is no longer this client's."],
	time_entry_worked_by_fkey: ['worked_by', 'That person no longer exists.']
};

/**
 * Accepts a time entry from the capture queue.
 *
 * The queue retries on reconnect, so this must be safe to call twice with the
 * same body. client_uuid is generated on the phone and carries a unique index;
 * a repeat returns the row that already exists rather than a conflict.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await readBody(request);
	if (!body) return problem('malformed', 400, 'Expected a JSON object.');

	const refuse = (field: string, why: string) =>
		problem('invalidField', 400, `${field}: ${why}`, { errors: { [field]: why } });

	for (const f of ['client_uuid', 'worked_on', 'minutes', 'crew', 'service_id'])
		if (body[f] === undefined || body[f] === null) return refuse(f, 'Required.');

	// Each of these is checked for its TYPE and not only its presence. The
	// queue is a phone's copy of this contract and can be any version of
	// itself; the database is the last place to find out that a date is not a
	// date, and its complaint arrives as a 500 the queue retries for ever.
	const text = (f: string) => (typeof body[f] === 'string' ? body[f] : null);
	const optionalText = (f: string) => (body[f] === undefined || body[f] === null ? null : text(f));

	const client_uuid = text('client_uuid');
	const worked_on = text('worked_on');
	const service_id = text('service_id');
	for (const [f, v] of [
		['client_uuid', client_uuid],
		['worked_on', worked_on],
		['service_id', service_id]
	] as const)
		if (v === null) return refuse(f, 'Expected text.');

	const minutes = body.minutes;
	if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes <= 0)
		return refuse('minutes', 'A positive whole number of minutes.');

	// crew decides the rate, so it is never implied. The database holds the same
	// rule; this is here to answer with something a person can read.
	const crew = body.crew;
	if (crew !== 'one' && crew !== 'team') return refuse('crew', "One of 'one' or 'team'.");

	const worked_by = optionalText('worked_by');
	if (crew === 'one' && !worked_by) return refuse('worked_by', 'Who worked it.');
	if (crew === 'team' && worked_by)
		return refuse('worked_by', 'Leave this empty for a team entry.');

	// A boolean, not a truthy value: a queue that sends "billable": "false" is
	// told so, rather than having a non-empty string read as yes.
	if (body.billable !== undefined && typeof body.billable !== 'boolean')
		return refuse('billable', 'True or false.');
	const billable = body.billable ?? true;

	const entity_id = optionalText('entity_id');
	if (billable && !entity_id) return refuse('entity_id', 'Who is paying.');
	const site_id = optionalText('site_id');
	const note = optionalText('note');

	// Never from the body: the queue is written on a phone and a client cannot
	// be trusted to say who it is.
	const created_by = locals.user!.id;

	let row;
	try {
		[row] = await asUser(created_by, (tx) =>
			tx
				.insert(timeEntry)
				.values({
					clientUuid: client_uuid!,
					workedOn: worked_on!,
					minutes,
					crew,
					workedBy: worked_by,
					createdBy: created_by,
					entityId: entity_id,
					siteId: site_id,
					serviceId: service_id!,
					billable: billable,
					note
				})
				// A repeat is the row already there, returned as if just written.
				.onConflictDoUpdate({
					target: timeEntry.clientUuid,
					set: { clientUuid: sql`excluded.client_uuid` }
				})
				.returning({
					id: timeEntry.id,
					client_uuid: timeEntry.clientUuid,
					worked_on: timeEntry.workedOn,
					minutes: timeEntry.minutes,
					crew: timeEntry.crew,
					billable: timeEntry.billable
				})
		);
	} catch (err) {
		// 42703 is an undefined column -- the shape of this statement being
		// wrong, not the body: a column dropped while this insert still names
		// it makes every entry fail and the queue retry for ever. A 500 is
		// right (the body is fine and will work once the code is), but it is
		// worth naming.
		const pg = pgError(err);
		if (pg.code === '42703')
			console.error('time_entry insert names a column that does not exist', pg.message);

		// A foreign key: the entry names something that has gone since the
		// phone recorded it -- a service deleted, a site moved to another
		// client. The phone keeps a refused entry and shows this sentence to
		// whoever has to fix it, so it says what is gone, in words.
		const gone = pg.code === '23503' ? GONE[pg.constraint ?? ''] : undefined;
		if (gone) return refuseFields({ [gone[0]]: gone[1] });

		// Any other integrity or data complaint is a 400 too: the body will
		// never satisfy it, and a 500 is what the queue retries.
		const refused = refuseIfTheDatabaseSaidSo(err, FIELDS, 'time_entry');
		if (refused) return refused;
		throw err;
	}

	return Response.json(row, { status: 200 });
};
