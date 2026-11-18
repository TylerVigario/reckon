#!/usr/bin/env node
/**
 * Proves the server keeps every tax rate as its authority says it
 * (#lib/server/tax-sync), against a stand-in for CDTFA.
 *
 *   PGDATABASE=reckon_empty node tests/tax-sync-check.mjs
 *
 * One client with two sites in two areas, one California site in none and
 * one in Oregon, and passes of the sync on successive days while the
 * stand-in's answers change: nothing asked before the business collects in
 * California, an area whose kept rate was dated wrongly, a site whose address
 * CDTFA now places elsewhere, a site in no area placed, the coming quarter's
 * rate published and then withdrawn, an area CDTFA does not answer about, and
 * a site whose address changed while it was being asked about. What it makes
 * it removes, before and after; it is meant for a database made for checks,
 * never one in use.
 */
// First, so .env is read before anything reads what it sets.
import { database } from '../scripts/env.mjs';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { syncTax } from '../src/lib/server/tax-sync.ts';
import { areaRate } from '../src/lib/server/tax-areas.ts';
import { lastConfirmed, rateIsStale } from '../src/lib/server/stale.ts';

const pool = new pg.Pool({ ...database(), max: 2, options: '-c TimeZone=UTC' });
/** @type {Kysely<import('../src/lib/server/db/database.ts').DB>} */
const db = new Kysely({ dialect: new PostgresDialect({ pool }) });

const CLIENT = '019a0fff-0000-7000-8000-000000000001';
const ONE = '019a0fff-0000-7000-8000-000000000011';
const TWO = '019a0fff-0000-7000-8000-000000000012';
const UNPLACED = '019a0fff-0000-7000-8000-000000000013';
const OREGON = '019a0fff-0000-7000-8000-000000000014';
const HERE = '019a0fff-0000-7000-8000-000000000021';
const CODES = ['TSYNC1', 'TSYNC2'];

// Whether the database collected in California before: if not, the check's
// registration there is its own, and goes with the rest.
const hadCalifornia = !!(await db
	.selectFrom('tax_registration')
	.select('state')
	.where('state', '=', 'CA')
	.executeTakeFirst());

async function clear() {
	await db.deleteFrom('site').where('entity_id', '=', CLIENT).execute();
	await db.deleteFrom('entity').where('id', '=', CLIENT).execute();
	await db.deleteFrom('tax_area').where('code', 'in', CODES).execute();
	if (!hadCalifornia) await db.deleteFrom('tax_registration').where('state', '=', 'CA').execute();
}

/** @type {string[]} */
const failures = [];
const expect = (/** @type {boolean} */ ok, /** @type {string} */ what) => {
	console.log(`  ${ok ? '✓' : '✗'} ${what}`);
	if (!ok) failures.push(what);
};

// THE STAND-IN. The rate layer by code, each a list of records; the rate API by
// street. Fractions, as CDTFA sends them.
/** @typedef {{ state: number; county: number; city: number; start: string; quarter: string }} Record */
/** @type {Map<string, Record[]>} */
const layer = new Map();
/** @type {Map<string, { tac: string; jurisdiction: string; rate: number }>} */
const places = new Map();
/** @type {Set<string>} */
const down = new Set();
/** Every street the rate API was asked about. */
/** @type {Set<string>} */
const asked = new Set();
/** Run once, when the rate API is next asked about a street. */
/** @type {Map<string, () => Promise<void>>} */
const meanwhile = new Map();
const pacificMidnight = (/** @type {string} */ day) => Date.parse(`${day}T08:00:00Z`);
const answer = (/** @type {unknown} */ body, ok = true) => ({
	ok,
	status: ok ? 200 : 503,
	json: () => Promise.resolve(body)
});
const fetcher = /** @type {typeof fetch} */ (
	/** @type {unknown} */ (
		async (/** @type {string} */ url) => {
			const u = new URL(url);
			if (u.hostname.includes('arcgis')) {
				const tac = /TAC_txt='([^']*)'/.exec(u.searchParams.get('where') ?? '')?.[1] ?? '';
				if (down.has(tac)) return answer({}, false);
				return answer({
					features: (layer.get(tac) ?? []).map((r) => ({
						attributes: {
							RATE: r.state + r.county + r.city,
							StateRate: r.state,
							CountyRate: r.county,
							CityRate: r.city,
							START_DATE: pacificMidnight(r.start),
							DateStamp: pacificMidnight(r.quarter)
						}
					}))
				});
			}
			const street = u.searchParams.get('address') ?? '';
			asked.add(street);
			await meanwhile.get(street)?.();
			meanwhile.delete(street);
			const p = places.get(street);
			return answer({
				taxRateInfo: p ? [p] : [],
				geocodeInfo: { confidence: 'High', matchCodes: ['Good'], formattedAddress: street }
			});
		}
	)
);

