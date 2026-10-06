import { fail, redirect } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { asUser, db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { RECEIPT_TYPES } from '#lib/server/db/schema/catalogue.ts';
import { personalToday } from '#lib/server/calendar.ts';
import { pgError } from '#lib/server/field-errors.ts';
import { readLot } from '#lib/stock-fields.ts';
import { UUID } from '#lib/field-rules.ts';
import type { Actions, PageServerLoad } from './$types';

/** What the phone sends is shrunk to well under this; the column holds no more. */
const MAX_RECEIPT = 2 * 1024 * 1024;

/**
 * Stock received: what arrived, from whom, what all of it cost before tax and
 * in tax as the receipt says them, who paid, and the receipt itself.
 *
 * A file is not a field, so this is a form action, as the logo is. The page
 * shrinks a photo before it is sent; this checks what arrives regardless.
 */
export const load: PageServerLoad = async ({ url }) => {
	const [materials, units, people, [op]] = await Promise.all([
		db
			.select({
				id: t.material.id,
				name: t.material.name,
				unit_id: t.material.unitId,
				markup_pct: t.material.markupPct
			})
			.from(t.material)
			.where(eq(t.material.active, true))
			.orderBy(asc(t.material.name)),
		db
			.select({ id: t.unit.id, name: t.unit.name, short: t.unit.short, places: t.unit.places })
			.from(t.unit)
			.orderBy(asc(t.unit.name)),
		db
			.select({ id: t.user.id, name: t.user.name })
			.from(t.user)
			.where(eq(t.user.active, true))
			.orderBy(asc(t.user.name)),
		db.select({ markup: t.operator.defaultMarkupPct }).from(t.operator)
	]);
	const asked = url.searchParams.get('material');
	return {
		materials,
		units,
		people,
		markup: op?.markup ?? '0',
		today: personalToday(),
		material: asked && materials.some((m) => m.id === asked) ? asked : null
	};
};

/** Each foreign key a lot can break, and what it means to the person fixing it. */
const GONE: Record<string, [field: string, why: string]> = {
	material_lot_material_id_fkey: ['material_id', 'That material no longer exists.'],
	material_lot_paid_by_fkey: ['paid_by', 'That person no longer exists.'],
	material_unit_id_fkey: ['unit_id', 'That unit no longer exists.']
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const form = await request.formData();
		const fields = Object.fromEntries(
			[...form.entries()].filter((e): e is [string, string] => typeof e[1] === 'string')
		);

		// The places a quantity may have are its unit's: the material's, or the
		// one a new material is counted in.
		const material = typeof fields.material_id === 'string' ? fields.material_id : '';
		const unitId = typeof fields.unit_id === 'string' ? fields.unit_id : '';
		const [unit] = UUID.test(material)
			? await db
					.select({ places: t.unit.places })
					.from(t.material)
					.innerJoin(t.unit, eq(t.unit.id, t.material.unitId))
					.where(eq(t.material.id, material))
			: UUID.test(unitId)
				? await db.select({ places: t.unit.places }).from(t.unit).where(eq(t.unit.id, unitId))
				: [];
		const { values, material: fresh, errors } = readLot(fields, unit?.places ?? null);
		if (typeof values.received_on === 'string' && values.received_on > personalToday())
			errors.received_on = 'It cannot have arrived after today.';

		const file = form.get('receipt');
		let receipt: { bytes: Buffer; type: string } | null = null;
		if (file instanceof File && file.size > 0) {
			if (!(RECEIPT_TYPES as readonly string[]).includes(file.type))
				errors.receipt = 'A photo, or a PDF.';
			else if (file.size > MAX_RECEIPT)
				errors.receipt = `Under 2 MB — that is ${(file.size / 1024 / 1024).toFixed(1)} MB.`;
			else receipt = { bytes: Buffer.from(await file.arrayBuffer()), type: file.type };
		}
		if (Object.keys(errors).length > 0) return fail(400, { errors });

		let materialId = String(values.material_id ?? '');
		try {
			await asUser(locals.user!.id, async (tx) => {
				if (fresh) {
					const [made] = await tx
						.insert(t.material)
						.values({ name: String(fresh.name), unitId: String(fresh.unit_id) })
						.returning({ id: t.material.id });
					materialId = made.id;
				}
				await tx.insert(t.materialLot).values({
					materialId,
					receivedOn: String(values.received_on),
					supplier: values.supplier === null ? null : String(values.supplier),
					qtyReceived: String(values.qty_received),
					qtyRemaining: String(values.qty_received),
					exTaxCost: String(values.ex_tax_cost),
					taxPaid: String(values.tax_paid),
					paidBy: values.paid_by === null ? null : String(values.paid_by),
					receipt: receipt?.bytes ?? null,
					receiptType: receipt?.type ?? null
				});
			});
		} catch (e) {
			const pg = pgError(e);
			const gone = pg.code === '23503' ? GONE[pg.constraint ?? ''] : undefined;
			if (gone) return fail(400, { errors: { [gone[0]]: gone[1] } });
			throw e;
		}
		redirect(303, `/catalogue/materials/${materialId}`);
	}
};
