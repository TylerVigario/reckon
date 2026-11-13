/**
 * What may be said about stock put right by hand: so much of one material
 * taken off the shelf or put on it, on a day, for a reason, and a note --
 * ERPNext's Material Issue and Material Receipt, with the reason said, since
 * a write-off nobody can account for later is the one worth explaining.
 *
 * A take comes off the oldest lots first at what they cost; a find goes on at
 * what one on the shelf is worth now (what ERPNext fills a blank rate in
 * with), or at a cost each said here, where there is nothing on the shelf to
 * go by.
 *
 * The keys are the columns' own names, as every registry's are; cost_each is
 * not one -- it is what a find's cost is worked out from.
 */
import { cap, decimal, isoDate, oneOf, optional, parseAll, required } from './field-rules.ts';
import { countError } from './stock-fields.ts';

export const ADJUST_WAYS = ['off', 'on'] as const;
export type AdjustWay = (typeof ADJUST_WAYS)[number];
export const ADJUST_REASONS = [
	'used',
	'damaged',
	'lost',
	'returned',
	'found',
	'correction'
] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];

/** Why stock moves each way, in the order offered. */
export const REASONS_FOR: Record<AdjustWay, readonly AdjustReason[]> = {
	off: ['used', 'damaged', 'lost', 'returned', 'correction'],
	on: ['found', 'correction']
};

/** Each reason as a person says it. */
export const REASON_WORDS: Record<AdjustReason, string> = {
	used: 'Used in the shop',
	damaged: 'Damaged',
	lost: 'Lost or stolen',
	returned: 'Returned to the supplier',
	found: 'Found',
	correction: 'A correction'
};

export const ADJUST_FIELDS = {
	way: required('Take off, or add.', oneOf([...ADJUST_WAYS])),
	qty: required('How many.', decimal(12, 4)),
	made_on: required('Which day.', isoDate),
	reason: required('Why.', oneOf([...ADJUST_REASONS])),
	note: optional(cap(200))
};

/** What one found is worth, where the shelf has nothing to go by. */
export const FOUND_FIELDS = {
	cost_each: optional(decimal(12, 4))
};

/**
 * An adjustment as a whole: each field, then what they say together -- the
 * reason one its way allows, something moved, no more places than the unit
 * counts in (`places`, null where unknown), and a cost each only for a find.
 */
export function readAdjustment(
	fields: Record<string, unknown>,
	places: number | null
): { values: Record<string, string | number | boolean | null>; errors: Record<string, string> } {
	const head = parseAll(ADJUST_FIELDS, fields);
	const found = parseAll(FOUND_FIELDS, fields);
	const errors: Record<string, string> = { ...head.errors, ...found.errors };
	const v = head.values;
	if (
		!errors.way &&
		!errors.reason &&
		!REASONS_FOR[v.way as AdjustWay].includes(v.reason as AdjustReason)
	)
		errors.reason =
			v.way === 'on'
				? 'Stock is put on when found, or to correct it.'
				: 'Found stock is added, not taken off.';
	if (!errors.qty) {
		const why = countError(String(v.qty), places, 'Something has to move.');
		if (why) errors.qty = why;
	}
	if (v.way === 'off' && found.values.cost_each !== null && !errors.cost_each)
		errors.cost_each = 'What a take cost is what the shelf says it cost.';
	return { values: { ...v, cost_each: found.values.cost_each }, errors };
}
