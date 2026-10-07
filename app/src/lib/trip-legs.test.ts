import { describe, expect, it } from 'vitest';
import { driveKey, estimate, legsOf, shares, type Stop } from './trip-legs.ts';

const at = (entityId: string, siteId: string | null = `${entityId}-site`, askedThere = false) => ({
	entityId,
	siteId,
	askedThere
});
const stop = (...visits: ReturnType<typeof at>[]): Stop => ({ visits });
const miles = (...m: string[]) => m.map((x) => ({ miles: x }));
const who = (legs: ReturnType<typeof legsOf>) =>
	legs.map((l) => `${l.drive}:${l.entityId ?? '-'}:${l.rule}:${l.miles}`);

describe("a trip's legs, each to whoever caused it", () => {
	it('gives one client both ways, out and back', () => {
		expect(who(legsOf([stop(at('A'))], miles('14', '14')))).toEqual([
			'0:A:round_trip:14.00',
			'1:A:round_trip:14.00'
		]);
	});

	it('gives the drive to A to A, A to B to B, and the longer way back to B', () => {
		expect(who(legsOf([stop(at('A')), stop(at('B'))], miles('21', '22', '14')))).toEqual([
			'0:A:house_to_a:21.00',
			'1:B:a_to_b:22.00',
			'2:B:b_to_house:14.00'
		]);
	});

	it('splits a drive between two clients at one stop, there and back', () => {
		expect(who(legsOf([stop(at('H'), at('P'))], miles('32', '32')))).toEqual([
			'0:H:split:16.00',
			'0:P:split:16.00',
			'1:H:split:16.00',
			'1:P:split:16.00'
		]);
	});

	it('gives a client who asked once the driver was there nothing', () => {
		expect(who(legsOf([stop(at('H'), at('P', 'P-site', true))], miles('32', '32')))).toEqual([
			'0:H:round_trip:32.00',
			'1:H:round_trip:32.00'
		]);
	});

	it("gives nobody the drive to the business's own errand, or the way back from it", () => {
		const errand: Stop = { visits: [] };
		expect(who(legsOf([stop(at('A')), errand], miles('10', '3', '12')))).toEqual([
			'0:A:house_to_a:10.00',
			'1:-:unassigned:3.00',
			'2:-:unassigned:12.00'
		]);
	});

	it('gives an errand for a client to that client', () => {
		const forA = stop(at('A', null));
		expect(who(legsOf([forA, stop(at('A'))], miles('6', '4', '9')))).toEqual([
			'0:A:house_to_a:6.00',
			'1:A:a_to_b:4.00',
			'2:A:b_to_house:9.00'
		]);
	});

	it('gives a drive to whoever it was given to by hand, and says so', () => {
		const legs = legsOf(
			[stop(at('A')), stop(at('B'))],
			[{ miles: '21' }, { miles: '22', to: ['A'] }, { miles: '14', to: [] }]
		);
		expect(who(legs)).toEqual(['0:A:house_to_a:21.00', '1:A:chosen:22.00', '2:-:chosen:14.00']);
		expect(legs[1].siteId).toBe('A-site');
	});

	it('never bills more miles than were driven: a split adds up to the drive', () => {
		expect(shares('10', 3)).toEqual(['3.34', '3.33', '3.33']);
		expect(shares('0.01', 2)).toEqual(['0.01', '0.00']);
	});

	it('has no legs until every drive is there', () => {
		expect(legsOf([stop(at('A'))], miles('14'))).toEqual([]);
		expect(legsOf([], miles('14'))).toEqual([]);
	});
});

describe("a drive's miles before anyone types them", () => {
	const known = { [driveKey({ site: 'W' }, { site: 'C' })]: { miles: '22.00', on: '2026-09-03' } };
	const rounds = { W: '42', C: '28', X: null };

	it('is as it was last driven, either way round', () => {
		expect(estimate({ site: 'C' }, { site: 'W' }, known, rounds)).toEqual({
			miles: '22.0',
			from: 'last',
			on: '2026-09-03'
		});
	});

	it("is half the site's round trip between the base and the site", () => {
		expect(estimate('base', { site: 'W' }, known, rounds)?.miles).toBe('21.0');
		expect(estimate({ site: 'C' }, 'base', known, rounds)?.miles).toBe('14.0');
	});

	it('is nothing when neither is known', () => {
		expect(estimate('base', { site: 'X' }, known, rounds)).toBeNull();
		expect(estimate({ address: 'Home Depot' }, { site: 'W' }, known, rounds)).toBeNull();
	});
});
