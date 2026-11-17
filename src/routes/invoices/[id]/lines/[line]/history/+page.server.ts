import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { UUID } from '#lib/field-rules.ts';
import type { PageServerLoad } from './$types';

/**
 * One line's whole history, oldest first (#lib/line-history), from
 * record_history -- which keeps it after the line is taken off, so this opens
 * for a line that is gone as well as one that is there.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!UUID.test(params.id) || !UUID.test(params.line)) error(404, 'no such line');
	const [rows, draft, line] = await Promise.all([
		db
			.selectFrom('record_history')
			.select(['field', 'old_value', 'new_value', 'changed_by', 'changed_at', 'made_at'])
			.where('table_name', '=', 'invoice_line')
			.where('row_id', '=', params.line)
			.orderBy('changed_at')
			.orderBy('id')
			.execute(),
		db
			.selectFrom('invoice')
			.select(['id', 'number', 'status'])
			.where('id', '=', params.id)
			.executeTakeFirst(),
		db
			.selectFrom('invoice_line')
			.select(['id', 'description', 'unit'])
			.where('id', '=', params.line)
			.where('invoice_id', '=', params.id)
			.executeTakeFirst()
	]);
	if (!draft || (!line && rows.length === 0)) error(404, 'no such line');

	// Who did each, and the places and people the values name, by their names.
	const ids = (pick: (r: (typeof rows)[number]) => (string | null)[]) => [
		...new Set(rows.flatMap(pick).filter((x): x is string => !!x && UUID.test(x)))
	];
	const people = ids((r) => [
		r.changed_by,
		...(r.field === 'paid_by' ? [r.old_value, r.new_value] : [])
	]);
	// A line added or taken off is written whole; its site is inside.
	const whole = (v: string | null) => {
		try {
			const site = (JSON.parse(v ?? '{}') as { site_id?: unknown }).site_id;
			return typeof site === 'string' ? site : null;
		} catch {
			return null;
		}
	};
	const places = ids((r) =>
		r.field === 'site_id'
			? [r.old_value, r.new_value]
			: r.field.startsWith('(')
				? [whole(r.old_value), whole(r.new_value)]
				: []
	);
	const [named, sites] = await Promise.all([
		people.length
			? db
					.selectFrom('user')
					.select(['id', 'name'])
					.where('id', '=', (eb) => eb.fn.any(eb.val(people)))
					.execute()
			: [],
		places.length
			? db
					.selectFrom('site')
					.select(['id', 'display as name'])
					.where('id', '=', (eb) => eb.fn.any(eb.val(places)))
					.execute()
			: []
	]);
	return {
		draft,
		line: line ?? null,
		rows: rows.map((r) => ({
			...r,
			changed_at: r.changed_at.toISOString(),
			made_at: r.made_at?.toISOString() ?? null
		})),
		people: Object.fromEntries(named.map((p) => [p.id, p.name])),
		sites: Object.fromEntries(sites.map((s) => [s.id, s.name ?? '']))
	};
};
