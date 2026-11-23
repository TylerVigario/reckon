import { describe, expect, it } from 'vitest';
import { kindRates, piecesFor } from './tax-areas.ts';

describe('the pieces a line keeps of its area’s', () => {
	const MEALS = '019a0000-0000-7000-8000-00000000000c';
	const GOODS = '019a0000-0000-7000-8000-00000000000a';
	// Boston: Massachusetts' 6.25% on everything it taxes, and 0.75% on meals.
	const boston = [
		{ level: 'state' as const, jurisdiction: 'Massachusetts', rate: '6.2500', kind: null },
		{ level: 'local' as const, jurisdiction: 'Boston', rate: '0.7500', kind: MEALS }
	];

	it('keeps those on every kind, and its own kind’s, saying its kind', () => {
		expect(piecesFor(boston, MEALS, true)).toEqual([
			{ level: 'state', jurisdiction: 'Massachusetts', rate: '6.2500' },
			{ level: 'local', jurisdiction: 'Boston', rate: '0.7500', kind: MEALS }
		]);
	});

	it('keeps none for another kind alone', () => {
		expect(piecesFor(boston, GOODS, true)).toEqual([
			{ level: 'state', jurisdiction: 'Massachusetts', rate: '6.2500' }
		]);
	});

	it('keeps its own kind’s alone where those on every kind do not fall on it', () => {
		expect(piecesFor(boston, MEALS, false)).toEqual([
			{ level: 'local', jurisdiction: 'Boston', rate: '0.7500', kind: MEALS }
		]);
	});
});

describe('what each kind an area taxes alone is taxed at there', () => {
	const MEALS = '019a0000-0000-7000-8000-00000000000c';
	const pieces = [
		{ level: 'state' as const, jurisdiction: 'Massachusetts', rate: '6.2500', kind: null },
		{ level: 'local' as const, jurisdiction: 'Springfield', rate: '0.7500', kind: MEALS }
	];

	it('the rate on every kind and its own, where the state taxes it', () => {
		expect(kindRates(pieces, [MEALS], { [MEALS]: 'Meals' })).toEqual([
			{
				kind: MEALS,
				name: 'Meals',
				rate: '7.0000',
				pieces: [
					{ level: 'state', jurisdiction: 'Massachusetts', rate: '6.2500' },
					{ level: 'local', jurisdiction: 'Springfield', rate: '0.7500' }
				]
			}
		]);
	});

	it('its own alone, where the state does not', () => {
		expect(kindRates(pieces, [], { [MEALS]: 'Meals' })[0]).toMatchObject({ rate: '0.7500' });
	});
});
