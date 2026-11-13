/**
 * What may be said about stock counted: how many of one material are there,
 * and, where the shelf has nothing to cost what turned up by, what one cost.
 * Nothing at all is a count too -- the shelf is empty -- so none is a figure
 * here, not a refusal.
 *
 * And what a count makes of the shelf once it is applied. A material counted
 * while its shelf said one thing, and applied after it moved -- a line drew
 * from it, or more came in -- is a conflict, as Odoo calls it: keep what was
 * counted, so the shelf becomes that, or keep the difference the count found,
 * applied to what the shelf says now ("Keep Counted Quantity" and "Keep
 * Difference", stock_inventory_conflict).
 *
 * The keys are the columns' own names, as every registry's are.
 */
import { decimal, optional, parseAll, required } from './field-rules.ts';
import { countError } from './stock-fields.ts';
import { Decimal } from './decimal.ts';

export const COUNT_LINE_FIELDS = {
	counted: required('How many are there.', decimal(12, 4)),
	cost_each: optional(decimal(12, 4))
};

/** A material counted: each field, and no more places than its unit counts in. */
export function readCountLine(fields: Record<string, unknown>, places: number | null) {
	const { values, errors } = parseAll(COUNT_LINE_FIELDS, fields);
	if (!errors.counted) {
		const why = countError(String(values.counted), places, '');
		if (why) errors.counted = why;
	}
	return { values, errors };
}

/** What a moved shelf becomes: what was counted, or the difference found. */
export const KEEPS = ['counted', 'difference'] as const;
export type Keep = (typeof KEEPS)[number];

/**
 * What the shelf should hold once the count is applied: what was counted,
 * unless it moved since and the difference is kept. Null where keeping the
 * difference would leave less than nothing.
 */
export function shelfAfter(
	line: { counted: string; was: string },
	now: string,
	keep: Keep = 'counted'
): Decimal | null {
	const counted = Decimal.from(line.counted);
	if (keep === 'counted' || Decimal.from(now).eq(line.was)) return counted;
	const after = Decimal.from(now).add(counted.sub(line.was));
	return after.lt(0) ? null : after;
}
