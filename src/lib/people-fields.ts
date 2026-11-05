/**
 * What may be said about a role, and about the role a person holds.
 *
 * A role is the operator's own word for a capacity people are paid in --
 * Partner, Employee, Contractor, or whatever a business calls them. Pay rules
 * are written against roles, so a person's role is which rules reach them.
 * What its pay is comes from a fixed list (0027), since that, not the name,
 * decides where the pay is reported. No role at all means they sign in and are
 * not paid for work.
 *
 * And what a person can reach, apart from what they are paid as: Full or Field
 * (#lib/access). And who they are -- a name, and the email they sign in with --
 * and whether they can sign in at all.
 */
import {
	anId,
	cap,
	flag,
	no,
	ok,
	oneOf,
	optional,
	parseIn,
	required,
	whole,
	type Parsed
} from './field-rules.ts';
import { pickLocale } from './locales.ts';
import { ACCESS } from './access.ts';

/** As the schema has them (#lib/server/db/schema/people), and PAID_AS_WORDS says them. */
export const PAYS_AS = ['guaranteed_payment', 'wages', 'fee'] as const;

export const ROLE_FIELDS = {
	name: required('A role needs a name.', cap(40)),
	// Once said, always said: there is no going back to not knowing.
	pays_as: required('Say what the role is paid as.', oneOf(PAYS_AS))
};

export function parseRoleField(field: string, raw: string): Parsed {
	return parseIn(ROLE_FIELDS, field, raw);
}

/** A zone this browser's Intl knows; the server checks it against Postgres too. */
const aZone = (v: string): Parsed => {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: v });
		return ok(v);
	} catch {
		return no('Not a time zone. Try America/Los_Angeles.');
	}
};

/** An email as signing in reads it: one @, a dot after it, lowercased. */
const anEmail = (v: string): Parsed =>
	/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
		? ok(v.toLowerCase())
		: no('Enter an email address in the correct format, like name@example.com.');

/** A locale Intl can write in, as Intl spells it: "en-gb" is saved as en-GB. */
const aLocale = (v: string): Parsed => {
	const tag = pickLocale(v);
	return tag ? ok(tag) : no('Not a locale. Try en-US or en-GB.');
};

export const PERSON_FIELDS = {
	name: required('Enter their name.', cap(120)),
	// What they sign in with: changing it changes how they sign in.
	email: required('Enter their email address.', cap(254, anEmail)),
	// False is deactivated: they can't sign in, and aren't offered work.
	active: flag,
	// Empty is no role: signs in, is not paid.
	role_id: optional(anId),
	access: required('Full or Field.', oneOf(ACCESS)),
	// The rest are the person's own, set in their profile. Empty follows the
	// business's zone and locale, and the locale's clock and first day of the week.
	timezone: optional(cap(64, aZone)),
	locale: optional(aLocale),
	hour_cycle: optional(oneOf(['h12', 'h23'])),
	week_start: optional(whole(1, 7))
};

/** What only the person themselves may change: their own clock and how their figures read. */
export const OWN_FIELDS = ['timezone', 'locale', 'hour_cycle', 'week_start'] as const;

export function parsePersonField(field: string, raw: string): Parsed {
	return parseIn(PERSON_FIELDS, field, raw);
}
