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
	heads: number;
	hours: string;
	earned: string | null;
	paid: string | null;
	kept: string | null;
};

export type PartnerPay = {
	jobs: PayJob[];
	due: string;
	kept: string;
	rates: HourNow[];
};

/**
 * What the partnership owes for a month's work, resolved per job per day.
 *
 * Every figure is entry_worth's: each entry priced and paid by the price and
 * the rules in force ON THE DAY it was worked, not today's. Re-pricing August
 * at September's rates is how somebody gets paid the wrong figure and nobody
 * can say why. A job's figures are the sum of its entries'.
 *
 * What a job EARNED is what it bills by the hour plus, for hours a retainer
 * covered, its share of what the retainer charged -- so a covered job is not a
 * job that brought in nothing. Pay is per head: a team entry pays everybody on
 * it, each by their own rule, so subtracting it gives what the business keeps.
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
			       max(w.heads) as heads,
			       sum(t.minutes) / 60.0 as hours,
			       sum(w.earned) as earned,
			       sum(w.paid) as paid
			  from time_entry t
			  join entry_worth w on w.time_entry_id = t.id
			  join entity e on e.id = t.entity_id
			  left join site si on si.id = t.site_id
			  left join app_user u on u.id = t.worked_by
			 where t.billable
			   and t.worked_on between ${p.start} and ${p.end}
			 group by coalesce(si.display, e.name), t.worked_on, t.crew, u.name,
			          t.service_id, t.entity_id, t.worked_by
		)
		select job, worked_on::text, crew, who, heads,
		       hours::numeric(10,4)::text as hours,
		       earned::numeric(12,2)::text as earned,
		       paid::numeric(12,2)::text as paid,
		       (earned - paid)::numeric(12,2)::text as kept
		  from worked
		 order by worked_on, job`;

	const due = jobs.reduce((n, j) => n + Number(j.paid ?? 0), 0).toFixed(2);
	const kept = jobs.reduce((n, j) => n + Number(j.kept ?? 0), 0).toFixed(2);
	return { jobs, due, kept, rates: await anHourNow() };
}

export type HourNow = {
	service_id: string;
	service: string;
	crew: 'one' | 'team';
	who: string;
	billed: string;
	paid: string | null;
	kept: string;
	unpaid: boolean;
	since: string | null;
};

/**
 * What an hour of each hourly service is worth now, at the every-client price,
 * and what it leaves the business once its rules have paid.
 *
 * One person first, grouped by what they are paid: everybody paid alike is
 * one row, and a person whose own rule sets them apart gets their own. A
 * person no rule reaches is marked unpaid rather than shown as keeping it all,
 * which is what an unpaid person looks like from the business's side.
 *
 * Then the team, where there is one and the service has a team to price: an
 * additional-person rate of its own, or team entries already worked. Crossing
 * every hourly service with a team invents rows nobody works -- a margin on
 * research that is never billed to anyone.
 *
 * Every figure is billed_amount() and time_pay(), the functions an entry is
 * worked out by, so this cannot tell a different story from the entries.
 */
export async function anHourNow(): Promise<HourNow[]> {
	return sql<HourNow[]>`
		with people as (
		  select id, name from app_user where active and role_id is not null
		),
		priced as (
		  select s.id, s.name, sp.effective_from as priced_from, sp.additional_rate
		    from service s
		    cross join lateral service_price_on(s.id, null, current_date) sp
		   where s.active and s.unit = 'hour' and sp.id is not null
		),
		one as (
		  select pr.id as service_id, pr.name as service, p.name as person, b.billed,
		         time_pay(pr.id, p.id, null, current_date, 3600, b.billed) as paid,
		         greatest(pr.priced_from, r.effective_from) as since
		    from priced pr
		    cross join people p
		    cross join lateral (
		      select billed_amount(pr.id, null, 1, current_date, 1) as billed) b
		    cross join lateral pay_rule_on(pr.id, p.id, null, 'time', current_date) r
		),
		team as (
		  select pr.id as service_id, pr.name as service, b.billed,
		         sum(tp.paid) as paid,
		         count(tp.paid) < count(*) as unpaid,
		         greatest(pr.priced_from, max(tp.since)) as since
		    from priced pr
		    cross join lateral (
		      select billed_amount(pr.id, null, (select count(*)::int from people),
		                           current_date, 1) as billed) b
		    cross join people p
		    cross join lateral (
		      select time_pay(pr.id, p.id, null, current_date, 3600, b.billed) as paid,
		             (pay_rule_on(pr.id, p.id, null, 'time', current_date)).effective_from
		               as since) tp
		   where (select count(*) from people) > 1
		     and (pr.additional_rate > 0
		          or exists (select 1 from time_entry t
		                      where t.service_id = pr.id and t.crew = 'team'))
		   group by pr.id, pr.name, b.billed, pr.priced_from
		)
		select service_id, service, 'one' as crew,
		       string_agg(person, ' and ' order by person) as who,
		       billed::text, paid::text,
		       (billed - coalesce(paid, 0))::numeric(12,2)::text as kept,
		       paid is null as unpaid,
		       max(since)::text as since
		  from one
		 group by service_id, service, billed, paid
		union all
		select service_id, service, 'team', 'the team',
		       billed::text, paid::text,
		       (billed - coalesce(paid, 0))::numeric(12,2)::text,
		       unpaid, since::text
		  from team
		 order by service, crew, who`;
}

