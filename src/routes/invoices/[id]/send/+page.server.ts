import { error, redirect } from '@sveltejs/kit';
import { sql } from 'kysely';
import { db } from '#lib/server/db/index.ts';
import { balances } from '#lib/server/balances.ts';
import { moneyPlaces } from '#lib/server/business.ts';
import { TAX_ROUNDING } from '#lib/server/tax-rules.ts';
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
	const places = await moneyPlaces();
	const owing = balances(TAX_ROUNDING, places);
	const today = businessToday();

	const inv = await db
		.selectFrom('invoice as i')
		.innerJoin('entity as e', 'e.id', 'i.entity_id')
		.select((eb) => [
			'i.id',
			'i.client_uuid',
			'i.number',
			'i.status',
			'e.name as who',
			eb
				.cast<number>(
					eb.fn.coalesce(
						'e.terms_days',
						eb.selectFrom('operator').select('operator.default_terms_days'),
						eb.lit(0)
					),
					'integer'
				)
				.as('terms'),
			eb
				.cast<string>(
					eb.selectFrom(owing.as('b')).select('b.gross').whereRef('b.invoice_id', '=', 'i.id'),
					'text'
				)
				.as('due'),
			eb
				.cast<string>(
					eb.selectFrom(owing.as('b')).select('b.tax').whereRef('b.invoice_id', '=', 'i.id'),
					'text'
				)
				.as('tax'),
			eb
				.cast<number>(
					eb
						.selectFrom('invoice_line')
						.select((eb) => eb.fn.countAll().as('n'))
						.whereRef('invoice_line.invoice_id', '=', 'i.id'),
					'integer'
				)
				.as('lines')
		])
		.where('i.id', '=', params.id)
		.executeTakeFirst();
	if (!inv) error(404, 'no such invoice');
	if (inv.status !== 'draft') redirect(303, `/invoices/${inv.id}`);

	const contact = await db
		.selectFrom('entity_contact as ec')
		.innerJoin('contact as c', 'c.id', 'ec.contact_id')
		.innerJoin('invoice as i', 'i.entity_id', 'ec.entity_id')
		.select(['c.name', 'c.email', 'c.phone'])
		.where('i.id', '=', inv.id)
		.where('ec.is_primary', '=', true)
		.executeTakeFirst();
	const { due_on } = await db
		.selectNoFrom(sql<string>`(${today}::date + ${inv.terms}::int)::text`.as('due_on'))
		.executeTakeFirstOrThrow();

	return { invoice: inv, contact: contact ?? null, today, due_on };
};
