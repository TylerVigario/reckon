// One connection pool for the app. Money never leaves Postgres as a float:
// postgres.js hands NUMERIC back as a string, and it stays a string until it
// reaches a Decimal type or the page.
import postgres from 'postgres';
import { env } from '$env/dynamic/private';

// NUMERIC as text, always. Parsing it into a JS number is how cents go
// missing, and this system's whole history is cent-level correctness.
const options = {
	types: {
		numeric: { to: 1700, from: [1700], serialize: String, parse: String }
	}
}; // inferred: the generic on Options<> IS this map, so annotating it erases it

// A unix socket by default, which is where most Linux packages put one and
// which peer-authenticates rather than asking for a password. PGHOST moves it,
// and DATABASE_URL wins outright -- so a host that wants TCP, another machine,
// or a managed service says so without editing this.
//
// Two calls rather than one with a spread argument: postgres() is overloaded on
// its first parameter, and a spread of a union picks neither overload.
export const sql = env.DATABASE_URL
	? postgres(env.DATABASE_URL, options)
	: postgres({
			host: env.PGHOST ?? '/var/run/postgresql',
			database: env.PGDATABASE ?? 'reckon_dev',
			...options
		});

/**
 * Select a DATE as `col::text`, never bare.
 *
 * postgres.js parses OID 1082 into a JS Date at UTC midnight, so west of
 * Greenwich a 2026-09-09 entry renders as Sep 08 -- an off-by-one day, not a
 * formatting nuisance. Overriding the parser does not work: neither a `types`
 * entry keyed `date`, nor one under another name, nor a raw `parsers[1082]`
 * is honoured, all three verified against this driver. Casting in SQL is the
 * mechanism that does work, and it says what it means: a calendar date has no
 * time of day and no zone.
 */

/** Attribute every write in a transaction, so record_history can name who. */
export async function asUser<T>(userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>) {
	return sql.begin(async (tx) => {
		await tx`select set_config('reckon.user_id', ${userId}, true)`;
		return fn(tx);
	});
}
