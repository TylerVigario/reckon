/**
 * Timers that are still running.
 *
 * Kept beside the capture queue and for the same reason: a timer starts where
 * there is no reception, so it cannot depend on reaching the server. It also
 * has to survive a refresh -- a timer that a reload silently ends is worse than
 * no timer, because you find out hours later.
 *
 * Several run at once on purpose: one of us can be on a job while the other is
 * on something else, and one phone tracks both.
 *
 * A running timer is not a record. Nothing reaches time_entry until it stops,
 * which is why stopping goes through the same queue as everything else.
 */
const KEY = 'reckon.running';

export type Running = {
	/** Made here, and becomes the entry's client_uuid so a retry cannot double it. */
	id: string;
	/** Epoch ms. Editable, because a timer is often started late. */
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

export function amend(id: string, patch: Partial<Running>): Running[] {
	write(read().map((t) => (t.id === id ? { ...t, ...patch } : t)));
	return running();
}

export function drop(id: string): Running[] {
	write(read().filter((t) => t.id !== id));
	return running();
}

/** Whole minutes elapsed, never zero: a timer that ran at all ran for a minute. */
export function elapsedMinutes(t: Running, now = Date.now()): number {
	return Math.max(1, Math.round((now - t.started_at) / 60_000));
}
