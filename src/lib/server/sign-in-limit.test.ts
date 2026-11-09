import { describe, expect, it } from 'vitest';
import { forgive, takeTry } from './sign-in-limit.ts';

const MINUTE = 60 * 1000;
/** `n` tries from one address, each taken before any is answered. */
const atOnce = (address: string, n: number, now: number) =>
	Array.from({ length: n }, () => takeTry(address, now));

describe('tries at a password from one address', () => {
	it('are five in fifteen minutes, however many are made at once', () => {
		expect(atOnce('192.0.2.1', 8, 0)).toEqual([0, 0, 0, 0, 0, 900, 900, 900]);
	});

	it('come back one at a time, as each turns fifteen minutes old', () => {
		takeTry('192.0.2.2', 0);
		atOnce('192.0.2.2', 4, 5 * MINUTE);
		expect(takeTry('192.0.2.2', 15 * MINUTE - 1)).toBe(1);
		expect(takeTry('192.0.2.2', 15 * MINUTE)).toBe(0);
		expect(takeTry('192.0.2.2', 15 * MINUTE)).toBe(5 * 60);
	});

	it('are not taken by a try refused', () => {
		atOnce('192.0.2.3', 5, 0);
		atOnce('192.0.2.3', 3, 10 * MINUTE);
		expect(takeTry('192.0.2.3', 15 * MINUTE)).toBe(0);
	});

	it('are given back by a right password', () => {
		atOnce('192.0.2.4', 5, 0);
		forgive('192.0.2.4');
		expect(atOnce('192.0.2.4', 5, 0)).toEqual([0, 0, 0, 0, 0]);
	});
});

describe('the address tries are counted against', () => {
	it('is each IPv4 address on its own', () => {
		atOnce('192.0.2.5', 5, 0);
		expect(takeTry('192.0.2.6', 0)).toBe(0);
	});

	it('is an IPv6 address’s /64, however it is written', () => {
		atOnce('2001:db8:1:2::1', 5, 0);
		expect(takeTry('2001:DB8:1:2:abcd:ef01:2345:6789', 0)).toBe(900);
		expect(takeTry('2001:db8:1:3::1', 0)).toBe(0);
		forgive('2001:db8:1:2::ffff');
		expect(takeTry('2001:db8:1:2::1', 0)).toBe(0);
	});

	it('is the IPv4 address that an IPv6 one carries', () => {
		atOnce('192.0.2.7', 5, 0);
		expect(takeTry('::ffff:192.0.2.7', 0)).toBe(900);
	});
});
