import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeEntry, Entry, LineEntry, TripEntry } from './queue.ts';

const entry = (client_uuid: string, extra: Partial<Entry> = {}): Entry => ({
	client_uuid,
	worked_on: '2026-03-14',
	minutes: 30,
	crew: 'one',
	worked_by: 'a',
	created_by: 'a',
	service_id: 'v',
	...extra
});

const answer = (status: number, body?: object) =>
	Promise.resolve(
		new Response(body ? JSON.stringify(body) : null, {
			status,
			headers: body ? { 'content-type': 'application/problem+json' } : {}
		})
	);

const sentId = (init: RequestInit) => (JSON.parse(init.body as string) as Entry).client_uuid;

let store: Map<string, string>;
let q: typeof import('./queue.ts');

/** A fresh database, and a fresh module that has never opened it. */
async function fresh(old: Map<string, string> = new Map(), setItem = true) {
	store = old;
	vi.stubGlobal('indexedDB', new IDBFactory());
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void (setItem && store.set(k, v)),
		removeItem: (k: string) => void store.delete(k)
	});
	// The module keeps its open connection, so reusing it would carry one
	// test's queue into the next.
	vi.resetModules();
	q = await import('./queue.ts');
}

beforeEach(() => fresh());

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('enqueue', () => {
	it('keeps an entry until it is sent', async () => {
		await q.enqueue(entry('one'));
		expect((await q.held()).waiting).toBe(1);
	});

	it('replaces an entry queued with the same client_uuid', async () => {
		await q.enqueue(entry('one', { minutes: 30 }));
		await q.enqueue(entry('one', { minutes: 45 }));
		expect((await q.held()).waiting).toBe(1);
		expect((await q.find('one'))?.entry.minutes).toBe(45);
	});
});

