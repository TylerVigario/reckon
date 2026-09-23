import { sql } from './db';
import type { Period } from './periods';

/**
 * The three things somebody outside the business asks for, and the one thing
 * the business asks itself.
 *
 * None of these is a report in the usual sense -- each is the same data grouped
 * the way a return, a partner, or a retainer needs it. They live here rather
 * than in one page because the index shows each one's headline figure beside
 * the link to it, and a headline computed differently from the page it links to
 * is a bug that takes a year to find.
 *
 * Money is NUMERIC throughout and stays a string out of Postgres.
 */

export type DistrictRow = {
	area: string;
	rate_pct: string | null;
	state_rate_pct: string | null;
	district_rate_pct: string | null;
	measure: string;
	deduction: string;
	net: string;
	tax: string;
	lines: number;
	sites: number;
};

export type ScheduleA = {
	districts: DistrictRow[];
	due: string;
	claimsResold: boolean;
	unchecked: { site: string; client: string; why: string }[];
	overrides: { invoice: string; description: string; rate_pct: string; reason: string | null }[];
};

/**
 * Schedule A: the measure and the deduction, by the CDTFA area the work
 * happened in.
 *
 * BY JURISDICTION, NOT BY DISTRICT. The rate API answers with one combined
 * rate per address and the area's name -- it does not decompose into the
 * districts making it up. Breaking out further would mean keeping a local
 * table of districts, which is exactly the second copy of CDTFA's data that
 * was removed: a copy nobody refreshes is what over-collects.
 *
 * DISTRICT TAX FOLLOWS THE JOBSITE, not the billing address -- Reg 1826 puts
 * the place of use of materials at the jobsite, and the jobsite is the place of
 * sale of a fixture. So every line is grouped by the area of the SITE on the
 * line, never by anything on the client.
 *
 * An address CDTFA has not been asked about lately is listed by name. The rate
 * on file is not wrong, but it is not known to be right either, and a district
 * added or ended in between would have been charged wrongly ever since.
 */
export async function scheduleA(p: Period): Promise<ScheduleA> {
	const [{ claims }] = await sql<{ claims: boolean }[]>`
		select claims_tax_paid_purchases_resold as claims from operator`;

	const districts = await sql<DistrictRow[]>`
		with billed as (
			select il.site_id, il.amount, il.ex_tax_cost
			  from invoice_line il
			  join invoice i on i.id = il.invoice_id
			 where i.status in ('sent', 'paid')
			   and i.issued_on between ${p.start} and ${p.end}
			   and il.taxable
		)
		select sr.tax_jurisdiction as area,
		       max(sr.rate_pct)::text as rate_pct,
		       max(sr.state_rate_pct)::text as state_rate_pct,
		       max(sr.district_rate_pct)::text as district_rate_pct,
		       coalesce(sum(b.amount), 0)::numeric(12,2)::text as measure,
		       -- Reg 1701: tax already paid on goods that were resold comes off
		       -- the measure, and only if the operator has made that election.
		       (case when ${claims} then coalesce(sum(b.ex_tax_cost), 0)
		             else 0 end)::numeric(12,2)::text as deduction,
		       (coalesce(sum(b.amount), 0)
		        - case when ${claims} then coalesce(sum(b.ex_tax_cost), 0)
		               else 0 end)::numeric(12,2)::text as net,
		       ((coalesce(sum(b.amount), 0)
		         - case when ${claims} then coalesce(sum(b.ex_tax_cost), 0)
		                else 0 end)
		        * coalesce(max(sr.rate_pct), 0) / 100)::numeric(12,2)::text as tax,
		       count(b.*)::int as lines,
		       count(distinct s.id)::int as sites
		  from site s
		  join site_rate sr on sr.site_id = s.id
		  left join billed b on b.site_id = s.id
		 where s.active
		 group by sr.tax_jurisdiction
		 order by 1`;

	const unchecked = await sql<{ site: string; client: string; why: string }[]>`
		select s.display as site, e.name as client,
		       'Last priced ' || to_char(sr.verified_on, 'FMDD Mon YYYY') ||
		         ', ' || (current_date - sr.verified_on) || ' days ago' as why
		  from site s
		  join entity e on e.id = s.entity_id
		  join site_rate sr on sr.site_id = s.id
		 where s.active and sr.stale
		 order by sr.verified_on, e.name, s.display`;

	// A rate that did not come from the site is never folded into an area.
	// It is shown on its own, with the reason it was overridden.
	const overrides = await sql<
		{ invoice: string; description: string; rate_pct: string; reason: string | null }[]
	>`
		select i.number as invoice, il.description, il.tax_rate_pct::text as rate_pct,
		       il.tax_override_reason as reason
		  from invoice_line il
		  join invoice i on i.id = il.invoice_id
		 where i.status in ('sent', 'paid')
		   and i.issued_on between ${p.start} and ${p.end}
		   and il.tax_source = 'override'
		 order by i.number, il.seq`;

	const due = districts.reduce((n, d) => n + Number(d.tax), 0).toFixed(2);
	return { districts, due, claimsResold: claims, unchecked, overrides };
}

