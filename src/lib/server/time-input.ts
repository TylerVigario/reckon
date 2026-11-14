import { serviceNamed } from '#lib/server/named.ts';
import { problem } from './problem.ts';
import { knownZone } from './zones.ts';
import { UUID } from '#lib/field-rules.ts';
import { theTeam } from './choices.ts';
import { fieldOnly } from './mine.ts';

/**
 * A time entry as a phone or a form sends it, read and checked before anything
 * is written -- for one added (POST /api/time) and one changed (PATCH
 * /api/time/:id), so both are held to the same rules. Every refusal names the
 * field it is about, in words a person can act on.
 *
 * Each field is checked for its TYPE and not only its presence. The queue is a
 * phone's copy of this contract and can be any version of itself; the database
 * is the last place to find out that a date is not a date, and its complaint
 * arrives as a 500 the queue retries for ever.
 */
export type TimeInput = {
	workedOn: string;
	seconds: number;
	startedAt: Date | null;
	endedAt: Date | null;
	zone: string | null;
	crew: 'one' | 'team';
	workedBy: string | null;
	/** Who was on a team entry; empty for one person's. */
	crewIds: string[];
	entityId: string | null;
	siteId: string | null;
	serviceId: string;
	billable: boolean;
	note: string | null;
};

/** The fields a time entry is sent with, in the words a refusal names them by. */
export const TIME_FIELDS = [
	'client_uuid',
	'worked_on',
	'started_at',
	'ended_at',
	'zone',
	'minutes',
	'crew',
	'worked_by',
	'crew_ids',
	'entity_id',
	'site_id',
	'service_id',
	'billable',
	'note'
];

/** A reference to something deleted meanwhile, as the field it was and why. */
export const GONE: Record<string, [field: string, why: string]> = {
	time_entry_service_id_fkey: ['service_id', 'That service no longer exists.'],
	time_entry_entity_id_fkey: ['entity_id', 'That client no longer exists.'],
	time_entry_site_id_fkey: ['site_id', 'That site no longer exists.'],
	time_entry_site_is_the_clients: ['site_id', "That site is no longer this client's."],
	time_entry_worked_by_fkey: ['worked_by', 'That person no longer exists.'],
	time_entry_crew_user_id_fkey: ['crew_ids', 'Somebody on the crew no longer exists.']
};

/** A refusal naming its field. */
const refuse = (field: string, why: string) =>
	problem('invalidField', 400, `${field}: ${why}`, { errors: { [field]: why } });

/**
 * Reads a time entry from `body`, for the person signed in: the entry, or the
 * refusal to answer with. Someone with Field records only work they were on --
 * their own, or a team's with them on it.
 */
export async function readTimeEntry(
	body: Record<string, unknown>,
	locals: App.Locals
): Promise<{ ok: true; entry: TimeInput } | { ok: false; refused: Response }> {
	const no = (field: string, why: string) => ({ ok: false as const, refused: refuse(field, why) });

	const timed = body.started_at !== undefined && body.started_at !== null;
	for (const f of [
		...(timed ? ['ended_at', 'zone'] : ['worked_on', 'minutes']),
		'crew',
		'service_id'
	])
		if (body[f] === undefined || body[f] === null) return no(f, 'Required.');

	const text = (f: string) => (typeof body[f] === 'string' ? body[f] : null);
	const optionalText = (f: string) => (body[f] === undefined || body[f] === null ? null : text(f));

	const named = text('service_id');
	if (named === null) return no('service_id', 'Expected text.');
	// By its id, or by the uuid a phone made for one added there (#lib/server/named).
	const serviceId = await serviceNamed(named);

	let length: Pick<TimeInput, 'workedOn' | 'seconds' | 'startedAt' | 'endedAt' | 'zone'>;
	if (timed) {
		const zone = typeof body.zone === 'string' ? await knownZone(body.zone) : null;
		if (zone === null) return no('zone', 'Not a time zone.');
		const moment = (f: string) => {
			try {
				return Temporal.Instant.from(text(f) ?? '');
			} catch {
				return null;
			}
		};
		const from = moment('started_at');
		if (from === null) return no('started_at', 'A moment, such as 2026-10-04T16:05:00Z.');
		const to = moment('ended_at');
		if (to === null) return no('ended_at', 'A moment, such as 2026-10-04T18:45:00Z.');
		const took = from.until(to).total('milliseconds');
		if (took <= 0) return no('ended_at', 'It ends before it starts.');
		// To the second: the start as it was, the length rounded up, so a timer
		// stopped within a second of starting is still a second's work.
		const started = from.round({ smallestUnit: 'second', roundingMode: 'floor' });
		const seconds = Math.ceil(took / 1000);
		const ended = started.add({ seconds });
		length = {
			workedOn: started.toZonedDateTimeISO(zone).toPlainDate().toString(),
			seconds,
			startedAt: new Date(started.epochMilliseconds),
			endedAt: new Date(ended.epochMilliseconds),
			zone
		};
	} else {
		const workedOn = text('worked_on');
		if (workedOn === null) return no('worked_on', 'Expected text.');
		const minutes = body.minutes;
		if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes <= 0)
			return no('minutes', 'A positive whole number of minutes.');
		length = { workedOn, seconds: minutes * 60, startedAt: null, endedAt: null, zone: null };
	}

	const crew = body.crew;
	if (crew !== 'one' && crew !== 'team') return no('crew', "One of 'one' or 'team'.");

	const workedBy = optionalText('worked_by');
	if (crew === 'one' && !workedBy) return no('worked_by', 'Who worked it.');
	if (crew === 'team' && workedBy) return no('worked_by', 'Leave this empty for a team entry.');
	let crewIds: string[] = [];
	if (crew === 'team') {
		if (body.crew_ids === undefined || body.crew_ids === null)
			crewIds = (await theTeam()).map((p) => p.id);
		else if (
			!Array.isArray(body.crew_ids) ||
			!body.crew_ids.every((x): x is string => typeof x === 'string' && UUID.test(x))
		)
			return no('crew_ids', 'Who was on it, by their ids.');
		else {
			crewIds = [...new Set(body.crew_ids)];
			if (crewIds.length < 2)
				return no('crew_ids', 'A team is two or more. One person is an entry of their own.');
		}
	} else if (body.crew_ids !== undefined && body.crew_ids !== null)
		return no('crew_ids', "Leave this empty for one person's entry.");

	if (fieldOnly(locals)) {
		const me = locals.user!.id;
		if (crew === 'one' && workedBy !== me)
			return no('worked_by', "Your own work. Someone with Full enters anyone else's.");
		if (crew === 'team' && !crewIds.includes(me))
			return no('crew_ids', 'A team you were on. Someone with Full enters any other.');
	}

	if (body.billable !== undefined && typeof body.billable !== 'boolean')
		return no('billable', 'True or false.');
	const billable = body.billable ?? true;

	const entityId = optionalText('entity_id');
	if (billable && !entityId) return no('entity_id', 'Who is paying.');

	return {
		ok: true,
		entry: {
			...length,
			crew,
			workedBy,
			crewIds,
			entityId,
			siteId: optionalText('site_id'),
			serviceId,
			billable,
			note: optionalText('note')
		}
	};
}
