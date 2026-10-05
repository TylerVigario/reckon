import { and, eq, notExists, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { businessToday, personalDay, businessDay } from '#lib/server/calendar.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { sum } from '#lib/decimal.ts';
import { entryColumns, valueEntries } from '#lib/server/valuation/load.ts';
import { rateIsStale } from '#lib/server/stale.ts';
import { balances } from '#lib/server/balances.ts';
import { moneyPlaces, taxRounding } from '#lib/server/business.ts';
import { count, dated } from '#lib/format.ts';
import { ageOf, type Age } from '#lib/ageing.ts';
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
	const [rounding, places] = await Promise.all([taxRounding(), moneyPlaces()]);
	const owing = balances(rounding, places);
	const today = businessToday();
	const i = t.invoice;
	const il = t.invoiceLine;
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
		select
		  round(coalesce(sum(b.owed) filter (where b.status = 'sent'), 0), ${places}::int)::text as owed,
		  count(*) filter (where b.status = 'sent' and b.owed > 0)::text              as owed_count,
		  round(coalesce(sum(b.gross) filter (where b.status = 'draft'), 0), ${places}::int)::text as drafts,
		  count(*) filter (where b.status = 'draft')::text                          as draft_count,
		  -- Collected on somebody else's behalf, so the figure worth seeing is
		  -- what is STILL HELD: charged on what has gone out, less the Reg 1701
		  -- credit that comes off the return, less what has been handed to
		  -- CDTFA. Whether a return was paid is a fact about the world, not
		  -- something the invoices know, which is why it is subtracted from a
		  -- table rather than inferred.
		  round(coalesce(sum(b.tax) filter (where b.status in ('sent', 'paid')), 0)
		   - (select coalesce(sum(${il.exTaxCost} * ${il.taxRatePct} / 100), 0)
		        from ${il} join ${i} on ${i.id} = ${il.invoiceId}
		       where ${il.taxable} and ${i.status} in ('sent', 'paid')
		         and (select ${t.operator.claimsTaxPaidPurchasesResold} from ${t.operator}))
		   - (select coalesce(sum(${t.taxRemittance.amount}), 0) from ${t.taxRemittance}),
		   ${places}::int)::text as tax_held
		  from ${owing} b
		 where b.status in ('sent', 'paid', 'draft')`);

	// Anything that cannot proceed until somebody decides. An invoice out past
	// the operator's own chase-after figure, and an address CDTFA has not been
	// asked about lately.
	const { rows: found } = await db.execute<{
		kind: 'invoice' | 'district';
		client: string;
		ref: string;
		dated_on: string;
		amount: string | null;
		days: number;
	}>(sql`
		select * from (
		select 'invoice' as kind, ${e.name} as client, ${i.number} as ref,
		       ${personalDay(i.sentAt)}::text as dated_on,
		       b.owed::text as amount,
		       ${businessToday()}::date - ${businessDay(i.sentAt)} as days,
		       'Invoice ' || ${i.number} || ' · ' || ${e.name} as sort
		  from ${i}
		  join ${e} on ${e.id} = ${i.entityId}
		  join ${owing} b on b.invoice_id = ${i.id}
		 where ${i.status} = 'sent'
		   and b.owed > 0
		   and ${i.sentAt} is not null
		   and ${businessToday()}::date - ${businessDay(i.sentAt)}
		       > coalesce((select ${t.operator.ageingAlertDays} from ${t.operator}), 30)
		union all
		select 'district', ${e.name}, ${s.display}, ${s.areaVerifiedOn}::text, null,
		       ${businessToday()}::date - ${s.areaVerifiedOn},
		       ${e.name} || ' · ' || ${s.display} || ' · rate is old'
		  from ${s}
		  join ${e} on ${e.id} = ${s.entityId}
		 where ${s.active} and ${rateIsStale(s.areaVerifiedOn, businessToday())}
		) d
		 -- Critical before warning, by severity rather than by how the kind
		 -- column happens to sort.
		 order by case kind when 'invoice' then 0 else 1 end, sort`);
	// Written here, with #lib/format, like every other date and count a person
	// reads.
	const decisions = found.map((d) =>
		d.kind === 'invoice'
			? {
					kind: d.kind,
					title: `Invoice ${d.ref} · ${d.client}`,
					detail: `Sent ${dated(d.dated_on)}, still unpaid.`,
					amount: d.amount,
					chip: `Unpaid ${count(d.days, 'day')}`
				}
			: {
					kind: d.kind,
					title: `${d.client} · ${d.ref} · rate is old`,
					detail:
						`CDTFA last priced this address on ${dated(d.dated_on)}. A district can be ` +
						'added or ended in between, and every invoice since would be wrong.',
					amount: d.amount,
					chip: `${count(d.days, 'day')} since CDTFA was asked`
				}
	);

	const { rows: drafts } = await db.execute<{
		id: string;
		number: string;
		who: string;
		lines: string;
		gross: string;
	}>(sql`
		select ${i.id} as id, ${i.number} as number, ${e.name} as who,
		       (select count(*) from ${il} where ${il.invoiceId} = ${i.id})::text as lines,
		       b.gross::text as gross
		  from ${i}
		  join ${e} on ${e.id} = ${i.entityId}
		  join ${owing} b on b.invoice_id = ${i.id}
		 where ${i.status} = 'draft'
		 order by ${i.createdAt} desc
		 limit 3`);

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
	const daysAgo = (d: string) => Temporal.PlainDate.from(d).until(today).days;
	const buckets = new Map<Age, { n: number; worth: (string | null)[]; oldest: number }>();
	for (const entry of unbilled) {
		const w = worth.get(entry.id)!;
		if (w.coveredMinutes !== null && w.coveredMinutes >= entry.minutes) continue;
		const days = daysAgo(entry.workedOn);
		const bucket = ageOf(days);
		const b = buckets.get(bucket) ?? { n: 0, worth: [], oldest: 0 };
		b.n += 1;
		b.worth.push(w.billed?.toString() ?? null);
		b.oldest = Math.max(b.oldest, days);
		buckets.set(bucket, b);
	}
	const ageing = [...buckets.entries()].map(([bucket, b]) => ({
		bucket,
		n: String(b.n),
		worth: sum(b.worth).toFixed(places),
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
