import { describe, expect, it } from 'vitest';
import { numberFrom } from './numbering.ts';

describe("an invoice's number, from the format", () => {
	it('puts the number where the zeros are, padded to them', () => {
		expect(numberFrom('INV-0000', 12)).toBe('INV-0012');
		expect(numberFrom('000000', 7)).toBe('000007');
	});

	it('lets a number outgrow its padding', () => {
		expect(numberFrom('INV-0000', 12345)).toBe('INV-12345');
	});

	it('takes the last run of zeros, so a year in the format stays a year', () => {
		expect(numberFrom('2026-0000', 12)).toBe('2026-0012');
		expect(numberFrom('KFS-000-A', 4)).toBe('KFS-004-A');
	});
});
