// What reckon tells a person by email, and how it is worded. Plain JavaScript, so
// the server and scripts/user.mjs write the same notice, and a release can run
// user.mjs with it.
//
// A notice says what happened, when, in the person's own zone and words, and
// what to do if it was not them -- NIST SP 800-63B-4 §4.6: "clear
// instructions, including contact information, in case the recipient
// repudiates the event". Plain text, which every mail program shows as sent.

/** What an email is about, as kept on each (email_message.kind). */
export const EMAIL_KINDS = /** @type {const} */ (['password_changed', 'password_reset']);

/** @typedef {(typeof EMAIL_KINDS)[number]} EmailKind */

/** How long a notice is worth sending: a week, for a relay that is down a while. */
export const NOTICE_SENDS_FOR = '7 days';

/**
 * The channel Postgres tells the server on when a message is written, so it is
 * sent at once (#lib/server/email): the table's own name.
 */
export const EMAIL_CHANNEL = 'email_message';

/**
 * Where a password was changed by its owner: on Your profile, on the page they
 * chose it on after signing in with one handed to them, or at the server's
 * command line.
 *
 * @typedef {'profile' | 'chosen' | 'command_line'} ChangedOn
 */

/**
 * @typedef {object} Person
 * @property {string} name
 * @property {string} email
 * @property {string | null} [timezone]
 * @property {string | null} [locale]
 */

/**
 * @typedef {object} Business
 * @property {string | null} [tradingName]
 * @property {string | null} [shortName]
 * @property {string | null} [email]
 * @property {string | null} [phone]
 * @property {string | null} [timezone]
 * @property {string | null} [locale]
 */

/** @typedef {{ kind: EmailKind, to: string, subject: string, body: string }} Notice */

const WHERE = {
	profile: 'on Your profile',
	chosen: 'when you chose it, after signing in with one handed to you',
	command_line: 'at the command line on the server reckon runs on'
};

/** The business's name, or nothing before it has one. */
const named = (/** @type {Business} */ business) => business.tradingName?.trim() || null;

/** What they sign in to: the business's reckon, or reckon alone. */
const theirReckon = (/** @type {Business} */ business) =>
	named(business) ? `${named(business)}'s reckon` : 'reckon';

/** Someone with Full access, at the business where it has a name. */
const someoneWithFull = (/** @type {Business} */ business, other = '') =>
	`someone${other} with Full access${named(business) ? ` at ${named(business)}` : ''}`;

/** A moment as the person reads one: their zone and locale, or the business's. */
function when(
	/** @type {Date} */ at,
	/** @type {Person} */ person,
	/** @type {Business} */ business
) {
	const options = /** @type {const} */ ({
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		timeZoneName: 'short'
	});
	const timeZone = person.timezone ?? business.timezone ?? 'UTC';
	const locale = person.locale ?? business.locale ?? 'en-US';
	try {
		return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(at);
	} catch {
		return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(at);
	}
}

/** However the business can be reached, after the rest of a sentence: "" if it can't. */
function orReach(/** @type {Business} */ business) {
	const reach = [business.email, business.phone].filter(Boolean).join(' or ');
	return reach ? `, or reach the business at ${reach}` : '';
}

const subject = (/** @type {Business} */ business, /** @type {string} */ what) =>
	`${business.shortName?.trim() || named(business) || 'reckon'}: ${what}`;

/**
 * Their password was changed by them.
 *
 * @param {Person} person
 * @param {Business} business
 * @param {{ at: Date, on: ChangedOn }} what
 * @returns {Notice}
 */
export function passwordChanged(person, business, { at, on }) {
	return {
		kind: 'password_changed',
		to: person.email,
		subject: subject(business, 'your password was changed'),
		body: [
			`Hello ${person.name},`,
			`The password you sign in to ${theirReckon(business)} with was changed on ${when(at, person, business)}, ${WHERE[on]}.`,
			'If that was you, there is nothing more to do.',
			`If it wasn't, someone else has your password. Ask ${someoneWithFull(business)} to reset it on Team${orReach(business)}.`
		].join('\n\n')
	};
}

/**
 * Their password was reset on Team, by someone with Full, who has a temporary
 * one to hand them.
 *
 * @param {Person} person
 * @param {Business} business
 * @param {{ at: Date, by: string }} what
 * @returns {Notice}
 */
export function passwordReset(person, business, { at, by }) {
	return {
		kind: 'password_reset',
		to: person.email,
		subject: subject(business, 'your password was reset'),
		body: [
			`Hello ${person.name},`,
			`${by} reset the password you sign in to ${theirReckon(business)} with on ${when(at, person, business)}, and signed you out everywhere. They have a temporary password to hand you, and you choose your own when you sign in with it.`,
			`If you didn't expect this, ask ${by} or ${someoneWithFull(business, ' else')} about it${orReach(business)}.`
		].join('\n\n')
	};
}
