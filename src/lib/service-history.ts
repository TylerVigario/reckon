/**
 * A SERVICE'S HISTORY, as a person reads it: newest first, one event to each
 * save (#lib/history-saves) -- when it was added, each change to what it is,
 * its retiring and offering again, and its deletion -- from the rows
 * record_history keeps for it (0059). Its prices and pay rules are read as
 * the days each was in force, beside this.
 */
import { inSaves, whole } from './history-saves.ts';

export type ServiceHistoryRow = {
	field: string;
	old_value: string | null;
	new_value: string | null;
	changed_by: string | null;
	changed_at: string;
	xact: number | null;
};

/** The details a person set, in the order the Details tab has them. */
export const SERVICE_DETAILS = {
	name: 'Name',
	unit: 'Charged per',
	bill_to_nearest_seconds: 'Billed to',
	minimum_charge: 'Minimum charge',
	time_tracked: 'On the timer',
	taxable: 'Taxable'
} as const;
export type ServiceDetail = keyof typeof SERVICE_DETAILS;

export type ServiceEvent = {
	who: string | null;
	at: string;
	added: Record<string, unknown> | null;
	removed: Record<string, unknown> | null;
	offered: boolean | null;
	changes: { field: ServiceDetail; from: string | null; to: string | null }[];
};

/** The rows, in any order, as the events a person reads, newest first. */
export function serviceEvents(rows: readonly ServiceHistoryRow[]): ServiceEvent[] {
	const events = inSaves(
		rows,
		(r): ServiceEvent => ({
			who: r.changed_by,
			at: r.changed_at,
			added: null,
			removed: null,
			offered: null,
			changes: []
		}),
		(e, r) => {
			if (r.field === '(added)') e.added = whole(r.new_value);
			else if (r.field === '(deleted)') e.removed = whole(r.old_value);
			else if (r.field === 'active') e.offered = r.new_value === 'true';
			else if (r.field in SERVICE_DETAILS)
				e.changes.push({ field: r.field as ServiceDetail, from: r.old_value, to: r.new_value });
		}
	);
	const order = Object.keys(SERVICE_DETAILS);
	for (const e of events) e.changes.sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field));
	return events
		.filter((e) => e.added || e.removed || e.offered !== null || e.changes.length)
		.reverse();
}
