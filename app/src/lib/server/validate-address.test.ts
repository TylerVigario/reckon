import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/env/private', () => ({ GOOGLE_MAPS_API_KEY: 'test-key' }));

const { NoVerdict, validate } = await import('./validate-address.ts');

const ADDRESS = { street: '1000 Main St', city: 'Woodland', region: 'CA', postcode: '95695' };

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

/**
 * Validation is information about a chosen address, never a gate, and what
 * Google says when it fails is for whoever runs the installation -- a key,
 * billing, a quota -- not for the person choosing an address.
 */
describe('validate', () => {
	it('puts a time limit on the question', async () => {
		let signal: unknown;
		vi.stubGlobal('fetch', (_: string, init?: RequestInit) => {
			signal = init?.signal;
			return Promise.resolve(Response.json({ result: { verdict: { addressComplete: true } } }));
		});
		expect((await validate(ADDRESS))?.complete).toBe(true);
		expect(signal).toBeInstanceOf(AbortSignal);
	});

	it('keeps what Google said out of its message, and logs it instead', async () => {
		const said = 'API key not valid. Please pass a valid API key. (project 123456)';
		vi.stubGlobal('fetch', () =>
			Promise.resolve(new Response(JSON.stringify({ error: { message: said } }), { status: 400 }))
		);
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const thrown = await validate(ADDRESS).catch((e: unknown) => e);
		expect(thrown).toBeInstanceOf(NoVerdict);
		expect((thrown as Error).message).not.toContain('API key');
		expect(JSON.stringify(log.mock.calls)).toContain('API key not valid');
	});

	it('says so when Google runs out of time', async () => {
		vi.stubGlobal('fetch', () =>
			Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
		);
		await expect(validate(ADDRESS)).rejects.toThrow(
			new NoVerdict('Google did not answer within 4 seconds.')
		);
	});

	it('gives no verdict, rather than throwing something else, when Google cannot be reached', async () => {
		vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fetch failed')));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(validate(ADDRESS)).rejects.toThrow(NoVerdict);
	});
});
