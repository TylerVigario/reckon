/**
 * What a client may say about itself.
 *
 * The standing terms of doing business with somebody: how long they have to
 * pay, how they usually pay, and whether they are exempt. Not what they owe --
 * that is the invoices' to say and nothing here can move it.
 */
import {
	cap,
	flag,
	no,
	ok,
	oneOf,
	optional,
	parseIn,
	required,
	text,
	whole,
	type Parsed
} from './field-rules';
import { toSlug } from './slug';

export type { Parsed };

export const CLIENT_FIELDS = {
	name: required('A client needs a name.', cap(160)),

	// What this client is called in a URL. Normalised rather than refused, and
	// never moved by a rename -- a link somebody kept is worth more than a URL
	// that matches the current spelling.
	slug: (raw: string): Parsed => {
		const v = toSlug(raw.trim());
		if (!v) return no('Letters or digits are needed -- that leaves nothing for a URL.');
		return v.length > 80 ? no('At most 80 characters.') : ok(v);
	},

	// Empty falls back to the operator's own default, which is why it is
	// optional rather than defaulted here: "not set" and "set to the same
	// number" are different facts and the screens show which.
	terms_days: optional(whole(0)),

	payment_method: optional(oneOf(['cheque', 'card', 'transfer', 'cash', 'other'])),

	// Exemption and its certificate are one decision. CDTFA needs the
	// certificate to support an untaxed sale, so claiming exemption without
	// one is a claim that cannot be defended -- the endpoint refuses the pair
	// rather than letting it through half-made.
	tax_exempt: flag,
	exemption_certificate: optional(cap(60, text)),
	exemption_expires_on: optional(text),

	active: flag
};

export type ClientFieldName = keyof typeof CLIENT_FIELDS;

export function parseClientField(name: string, raw: string): Parsed {
	return parseIn(CLIENT_FIELDS, name, raw);
}
