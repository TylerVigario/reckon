import type { Kysely } from 'kysely';
import type { DB } from './db/database.ts';
import { NoAnswer, priceAddress, ratesFor } from './cdtfa.ts';
import { quarterBegan } from './stale.ts';
import { confirmCdtfaArea, placeSite, recordCdtfaArea } from './tax-areas.ts';
import { collecting } from './tax-registrations.ts';
import { log } from './log.ts';

/**
 * EVERY RATE KEPT AS ITS AUTHORITY SAYS IT, without anyone asking (18 November
 * 2026). A tax area is an authoritative cache: its pieces are its authority's
 * answer, and they stay its answer only as long as somebody keeps asking.
 *
 * So the server asks, every hour as it runs:
 *
 *   AREAS   each not yet confirmed today, of its authority by its code -- in
 *           California CDTFA's rate layer, by tax area code, which answers
 *           every rate it publishes for the area with the day each took
 *           effect. The layer is published ahead of a quarter, so the coming
 *           quarter's rate is kept dated the day it comes in, and switches on
 *           that day rather than on the day somebody notices. One request per
 *           area a day.
 *
 *   SITES   each not placed since this quarter began, or not placed at all,
 *           of its authority by its address, which moves a site whose area's
 *           boundary moved. California's boundaries change when its rates do,
 *           on a quarter's first day.
 *
 * Only where the business collects tax (#lib/server/tax-registrations): an
 * area nobody is taxed in, or a site nothing billed at is taxed, is not asked
 * about.
 *
 * Whatever cannot be reached waits for the next hour. A rate is stale only when
 * it has not been confirmed since this quarter began (#lib/server/stale): the
 * server not having reached CDTFA.
 *
 * Imports nothing of SvelteKit's, so scripts/refresh-tax-rates.mjs runs it
 * once under plain Node, and the database and the day are handed in.
 */

/**
 * What a pass did: the areas it confirmed and how many of them changed -- a
 * rate, or the day one took effect -- the sites it placed and how many moved,
 * and what it could not get an answer about. A dry run's counts are what was
 * due.
 */
export type Synced = {
	areas: number;
	changed: number;
	sites: number;
	moved: number;
	failed: { what: string; why: string }[];
};

/** Between one question to the authority and the next. */
const PAUSE_MS = 250;
const pause = () => new Promise((r) => setTimeout(r, PAUSE_MS));

/**
 * One pass: every area not confirmed on `today` (the business's), and every
 * site not placed since this quarter began -- or, `all`, every one. `dry`
 * says what is due and asks nothing.
 */
export async function syncTax(
	db: Kysely<DB>,
	today: string,
	{
		all = false,
		dry = false,
		fetcher = fetch
	}: { all?: boolean; dry?: boolean; fetcher?: typeof fetch } = {}
): Promise<Synced> {
	const out: Synced = { areas: 0, changed: 0, sites: 0, moved: 0, failed: [] };
	// CDTFA answers for California, so there is nothing to ask it unless the
	// business collects there.
	if (!(await collecting(db)).includes('CA')) return out;
	const areas = await db
		.selectFrom('tax_area')
		.select(['id', 'name', 'code'])
		.where('source', '=', 'cdtfa')
		.where('code', 'is not', null)
		.$narrowType<{ code: string }>()
		.$if(!all, (qb) => qb.where('confirmed_on', '<', today))
		.orderBy('name')
		.orderBy('id')
		.execute();
	// Each California site: it is CDTFA that places it.
	const sites = await db
		.selectFrom('site as s')
		.select(['s.id', 's.display', 's.street', 's.city', 's.postcode', 's.tax_area_id'])
		.where('s.active', '=', true)
		.where('s.region', '=', 'CA')
		.$if(!all, (qb) =>
			qb.where((eb) =>
				eb.or([
					eb('s.area_verified_on', 'is', null),
					eb('s.area_verified_on', '<', quarterBegan(today))
				])
			)
		)
		.orderBy('s.display')
		.orderBy('s.id')
		.execute();
	if (dry) return { ...out, areas: areas.length, sites: sites.length };

	for (const area of areas) {
		try {
			const rates = await ratesFor(area.code, fetcher);
			if (await db.transaction().execute((tx) => confirmCdtfaArea(tx, area, rates, today)))
				out.changed++;
			out.areas++;
		} catch (e) {
			if (!(e instanceof NoAnswer)) throw e;
			out.failed.push({ what: area.name, why: e.message });
		}
		await pause();
	}

	for (const site of sites) {
		try {
			const priced = await priceAddress(site, today, fetcher);
			const placed = await db.transaction().execute(async (tx) => {
				// The answer is true of its area whatever this site did
				// meanwhile; the site takes it only if it is still at the
				// address it was asked about. Moved since, it was placed then.
				const area = await recordCdtfaArea(tx, priced, today);
				const still = await tx
					.updateTable('site')
					.set({ tax_area_id: area, area_verified_on: today })
					.where('id', '=', site.id)
					.where('street', '=', site.street)
					.where('city', '=', site.city)
					.where('postcode', '=', site.postcode)
					.executeTakeFirst();
				if (!still.numUpdatedRows) return null;
				await placeSite(tx, { id: site.id, was: site.tax_area_id }, area, {
					way: 'asked',
					by: null,
					note: 'asked on a refresh'
				});
				return { moved: area !== site.tax_area_id };
			});
			if (placed) out.sites++;
			if (placed?.moved) out.moved++;
		} catch (e) {
			if (!(e instanceof NoAnswer)) throw e;
			out.failed.push({ what: site.display ?? site.id, why: e.message });
		}
		await pause();
	}
	return out;
}

const HOUR = 60 * 60 * 1000;

/** The pass that is kept running, once the server has started it. */
let nudge: (() => void) | null = null;

/**
 * A pass now rather than on the hour, where the server is keeping rates in
 * sync: when the business begins collecting somewhere, its sites there are
 * placed at once. One already running is left to finish.
 */
export function syncTaxNow() {
	nudge?.();
}

/**
 * Keeps every rate in sync as the server starts and every hour after, one
 * pass at a time, on the business's day (`today`). The timer holds nothing
 * open, so a shutdown waits for none of it. Says what a pass did, and what it
 * could not get an answer about; a pass with nothing due says nothing.
 */
export function startSyncingTax(db: Kysely<DB>, today: () => Promise<string>) {
	let running = false;
	const run = async () => {
		if (running) return;
		running = true;
		try {
			const done = await syncTax(db, await today());
			if (done.areas || done.sites)
				log.info(
					{ ...done, failed: done.failed.length },
					`Tax rates kept in sync: areas confirmed ${done.areas}, changed ${done.changed}; ` +
						`sites placed ${done.sites}, moved ${done.moved}`
				);
			for (const f of done.failed)
				log.warn({ what: f.what }, `Tax rates not kept in sync for ${f.what}: ${f.why}`);
		} catch (e) {
			log.error({ err: e }, 'Keeping tax rates in sync failed');
		} finally {
			running = false;
		}
	};
	nudge = () => void run();
	void run();
	const timer = setInterval(() => void run(), HOUR);
	timer.unref();
	process.once('sveltekit:shutdown', () => clearInterval(timer));
}
