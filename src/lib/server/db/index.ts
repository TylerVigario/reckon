// One connection pool for the app, and Kysely over it.
//
// Money never passes through a JS number: NUMERIC arrives as a string and is
// worked with through #lib/decimal. A calendar date arrives as the string
// Postgres writes, never as a JS Date -- a Date is a moment, and west of
// Greenwich it turns 2026-03-14 into the 13th. database.ts, generated from the
// database the migrations build (`npm run db:types`), types every column as
// it arrives, and Kysely checks every query against it.
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import { building } from '$app/env';
import { DATABASE_URL, PGDATABASE, PGHOST, PGPASSWORD, PGPORT, PGUSER } from '$app/env/private';
import type { DB } from './database.ts';
import { connectionFrom, NO_DATABASE } from './defaults.js';

// DATE as text, for a date computed in SQL as much as a column: pg would
// otherwise make it a Date.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

// The database PGDATABASE names, at PGHOST or where libpq looks on this
// platform (./defaults.js), and DATABASE_URL wins outright -- so a host that
// wants TCP, another machine or a managed service says so without editing
// this. A socket can be named in the URL too, as ?host=. With neither, the
// server stops as it starts: which database is the business's is never
// assumed. A build reaches no database, so names none.
//
// IN UTC, ALWAYS. Every connection is opened with TimeZone=UTC, as a startup
// parameter, so the host's default -- which may be anywhere -- changes
// nothing. Moments are timestamptz; turning one into a local day or time is
// done in SQL, in a zone named outright (#lib/server/calendar), never by the
// connection.
const UTC = '-c TimeZone=UTC';
const where = connectionFrom({ DATABASE_URL, PGDATABASE, PGHOST, PGPASSWORD, PGPORT, PGUSER });
if (!where && !building) throw new Error(NO_DATABASE);
export const pool = new pg.Pool({ ...where, options: UTC });

// Rows come back with the columns' own names, as the pages, the field
// registries and the API speak them; code that works in camelCase names its
// columns so in the select (`te.worked_on as workedOn`), and Kysely types the
// alias. Inside sql``, a column is written ${eb.ref('te.worked_on')}, which
// Kysely checks against the query; a name typed into the template is not
// checked by anything.
export const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

export type Db = Kysely<DB>;
export type Tx = Transaction<DB>;
/** Either: a transaction is a Kysely too, so a function that reads can run inside one or outside. */
export type Reader = Kysely<DB>;

/**
 * Puts the rest of transaction `tx`'s changes in record_history against
 * `userId`: for a change someone makes without being signed in, with a link
 * that names them.
 */
export const actingAs = (tx: Tx, userId: string) =>
	sql`select set_config('reckon.user_id', ${userId}, true)`.execute(tx);

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
	return db.transaction().execute(async (tx) => {
		await actingAs(tx, userId);
		if (madeAt) await sql`select set_config('reckon.made_at', ${madeAt}, true)`.execute(tx);
		return fn(tx);
	});
}