describe('flush', () => {
	it('sends in the order things were queued, and lets go of what was sent', async () => {
		await q.enqueue(entry('first'));
		await q.enqueue(entry('second'));
		const order: string[] = [];
		vi.stubGlobal('fetch', (_: string, init: RequestInit) => {
			order.push(sentId(init));
			return answer(200, {});
		});
		expect(await q.flush()).toEqual({ sent: 2, refused: 0 });
		expect(order).toEqual(['first', 'second']);
		expect((await q.held()).waiting).toBe(0);
	});

	it('keeps an entry queued while a post was in flight', async () => {
		await q.enqueue(entry('first'));
		vi.stubGlobal('fetch', async () => {
			// Somebody stops a timer while the first post is still out.
			await q.enqueue(entry('second'));
			return answer(200, {});
		});
		expect((await q.flush()).sent).toBe(1);
		expect((await q.held()).waiting).toBe(1);
	});

	it('keeps what failed for a reason that is not the entry', async () => {
		for (const id of ['401', '403', '408', '429', '500', '503']) await q.enqueue(entry(id));
		vi.stubGlobal('fetch', (_: string, init: RequestInit) => answer(Number(sentId(init))));
		expect(await q.flush()).toEqual({ sent: 0, refused: 0 });
		expect((await q.held()).waiting).toBe(6);
	});

	it('keeps everything when there is no connection', async () => {
		await q.enqueue(entry('first'));
		await q.enqueue(entry('second'));
		vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
		expect(await q.flush()).toEqual({ sent: 0, refused: 0 });
		expect((await q.held()).waiting).toBe(2);
	});

	it('keeps an entry the server refuses, with its reason, and stops sending it', async () => {
		await q.enqueue(entry('gone'));
		const fetch = vi.fn(() =>
			answer(400, {
				type: '/problems/invalid-field',
				title: 'A value was refused',
				status: 400,
				detail: 'That service no longer exists.',
				errors: { service_id: 'That service no longer exists.' }
			})
		);
		vi.stubGlobal('fetch', fetch);
		expect(await q.flush()).toEqual({ sent: 0, refused: 1 });

		const s = await q.held();
		expect(s.waiting).toBe(0);
		expect(s.refused).toHaveLength(1);
		expect(s.refused[0].refused).toEqual({
			status: 400,
			detail: 'That service no longer exists.',
			errors: { service_id: 'That service no longer exists.' }
		});

		// Refused is refused: the next flush does not post it again.
		await q.flush();
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('says something even when the refusal has no body', async () => {
		await q.enqueue(entry('bare'));
		vi.stubGlobal('fetch', () => answer(422));
		await q.flush();
		expect((await q.held()).refused[0].refused?.detail).toBe('The server refused it (422).');
	});

	it('runs one flush at a time, and a later one sees what was queued before it', async () => {
		await q.enqueue(entry('first'));
		let out = 0;
		let most = 0;
		vi.stubGlobal('fetch', async () => {
			most = Math.max(most, ++out);
			await new Promise((r) => setTimeout(r, 5));
			out--;
			return answer(200, {});
		});
		const a = q.flush();
		await q.enqueue(entry('second'));
		const b = q.flush();
		// Whichever flush carries it, the second is sent, and once.
		expect((await a).sent + (await b).sent).toBe(2);
		expect(most).toBe(1);
		expect((await q.held()).waiting).toBe(0);
	});
});

describe('a refused entry', () => {
	beforeEach(async () => {
		await q.enqueue(entry('gone'));
		vi.stubGlobal('fetch', () => answer(400, { detail: 'That service no longer exists.' }));
		await q.flush();
	});

	it('is sent again once it is fixed', async () => {
		await q.enqueue(entry('gone', { service_id: 'another' }));
		const s = await q.held();
		expect(s.refused).toHaveLength(0);
		expect(s.waiting).toBe(1);
	});

	it('goes only when a person discards it', async () => {
		await q.discard('gone');
		expect(await q.held()).toEqual({ waiting: 0, refused: [] });
	});
});

describe('moving from localStorage', () => {
	it('moves what an earlier version queued, in order, and empties the old store', async () => {
		await fresh(
			new Map([['reckon.queue', JSON.stringify([entry('older'), entry('newer'), { bad: 1 }])]])
		);
		const order: string[] = [];
		vi.stubGlobal('fetch', (_: string, init: RequestInit) => {
			order.push(sentId(init));
			return answer(500);
		});
		await q.flush();
		expect(order).toEqual(['older', 'newer']);
		expect(store.has('reckon.queue')).toBe(false);
	});

	it('leaves the old store alone when the new one will not open', async () => {
		await fresh(new Map([['reckon.queue', JSON.stringify([entry('older')])]]));
		vi.stubGlobal('indexedDB', {
			open: () => {
				const req = { error: new Error('no room') } as unknown as IDBOpenDBRequest;
				setTimeout(() => {
					req.onerror?.call(req, new Event('error'));
				});
				return req;
			}
		});
		await expect(q.held()).rejects.toThrow('no room');
		expect(store.has('reckon.queue')).toBe(true);
	});
});

const line = (client_uuid: string, extra: Partial<LineEntry> = {}): LineEntry => ({
	client_uuid,
	invoice_id: 'd',
	fields: { kind: 'paid_for', description: 'Low-voltage permit', ex_tax_cost: '35.00' },
	shown: {
		kind: 'paid_for',
		description: 'Low-voltage permit',
		detail: 'Paid for them · City of Woodland · the business paid · at cost',
		qty: '1',
		unit: 'each',
		unit_price: '35.0000',
		amount: '35.00',
		taxable: false,
		tax_rate_pct: '0'
	},
	...extra
});

describe('lines', () => {
	it('wait in a store of their own, which the Time screen does not count', async () => {
		await q.enqueueLine(line('permit'));
		expect((await q.linesHeld()).map((l) => l.line.client_uuid)).toEqual(['permit']);
		expect((await q.held()).waiting).toBe(0);
	});

	it('are a draft’s own', async () => {
		await q.enqueueLine(line('permit'));
		await q.enqueueLine(line('other', { invoice_id: 'e' }));
		expect((await q.linesHeld('d')).map((l) => l.line.client_uuid)).toEqual(['permit']);
	});

	it('go after the time entries, as form data with their receipt', async () => {
		await q.enqueueLine(line('permit', { receipt: new Blob(['jpeg'], { type: 'image/jpeg' }) }));
		await q.enqueue(entry('hour'));
		const sent: string[] = [];
		let form: FormData | null = null;
		vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
			sent.push(url);
			if (url === '/api/lines') form = init.body as FormData;
			return answer(200, {});
		});
		expect(await q.flush()).toEqual({ sent: 2, refused: 0 });
		expect(sent).toEqual(['/api/time', '/api/lines']);
		const f = form as unknown as FormData;
		expect([f.get('client_uuid'), f.get('invoice_id'), f.get('description')]).toEqual([
			'permit',
			'd',
			'Low-voltage permit'
		]);
		expect((f.get('receipt') as File).type).toBe('image/jpeg');
		expect(await q.linesHeld()).toEqual([]);
	});

	it('are kept when the server refuses one, with its reason', async () => {
		await q.enqueueLine(line('permit'));
		vi.stubGlobal('fetch', () =>
			answer(409, { status: 409, detail: 'INV-0213 has gone out, so it takes no more lines.' })
		);
		expect(await q.flush()).toEqual({ sent: 0, refused: 1 });
		const [kept] = await q.linesHeld();
		expect(kept.refused?.detail).toBe('INV-0213 has gone out, so it takes no more lines.');
		await q.discardLine('permit');
		expect(await q.linesHeld()).toEqual([]);
	});

	it('are all kept when there is no connection', async () => {
		await q.enqueueLine(line('permit'));
		vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
		expect(await q.flush()).toEqual({ sent: 0, refused: 0 });
		expect(await q.linesHeld()).toHaveLength(1);
	});
});

