#!/usr/bin/env node
/**
 * Applies every migration a database has not seen, with Drizzle's migrator.
 *
 *   node scripts/migrate.mjs <database> <migrations folder> [owner]
 *
 * db/apply.sh is what a person or a service runs; this is the part of it that
 * needs Node. Drizzle records what it applied in drizzle.__drizzle_migrations,
 * so running it twice applies nothing the second time.
 *
 * Connecting is libpq's business, as everywhere else: PGHOST, PGPORT, PGUSER
 * and PGPASSWORD, with the unix socket where Linux packages put it when PGHOST
 * is unset. The database is named on the command line.
 *
 * OWNER: whoever owns the database owns everything a migration makes. Run as a
 * superuser, this sets its role to that owner first, so the application -- which
 * connects as the owner -- is never refused a table another role made.
 */
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const [, , database, migrationsFolder, owner] = process.argv;
if (!database || !migrationsFolder) {
	console.error('usage: node scripts/migrate.mjs <database> <migrations folder> [owner]');
	process.exit(1);
}

const pool = new pg.Pool({
	host: process.env.PGHOST ?? '/var/run/postgresql',
	database,
	max: 1,
	// Connection options split on spaces, so a space or backslash in the role
	// name is escaped with a backslash, which is how libpq reads them.
	...(owner ? { options: `-c role=${owner.replace(/[\\ ]/g, '\\$&')}` } : {})
});

try {
	await migrate(drizzle(pool), { migrationsFolder });
} catch (e) {
	const err = /** @type {{ cause?: { message?: string }, message?: string }} */ (e);
	console.error(`migration failed: ${err.cause?.message ?? err.message}`);
	process.exitCode = 1;
} finally {
	await pool.end();
}
