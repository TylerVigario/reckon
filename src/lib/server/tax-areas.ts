import { expressionBuilder, sql, type Expression, type Kysely, type NumericString } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { DB, PlacementWay, TaxLevel } from './db/database.ts';
import type { TaxPiece } from './db/tax-pieces.ts';
import { Decimal } from '../decimal.ts';
import type { Priced, PublishedRate } from './cdtfa.ts';

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
 * Imports nothing of SvelteKit's, so `bin/reckon tax refresh` runs it under
 * plain Node, as it does cdtfa.ts.
 */

/** The day an area's set in force on `day` took effect. */
function setInForce(area: Expression<string>, day: string | Expression<string>) {
	return expressionBuilder<DB>()
		.selectFrom('tax_piece as q')
		.select((eb) => eb.fn.max('q.effective_from').as('from'))
		.where('q.area_id', '=', area)
		.where('q.effective_from', '<=', day)
		.$asScalar();
}

/**
 * An area's rate on `day` on every kind of sale its state taxes, or the part
 * of it one level levies: its pieces in force then that fall on every kind,
 * added together. A level with no piece is 0.0000, as a share was written
 * before the pieces had a table. What a piece for one kind adds is that
 * kind's (areaKindRates).
 */
export function areaRate(
	area: Expression<string>,
	day: string | Expression<string>,
	level?: TaxLevel
) {
	return expressionBuilder<DB>()
		.selectFrom('tax_piece as p')
		.select((eb) =>
			sql<NumericString>`coalesce(sum(${eb.ref('p.rate_pct')}), 0)::numeric(7, 4)`.as('rate')
		)
		.where('p.area_id', '=', area)
		.where('p.effective_from', '=', setInForce(area, day))
		.where('p.sale_kind_id', 'is', null)
		.$if(level !== undefined, (qb) => qb.where('p.level', '=', level!))
		.$asScalar()
		.$notNull();
}

/**
 * What an area's pieces for one kind of sale alone come to on `day`, by kind:
 * what a line of that kind is taxed at there over the area's rate, or in
 * place of it where its state does not tax the kind. Each rate is the text
 * Postgres writes; a kind with no piece of its own is not there.
 */
export function areaKindRates(area: Expression<string>, day: string | Expression<string>) {
	return sql<Record<string, string>>`coalesce((
		select jsonb_object_agg(k.kind, k.rate)
		  from (select p.sale_kind_id::text as kind, sum(p.rate_pct)::numeric(7, 4)::text as rate
		          from tax_piece p
		         where p.area_id = ${area}
		           and p.effective_from = (${setInForce(area, day)})
		           and p.sale_kind_id is not null
		         group by p.sale_kind_id) k), '{}'::jsonb)`;
}

/**
 * An area's pieces in force on `day`: who levies what, the state's before the
 * local ones and, at each level, those on every kind before those for one,
 * each rate as the text Postgres writes and each piece's kind, null for every
 * kind its state taxes. A line keeps those it is taxed by (#lib/server/lines).
 */
export function areaPieces(area: Expression<string>, day: string) {
	return jsonArrayFrom(
		expressionBuilder<DB>()
			.selectFrom('tax_piece as p')
			.select((eb) => [
				'p.level',
				'p.jurisdiction',
				eb.cast<string>('p.rate_pct', 'text').as('rate'),
				'p.sale_kind_id as kind'
			])
			.where('p.area_id', '=', area)
			.where('p.effective_from', '=', setInForce(area, day))
			.orderBy('p.level')
			.orderBy(sql`p.sale_kind_id is not null`)
			.orderBy('p.jurisdiction')
	).$castTo<TaxPiece[]>();
}

/**
 * The pieces a line of `kind` taxed at its site's rate keeps, of its area's
 * `pieces`: those for its kind alone, and those on every kind where they fall
 * on it -- its state taxes the kind, or its tax was set by hand to the site's
 * rate (`everyKind`). A piece for its kind says so; one on every kind says no
 * kind.
 */
export function piecesFor(
	pieces: readonly TaxPiece[],
	kind: string | null,
	everyKind: boolean
): TaxPiece[] {
	return pieces.flatMap(({ kind: k, ...p }) =>
		k ? (k === kind ? [{ ...p, kind: k }] : []) : everyKind ? [p] : []
	);
}

/**
 * What a line of each kind of sale an area taxes alone is taxed at there, of
 * its `pieces` in force: those on every kind where its state taxes the kind
 * (`taxed`), and the kind's own. By the kind's name, as `names` gives it, so a
 * page can say "On Meals, 7.000%" beside the rate on every kind.
 */
