import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next.ts';

const SITE = 'https://reckon.example';

describe('safeNext', () => {
	it('keeps a page on this site, with its query and fragment', () => {
		expect(safeNext('/timesheet', SITE)).toBe('/timesheet');
		expect(safeNext('/timesheet/manual?fix=abc#top', SITE)).toBe('/timesheet/manual?fix=abc#top');
	});

	it('sends home anything a browser would read as another site', () => {
		for (const next of [
			'//example.com/',
			'/\\example.com/',
			'/\t/example.com/',
			'/\\/example.com/',
			'https://example.com/',
			'javascript:alert(1)'
		])
			expect(safeNext(next, SITE), JSON.stringify(next)).toBe('/');
	});

	it('keeps an escaped backslash, which is only a path on this site', () => {
		expect(safeNext('/%5Cexample.com', SITE)).toBe('/%5Cexample.com');
	});

	it('sends home when there is nothing to go to', () => {
		for (const next of [null, undefined, '', 'timesheet', 42])
			expect(safeNext(next, SITE)).toBe('/');
	});
});
