import { fail, redirect } from '@sveltejs/kit';
import { asc, eq, inArray } from 'drizzle-orm';
import { asUser, db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { RECEIPT_TYPES } from '#lib/server/db/schema/catalogue.ts';
import { personalToday } from '#lib/server/calendar.ts';
import { pgError } from '#lib/server/field-errors.ts';
import { readReceipt } from '#lib/stock-fields.ts';
import { splitTax } from '#lib/receipt-split.ts';
import { moneyPlaces } from '#lib/server/business.ts';
import { UUID } from '#lib/field-rules.ts';
import type { Actions, PageServerLoad } from './$types';

/** What the phone sends is shrunk to well under this; the column holds no more. */
const MAX_RECEIPT = 2 * 1024 * 1024;

/**
 * Stock received, as a receipt or invoice says it: printed once, from whom,
 * the day, its number, who paid, the tax and the paper itself; and each item
 * on it, which becomes a lot with its share of the tax (#lib/stock-fields,
 * #lib/receipt-split).
 *
 * A file is not a field, so this is a form action, as the logo is. The page
 * shrinks a photo before it is sent; this checks what arrives regardless.
 */
export const load: PageServerLoad = async ({ url }) => {
	const [materials, units, people, [op], places] = await Promise.all([
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
		db.select({ markup: t.operator.defaultMarkupPct }).from(t.operator),
		moneyPlaces()
	]);
	const asked = url.searchParams.get('material');
	return {
		materials,
		units,
		people,
		markup: op?.markup ?? '0',
		today: personalToday(),
		// What an item's cost is rounded to, as the server rounds it.
		places,
		material: asked && materials.some((m) => m.id === asked) ? asked : null
	};
};

/** Each foreign key a receipt can break, and what it means to the person fixing it. */
const GONE: Record<string, [field: string, why: string]> = {
	material_lot_material_id_fkey: ['items', 'One of those materials no longer exists.'],
	stock_receipt_paid_by_fkey: ['paid_by', 'That person no longer exists.'],
	material_unit_id_fkey: ['items', 'One of those units no longer exists.']
};

/** The items, as the form sends them: a JSON list of what each says. */
function itemsIn(raw: FormDataEntryValue | null): Record<string, unknown>[] | null {
	if (typeof raw !== 'string') return null;
	try {
		const list: unknown = JSON.parse(raw);
		return Array.isArray(list) &&
			list.every((x) => typeof x === 'object' && x !== null && !Array.isArray(x))
			? (list as Record<string, unknown>[])
			: null;
	} catch {
		return null;
	}
}

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const form = await request.formData();
		const fields = Object.fromEntries(
			[...form.entries()].filter((e): e is [string, string] => typeof e[1] === 'string')
		);
		const items = itemsIn(form.get('items'));
		if (!items) return fail(400, { errors: { items: 'The items did not arrive whole.' } });

		// The places a quantity may have are its unit's: each material's, or the
		// one a new material is counted in.
		const ids = (k: string) =>
			[...new Set(items.map((i) => i[k]))].filter(
				(v): v is string => typeof v === 'string' && UUID.test(v)
			);
		const [ofMaterial, ofUnit, places] = await Promise.all([
			ids('material_id').length
				? db
						.select({ id: t.material.id, places: t.unit.places })
						.from(t.material)
						.innerJoin(t.unit, eq(t.unit.id, t.material.unitId))
						.where(inArray(t.material.id, ids('material_id')))
				: [],
			ids('unit_id').length
				? db
						.select({ id: t.unit.id, places: t.unit.places })
						.from(t.unit)
						.where(inArray(t.unit.id, ids('unit_id')))
				: [],
			moneyPlaces()
		]);
		const placesOf = (item: Record<string, unknown>) =>
			ofMaterial.find((m) => m.id === item.material_id)?.places ??
			ofUnit.find((u) => u.id === item.unit_id)?.places ??
			null;
		const { values, items: read, errors } = readReceipt(fields, items, placesOf, places);
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

		// The receipt's tax, each item's share by what it cost (#lib/receipt-split).
		const tax = String(values.tax_paid);
		const shares = splitTax(
			tax,
			read.map((i) => i.cost),
			places
		);
		let receiptId = '';
		try {
			await asUser(locals.user!.id, async (tx) => {
				const [made] = await tx
					.insert(t.stockReceipt)
					.values({
						receivedOn: String(values.received_on),
						supplier: values.supplier === null ? null : String(values.supplier),
						reference: values.reference === null ? null : String(values.reference),
						paidBy: values.paid_by === null ? null : String(values.paid_by),
						taxPaid: tax,
						receipt: receipt?.bytes ?? null,
						receiptType: receipt?.type ?? null
					})
					.returning({ id: t.stockReceipt.id });
				receiptId = made.id;
				for (const [n, item] of read.entries()) {
					let materialId = item.material_id;
					if (item.material) {
						const [fresh] = await tx
							.insert(t.material)
							.values({ name: item.material.name, unitId: item.material.unit_id })
							.returning({ id: t.material.id });
						materialId = fresh.id;
					}
					await tx.insert(t.materialLot).values({
						receiptId,
						materialId: materialId!,
						receivedOn: String(values.received_on),
						qtyReceived: item.qty,
						qtyRemaining: item.qty,
						exTaxCost: item.cost,
						taxPaid: shares[n]
					});
				}
			});
		} catch (e) {
			const pg = pgError(e);
			const gone = pg.code === '23503' ? GONE[pg.constraint ?? ''] : undefined;
			if (gone) return fail(400, { errors: { [gone[0]]: gone[1] } });
			throw e;
		}
		redirect(303, `/catalogue/receipts/${receiptId}`);
	}
};
