import { describe, expect, it } from 'vitest';
import { toSlug } from './slug';

/**
 * These cases pin what toSlug makes. That the database accepts it is not
 * something a unit test can know -- scripts/schema-check.mjs puts the same
 * names to the column's CHECK, which is where that claim is actually checked.
 */
describe('toSlug', () => {
	it('lowercases and joins words with a single hyphen', () => {
		expect(toSlug('Harbor Light Dental')).toBe('harbor-light-dental');
		expect(toSlug('VALLEY OAK VETERINARY')).toBe('valley-oak-veterinary');
	});

	it('collapses a run of punctuation into one hyphen', () => {
		expect(toSlug('Harbor   Light   Dental')).toBe('harbor-light-dental');
		expect(toSlug("Harbor Light's Dental, Inc.")).toBe('harbor-light-s-dental-inc');
		expect(toSlug('8556 Gibson Ranch Park Rd')).toBe('8556-gibson-ranch-park-rd');
	});

	it('does not leave a hyphen at either end', () => {
		expect(toSlug('  Elverta  ')).toBe('elverta');
		expect(toSlug('...Elverta!!!')).toBe('elverta');
		expect(toSlug('-Elverta-')).toBe('elverta');
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

	// Idempotent: a slug comes back as itself, so one typed into the slug field
	// is kept as typed rather than moved.
	it('is idempotent: a slug is its own slug', () => {
		for (const name of [
			'Harbor Light Dental',
			"Harbor Light's Dental, Inc.",
			'8556 Gibson Ranch Park Rd',
			'Suite 210',
			''
		]) {
			expect(toSlug(toSlug(name))).toBe(toSlug(name));
		}
	});
});
