import { asUser, today } from '#lib/server/db/index.ts';
import { site as sites, siteTaxCheck } from '#lib/server/db/schema/index.ts';
import { insertNamed } from '#lib/server/slugs.ts';
import { refuse, refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';
import { lookUpClient } from '#lib/server/find.ts';
import { SITE_FIELDS, parseSiteField } from '#lib/site-fields.ts';
import { priceAddress, NoAnswer } from '#lib/server/cdtfa.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readFields } from '#lib/json.ts';

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
	// `slug` is skipped when not sent: it is made from the label, and a caller
	// that has no opinion should not have to have one. `active` is never asked
	// -- a site is created because it is being worked at.
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
		const optional = <T>(v: unknown, as: (v: unknown) => T) =>
			v === null || v === undefined ? null : as(v);
		const site = await asUser(locals.user!.id, async (tx) => {
			const areaVerifiedOn = await today(tx);
			const [made] = await insertNamed(
				tx,
				{
					given: optional(row.slug, String),
					from: String(row.label),
					fallback: 'site',
					constraint: 'site_slug_is_the_clients'
				},
				(tx, slug) =>
					tx
						.insert(sites)
						.values({
							slug,
							label: String(row.label),
							street: String(row.street),
							city: String(row.city),
							region: String(row.region),
							postcode: String(row.postcode),
							roundTripMiles: optional(row.round_trip_miles, String),
							driveMinutes: optional(row.drive_minutes, Number),
							entityId: entity_id,
							active: true,
							taxRatePct: priced.rate,
							stateRatePct: priced.state,
							districtRatePct: priced.district,
							taxJurisdiction: priced.jurisdiction,
							taxAreaCode: priced.tac,
							areaVerifiedOn
						})
						.returning({ id: sites.id, slug: sites.slug, display: sites.display })
			);

			// The answer is logged as an answer, the same as a refresh's, so the
			// first thing that happened to this site is in the same record as
			// everything after it.
			await tx.insert(siteTaxCheck).values({
				siteId: made.id,
				taxAreaCode: priced.tac,
				taxJurisdiction: priced.jurisdiction,
				ratePct: priced.rate,
				stateRatePct: priced.state,
				districtRatePct: priced.district,
				changed: true,
				note: 'asked when the site was created'
			});
			return made;
		});

		return Response.json(
			{ id: site.id, slug: site.slug, display: site.display, priced },
			{ status: 201 }
		);
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, Object.keys(row), 'site');
		if (refused) return refused;
		throw e;
	}
};
