import { hours } from '#lib/format.ts';
import { error, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { and, eq, gte, isNull, or, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { businessToday, personalDay } from '#lib/server/calendar.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { balances } from '#lib/server/balances.ts';
import { moneyPlaces, taxRounding } from '#lib/server/business.ts';
import { findClient } from '#lib/server/find.ts';
import { loadAgreements, usedThisMonth } from '#lib/server/valuation/load.ts';
import { hoursOf } from '#lib/server/valuation/misc.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import type { PageServerLoad } from './$types';

/**
 * A client's Details: how they are billed, what they have agreed to, their
 * credit and tax, and their recent invoices. What they owe heads every tab
 * (+layout); where they are is Sites, and who to ask for, Contacts.
 *
 * No tax rate: a rate is a site's, not the client's, and shown on the site.
 * A client is not a place -- two clients can work at one address, and one
 * client can work in two districts.
 *
 * Someone with Field reads where a client is, to work there, and nothing of
 * what they owe, have agreed to or been invoiced (#lib/access), so for them a
 * client opens on Sites.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	if (fieldOnly(locals)) redirect(307, resolve('/clients/[id]/sites', { id: params.id }));
	const [rounding, places] = await Promise.all([taxRounding(), moneyPlaces()]);
	const owing = balances(rounding, places);
	const { id } = await findClient(params.id);
	const e = t.entity;
	const cn = t.creditNote;
	const ca = t.creditApplication;

	const {
		rows: [client]
	} = await db.execute<{
		id: string;
		slug: string;
		version: string;
		name: string;
		active: boolean;
		terms: number | null;
		default_terms: number;
		payment_method: string | null;
		tax_exempt: boolean;
		certificate: string | null;
		expires_on: string | null;
		credit: string;
	}>(sql`
		select ${e.id} as id, ${e.slug} as slug, ${e.name} as name, ${e.active} as active,
		       ${e}.xmin::text as version,
		       ${e.termsDays} as terms,
		       (select ${t.operator.defaultTermsDays} from ${t.operator}) as default_terms,
		       ${e.paymentMethod} as payment_method, ${e.taxExempt} as tax_exempt,
		       ${e.exemptionCertificate} as certificate,
		       ${e.exemptionExpiresOn}::text as expires_on,
		       -- Notes and what has been applied from them, each added up on its
		       -- own: joined first, a note applied twice would count twice.
		       ((select coalesce(sum(${cn.amount}), 0) from ${cn} where ${cn.entityId} = ${e.id})
		        - (select coalesce(sum(${ca.amount}), 0)
		             from ${ca} join ${cn} on ${cn.id} = ${ca.creditNoteId}
		            where ${cn.entityId} = ${e.id}))::text as credit
		  from ${e}
		 where ${e.id} = ${id}`);

	if (!client) error(404, 'no such client');

	const today = businessToday();
	const [running, recent] = await Promise.all([
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
			.execute<{ id: string; number: string; status: string; gross: string; on: string }>(
				sql`
				select ${t.invoice.id} as id, ${t.invoice.number} as number, ${t.invoice.status} as status,
				       b.gross::text as gross,
				       coalesce(${personalDay(t.invoice.sentAt)}, ${personalDay(t.invoice.createdAt)})::text as on
				  from ${t.invoice}
				  join ${owing} b on b.invoice_id = ${t.invoice.id}
				 where ${t.invoice.entityId} = ${id}
				 order by coalesce(${t.invoice.sentAt}, ${t.invoice.createdAt}) desc
				 limit 5`
			)
			.then((r) => r.rows)
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
				const used = hours(hoursOf(minutes.get(`${a.id}:${s.serviceId}`) ?? 0), 'allotted');
				const of =
					s.allotment === 'unlimited' ? 'unlimited' : hours(s.includedHours ?? '0', 'allotted');
				return { name: nameOf.get(s.serviceId) ?? '', text: `${used} of ${of}` };
			})
			.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
		return parts.length ? parts.map((p) => `${p.name} ${p.text}`).join(', ') : null;
	};

	return {
		client,
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
