import { error, redirect } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { balances } from '#lib/server/balances.ts';
import { moneyPlaces, taxRounding } from '#lib/server/business.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { UUID } from '#lib/field-rules.ts';
import type { PageServerLoad } from './$types';

/**
 * Sending a draft (0028): what it asks for, the day it will be dated and the
 * day it falls due, and who it is for. Sending is POST /api/invoices/[id]/send;
 * one already sent opens as itself.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!UUID.test(params.id)) error(404, 'no such invoice');
	const [rounding, places] = await Promise.all([taxRounding(), moneyPlaces()]);
	const owing = balances(rounding, places);
	const today = businessToday();

	const [inv] = await db
		.select({
			id: t.invoice.id,
			client_uuid: t.invoice.clientUuid,
			number: t.invoice.number,
			status: t.invoice.status,
			who: t.entity.name,
			terms: sql<number>`coalesce(${t.entity.termsDays},
			          (select ${t.operator.defaultTermsDays} from ${t.operator}), 0)::int`,
			due: sql<string>`(select b.gross from ${owing} b where b.invoice_id = ${t.invoice.id})::text`,
			tax: sql<string>`(select b.tax from ${owing} b where b.invoice_id = ${t.invoice.id})::text`,
			lines: sql<number>`(select count(*) from ${t.invoiceLine}
			                     where ${t.invoiceLine.invoiceId} = ${t.invoice.id})::int`
		})
		.from(t.invoice)
		.innerJoin(t.entity, eq(t.entity.id, t.invoice.entityId))
		.where(eq(t.invoice.id, params.id));
	if (!inv) error(404, 'no such invoice');
	if (inv.status !== 'draft') redirect(303, `/invoices/${inv.id}`);

	const [contact] = await db
		.select({ name: t.contact.name, email: t.contact.email, phone: t.contact.phone })
		.from(t.entityContact)
		.innerJoin(t.contact, eq(t.contact.id, t.entityContact.contactId))
		.innerJoin(t.invoice, eq(t.invoice.entityId, t.entityContact.entityId))
		.where(and(eq(t.invoice.id, inv.id), eq(t.entityContact.isPrimary, true)));
	const {
		rows: [{ due_on }]
	} = await db.execute<{ due_on: string }>(
		sql`select (${today}::date + ${inv.terms}::int)::text as due_on`
	);

	return { invoice: inv, contact: contact ?? null, today, due_on };
};
