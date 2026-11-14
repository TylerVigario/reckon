import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { asUser, db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { problem } from '#lib/server/problem.ts';
import { UUID } from '#lib/field-rules.ts';
import { readBody } from '#lib/json.ts';
import { pricedBy, readPricing, type Pricing } from '#lib/material-fields.ts';
import { isoDate } from '#lib/field-rules.ts';
import { madeAt } from '#lib/server/made-at.ts';
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
 *
 * WHAT IT BEGAN FROM. A pricing may say what the material sold at when it
 * began (base): one changed since to something other than this is a choice
 * for a person, not this save's to overwrite -- refused, with what it is now,
 * as a field changed meanwhile is (409). From a phone with no signal it also
 * says the day it was set there (from), no later than today, and when.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No material with that id.');
	const body = await readBody(request);
	const fields = body?.fields;
	if (!fields || typeof fields !== 'object' || Array.isArray(fields))
		return problem('malformed', 400, 'Expected { fields: { by, markup_pct, price } }.');
	const { values, errors } = readPricing(fields as Record<string, unknown>);
	if (Object.keys(errors).length > 0) return refuse(errors);

	const [m] = await db
		.select({ id: t.material.id, markup: t.material.markupPct })
		.from(t.material)
		.where(eq(t.material.id, params.id));
	if (!m) return problem('notFound', 404, 'No material with that id.');

	const today = businessToday();
	const said = typeof body.from === 'string' ? isoDate(body.from) : null;
	const from = said?.ok && String(said.value) <= today ? String(said.value) : today;
	const [inForce] = await db
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
	const now = pricedBy({ markup_pct: m.markup, listed: inForce?.price ?? null });
	const mine = pricedBy({
		markup_pct: values.by === 'markup' ? String(values.markup_pct) : null,
		listed: values.by === 'price' ? String(values.price) : null
	});
	const base = body.base as Partial<Pricing> | undefined;
	if (base && typeof base === 'object') {
		// Empty is none, as the form sends it.
		const was = pricedBy({ markup_pct: base.markup_pct || null, listed: base.price || null });
		if (!samePricing(now, was) && !samePricing(now, mine))
			return problem(
				'conflict',
				409,
				'What it sells at was changed meanwhile. Save puts yours over it; Cancel keeps theirs.',
				{ members: { conflict: { field: 'pricing', theirs: now } } }
			);
	}

	// From the day it was set -- unless a price was set for a later day since,
	// which this is put over, so it is from today.
	const [later] = await db
		.select({ on: t.materialPrice.effectiveFrom })
		.from(t.materialPrice)
		.where(
			and(
				eq(t.materialPrice.materialId, m.id),
				sql`${t.materialPrice.effectiveFrom} > ${from}::date`,
				lte(t.materialPrice.effectiveFrom, sql`${today}::date`)
			)
		)
		.limit(1);
	const on = later ? today : from;

	await asUser(
		locals.user!.id,
		async (tx) => {
			const [listed] = await tx
				.select({ price: t.materialPrice.price })
				.from(t.materialPrice)
				.where(
					and(
						eq(t.materialPrice.materialId, m.id),
						lte(t.materialPrice.effectiveFrom, sql`${on}::date`)
					)
				)
				.orderBy(desc(t.materialPrice.effectiveFrom))
				.limit(1);
			const price = values.by === 'price' ? String(values.price) : null;
			// A set price from the day, or the end of one in force: a row either way.
			if (price !== null || (listed && listed.price !== null))
				await tx
					.insert(t.materialPrice)
					.values({ materialId: m.id, price, effectiveFrom: on })
					.onConflictDoUpdate({
						target: [t.materialPrice.materialId, t.materialPrice.effectiveFrom],
						set: { price }
					});
			if (values.by !== 'price') {
				const markup = values.by === 'markup' ? String(values.markup_pct) : null;
				if (markup !== m.markup)
					await tx.update(t.material).set({ markupPct: markup }).where(eq(t.material.id, m.id));
			}
		},
		madeAt(typeof body.made_at === 'string' ? body.made_at : '')
	);
	return Response.json({ saved: values });
};

/** Two pricings that sell it the same way. */
const samePricing = (a: Pricing, b: Pricing) =>
	a.by === b.by &&
	(a.by !== 'markup' || Number(a.markup_pct) === Number(b.markup_pct)) &&
	(a.by !== 'price' || Number(a.price) === Number(b.price));
