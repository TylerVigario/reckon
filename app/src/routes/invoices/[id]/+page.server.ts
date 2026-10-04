import { personalDay } from '#lib/server/calendar.ts';
import { error } from '@sveltejs/kit';
import { asc, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { UUID } from '#lib/field-rules.ts';
import { balances } from '#lib/server/balances.ts';
import { taxRounding } from '#lib/server/business.ts';
import { lineTaxSql } from '#lib/server/tax-rules.ts';
import { day, monthName } from '#lib/format.ts';
import type { PageServerLoad } from './$types';

/**
 * One invoice, and what it does to the return.
 *
 * Every figure comes off the lines as they were billed -- invoice_line stores
 * the rate that was applied and where it came from, so an invoice sent in June
 * still says what June said, whatever the rate table says today.
 */
export const load: PageServerLoad = async ({ params }) => {
	const rounding = await taxRounding();
	const owing = balances(rounding);
	if (!UUID.test(params.id)) error(404, 'no such invoice');

	const i = t.invoice;
	const e = t.entity;
	const il = t.invoiceLine;
	const te = t.timeEntry;
	const u = t.user;
	const tl = t.tripLeg;
	const tr = t.trip;
	const ml = t.materialLot;
	const ap = t.agreementPeriod;
	const si = t.site;

	const [invoice] = await db
		.select({
			id: i.id,
			number: i.number,
			status: i.status,
			who: e.name,
			terms: sql<
				number | null
			>`coalesce(${e.termsDays}, (select ${t.operator.defaultTermsDays} from ${t.operator}))`,
			issued_on: i.issuedOn,
			due_on: i.dueOn,
			sent_on: sql<string | null>`${personalDay(i.sentAt)}::text`,
			// A moment: drawn on the page, in the person's own zone.
			assembled: i.createdAt,
			period_start: i.periodStart,
			period_end: i.periodEnd
		})
		.from(i)
		.innerJoin(e, eq(e.id, i.entityId))
		.where(eq(i.id, params.id));
	if (!invoice) error(404, 'no such invoice');

	const [lines, [totals]] = await Promise.all([
		db
			.select({
				id: il.id,
				seq: il.seq,
				kind: il.kind,
				description: il.description,
				// Where the line came from, in the terms of its source: put into
				// words below.
				worker: u.name,
				worked_on: te.workedOn,
				note: te.note,
				travelled_on: tr.travelledOn,
				supplier: ml.supplier,
				period_start: ap.periodStart,
				qty: il.qty,
				unit: il.unit,
				unit_price: il.unitPrice,
				amount: il.amount,
				taxable: il.taxable,
				tax_rate_pct: il.taxRatePct,
				trip_leg_id: il.tripLegId,
				where_from: sql<string>`coalesce(${si.display}, '')`
			})
			.from(il)
			.leftJoin(te, eq(te.id, il.timeEntryId))
			.leftJoin(u, eq(u.id, te.workedBy))
			.leftJoin(tl, eq(tl.id, il.tripLegId))
			.leftJoin(tr, eq(tr.id, tl.tripId))
			.leftJoin(ml, eq(ml.id, il.materialLotId))
			.leftJoin(ap, eq(ap.id, il.agreementPeriodId))
			.leftJoin(si, eq(si.id, il.siteId))
			.where(eq(il.invoiceId, params.id))
			.orderBy(asc(il.seq)),
		db
			.execute<{
				untaxed: string;
				taxable_measure: string;
				tax: string;
				due: string;
				resold: string;
				due_on_return: string;
				district: string | null;
				rate_pct: string | null;
				state_rate_pct: string | null;
				district_rate_pct: string | null;
				untaxed_kinds: string[];
				taxed_kinds: string[];
			}>(
				sql`
		select
		  coalesce(sum(${il.amount}) filter (where not ${il.taxable}), 0)::text as untaxed,
		  coalesce(sum(${il.amount}) filter (where ${il.taxable}), 0)::text     as taxable_measure,
		  -- The tax, rounded as the business's tax rule rounds it, and what is due
		  -- with it: the same figures the invoice list and every balance use.
		  (select b.tax from ${owing} b where b.invoice_id = ${params.id})::text as tax,
		  (select b.gross from ${owing} b where b.invoice_id = ${params.id})::text as due,
		  -- Reg 1701, where the operator has made that election: goods resold
		  -- after tax was paid on them come off the measure, at the cost
		  -- recorded on each line, and the return is taxed line by line on
		  -- what is left.
		  coalesce(sum(${il.exTaxCost}) filter (where ${il.taxable} and o.claims), 0)::text as resold,
		  ${lineTaxSql(
				// The election read here rather than from o: this is a query of its
				// own, and o belongs to the totals around it.
				sql`(${il.amount} - case when (select coalesce(bool_or(${t.operator.claimsTaxPaidPurchasesResold}), false)
				                                 from ${t.operator})
				                         then coalesce(${il.exTaxCost}, 0) else 0 end)
				    * ${il.taxRatePct} / 100`,
				rounding,
				2,
				sql`from ${il} where ${il.invoiceId} = ${params.id} and ${il.taxable}`
			)}::text as due_on_return,
		  max(${si.taxJurisdiction}) as district,
		  max(${il.taxRatePct})::text as rate_pct,
		  max(${si.stateRatePct})::text as state_rate_pct,
		  max(${si.districtRatePct})::text as district_rate_pct,
		  -- What is actually in each half, so the page can name them instead of
		  -- assuming labour is never taxed and goods always are.
		  coalesce(array_remove(array_agg(distinct ${il.kind}) filter (where not ${il.taxable}), null), '{}') as untaxed_kinds,
		  coalesce(array_remove(array_agg(distinct ${il.kind}) filter (where ${il.taxable}), null), '{}') as taxed_kinds
		  from ${il}
		  cross join (select coalesce(bool_or(${t.operator.claimsTaxPaidPurchasesResold}), false) as claims
		                from ${t.operator}) o
		  left join ${si} on ${si.id} = ${il.siteId}
		 where ${il.invoiceId} = ${params.id}`
			)
			.then((r) => r.rows)
	]);

	return {
		invoice,
		lines: lines.map(({ worker, worked_on, note, travelled_on, supplier, period_start, ...l }) => ({
			...l,
			// The first source the line has, said with #lib/format. A team's entry
			// names no worker, and says nothing here.
			detail:
				worker !== null && worked_on !== null
					? `${worker} · ${day(worked_on)}${note !== null ? ` · ${note}` : ''}`
					: travelled_on !== null
						? `${day(travelled_on)} · leg of a trip`
						: supplier !== null
							? `${supplier} · from stock, weighted average`
							: period_start !== null
								? `Recurring · ${monthName(period_start)}`
								: null
		})),
		totals
	};
};
