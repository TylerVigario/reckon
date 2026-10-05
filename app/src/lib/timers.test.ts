import { describe, expect, it } from 'vitest';
import { toEntry, type Running } from './timers.ts';
import { secondsOf } from './queue.ts';

const timer = (over: Partial<Running> = {}): Running => ({
	id: '0f0e0d0c-0000-4000-8000-000000000001',
	started_at: new Date(2026, 2, 14, 9, 5).getTime(),
	crew: 'one',
	worked_by: 'a',
	entity_id: 'e',
	site_id: 's',
	service_id: 'v',
	billable: true,
	note: 'Rack moved',
	...over
});

describe('toEntry', () => {
	it('keeps the timer id, so a stop recorded twice is one entry', () => {
		expect(toEntry(timer(), 'me', 'UTC').client_uuid).toBe('0f0e0d0c-0000-4000-8000-000000000001');
	});

	// One moment, 01:30 UTC on 15 March: still the evening of the 14th in
	// California, already the afternoon of the 15th at UTC+14. The entry takes
	// the business's date for it, whatever zone the phone is set to.
	it("dates the entry the day the timer started, on the business's calendar", () => {
		const t = timer({ started_at: Date.UTC(2026, 2, 15, 1, 30) });
		expect(toEntry(t, 'me', 'America/Los_Angeles').worked_on).toBe('2026-03-14');
		expect(toEntry(t, 'me', 'Pacific/Kiritimati').worked_on).toBe('2026-03-15');
		expect(toEntry(t, 'me', 'UTC').worked_on).toBe('2026-03-15');
	});

	it('keeps the day it started, when it stops after midnight', () => {
		const t = timer({ started_at: Date.UTC(2026, 2, 14, 22, 0) });
		const late = Date.UTC(2026, 2, 15, 9, 0);
		expect(toEntry(t, 'me', 'UTC', late).worked_on).toBe('2026-03-14');
	});

	it('is the moment it started and the moment it stopped, in the zone it ran in', () => {
		const t = timer();
		const e = toEntry(t, 'me', 'Europe/London', t.started_at + 95 * 60_000 + 7_000);
		expect([e.started_at, e.ended_at, e.zone]).toEqual([
			new Date(t.started_at).toISOString(),
			new Date(t.started_at + 95 * 60_000 + 7_000).toISOString(),
			'Europe/London'
		]);
		expect(e.minutes).toBeUndefined();
		expect(secondsOf(e)).toBe(95 * 60 + 7);
	});

	it('never ends before it starts', () => {
		const t = timer();
		const e = toEntry(t, 'me', 'UTC', t.started_at);
		expect(Date.parse(e.ended_at!)).toBeGreaterThan(Date.parse(e.started_at!));
	});

	it('names nobody on a team entry, and records who stopped it', () => {
		const e = toEntry(timer({ crew: 'team', worked_by: 'a' }), 'me', 'UTC');
		expect(e.worked_by).toBeNull();
		expect(e.created_by).toBe('me');
	});
});
