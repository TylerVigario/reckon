#!/usr/bin/env node
/**
 * Proves the schema holds what it claims: a scratch database is brought up to
 * date as the server would (#lib/server/db/migrate), every guard in
 * tests/db/constraints.sql is run both ways -- what must be refused is, and the
 * ordinary case beside it still works -- and the database is dropped.
 *
 *   npm run db:test
 *
 * Needs psql, since the guard suite is a psql script, and a role that may create
 * a database. Connecting is libpq's business: PGHOST, PGPORT, PGUSER, PGPASSWORD,
 * from .env in development under whatever the shell sets, with PGHOST where
 * libpq looks on this platform when that is unset (#lib/server/db/defaults).
 * The database is its own, so PGDATABASE is not read.
 */
// First, so .env is read before anything reads what it sets.
import './env.mjs';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { DEFAULT_PGHOST } from '../src/lib/server/db/defaults.js';
import { bringUpToDate } from '../src/lib/server/db/migrate.ts';

const SCRATCH = 'reckon_guards';
const SUITE = 'tests/db/constraints.sql';
const host = process.env.PGHOST?.trim() || DEFAULT_PGHOST;

const cluster = new pg.Client({ host, database: 'postgres' });
await cluster.connect();
await cluster.query(`drop database if exists ${SCRATCH}`);
await cluster.query(`create database ${SCRATCH}`);
console.log(`scratch database: ${SCRATCH}`);

let failed = 0;
try {
	const pool = new pg.Pool({ host, database: SCRATCH, max: 1 });
	try {
		await bringUpToDate(pool);
	} finally {
		await pool.end();
	}

	// One stream, in order: a guard's NOTICE goes to stderr and its section's
	// heading to stdout, and the report reads only with both where they fell.
	const run = spawnSync(
		'sh',
		[
			'-c',
			'exec psql "$@" 2>&1',
			'psql',
			'-q',
			'-t',
			'-v',
			'ON_ERROR_STOP=1',
			'-d',
			SCRATCH,
			'-f',
			SUITE
		],
		{ encoding: 'utf8', env: { ...process.env, PGHOST: host } }
	);
	if (run.error) throw run.error;
	for (const line of run.stdout.split('\n'))
		if (/NOTICE|ERROR|DETAIL|HINT|CONTEXT|===|All guards/.test(line))
			console.log(line.replace(/^.*?NOTICE: {2}/, ''));
	if (run.status !== 0) {
		console.error(`\nA guard did not hold. Exit ${run.status}.`);
		failed = run.status ?? 1;
	} else console.log('\nSchema and guards verified, scratch database dropped.');
} catch (e) {
	const err = /** @type {{ cause?: { message?: string }, message?: string }} */ (e);
	console.error(
		`The scratch database was not brought up to date: ${err.cause?.message ?? err.message}`
	);
	failed = 1;
} finally {
	await cluster.query(`drop database if exists ${SCRATCH}`);
	await cluster.end();
}
process.exit(failed);
