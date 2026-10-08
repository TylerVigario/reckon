import type { ProblemBody } from './problem.ts';
import type { Conflict } from './line-conflict.ts';
import type { TripDraft } from './trip/draft.ts';

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
 * IN INDEXEDDB, NOT localStorage. Receipts travel through here, and localStorage
 * holds a few megabytes of strings; IndexedDB holds files, and writes in
 * transactions, so an entry is in the store whole or not at all. Entries an
 * earlier version queued in localStorage move across on first open.
 *
 * LINES ADDED TO A DRAFT wait here too, receipt and all, in a store of their
 * own: a time entry and a line are different things, and the Time screen counts
 * only its own. They go after the time entries, oldest first, to /api/lines.
 *
 * DRAFTS STARTED ON THE PHONE wait in a third, and go before the lines, which
 * may be for them: a line names its draft by the server's id, or by the uuid
 * the phone made for a draft started here. A line for a draft still waiting
 * waits with it.
 *
 * CHANGES to lines the server has -- a line changed, taken off, or put back --
 * wait in a fourth, one to a line, and go last. Each says the save of the line
 * it began from and the line's fields then, so the server can merge it with a
 * change made meanwhile (#lib/line-merge). What a change runs into -- a field
 * both changed, a line taken off -- is kept with it, as a refusal is, until a
 * person decides (#lib/line-conflict).
 *
 * TRIPS recorded or changed on the phone wait in a fifth, and go last: the
 * trip as /api/trips takes it, the form as it was filled in, so Fix opens it
 * again, and what the trips list shows of it meanwhile. A change names the trip
 * it changes, and a second change before the first has gone takes its place.
 */
const DB = 'reckon';
const STORE = 'queue';
const LINES = 'lines';
const DRAFTS = 'drafts';
const CHANGES = 'changes';
const TRIPS = 'trips';
type Store = typeof STORE | typeof LINES | typeof DRAFTS | typeof CHANGES | typeof TRIPS;
/** Where the queue lived before IndexedDB. Read once, emptied once moved. */
const OLD_KEY = 'reckon.queue';

export type Entry = {
	client_uuid: string;
	/** The day it is dated, as this phone worked it out: for showing. The server works out its own. */
	worked_on: string;
	/**
	 * When it started and ended, as moments ("2026-10-04T16:05:00.000Z"), and the
	 * zone it was worked in. The server works out the length from them.
	 */
	started_at?: string;
	ended_at?: string;
	zone?: string;
	/** A length alone, in place of the moments: what an entry carried before it kept its times. */
	minutes?: number;
	crew: 'one' | 'team';
	/** Null on a team entry: the team worked it, so no one name is right. */
	worked_by: string | null;
	/**
	 * Who was on a team entry. Absent on one queued before entries named their
	 * crew: the server takes that as everybody holding a role, as it was then.
	 */
	crew_ids?: string[];
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
	/** What a change to a line ran into, for a person to decide (#lib/line-conflict). */
	conflict?: Conflict;
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
		(typeof r.minutes === 'number' ||
			(typeof r.started_at === 'string' &&
				typeof r.ended_at === 'string' &&
				typeof r.zone === 'string')) &&
		(r.crew === 'one' || r.crew === 'team') &&
		typeof r.service_id === 'string' &&
		typeof r.created_by === 'string'
	);
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
	opening ??= new Promise<IDBDatabase>((resolve, reject) => {
		// 2: lines joined time entries; 3: drafts started here; 4: changes to
		// lines; 5: trips. A phone on an earlier one keeps what it has and gains
		// the stores it lacks.
		const req = indexedDB.open(DB, 5);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE))
				db.createObjectStore(STORE, { keyPath: 'entry.client_uuid' });
			if (!db.objectStoreNames.contains(LINES))
				db.createObjectStore(LINES, { keyPath: 'line.client_uuid' });
			if (!db.objectStoreNames.contains(DRAFTS))
				db.createObjectStore(DRAFTS, { keyPath: 'draft.client_uuid' });
			if (!db.objectStoreNames.contains(CHANGES))
				db.createObjectStore(CHANGES, { keyPath: 'change.line_id' });
			if (!db.objectStoreNames.contains(TRIPS))
				db.createObjectStore(TRIPS, { keyPath: 'trip.key' });
		};
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
	work: (store: IDBObjectStore) => IDBRequest<T> | void,
	store: Store = STORE
): Promise<T | undefined> {
	return open().then(
		(db) =>
			new Promise<T | undefined>((resolve, reject) => {
				const t =
					mode === 'readwrite'
						? db.transaction(store, mode, { durability: 'strict' })
						: db.transaction(store, mode);
				let result: T | undefined;
				const req = work(t.objectStore(store));
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
 * Settles a posted entry or line -- removed, or marked refused -- but only if it
 * is still the copy that was posted. One queued again while its post was out is
 * the newer word, and stays as it is.
 */
function settleIn<Q extends { queued_at: number }>(
	store: Store,
	id: string,
	q: Q,
	next: Q | null
): Promise<unknown> {
	return tx(
		'readwrite',
		(s) => {
			const got = s.get(id);
			got.onsuccess = () => {
				if ((got.result as Q | undefined)?.queued_at !== q.queued_at) return;
				if (next) s.put(next);
				else s.delete(id);
			};
		},
		store
	);
}
const settle = (q: Queued, next: Queued | null) => settleIn(STORE, q.entry.client_uuid, q, next);
const settleLine = (q: QueuedLine, next: QueuedLine | null) =>
	settleIn(LINES, q.line.client_uuid, q, next);
const settleDraft = (q: QueuedDraft, next: QueuedDraft | null) =>
	settleIn(DRAFTS, q.draft.client_uuid, q, next);
const settleChange = (q: QueuedChange, next: QueuedChange | null) =>
	settleIn(CHANGES, q.change.line_id, q, next);
const settleTrip = (q: QueuedTrip, next: QueuedTrip | null) => settleIn(TRIPS, q.trip.key, q, next);

async function reason(r: Response): Promise<Refusal> {
	let body: Partial<ProblemBody> = {};
	try {
		body = (await r.json()) as Partial<ProblemBody>;
	} catch {
		/* not a problem document; the status says enough */
	}
	const conflict = (body as { conflict?: unknown }).conflict;
	return {
		status: r.status,
		detail:
			typeof body.detail === 'string' && body.detail
				? body.detail
				: `The server refused it (${r.status}).`,
		...(body.errors && typeof body.errors === 'object' ? { errors: body.errors } : {}),
		...(conflict && typeof conflict === 'object' ? { conflict: conflict as Conflict } : {})
	};
}

export type Flushed = { sent: number; refused: number };

/** What a post came to: in, kept as refused, worth another go, or no connection. */
type Posted = 'sent' | 'refused' | 'again' | 'offline';

async function postOne(
	send: () => Promise<Response>,
	refuse: (why: Refusal) => Promise<unknown>,
	done: () => Promise<unknown>
): Promise<Posted> {
	let r: Response;
	try {
		r = await send();
	} catch {
		return 'offline';
	}
	if (r.ok) {
		await done();
		return 'sent';
	}
	// It is fine and something else is not: the session (401, 403), the moment
	// (408, 429), or the server (5xx). Worth another go.
	if ([401, 403, 408, 429].includes(r.status) || r.status >= 500) return 'again';
	// Any other 4xx the server would refuse again. Kept, with its reason.
	await refuse(await reason(r));
	return 'refused';
}

async function post(): Promise<Flushed> {
	let sent = 0;
	let refused = 0;
	const count = (p: Posted) => {
		if (p === 'sent') sent++;
		if (p === 'refused') refused++;
		return p;
	};
	for (const q of (await all()).filter((q) => !q.refused)) {
		const p = await postOne(
			() =>
				fetch('/api/time', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(q.entry)
				}),
			(why) => settle(q, { ...q, refused: why }),
			() => settle(q, null)
		);
		// No connection. The rest would fail the same way; they all wait.
		if (count(p) === 'offline') return { sent, refused };
	}
	for (const q of (await allDrafts()).filter((q) => !q.refused)) {
		const p = await postOne(
			() =>
				fetch('/api/drafts', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ client_uuid: q.draft.client_uuid, entity_id: q.draft.entity_id })
				}),
			(why) => settleDraft(q, { ...q, refused: why }),
			() => settleDraft(q, null)
		);
		if (count(p) === 'offline') return { sent, refused };
	}
	// A line for a draft that has not arrived waits for it.
	const waitingDrafts = new Set((await allDrafts()).map((q) => q.draft.client_uuid));
	for (const q of (await allLines()).filter(
		(q) => !q.refused && !waitingDrafts.has(q.line.invoice_id)
	)) {
		const p = await postOne(
			() => fetch('/api/lines', { method: 'POST', body: formOf(q.line) }),
			(why) => settleLine(q, { ...q, refused: why }),
			() => settleLine(q, null)
		);
		if (count(p) === 'offline') return { sent, refused };
	}
	for (const q of (await allChanges()).filter((q) => !q.refused)) {
		const p = await postOne(
			() => sendChange(q.change),
			(why) => settleChange(q, { ...q, refused: why }),
			() => settleChange(q, null)
		);
		if (count(p) === 'offline') return { sent, refused };
	}
	for (const q of (await allTrips()).filter((q) => !q.refused)) {
		const p = await postOne(
			() =>
				fetch(q.trip.trip_id ? `/api/trips/${q.trip.trip_id}` : '/api/trips', {
					method: q.trip.trip_id ? 'PUT' : 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(q.trip.body)
				}),
			(why) => settleTrip(q, { ...q, refused: why }),
			() => settleTrip(q, null)
		);
		if (count(p) === 'offline') break;
	}
	return { sent, refused };
}

