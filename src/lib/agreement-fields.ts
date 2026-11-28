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
 *                     saved together: agreement_service_cap_is_whole. What it
 *                     includes is counted as its service is charged: hours,
 *                     or how many of one charged each (a_count_is_whole).
 *
 * An agreement is a client's or one site's, and its price is what a period
 * charges: there is nothing to multiply by. There is no default allotment, so
 * an allotment is only ever set here.
 */
import {
	anId,
	decimal,
	isoDate,
	money,
	oneOf,
	optional,
	parseAll,
	parseIn,
	required,
	whole,
	type Parsed
} from './field-rules.ts';
import { everyWord } from './every-word.ts';
import type {
	Allotment,
	BillingInterval,
	FinalPeriodProration,
	Overage,
	ServiceUnit
} from './server/db/database.ts';

export const INTERVALS = everyWord<BillingInterval>()([
	'weekly',
	'monthly',
	'quarterly',
	'annually'
]);
export const PRORATION = everyWord<FinalPeriodProration>()(['daily', 'none']);
export const ALLOTMENTS = everyWord<Allotment>()(['unlimited', 'capped']);
export const OVERAGES = everyWord<Overage>()(['bill', 'no_charge', 'deny']);

const dayOfMonth = (raw: string): Parsed => {
	const n = whole(1)(raw);
	if (!n.ok) return n;
	return Number(n.value) > 31 ? { ok: false, why: 'A day of the month: 1 to 31.' } : n;
};

export const AGREEMENT_FIELDS = {
	price: required('What it charges.', money),
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
	price: required('What it charges.', money),
	billing_interval: oneOf(INTERVALS),
	starts_on: required('The day it starts.', isoDate)
};

export function readNewAgreement(fields: Record<string, unknown>) {
	return parseAll(NEW_AGREEMENT_FIELDS, fields);
}

export const COVERAGE_FIELDS = {
	allotment: oneOf(ALLOTMENTS),
	// The agreement's own: its site's, or the client's across its sites. Hours,
	// or how many of a service charged each.
	included: optional(decimal(8, 2)),
	overage: optional(oneOf(OVERAGES))
};

/**
 * An allotment as a whole, for a service charged by `unit`: a cap needs what
 * it includes and a rule for past it; unlimited needs neither, and whatever
 * was typed into them is dropped rather than refused -- choosing unlimited is
 * not a mistake about the box. A service charged each is included by how
 * many, so whole: each entry is covered whole or billed whole.
 */
export function readCoverage(fields: Record<string, unknown>, unit: ServiceUnit) {
	const { values, errors } = parseAll(COVERAGE_FIELDS, fields);
	if (Object.keys(errors).length) return { values, errors };
	if (values.allotment === 'capped') {
		if (values.included === null)
			errors.included =
				unit === 'each' ? 'How many times it includes.' : 'How many hours it includes.';
		else if (unit === 'each' && !/^\d+(\.0+)?$/.test(String(values.included)))
			errors.included = 'A whole number of times: each is covered whole or billed whole.';
		if (values.overage === null) errors.overage = 'What happens once they are used.';
	} else {
		values.included = null;
		values.overage = null;
	}
	return { values, errors };
}
