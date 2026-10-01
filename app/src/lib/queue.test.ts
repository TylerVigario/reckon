import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueue, flush, pending, type Entry } from './queue';

const entry = (client_uuid: string): Entry => ({
	client_uuid,
	worked_on: '2026-03-14',
	minutes: 30,
	crew: 'one',
	worked_by: 'a',
	created_by: 'a',
	service_id: 'v'
});

beforeEach(() => {
	const store = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v)
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('flush', () => {
	it('keeps an entry queued while a post was in flight', async () => {
		enqueue(entry('first'));
		vi.stubGlobal('fetch', () => {
			// Somebody stops a timer while the first post is still out.
			enqueue(entry('second'));
			return Promise.resolve({ ok: true, status: 201 });
		});
		const r = await flush();
		expect(r.sent).toBe(1);
		expect(pending()).toBe(1);
	});

	it('keeps what the session refused and drops what the server never will', async () => {
		enqueue(entry('unauthorised'));
		enqueue(entry('malformed'));
		let n = 0;
		vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, status: n++ === 0 ? 401 : 400 }));
		await flush();
		expect(pending()).toBe(1);
	});
});
