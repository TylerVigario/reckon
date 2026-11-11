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

/** What an email is about, as kept on each (email_message.kind). */
export const EMAIL_KINDS = /** @type {const} */ ([
	'invitation',
	'passkey_link',
	'email_confirmation',
	'email_change',
	'email_changing',
	'passkey_added',
	'passkey_removed',
	'passkeys_ended'
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
 * They were added on Team, by someone with Full, and make their passkey with
 * the link. Using it confirms the address is theirs.
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
		subject: subject(business, 'make your passkey'),
		heading: `Welcome to ${named(business) ?? 'reckon'}`,
		blocks: [
			`Hello ${person.name},`,
			`${by} added you to ${theirReckon(business)}. You sign in with a passkey: your phone or computer keeps it, and your fingerprint, face or screen lock unlocks it, so there is no password to choose or remember. Make yours at this link, on the phone or computer you'll use reckon on:`,
			{ link, label: 'Make your passkey' },
			lapses(person, business, until, `If it lapses, ask ${by} to send another.`),
			`You sign in with this address, ${person.email}.`,
			`If you weren't expecting this, nothing happens unless the link is used. Ask ${by} about it${orContact(business)}.`
		]
	});
}

/**
 * They were sent a new link on Team, by someone with Full, to make a passkey
 * with. A person who can't sign in gets back in so (NIST SP 800-63B-4 §4.2.1,
 * recovery through someone who knows them). The passkeys they had still work,
 * unless whoever sent it said one was lost or stolen, and `ended` them as it
 * went (#lib/server/passkeys endPasskeys).
 *
 * @param {Person} person
 * @param {Business} business
 * @param {Link & { at: Date, by: string, ended: boolean }} what
 * @returns {Notice}
 */
export function newPasskeyLink(person, business, { at, by, ended, link, until }) {
	return laid(person, business, {
		kind: 'passkey_link',
		to: person.email,
		subject: subject(business, 'a link to make a new passkey'),
		heading: 'Make a new passkey',
		blocks: [
			`Hello ${person.name},`,
			`${by} sent you this link on ${when(at, person, business)}, to make a new passkey to sign in to ${theirReckon(business)} with. ${ended ? "The passkeys you had were ended as it was sent, and you were signed out everywhere, so a lost or stolen phone or computer can't sign in as you." : 'The passkeys you have still work.'} Make it on the phone or computer you'll use reckon on:`,
			{ link, label: 'Make a new passkey' },
			lapses(person, business, until, `If it lapses, ask ${by} to send another.`),
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
			`If you didn't ask, someone else is signed in as you. Contact ${contactFor(business)}: they can sign you out everywhere and send you a new link to make a passkey with.`
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
				: `If you didn't, someone else is signed in as you. Cancel it on Team, or contact ${contactFor(business)}: they can sign you out everywhere and send you a new link to make a passkey with.`
		]
	});
}

/** "A passkey, iCloud Keychain," where it is named, and "A passkey" where not. */
const aPasskey = (/** @type {string | null} */ name) =>
	name ? `A passkey, ${name},` : 'A passkey';

/**
 * Where a passkey is kept and when, for a notice to name it: what its passkey
 * manager calls itself, where it says, and the browser it was used from.
 *
 * @typedef {{ name: string | null, at: Date, from: string | null }} PasskeyEvent
 */

/**
 * A passkey was added to their account: by them on Your profile, or with a
 * link. NIST SP 800-63B-4 §4.1.2.1: "When an authenticator is added, the CSP
 * SHALL notify the subscriber via a mechanism independent of the transaction".
 *
 * @param {Person} person
 * @param {Business} business
 * @param {PasskeyEvent} what
 * @returns {Notice}
 */
export function passkeyAdded(person, business, { name, at, from }) {
	return laid(person, business, {
		kind: 'passkey_added',
		to: person.email,
		subject: subject(business, 'a passkey was added'),
		heading: 'A passkey was added',
		blocks: [
			`Hello ${person.name},`,
			`${aPasskey(name)} was added to the account you sign in to ${theirReckon(business)} with, on ${when(at, person, business)}${from ? `, from ${from}` : ''}. It can sign you in from now on.`,
			'If that was you, there is nothing more to do.',
			`If it wasn't, someone else can sign in as you. Contact ${contactFor(business)} to have it ended.`
		]
	});
}

