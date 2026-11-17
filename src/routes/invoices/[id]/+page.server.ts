import { personalDay } from '#lib/server/calendar.ts';
import { error } from '@sveltejs/kit';
import { expressionBuilder, sql, type Expression, type NumericString, type SqlBool } from 'kysely';
import { db } from '#lib/server/db/index.ts';
import type { DB } from '#lib/server/db/database.ts';
import { UUID } from '#lib/field-rules.ts';
import { balances } from '#lib/server/balances.ts';
import { moneyPlaces, taxRounding } from '#lib/server/business.ts';
import { lineTax } from '#lib/server/tax-rules.ts';
import { day, monthName, names } from '#lib/format.ts';
import { crewNames } from '#lib/server/choices.ts';
import { clientLink } from '#lib/client-link.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import { refusedForAccess } from '#lib/server/refused.ts';
import type { PageServerLoad } from './$types';

/**
 * One invoice, and what it does to the return.
 *
 * Every figure comes off the lines as they were billed -- invoice_line stores
 * the rate that was applied and where it came from, so an invoice sent in June
 * still says what June said, whatever the rate table says today.
 *
 * Someone with Field opens a draft, to add lines to (#lib/access): nothing that
 * has gone out, nothing of what it does to the return -- what the goods cost
 * is the business's -- and no history of lines taken off.
 */
