// Money out and money in.
//
// An invoice is built as a draft and sent once; after that it is immutable,
// which a trigger in the hand-written migration enforces, and a credit note is
// the only way to change what a client owes. Each line stores what was billed
// -- quantity, price, tax rate, the cost of resold goods -- rather than looking
// it up, so a price changed later rewrites nothing already sent. A line points
// at what produced it: one time entry, trip leg, agreement period or lot, or
// none.
//
// A payment is what arrived; payment_allocation says which invoices it paid,
// so a partial payment and one deposit covering several invoices are both
// ordinary.

import { sql } from 'drizzle-orm';
import {
	boolean,
	check,
	foreignKey,
	index,
	integer,
	pgTable,
	text,
	unique,
	uuid
} from 'drizzle-orm/pg-core';
import { createdAt, day, decimal, id, nonNegative, oneOf, tstz } from './columns';
import { entity, site } from './clients';
import { materialLot } from './catalogue';
import { agreementPeriod } from './agreements';
import { timeEntry, tripLeg } from './work';
import { user } from './people';

export const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'void'] as const;
export const LINE_KINDS = ['service', 'material', 'recurring', 'adjustment'] as const;
export const TAX_SOURCES = ['none', 'site', 'override', 'exempt'] as const;
export const LINE_UNITS = ['hour', 'mile', 'each', 'foot', 'month'] as const;
export const CREDIT_KINDS = ['reg1700b', 'correction', 'goodwill'] as const;
export const PAYMENT_METHODS = ['card', 'transfer', 'cheque', 'cash', 'other'] as const;

