import { personalDay } from '#lib/server/calendar.ts';
import { error } from '@sveltejs/kit';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { UUID } from '#lib/field-rules.ts';
import { balances } from '#lib/server/balances.ts';
import { moneyPlaces, taxRounding } from '#lib/server/business.ts';
import { lineTaxSql } from '#lib/server/tax-rules.ts';
import { day, monthName, names } from '#lib/format.ts';
import { crewNames } from '#lib/server/choices.ts';
import { clientLink } from '#lib/client-link.ts';
import type { PageServerLoad } from './$types';

/**
 * One invoice, and what it does to the return.
 *
 * Every figure comes off the lines as they were billed -- invoice_line stores
 * the rate that was applied and where it came from, so an invoice sent in June
 * still says what June said, whatever the rate table says today.
 */
export const load: PageServerLoad = async ({ params, url }) => {
	const [rounding, places] = await Promise.all([taxRounding(), moneyPlaces()]);
	const owing = balances(rounding, places);
	if (!UUID.test(params.id)) error(404, 'no such invoice');

	const i = t.invoice;
	const e = t.entity;
	const il = t.invoiceLine;
	const te = t.timeEntry;
	const u = t.user;
	const tl = t.tripLeg;
	const tr = t.trip;
	const ap = t.agreementPeriod;
	const si = t.site;
	const payer = alias(t.user, 'payer');

	const [invoice] = await db
		.select({
			id: i.id,
			// The uuid it was started with on a phone, which lines added there
			// still name it by until they arrive.
			client_uuid: i.clientUuid,
			number: i.number,
			status: i.status,
			who: e.name,
			terms: sql<
				number | null
			>`coalesce(${e.termsDays}, (select ${t.operator.defaultTermsDays} from ${t.operator}))`,
			issued_on: i.issuedOn,
			due_on: i.dueOn,
			sent_on: sql<string | null>`${personalDay(i.sentAt)}::text`,
			token: i.publicToken,
			// A moment: drawn on the page, in the person's own zone.
			assembled: i.createdAt,
			period_start: i.periodStart,
			period_end: i.periodEnd
		})
		.from(i)
		.innerJoin(e, eq(e.id, i.entityId))
		.where(eq(i.id, params.id));
	if (!invoice) error(404, 'no such invoice');

	const src = alias(t.invoice, 'src');
	const dst = alias(t.invoice, 'dst');
	const [lines, [totals], movedIn, takenOff, movedOut] = await Promise.all([
		db
			.select({
				id: il.id,
				// The draft it was added for on a phone, where that one had gone
				// out by the time it arrived.
				moved_from: src.number,
				seq: il.seq,
				kind: il.kind,
				description: il.description,
				// Where the line came from, in the terms of its source: put into
				// words below.
				worker: u.name,
				// A team's hours name its crew (0023).
				team: crewNames(sql`${te.id}`),
				worked_on: te.workedOn,
				note: te.note,
				travelled_on: tr.travelledOn,
				// Who what it drew from stock came from, oldest first.
				from_stock: sql<boolean>`${il.materialId} is not null`,
				supplier: sql<string | null>`(
					select string_agg(s.supplier, ', ' order by s.first)
					  from (select ${t.materialLot.supplier} as supplier,
					               min(${t.materialLot.receivedOn}) as first
					          from ${t.stockDraw}
					          join ${t.materialLot} on ${t.materialLot.id} = ${t.stockDraw.materialLotId}
					         where ${t.stockDraw.invoiceLineId} = ${il.id}
					           and ${t.materialLot.supplier} is not null
					         group by 1) s)`,
				period_start: ap.periodStart,
				qty: il.qty,
				unit: il.unit,
				unit_price: il.unitPrice,
				amount: il.amount,
				taxable: il.taxable,
				tax_rate_pct: il.taxRatePct,
				trip_leg_id: il.tripLegId,
				where_from: sql<string>`coalesce(${si.display}, '')`,
				bought_from: il.boughtFrom,
				paid_by: payer.name,
				receipt: sql<boolean>`${il.receipt} is not null`
			})
			.from(il)
			.leftJoin(te, eq(te.id, il.timeEntryId))
			.leftJoin(u, eq(u.id, te.workedBy))
			.leftJoin(tl, eq(tl.id, il.tripLegId))
			.leftJoin(tr, eq(tr.id, tl.tripId))
			.leftJoin(ap, eq(ap.id, il.agreementPeriodId))
			.leftJoin(si, eq(si.id, il.siteId))
			.leftJoin(payer, eq(payer.id, il.paidBy))
			.leftJoin(src, eq(src.id, il.movedFromInvoiceId))
			.where(eq(il.invoiceId, params.id))
			.orderBy(asc(il.seq)),
		db
			.execute<{
				untaxed: string;
				taxable_measure: string;
				tax: string;
				due: string;
				owed: string;
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
		  -- What is still owed on it: less what payments and credit notes took off.
		  (select b.owed from ${owing} b where b.invoice_id = ${params.id})::text as owed,
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
				places,
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
			.then((r) => r.rows),
		// Lines that came here because the draft they were added for on a phone
		// had gone out: which draft, when it went, and how many.
		db
			.select({
				number: src.number,
				sent_at: src.sentAt,
				lines: sql<number>`count(*)::int`
			})
			.from(il)
			.innerJoin(src, eq(src.id, il.movedFromInvoiceId))
			.where(eq(il.invoiceId, params.id))
			.groupBy(src.id, src.number, src.sentAt),
		// Lines taken off it: what each was, who took it off and when. Their
		// history stays in record_history (0021).
		db
			.select({
				id: t.recordHistory.rowId,
				description: sql<string>`${t.recordHistory.oldValue}::jsonb ->> 'description'`,
				who: u.name,
				at: t.recordHistory.changedAt
			})
			.from(t.recordHistory)
			.leftJoin(u, eq(u.id, t.recordHistory.changedBy))
			.where(
				and(
					eq(t.recordHistory.tableName, 'invoice_line'),
					eq(t.recordHistory.field, '(deleted)'),
					sql`${t.recordHistory.oldValue}::jsonb ->> 'invoice_id' = ${params.id}`
				)
			)
			.orderBy(asc(t.recordHistory.changedAt)),
		// And the other way: lines added to this one on a phone after it went
		// out, and the draft they started instead.
		db
			.select({ id: dst.id, number: dst.number, lines: sql<number>`count(*)::int` })
			.from(il)
			.innerJoin(dst, eq(dst.id, il.invoiceId))
			.where(eq(il.movedFromInvoiceId, params.id))
			.groupBy(dst.id, dst.number)
	]);

	const { token, ...shown } = invoice;
	return {
		// A sent invoice's link, on the origin this was asked on (#lib/client-link).
		invoice: { ...shown, link: token ? clientLink(url.origin, token) : null },
		lines: lines.map(
			({
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
		totals,
		movedIn,
		movedOut,
		takenOff,
		// For a draft opened on a phone, whose lines on the phone join the total
		// by the same rounding the server's own lines had.
		rounding,
		places,
		// When this copy was made: shown when it is opened with no signal.
		as_of: new Date().toISOString()
	};
};
