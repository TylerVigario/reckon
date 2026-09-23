import { json } from '@sveltejs/kit';
import { asUser } from '$lib/server/db';
import type { RequestHandler } from './$types';
import { problem } from '$lib/server/problem';
import { readBody } from '$lib/json';

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

	// A boolean, not a truthy value. postgres.js hands the string 'true' to a
	// boolean column as FALSE without complaining, so a queue that sends
	// "billable": "true" would silently record unbillable work.
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
		[row] = await asUser(
			created_by,
			(tx) => tx`
		insert into time_entry (client_uuid, worked_on, minutes, crew, worked_by, created_by,
		                        entity_id, site_id, service_id, billable, note)
		values (${client_uuid}, ${worked_on}, ${minutes}, ${crew}, ${worked_by},
		        ${created_by}, ${entity_id}, ${site_id},
		        ${service_id}, ${billable}, ${note})
		on conflict (client_uuid) do update set client_uuid = excluded.client_uuid
			returning id, client_uuid, worked_on, minutes, crew, billable
		`
		);
	} catch (err) {
		// SQLSTATE class 23 is integrity: a check, a foreign key, a not-null.
		// The body will never satisfy it, so this must be a 400 the queue drops
		// rather than a 500 it retries every thirty seconds for ever.
		// 42703 is an undefined column -- the shape of this statement being
		// wrong, not the body. It reached production once: `location_id` was
		// dropped on 14 Sep and this insert kept naming it, so every entry
		// 500ed and the queue retried for ever. A 500 is right (the body is
		// fine and will work once the code is), but it is worth naming.
		const code = (err as { code?: string }).code ?? '';
		if (code === '42703')
			console.error('time_entry insert names a column that does not exist', (err as Error).message);
		if (code.startsWith('23') || code.startsWith('22'))
			return problem(
				'invalidField',
				400,
				`the database refused this entry: ${(err as Error).message}`
			);
		throw err;
	}

	return json(row, { status: 200 });
};
