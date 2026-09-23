import { json } from '@sveltejs/kit';
import { asUser, sql } from '$lib/server/db';
import { refuse, refuseIfTheDatabaseSaidSo } from '$lib/server/field-errors';
import { lookUpClient } from '$lib/server/find';
import { SITE_FIELDS, parseSiteField } from '$lib/site-fields';
import { priceAddress, NoAnswer } from '$lib/server/cdtfa.js';
import type { RequestHandler } from './$types';
import { problem } from '$lib/server/problem';
import { readFields } from '$lib/json';

/**
 * Creates a site.
 *
 * POST, not PATCH: this makes a thing that did not exist, and every field it
 * needs has to arrive at once -- there is no half a site to save.
 *
 * CREATING A SITE IS A LOOKUP. The rate, the area and the tax area code are
 * CDTFA's answer about the address, and the schema will not hold a site
 * without them. So the address is priced before the row is written, and a
 * place CDTFA cannot answer for is refused with their reason rather than
 * stored as a site nobody can bill from.
 *
 * THE CLIENT IS IN THE PATH, not in the body. A site belongs to exactly one
 * client -- site_belongs_to_one_client says so -- and an endpoint that took
 * the client as a field could be asked to put a site under one client while
 * the caller believed it was another. The URL carries the same scoping the
 * schema does, and it is the URL the pages already use.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const client = await lookUpClient(params.id);
	if (!client) return problem('notFound', 404, 'No client by that name or id.');
	const entity_id = client.id;

	const fields = await readFields(request);
	if (!fields) return problem('malformed', 400, 'Expected { fields: { name: value } }.');

	const row: Record<string, string | number | boolean | null> = {};
	const errors: Record<string, string> = {};

	// Everything the registry knows, whether or not the caller sent it: a
	// missing required field has to answer "this is needed" rather than pass
	// unmentioned and fail later as a NOT NULL nobody can read.
	//
	// Except `active`, which is not a question a new site answers -- one is
	// created because it is being worked at. It is set below, as a real
	// boolean: handing postgres.js the string 'true' for a boolean column
	// stores FALSE and reports success.
	// `slug` is skipped when not sent: the database derives it from the label,
	// and a caller that has no opinion should not have to have one. `active` is
	// never asked -- a site is created because it is being worked at.
	const asked = Object.keys(SITE_FIELDS).filter(
		(n) => n !== 'active' && (n !== 'slug' || 'slug' in fields)
	);
	for (const name of asked) {
		const raw = fields[name];
		if (raw !== null && raw !== undefined && typeof raw !== 'string' && typeof raw !== 'number') {
			errors[name] = 'Expected a value, not a structure.';
			continue;
		}
		const parsed = parseSiteField(name, raw === null || raw === undefined ? '' : String(raw));
		if (parsed.ok) row[name] = parsed.value;
		else errors[name] = parsed.why;
	}
	if (Object.keys(errors).length > 0) return refuse(errors);

	let priced;
	try {
		priced = await priceAddress({
			street: String(row.street),
			city: String(row.city),
			postcode: String(row.postcode)
		});
	} catch (e) {
		// Against the postcode, because that is the field most often wrong and
		// the one the reader can act on. The message is CDTFA's own.
		return refuse({ postcode: e instanceof NoAnswer ? e.message : 'CDTFA could not be reached.' });
	}

	try {
		const [site]: { id: string; slug: string; display: string }[] = await asUser(
			locals.user!.id,
			(tx) =>
				tx`
				insert into site ${tx({
					...row,
					entity_id,
					active: true,
					tax_rate_pct: priced.rate,
					state_rate_pct: priced.state,
					district_rate_pct: priced.district,
					tax_jurisdiction: priced.jurisdiction,
					tax_area_code: priced.tac,
					area_verified_on: new Date().toISOString().slice(0, 10)
				})}
				returning id, slug, display`
		);

		// The answer is logged as an answer, the same as a refresh's, so the
		// first thing that happened to this site is in the same record as
		// everything after it.
		await sql`
			insert into site_tax_check (site_id, tax_area_code, tax_jurisdiction, rate_pct,
			                            state_rate_pct, district_rate_pct, changed, note)
			values (${site.id}, ${priced.tac}, ${priced.jurisdiction}, ${priced.rate},
			        ${priced.state}, ${priced.district}, true, 'asked when the site was created')`;

		return json({ id: site.id, slug: site.slug, display: site.display, priced }, { status: 201 });
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, Object.keys(row), 'site');
		if (refused) return refused;
		throw e;
	}
};
