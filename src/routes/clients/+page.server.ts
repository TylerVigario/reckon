import { sql, type NumericString } from 'kysely';
import { db } from '#lib/server/db/index.ts';
import { balances } from '#lib/server/balances.ts';
import { moneyPlaces, taxRounding } from '#lib/server/business.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import type { PageServerLoad } from './$types';

/**
 * Entities: the three things, and none owns another.
 *
 * A client is a business; a site is a place; a contact is a person. Two clients
 * can work at one address and each names it their own way, so the count beside
 * a client is that client's sites, not the address book's. Someone with Field
 * reads them to work at, without what each owes (#lib/access).
 */
export const load: PageServerLoad = async ({ locals }) => {
	const [rounding, places] = await Promise.all([taxRounding(), moneyPlaces()]);

	const [clients, contacts] = await Promise.all([
		db
			.with('owing', (qc) =>
				qc
					.selectFrom(balances(rounding, places).as('b'))
					.where('b.status', '=', 'sent')
					.groupBy('b.entity_id')
					.select((eb) => ['b.entity_id', eb.fn.sum<NumericString>('b.owed').as('owed')])
			)
			.selectFrom('entity as e')
			.leftJoin('site as si', (join) =>
				join.onRef('si.entity_id', '=', 'e.id').on('si.active', '=', true)
			)
			.leftJoin('owing as o', 'o.entity_id', 'e.id')
			.select((eb) => [
				'e.id',
				'e.slug',
				'e.name',
				'e.active',
				eb
					.selectFrom('entity_contact as ec')
					.innerJoin('contact as c', 'c.id', 'ec.contact_id')
					.select('c.name')
					.whereRef('ec.entity_id', '=', 'e.id')
					.where('ec.is_primary', '=', true)
					.limit(1)
					.as('contact'),
				eb.cast<string>(eb.fn.count('si.id'), 'text').as('sites'),
				eb.fn
					.agg<string | null>('string_agg', ['si.display', eb.val(' · ')])
					.orderBy('si.display')
					.as('site_labels'),
				sql<string>`round(coalesce(${eb.ref('o.owed')}, 0), ${places}::int)::text`.as('owed')
			])
			.groupBy(['e.id', 'o.owed'])
			.orderBy('e.active', 'desc')
			.orderBy('e.name')
			.execute(),
		db
			.selectFrom('contact')
			.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
			.executeTakeFirstOrThrow()
	]);

	return {
		clients: fieldOnly(locals) ? clients.map((x) => ({ ...x, owed: null })) : clients,
		// For Entities' other tab.
		counts: { contacts: contacts.n }
	};
};
