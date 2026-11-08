#!/usr/bin/env node
/**
 * Fills a database with the invented business the checks run against
 * (src/lib/server/db/seed/demo.sql). Seed one that is up to date and empty.
 *
 *   npm run db:seed
 *
 * The database is the one the server would use, from the same settings, as
 * db:migrate's is (#lib/server/db/defaults). Needs psql, since the seed is a
 * psql script.
 */
// First, so .env is read before anything reads what it sets.
import { database } from './env.mjs';
import { spawnSync } from 'node:child_process';

const SEED = 'src/lib/server/db/seed/demo.sql';

if (process.argv.length > 2) {
	console.error(
		'db:seed takes no database: it seeds the one PGDATABASE or DATABASE_URL names, ' +
			'as the server would use.'
	);
	process.exit(2);
}
const where = database();

// psql reads libpq's own settings, so it is handed these as the server reads
// them: DATABASE_URL as its database, or PGDATABASE at PGHOST. PGUSER and the
// rest it reads from the environment, .env's among them.
const run = spawnSync(
	'psql',
	[
		'-q',
		'-v',
		'ON_ERROR_STOP=1',
		...(where.connectionString ? ['-d', where.connectionString] : []),
		'-f',
		SEED
	],
	{
		stdio: 'inherit',
		env: where.connectionString
			? process.env
			: { ...process.env, PGHOST: where.host, PGDATABASE: where.database }
	}
);
if (run.error) throw run.error;
process.exit(run.status ?? 1);
