import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { asUser } from '#lib/server/db/index.ts';
import { balances } from '#lib/server/balances.ts';
import { moneyPlaces } from '#lib/server/business.ts';
import { TAX_ROUNDING } from '#lib/server/tax-rules.ts';
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
	const places = await moneyPlaces();
	const today = businessToday();

	const done = await asUser(locals.user!.id, async (tx) => {
		const inv = await tx
			.selectFrom('invoice as i')
			.innerJoin('entity as e', 'e.id', 'i.entity_id')
			.select((eb) => [
				'i.status',
				'i.public_token as token',
				eb
					.cast<number>(
						eb.fn.coalesce(
							'e.terms_days',
							eb.selectFrom('operator').select('operator.default_terms_days'),
							eb.lit(0)
						),
						'integer'
					)
					.as('terms')
			])
			.where('i.id', '=', params.id)
			.forUpdate('i')
			.executeTakeFirst();
		if (!inv) return 'missing' as const;
		if (inv.status === 'sent') return { token: inv.token!, repeat: true };
		if (inv.status !== 'draft') return 'void' as const;

		const b = await tx
			.selectNoFrom((eb) => [
				eb
					.cast<number>(
						eb
							.selectFrom('invoice_line')
							.select((eb) => eb.fn.countAll().as('n'))
							.where('invoice_line.invoice_id', '=', params.id),
						'integer'
					)
					.as('lines'),
				eb
					.cast<string>(
						eb
							.selectFrom(balances(TAX_ROUNDING, places).as('b'))
							.select('b.gross')
							.where('b.invoice_id', '=', params.id),
						'text'
					)
					.as('gross')
			])
			.executeTakeFirst();
		if (!b || b.lines === 0) return 'empty' as const;
		if (Number(b.gross) < 0) return 'negative' as const;

		const token = randomBytes(32).toString('base64url');
		await tx
			.updateTable('invoice')
			.set({
				status: 'sent',
				issued_on: today,
				due_on: sql<string>`(${today}::date + ${inv.terms}::int)`,
				sent_at: sql<Date>`now()`,
				public_token: token
			})
			.where('id', '=', params.id)
			.execute();
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
