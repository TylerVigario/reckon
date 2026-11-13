import { and, eq, inArray, or } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { UUID } from '#lib/field-rules.ts';
import type { MaterialHistoryRow } from '#lib/material-history.ts';
import type { PageServerLoad } from './$types';

/**
 * Everything a material has been, and sold at: its History tab, from the rows
 * record_history keeps for it and for its prices (#lib/material-history), with
 * who made each change and the units it was counted in by their names.
 */
export const load: PageServerLoad = async ({ params }) => {
	const h = t.recordHistory;
	const prices = await db
		.select({ id: t.materialPrice.id, from: t.materialPrice.effectiveFrom })
		.from(t.materialPrice)
		.where(eq(t.materialPrice.materialId, params.id));
	const fromOf = new Map(prices.map((p) => [p.id, p.from]));
	const rows = await db
		.select({
			table: h.tableName,
			row: h.rowId,
			field: h.field,
			old_value: h.oldValue,
			new_value: h.newValue,
			changed_by: h.changedBy,
			changed_at: h.changedAt,
			xact: h.xact
		})
		.from(h)
		.where(
			or(
				and(eq(h.tableName, 'material'), eq(h.rowId, params.id)),
				prices.length
					? and(
							eq(h.tableName, 'material_price'),
							inArray(
								h.rowId,
								prices.map((p) => p.id)
							)
						)
					: undefined
			)
		);

	const ids = (pick: (r: (typeof rows)[number]) => (string | null)[]) => [
		...new Set(rows.flatMap(pick).filter((x): x is string => !!x && UUID.test(x)))
	];
	const people = ids((r) => [r.changed_by]);
	// What it was counted in: changed, or as it was added.
	const added = (v: string | null) => {
		try {
			const unit = (JSON.parse(v ?? '{}') as { unit_id?: unknown }).unit_id;
			return typeof unit === 'string' ? unit : null;
		} catch {
			return null;
		}
	};
	const units = ids((r) =>
		r.field === 'unit_id'
			? [r.old_value, r.new_value]
			: r.table === 'material' && r.field === '(added)'
				? [added(r.new_value)]
				: []
	);
	const [named, counted] = await Promise.all([
		people.length
			? db
					.select({ id: t.user.id, name: t.user.name })
					.from(t.user)
					.where(inArray(t.user.id, people))
			: [],
		units.length
			? db
					.select({ id: t.unit.id, name: t.unit.name })
					.from(t.unit)
					.where(inArray(t.unit.id, units))
			: []
	]);
	return {
		rows: rows.map((r): MaterialHistoryRow => ({
			table: r.table === 'material_price' ? 'material_price' : 'material',
			field: r.field,
			old_value: r.old_value,
			new_value: r.new_value,
			changed_by: r.changed_by,
			changed_at: r.changed_at.toISOString(),
			xact: r.xact,
			effective_from: fromOf.get(r.row) ?? null
		})),
		people: Object.fromEntries(named.map((p) => [p.id, p.name])),
		units: Object.fromEntries(counted.map((u) => [u.id, u.name]))
	};
};
