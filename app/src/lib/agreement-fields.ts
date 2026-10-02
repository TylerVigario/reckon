/**
 * What an agreement may say, and what each field accepts.
 *
 * Same contract as the other registries: the page imports it to answer without
 * a round trip, the endpoint imports it because the page is not why a value is
 * safe, and the keys are the allowlist.
 *
 * THREE SHAPES OF WRITE.
 *
 *   AGREEMENT_FIELDS  what it charges and when it runs. Each saves on its own
 *                     as it is left. Which client and site it belongs to is
 *                     not among them: that is what the
 *                     agreement is, from the day it is made.
 *   NEW_AGREEMENT     what an agreement needs before it can exist.
 *   COVERAGE_FIELDS   one service it covers, and its allotment -- whole, so
 *                     saved together: agreement_service_cap_is_whole.
 *
 * An agreement is a client's or one site's, and its price is what a period
 * charges: there is nothing to multiply by. There is no default allotment, so
 * an allotment is only ever set here.
 */
import {
	anId,
	decimal,
	isoDate,
	oneOf,
	optional,
	parseAll,
	parseIn,
	required,
	whole,
	type Parsed
} from './field-rules.ts';

export const INTERVALS = ['weekly', 'monthly', 'quarterly', 'annually'] as const;
export const PRORATION = ['daily', 'none'] as const;
export const ALLOTMENTS = ['unlimited', 'capped'] as const;
export const OVERAGES = ['bill', 'no_charge', 'deny'] as const;

const dayOfMonth = (raw: string): Parsed => {
	const n = whole(1)(raw);
	if (!n.ok) return n;
	return Number(n.value) > 31 ? { ok: false, why: 'A day of the month: 1 to 31.' } : n;
};

export const AGREEMENT_FIELDS = {
	price: required('What it charges.', decimal(12, 2)),
	billing_interval: oneOf(INTERVALS),
	billing_anchor_day: required('Which day of the month it bills on.', dayOfMonth),
	starts_on: required('The day it starts.', isoDate),
	// Empty is open-ended: it runs until somebody ends it.
	ends_on: optional(isoDate),
	final_period_proration: oneOf(PRORATION),
	// Empty is nobody in particular. Must be one of the client's contacts; the
	// schema's agreement_contact_is_the_clients says so.
	contact_id: optional(anId)
};

export function parseAgreementField(field: string, raw: string): Parsed {
	return parseIn(AGREEMENT_FIELDS, field, raw);
}

export const NEW_AGREEMENT_FIELDS = {
	entity_id: required('Which client.', anId),
	// Empty is the client as a whole; a site is that site alone.
	site_id: optional(anId),
	price: required('What it charges.', decimal(12, 2)),
	billing_interval: oneOf(INTERVALS),
	starts_on: required('The day it starts.', isoDate)
};

export function readNewAgreement(fields: Record<string, unknown>) {
	return parseAll(NEW_AGREEMENT_FIELDS, fields);
}

export const COVERAGE_FIELDS = {
	allotment: oneOf(ALLOTMENTS),
	// The agreement's own hours: its site's, or the client's across its sites.
	included_hours: optional(decimal(8, 2)),
	overage: optional(oneOf(OVERAGES))
};

/**
 * An allotment as a whole: a cap needs its hours and a rule for past them;
 * unlimited needs neither, and whatever was typed into them is dropped rather
 * than refused -- choosing unlimited is not a mistake about the hours box.
 */
export function readCoverage(fields: Record<string, unknown>) {
	const { values, errors } = parseAll(COVERAGE_FIELDS, fields);
	if (Object.keys(errors).length) return { values, errors };
	if (values.allotment === 'capped') {
		if (values.included_hours === null) errors.included_hours = 'How many hours it includes.';
		if (values.overage === null) errors.overage = 'What happens once they are used.';
	} else {
		values.included_hours = null;
		values.overage = null;
	}
	return { values, errors };
}
