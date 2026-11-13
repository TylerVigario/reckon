import { describe, expect, it } from 'vitest';
import { readCountLine, shelfAfter } from './count-fields.ts';

describe('a material counted', () => {
	it('is how many are there, none included', () => {
		expect(readCountLine({ counted: '55', cost_each: '' }, 2).errors).toEqual({});
		expect(readCountLine({ counted: '0', cost_each: '' }, 2).errors).toEqual({});
	});

	it('is counted in its unit', () => {
		expect(readCountLine({ counted: '2.5', cost_each: '' }, 0).errors.counted).toBe(
			'Whole numbers in this unit.'
		);
		expect(readCountLine({ counted: '-1', cost_each: '' }, 2).errors.counted).toBeTruthy();
		expect(readCountLine({ counted: '', cost_each: '' }, 2).errors.counted).toBe(
			'How many are there.'
		);
	});

	it('may say what one cost', () => {
		const { values, errors } = readCountLine({ counted: '4', cost_each: '1.24' }, 0);
		expect(errors).toEqual({});
		expect(values.cost_each).toBe('1.24');
	});
});

describe('what a count makes of the shelf', () => {
	it('is what was counted, where the shelf has not moved', () => {
		expect(shelfAfter({ counted: '55', was: '60' }, '60')?.toString()).toBe('55');
		expect(shelfAfter({ counted: '55', was: '60' }, '60', 'difference')?.toString()).toBe('55');
	});

	it('is what was counted, kept, where it moved since', () => {
		expect(shelfAfter({ counted: '55', was: '60' }, '50', 'counted')?.toString()).toBe('55');
	});

	it('is the difference found applied to the shelf now, kept so', () => {
		// 5 short when counted; 10 drawn since: 45, not 55.
		expect(shelfAfter({ counted: '55', was: '60' }, '50', 'difference')?.toString()).toBe('45');
		expect(shelfAfter({ counted: '62', was: '60' }, '50', 'difference')?.toString()).toBe('52');
	});

	it('is nothing it cannot be: less than none', () => {
		expect(shelfAfter({ counted: '0', was: '60' }, '50', 'difference')).toBeNull();
	});
});
