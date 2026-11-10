// What reckon tells a person by email, and how it is worded. Plain JavaScript, so
// the server and scripts/user.mjs write the same notice, and a release can run
// user.mjs with it.
//
// A notice says what happened, when, in the person's own zone and words, and
// what to do if it was not them -- NIST SP 800-63B-4 §4.6: "clear
// instructions, including contact information, in case the recipient
// repudiates the event". Each is laid out as HTML and as plain text from the
// same words (#lib/server/email-layout), the text sent first, for the programs
// and the readers that prefer it.

import { contactFor, reachOf } from './contact.js';
import { laidOut } from './email-layout.js';

/**
 * What an email is about, as kept on each (email_message.kind). password_reset
 * is a reset that handed over a temporary password, before reset sent a link
 * (password_reset_link); it is kept for the rows that say so.
 */
export const EMAIL_KINDS = /** @type {const} */ ([
	'password_changed',
	'password_reset',
	'invitation',
	'password_reset_link',
	'email_confirmation',
	'email_change',
	'email_changing',
	'password_recovery',
	'password_recovery_unconfirmed'
]);

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
 * chose it on after signing in with one handed to them, with a link reckon
 * emailed them, or at the server's command line.
 *
 * @typedef {'profile' | 'chosen' | 'link' | 'command_line'} ChangedOn
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
 * @property {string | null} [accentColour] #rrggbb
 * @property {{ width: number, height: number } | null} [logo] its size, where it is a PNG or JPEG
 */

/**
 * An email, ready to keep and send: its plain text, and the same as HTML
 * (#lib/server/email-layout).
 *
 * @typedef {{ kind: EmailKind, to: string, subject: string, body: string, html: string }} Notice
 */

const WHERE = {
	profile: 'on Your profile',
	chosen: 'when you chose it, after signing in with one handed to you',
	link: 'with a link reckon emailed you',
	command_line: 'at the command line on the server reckon runs on'
};

/** The business's name, or nothing before it has one. */
const named = (/** @type {Business} */ business) => business.tradingName?.trim() || null;

/** What they sign in to: the business's reckon, or reckon alone. */
const theirReckon = (/** @type {Business} */ business) =>
	named(business) ? `${named(business)}'s reckon` : 'reckon';

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

/**
 * Whom to contact as well as a person named, after the rest of a sentence:
 * the business, where it gives a way to reach it (#lib/server/contact); "" if
 * it gives none, the person named being whom to ask.
 */
const orContact = (/** @type {Business} */ business) =>
	reachOf(business) ? `, or contact ${contactFor(business)}` : '';

/**
 * A notice laid out (#lib/server/email-layout): its text and its HTML from the
 * same blocks -- a string is a paragraph, { link, label } a link.
 *
 * @param {Person} person
 * @param {Business} business
 * @param {{ kind: EmailKind, to: string, subject: string, heading: string, blocks: (string | { link: string, label: string })[] }} notice
 * @returns {Notice}
 */
function laid(person, business, { kind, to, subject, heading, blocks }) {
	const { text, html } = laidOut({
		subject,
		heading,
		blocks: blocks.map((b) => (typeof b === 'string' ? { text: b } : b)),
		look: lookOf(business)
	});
	return { kind, to, subject, body: text, html };
}

/** The business as an email shows it (#lib/server/email-layout Look). */
export const lookOf = (/** @type {Business} */ business) => ({
	name: named(business) ?? 'reckon',
	email: business.email ?? null,
	phone: business.phone ?? null,
	accent: business.accentColour ?? null,
	logo: business.logo ?? null
});

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
	return laid(person, business, {
		kind: 'password_changed',
		to: person.email,
		subject: subject(business, 'your password was changed'),
		heading: 'Your password was changed',
		blocks: [
			`Hello ${person.name},`,
			`The password you sign in to ${theirReckon(business)} with was changed on ${when(at, person, business)}, ${WHERE[on]}.`,
			'If that was you, there is nothing more to do.',
			`If it wasn't, someone else has your password. Contact ${contactFor(business)} to have it reset.`
		]
	});
}

