/**
 * What may be said about a contact: someone at a client to ask for, call, or
 * send the invoices to.
 *
 * A person is shared, not owned: one bookkeeper can act for two clients
 * (#lib/server/db/schema/clients). So these are the person themselves, said
 * once on their own page, and every client and site they act for shows the
 * same name, email and phone.
 */
import { anEmail, cap, optional, parseIn, phone, required, type Parsed } from './field-rules.ts';

export const CONTACT_FIELDS = {
	name: required('Enter their name.', cap(120)),
	// Where the invoices go, for a client that sends them to this person.
	email: optional(cap(254, anEmail)),
	phone: optional(cap(40, phone)),
	// What they do, or when to call.
	note: optional(cap(200))
};

export function parseContactField(field: string, raw: string): Parsed {
	return parseIn(CONTACT_FIELDS, field, raw);
}
