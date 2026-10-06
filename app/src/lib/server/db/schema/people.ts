// People, the capacity they are paid in, and how they sign in.
//
// user, session, account and verification are Better Auth's, in the shape its
// Drizzle adapter reads: it finds them by these names and these fields. They
// are kept by hand rather than generated because the conventions here differ
// from its generator's output: ids are uuids the database makes (so Better
// Auth runs with advanced.database.generateId false), timestamps carry their
// zone, and emails are stored lowercased. When its config gains a plugin that
// adds fields, generate into a scratch file and carry them across.
//
// A password is never a column of user. It is account.password, an argon2id
// hash carrying its own parameters, set by Better Auth through the hash
// function in #lib/server/auth.

import { sql } from 'drizzle-orm';
import {
	boolean,
	check,
	foreignKey,
	index,
	pgTable,
	smallint,
	text,
	unique,
	uuid
} from 'drizzle-orm/pg-core';
import { createdAt, id, lowercaseEmail, oneOf, tstz, updatedAt } from './columns.ts';

/** A 12-hour clock, or a 24-hour one, as Unicode names them (the locale key hc). */
export const HOUR_CYCLES = ['h12', 'h23'] as const;

/**
 * The operator's own list of the capacities people are paid in -- Partner,
 * Employee, Contractor, or whatever a business calls them. Pay rules are
 * written against these, so a business names its own rather than inheriting
 * ours.
 */
export const role = pgTable(
	'role',
	{
		id: id(),
		name: text().notNull(),
		createdAt: createdAt()
	},
	(t) => [
		unique('role_name_key').on(t.name),
		check('role_name_is_something', sql`btrim(${t.name}) <> ''`)
	]
);

/**
 * Anyone who can sign in. Signing in is an account row, so a user without one
 * cannot; there is no sign-up, and accounts are made from the command line.
 */
export const user = pgTable(
	'user',
	{
		id: id(),
		name: text().notNull(),
		email: text().notNull(),
		emailVerified: boolean().default(false).notNull(),
		image: text(),
		/**
		 * The capacity this person is paid in, now. Null means they sign in and
		 * are not paid. It is a current value, not a history: a role change
		 * reprices nothing already worked out.
		 */
		roleId: uuid(),
		/** Whether they count: an inactive person is not offered to work, nor ticked on a team. */
		active: boolean().default(true).notNull(),
		/**
		 * The zone this person keeps their days in, as Postgres names it. Their
		 * own timesheet, the day a new entry starts on, and every moment shown to
		 * them are on this clock (#lib/server/calendar). Set from their browser
		 * the first time they sign in, and theirs to change; null until then,
		 * which follows the business's zone.
		 */
		timezone: text(),
		/**
		 * How dates and figures read for this person: a locale, as BCP 47 writes
		 * one ("en-GB") -- language, the order of day and month, the separators.
		 * Null follows the business's locale. Theirs to set, in their profile.
		 */
		locale: text(),
		/** A 12- or 24-hour clock, over what their locale says. Null keeps the locale's. */
		hourCycle: text({ enum: HOUR_CYCLES }),
		/** The day their week starts, 1 for Monday to 7 for Sunday. Null keeps the locale's. */
		weekStart: smallint(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		unique('user_email_key').on(t.email),
		lowercaseEmail('user_email_lowercase', t.email),
		oneOf('user_hour_cycle_check', t.hourCycle, HOUR_CYCLES),
		check('user_week_start_check', sql`${t.weekStart} between 1 and 7`),
		foreignKey({
			name: 'user_role_id_fkey',
			columns: [t.roleId],
			foreignColumns: [role.id]
		}).onDelete('restrict')
	]
);

/**
 * One row per signed-in browser. Deleting it signs that browser out; deleting
 * a user's rows signs them out everywhere.
 */
export const session = pgTable(
	'session',
	{
		id: id(),
		userId: uuid().notNull(),
		token: text().notNull(),
		expiresAt: tstz().notNull(),
		ipAddress: text(),
		userAgent: text(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		unique('session_token_key').on(t.token),
		check('a_session_must_end', sql`${t.expiresAt} > ${t.createdAt}`),
		index('session_by_user').on(t.userId),
		foreignKey({
			name: 'session_user_id_fkey',
			columns: [t.userId],
			foreignColumns: [user.id]
		}).onDelete('cascade')
	]
);

/** How a user signs in. For a password, providerId is "credential". */
export const account = pgTable(
	'account',
	{
		id: id(),
		userId: uuid().notNull(),
		accountId: text().notNull(),
		providerId: text().notNull(),
		accessToken: text(),
		refreshToken: text(),
		idToken: text(),
		accessTokenExpiresAt: tstz(),
		refreshTokenExpiresAt: tstz(),
		scope: text(),
		/** An argon2id hash, carrying its own parameters. Never a password. */
		password: text(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('account_by_user').on(t.userId),
		foreignKey({
			name: 'account_user_id_fkey',
			columns: [t.userId],
			foreignColumns: [user.id]
		}).onDelete('cascade')
	]
);

/** Better Auth's one-time values. Nothing here issues any yet. */
export const verification = pgTable(
	'verification',
	{
		id: id(),
		identifier: text().notNull(),
		value: text().notNull(),
		expiresAt: tstz().notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('verification_by_identifier').on(t.identifier)]
);