describe('a phone that queued before lines', () => {
	it('keeps its entries, and gains a store for lines', async () => {
		// The first version's database: one store, an entry in it.
		const factory = new IDBFactory();
		await new Promise<void>((resolve) => {
			const req = factory.open('reckon', 1);
			req.onupgradeneeded = () =>
				req.result.createObjectStore('queue', { keyPath: 'entry.client_uuid' });
			req.onsuccess = () => {
				const t = req.result.transaction('queue', 'readwrite');
				t.objectStore('queue').put({ entry: entry('older'), queued_at: 1 });
				t.oncomplete = () => {
					req.result.close();
					resolve();
				};
			};
		});
		vi.stubGlobal('indexedDB', factory);
		vi.resetModules();
		q = await import('./queue.ts');
		expect((await q.held()).waiting).toBe(1);
		await q.enqueueLine(line('permit'));
		expect(await q.linesHeld()).toHaveLength(1);
	});
});

describe('a draft started on the phone', () => {
	const draft = { client_uuid: 'phone-draft', entity_id: 'e', who: 'Marisol Vega' };

	it('goes before the lines added to it', async () => {
		await q.enqueueLine(line('permit', { invoice_id: 'phone-draft' }));
		await q.enqueueDraft(draft);
		const sent: string[] = [];
		vi.stubGlobal('fetch', (url: string) => {
			sent.push(url);
			return answer(200, {});
		});
		expect(await q.flush()).toEqual({ sent: 2, refused: 0 });
		expect(sent).toEqual(['/api/drafts', '/api/lines']);
		expect(await q.draftsHeld()).toEqual([]);
	});

	it('keeps its lines waiting until it has arrived', async () => {
		await q.enqueueDraft(draft);
		await q.enqueueLine(line('permit', { invoice_id: 'phone-draft' }));
		await q.enqueueLine(line('other'));
		const sent: string[] = [];
		vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
			sent.push(
				url === '/api/lines' ? ((init.body as FormData).get('client_uuid') as string) : url
			);
			// The server is having a moment with the draft: worth another go.
			return url === '/api/drafts' ? answer(503) : answer(200, {});
		});
		await q.flush();
		expect(sent).toEqual(['/api/drafts', 'other']);
		expect((await q.linesHeld('phone-draft')).map((l) => l.line.client_uuid)).toEqual(['permit']);
	});

	it('takes its lines with it when it is discarded', async () => {
		await q.enqueueDraft(draft);
		await q.enqueueLine(line('permit', { invoice_id: 'phone-draft' }));
		await q.discardDraft('phone-draft');
		expect([await q.draftsHeld(), await q.linesHeld()]).toEqual([[], []]);
	});
});

