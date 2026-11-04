import { describe, expect, it } from 'vitest';
import type { RouteId } from '$app/types';
import { ACCESS, REACH, opens, reaches } from './access.ts';

const routes = Object.keys(REACH) as RouteId[];
const needing = (need: string) => routes.filter((r) => REACH[r] === need).sort();

describe('who reaches a route', () => {
	it('gives Full every route', () => {
		expect(routes.every((r) => reaches('full', REACH[r]))).toBe(true);
	});

	it("gives Field what is open and what is Field's, and nothing that is Full's", () => {
		for (const r of routes) expect(reaches('field', REACH[r])).toBe(REACH[r] !== 'full');
	});

	it('opens without signing in only the sign-in page, what it uses, and the client link', () => {
		expect(needing('open')).toEqual(
			[
				'/login',
				'/manifest.webmanifest',
				'/operator/logo',
				'/operator/theme.css',
				'/invoice/[token]'
			].sort()
		);
	});

	// Written out a second time on purpose: widening what Field reaches is then a
	// change made in two places, and a review sees it twice.
	it('gives Field their own work and pay, and these routes alone', () => {
		expect(needing('field')).toEqual(
			[
				'/',
				'/refused',
				'/more',
				'/profile',
				'/logout',
				'/api/device',
				'/api/reachable',
				'/api/offline',
				'/api/people/[id]',
				'/timesheet',
				'/timesheet/all',
				'/timesheet/manual',
				'/timesheet/start',
				'/api/time',
				'/api/time/[id]',
				'/trips',
				'/trips/[id]',
				'/trips/[id]/change',
				'/trips/new',
				'/api/trips',
				'/api/trips/[id]',
				'/api/trips/route',
				'/api/trips/worth',
				'/invoices',
				'/invoices/[id]',
				'/invoices/[id]/add',
				'/invoices/[id]/lines/[line]',
				'/invoices/[id]/lines/[line]/change',
				'/invoices/[id]/lines/[line]/receipt',
				'/api/lines',
				'/api/lines/[id]',
				'/api/lines/[id]/restore',
				'/clients',
				'/clients/contacts',
				'/clients/[id]',
				'/clients/[id]/sites',
				'/clients/[id]/sites/[site]',
				'/reports/pay/[person]',
				'/reports/pay/payments/[id]'
			].sort()
		);
	});

	it('knows the two levels, Full above Field', () => {
		expect(ACCESS).toEqual(['full', 'field']);
	});

	it('offers someone signed out only what is open', () => {
		expect(opens(null, '/login')).toBe(true);
		expect(opens(null, '/')).toBe(false);
		expect(opens('field', '/timesheet')).toBe(true);
		expect(opens('field', '/settings')).toBe(false);
		expect(opens('full', '/settings')).toBe(true);
	});
});
