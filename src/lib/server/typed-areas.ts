import { sql, type Kysely } from 'kysely';
import type { DB } from './db/database.ts';
import type { TypedPiece } from '../area-fields.ts';
import { Decimal } from '../decimal.ts';
import { UUID } from '../field-rules.ts';
import { pgError } from './field-errors.ts';
import { areaRate } from './tax-areas.ts';
import { quarterBegan } from './stale.ts';
import { stateName, typesAreas } from '../us-states.ts';
import { dated } from '../format.ts';
import { collecting } from './tax-registrations.ts';

/**
 * A STATE'S AREAS, AS A PERSON TYPES THEM (18 November 2026). CDTFA answers
 * for an address in California; in most states nothing does, so a business
 * that collects in one types its areas in from the state's own table -- what
 * the state calls each, its code for it where it has one, and its rate from a
 * day, piece by piece -- and a person chooses which a site is in.
 *
 * A new rate is a new set from its day, as CDTFA's coming quarter is, so a
 * figure from last quarter stays explainable (#lib/server/tax-areas). An area
 * is stale once nobody has confirmed it since a quarter began, when the
 * Streamlined Sales and Use Tax Agreement puts a rate or boundary change
 * (s. 304(A)(2), s. 305(A) and (C)); typing a rate confirms it, having just
 * read the table, and so does confirming it, one action.
 *
 * Each says who typed it and who last confirmed it, and every change to an
 * area or its rates is kept (record_history).
 */

/** Why a typed area or rate was not written, in the words a page shows. */
export class Refused extends Error {
	constructor(
		readonly field: string,
		message: string
	) {
		super(message);
	}
}

/** A name or a code another area of the state has already. */
function taken(e: unknown, state: string): Refused | null {
	const err = pgError(e);
	if (err.code !== '23505') return null;
	if (err.constraint === 'tax_area_typed_name_once')
		return new Refused('name', `${stateName(state)} has an area called that already.`);
	if (err.constraint === 'tax_area_code_names_one')
		return new Refused('code', `${stateName(state)} has an area with that code already.`);
	return null;
}

/** Whether two sets of pieces say the same. */
function same(
	a: readonly {
		level: string;
		jurisdiction: string;
		code: string | null;
		rate_pct: string;
		sale_kind_id: string | null;
	}[],
	b: readonly TypedPiece[]
) {
	return (
		a.length === b.length &&
		b.every((p) =>
			a.some(
				(n) =>
					n.level === p.level &&
					n.jurisdiction === p.jurisdiction &&
					n.code === p.code &&
					n.sale_kind_id === p.sale_kind_id &&
					Decimal.from(n.rate_pct).eq(p.rate_pct)
			)
		)
	);
}

/**
 * Refuses a piece for a kind of sale there is not, or for one retired that
 * the area has no piece for already: a retired kind is offered for nothing
 * new, and a piece the area has for it stays as the state's table has it.
 */
async function kindsThere(db: Kysely<DB>, area: string | null, pieces: readonly TypedPiece[]) {
	const named = [...new Set(pieces.flatMap((p) => (p.sale_kind_id ? [p.sale_kind_id] : [])))];
	if (!named.length) return;
	const [kinds, had] = await Promise.all([
		db.selectFrom('sale_kind').select(['id', 'name', 'active']).where('id', 'in', named).execute(),
		area
			? db
					.selectFrom('tax_piece')
					.select('sale_kind_id')
					.distinct()
					.where('area_id', '=', area)
					.where('sale_kind_id', 'in', named)
					.execute()
			: []
	]);
	pieces.forEach((p, i) => {
		if (!p.sale_kind_id) return;
		const k = kinds.find((k) => k.id === p.sale_kind_id);
		if (!k) throw new Refused(`pieces.${i}.sale_kind_id`, 'That kind of sale no longer exists.');
		if (!k.active && !had.some((h) => h.sale_kind_id === k.id))
			throw new Refused(
				`pieces.${i}.sale_kind_id`,
				`${k.name} is retired. Offer it again from Settings → Tax, or choose another.`
			);
	});
}

/** The set an area has from `day` exactly, or the one in force just before it. */
async function setOn(db: Kysely<DB>, area: string, day: string, before = false) {
	return db
		.selectFrom('tax_piece')
		.select(['level', 'jurisdiction', 'code', 'rate_pct', 'sale_kind_id', 'effective_from'])
		.where('area_id', '=', area)
		.where('effective_from', '=', (eb) =>
			before
				? eb
						.selectFrom('tax_piece as q')
						.select((eb) => eb.fn.max('q.effective_from').as('d'))
						.where('q.area_id', '=', area)
						.where('q.effective_from', '<', day)
						.$asScalar()
				: eb.val(day)
		)
		.execute();
}

/**
 * Types a new area in `state`, with its first rate from `from`, by `by`, and
 * confirms it today. Its first rate is in force today, or every site chosen
 * into it would have none: the day it took effect, or this quarter's first.
 */
export async function typeArea(
	db: Kysely<DB>,
	state: string,
	area: { name: string; code: string | null },
	rate: { from: string; pieces: readonly TypedPiece[] },
	by: string,
	today: string
): Promise<string> {
	if (rate.from > today)
		throw new Refused(
			'from',
			'Its first rate is the one in force today: the day it took effect, or this quarter’s first day.'
		);
	await kindsThere(db, null, rate.pieces);
	try {
		const { id } = await db
			.insertInto('tax_area')
			.values({
				state,
				name: area.name,
				code: area.code,
				source: 'typed',
				typed_by: by,
				confirmed_on: today,
				confirmed_by: by
			})
			.returning('id')
			.executeTakeFirstOrThrow();
		await db
			.insertInto('tax_piece')
			.values(
				rate.pieces.map((p) => ({ ...p, area_id: id, effective_from: rate.from, typed_by: by }))
			)
			.execute();
		return id;
	} catch (e) {
		throw taken(e, state) ?? e;
	}
}