export const invoice = pgTable(
	'invoice',
	{
		id: id(),
		number: text().notNull(),
		entityId: uuid().notNull(),
		status: text({ enum: INVOICE_STATUSES }).default('draft').notNull(),
		issuedOn: day(),
		dueOn: day(),
		periodStart: day(),
		periodEnd: day(),
		/**
		 * UNUSED, PLANNED. A link that lets a client read one invoice without an
		 * account. Nothing issues or checks a token yet, so the column is always
		 * null and /invoice/<token> does not exist.
		 */
		publicToken: text(),
		/**
		 * UNUSED, PLANNED. When the public link stops working. A link that never
		 * expires is a link that is still live in an inbox in three years.
		 */
		tokenExpiresOn: day(),
		sentAt: tstz(),
		createdBy: uuid().notNull(),
		/**
		 * UNUSED, PLANNED. Why an invoice was voided. The CHECK that a void needs
		 * a reason is enforced and currently unreachable: nothing can void one.
		 */
		voidReason: text(),
		createdAt: createdAt()
	},
	(t) => [
		unique('invoice_number_key').on(t.number),
		unique('invoice_public_token_key').on(t.publicToken),
		index('invoice_entity_status').on(t.entityId, t.status),
		foreignKey({
			name: 'invoice_entity_id_fkey',
			columns: [t.entityId],
			foreignColumns: [entity.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'invoice_created_by_fkey',
			columns: [t.createdBy],
			foreignColumns: [user.id]
		}).onDelete('restrict'),
		oneOf('invoice_status_check', t.status, INVOICE_STATUSES),
		check(
			'sent_invoices_have_dates',
			sql`(${t.status} = 'draft') OR ((${t.issuedOn} IS NOT NULL) AND (${t.dueOn} IS NOT NULL))`
		),
		check('voiding_needs_a_reason', sql`(${t.status} <> 'void') OR (${t.voidReason} IS NOT NULL)`)
	]
);

export const invoiceLine = pgTable(
	'invoice_line',
	{
		id: id(),
		invoiceId: uuid().notNull(),
		seq: integer().notNull(),
		kind: text({ enum: LINE_KINDS }).notNull(),
		description: text().notNull(),
		qty: decimal(12, 4).notNull(),
		unitPrice: decimal(12, 4).notNull(),
		taxable: boolean().default(false).notNull(),
		taxRatePct: decimal(7, 4).default('0').notNull(),
		taxSource: text({ enum: TAX_SOURCES }).default('none').notNull(),
		taxOverrideReason: text(),
		exTaxCost: decimal(12, 4),
		taxPaid: decimal(12, 4),
		amount: decimal(12, 2).notNull(),
		timeEntryId: uuid(),
		tripLegId: uuid(),
		agreementPeriodId: uuid(),
		materialLotId: uuid(),
		/**
		 * What qty counts, frozen at issue. Null when the quantity counts nothing,
		 * as on a flat charge or an adjustment.
		 */
		unit: text({ enum: LINE_UNITS }),
		siteId: uuid()
	},
	(t) => [
		unique('invoice_line_invoice_id_seq_key').on(t.invoiceId, t.seq),
		unique('invoice_line_time_entry_id_key').on(t.timeEntryId),
		unique('invoice_line_trip_leg_id_key').on(t.tripLegId),
		unique('invoice_line_agreement_period_id_key').on(t.agreementPeriodId),
		index('invoice_line_material').on(t.materialLotId),
		foreignKey({
			name: 'invoice_line_invoice_id_fkey',
			columns: [t.invoiceId],
			foreignColumns: [invoice.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'invoice_line_time_entry_id_fkey',
			columns: [t.timeEntryId],
			foreignColumns: [timeEntry.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'invoice_line_trip_leg_id_fkey',
			columns: [t.tripLegId],
			foreignColumns: [tripLeg.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'invoice_line_agreement_period_id_fkey',
			columns: [t.agreementPeriodId],
			foreignColumns: [agreementPeriod.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'invoice_line_material_lot_id_fkey',
			columns: [t.materialLotId],
			foreignColumns: [materialLot.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'invoice_line_site_id_fkey',
			columns: [t.siteId],
			foreignColumns: [site.id]
		}).onDelete('restrict'),
		oneOf('invoice_line_kind_check', t.kind, LINE_KINDS),
		nonNegative('invoice_line_tax_rate_pct_check', t.taxRatePct),
		oneOf('invoice_line_tax_source_check', t.taxSource, TAX_SOURCES),
		oneOf('invoice_line_unit_check', t.unit, LINE_UNITS),
		check(
			'one_source_at_most',
			sql`((${t.timeEntryId} IS NOT NULL)::integer + (${t.tripLegId} IS NOT NULL)::integer + (${t.agreementPeriodId} IS NOT NULL)::integer + (${t.materialLotId} IS NOT NULL)::integer) <= 1`
		),
		check(
			'override_needs_a_reason',
			sql`(${t.taxSource} <> 'override') OR (${t.taxOverrideReason} IS NOT NULL)`
		),
		check('untaxed_lines_carry_no_rate', sql`${t.taxable} OR (${t.taxRatePct} = 0)`)
	]
);

export const creditNote = pgTable(
	'credit_note',
	{
		id: id(),
		number: text().notNull(),
		entityId: uuid().notNull(),
		issuedOn: day().notNull(),
		amount: decimal(12, 2).notNull(),
		kind: text({ enum: CREDIT_KINDS }).notNull(),
		reason: text().notNull(),
		createdBy: uuid().notNull(),
		createdAt: createdAt()
	},
	(t) => [
		unique('credit_note_number_key').on(t.number),
		foreignKey({
			name: 'credit_note_entity_id_fkey',
			columns: [t.entityId],
			foreignColumns: [entity.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'credit_note_created_by_fkey',
			columns: [t.createdBy],
			foreignColumns: [user.id]
		}).onDelete('restrict'),
		check('credit_note_amount_check', sql`${t.amount} > 0`),
		oneOf('credit_note_kind_check', t.kind, CREDIT_KINDS)
	]
);

export const creditApplication = pgTable(
	'credit_application',
	{
		id: id(),
		creditNoteId: uuid().notNull(),
		invoiceId: uuid().notNull(),
		amount: decimal(12, 2).notNull(),
		appliedOn: day().notNull()
	},
	(t) => [
		unique('credit_application_credit_note_id_invoice_id_key').on(t.creditNoteId, t.invoiceId),
		foreignKey({
			name: 'credit_application_credit_note_id_fkey',
			columns: [t.creditNoteId],
			foreignColumns: [creditNote.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'credit_application_invoice_id_fkey',
			columns: [t.invoiceId],
			foreignColumns: [invoice.id]
		}).onDelete('restrict'),
		check('credit_application_amount_check', sql`${t.amount} > 0`)
	]
);

/**
 * UNUSED, PLANNED. A settlement batch from a card processor: several invoices
 * paid, one deposit, minus a fee. payment.payout_id already points here.
 */
export const payout = pgTable(
	'payout',
	{
		id: id(),
		processor: text().notNull(),
		arrivedOn: day().notNull(),
		gross: decimal(12, 2).notNull(),
		fees: decimal(12, 2).default('0').notNull(),
		net: decimal(12, 2).notNull(),
		bankReference: text()
	},
	(t) => [check('payout_nets_out', sql`${t.net} = (${t.gross} - ${t.fees})`)]
);

export const payment = pgTable(
	'payment',
	{
		id: id(),
		entityId: uuid().notNull(),
		receivedOn: day().notNull(),
		gross: decimal(12, 2).notNull(),
		method: text({ enum: PAYMENT_METHODS }).notNull(),
		/** UNUSED, PLANNED. The card processor's id for the payment. Nothing records it yet. */
		processorRef: text(),
		payoutId: uuid(),
		createdAt: createdAt()
	},
	(t) => [
		index('payment_entity').on(t.entityId, t.receivedOn),
		index('payment_payout').on(t.payoutId),
		foreignKey({
			name: 'payment_entity_id_fkey',
			columns: [t.entityId],
			foreignColumns: [entity.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'payment_payout_id_fkey',
			columns: [t.payoutId],
			foreignColumns: [payout.id]
		}).onDelete('set null'),
		check('payment_gross_check', sql`${t.gross} > 0`),
		oneOf('payment_method_check', t.method, PAYMENT_METHODS)
	]
);

export const paymentAllocation = pgTable(
	'payment_allocation',
	{
		id: id(),
		paymentId: uuid().notNull(),
		invoiceId: uuid().notNull(),
		amount: decimal(12, 2).notNull()
	},
	(t) => [
		unique('payment_allocation_payment_id_invoice_id_key').on(t.paymentId, t.invoiceId),
		foreignKey({
			name: 'payment_allocation_payment_id_fkey',
			columns: [t.paymentId],
			foreignColumns: [payment.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'payment_allocation_invoice_id_fkey',
			columns: [t.invoiceId],
			foreignColumns: [invoice.id]
		}).onDelete('restrict'),
		check('payment_allocation_amount_check', sql`${t.amount} > 0`)
	]
);

/**
 * UNUSED, PLANNED. Money sent back. Distinct from a credit note, which is a
 * reduction in what is owed rather than a movement of cash.
 */
export const refund = pgTable(
	'refund',
	{
		id: id(),
		paymentId: uuid().notNull(),
		amount: decimal(12, 2).notNull(),
		refundedOn: day().notNull(),
		reason: text().notNull()
	},
	(t) => [
		foreignKey({
			name: 'refund_payment_id_fkey',
			columns: [t.paymentId],
			foreignColumns: [payment.id]
		}).onDelete('restrict'),
		check('refund_amount_check', sql`${t.amount} > 0`)
	]
);

/**
 * A return that was filed and the money that went with it. Nothing here can be
 * derived: what was charged is in the invoices, but what was handed over is a
 * fact about the world, and the difference is what is still owed.
 */
export const taxRemittance = pgTable(
	'tax_remittance',
	{
		id: id(),
		periodStart: day().notNull(),
		periodEnd: day().notNull(),
		/**
		 * When the return went in. Distinct from paid_on: a return can be filed and
		 * paid on different days, and a ledger posts the payment.
		 */
		filedOn: day(),
		paidOn: day(),
		amount: decimal(12, 2).notNull(),
		reference: text(),
		note: text(),
		createdBy: uuid().notNull(),
		createdAt: createdAt()
	},
	(t) => [
		unique('one_filing_per_period').on(t.periodStart, t.periodEnd),
		foreignKey({
			name: 'tax_remittance_created_by_fkey',
			columns: [t.createdBy],
			foreignColumns: [user.id]
		}).onDelete('restrict'),
		check('remittance_period_ends_after_it_starts', sql`${t.periodEnd} >= ${t.periodStart}`),
		nonNegative('tax_remittance_amount_check', t.amount)
	]
);
