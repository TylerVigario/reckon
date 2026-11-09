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
	anEmail,
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

/**
 * What is said when someone is added on Team: who they are, the role they are
 * paid as, and what they reach. How their figures read is theirs, once they
 * sign in.
 */
export const NEW_PERSON_FIELDS = {
	name: PERSON_FIELDS.name,
	email: PERSON_FIELDS.email,
	role_id: PERSON_FIELDS.role_id,
	access: PERSON_FIELDS.access
};

/**
 * The newest link to choose a password that someone has waiting
 * (#lib/server/links): an invitation, or a reset's. Lapsed once its 24 hours
 * pass, or once the address it went to is no longer theirs.
 */
export type Waiting = {
	purpose: 'invite' | 'reset';
	sent_at: string;
	until: string;
	lapsed: boolean;
};

/**
 * Where someone stands, as Team labels them: Invited while the link to choose
 * their first password works, Invitation expired once it lapses unused, then
 * Active, and Deactivated when they can no longer sign in at all. Someone
 * handed a temporary password, before invitations were emailed, is Invited
 * until they first sign in with it; someone with no password who was never
 * sent one -- made by hand, or brought in -- is Not invited.
 */
export const STANDING = {
	active: { label: 'Active', tone: 'good' },
	invited: { label: 'Invited', tone: 'warn' },
	expired: { label: 'Invitation expired', tone: 'crit' },
	uninvited: { label: 'Not invited', tone: 'warn' },
	deactivated: { label: 'Deactivated', tone: '' }
} as const;

export function standing(p: {
	active: boolean;
	temporary_password: boolean;
	last_signed_in_at: Date | string | null;
	has_password: boolean;
	waiting: Waiting | null;
}): keyof typeof STANDING {
	if (!p.active) return 'deactivated';
	if (p.last_signed_in_at !== null) return 'active';
	if (p.temporary_password) return 'invited';
	if (p.has_password) return 'active';
	if (!p.waiting) return 'uninvited';
	return p.waiting.purpose === 'invite' && !p.waiting.lapsed ? 'invited' : 'expired';
}

/** What only the person themselves may change: their own clock and how their figures read. */
export const OWN_FIELDS = ['timezone', 'locale', 'hour_cycle', 'week_start'] as const;

export function parsePersonField(field: string, raw: string): Parsed {
	return parseIn(PERSON_FIELDS, field, raw);
}
