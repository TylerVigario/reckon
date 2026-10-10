// Bringing a database up to date: every migration it has not seen, then a check
// that it can see everything it has.
//
// Plain TypeScript over pg and Drizzle, with nothing of SvelteKit's, so the
// commands in scripts/ can run it under Node as well as the server.
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';

/** Where the migrations are, from the repository's root or a release's: Drizzle's own folder. */
export const MIGRATIONS = 'drizzle';

/** Something in the database that another role owns, which the application cannot see. */
export class NotOwned extends Error {}

/**
 * THE DATABASE IS UP TO DATE BEFORE ANYTHING IS SERVED (10 October 2026). The
 * server runs this in its init hook (hooks.server.ts), from the drizzle/ beside
 * its build; `npm run db:migrate` runs it for a database named on the command
 * line (scripts/migrate.mjs).
 *
 * Drizzle records each migration it applies in drizzle.__drizzle_migrations, so
 * a second run applies nothing. Each is applied in a transaction, so one that
 * fails leaves the database as it was, and the server does not start.
 *
 * Then every table, view and sequence in public and drizzle must belong to the
 * role connected. An object made by another role is invisible to the
 * application, and that arrives as "permission denied" from whichever query
 * reaches it first -- a long way from the cause -- so it stops here instead.
 */
export async function bringUpToDate(pool: pg.Pool, migrationsFolder = MIGRATIONS): Promise<string> {
	await migrate(drizzle(pool), { migrationsFolder });
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
