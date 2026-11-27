import { asUser, db } from '#lib/server/db/index.ts';
import { lockMaterials } from '#lib/server/adjust.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { pgError } from '#lib/server/field-errors.ts';
import { problem } from '#lib/server/problem.ts';
import { shelves } from '#lib/server/stock.ts';
import { UUID } from '#lib/field-rules.ts';
import { readBody } from '#lib/json.ts';
import { madeAt } from '#lib/server/made-at.ts';
import { readCountLine } from '#lib/count-fields.ts';
import { onHandOf } from '#lib/stock-draw.ts';
import type { RequestHandler } from './$types';

/** The count, if it is still being counted, and the material, with the places its unit counts in. */
async function find(countId: string, materialId: string) {
	const [count, m] = await Promise.all([
		db
			.selectFrom('stock_count')
			.select((eb) => ['id', eb('applied_at', 'is not', null).as('applied')])
			.where('id', '=', countId)
			.executeTakeFirst(),
		db
			.selectFrom('material as m')
			.innerJoin('unit as u', 'u.id', 'm.unit_id')
			.select(['m.id', 'u.places'])
			.where('m.id', '=', materialId)
			.executeTakeFirst()
	]);
	return { count, m };
}
const applied = () =>
	problem(
		'notAsThingsStand',
		'That count has been applied: what was counted on it stays as it was.'
	);

/**
 * One material counted (#lib/count-fields): how many are there, kept with what
 * the shelf said where it was counted -- what the page or the phone showed,
 * or the shelf now where it says nothing -- so stock that moves before the
 * count is applied is told. Counted again, it is changed; it is said by
 * whoever counted it last. Its row is locked as a draw locks it. From the
 * page or a phone's queue (#lib/queue): sending the same figure twice is the
 * same figure.
 */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id) || !UUID.test(params.material))
		return problem('notFound', 'No such count, or no such material.');
	const body = await readBody(request);
	const fields = body?.fields;
	if (!fields || typeof fields !== 'object' || Array.isArray(fields))
		return problem('malformed', 'Expected { fields: { counted, cost_each, on_hand } }.');
	const { count, m } = await find(params.id, params.material);
	if (!count || !m) return problem('notFound', 'No such count, or no such material.');
	if (count.applied) return applied();
	const { values, errors } = readCountLine(fields as Record<string, unknown>, m.places);
	if (Object.keys(errors).length > 0) return refuse(errors);

	try {
		const onHand = await asUser(
			locals.user!.id,
			async (tx) => {
				await lockMaterials(tx, [m.id]);
				// What the shelf said where it was counted, or says now.
				const onHand =
					values.on_hand !== null
						? String(values.on_hand)
						: onHandOf((await shelves([m.id], tx)).get(m.id)!).toString();
				const line = {
					counted: String(values.counted),
					on_hand: onHand,
					// A cost each is only for stock found where nothing on the shelf costs it.
					cost_each: values.cost_each === null ? null : String(values.cost_each),
					counted_by: locals.user!.id,
					counted_at: new Date()
				};
				await tx
					.insertInto('stock_count_line')
					.values({ count_id: count.id, material_id: m.id, ...line })
					.onConflict((oc) => oc.columns(['count_id', 'material_id']).doUpdateSet(line))
					.execute();
				return onHand;
			},
			madeAt(typeof body.made_at === 'string' ? body.made_at : '')
		);
		return Response.json({ saved: values, on_hand: onHand });
	} catch (e) {
		if (/stays as it was/.test(pgError(e).message ?? '')) return applied();
		throw e;
	}
};

/** One material no longer counted: the count leaves it as it is. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id) || !UUID.test(params.material))
		return problem('notFound', 'No such count, or no such material.');
	try {
		await asUser(locals.user!.id, (tx) =>
			tx
				.deleteFrom('stock_count_line')
				.where('count_id', '=', params.id)
				.where('material_id', '=', params.material)
				.execute()
		);
	} catch (e) {
		if (/stays as it was/.test(pgError(e).message ?? '')) return applied();
		throw e;
	}
	return new Response(null, { status: 204 });
};
