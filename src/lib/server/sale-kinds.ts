import { sql, type Kysely, type NotNull } from 'kysely';
import type { DB, ReckonKind } from './db/database.ts';
import type { Taxes } from '../passed-on.ts';
import { pgError, stillReferenced } from './field-errors.ts';
import { collecting } from './tax-registrations.ts';

/**
 * KINDS OF SALE, AND WHETHER EACH STATE TAXES EACH (19 November 2026). A
 * material or a service says what kind of sale it is -- goods, installation
 * labour, a help desk -- and each state the business collects in says whether
 * it taxes that kind, its taxability: one answer per kind, not per item, since
 * states differ on what they tax and agree on what a thing is.
 *
 * The kinds are the business's own list, begun with reckon's four, which
 * stay: goods, which goods bought for a job are; installation labour; repair
 * labour; and travel. Every state collected in answers every kind, which the
 * schema holds at the end of each save (every_state_answers_every_kind), so a
 * kind is made with every state's answer and a state collected in with every
 * kind's. Each answer says who gave it and when, and every change to a kind or
 * an answer is kept (record_history).
 *
 * Imports nothing of SvelteKit's, as #lib/server/tax-registrations does not.
 */

/** Why a kind or an answer was not written, in the words a page shows. */
export class Refused extends Error {
	constructor(
		readonly field: string,
		message: string
	) {
		super(message);
	}
}

/** What a kind's name is refused for, or null where that was not it. */
function named(e: unknown): Refused | null {
	const err = pgError(e);
	if (err.code === '23505' && err.constraint === 'sale_kind_name_once')
		return new Refused('name', 'There is a kind called that already.');
	return null;
}

/**
 * Each state the business collects in, and the kinds of sale it taxes there:
 * what a line's tax turns on (#lib/passed-on), on the server and on a phone.
 */
export async function taxesByState(db: Kysely<DB>): Promise<Taxes> {
	const rows = await db
		.selectFrom('tax_registration as r')
		.leftJoin('taxability as t', (j) => j.onRef('t.state', '=', 'r.state').on('t.taxed', '=', true))
		.select(['r.state', 't.sale_kind_id'])
		.orderBy('r.state')
		.execute();
	const out: Record<string, string[]> = {};
	for (const r of rows) {
		out[r.state] ??= [];
		if (r.sale_kind_id) out[r.state].push(r.sale_kind_id);
	}
	return out satisfies Taxes;
}

/**
 * Each state the business collects in, and the kinds of sale some area of it
 * taxes on `day` by a piece for that kind alone (#lib/server/tax-areas),
 * whether or not the state does: a line of one of them needs its site there,
 * as a line of a kind the state taxes does.
 */
export async function areaTaxesByState(db: Kysely<DB>, day: string): Promise<Taxes> {
	const rows = await db
		.selectFrom('tax_piece as p')
		.innerJoin('tax_area as a', 'a.id', 'p.area_id')
		.innerJoin('tax_registration as r', 'r.state', 'a.state')
		.select(['a.state', 'p.sale_kind_id'])
		.distinct()
		.where('p.sale_kind_id', 'is not', null)
		.where('p.effective_from', '=', (eb) =>
			eb
				.selectFrom('tax_piece as q')
				.select((eb) => eb.fn.max('q.effective_from').as('d'))
				.whereRef('q.area_id', '=', 'p.area_id')
				.where('q.effective_from', '<=', day)
				.$asScalar()
		)
		.$narrowType<{ sale_kind_id: NotNull }>()
		.orderBy('a.state')
		.execute();
	const out: Record<string, string[]> = {};
	for (const r of rows) (out[r.state] ??= []).push(r.sale_kind_id);
	return out satisfies Taxes;
}

/** One of reckon's own kinds, by which it is: goods, for goods bought for a job. */
export async function reckonsKind(db: Kysely<DB>, code: ReckonKind): Promise<string> {
	const { id } = await db
		.selectFrom('sale_kind')
		.select('id')
		.where('code', '=', code)
		.executeTakeFirstOrThrow();
	return id;
}

