// Bringing a database up to date: every migration it has not seen, then a check
// that everything in it belongs to its owner. And, for the server, checking that
// it is.
//
// Plain TypeScript over pg and Kysely, with nothing of SvelteKit's, so the
// commands in scripts/ can run it under Node as well as the server.
import { Kysely, PostgresDialect } from 'kysely';
import { Migrator, type MigrationProvider } from 'kysely/migration';
import type pg from 'pg';
import { MIGRATIONS } from './migrations/index.ts';

export { MIGRATIONS };

/** The schema Kysely keeps its record of migrations in, apart from the application's tables. */
export const RECORD_SCHEMA = 'kysely';
/** Kysely's own name for that record, which it creates. */
const RECORD_TABLE = 'kysely_migration';

/** Something in the database that another role owns, which the application cannot see. */
export class NotOwned extends Error {}

/** A role that may not do what the migrations do: only the database's owner migrates. */
export class CannotMigrate extends Error {}

/** A database behind the migrations in the build, which the server will not serve. */
export class Behind extends Error {}

/** A database that has run migrations the build does not have: a newer build's. */
export class Ahead extends Error {}

/** Postgres's code for a privilege the role does not have. */
const DENIED = '42501';
const codeOf = (e: unknown) => (e as { code?: string }).code;

/** Migrations from a list, rather than a folder: the build carries them. */
const listed = (migrations: typeof MIGRATIONS): MigrationProvider => ({
	getMigrations: async () => migrations
});

/**
 * Kysely over `pool`, for migrating. Never destroyed here: destroying it would
 * end the pool, which is the caller's.
 */
const over = (pool: pg.Pool) => new Kysely<any>({ dialect: new PostgresDialect({ pool }) });

/**
 * THE DATABASE IS UP TO DATE BEFORE ANYTHING IS SERVED (10 October 2026).
 * `node scripts/migrate.mjs`, or `npm run db:migrate` in a clone, runs this as
 * the database's owner (scripts/migrate.mjs); the server runs it in its init
 * hook (hooks.server.ts) only where MIGRATE_ON_START=true, connected as the
 * owner.
 *
 * Kysely's Migrator records each migration it applies in kysely.kysely_migration,
 * so a second run applies nothing, and holds a lock while it works, so two at
 * once run one after the other. EACH MIGRATION IS ITS OWN TRANSACTION, applied
 * one step at a time (migrateUp): a word added to one of the schema's types
 * "cannot be used until after the transaction has been committed" (PostgreSQL
 * 18, ALTER TYPE), so the migration that uses it must come after one that has.
 * One that fails is rolled back and stops there, those before it kept, and the
 * server does not start: it refuses a database behind its build
 * (mustBeUpToDate). A role that may not make or change what they do -- one
 * that owns nothing, say -- is told that migrating is the owner's, rather than
 * shown the first statement Postgres refused.
 *
 * Then every table, view and sequence in public and kysely must belong to the
 * role connected. An object made by another role is invisible to the
 * application, and that arrives as "permission denied" from whichever query
 * reaches it first -- a long way from the cause -- so it stops here instead.
 */
export async function bringUpToDate(pool: pg.Pool, migrations = MIGRATIONS): Promise<string> {
	const migrator = new Migrator({
		db: over(pool),
		provider: listed(migrations),
		migrationTableSchema: RECORD_SCHEMA
	});
	for (;;) {
		const { error, results = [] } = await migrator.migrateUp();
		if (error) {
			if (codeOf(error) !== DENIED) throw error;
			const {
				rows: [who]
			} = await pool.query<{ role: string; owner: string }>(
				`select current_user as role, pg_get_userbyid(datdba) as owner
				   from pg_database where datname = current_database()`
			);
			throw new CannotMigrate(
				`${who.role} may not do what the migrations do (${(error as Error).message}), so the migration was not applied. ` +
					(who.role === who.owner
						? `Something in the database belongs to another role: ALTER TABLE <name> OWNER TO ${who.owner};`
						: `Migrating is for the database's owner, ${who.owner}: run \`node scripts/migrate.mjs\` as ${who.owner}, ` +
							`or as a role that may become it. A server that connects as ${who.role} leaves MIGRATE_ON_START unset, and only checks.`)
			);
		}
		if (!results.length) break;
	}
	const {
		rows: [found]
	} = await pool.query<{ owner: string; stray: string | null }>(
		`
		select current_user as owner,
		       string_agg(c.relkind::text || ' ' || c.relname, ', ' order by c.relname)
		         filter (where pg_get_userbyid(c.relowner) <> current_user) as stray
		  from pg_class c join pg_namespace n on n.oid = c.relnamespace
		 where n.nspname in ('public', $1) and c.relkind in ('r', 'v', 'm', 'S')`,
		[RECORD_SCHEMA]
	);
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
 * start while one in its build is waiting, so nothing is served from a
 * database the code does not expect, here either; nor where the database has
 * run one its build does not have, a newer build's, whose schema this code
 * was not written for.
 */
export async function mustBeUpToDate(pool: pg.Pool, migrations = MIGRATIONS): Promise<void> {
	let applied: string[] = [];
	try {
		const { rows } = await pool.query<{ name: string }>(
			`select name from ${RECORD_SCHEMA}.${RECORD_TABLE}`
		);
		applied = rows.map((r) => r.name);
	} catch (e) {
		const code = codeOf(e);
		// No record at all: a database nothing has been applied to.
		if (code !== '42P01' && code !== '3F000') {
			if (code === DENIED)
				throw new Behind(
					`The server cannot read the record of migrations, ${RECORD_SCHEMA}.${RECORD_TABLE}, so cannot tell whether the database is up to date. ` +
						`Grant its role USAGE on the schema ${RECORD_SCHEMA} and SELECT on that table.`
				);
			throw e;
		}
	}
	const unknown = applied.filter((name) => !(name in migrations));
	if (unknown.length)
		throw new Ahead(
			`The database has run ${unknown.length === 1 ? 'a migration' : 'migrations'} this build does not have (${unknown.join(', ')}): ` +
				'it belongs to a newer release. Start that release, or restore the database from before it.'
		);
	const waiting = Object.keys(migrations).filter((name) => !applied.includes(name)).length;
	if (waiting)
		throw new Behind(
			`${waiting} ${waiting === 1 ? 'migration is' : 'migrations are'} waiting. ` +
				'Bring the database up to date as its owner -- `node scripts/migrate.mjs`, or `npm run db:migrate` in a clone -- then start the server. ' +
				'Or set MIGRATE_ON_START=true, and the server, connected as the owner, applies them as it starts.'
		);
}
