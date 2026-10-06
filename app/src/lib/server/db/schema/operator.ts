// The business running this, and what it remembers.
//
// One operator row, ever. What the business supplies -- its name, its marks,
// how it numbers invoices, which tax rules it files under -- is here, so
// nothing about any one business is in the code.
//
// record_history is written by triggers in the hand-written migration: a
// figure on an invoice is answerable a year later -- who changed it, from
// what, and when.
//
// integration records whether an outside thing is wired up and what it points
// at, never how to log in: keys are environment, because a table travels in
// every dump and every backup.

import { sql } from 'drizzle-orm';
import {
	bigint,
	boolean,
	check,
	foreignKey,
	index,
	integer,
	pgTable,
	primaryKey,
	smallint,
	text,
	unique,
	uuid
} from 'drizzle-orm/pg-core';
import { bytea, day, decimal, id, nonNegative, oneOf, tstz } from './columns.ts';
import { user } from './people.ts';
import { COSTINGS } from '../../../stock-draw.ts';

export const TAX_RULE_SETS = ['us_ca', 'flat_per_site', 'none'] as const;
export const FILING_BASES = ['annual', 'quarterly', 'monthly'] as const;
export const MILEAGE_ASSIGNMENTS = ['actual', 'round_trip_per_client'] as const;
export const INTEGRATIONS = ['stripe', 'beancount', 'press', 'email'] as const;

export const operator = pgTable(
	'operator',
	{
		id: id(),
		tradingName: text().notNull(),
		shortName: text(),
		logo: bytea(),
		logoMediaType: text(),
		accentColour: text(),
		address: text(),
		taxNumber: text(),
		/**
		 * UNUSED, PLANNED. What the tax number is called on an invoice. The
		 * settings page saves it; nothing prints an invoice yet.
		 */
		taxNumberLabel: text().default('EIN').notNull(),
		email: text(),
		phone: text(),
		currency: text().default('USD').notNull(),
		/**
		 * The business's clock, as Postgres names it: whether an invoice is
		 * overdue, how long work has waited, where a report's month begins, which
		 * price is in force -- one answer for everyone (#lib/server/calendar). A
		 * person follows it until they set their own zone.
		 */
		timezone: text().default('UTC').notNull(),
		taxRuleSet: text({ enum: TAX_RULE_SETS }).default('none').notNull(),
		invoiceNumberFormat: text().default('INV-0000').notNull(),
		nextInvoiceNumber: integer().default(1).notNull(),
		defaultTermsDays: integer().default(30).notNull(),
		ageingAlertDays: integer().default(30).notNull(),
		singleton: boolean().default(true).notNull(),
		defaultMarkupPct: decimal(7, 4).default('25').notNull(),
		/**
		 * What goods bought for a job are marked up by when they are passed on.
		 * None by default: passed on as they cost.
		 */
		purchaseMarkupPct: decimal(7, 4).default('0').notNull(),
		/**
		 * What a line drawn from stock costs (#lib/stock-draw): the average of
		 * what is on the shelf, or the oldest first. A change applies to what is
		 * drawn after it; a line keeps the cost it was drawn at.
		 */
		stockCosting: text({ enum: COSTINGS }).default('average').notNull(),
		/**
		 * Google's identifier for the place operator.address is. The id is the one
		 * piece of Places data that may be stored indefinitely.
		 */
		googlePlaceId: text(),
		/** When operator.address was last confirmed against Google. */
		addressVerifiedOn: day(),
		/**
		 * UNUSED, PLANNED. The foot of every printed invoice, under the lines --
		 * where "cheques payable to" and how card payments settle belong. The
		 * settings page saves it; nothing prints an invoice yet.
		 */
		invoiceFooter: text(),
		/**
		 * UNUSED, PLANNED. Whether an invoice's email carries the PDF. The
		 * settings page saves it; nothing emails an invoice yet.
		 */
		emailAttachesPdf: boolean().default(true).notNull(),
		/**
		 * UNUSED, PLANNED. Whether an invoice's email carries a link to pay by
		 * card. The settings page saves it; nothing emails an invoice yet.
		 */
		emailIncludesPaymentLink: boolean().default(true).notNull(),
		/**
		 * UNUSED, PLANNED. Whether a draft goes out without a person sending it.
		 * False by default and deliberately so: a client should see nothing a
		 * person has not decided is right. The settings page saves it; nothing
		 * builds or sends a draft yet.
		 */
		autoSend: boolean().default(false).notNull(),
		/**
		 * What the operator holds, in the issuer's own words -- "Seller's permit".
		 * Distinct from tax_number, which is the number on it.
		 */
		taxRegistration: text(),
		/** Who issued it and who the return goes to -- CDTFA in California. */
		taxAgency: text(),
		filingBasis: text({ enum: FILING_BASES }),
		/**
		 * The month the fiscal year ends in; the year ends on its last day.
		 * Reports are built on this -- a Schedule A for a fiscal year cannot be
		 * drawn without it.
		 */
		fiscalYearEndMonth: smallint(),
		/**
		 * The Reg 1701 election: tax already paid on materials that were resold
		 * comes off the measure. An election, not a calculation, so it is recorded
		 * rather than inferred from whether any material qualifies.
		 */
		claimsTaxPaidPurchasesResold: boolean().default(false).notNull(),
		/**
		 * How dates and figures read for the business: a locale, as BCP 47 writes
		 * one ("en-US"). Each person follows it until they set their own, and the
		 * business's documents are written in it. A locale rather than a date
		 * pattern, because a pattern does not translate: the locale carries the
		 * language, the order of day and month, and the separators.
		 */
		locale: text().default('en-US').notNull(),
		/**
		 * UNUSED, PLANNED: the settings page saves it, and nothing applies it to a
		 * trip yet. actual: each leg goes to whoever caused it, and never more
		 * miles than were driven. round_trip_per_client: a full round trip each,
		 * which over-bills whenever two sites are near each other -- a trip past
		 * two clients can charge 70 miles for 57 driven.
		 */
		mileageAssignment: text({ enum: MILEAGE_ASSIGNMENTS }).default('actual').notNull()
	},
	(t) => [
		unique('operator_singleton_key').on(t.singleton),
		check('operator_ageing_alert_days_check', sql`${t.ageingAlertDays} > 0`),
		nonNegative('operator_default_markup_pct_check', t.defaultMarkupPct),
		nonNegative('operator_purchase_markup_pct_check', t.purchaseMarkupPct),
		nonNegative('operator_default_terms_days_check', t.defaultTermsDays),
		oneOf('operator_filing_basis_check', t.filingBasis, FILING_BASES),
		check(
			'operator_fiscal_year_end_month_check',
			sql`(${t.fiscalYearEndMonth} >= 1) AND (${t.fiscalYearEndMonth} <= 12)`
		),
		oneOf('operator_mileage_assignment_check', t.mileageAssignment, MILEAGE_ASSIGNMENTS),
		check('operator_next_invoice_number_check', sql`${t.nextInvoiceNumber} > 0`),
		check('operator_singleton_check', sql`${t.singleton}`),
		oneOf('operator_tax_rule_set_check', t.taxRuleSet, TAX_RULE_SETS),
		oneOf('operator_stock_costing_check', t.stockCosting, COSTINGS)
	]
);

