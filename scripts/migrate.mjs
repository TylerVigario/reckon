#!/usr/bin/env node
/**
 * Brings a database up to date, as the server does when it starts
 * (#lib/server/db/migrate): every migration in drizzle/ it has not seen, then a
 * check that the application can see everything in it.
 *
 *   npm run db:migrate
 *
 * The database is the one the server would use, connected to as the server
 * connects, from the same settings (#lib/server/db/defaults): .env in
 * development, under whatever the shell sets, or the host's own. DATABASE_URL
 * wins outright; otherwise PGDATABASE, which must be set, at PGHOST, where libpq
 * looks on this platform when that is unset.
 *
 * Whoever owns the database owns everything a migration makes, since the owner
 * is who the application connects as. Run by another role -- postgres, say --
 * this acts as the owner.
 */
// First, so .env is read before anything reads what it sets.
import { database } from './env.mjs';
import pg from 'pg';
import { bringUpToDate } from '../src/lib/server/db/migrate.ts';

if (process.argv.length > 2) {
	console.error(
		'db:migrate takes no database: it brings up to date the one PGDATABASE or DATABASE_URL ' +
			'names, as the server would use.'
	);
	process.exit(2);
}
const where = database();

const probe = new pg.Client(where);
let name, owner;
try {
	await probe.connect();
	({
		rows: [{ name, owner }]
	} = await probe.query(
		`select current_database() as name, pg_get_userbyid(datdba) as owner
		   from pg_database where datname = current_database()`
	));
} catch (e) {
	// Not the URL itself, which can carry a password.
	const which = where.database ?? 'the database DATABASE_URL names';
	console.error(`cannot reach ${which}: ${/** @type {Error} */ (e).message}`);
	process.exit(1);
} finally {
	await probe.end().catch(() => {});
}

// Connection options split on spaces, so a space or backslash in the role name
// is escaped with a backslash, which is how libpq reads them.
const pool = new pg.Pool({
	...where,
	max: 1,
	options: `-c role=${owner.replace(/[\\ ]/g, '\\$&')}`
});
try {
	const as = await bringUpToDate(pool);
	console.log(`${name} is up to date, and everything in it belongs to ${as}.`);
} catch (e) {
	const err = /** @type {{ cause?: { message?: string }, message?: string }} */ (e);
	console.error(`${name} was not brought up to date: ${err.cause?.message ?? err.message}`);
	process.exitCode = 1;
} finally {
	await pool.end();
}
