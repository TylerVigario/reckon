// What a person was paid, as it was paid (0026). Pay is worked out live from
// the work and the rules (#lib/server/valuation); a payment records what it
// came to on the day, so a later role or rule moves only what is still unpaid.
// reckon records a payment; the money moves at the bank.

import { sql } from 'drizzle-orm';
import {
	check,
	foreignKey,
	index,
	pgTable,
	text,
	unique,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { createdAt, day, id, money } from './columns.ts';
import { user } from './people.ts';
import { timeEntry, trip } from './work.ts';

/**
 * A payment to one person: the day it was made, how, and a note. Never changed
 * once recorded; a correction is an item on the next one.
 */
export const personPayment = pgTable(
	'person_payment',
	{
		id: id(),
		userId: uuid().notNull(),
		paidOn: day().notNull(),
		/** How it was paid: a bank transfer, cash, a check. */
		how: text().notNull(),
		note: text(),
		/** Made where it was recorded, so a save sent twice is one payment. */
		clientUuid: uuid().notNull(),
		createdBy: uuid().notNull(),
		createdAt: createdAt()
	},
	(t) => [
		unique('person_payment_client_uuid_key').on(t.clientUuid),
		// What an item names as its payment must be its own person's.
		unique('person_payment_id_user_id_key').on(t.id, t.userId),
		index('person_payment_by_person').on(t.userId, t.paidOn),
		check('person_payment_how_is_something', sql`btrim(${t.how}) <> ''`),
		foreignKey({
			name: 'person_payment_user_id_fkey',
			columns: [t.userId],
			foreignColumns: [user.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'person_payment_created_by_fkey',
			columns: [t.createdBy],
			foreignColumns: [user.id]
		}).onDelete('restrict')
	]
);

/**
 * What a payment covered, each as it was worked out that day: an entry's time,
 * a trip's miles for the vehicle the person owns, or a correction to an earlier
 * payment, plus or minus. `said` is how the figure was reached -- the hours and
 * the rule, in words -- kept as it was, whatever the rules say later. A piece of
 * work is paid to a person once.
 */
export const personPaymentItem = pgTable(
	'person_payment_item',
	{
		id: id(),
		paymentId: uuid().notNull(),
		userId: uuid().notNull(),
		timeEntryId: uuid(),
		tripId: uuid(),
		correctsPaymentId: uuid(),
		amount: money().notNull(),
		said: text().notNull()
	},
	(t) => [
		uniqueIndex('person_payment_item_entry_once')
			.on(t.userId, t.timeEntryId)
			.where(sql`${t.timeEntryId} IS NOT NULL`),
		uniqueIndex('person_payment_item_trip_once')
			.on(t.userId, t.tripId)
			.where(sql`${t.tripId} IS NOT NULL`),
		index('person_payment_item_payment').on(t.paymentId),
		check(
			'person_payment_item_is_one_thing',
			sql`num_nonnulls(${t.timeEntryId}, ${t.tripId}, ${t.correctsPaymentId}) = 1`
		),
		// Only a correction can take something back.
		check(
			'person_payment_item_pays',
			sql`(${t.amount} >= 0) OR (${t.correctsPaymentId} IS NOT NULL)`
		),
		check('person_payment_item_says_how', sql`btrim(${t.said}) <> ''`),
		// A correction is to another payment, made before.
		check(
			'person_payment_item_corrects_another',
			sql`${t.correctsPaymentId} IS DISTINCT FROM ${t.paymentId}`
		),
		foreignKey({
			name: 'person_payment_item_payment_is_the_persons',
			columns: [t.paymentId, t.userId],
			foreignColumns: [personPayment.id, personPayment.userId]
		}).onDelete('restrict'),
		foreignKey({
			name: 'person_payment_item_time_entry_id_fkey',
			columns: [t.timeEntryId],
			foreignColumns: [timeEntry.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'person_payment_item_trip_id_fkey',
			columns: [t.tripId],
			foreignColumns: [trip.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'person_payment_item_corrects_is_the_persons',
			columns: [t.correctsPaymentId, t.userId],
			foreignColumns: [personPayment.id, personPayment.userId]
		}).onDelete('restrict')
	]
);
