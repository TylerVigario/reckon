import type { ProblemBody } from './problem.ts';

/**
 * The capture queue.
 *
 * Time is recorded on jobsites, and a jobsite is often where reception is bad.
 * So an entry is written on the phone first and posted when there is a
 * connection.
 *
 * This is a queue, not a sync engine. One table, and an entry posted once rather
 * than edited from two places: there is nothing to reconcile. Every entry
 * carries a client_uuid made here, so a retry after a timeout cannot enter the
 * hour twice.
 *
 * NOTHING IN IT IS THROWN AWAY. An entry leaves when the server has it, or when
 * a person discards it by hand. One the server refuses for good -- it names a
 * service deleted since the phone recorded it, say -- stops being posted and is
 * kept, with the server's reason, to be fixed or discarded. Nothing else holds a
 * copy, so dropping it would lose the hours.
 *
 * IN INDEXEDDB, NOT localStorage. Receipts and photos will travel through here,
 * and localStorage holds a few megabytes of strings; IndexedDB holds files, and
 * writes in transactions, so an entry is in the store whole or not at all.
 * Entries an earlier version queued in localStorage move across on first open.
 */
const DB = 'reckon';
const STORE = 'queue';
/** Where the queue lived before IndexedDB. Read once, emptied once moved. */
const OLD_KEY = 'reckon.queue';

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

/** Why the server refused an entry, in its own words. */
export type Refusal = {
	status: number;
	/** A sentence that is safe to show a person. */
	detail: string;
	/** Which field it was about, where the server said. */
	errors?: Record<string, string>;
};

export type Queued = {
	entry: Entry;
	/** Epoch ms, when it was written on this phone. The queue posts in this order. */
	queued_at: number;
	/** Set once the server refuses it. A refused entry is not posted again until it is fixed. */
	refused?: Refusal;
};

/** Every entry must still carry what makes it postable and what makes a retry safe. */
function isEntry(e: unknown): e is Entry {
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
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
	opening ??= new Promise<IDBDatabase>((resolve, reject) => {
		const req = indexedDB.open(DB, 1);
		req.onupgradeneeded = () =>
			req.result.createObjectStore(STORE, { keyPath: 'entry.client_uuid' });
		req.onsuccess = () => {
			// A later version opening this database in another tab has to be
			// let in, or it waits on this one for ever.
			req.result.onversionchange = () => req.result.close();
			resolve(req.result);
		};
		req.onerror = () => reject(req.error ?? new Error('the queue would not open'));
	}).then(adoptOld);
	// A failed open is tried again next time, rather than remembered.
	opening.catch(() => (opening = null));
	return opening;
}

/**
 * Runs one transaction and settles when it has COMMITTED, not when its request
 * succeeded: a write is not on the phone until then. Writes ask for strict
 * durability, so committed means on the disk -- a timer is dropped only after
 * its entry is written, and a relaxed commit could be lost to a flat battery in
 * the gap between.
 */
