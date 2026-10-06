import { describe, expect, it } from 'vitest';
import { eventsOf, type HistoryRow } from './line-history.ts';

const row = (field: string, from: string | null, to: string | null, at: string, by = 'avery') =>
	({ field, old_value: from, new_value: to, changed_by: by, changed_at: at }) satisfies HistoryRow;

describe("a line's history", () => {
	it('is its adding, each save that changed it, and its removal, oldest first', () => {
		const events = eventsOf([
			row('(added)', null, '{"description":"Cat6 plenum cable","qty":"147.0000"}', '09:50'),
			row('qty', '147.0000', '150.0000', '13:10', 'sam'),
			row('description', 'Cat6 plenum cable', 'Cat6 plenum cable, two drops', '13:10', 'sam'),
			row('amount', '54.680', '55.800', '13:10', 'sam'),
			row('seq', '3', '2', '13:10', 'sam'),
			row('qty', '150.0000', '152.0000', '16:05'),
			row('(deleted)', '{"description":"Cat6 plenum cable, two drops"}', null, '17:00')
		]);
		expect(events.map((e) => [e.what, e.who, e.at])).toEqual([
			['added', 'avery', '09:50'],
			['changed', 'sam', '13:10'],
			['changed', 'avery', '16:05'],
			['removed', 'avery', '17:00']
		]);
	});

	it('says what a save changed in the order the form has them, and nothing it says nothing by', () => {
		const [e] = eventsOf([
			row('amount', '54.680', '55.800', '13:10'),
			row('seq', '3', '2', '13:10'),
			row('qty', '147.0000', '150.0000', '13:10'),
			row('description', 'a', 'b', '13:10')
		]);
		expect(e.what === 'changed' && e.changes.map((c) => c.field)).toEqual([
			'description',
			'qty',
			'amount'
		]);
	});

	it('keeps two saves at different moments apart', () => {
		expect(eventsOf([row('qty', '1', '2', '10:00'), row('qty', '2', '3', '10:01')]).length).toBe(2);
	});
});
