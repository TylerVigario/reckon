/**
 * A MATERIAL'S HISTORY, as a person reads it: newest first, one event to each
 * save -- when it was added, each change to what it is, what it sells at, and
 * its retiring and offering again -- from the rows record_history keeps for
 * the material and for its prices (0055).
 *
 * One save is one transaction (xact), whose rows all belong together: going
 * back to a markup from a set price writes the price's end and the markup in
 * one. What the material's history says is its own words, never a column's
 * name.
 */

/** A row of record_history for the material, or for one of its prices. */
export type MaterialHistoryRow = {
	table: 'material' | 'material_price';
	field: string;
	old_value: string | null;
	new_value: string | null;
	changed_by: string | null;
	changed_at: string;
	xact: number | null;
	/** For a price, the day it is from. */
	effective_from?: string | null;
};

/** The details a person set, in the order the Details tab has them. */
export const DETAILS = {
	name: 'Name',
	brand: 'Brand',
	sku: 'SKU',
	unit_id: 'Counted in',
	taxable: 'Taxed'
} as const;
export type Detail = keyof typeof DETAILS;

export type MaterialEvent = {
	who: string | null;
	at: string;
	/** Added; retired or offered again, where the save did that. */
	added: Record<string, unknown> | null;
	offered: boolean | null;
	changes: { field: Detail; from: string | null; to: string | null }[];
	/** Its own markup, where the save changed it: null is the business's. */
	markup: { from: string | null; to: string | null } | null;
	/** A set price from a day, where the save gave one; price null is back to the markup. */
	priced: { price: string | null; from: string } | null;
};

const json = (v: string | null): Record<string, unknown> => {
	try {
		const parsed: unknown = JSON.parse(v ?? '{}');
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
};
const text = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);

/** The rows, in any order, as the events a person reads, newest first. */
export function materialEvents(rows: readonly MaterialHistoryRow[]): MaterialEvent[] {
	const sorted = [...rows].sort((a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at));
	const events: MaterialEvent[] = [];
	const bySave = new Map<string, MaterialEvent>();
	for (const r of sorted) {
		// Rows of one transaction are one save; with none, one moment and one person.
		const key = r.xact !== null ? `x${r.xact}` : `t${r.changed_at}|${r.changed_by ?? ''}`;
		let e = bySave.get(key);
		if (!e) {
			e = {
				who: r.changed_by,
				at: r.changed_at,
				added: null,
				offered: null,
				changes: [],
				markup: null,
				priced: null
			};
			bySave.set(key, e);
			events.push(e);
		}
		if (r.table === 'material_price') {
			// A price given, or today's given again the same day.
			const from = r.effective_from ?? text(json(r.new_value).effective_from);
			if (from && r.field === '(added)') e.priced = { price: text(json(r.new_value).price), from };
			else if (from && r.field === 'price') e.priced = { price: r.new_value, from };
			continue;
		}
		if (r.field === '(added)') e.added = json(r.new_value);
		else if (r.field === 'active') e.offered = r.new_value === 'true';
		else if (r.field === 'markup_pct') e.markup = { from: r.old_value, to: r.new_value };
		else if (r.field in DETAILS)
			e.changes.push({ field: r.field as Detail, from: r.old_value, to: r.new_value });
	}
	const order = Object.keys(DETAILS);
	for (const e of events) e.changes.sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field));
	// Only what a person reads: a save that moved nothing said here is left out.
	return events
		.filter((e) => e.added || e.offered !== null || e.changes.length || e.markup || e.priced)
		.reverse();
}
