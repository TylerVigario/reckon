import { and, eq } from 'drizzle-orm';
import { Decimal } from '#lib/decimal.ts';
import { asUser, db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { site as sites, siteTaxCheck } from '#lib/server/db/schema/index.ts';
import { lookUpClient, lookUpSite } from '#lib/server/find.ts';
import { priceAddress, NoAnswer } from '#lib/server/cdtfa.ts';
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

	const [was] = await db
		.select({
			street: sites.street,
			city: sites.city,
			postcode: sites.postcode,
			rate: sites.taxRatePct
		})
		.from(sites)
		.where(eq(sites.id, found.id));

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
		const [row] = await tx
			.update(sites)
			.set({
				taxRatePct: answer.rate,
				stateRatePct: answer.state,
				districtRatePct: answer.district,
				taxJurisdiction: answer.jurisdiction,
				taxAreaCode: answer.tac,
				areaVerifiedOn: today
			})
			.where(
				and(
					eq(sites.id, found.id),
					eq(sites.street, was.street),
					eq(sites.city, was.city),
					eq(sites.postcode, was.postcode)
				)
			)
			.returning({ version: VERSION });
		if (row)
			await tx.insert(siteTaxCheck).values({
				siteId: found.id,
				taxAreaCode: answer.tac,
				taxJurisdiction: answer.jurisdiction,
				ratePct: answer.rate,
				stateRatePct: answer.state,
				districtRatePct: answer.district,
				changed,
				note: 'asked again'
			});
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
