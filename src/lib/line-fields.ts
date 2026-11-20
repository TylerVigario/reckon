/**
 * What may be said about a line added to a draft by hand: goods drawn from
 * stock, goods bought for the job, or a cost paid on the client's behalf
 * (#lib/passed-on).
 *
 * What it cost before tax and the tax paid on it are all of it, as the receipt
 * says them. Where it went is one of the client's sites, for its tax rate; who
 * paid is a person, who is owed it back, or the business when empty.
 *
 * The keys are the columns' own names, as every registry's are.
 */
import {
	anId,
	cap,
	decimal,
	flag,
	money,
	oneOf,
	optional,
	orDefault,
	parseAll,
	percentage,
	required
} from './field-rules.ts';
import type { InvoiceLineKind } from './server/db/database.ts';
import type { ByHand } from './passed-on.ts';
import { countError } from './stock-fields.ts';

export const PASSED_ON = ['bought', 'paid_for'] as const satisfies readonly InvoiceLineKind[];

export const PASSED_ON_FIELDS = {
	kind: oneOf(PASSED_ON),
	description: required('What it was — it appears on the invoice.', cap(200)),
	site_id: optional(anId),
	bought_from: optional(cap(80)),
	ex_tax_cost: required('What it cost before tax.', money),
	tax_paid: orDefault('0', money),
	paid_by: optional(anId)
};

export function readPassedOn(fields: Record<string, unknown>) {
	return parseAll(PASSED_ON_FIELDS, fields);
}

/**
 * Goods drawn from stock: which material, and how much of it in its unit. What
 * it cost comes off the shelf (#lib/stock-draw), so it is not said here.
 */
export const FROM_STOCK_FIELDS = {
	material_id: required('Which item.', anId),
	qty: required('How much.', decimal(12, 4)),
	description: required('What it was — it appears on the invoice.', cap(200)),
	site_id: optional(anId)
};

/** A draw as a whole: each field, then something drawn, in its unit's places. */
export function readFromStock(fields: Record<string, unknown>, places: number | null) {
	const read = parseAll(FROM_STOCK_FIELDS, fields);
	const qty = read.values.qty;
	if (typeof qty === 'string' && !read.errors.qty) {
		const why = countError(qty, places, 'Something has to be drawn.');
		if (why) read.errors.qty = why;
	}
	return read;
}

/**
 * A line's tax set by hand, by someone with Full (#lib/passed-on ByHand): on a
 * sale, where the line is the exception to its kind. In the words the form
 * sends, under the columns' own names:
 *
 *   taxable              empty as its kind is taxed; false, not taxed; true, taxed
 *   tax_rate_pct         taxed at another rate than the site's; empty for the site's
 *   tax_override_reason  why, which is what says a line's tax was set by hand
 */
export const BY_HAND_FIELDS = {
	taxable: optional(flag),
	tax_rate_pct: optional(percentage),
	tax_override_reason: optional(cap(200))
};
export const BY_HAND = [
	'taxable',
	'tax_rate_pct',
	'tax_override_reason'
] as const satisfies readonly (keyof typeof BY_HAND_FIELDS)[];

/**
 * A line's tax set by hand, as the form says it: undefined where it says
 * nothing of it, as a form without the choice does -- a line on a draft then
 * keeps its own -- null for as its kind is taxed, or what was set and why.
 */
export function readByHand(fields: Record<string, unknown>): {
	byHand: ByHand | null | undefined;
	reason: string | null;
	errors: Record<string, string>;
} {
	if (!BY_HAND.some((f) => f in fields)) return { byHand: undefined, reason: null, errors: {} };
	const { values, errors } = parseAll(BY_HAND_FIELDS, fields);
	if (Object.keys(errors).length > 0) return { byHand: undefined, reason: null, errors };
	const taxed = values.taxable as boolean | null;
	const rate = values.tax_rate_pct as string | null;
	const reason = values.tax_override_reason as string | null;
	if (taxed === null) {
		if (reason !== null) errors.tax_override_reason = 'A reason goes with a tax set by hand.';
		if (rate !== null) errors.tax_rate_pct = 'A rate goes with a tax set by hand.';
		return { byHand: null, reason: null, errors };
	}
	if (reason === null)
		errors.tax_override_reason =
			'Why it is the exception — kept with the line, not on the invoice.';
	if (!taxed && rate !== null) errors.tax_rate_pct = 'Not taxed is at no rate.';
	return {
		byHand: taxed ? { taxed: true, ratePct: rate } : { taxed: false },
		reason,
		errors
	};
}