/** The kinds an item can be, as a choice offers them: the business's word for each. */
export async function kindChoices(db: Kysely<DB>) {
	return db
		.selectFrom('sale_kind')
		.select(['id', 'name', 'active'])
		.orderBy(sql`code is null`)
		.orderBy('code')
		.orderBy(sql`lower(name)`)
		.execute();
}

/**
 * Every kind, reckon's first: what it is called, whether it is offered, how
 * many materials and services are it and how many lines were sold as it, and
 * the states collected in that tax it.
 */
export async function saleKinds(db: Kysely<DB>) {
	return db
		.selectFrom('sale_kind as k')
		.select((eb) => [
			'k.id',
			'k.code',
			'k.name',
			'k.active',
			eb
				.selectFrom('material')
				.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
				.whereRef('material.sale_kind_id', '=', 'k.id')
				.$asScalar()
				.$notNull()
				.as('materials'),
			eb
				.selectFrom('service')
				.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
				.whereRef('service.sale_kind_id', '=', 'k.id')
				.$asScalar()
				.$notNull()
				.as('services'),
			eb
				.exists(
					eb
						.selectFrom('invoice_line')
						.select('invoice_line.id')
						.whereRef('invoice_line.sale_kind_id', '=', 'k.id')
				)
				.$castTo<boolean>()
				.as('sold'),
			sql<string[]>`coalesce((select array_agg(t.state order by t.state) from taxability t
				where t.sale_kind_id = k.id and t.taxed), '{}')`.as('taxed_in')
		])
		.orderBy(sql`k.code is null`)
		.orderBy('k.code')
		.orderBy(sql`lower(k.name)`)
		.execute();
}

/** One kind as its page shows it, or undefined where there is none of that id. */
export async function saleKind(db: Kysely<DB>, id: string) {
	const kind = (await saleKinds(db)).find((k) => k.id === id);
	if (!kind) return undefined;
	const [answers, items] = await Promise.all([
		answersFor(db, { kind: id }),
		db
			.selectFrom('material')
			.select(['id', 'name', sql<'material' | 'service'>`'material'`.as('is')])
			.where('sale_kind_id', '=', id)
			.unionAll(
				db
					.selectFrom('service')
					.select(['id', 'name', sql<'material' | 'service'>`'service'`.as('is')])
					.where('sale_kind_id', '=', id)
			)
			.orderBy('name')
			.execute()
	]);
	return { ...kind, answers, items };
}

/**
 * The answers of one state, every kind's, or of one kind, every state's: each
 * with who gave it and when, where somebody did.
 */
export async function answersFor(db: Kysely<DB>, of: { state: string } | { kind: string }) {
	return db
		.selectFrom('taxability as t')
		.innerJoin('sale_kind as k', 'k.id', 't.sale_kind_id')
		.leftJoin('user as u', 'u.id', 't.said_by')
		.select([
			't.state',
			't.sale_kind_id as kind',
			'k.name',
			'k.code',
			'k.active',
			't.taxed',
			't.said_on',
			'u.name as said_by'
		])
		.$if('state' in of, (qb) => qb.where('t.state', '=', (of as { state: string }).state))
		.$if('kind' in of, (qb) => qb.where('t.sale_kind_id', '=', (of as { kind: string }).kind))
		.orderBy('t.state')
		.orderBy(sql`k.code is null`)
		.orderBy('k.code')
		.orderBy(sql`lower(k.name)`)
		.execute();
}

/**
 * A kind of the business's own, with each state's answer for it: `answers`
 * has one for every state the business collects in, which the endpoint has
 * checked (#lib/kind-fields parseAnswers).
 */
