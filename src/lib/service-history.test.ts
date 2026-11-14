import { describe, expect, it } from 'vitest';
import { serviceEvents, type ServiceHistoryRow } from './service-history.ts';

const row = (over: Partial<ServiceHistoryRow>): ServiceHistoryRow => ({
	field: 'name',
	old_value: null,
	new_value: null,
	changed_by: 'avery',
	changed_at: '2026-11-14T15:00:00.000Z',
	xact: 1,
	...over
});

describe('a service’s history', () => {
	it('is newest first, one event to each save, its changes in the order Details has them', () => {
		const events = serviceEvents([
			row({ field: '(added)', new_value: '{"name":"Cable pulling","unit":"hour"}', xact: 1 }),
			row({
				field: 'taxable',
				old_value: 'false',
				new_value: 'true',
				xact: 2,
				changed_at: '2026-11-14T16:00:00.000Z'
			}),
			row({
				field: 'name',
				old_value: 'Cable pulling',
				new_value: 'Cable runs',
				xact: 2,
				changed_at: '2026-11-14T16:00:00.000Z'
			})
		]);
		expect(events).toHaveLength(2);
		expect(events[0].changes.map((c) => c.field)).toEqual(['name', 'taxable']);
		expect(events[1].added?.name).toBe('Cable pulling');
	});

	it('says retiring, and leaves out what it does not say', () => {
		const events = serviceEvents([
			row({ field: 'active', old_value: 'true', new_value: 'false', xact: 3 }),
			row({ field: 'code', old_value: 'a', new_value: 'b', xact: 4 }),
			row({ field: 'client_uuid', new_value: 'x', xact: 5 })
		]);
		expect(events).toHaveLength(1);
		expect(events[0].offered).toBe(false);
	});
});
