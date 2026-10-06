// Money out and money in.
//
// An invoice is built as a draft and sent once; after that it is immutable,
// which triggers in the hand-written migrations enforce, and a credit note is
// the only way to change what a client owes. Each line stores what was billed
// -- quantity, price, tax rate, the cost of resold goods -- rather than looking
// it up, so a price changed later rewrites nothing already sent. A line points
// at what produced it: one time entry, trip leg, agreement period or material,
// or none. What a line drawn from stock took off each lot is stock_draw.
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
	primaryKey,
	text,
	unique,
	uuid
} from 'drizzle-orm/pg-core';
import { bytea, createdAt, day, decimal, id, money, nonNegative, oneOf, tstz } from './columns.ts';
import { entity, site } from './clients.ts';
import { material, materialLot, RECEIPT_TYPES } from './catalogue.ts';
import { agreementPeriod } from './agreements.ts';
import { timeEntry, tripLeg } from './work.ts';
import { user } from './people.ts';

export const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'void'] as const;
/**
 * How a line behaves. service, recurring and adjustment are the work and the
 * charges; the goods and costs passed on are three: material, drawn from stock;
 * bought, goods bought for this job and passed on; paid_for, a fee, a hire or a
 * bill paid on the client's behalf, which is not goods.
 */
export const LINE_KINDS = [
	'service',
	'material',
	'recurring',
	'adjustment',
	'bought',
	'paid_for'
] as const;
export const TAX_SOURCES = ['none', 'site', 'override', 'exempt'] as const;
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
		/**
		 * Made on the phone that added the line by hand, so a retry after a
		 * timeout cannot add it twice. Null on a line the server built.
		 */
		clientUuid: uuid(),
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
		amount: money().notNull(),
		timeEntryId: uuid(),
		tripLegId: uuid(),
		agreementPeriodId: uuid(),
		/**
		 * What a line drawn from stock is of. What it took from each lot is in
		 * stock_draw.
		 */
		materialId: uuid(),
		/**
		 * What qty counts, frozen at issue. Null when the quantity counts nothing,
		 * as on a flat charge or an adjustment.
		 */
		unit: text(),
		siteId: uuid(),
		/** Who it was bought from or paid to: "Valley Hardware", "City of Woodland". */
		boughtFrom: text(),
		/** Who paid for it: a person, who is owed it back, or the business when empty. */
		paidBy: uuid(),
		/** The receipt, as the phone shrank it, and its type. */
		receipt: bytea(),
		receiptType: text()
	},
	(t) => [
		unique('invoice_line_invoice_id_seq_key').on(t.invoiceId, t.seq),
		unique('invoice_line_client_uuid_key').on(t.clientUuid),
		unique('invoice_line_time_entry_id_key').on(t.timeEntryId),
		unique('invoice_line_trip_leg_id_key').on(t.tripLegId),
		unique('invoice_line_agreement_period_id_key').on(t.agreementPeriodId),
		// What a draw names, so the lots it comes off are of the line's material.
		unique('invoice_line_id_material_id_key').on(t.id, t.materialId),
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
			name: 'invoice_line_material_id_fkey',
			columns: [t.materialId],
			foreignColumns: [material.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'invoice_line_site_id_fkey',
			columns: [t.siteId],
			foreignColumns: [site.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'invoice_line_paid_by_fkey',
			columns: [t.paidBy],
			foreignColumns: [user.id]
		}).onDelete('restrict'),
		check(
			'invoice_line_receipt_comes_with_its_type',
			sql`(${t.receipt} IS NULL) = (${t.receiptType} IS NULL)`
		),
		oneOf('invoice_line_receipt_type_check', t.receiptType, RECEIPT_TYPES),
		check('invoice_line_receipt_size_check', sql`octet_length(${t.receipt}) <= 2097152`),
		check(
			'material_is_for_what_is_drawn',
			sql`(${t.materialId} IS NULL) OR (${t.kind} = 'material')`
		),
		// Who paid is said of what was bought or paid for, and of nothing else.
		check(
			'paid_by_is_for_what_was_bought',
			sql`(${t.paidBy} IS NULL) OR (${t.kind} IN ('bought', 'paid_for'))`
		),
		oneOf('invoice_line_kind_check', t.kind, LINE_KINDS),
		nonNegative('invoice_line_tax_rate_pct_check', t.taxRatePct),
		oneOf('invoice_line_tax_source_check', t.taxSource, TAX_SOURCES),
		// The unit as it was billed, in words: a line keeps saying what it counted
		// after a unit is renamed or a service changes how it is charged.
		check('invoice_line_unit_is_something', sql`(${t.unit} IS NULL) OR (btrim(${t.unit}) <> '')`),
		check(
			'one_source_at_most',
			sql`((${t.timeEntryId} IS NOT NULL)::integer + (${t.tripLegId} IS NOT NULL)::integer + (${t.agreementPeriodId} IS NOT NULL)::integer + (${t.materialId} IS NOT NULL)::integer) <= 1`
		),
		check(
			'override_needs_a_reason',
			sql`(${t.taxSource} <> 'override') OR (${t.taxOverrideReason} IS NOT NULL)`
		),
		check('untaxed_lines_carry_no_rate', sql`${t.taxable} OR (${t.taxRatePct} = 0)`)
	]
);

/**
 * What a line drawn from stock took off each lot: 147 ft, 100 off the oldest
 * spool and 47 off the next. A lot's qty_remaining follows these -- a trigger
 * takes a draw off its lot and puts it back when the draw goes, as it does with
 * its line or a deleted draft -- so stock is never counted twice, and a draw
 * larger than what is left is refused by the lot's own check.
 *
 * The material is named twice over so the database holds a line's draws to its
 * own material: (line, material) and (lot, material) must each exist.
 */
export const stockDraw = pgTable(
	'stock_draw',
	{
		invoiceLineId: uuid().notNull(),
		materialLotId: uuid().notNull(),
		materialId: uuid().notNull(),
		qty: decimal(12, 4).notNull()
	},
	(t) => [
		primaryKey({ name: 'stock_draw_pkey', columns: [t.invoiceLineId, t.materialLotId] }),
		index('stock_draw_lot').on(t.materialLotId),
		foreignKey({
			name: 'stock_draw_line_fkey',
			columns: [t.invoiceLineId, t.materialId],
			foreignColumns: [invoiceLine.id, invoiceLine.materialId]
		}).onDelete('cascade'),
		foreignKey({
			name: 'stock_draw_lot_fkey',
			columns: [t.materialLotId, t.materialId],
			foreignColumns: [materialLot.id, materialLot.materialId]
		}).onDelete('restrict'),
		check('stock_draw_qty_check', sql`${t.qty} > 0`)
	]
);

export const creditNote = pgTable(
	'credit_note',
	{
		id: id(),
		number: text().notNull(),
		entityId: uuid().notNull(),
		issuedOn: day().notNull(),
		amount: money().notNull(),
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
		amount: money().notNull(),
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
		gross: money().notNull(),
		fees: money().default('0').notNull(),
		net: money().notNull(),
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
		gross: money().notNull(),
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
		amount: money().notNull()
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
		amount: money().notNull(),
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
		amount: money().notNull(),
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
