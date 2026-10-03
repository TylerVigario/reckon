import { sql } from 'drizzle-orm';
import { asUser, db, useZone } from '#lib/server/db/index.ts';
import { invoice, operator } from '#lib/server/db/schema/index.ts';
import { camel } from '#lib/server/db/rows.ts';
import { type Errors, refuse, refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';
import { parseField } from '#lib/settings-fields.ts';
import { verifyPlace } from '#lib/server/verify-place.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readFields } from '#lib/json.ts';

/**
 * Saves settings one field at a time.
 *
 * PATCH, not POST: this changes part of a thing that already exists, and a
 * request carrying `phone` says nothing about the operator's other columns.
 *
 * It takes several fields at once because some belong together: an address
 * and its Google place id describe one place, and changing the words alone
 * would leave the id pointing somewhere else. The whole set is checked before
 * any of it is written, so one bad value saves nothing.
 *
 * THIS IS THE CHECK THAT COUNTS. The page runs the same rules from
 * #lib/settings-fields, which is a courtesy -- an answer without a round trip.
 * Nothing arriving here has necessarily been through the page, so this side
 * assumes it did not, and then adds the four things the page could not have
 * done for itself:
 *
 *   1. values that are not values at all -- an object where a string belongs
 *   2. references to rows: a row that exists and is still active
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
		// Only strings and numbers are values here. Anything else would be
		// stored as whatever String() makes of it -- "[object Object]" for {}.
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

	// A next number at or below one already used would issue a duplicate, and
	// a client would be the one to notice. Only this side knows which numbers
	// are taken.
	if (typeof row.next_invoice_number === 'number') {
		const [issued] = await db
			.select({
				high: sql<string>`coalesce(max(nullif(regexp_replace(${invoice.number}, '[^0-9]', '', 'g'), '')::bigint), 0)::text`
			})
			.from(invoice);
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

	// The time zone has to be one Postgres knows, not only one the browser
	// does: every connection is set to it (#26). Saved under Postgres's own
	// spelling of the name, so the two never disagree about which zone it is.
	if (typeof row.timezone === 'string') {
		const { rows: known } = await db.execute<{ name: string }>(
			sql`select name from pg_timezone_names where lower(name) = lower(${row.timezone}) limit 1`
		);
		if (!known[0]) return refuse({ timezone: 'The database does not know that time zone.' });
		row.timezone = known[0].name;
	}

	const [exists] = await db.select({ id: operator.id }).from(operator).limit(1);
	// The registry's keys are the columns' own names; the schema's are camelCase.
	const values = camel(row) as Partial<typeof operator.$inferInsert>;

	try {
		if (exists) {
			// asUser so the h_operator trigger records who changed the rate a
			// client is billed at, rather than recording that somebody did.
			await asUser(locals.user!.id, async (tx) => {
				await tx.update(operator).set(values);
				if ('google_place_id' in row)
					// Stamped here with current_date; a request does not get to
					// say when the check happened.
					await tx.update(operator).set({ addressVerifiedOn: verified ? sql`current_date` : null });
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
			await db
				.insert(operator)
				.values({ ...values, tradingName: String(row.trading_name), singleton: true });
		}
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, names, 'operator');
		if (refused) return refused;
		throw e;
	}

	// Every connection follows the new zone from its next use.
	if (typeof row.timezone === 'string') useZone(row.timezone);

	// The stored values go back, not the submitted ones: "usd" is saved as USD
	// and #4F6D8A as #4f6d8a, and the field should show what is actually there.
	return Response.json({ saved: row, address_verified: verified });
};
