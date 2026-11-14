import { eq, inArray } from 'drizzle-orm';
import { asUser, db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { RECEIPT_TYPES } from '#lib/server/db/schema/catalogue.ts';
import { personalToday } from '#lib/server/calendar.ts';
import { pgError } from '#lib/server/field-errors.ts';
import { moneyPlaces } from '#lib/server/business.ts';
import { readReceipt } from '#lib/stock-fields.ts';
import { splitTax } from '#lib/receipt-split.ts';
import { UUID } from '#lib/field-rules.ts';

/** What the phone sends is shrunk to well under this; the column holds no more. */
export const MAX_RECEIPT = 2 * 1024 * 1024;

/** Each foreign key a receipt can break, and what it means to the person fixing it. */
const GONE: Record<string, [field: string, why: string]> = {
	material_lot_material_id_fkey: ['items', 'One of those materials no longer exists.'],
	stock_receipt_paid_by_fkey: ['paid_by', 'That person no longer exists.'],
	material_unit_id_fkey: ['items', 'One of those units no longer exists.']
};

/** The items, as a form sends them: a JSON list of what each says. */
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

export type Received =
	{ ok: true; id: string } | { ok: false; status: 400; errors: Record<string, string> };

/** The receipt made with this uuid, if one was. */
async function madeWith(clientUuid: string) {
	const [had] = await db
		.select({ id: t.stockReceipt.id })
		.from(t.stockReceipt)
		.where(eq(t.stockReceipt.clientUuid, clientUuid));
	return had?.id ?? null;
}

/**
 * STOCK RECEIVED, as a receipt or invoice says it: printed once, from whom,
 * the day, its number, who paid, the tax and the paper itself; and each item
 * on it, which becomes a lot with its share of the tax (#lib/stock-fields,
 * #lib/receipt-split). Something new to the catalogue becomes a material,
 * keeping the uuid a phone made for it (`material_uuid`), which a line
 * drawing from it names until it arrives.
 *
 * From the page, or from a phone's queue with no signal at the time (#lib/
 * queue): either way the form says the uuid it was made with, and a receipt
 * sent twice -- a retry after a timeout -- is answered with the one already
 * made. Retired materials are refused, as ERPNext refuses a disabled item on
 * a new entry.
 */
export async function receive(
	form: FormData,
	userId: string,
	madeAt: string | null = null
): Promise<Received> {
	const fields = Object.fromEntries(
		[...form.entries()].filter((e): e is [string, string] => typeof e[1] === 'string')
	);
	const clientUuid = fields.client_uuid ?? '';
	if (!UUID.test(clientUuid))
		return { ok: false, status: 400, errors: { client_uuid: 'The uuid it was made with.' } };
	const had = await madeWith(clientUuid);
	if (had) return { ok: true, id: had };

	const items = itemsIn(form.get('items'));
	if (!items)
		return { ok: false, status: 400, errors: { items: 'The items did not arrive whole.' } };

	// The places a quantity may have are its unit's: each material's, or the
	// one a new material is counted in.
	const ids = (k: string) =>
		[...new Set(items.map((i) => i[k]))].filter(
			(v): v is string => typeof v === 'string' && UUID.test(v)
		);
	const [ofMaterial, ofUnit, places] = await Promise.all([
		ids('material_id').length
			? db
					.select({
						id: t.material.id,
						name: t.material.name,
						places: t.unit.places,
						active: t.material.active
					})
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
	const retired = ofMaterial.find((m) => !m.active);
	if (retired && !errors.items)
		errors.items = `${retired.name} is retired. Offer it again from its record to receive it.`;
	// The uuid a phone made for something new, so a line already naming it finds it.
	const newUuid = (n: number) => {
		const v = items[n]?.material_uuid;
		return typeof v === 'string' && UUID.test(v) ? v : null;
	};

	const file = form.get('receipt');
	let receipt: { bytes: Buffer; type: string } | null = null;
	if (file instanceof File && file.size > 0) {
		if (!(RECEIPT_TYPES as readonly string[]).includes(file.type))
			errors.receipt = 'A photo, or a PDF.';
		else if (file.size > MAX_RECEIPT)
			errors.receipt = `Under 2 MB — that is ${(file.size / 1024 / 1024).toFixed(1)} MB.`;
		else receipt = { bytes: Buffer.from(await file.arrayBuffer()), type: file.type };
	}
	if (Object.keys(errors).length > 0) return { ok: false, status: 400, errors };

	// The receipt's tax, each item's share by what it cost (#lib/receipt-split).
	const tax = String(values.tax_paid);
	const shares = splitTax(
		tax,
		read.map((i) => i.cost),
		places
	);
	try {
		const id = await asUser(
			userId,
			async (tx) => {
				const [made] = await tx
					.insert(t.stockReceipt)
					.values({
						receivedOn: String(values.received_on),
						supplier: values.supplier === null ? null : String(values.supplier),
						reference: values.reference === null ? null : String(values.reference),
						paidBy: values.paid_by === null ? null : String(values.paid_by),
						taxPaid: tax,
						receipt: receipt?.bytes ?? null,
						receiptType: receipt?.type ?? null,
						clientUuid
					})
					.returning({ id: t.stockReceipt.id });
				for (const [n, item] of read.entries()) {
					let materialId = item.material_id;
					if (item.material) {
						const [fresh] = await tx
							.insert(t.material)
							.values({
								name: item.material.name,
								unitId: item.material.unit_id,
								clientUuid: newUuid(n)
							})
							.returning({ id: t.material.id });
						materialId = fresh.id;
					}
					await tx.insert(t.materialLot).values({
						receiptId: made.id,
						materialId: materialId!,
						receivedOn: String(values.received_on),
						qtyReceived: item.qty,
						qtyRemaining: item.qty,
						exTaxCost: item.cost,
						taxPaid: shares[n]
					});
				}
				return made.id;
			},
			madeAt
		);
		return { ok: true, id };
	} catch (e) {
		const pg = pgError(e);
		// Sent twice at once: the other one made it.
		if (pg.constraint === 'stock_receipt_client_uuid_key') {
			const id = await madeWith(clientUuid);
			if (id) return { ok: true, id };
		}
		if (pg.constraint === 'material_client_uuid_key')
			return {
				ok: false,
				status: 400,
				errors: { items: 'Something new on it is already in the catalogue from another receipt.' }
			};
		const gone = pg.code === '23503' ? GONE[pg.constraint ?? ''] : undefined;
		if (gone) return { ok: false, status: 400, errors: { [gone[0]]: gone[1] } };
		throw e;
	}
}
