import { sql, type Updateable } from 'kysely';
import { businessToday } from '#lib/server/calendar.ts';
import type { Operator } from '#lib/server/db/database.ts';
import { asUser, db } from '#lib/server/db/index.ts';
import { type Errors, refuse, refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';
import { parseField } from '#lib/settings-fields.ts';
import { confirmPlace } from '#lib/server/verify-place.ts';
import { measureEverySite } from '#lib/server/site-drive.ts';
import { knownZone } from '#lib/server/zones.ts';
import { rememberBusiness } from '#lib/server/business.ts';
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
 * And one thing after: a business that moves has every site's drive measured
 * again from where it now is (#lib/server/site-drive), since Google's were
 * measured from where it was.
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
		const issued = await db
			.selectFrom('invoice')
			.select((eb) =>
				sql<string>`coalesce(max(nullif(regexp_replace(${eb.ref('number')}, '[^0-9]', '', 'g'), '')::bigint), 0)::text`.as(
					'high'
				)
			)
			.executeTakeFirst();
		const high = Number(issued?.high ?? 0);
		if (row.next_invoice_number <= high)
			return refuse({
				next_invoice_number: `Invoice ${high} has already been issued, so the next one must be ${high + 1} or more.`
			});
	}

	// An address is a place chosen from Google's suggestions, with its id, and
	// Google is asked whether it is one: its answer, not the browser's claim,
	// is what lets the address save and dates when it was confirmed. No
	// address at all is the one other thing it may be.
	let verified = false;
	if ('address' in row) {
		if (row.address) {
			const why = await confirmPlace(row.google_place_id as string | null);
			if (why) return refuse({ address: why });
			verified = true;
		} else row.google_place_id = null;
	} else if ('google_place_id' in row)
		return refuse({ address: 'An address and its place are saved together.' });

	// The business's time zone: its clock for overdue, ageing and report months,
	// and the zone a person follows until they set their own. It has to be one
	// Postgres knows, and it is saved under Postgres's own spelling.
	if (typeof row.timezone === 'string') {
		const known = await knownZone(row.timezone);
		if (!known) return refuse({ timezone: 'The database does not know that time zone.' });
		row.timezone = known;
	}

	const exists = await db
		.selectFrom('operator')
		.select(['id', 'address', 'google_place_id'])
		.limit(1)
		.executeTakeFirst();
	const moved =
		'address' in row &&
		((row.address || null) !== (exists?.address || null) ||
			(row.google_place_id || null) !== (exists?.google_place_id || null));
	// The registry's keys are the columns' own names, and each one's rule
	// (#lib/settings-fields) makes the value its column holds.
	const values = row as Updateable<Operator>;

	try {
		if (exists) {
			// asUser so the h_operator trigger records who changed the rate a
			// client is billed at, rather than recording that somebody did.
			await asUser(locals.user!.id, async (tx) => {
				await tx.updateTable('operator').set(values).execute();
				if ('google_place_id' in row)
					// Stamped here, on the business's clock; a request does not get
					// to say when the check happened.
					await tx
						.updateTable('operator')
						.set({ address_verified_on: verified ? businessToday() : null })
						.execute();
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
				.insertInto('operator')
				.values({ ...values, trading_name: String(row.trading_name), singleton: true })
				.execute();
		}
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, names, 'operator');
		if (refused) return refused;
		throw e;
	}

	const sites = moved ? await measureEverySite(locals.user!.id) : null;

	// The business's clock, locale and currency move the moment they are saved.
	if (typeof values.timezone === 'string') await rememberBusiness({ zone: values.timezone });
	if (typeof values.locale === 'string') await rememberBusiness({ locale: values.locale });
	if (typeof values.currency === 'string') await rememberBusiness({ currency: values.currency });
	if (typeof values.tax_rule_set === 'string')
		await rememberBusiness({ taxRuleSet: values.tax_rule_set });

	// The stored values go back, not the submitted ones: "usd" is saved as USD
	// and #4F6D8A as #4f6d8a, and the field should show what is actually there.
	return Response.json({ saved: row, address_verified: verified, sites });
};