let chain: Promise<unknown> = Promise.resolve();

/**
 * Posts everything waiting, oldest first: time, then drafts, then lines, then changes, then trips. One flush at a time: a second call
 * runs after the first, so it sees whatever was queued before it was made, and
 * no entry is ever out on two posts at once.
 */
export function flush(): Promise<Flushed> {
	const run = chain.then(post, post);
	chain = run.catch(() => {});
	return run;
}

/**
 * A line added to a draft, waiting to be sent: which draft, its fields as the
 * Add a line form names them -- which is how the server reads them
 * (#lib/line-fields) -- and its receipt, as this phone shrank it.
 */
export type LineEntry = {
	client_uuid: string;
	invoice_id: string;
	fields: Record<string, string>;
	receipt?: Blob | null;
	/** When it was added, on this phone. */
	made_at?: string;
	/** What it is and what it will bill, as this phone worked them out: for showing. */
	shown: ShownLine;
};

/**
 * A line as the draft shows it until the server has it. A line from stock is
 * costed when it arrives, off the shelf as it is then, so its figures here are
 * a preview.
 */
export type ShownLine = {
	kind: 'material' | 'bought' | 'paid_for';
	description: string;
	/** Where it came from, in the draft's words: "Bought · Valley Hardware · Avery paid". */
	detail: string;
	qty: string;
	unit: string;
	unit_price: string;
	amount: string;
	taxable: boolean;
	tax_rate_pct: string;
};

