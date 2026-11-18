import { expressionBuilder, sql, type Expression } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { Decimal } from '#lib/decimal.ts';
import type { DB } from './db/database.ts';
import { db } from './db/index.ts';
import { businessToday } from './calendar.ts';
import { areaRate } from './tax-areas.ts';

/**
 * What an entry can be written against: who can work it, who pays and where,
 * and what was done. Shared by every screen that writes one down, so a person
 * or a client offered on one is offered on all.
 */

/**
 * Who a team entry names as its crew (0023), by name, A to Z: what a screen
 * says in place of "the team". Empty for one person's entry, and for none (a
 * line with no entry behind it).
 */
export const crewNames = (entryId: Expression<string | null>) =>
	expressionBuilder<DB>()
		.selectFrom('time_entry_crew as c')
		.innerJoin('user as u', 'u.id', 'c.user_id')
		.where('c.time_entry_id', '=', entryId)
		.select((eb) =>
			sql<string[]>`coalesce(array_agg(${eb.ref('u.name')} order by ${eb.ref('u.name')}), '{}')`.as(
				'names'
			)
		)
		.$asScalar()
		// An aggregate: always one row, so never null.
		.$notNull();

/** The team: everyone active who holds a role. */
export const theTeam = () =>
	db
		.selectFrom('user')
		.select(['id', 'name'])
		.where('active', '=', true)
		.where('role_id', 'is not', null)
		.orderBy('name')
		.execute();

/**
 * Active clients, each with its active sites by the name it uses for them, and
 * the rate charged at each -- none where nothing is.
 */
export async function clientsAndSites() {
	const clients = await db
		.selectFrom('entity')
		.select((eb) => [
			'entity.id',
			'entity.slug',
			'entity.name',
			jsonArrayFrom(
				eb
					.selectFrom('site')
					// As text: a NUMERIC inside JSON would arrive as a JS number.
					.select((eb) => [
						'site.id',
						'site.display',
						// Its area's rate today (#lib/server/tax-areas).
						eb
							.cast<string>(areaRate(eb.ref('site.tax_area_id'), businessToday()), 'text')
							.as('rate')
					])
					.whereRef('site.entity_id', '=', 'entity.id')
					.where('site.active', '=', true)
					.orderBy('site.display')
			).as('sites')
		])
		.where('entity.active', '=', true)
		.orderBy('entity.name')
		.execute();
	return clients.map((c) => ({
		id: c.id,
		slug: c.slug,
		name: c.name,
		sites: c.sites.map((s) => ({
			id: s.id,
			label: s.display ?? '',
			rate_pct: Decimal.from(s.rate).isZero() ? null : s.rate
		}))
	}));
}

/** The services a timer can run. */
export const timedServices = () =>
	db
		.selectFrom('service')
		.select(['id', 'name', 'unit', 'bill_to_nearest_seconds'])
		.where('active', '=', true)
		.where('time_tracked', '=', true)
		.orderBy('name')
		.execute();
