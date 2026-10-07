import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/env/private', () => ({ GOOGLE_MAPS_API_KEY: 'test-key' }));

const { routeMiles } = await import('./routes.ts');

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const place = (n: number) => ({ address: `${n} Main St, Woodland, CA 95695` });
/** Google, answering each request with a leg of `metres` between every pair of its places. */
const google = (metres = 1609.344 * 21.5) => {
	const asked: { body: Record<string, unknown>; headers: Record<string, string> }[] = [];
	vi.stubGlobal('fetch', (_: string, init: RequestInit) => {
		const body = JSON.parse(init.body as string) as { intermediates: unknown[] };
		asked.push({ body, headers: init.headers as Record<string, string> });
		const legs = Array.from({ length: body.intermediates.length + 1 }, () => ({
			distanceMeters: metres
		}));
		return Promise.resolve(Response.json({ routes: [{ legs }] }));
	});
	return asked;
};

describe("a trip's miles by Google's route", () => {
	it('asks once for the whole trip, without traffic, for the legs alone', async () => {
		const asked = google();
		const points = [{ placeId: 'base' }, place(1), place(2), { placeId: 'base' }];
		expect(await routeMiles(points)).toEqual(['21.5', '21.5', '21.5']);
		expect(asked).toHaveLength(1);
		expect(asked[0].body).toEqual({
			origin: { placeId: 'base' },
			destination: { placeId: 'base' },
			intermediates: [place(1), place(2)],
			travelMode: 'DRIVE'
		});
		expect(asked[0].headers['X-Goog-FieldMask']).toBe('routes.legs.distanceMeters');
	});

	it('asks a long trip in pieces of ten places between, each at the cheaper tier', async () => {
		const asked = google();
		const points = Array.from({ length: 15 }, (_, n) => place(n + 100));
		expect(await routeMiles(points)).toHaveLength(14);
		expect(asked.map((a) => (a.body.intermediates as unknown[]).length)).toEqual([10, 2]);
		// The second piece starts where the first ended.
		expect(asked[1].body.origin).toEqual(asked[0].body.destination);
	});

	it('does not ask again for places it has just been asked about', async () => {
		const points = [place(200), place(201)];
		google();
		await routeMiles(points);
		const again = google();
		expect(await routeMiles(points)).toEqual(['21.5']);
		expect(again).toHaveLength(0);
	});

	it('says nothing rather than guess when Google refuses, and logs why', async () => {
		vi.stubGlobal('fetch', () =>
			Promise.resolve(new Response('Routes API has not been used in project', { status: 403 }))
		);
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await routeMiles([place(300), place(301)])).toBeNull();
		expect(JSON.stringify(log.mock.calls)).toContain('Routes API has not been used');
	});

	it('says nothing when the answer has the wrong number of legs', async () => {
		vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ routes: [{ legs: [] }] })));
		expect(await routeMiles([place(400), place(401)])).toBeNull();
	});

	it('puts a time limit on the question', async () => {
		let signal: unknown;
		vi.stubGlobal('fetch', (_: string, init: RequestInit) => {
			signal = init.signal;
			return Promise.resolve(Response.json({ routes: [{ legs: [{ distanceMeters: 1000 }] }] }));
		});
		expect(await routeMiles([place(500), place(501)])).toEqual(['0.6']);
		expect(signal).toBeInstanceOf(AbortSignal);
	});
});