export type Obligation = {
	charged: string;
	state: string;
	district: string;
	remitted: string;
	outstanding: string;
	estimated_lines: number;
	filings: {
		id: string;
		period_start: string;
		period_end: string;
		filed_on: string | null;
		paid_on: string | null;
		amount: string;
		reference: string | null;
	}[];
};

/**
 * What was collected on somebody else's behalf, what has been handed over, and
 * the difference.
 *
 * TAX CHARGED IS NOT INCOME. It is held briefly and then passed on, so the
 * only figure that means anything is what is still held -- and that cannot be
 * derived from invoices alone, because whether a return was paid is a fact
 * about the world. tax_remittance records it; this subtracts.
 *
 * ACCRUAL, not cash: the obligation arises when the invoice is raised, not
 * when the client pays. That is the basis a sent invoice already implies, and
 * billing a client for tax while claiming not to owe it yet is the position
 * that goes wrong under audit.
 */
export async function taxObligation(p: Period): Promise<Obligation> {
	const [charged] = await sql<
		{
			charged: string;
			state: string;
			district: string;
			estimated_lines: number;
		}[]
	>`
		select coalesce(sum(t.tax), 0)::text as charged,
		       coalesce(sum(t.state_tax), 0)::text as state,
		       coalesce(sum(t.district_tax), 0)::text as district,
		       coalesce(sum(t.estimated_lines), 0)::int as estimated_lines
		  from invoice_tax t
		 where t.status in ('sent', 'paid')
		   and t.issued_on between ${p.start} and ${p.end}`;

	const filings = await sql<Obligation['filings']>`
		select id, period_start::text, period_end::text,
		       filed_on::text, paid_on::text, amount::text, reference
		  from tax_remittance
		 where period_start <= ${p.end} and period_end >= ${p.start}
		 order by period_start`;

	const remitted = filings.reduce((n, f) => n + Number(f.amount), 0);
	return {
		...charged,
		remitted: remitted.toFixed(2),
		outstanding: (Number(charged.charged) - remitted).toFixed(2),
		filings
	};
}

export type PayJob = {
	job: string;
	worked_on: string;
	crew: string;
	who: string | null;
	hours: string;
	billed: string | null;
	paid: string | null;
	kept: string | null;
};

export type PartnerPay = {
	jobs: PayJob[];
	due: string;
	kept: string;
	rates: {
		service: string;
		crew: string;
		billed: string | null;
		paid: string | null;
		from: string | null;
	}[];
};

/**
 * What the partnership owes its partners for a month, resolved per job per day.
 *
 * A guaranteed payment is for the hour worked, so it is priced at the pay rate
 * in force ON THE DAY -- not at today's. Re-pricing August at September's rates
 * is how a partner gets paid the wrong figure and nobody can say why.
 *
 * A TEAM HOUR PAYS TWICE. The billed rate for `team` is per hour of the job,
 * not per person; the pay is per head, so two heads are paid for the one hour.
 * Subtracting one from the other without doubling the pay reports a margin the
 * partnership does not have.
 */