function tx<T>(
	mode: IDBTransactionMode,
	work: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | undefined> {
	return open().then(
		(db) =>
			new Promise<T | undefined>((resolve, reject) => {
				const t =
					mode === 'readwrite'
						? db.transaction(STORE, mode, { durability: 'strict' })
						: db.transaction(STORE, mode);
				let result: T | undefined;
				const req = work(t.objectStore(STORE));
				if (req) req.onsuccess = () => (result = req.result);
				t.oncomplete = () => resolve(result);
				t.onerror = () => reject(t.error ?? new Error('the queue refused a write'));
				t.onabort = () => reject(t.error ?? new Error('the queue abandoned a write'));
			})
	);
}

/**
 * Moves what an earlier version queued in localStorage. The old copy is removed
 * only once the new one has committed, so a failure part-way leaves it where it
 * was, to be moved next time; putting by client_uuid makes a second move harmless.
 */
async function adoptOld(db: IDBDatabase): Promise<IDBDatabase> {
	let old: Entry[];
	try {
		const v: unknown = JSON.parse(localStorage.getItem(OLD_KEY) ?? '[]');
		old = Array.isArray(v) ? v.filter(isEntry) : [];
	} catch {
		return db;
	}
	if (old.length) {
		await new Promise<void>((resolve, reject) => {
			const t = db.transaction(STORE, 'readwrite', { durability: 'strict' });
			const store = t.objectStore(STORE);
			const now = Date.now();
			// In the order they were queued, a millisecond apart, so they post in it.
			old.forEach((entry, i) =>
				store.put({ entry, queued_at: now - old.length + i } satisfies Queued)
			);
			t.oncomplete = () => resolve();
			t.onerror = () => reject(t.error ?? new Error('the queue refused the move'));
			t.onabort = () => reject(t.error ?? new Error('the queue abandoned the move'));
		});
	}
	try {
		localStorage.removeItem(OLD_KEY);
	} catch {
		/* moved already; a copy left behind is put again harmlessly */
	}
	return db;
}

let asked = false;
/**
 * Asks the browser not to clear this site's storage when the phone is short of
 * space. Without it the queue is best effort, and a browser may evict it --
 * hours recorded nowhere else. Asked once, on the first write; the answer is
 * the browser's, and the queue works either way.
 */
function keep() {
	if (asked) return;
	asked = true;
	void navigator.storage?.persist?.().catch(() => {});
}

/**
 * Writes an entry. Resolves once it is committed, and rejects if the phone would
 * not store it -- the caller must not let go of the time until this resolves.
 *
 * An entry with a client_uuid already queued replaces it: fixing a refused entry
 * is queueing it again, and that clears the refusal.
 */
export async function enqueue(e: Entry): Promise<void> {
	keep();
	await tx('readwrite', (s) => s.put({ entry: e, queued_at: Date.now() } satisfies Queued));
}

async function all(): Promise<Queued[]> {
	const rows = (await tx<Queued[]>('readonly', (s) => s.getAll())) ?? [];
	return rows.sort((a, b) => a.queued_at - b.queued_at);
}

/** What is waiting to send, and what the server refused, oldest first. */
export async function held(): Promise<{ waiting: number; refused: Queued[] }> {
	const rows = await all();
	return {
		waiting: rows.filter((q) => !q.refused).length,
		refused: rows.filter((q) => q.refused)
	};
}

/** One queued entry, to be fixed. */
export function find(client_uuid: string): Promise<Queued | undefined> {
	return tx<Queued>('readonly', (s) => s.get(client_uuid));
}

/** Lets go of an entry. Only ever a person's decision, made on purpose. */
export async function discard(client_uuid: string): Promise<void> {
	await tx('readwrite', (s) => s.delete(client_uuid));
}

/**
 * Settles a posted entry -- removed, or marked refused -- but only if it is still
 * the copy that was posted. One queued again while its post was out is the newer
 * word, and stays as it is.
 */
function settle(q: Queued, next: Queued | null): Promise<unknown> {
	return tx('readwrite', (s) => {
		const id = q.entry.client_uuid;
		const got = s.get(id);
		got.onsuccess = () => {
			if ((got.result as Queued | undefined)?.queued_at !== q.queued_at) return;
			if (next) s.put(next);
			else s.delete(id);
		};
	});
}

async function reason(r: Response): Promise<Refusal> {
	let body: Partial<ProblemBody> = {};
	try {
		body = (await r.json()) as Partial<ProblemBody>;
	} catch {
		/* not a problem document; the status says enough */
	}
	return {
		status: r.status,
		detail:
			typeof body.detail === 'string' && body.detail
				? body.detail
				: `The server refused it (${r.status}).`,
		...(body.errors && typeof body.errors === 'object' ? { errors: body.errors } : {})
	};
}

export type Flushed = { sent: number; refused: number };

async function post(): Promise<Flushed> {
	const waiting = (await all()).filter((q) => !q.refused);
	let sent = 0;
	let refused = 0;
	for (const q of waiting) {
		let r: Response;
		try {
			r = await fetch('/api/time', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(q.entry)
			});
		} catch {
			// No connection. The rest would fail the same way; they all wait.
			break;
		}
		if (r.ok) {
			await settle(q, null);
			sent++;
			continue;
		}
		// The entry is fine and something else is not: the session (401, 403),
		// the moment (408, 429), or the server (5xx). Worth another go.
		if ([401, 403, 408, 429].includes(r.status) || r.status >= 500) continue;
		// Any other 4xx the server would refuse again. Kept, with its reason.
		await settle(q, { ...q, refused: await reason(r) });
		refused++;
	}
	return { sent, refused };
}

let chain: Promise<unknown> = Promise.resolve();

/**
 * Posts everything waiting, oldest first. One flush at a time: a second call
 * runs after the first, so it sees whatever was queued before it was made, and
 * no entry is ever out on two posts at once.
 */
export function flush(): Promise<Flushed> {
	const run = chain.then(post, post);
	chain = run.catch(() => {});
	return run;
}
