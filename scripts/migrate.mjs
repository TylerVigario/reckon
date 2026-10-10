#!/usr/bin/env node
/**
 * Brings a database up to date, as the server does when it starts
 * (#lib/server/db/migrate): every migration in drizzle/ it has not seen, then a
 * check that the application can see everything in it.
 *
 *   npm run db:migrate -- <database>
 *
 * Connecting is libpq's business, as everywhere else: PGHOST, PGPORT, PGUSER and
 * PGPASSWORD, with the unix socket where Linux packages put it when PGHOST is
 * unset. The database is named on the command line, or by PGDATABASE.
 *
 * Whoever owns the database owns everything a migration makes, since the owner
 * is who the application connects as. Run by another role -- postgres, say --
 * this acts as the owner.
 */
import pg from 'pg';
import { bringUpToDate } from '../src/lib/server/db/migrate.ts';

const database = process.argv[2] ?? process.env.PGDATABASE;
if (!database) {
	console.error('usage: npm run db:migrate -- <database>');
	process.exit(2);
}
const host = process.env.PGHOST ?? '/var/run/postgresql';

const probe = new pg.Client({ host, database });
let owner;
try {
	await probe.connect();
	({
		rows: [{ owner }]
	} = await probe.query(
		`select pg_get_userbyid(datdba) as owner from pg_database where datname = current_database()`
	));
} catch (e) {
	console.error(`cannot reach ${database}: ${/** @type {Error} */ (e).message}`);
	process.exit(1);
} finally {
	await probe.end().catch(() => {});
}

// Connection options split on spaces, so a space or backslash in the role name
// is escaped with a backslash, which is how libpq reads them.
const pool = new pg.Pool({
	host,
	database,
	max: 1,
	options: `-c role=${owner.replace(/[\\ ]/g, '\\$&')}`
});
try {
	const as = await bringUpToDate(pool);
	console.log(`${database} is up to date, and everything in it belongs to ${as}.`);
} catch (e) {
	const err = /** @type {{ cause?: { message?: string }, message?: string }} */ (e);
	console.error(`${database} was not brought up to date: ${err.cause?.message ?? err.message}`);
	process.exitCode = 1;
} finally {
	await pool.end();
}
