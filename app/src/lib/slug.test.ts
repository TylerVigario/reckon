import { describe, expect, it } from 'vitest';
import { toSlug } from './slug';

/**
 * The same rule as slugify() in the database, on purpose and in both places.
 *
 * These cases pin what this side does. That the OTHER side agrees is not
 * something a unit test can know -- scripts/schema-check.mjs asks Postgres the
 * same questions and compares, which is where that claim is actually checked.
 */
describe('toSlug', () => {
	it('lowercases and joins words with a single hyphen', () => {
		expect(toSlug('Bravo Farms')).toBe('bravo-farms');
		expect(toSlug('WILD JACKS')).toBe('wild-jacks');
	});

	it('collapses a run of punctuation into one hyphen', () => {
		expect(toSlug('Bravo   Farms')).toBe('bravo-farms');
		expect(toSlug("Bravo's Farms, Inc.")).toBe('bravo-s-farms-inc');
		expect(toSlug('36005 CA-99 N')).toBe('36005-ca-99-n');
	});

	it('does not leave a hyphen at either end', () => {
		expect(toSlug('  Traver  ')).toBe('traver');
		expect(toSlug('...Traver!!!')).toBe('traver');
		expect(toSlug('-Traver-')).toBe('traver');
	});

	it('keeps digits, because a site name is often a number', () => {
		expect(toSlug('Shop 4')).toBe('shop-4');
	});

	// A name that is entirely punctuation has no slug. The caller has to notice
	// rather than save an empty one -- the column is unique, and two empties
	// collide.
	it('gives nothing back when there is nothing to make a slug from', () => {
		expect(toSlug('!!!')).toBe('');
		expect(toSlug('')).toBe('');
	});

	// Idempotent, which is what the CHECK constraint asserts: slug must equal
	// slugify(slug). A slug that changes when re-slugified could never be saved.
	it('is idempotent, which is what the column CHECK requires', () => {
		for (const name of ['Bravo Farms', "Bravo's Farms, Inc.", '36005 CA-99 N', 'Shop 4', '']) {
			expect(toSlug(toSlug(name))).toBe(toSlug(name));
		}
	});
});
