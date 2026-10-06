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
//
// IN UTC, ALWAYS. Every connection is opened with TimeZone=UTC, as a startup
// parameter, so the host's default -- which may be anywhere -- changes
// nothing. Moments are timestamptz; turning one into a local day or time is
// done in SQL, in a zone named outright (#lib/server/calendar), never by the
// connection.
const UTC = '-c TimeZone=UTC';
const pool = DATABASE_URL
	? new pg.Pool({ connectionString: DATABASE_URL, options: UTC })
	: new pg.Pool({ host: PGHOST, database: PGDATABASE, options: UTC });

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
export async function asUser<T>(
	userId: string,
	fn: (tx: Tx) => Promise<T>,
	/**
	 * When the change was made, where that was on a phone with no signal: the
	 * history keeps it beside when it arrived (0022). Only ever a moment the
	 * phone said; the server's own clock says when it arrived.
	 */
	madeAt?: string | null
): Promise<T> {
	return db.transaction(async (tx) => {
		await tx.execute(sql`select set_config('reckon.user_id', ${userId}, true)`);
		if (madeAt) await tx.execute(sql`select set_config('reckon.made_at', ${madeAt}, true)`);
		return fn(tx);
	});
}

export { schema };
