/**
 * A RETURN AND A PAYMENT, as a person records them from what the state's
 * agency gave back (#lib/server/sales-tax): the period each is for, the day,
 * the tax, and the confirmation number. The pages and their endpoints both
 * import this, so a page answers as a person types and the endpoint checks
 * again.
 *
 * ONLY THESE KEYS CAN BE WRITTEN. A field named in a request is looked up here
 * and nowhere else.
 */
import { Decimal } from './decimal.ts';
import { dated } from './format.ts';
import { cap, isoDate, money, optional, orDefault, parseAll, required } from './field-rules.ts';

const PERIOD = {
	period_start: required('The first day of the period it is for.', isoDate),
	period_end: required('The last day of the period it is for.', isoDate)
};

export const RETURN_FIELDS = {
	...PERIOD,
	filed_on: required('The day it was filed.', isoDate),
	tax: required('What the return says the period owes.', money),
	kept: orDefault('0', money),
	// What was paid with it: a payment of its own, on the day it was filed.
	paid: orDefault('0', money),
	reference: optional(cap(60))
};

export const PAYMENT_FIELDS = {
	...PERIOD,
	paid_on: required('The day it was paid.', isoDate),
	tax: orDefault('0', money),
	penalty_and_interest: orDefault('0', money),
	reference: optional(cap(60))
};

export type Period = { period_start: string; period_end: string };

export type ReturnFields = Period & {
	filed_on: string;
	tax: string;
	kept: string;
	paid: string;
	reference: string | null;
};

export type PaymentFields = Period & {
	paid_on: string;
	tax: string;
	penalty_and_interest: string;
	reference: string | null;
};

const said = (v: string | number | boolean | null | undefined) =>
	v === null || v === undefined ? null : String(v);

/** A period ends on or after the day it starts. */
function periodErrors(values: Record<string, unknown>, errors: Record<string, string>) {
	if (
		!errors.period_start &&
		!errors.period_end &&
		String(values.period_end) < String(values.period_start)
	)
		errors.period_end = 'Its last day, on or after its first.';
}

/**
 * A return as it was sent: filed once its period ends, keeping no more than
 * its tax.
 */
export function parseReturn(fields: Record<string, unknown>): {
	value: ReturnFields | null;
	errors: Record<string, string>;
} {
	const { values, errors } = parseAll(RETURN_FIELDS, fields);
	periodErrors(values, errors);
	if (!errors.period_end && !errors.filed_on && String(values.filed_on) < String(values.period_end))
		errors.filed_on = `Filed once its period ends: on ${dated(String(values.period_end))} or after.`;
	if (!errors.tax && !errors.kept && Decimal.from(String(values.kept)).gt(String(values.tax)))
		errors.kept = 'No more than the tax on the return.';
	if (Object.keys(errors).length) return { value: null, errors };
	return {
		value: {
			period_start: String(values.period_start),
			period_end: String(values.period_end),
			filed_on: String(values.filed_on),
			tax: String(values.tax),
			kept: String(values.kept),
			paid: String(values.paid),
			reference: said(values.reference)
		},
		errors
	};
}

/** A payment as it was sent: something handed over, tax or penalty and interest. */
export function parsePayment(fields: Record<string, unknown>): {
	value: PaymentFields | null;
	errors: Record<string, string>;
} {
	const { values, errors } = parseAll(PAYMENT_FIELDS, fields);
	periodErrors(values, errors);
	if (
		!errors.tax &&
		!errors.penalty_and_interest &&
		!Decimal.from(String(values.tax)).add(String(values.penalty_and_interest)).gt('0')
	)
		errors.tax = 'What was handed over.';
	if (Object.keys(errors).length) return { value: null, errors };
	return {
		value: {
			period_start: String(values.period_start),
			period_end: String(values.period_end),
			paid_on: String(values.paid_on),
			tax: String(values.tax),
			penalty_and_interest: String(values.penalty_and_interest),
			reference: said(values.reference)
		},
		errors
	};
}

/** What a state lets a return keep of its tax, where reckon has read its law. */
const KEPT: Record<string, string> = {
	CA: 'California’s return has no line for it.',
	NV: 'Nevada lets a return paid on time keep 0.25% of its tax (NRS 372.370).',
	TX: 'Texas lets a return filed on time keep 0.5% of its tax, and 1.25% of a prepayment (Tax Code §151.423, §151.424).'
};

/** What a return's share kept for filing on time is, as its state has it. */
export const keptAs = (state: string) =>
	KEPT[state] ?? 'What the state lets a return filed on time keep of its tax, where it does.';