describe('a change to a line the server has', () => {
	const change = (extra: Partial<ChangeEntry> = {}): ChangeEntry => ({
		line_id: 'cable',
		invoice_id: 'd',
		act: 'change',
		version: 2,
		base: { qty: '147' },
		fields: { qty: '152' },
		made_at: '2026-10-06T21:30:00.000Z',
		shown: line('x').shown,
		...extra
	});

	it('goes last, saying the save it began from and the line then', async () => {
		await q.enqueueChange(change());
		await q.enqueueLine(line('permit'));
		const sent: string[] = [];
		let form: FormData | null = null;
		vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
			sent.push(`${init.method} ${url}`);
			if (url === '/api/lines/cable') form = init.body as FormData;
			return answer(200, {});
		});
		await q.flush();
		expect(sent).toEqual(['POST /api/lines', 'PATCH /api/lines/cable']);
		const f = form as unknown as FormData;
		expect([f.get('qty'), f.get('version'), f.get('base'), f.get('made_at')]).toEqual([
			'152',
			'2',
			'{"qty":"147"}',
			'2026-10-06T21:30:00.000Z'
		]);
	});

	it('changed again before it goes, still begins where the first did', async () => {
		await q.enqueueChange(change());
		await q.enqueueChange(change({ version: 3, base: { qty: '152' }, fields: { qty: '160' } }));
		const kept = await q.findChange('cable');
		expect([kept?.change.version, kept?.change.base, kept?.change.fields]).toEqual([
			2,
			{ qty: '147' },
			{ qty: '160' }
		]);
	});

	it('is kept with what it ran into, and not sent again until a person decides', async () => {
		await q.enqueueChange(change());
		vi.stubGlobal('fetch', () =>
			answer(409, {
				status: 409,
				detail: 'A field needs a choice.',
				conflict: { what: 'collided' }
			})
		);
		expect(await q.flush()).toEqual({ sent: 0, refused: 1 });
		expect((await q.findChange('cable'))?.refused?.conflict).toEqual({ what: 'collided' });
		let asked = false;
		vi.stubGlobal('fetch', () => {
			asked = true;
			return answer(200, {});
		});
		await q.flush();
		expect(asked).toBe(false);
	});

	it('taken off, goes as a removal at the save it was taken off at', async () => {
		await q.enqueueChange(change({ act: 'remove' }));
		let asked = '';
		vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
			asked = `${init.method} ${url}`;
			return answer(200, {});
		});
		await q.flush();
		expect(asked).toBe('DELETE /api/lines/cable?version=2&made_at=2026-10-06T21%3A30%3A00.000Z');
	});
});

describe('a trip recorded or changed on the phone', () => {
	const trip = (key: string, trip_id: string | null = null, note = 'Cable'): TripEntry => ({
		key,
		trip_id,
		body: { client_uuid: key, note },
		draft: {
			clientUuid: key,
			day: '2026-10-07',
			driver: 'sam',
			vehicleId: null,
			serviceId: null,
			startAddress: null,
			endAddress: null,
			stops: [],
			typed: {},
			given: {},
			odometerStart: '',
			odometerEnd: '',
			note
		},
		shown: {
			label: 'Woodland office, Clinic',
			day: '2026-10-07',
			driver: 'Sam Ortega',
			miles: '57.0'
		}
	});

	it('goes last: a new one posted, a change put to the trip it changes', async () => {
		await q.enqueueTrip(trip('new-trip'));
		await q.enqueueTrip(trip('saved', 'saved'));
		await q.enqueueChange({
			line_id: 'cable',
			invoice_id: 'd',
			act: 'change',
			version: 2,
			base: {},
			fields: {},
			made_at: '2026-10-06T21:30:00.000Z',
			shown: line('x').shown
		});
		const sent: string[] = [];
		vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
			sent.push(`${init.method} ${url}`);
			return answer(200, {});
		});
		expect(await q.waitingCount()).toBe(3);
		await q.flush();
		expect(sent).toEqual(['PATCH /api/lines/cable', 'POST /api/trips', 'PUT /api/trips/saved']);
		expect(await q.tripsHeld()).toEqual([]);
	});

	it('changed again before it goes, is the later change', async () => {
		await q.enqueueTrip(trip('saved', 'saved', 'Cable'));
		await q.enqueueTrip(trip('saved', 'saved', 'Cable, the long way'));
		const held = await q.tripsHeld();
		expect(held.map((h) => h.trip.draft.note)).toEqual(['Cable, the long way']);
	});

	it('is kept with the reason when the server refuses it, and not sent again', async () => {
		await q.enqueueTrip(trip('billed', 'billed'));
		vi.stubGlobal('fetch', () =>
			answer(409, { detail: 'Its miles are on an invoice, so it stays as it was billed.' })
		);
		await q.flush();
		expect((await q.findTrip('billed'))?.refused?.detail).toBe(
			'Its miles are on an invoice, so it stays as it was billed.'
		);
		expect(await q.waitingCount()).toBe(0);
		await q.discardTrip('billed');
		expect(await q.tripsHeld()).toEqual([]);
	});

	it('waits whole when there is no signal', async () => {
		await q.enqueueTrip(trip('new-trip'));
		vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
		await q.flush();
		expect((await q.tripsHeld()).length).toBe(1);
	});
});