export type QueuedLine = {
	line: LineEntry;
	/** Epoch ms, when it was written on this phone. Lines post in this order. */
	queued_at: number;
	refused?: Refusal;
};

/** The form a line is posted as: its draft, its uuid, its fields and its receipt. */
function formOf(l: LineEntry): FormData {
	const f = new FormData();
	f.set('client_uuid', l.client_uuid);
	f.set('invoice_id', l.invoice_id);
	for (const [k, v] of Object.entries(l.fields)) f.set(k, v);
	if (l.made_at) f.set('made_at', l.made_at);
	if (l.receipt) f.set('receipt', l.receipt, 'receipt');
	return f;
}

/**
 * Writes a line. Resolves once it is committed, and rejects if the phone would
 * not store it -- the page must not say it is added until this resolves. A line
 * with a client_uuid already queued replaces it: fixing a refused line is
 * queueing it again, and that clears the refusal.
 */
export async function enqueueLine(l: LineEntry): Promise<void> {
	keep();
	await tx(
		'readwrite',
		(s) => s.put({ line: l, queued_at: Date.now() } satisfies QueuedLine),
		LINES
	);
}

async function allLines(): Promise<QueuedLine[]> {
	const rows = (await tx<QueuedLine[]>('readonly', (s) => s.getAll(), LINES)) ?? [];
	return rows.sort((a, b) => a.queued_at - b.queued_at);
}

