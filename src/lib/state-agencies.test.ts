import { describe, expect, it } from 'vitest';
import { AGENCY } from './state-agencies.ts';
import { COLLECTABLE, typesAreas } from './us-states.ts';

describe('where each state publishes its rates', () => {
	it('names an agency and its rates for every state whose areas are typed', () => {
		const typed = COLLECTABLE.filter(typesAreas);
		expect(typed.filter((s) => !AGENCY[s])).toEqual([]);
		expect(typed.length).toBe(47);
	});

	it('links only somebody else’s pages, over https', () => {
		for (const a of Object.values(AGENCY)) {
			expect(new URL(a.rates).protocol).toBe('https:');
			if (a.lookup) expect(new URL(a.lookup).protocol).toBe('https:');
		}
	});
});
