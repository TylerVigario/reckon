import { describe, expect, it } from 'vitest';
import { readNewService } from './service-fields.ts';

describe('a new service', () => {
	it('is a name and what it is charged per, with no price yet', () => {
		const { values, errors } = readNewService({
			name: 'Cable pulling',
			unit: 'hour',
			rate: '',
			additional_rate: ''
		});
		expect(errors).toEqual({});
		expect([values.rate, values.additional_rate]).toEqual([null, '0']);
	});

	it('may say what every client pays: the first person, and each one after', () => {
		const { values, errors } = readNewService({
			name: 'Cable pulling',
			unit: 'hour',
			rate: '80',
			additional_rate: '50'
		});
		expect(errors).toEqual({});
		expect([values.rate, values.additional_rate]).toEqual(['80', '50']);
	});

	it('does not price each one after with no first', () => {
		expect(
			readNewService({ name: 'Cable pulling', unit: 'hour', rate: '', additional_rate: '50' })
				.errors.rate
		).toBeTruthy();
	});
});
