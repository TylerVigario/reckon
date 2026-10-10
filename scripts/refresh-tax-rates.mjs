#!/usr/bin/env node
/**
 * Ask CDTFA what each site pays, and write down the answer.
 *
 * Every rate in the system is CDTFA's answer for an address -- this script
 * re-asks for every site, and creating or moving a site asks for that one.
 * Nothing can author a rate by hand, which is the point: a locally held rate
 * goes stale without telling anybody, and is then charged at addresses it was
 * never true for.
 *
 *   node scripts/refresh-tax-rates.mjs [--all] [--dry-run]
 *
 * Two questions, because CDTFA answers them in two places. The rate API turns
 * an address into a rate and a tax area code; the published rate layer turns
 * that code into the state, county and city shares that make the total up. The
 * second is what lets a ledger post tax to the right obligation.
 *
 * By default it asks about sites whose rate is stale -- last checked over
 * STALE_AFTER_DAYS ago, the same rule the screens use. --all re-asks about
 * everything.
 *
 * It imports the app's own CDTFA client and decimals, which are TypeScript.
 * Node strips the types itself, and every import names its file, so they run
 * as they are.
 *
 * Scheduling belongs to the host, not here. Run it daily; the API is free and
 * needs no key. It makes one rate request per site and one rate-layer request
 * per tax area code.
 */
import pg from 'pg';
import { priceAddress, NoAnswer } from '../src/lib/server/cdtfa.ts';
import { Decimal } from '../src/lib/decimal.ts';
import { STALE_AFTER_DAYS } from '../src/lib/server/stale.ts';

const PAUSE_MS = 250;

const all = process.argv.includes('--all');
const dry = process.argv.includes('--dry-run');

// Same connection rule as the app: the unix socket peer-authenticates, and
// DATABASE_URL wins outright for a host that wants TCP.
const pool = process.env.DATABASE_URL
	? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, options: '-c TimeZone=UTC' })
	: new pg.Pool({
			host: process.env.PGHOST ?? '/var/run/postgresql',
			database: process.env.PGDATABASE ?? 'reckon_dev',
			max: 1,
			options: '-c TimeZone=UTC'
		});
const q = (/** @type {string} */ text, /** @type {unknown[]} */ values = []) =>
	pool.query(text, values).then((r) => r.rows);

// In UTC, like the app. This runs with nobody looking, so the day it stamps
// and judges staleness by is the business's own: the operator's zone, said
// outright, rather than whatever zone the host happens to keep.
const [{ today }] = await q(
	`select (now() at time zone coalesce((select timezone from operator limit 1), 'UTC'))::date::text
	          as today`
);

// The API wants street, city AND zip -- any one of them missing is a 400, not
// a best guess. The schema already requires all three; this checks anyway, and
// names a site it cannot ask about rather than skipping it quietly.
const answerable = `coalesce(s.street, '') <> '' and coalesce(s.city, '') <> ''
	and coalesce(s.postcode, '') <> ''`;

const sites = await q(
	`select s.id, s.display, s.street, s.city, s.region, s.postcode,
	        s.tax_area_code, s.tax_jurisdiction, s.tax_rate_pct, s.area_verified_on::text
	   from site s
	  where s.active
	    and ${answerable}
	    and ($1 or s.area_verified_on < $3::date - $2::int)
	  order by s.display`,
	[all, STALE_AFTER_DAYS, today]
);

const unanswerable = await q(
	`select s.display, e.name as client,
	        concat_ws(' and ',
	          nullif(case when coalesce(s.street, '') = '' then 'a street' end, ''),
	          nullif(case when coalesce(s.city, '') = '' then 'a city' end, ''),
	          nullif(case when coalesce(s.postcode, '') = '' then 'a postcode' end, '')
	        ) as missing
	   from site s join entity e on e.id = s.entity_id
	  where s.active and not (${answerable})
	  order by e.name, s.display`
);

if (sites.length === 0 && unanswerable.length === 0) {
	console.log('Nothing to check.');
	await pool.end();
	process.exit(0);
}

let changed = 0;
let failed = 0;
const pct = (/** @type {string} */ x) => Decimal.from(x).toFixed(3);
// What this run learns about each tax area, so it asks once per area. Made per
// run and gone with it: a split kept longer could outlive the quarter it was
// true for.
/** @type {import('../src/lib/server/cdtfa.ts').Splits} */
const splits = new Map();

for (const s of sites) {
	let answer;
	try {
		answer = await priceAddress(s, fetch, splits);
	} catch (e) {
		console.error(`  ✗ ${s.display}: ${e instanceof NoAnswer ? e.message : String(e)}`);
		failed++;
		continue;
	}

	const moved = !Decimal.from(s.tax_rate_pct).eq(answer.rate) || s.tax_area_code !== answer.tac;
	if (moved) changed++;

	const mark = moved ? '→   ' : '=   ';
	const was = moved ? ` (was ${pct(s.tax_rate_pct)}%)` : '';
	const parts =
		`state ${pct(answer.state)}` +
		(Decimal.from(answer.district).isZero() ? '' : ` + district ${pct(answer.district)}`);
	console.log(
		`  ${mark}${s.display}: ${pct(answer.rate)}% ${answer.jurisdiction}${was}\n` + `      ${parts}`
	);

	if (!dry) {
		const client = await pool.connect();
		try {
			await client.query('begin');
			await client.query(
				`insert into site_tax_check (site_id, tax_area_code, tax_jurisdiction, rate_pct,
				                             state_rate_pct, district_rate_pct, changed)
				 values ($1, $2, $3, $4, $5, $6, $7)`,
				[s.id, answer.tac, answer.jurisdiction, answer.rate, answer.state, answer.district, moved]
			);
			// The date moves whether or not the rate did: "confirmed today" is
			// the fact the screens need, and it is not the same as "unchanged
			// since somebody looked in March".
			await client.query(
				`update site
				    set tax_rate_pct = $2, state_rate_pct = $3, district_rate_pct = $4,
				        tax_jurisdiction = $5, tax_area_code = $6, area_verified_on = $7::date
				  where id = $1`,
				[s.id, answer.rate, answer.state, answer.district, answer.jurisdiction, answer.tac, today]
			);
			await client.query('commit');
		} catch (e) {
			await client.query('rollback');
			throw e;
		} finally {
			client.release();
		}
	}

	await new Promise((r) => setTimeout(r, PAUSE_MS));
}

if (unanswerable.length) {
	console.log('\nCannot be looked up at all:');
	for (const u of unanswerable) {
		console.log(`  ✗ ${u.client} · ${u.display}: needs ${u.missing}`);
	}
}

console.log(
	`\n${sites.length} asked · ${changed} moved · ${failed} could not be answered` +
		(unanswerable.length ? ` · ${unanswerable.length} missing an address` : '') +
		(dry ? ' · dry run, nothing written' : '')
);

await pool.end();
process.exit(failed > 0 || unanswerable.length > 0 ? 1 : 0);