/** An area's sets, as "from: piece, piece". */
const setsOf = async (/** @type {string} */ code) =>
	(
		await sql`
			select p.effective_from::text || ': ' ||
			       string_agg(p.jurisdiction || ' ' || p.rate_pct::text, ' + '
			                  order by p.level, p.jurisdiction) as said
			  from tax_piece p join tax_area a on a.id = p.area_id
			 where a.code = ${code}
			 group by p.effective_from order by p.effective_from`.execute(db)
	).rows.map((r) => /** @type {{ said: string }} */ (r).said);
const area = (/** @type {string} */ code) =>
	db
		.selectFrom('tax_area')
		.select(['id', sql`confirmed_on::text`.$castTo().as('confirmed_on')])
		.where('code', '=', code)
		.executeTakeFirst();
const rateOn = async (/** @type {string} */ code, /** @type {string} */ day) =>
	(
		await db
			.selectFrom('tax_area as a')
			.select((eb) => areaRate(eb.ref('a.id'), day).as('rate'))
			.where('a.code', '=', code)
			.executeTakeFirstOrThrow()
	).rate;
const site = (/** @type {string} */ id) =>
	db
		.selectFrom('site as s')
		.innerJoin('tax_area as a', 'a.id', 's.tax_area_id')
		.select(['a.code', sql`s.area_verified_on::text`.$castTo().as('placed_on')])
		.where('s.id', '=', id)
		.executeTakeFirstOrThrow();

