#!/usr/bin/env node
/**
 * Keep every tax rate in sync now, rather than when the server next does.
 *
 *   node scripts/refresh-tax-rates.mjs [--all] [--dry-run]
 *
 * The server does this on its own, as it starts and every hour after
 * (#lib/server/tax-sync): each tax area is asked about once a day, by its
 * code, and each site's address once a quarter. This runs one pass of the same
 * job: the areas not confirmed today and the sites not placed since this
 * quarter began. --all asks about every one; --dry-run says how many are due
 * and asks nothing.
 *
 * It imports the app's own modules, which are TypeScript. Node strips the
 * types itself, and every import names its file, so they run as they are.
 */
// First, so .env is read before anything reads what it sets.
import { database } from './env.mjs';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { syncTax } from '../src/lib/server/tax-sync.ts';

const all = process.argv.includes('--all');
const dry = process.argv.includes('--dry-run');

// The database the server uses, found the way the server finds it
// (#lib/server/db/defaults), in UTC like the server.
const pool = new pg.Pool({ ...database(), max: 1, options: '-c TimeZone=UTC' });
/** @type {Kysely<import('../src/lib/server/db/database.ts').DB>} */
const db = new Kysely({ dialect: new PostgresDialect({ pool }) });

// The business's day, as the server's (#lib/server/calendar): the operator's
// zone, said outright, rather than whatever zone the host keeps.
const { rows } = await pool.query(
	`select (now() at time zone coalesce((select timezone from operator limit 1), 'UTC'))::date::text
	          as today`
);
const today = /** @type {string} */ (rows[0].today);

const done = await syncTax(db, today, { all, dry });
for (const f of done.failed) console.error(`  ✗ ${f.what}: ${f.why}`);
console.log(
	dry
		? `areas due ${done.areas} · sites due ${done.sites} · dry run, nothing asked`
		: `areas confirmed ${done.areas}, changed ${done.changed} · ` +
				`sites placed ${done.sites}, moved ${done.moved} · ` +
				`could not be answered ${done.failed.length}`
);

await db.destroy();
process.exit(done.failed.length > 0 ? 1 : 0);
