/**
 * What a business says about a state it collects tax in (tax_registration),
 * and what each field accepts. The page and its endpoint both import this, as
 * #lib/settings-fields is imported for the business's own settings: the page
 * answers as a person types, and the endpoint checks again.
 *
 * The state itself is not here: a registration is made for a state and stays
 * that state's, so it is in the address of the endpoint, never a field.
 *
 * ONLY THESE KEYS CAN BE WRITTEN. A field named in a request is looked up here
 * and nowhere else, and the column written is this object's own key.
 */
import { cap, flag, oneOf, optional, parseIn, type Parsed } from './field-rules.ts';
import { everyWord } from './every-word.ts';
import type { FilingBasis } from './server/db/database.ts';

export const REGISTRATION_FIELDS = {
	// What is held, in the issuer's words: Seller's permit.
	held: optional(cap(60)),
	// Who issued it, and who the return goes to: CDTFA.
	agency: optional(cap(60)),
	filing_basis: optional(oneOf(everyWord<FilingBasis>()(['annual', 'quarterly', 'monthly']))),
	// California's alone, which the schema says
	// (only_california_claims_tax_paid_purchases_resold).
	claims_tax_paid_purchases_resold: flag
};

export type RegistrationFieldName = keyof typeof REGISTRATION_FIELDS;

/** Parse one field of a registration by name. An unknown name is refused. */
export function parseRegistrationField(name: string, raw: string): Parsed {
	return parseIn(REGISTRATION_FIELDS, name, raw);
}
