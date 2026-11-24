/**
 * EVERY TAX RATE KEPT IN SYNC NOW, rather than when the server next does.
 *
 * The server does this on its own, as it starts and every hour after
 * (#lib/server/tax-sync): each area its authority answers for is asked about
 * once a day, by its code, and each site's address once a quarter. This runs
 * one pass of the same job: the areas not confirmed today and the sites not
 * placed since this quarter began. --all asks about every one; --dry-run says
 * how many are due and asks nothing.
 *
 * Where no authority answers -- the business collects in no state that has
 * one -- it says there is nothing to ask. A typed area is confirmed by a
 * person, against the state's own table.
 */
import { parseArgs } from 'node:util';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from '#lib/server/db/database.ts';
import { anyoneToAsk, syncTax } from '#lib/server/tax-sync.ts';
import { operands, Usage, type Command } from './command.ts';

const usage = 'usage: bin/reckon tax refresh [--all] [--dry-run]';

export const tax: Command = {
	summary: 'ask the tax authority about every rate now, not within the hour',
	usage,
	help: `${usage}

Asks the tax authority about each area not confirmed today, and each site not
placed since this quarter began, as the server does every hour. CDTFA answers
for California; a typed area is confirmed by a person, under Settings → Tax.

  --all       ask about every area and site, whenever it was last asked
  --dry-run   say how many are due, and ask nothing

It exits 1 if any could not be answered.`,

	async run(args, { database }) {
		const [command, ...rest] = args;
		if (command !== 'refresh')
			throw new Usage(
				command === undefined
					? 'tax has one command, refresh.'
					: `There is no tax ${command}: only refresh.`
			);
		const { values, positionals } = parseArgs({
			args: rest,
			options: {
				all: { type: 'boolean', default: false },
				'dry-run': { type: 'boolean', default: false }
			},
			allowPositionals: true
		});
		operands(positionals, 0, 'refresh takes no operands: --all, --dry-run, or neither.');
		const dry = values['dry-run'];

		// The database the server uses, in UTC like the server.
		const pool = new pg.Pool({ ...database(), max: 1, options: '-c TimeZone=UTC' });
		const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
		try {
			if (!(await anyoneToAsk(db))) {
				console.log(
					'Nothing to ask: CDTFA answers for California, and the business does not collect there. ' +
						'A typed area is confirmed by a person, under Settings → Tax.'
				);
				return 0;
			}
			// The business's day, as the server's (#lib/server/calendar): the
			// operator's zone, said outright, rather than whatever zone the host keeps.
			const {
				rows: [{ today }]
			} = await pool.query<{ today: string }>(
				`select (now() at time zone coalesce((select timezone from operator limit 1), 'UTC'))::date::text
				          as today`
			);
			const done = await syncTax(db, today, { all: values.all, dry });
			for (const f of done.failed) console.error(`  ✗ ${f.what}: ${f.why}`);
			console.log(
				dry
					? `areas due ${done.areas} · sites due ${done.sites} · dry run, nothing asked`
					: `areas confirmed ${done.areas}, changed ${done.changed} · ` +
							`sites placed ${done.sites}, moved ${done.moved} · ` +
							`could not be answered ${done.failed.length}`
			);
			return done.failed.length > 0 ? 1 : 0;
		} finally {
			await db.destroy();
		}
	}
};
