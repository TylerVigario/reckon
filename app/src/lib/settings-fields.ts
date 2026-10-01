/**
 * Everything the operator sets about the business, and what each field accepts.
 *
 * The settings page and its endpoint both import this, so the rules exist once
 * and cannot drift apart. The page checks as a person types, to answer without
 * a request; the endpoint checks again, because a request need not come from
 * the page at all.
 *
 * WHICH SIDE IS IN CHARGE. The server. What is here is every check both sides
 * can make, and the endpoint adds the ones only it can: that a referenced row
 * still exists, that an invoice number is not already taken. The page makes a
 * mistake quick to find; it never makes a value safe.
 *
 * Postgres has the last word, and nothing here accepts what it would refuse.
 * Each CHECK, NOT NULL and NUMERIC precision on a column is repeated here, so
 * a markup too large for its NUMERIC(7,4) column is refused in a sentence
 * rather than by an overflow.
 *
 * Other rules have nothing to mirror. Emails, colours, zones, number formats
 * and phone numbers are all plain `text` to Postgres: a badly shaped one harms
 * no other row, and a pattern in a CHECK would turn away the first foreign
 * number anyone used. The schema refuses what would damage the data; this file
 * refuses what was plainly a slip.
 *
 * ONLY THESE KEYS CAN BE WRITTEN. A field named in a request is looked up here
 * and nowhere else -- the column written is this object's own key, which is
 * source text. A name that is not a key is refused, so no request can reach a
 * column nobody meant to expose.
 *
 * WHAT IS NOT HERE. Subscription terms -- how many hours are included and
 * what happens past them -- describe what one client gets, so they are on the
 * agreement, not on the row that describes the business. What is paid is a
 * pay rule.
 */
import {
	cap,
	decimal,
	flag,
	no,
	ok,
	oneOf,
	optional,
	orDefault,
	parseIn,
	phone,
	required,
	type Parse,
	type Parsed,
	whole
} from './field-rules';

export type { Parsed };

export const FIELDS: Record<string, Parse> = {
	// --- Identity -----------------------------------------------------------
	trading_name: required('A trading name is required.', cap(120)),
	short_name: optional(cap(40)),
	tax_number_label: orDefault('EIN', cap(20)),
	tax_number: optional(cap(40)),

	address: optional(cap(200)),
	// Not typed by anyone: Google's answer, kept beside the address it is for.
	// The id is opaque, so all that can be checked is that it has an id's
	// characters. Its verification date is not a field: the endpoint stamps it,
	// since no request may say when the check was made.
	google_place_id: optional(
		cap(255, (v) => (/^[A-Za-z0-9_-]+$/.test(v) ? ok(v) : no('That is not a Google place id.')))
	),

	email: optional(
		cap(254, (v) =>
			/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? ok(v) : no('That is not an email address.')
		)
	),
	phone: optional(cap(40, phone)),
	accent_colour: optional(
		cap(7, (v) => {
			const hex = v.startsWith('#') ? v : `#${v}`;
			return /^#[0-9a-fA-F]{6}$/.test(hex)
				? ok(hex.toLowerCase())
				: no('A hex colour, such as #4f6d8a.');
		})
	),

	// --- Money --------------------------------------------------------------
	currency: orDefault('USD', (v) =>
		/^[A-Za-z]{3}$/.test(v) ? ok(v.toUpperCase()) : no('A three-letter code, such as USD.')
	),
	// Asking Intl rather than keeping a list: the zone database changes, and a
	// list copied into this file would be wrong by the time a zone is renamed.
	timezone: orDefault(
		'UTC',
		cap(60, (v) => {
			try {
				new Intl.DateTimeFormat('en-US', { timeZone: v });
				return ok(v);
			} catch {
				return no('Not a time zone. Try Europe/London.');
			}
		})
	),
	rounding_mode: oneOf(['half_up', 'half_even']),
	tax_rule_set: oneOf(['none', 'us_ca', 'flat_per_site']),
	default_markup_pct: orDefault('25', decimal(7, 4)),

	// --- Invoicing ----------------------------------------------------------
	// A zero is the padding mask -- INV-0000 is four digits behind a prefix,
	// 000000 is six and nothing else. A format with no zero in it numbers every
	// invoice the same, so it is refused rather than left to be discovered at
	// invoice two.
	invoice_number_format: orDefault(
		'INV-0000',
		cap(32, (v) => {
			if (/\s/.test(v)) return no('No spaces in an invoice number.');
			return v.includes('0') ? ok(v) : no('Needs at least one 0, which is where the number goes.');
		})
	),
	invoice_footer: optional(cap(500)),
	email_attaches_pdf: flag,
	email_includes_payment_link: flag,
	auto_send: flag,
	// Whether it collides with an invoice already issued is the endpoint's
	// question: this side does not know what has been sent.
	next_invoice_number: whole(1),
	default_terms_days: whole(0),
	// > 0, not >= 0, matching the CHECK: chasing after zero days means chasing
	// an invoice the moment it is sent.
	ageing_alert_days: whole(1),

	// --- Tax ----------------------------------------------------------------
	tax_registration: optional(cap(60)),
	tax_agency: optional(cap(60)),
	filing_basis: optional(oneOf(['annual', 'quarterly', 'monthly'])),
	// The month it ends in; the year ends on that month's last day, which is a
	// rule rather than a second field to get out of step with the first.
	fiscal_year_end_month: optional(whole(1, 12)),
	claims_tax_paid_purchases_resold: flag,

	// --- How things are written, and driven ---------------------------------
	date_format: orDefault('d MMM yyyy', cap(32)),
	// NOT trip_leg.rule's vocabulary. That says what a leg IS; this says how
	// legs are handed to clients, and they are different questions.
	mileage_assignment: oneOf(['actual', 'round_trip_per_client'])
};

/** Field names, for anything that needs to iterate them. */
export type FieldName = keyof typeof FIELDS;

/** Parse one operator setting by name. An unknown name is refused. */
export function parseField(name: string, raw: string): Parsed {
	return parseIn(FIELDS, name, raw);
}
