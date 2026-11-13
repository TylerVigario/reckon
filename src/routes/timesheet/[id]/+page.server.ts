import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { personalToday } from '#lib/server/calendar.ts';
import { clientsAndSites, theTeam, timedServices } from '#lib/server/choices.ts';
import { pricesToday } from '#lib/server/prices.ts';
import { db } from '#lib/server/db/index.ts';
import {
	invoice,
	invoiceLine,
	personPaymentItem,
	service,
	timeEntry,
	timeEntryCrew,
	user
} from '#lib/server/db/schema/index.ts';
import { UUID } from '#lib/field-rules.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import { refusedForAccess } from '#lib/server/refused.ts';
import type { PageServerLoad } from './$types';

/**
 * ONE TIME ENTRY, TO CHANGE AFTER THE FACT (12 November 2026): the entry as it
 * is, which save it is (version), and what Add past work offers to choose from
 * (#lib/EntryForm). Whoever entered it, or someone with Full, changes or
 * removes it (api/time/[id]); someone with Field opens their own work -- an
 * entry of theirs, or a team's they were on -- and any other is not found.
 *
 * One an invoice was built from, or a payment recorded, says so instead of
 * opening to change: it is put right where it was used.
 */
export const load: PageServerLoad = async ({ params, locals, route, request }) => {
	if (!UUID.test(params.id)) error(404, 'No entry with that id.');
	const [found] = await db
		.select({
			id: timeEntry.id,
			version: timeEntry.version,
			created_by: timeEntry.createdBy,
			entered_by: user.name,
			worked_on: timeEntry.workedOn,
			seconds: timeEntry.seconds,
			started_at: timeEntry.startedAt,
			ended_at: timeEntry.endedAt,
			zone: timeEntry.zone,
			crew: timeEntry.crew,
			worked_by: timeEntry.workedBy,
			entity_id: timeEntry.entityId,
			site_id: timeEntry.siteId,
			service_id: timeEntry.serviceId,
			service: service.name,
			billable: timeEntry.billable,
			note: timeEntry.note,
			invoice_id: invoiceLine.invoiceId,
			invoice_number: invoice.number,
			invoice_status: invoice.status
		})
		.from(timeEntry)
		.innerJoin(user, eq(user.id, timeEntry.createdBy))
		.innerJoin(service, eq(service.id, timeEntry.serviceId))
		.leftJoin(invoiceLine, eq(invoiceLine.timeEntryId, timeEntry.id))
		.leftJoin(invoice, eq(invoice.id, invoiceLine.invoiceId))
		.where(eq(timeEntry.id, params.id));
	if (!found) error(404, 'No entry with that id.');

	const me = locals.user!.id;
	const crew = await db
		.select({ id: timeEntryCrew.userId })
		.from(timeEntryCrew)
		.where(eq(timeEntryCrew.timeEntryId, found.id));
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

	const [paid] = await db
		.select({ to: user.name })
		.from(personPaymentItem)
		.innerJoin(user, eq(user.id, personPaymentItem.userId))
		.where(eq(personPaymentItem.timeEntryId, found.id))
		.limit(1);

	const [people, entities, services, prices] = await Promise.all([
		theTeam(),
		clientsAndSites(),
		timedServices(),
		pricesToday()
	]);
	return {
		entry: {
			...found,
			started_at: found.started_at?.toISOString() ?? null,
			ended_at: found.ended_at?.toISOString() ?? null,
			crew_ids: crewIds
		},
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
		prices
	};
};
