import { describe, expect, it } from 'vitest';
import { insertNamed } from './slugs.ts';

/**
 * A table that holds the slugs already taken, as Postgres does: a made slug
 * already there inserts no row (ON CONFLICT ... DO NOTHING), and a given one
 * is refused with a unique violation naming its constraint.
 */
function holding(...taken: string[]) {
	const tried: string[] = [];
	const insert = (slug: string, made: boolean) => {
		tried.push(slug);
		if (taken.includes(slug))
			return made
				? Promise.resolve(undefined)
				: Promise.reject(
						Object.assign(new Error('duplicate key'), {
							code: '23505',
							constraint: 'entity_slug_key'
						})
					);
		taken.push(slug);
		return Promise.resolve(slug);
	};
	return { insert, tried };
}

const named = (from: string, given: string | null = null) => ({ given, from, fallback: 'client' });

describe('a slug is made from the name, and numbered when it is taken', () => {
	it('is the name as it reads in a URL', async () => {
		const { insert } = holding();
		expect(await insertNamed(named('Harbor Light Dental'), insert)).toBe('harbor-light-dental');
	});
	it('numbers the second -2 and the third -3', async () => {
		const { insert, tried } = holding('harbor-light-dental', 'harbor-light-dental-2');
		expect(await insertNamed(named('Harbor Light Dental'), insert)).toBe('harbor-light-dental-3');
		expect(tried).toEqual([
			'harbor-light-dental',
			'harbor-light-dental-2',
			'harbor-light-dental-3'
		]);
	});
	it('falls back to a word when the name has nothing usable in it', async () => {
		const { insert } = holding();
		expect(await insertNamed(named('!!!'), insert)).toBe('client');
	});
	it('takes a slug that was given as it is, and lets its clash through', async () => {
		const { insert, tried } = holding('woodland');
		await expect(insertNamed(named('Anything', 'woodland'), insert)).rejects.toThrow(
			'duplicate key'
		);
		expect(tried).toEqual(['woodland']);
	});
	it('lets any other refusal through rather than retrying it', async () => {
		const refused = Object.assign(new Error('check'), {
			code: '23514',
			constraint: 'entity_slug_is_a_slug'
		});
		await expect(insertNamed(named('Anything'), () => Promise.reject(refused))).rejects.toBe(
			refused
		);
	});
});
