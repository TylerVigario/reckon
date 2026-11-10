import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	MAX_PASSWORD_LENGTH,
	MIN_PASSWORD_LENGTH,
	breached,
	lengthOf,
	weakness,
	wordsAbout
} from './password-rules.js';

const sha1 = (p: string) => createHash('sha1').update(p, 'utf8').digest('hex').toUpperCase();

/**
 * Pwned Passwords, answering as it does: every hash it holds under the prefix
 * asked, as the 35 characters after it and a count, and padding that counts 0.
 */
function pwned(seen: Record<string, number>) {
	const asked: { url: string; headers: Record<string, string> }[] = [];
	const fetch = vi.fn((url: string, init: { headers: Record<string, string> }) => {
		asked.push({ url, headers: init.headers });
		const prefix = url.slice(-5);
		const lines = Object.entries(seen)
			.filter(([p]) => sha1(p).startsWith(prefix))
			.map(([p, n]) => `${sha1(p).slice(5)}:${n}`);
		lines.push(`${'0'.repeat(35)}:0`, `${'F'.repeat(35)}:0`);
		return Promise.resolve(new Response(lines.join('\r\n')));
	});
	vi.stubGlobal('fetch', fetch);
	return asked;
}

const AVERY = { name: 'Avery Quinn', email: 'avery.quinn@kestrel.example' };
const KESTREL = { tradingName: 'Kestrel Field Services', shortName: 'Kestrel', email: null };
const about = wordsAbout(AVERY, KESTREL);
const GOOD = 'tundra-ladle-orbit-velvet';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('a password’s length', () => {
	it('counts each character once, as NIST does, whatever UTF-16 makes of it', () => {
		expect(lengthOf('🔑'.repeat(15))).toBe(15);
		expect('🔑'.repeat(15).length).toBe(30);
	});

	it('is fifteen at least and 128 at most', async () => {
		pwned({});
		expect(await weakness('x'.repeat(MIN_PASSWORD_LENGTH - 1), { about })).toBe('too_short');
		expect(await weakness('🔑'.repeat(MIN_PASSWORD_LENGTH - 1), { about })).toBe('too_short');
		expect(await weakness(`${GOOD}-🔑`, { about })).toBeNull();
		expect(await weakness('🔑'.repeat(MAX_PASSWORD_LENGTH), { about })).toBeNull();
		expect(await weakness('x'.repeat(MAX_PASSWORD_LENGTH + 1), { about })).toBe('too_long');
	});
});

describe('a common password', () => {
	it('is refused in any case, without asking Pwned Passwords', async () => {
		const asked = pwned({});
		expect(await weakness('1q2w3e4r5t6y7u8i', { about })).toBe('common');
		expect(await weakness('1Q2W3E4R5T6Y7U8I', { about })).toBe('common');
		expect(asked).toEqual([]);
	});
});

describe('a breached password', () => {
	it('is asked about by the first five characters of its SHA-1 alone, padded', async () => {
		const asked = pwned({ [GOOD]: 0 });
		await breached(GOOD);
		expect(asked).toEqual([
			{
				url: `https://api.pwnedpasswords.com/range/${sha1(GOOD).slice(0, 5)}`,
				headers: { 'Add-Padding': 'true', 'User-Agent': 'reckon' }
			}
		]);
	});

	it('is refused when Pwned Passwords has seen it, and only then', async () => {
		pwned({ 'seen-in-a-breach-somewhere': 3 });
		expect(await weakness('seen-in-a-breach-somewhere', { about })).toBe('breached');
		expect(await weakness(GOOD, { about })).toBeNull();
	});

	it('is not one that matched only a padded line', async () => {
		pwned({ [GOOD]: 0 });
		expect(await breached(GOOD)).toBe(false);
	});

	it('is asked about where PWNED_PASSWORDS_URL says', async () => {
		const asked = pwned({});
		await breached(GOOD, 'http://127.0.0.1:5180/range/');
		expect(asked[0].url).toBe(`http://127.0.0.1:5180/range/${sha1(GOOD).slice(0, 5)}`);
	});
});

describe('when Pwned Passwords cannot say', () => {
	const cases: [string, () => Promise<Response>][] = [
		['cannot be reached', () => Promise.reject(new TypeError('fetch failed'))],
		['answers an error', () => Promise.resolve(new Response('', { status: 503 }))],
		[
			'answers something else, as a captive portal would',
			() => Promise.resolve(new Response('<html><body>Sign in to the Wi-Fi</body></html>'))
		],
		['answers nothing', () => Promise.resolve(new Response(''))]
	];
	for (const [what, answer] of cases)
		it(`because it ${what}, the common list decides alone, and the log says so`, async () => {
			vi.stubGlobal('fetch', vi.fn(answer));
			const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
			expect(await breached(GOOD)).toBeNull();
			expect(await weakness(GOOD, { about })).toBeNull();
			expect(await weakness('1q2w3e4r5t6y7u8i', { about })).toBe('common');
			expect(warned).toHaveBeenCalledWith(expect.stringContaining('Pwned Passwords could not'));
			// Nothing of the password reaches the log.
			for (const [line] of warned.mock.calls) {
				expect(line).not.toContain(GOOD);
				expect(line).not.toContain(sha1(GOOD).slice(0, 5));
			}
		});

	it('it is given three seconds, no more', async () => {
		const timeout = vi.spyOn(AbortSignal, 'timeout');
		vi.stubGlobal(
			'fetch',
			vi.fn((_: string, init: { signal: AbortSignal }) =>
				Promise.reject(
					init.signal === timeout.mock.results[0]?.value
						? new DOMException('The operation timed out.', 'TimeoutError')
						: new Error('asked without the deadline')
				)
			)
		);
		const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(await breached(GOOD)).toBeNull();
		expect(timeout).toHaveBeenCalledWith(3000);
		expect(warned).toHaveBeenCalledWith(expect.stringContaining('timed out'));
	});
});

describe('a password made of the names', () => {
	it('of reckon, the business and the person, whatever is around them, is refused', async () => {
		pwned({});
		for (const p of [
			'Kestrel-Reckon-2026!',
			'avery.quinn.1990!!',
			'QuinnQuinnQuinn1',
			'kestrel field services',
			'avery@kestrel.example'
		])
			expect(await weakness(p, { about }), p).toBe('about_them');
	});

	it('is the whole password, never a name found inside one', async () => {
		pwned({});
		for (const p of ['a kestrel over the cliffs', 'averyquinnsdogrex', 'reckoning-day-at-dawn'])
			expect(await weakness(p, { about }), p).toBeNull();
	});

	it('takes nothing from a business with no names yet', async () => {
		pwned({});
		const alone = wordsAbout(AVERY);
		expect(alone).toEqual(new Set(['reckon', 'avery', 'quinn', 'kestrel', 'example']));
		expect(await weakness('reckon-reckon-reckon', { about: alone })).toBe('about_them');
	});
});