export function kindRates(
	pieces: readonly TaxPiece[],
	taxed: readonly string[],
	names: Readonly<Record<string, string>>
) {
	const kinds = [...new Set(pieces.flatMap((p) => (p.kind ? [p.kind] : [])))];
	return kinds
		.map((kind) => {
			const of = piecesFor(pieces, kind, taxed.includes(kind)).map(({ kind: _, ...p }) => p);
			return {
				kind,
				name: names[kind] ?? 'A kind of sale',
				rate: of.reduce((t, p) => t.add(p.rate), Decimal.ZERO).toFixed(4),
				pieces: of
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Writes down that a site was placed in an area, and whether that moved it
 * from `was`, the area it was in before; a site's first placement moves it.
 * How: asked of the authority -- when the site was made, when it moved, by
 * hand, or on a refresh -- or chosen by a person, in a typed area. By whom,
 * where somebody did it: the server's own refresh is nobody.
 */
export async function placeSite(
	db: Kysely<DB>,
	site: { id: string; was: string | null },
	area: string,
	how: { way: PlacementWay; by: string | null; note: string }
) {
	await db
		.insertInto('site_placement')
		.values({
			site_id: site.id,
			area_id: area,
			moved: site.was !== area,
			way: how.way,
			placed_by: how.by,
			note: how.note
		})
		.execute();
}

/** One piece of a set, as it is written. */
type Piece = { level: TaxLevel; jurisdiction: string; code: string | null; rate_pct: string };

/**
 * Makes `pieces` the area's rate on every day from `from` until `until`: a set
 * that took effect in between is not what the authority says was in force
 * then, and goes, and the set in force on `from` is made `pieces` unless it
 * already is. Says whether anything was written.
 */
async function confirmSet(
	db: Kysely<DB>,
	area: string,
	pieces: Piece[],
	from: string,
	until: Expression<string>
): Promise<boolean> {
	const between = await db
		.deleteFrom('tax_piece')
		.where('area_id', '=', area)
		.where('effective_from', '>', from)
		.where('effective_from', '<', until)
		.executeTakeFirst();
	const now = await db
		.selectFrom('tax_piece')
		.select(['level', 'jurisdiction', 'code', 'rate_pct'])
		.where('area_id', '=', area)
		.where('effective_from', '=', setInForce(sql.val(area), from))
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
	if (same) return between.numDeletedRows > 0n;
	await db
		.deleteFrom('tax_piece')
		.where('area_id', '=', area)
		.where('effective_from', '=', from)
		.execute();
	await db
		.insertInto('tax_piece')
		.values(pieces.map((p) => ({ ...p, area_id: area, effective_from: from })))
		.execute();
	return true;
}

/** A set the same as the one before it changed nothing, and goes. */
async function dropRepeats(db: Kysely<DB>, area: string) {
	await sql`
		with sets as (
		  select effective_from,
		         string_agg(level || ' ' || jurisdiction || ' ' || coalesce(code, '') || ' ' ||
		                    rate_pct::text || ' ' || coalesce(sale_kind_id::text, ''), ', '
		                    order by level, jurisdiction, sale_kind_id) as said
		    from tax_piece where area_id = ${area} group by effective_from
		), repeated as (
		  select effective_from from (
		    select s.*, lag(said) over (order by effective_from) as before from sets s
		  ) x where x.said = x.before
		)
		delete from tax_piece p using repeated r
		 where p.area_id = ${area} and p.effective_from = r.effective_from`.execute(db);
}

/**
 * Writes down every rate CDTFA publishes for an area, and the area as
 * confirmed today. Each holds from the day it took effect to the end of the
 * quarter its record describes -- the coming quarter's among them, so it comes
 * in on its day -- and CDTFA's word for those days replaces whatever was kept
 * for them. Its pieces are the state's share and the districts' together, as
 * CDTFA-105 lists districts and makes no other kind. Says whether any rate
 * changed.
 */
export async function confirmCdtfaArea(
	db: Kysely<DB>,
	area: { id: string; name: string; code: string },
	rates: readonly PublishedRate[],
	today: string
): Promise<boolean> {
	let changed = false;
	for (const r of rates) {
		const wrote = await confirmSet(
			db,
			area.id,
			[
				{ level: 'state', jurisdiction: 'CALIFORNIA', code: null, rate_pct: r.state },
				...(Decimal.from(r.district).isZero()
					? []
					: [
							{
								level: 'local' as const,
								jurisdiction: area.name,
								code: area.code,
								rate_pct: r.district
							}
						])
			],
			r.start,
			sql<string>`(${r.quarter}::date + interval '3 months')::date`
		);
		changed = changed || wrote;
	}
	await dropRepeats(db, area.id);
	await db.updateTable('tax_area').set({ confirmed_on: today }).where('id', '=', area.id).execute();
	return changed;
}

/**
 * Writes down CDTFA's answer about an address (#lib/server/cdtfa priceAddress)
 * as its area's, and gives back the area: found by its code, or made, and its
 * rates confirmed (confirmCdtfaArea).
 */
export async function recordCdtfaArea(
	db: Kysely<DB>,
	answer: Pick<Priced, 'tac' | 'jurisdiction' | 'rates'>,
	today: string
): Promise<string> {
	const { id } = await db
		.insertInto('tax_area')
		.values({
			state: 'CA',
			code: answer.tac,
			name: answer.jurisdiction,
			source: 'cdtfa',
			confirmed_on: today
		})
		.onConflict((oc) =>
			oc
				.columns(['state', 'code'])
				.where('code', 'is not', null)
				.doUpdateSet((eb) => ({ name: eb.ref('excluded.name') }))
		)
		.returning('id')
		.executeTakeFirstOrThrow();
	await confirmCdtfaArea(
		db,
		{ id, name: answer.jurisdiction, code: answer.tac },
		answer.rates,
		today
	);
	return id;
}
