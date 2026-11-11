// People, the capacity they are paid in, what they can reach, and how they
// sign in.
//
// user, session, account and verification are Better Auth's, in the shape its
// Drizzle adapter reads: it finds them by these names and these fields. They
// are kept by hand rather than generated because the conventions here differ
// from its generator's output: ids are uuids the database makes (so Better
// Auth runs with advanced.database.generateId false), timestamps carry their
// zone, and emails are stored lowercased. When its config gains a plugin that
// adds fields, generate into a scratch file and carry them across.
//
// There are no passwords: everyone signs in with a passkey (#lib/server/passkeys).
// account.password is Better Auth's own column, and the database keeps it empty.

import { sql } from 'drizzle-orm';
import {
	bigint,
	boolean,
	check,
	cidr,
	foreignKey,
	index,
	inet,
	integer,
	pgTable,
	smallint,
	text,
	unique,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import {
	bytea,
	createdAt,
	id,
	lowercaseEmail,
	nonNegative,
	oneOf,
	tstz,
	updatedAt
} from './columns.ts';
import { ACCESS } from '../../../access.ts';

/**
 * What a role's pay is, which decides where it is reported: a partner's
 * guaranteed payments, an employee's wages, a contractor's fees. A fixed list,
 * where the role's name is the business's own.
 */
export const PAYS_AS = ['guaranteed_payment', 'wages', 'fee'] as const;

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
		/**
		 * What its pay is (PAYS_AS). Null is not said: a role the business named
		 * before reckon asked, whose work is owed at no figure anyone can pay
		 * until it says.
		 */
		paysAs: text({ enum: PAYS_AS }),
		createdAt: createdAt()
	},
	(t) => [
		unique('role_name_key').on(t.name),
		check('role_name_is_something', sql`btrim(${t.name}) <> ''`),
		oneOf('role_pays_as_check', t.paysAs, PAYS_AS)
	]
);

/**
 * Anyone who can sign in. Signing in is an account row, so a user without one
 * cannot; there is no sign-up. Someone with Full adds people on Team, and the
 * first person is added from the command line (scripts/user.mjs).
 */
