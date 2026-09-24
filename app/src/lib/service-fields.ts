/**
 * What a service may say about itself, and what each field accepts.
 *
 * Same contract as the other registries: the page imports it to answer without
 * a round trip, the endpoint imports it because the page is not why a value is
 * safe, and the keys are the allowlist -- a request names a field and the column
 * written is this object's own key, which is source text.
 *
 * FOUR SHAPES OF WRITE, because a service is four kinds of fact.
 *
 *   SERVICE_FIELDS       what it is. Each saves on its own as it is left, the
 *                        way a setting does.
 *   SUBSCRIPTION_FIELDS  how it is sold on subscription. The four are one
 *                        decision -- subscription_terms_match_basis says so --
 *                        and save together, because from "not sold as one" no
 *                        single field can be set on its own.
 *   PRICE_FIELDS         what it charges, from a day. A price is dated, so a
 *                        change adds a row rather than overwriting today's
 *                        figure: what a line was worth in June stays June's.
 *   RULE_FIELDS          whom it pays, and how, from a day. Dated for the same
 *                        reason.
 *
 * NULL HERE IS NOT NULL ON AN AGREEMENT. `subscription_hours` empty means this
 * service is not sold as a subscription. `agreement_service.included_hours`
 * empty means unlimited -- which is what Bravo has. A service's terms are where
 * an agreement's coverage starts from, not what it goes on reading.
 */
import {
	anId,
	cap,
	decimal,
	flag,
	isoDate,
	oneOf,
	optional,
	orDefault,
	parseAll,
	parseIn,
	required,
	whole,
	type Parsed
} from './field-rules';

export type { Parsed };

export const UNITS = ['hour', 'mile', 'each'] as const;
export const BASES = ['none', 'capped', 'unlimited'] as const;
export const PERIODS = ['week', 'month', 'quarter', 'year'] as const;
export const OVERAGES = ['bill', 'no_charge', 'deny'] as const;
export const PAYS_FOR = ['time', 'covered_time', 'vehicle'] as const;
export const METHODS = ['per_hour', 'percent', 'fixed', 'nothing'] as const;

const name = required('A service needs a name.', cap(80));

export const SERVICE_FIELDS = {
	name,
	unit: oneOf(UNITS),
	time_tracked: flag,
	taxable: flag,
	// Empty bills the exact time. Only for a service charged by the hour: the
	// endpoint refuses it on anything else, as service_increment_is_for_time does.
	bill_to_nearest_seconds: optional(whole(1)),
	minimum_charge: optional(decimal(12, 2)),
	active: flag
};

export type ServiceFieldName = keyof typeof SERVICE_FIELDS;

/** Parse one service field by name. An unknown name is refused. */
export function parseServiceField(field: string, raw: string): Parsed {
	return parseIn(SERVICE_FIELDS, field, raw);
}

/** What a new service needs before it can exist: a name, and what it is charged per. */
export const NEW_SERVICE_FIELDS = { name, unit: oneOf(UNITS) };

export const SUBSCRIPTION_FIELDS = {
	subscription_basis: oneOf(BASES),
	subscription_hours: optional(decimal(8, 2)),
	subscription_period: optional(oneOf(PERIODS)),
	subscription_overage: optional(oneOf(OVERAGES))
};

/**
 * The four as one decision. A cap needs all three of its terms; no cap needs
 * none of them, and whatever was typed into them is dropped rather than refused
 * -- choosing "unlimited" is not a mistake about the hours box.
 */
export function readSubscription(fields: Record<string, unknown>) {
	const { values, errors } = parseAll(SUBSCRIPTION_FIELDS, fields);
	if (Object.keys(errors).length) return { values, errors };
	if (values.subscription_basis === 'capped') {
		if (values.subscription_hours === null)
			errors.subscription_hours = 'How many hours it includes.';
		if (values.subscription_period === null)
			errors.subscription_period = 'A week, a month, a quarter or a year.';
		if (values.subscription_overage === null)
			errors.subscription_overage = 'What happens once they are used.';
	} else {
		values.subscription_hours = null;
		values.subscription_period = null;
		values.subscription_overage = null;
	}
	return { values, errors };
}

export const PRICE_FIELDS = {
	// Empty is every client.
	entity_id: optional(anId),
	rate: required('What it charges.', decimal(12, 2)),
	// What each person after the first adds. Empty is nothing extra: the rate
	// is for the job, however many work it.
	additional_rate: orDefault('0', decimal(12, 2)),
	effective_from: required('From which day.', isoDate)
};

export function readPrice(fields: Record<string, unknown>) {
	return parseAll(PRICE_FIELDS, fields);
}

export const RULE_FIELDS = {
	role_id: optional(anId),
	user_id: optional(anId),
	// Empty is every client.
	entity_id: optional(anId),
	pays_for: oneOf(PAYS_FOR),
	method: oneOf(METHODS),
	amount: optional(decimal(12, 4)),
	effective_from: required('From which day.', isoDate)
};

/**
 * A rule as a whole: it pays a role or one person, never both; covered time is
 * paid as a share of the retainer, so only a percentage or nothing; and an
 * amount goes with every method but "nothing", which carries none.
 */
export function readRule(fields: Record<string, unknown>) {
	const { values, errors } = parseAll(RULE_FIELDS, fields);
	if (Object.keys(errors).length) return { values, errors };
	if ((values.role_id === null) === (values.user_id === null))
		errors[values.role_id === null ? 'role_id' : 'user_id'] =
			'A rule pays a role, or one person -- one of the two.';
	if (values.pays_for === 'covered_time' && !['percent', 'nothing'].includes(String(values.method)))
		errors.method = 'Time a retainer covers is paid as a share of it: a percentage, or nothing.';
	if (values.method === 'nothing') values.amount = null;
	else if (values.amount === null) errors.amount = 'How much.';
	else if (values.method === 'percent' && Number(values.amount) > 100)
		errors.amount = 'At most 100%.';
	return { values, errors };
}
