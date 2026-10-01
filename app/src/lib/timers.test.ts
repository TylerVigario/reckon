import { describe, expect, it } from 'vitest';
import { toEntry, type Running } from './timers';

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
		expect(toEntry(timer(), 'me').client_uuid).toBe('0f0e0d0c-0000-4000-8000-000000000001');
	});

	it('dates the entry the day the timer started, on this calendar', () => {
		const late = new Date(2026, 2, 15, 1, 0).getTime();
		expect(toEntry(timer(), 'me', late).worked_on).toBe('2026-03-14');
	});

	it('counts whole minutes, and never none', () => {
		const t = timer();
		expect(toEntry(t, 'me', t.started_at + 95 * 60_000).minutes).toBe(95);
		expect(toEntry(t, 'me', t.started_at + 5_000).minutes).toBe(1);
	});

	it('names nobody on a team entry, and records who stopped it', () => {
		const e = toEntry(timer({ crew: 'team', worked_by: 'a' }), 'me');
		expect(e.worked_by).toBeNull();
		expect(e.created_by).toBe('me');
	});
});
