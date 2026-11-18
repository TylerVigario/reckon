import { expressionBuilder, sql, type Expression, type Kysely, type NumericString } from 'kysely';
import type { DB, TaxLevel } from './db/database.ts';
import { Decimal } from '../decimal.ts';
import type { Priced } from './cdtfa.ts';

/**
 * A RATE BELONGS TO A PLACE. A tax area is one place with one combination of
 * jurisdictions -- what CDTFA's tax area code names -- and its rate is its
 * pieces: who levies what, federal, state and local, added together. A site
 * only says which area it is in (tax_area_id).
 *
 * An area's pieces come in dated sets, and the set in force on a day is the
 * newest dated on or before it. Everything that shows or uses a site's rate
 * reads it from here, as of a day: today, for a site's page or a line being
 * added.
 *
 * Imports nothing of SvelteKit's, so scripts/refresh-tax-rates.mjs runs it
 * under plain Node, as it does cdtfa.ts.
 */

/** The day an area's set in force on `day` took effect. */
function setInForce(area: Expression<string>, day: string) {
	return expressionBuilder<DB>()
		.selectFrom('tax_piece as q')
		.select((eb) => eb.fn.max('q.effective_from').as('from'))
		.where('q.area_id', '=', area)
		.where('q.effective_from', '<=', day)
		.$asScalar();
}

/**
 * An area's rate on `day`, or the part of it one level levies: its pieces in
 * force then, added together. A level with no piece is 0.0000, as a share was
 * written before the pieces had a table.
 */
export function areaRate(area: Expression<string>, day: string, level?: TaxLevel) {
	return expressionBuilder<DB>()
		.selectFrom('tax_piece as p')
		.select((eb) =>
			sql<NumericString>`coalesce(sum(${eb.ref('p.rate_pct')}), 0)::numeric(7, 4)`.as('rate')
		)
		.where('p.area_id', '=', area)
		.where('p.effective_from', '=', setInForce(area, day))
		.$if(level !== undefined, (qb) => qb.where('p.level', '=', level!))
		.$asScalar()
		.$notNull();
}

/**
 * Writes down CDTFA's answer about an address (#lib/server/cdtfa priceAddress)
 * as its area's, and gives back the area. The area is found by its code, or made; its pieces are the state's
 * share and the districts' together, as CDTFA-105 lists districts and makes no
 * other kind. A set that differs from the one in force today is added, dated
 * today, and one already added today is replaced: CDTFA said something new
 * since. The same answer again only confirms it.
 */
export async function recordCdtfaArea(
	db: Kysely<DB>,
	answer: Pick<Priced, 'tac' | 'jurisdiction' | 'state' | 'district'>,
	day: string
): Promise<string> {
	const { id } = await db
		.insertInto('tax_area')
		.values({
			state: 'CA',
			code: answer.tac,
			name: answer.jurisdiction,
			source: 'cdtfa',
			confirmed_on: day
		})
		.onConflict((oc) =>
			oc
				.columns(['state', 'code'])
				.where('code', 'is not', null)
				.doUpdateSet((eb) => ({
					name: eb.ref('excluded.name'),
					confirmed_on: eb.ref('excluded.confirmed_on')
				}))
		)
		.returning('id')
		.executeTakeFirstOrThrow();

	const pieces = [
		{ level: 'state' as const, jurisdiction: 'CALIFORNIA', code: null, rate_pct: answer.state },
		...(Decimal.from(answer.district).isZero()
			? []
			: [
					{
						level: 'local' as const,
						jurisdiction: answer.jurisdiction,
						code: answer.tac,
						rate_pct: answer.district
					}
				])
	];
	const now = await db
		.selectFrom('tax_piece')
		.select(['level', 'jurisdiction', 'code', 'rate_pct'])
		.where('area_id', '=', id)
		.where('effective_from', '=', setInForce(sql.val(id), day))
		.execute();
	const same =
		now.length === pieces.length &&
		pieces.every((p) =>
			now.some(
				(n) =>
					n.level === p.level &&
					n.jurisdiction === p.jurisdiction &&
					n.code === p.code &&
					Decimal.from(n.rate_pct).eq(p.rate_pct)
			)
		);
	if (same) return id;

	await db
		.deleteFrom('tax_piece')
		.where('area_id', '=', id)
		.where('effective_from', '=', day)
		.execute();
	await db
		.insertInto('tax_piece')
		.values(pieces.map((p) => ({ ...p, area_id: id, effective_from: day })))
		.execute();
	return id;
}