/**
 * A passkey was removed from their account, by them on Your profile. NIST SP
 * 800-63B-4 §4.5: notification of an invalidation SHOULD follow.
 *
 * @param {Person} person
 * @param {Business} business
 * @param {PasskeyEvent} what
 * @returns {Notice}
 */
export function passkeyRemoved(person, business, { name, at, from }) {
	return laid(person, business, {
		kind: 'passkey_removed',
		to: person.email,
		subject: subject(business, 'a passkey was removed'),
		heading: 'A passkey was removed',
		blocks: [
			`Hello ${person.name},`,
			`${aPasskey(name)} was removed from the account you sign in to ${theirReckon(business)} with, on ${when(at, person, business)}${from ? `, from ${from}` : ''}. It no longer signs you in.`,
			'If that was you, there is nothing more to do.',
			`If it wasn't, someone else has been signed in as you. Contact ${contactFor(business)}.`
		]
	});
}

/**
 * Every passkey they had was ended, and they were signed out everywhere, for
 * a phone or computer lost or stolen: on Team, by someone with Full, or from
 * the command line where `by` is null (#lib/server/passkeys endPasskeys). NIST
 * SP 800-63B-4 §4.5: notification of an invalidation SHOULD follow. A new link
 * sent as they were ended says so itself (newPasskeyLink).
 *
 * @param {Person} person
 * @param {Business} business
 * @param {{ at: Date, by: string | null }} what
 * @returns {Notice}
 */
export function passkeysEnded(person, business, { at, by }) {
	return laid(person, business, {
		kind: 'passkeys_ended',
		to: person.email,
		subject: subject(business, 'your passkeys were ended'),
		heading: 'Your passkeys were ended',
		blocks: [
			`Hello ${person.name},`,
			`${by ? `${by} ended the passkeys you sign in to ${theirReckon(business)} with` : `The passkeys you sign in to ${theirReckon(business)} with were ended`} on ${when(at, person, business)}, and you were signed out everywhere, so a lost or stolen phone or computer can't sign in as you.`,
			...(by
				? [
						`To sign in again, ask ${by} to send you a new link to make a passkey with.`,
						`If you didn't expect this, ask ${by} about it${orContact(business)}.`
					]
				: [
						`To sign in again, you need a new link to make a passkey with. Contact ${contactFor(business)} for one, or about this if you didn't expect it.`
					])
		]
	});
}

/**
 * One of their passkeys was ended on Team, by someone with Full, for the phone
 * or computer holding it being lost or stolen, and they were signed out
 * everywhere (#lib/server/passkeys endPasskey). NIST SP 800-63B-4 §4.5:
 * notification of an invalidation SHOULD follow. With others `left`, they sign
 * in with one of those; with none, they need a new link.
 *
 * @param {Person} person
 * @param {Business} business
 * @param {{ name: string | null, at: Date, by: string, left: number }} what
 * @returns {Notice}
 */
export function passkeyEnded(person, business, { name, at, by, left }) {
	return laid(person, business, {
		kind: 'passkey_removed',
		to: person.email,
		subject: subject(business, 'a passkey was ended'),
		heading: 'A passkey was ended',
		blocks: [
			`Hello ${person.name},`,
			`${by} ended a passkey${name ? `, ${name},` : ''} on the account you sign in to ${theirReckon(business)} with, on ${when(at, person, business)}, and you were signed out everywhere, so a lost or stolen phone or computer can't sign in as you.`,
			left
				? `Your other ${left === 1 ? 'passkey still works: sign in with it' : 'passkeys still work: sign in with one of them'}.`
				: `It was your last. To sign in again, ask ${by} to send you a new link to make a passkey with.`,
			`If you didn't expect this, ask ${by} about it${orContact(business)}.`
		]
	});
}