export async function partnerPay(p: Period): Promise<PartnerPay> {
	const jobs = await sql<PayJob[]>`
		with worked as (
			-- One row per job per day. What makes it one job is everything that
			-- prices it: the client, the place, the service, the crew and who
			-- worked it. Two of those differing is two jobs, however near each
			-- other they happened.
			select coalesce(si.display, e.name) as job,
			       t.worked_on, t.crew,
			       u.name as who,
			       sum(t.minutes) / 60.0 as hours,
			       t.service_id, t.entity_id, t.worked_by
			  from time_entry t
			  join entity e on e.id = t.entity_id
			  left join site si on si.id = t.site_id
			  left join app_user u on u.id = t.worked_by
			 where t.billable
			   and t.worked_on between ${p.start} and ${p.end}
			 group by coalesce(si.display, e.name), t.worked_on, t.crew, u.name,
			          t.service_id, t.entity_id, t.worked_by
		)
		select w.job, w.worked_on::text, w.crew, w.who,
		       w.hours::numeric(10,4)::text as hours,
		       (w.hours * price.rate)::numeric(12,2)::text as billed,
		       (w.hours * pay.rate * case when w.crew = 'team' then 2 else 1 end)
		         ::numeric(12,2)::text as paid,
		       (w.hours * price.rate
		        - w.hours * pay.rate * case when w.crew = 'team' then 2 else 1 end)
		         ::numeric(12,2)::text as kept
		  from worked w
		  left join lateral (
		         select sp.rate from service_price sp
		          where sp.service_id = w.service_id
		            and sp.effective_from <= w.worked_on
		            and (sp.entity_id = w.entity_id or sp.entity_id is null)
		            and (sp.crew = w.crew or sp.crew is null)
		          order by (sp.entity_id is not null) desc,
		                   (sp.crew is not null) desc,
		                   sp.effective_from desc
		          limit 1) price on true
		  left join lateral (
		         select ppr.rate from person_pay_rate ppr
		          where ppr.effective_from <= w.worked_on
		            and (ppr.user_id = w.worked_by or ppr.user_id is null)
		            and (ppr.service_id = w.service_id or ppr.service_id is null)
		          order by (ppr.user_id is not null) desc,
		                   (ppr.service_id is not null) desc,
		                   ppr.effective_from desc
		          limit 1) pay on true
		 order by w.worked_on, w.job`;

	// What an hour is worth now, for every way an hour is ACTUALLY worked --
	// which is a pair, a service and a crew, not a service. Crossing every
	// hourly service with both crews invents rows nobody works: a remote call
	// taken by two people at once, or a margin on research that is never
	// billed to anyone. A pair earns its row by having a price of its own or
	// by having been worked and charged for.
	const rates = await sql<
		{
			service: string;
			crew: string;
			billed: string | null;
			paid: string | null;
			from: string | null;
		}[]
	>`
		select s.name as service, c.crew, price.rate::text as billed,
		       pay.rate::text as paid,
		       greatest(price.effective_from, pay.effective_from)::text as from
		  from service s
		  cross join (values ('one'), ('team')) as c(crew)
		  join lateral (
		         select sp.rate, sp.effective_from from service_price sp
		          where sp.service_id = s.id and sp.entity_id is null
		            and (sp.crew = c.crew or sp.crew is null)
		            and sp.effective_from <= current_date
		          order by (sp.crew is not null) desc, sp.effective_from desc
		          limit 1) price on true
		  join lateral (
		         select ppr.rate, ppr.effective_from from person_pay_rate ppr
		          where ppr.user_id is null
		            and (ppr.service_id = s.id or ppr.service_id is null)
		            and ppr.effective_from <= current_date
		          order by (ppr.service_id is not null) desc, ppr.effective_from desc
		          limit 1) pay on true
		 where s.active and s.unit = 'hour'
		   and (exists (select 1 from service_price sp2
		                 where sp2.service_id = s.id and sp2.crew = c.crew)
		     or exists (select 1 from time_entry t
		                 where t.service_id = s.id and t.billable and t.crew = c.crew))
		 order by s.name, c.crew desc`;

	const due = jobs.reduce((n, j) => n + Number(j.paid ?? 0), 0).toFixed(2);
	const kept = jobs.reduce((n, j) => n + Number(j.kept ?? 0), 0).toFixed(2);
	return { jobs, due, kept, rates };
}

export type MeterRow = {
	entity_id: string;
	client: string;
	site: string | null;
	allotment: string;
	cap_hours: string | null;
	hours_used: string;
	hours_left: string | null;
	charged: string;
	to_responder: string;
};

export type RemoteMeter = {
	rows: MeterRow[];
	charged: string;
	toResponder: string;
	toOperator: string;
};

/**
 * What remote support cost and what it earned, per client, for a month.
 *
 * A retainer meters even when it is unlimited. That is the whole point of the
 * screen: at a flat price per site, hours used is the only way to tell whether
 * the retainer is priced anywhere near the work, and an unlimited allotment is
 * exactly the case where nobody is counting.
 *
 * A client with no agreement still appears, against the remote service's own
 * cap -- because "how much free support has this client had" is the same
 * question whether or not they signed anything.
 */
