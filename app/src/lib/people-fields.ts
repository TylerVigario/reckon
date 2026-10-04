/**
 * What may be said about a role, and about the role a person holds.
 *
 * A role is the operator's own word for a capacity people are paid in --
 * Partner, Employee, Contractor, or whatever a business calls them. Pay rules
 * are written against roles, so a person's role is which rules reach them.
 * No role at all means they sign in and are not paid for work.
 */
import { anId, cap, no, ok, optional, parseIn, required, type Parsed } from './field-rules.ts';

export const ROLE_FIELDS = {
	name: required('A role needs a name.', cap(40))
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

export const PERSON_FIELDS = {
	// Empty is no role: signs in, is not paid.
	role_id: optional(anId),
	// Empty follows the business's zone.
	timezone: optional(cap(64, aZone))
};

export function parsePersonField(field: string, raw: string): Parsed {
	return parseIn(PERSON_FIELDS, field, raw);
}
