import { businessToday } from '#lib/server/calendar.ts';
import { sql } from 'kysely';
import { sumMoney } from '#lib/decimal.ts';
import { db } from '#lib/server/db/index.ts';
import { balances } from '#lib/server/balances.ts';
import { moneyPlaces } from '#lib/server/business.ts';
import { TAX_ROUNDING } from '#lib/server/tax-rules.ts';
import type { PageServerLoad } from './$types';

/**
 * Every draft, with what put it there.
 *
 * Sending is a decision, and this is the screen it is meant to be made from,
 * so each row carries enough to make it without opening the draft -- who it is
 * for, who receives it, what tax it charges, what it is made of, and whether
 * the work on it has been waiting too long. Nothing builds or sends a draft
 * yet.
 *
 * Work ageing past the operator's own alert figure is the loud case: that is
 * money worked for and not asked for, and the row says so in the loudest way
 * the screen has.
 *
 * Each row's figures are Postgres', and the total is added exactly by
 * #lib/decimal. Money stays a string the whole way out -- the rows and the
 * total sit on the same screen, where one cent out would show.
 */
export const load: PageServerLoad = async () => {
	const places = await moneyPlaces();
	const today = businessToday();

	const [operator, drafts] = await Promise.all([
		db.selectFrom('operator').select('ageing_alert_days as days').executeTakeFirst(),
		db
			.with('alert', (qc) =>
				qc.selectNoFrom((eb) =>
					eb.fn
						.coalesce(eb.selectFrom('operator').select('operator.ageing_alert_days'), eb.lit(30))
						.as('days')
				)
			)
			.with('counted', (qc) =>
				qc
					.selectFrom('invoice_line as il')
					.select((eb) => ['il.invoice_id', eb.cast<string>(eb.fn.countAll(), 'text').as('lines')])
					.groupBy('il.invoice_id')
			)
			// What the invoice is made of, in the order a reader expects to meet it:
			// the standing charge, then the work, then the driving, then the parts,
			// whether drawn from stock or bought for the job, then what was paid for
			// them.
			// Mileage is a service billed by the mile, which is why the unit decides
			// it rather than the kind.
			.with('made_of', (qc) =>
				qc
					.selectFrom(
						qc
							.selectFrom('invoice_line as il')
							.select((eb) => {
								const mileage = eb.and([eb('il.kind', '=', 'service'), eb('il.unit', '=', 'mile')]);
								const goods = eb.or([eb('il.kind', '=', 'material'), eb('il.kind', '=', 'bought')]);
								return [
									'il.invoice_id',
									eb
										.case()
										.when('il.kind', '=', 'recurring')
										.then(eb.lit(1))
										.when(mileage)
										.then(eb.lit(3))
										.when('il.kind', '=', 'service')
										.then(eb.lit(2))
										.when(goods)
										.then(eb.lit(4))
										.when('il.kind', '=', 'paid_for')
										.then(eb.lit(5))
										.else(eb.lit(6))
										.end()
										.as('ord'),
									eb
										.case()
										.when('il.kind', '=', 'recurring')
										.then(sql.lit('retainer'))
										.when(mileage)
										.then(sql.lit('mileage'))
										.when('il.kind', '=', 'service')
										.then(sql.lit('labour'))
										.when(goods)
										.then(sql.lit('materials'))
										.when('il.kind', '=', 'paid_for')
										.then(sql.lit('expenses'))
										.else(sql.lit('an adjustment'))
										.end()
										.$castTo<string>()
										.as('part')
								];
							})
							.distinct()
							.as('p')
					)
					.select((eb) => [
						'p.invoice_id',
						eb.fn
							.agg<string>('string_agg', ['p.part', eb.val(', ')])
							.orderBy('p.ord')
							.as('made_of')
					])
					.groupBy('p.invoice_id')
			)
			// The rate charged comes from where the work happened, so the name of
			// the place that levies it is what identifies it on the row. The state's
			// share is on every invoice and names nothing. Both as the lines kept
			// them when they were priced (0030), which is what the invoice charges.
			.with('where_taxed', (qc) =>
				qc
					.selectFrom('invoice_line as il')
					.select((eb) => [
						'il.invoice_id',
						eb.cast<string>(eb.fn.max('il.tax_rate_pct'), 'text').as('rate_pct'),
						eb.fn.min<string>('il.tax_jurisdiction').as('area')
					])
					.where('il.tax_jurisdiction', 'is not', null)
					.groupBy('il.invoice_id')
			)
			// How long the oldest thing on it has been waiting. Time has a worked-on
			// date of its own; a leg takes its trip's.
			.with('waiting', (qc) =>
				qc
					.selectFrom('invoice_line as il')
					.leftJoin('time_entry as te', 'te.id', 'il.time_entry_id')
					.leftJoin('trip_leg as tl', 'tl.id', 'il.trip_leg_id')
					.leftJoin('trip as tr', 'tr.id', 'tl.trip_id')
					.select((eb) => [
						'il.invoice_id',
						eb.fn.min<string | null>(eb.fn.coalesce('te.worked_on', 'tr.travelled_on')).as('oldest')
					])
					.groupBy('il.invoice_id')
			)
			.selectFrom('invoice as i')
			.crossJoin('alert as a')
			.innerJoin('entity as e', 'e.id', 'i.entity_id')
			.innerJoin(balances(TAX_ROUNDING, places).as('b'), 'b.invoice_id', 'i.id')
			.leftJoin('entity_contact as ec', (join) =>
				join.onRef('ec.entity_id', '=', 'e.id').on('ec.is_primary', '=', true)
			)
			.leftJoin('contact as c', 'c.id', 'ec.contact_id')
			.leftJoin('counted as n', 'n.invoice_id', 'i.id')
			.leftJoin('made_of as m', 'm.invoice_id', 'i.id')
			.leftJoin('where_taxed as w', 'w.invoice_id', 'i.id')
			.leftJoin('waiting as g', 'g.invoice_id', 'i.id')
			.select((eb) => {
				const waited = sql<number | null>`${today}::date - ${eb.ref('g.oldest')}`;
				return [
					'i.id',
					'i.number',
					'e.name as who',
					'c.name as contact',
					'w.area',
					'w.rate_pct',
					'm.made_of',
					eb.cast<string | null>('i.period_end', 'text').as('period_end'),
					eb.cast<string | null>('g.oldest', 'text').as('oldest_worked_on'),
					eb.cast<number | null>(waited, 'integer').as('days_waiting'),
					eb.fn
						.coalesce(eb(waited, '>', eb.ref('a.days')), eb.lit(false))
						.$castTo<boolean>()
						.as('aged'),
					eb.fn.coalesce('n.lines', eb.val('0')).as('lines'),
					eb.cast<string>('b.gross', 'text').as('gross')
				];
			})
			.where('i.status', '=', 'draft')
			// What has waited longest goes first: that is the one that should have
			// gone already.
			.orderBy((eb) => eb('g.oldest', 'is', null))
			.orderBy('g.oldest')
			.orderBy('i.number')
			.execute()
	]);

	return {
		drafts,
		alertDays: operator?.days ?? 30,
		total: sumMoney(
			drafts.map((d) => d.gross),
			places
		)
	};
};
