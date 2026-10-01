import { describe, expect, it } from 'vitest';
import type { Tx } from './db';
import { insertNamed } from './slugs';

/**
 * A transaction that holds the slugs already taken, refusing a taken one the
 * way Postgres does: a unique violation, under Drizzle's wrapper, naming its
 * constraint.
 */
function holding(...taken: string[]) {
	const tried: string[] = [];
	const tx = {
		transaction: <T>(fn: (sp: Tx) => Promise<T>) => fn(tx as unknown as Tx)
	};
	const insert = (_: Tx, slug: string) => {
		tried.push(slug);
		if (taken.includes(slug))
			return Promise.reject(
				Object.assign(new Error('Failed query'), {
					cause: { code: '23505', constraint: 'entity_slug_key' }
				})
			);
		taken.push(slug);
		return Promise.resolve(slug);
	};
	return { tx: tx as unknown as Tx, insert, tried };
}

const named = (from: string, given: string | null = null) => ({
	given,
	from,
	fallback: 'client',
	constraint: 'entity_slug_key'
});

describe('a slug is made from the name, and numbered when it is taken', () => {
	it('is the name as it reads in a URL', async () => {
		const { tx, insert } = holding();
		expect(await insertNamed(tx, named('Harbor Light Dental'), insert)).toBe('harbor-light-dental');
	});
	it('numbers the second -2 and the third -3', async () => {
		const { tx, insert, tried } = holding('harbor-light-dental', 'harbor-light-dental-2');
		expect(await insertNamed(tx, named('Harbor Light Dental'), insert)).toBe(
			'harbor-light-dental-3'
		);
		expect(tried).toEqual([
			'harbor-light-dental',
			'harbor-light-dental-2',
			'harbor-light-dental-3'
		]);
	});
	it('falls back to a word when the name has nothing usable in it', async () => {
		const { tx, insert } = holding();
		expect(await insertNamed(tx, named('!!!'), insert)).toBe('client');
	});
	it('takes a slug that was given as it is, and lets its clash through', async () => {
		const { tx, insert } = holding('woodland');
		await expect(insertNamed(tx, named('Anything', 'woodland'), insert)).rejects.toThrow(
			'Failed query'
		);
	});
	it('lets any other refusal through rather than retrying it', async () => {
		const tx = {
			transaction: <T>(fn: (sp: Tx) => Promise<T>) => fn(tx)
		} as unknown as Tx;
		const refused = Object.assign(new Error('Failed query'), {
			cause: { code: '23514', constraint: 'entity_slug_is_a_slug' }
		});
		await expect(insertNamed(tx, named('Anything'), () => Promise.reject(refused))).rejects.toBe(
			refused
		);
	});
});
