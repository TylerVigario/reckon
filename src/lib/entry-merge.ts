import type { EntryFields } from './entry-form.ts';

/**
 * A CHANGE TO A TIME ENTRY MADE ON A PHONE, MERGED with what the server has,
 * against what the entry was when the change began (its base): the three-way
 * merge #lib/line-merge makes for a line.
 *
 *   a part only the phone changed       takes the phone's
 *   a part only the server changed      keeps the server's
 *   a part both changed to one value    has it
 *   a part both changed differently     collides, and a person picks
 *
 * An entry is merged by the PARTS its form asks as one answer, not field by
 * field: when it was worked is its start, its end and its zone (or a day and a
 * length) together, who worked it is one person or a team and who was on it,
 * and a site is one of its client's. A start from one side and an end from the
 * other would be an entry nobody recorded.
 */
export const ENTRY_PARTS = ['when', 'who', 'where', 'service', 'billable', 'note'] as const;
export type EntryPart = (typeof ENTRY_PARTS)[number];

/** The fields each part is made of, as the form sends them (#lib/EntryForm). */
const FIELDS: Record<EntryPart, readonly (keyof EntryFields)[]> = {
	when: ['worked_on', 'started_at', 'ended_at', 'zone', 'minutes'],
	who: ['crew', 'worked_by', 'crew_ids'],
	where: ['entity_id', 'site_id'],
	service: ['service_id'],
	billable: ['billable'],
	note: ['note']
};

const moment = (v: string | undefined) => (v ? Date.parse(v) : null);

/** One part of an entry, written so two that mean the same are equal. */
function valueOf(part: EntryPart, f: EntryFields): string {
	switch (part) {
		case 'when':
			return JSON.stringify(
				f.started_at
					? [moment(f.started_at), moment(f.ended_at), f.zone ?? null]
					: [f.worked_on, f.minutes ?? null]
			);
		case 'who':
			return JSON.stringify(
				f.crew === 'team' ? ['team', [...(f.crew_ids ?? [])].sort()] : ['one', f.worked_by]
			);
		case 'where':
			return JSON.stringify([f.entity_id ?? null, f.site_id ?? null]);
		case 'service':
			return f.service_id;
		case 'billable':
			return String(f.billable ?? true);
		case 'note':
			return (f.note ?? '').trim();
	}
}

/** Whether two entries say the same of one part. */
export const samePart = (part: EntryPart, a: EntryFields, b: EntryFields) =>
	valueOf(part, a) === valueOf(part, b);

/** `into` with one part taken from `from`: every field of it, and none it lacks. */
export function withPart(part: EntryPart, into: EntryFields, from: EntryFields): EntryFields {
	const out: Record<string, unknown> = { ...into };
	for (const k of FIELDS[part]) {
		if (from[k] === undefined) delete out[k];
		else out[k] = from[k];
	}
	return out as EntryFields;
}

export type EntryMerge = {
	/** The entry once merged: what to save, but for what collided, left as the server has it. */
	fields: EntryFields;
	/** Who each part that moved was taken from. */
	from: Partial<Record<EntryPart, 'phone' | 'server'>>;
	/** The parts both changed differently. */
	collided: EntryPart[];
};

export function mergeEntry(base: EntryFields, phone: EntryFields, server: EntryFields): EntryMerge {
	let fields = server;
	const from: EntryMerge['from'] = {};
	const collided: EntryPart[] = [];
	for (const p of ENTRY_PARTS) {
		const phoneMoved = !samePart(p, phone, base);
		const serverMoved = !samePart(p, server, base);
		if (phoneMoved && serverMoved && !samePart(p, phone, server)) collided.push(p);
		else if (phoneMoved) {
			fields = withPart(p, fields, phone);
			from[p] = 'phone';
		} else if (serverMoved) from[p] = 'server';
	}
	return { fields, from, collided };
}

/**
 * WHAT A CHANGE TO AN ENTRY MADE ON A PHONE RAN INTO, as the server says it and
 * the phone keeps it until a person decides (#lib/queue), as #lib/line-conflict
 * is for a line.
 *
 *   collided  a part both changed differently: the entry as the server has it
 *             now and the save it is at, so a pick is made against that; the
 *             phone has what both began from, and its own.
 *   removed   the entry was removed meanwhile: add it again with the change,
 *             or let the change go.
 *   changed   an entry removed on the phone was changed meanwhile: remove it
 *             anyway, or keep it.
 */
export type EntryConflict =
	| {
			what: 'collided';
			version: number;
			server: EntryFields;
			collided: EntryPart[];
			from: EntryMerge['from'];
			/** Who last changed it on the server, and when. */
			by: string | null;
			at: string | null;
	  }
	| { what: 'removed'; by: string | null; at: string }
	| { what: 'changed'; by: string | null; at: string | null };

/**
 * An entry as its form sends it, from what the server keeps: what a change
 * from the phone is merged against. One recorded as a length alone is its day
 * and its minutes; a team's names who was on it.
 */
export function fieldsOfEntry(e: {
	worked_on: string;
	seconds: number;
	started_at: string | null;
	ended_at: string | null;
	zone: string | null;
	crew: 'one' | 'team';
	worked_by: string | null;
	crew_ids: string[];
	entity_id: string | null;
	site_id: string | null;
	service_id: string;
	billable: boolean;
	note: string | null;
}): EntryFields {
	return {
		worked_on: e.worked_on,
		...(e.started_at && e.ended_at && e.zone
			? { started_at: e.started_at, ended_at: e.ended_at, zone: e.zone }
			: { minutes: Math.round(e.seconds / 60) }),
		crew: e.crew,
		worked_by: e.crew === 'team' ? null : e.worked_by,
		...(e.crew === 'team' ? { crew_ids: [...e.crew_ids].sort() } : {}),
		entity_id: e.entity_id,
		site_id: e.site_id,
		service_id: e.service_id,
		billable: e.billable,
		note: e.note
	};
}
