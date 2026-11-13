import { and, eq, sql } from 'drizzle-orm';
import { asUser, db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { lockMaterials } from '#lib/server/adjust.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { pgError } from '#lib/server/field-errors.ts';
import { problem } from '#lib/server/problem.ts';
import { shelves } from '#lib/server/stock.ts';
import { UUID } from '#lib/field-rules.ts';
import { readFields } from '#lib/json.ts';
import { readCountLine } from '#lib/count-fields.ts';
import { onHandOf } from '#lib/stock-draw.ts';
import type { RequestHandler } from './$types';

/** The count, if it is still being counted, and the material, with the places its unit counts in. */
async function find(countId: string, materialId: string) {
	const [[count], [m]] = await Promise.all([
		db
			.select({ id: t.stockCount.id, applied: sql<boolean>`${t.stockCount.appliedAt} is not null` })
			.from(t.stockCount)
			.where(eq(t.stockCount.id, countId)),
		db
			.select({ id: t.material.id, places: t.unit.places })
			.from(t.material)
			.innerJoin(t.unit, eq(t.unit.id, t.material.unitId))
			.where(eq(t.material.id, materialId))
	]);
	return { count, m };
}
const applied = () =>
	problem('conflict', 409, 'That count has been applied: what was counted on it stays as it was.');

/**
 * One material counted (#lib/count-fields): how many are there, kept with what
 * the shelf said at that moment, so stock that moves before the count is
 * applied is told. Counted again, it is changed; it is said by whoever counted
 * it last. Its row is locked while the shelf is read, as a draw locks it.
 */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id) || !UUID.test(params.material))
		return problem('notFound', 404, 'No such count, or no such material.');
	const fields = await readFields(request);
	if (!fields) return problem('malformed', 400, 'Expected { fields: { counted, cost_each } }.');
	const { count, m } = await find(params.id, params.material);
	if (!count || !m) return problem('notFound', 404, 'No such count, or no such material.');
	if (count.applied) return applied();
	const { values, errors } = readCountLine(fields, m.places);
	if (Object.keys(errors).length > 0) return refuse(errors);

	try {
		const onHand = await asUser(locals.user!.id, async (tx) => {
			await lockMaterials(tx, [m.id]);
			const shelf = (await shelves([m.id], tx)).get(m.id)!;
			const onHand = onHandOf(shelf).toString();
			const line = {
				counted: String(values.counted),
				onHand,
				// A cost each is only for stock found where nothing on the shelf costs it.
				costEach: values.cost_each === null ? null : String(values.cost_each),
				countedBy: locals.user!.id,
				countedAt: new Date()
			};
			await tx
				.insert(t.stockCountLine)
				.values({ countId: count.id, materialId: m.id, ...line })
				.onConflictDoUpdate({
					target: [t.stockCountLine.countId, t.stockCountLine.materialId],
					set: line
				});
			return onHand;
		});
		return Response.json({ saved: values, on_hand: onHand });
	} catch (e) {
		if (/stays as it was/.test(pgError(e).message ?? '')) return applied();
		throw e;
	}
};

/** One material no longer counted: the count leaves it as it is. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id) || !UUID.test(params.material))
		return problem('notFound', 404, 'No such count, or no such material.');
	try {
		await asUser(locals.user!.id, (tx) =>
			tx
				.delete(t.stockCountLine)
				.where(
					and(
						eq(t.stockCountLine.countId, params.id),
						eq(t.stockCountLine.materialId, params.material)
					)
				)
		);
	} catch (e) {
		if (/stays as it was/.test(pgError(e).message ?? '')) return applied();
		throw e;
	}
	return new Response(null, { status: 204 });
};
