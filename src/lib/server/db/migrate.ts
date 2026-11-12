// Bringing a database up to date: every migration it has not seen, then a check
// that everything in it belongs to its owner. And, for the server, checking that
// it is.
//
// Plain TypeScript over pg and Drizzle, with nothing of SvelteKit's, so the
// commands in scripts/ can run it under Node as well as the server.
import { drizzle } from 'drizzle-orm/node-postgres';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';

/** Where the migrations are, from the repository's root or a release's: Drizzle's own folder. */
export const MIGRATIONS = 'drizzle';

/** Something in the database that another role owns, which the application cannot see. */
export class NotOwned extends Error {}

/** A role that may not do what the migrations do: only the database's owner migrates. */
export class CannotMigrate extends Error {}

/** A database behind the migrations beside the build, which the server will not serve. */
export class Behind extends Error {}

/** Postgres's code for a privilege the role does not have, whether Drizzle wrapped the error or not. */
const DENIED = '42501';
const codeOf = (e: unknown) =>
	(e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
const reasonOf = (e: unknown) =>
	(e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message;

/**
 * THE DATABASE IS UP TO DATE BEFORE ANYTHING IS SERVED (10 October 2026).
 * `node scripts/migrate.mjs`, or `npm run db:migrate` in a clone, runs this as
 * the database's owner (scripts/migrate.mjs); the server runs it in its init
 * hook (hooks.server.ts) only where MIGRATE_ON_START=true, connected as the
 * owner. Either way from the drizzle/ beside it.
 *
 * Drizzle records each migration it applies in drizzle.__drizzle_migrations, so
 * a second run applies nothing. Those waiting are applied in one transaction, so
 * one that fails leaves the database as it was, and the server does not start.
 * A role that may not make or change what they do -- one that owns nothing,
 * say -- is told that migrating is the owner's, rather than shown the first
 * statement Postgres refused.
 *
 * Then every table, view and sequence in public and drizzle must belong to the
 * role connected. An object made by another role is invisible to the
 * application, and that arrives as "permission denied" from whichever query
 * reaches it first -- a long way from the cause -- so it stops here instead.
 */
export async function bringUpToDate(pool: pg.Pool, migrationsFolder = MIGRATIONS): Promise<string> {
	try {
		await migrate(drizzle(pool), { migrationsFolder });
	} catch (e) {
		if (codeOf(e) !== DENIED) throw e;
		const {
			rows: [who]
		} = await pool.query<{ role: string; owner: string }>(
			`select current_user as role, pg_get_userbyid(datdba) as owner
			   from pg_database where datname = current_database()`
		);
		throw new CannotMigrate(
			`${who.role} may not do what the migrations do (${reasonOf(e)}), so none was applied. ` +
				(who.role === who.owner
					? `Something in the database belongs to another role: ALTER TABLE <name> OWNER TO ${who.owner};`
					: `Migrating is for the database's owner, ${who.owner}: run \`node scripts/migrate.mjs\` as ${who.owner}, ` +
						`or as a role that may become it. A server that connects as ${who.role} leaves MIGRATE_ON_START unset, and only checks.`)
		);
	}
	const {
		rows: [found]
	} = await pool.query<{ owner: string; stray: string | null }>(`
		select current_user as owner,
		       string_agg(c.relkind::text || ' ' || c.relname, ', ' order by c.relname)
		         filter (where pg_get_userbyid(c.relowner) <> current_user) as stray
		  from pg_class c join pg_namespace n on n.oid = c.relnamespace
		 where n.nspname in ('public', 'drizzle') and c.relkind in ('r', 'v', 'm', 'S')`);
	if (found.stray)
		throw new NotOwned(
			`Not owned by ${found.owner}, so invisible to the application: ${found.stray}. ` +
				`They were made by another role: ALTER TABLE <name> OWNER TO ${found.owner};`
		);
	return found.owner;
}

/**
 * THE SERVER ONLY CHECKS (12 November 2026), unless MIGRATE_ON_START=true:
 * migrating is its own step, run as the database's owner before each start --
 * `node scripts/migrate.mjs` -- so the server can connect as a role that owns
 * nothing, granted rows and reading the record of migrations. It will not
 * start while one beside its build is waiting, so nothing is served from a
 * database the code does not expect, here either.
 *
 * Waiting is what Drizzle's migrator would apply: each migration newer than
 * the newest recorded (drizzle-orm's pg dialect, migrate()), read from the
 * same journal by its own reader.
 */
export async function mustBeUpToDate(pool: pg.Pool, migrationsFolder = MIGRATIONS): Promise<void> {
	const migrations = readMigrationFiles({ migrationsFolder });
	let newest: number | null = null;
	try {
		const { rows } = await pool.query<{ created_at: string | null }>(
			'select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1'
		);
		newest = rows[0]?.created_at == null ? null : Number(rows[0].created_at);
	} catch (e) {
		const code = (e as { code?: string }).code;
		// No record at all: a database nothing has been applied to.
		if (code !== '42P01' && code !== '3F000') {
			if (code === DENIED)
				throw new Behind(
					'The server cannot read the record of migrations, drizzle.__drizzle_migrations, so cannot tell whether the database is up to date. ' +
						'Grant its role USAGE on the schema drizzle and SELECT on that table.'
				);
			throw e;
		}
	}
	const waiting = migrations.filter((m) => newest === null || newest < m.folderMillis).length;
	if (waiting)
		throw new Behind(
			`${waiting} ${waiting === 1 ? 'migration is' : 'migrations are'} waiting. ` +
				'Bring the database up to date as its owner -- `node scripts/migrate.mjs`, or `npm run db:migrate` in a clone -- then start the server. ' +
				'Or set MIGRATE_ON_START=true, and the server, connected as the owner, applies them as it starts.'
		);
}
