// What can go on a line.
//
// A service is configured, not categorised. What it is charged per -- the hour,
// the mile, or each -- how finely time is billed, whether there is a minimum,
// and whom it pays are all values an operator sets, not kinds built into the
// schema.
//
// A price is an effective-dated row, never a column: a rate is true for a
// period, and invoice_line stores what was billed rather than looking it up, or
// changing a price silently rewrites history. A price counts heads -- rate is
// the first person and additional_rate each one after. The most specific price
// that has started wins: one client's before every client's.
//
// Pay is a set of dated rules, resolved by #lib/server/valuation. A material is
// sold from lots, and each lot keeps its cost before tax and the tax paid on
// it, which Reg 1701 lets come off the measure when the goods are resold.

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
import { createdAt, day, decimal, id, money, nonNegative, oneOf } from './columns.ts';
import { entity } from './clients.ts';
import { role, user } from './people.ts';

export const UNITS = ['hour', 'mile', 'each'] as const;
export const PAYS_FOR = ['time', 'covered_time', 'vehicle'] as const;
export const PAY_METHODS = ['per_hour', 'percent', 'fixed', 'nothing'] as const;
export const MATERIAL_UNITS = ['each', 'foot'] as const;

export const service = pgTable(
	'service',
	{
		id: id(),
		code: text().notNull(),
		name: text().notNull(),
		/** What a quantity of it is: an hour, a mile, or each -- which is how a service charges a flat rate. */
		unit: text({ enum: UNITS }).notNull(),
		/**
		 * UNUSED, PLANNED. Whether lines of this service are taxed. The service
		 * page saves it; nothing builds invoice lines from it yet, and each line
		 * carries its own taxable.
		 */
		taxable: boolean().default(false).notNull(),
		active: boolean().default(true).notNull(),
		/**
		 * Whether this service appears in the timer. Independent of unit: a
		 * service charged per mile may still be worth timing.
		 */
		timeTracked: boolean().default(true).notNull(),
		/**
		 * Time billed to the nearest this many seconds: 60 is the nearest minute,
		 * 900 the nearest quarter hour. Null bills the exact time. Only for a
		 * service charged by the hour. Pay is never rounded this way: it is
		 * counted as worked.
		 */
		billToNearestSeconds: integer(),
		/** The least one entry of it bills, whatever its quantity. Null for none. */
		minimumCharge: money()
	},
	(t) => [
		unique('service_code_key').on(t.code),
		index('service_time_tracked')
			.on(t.timeTracked)
			.where(sql`${t.timeTracked}`),
		check('service_bill_to_nearest_seconds_check', sql`${t.billToNearestSeconds} > 0`),
		check(
			'service_increment_is_for_time',
			sql`(${t.unit} = 'hour') OR (${t.billToNearestSeconds} IS NULL)`
		),
		nonNegative('service_minimum_charge_check', t.minimumCharge),
		oneOf('service_unit_check', t.unit, UNITS)
	]
);

