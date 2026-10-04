// Standing arrangements.
//
// With site_id empty, an agreement covers the client wherever the work is
// done; with it set, only that site. A client may hold one of its own, one per
// site, or both.
//
// Its price is what one period charges. What it includes is named service by
// service in agreement_service, and there is no default: capped or unlimited,
// said outright rather than by leaving a column empty. A capped allotment is a
// number of hours belonging to the agreement, whichever sites it reaches, and a
// rule for the hours beyond. An hour falls under its site's agreement when that
// lists its service, and otherwise under the client's.
//
// An agreement bills on its own anniversary, not the calendar's:
// billing_anchor_day comes off starts_on and is then left alone. A period can
// be given -- written, with nothing charged, on purpose -- because a $0 period
// on its own reads the same as a mistake.

import { sql } from 'drizzle-orm';
import {
	boolean,
	check,
	foreignKey,
	pgTable,
	smallint,
	text,
	unique,
	uuid
} from 'drizzle-orm/pg-core';
import { day, decimal, id, money, nonNegative, oneOf } from './columns.ts';
import { contact, entity, site } from './clients.ts';
import { service } from './catalogue.ts';

export const INTERVALS = ['weekly', 'monthly', 'quarterly', 'annually'] as const;
export const PRORATIONS = ['none', 'daily'] as const;
export const ALLOTMENTS = ['capped', 'unlimited'] as const;
export const OVERAGES = ['bill', 'no_charge', 'deny'] as const;

export const agreement = pgTable(
	'agreement',
	{
		id: id(),
		entityId: uuid().notNull(),
		/** What one period of the agreement charges. */
		price: money().notNull(),
		startsOn: day().notNull(),
		endsOn: day(),
		/**
		 * The person this was agreed with. A retainer is agreed with somebody by
		 * name, and when it is questioned a year later that name is the answer.
		 * Losing the contact must not lose the agreement.
		 */
		contactId: uuid(),
		/** How often it bills. The period it covers is agreement_period; this is the rule that generates one. */
		billingInterval: text({ enum: INTERVALS }).default('monthly').notNull(),
		/**
		 * The day of the month this bills on, taken from starts_on and then left
		 * alone. Kept as a number rather than read back off the last invoice: a
		 * 31st anchor bills 28 February and must still bill 31 March.
		 */
		billingAnchorDay: smallint().notNull(),
		/**
		 * What happens to a period this agreement did not finish. daily: the
		 * client is billed the days they had. none: the last period bills whole,
		 * whenever it ended. Only ever applies to the period containing ends_on --
		 * every other period is whole, because billing is anchored to starts_on.
		 */
		finalPeriodProration: text({ enum: PRORATIONS }).default('daily').notNull(),
		/**
		 * The one site this agreement is for, or empty for the client as a whole.
		 * A site's agreement covers work there; the client's covers work anywhere
		 * else. It must be one of the client's own sites.
		 */
		siteId: uuid()
	},
	(t) => [
		foreignKey({
			name: 'agreement_entity_id_fkey',
			columns: [t.entityId],
			foreignColumns: [entity.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'agreement_contact_id_fkey',
			columns: [t.contactId],
			foreignColumns: [contact.id]
		}).onDelete('set null'),
		foreignKey({
			name: 'agreement_site_is_the_clients',
			columns: [t.siteId, t.entityId],
			foreignColumns: [site.id, site.entityId]
		}).onDelete('restrict'),
		// agreement_contact_is_the_clients -- the contact must be the client's --
		// nulls only contact_id when the person leaves, which Drizzle cannot
		// express. It is in the hand-written migration.
		check(
			'agreement_billing_anchor_day_check',
			sql`(${t.billingAnchorDay} >= 1) AND (${t.billingAnchorDay} <= 31)`
		),
		oneOf('agreement_billing_interval_check', t.billingInterval, INTERVALS),
		check(
			'agreement_ends_after_it_starts',
			sql`(${t.endsOn} IS NULL) OR (${t.endsOn} >= ${t.startsOn})`
		),
		oneOf('agreement_final_period_proration_check', t.finalPeriodProration, PRORATIONS),
		nonNegative('agreement_price_check', t.price)
	]
);

/**
 * One row per service an agreement covers, with its allotment: unlimited, or
 * included_hours each period and an overage rule. The hours belong to the
 * agreement and are shared by every site it reaches. Only hours of a listed
 * service draw on it; anything else bills as usual.
 */
export const agreementService = pgTable(
	'agreement_service',
	{
		id: id(),
		agreementId: uuid().notNull(),
		serviceId: uuid().notNull(),
		allotment: text({ enum: ALLOTMENTS }).notNull(),
		includedHours: decimal(8, 2),
		overage: text({ enum: OVERAGES })
	},
	(t) => [
		unique('agreement_service_once').on(t.agreementId, t.serviceId),
		foreignKey({
			name: 'agreement_service_agreement_id_fkey',
			columns: [t.agreementId],
			foreignColumns: [agreement.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'agreement_service_service_id_fkey',
			columns: [t.serviceId],
			foreignColumns: [service.id]
		}).onDelete('restrict'),
		oneOf('agreement_service_allotment_check', t.allotment, ALLOTMENTS),
		check(
			'agreement_service_cap_is_whole',
			sql`((${t.allotment} = 'capped') AND (${t.includedHours} IS NOT NULL) AND (${t.overage} IS NOT NULL)) OR ((${t.allotment} = 'unlimited') AND (${t.includedHours} IS NULL) AND (${t.overage} IS NULL))`
		),
		nonNegative('agreement_service_included_hours_check', t.includedHours),
		oneOf('agreement_service_overage_check', t.overage, OVERAGES)
	]
);

export const agreementPeriod = pgTable(
	'agreement_period',
	{
		id: id(),
		agreementId: uuid().notNull(),
		periodStart: day().notNull(),
		periodEnd: day().notNull(),
		amount: money().notNull(),
		/**
		 * This period was given: covered, and deliberately not charged. Its amount
		 * is 0, and given says the 0 is on purpose.
		 */
		given: boolean().default(false).notNull()
	},
	(t) => [
		unique('agreement_period_agreement_id_period_start_key').on(t.agreementId, t.periodStart),
		foreignKey({
			name: 'agreement_period_agreement_id_fkey',
			columns: [t.agreementId],
			foreignColumns: [agreement.id]
		}).onDelete('restrict'),
		nonNegative('agreement_period_amount_check', t.amount),
		check('agreement_period_given_charges_nothing', sql`(NOT ${t.given}) OR (${t.amount} = 0)`),
		check('period_ends_after_it_starts', sql`${t.periodEnd} >= ${t.periodStart}`)
	]
);
