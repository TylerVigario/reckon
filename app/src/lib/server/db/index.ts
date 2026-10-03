// One connection pool for the app, and Drizzle over it.
//
// Money never passes through a JS number: NUMERIC arrives as a string and is
// worked with through #lib/decimal. A calendar date arrives as the string
// Postgres writes, never as a JS Date -- a Date is a moment, and west of
// Greenwich it turns 2026-03-14 into the 13th.
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { DATABASE_URL, PGDATABASE, PGHOST } from '$app/env/private';
import * as schema from './schema/index.ts';

// DATE as text, for raw queries too: the schema's date columns already say so,
// but a date computed in SQL would otherwise come back as a Date.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

// By default, the unix socket Linux packages usually create, which
// authenticates by user rather than by password (the defaults are in
// src/env.ts). PGHOST moves it, and DATABASE_URL wins outright -- so a host that
// wants TCP, another machine or a managed service says so without editing
// this. A socket can be named in the URL too, as ?host=.
const pool = DATABASE_URL
	? new pg.Pool({ connectionString: DATABASE_URL })
	: new pg.Pool({ host: PGHOST, database: PGDATABASE });

/**
 * THE BUSINESS'S CLOCK (#26).
 *
 * Every date this application treats as today is Postgres's current_date --
 * the day a form starts on, a month's edges, how long work has waited, whether
 * an invoice is overdue -- and every timestamp it writes out as a date or a
 * time goes through Postgres too. All of it follows the session's TimeZone,
 * which is the database server's own unless the session says otherwise. So
 * each connection is given the operator's time zone, and the database does
 * the calendar arithmetic in the business's zone, in one place.
 *
 * Set when a connection is handed out and does not have it yet: nothing on a
 * connection that already has it, and one statement on each after a change.
 * The pool announces a checkout before the caller has the connection, and a
 * connection runs its statements in the order they were made, so this always
 * runs first.
 *
 * Null until it is known. Before there is an operator, a connection keeps the
 * server's zone.
 */
let zone: string | null = null;
const zoneOf = new WeakMap<pg.PoolClient, string>();
pool.on('acquire', (client) => {
	if (zone === null || zoneOf.get(client) === zone) return;
	zoneOf.set(client, zone);
	client.query('select set_config($1, $2, false)', ['TimeZone', zone]).catch((e: unknown) => {
		zoneOf.delete(client);
		console.error('the business time zone could not be set on a connection', e);
	});
});

// `casing` must match drizzle.config.ts: it maps workedOn to worked_on, here at
// runtime and there in migrations.
//
// A raw sql`` query names the tables themselves -- ${t.entity}, ${t.entity.id}.
// An alias() interpolated there renders as its short name alone, "e", which
// names no table in a FROM; aliases belong to the query builder, which renders
// them whole.
//
// A correlated subquery inside a builder query is itself a builder query --
// db.select()... -- interpolated as sql`(${sub})`. Selecting from one table,
// Drizzle leaves column names unqualified, in sql`` fragments too, so a raw
// "(select count(*) from user where user.role_id = role.id)" there renders as
// "role_id" = "id", both the inner table's. A nested builder renders whole.
export const db = drizzle(pool, { schema, casing: 'snake_case' });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Either: a function that reads can run inside a transaction or outside one. */
export type Reader = Db | Tx;

/**
 * Runs `fn` in a transaction whose changes record_history puts against this
 * person, and rolls back everything if it throws.
 */
export async function asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
	return db.transaction(async (tx) => {
		await tx.execute(sql`select set_config('reckon.user_id', ${userId}, true)`);
		return fn(tx);
	});
}

/** From now on, every connection keeps this zone: the operator's, as just saved. */
export function useZone(next: string | null): void {
	zone = next;
}

let zoneLoaded = false;
/**
 * Reads the operator's time zone. When the server starts, and again on a later
 * request if the database could not be reached then.
 */
export async function loadZone(): Promise<void> {
	if (zoneLoaded) return;
	const [row] = await db.select({ zone: schema.operator.timezone }).from(schema.operator).limit(1);
	zone = row?.zone ?? null;
	zoneLoaded = true;
}

/** Today, by the business's calendar -- the one every stored date is compared with. */
export async function today(r: Reader = db): Promise<string> {
	const { rows } = await r.execute<{ today: string }>(sql`select current_date::text as today`);
	return rows[0].today;
}

export { schema };
