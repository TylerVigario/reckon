import { error } from '@sveltejs/kit';
import { and, desc, eq, gte, isNull, or, sql } from 'drizzle-orm';
import { Decimal } from '#lib/decimal.ts';
import { db } from '#lib/server/db/index.ts';
import { businessToday, personalDay } from '#lib/server/calendar.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { balances } from '#lib/server/balances.ts';
import { findClient } from '#lib/server/find.ts';
import { loadAgreements, usedThisMonth } from '#lib/server/valuation/load.ts';
import { hoursOf } from '#lib/server/valuation/misc.ts';
import { rateIsStale } from '#lib/server/stale.ts';
import type { PageServerLoad } from './$types';

/**
 * One client: what they owe, what they have agreed to, and where they are.
 *
 * The tax rate shown is the rate at their site, not a property of the client.
 * A client is not a place -- two clients can work at one address, and one
 * client can work in two districts.
 */
export const load: PageServerLoad = async ({ params }) => {
	const { id } = await findClient(params.id);
	const e = t.entity;
	const ec = t.entityContact;
	const c = t.contact;
	const cn = t.creditNote;
	const ca = t.creditApplication;
	const stale = rateIsStale(t.site.areaVerifiedOn, businessToday());

	const {
		rows: [client]
	} = await db.execute<{
		id: string;
		slug: string;
		version: string;
		name: string;
		active: boolean;
		terms: number | null;
		payment_method: string | null;
		tax_exempt: boolean;
		certificate: string | null;
		expires_on: string | null;
		contact: string | null;
		owed: string;
		out: string;
		credit: string;
		rules: string | null;
	}>(sql`
		with owing as (
			select entity_id, sum(owed) as owed, count(*) filter (where owed > 0) as out
			  from ${balances} b
			 where status = 'sent' group by entity_id
		)
		select ${e.id} as id, ${e.slug} as slug, ${e.name} as name, ${e.active} as active,
		       ${e}.xmin::text as version,
		       coalesce(${e.termsDays}, (select ${t.operator.defaultTermsDays} from ${t.operator})) as terms,
		       ${e.paymentMethod} as payment_method, ${e.taxExempt} as tax_exempt,
		       ${e.exemptionCertificate} as certificate,
		       ${e.exemptionExpiresOn}::text as expires_on,
		       (select ${c.name} from ${ec} join ${c} on ${c.id} = ${ec.contactId}
		         where ${ec.entityId} = ${e.id} and ${ec.isPrimary} limit 1) as contact,
		       coalesce(o.owed, 0)::numeric(12,2)::text as owed,
		       coalesce(o.out, 0)::text as out,
		       -- Notes and what has been applied from them, each added up on its
		       -- own: joined first, a note applied twice would count twice.
		       ((select coalesce(sum(${cn.amount}), 0) from ${cn} where ${cn.entityId} = ${e.id})
		        - (select coalesce(sum(${ca.amount}), 0)
		             from ${ca} join ${cn} on ${cn.id} = ${ca.creditNoteId}
		            where ${cn.entityId} = ${e.id}))::text as credit,
		       (select ${t.operator.taxRuleSet} from ${t.operator}) as rules
		  from ${e}
		  left join owing o on o.entity_id = ${e.id}
		 where ${e.id} = ${id}`);

	if (!client) error(404, 'no such client');

	const active = and(eq(t.site.entityId, id), eq(t.site.active, true));
	const today = businessToday();
	const [[sites], levies, running, recent] = await Promise.all([
		// The client page says how many places and roughly where; the sites page
		// says everything else, because a client's terms and its addresses are
		// two subjects.
		db
			.select({
				n: sql<number>`count(*)::int`,
				towns: sql<
					string | null
				>`string_agg(distinct coalesce(${t.site.city}, ${t.site.label}), ', ')`,
				unchecked: sql<number>`(count(*) filter (where ${stale}))::int`,
				miles: sql<string | null>`max(${t.site.roundTripMiles})::text`
			})
			.from(t.site)
			.where(active),
		db
			.select({
				name: t.site.taxJurisdiction,
				rate_pct: sql<string>`max(${t.site.taxRatePct})::text`,
				state_rate_pct: sql<string>`max(${t.site.stateRatePct})::text`,
				district_rate_pct: sql<string>`max(${t.site.districtRatePct})::text`,
				sites: sql<string>`count(*)::text`,
				priced_on: sql<string>`max(${t.site.areaVerifiedOn})::text`,
				stale: sql<boolean>`bool_or(${stale})`
			})
			.from(t.site)
			.where(active)
			.groupBy(t.site.taxJurisdiction)
			.orderBy(t.site.taxJurisdiction),
		db
			.select({
				id: t.agreement.id,
				site: t.site.display,
				price: t.agreement.price,
				interval: t.agreement.billingInterval
			})
			.from(t.agreement)
			.leftJoin(t.site, eq(t.site.id, t.agreement.siteId))
			.where(
				and(
					eq(t.agreement.entityId, id),
					or(isNull(t.agreement.endsOn), gte(t.agreement.endsOn, sql`${businessToday()}::date`))
				)
			)
			.orderBy(sql`${t.site.display} nulls first`),
		db
			.select({
				id: t.invoice.id,
				number: t.invoice.number,
				status: t.invoice.status,
				gross: sql<string>`coalesce(sum(${t.invoiceLine.amount} + ${t.invoiceLine.amount} * ${t.invoiceLine.taxRatePct} / 100), 0)::numeric(12,2)::text`,
				on: sql<string>`coalesce(${personalDay(t.invoice.sentAt)}, ${personalDay(t.invoice.createdAt)})::text`
			})
			.from(t.invoice)
			.leftJoin(t.invoiceLine, eq(t.invoiceLine.invoiceId, t.invoice.id))
			.where(eq(t.invoice.entityId, id))
			.groupBy(t.invoice.id)
			.orderBy(desc(sql`coalesce(${t.invoice.sentAt}, ${t.invoice.createdAt})`))
			.limit(5)
	]);

	// Each running agreement -- the client's, and each site's -- with this
	// month's use against what it covers: "Help desk 1.25 h of unlimited". Every
	// hour counts against the agreement it falls under, billable or not.
	const [agreements, services] = await Promise.all([
		loadAgreements(db, [id]),
		db.select({ id: t.service.id, name: t.service.name }).from(t.service)
	]);
	const minutes = await usedThisMonth(db, agreements, today);
	const nameOf = new Map(services.map((s) => [s.id, s.name]));
	const coverOf = (agreementId: string) => {
		const a = agreements.find((x) => x.id === agreementId)!;
		const parts = a.services
			.map((s) => {
				const used = hoursOf(minutes.get(`${a.id}:${s.serviceId}`) ?? 0);
				const of =
					s.allotment === 'unlimited'
						? 'unlimited'
						: `${Decimal.from(s.includedHours ?? '0').toFixed(2)} h`;
				return { name: nameOf.get(s.serviceId) ?? '', text: `${used} h of ${of}` };
			})
			.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
		return parts.length ? parts.map((p) => `${p.name} ${p.text}`).join(', ') : null;
	};

	return {
		client,
		sites,
		levies,
		agreements: running.map((r) => {
			const a = agreements.find((x) => x.id === r.id)!;
			return {
				...r,
				covers: coverOf(r.id),
				// Charged in advance, so this month either has its charge or was given.
				given: a.periods.some((p) => p.given && p.periodStart <= today && today <= p.periodEnd)
			};
		}),
		recent
	};
};
