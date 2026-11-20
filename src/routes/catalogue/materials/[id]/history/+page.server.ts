import { db } from '#lib/server/db/index.ts';
import { UUID } from '#lib/field-rules.ts';
import type { MaterialHistoryRow } from '#lib/material-history.ts';
import { kindChoices } from '#lib/server/sale-kinds.ts';
import type { PageServerLoad } from './$types';

/**
 * Everything a material has been, and sold at: its History tab, from the rows
 * record_history keeps for it and for its prices (#lib/material-history), with
 * who made each change and the units it was counted in by their names.
 */
export const load: PageServerLoad = async ({ params }) => {
	const prices = await db
		.selectFrom('material_price')
		.select(['id', 'effective_from'])
		.where('material_id', '=', params.id)
		.execute();
	const fromOf = new Map(prices.map((p) => [p.id, p.effective_from]));
	const rows = await db
		.selectFrom('record_history as h')
		.select([
			'h.table_name as table',
			'h.row_id as row',
			'h.field',
			'h.old_value',
			'h.new_value',
			'h.changed_by',
			'h.changed_at',
			'h.xact'
		])
		.where((eb) =>
			eb.or([
				eb.and([eb('h.table_name', '=', 'material'), eb('h.row_id', '=', params.id)]),
				eb.and([
					eb('h.table_name', '=', 'material_price'),
					eb('h.row_id', '=', eb.fn.any(eb.val(prices.map((p) => p.id))))
				])
			])
		)
		.execute();

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
					.selectFrom('user')
					.select(['id', 'name'])
					.where('id', '=', (eb) => eb.fn.any(eb.val(people)))
					.execute()
			: [],
		units.length
			? db
					.selectFrom('unit')
					.select(['id', 'name'])
					.where('id', '=', (eb) => eb.fn.any(eb.val(units)))
					.execute()
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
			// A bigint arrives as a string; the page takes the number.
			xact: r.xact === null ? null : Number(r.xact),
			effective_from: fromOf.get(r.row) ?? null
		})),
		people: Object.fromEntries(named.map((p) => [p.id, p.name])),
		units: Object.fromEntries(counted.map((u) => [u.id, u.name])),
		// What it was sold as, by the business's word for each kind.
		kinds: Object.fromEntries((await kindChoices(db)).map((k) => [k.id, k.name]))
	};
};