/** Renames an area, or gives it the state's code for it. */
export async function renameArea(
	db: Kysely<DB>,
	area: { id: string; state: string },
	set: { name?: string; code?: string | null }
) {
	try {
		await db.updateTable('tax_area').set(set).where('id', '=', area.id).execute();
	} catch (e) {
		throw taken(e, area.state) ?? e;
	}
}

/**
 * Makes `pieces` the area's rate from `from`, by `by`, and confirms the area
 * today: whoever typed it has just read the state's table. A rate the same as
 * the one in force before that day changes nothing, and is refused, as is one
 * the same as the area has from that day already. Says the set it replaced,
 * where there was one.
 */
export async function typeRate(
	db: Kysely<DB>,
	area: string,
	from: string,
	pieces: readonly TypedPiece[],
	by: string,
	today: string
): Promise<'typed' | 'replaced'> {
	await kindsThere(db, area, pieces);
	const there = await setOn(db, area, from);
	if (there.length && same(there, pieces))
		throw new Refused('pieces', 'That is its rate from that day already.');
	const before = await setOn(db, area, from, true);
	if (before.length && same(before, pieces))
		throw new Refused(
			'pieces',
			`That is its rate already, from ${dated(before[0].effective_from)}: a new rate is a change.`
		);
	await db
		.deleteFrom('tax_piece')
		.where('area_id', '=', area)
		.where('effective_from', '=', from)
		.execute();
	await db
		.insertInto('tax_piece')
		.values(pieces.map((p) => ({ ...p, area_id: area, effective_from: from, typed_by: by })))
		.execute();
	await confirmArea(db, area, by, today);
	return there.length ? 'replaced' : 'typed';
}

/**
 * Takes away the rate an area has from `from` -- typed wrong, or a change that
 * is not coming. Not its only rate in force today, which every site in it
 * would be left without. Says whether there was one.
 */
export async function removeRate(
	db: Kysely<DB>,
	area: string,
	from: string,
	today: string
): Promise<boolean> {
	if (from <= today) {
		const others = await db
			.selectFrom('tax_piece')
			.select('effective_from')
			.where('area_id', '=', area)
			.where('effective_from', '<=', today)
			.where('effective_from', '<>', from)
			.limit(1)
			.execute();
		if (!others.length)
			throw new Refused(
				'from',
				'It is the area’s only rate in force today. Type the right one from the same day instead.'
			);
	}
	const gone = await db
		.deleteFrom('tax_piece')
		.where('area_id', '=', area)
		.where('effective_from', '=', from)
		.executeTakeFirst();
	return gone.numDeletedRows > 0n;
}

/** Confirms an area's rate as the state's table has it today, by `by`. */
export async function confirmArea(db: Kysely<DB>, area: string, by: string, today: string) {
	await db
		.updateTable('tax_area')
		.set({ confirmed_on: today, confirmed_by: by })
		.where('id', '=', area)
		.execute();
}

/**
 * Takes away an area typed by mistake. Not one a site has ever been placed in:
 * its placements name it, and stay. Says whether it went.
 */
export async function removeArea(db: Kysely<DB>, area: string): Promise<boolean> {
	const used = await db
		.selectFrom('site_placement')
		.select('id')
		.where('area_id', '=', area)
		.union(db.selectFrom('site').select('id').where('tax_area_id', '=', area))
		.limit(1)
		.execute();
	if (used.length)
		throw new Refused('area', 'A site has been placed in it, so it stays: its history names it.');
	const gone = await db.deleteFrom('tax_area').where('id', '=', area).executeTakeFirst();
	return gone.numDeletedRows > 0n;
}

/**
 * A state's typed areas, as its page lists them: each one's rate today, when
 * it was last confirmed and by whom, whether that was before this quarter
 * began, and how many of the business's sites are in it.
 */
export async function typedAreas(db: Kysely<DB>, state: string, today: string) {
	return db
		.selectFrom('tax_area as a')
		.leftJoin('user as u', 'u.id', 'a.confirmed_by')
		.select((eb) => [
			'a.id',
			'a.name',
			'a.code',
			areaRate(eb.ref('a.id'), today).as('rate_pct'),
			eb.cast<string>('a.confirmed_on', 'text').as('confirmed_on'),
			'u.name as confirmed_by',
			sql<boolean>`${eb.ref('a.confirmed_on')} < ${quarterBegan(today)}`.as('stale'),
			eb
				.cast<number>(
					eb
						.selectFrom('site as s')
						.select((eb) => eb.fn.countAll().as('n'))
						.whereRef('s.tax_area_id', '=', 'a.id')
						.where('s.active', '=', true)
						.$asScalar(),
					'integer'
				)
				.as('sites')
		])
		.where('a.state', '=', state)
		.where('a.source', '=', 'typed')
		.orderBy('a.name')
		.execute();
}

/**
 * Whether a person types `state`'s areas: the business collects there, and
 * no authority answers for an address in it.
 */
export async function typesAreasIn(db: Kysely<DB>, state: string): Promise<boolean> {
	return typesAreas(state) && (await collecting(db)).includes(state);
}

/** A typed area of `state` by its id, or null. */
export async function findTypedArea(db: Kysely<DB>, state: string, id: string) {
	if (!UUID.test(id)) return null;
	return (
		(await db
			.selectFrom('tax_area')
			.select(['id', 'state', 'name', 'code'])
			.where('id', '=', id)
			.where('state', '=', state)
			.where('source', '=', 'typed')
			.executeTakeFirst()) ?? null
	);
}