/**
 * The link an email carries, and until when it works (#lib/server/links). It
 * opens a page that does nothing until it is used, and is good once.
 *
 * @typedef {{ link: string, until: Date }} Link
 */

/** When a link stops working, and what to do then. */
const lapses = (
	/** @type {Person} */ person,
	/** @type {Business} */ business,
	/** @type {Date} */ until,
	/** @type {string} */ then
) => `It works once, until ${when(until, person, business)}. ${then}`;

/**
 * They were added on Team, by someone with Full, and choose their password
 * with the link. Using it confirms the address is theirs.
 *
 * @param {Person} person
 * @param {Business} business
 * @param {Link & { by: string }} what
 * @returns {Notice}
 */
export function invitation(person, business, { by, link, until }) {
	return laid(person, business, {
		kind: 'invitation',
		to: person.email,
		subject: subject(business, 'choose your password'),
		heading: `Welcome to ${named(business) ?? 'reckon'}`,
		blocks: [
			`Hello ${person.name},`,
			`${by} added you to ${theirReckon(business)}. Choose the password you'll sign in with, at this link:`,
			{ link, label: 'Choose your password' },
			lapses(person, business, until, `If it lapses, ask ${by} to send another.`),
			`You sign in with this address, ${person.email}.`,
			`If you weren't expecting this, nothing happens unless the link is used. Ask ${by} about it${orContact(business)}.`
		]
	});
}

/**
 * Their password was reset on Team, by someone with Full: it no longer works,
 * they were signed out everywhere, and they choose a new one with the link.
 *
 * @param {Person} person
 * @param {Business} business
 * @param {Link & { at: Date, by: string }} what
 * @returns {Notice}
 */
export function passwordResetLink(person, business, { at, by, link, until }) {
	return laid(person, business, {
		kind: 'password_reset_link',
		to: person.email,
		subject: subject(business, 'your password was reset'),
		heading: 'Your password was reset',
		blocks: [
			`Hello ${person.name},`,
			`${by} reset the password you sign in to ${theirReckon(business)} with on ${when(at, person, business)}, and signed you out everywhere. Your old password no longer works. Choose a new one at this link:`,
			{ link, label: 'Choose a new password' },
			lapses(person, business, until, `If it lapses, ask ${by} to reset it again.`),
			`If you didn't expect this, ask ${by} about it${orContact(business)}.`
		]
	});
}

/**
 * They asked, on Your profile, to confirm that the address they sign in with
 * is theirs: using the link does.
 *
 * @param {Person} person
 * @param {Business} business
 * @param {Link} what
 * @returns {Notice}
 */
export function emailConfirmation(person, business, { link, until }) {
	return laid(person, business, {
		kind: 'email_confirmation',
		to: person.email,
		subject: subject(business, 'confirm your email'),
		heading: 'Confirm your email',
		blocks: [
			`Hello ${person.name},`,
			`You asked ${theirReckon(business)} to confirm that ${person.email} is yours. Confirm it at this link:`,
			{ link, label: 'Confirm your email' },
			lapses(person, business, until, 'If it lapses, ask for another on Your profile.'),
			`If you didn't ask, someone else is signed in as you. Change your password on Your profile, or contact ${contactFor(business)} to have it reset.`
		]
	});
}

/**
 * Someone with Full asked, on Team, for the address they sign in with to be
 * this one: using the link makes it theirs, and confirms it. Sent to the new
 * address, which may be a stranger's if it was mistyped, so it does not say
 * the old one. `by` is null where they asked for it themselves.
 *
 * @param {Person} person
 * @param {Business} business
 * @param {Link & { by: string | null, to: string }} what
 * @returns {Notice}
 */
