// What reckon sends by email, and whether it went.
import { sql, type Kysely, type SqlBool } from 'kysely';

export async function mail(db: Kysely<any>): Promise<void> {
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
	await db.schema
		.createTable('email_message')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addColumn('kind', sql`email_message_kind`, (c) => c.notNull())
		/** Whom it is about, if anyone: kept until they are taken away. */
		.addColumn('user_id', 'uuid', (c) => c.references('user.id').onDelete('set null'))
		.addColumn('to_address', 'text', (c) => c.notNull())
		.addColumn('subject', 'text', (c) => c.notNull())
		/** Plain text. Null once it has been sent or given up on. */
		.addColumn('body', 'text')
		/**
		 * The same as HTML (#lib/server/email-layout), sent after the text as its
		 * richer form. Null once it has been sent or given up on, and for the
		 * messages written before reckon sent HTML.
		 */
		.addColumn('html', 'text')
		/** After this it is no longer worth sending, and is given up on. */
		.addColumn('send_by', 'timestamptz', (c) => c.notNull())
		/** When it is next tried. */
		.addColumn('next_try_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addColumn('tries', 'smallint', (c) =>
			c
				.notNull()
				.defaultTo(0)
				.check(sql`tries >= 0`)
		)
		/** Held by a sender until then, so two never send it at once. */
		.addColumn('claimed_until', 'timestamptz')
		.addColumn('sent_at', 'timestamptz')
		.addColumn('gave_up_at', 'timestamptz')
		/** What the relay last said, or why it could not be reached. */
		.addColumn('last_error', 'text')
		.addCheckConstraint('email_message_to_lowercase', sql`to_address = lower(to_address)`)
		.addCheckConstraint('email_message_subject_is_something', sql`btrim(subject) <> ''`)
		.addCheckConstraint(
			'email_message_sent_or_given_up',
			sql`sent_at is null or gave_up_at is null`
		)
		// What it said is there exactly while it is still to send.
		.addCheckConstraint(
			'email_message_body_while_waiting',
			sql`(sent_at is null and gave_up_at is null) = (body is not null)`
		)
		// The HTML is the text's other form: never kept without it.
		.addCheckConstraint('email_message_html_beside_its_text', sql`html is null or body is not null`)
		.execute();
	await db.schema
		.createIndex('email_message_due')
		.on('email_message')
		.column('next_try_at')
		.where(sql<SqlBool>`sent_at is null and gave_up_at is null`)
		.execute();
	await db.schema
		.createIndex('email_message_by_time')
		.on('email_message')
		.column('created_at')
		.execute();
	await db.schema
		.createIndex('email_message_by_user')
		.on('email_message')
		.columns(['user_id', 'created_at'])
		.execute();
}