export const servicePrice = pgTable(
	'service_price',
	{
		id: id(),
		serviceId: uuid().notNull(),
		entityId: uuid(),
		/** The rate for the first person -- per hour, per mile or each, in the service's unit. */
		rate: money().notNull(),
		effectiveFrom: day().notNull(),
		/**
		 * What each person after the first adds to the hourly price: at 120.00 and
		 * 70.00, a crew of three is 260.00 an hour.
		 */
		additionalRate: money().default('0').notNull()
	},
	(t) => [
		unique('service_price_scope').on(t.serviceId, t.entityId, t.effectiveFrom).nullsNotDistinct(),
		index('service_price_asof').on(t.serviceId, t.effectiveFrom.desc()),
		foreignKey({
			name: 'service_price_service_id_fkey',
			columns: [t.serviceId],
			foreignColumns: [service.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'service_price_entity_id_fkey',
			columns: [t.entityId],
			foreignColumns: [entity.id]
		}).onDelete('cascade'),
		nonNegative('service_price_additional_rate_check', t.additionalRate),
		nonNegative('service_price_rate_check', t.rate)
	]
);

/**
 * Who a service pays, for what, and how. The most specific rule that has
 * started wins: a rule for one client beats one for every client, then a rule
 * for one person beats one for their role, then the newest. "nothing" exists so
 * a narrower rule can switch a wider one off, for one client or one person.
 */
export const payRule = pgTable(
	'pay_rule',
	{
		id: id(),
		serviceId: uuid().notNull(),
		roleId: uuid(),
		userId: uuid(),
		entityId: uuid(),
		/**
		 * What was contributed. time pays the person who spent it, on hours that
		 * are billed. covered_time pays for hours a retainer covers, as a share of
		 * the retainer. vehicle pays whoever owns the vehicle, so a company vehicle
		 * pays nobody and the business keeps it.
		 */
		paysFor: text({ enum: PAYS_FOR }).notNull(),
		/**
		 * per_hour: amount an hour worked, counted to the second. percent: amount
		 * percent of the line before tax; for covered_time, amount percent of the
		 * period's retainer charge, divided by each person's part of the covered
		 * time. fixed: amount per entry, however long. nothing: no pay.
		 */
		method: text({ enum: PAY_METHODS }).notNull(),
		amount: decimal(12, 4),
		effectiveFrom: day().notNull(),
		createdAt: createdAt()
	},
	(t) => [
		unique('pay_rule_scope')
			.on(t.serviceId, t.roleId, t.userId, t.entityId, t.paysFor, t.effectiveFrom)
			.nullsNotDistinct(),
		index('pay_rule_by_service').on(t.serviceId, t.paysFor, t.effectiveFrom.desc()),
		foreignKey({
			name: 'pay_rule_service_id_fkey',
			columns: [t.serviceId],
			foreignColumns: [service.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'pay_rule_role_id_fkey',
			columns: [t.roleId],
			foreignColumns: [role.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'pay_rule_user_id_fkey',
			columns: [t.userId],
			foreignColumns: [user.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'pay_rule_entity_id_fkey',
			columns: [t.entityId],
			foreignColumns: [entity.id]
		}).onDelete('cascade'),
		check(
			'pay_rule_amount_fits_method',
			sql`((${t.method} = 'nothing') AND (${t.amount} IS NULL)) OR ((${t.method} = 'percent') AND (${t.amount} IS NOT NULL) AND (${t.amount} >= 0) AND (${t.amount} <= 100)) OR ((${t.method} = ANY (ARRAY['per_hour', 'fixed'])) AND (${t.amount} IS NOT NULL) AND (${t.amount} >= 0))`
		),
		check(
			'pay_rule_covered_time_is_a_share',
			sql`(${t.paysFor} <> 'covered_time') OR (${t.method} = ANY (ARRAY['percent', 'nothing']))`
		),
		oneOf('pay_rule_method_check', t.method, PAY_METHODS),
		check('pay_rule_names_one_payee', sql`num_nonnulls(${t.roleId}, ${t.userId}) = 1`),
		oneOf('pay_rule_pays_for_check', t.paysFor, PAYS_FOR)
	]
);

export const material = pgTable(
	'material',
	{
		id: id(),
		sku: text(),
		name: text().notNull(),
		brand: text(),
		unit: text({ enum: MATERIAL_UNITS }).notNull(),
		/** Null takes operator.default_markup_pct. Set it here to override one item. */
		markupPct: decimal(7, 4),
		taxable: boolean().default(true).notNull(),
		/** UNUSED, PLANNED. The stock level at which to buy more. Nothing reads it yet. */
		reorderLevel: decimal(12, 4),
		active: boolean().default(true).notNull()
	},
	(t) => [
		unique('material_sku_key').on(t.sku),
		nonNegative('material_markup_pct_check', t.markupPct),
		nonNegative('material_reorder_level_check', t.reorderLevel),
		oneOf('material_unit_check', t.unit, MATERIAL_UNITS)
	]
);

export const materialPrice = pgTable(
	'material_price',
	{
		id: id(),
		materialId: uuid().notNull(),
		price: decimal(12, 4).notNull(),
		effectiveFrom: day().notNull()
	},
	(t) => [
		unique('material_price_material_id_effective_from_key').on(t.materialId, t.effectiveFrom),
		foreignKey({
			name: 'material_price_material_id_fkey',
			columns: [t.materialId],
			foreignColumns: [material.id]
		}).onDelete('cascade'),
		nonNegative('material_price_price_check', t.price)
	]
);

export const materialLot = pgTable(
	'material_lot',
	{
		id: id(),
		materialId: uuid().notNull(),
		receivedOn: day().notNull(),
		supplier: text(),
		/**
		 * UNUSED, PLANNED. The supplier's invoice or receipt the lot arrived on.
		 * Nothing records or reads it yet.
		 */
		documentRef: text(),
		qtyReceived: decimal(12, 4).notNull(),
		qtyRemaining: decimal(12, 4).notNull(),
		exTaxCostPerUnit: decimal(12, 4).notNull(),
		taxPaidPerUnit: decimal(12, 4).default('0').notNull()
	},
	(t) => [
		index('material_lot_open')
			.on(t.materialId, t.receivedOn)
			.where(sql`${t.qtyRemaining} > 0`),
		foreignKey({
			name: 'material_lot_material_id_fkey',
			columns: [t.materialId],
			foreignColumns: [material.id]
		}).onDelete('restrict'),
		check('cannot_use_more_than_received', sql`${t.qtyRemaining} <= ${t.qtyReceived}`),
		nonNegative('material_lot_ex_tax_cost_per_unit_check', t.exTaxCostPerUnit),
		check('material_lot_qty_received_check', sql`${t.qtyReceived} > 0`),
		nonNegative('material_lot_qty_remaining_check', t.qtyRemaining),
		nonNegative('material_lot_tax_paid_per_unit_check', t.taxPaidPerUnit)
	]
);
