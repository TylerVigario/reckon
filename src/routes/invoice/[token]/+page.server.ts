import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { balances } from '#lib/server/balances.ts';
import { moneyPlaces } from '#lib/server/business.ts';
import { TAX_ROUNDING } from '#lib/server/tax-rules.ts';
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
	const gone: () => never = () => error(404, 'There is no invoice at this link.');
	if (!/^[A-Za-z0-9_-]{20,64}$/.test(params.token)) gone();

	const inv = await db
		.selectFrom('invoice as i')
		.innerJoin('entity as e', 'e.id', 'i.entity_id')
		.select([
			'i.id',
			'i.number',
			'i.status',
			'i.issued_on',
			'i.due_on',
			'i.token_expires_on as expires_on',
			'e.name as to'
		])
		.where('i.public_token', '=', params.token)
		.executeTakeFirst();
	if (!inv || inv.status === 'draft') gone();
	if (inv.expires_on && inv.expires_on < businessToday())
		error(410, 'This link has expired. Ask for a new one.');

	const from = await db
		.selectFrom('operator')
		.select((eb) => [
			'trading_name as name',
			'address',
			'phone',
			'email',
			eb('logo', 'is not', null).$castTo<boolean>().as('has_logo')
		])
		.limit(1)
		.executeTakeFirst();
	const invoice = {
		number: inv.number,
		to: inv.to,
		issued_on: inv.issued_on,
		due_on: inv.due_on
	};
	if (inv.status === 'void') return { from, invoice, voided: true as const };

	const places = await moneyPlaces();
	const [lines, totals] = await Promise.all([
		db
			.selectFrom('invoice_line as il')
			.leftJoin('time_entry as te', 'te.id', 'il.time_entry_id')
			.leftJoin('trip_leg as tl', 'tl.id', 'il.trip_leg_id')
			.leftJoin('trip as tr', 'tr.id', 'tl.trip_id')
			.select((eb) => [
				'il.description',
				'il.qty',
				'il.unit',
				'il.unit_price',
				'il.amount',
				// The day the work or the drive was, where the line came from one.
				eb.cast<string | null>(eb.fn.coalesce('te.worked_on', 'tr.travelled_on'), 'text').as('on')
			])
			.where('il.invoice_id', '=', inv.id)
			.orderBy('il.seq')
			.execute(),
		db
			.selectFrom(balances(TAX_ROUNDING, places).as('b'))
			.select((eb) => {
				// Its taxed lines.
				const taxed = () =>
					eb
						.selectFrom('invoice_line as il')
						.where('il.invoice_id', '=', inv.id)
						.where('il.taxable', '=', true);
				return [
					eb.cast<string>('b.tax', 'text').as('tax'),
					eb.cast<string>('b.gross', 'text').as('gross'),
					eb.cast<string>('b.paid', 'text').as('paid'),
					eb.cast<string>('b.credited', 'text').as('credited'),
					eb.cast<string>('b.owed', 'text').as('owed'),
					taxed()
						.select((eb) => eb.cast<string | null>(eb.fn.max('il.tax_rate_pct'), 'text').as('r'))
						.as('rate_pct'),
					taxed()
						.select((eb) =>
							eb.cast<number>(eb.fn.count('il.tax_rate_pct').distinct(), 'integer').as('n')
						)
						.as('rates')
				];
			})
			.where('b.invoice_id', '=', inv.id)
			// Its own balance: there whenever the invoice is.
			.executeTakeFirstOrThrow()
	]);
	return { from, invoice, voided: false as const, lines, totals };
};
