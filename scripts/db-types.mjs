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
 * Both also check the schema documentation, docs/schema/regenerate.py, which
 * is written by hand: every table and column it describes has to be one the
 * migrations make, and every one they make described, with its type -- or,
 * for one of the schema's types, that type's name or its words, in order. It
 * cannot be generated, since what it says of each is the point of it, so it
 * is checked, and fails with what disagrees.
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
	let described;
	try {
		await bringUpToDate(pool);
		described = await disagreements(pool);
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
	if (described.length) {
		console.error(
			'\nThe schema documentation, docs/schema/regenerate.py, is not what the migrations make:'
		);
		for (const d of described) console.error(`  ${d}`);
		status = 1;
	}
} finally {
	await cluster.query(`drop database if exists ${SCRATCH}`);
	await cluster.end();
}
process.exit(status);

/**
 * Where docs/schema/regenerate.py and the database the migrations built
 * disagree: a table or a column on one side only, or a column's type.
 *
 * @param {pg.Pool} pool
 * @returns {Promise<string[]>}
 */
async function disagreements(pool) {
	const run = spawnSync('python3', ['docs/schema/regenerate.py', '--tables'], {
		encoding: 'utf8'
	});
	if (run.error) throw run.error;
	if (run.status) throw new Error(`docs/schema/regenerate.py --tables: ${run.stderr}`);
	/** @type {Record<string, [string, string, string][]>} */
	const docs = JSON.parse(run.stdout);

	const { rows: columns } = await pool.query(`
		select table_name, column_name, data_type, udt_name
		  from information_schema.columns
		 where table_schema = 'public'`);
	const { rows: types } = await pool.query(`
		select t.typname as name, array_agg(e.enumlabel::text order by e.enumsortorder) as words
		  from pg_enum e join pg_type t on t.oid = e.enumtypid
		 group by t.typname`);
	const words = new Map(types.map((t) => [t.name, /** @type {string[]} */ (t.words)]));
	// How the documentation writes a type: Postgres's own short names.
	/** @type {Record<string, string>} */
	const SHORT = {
		integer: 'int',
		boolean: 'bool',
		'timestamp with time zone': 'timestamptz'
	};

	const out = [];
	const made = new Map();
	for (const c of columns) {
		if (!made.has(c.table_name)) made.set(c.table_name, new Map());
		made.get(c.table_name).set(c.column_name, c);
	}
	for (const table of Object.keys(docs).filter((t) => !made.has(t)))
		out.push(`${table}: described, and no migration makes it`);
	for (const table of [...made.keys()].filter((t) => !(t in docs)))
		out.push(`${table}: made, and not described`);
	for (const [table, rows] of Object.entries(docs)) {
		const cols = made.get(table);
		if (!cols) continue;
		const named = new Set(rows.map(([, name]) => name));
		for (const name of [...cols.keys()].filter((n) => !named.has(n)))
			out.push(`${table}.${name}: made, and not described`);
		for (const [, name, what] of rows) {
			const c = cols.get(name);
			if (!c) {
				out.push(`${table}.${name}: described, and no migration makes it`);
				continue;
			}
			// What it is comes first, before any note: "uuid · one client".
			const said = what.split(' · ')[0].trim();
			const list = words.get(c.udt_name);
			if (list) {
				const saidWords = said.split('|').map((w) => w.trim());
				if (said !== c.udt_name && saidWords.join('|') !== list.join('|'))
					out.push(
						`${table}.${name}: is a ${c.udt_name}, said as '${said}': its name or ${list.join('|')}`
					);
				continue;
			}
			const type = SHORT[c.data_type] ?? c.data_type;
			// A whole number may be said as the range its check allows: 1–12.
			const range = /^\d+–\d+$/.test(said) && ['int', 'smallint', 'bigint'].includes(type);
			if (said !== type && !range) out.push(`${table}.${name}: is ${type}, said as '${said}'`);
		}
	}
	return out;
}