export function emailChange(person, business, { by, link, until, to }) {
	return laid(person, business, {
		kind: 'email_change',
		to,
		subject: subject(business, 'confirm your new email'),
		heading: 'Confirm your new email',
		blocks: [
			`Hello ${person.name},`,
			`${by ? `${by} is changing` : 'You are changing'} the email you sign in to ${theirReckon(business)} with to this one, ${to}. Confirm it's yours at this link:`,
			{ link, label: 'Confirm your new email' },
			lapses(
				person,
				business,
				until,
				by ? `If it lapses, ask ${by} to send another.` : 'If it lapses, send another from Team.'
			),
			"Until it's used, you keep signing in with your old address.",
			`If you aren't ${person.name}, this address was given by mistake, and nothing changes unless the link is used.${reachOf(business) ? ` Tell ${contactFor(business)}.` : ''}`
		]
	});
}

/**
 * The address they sign in with is to change to `to`, asked for on Team: told
 * to the address they have now, when it is asked for, so a change they did
 * not expect can be stopped before it is made. `by` is null where they asked
 * for it themselves.
 *
 * @param {Person} person
 * @param {Business} business
 * @param {{ at: Date, by: string | null, to: string }} what
 * @returns {Notice}
 */
export function emailChanging(person, business, { at, by, to }) {
	return laid(person, business, {
		kind: 'email_changing',
		to: person.email,
		subject: subject(business, 'your sign-in email is changing'),
		heading: 'Your sign-in email is changing',
		blocks: [
			`Hello ${person.name},`,
			`On ${when(at, person, business)}, ${by ?? 'you'} asked for the email you sign in to ${theirReckon(business)} with to change from this one to ${to}. A link went there to confirm it, and until it's used you keep signing in with this one.`,
			'If you expected this, there is nothing more to do.',
			by
				? `If you didn't, ask ${by} to cancel it${orContact(business)}.`
				: `If you didn't, someone else is signed in as you. Cancel it on Team and change your password on Your profile, or contact ${contactFor(business)} to have it reset.`
		]
	});
}

/**
 * Someone asked, on the sign-in page, to choose a new password for this
 * address, which is confirmed theirs: the link lets them, and their password
 * stays as it is until it is used (OWASP's Forgot Password Cheat Sheet: "Do not
 * make a change to the account until a valid token is presented"). Whoever
 * asked may not be them, so it says what to do if they did not.
 *
 * @param {Person} person
 * @param {Business} business
 * @param {Link & { at: Date }} what
 * @returns {Notice}
 */
export function passwordRecovery(person, business, { at, link, until }) {
	return laid(person, business, {
		kind: 'password_recovery',
		to: person.email,
		subject: subject(business, 'choose a new password'),
		heading: 'Choose a new password',
		blocks: [
			`Hello ${person.name},`,
			`On ${when(at, person, business)}, someone asked to choose a new password for the email you sign in to ${theirReckon(business)} with. Choose one at this link:`,
			{ link, label: 'Choose a new password' },
			lapses(person, business, until, "Until it's used, your password stays as it is."),
			`If you didn't ask, you can ignore this email: nothing changes unless the link is used. If more keep coming, contact ${contactFor(business)}.`
		]
	});
}

/**
 * Someone asked to choose a new password for this address, which is not yet
 * confirmed theirs: reckon recovers an account only to an address proven its
 * holder's (NIST SP 800-63B-4 §4.2.1.2), so this carries no link, and says whom
 * to contact for one (#lib/server/contact): a link sent from Team confirms the
 * address as it is used.
 *
 * @param {Person} person
 * @param {Business} business
 * @param {{ at: Date }} what
 * @returns {Notice}
 */
export function passwordRecoveryUnconfirmed(person, business, { at }) {
	return laid(person, business, {
		kind: 'password_recovery_unconfirmed',
		to: person.email,
		subject: subject(business, 'choosing a new password'),
		heading: 'Choosing a new password',
		blocks: [
			`Hello ${person.name},`,
			`On ${when(at, person, business)}, someone asked to choose a new password for the email you sign in to ${theirReckon(business)} with.`,
			`This address hasn't been confirmed as yours, so reckon can't send a link to choose one here. Contact ${contactFor(business)} to have one sent: using it confirms the address too.`,
			"If you didn't ask, there is nothing to do: your password hasn't changed."
		]
	});
}
