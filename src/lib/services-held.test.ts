import { describe, expect, it } from 'vitest';
import { pricesAdded, servicesAdded } from './services-held.ts';
import type { ServiceEntry } from './queue.ts';

const field = { id: 's1', name: 'Field service', unit: 'hour' };
const added = (over: Partial<ServiceEntry['fields']> = {}): ServiceEntry => ({
	client_uuid: 'u1',
	fields: { name: 'Cable pulling', unit: 'hour', rate: '80', additional_rate: '50', ...over },
	from: '2026-11-13'
});

describe('a service added on this phone', () => {
	it('is offered at once, by the uuid made for it, among the rest by name', () => {
		const offered = servicesAdded([field], [added()], (s) => ({
			id: s.client_uuid,
			name: s.fields.name,
			unit: s.fields.unit
		}));
		expect(offered.map((s) => s.id)).toEqual(['u1', 's1']);
	});

	it('is offered only where it fits: a trip’s miles take a service by the mile', () => {
		const miles = servicesAdded(
			[],
			[added(), added({ unit: 'mile' })].map((s, i) => ({ ...s, client_uuid: `u${i}` })),
			(s) => ({ id: s.client_uuid, name: s.fields.name }),
			(s) => s.fields.unit === 'mile'
		);
		expect(miles.map((s) => s.id)).toEqual(['u1']);
	});

	it('is priced for every client, the first person and each one after', () => {
		const [p] = pricesAdded([], [added()], 3);
		expect(p).toEqual({ service_id: 'u1', entity_id: null, byHeads: [null, '80', '130', '180'] });
	});

	it('has no price where none was given', () => {
		expect(pricesAdded([], [added({ rate: '', additional_rate: '0' })], 2)).toEqual([]);
	});
});
