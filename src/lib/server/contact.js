// Whom someone is told to contact for help, wherever reckon sends them to a
// person: the emails it sends (#lib/server/notices) and the pages that turn
// someone away. It is the business, by the email and phone it gives under
// Settings → Business, the way it chooses to be reached; or, where it gives
// neither, their administrator, as Microsoft's and Okta's sign-in pages say.
// Never a level of access: nobody locked out knows who has one. NIST SP
// 800-63B-4 §4.6 asks a notification to carry contact information. Plain
// JavaScript, so scripts/user.mjs tells a person the same.

/**
 * @typedef {object} Reachable
 * @property {string | null} [tradingName]
 * @property {string | null} [email]
 * @property {string | null} [phone]
 */

/** However the business can be reached, "office@kestrel.example or (555) 010-0142": "" if it can't. */
export const reachOf = (/** @type {Reachable} */ business) =>
	[business.email, business.phone]
		.map((v) => v?.trim())
		.filter(Boolean)
		.join(' or ');

/**
 * Whom to contact, after "contact": "Kestrel Field Services at
 * office@kestrel.example or (555) 010-0142", or "your administrator".
 */
export function contactFor(/** @type {Reachable} */ business) {
	const reach = reachOf(business);
	return reach
		? `${business.tradingName?.trim() || 'the business'} at ${reach}`
		: 'your administrator';
}
