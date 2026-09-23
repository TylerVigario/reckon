/**
 * Everything the operator sets about the business, and what each field accepts.
 *
 * This file is imported by the settings page AND by the endpoint it posts to,
 * which is the whole point: a rule written twice is a rule that disagrees with
 * itself the first time one copy is edited. The page uses it to answer without
 * a round trip; the endpoint uses it because nothing arriving over the wire has
 * been through the page -- curl exists, and so do stale tabs.
 *
 * WHICH SIDE IS IN CHARGE. The server decides. This file is everything the two
 * sides can agree on, which is most of it, and the endpoint then applies what
 * only it can know -- whether a location still exists, whether an invoice
 * number has already been issued. The page is never the reason a value is safe;
 * it is the reason a person finds out quickly.
 *
 * The database is the last authority of all, and nothing here is ever looser
 * than it. Where a column carries a CHECK, a NOT NULL or a NUMERIC precision,
 * the rule mirrors it exactly -- `default_markup_pct` is NUMERIC(7,4), so three
 * digits before the point and four after, which is refused here as a sentence
 * rather than there as an overflow.
 *
 * Some rules have no constraint to mirror. An email address, a hex colour, a
 * time zone, a number format and a phone number are all `text` to Postgres,
 * because their shape is presentation rather than integrity -- a malformed
 * phone number breaks nothing in the database, and a regex in a CHECK becomes a
 * false rejection the first time somebody bills across a border. The database
 * refuses what would corrupt the system; this file refuses what a person
 * plainly did not mean.
 *
 * THE KEYS ARE THE ALLOWLIST. A request names a field, and the name is only
 * ever used to look one up here -- the column written is this object's own key,
 * which is source text. A name that is not a key is refused, so no request can
 * reach a column nobody meant to expose.
 *
 * WHAT IS NOT HERE. Subscription terms used to be: how many hours were
 * included, what was paid to whoever answered, and what happened past them.
 * They described one service while sitting on the row that describes the
 * business, so they moved -- see service-fields.ts and 0017.
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
	// Not typed by anyone: this is what Google answered, saved beside the
	// address it describes. Google's ids are opaque, so the only honest check
	// is that it looks like one rather than like a sentence. The date that goes
	// with it is NOT a field -- the endpoint sets it, because when this system
	// last checked is not something a request gets to assert.
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
				: no('A hex colour, such as #2382b3.');
		})
	),

	// --- Money --------------------------------------------------------------
	currency: orDefault('USD', (v) =>
		/^[A-Za-z]{3}$/.test(v) ? ok(v.toUpperCase()) : no('A three-letter code, such as USD.')
	),
	// Asking Intl rather than keeping a list: the zone database changes, and a
	// list copied into this file would be wrong by the time a zone is renamed.
	timezone: orDefault(
		'America/Los_Angeles',
		cap(60, (v) => {
			try {
				new Intl.DateTimeFormat('en-US', { timeZone: v });
				return ok(v);
			} catch {
				return no('Not a time zone. Try America/Los_Angeles.');
			}
		})
	),
	rounding_mode: oneOf(['half_up', 'half_even']),
	tax_rule_set: oneOf(['none', 'us_ca', 'flat_per_site']),
	default_markup_pct: orDefault('20', decimal(7, 4)),

	// --- Invoicing ----------------------------------------------------------
	// A zero is the padding mask -- 0000000 is seven digits, INV-0000 is four
	// behind a prefix. A format with no zero in it numbers every invoice the
	// same, so it is refused rather than left to be discovered at invoice two.
	invoice_number_format: orDefault(
		'0000000',
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
	fiscal_year_end_month: optional(whole(1)),
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
