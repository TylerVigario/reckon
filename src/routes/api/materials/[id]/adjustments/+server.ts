import { and, eq } from 'drizzle-orm';
import { lockMaterials, putRight, ShelfRefused } from '#lib/server/adjust.ts';
import { asUser, db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { problem } from '#lib/server/problem.ts';
import { personalToday } from '#lib/server/calendar.ts';
import { shelves } from '#lib/server/stock.ts';
import { UUID } from '#lib/field-rules.ts';
import { readBody } from '#lib/json.ts';
import { madeAt } from '#lib/server/made-at.ts';
import { pgError } from '#lib/server/field-errors.ts';
import { readAdjustment } from '#lib/adjust-fields.ts';
import type { RequestHandler } from './$types';

/**
 * Stock put right by hand (#lib/adjust-fields): so much of one material taken
 * off the shelf, or put on it, on a day, for a reason.
 *
 * A take comes off the oldest lots at what it cost, and a find goes on at
 * what one on the shelf is worth now, or a cost each said (#lib/server/adjust).
 * The material's row is locked first, as a line's draw locks it, so two
 * adjustments, or an adjustment and a draw, are made one after the other.
 *
 * From the page or a phone's queue (#lib/queue), with the uuid it was made
 * with and, from a phone, when: one sent twice -- a retry after a timeout --
 * is answered with the one already made. What the shelf no longer allows when
 * it arrives is a refusal the phone keeps, to be fixed or let go.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No material with that id.');
	const body = await readBody(request);
	const fields = body?.fields;
	if (!fields || typeof fields !== 'object' || Array.isArray(fields))
		return problem('malformed', 400, 'Expected { fields: { name: value }, client_uuid }.');
	const clientUuid = typeof body.client_uuid === 'string' ? body.client_uuid : '';
	if (!UUID.test(clientUuid)) return refuse({ client_uuid: 'The uuid it was made with.' });
	const userId = locals.user!.id;
	const had = await madeWith(userId, clientUuid);
	if (had) return Response.json({ id: had });

	const [m] = await db
		.select({
			id: t.material.id,
			name: t.material.name,
			places: t.unit.places,
			short: t.unit.short,
			unit: t.unit.name
		})
		.from(t.material)
		.innerJoin(t.unit, eq(t.unit.id, t.material.unitId))
		.where(eq(t.material.id, params.id));
	if (!m) return problem('notFound', 404, 'No material with that id.');

	const { values, errors } = readAdjustment(fields as Record<string, unknown>, m.places);
	if (typeof values.made_on === 'string' && values.made_on > personalToday())
		errors.made_on = 'It cannot be put right before it happens.';
	if (Object.keys(errors).length > 0) return refuse(errors);

	const [op] = await db.select({ costing: t.operator.stockCosting }).from(t.operator);
	try {
		const id = await asUser(
			userId,
			async (tx) => {
				await lockMaterials(tx, [m.id]);
				const shelf = (await shelves([m.id], tx)).get(m.id)!;
				return putRight(tx, {
					material: { id: m.id, name: m.name, unit: m.short ?? m.unit },
					shelf,
					costing: op?.costing ?? 'average',
					way: values.way as 'off' | 'on',
					qty: String(values.qty),
					madeOn: String(values.made_on),
					reason: values.reason as 'used',
					note: values.note === null ? null : String(values.note),
					costEach: values.cost_each === null ? null : String(values.cost_each),
					clientUuid,
					userId
				});
			},
			madeAt(typeof body.made_at === 'string' ? body.made_at : '')
		);
		return Response.json({ id }, { status: 201 });
	} catch (e) {
		if (e instanceof ShelfRefused) return refuse({ [e.field]: e.why });
		// Sent twice at once: the other one made it.
		if (pgError(e).constraint === 'stock_adjustment_created_by_client_uuid_key') {
			const id = await madeWith(userId, clientUuid);
			if (id) return Response.json({ id });
		}
		throw e;
	}
};

/** The adjustment this person made with this uuid, if they made one. */
async function madeWith(userId: string, clientUuid: string) {
	const [had] = await db
		.select({ id: t.stockAdjustment.id })
		.from(t.stockAdjustment)
		.where(
			and(eq(t.stockAdjustment.createdBy, userId), eq(t.stockAdjustment.clientUuid, clientUuid))
		);
	return had?.id ?? null;
}