export const recordHistory = pgTable(
	'record_history',
	{
		id: bigint({ mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
		tableName: text().notNull(),
		rowId: uuid().notNull(),
		field: text().notNull(),
		oldValue: text(),
		newValue: text(),
		changedBy: uuid(),
		changedAt: tstz().defaultNow().notNull()
	},
	(t) => [
		index('record_history_row').on(t.tableName, t.rowId, t.changedAt.desc()),
		foreignKey({
			name: 'record_history_changed_by_fkey',
			columns: [t.changedBy],
			foreignColumns: [user.id]
		}).onDelete('set null')
	]
);

/**
 * Whether an outside thing is wired up, and what it points at -- the ledger
 * directory, the sending address. Never a credential.
 */
export const integration = pgTable(
	'integration',
	{
		name: text({ enum: INTEGRATIONS }).primaryKey(),
		connected: boolean().default(false).notNull(),
		/** What it points at, in the operator's terms. Not a secret. */
		detail: text(),
		/** When the connection was last proven, rather than last configured. */
		checkedAt: tstz()
	},
	(t) => [oneOf('integration_name_check', t.name, INTEGRATIONS)]
);

/**
 * UNUSED, PLANNED. Meant to record what has been handed to the operator's
 * ledger. Nothing is handed over yet: an export waits until that ledger exists
 * and what it needs from this application is known.
 */
export const ledgerExport = pgTable(
	'ledger_export',
	{
		id: id(),
		event: text().notNull(),
		sourceTable: text().notNull(),
		sourceId: uuid().notNull(),
		datedOn: day().notNull(),
		exportedAt: tstz().defaultNow().notNull(),
		transactionText: text().notNull()
	},
	(t) => [
		unique('ledger_export_source_table_source_id_event_key').on(t.sourceTable, t.sourceId, t.event)
	]
);

/**
 * UNUSED, PLANNED. Which account in the operator's own ledger each kind of
 * posting goes to. Nothing supplies a default: a default would be one
 * business's chart applied to every other.
 */
export const accountMap = pgTable(
	'account_map',
	{
		/** What the account is for. */
		role: text().notNull(),
		/** The account name exactly as the operator's ledger has it. */
		account: text().notNull()
	},
	(t) => [primaryKey({ name: 'account_map_pkey', columns: [t.role] })]
);
