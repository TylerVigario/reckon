import { asUser, db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { insertNamed } from '#lib/server/slugs.ts';
import { refuse, refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';
import { lookUpClient } from '#lib/server/find.ts';
import { SITE_FIELDS, parseSiteField } from '#lib/site-fields.ts';
import { priceAddress, NoAnswer } from '#lib/server/cdtfa.ts';
import { placeSite, recordCdtfaArea } from '#lib/server/tax-areas.ts';
import { asksCdtfa } from '#lib/server/tax-registrations.ts';
import { findTypedArea, typesAreasIn } from '#lib/server/typed-areas.ts';
import { stateName } from '#lib/us-states.ts';
import { confirmPlace } from '#lib/server/verify-place.ts';
import { measureDrive } from '#lib/server/site-drive.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readFields } from '#lib/json.ts';

/**
 * Creates a site.
 *
 * POST, not PATCH: this makes a thing that did not exist, and every field it
 * needs has to arrive at once -- there is no half a site to save.
 *
 * IN CALIFORNIA, CREATING A SITE IS A LOOKUP, where the business collects tax
 * there. The site's area, and so its rate, is CDTFA's answer about the
 * address, so the address is priced before the row is written, and a place
 * CDTFA cannot answer for is refused with their reason rather than stored as a
 * site nobody can bill from. Where the business collects and no authority
 * answers, a person chooses its area as it is made, from the state's typed
 * ones -- `tax_area_id`, beside the fields -- or later, from its Tax tab
 * (#lib/server/typed-areas). A site in a state the business does not collect
 * in has no area to find, and is made with none
 * (#lib/server/tax-registrations).
 *
 * THE ADDRESS IS A PLACE GOOGLE CONFIRMS (8 October 2026): chosen from
 * Google's suggestions, its parts arrive with its place id, and Google is asked
 * whether that is a place before anything else is. Online only: an address
 * Google could not confirm is not saved.
 *
 * AND HOW FAR IT IS (8 October 2026). Google's route there and back from the
 * business (#lib/server/site-drive) is asked here, whoever the caller, and kept
 * beside any round trip or drive time typed over it (12 October 2026). New
 * site has already asked, to show it, so this is the same answer from the
 * cache.
 *
 * THE CLIENT IS IN THE PATH, not in the body. A site belongs to exactly one
 * client -- site_belongs_to_one_client says so -- and an endpoint that took
 * the client as a field could be asked to put a site under one client while
 * the caller believed it was another. The URL carries the same scoping the
 * schema does, and it is the URL the pages already use.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const client = await lookUpClient(params.id);
	if (!client) return problem('notFound', 'No client by that name or id.');
	const entity_id = client.id;

	const fields = await readFields(request);
	if (!fields) return problem('malformed', 'Expected { fields: { name: value } }.');

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

	// The area a person chose, where one is chosen rather than asked for.
	const choice = fields.tax_area_id;
	let chosen: string | null = null;
	if (choice !== null && choice !== undefined && choice !== '') {
		const region = String(row.region);
		const area =
			typeof choice === 'string' && (await typesAreasIn(db, region))
				? await findTypedArea(db, region, choice)
				: null;
		if (!area)
			return refuse({
				tax_area_id:
					region === 'CA'
						? 'CDTFA says which area a California site is in.'
						: `Choose one of ${stateName(region)}'s areas, where the business collects there.`
			});
		chosen = area.id;
	}

	const notAPlace = await confirmPlace(String(row.google_place_id));
	if (notAPlace) return refuse({ google_place_id: notAPlace });

	let priced = null;
	if (await asksCdtfa(db, String(row.region)))
		try {
			priced = await priceAddress(
				{ street: String(row.street), city: String(row.city), postcode: String(row.postcode) },
				businessToday()
			);
		} catch (e) {
			// Against the postcode, because that is the field most often wrong
			// and the one the reader can act on. The message is CDTFA's own.
			return refuse({
				postcode: e instanceof NoAnswer ? e.message : 'CDTFA could not be reached.'
			});
		}

	const { drive } = await measureDrive(String(row.google_place_id));

	try {
		const optional = <T>(v: unknown, as: (v: unknown) => T) =>
			v === null || v === undefined ? null : as(v);
		const site = await asUser(locals.user!.id, async (tx) => {
			const areaVerifiedOn = businessToday();
			// CDTFA's answer is its area's (#lib/server/tax-areas), or it is
			// the one chosen.
			const area = priced ? await recordCdtfaArea(tx, priced, areaVerifiedOn) : chosen;
			const made = await insertNamed(
				{ given: optional(row.slug, String), from: String(row.label), fallback: 'site' },
				(slug, madeHere) =>
					tx
						.insertInto('site')
						.values({
							slug,
							label: String(row.label),
							street: String(row.street),
							city: String(row.city),
							region: String(row.region),
							postcode: String(row.postcode),
							google_place_id: String(row.google_place_id),
							address_verified_on: areaVerifiedOn,
							google_round_trip_miles: drive?.miles ?? null,
							google_drive_minutes: drive?.minutes ?? null,
							typed_round_trip_miles: optional(row.typed_round_trip_miles, String),
							typed_drive_minutes: optional(row.typed_drive_minutes, Number),
							entity_id,
							active: true,
							tax_area_id: area,
							area_verified_on: area ? areaVerifiedOn : null
						})
						.$if(madeHere, (qb) =>
							qb.onConflict((oc) => oc.constraint('site_slug_is_the_clients').doNothing())
						)
						.returning(['id', 'slug', 'display'])
						.executeTakeFirst()
			);

			// Its first placement, the same as a refresh's, so the first thing
			// that happened to this site is in the same record as everything
			// after it.
			if (area)
				await placeSite(
					tx,
					{ id: made.id, was: null },
					area,
					priced
						? { way: 'asked', by: locals.user!.id, note: 'asked when the site was created' }
						: { way: 'chosen', by: locals.user!.id, note: 'chosen when the site was created' }
				);
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
