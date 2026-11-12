#!/usr/bin/env node
/**
 * Brings a database up to date before the server starts (#lib/server/db/migrate):
 * every migration in drizzle/ it has not seen, then a check that everything in
 * it belongs to its owner.
 *
 *   npm run db:migrate                in a clone
 *   node scripts/migrate.mjs          in a release, from its directory
 *
 * The database is the one the server would use, from the same settings
 * (#lib/server/db/defaults): .env in development, under whatever the shell
 * sets, or the host's own. DATABASE_URL wins outright; otherwise PGDATABASE,
 * which must be set, at PGHOST, where libpq looks on this platform when that is
 * unset.
 *
 * Migrating is the owner's: whoever owns the database owns everything a
 * migration makes. Run by a role that may become the owner -- postgres, say --
 * this acts as the owner. Run by one that may not -- the server's, where it
 * owns nothing -- it stops before anything is applied.
 *
 * The server only checks, and will not start while a migration is waiting, so
 * this is the step before each start (MIGRATE_ON_START=true has the server do
 * it instead, connected as the owner). Where the server's role owns nothing,
 * run this as the owner's: on a host, a system user of its own, whom the unix
 * socket signs in as that role (README, "The database").
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
let name, owner, role, may;
try {
	await probe.connect();
	({
		rows: [{ name, owner, role, may }]
	} = await probe.query(
		`select current_database() as name, pg_get_userbyid(datdba) as owner,
		        current_user as role, pg_has_role(current_user, datdba, 'SET') as may
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
// The server's role, where it owns nothing, is told so before anything is tried.
if (!may) {
	console.error(
		`${name} was not brought up to date: ${role} may not act as its owner, ${owner}, and migrating is the owner's. ` +
			`Run this as ${owner}, or as a role that may become it.`
	);
	process.exit(1);
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
