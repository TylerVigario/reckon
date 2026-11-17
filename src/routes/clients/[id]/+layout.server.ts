import { sql, type NumericString } from 'kysely';
import { db } from '#lib/server/db/index.ts';
import { balances } from '#lib/server/balances.ts';
import { moneyPlaces, taxRounding } from '#lib/server/business.ts';
import { findClient } from '#lib/server/find.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import type { LayoutServerLoad } from './$types';

/**
 * One client, as each of their tabs heads them (+layout): who they are,
 * whether they are still worked for, what they owe and on how many invoices,
 * and how many sites and contacts they have. Someone with Field reads where a
 * client is and whom to ask for, and nothing of what they owe (#lib/access).
 */
export const load: LayoutServerLoad = async ({ params, locals }) => {
	const { id } = await findClient(params.id);
	const field = fieldOnly(locals);
	const [rounding, places] = await Promise.all([taxRounding(), moneyPlaces()]);
	const owing = balances(rounding, places).as('b');

	const [client, sites, contacts] = await Promise.all([
		db
			.selectFrom('entity as e')
			.select((eb) => {
				const sent = eb
					.selectFrom(owing)
					.whereRef('b.entity_id', '=', 'e.id')
					.where('b.status', '=', 'sent');
				const owed = sent.select((eb) => eb.fn.sum<NumericString>('b.owed').as('owed')).$asScalar();
				const out = sent
					.where('b.owed', '>', '0')
					.select((eb) => eb.fn.countAll().as('n'))
					.$asScalar();
				return [
					'e.id',
					'e.slug',
					'e.name',
					'e.active',
					sql<string>`round(coalesce(${owed}, 0), ${places}::int)::text`.as('owed'),
					eb.cast<string>(out, 'text').as('out')
				];
			})
			.where('e.id', '=', id)
			.executeTakeFirstOrThrow(),
		db
			.selectFrom('site')
			.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
			.where('entity_id', '=', id)
			.where('active', '=', true)
			.executeTakeFirstOrThrow(),
		db
			.selectFrom('entity_contact')
			.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
			.where('entity_id', '=', id)
			.executeTakeFirstOrThrow()
	]);

	return {
		client: field ? { ...client, owed: null, out: null } : client,
		counts: { sites: sites.n, contacts: contacts.n }
	};
};