await clear();
try {
	await db
		.insertInto('entity')
		.values({ id: CLIENT, name: 'Sync Check', slug: 'sync-check' })
		.execute();
	await db
		.insertInto('tax_area')
		.values({
			id: HERE,
			state: 'CA',
			code: 'TSYNC1',
			name: 'SYNCVILLE',
			source: 'cdtfa',
			confirmed_on: '2026-04-01'
		})
		.execute();
	// Kept from the day it was first asked about, though CDTFA says it took
	// effect long before.
	await db
		.insertInto('tax_piece')
		.values([
			{
				area_id: HERE,
				level: 'state',
				jurisdiction: 'CALIFORNIA',
				rate_pct: '7.2500',
				effective_from: '2026-04-01'
			},
			{
				area_id: HERE,
				level: 'local',
				jurisdiction: 'SYNCVILLE',
				code: 'TSYNC1',
				rate_pct: '0.7500',
				effective_from: '2026-04-01'
			}
		])
		.execute();
	const made = (
		/** @type {string} */ id,
		/** @type {string} */ street,
		/** @type {string} */ on
	) => ({
		id,
		entity_id: CLIENT,
		label: street,
		slug: street.toLowerCase().replaceAll(' ', '-'),
		street,
		city: 'Syncville',
		region: 'CA',
		postcode: '95000',
		tax_area_id: HERE,
		area_verified_on: on
	});
	// One last placed before this quarter, one in it; and one in California
	// made while the business collected nowhere, and one in Oregon, in none.
	await db
		.insertInto('site')
		.values([
			made(ONE, '1 Sync St', '2026-04-01'),
			made(TWO, '2 Sync St', '2026-11-01'),
			{ ...made(UNPLACED, '4 Sync St', ''), tax_area_id: null, area_verified_on: null },
			{
				...made(OREGON, '5 Sync St', ''),
				city: 'Portland',
				region: 'OR',
				postcode: '97204',
				tax_area_id: null,
				area_verified_on: null
			}
		])
		.execute();

	layer.set('TSYNC1', [
		{ state: 0.0725, county: 0.005, city: 0.0025, start: '2005-01-01', quarter: '2026-10-01' }
	]);
	layer.set('TSYNC2', [
		{ state: 0.0725, county: 0, city: 0, start: '2005-01-01', quarter: '2026-10-01' }
	]);
	places.set('1 Sync St', { tac: 'TSYNC2', jurisdiction: 'ELSEWHERE', rate: 0.0725 });
	places.set('2 Sync St', { tac: 'TSYNC1', jurisdiction: 'SYNCVILLE', rate: 0.08 });
	places.set('4 Sync St', { tac: 'TSYNC1', jurisdiction: 'SYNCVILLE', rate: 0.08 });
	places.set('5 Sync St', { tac: 'TSYNC1', jurisdiction: 'SYNCVILLE', rate: 0.08 });

	console.log('17 November: before the business collects in California');
	if (hadCalifornia) await db.deleteFrom('tax_registration').where('state', '=', 'CA').execute();
	const none = await syncTax(db, '2026-11-17', { fetcher });
	expect(
		none.areas === 0 && none.sites === 0 && asked.size === 0,
		`nothing is asked (${JSON.stringify(none)})`
	);
	expect((await area('TSYNC1'))?.confirmed_on === '2026-04-01', 'and nothing is confirmed');
	await db.insertInto('tax_registration').values({ state: 'CA' }).execute();

	console.log('18 November: the first pass');
	const dry = await syncTax(db, '2026-11-18', { dry: true, fetcher });
	expect(
		dry.areas === 1 && dry.sites === 2,
		`a dry run says 1 area and 2 sites are due (${JSON.stringify(dry)})`
	);
	expect((await area('TSYNC1'))?.confirmed_on === '2026-04-01', 'and asks nothing');
	const first = await syncTax(db, '2026-11-18', { fetcher });
	expect(
		first.areas === 1 &&
			first.changed === 1 &&
			first.sites === 2 &&
			first.moved === 2 &&
			!first.failed.length,
		`1 area confirmed and changed, 2 sites placed and moved (${JSON.stringify(first)})`
	);
	const unplaced = await site(UNPLACED);
	expect(
		unplaced.code === 'TSYNC1' && unplaced.placed_on === '2026-11-18',
		`the California site in no area is placed in one (${JSON.stringify(unplaced)})`
	);
	const oregon = await db
		.selectFrom('site')
		.select('tax_area_id')
		.where('id', '=', OREGON)
		.executeTakeFirstOrThrow();
	expect(
		oregon.tax_area_id === null && !asked.has('5 Sync St'),
		'the Oregon site is not asked about, and stays in no area'
	);
	const sets = await setsOf('TSYNC1');
	expect(
		sets.length === 1 && sets[0] === '2005-01-01: CALIFORNIA 7.2500 + SYNCVILLE 0.7500',
		`the area's rate is dated the day CDTFA says it took effect (${sets.join('; ')})`
	);
	expect((await area('TSYNC1'))?.confirmed_on === '2026-11-18', 'and the area is confirmed today');
	const one = await site(ONE);
	expect(
		one.code === 'TSYNC2' && one.placed_on === '2026-11-18',
		`the site CDTFA places elsewhere is moved to that area (${JSON.stringify(one)})`
	);
	const placements = await db
		.selectFrom('site_placement')
		.select(['moved', 'note'])
		.where('site_id', '=', ONE)
		.execute();
	expect(
		placements.length === 1 && placements[0].moved,
		`and its placement says it moved (${JSON.stringify(placements)})`
	);
	expect(
		(await site(TWO)).placed_on === '2026-11-01',
		'a site placed this quarter is not asked about'
	);

	const again = await syncTax(db, '2026-11-18', { fetcher });
	expect(
		again.areas === 0 && again.sites === 0,
		`a second pass that day has nothing due (${JSON.stringify(again)})`
	);
	const ids = await db
		.selectFrom('tax_piece')
		.select('id')
		.where('area_id', '=', HERE)
		.orderBy('id')
		.execute();
	const all = await syncTax(db, '2026-11-18', { all: true, fetcher });
	const after = await db
		.selectFrom('tax_piece')
		.select('id')
		.where('area_id', '=', HERE)
		.orderBy('id')
		.execute();
	expect(
		all.changed === 0 && JSON.stringify(ids) === JSON.stringify(after),
		`asked about everything again, an unchanged answer writes nothing (${JSON.stringify(all)})`
	);

	console.log('19 November: the coming quarter is published');
	layer.get('TSYNC1')?.push({
		state: 0.0725,
		county: 0.005,
		city: 0.005,
		start: '2027-01-01',
		quarter: '2027-01-01'
	});
	const coming = await syncTax(db, '2026-11-19', { fetcher });
	expect(coming.changed === 1, `the area is changed (${JSON.stringify(coming)})`);
	expect(
		(await rateOn('TSYNC1', '2026-12-31')) === '8.0000' &&
			(await rateOn('TSYNC1', '2027-01-01')) === '8.2500',
		`it comes in on its day: ${await rateOn('TSYNC1', '2026-12-31')} on 31 December, ${await rateOn('TSYNC1', '2027-01-01')} on 1 January`
	);

	console.log('20 November: it is withdrawn');
	layer.set('TSYNC1', [
		{ state: 0.0725, county: 0.005, city: 0.0025, start: '2005-01-01', quarter: '2026-10-01' },
		{ state: 0.0725, county: 0.005, city: 0.0025, start: '2005-01-01', quarter: '2027-01-01' }
	]);
	await syncTax(db, '2026-11-20', { fetcher });
	const withdrawn = await setsOf('TSYNC1');
	expect(
		withdrawn.length === 1 && (await rateOn('TSYNC1', '2027-01-01')) === '8.0000',
		`the withdrawn rate is gone (${withdrawn.join('; ')})`
	);

	console.log('21 November: CDTFA does not answer about one area');
	down.add('TSYNC2');
	const half = await syncTax(db, '2026-11-21', { fetcher });
	expect(
		half.areas === 1 && half.failed.length === 1 && half.failed[0].what === 'ELSEWHERE',
		`the other is confirmed, and the one it could not ask about is named (${JSON.stringify(half)})`
	);
	expect(
		(await area('TSYNC2'))?.confirmed_on === '2026-11-20',
		'which keeps the day it was last confirmed'
	);
	const stale = async (/** @type {string} */ id, /** @type {string} */ today) =>
		(
			await db
				.selectFrom('site as s')
				.innerJoin('tax_area as a', 'a.id', 's.tax_area_id')
				.select((eb) =>
					rateIsStale(
						lastConfirmed(eb.ref('s.area_verified_on'), eb.ref('a.confirmed_on')),
						today
					).as('stale')
				)
				.where('s.id', '=', id)
				.executeTakeFirstOrThrow()
		).stale;
	expect(
		!(await stale(ONE, '2026-11-21')) && (await stale(ONE, '2027-01-02')),
		'its sites are not stale this quarter, and are on the next one until it answers'
	);
	down.clear();

	console.log('2 January: a site moves while it is being asked about');
	meanwhile.set('2 Sync St', async () => {
		await pool.query(`update site set street = '3 Sync St' where id = $1`, [TWO]);
	});
	const moving = await syncTax(db, '2027-01-02', { fetcher });
	const [one2, two2] = [await site(ONE), await site(TWO)];
	expect(
		moving.sites === 2 && one2.placed_on === '2027-01-02' && two2.placed_on === '2026-11-18',
		`only the sites still at their addresses are placed (${JSON.stringify(moving)}, ` +
			`${JSON.stringify(one2)}, ${JSON.stringify(two2)})`
	);
} finally {
	await clear();
	await db.destroy();
}

if (failures.length) process.exit(1);
console.log('\nThe sync keeps every rate as CDTFA says it.');
