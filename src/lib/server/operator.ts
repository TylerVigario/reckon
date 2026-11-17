import { sql } from 'kysely';
import type { Operator } from './db/database.ts';
import { db, type Reader } from './db/index.ts';

/**
 * Every column of the operator row but the logo's bytes, by name, in the
 * order the table describes them. A column the migrations add and this leaves
 * out is a type error (everyColumn), so the settings pages are never missing
 * one.
 */
const COLUMNS = [
	'id',
	'trading_name',
	'short_name',
	'logo_media_type',
	'accent_colour',
	'address',
	'tax_number',
	'tax_number_label',
	'email',
	'phone',
	'currency',
	'timezone',
	'tax_rule_set',
	'invoice_number_format',
	'next_invoice_number',
	'default_terms_days',
	'ageing_alert_days',
	'singleton',
	'default_markup_pct',
	'purchase_markup_pct',
	'stock_costing',
	'google_place_id',
	'address_verified_on',
	'invoice_footer',
	'email_attaches_pdf',
	'email_includes_payment_link',
	'auto_send',
	'tax_registration',
	'tax_agency',
	'filing_basis',
	'fiscal_year_end_month',
	'claims_tax_paid_purchases_resold',
	'locale',
	'mileage_assignment'
] as const satisfies readonly Exclude<keyof Operator, 'logo'>[];

type Missing = Exclude<keyof Operator, 'logo' | (typeof COLUMNS)[number]>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- a check, read by the compiler alone
const everyColumn: [Missing] extends [never] ? true : Missing = true;

/**
 * The operator row as the settings pages read it: every column by its own
 * name, except the logo's bytes, which only /operator/logo serves -- a page
 * needs to know there is one, not to carry it.
 */
export async function operatorRow(r: Reader = db) {
	const row = await r
		.selectFrom('operator')
		.select(COLUMNS)
		.select((eb) => sql<boolean>`${eb.ref('logo')} is not null`.as('has_logo'))
		.limit(1)
		.executeTakeFirst();
	return row ?? null;
}

export type OperatorRow = NonNullable<Awaited<ReturnType<typeof operatorRow>>>;