export const user = pgTable(
	'user',
	{
		id: id(),
		name: text().notNull(),
		email: text().notNull(),
		/**
		 * Whether that address is proven theirs (Better Auth's name for it): true
		 * once they have used a link reckon emailed there (email_link) -- a
		 * change's link among them, which makes the address it went to theirs --
		 * and false whenever it is changed without one.
		 */
		emailVerified: boolean().default(false).notNull(),
		image: text(),
		/**
		 * The capacity this person is paid in, now. Null means they sign in and
		 * are not paid. It is a current value, not a history: a role change
		 * reprices nothing already worked out.
		 */
		roleId: uuid(),
		/**
		 * Whether they are on the team. Deactivated on Team, they can't sign in,
		 * aren't offered work and aren't ticked on a team; everything they did is
		 * kept.
		 */
		active: boolean().default(true).notNull(),
		/**
		 * What they can reach, apart from what they are paid as (0031): Full or
		 * Field, and which routes each reaches is #lib/access. Someone new starts
		 * with Field, and the database keeps one active person on Full.
		 */
		access: text({ enum: ACCESS }).default('field').notNull(),
		/**
		 * When they last signed in (0032), with a passkey (#lib/server/passkeys).
		 * Null is none recorded: they never have.
		 */
		lastSignedInAt: tstz(),
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
		oneOf('user_access_check', t.access, ACCESS),
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
		/** Better Auth's, for a password: always empty, as there are none. */
		password: text(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		check('account_holds_no_password', sql`${t.password} is null`),
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

/**
 * Better Auth's own count of requests to its routes, kept here rather than in
 * memory so a restart forgives nothing: one row per address and route, how
 * many it has made in the window, and when the last was, in milliseconds
 * (#lib/server/auth).
 */
export const rateLimit = pgTable(
	'rate_limit',
	{
		id: id(),
		key: text().notNull(),
		count: integer().notNull(),
		lastRequest: bigint({ mode: 'number' }).notNull()
	},
	(t) => [unique('rate_limit_key_key').on(t.key)]
);

/**
 * A passkey: a key pair made on someone's phone, computer or security key, of
 * which only the public half is here (#lib/server/auth). The columns are Better
 * Auth's passkey plugin's, as it reads and writes them, but for last_used_at,
 * which is reckon's: when it last signed someone in, for Your profile to show.
 *
 * device_type is WebAuthn's: a key kept on one device (singleDevice) or synced
 * between someone's devices by their passkey manager (multiDevice), and
 * backed_up is whether it is synced now. aaguid names the kind of
 * authenticator that made it, Google Password Manager or iCloud Keychain, where
 * it says (#lib/passkey-names).
 */
export const passkey = pgTable(
	'passkey',
	{
		id: id(),
		name: text(),
		publicKey: text().notNull(),
		userId: uuid().notNull(),
		credentialID: text('credential_id').notNull(),
		counter: integer().notNull(),
		deviceType: text().notNull(),
		backedUp: boolean().notNull(),
		transports: text(),
		createdAt: createdAt(),
		aaguid: text(),
		lastUsedAt: tstz()
	},
	(t) => [
		// One credential is one passkey: the plugin does not ask for this itself.
		unique('passkey_credential_id_key').on(t.credentialID),
		index('passkey_by_user').on(t.userId),
		oneOf('passkey_device_type_check', t.deviceType, ['singleDevice', 'multiDevice']),
		nonNegative('passkey_counter_not_negative', t.counter),
		foreignKey({
			name: 'passkey_user_id_fkey',
			columns: [t.userId],
			foreignColumns: [user.id]
		}).onDelete('cascade')
	]
);

/**
 * What an emailed link is for: to make a first passkey, on being added on Team
 * or at the command line; to make a new one after losing their way in, sent
 * the same way (a "reset", which ends the ones they had when it is used); to
 * confirm the address one signs in with, asked for on Your profile; or to make
 * a new address the one they sign in with, asked for on Team.
 */
export const LINK_PURPOSES = ['invite', 'reset', 'confirm', 'change'] as const;

/**
 * A LINK reckon emailed someone (#lib/server/links), good once, for an hour:
 * NIST SP 800-63A-4 §3.8 allows a code confirming an email address 24 hours,
 * and SP 800-63B-4 §4.2.1.2 a recovery code sent by email the same, and a link
 * to make a passkey is a way in, so it lasts as one handed over does. Using
 * one also proves the person reads mail at the address it went to.
 *
 * The code itself is never kept: code_hash is its SHA-256, and the code is 256
 * random bits, so the hash cannot be worked back to it. It works only while
 * sent_to is still the address its person signs in with, and they are active
 * -- except a change's, which went to the address they are to sign in with
 * instead, and makes it theirs.
 *
 * A new link for a passkey ends any other not yet used, as does a new
 * confirmation or a new change: one of each can be waiting at a time. A link
 * used is kept 90 days, the record of a passkey made or an address confirmed
 * or changed.
 */
export const emailLink = pgTable(
	'email_link',
	{
		id: id(),
		createdAt: createdAt(),
		userId: uuid().notNull(),
		purpose: text({ enum: LINK_PURPOSES }).notNull(),
		/** The SHA-256 of the code. Never the code. */
		codeHash: bytea().notNull(),
		/** The address it went to, which using it proves: for a change, the new one. */
		sentTo: text().notNull(),
		expiresAt: tstz().notNull(),
		/** When it was used. Null is not yet: it cannot be used twice. */
		usedAt: tstz(),
		/** Who had it sent: someone with Full, or the person themselves. */
		sentBy: uuid()
	},
	(t) => [
		unique('email_link_code_hash_key').on(t.codeHash),
		check('email_link_code_hash_is_a_sha256', sql`octet_length(${t.codeHash}) = 32`),
		oneOf('email_link_purpose_check', t.purpose, LINK_PURPOSES),
		lowercaseEmail('email_link_sent_to_lowercase', t.sentTo),
		check(
			'email_link_lasts_an_hour_at_most',
			sql`${t.expiresAt} > ${t.createdAt} and ${t.expiresAt} <= ${t.createdAt} + interval '1 hour'`
		),
		check(
			'email_link_used_while_it_worked',
			sql`${t.usedAt} is null or ${t.usedAt} between ${t.createdAt} and ${t.expiresAt}`
		),
		uniqueIndex('email_link_one_passkey_link_waiting')
			.on(t.userId)
			.where(sql`${t.usedAt} is null and ${t.purpose} in ('invite', 'reset')`),
		uniqueIndex('email_link_one_confirmation_waiting')
			.on(t.userId)
			.where(sql`${t.usedAt} is null and ${t.purpose} = 'confirm'`),
		uniqueIndex('email_link_one_change_waiting')
			.on(t.userId)
			.where(sql`${t.usedAt} is null and ${t.purpose} = 'change'`),
		index('email_link_by_user').on(t.userId, t.createdAt),
		foreignKey({
			name: 'email_link_user_id_fkey',
			columns: [t.userId],
			foreignColumns: [user.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'email_link_sent_by_fkey',
			columns: [t.sentBy],
			foreignColumns: [user.id]
		}).onDelete('set null')
	]
);

/**
 * Every code tried at a link that was not one to use -- unknown, used, lapsed
 * -- by the network it came from (#lib/server/links), so a network that keeps
 * trying is turned away: NIST SP 800-63B-4 §4.2.1.2 holds an emailed code to
 * the throttling of §3.2.2. A code is 256 random bits, which no number of
 * tries finds; the limit is the standard's, and costs a person nothing. Kept a
 * day.
 */
export const linkTry = pgTable(
	'link_try',
	{
		id: id(),
		createdAt: createdAt(),
		address: inet().notNull(),
		network: cidr().notNull()
	},
	(t) => [
		index('link_try_by_network').on(t.network, t.createdAt),
		check('link_try_address_in_network', sql`${t.address} <<= ${t.network}`)
	]
);
