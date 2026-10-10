import { describe, expect, it } from 'vitest';
import { merge, same } from './line-merge.ts';

const base = { description: 'Cat6 plenum cable', qty: '147', site_id: 's1', ex_tax_cost: '' };

describe('a change made on a phone, merged field by field', () => {
	it('takes what only the phone changed, and keeps what only the server did', () => {
		const m = merge(
			base,
			{ ...base, qty: '152' },
			{ ...base, description: 'Cat6 plenum cable, two drops' }
		);
		expect(m.collided).toEqual([]);
		expect([m.fields.qty, m.fields.description]).toEqual(['152', 'Cat6 plenum cable, two drops']);
		expect(m.from).toEqual({ qty: 'phone', description: 'server' });
	});

	it('collides on a field both changed differently', () => {
		const m = merge(base, { ...base, qty: '152' }, { ...base, qty: '150' });
		expect(m.collided).toEqual(['qty']);
		// What collided is left as the server has it until a person picks.
		expect(m.fields.qty).toBe('150');
	});

	it('has no collision where both made the same change, however it is written', () => {
		const m = merge(base, { ...base, qty: '150' }, { ...base, qty: '150.0000' });
		expect(m.collided).toEqual([]);
	});

	it('reads nothing and an empty box as the same', () => {
		expect(same('bought_from', undefined, '')).toBe(true);
		expect(same('ex_tax_cost', '30', '30.00')).toBe(true);
		expect(same('description', '30', '30.00')).toBe(false);
	});
});
