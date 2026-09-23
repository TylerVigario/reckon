/**
 * The capture queue.
 *
 * Time is recorded in metal-roofed farm stores and restaurant back-of-house
 * where reception is bad, and the server itself sits at one of those addresses.
 * So an entry is written locally first and posted when there is a connection.
 *
 * This is a queue, not a sync engine. One table, two people, nobody editing the
 * same row: there is nothing to reconcile. Every entry carries a client_uuid
 * made here, so a retry after a timeout cannot enter the hour twice.
 */
const KEY = 'reckon.queue';

export type Entry = {
	client_uuid: string;
	worked_on: string;
	minutes: number;
	crew: 'one' | 'team';
	/** Null on a team entry: the team worked it, so no one name is right. */
	worked_by: string | null;
	created_by: string;
	entity_id?: string | null;
	site_id?: string | null;
	service_id: string;
	billable?: boolean;
	note?: string | null;
};

function read(): Entry[] {
	try {
		const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
		if (!Array.isArray(v)) return [];
		// Every entry must still carry what makes it postable and what makes a
		// retry safe. One unreadable row is dropped rather than taking the
		// queue down with it -- the rest are still somebody's recorded hours.
		return v.filter((e): e is Entry => {
			if (typeof e !== 'object' || e === null) return false;
			const r = e as Record<string, unknown>;
			return (
				typeof r.client_uuid === 'string' &&
				typeof r.worked_on === 'string' &&
				typeof r.minutes === 'number' &&
				(r.crew === 'one' || r.crew === 'team') &&
				typeof r.service_id === 'string' &&
				typeof r.created_by === 'string'
			);
		});
	} catch {
		return [];
	}
}

function write(q: Entry[]) {
	try {
		localStorage.setItem(KEY, JSON.stringify(q));
	} catch {
		/* a full or blocked store must not lose the entry in hand */
	}
}

export function pending(): number {
	return read().length;
}

export function enqueue(e: Entry) {
	write([...read(), e]);
}

/** Post everything queued. Anything that fails stays queued for the next try. */
export async function flush(): Promise<{ sent: number; left: number }> {
	const q = read();
	if (!q.length) return { sent: 0, left: 0 };

	const left: Entry[] = [];
	let sent = 0;
	for (const e of q) {
		try {
			const r = await fetch('/api/time', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(e)
			});
			// 4xx means the server will never accept it, so keeping it would
			// retry forever. 401 and 403 are the exception: the entry is fine
			// and the session is not, so dropping them would destroy hours
			// recorded somewhere with no signal. 5xx and network failures are
			// worth another go too.
			if (r.ok) sent++;
			else if (r.status === 401 || r.status === 403 || r.status >= 500) left.push(e);
		} catch {
			left.push(e);
		}
	}
	write(left);
	return { sent, left: left.length };
}
