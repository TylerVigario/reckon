/**
 * A LINE'S HISTORY, as a person reads it: oldest first, one event to each
 * save -- who added it and what it was, each change with every field it moved,
 * its removal -- from the rows record_history keeps (0021).
 *
 * One save writes one row to each field it changes, all at the moment its
 * transaction began and against one person, so rows that share both are one
 * event.
 */

/** A row of record_history for one line. */
export type HistoryRow = {
	field: string;
	old_value: string | null;
	new_value: string | null;
	changed_by: string | null;
	changed_at: string;
};

/**
 * What a field is called, and what its value is, for the fields a person set
 * or sees billed. The rest -- where it sits, what it points at, how its tax was
 * sourced -- move only with these, and say nothing more.
 */
export const FIELDS = {
	description: { label: 'Description', is: 'text' },
	qty: { label: 'How much', is: 'quantity' },
	unit_price: { label: 'Price', is: 'price' },
	amount: { label: 'Charged', is: 'money' },
	tax_rate_pct: { label: 'Tax rate', is: 'rate' },
	site_id: { label: 'Where', is: 'site' },
	bought_from: { label: 'From', is: 'text' },
	ex_tax_cost: { label: 'Cost before tax', is: 'money' },
	tax_paid: { label: 'Tax paid', is: 'money' },
	paid_by: { label: 'Who paid', is: 'person' },
	receipt: { label: 'Receipt', is: 'receipt' }
} as const;
export type Field = keyof typeof FIELDS;

export type Change = { field: Field; from: string | null; to: string | null };

export type HistoryEvent =
	| { what: 'added'; who: string | null; at: string; was: Record<string, unknown> }
	| { what: 'changed'; who: string | null; at: string; changes: Change[] }
	| { what: 'removed'; who: string | null; at: string; was: Record<string, unknown> };

const json = (v: string | null): Record<string, unknown> => {
	try {
		const parsed: unknown = JSON.parse(v ?? '{}');
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
};

/** The rows, oldest first, as the events a person reads. */
export function eventsOf(rows: readonly HistoryRow[]): HistoryEvent[] {
	const events: HistoryEvent[] = [];
	for (const r of rows) {
		if (r.field === '(added)') {
			events.push({ what: 'added', who: r.changed_by, at: r.changed_at, was: json(r.new_value) });
			continue;
		}
		if (r.field === '(deleted)') {
			events.push({ what: 'removed', who: r.changed_by, at: r.changed_at, was: json(r.old_value) });
			continue;
		}
		if (!(r.field in FIELDS)) continue;
		const last = events.at(-1);
		const change = { field: r.field as Field, from: r.old_value, to: r.new_value };
		if (last?.what === 'changed' && last.at === r.changed_at && last.who === r.changed_by)
			last.changes.push(change);
		else events.push({ what: 'changed', who: r.changed_by, at: r.changed_at, changes: [change] });
	}
	// In the order a form has them, within each change.
	const order = Object.keys(FIELDS);
	for (const e of events)
		if (e.what === 'changed')
			e.changes.sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field));
	return events;
}
