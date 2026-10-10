import { error } from '@sveltejs/kit';
import { asc, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { balances } from '#lib/server/balances.ts';
import { moneyPlaces, taxRounding } from '#lib/server/business.ts';
import { businessToday } from '#lib/server/calendar.ts';
import type { PageServerLoad } from './$types';

/**
 * THE CLIENT'S PAGE (0028): one sent invoice, opened by its link without
 * signing in (#lib/client-link). It shows what the invoice asks for and what is
 * still owed on it, and who it is from -- the business's name, address and how
 * to reach it. Nothing of how the work was done is shown: who did it, or a
 * note written about it, is the business's, not the client's.
 *
 * A draft has no link, and a token that is not one answers the same as a
 * draft, so the page says nothing about which invoices exist.
 */
export const load: PageServerLoad = async ({ params, setHeaders }) => {
	// Never kept by a shared cache, and never reused for somebody else.
	setHeaders({ 'cache-control': 'private, no-store' });
	const gone = () => error(404, 'There is no invoice at this link.');
	if (!/^[A-Za-z0-9_-]{20,64}$/.test(params.token)) gone();

	const [inv] = await db
		.select({
			id: t.invoice.id,
			number: t.invoice.number,
			status: t.invoice.status,
			issued_on: t.invoice.issuedOn,
			due_on: t.invoice.dueOn,
			expires_on: t.invoice.tokenExpiresOn,
			to: t.entity.name
		})
		.from(t.invoice)
		.innerJoin(t.entity, eq(t.entity.id, t.invoice.entityId))
		.where(eq(t.invoice.publicToken, params.token));
	if (!inv || inv.status === 'draft') gone();
	if (inv.expires_on && inv.expires_on < businessToday())
		error(410, 'This link has expired. Ask for a new one.');

	const [from] = await db
		.select({
			name: t.operator.tradingName,
			address: t.operator.address,
			phone: t.operator.phone,
			email: t.operator.email,
			has_logo: sql<boolean>`${t.operator.logo} is not null`
		})
		.from(t.operator)
		.limit(1);
	const invoice = {
		number: inv.number,
		to: inv.to,
		issued_on: inv.issued_on,
		due_on: inv.due_on
	};
	if (inv.status === 'void') return { from, invoice, voided: true as const };

	const [rounding, places] = await Promise.all([taxRounding(), moneyPlaces()]);
	const owing = balances(rounding, places);
	const [lines, [totals]] = await Promise.all([
		db
			.select({
				description: t.invoiceLine.description,
				qty: t.invoiceLine.qty,
				unit: t.invoiceLine.unit,
				unit_price: t.invoiceLine.unitPrice,
				amount: t.invoiceLine.amount,
				// The day the work or the drive was, where the line came from one.
				on: sql<string | null>`coalesce(${t.timeEntry.workedOn}, ${t.trip.travelledOn})::text`
			})
			.from(t.invoiceLine)
			.leftJoin(t.timeEntry, eq(t.timeEntry.id, t.invoiceLine.timeEntryId))
			.leftJoin(t.tripLeg, eq(t.tripLeg.id, t.invoiceLine.tripLegId))
			.leftJoin(t.trip, eq(t.trip.id, t.tripLeg.tripId))
			.where(eq(t.invoiceLine.invoiceId, inv.id))
			.orderBy(asc(t.invoiceLine.seq)),
		db
			.execute<{
				tax: string;
				gross: string;
				paid: string;
				credited: string;
				owed: string;
				rate_pct: string | null;
				rates: number;
			}>(
				sql`select b.tax::text, b.gross::text, b.paid::text, b.credited::text, b.owed::text,
				           (select max(${t.invoiceLine.taxRatePct})::text from ${t.invoiceLine}
				             where ${t.invoiceLine.invoiceId} = ${inv.id} and ${t.invoiceLine.taxable}) as rate_pct,
				           (select count(distinct ${t.invoiceLine.taxRatePct})::int from ${t.invoiceLine}
				             where ${t.invoiceLine.invoiceId} = ${inv.id} and ${t.invoiceLine.taxable}) as rates
				      from ${owing} b where b.invoice_id = ${inv.id}`
			)
			.then((r) => r.rows)
	]);
	return { from, invoice, voided: false as const, lines, totals };
};
