import type { Cookies } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/env/private', () => ({ SECURE_COOKIES: true }));
vi.mock('./auth.ts', () => ({ authSecret: () => 'a-secret-for-these-tests-and-nothing-else' }));
const { SIGNED_IN_HERE, browserSignedInAs, signedInHere } = await import('./signed-in-here.ts');

/** A browser's cookies, as far as signing in reads and sets them. */
function browser() {
	const kept = new Map<string, string>();
	let options: unknown;
	const cookies = {
		get: (name: string) => kept.get(name),
		set: (name: string, value: string, opts: unknown) => {
			kept.set(name, value);
			options = opts;
		}
	} as unknown as Cookies;
	return {
		cookies,
		value: () => kept.get(SIGNED_IN_HERE) ?? '',
		replace: (value: string) => kept.set(SIGNED_IN_HERE, value),
		options: () => options
	};
}

describe('a browser', () => {
	it('that has never signed in is nobody’s', () => {
		expect(browserSignedInAs(browser().cookies, 'avery@example.com')).toBeNull();
	});

	it('that has signed in as someone is theirs, and nobody else’s', () => {
		const b = browser();
		signedInHere(b.cookies, 'avery@example.com');
		expect(browserSignedInAs(b.cookies, 'avery@example.com')).toMatch(/^[\w-]{22}$/);
		expect(browserSignedInAs(b.cookies, 'sam@example.com')).toBeNull();
	});

	it('is told apart from another that signed in as them', () => {
		const one = browser();
		const other = browser();
		signedInHere(one.cookies, 'avery@example.com');
		signedInHere(other.cookies, 'avery@example.com');
		expect(browserSignedInAs(one.cookies, 'avery@example.com')).not.toBe(
			browserSignedInAs(other.cookies, 'avery@example.com')
		);
	});

	it('keeps an entry for each person who signs in on it, ten at most, the newest first', () => {
		const b = browser();
		const people = Array.from({ length: 11 }, (_, i) => `person-${i}@example.com`);
		for (const email of people) signedInHere(b.cookies, email);
		expect(browserSignedInAs(b.cookies, people[0])).toBeNull();
		for (const email of people.slice(1)) expect(browserSignedInAs(b.cookies, email)).not.toBeNull();
		expect(b.value().split('~')).toHaveLength(10);
	});

	it('signing in as them again has a new entry for them in place of the old', () => {
		const b = browser();
		signedInHere(b.cookies, 'avery@example.com');
		signedInHere(b.cookies, 'sam@example.com');
		const before = browserSignedInAs(b.cookies, 'avery@example.com');
		signedInHere(b.cookies, 'avery@example.com');
		expect(b.value().split('~')).toHaveLength(2);
		expect(browserSignedInAs(b.cookies, 'avery@example.com')).not.toBe(before);
		expect(browserSignedInAs(b.cookies, 'sam@example.com')).not.toBeNull();
	});
});

describe('the cookie', () => {
	it('names nobody', () => {
		const b = browser();
		signedInHere(b.cookies, 'avery@example.com');
		expect(b.value()).not.toContain('avery');
	});

	it('is nobody’s once altered', () => {
		const b = browser();
		signedInHere(b.cookies, 'avery@example.com');
		const [nonce, signature] = b.value().split('.');
		const flipped = (signature.at(-1) === 'A' ? 'B' : 'A') + signature.slice(0, -1);
		b.replace(`${nonce}.${flipped}`);
		expect(browserSignedInAs(b.cookies, 'avery@example.com')).toBeNull();
		b.replace(`${nonce}.${signature}~garbage~`);
		expect(browserSignedInAs(b.cookies, 'avery@example.com')).toBe(nonce);
	});

	it('is kept 400 days, out of a script’s reach, and sent only to the sign-in page', () => {
		const b = browser();
		signedInHere(b.cookies, 'avery@example.com');
		expect(b.options()).toEqual({
			path: '/login',
			httpOnly: true,
			sameSite: 'strict',
			secure: true,
			maxAge: 400 * 24 * 60 * 60
		});
	});
});
