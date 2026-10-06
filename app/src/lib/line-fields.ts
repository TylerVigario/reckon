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
	money,
	oneOf,
	optional,
	orDefault,
	parseAll,
	required
} from './field-rules.ts';
import { countError } from './stock-fields.ts';

export const PASSED_ON = ['bought', 'paid_for'] as const;

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
