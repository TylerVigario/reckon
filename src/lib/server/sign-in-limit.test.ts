import { describe, expect, it, vi } from 'vitest';

// What is pure here is tested here; what the record holds and the locks around
// it are tested over HTTP, against a database (tests/sign-in-limit-check.mjs).
vi.mock('./db/index.ts', () => ({ db: {} }));
vi.mock('./auth.ts', () => ({ authSecret: () => 'a-secret-for-these-tests-and-nothing-else' }));
const { emailKey, placeOf, refusal, waitAfter } = await import('./sign-in-limit.ts');

const at = (s: number) => new Date(s * 1000);
/** `n` tries from one address, the newest at `newest` seconds, a second apart. */
const tries = (n: number, newest: number) => Array.from({ length: n }, (_, i) => at(newest - i));
const none = { inARow: 0, last: null };

describe('tries at a password from one address', () => {
	it('are five in fifteen minutes', () => {
		expect(refusal(at(10), tries(4, 10), none)).toBeNull();
		expect(refusal(at(10), tries(5, 10), none)).toEqual({ by: 'address', wait: 900 - 4 });
	});

	it('come back as the oldest of the five turns fifteen minutes old', () => {
		const five = [at(300), at(200), at(100), at(50), at(0)];
		expect(refusal(at(600), five, none)).toEqual({ by: 'address', wait: 300 });
		expect(refusal(at(899), five, none)).toEqual({ by: 'address', wait: 1 });
	});
});

describe('tries at one email in a row', () => {
	it('are ten before any wait', () => {
		expect(waitAfter(9)).toBe(0);
		expect(refusal(at(0), [], { inARow: 9, last: at(0) })).toBeNull();
		expect(refusal(at(0), [], { inARow: 10, last: at(0) })).toEqual({ by: 'email', wait: 30 });
	});

	it('then each wait twice as long as the last, up to an hour', () => {
		expect([10, 11, 12, 13, 14, 15, 16, 17, 18, 1000].map(waitAfter)).toEqual([
			30, 60, 120, 240, 480, 960, 1920, 3600, 3600, 3600
		]);
	});

	it('wait from the last of them', () => {
		expect(refusal(at(29), [], { inARow: 10, last: at(0) })).toEqual({ by: 'email', wait: 1 });
		expect(refusal(at(30), [], { inARow: 10, last: at(0) })).toBeNull();
	});

	it('wait after the address does, when both would', () => {
		expect(refusal(at(0), tries(5, 0), { inARow: 10, last: at(0) })?.by).toBe('address');
	});
});

describe('the address a try is recorded from', () => {
	it('is an IPv4 address on its own', () => {
		expect(placeOf('192.0.2.5')).toEqual({ address: '192.0.2.5', network: '192.0.2.5/32' });
	});

	it('counts in its /64 when IPv6, however it is written', () => {
		const network = '2001:0db8:0001:0002:0000:0000:0000:0000/64';
		expect(placeOf('2001:db8:1:2::1').network).toBe(network);
		expect(placeOf('2001:DB8:1:2:abcd:ef01:2345:6789')).toEqual({
			address: '2001:DB8:1:2:abcd:ef01:2345:6789',
			network
		});
	});

	it('is the IPv4 address that an IPv6 one carries', () => {
		expect(placeOf('::ffff:192.0.2.7')).toEqual({ address: '192.0.2.7', network: '192.0.2.7/32' });
	});

	it('has no zone index, which Postgres cannot keep', () => {
		expect(placeOf('fe80::1%eth0').address).toBe('fe80::1');
	});
});

describe('what the record keeps of an email', () => {
	it('is the same for the same email, and another for another', () => {
		expect(emailKey('avery@example.com')).toBe(emailKey('avery@example.com'));
		expect(emailKey('avery@example.com')).not.toBe(emailKey('sam@example.com'));
	});

	it('is not the email, nor its plain hash', async () => {
		const { createHash } = await import('node:crypto');
		const kept = emailKey('avery@example.com');
		expect(kept).not.toContain('avery');
		expect(kept).not.toBe(createHash('sha256').update('avery@example.com').digest('base64url'));
		expect(kept).toMatch(/^[\w-]{43}$/);
	});
});
