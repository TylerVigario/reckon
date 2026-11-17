import { error } from '@sveltejs/kit';
import { personalToday } from '#lib/server/calendar.ts';
import { clientsAndSites, theTeam, timedServices } from '#lib/server/choices.ts';
import { pricesToday } from '#lib/server/prices.ts';
import { db } from '#lib/server/db/index.ts';
import { UUID } from '#lib/field-rules.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import { refusedForAccess } from '#lib/server/refused.ts';
import { fieldsOfEntry } from '#lib/entry-merge.ts';
import type { PageServerLoad } from './$types';

/**
 * ONE TIME ENTRY, TO CHANGE AFTER THE FACT (12 November 2026): the entry as it
 * is, which save it is (version) and its fields as the form sends them (base),
 * which a change says it began from, and what Add past work offers to choose
 * from (#lib/EntryForm). Kept for no signal for whoever entered it, this week
 * and last (api/offline), so a change is made on site and sent later. Whoever entered it, or someone with Full, changes or
 * removes it (api/time/[id]); someone with Field opens their own work -- an
 * entry of theirs, or a team's they were on -- and any other is not found.
 *
 * One an invoice was built from, or a payment recorded, says so instead of
 * opening to change: it is put right where it was used.
 */
export const load: PageServerLoad = async ({ params, locals, route, request }) => {
	if (!UUID.test(params.id)) error(404, 'No entry with that id.');
	const found = await db
		.selectFrom('time_entry')
		.innerJoin('user', 'user.id', 'time_entry.created_by')
		.innerJoin('service', 'service.id', 'time_entry.service_id')
		.leftJoin('invoice_line', 'invoice_line.time_entry_id', 'time_entry.id')
		.leftJoin('invoice', 'invoice.id', 'invoice_line.invoice_id')
		.select([
			'time_entry.id',
			'time_entry.version',
			'time_entry.created_by',
			'user.name as entered_by',
			'time_entry.worked_on',
			'time_entry.seconds',
			'time_entry.started_at',
			'time_entry.ended_at',
			'time_entry.zone',
			'time_entry.crew',
			'time_entry.worked_by',
			'time_entry.entity_id',
			'time_entry.site_id',
			'time_entry.service_id',
			'service.name as service',
			'time_entry.billable',
			'time_entry.note',
			'invoice_line.invoice_id',
			'invoice.number as invoice_number',
			'invoice.status as invoice_status'
		])
		.where('time_entry.id', '=', params.id)
		.executeTakeFirst();
	if (!found) error(404, 'No entry with that id.');

	const me = locals.user!.id;
	const crew = await db
		.selectFrom('time_entry_crew')
		.select('user_id as id')
		.where('time_entry_id', '=', found.id)
		.execute();
	const crewIds = crew.map((c) => c.id);
	if (
		fieldOnly(locals) &&
		found.created_by !== me &&
		found.worked_by !== me &&
		!crewIds.includes(me)
	) {
		await refusedForAccess({ locals, route, request });
		error(404, 'No entry with that id.');
	}

	const paid = await db
		.selectFrom('person_payment_item')
		.innerJoin('user', 'user.id', 'person_payment_item.user_id')
		.select('user.name as to')
		.where('person_payment_item.time_entry_id', '=', found.id)
		.limit(1)
		.executeTakeFirst();

	const [people, entities, services, prices] = await Promise.all([
		theTeam(),
		clientsAndSites(),
		timedServices(),
		pricesToday()
	]);
	const entry = {
		...found,
		started_at: found.started_at?.toISOString() ?? null,
		ended_at: found.ended_at?.toISOString() ?? null,
		crew_ids: crewIds
	};
	return {
		entry,
		base: fieldsOfEntry(entry),
		/** Why it stays as it is, where it does: on an invoice, or in a payment. */
		used: found.invoice_id
			? {
					invoice: found.invoice_id,
					number: found.invoice_number,
					draft: found.invoice_status === 'draft'
				}
			: null,
		paidTo: paid?.to ?? null,
		/** Whether the person signed in may change it: whoever entered it, or Full. */
		mayChange: !fieldOnly(locals) || found.created_by === me,
		today: personalToday(),
		me,
		people,
		entities,
		services,
		prices,
		as_of: new Date().toISOString()
	};
};