export async function addKind(
	db: Kysely<DB>,
	name: string,
	answers: Record<string, boolean>,
	by: string,
	today: string
): Promise<string> {
	try {
		const { id } = await db
			.insertInto('sale_kind')
			.values({ name })
			.returning('id')
			.executeTakeFirstOrThrow();
		const states = await collecting(db);
		const unanswered = states.find((s) => answers[s] === undefined);
		if (unanswered)
			throw new Refused(
				`taxed.${unanswered}`,
				`The business started collecting in ${unanswered} meanwhile: say whether it taxes this there too.`
			);
		if (states.length)
			await db
				.insertInto('taxability')
				.values(
					states.map((state) => ({
						state,
						sale_kind_id: id,
						taxed: answers[state],
						said_by: by,
						said_on: today
					}))
				)
				.execute();
		return id;
	} catch (e) {
		throw named(e) ?? e;
	}
}

/** A kind renamed, or retired or offered again: what was saved, or undefined where there is none. */
export async function changeKind(
	db: Kysely<DB>,
	id: string,
	row: { name?: string; active?: boolean }
) {
	try {
		return await db
			.updateTable('sale_kind')
			.set(row)
			.where('id', '=', id)
			.returning(['name', 'active'])
			.executeTakeFirst();
	} catch (e) {
		throw named(e) ?? e;
	}
}

/**
 * A kind of the business's own that nothing is or was sold as taken away, its
 * answers with it. reckon's own kinds stay, and so does one anything names --
 * an area's piece for it among them.
 */
export async function removeKind(db: Kysely<DB>, id: string): Promise<boolean> {
	try {
		const gone = await db.deleteFrom('sale_kind').where('id', '=', id).executeTakeFirst();
		return gone.numDeletedRows > 0n;
	} catch (e) {
		if (pgError(e).constraint === 'reckons_kinds_stay')
			throw new Refused('kind', 'One of reckon’s own kinds stays. Retire it instead.');
		if (pgError(e).constraint === 'tax_piece_sale_kind_id_fkey')
			throw new Refused('kind', 'An area taxes it by a piece of its own. Retire it instead.');
		if (stillReferenced(e))
			throw new Refused('kind', 'Something is, or was, sold as it. Retire it instead.');
		throw e;
	}
}

/** A state's answer for a kind, given by `by` today: what was saved, or undefined where there is none. */
export async function answer(
	db: Kysely<DB>,
	state: string,
	kind: string,
	taxed: boolean,
	by: string,
	today: string
) {
	return db
		.updateTable('taxability')
		.set({ taxed, said_by: by, said_on: today })
		.where('state', '=', state)
		.where('sale_kind_id', '=', kind)
		.returning(['taxed', 'said_on'])
		.executeTakeFirst();
}

/**
 * Every kind's answer in a state the business starts collecting in, given by
 * `by` today: `answers` has one for every kind, which the endpoint has checked.
 */
export async function answerEveryKind(
	db: Kysely<DB>,
	state: string,
	answers: Record<string, boolean>,
	by: string,
	today: string
) {
	const kinds = await db.selectFrom('sale_kind').select(['id', 'name']).execute();
	const unanswered = kinds.find((k) => answers[k.id] === undefined);
	if (unanswered)
		throw new Refused(
			`taxed.${unanswered.id}`,
			`${unanswered.name} was added meanwhile: say whether it is taxed here too.`
		);
	await db
		.insertInto('taxability')
		.values(
			kinds.map((k) => ({
				state,
				sale_kind_id: k.id,
				taxed: answers[k.id],
				said_by: by,
				said_on: today
			}))
		)
		.execute();
}

/**
 * Why an item cannot be made `id`'s kind, or null where it can: a kind that
 * is no longer there, or one retired. An item already of a retired kind stays
 * it until changed.
 */
export async function refusedKind(db: Kysely<DB>, id: string): Promise<string | null> {
	const kind = await db
		.selectFrom('sale_kind')
		.select(['name', 'active'])
		.where('id', '=', id)
		.executeTakeFirst();
	if (!kind) return 'That kind of sale no longer exists.';
	if (!kind.active)
		return `${kind.name} is retired. Offer it again from Settings → Tax, or choose another.`;
	return null;
}
