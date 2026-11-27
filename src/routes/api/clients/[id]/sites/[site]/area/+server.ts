import { Decimal } from '#lib/decimal.ts';
import { asUser, db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { lookUpClient, lookUpSite } from '#lib/server/find.ts';
import { priceAddress, NoAnswer } from '#lib/server/cdtfa.ts';
import { placeSite, recordCdtfaArea } from '#lib/server/tax-areas.ts';
import { asksCdtfa, siteRate } from '#lib/server/tax-registrations.ts';
import { findTypedArea, typesAreasIn } from '#lib/server/typed-areas.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { stateName } from '#lib/us-states.ts';
import { readFields } from '#lib/json.ts';
import { problem } from '#lib/server/problem.ts';
import { VERSION } from '#lib/server/concurrent.ts';
import type { RequestHandler } from './$types';

/**
 * A SITE'S TAX AREA. POST asks the state's authority which area its address is
 * in, and PUT is a person choosing it, where nothing answers.
 *
 * POST asks CDTFA again what a site pays (7 November 2026), now rather than
 * when the server next does on its own (#lib/server/tax-sync): where its
 * address is, and every rate its area has.
 *
 * The answer is written down whether or not the rate moved, and the site is
 * dated as asked today, on the business's clock: "confirmed today" is what the
 * screens need, and it is not "unchanged since March". A line already written
 * keeps the rate it was written at (#lib/server/lines); the next one here is
 * charged at the new.
 *
 * CDTFA not answering writes nothing, and says why. Nor does a site that moved
 * while CDTFA was being asked take the answer: it was about where the site was.
 * And CDTFA is asked only about a California site, where the business collects
 * tax there (#lib/server/tax-registrations).
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	const client = await lookUpClient(params.id);
	if (!client) return problem('notFound', 'No client by that name or id.');
	const found = await lookUpSite(client.id, params.site);
	if (!found) return problem('notFound', 'That client has no such site.');

	const was = await db
		.selectFrom('site')
		.select((eb) => [
			'street',
			'city',
			'region',
			'postcode',
			'tax_area_id',
			// Its area's rate today, where it is in one.
			siteRate(
				{ region: eb.ref('site.region'), area: eb.ref('site.tax_area_id') },
				businessToday()
			).as('rate')
		])
		.where('id', '=', found.id)
		.executeTakeFirstOrThrow();
	if (!(await asksCdtfa(db, was.region)))
		return problem(
			'notAsThingsStand',
			was.region === 'CA'
				? 'The business does not collect tax in California, so CDTFA is not asked.'
				: 'CDTFA answers for California, and this site is not there.'
		);

	let answer;
	try {
		answer = await priceAddress(was, businessToday());
	} catch (e) {
		return problem('upstream', e instanceof NoAnswer ? e.message : 'CDTFA could not be reached.');
	}
	const changed = was.rate === null || !Decimal.from(answer.rate).eq(was.rate);
	const today = businessToday();

	const saved = await asUser(locals.user!.id, async (tx) => {
		// The answer is true of its area whatever this site did meanwhile; the
		// site takes it only if it is still where it was asked about.
		const area = await recordCdtfaArea(tx, answer, today);
		const row = await tx
			.updateTable('site')
			.set({ tax_area_id: area, area_verified_on: today })
			.where('id', '=', found.id)
			.where('street', '=', was.street)
			.where('city', '=', was.city)
			.where('postcode', '=', was.postcode)
			.returning(VERSION.as('version'))
			.executeTakeFirst();
		if (row)
			await placeSite(tx, { id: found.id, was: was.tax_area_id }, area, {
				way: 'asked',
				by: locals.user!.id,
				note: 'asked again'
			});
		return row;
	});
	if (!saved)
		return problem(
			'changedMeanwhile',
			'The site moved while CDTFA was being asked, so the answer was not kept. Ask again.'
		);

	return Response.json({
		rate: answer.rate,
		was: was.rate,
		changed,
		verified_on: today,
		version: saved.version
	});
};

/**
 * A person chooses which of its state's typed areas a site is in
 * (#lib/server/typed-areas), from the state's own lookup: { fields: { area } }.
 * Only where the business collects and no authority answers for an address;
 * a California site's area is CDTFA's answer. Nothing asks again where a
 * chosen site is, so it stays where it was put until someone moves it, and
 * its rate is as current as its area's confirmation.
 */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const client = await lookUpClient(params.id);
	if (!client) return problem('notFound', 'No client by that name or id.');
	const found = await lookUpSite(client.id, params.site);
	if (!found) return problem('notFound', 'That client has no such site.');
	const fields = await readFields(request);
	if (!fields) return problem('malformed', 'Expected { fields: { area } }.');

	const site = await db
		.selectFrom('site')
		.select(['region', 'tax_area_id'])
		.where('id', '=', found.id)
		.executeTakeFirstOrThrow();
	if (!(await typesAreasIn(db, site.region)))
		return problem(
			'notAsThingsStand',
			site.region === 'CA'
				? 'CDTFA says which area a California site is in.'
				: `The business does not collect tax in ${stateName(site.region)}, so its sites are in no area.`
		);
	const area =
		typeof fields.area === 'string' ? await findTypedArea(db, site.region, fields.area) : null;
	if (!area) return refuse({ area: `Choose one of ${stateName(site.region)}'s areas.` });

	const today = businessToday();
	const saved = await asUser(locals.user!.id, async (tx) => {
		const row = await tx
			.updateTable('site')
			.set({ tax_area_id: area.id, area_verified_on: today })
			.where('id', '=', found.id)
			.where('region', '=', site.region)
			.returning(VERSION.as('version'))
			.executeTakeFirst();
		if (row)
			await placeSite(tx, { id: found.id, was: site.tax_area_id }, area.id, {
				way: 'chosen',
				by: locals.user!.id,
				note: 'chosen'
			});
		return row;
	});
	if (!saved)
		return problem('changedMeanwhile', 'The site moved to another state meanwhile. Choose again.');
	return Response.json({
		area: area.id,
		name: area.name,
		placed_on: today,
		version: saved.version
	});
};