export const load: PageServerLoad = async ({ params, url, locals, route, request }) => {
	const [rounding, places] = await Promise.all([taxRounding(), moneyPlaces()]);
	const owing = balances(rounding, places);
	if (!UUID.test(params.id)) error(404, 'no such invoice');

	const invoice = await db
		.selectFrom('invoice as i')
		.innerJoin('entity as e', 'e.id', 'i.entity_id')
		.select((eb) => [
			'i.id',
			// The uuid it was started with on a phone, which lines added there
			// still name it by until they arrive.
			'i.client_uuid',
			'i.number',
			'i.status',
			'e.name as who',
			eb.fn
				.coalesce('e.terms_days', eb.selectFrom('operator').select('operator.default_terms_days'))
				.$castTo<number | null>()
				.as('terms'),
			'i.issued_on',
			'i.due_on',
			eb.cast<string | null>(personalDay(eb.ref('i.sent_at')), 'text').as('sent_on'),
			'i.public_token as token',
			// A moment: drawn on the page, in the person's own zone.
			'i.created_at as assembled',
			'i.period_start',
			'i.period_end'
		])
		.where('i.id', '=', params.id)
		.executeTakeFirst();
	const field = fieldOnly(locals);
	if (!invoice) error(404, 'no such invoice');
	if (field && invoice.status !== 'draft') {
		await refusedForAccess({ locals, route, request });
		error(404, 'no such invoice');
	}

	// Whether the business has made the Reg 1701 election (below), as one row.
	const election = () =>
		expressionBuilder<DB>()
			.selectFrom('operator')
			.select((eb) =>
				eb.fn
					.coalesce(
						eb.fn.agg<boolean | null>('bool_or', ['operator.claims_tax_paid_purchases_resold']),
						eb.lit(false)
					)
					.as('claims')
			);
	// What is due on the return: the tax on this invoice's taxed lines, each
	// less what the election takes off it (below).
	const ofLine = expressionBuilder<DB, 'invoice_line'>();
	const dueOnReturn = lineTax(
		expressionBuilder<DB>()
			.selectFrom('invoice_line')
			.where('invoice_line.invoice_id', '=', params.id)
			.where('invoice_line.taxable', '=', true),
		// The election read here rather than from o: this is a query of its
		// own, and o belongs to the totals around it.
		sql<NumericString>`(${ofLine.ref('invoice_line.amount')} - ${ofLine
			.case()
			.when(election().$asScalar())
			.then(ofLine.fn.coalesce('invoice_line.ex_tax_cost', ofLine.lit(0)))
			.else(ofLine.lit(0))
			.end()}) * ${ofLine.ref('invoice_line.tax_rate_pct')} / 100`,
		rounding,
		places
	);

	const [lines, totals, movedIn, takenOff, movedOut] = await Promise.all([
		db
			.selectFrom('invoice_line as il')
			.leftJoin('time_entry as te', 'te.id', 'il.time_entry_id')
			.leftJoin('user as u', 'u.id', 'te.worked_by')
			.leftJoin('trip_leg as tl', 'tl.id', 'il.trip_leg_id')
			.leftJoin('trip as tr', 'tr.id', 'tl.trip_id')
			.leftJoin('agreement_period as ap', 'ap.id', 'il.agreement_period_id')
			.leftJoin('site as si', 'si.id', 'il.site_id')
			.leftJoin('user as payer', 'payer.id', 'il.paid_by')
			.leftJoin('invoice as src', 'src.id', 'il.moved_from_invoice_id')
			.select((eb) => [
				'il.id',
				// The draft it was added for on a phone, where that one had gone
				// out by the time it arrived.
				'src.number as moved_from',
				'il.seq',
				'il.kind',
				'il.description',
				// Where the line came from, in the terms of its source: put into
				// words below.
				'u.name as worker',
				// A team's hours name its crew (0023).
				crewNames(eb.ref('te.id')).as('team'),
				'te.worked_on',
				'te.note',
				'tr.travelled_on',
				// Who what it drew from stock came from, oldest first.
				eb('il.material_id', 'is not', null).$castTo<boolean>().as('from_stock'),
				eb
					.selectFrom(
						eb
							.selectFrom('stock_draw as sd')
							.innerJoin('material_lot as ml', 'ml.id', 'sd.material_lot_id')
							.innerJoin('stock_receipt as sr', 'sr.id', 'ml.receipt_id')
							.select((eb) => ['sr.supplier', eb.fn.min('ml.received_on').as('first')])
							.whereRef('sd.invoice_line_id', '=', 'il.id')
							.where('sr.supplier', 'is not', null)
							.groupBy('sr.supplier')
							.as('s')
					)
					.select((eb) =>
						eb.fn
							.agg<string | null>('string_agg', ['s.supplier', eb.val(', ')])
							.orderBy('s.first')
							.as('supplier')
					)
					.as('supplier'),
				'ap.period_start',
				'il.qty',
				'il.unit',
				'il.unit_price',
				'il.amount',
				'il.taxable',
				'il.tax_rate_pct',
				'il.trip_leg_id',
				eb.fn.coalesce('si.display', eb.val('')).as('where_from'),
				'il.bought_from',
				'payer.name as paid_by',
				eb('il.receipt', 'is not', null).$castTo<boolean>().as('receipt'),
				'il.created_by'
			])
			.where('il.invoice_id', '=', params.id)
			.orderBy('il.seq')
			.execute(),
		db
			.selectFrom('invoice_line as il')
			.crossJoin(election().as('o'))
			.select((eb) => {
				const untaxed = eb.not(eb.ref('il.taxable'));
				const taxed = eb.ref('il.taxable');
				// This invoice's figure from its balance.
				const balance = (figure: 'b.tax' | 'b.gross' | 'b.owed') =>
					eb.cast<string>(
						eb.selectFrom(owing.as('b')).select(figure).where('b.invoice_id', '=', params.id),
						'text'
					);
				// The kinds of line in one half, each once. As text: an enum's array
				// arrives as the string Postgres writes it.
				const kinds = (half: Expression<SqlBool>) =>
					eb.fn.coalesce(
						eb.fn<string[] | null>('array_remove', [
							eb.fn
								.agg<string[] | null>('array_agg', [eb.cast<string>('il.kind', 'text')])
								.distinct()
								.filterWhere(half),
							eb.lit(null)
						]),
						sql<string[]>`'{}'`
					);
				return [
					eb
						.cast<string>(
							eb.fn.coalesce(eb.fn.sum<NumericString>('il.amount').filterWhere(untaxed), eb.lit(0)),
							'text'
						)
						.as('untaxed'),
					eb
						.cast<string>(
							eb.fn.coalesce(eb.fn.sum<NumericString>('il.amount').filterWhere(taxed), eb.lit(0)),
							'text'
						)
						.as('taxable_measure'),
					// The tax, rounded as the business's tax rule rounds it, and what is due
					// with it: the same figures the invoice list and every balance use.
					balance('b.tax').as('tax'),
					balance('b.gross').as('due'),
					// What is still owed on it: less what payments and credit notes took off.
					balance('b.owed').as('owed'),
					// Reg 1701, where the operator has made that election: goods resold
					// after tax was paid on them come off the measure, at the cost
					// recorded on each line, and the return is taxed line by line on
					// what is left.
					eb
						.cast<string>(
							eb.fn.coalesce(
								eb.fn
									.sum<NumericString>('il.ex_tax_cost')
									.filterWhere(eb.and([taxed, eb.ref('o.claims')])),
								eb.lit(0)
							),
							'text'
						)
						.as('resold'),
					eb.cast<string>(dueOnReturn, 'text').as('due_on_return'),
					// Where it was taxed, as each line kept it when it was priced (0030),
					// not as its site says now.
					eb.fn.max<string | null>('il.tax_jurisdiction').as('district'),
					eb.cast<string | null>(eb.fn.max('il.tax_rate_pct'), 'text').as('rate_pct'),
					eb.cast<string | null>(eb.fn.max('il.state_rate_pct'), 'text').as('state_rate_pct'),
					eb.cast<string | null>(eb.fn.max('il.district_rate_pct'), 'text').as('district_rate_pct'),
					// What is actually in each half, so the page can name them instead of
					// assuming labour is never taxed and goods always are.
					kinds(untaxed).as('untaxed_kinds'),
					kinds(taxed).as('taxed_kinds')
				];
			})
			.where('il.invoice_id', '=', params.id)
			// An aggregate: always one row.
			.executeTakeFirstOrThrow(),
		// Lines that came here because the draft they were added for on a phone
		// had gone out: which draft, when it went, and how many.
		db
			.selectFrom('invoice_line as il')
			.innerJoin('invoice as src', 'src.id', 'il.moved_from_invoice_id')
			.select((eb) => [
				'src.number',
				'src.sent_at',
				eb.cast<number>(eb.fn.countAll(), 'integer').as('lines')
			])
			.where('il.invoice_id', '=', params.id)
			.groupBy(['src.id', 'src.number', 'src.sent_at'])
			.execute(),
		// Lines taken off it: what each was, who took it off and when. Their
		// history stays in record_history (0021).
		db
			.selectFrom('record_history as h')
			.leftJoin('user as u', 'u.id', 'h.changed_by')
			.select((eb) => [
				'h.row_id as id',
				sql<string>`${eb.ref('h.old_value')}::jsonb ->> 'description'`.as('description'),
				'u.name as who',
				'h.changed_at as at'
			])
			.where('h.table_name', '=', 'invoice_line')
			.where('h.field', '=', '(deleted)')
			.where((eb) =>
				eb(sql<string>`${eb.ref('h.old_value')}::jsonb ->> 'invoice_id'`, '=', params.id)
			)
			.orderBy('h.changed_at')
			.execute(),
		// And the other way: lines added to this one on a phone after it went
		// out, and the draft they started instead.
		db
			.selectFrom('invoice_line as il')
			.innerJoin('invoice as dst', 'dst.id', 'il.invoice_id')
			.select((eb) => [
				'dst.id',
				'dst.number',
				eb.cast<number>(eb.fn.countAll(), 'integer').as('lines')
			])
			.where('il.moved_from_invoice_id', '=', params.id)
			.groupBy(['dst.id', 'dst.number'])
			.execute()
	]);

	const { token, ...shown } = invoice;
	return {
		// A sent invoice's link, on the origin this was asked on (#lib/client-link).
		invoice: { ...shown, link: token ? clientLink(url.origin, token) : null },
		lines: lines.map(
			({
				created_by,
				worker,
				team,
				worked_on,
				note,
				travelled_on,
				from_stock,
				supplier,
				period_start,
				...l
			}) => ({
				...l,
				// Whether the person asking added it: with Field, the lines they can change.
				mine: created_by === locals.user!.id,
				// The first source the line has, said with #lib/format: who worked it --
				// one person, or a team's crew -- and when. What was bought or paid for
				// says from whom, and who paid; what was drawn from stock, whom it came
				// from.
				detail:
					l.kind === 'bought' || l.kind === 'paid_for'
						? [
								l.kind === 'bought' ? 'Bought' : 'Paid for them',
								l.bought_from,
								l.paid_by ? `${l.paid_by} paid` : 'the business paid',
								l.kind === 'paid_for' ? 'at cost' : null
							]
								.filter(Boolean)
								.join(' · ')
						: (worker !== null || team.length > 0) && worked_on !== null
							? `${worker ?? names(team)} · ${day(worked_on)}${note !== null ? ` · ${note}` : ''}`
							: travelled_on !== null
								? `${day(travelled_on)} · leg of a trip`
								: from_stock
									? ['From stock', supplier].filter(Boolean).join(' · ')
									: period_start !== null
										? `Recurring · ${monthName(period_start)}`
										: null
			})
		),
		totals: field ? { ...totals, resold: null, due_on_return: null } : totals,
		movedIn,
		movedOut,
		takenOff: field ? [] : takenOff,
		// For a draft opened on a phone, whose lines on the phone join the total
		// by the same rounding the server's own lines had.
		rounding,
		places,
		// When this copy was made: shown when it is opened with no signal.
		as_of: new Date().toISOString()
	};
};