export type MeteredService = {
	service: string;
	allotment: string;
	cap_hours: string | null;
	hours_used: string;
	hours_left: string | null;
};

export type Responder = {
	person: string;
	hours: string;
	share: string;
	paid: string | null;
};

export type MeterRow = {
	entity_id: string;
	client: string;
	services: MeteredService[];
	responders: Responder[];
	// The retainer's own charge for the month: made, given, or not made yet.
	// Null for a client with no retainer running.
	retainer: {
		state: 'charged' | 'given' | 'uncharged';
		amount: string;
		// What it charges at its price -- what a given month was worth.
		charge: string;
	} | null;
	charged: string;
	paid: string | null;
};

export type RetainerMeter = {
	rows: MeterRow[];
	charged: string;
	paid: string | null;
	kept: string | null;
};

/**
 * What each client's retainer covered in a month, and what it earned.
 *
 * A retainer meters even when it is unlimited. That is the whole point of the
 * screen: at a flat price per site, hours used is the only way to tell whether
 * the retainer is priced anywhere near the work, and an unlimited allotment is
 * exactly the case where nobody is counting.
 *
 * What is metered is what the agreement names, service by service -- nothing
 * is inferred from what kind of work it was. A client with no agreement still
 * appears for a service sold as a subscription, against the service's own
 * terms, because "how much has this client had" is the same question whether
 * or not they signed anything; what they worked is then billed by the hour.
 *
 * WHO ANSWERED, AND WHAT SHARE. Covered time pays a percentage of the retainer,
 * split by each person's share of the covered hours -- so the share is shown,
 * because it is what their pay was worked out from. Pay that depends on a
 * period not yet charged is not known, and says so rather than reading $0.
 */
