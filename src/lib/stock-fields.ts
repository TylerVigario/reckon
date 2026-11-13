/**
 * What may be said about stock received: a receipt or invoice, and the items
 * on it -- each a material already stocked, or one new to the catalogue.
 *
 * A receipt is what is printed once: the day it arrived, from whom, its
 * number, who paid -- a person, who is owed it back, or the business -- and
 * the tax it charged, all of it. An item is what the receipt says of one
 * thing: how many, how many of the material's own unit each holds (a pack of
 * 50, or one), and its price, for each or for all of them (#lib/receipt-split
 * turns it into what goes on the shelf). Each item becomes a lot; the
 * receipt's tax is split over them by what each cost.
 *
 * The receipt's keys are its columns' own names, as every registry's are.
 */
import {
	anId,
	cap,
	decimal,
	isoDate,
	money,
	oneOf,
	optional,
	orDefault,
	parseAll,
	required
} from './field-rules.ts';
import { itemTotals } from './receipt-split.ts';

export const RECEIPT_FIELDS = {
	received_on: required('Which day it arrived.', isoDate),
	supplier: optional(cap(80)),
	reference: optional(cap(40)),
	// Empty is the business.
	paid_by: optional(anId),
	tax_paid: orDefault('0', money)
};

/** A material named while it is received: what it is, and what it is counted in. */
export const NEW_MATERIAL_FIELDS = {
	name: required('What it is.', cap(120)),
	unit_id: required('What it is counted in.', anId)
};

/** One item, as the receipt prints it. Not columns: what the lot is made from. */
export const ITEM_FIELDS = {
	// Empty is something new, named by NEW_MATERIAL_FIELDS.
	material_id: optional(anId),
	count: required('How many.', decimal(12, 4)),
	// Empty is one: sold singly.
	per: optional(decimal(12, 4)),
	price: required('What it cost before tax.', money),
	price_is: required('For each, or for all of them.', oneOf(['each', 'all']))
};

/** The most items one receipt takes: more is not a receipt someone typed in. */
export const MOST_ITEMS = 40;

export type ReadItem = {
	material_id: string | null;
	/** Something new to the catalogue, where material_id is null. */
	material: { name: string; unit_id: string } | null;
	/** How much of the material's unit arrived, and what all of it cost before tax. */
	qty: string;
	cost: string;
};

/**
 * One item as a whole: what each field says, a material or a new one named,
 * something received, no more places in the quantity than its unit counts in
 * (`places`, or null where no unit is known yet), and what it cost, to the
 * currency's `money` places. Its complaints are keyed by field.
 */
export function readItem(
	raw: Record<string, unknown>,
	places: number | null,
	money: number
): { item: ReadItem | null; errors: Record<string, string> } {
	const item = parseAll(ITEM_FIELDS, raw);
	const named = item.values.material_id === null;
	const fresh = named ? parseAll(NEW_MATERIAL_FIELDS, raw) : null;
	const errors: Record<string, string> = { ...item.errors, ...(fresh?.errors ?? {}) };
	if (Object.keys(item.errors).length) return { item: null, errors };
	const v = item.values;
	if (v.per !== null && !/[1-9]/.test(String(v.per)))
		return { item: null, errors: { ...errors, per: 'A pack holds something.' } };
	const totals = itemTotals(
		{
			count: String(v.count),
			per: v.per === null ? '' : String(v.per),
			price: String(v.price),
			priceIs: v.price_is === 'each' ? 'each' : 'all'
		},
		money
	);
	if (!totals)
		return { item: null, errors: { ...errors, count: 'Something has to have arrived.' } };
	const why = countError(totals.qty, places, 'Something has to have arrived.');
	if (why) return { item: null, errors: { ...errors, count: why } };
	if (!decimal(12, 4)(totals.qty).ok)
		return { item: null, errors: { ...errors, count: 'More than one receipt brings in.' } };
	if (Object.keys(errors).length) return { item: null, errors };
	return {
		item: {
			material_id: named ? null : String(v.material_id),
			material: fresh
				? { name: String(fresh.values.name), unit_id: String(fresh.values.unit_id) }
				: null,
			qty: totals.qty,
			cost: totals.cost
		},
		errors
	};
}

/**
 * A receipt as a whole: what each field says, then each item (readItem),
 * with `placesOf` saying each item's unit's places. An item's complaints are
 * keyed "items.2.count".
 */
export function readReceipt(
	fields: Record<string, unknown>,
	items: readonly Record<string, unknown>[],
	placesOf: (item: Record<string, unknown>) => number | null,
	places: number
): {
	values: Record<string, string | number | boolean | null>;
	items: ReadItem[];
	errors: Record<string, string>;
} {
	const head = parseAll(RECEIPT_FIELDS, fields);
	const errors: Record<string, string> = { ...head.errors };
	if (items.length === 0) errors.items = 'At least one item.';
	if (items.length > MOST_ITEMS) errors.items = `At most ${MOST_ITEMS} items on one receipt.`;
	const read: ReadItem[] = [];
	items.slice(0, MOST_ITEMS).forEach((raw, i) => {
		const one = readItem(raw, placesOf(raw), places);
		for (const [k, why] of Object.entries(one.errors)) errors[`items.${i}.${k}`] = why;
		if (one.item) read.push(one.item);
	});
	return { values: head.values, items: read, errors };
}

/**
 * What is wrong with a quantity of something, or null: it is nothing, or it
 * has more places than its unit counts in. `places` is the unit's, or null
 * when no unit is known yet.
 */
export function countError(qty: string, places: number | null, nothing: string): string | null {
	const [, after = ''] = qty.split('.');
	if (!/[1-9]/.test(qty)) return nothing;
	if (places !== null && after.replace(/0+$/, '').length > places)
		return places === 0
			? 'Whole numbers in this unit.'
			: `At most ${places} decimal place${places === 1 ? '' : 's'} in this unit.`;
	return null;
}
