import { json } from '@sveltejs/kit';
import { asUser, sql } from '$lib/server/db';
import { refuse, refuseIfTheDatabaseSaidSo } from '$lib/server/field-errors';
import { lookUpClient, lookUpSite } from '$lib/server/find';
import { ADDRESS_FIELDS, parseSiteField } from '$lib/site-fields';
import { priceAddress, NoAnswer } from '$lib/server/cdtfa.js';
import type { RequestHandler } from './$types';
import { problem } from '$lib/server/problem';
import { preconditionOf, staleRead, withVersion } from '$lib/server/concurrent';
import { readFields } from '$lib/json';

/**
 * Saves one site's details, a field at a time.
 *
 * MOVING A SITE RE-PRICES IT. The address decides the rate, so changing any
 * part of it means CDTFA has to be asked again -- and if they cannot answer
 * for the new address, the change is refused rather than left pointing at a
 * rate for somewhere else. That is the whole failure this lane has been
 * unwinding: a rate that stayed behind while the thing it described moved.
 *
 * The rate fields themselves are not in the registry and cannot be named by a
 * request. There is no way to type a rate into this system.
 */
const MOST_AT_ONCE = 8;

export const PATCH: RequestHandler = async (event) => {
	const { params, request, locals } = event;

	const pre = preconditionOf(event);
	if (!pre.ok) return pre.response;

	// A slug or an id for either. A site's slug is unique within its client,
	// which is exactly what this path supplies -- two clients each having a
	// "kettleman" resolves correctly because the client comes first.
	const client = await lookUpClient(params.id);
	if (!client) return problem('notFound', 404, 'No client by that name or id.');
	const found = await lookUpSite(client.id, params.site);
	if (!found) return problem('notFound', 404, 'That client has no such site.');
	const id = found.id;

	const fields = await readFields(request);
	if (!fields) return problem('malformed', 400, 'Expected { fields: { name: value } }.');

	const names = Object.keys(fields);
	if (names.length === 0) return problem('malformed', 400, 'No fields given.');
	if (names.length > MOST_AT_ONCE)
		return problem('malformed', 400, `At most ${MOST_AT_ONCE} fields at once.`);

	const row: Record<string, string | number | boolean | null> = {};
	const errors: Record<string, string> = {};
	for (const name of names) {
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

	const [site] = await sql`
		select id, street, city, postcode, tax_rate_pct from site where id = ${id}`;

	const moved = ADDRESS_FIELDS.some((f) => f in row && String(row[f]) !== String(site[f] ?? ''));

	let priced = null;
	if (moved) {
		// The address as it will END UP, which is the one to price: a PATCH can
		// carry the city without the street, and pricing what arrived rather
		// than what results is how a site ends up rated for neither address.
		const after = {
			street: String('street' in row ? row.street : site.street),
			city: String('city' in row ? row.city : site.city),
			postcode: String('postcode' in row ? row.postcode : site.postcode)
		};
		try {
			priced = await priceAddress(after);
		} catch (e) {
			const why = e instanceof NoAnswer ? e.message : 'CDTFA could not be reached.';
			return refuse(
				Object.fromEntries(ADDRESS_FIELDS.filter((f) => f in row).map((f) => [f, why]))
			);
		}
		Object.assign(row, {
			tax_rate_pct: priced.rate,
			state_rate_pct: priced.state,
			district_rate_pct: priced.district,
			tax_jurisdiction: priced.jurisdiction,
			tax_area_code: priced.tac,
			area_verified_on: new Date().toISOString().slice(0, 10)
		});
	}

	let after: { version: string } | undefined;
	try {
		// Checked in the update rather than before it, so there is no window
		// between reading the version and writing over it.
		[after] = await asUser(
			locals.user!.id,
			(tx) => tx`
			update site set ${tx(row)}
			 where id = ${id}
			   and (${pre.version}::text is null or xmin::text = ${pre.version})
			 returning xmin::text as version`
		);
		if (after && priced) {
			await sql`
				insert into site_tax_check (site_id, tax_area_code, tax_jurisdiction, rate_pct,
				                            state_rate_pct, district_rate_pct, changed, note)
				values (${id}, ${priced.tac}, ${priced.jurisdiction}, ${priced.rate},
				        ${priced.state}, ${priced.district},
				        ${Number(priced.rate) !== Number(site.tax_rate_pct)},
				        'asked because the address changed')`;
		}
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, Object.keys(row), 'site');
		if (refused) return refused;
		throw e;
	}

	if (!after) return staleRead('This site', event.url.pathname);
	return withVersion(json({ saved: row, priced, version: after.version }), after.version);
};

/**
 * Closes a site. Not a delete: work was done here and invoices point at it, so
 * the row stays and stops being offered.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const client = await lookUpClient(params.id);
	if (!client) return problem('notFound', 404, 'No client by that name or id.');
	const found = await lookUpSite(client.id, params.site);
	if (!found) return problem('notFound', 404, 'That client has no such site.');
	await asUser(locals.user!.id, (tx) => tx`update site set active = false where id = ${found.id}`);
	return json({ closed: true });
};
