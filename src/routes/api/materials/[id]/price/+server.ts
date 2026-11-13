import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { asUser, db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { problem } from '#lib/server/problem.ts';
import { UUID } from '#lib/field-rules.ts';
import { readFields } from '#lib/json.ts';
import { readPricing } from '#lib/material-fields.ts';
import type { RequestHandler } from './$types';

/**
 * What a material sells at, from today (#lib/material-fields readPricing): the
 * business's markup over what one cost, a markup of its own, or a set price a
 * unit. Lines already on a draft keep what they were priced at.
 *
 * A set price is a row from today (material_price), today's replaced if it is
 * changed again the same day; a return to a markup is a row with no price, so
 * the price it had stays in its history rather than being taken away. The
 * markup of its own is the material's (markup_pct); the business's is none.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No material with that id.');
	const fields = await readFields(request);
	if (!fields) return problem('malformed', 400, 'Expected { fields: { by, markup_pct, price } }.');
	const { values, errors } = readPricing(fields);
	if (Object.keys(errors).length > 0) return refuse(errors);

	const [m] = await db
		.select({ id: t.material.id, markup: t.material.markupPct })
		.from(t.material)
		.where(eq(t.material.id, params.id));
	if (!m) return problem('notFound', 404, 'No material with that id.');

	const today = businessToday();
	await asUser(locals.user!.id, async (tx) => {
		const [listed] = await tx
			.select({ price: t.materialPrice.price })
			.from(t.materialPrice)
			.where(
				and(
					eq(t.materialPrice.materialId, m.id),
					lte(t.materialPrice.effectiveFrom, sql`${today}::date`)
				)
			)
			.orderBy(desc(t.materialPrice.effectiveFrom))
			.limit(1);
		const price = values.by === 'price' ? String(values.price) : null;
		// A set price from today, or the end of one in force: a row either way.
		if (price !== null || (listed && listed.price !== null))
			await tx
				.insert(t.materialPrice)
				.values({ materialId: m.id, price, effectiveFrom: today })
				.onConflictDoUpdate({
					target: [t.materialPrice.materialId, t.materialPrice.effectiveFrom],
					set: { price }
				});
		if (values.by !== 'price') {
			const markup = values.by === 'markup' ? String(values.markup_pct) : null;
			if (markup !== m.markup)
				await tx.update(t.material).set({ markupPct: markup }).where(eq(t.material.id, m.id));
		}
	});
	return Response.json({ saved: values });
};
