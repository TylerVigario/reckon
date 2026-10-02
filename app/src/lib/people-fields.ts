/**
 * What may be said about a role, and about the role a person holds.
 *
 * A role is the operator's own word for a capacity people are paid in --
 * Partner, Employee, Contractor, or whatever a business calls them. Pay rules
 * are written against roles, so a person's role is which rules reach them.
 * No role at all means they sign in and are not paid for work.
 */
import { anId, cap, optional, parseIn, required, type Parsed } from './field-rules.ts';

export const ROLE_FIELDS = {
	name: required('A role needs a name.', cap(40))
};

export function parseRoleField(field: string, raw: string): Parsed {
	return parseIn(ROLE_FIELDS, field, raw);
}

export const PERSON_FIELDS = {
	// Empty is no role: signs in, is not paid.
	role_id: optional(anId)
};

export function parsePersonField(field: string, raw: string): Parsed {
	return parseIn(PERSON_FIELDS, field, raw);
}