export async function retainerMeter(p: Period): Promise<RetainerMeter> {
	const rows = await sql<MeterRow[]>`
		with running as (
			select a.id, a.entity_id from agreement a
			 where a.starts_on <= ${p.end}
			   and (a.ends_on is null or a.ends_on >= ${p.start})
		),
		covered as (
			select r.entity_id, al.service_id, al.allotment, al.pooled_hours
			  from running r
			  join agreement_allotment al on al.agreement_id = r.id
		),
		worked as (
			-- Every hour counts toward what was used, billable or not: an hour
			-- given away is still an hour the retainer's price has to carry.
			select t.entity_id, t.service_id,
			       sum(t.minutes) / 60.0 as hours,
			       coalesce(sum(w.billed) filter (where t.billable), 0) as billed,
			       coalesce(sum(w.paid), 0) as paid,
			       bool_or(w.paid is null and w.covered_minutes > 0) as pay_unknown
			  from time_entry t
			  join entry_worth w on w.time_entry_id = t.id
			 where t.entity_id is not null
			   and t.worked_on between ${p.start} and ${p.end}
			 group by t.entity_id, t.service_id
		),
		metered as (
			select c.entity_id, c.service_id, c.allotment, c.pooled_hours as cap
			  from covered c
			union all
			select wk.entity_id, s.id, s.subscription_basis, s.subscription_hours
			  from worked wk
			  join service s on s.id = wk.service_id
			 where s.subscription_basis <> 'none'
			   and not exists (select 1 from covered c
			                    where c.entity_id = wk.entity_id
			                      and c.service_id = wk.service_id)
		),
		lines as (
			select m.entity_id, s.name as service, m.allotment, m.cap,
			       coalesce(wk.hours, 0) as hours,
			       coalesce(wk.billed, 0) as billed,
			       coalesce(wk.paid, 0) as paid,
			       coalesce(wk.pay_unknown, false) as pay_unknown
			  from metered m
			  join service s on s.id = m.service_id
			  left join worked wk on wk.entity_id = m.entity_id
			                     and wk.service_id = m.service_id
		),
		-- A retainer's own charge for the period, which is what the client pays
		-- whether they call or not. Once per client, however many services it
		-- covers. It is charged in advance, so a month under way already has
		-- one -- unless it was given, or nobody has charged it yet.
		retained as (
			select r.entity_id,
			       sum(pd.amount) as amount,
			       sum(pd.periods) as periods,
			       coalesce(bool_and(pd.given), false) as given,
			       sum(agreement_charge(r.id)) as charge
			  from running r
			  cross join lateral (
			    select coalesce(sum(ap.amount), 0) as amount, count(ap.id) as periods,
			           bool_and(ap.given) as given
			      from agreement_period ap
			     where ap.agreement_id = r.id
			       and ap.period_start <= ${p.end} and ap.period_end >= ${p.start}) pd
			 group by r.entity_id
		),
		clients as (
			select entity_id from lines union select entity_id from retained
		)
		select e.id as entity_id,
		       e.name as client,
		       coalesce(json_agg(json_build_object(
		                  'service', l.service,
		                  'allotment', l.allotment,
		                  'cap_hours', l.cap::numeric(10,2)::text,
		                  'hours_used', l.hours::numeric(10,2)::text,
		                  'hours_left', case when l.allotment = 'unlimited' then null
		                                     else greatest(coalesce(l.cap, 0) - l.hours, 0)
		                                            ::numeric(10,2)::text end)
		                order by l.service) filter (where l.service is not null),
		                '[]') as services,
		       -- Everyone who worked covered time for this client this month, and
		       -- their share of it in person-hours: a team hour is one each.
		       coalesce((
		         select json_agg(json_build_object(
		                  'person', r.person,
		                  'hours', (r.minutes / 60.0)::numeric(10,2)::text,
		                  'share', r.share::numeric(5,1)::text,
		                  'paid', case when r.unknown then null else r.paid::text end)
		                order by r.minutes desc, r.person)
		           from (select g.*, 100.0 * g.minutes / sum(g.minutes) over () as share
		                   from (select u.name as person,
		                                sum(ep.covered_minutes) as minutes,
		                                sum(ep.covered_paid) as paid,
		                                bool_or(ep.covered_paid is null) as unknown
		                           from entry_pay ep
		                           join time_entry t on t.id = ep.time_entry_id
		                           join app_user u on u.id = ep.user_id
		                          where t.entity_id = e.id and ep.covered_minutes > 0
		                            and t.worked_on between ${p.start} and ${p.end}
		                          group by u.name) g) r), '[]') as responders,
		       case when rt.entity_id is null then null
		            else json_build_object(
		                   'state', case when rt.periods = 0 then 'uncharged'
		                                 when rt.given then 'given'
		                                 else 'charged' end,
		                   'amount', rt.amount::numeric(12,2)::text,
		                   'charge', rt.charge::numeric(12,2)::text)
		       end as retainer,
		       -- The retainer, plus whatever was billed by the hour: services it
		       -- does not cover, and time past an allotment.
		       (coalesce(rt.amount, 0) + coalesce(sum(l.billed), 0))
		         ::numeric(12,2)::text as charged,
		       case when bool_or(l.pay_unknown) then null
		            else coalesce(sum(l.paid), 0)::numeric(12,2)::text end as paid
		  from clients c
		  join entity e on e.id = c.entity_id
		  left join lines l on l.entity_id = c.entity_id
		  left join retained rt on rt.entity_id = c.entity_id
		 where e.active
		 group by e.id, e.name, rt.entity_id, rt.amount, rt.periods, rt.given, rt.charge
		 order by e.name`;

	const charged = rows.reduce((n, r) => n + Number(r.charged), 0);
	// One client's pay not known yet is the total's not known yet: a sum that
	// quietly counts it as nothing overstates what was kept.
	const known = rows.every((r) => r.paid !== null);
	const paid = rows.reduce((n, r) => n + Number(r.paid ?? 0), 0);
	return {
		rows,
		charged: charged.toFixed(2),
		paid: known ? paid.toFixed(2) : null,
		kept: known ? (charged - paid).toFixed(2) : null
	};
}

export type GivenRow = { service: string; hours: string; worth: string | null };

/**
 * What the business costs itself: hours worked and not charged for, priced at
 * what they would have billed -- entry_worth's figure, the client's own price
 * where it has one. Given away on purpose is still given away, and a decision
 * nobody can see was never made.
 */
export async function nonBillable(p: Period) {
	const rows = await sql<GivenRow[]>`
		select s.name as service,
		       (sum(t.minutes) / 60.0)::numeric(10,4)::text as hours,
		       sum(w.billed)::numeric(12,2)::text as worth
		  from time_entry t
		  join entry_worth w on w.time_entry_id = t.id
		  join service s on s.id = t.service_id
		 where not t.billable
		   and t.worked_on between ${p.start} and ${p.end}
		 group by s.name
		 order by sum(t.minutes) desc`;

	const hours = rows.reduce((n, r) => n + Number(r.hours), 0);
	const worth = rows.reduce((n, r) => n + Number(r.worth ?? 0), 0);
	return { rows, hours: hours.toFixed(4), worth: worth.toFixed(2) };
}
