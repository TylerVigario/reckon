import { todayIn } from './format.ts';
import type { Entry } from './queue.ts';
import { currentOwner } from './owner.ts';

/**
 * Timers that are still running.
 *
 * Kept beside the capture queue and for the same reason: a timer starts where
 * there is no reception, so it cannot depend on reaching the server. It also
 * has to survive a refresh -- a timer that a reload silently ends is worse than
 * no timer, because you find out hours later.
 *
 * Several run at once on purpose: one person can be on a job while another is
 * on something else, and one phone tracks both.
 *
 * A running timer is not a record. Nothing reaches time_entry until it stops,
 * and stopping turns it into an entry on the same queue as everything else.
 *
 * Each is its starter's (#lib/owner): only they see it, stop it or move it,
 * whenever they next sign in on this phone, and signing out stops none.
 */
const KEY = 'reckon.running';

export type Running = {
	/** Made here, and becomes the entry's client_uuid so a retry cannot double it. */
	id: string;
	/** Epoch ms. */
	started_at: number;
	crew: 'one' | 'team';
	worked_by: string | null;
	/** Who is on a team timer. Absent on one started before timers named their crew. */
	crew_ids?: string[];
	entity_id: string | null;
	site_id: string | null;
	service_id: string;
	billable: boolean;
	note: string | null;
	/** Who started it (#lib/owner). Absent only on one started before it said. */
	owner?: string;
};

/** Every timer on this phone, whoever's. */
function readAll(): Running[] {
	try {
		const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
		if (!Array.isArray(v)) return [];
		// A timer with no id cannot become an entry, and one with no start
		// cannot be counted -- both would show on screen as a running clock
		// that never stops.
		return v.filter((t): t is Running => {
			if (typeof t !== 'object' || t === null) return false;
			const r = t as Record<string, unknown>;
			return (
				typeof r.id === 'string' &&
				typeof r.started_at === 'number' &&
				(r.crew === 'one' || r.crew === 'team') &&
				typeof r.service_id === 'string'
			);
		});
	} catch {
		return [];
	}
}

/** The signed-in person's timers; none, signed out. */
function read(): Running[] {
	const id = currentOwner();
	return id ? readAll().filter((t) => t.owner === id) : [];
}

/** Writes the signed-in person's timers, keeping everyone else's as they are. */
function writeMine(list: Running[]) {
	const id = currentOwner();
	write([...readAll().filter((t) => t.owner !== id), ...list]);
}

function write(list: Running[]) {
	try {
		localStorage.setItem(KEY, JSON.stringify(list));
	} catch {
		/* a blocked store must not take the running timer down with it */
	}
}

export function running(): Running[] {
	return read().sort((a, b) => a.started_at - b.started_at);
}

export function start(t: Omit<Running, 'id' | 'started_at' | 'owner'>): Running[] {
	const owner = currentOwner();
	if (!owner) throw new Error('Nobody is signed in on this phone to start it for.');
	writeMine([...read(), { ...t, id: crypto.randomUUID(), started_at: Date.now(), owner }]);
	return running();
}

export function drop(id: string): Running[] {
	writeMine(read().filter((t) => t.id !== id));
	return running();
}

/**
 * Timers started before they named their starter are the first person's to
 * sign in here after, as their entries are (#lib/queue claimUnowned).
 */
export function claimUnownedTimers() {
	const id = currentOwner();
	if (!id) return;
	const all = readAll();
	if (all.some((t) => !t.owner)) write(all.map((t) => (t.owner ? t : { ...t, owner: id })));
}

/**
 * A timer set going late -- somebody arrived, dealt with the first thing, and
 * only then remembered it -- started when the work did. Moves its start to
 * `startedAt`, epoch ms, which must be before now; null when it is not, or
 * there is no such timer.
 */
export function moveStart(id: string, startedAt: number, now = Date.now()): Running[] | null {
	if (!(startedAt < now)) return null;
	const list = read();
	if (!list.some((t) => t.id === id)) return null;
	writeMine(list.map((t) => (t.id === id ? { ...t, started_at: startedAt } : t)));
	return running();
}

/**
 * The entry a timer becomes when it stops: the moment it started and the
 * moment it stopped, in the zone the person is in -- their own, the same one
 * the server's "today" uses for them -- dated the day it started, and carrying
 * the timer's own id as its client_uuid, so a stop whose post is retried still
 * records the time once. The server works out how long it ran, to the second.
 */
export function toEntry(t: Running, createdBy: string, zone: string, now = Date.now()): Entry {
	return {
		client_uuid: t.id,
		worked_on: todayIn(zone, t.started_at),
		started_at: new Date(t.started_at).toISOString(),
		ended_at: new Date(Math.max(now, t.started_at + 1)).toISOString(),
		zone,
		crew: t.crew,
		worked_by: t.crew === 'team' ? null : t.worked_by,
		// A copy: a timer on screen is a $state proxy, which IndexedDB will not store.
		...(t.crew === 'team' && t.crew_ids ? { crew_ids: [...t.crew_ids] } : {}),
		created_by: createdBy,
		entity_id: t.entity_id,
		site_id: t.site_id,
		service_id: t.service_id,
		billable: t.billable,
		note: t.note
	};
}
