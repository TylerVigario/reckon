#!/usr/bin/env node
/**
 * Ask CDTFA what each site pays, and write down the answer.
 *
 * This is the only thing in the system that produces a tax rate. Nothing in
 * the app can author one, which is the point: a locally held rate goes stale
 * without telling anybody, and that is how every address ends up billed at the
 * operator's own rate.
 *
 *   node scripts/refresh-tax-rates.mjs [--all] [--dry-run]
 *
 * Two questions, because CDTFA answers them in two places. The rate API turns
 * an address into a rate and a tax area code; the published rate layer turns
 * that code into the state, county and city shares that make the total up. The
 * second is what lets a ledger post tax to the right obligation.
 *
 * By default it asks about sites that have never been checked or were last
 * checked over STALE_DAYS ago. --all re-asks about everything.
 *
 * Scheduling belongs to server-admin, not here. Run it daily; the API is free,
 * needs no key, and this makes one request per site.
 */
import postgres from 'postgres';
import { priceAddress, NoAnswer } from '../src/lib/server/cdtfa.js';

const STALE_DAYS = 90;
const PAUSE_MS = 250;

const all = process.argv.includes('--all');
const dry = process.argv.includes('--dry-run');

// Same connection rule as the app: the unix socket peer-authenticates, and
// DATABASE_URL wins outright for a host that wants TCP.
const sql = process.env.DATABASE_URL
	? postgres(process.env.DATABASE_URL, { onnotice: () => {} })
	: postgres({
			host: process.env.PGHOST ?? '/var/run/postgresql',
			database: process.env.PGDATABASE ?? 'reckon_dev',
			onnotice: () => {}
		});

// The API wants street, city AND zip -- any one of them missing is a 400, not
// a best guess. So a site short of one cannot be looked up at all, and that is
// reported by name rather than skipped: an address nobody can price is billed
// at no rate, which is the failure this whole thing exists to prevent.
const answerable = sql`
	coalesce(s.street, '') <> '' and coalesce(s.city, '') <> ''
	and coalesce(s.postcode, '') <> ''`;

const sites = await sql`
	select s.id, s.display, s.street, s.city, s.region, s.postcode,
	       s.tax_area_code, s.tax_jurisdiction, s.tax_rate_pct, s.area_verified_on
	  from site s
	 where s.active
	   and ${answerable}
	   and (${all}
	     or s.area_verified_on is null
	     or s.area_verified_on < current_date - ${STALE_DAYS}::int)
	 order by s.display`;

const unanswerable = await sql`
	select s.display, e.name as client,
	       concat_ws(' and ',
	         nullif(case when coalesce(s.street, '') = '' then 'a street' end, ''),
	         nullif(case when coalesce(s.city, '') = '' then 'a city' end, ''),
	         nullif(case when coalesce(s.postcode, '') = '' then 'a postcode' end, '')
	       ) as missing
	  from site s join entity e on e.id = s.entity_id
	 where s.active and not (${answerable})
	 order by e.name, s.display`;

if (sites.length === 0 && unanswerable.length === 0) {
	console.log('Nothing to check.');
	await sql.end();
	process.exit(0);
}

let changed = 0;
let failed = 0;

for (const s of sites) {
	let answer;
	try {
		answer = await priceAddress(s);
	} catch (e) {
		console.error(`  ✗ ${s.display}: ${e instanceof NoAnswer ? e.message : String(e)}`);
		failed++;
		continue;
	}
	const rate = answer.rate;
	const split = answer;

	const moved =
		s.tax_rate_pct === null ||
		Number(s.tax_rate_pct) !== Number(rate) ||
		s.tax_area_code !== answer.tac;

	if (moved) changed++;

	const mark = moved ? (s.tax_rate_pct === null ? 'new ' : '→   ') : '=   ';
	const was =
		s.tax_rate_pct !== null && moved ? ` (was ${Number(s.tax_rate_pct).toFixed(3)}%)` : '';
	const parts =
		`state ${Number(split.state).toFixed(3)}` +
		(Number(split.district) ? ` + district ${Number(split.district).toFixed(3)}` : '');
	console.log(
		`  ${mark}${s.display}: ${Number(rate).toFixed(3)}% ${answer.jurisdiction}${was}\n` +
			`      ${parts}`
	);

	if (!dry) {
		await sql.begin(async (tx) => {
			await tx`
				insert into site_tax_check (site_id, tax_area_code, tax_jurisdiction, rate_pct,
				                            state_rate_pct, district_rate_pct, changed)
				values (${s.id}, ${answer.tac}, ${answer.jurisdiction}, ${rate},
				        ${split.state}, ${split.district}, ${moved})`;
			// The date moves whether or not the rate did: "confirmed today" is
			// the fact the screens need, and it is not the same as "unchanged
			// since somebody looked in March".
			await tx`
				update site
				   set tax_rate_pct = ${rate},
				       state_rate_pct = ${split.state},
				       district_rate_pct = ${split.district},
				       tax_jurisdiction = ${answer.jurisdiction},
				       tax_area_code = ${answer.tac},
				       area_verified_on = current_date
				 where id = ${s.id}`;
		});
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

await sql.end();
process.exit(failed > 0 || unanswerable.length > 0 ? 1 : 0);
