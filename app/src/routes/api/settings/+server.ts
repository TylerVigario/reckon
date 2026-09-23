import { json } from '@sveltejs/kit';
import { asUser, sql } from '$lib/server/db';
import { type Errors, refuse, refuseIfTheDatabaseSaidSo } from '$lib/server/field-errors';
import { parseField } from '$lib/settings-fields';
import { verifyPlace } from '$lib/server/verify-place';
import type { RequestHandler } from './$types';
import { problem } from '$lib/server/problem';
import { readFields } from '$lib/json';

/**
 * Saves settings one field at a time.
 *
 * PATCH, not POST: this changes part of a thing that already exists, and a
 * request carrying `phone` says nothing about the other twenty-two columns.
 *
 * It takes a set rather than a single field because some values only make
 * sense together -- an address and the Google place id that identifies it are
 * one fact, and saving the text without the id would leave the row describing
 * a place it no longer points at. Everything in the set is validated before
 * anything is written, so a bad value cannot leave half of one saved.
 *
 * THIS IS THE CHECK THAT COUNTS. The page runs the same rules from
 * $lib/settings-fields, which is a courtesy -- an answer without a round trip.
 * Nothing arriving here has necessarily been through the page, so this side
 * assumes it did not, and then adds the four things the page could not have
 * done for itself:
 *
 *   1. values that are not values at all -- an object where a string belongs
 *   2. references to rows: a base location that exists and is still active
 *   3. facts about what has already happened -- an invoice number that has
 *      been issued cannot be handed out again
 *   4. the browser's word against Google's: a place id is checked with Google
 *      rather than believed, and Google's answer is what dates the check
 *
 * Everything it refuses comes back keyed by field, so the page can show it
 * under the box that caused it rather than as a banner about "an error".
 */
const MOST_AT_ONCE = 8;

export const PATCH: RequestHandler = async ({ request, locals }) => {
	const fields = await readFields(request);
	if (!fields) return problem('malformed', 400, 'Expected { fields: { name: value } }.');

	const names = Object.keys(fields);
	if (names.length === 0) return problem('malformed', 400, 'No fields given.');
	if (names.length > MOST_AT_ONCE)
		return problem('malformed', 400, `At most ${MOST_AT_ONCE} fields at once.`);

	// Everything is parsed before anything is written. The column written is
	// the key from the registry, never the name off the request.
	const row: Record<string, string | number | boolean | null> = {};
	const errors: Errors = {};
	for (const name of names) {
		const raw = fields[name];
		// A string or a number is a value. An object, an array or a boolean is
		// a caller doing something else, and String()-ing one would turn {}
		// into "[object Object]" and store it.
		if (raw !== null && raw !== undefined && typeof raw !== 'string' && typeof raw !== 'number') {
			errors[name] = 'Expected a value, not a structure.';
			continue;
		}
		const parsed = parseField(name, raw === null || raw === undefined ? '' : String(raw));
		if (parsed.ok) row[name] = parsed.value;
		else errors[name] = parsed.why;
	}
	if (Object.keys(errors).length > 0) return refuse(errors);

	// --- What only this side can know ---------------------------------------

	// Numbering back over an invoice that has gone out produces two invoices
	// with one number, which is a problem found by a client rather than by us.
	// The page cannot check it: it is never told what has issued.
	if (typeof row.next_invoice_number === 'number') {
		const [issued] = await sql`
			select coalesce(max(nullif(regexp_replace(number, '\D', '', 'g'), '')::bigint), 0) as high
			  from invoice`;
		const high = Number(issued?.high ?? 0);
		if (row.next_invoice_number <= high)
			return refuse({
				next_invoice_number: `Invoice ${high} has already been issued, so the next one must be ${high + 1} or more.`
			});
	}

	// The browser asserted this place id. Google is asked whether it is a place
	// -- and Google's answer, not the browser's claim, is what sets the date
	// saying when this was last confirmed.
	let verified = false;
	if (row.google_place_id) {
		const verdict = await verifyPlace(row.google_place_id as string);
		if (verdict === 'no-such-place')
			return refuse({ address: 'Google does not know that place. Choose the address again.' });
		verified = verdict === 'real';
	}

	const [exists] = await sql`select 1 from operator limit 1`;

	try {
		if (exists) {
			// asUser so the h_operator trigger records who changed the rate a
			// client is billed at, rather than recording that somebody did.
			await asUser(locals.user!.id, async (tx) => {
				await tx`update operator set ${tx(row)}`;
				if ('google_place_id' in row) {
					// current_date rather than a date from the browser: when this
					// system last checked is not something a request may assert.
					if (verified) await tx`update operator set address_verified_on = current_date`;
					else await tx`update operator set address_verified_on = null`;
				}
			});
		} else {
			// Nothing to update yet. Every other column has a default, so the
			// trading name is the one that has to arrive first -- the same thing
			// the logo upload says when it is asked to run on an empty table.
			if (!('trading_name' in row))
				return refuse(
					Object.fromEntries(names.map((n) => [n, 'Set the trading name first.'])),
					409
				);
			await sql`insert into operator ${sql({ ...row, singleton: true })}`;
		}
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, names, 'operator');
		if (refused) return refused;
		throw e;
	}

	// The stored values go back, not the submitted ones: "usd" is saved as USD
	// and #2382B3 as #2382b3, and the field should show what is actually there.
	return json({ saved: row, address_verified: verified });
};
