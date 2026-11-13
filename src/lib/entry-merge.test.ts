import { describe, expect, it } from 'vitest';
import type { EntryFields } from './entry-form.ts';
import { fieldsOfEntry, mergeEntry, samePart, withPart } from './entry-merge.ts';

const base: EntryFields = {
	worked_on: '2026-11-10',
	started_at: '2026-11-10T17:00:00Z',
	ended_at: '2026-11-10T19:30:00Z',
	zone: 'America/Los_Angeles',
	crew: 'one',
	worked_by: 'avery',
	entity_id: 'pinecrest',
	site_id: 'suite-210',
	service_id: 'field-service',
	billable: true,
	note: 'Replaced the switch'
};

describe('a change to a time entry made on a phone, merged part by part', () => {
	it('takes what only the phone changed, and keeps what only the server did', () => {
		const m = mergeEntry(
			base,
			{ ...base, note: 'Replaced the switch and the patch leads' },
			{ ...base, service_id: 'network-assessment' }
		);
		expect(m.collided).toEqual([]);
		expect([m.fields.note, m.fields.service_id]).toEqual([
			'Replaced the switch and the patch leads',
			'network-assessment'
		]);
		expect(m.from).toEqual({ note: 'phone', service: 'server' });
	});

	it('collides on a part both changed differently, and leaves it as the server has it', () => {
		const m = mergeEntry(base, { ...base, note: 'Phone' }, { ...base, note: 'Server' });
		expect(m.collided).toEqual(['note']);
		expect(m.fields.note).toBe('Server');
	});

	it('takes when it was worked whole: a start and an end are never from two sides', () => {
		const phone = { ...base, ended_at: '2026-11-10T20:00:00Z' };
		const server = { ...base, started_at: '2026-11-10T16:30:00Z' };
		const m = mergeEntry(base, phone, server);
		expect(m.collided).toEqual(['when']);
		expect([m.fields.started_at, m.fields.ended_at]).toEqual([
			'2026-11-10T16:30:00Z',
			'2026-11-10T19:30:00Z'
		]);
	});

	it('takes a site with its client, so a site is always one of its client’s', () => {
		const phone = { ...base, entity_id: 'harbor', site_id: 'harbor-main' };
		const m = mergeEntry(base, phone, { ...base, billable: false });
		expect([m.fields.entity_id, m.fields.site_id, m.fields.billable]).toEqual([
			'harbor',
			'harbor-main',
			false
		]);
	});

	it('has no collision where both made the same change, however it is written', () => {
		const m = mergeEntry(
			base,
			{ ...base, ended_at: '2026-11-10T20:00:00.000Z' },
			{ ...base, ended_at: '2026-11-10T20:00:00Z' }
		);
		expect(m.collided).toEqual([]);
	});

	it('reads a team as who was on it, in any order', () => {
		const team = { ...base, crew: 'team' as const, worked_by: null };
		expect(
			samePart('who', { ...team, crew_ids: ['a', 'b'] }, { ...team, crew_ids: ['b', 'a'] })
		).toBe(true);
		expect(samePart('who', { ...team, crew_ids: ['a', 'b'] }, base)).toBe(false);
	});

	it('moves a part from a length to a start and an end, and leaves nothing of the length', () => {
		const untimed: EntryFields = { ...base, minutes: 90 };
		delete untimed.started_at;
		delete untimed.ended_at;
		delete untimed.zone;
		const moved = withPart('when', untimed, base);
		expect(moved.minutes).toBeUndefined();
		expect(moved.started_at).toBe(base.started_at);
	});
});

describe('an entry as its form sends it', () => {
	it('is its moments where it kept them, and its day and minutes where it did not', () => {
		const row = {
			worked_on: '2026-11-10',
			seconds: 5400,
			started_at: null,
			ended_at: null,
			zone: null,
			crew: 'team' as const,
			worked_by: null,
			crew_ids: ['b', 'a'],
			entity_id: null,
			site_id: null,
			service_id: 's',
			billable: false,
			note: null
		};
		expect(fieldsOfEntry(row)).toEqual({
			worked_on: '2026-11-10',
			minutes: 90,
			crew: 'team',
			worked_by: null,
			crew_ids: ['a', 'b'],
			entity_id: null,
			site_id: null,
			service_id: 's',
			billable: false,
			note: null
		});
	});
});
