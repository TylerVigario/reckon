/**
 * What a service may say about itself, and what each field accepts.
 *
 * Same contract as the other registries: the page imports it to answer without
 * a round trip, the endpoint imports it because the page is not why a value is
 * safe, and the keys are the allowlist -- a request names a field and the column
 * written is this object's own key, which is source text.
 *
 * THREE SHAPES OF WRITE, because a service is three kinds of fact.
 *
 *   SERVICE_FIELDS  what it is. Each saves on its own as it is left, the way a
 *                   setting does.
 *   PRICE_FIELDS    what it charges, from a day. A price is dated, so a change
 *                   adds a row rather than overwriting today's figure: what a
 *                   line was worth in June stays June's.
 *   RULE_FIELDS     whom it pays, and how, from a day. Dated for the same reason.
 *
 * WHAT IS NOT HERE: how much of it a client gets included. That is the
 * client's, on their agreement -- "allotment for a service shouldnt even a part
 * of its service configuration. that should be per client and/or per site",
 * 24 Sep 2026.
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
