import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { asUser } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { balances } from '#lib/server/balances.ts';
import { moneyPlaces, taxRounding } from '#lib/server/business.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { problem } from '#lib/server/problem.ts';
import { UUID } from '#lib/field-rules.ts';
import { clientLink } from '#lib/client-link.ts';
import type { RequestHandler } from './$types';

/**
 * Sends a draft (0028): dates it today, on the business's clock, gives it its
 * due date from the client's terms or the business's, and its link, which
 * opens it without signing in. From then it is fixed (0001), and a correction
 * is a credit note.
 *
 * The draft is held while it is sent, so a line arriving at that moment waits
 * and then finds it gone out, and starts a new draft (#lib/server/lines). One
 * already sent answers with its link, so a send that is tapped twice is one.
 */
export const POST: RequestHandler = async ({ params, locals, url }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No invoice with that id.');
	const [rounding, places] = await Promise.all([taxRounding(), moneyPlaces()]);
	const owing = balances(rounding, places);
	const today = businessToday();

	const done = await asUser(locals.user!.id, async (tx) => {
		const [inv] = await tx
			.select({
				status: t.invoice.status,
				token: t.invoice.publicToken,
				terms: sql<number>`coalesce(${t.entity.termsDays},
				          (select ${t.operator.defaultTermsDays} from ${t.operator}), 0)::int`
			})
			.from(t.invoice)
			.innerJoin(t.entity, eq(t.entity.id, t.invoice.entityId))
			.where(eq(t.invoice.id, params.id))
			.for('update', { of: t.invoice });
		if (!inv) return 'missing' as const;
		if (inv.status === 'sent') return { token: inv.token!, repeat: true };
		if (inv.status !== 'draft') return 'void' as const;

		const {
			rows: [b]
		} = await tx.execute<{ lines: number; gross: string }>(sql`
			select (select count(*) from ${t.invoiceLine} where ${t.invoiceLine.invoiceId} = ${params.id})::int as lines,
			       (select b.gross from ${owing} b where b.invoice_id = ${params.id})::text as gross`);
		if (!b || b.lines === 0) return 'empty' as const;
		if (Number(b.gross) < 0) return 'negative' as const;

		const token = randomBytes(32).toString('base64url');
		await tx
			.update(t.invoice)
			.set({
				status: 'sent',
				issuedOn: today,
				dueOn: sql`(${today}::date + ${inv.terms}::int)`,
				sentAt: sql`now()`,
				publicToken: token
			})
			.where(eq(t.invoice.id, params.id));
		return { token, repeat: false };
	});

	if (done === 'missing') return problem('notFound', 404, 'No invoice with that id.');
	if (done === 'void') return problem('conflict', 409, 'It was voided, and cannot be sent.');
	if (done === 'empty') return refuse({ invoice: 'There is nothing on it to send.' });
	if (done === 'negative')
		return refuse({ invoice: 'It comes to less than nothing. That is a credit note.' });
	return Response.json(
		{ link: clientLink(url.origin, done.token) },
		{ status: done.repeat ? 200 : 201 }
	);
};
