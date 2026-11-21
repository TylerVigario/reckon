import { describe, expect, it } from 'vitest';
import { readByHand } from './line-fields.ts';

describe('a line’s tax set by hand, as the form says it', () => {
	it('is nothing where the form says nothing of it, so a line keeps its own', () => {
		expect(readByHand({ description: 'Cat6' })).toEqual({
			byHand: undefined,
			reason: null,
			errors: {}
		});
	});

	it('is as its kind is taxed where it is said empty, with no reason or rate', () => {
		expect(readByHand({ taxable: '', tax_rate_pct: '', tax_override_reason: '' })).toEqual({
			byHand: null,
			reason: null,
			errors: {}
		});
		expect(readByHand({ taxable: '', tax_override_reason: 'Resold' }).errors).toEqual({
			tax_override_reason: 'A reason goes with a tax set by hand.'
		});
	});

	it('is not taxed, or taxed at the site’s rate or another, each with why', () => {
		const why = 'Wire installed in the walls: the business is the consumer (Reg 1521).';
		expect(readByHand({ taxable: 'false', tax_override_reason: why })).toEqual({
			byHand: { taxed: false },
			reason: why,
			errors: {}
		});
		expect(readByHand({ taxable: 'true', tax_override_reason: 'Fabricated here' }).byHand).toEqual({
			taxed: true,
			ratePct: null
		});
		expect(
			readByHand({ taxable: 'true', tax_rate_pct: '4.0625', tax_override_reason: 'Partly exempt' })
				.byHand
		).toEqual({ taxed: true, ratePct: '4.0625' });
	});

	it('needs why, and takes a rate only where it is taxed, under 100', () => {
		expect(readByHand({ taxable: 'false' }).errors).toEqual({
			tax_override_reason: 'Why it is the exception — kept with the line, not on the invoice.'
		});
		expect(
			readByHand({ taxable: 'false', tax_rate_pct: '4', tax_override_reason: 'x' }).errors
		).toEqual({ tax_rate_pct: 'Not taxed is at no rate.' });
		expect(
			readByHand({ taxable: 'true', tax_rate_pct: '100', tax_override_reason: 'x' }).errors
		).toEqual({ tax_rate_pct: 'A percentage under 100: 4.6 for 4.6%.' });
		expect(readByHand({ taxable: 'maybe', tax_override_reason: 'x' }).errors).toEqual({
			taxable: 'Must be true or false.'
		});
	});
});
