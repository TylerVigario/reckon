// What a password must be: NIST SP 800-63B-4 §3.1.1.2, and OWASP ASVS 5.0 6.2.
// Plain JavaScript, so the server and scripts/user.mjs share one answer, and a
// release can run user.mjs with it and the list it reads (scripts/release-files.mjs).
//
// Every rule is held to when a password is chosen: with a link reckon emailed,
// under Password on Your profile, on /new-password, and by scripts/user.mjs.
// One thing can change after: Pwned Passwords comes to hold it, from a breach
// somewhere else. reckon keeps only a hash, so the one other moment a password
// is in hand is a sign-in, and each asks Pwned Passwords again
// (#lib/server/breach): one it has seen by then stops, NIST's "verifiers SHALL
// force a change if there is evidence that the authenticator has been
// compromised".

import { createHash } from 'node:crypto';
import { COMMON_PASSWORDS } from './common-passwords.js';

/** Fifteen at least: NIST's floor for a password used alone, as every one here is. */
export const MIN_PASSWORD_LENGTH = 15;
/**
 * The most a password may be. Better Auth counts in UTF-16 units, of which a
 * character is one or two, so it is given twice this (#lib/server/auth).
 */
export const MAX_PASSWORD_LENGTH = 128;

/** A password's length as NIST counts it: each Unicode code point is one character. */
export const lengthOf = (/** @type {string} */ password) => [...password].length;

/**
 * What can be wrong with a password being chosen, worst first.
 *
 * @typedef {'too_long' | 'common' | 'breached' | 'about_them' | 'too_short'} Weakness
 */

/**
 * Why a password being chosen is refused, said to whoever chose it: NIST asks
 * for the reason.
 *
 * @type {Record<Weakness, string>}
 */
export const REFUSED = {
	too_long: `Enter a password of at most ${MAX_PASSWORD_LENGTH} characters.`,
	common: 'That’s one of the most common passwords, which are the first anyone would try.',
	breached:
		'That password has appeared in a data breach, so it may already be on the lists attackers try.',
	about_them:
		'That password is made of your name, your email or the business’s, which are the first things anyone would try.',
	too_short: `Enter a password of at least ${MIN_PASSWORD_LENGTH} characters.`
};

/** What NIST asks to be offered with every refusal: how to choose one that is not. */
export const GUIDANCE = 'Four or more random words make one that’s long and hard to guess.';

/** Have I Been Pwned's Pwned Passwords, unless PWNED_PASSWORDS_URL names another. */
export const PWNED_PASSWORDS = 'https://api.pwnedpasswords.com/range/';

/** How long Pwned Passwords is waited for before the list of common ones decides alone. */
const PATIENCE_MS = 3000;

/**
 * The words a password must not be made of (ASVS 6.1.2): reckon, the
 * business's names and email, and the person's own name and email, each split
 * at whatever is not a letter.
 *
 * @param {{ name: string, email: string }} person
 * @param {{ tradingName?: string | null, shortName?: string | null, email?: string | null }} [business]
 * @returns {Set<string>}
 */
export function wordsAbout(person, business) {
	const words = new Set(['reckon']);
	for (const text of [
		person.name,
		person.email,
		business?.tradingName,
		business?.shortName,
		business?.email
	])
		for (const word of (text ?? '').toLowerCase().split(/[^\p{L}\p{M}]+/u))
			if (lengthOf(word) >= 2) words.add(word);
	return words;
}

/**
 * Whether a password is those words and nothing else, whatever digits, spaces
 * and symbols are around or between them: "Reckon2026!" or
 * "avery.quinn.1990". The whole password is what is compared, as NIST asks,
 * never a word found inside a longer one.
 *
 * @param {string} password
 * @param {Set<string>} words
 */
function madeOf(password, words) {
	const letters = password.toLowerCase().replace(/[^\p{L}\p{M}]+/gu, '');
	if (!letters) return false;
	// Where the letters so far end on a word's end; the last one must.
	const ends = Array.from({ length: letters.length + 1 }, (_, i) => i === 0);
	for (let i = 0; i < letters.length; i++)
		if (ends[i])
			for (const word of words) if (letters.startsWith(word, i)) ends[i + word.length] = true;
	return ends[letters.length];
}

/**
 * Whether Pwned Passwords has seen this password in a breach, or null where it
 * could not say. Only the first five characters of the password's SHA-1 leave
 * the server: the answer is every hash it holds that begins with them, about
 * two thousand, padded with made-up ones so that even its size says nothing,
 * and the match is made here.
 *
 * @param {string} password
 * @param {string} [from] where it is asked, as …/range/
 * @returns {Promise<boolean | null>}
 */
export async function breached(password, from = PWNED_PASSWORDS) {
	const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
	try {
		const answer = await fetch(from + sha1.slice(0, 5), {
			headers: { 'Add-Padding': 'true', 'User-Agent': 'reckon' },
			signal: AbortSignal.timeout(PATIENCE_MS)
		});
		if (!answer.ok) throw new Error(`it answered ${answer.status}`);
		const lines = (await answer.text())
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);
		// Anything but its own lines -- a captive portal's page, say -- is no
		// answer, not a clean one.
		if (!lines.length || !lines.every((line) => /^[0-9A-F]{35}:\d+$/.test(line)))
			throw new Error('its answer was not a list of hashes');
		// A padded line counts 0, and is none.
		return lines.some((line) => line.startsWith(`${sha1.slice(5)}:`) && Number(line.slice(36)) > 0);
	} catch (e) {
		console.warn(
			`Pwned Passwords could not be asked about a password (${e instanceof Error ? e.message : String(e)}), so only the list of common ones was.`
		);
		return null;
	}
}

/**
 * What is wrong with a password, worst first, or null if nothing is.
 *
 * @param {string} password
 * @param {{ about: Set<string>, pwned?: string }} against the words it must not
 *   be made of (wordsAbout), and where Pwned Passwords is asked
 * @returns {Promise<Weakness | null>}
 */
export async function weakness(password, { about, pwned }) {
	const length = lengthOf(password);
	if (length > MAX_PASSWORD_LENGTH) return 'too_long';
	if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'common';
	if (await breached(password, pwned)) return 'breached';
	if (madeOf(password, about)) return 'about_them';
	if (length < MIN_PASSWORD_LENGTH) return 'too_short';
	return null;
}
