import { businessToday, personalDay, businessDay } from '#lib/server/calendar.ts';
import { sql } from 'kysely';
import { Decimal, sumMoney } from '#lib/decimal.ts';
import { db } from '#lib/server/db/index.ts';
import { balances } from '#lib/server/balances.ts';
import { moneyPlaces, taxRounding } from '#lib/server/business.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import { isOfflineCopy } from '#lib/offline-copy.ts';
import type { PageServerLoad } from './$types';

/**
 * Invoices: drafted, out, and recently settled. Someone with Field sees the
 * drafts, to add lines to, and nothing that has gone out (#lib/access).
 *
 * A total is the sum of its lines plus the tax each line carried when it was
 * billed -- never a live rate lookup. invoice_line stores the rate as applied,
 * so an invoice sent in June still says what June said.
 *
 * KEPT FOR NO SIGNAL (#lib/offline-copy), it is the drafts to add to, by
 * number and client: what has gone out, what has been paid, and what any of
 * it comes to, need a connection.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const [rounding, places] = await Promise.all([taxRounding(), moneyPlaces()]);
	const today = businessToday();

	const rows = await db
		.with('kinds', (qc) =>
			qc
				.selectFrom('invoice_line as il')
				.select((eb) => [
					'il.invoice_id',
					eb.fn
						.agg<string>('string_agg', [eb.cast<string>('il.kind', 'text'), eb.val(', ')])
						.distinct()
						.orderBy(eb.cast<string>('il.kind', 'text'))
						.as('kinds')
				])
				.groupBy('il.invoice_id')
		)
		// The day the last payment against it arrived.
		.with('settled', (qc) =>
			qc
				.selectFrom('payment_allocation as pa')
				.innerJoin('payment as p', 'p.id', 'pa.payment_id')
				.select((eb) => ['pa.invoice_id', eb.fn.max('p.received_on').as('paid_on')])
				.groupBy('pa.invoice_id')
		)
		.selectFrom('invoice as i')
		.innerJoin('entity as e', 'e.id', 'i.entity_id')
		.innerJoin(balances(rounding, places).as('b'), 'b.invoice_id', 'i.id')
		.leftJoin('kinds as k', 'k.invoice_id', 'i.id')
		.leftJoin('settled as s', 's.invoice_id', 'i.id')
		.select((eb) => [
			'i.id',
			'i.client_uuid',
			'i.number',
			'i.status',
			'e.name as who',
			eb.cast<string | null>('i.issued_on', 'text').as('issued_on'),
			eb.cast<string | null>('i.due_on', 'text').as('due_on'),
			eb.cast<string | null>(personalDay(eb.ref('i.sent_at')), 'text').as('sent_on'),
			eb.cast<string | null>('s.paid_on', 'text').as('paid_on'),
			'e.terms_days as terms',
			'k.kinds',
			eb.cast<string>('b.gross', 'text').as('gross'),
			eb.cast<string>('b.owed', 'text').as('owed'),
			eb
				.case()
				.when('i.sent_at', 'is not', null)
				.then(sql<number>`${today}::date - ${businessDay(eb.ref('i.sent_at'))}`)
				.end()
				.as('days_out'),
			eb
				.and([eb('i.due_on', 'is not', null), eb('i.due_on', '<', today), eb('b.owed', '>', '0')])
				.$castTo<boolean>()
				.as('overdue')
		])
		.where('i.status', '<>', 'void')
		.$if(fieldOnly(locals), (qb) => qb.where('i.status', '=', 'draft'))
		.orderBy('i.created_at', 'desc')
		.execute();

	const drafts = rows.filter((r) => r.status === 'draft');
	// Out is sent and not yet paid in full: a part-payment leaves the rest owed.
	const out = rows.filter((r) => r.status === 'sent' && Decimal.from(r.owed).gt(0));
	const paid = rows.filter((r) => r.paid_on !== null && Decimal.from(r.owed).isZero()).slice(0, 5);

	if (isOfflineCopy(url))
		return {
			drafts: drafts.map((d) => ({ ...d, gross: null, owed: null })),
			out: [],
			paid: [],
			totals: null,
			offline: true,
			as_of: new Date().toISOString()
		};

	return {
		drafts,
		out,
		paid,
		totals: {
			owed: sumMoney(
				out.map((r) => r.owed),
				places
			),
			overdue: sumMoney(
				out.filter((r) => r.overdue).map((r) => r.owed),
				places
			),
			overdueCount: out.filter((r) => r.overdue).length,
			drafted: sumMoney(
				drafts.map((r) => r.gross),
				places
			)
		},
		offline: false,
		// When this copy was made: shown when it is opened with no signal.
		as_of: new Date().toISOString()
	};
};