/** Every line on this phone, waiting or refused, oldest first; or one draft's. */
export async function linesHeld(invoiceId?: string): Promise<QueuedLine[]> {
	const rows = await allLines();
	return invoiceId ? rows.filter((q) => q.line.invoice_id === invoiceId) : rows;
}

/** One queued line, to be fixed. */
export function findLine(client_uuid: string): Promise<QueuedLine | undefined> {
	return tx<QueuedLine>('readonly', (s) => s.get(client_uuid), LINES);
}

/** Lets go of a line. Only ever a person's decision, made on purpose. */
export async function discardLine(client_uuid: string): Promise<void> {
	await tx('readwrite', (s) => s.delete(client_uuid), LINES);
}

/**
 * A draft started on this phone: for which client, and when. It takes its
 * number when it reaches the server, and the lines added to it name it by its
 * client_uuid until then.
 */
export type DraftEntry = {
	client_uuid: string;
	entity_id: string;
	/** The client's name, for showing until the server has it. */
	who: string;
};

export type QueuedDraft = {
	draft: DraftEntry;
	queued_at: number;
	refused?: Refusal;
};

/** Writes a draft. Resolves once it is committed. */
export async function enqueueDraft(d: DraftEntry): Promise<void> {
	keep();
	await tx(
		'readwrite',
		(s) => s.put({ draft: d, queued_at: Date.now() } satisfies QueuedDraft),
		DRAFTS
	);
}

async function allDrafts(): Promise<QueuedDraft[]> {
	const rows = (await tx<QueuedDraft[]>('readonly', (s) => s.getAll(), DRAFTS)) ?? [];
	return rows.sort((a, b) => a.queued_at - b.queued_at);
}

/** Every draft started on this phone and not yet arrived, oldest first. */
export const draftsHeld = allDrafts;

/** One draft started on this phone, while it waits. */
export function findDraft(client_uuid: string): Promise<QueuedDraft | undefined> {
	return tx<QueuedDraft>('readonly', (s) => s.get(client_uuid), DRAFTS);
}

/** Lets go of a draft started here, and of the lines on it. A person's decision. */
export async function discardDraft(client_uuid: string): Promise<void> {
	for (const q of await linesHeld(client_uuid)) await discardLine(q.line.client_uuid);
	await tx('readwrite', (s) => s.delete(client_uuid), DRAFTS);
}

/**
 * A change to a line the server has: what it does, the save of the line it
 * began from and the line's fields then, and the fields it leaves the line
 * with. Put back, a line is added again with them.
 */
export type ChangeEntry = {
	line_id: string;
	invoice_id: string;
	act: 'change' | 'remove' | 'restore';
	version: number;
	base: Record<string, string>;
	fields: Record<string, string>;
	receipt?: Blob | null;
	/** Taken off even though someone changed it since. */
	force?: boolean;
	/** When it was made, on this phone. */
	made_at: string;
	/** The line as the draft shows it once changed: for showing, and its total. */
	shown: ShownLine;
};

export type QueuedChange = {
	change: ChangeEntry;
	queued_at: number;
	refused?: Refusal;
};

/** The request a change is sent as. */
function sendChange(c: ChangeEntry): Promise<Response> {
	if (c.act === 'remove') {
		const q = new URLSearchParams({ version: String(c.version), made_at: c.made_at });
		if (c.force) q.set('force', '1');
		return fetch(`/api/lines/${c.line_id}?${q.toString()}`, { method: 'DELETE' });
	}
	const f = new FormData();
	for (const [k, v] of Object.entries(c.fields)) f.set(k, v);
	f.set('version', String(c.version));
	f.set('base', JSON.stringify(c.base));
	f.set('made_at', c.made_at);
	if (c.receipt) f.set('receipt', c.receipt, 'receipt');
	return c.act === 'restore'
		? fetch(`/api/lines/${c.line_id}/restore`, { method: 'POST', body: f })
		: fetch(`/api/lines/${c.line_id}`, { method: 'PATCH', body: f });
}

