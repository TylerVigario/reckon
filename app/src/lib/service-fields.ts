/**
 * What a service may say about itself, and what each field accepts.
 *
 * The second vocabulary, built from the same pieces as the first. Same
 * contract: the page imports it to answer without a round trip, the endpoint
 * imports it because the page is not why a value is safe, and the keys are the
 * allowlist -- a request names a field and the column written is this object's
 * own key, which is source text.
 *
 * WHY A SERVICE HOLDS TERMS AT ALL.
 *
 * "Remote support settings should be a function of a service item" -- 11 Sep
 * 2026. They used to sit on `operator`, describing one service from the row
 * that describes the business. A business does not have an included-hours
 * figure; a thing it sells does.
 *
 * NULL HERE IS NOT NULL ON AN AGREEMENT. `subscription_hours` empty means this
 * service is not sold as a subscription. `agreement.remote_cap_hours` empty
 * means unlimited -- which is what Bravo has. The two are different facts and
 * the database keeps them apart; so does this file, by refusing half a set of
 * terms rather than quietly treating one as the other.
 */
import { decimal, oneOf, optional, parseIn, type Parsed } from './field-rules';

export type { Parsed };

export const SERVICE_FIELDS = {
	// NUMERIC(8,2), and empty means "not sold as a subscription".
	subscription_hours: optional(decimal(8, 2)),
	// The same three words an agreement uses, because it is the same decision
	// made at a different level. Empty clears it, which is only valid with the
	// hours cleared too -- a rule for exceeding an allotment that does not
	// exist is half a thought, and the endpoint refuses the pair rather than
	// letting the CHECK say it in constraint names.
	subscription_overage: optional(oneOf(['bill', 'no_charge', 'deny']))
};

export type ServiceFieldName = keyof typeof SERVICE_FIELDS;

/** Parse one service field by name. An unknown name is refused. */
export function parseServiceField(name: string, raw: string): Parsed {
	return parseIn(SERVICE_FIELDS, name, raw);
}
