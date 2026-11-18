import { Decimal } from '#lib/decimal.ts';
import { asUser, db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { lookUpClient, lookUpSite } from '#lib/server/find.ts';
import { priceAddress, NoAnswer } from '#lib/server/cdtfa.ts';
import { areaRate, recordCdtfaArea } from '#lib/server/tax-areas.ts';
import { problem } from '#lib/server/problem.ts';
import { VERSION } from '#lib/server/concurrent.ts';
import type { RequestHandler } from './$types';

/**
 * Asks CDTFA again what a site pays (7 November 2026): the site is the rate's
 * one home, and its page asks, as the refresh script does for every rate over
 * STALE_AFTER_DAYS old (#lib/server/stale).
 *
 * The answer is written down whether or not the rate moved, and the site is
 * dated as asked today, on the business's clock: "confirmed today" is what the
 * screens need, and it is not "unchanged since March". A line already written
 * keeps the rate it was written at (#lib/server/lines); the next one here is
 * charged at the new.
 *
 * CDTFA not answering writes nothing, and says why. Nor does a site that moved
 * while CDTFA was being asked take the answer: it was about where the site was.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	const client = await lookUpClient(params.id);
	if (!client) return problem('notFound', 404, 'No client by that name or id.');
	const found = await lookUpSite(client.id, params.site);
	if (!found) return problem('notFound', 404, 'That client has no such site.');

	const was = await db
		.selectFrom('site')
		.select((eb) => [
			'street',
			'city',
			'postcode',
			// Its area's rate today (#lib/server/tax-areas).
			areaRate(eb.ref('site.tax_area_id'), businessToday()).as('rate')
		])
		.where('id', '=', found.id)
		.executeTakeFirstOrThrow();

	let answer;
	try {
		answer = await priceAddress(was);
	} catch (e) {
		return problem(
			'upstream',
			502,
			e instanceof NoAnswer ? e.message : 'CDTFA could not be reached.'
		);
	}
	const changed = !Decimal.from(answer.rate).eq(was.rate);
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
			await tx
				.insertInto('site_tax_check')
				.values({
					site_id: found.id,
					tax_area_code: answer.tac,
					tax_jurisdiction: answer.jurisdiction,
					rate_pct: answer.rate,
					state_rate_pct: answer.state,
					district_rate_pct: answer.district,
					changed,
					note: 'asked again'
				})
				.execute();
		return row;
	});
	if (!saved)
		return problem(
			'conflict',
			409,
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
