/**
 * BRINGS A DATABASE UP TO DATE before the server starts (#lib/server/db/migrate):
 * every migration it carries that it has not seen, then a check that everything in
 * it belongs to its owner.
 *
 * The database is the one the server would use, from the same settings
 * (#lib/server/db/defaults): .env in development, under whatever the shell
 * sets, or the host's own. DATABASE_URL wins outright; otherwise PGDATABASE,
 * which must be set, at PGHOST, where libpq looks on this platform when that is
 * unset.
 *
 * Migrating is the owner's: whoever owns the database owns everything a
 * migration makes. Run by a role that may become the owner -- postgres, say --
 * this acts as the owner. Run by one that may not -- the server's, where it
 * owns nothing -- it stops before anything is applied.
 *
 * The server only checks, and will not start while a migration is waiting, so
 * this is the step before each start (MIGRATE_ON_START=true has the server do
 * it instead, connected as the owner). Where the server's role owns nothing,
 * run this as the owner's: on a host, a system user of its own, whom the unix
 * socket signs in as that role (README, "The database").
 */
import pg from 'pg';
import { bringUpToDate } from '#lib/server/db/migrate.ts';
import { Failed, Usage, type Command } from './command.ts';

const usage = 'usage: bin/reckon migrate';

export const migrate: Command = {
	summary: 'bring the database up to date, as its owner',
	usage,
	help: `${usage}

Applies every migration this reckon carries that the database hasn't seen, as
the database's owner, then checks that everything in it belongs to its owner.
The server won't start on a database behind it, so this is the step before
each start.

The database is the one the server would use: DATABASE_URL, or else
PGDATABASE at PGHOST. Run it as the database's owner, or as a role that may
become it, such as postgres. Run as one that may not, it stops before
anything is applied.`,

	async run(args, { database }) {
		if (args.length)
			throw new Usage(
				'migrate takes no database: it brings up to date the one PGDATABASE or DATABASE_URL ' +
					'names, as the server would use.'
			);
		const where = database();

		const probe = new pg.Client(where);
		let found: { name: string; owner: string; role: string; may: boolean };
		try {
			await probe.connect();
			[found] = (
				await probe.query<typeof found>(
					`select current_database() as name, pg_get_userbyid(datdba) as owner,
					        current_user as role, pg_has_role(current_user, datdba, 'SET') as may
					   from pg_database where datname = current_database()`
				)
			).rows;
		} catch (e) {
			// Not the URL itself, which can carry a password.
			const which = where.database ?? 'the database DATABASE_URL names';
			throw new Failed(`cannot reach ${which}: ${(e as Error).message}`);
		} finally {
			await probe.end().catch(() => {});
		}
		const { name, owner, role, may } = found;
		// The server's role, where it owns nothing, is told so before anything is tried.
		if (!may)
			throw new Failed(
				`${name} was not brought up to date: ${role} may not act as its owner, ${owner}, and migrating is the owner's. ` +
					`Run this as ${owner}, or as a role that may become it.`
			);

		// Connection options split on spaces, so a space or backslash in the role name
		// is escaped with a backslash, which is how libpq reads them.
		const pool = new pg.Pool({
			...where,
			max: 1,
			options: `-c role=${owner.replace(/[\\ ]/g, '\\$&')}`
		});
		try {
			const as = await bringUpToDate(pool);
			console.log(`${name} is up to date, and everything in it belongs to ${as}.`);
			return 0;
		} catch (e) {
			const err = e as { cause?: { message?: string }; message?: string };
			throw new Failed(`${name} was not brought up to date: ${err.cause?.message ?? err.message}`);
		} finally {
			await pool.end();
		}
	}
};
