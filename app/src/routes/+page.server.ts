import { and, desc, eq, notExists, sql } from 'drizzle-orm';
import { db, today as dbToday } from '$lib/server/db';
import * as t from '$lib/server/db/schema';
import { sum } from '$lib/decimal';
import { entryColumns, valueEntries } from '$lib/server/valuation/load';
import { rateIsStale } from '$lib/server/stale';
import type { PageServerLoad } from './$types';

/**
 * Today: what is owed, what is ready, and what needs a decision.
 *
 * Figures are computed in Postgres, or by the valuation in exact decimals.
 * Money is NUMERIC and stays a string all the way to the page -- adding cents
 * as floats is how they go missing, and these figures sit side by side where
 * one out would show.
 *
 * The date comes from the database rather than from `new Date()`: the server's
 * clock is UTC and toISOString() west of Greenwich calls it tomorrow from five
 * in the afternoon.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const today = await dbToday();
	const i = t.invoice;
	const il = t.invoiceLine;
	const pa = t.paymentAllocation;
	const e = t.entity;
	const s = t.site;

	const {
		rows: [totals]
	} = await db.execute<{
		owed: string;
		owed_count: string;
		drafts: string;
		draft_count: string;
		tax_held: string;
	}>(sql`
		with line_totals as (
			select ${il.invoiceId} as invoice_id,
			       sum(${il.amount}) as net,
			       sum(${il.amount} * ${il.taxRatePct} / 100) as tax,
			       -- Reg 1701, where the operator has made that election: tax
			       -- already paid on resold goods never reaches the return.
			       sum(${il.exTaxCost} * ${il.taxRatePct} / 100)
			         filter (where ${il.taxable}
			                   and (select ${t.operator.claimsTaxPaidPurchasesResold} from ${t.operator}))
			         as credit
			  from ${il} group by ${il.invoiceId}
		),
		-- What has been paid against each invoice. Owed is what is left.
		allocated as (
			select ${pa.invoiceId} as invoice_id, sum(${pa.amount}) as paid from ${pa} group by ${pa.invoiceId}
		)
		select
		  coalesce(sum(greatest(lt.net + lt.tax - coalesce(a.paid, 0), 0))
		             filter (where ${i.status} = 'sent'), 0)::numeric(12,2)::text      as owed,
		  count(*) filter (where ${i.status} = 'sent'
		                     and lt.net + lt.tax > coalesce(a.paid, 0))::text        as owed_count,
		  coalesce(sum(lt.net + lt.tax) filter (where ${i.status} = 'draft'), 0)::numeric(12,2)::text as drafts,
		  count(*) filter (where ${i.status} = 'draft')::text                        as draft_count,
		  -- Collected on somebody else's behalf, so the figure worth seeing is
		  -- what is STILL HELD: charged on what has gone out, less the Reg 1701
		  -- credit that comes off the return, less what has been handed to
		  -- CDTFA. Whether a return was paid is a fact about the world, not
		  -- something the invoices know, which is why it is subtracted from a
		  -- table rather than inferred.
		  (coalesce(sum(lt.tax) filter (where ${i.status} in ('sent', 'paid')), 0)
		   - coalesce(sum(lt.credit) filter (where ${i.status} in ('sent', 'paid')), 0)
		   - (select coalesce(sum(${t.taxRemittance.amount}), 0) from ${t.taxRemittance}))::numeric(12,2)::text as tax_held
		  from ${i}
		  left join line_totals lt on lt.invoice_id = ${i.id}
		  left join allocated a on a.invoice_id = ${i.id}
		 where ${i.status} in ('sent', 'paid', 'draft')`);

	// Anything that cannot proceed until somebody decides. An invoice out past
	// the operator's own chase-after figure, and an address CDTFA has not been
	// asked about lately.
	const { rows: decisions } = await db.execute<{
		kind: string;
		title: string;
		detail: string;
		amount: string | null;
		chip: string;
	}>(sql`
		with line_totals as (
			select ${il.invoiceId} as invoice_id,
			       sum(${il.amount} + ${il.amount} * ${il.taxRatePct} / 100) as gross
			  from ${il} group by ${il.invoiceId}
		),
		allocated as (
			select ${pa.invoiceId} as invoice_id, sum(${pa.amount}) as paid from ${pa} group by ${pa.invoiceId}
		)
		select * from (
		select 'invoice' as kind,
		       'Invoice ' || ${i.number} || ' · ' || ${e.name} as title,
		       'Sent ' || to_char(${i.sentAt}, 'FMDD Mon YYYY') || ', still unpaid.' as detail,
		       (coalesce(lt.gross, 0) - coalesce(a.paid, 0))::numeric(12,2)::text as amount,
		       'Unpaid ' || (current_date - ${i.sentAt}::date) || ' days' as chip
		  from ${i}
		  join ${e} on ${e.id} = ${i.entityId}
		  left join line_totals lt on lt.invoice_id = ${i.id}
		  left join allocated a on a.invoice_id = ${i.id}
		 where ${i.status} = 'sent'
		   and coalesce(lt.gross, 0) > coalesce(a.paid, 0)
		   and ${i.sentAt} is not null
		   and current_date - ${i.sentAt}::date
		       > coalesce((select ${t.operator.ageingAlertDays} from ${t.operator}), 30)
		union all
		select 'district',
		       ${e.name} || ' · ' || ${s.display} || ' · rate is old',
		       'CDTFA last priced this address on ' ||
		         to_char(${s.areaVerifiedOn}, 'FMDD Mon YYYY') || '. A district can be '
		         'added or ended in between, and every invoice since would be wrong.',
		       null,
		       (current_date - ${s.areaVerifiedOn}) || ' days since CDTFA was asked'
		  from ${s}
		  join ${e} on ${e.id} = ${s.entityId}
		 where ${s.active} and ${rateIsStale(s.areaVerifiedOn)}
		) d
		 -- Critical before warning, by severity rather than by how the kind
		 -- column happens to sort.
		 order by case kind when 'invoice' then 0 else 1 end, title`);

	const drafts = await db
		.select({
			id: t.invoice.id,
			number: t.invoice.number,
			who: t.entity.name,
			lines: sql<string>`count(${t.invoiceLine.id})::text`,
			gross: sql<string>`coalesce(sum(${t.invoiceLine.amount} + ${t.invoiceLine.amount} * ${t.invoiceLine.taxRatePct} / 100), 0)::numeric(12,2)::text`
		})
		.from(t.invoice)
		.innerJoin(t.entity, eq(t.entity.id, t.invoice.entityId))
		.leftJoin(t.invoiceLine, eq(t.invoiceLine.invoiceId, t.invoice.id))
		.where(eq(t.invoice.status, 'draft'))
		.groupBy(t.invoice.id, t.invoice.number, t.entity.name)
		.orderBy(desc(t.invoice.createdAt))
		.limit(3);

	// Work done and not yet put on an invoice, by how long it has waited.
	// Worth what the valuation says it bills: the price in force on the day it
	// was worked, rounded to the service's increment and never below its
	// minimum -- the same rule an invoice line will use when it is drawn. An hour
	// a retainer covers is not waiting on anything: the retainer has charged
	// for it.
	const unbilled = await db
		.select(entryColumns)
		.from(t.timeEntry)
		.where(
			and(
				eq(t.timeEntry.billable, true),
				notExists(
					db
						.select({ x: sql`1` })
						.from(t.invoiceLine)
						.where(eq(t.invoiceLine.timeEntryId, t.timeEntry.id))
				)
			)
		);
	const worth = await valueEntries(db, unbilled);
	const daysAgo = (d: string) =>
		Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000);
	const buckets = new Map<string, { n: number; worth: (string | null)[]; oldest: number }>();
	for (const entry of unbilled) {
		const w = worth.get(entry.id)!;
		if (w.coveredMinutes !== null && w.coveredMinutes >= entry.minutes) continue;
		const days = daysAgo(entry.workedOn);
		const bucket = days <= 7 ? '0–7 days' : days <= 30 ? '8–30 days' : '31+ days';
		const b = buckets.get(bucket) ?? { n: 0, worth: [], oldest: 0 };
		b.n += 1;
		b.worth.push(w.billed?.toString() ?? null);
		b.oldest = Math.max(b.oldest, days);
		buckets.set(bucket, b);
	}
	const ageing = [...buckets.entries()].map(([bucket, b]) => ({
		bucket,
		n: String(b.n),
		worth: sum(b.worth).toFixed(2),
		oldest: String(b.oldest)
	}));

	// Names for whatever the browser has a timer running against. The timer
	// itself is local -- it survives a refresh because it is written down in the
	// browser, not because the server was told -- so only the labels come from
	// here.
	const [entities, services] = await Promise.all([
		db
			.select({ id: t.entity.id, name: t.entity.name })
			.from(t.entity)
			.where(eq(t.entity.active, true)),
		db
			.select({ id: t.service.id, name: t.service.name })
			.from(t.service)
			.where(eq(t.service.active, true))
	]);

	return {
		today,
		totals,
		decisions,
		drafts,
		ageing,
		names: {
			entity: Object.fromEntries(entities.map((x) => [x.id, x.name])),
			service: Object.fromEntries(services.map((x) => [x.id, x.name]))
		},
		me: locals.user!.id
	};
};