export async function remoteMeter(p: Period): Promise<RemoteMeter> {
	const rows = await sql<MeterRow[]>`
		with remote as (
			select id, subscription_basis, subscription_hours from service
			 where delivery = 'remote' and active order by name limit 1
		),
		used as (
			select t.entity_id,
			       sum(t.minutes) / 60.0 as hours,
			       sum(t.minutes / 60.0 * (
			         select sp.rate from service_price sp
			          where sp.service_id = t.service_id
			            and sp.effective_from <= t.worked_on
			            and (sp.entity_id = t.entity_id or sp.entity_id is null)
			          order by (sp.entity_id is not null) desc, sp.effective_from desc
			          limit 1)) as billed
			  from time_entry t, remote r
			 where t.service_id = r.id
			   and t.worked_on between ${p.start} and ${p.end}
			 group by t.entity_id
		),
		-- A retainer's own charge for the period, which is what the client pays
		-- whether they call or not.
		retained as (
			select a.entity_id,
			       a.remote_allotment,
			       a.remote_cap_hours,
			       a.responder_rate,
			       coalesce(sum(ap.amount), 0) as amount
			  from agreement a
			  left join agreement_period ap on ap.agreement_id = a.id
			                               and ap.period_start <= ${p.end}
			                               and ap.period_end >= ${p.start}
			 where a.starts_on <= ${p.end}
			   and (a.ends_on is null or a.ends_on >= ${p.start})
			 group by a.entity_id, a.remote_allotment, a.remote_cap_hours, a.responder_rate
		)
		select e.id as entity_id,
		       e.name as client,
		       null::text as site,
		       coalesce(rt.remote_allotment, r.subscription_basis) as allotment,
		       coalesce(rt.remote_cap_hours, r.subscription_hours)::text as cap_hours,
		       coalesce(u.hours, 0)::numeric(10,2)::text as hours_used,
		       case when coalesce(rt.remote_allotment, r.subscription_basis) = 'unlimited'
		            then null
		            else greatest(coalesce(rt.remote_cap_hours, r.subscription_hours, 0)
		                          - coalesce(u.hours, 0), 0)::numeric(10,2)::text
		       end as hours_left,
		       (coalesce(rt.amount, 0) + case when rt.entity_id is null
		                                      then coalesce(u.billed, 0) else 0 end)
		         ::numeric(12,2)::text as charged,
		       (coalesce(u.hours, 0) * coalesce(rt.responder_rate, 0))
		         ::numeric(12,2)::text as to_responder
		  from entity e
		  cross join remote r
		  left join used u on u.entity_id = e.id
		  left join retained rt on rt.entity_id = e.id
		 where e.active
		   and (u.entity_id is not null or rt.entity_id is not null)
		 order by e.name`;

	const charged = rows.reduce((n, r) => n + Number(r.charged), 0);
	const toResponder = rows.reduce((n, r) => n + Number(r.to_responder), 0);
	return {
		rows,
		charged: charged.toFixed(2),
		toResponder: toResponder.toFixed(2),
		toOperator: (charged - toResponder).toFixed(2)
	};
}

export type GivenRow = { service: string; hours: string; worth: string | null };

/**
 * What the business costs itself: hours worked and not charged for, priced at
 * what they would have been worth. Given away on purpose is still given away,
 * and a decision nobody can see was never made.
 */
export async function nonBillable(p: Period) {
	const rows = await sql<GivenRow[]>`
		select s.name as service,
		       (sum(t.minutes) / 60.0)::numeric(10,4)::text as hours,
		       sum(t.minutes / 60.0 * (
		         select sp.rate from service_price sp
		          where sp.service_id = t.service_id
		            and sp.entity_id is null
		            and sp.effective_from <= t.worked_on
		          order by sp.effective_from desc limit 1))::numeric(12,2)::text as worth
		  from time_entry t
		  join service s on s.id = t.service_id
		 where not t.billable
		   and t.worked_on between ${p.start} and ${p.end}
		 group by s.name
		 order by sum(t.minutes) desc`;

	const hours = rows.reduce((n, r) => n + Number(r.hours), 0);
	const worth = rows.reduce((n, r) => n + Number(r.worth ?? 0), 0);
	return { rows, hours: hours.toFixed(4), worth: worth.toFixed(2) };
}
