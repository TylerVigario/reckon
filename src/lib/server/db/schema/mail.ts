// What reckon sends by email, and whether it went.

import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, smallint, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, lowercaseEmail, oneOf, tstz } from './columns.ts';
import { user } from './people.ts';
import { EMAIL_KINDS } from '../../notices.js';

/**
 * One row per email (#lib/server/email): written in the same transaction as
 * the change it tells of, so it is sent if and only if that change is kept,
 * and sent afterwards, so no request waits on mail. A failure the relay calls
 * temporary is tried again, later each time, until it goes or its send_by
 * passes; one it calls permanent is given up on at once.
 *
 * What it said is kept only until it is sent or given up on, then nothing but
 * that it was; a row is deleted after 90 days.
 */
export const emailMessage = pgTable(
	'email_message',
	{
		id: id(),
		createdAt: createdAt(),
		kind: text({ enum: EMAIL_KINDS }).notNull(),
		/** Whom it is about, if anyone: kept until they are taken away. */
		userId: uuid(),
		toAddress: text().notNull(),
		subject: text().notNull(),
		/** Plain text. Null once it has been sent or given up on. */
		body: text(),
		/** After this it is no longer worth sending, and is given up on. */
		sendBy: tstz().notNull(),
		/** When it is next tried. */
		nextTryAt: tstz().defaultNow().notNull(),
		tries: smallint().default(0).notNull(),
		/** Held by a sender until then, so two never send it at once. */
		claimedUntil: tstz(),
		sentAt: tstz(),
		gaveUpAt: tstz(),
		/** What the relay last said, or why it could not be reached. */
		lastError: text()
	},
	(t) => [
		index('email_message_due')
			.on(t.nextTryAt)
			.where(sql`${t.sentAt} is null and ${t.gaveUpAt} is null`),
		index('email_message_by_time').on(t.createdAt),
		index('email_message_by_user').on(t.userId, t.createdAt),
		oneOf('email_message_kind_check', t.kind, EMAIL_KINDS),
		lowercaseEmail('email_message_to_lowercase', t.toAddress),
		check('email_message_subject_is_something', sql`btrim(${t.subject}) <> ''`),
		check('email_message_tries_check', sql`${t.tries} >= 0`),
		check('email_message_sent_or_given_up', sql`${t.sentAt} is null or ${t.gaveUpAt} is null`),
		// What it said is there exactly while it is still to send.
		check(
			'email_message_body_while_waiting',
			sql`(${t.sentAt} is null and ${t.gaveUpAt} is null) = (${t.body} is not null)`
		),
		foreignKey({
			name: 'email_message_user_id_fkey',
			columns: [t.userId],
			foreignColumns: [user.id]
		}).onDelete('set null')
	]
);
