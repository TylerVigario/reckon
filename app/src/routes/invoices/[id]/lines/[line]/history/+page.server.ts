import { error } from '@sveltejs/kit';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { UUID } from '#lib/field-rules.ts';
import type { PageServerLoad } from './$types';

/**
 * One line's whole history, oldest first (#lib/line-history), from
 * record_history -- which keeps it after the line is taken off, so this opens
 * for a line that is gone as well as one that is there.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!UUID.test(params.id) || !UUID.test(params.line)) error(404, 'no such line');
	const h = t.recordHistory;
	const [rows, [draft], [line]] = await Promise.all([
		db
			.select({
				field: h.field,
				old_value: h.oldValue,
				new_value: h.newValue,
				changed_by: h.changedBy,
				changed_at: h.changedAt
			})
			.from(h)
			.where(and(eq(h.tableName, 'invoice_line'), eq(h.rowId, params.line)))
			.orderBy(asc(h.changedAt), asc(h.id)),
		db
			.select({ id: t.invoice.id, number: t.invoice.number, status: t.invoice.status })
			.from(t.invoice)
			.where(eq(t.invoice.id, params.id)),
		db
			.select({
				id: t.invoiceLine.id,
				description: t.invoiceLine.description,
				unit: t.invoiceLine.unit
			})
			.from(t.invoiceLine)
			.where(and(eq(t.invoiceLine.id, params.line), eq(t.invoiceLine.invoiceId, params.id)))
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
					.select({ id: t.user.id, name: t.user.name })
					.from(t.user)
					.where(inArray(t.user.id, people))
			: [],
		places.length
			? db
					.select({ id: t.site.id, name: t.site.display })
					.from(t.site)
					.where(inArray(t.site.id, places))
			: []
	]);
	return {
		draft,
		line: line ?? null,
		rows: rows.map((r) => ({ ...r, changed_at: r.changed_at.toISOString() })),
		people: Object.fromEntries(named.map((p) => [p.id, p.name])),
		sites: Object.fromEntries(sites.map((s) => [s.id, s.name ?? '']))
	};
};
