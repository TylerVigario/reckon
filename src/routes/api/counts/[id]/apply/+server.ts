import { asUser } from '#lib/server/db/index.ts';
import { lockMaterials, putRight, ShelfRefused } from '#lib/server/adjust.ts';
import { problem } from '#lib/server/problem.ts';
import { shelves } from '#lib/server/stock.ts';
import { UUID } from '#lib/field-rules.ts';
import { readBody } from '#lib/json.ts';
import { KEEPS, shelfAfter, type Keep } from '#lib/count-fields.ts';
import { onHandOf } from '#lib/stock-draw.ts';
import { quantity } from '#lib/format.ts';
import type { RequestHandler } from './$types';

/** Thrown inside the transaction to answer with this instead. */
class Answer extends Error {
	constructor(readonly response: Response) {
		super('answered');
	}
}

/**
 * Applies a count, once: each material counted is put right to what was
 * counted, by an adjustment that names the count (#lib/server/adjust). What
 * is short comes off the oldest lots at what it cost; what is over goes on at
 * what one on the shelf is worth now, or the cost each said where the shelf
 * has nothing to go by; one that matches makes nothing, as ERPNext leaves an
 * item with no change out of a reconciliation.
 *
 * MOVED SINCE IT WAS COUNTED. A material whose shelf says something other
 * than it did when it was counted -- a line drew from it, more came in -- is
 * not written over unseen: the count is refused, saying which, until it is
 * applied again saying what to keep (`keep`), Odoo's choice -- what was
 * counted, or the difference the count found (#lib/count-fields shelfAfter).
 *
 * The count's row and every material on it are locked first, in one order,
 * so it is applied once and no draw slips in between reading and writing.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 'No count with that id.');
	const body = await readBody(request);
	const asked = body?.keep;
	if (asked !== undefined && !KEEPS.includes(asked as Keep))
		return problem('malformed', 'keep is "counted" or "difference", or not said.');
	const keep = asked as Keep | undefined;
	const userId = locals.user!.id;

	try {
		const made = await asUser(userId, async (tx) => {
			const count = await tx
				.selectFrom('stock_count')
				.select(['id', 'counted_on', 'applied_at'])
				.where('id', '=', params.id)
				.forUpdate()
				.executeTakeFirst();
			if (!count) throw new Answer(problem('notFound', 'No count with that id.'));
			if (count.applied_at)
				throw new Answer(problem('notAsThingsStand', 'That count has been applied already.'));
			const lines = await tx
				.selectFrom('stock_count_line as l')
				.innerJoin('material as m', 'm.id', 'l.material_id')
				.innerJoin('unit as u', 'u.id', 'm.unit_id')
				.select([
					'm.id as material',
					'm.name',
					'u.short as unit',
					'u.name as unit_name',
					'l.counted',
					'l.on_hand as was',
					'l.cost_each'
				])
				.where('l.count_id', '=', count.id)
				.orderBy('m.name')
				.execute();
			if (lines.length === 0)
				throw new Answer(problem('malformed', 'Nothing has been counted on it yet.'));

			const ids = lines.map((l) => l.material);
			await lockMaterials(tx, ids);
			const op = await tx.selectFrom('operator').select('stock_costing').executeTakeFirst();
			const shelf = await shelves(ids, tx);
			const now = (id: string) => onHandOf(shelf.get(id)!).toString();

			const outdated = lines.filter((l) => !onHandOf(shelf.get(l.material)!).eq(l.was));
			if (outdated.length > 0 && !keep)
				throw new Answer(
					problem(
						'changedMeanwhile',
						`${outdated.length === 1 ? `${outdated[0].name} has` : `${outdated.length} of what was counted have`} moved since it was counted. Say what to keep.`,
						{
							members: {
								moved: outdated.map((l) => ({
									material_id: l.material,
									name: l.name,
									unit: l.unit ?? l.unit_name,
									counted: l.counted,
									was: l.was,
									now: now(l.material)
								}))
							}
						}
					)
				);

			let adjusted = 0;
			for (const l of lines) {
				const after = shelfAfter({ counted: l.counted, was: l.was }, now(l.material), keep);
				const unit = l.unit ?? l.unit_name;
				if (after === null)
					throw new Answer(
						problem(
							'notAsThingsStand',
							`Keeping the difference found would leave less than none of ${l.name}: ${quantity(now(l.material))} ${unit} is on the shelf now. Keep what was counted instead.`
						)
					);
				const diff = after.sub(now(l.material));
				if (diff.isZero()) continue;
				await putRight(tx, {
					material: { id: l.material, name: l.name, unit },
					shelf: shelf.get(l.material)!,
					costing: op?.stock_costing ?? 'average',
					way: diff.lt(0) ? 'off' : 'on',
					qty: (diff.lt(0) ? diff.neg() : diff).toString(),
					madeOn: count.counted_on,
					reason: 'counted',
					note: null,
					costEach: diff.lt(0) ? null : l.cost_each,
					countId: count.id,
					userId
				});
				adjusted++;
			}
			await tx
				.updateTable('stock_count')
				.set({ applied_at: new Date(), applied_by: userId })
				.where('id', '=', count.id)
				.execute();
			return adjusted;
		});
		return Response.json({ adjusted: made });
	} catch (e) {
		if (e instanceof Answer) return e.response;
		if (e instanceof ShelfRefused)
			return problem('invalidField', e.why, { errors: { [e.field]: e.why } });
		throw e;
	}
};
