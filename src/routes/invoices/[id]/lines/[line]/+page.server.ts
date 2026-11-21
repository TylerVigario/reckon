import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { claimsResold } from '#lib/server/tax-registrations.ts';
import { UUID } from '#lib/field-rules.ts';
import { formFieldsOf } from '#lib/server/lines.ts';
import { moneyPlaces } from '#lib/server/business.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import { refusedForAccess } from '#lib/server/refused.ts';
import type { PageServerLoad } from './$types';

/**
 * One line, opened from its draft: what it was bought from, paid to or drawn
 * from stock as, its receipt, what it bills, and its history -- as the mock's
 * line screen has them. A line added by hand can be changed or taken off here
 * while its draft is a draft. Someone with Field opens a line on a draft, and
 * changes one they added (#lib/access).
 */
export const load: PageServerLoad = async ({ params, locals, route, request }) => {
	if (!UUID.test(params.id) || !UUID.test(params.line)) error(404, 'no such line');
	const line = await db
		.selectFrom('invoice_line as il')
		.innerJoin('invoice as i', 'i.id', 'il.invoice_id')
		.innerJoin('entity as e', 'e.id', 'i.entity_id')
		.leftJoin('site as si', 'si.id', 'il.site_id')
		.leftJoin('user as payer', 'payer.id', 'il.paid_by')
		.leftJoin('material as m', 'm.id', 'il.material_id')
		.leftJoin('invoice as src', 'src.id', 'il.moved_from_invoice_id')
		.select((eb) => [
			'il.id',
			'il.version',
			'il.kind',
			'il.material_id',
			'il.site_id',
			'il.paid_by as paid_by_id',
			'il.description',
			'il.qty',
			'il.unit',
			'il.unit_price',
			'il.amount',
			'il.taxable',
			'il.tax_rate_pct',
			// Where its rate came from, and why, where its tax was set by hand.
			'il.tax_source',
			'il.tax_override_reason',
			// Whether the Reg 1701 election is made where it was taxed.
			claimsResold(eb.ref('il.tax_state')).as('claims'),
			'il.ex_tax_cost',
			'il.tax_paid',
			'il.bought_from',
			'payer.name as paid_by',
			'si.display as where',
			'm.name as item',
			'il.receipt_type',
			'src.number as moved_from',
			'i.id as invoice_id',
			'i.number',
			'i.status',
			'e.name as who',
			'il.created_by'
		])
		.where('il.id', '=', params.line)
		.where('il.invoice_id', '=', params.id)
		.executeTakeFirst();
	const field = fieldOnly(locals);
	if (!line) error(404, 'no such line');
	if (field && line.status !== 'draft') {
		await refusedForAccess({ locals, route, request });
		error(404, 'no such line');
	}
	// Whether this person can change it: with Field, only a line they added.
	const changeable = !field || line.created_by === locals.user!.id;

	const [added, saves, sites, people, places] = await Promise.all([
		db
			.selectFrom('record_history as h')
			.leftJoin('user as u', 'u.id', 'h.changed_by')
			.select(['u.name as who', 'h.changed_at as at'])
			.where('h.table_name', '=', 'invoice_line')
			.where('h.row_id', '=', line.id)
			.where('h.field', '=', '(added)')
			.orderBy('h.changed_at')
			.limit(1)
			.executeTakeFirst(),
		// Each save that changed it is one moment.
		db
			.selectFrom('record_history as h')
			.select((eb) => eb.cast<number>(eb.fn.count('h.changed_at').distinct(), 'integer').as('n'))
			.where('h.table_name', '=', 'invoice_line')
			.where('h.row_id', '=', line.id)
			.where('h.field', 'not like', '(%')
			.executeTakeFirst(),
		// The places and people a change's values name, by their names.
		db
			.selectFrom('site as si')
			.innerJoin('invoice as i', 'i.entity_id', 'si.entity_id')
			.select(['si.id', 'si.display as name'])
			.where('i.id', '=', line.invoice_id)
			.execute(),
		db.selectFrom('user').select(['id', 'name']).execute(),
		moneyPlaces()
	]);
	return {
		line,
		changeable,
		// As the form puts them: what a change made here begins from.
		fields: formFieldsOf({ ...line, paid_by: line.paid_by_id }, places),
		added: added ?? null,
		changes: saves?.n ?? 0,
		claims: line.claims,
		sites: Object.fromEntries(sites.map((x) => [x.id, x.name ?? ''])),
		people: Object.fromEntries(people.map((x) => [x.id, x.name])),
		// When this copy was made: shown when it is opened with no signal.
		as_of: new Date().toISOString()
	};
};
