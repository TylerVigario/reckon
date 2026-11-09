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
// A password is never a column of user. It is account.password, an argon2id
// hash carrying its own parameters, set by Better Auth through the hash
// function in #lib/server/auth.

import { sql } from 'drizzle-orm';
import {
	boolean,
	check,
	cidr,
	foreignKey,
	index,
	inet,
	pgTable,
	smallint,
	text,
	unique,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { bytea, createdAt, id, lowercaseEmail, oneOf, tstz, updatedAt } from './columns.ts';
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
		 * once they have used a link reckon emailed there (email_link), and false
		 * again whenever it changes.
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
		 * When they last signed in (0032), set by the sign-in form. Null is none
		 * recorded: they never have, or not since reckon began keeping it.
		 */
		lastSignedInAt: tstz(),
		/**
		 * Whether the password they sign in with was handed to them (0033): made
		 * when someone with Full added them or reset it, and shown once, to give
		 * them. Until they choose their own, signing in reaches nothing but the
		 * page where they do (/new-password).
		 */
		temporaryPassword: boolean().default(false).notNull(),
		/**
		 * When their password was last set (0034): chosen with an emailed link,
		 * changed, handed over before invitations, or set at the command line.
		 * Tries before it count against none of theirs (#lib/server/sign-in-limit).
		 * Null is before reckon kept it.
		 */
		passwordSetAt: tstz(),
		/**
		 * When their password stopped working, after a hundred wrong tries in a
		 * row (0034), until a new one is set. Null is working.
		 */
		passwordStoppedAt: tstz(),
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

/**
 * What an emailed link is for: to choose a first password, on being added on
 * Team; to choose a new one, after a reset there; or to confirm the address
 * one signs in with, asked for on Your profile.
 */
export const LINK_PURPOSES = ['invite', 'reset', 'confirm'] as const;

/**
 * A LINK reckon emailed someone (#lib/server/links), good once, for 24 hours
 * at most: NIST SP 800-63A-4 §3.8 allows a code confirming an email address no
 * longer, and SP 800-63B-4 §4.2.1.2 a recovery code sent by email none. Using
 * one also proves the person reads mail at the address it went to.
 *
 * The code itself is never kept: code_hash is its SHA-256, and the code is 256
 * random bits, so the hash cannot be worked back to it. It works only while
 * sent_to is still the address its person signs in with, and they are active.
 *
 * A new link for a password ends any other not yet used, as does a new
 * confirmation: one of each can be waiting at a time. A link used is kept 90
 * days, the record of a password chosen or an address confirmed.
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
		/** The address it went to, which using it proves. */
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
			'email_link_lasts_a_day_at_most',
			sql`${t.expiresAt} > ${t.createdAt} and ${t.expiresAt} <= ${t.createdAt} + interval '24 hours'`
		),
		check(
			'email_link_used_while_it_worked',
			sql`${t.usedAt} is null or ${t.usedAt} between ${t.createdAt} and ${t.expiresAt}`
		),
		uniqueIndex('email_link_one_password_link_waiting')
			.on(t.userId)
			.where(sql`${t.usedAt} is null and ${t.purpose} in ('invite', 'reset')`),
		uniqueIndex('email_link_one_confirmation_waiting')
			.on(t.userId)
			.where(sql`${t.usedAt} is null and ${t.purpose} = 'confirm'`),
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

/** The page a password was tried at: signing in, or changing one's own. */
export const TRY_PAGES = ['sign_in', 'password_change'] as const;
/**
 * How a try came out. Inactive is a right password for someone made inactive,
 * answered and counted as a wrong one; stopped, one not checked, the password
 * having stopped. A try still being checked, or never finished, has none.
 */
export const TRY_OUTCOMES = ['right', 'wrong', 'inactive', 'stopped'] as const;

/**
 * Every try at a password (0034), and what the limits on them are worked out
 * from (#lib/server/sign-in-limit): per address, per email, and a hundred wrong
 * in a row. A row is written for every email tried, whether or not anyone signs
 * in with it, and kept 90 days.
 *
 * The email as typed is never kept, since a password is sometimes typed in its
 * place: email_key is an HMAC of it, which counts the same, and user_id is whose
 * it was, if anyone's.
 */
export const signInTry = pgTable(
	'sign_in_try',
	{
		id: id(),
		createdAt: createdAt(),
		page: text({ enum: TRY_PAGES }).notNull(),
		/** The client's address, as adapter-node resolved it. */
		address: inet().notNull(),
		/** The network the per-address limit counts it in: an IPv4 address, or an IPv6 /64. */
		network: cidr().notNull(),
		/** An HMAC of the email as typed, under a key drawn from the session secret. */
		emailKey: text().notNull(),
		userId: uuid(),
		/**
		 * The browser, when it has signed in as them: its entry in their
		 * signed-in-here cookie at the sign-in page, its session when changing a
		 * password. Its tries are a count of its own. Null is a stranger.
		 */
		browser: text(),
		outcome: text({ enum: TRY_OUTCOMES })
	},
	(t) => [
		index('sign_in_try_by_network').on(t.network, t.createdAt),
		index('sign_in_try_by_email').on(t.emailKey, t.createdAt),
		index('sign_in_try_by_user').on(t.userId, t.createdAt),
		index('sign_in_try_by_time').on(t.createdAt),
		oneOf('sign_in_try_page_check', t.page, TRY_PAGES),
		oneOf('sign_in_try_outcome_check', t.outcome, TRY_OUTCOMES),
		check('sign_in_try_address_in_network', sql`${t.address} <<= ${t.network}`),
		// The record outlives a person taken away, as a log does, until it ages out.
		foreignKey({
			name: 'sign_in_try_user_id_fkey',
			columns: [t.userId],
			foreignColumns: [user.id]
		}).onDelete('set null')
	]
);