/**
 * Writes a change to a line. Resolves once it is committed. A second change to
 * a line whose first is still waiting replaces it, but keeps the save and the
 * fields the first began from: the server merges against where this phone
 * started, not against itself. `fresh` writes it as given -- a pick made
 * against the line as the server now has it.
 */
export async function enqueueChange(c: ChangeEntry, fresh = false): Promise<void> {
	keep();
	const had = fresh ? undefined : await findChange(c.line_id);
	const began = had && !had.refused ? { version: had.change.version, base: had.change.base } : {};
	await tx(
		'readwrite',
		(s) => s.put({ change: { ...c, ...began }, queued_at: Date.now() } satisfies QueuedChange),
		CHANGES
	);
}

async function allChanges(): Promise<QueuedChange[]> {
	const rows = (await tx<QueuedChange[]>('readonly', (s) => s.getAll(), CHANGES)) ?? [];
	return rows.sort((a, b) => a.queued_at - b.queued_at);
}

/** Every change on this phone, waiting or run into something, oldest first; or one draft's. */
export async function changesHeld(invoiceId?: string): Promise<QueuedChange[]> {
	const rows = await allChanges();
	return invoiceId ? rows.filter((q) => q.change.invoice_id === invoiceId) : rows;
}

/** The change waiting for one line. */
export function findChange(line_id: string): Promise<QueuedChange | undefined> {
	return tx<QueuedChange>('readonly', (s) => s.get(line_id), CHANGES);
}

/** Lets go of a change. A person's decision. */
export async function discardChange(line_id: string): Promise<void> {
	await tx('readwrite', (s) => s.delete(line_id), CHANGES);
}

/**
 * A trip recorded or changed on this phone, waiting to be sent: keyed by the
 * trip it changes, or by its own client_uuid when it is new.
 */
export type TripEntry = {
	key: string;
	/** The trip it changes; null for a trip recorded here. */
	trip_id: string | null;
	/** The trip as /api/trips takes it. */
	body: Record<string, unknown>;
	/** The form as it was filled in, which Fix opens again. */
	draft: TripDraft;
	/** What the trips list shows of it until it arrives. */
	shown: { label: string; day: string; driver: string; miles: string };
};

export type QueuedTrip = {
	trip: TripEntry;
	queued_at: number;
	refused?: Refusal;
};

/** Writes a trip, in place of any waiting under the same key. Resolves once it is committed. */
export async function enqueueTrip(trip: TripEntry): Promise<void> {
	keep();
	await tx('readwrite', (s) => s.put({ trip, queued_at: Date.now() } satisfies QueuedTrip), TRIPS);
}

async function allTrips(): Promise<QueuedTrip[]> {
	const rows = (await tx<QueuedTrip[]>('readonly', (s) => s.getAll(), TRIPS)) ?? [];
	return rows.sort((a, b) => a.queued_at - b.queued_at);
}

/** Every trip recorded or changed on this phone and not yet arrived, oldest first. */
export const tripsHeld = allTrips;

/** One trip waiting on this phone. */
export function findTrip(key: string): Promise<QueuedTrip | undefined> {
	return tx<QueuedTrip>('readonly', (s) => s.get(key), TRIPS);
}

/** Lets go of a trip, or a change to one. A person's decision. */
export async function discardTrip(key: string): Promise<void> {
	await tx('readwrite', (s) => s.delete(key), TRIPS);
}

/** Everything on this phone waiting to send -- time, drafts, lines, changes and trips -- leaving out what was refused. */
export async function waitingCount(): Promise<number> {
	const [time, drafts, lines, changes, trips] = await Promise.all([
		held(),
		allDrafts(),
		allLines(),
		allChanges(),
		allTrips()
	]);
	return (
		time.waiting +
		drafts.filter((q) => !q.refused).length +
		lines.filter((q) => !q.refused).length +
		changes.filter((q) => !q.refused).length +
		trips.filter((q) => !q.refused).length
	);
}

/** How long a queued entry took, in seconds: from its moments, or its minutes. */
export function secondsOf(e: Entry): number {
	if (e.started_at && e.ended_at)
		return Math.max(1, Math.round((Date.parse(e.ended_at) - Date.parse(e.started_at)) / 1000));
	return (e.minutes ?? 0) * 60;
}
