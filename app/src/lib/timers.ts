import { todayIn } from './format.ts';
import type { Entry } from './queue.ts';

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
 */
const KEY = 'reckon.running';

export type Running = {
	/** Made here, and becomes the entry's client_uuid so a retry cannot double it. */
	id: string;
	/** Epoch ms. */
	started_at: number;
	crew: 'one' | 'team';
	worked_by: string | null;
	entity_id: string | null;
	site_id: string | null;
	service_id: string;
	billable: boolean;
	note: string | null;
};

function read(): Running[] {
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

export function start(t: Omit<Running, 'id' | 'started_at'>): Running[] {
	const now = read();
	write([...now, { ...t, id: crypto.randomUUID(), started_at: Date.now() }]);
	return running();
}

export function drop(id: string): Running[] {
	write(read().filter((t) => t.id !== id));
	return running();
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
	write(list.map((t) => (t.id === id ? { ...t, started_at: startedAt } : t)));
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
		created_by: createdBy,
		entity_id: t.entity_id,
		site_id: t.site_id,
		service_id: t.service_id,
		billable: t.billable,
		note: t.note
	};
}
