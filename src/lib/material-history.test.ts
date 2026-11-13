import { describe, expect, it } from 'vitest';
import { materialEvents, type MaterialHistoryRow } from './material-history.ts';

const ROBIN = '00000000-0000-4000-8000-000000000001';
const row = (over: Partial<MaterialHistoryRow>): MaterialHistoryRow => ({
	table: 'material',
	field: 'name',
	old_value: null,
	new_value: null,
	changed_by: ROBIN,
	changed_at: '2026-11-13T15:00:00.000Z',
	xact: 1,
	...over
});

describe('a material’s history', () => {
	it('is newest first, one event to each save', () => {
		const events = materialEvents([
			row({ field: '(added)', new_value: '{"name":"Cable","unit_id":"u"}', xact: 1 }),
			row({
				field: 'name',
				old_value: 'Cable',
				new_value: '12/2 Romex',
				changed_at: '2026-11-13T16:00:00.000Z',
				xact: 2
			}),
			row({
				field: 'brand',
				old_value: null,
				new_value: 'Southwire',
				changed_at: '2026-11-13T16:00:00.000Z',
				xact: 2
			})
		]);
		expect(events).toHaveLength(2);
		expect(events[0].changes.map((c) => c.field)).toEqual(['name', 'brand']);
		expect(events[1].added?.name).toBe('Cable');
	});

	it('reads a return to the markup with the end of the price it had', () => {
		const [e] = materialEvents([
			row({
				table: 'material_price',
				field: '(added)',
				new_value: '{"price":null,"effective_from":"2026-11-13"}',
				xact: 7
			}),
			row({ field: 'markup_pct', old_value: null, new_value: '40.0000', xact: 7 })
		]);
		expect(e.priced).toEqual({ price: null, from: '2026-11-13' });
		expect(e.markup).toEqual({ from: null, to: '40.0000' });
	});

	it('reads a price given again the same day as the price it is now', () => {
		const [e] = materialEvents([
			row({
				table: 'material_price',
				field: 'price',
				old_value: '4.5000',
				new_value: '4.7500',
				effective_from: '2026-11-13',
				xact: 9
			})
		]);
		expect(e.priced).toEqual({ price: '4.7500', from: '2026-11-13' });
	});

	it('says retiring and offering again, and leaves out what it does not say', () => {
		const events = materialEvents([
			row({ field: 'active', old_value: 'true', new_value: 'false', xact: 3 }),
			row({ field: 'reorder_level', old_value: null, new_value: '10', xact: 4 })
		]);
		expect(events).toHaveLength(1);
		expect(events[0].offered).toBe(false);
	});
});
