#!/usr/bin/env node
/**
 * Writes src/lib/server/db/database.ts: every table, column and type as the
 * migrations make them, for Kysely to check each query against. kysely-codegen
 * reads it from a scratch database brought up to date as the server would
 * (#lib/server/db/migrate) -- never from a database anyone has worked in,
 * which can hold what no migration made -- and the scratch database is
 * dropped.
 *
 *   npm run db:types              after writing a migration
 *   npm run db:drift              writes nothing: fails if database.ts is not
 *                                 what the migrations make
 *
 * How it types a column is .kysely-codegenrc.json's: a date as the string
 * Postgres writes, a NUMERIC as #lib/server/db/numeric's, an enum type as the
 * union of its words.
 *
 * Needs a role that may create a database. Connecting is libpq's business:
 * PGHOST, PGPORT, PGUSER, PGPASSWORD, from .env in development under whatever
 * the shell sets, with PGHOST where libpq looks on this platform when that is
 * unset (#lib/server/db/defaults). The database is its own, so PGDATABASE is
 * not read.
 */
// First, so .env is read before anything reads what it sets.
import './env.mjs';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { DEFAULT_PGHOST } from '../src/lib/server/db/defaults.js';
import { bringUpToDate } from '../src/lib/server/db/migrate.ts';

const SCRATCH = 'reckon_types';
const verify = process.argv.includes('--verify');
const host = process.env.PGHOST?.trim() || DEFAULT_PGHOST;

const cluster = new pg.Client({ host, database: 'postgres' });
await cluster.connect();
await cluster.query(`drop database if exists ${SCRATCH}`);
await cluster.query(`create database ${SCRATCH}`);

/** @type {number} */
let status;
try {
	const pool = new pg.Pool({ host, database: SCRATCH, max: 1 });
	try {
		await bringUpToDate(pool);
	} finally {
		await pool.end();
	}
	// A socket is a directory, which a URL names as ?host=.
	const url = host.startsWith('/')
		? `postgres:///${SCRATCH}?host=${encodeURIComponent(host)}`
		: `postgres://${host}/${SCRATCH}`;
	const run = spawnSync(
		'npx',
		[
			'--no-install',
			'kysely-codegen',
			'--config-file',
			'.kysely-codegenrc.json',
			'--url',
			url,
			...(verify ? ['--verify'] : [])
		],
		{ encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] }
	);
	if (run.error) throw run.error;
	status = run.status ?? 1;
	if (status && verify)
		console.error('\ndatabase.ts is not what the migrations make. Regenerate it: npm run db:types');
} finally {
	await cluster.query(`drop database if exists ${SCRATCH}`);
	await cluster.end();
}
process.exit(status);
