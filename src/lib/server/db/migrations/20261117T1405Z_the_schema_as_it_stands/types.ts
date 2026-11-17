// The words a column may hold, each list a type of its own.
//
// An enum type is what Postgres has for "a static, ordered set of values ... a
// set of status values for a piece of data" (PostgreSQL 18, 8.7), and it is
// what the generated types read: each becomes a union of its words, so a word
// the database does not have is a compile error wherever it is written.
//
// A word is added with ALTER TYPE ... ADD VALUE, in a migration of its own: a
// value added inside a transaction "cannot be used until after the transaction
// has been committed", and each migration is its own transaction
// (#lib/server/db/migrate). One cannot be taken away, "short of dropping and
// re-creating the enum type". The order is the order a list reads in, which
// is the order Postgres sorts them by.
import type { Kysely } from 'kysely';

export const TYPES = {
	/** A person's level (#lib/access): full, or field. */
	access: ['full', 'field'],
	/** A 12-hour clock, or a 24-hour one, as Unicode names them (the locale key hc). */
	hour_cycle: ['h12', 'h23'],
	/** How a role's pay is paid. */
	pays_as: ['guaranteed_payment', 'wages', 'fee'],
	/** What a pay item paid: the person's pay, as their role says it is, or a reimbursement. */
	paid_as: ['guaranteed_payment', 'wages', 'fee', 'reimbursement'],
	/** A passkey's device type, in WebAuthn's words. */
	passkey_device_type: ['singleDevice', 'multiDevice'],
	/** What an emailed link is for. */
	email_link_purpose: ['invite', 'reset', 'confirm', 'change'],
	/** What happened, as OWASP's Logging Vocabulary names it, and in its style where it has no name. */
	security_event_name: [
		'authn_login_success',
		'authn_login_fail',
		'excess_rate_limit_exceeded',
		'session_logout',
		'session_expired',
		'authn_passkey_added',
		'authn_passkey_removed',
		'authn_link_issued',
		'authn_link_used',
		'authn_link_refused',
		'user_created',
		'user_updated',
		'authz_change',
		'user_archived',
		'user_restored',
		'authz_fail'
	],
	/** What a service is counted in. */
	service_unit: ['hour', 'mile', 'each'],
	/** What a pay rule pays for. */
	pays_for: ['time', 'covered_time', 'vehicle'],
	/** How a pay rule works out what is owed. */
	pay_rule_method: ['per_hour', 'percent', 'fixed', 'nothing'],
	/** What a receipt may be: a photo, as the phone shrinks it, or a supplier's PDF. */
	receipt_type: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
	/** Which way a hand adjustment moves stock. */
	stock_adjustment_way: ['off', 'on'],
	/** Why stock was put right by hand. */
	stock_adjustment_reason: [
		'used',
		'damaged',
		'lost',
		'returned',
		'found',
		'correction',
		'counted'
	],
	/** Who did an hour: one person, or the crew time_entry_crew names. */
	crew: ['one', 'team'],
	/** How a trip leg came to be charged where it is. */
	trip_leg_rule: [
		'house_to_a',
		'a_to_b',
		'b_to_house',
		'round_trip',
		'split',
		'unassigned',
		// Given to someone by whoever recorded the trip, rather than by the rule.
		'chosen'
	],
	/** How often an agreement bills. */
	billing_interval: ['weekly', 'monthly', 'quarterly', 'annually'],
	/** What happens to a period an agreement did not finish. */
	final_period_proration: ['none', 'daily'],
	/** How much of a service an agreement covers. */
	allotment: ['capped', 'unlimited'],
	/** What happens past what an agreement covers. */
	overage: ['bill', 'no_charge', 'deny'],
	/** Where an invoice is in its life. */
	invoice_status: ['draft', 'sent', 'void'],
	/** What an invoice line is for. */
	invoice_line_kind: ['service', 'material', 'recurring', 'adjustment', 'bought', 'paid_for'],
	/** Where an invoice line's tax rate came from. */
	tax_source: ['none', 'site', 'override', 'exempt'],
	/** Why a credit note was written. */
	credit_note_kind: ['reg1700b', 'correction', 'goodwill'],
	/** How a payment arrived. */
	payment_method: ['card', 'transfer', 'cheque', 'cash', 'other'],
	/** How often the business files its sales tax return. */
	filing_basis: ['annual', 'quarterly', 'monthly'],
	/** How a trip's miles go to the clients it reached. */
	mileage_assignment: ['actual', 'round_trip_per_client'],
	/** What a line drawn from stock costs: the average on the shelf, or the oldest first. */
	stock_costing: ['average', 'oldest_first'],
	/** Whose sales tax rules the business follows. */
	tax_rule_set: ['us_ca', 'flat_per_site', 'none'],
	/** Something the business is connected to. */
	integration_name: ['stripe', 'beancount', 'press', 'email'],
	/** What an email is about. */
	email_message_kind: [
		'invitation',
		'passkey_link',
		'email_confirmation',
		'email_change',
		'email_changing',
		'passkey_added',
		'passkey_removed',
		'passkeys_ended',
		'name_changed',
		'access_changed',
		'deactivated',
		'reactivated'
	]
} as const;

export async function types(db: Kysely<any>): Promise<void> {
	for (const [name, words] of Object.entries(TYPES))
		await db.schema.createType(name).asEnum(words).execute();
}
